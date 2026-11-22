"""
ANTENNA AI — Local Python Surrogate Inference Bridge

Loads `AntennaSurrogatePredictor` from `predict.py` and the trained
`antenna_surrogate_ensemble.joblib` weights once at startup and exposes
a lightweight JSON HTTP API on 127.0.0.1:5055 using Python's stdlib
`http.server` (no FastAPI/Flask dependency required).
"""

from __future__ import annotations

import argparse
import importlib.util
import inspect
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = Path(__file__).resolve().parent


def resolve_first_existing(candidates: List[Path]) -> Optional[Path]:
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return None


def find_model_path() -> Optional[Path]:
    env_path = os.environ.get("ANTENNA_MODEL_PATH", "").strip()
    candidates: List[Path] = []
    if env_path:
        candidates.append(Path(env_path))
    candidates.extend([
        ML_DIR / "antenna_surrogate_ensemble.joblib",
        REPO_ROOT / "antenna_surrogate_ensemble.joblib",
    ])
    return resolve_first_existing(candidates)


def find_predict_py() -> Optional[Path]:
    env_dir = os.environ.get("ANTENNA_PREDICT_DIR", "").strip()
    candidates: List[Path] = []
    if env_dir:
        candidates.append(Path(env_dir) / "predict.py")
    candidates.extend([
        ML_DIR / "predict.py",
        REPO_ROOT / "predict.py",
    ])
    return resolve_first_existing(candidates)


def find_schema_path() -> Optional[Path]:
    candidates = [
        ML_DIR / "antenna_feature_schema.json",
        REPO_ROOT / "antenna_feature_schema.json",
    ]
    return resolve_first_existing(candidates)


def extract_metric_float(entry: Any) -> float:
    """
    Supports both scalar predictions (float/int) and AntennaSurrogatePredictor's
    nested format: {"ensemble": 6.057, "unit": "dBi"}.
    """
    if isinstance(entry, dict):
        if "ensemble" in entry:
            return float(entry["ensemble"])
        for val in entry.values():
            if isinstance(val, (int, float)):
                return float(val)
        raise ValueError(f"Could not extract numeric value from prediction entry: {entry}")
    return float(entry)


def format_prediction_entry(raw: Dict[str, Any]) -> Dict[str, float]:
    preds = raw.get("predictions", raw) if isinstance(raw, dict) else raw
    return {
        "gainDbi": extract_metric_float(preds["gainDbi"]),
        "bandwidthMHz": extract_metric_float(preds["bandwidthMHz"]),
        "resonantFreqGHz": extract_metric_float(preds["resonantFreqGHz"]),
        "efficiencyPct": extract_metric_float(preds["efficiencyPct"]),
    }


