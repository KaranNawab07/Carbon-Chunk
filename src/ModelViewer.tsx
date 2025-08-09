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
  const overlayMats = useRef<THREE.ShaderMaterial[]>([]);

  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // POINTER → update both UV-space and WORLD-space uniforms
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const uv = e.uv;
    const wp = e.point; // world-space hit point

    for (const m of overlayMats.current) {
      if (uv) m.uniforms.u_mouse.value.set(uv.x, uv.y);
      if (wp) m.uniforms.u_mouseWorld.value.set(wp.x, wp.y, wp.z);
    }
  };

  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    const targets: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        targets.push(child);
      }
    });

    overlayMats.current = [];
    for (const mesh of targets) {
      mesh.raycast = THREE.Mesh.prototype.raycast;

      const mat = createOverlayRipple({
        // keep these if you want the stronger debug visibility first run:
        u_intensity: 0.55,
        u_radius: 0.34,
        u_sigma: 0.08,
      }) as THREE.ShaderMaterial;

      const hasUV = !!mesh.geometry.attributes?.uv;
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      const overlay = new THREE.Mesh(mesh.geometry, mat);
      
      // ⬇️ make sure the overlay never steals pointer events
      overlay.raycast = () => {};
      
      // keep the rest
      overlay.userData.__isOverlay = true;
      overlay.frustumCulled = mesh.frustumCulled;
      overlay.renderOrder = (mesh.renderOrder || 0) + 1;

      mesh.userData.__overlayAdded = true;
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