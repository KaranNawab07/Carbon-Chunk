import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF, Environment } from "@react-three/drei";
import { createOverlayRipple } from "./shaders/overlayRipple";

const MODEL_URL = "/model.glb";

function centerAndScaleToUnit(object: THREE.Object3D, targetSize = 2) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const scale = targetSize / maxDim;
  object.scale.setScalar(scale);
}

export default function ModelViewer() {
  const groupRef = useRef<THREE.Group>(null);

  // Keep references to every overlay material so we can update time/mouse
  const overlayMats = useRef<THREE.ShaderMaterial[]>([]);

  // Animate time & autorotate
  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Pointer -> UV mapped to ALL overlays
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return;
    const x = e.uv.x, y = e.uv.y;
    for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(x, y);
  };

  // Load & prep once
  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    // 1) Collect ONLY the original meshes (no overlay creation here)
    const targets: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        targets.push(child);
      }
    });

    // 2) Create overlays in a separate pass
    overlayMats.current = []; // reset (HMR-safe)
    for (const mesh of targets) {
      // Base must receive raycasts for e.uv
      mesh.raycast = THREE.Mesh.prototype.raycast;

      // Fresh material per mesh (avoids clone recursion & shared-uniform issues)
      const mat = createOverlayRipple({
        u_intensity: 0.7,
        u_radius: 0.22,
        u_size: 6.0,
        u_speed: 0.65,
        u_sharpness: 0.75,
        u_rippleColor: new THREE.Color(1, 1, 1),
      }) as THREE.ShaderMaterial;

      // If the mesh lacks UVs, use our fallback mapping
      const hasUV = !!mesh.geometry.attributes?.uv;
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      // Make overlay ignore pointer hits (so base mesh gets e.uv)
      // @ts-ignore
      mat.raycast = () => {};

      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.userData.__isOverlay = true;
      overlay.frustumCulled = mesh.frustumCulled;
      overlay.renderOrder = (mesh.renderOrder || 0) + 1;

      // Critical: mark base so we don't add again on HMR
      mesh.userData.__overlayAdded = true;

      // Add overlay as a child (inherits transforms) AFTER collection pass
      mesh.add(overlay);

      overlayMats.current.push(mat);
    }

    return root;
  }, [scene]);

  return (
    <>
      <Environment preset="studio" />
      <group ref={groupRef} onPointerMove={onPointerMove} dispose={null}>
        {prepared ? (
          <primitive object={prepared} />
        ) : (
          <Html center>
            <div style={{ color: "white", fontFamily: "sans-serif" }}>
              Model failed to load. Place <b>model.glb</b> in <b>public/</b>.
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);