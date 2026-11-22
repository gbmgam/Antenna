import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

interface STLPreview3DProps {
  buffer: ArrayBuffer | null;
  fileName?: string;
}

export const STLPreview3D: React.FC<STLPreview3DProps> = ({ buffer, fileName }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !buffer) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 400, container.clientHeight || 300);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040814);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || 400) / (container.clientHeight || 300),
      0.1,
      100,
    );
    camera.position.set(3.5, 2.8, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 1.1));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
    key.position.set(5, 7, 5);
    scene.add(key);

    const grid = new THREE.GridHelper(10, 20, 0x1e3a5f, 0x0c1b36);
    grid.position.y = -1.2;
    scene.add(grid);

    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();
    geometry.center();
    geometry.computeBoundingBox();

    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box?.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 3.0 / maxDim;

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xd97b43,
      metalness: 0.88,
      roughness: 0.25,
      clearcoat: 0.2,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.scale.setScalar(scale);
    scene.add(mesh);

    let frameId = 0;
    const renderLoop = () => {
      mesh.rotation.y += 0.004;
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderLoop);
    };
    frameId = requestAnimationFrame(renderLoop);

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      camera.aspect = e.contentRect.width / Math.max(1, e.contentRect.height);
      camera.updateProjectionMatrix();
      renderer.setSize(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      geometry.dispose();
      mat.dispose();
      env.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [buffer]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border border-sky-400/25 bg-[#040814]">
      <div ref={mountRef} className="h-full w-full" />
      {fileName && (
        <div className="pointer-events-none absolute top-2.5 left-2.5 rounded border border-sky-400/25 bg-[#060d20]/90 px-2.5 py-1 font-mono text-xs text-cyan-300">
          STL Mesh: {fileName}
        </div>
      )}
    </div>
  );
};
