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

  // Animate time & autorotate
  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Pointer -> update both UV and WORLD uniforms (used later after we remove diagnostics)
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    for (const m of overlayMats.current) {
      if (e.uv)    m.uniforms.u_mouse.value.set(e.uv.x, e.uv.y);
      if (e.point) m.uniforms.u_mouseWorld.value.set(e.point.x, e.point.y, e.point.z);
    }
  };

  // Load & prep once
  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    // 1) Collect ONLY original meshes
    const targets: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        targets.push(child);
      }
    });

    // 2) Create overlays in a separate pass
    overlayMats.current = []; // reset
    for (const mesh of targets) {
      // Base mesh should receive raycasts (for e.uv / e.point)
      mesh.raycast = THREE.Mesh.prototype.raycast;

      const mat = createOverlayRipple({
        // subtle defaults (we'll override below for diagnostics)
        // u_intensity: 0.35, u_radius: 0.26, u_sigma: 0.07
      }) as THREE.ShaderMaterial;

      const hasUV = !!mesh.geometry.attributes?.uv;
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      const overlay = new THREE.Mesh(mesh.geometry, mat);

      // ✳️ Critical: overlays must NOT capture pointer events
      overlay.raycast = () => {};

      // Draw after base material to avoid depth/ordering faintness
      overlay.renderOrder = 9999;
      overlay.frustumCulled = mesh.frustumCulled;

      mesh.userData.__overlayAdded = true;
      mesh.add(overlay);
      overlayMats.current.push(mat);

      // Optional log (helps confirm UV presence)
      // console.log("[overlay]", mesh.name || mesh.uuid, "hasUV=", hasUV);
    }

    // 3) 🔎 DIAGNOSTIC OVERRIDES (force a big pulse so you can see it)
    //    You should see a bright, wide pulse near UV center (0.5, 0.5).
    for (const m of overlayMats.current) {
      m.uniforms.u_useUV.value = 0.0;             // force WORLD test
      m.uniforms.u_mouseWorld.value.set(0, 0, 0); // origin (we centered the model)
      m.uniforms.u_intensity.value = 1.0;            // strong
      m.uniforms.u_radius.value    = 0.65;        // bigger for world scale
      m.uniforms.u_sigma.value     = 0.12;           // thick
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