class SurrogateRuntime:
    def __init__(self) -> None:
        self.predictor: Any = None
        self.model_path: Optional[Path] = find_model_path()
        self.predict_py_path: Optional[Path] = find_predict_py()
        self.schema_path: Optional[Path] = find_schema_path()
        self.predictor_class: Optional[str] = None
        self.supports_model_arg: bool = False
        self.error: Optional[str] = None
        self._load()

    def _load(self) -> None:
        if not self.model_path:
            self.error = "antenna_surrogate_ensemble.joblib not found in ml/ or project root."
            return
        if not self.predict_py_path:
            self.error = "predict.py not found in ml/ or project root."
            return

        try:
            predict_dir = str(self.predict_py_path.parent)
            if predict_dir not in sys.path:
                sys.path.insert(0, predict_dir)

            spec = importlib.util.spec_from_file_location("predict", str(self.predict_py_path))
            if spec is None or spec.loader is None:
                raise RuntimeError(f"Could not create module spec for {self.predict_py_path}")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            predictor_cls = getattr(module, "AntennaSurrogatePredictor", None)
            if predictor_cls is None:
                raise RuntimeError("AntennaSurrogatePredictor class not found in predict.py")

            init_sig = inspect.signature(predictor_cls.__init__)
            if "schema_path" in init_sig.parameters and self.schema_path:
                self.predictor = predictor_cls(
                    str(self.model_path),
                    schema_path=str(self.schema_path),
                )
            else:
                self.predictor = predictor_cls(str(self.model_path))

            self.predictor_class = predictor_cls.__name__

            sig = inspect.signature(self.predictor.predict)
            self.supports_model_arg = "model" in sig.parameters or any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            )
            self.error = None
        except Exception as exc:  # noqa: BLE001
            self.predictor = None
            self.error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()

    def predict_one(self, design: Dict[str, Any], model_name: Optional[str] = None) -> Dict[str, Any]:
        if self.predictor is None:
            raise RuntimeError(self.error or "Surrogate model is not loaded")

        if self.supports_model_arg and model_name:
            raw = self.predictor.predict(design, model=model_name)
        else:
            raw = self.predictor.predict(design)

        return {
            "predictions": format_prediction_entry(raw),
            "fidelity": raw.get("fidelity") if isinstance(raw, dict) else None,
            "raw": raw if isinstance(raw, dict) else None,
        }

    def predict_batch(self, items: List[Dict[str, Any]], model_name: Optional[str] = None) -> List[Dict[str, float]]:
        if self.predictor is None:
            raise RuntimeError(self.error or "Surrogate model is not loaded")
        if not items:
            return []

        # Fast vectorized batch path when standard AntennaSurrogatePredictor attributes are present
        if (
            not (self.supports_model_arg and model_name)
            and hasattr(self.predictor, "_prepare_feature_row")
            and hasattr(self.predictor, "_compute_physics_features")
            and hasattr(self.predictor, "models")
            and hasattr(self.predictor, "target_weights")
            and hasattr(self.predictor, "targets")
        ):
            import numpy as np
            import pandas as pd

            p = self.predictor
            base_df = pd.DataFrame([p._prepare_feature_row(rec) for rec in items])
            full_df = p._compute_physics_features(base_df)
            n = len(full_df)
            f0_mhz = full_df["operatingFreqGHz"].values.astype(float) * 1000.0

            ens_outputs: Dict[str, Any] = {t: np.zeros(n, dtype=float) for t in p.targets}
            for t in p.targets:
                models_for_target = p.models[t]
                w = p.target_weights[t]
                for m_name, model in models_for_target.items():
                    feats_needed = getattr(model, "feature_names_in_", None)
                    if feats_needed is not None:
                        X_in = full_df[[f for f in feats_needed if f in full_df.columns]]
                    else:
                        X_in = full_df[[c for c in full_df.columns if c not in ["simulationId", "topologyName"]]]
                    raw_vals = np.asarray(model.predict(X_in), dtype=float)
                    vals = raw_vals * f0_mhz if m_name.startswith("FBW_") else raw_vals
                    ens_outputs[t] += w.get(m_name, 0.0) * vals

            # Apply exact-fit memory catalog overrides if present
            if getattr(p, "memory", None) is not None:
                mem = p.memory
                x_mat = full_df[p.base_features].values
                norm_x = (x_mat - p.mem_mean) / p.mem_std
                for i in range(n):
                    dists = np.linalg.norm(p.norm_mem_X - norm_x[i], axis=1)
                    min_idx = int(np.argmin(dists))
                    if dists[min_idx] < 0.05:
                        ens_outputs["gainDbi"][i] = float(mem["y_gain"][min_idx])
                        ens_outputs["bandwidthMHz"][i] = float(mem["y_bandwidth"][min_idx])
                        ens_outputs["resonantFreqGHz"][i] = float(mem["y_freq"][min_idx])
                        ens_outputs["efficiencyPct"][i] = float(mem["y_eff"][min_idx])

            results: List[Dict[str, float]] = []
            for i in range(n):
                results.append({
                    "gainDbi": round(float(ens_outputs["gainDbi"][i]), 3),
                    "bandwidthMHz": round(float(ens_outputs["bandwidthMHz"][i]), 3),
                    "resonantFreqGHz": round(float(ens_outputs["resonantFreqGHz"][i]), 3),
                    "efficiencyPct": round(float(ens_outputs["efficiencyPct"][i]), 3),
                })
            return results

        if self.supports_model_arg and model_name:
            raw_list = self.predictor.predict(items, model=model_name)
        else:
            raw_list = self.predictor.predict(items)

        if not isinstance(raw_list, list):
            raw_list = [raw_list]

        return [format_prediction_entry(item) for item in raw_list]


RUNTIME = SurrogateRuntime()


class BridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        if os.environ.get("PYTHON_BRIDGE_DEBUG") == "1":
            super().log_message(format, *args)

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(
                200 if RUNTIME.predictor is not None else 503,
                {
                    "ok": RUNTIME.predictor is not None,
                    "modelLoaded": RUNTIME.predictor is not None,
                    "modelPath": str(RUNTIME.model_path) if RUNTIME.model_path else None,
                    "predictPyPath": str(RUNTIME.predict_py_path) if RUNTIME.predict_py_path else None,
                    "schemaPath": str(RUNTIME.schema_path) if RUNTIME.schema_path else None,
                    "predictorClass": RUNTIME.predictor_class,
                    "pythonVersion": sys.version.split()[0],
                    "error": RUNTIME.error,
                },
            )
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/predict":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(raw_body) if raw_body else {}
        except Exception as exc:  # noqa: BLE001
            self._send_json(400, {"error": f"Invalid JSON payload: {exc}"})
            return

        if RUNTIME.predictor is None:
            self._send_json(503, {"error": RUNTIME.error or "Model not loaded"})
            return

        try:
            model_name = payload.get("model")
            if isinstance(payload.get("items"), list):
                results = RUNTIME.predict_batch(payload["items"], model_name=model_name)
                self._send_json(200, {"predictionsList": results})
                return

            design = payload.get("design", payload)
            if not isinstance(design, dict):
                self._send_json(400, {"error": "Expected design dictionary payload"})
                return

            result = RUNTIME.predict_one(design, model_name=model_name)
            self._send_json(200, result)
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": f"Inference failed: {exc}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="ANTENNA AI Python Surrogate Bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PYTHON_SURROGATE_PORT", "5055")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"ANTENNA AI Python Surrogate Bridge listening on http://{args.host}:{args.port}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
