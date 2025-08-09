import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF, Environment } from "@react-three/drei";

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
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);
    return root;
  }, [scene]);

  return (
    <>
      <Environment preset="studio" />
      <group ref={groupRef} dispose={null}>
        {prepared ? (
          <primitive object={prepared} />
        ) : (
          <Html center>
            <div style={{ color: "white" }}>
              Model failed to load. Place <b>model.glb</b> in <b>public/</b>.
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);