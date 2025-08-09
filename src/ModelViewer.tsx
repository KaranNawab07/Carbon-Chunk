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

  // Base template overlay (we will CLONE this per mesh)
  const overlayTemplate = useMemo(
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

  // Registry of all overlay materials so we can update uniforms on every clone
  const overlayMats = useRef<THREE.ShaderMaterial[]>([]);

  // Animate time & autorotate
  useFrame((_, delta) => {
    // advance time on ALL overlays
    for (const m of overlayMats.current) {
      m.uniforms.u_time.value += delta;
    }
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Map cursor to UV space when available and push to ALL overlays
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return;
    const x = e.uv.x;
    const y = e.uv.y;
    for (const m of overlayMats.current) {
      m.uniforms.u_mouse.value.set(x, y);
    }
  };

  // Load GLB and add overlay meshes without touching base materials
  const { scene } = useGLTF(MODEL_URL);
  const cloned = useMemo(() => {
    const copy = scene.clone(true);
    centerAndScaleToUnit(copy, 2.0);

    // clear registry (in case of HMR)
    overlayMats.current = [];

    copy.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        // Ensure raycasting works for pointer events
        child.raycast = THREE.Mesh.prototype.raycast;

        // Clone per-mesh overlay so we can set u_useUV individually
        const mat = overlayTemplate.clone() as THREE.ShaderMaterial;

        // IMPORTANT: clones have their own uniforms — set per-mesh flags here
        const hasUV = !!child.geometry.attributes?.uv;
        mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

        // Track the clone so it receives time/mouse updates
        overlayMats.current.push(mat);

        // Create overlay mesh
        const overlay = new THREE.Mesh(child.geometry, mat);
        overlay.frustumCulled = child.frustumCulled;
        overlay.renderOrder = (child.renderOrder || 0) + 1;

        // Add overlay (keeps original PBR material intact underneath)
        child.add(overlay);
      }
    });

    return copy;
  }, [scene, overlayTemplate]);

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