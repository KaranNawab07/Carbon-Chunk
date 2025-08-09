import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import { createRippleMaterial } from "./shaders/rippleMaterial";

const MODEL_URL = "/model.glb";

function centerAndScaleToUnit(object: THREE.Object3D, targetSize = 2) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = targetSize / Math.max(maxDim, 1e-4);
  object.scale.setScalar(scale);
}

export default function ModelViewer() {
  const groupRef = useRef<THREE.Group>(null);
  const rippleMat = useMemo(() => createRippleMaterial(), []);
  const u = (rippleMat as any).__rippleUniforms;

  // Drive time for animation
  useFrame((_, delta) => { u.u_time.value += delta; });

  // Auto-rotate model
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Update mouse uniform from cursor position on the model
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) {
      u.u_mouse.value.set(e.uv.x, e.uv.y);
    }
  };

  // Load the GLB
  const { scene } = useGLTF(MODEL_URL);
  const cloned = useMemo(() => {
    const copy = scene.clone(true);
    centerAndScaleToUnit(copy, 2.0);
    // Apply ripple shader to meshes with UVs
    copy.traverse((child: any) => {
      if (child.isMesh && child.geometry?.attributes?.uv) {
        child.material = rippleMat;
      }
    });
    return copy;
  }, [scene, rippleMat]);

  return (
    <group
      ref={groupRef}
      onPointerMove={onPointerMove}
      dispose={null}
    >
      {cloned ? (
        <primitive object={cloned} />
      ) : (
        <Html center>
          <div style={{ color: "white", fontFamily: "sans-serif" }}>
            Model failed to load.  
            Please check if the GLB file exists.
          </div>
        </Html>
      )}
    </group>
  );
}

useGLTF.preload(MODEL_URL);