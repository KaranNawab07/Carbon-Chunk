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

  // One shared overlay material instance for all meshes
  const overlayMat = useMemo(
    () =>
      createOverlayRipple({
        u_intensity: 0.7,
        u_radius: 0.22,
        u_size: 6.0,
        u_speed: 0.65,
        u_sharpness: 0.75,
        u_rippleColor: new THREE.Color(1.0, 1.0, 1.0),
      }),
    []
  );
  const u = (overlayMat as any).__rippleUniforms;

  // Animate time & autorotate
  useFrame((_, delta) => {
    u.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Map cursor to UV space when available
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) {
      u.u_mouse.value.set(e.uv.x, e.uv.y);
    } else {
      // fallback to screen coords (approximate)
      const x = (e.pointer.x + 1) * 0.5;
      const y = (e.pointer.y + 1) * 0.5;
      u.u_mouse.value.set(x, y);
    }
  };

  // Load GLB and add overlay meshes without touching base materials
  const { scene } = useGLTF(MODEL_URL);
  const cloned = useMemo(() => {
    const copy = scene.clone(true);
    centerAndScaleToUnit(copy, 2.0);

    copy.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        // Ensure raycasting works for pointer events
        child.raycast = THREE.Mesh.prototype.raycast;

        // Create an overlay mesh as a CHILD so it inherits transforms
        const mat = overlayMat.clone();
        // If the mesh has no UVs, tell shader to use fallback (world/triplanar-ish)
        (mat as any).__rippleUniforms.u_useUV.value = child.geometry.attributes?.uv ? 1.0 : 0.0;

        const overlay = new THREE.Mesh(child.geometry, mat);
        overlay.frustumCulled = child.frustumCulled;
        overlay.renderOrder = (child.renderOrder || 0) + 1;

        // Add overlay (keeps original material visible underneath)
        child.add(overlay);
      }
    });

    return copy;
  }, [scene, overlayMat]);

  return (
    <>
      <Environment preset="studio" />
      <group ref={groupRef} onPointerMove={onPointerMove} dispose={null}>
        {cloned ? (
          <primitive object={cloned} />
        ) : (
          <Html center>
            <div style={{ color: "white", fontFamily: "sans-serif" }}>
              Model failed to load. Place <b>model.glb</b> in the <b>public/</b> folder.
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);