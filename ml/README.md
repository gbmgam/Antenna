# Trained Antenna Surrogate ML Integration

This directory connects your offline trained **`AntennaSurrogatePredictor`** (`antenna_surrogate_ensemble.joblib` + `predict.py`) to the ANTENNA AI Express backend (`server.ts`).

## Setup (Local Machine)

1. Copy your trained files into `ml/`:
   - `ml/antenna_surrogate_ensemble.joblib`
   - `ml/predict.py`
   - `ml/antenna_feature_schema.json` (optional)

2. Install the Python dependencies:
   ```bash
   pip install -r ml/requirements.txt
   ```

3. Start the app (`npm run dev`). The Node.js server automatically detects `ml/antenna_surrogate_ensemble.joblib` + `ml/predict.py`, spawns `ml/bridge_server.py` on `127.0.0.1:5055`, and routes predictions, multi-frequency sweeps, fault diagnosis, NSGA-II optimization, and assistant synthesis through your trained `.joblib` ensemble.

## Remote Bridge Option

If you run `bridge_server.py` separately (for example, in a dedicated conda/venv environment):

```bash
python ml/bridge_server.py --host 127.0.0.1 --port 5055
```

Then set `PYTHON_SURROGATE_URL="http://127.0.0.1:5055"` in your `.env` file.
