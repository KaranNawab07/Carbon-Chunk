import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF, Environment } from "@react-three/drei";
import { createOverlayRipple } from "./shaders/overlayRipple";

const MODEL_URL = "/model.glb";
const USE_DEBUG_KEYS = true;

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
  const hitTargets = useRef<THREE.Mesh[]>([]);
  const { gl, camera } = useThree();
  const raycaster = useRef(new THREE.Raycaster()).current;

  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    const baseMeshes: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) baseMeshes.push(child);
    });

    overlayMats.current = [];
    hitTargets.current = [];

    for (const mesh of baseMeshes) {
      mesh.raycast = THREE.Mesh.prototype.raycast;
      const mat = createOverlayRipple();
      mat.uniforms.u_useUV.value = mesh.geometry.attributes?.uv ? 1.0 : 0.0;
      
      // Set up ripple parameters
      mat.uniforms.u_mode.value = 0;        // normal ripple mode
      mat.uniforms.u_radius.value = 0.5;    // larger ripple radius
      mat.uniforms.u_sigma.value = 0.1;     // thicker ring
      mat.uniforms.u_intensity.value = 2.0; // much brighter
      mat.uniforms.u_speed.value = 2.0;     // expansion speed
      
      console.log('Created ripple overlay for mesh with UVs:', !!mesh.geometry.attributes?.uv);

      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.raycast = () => {};
      overlay.renderOrder = 9999;
      overlay.frustumCulled = mesh.frustumCulled;

      mesh.userData.__overlayAdded = true;
      mesh.add(overlay);

      overlayMats.current.push(mat);
      hitTargets.current.push(mesh);
    }
    return root;
  }, [scene]);

  useEffect(() => {
    const el = gl.domElement;
    const handler = (ev: PointerEvent) => {
      if (!hitTargets.current.length) return;

      const rect = el.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera({ x, y }, camera);
      const hits = raycaster.intersectObjects(hitTargets.current, true);

      console.log('Raycast hits:', hits.length);

      for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);

      if (hits.length) {
        const hit = hits[0];
        const uv = hit.uv ?? null;
        const pt = hit.point;

        console.log('Hit UV:', uv?.x.toFixed(3), uv?.y.toFixed(3));

        for (const m of overlayMats.current) m.uniforms.u_mouseWorld.value.copy(pt);

        if (uv) {
          const base = hit.object as THREE.Mesh;
          const overlay = base.children.find(
            (c: any) => c.isMesh && c.material && c.material.uniforms
          ) as THREE.Mesh | undefined;

          if (overlay) {
            const mat = overlay.material as THREE.ShaderMaterial;
            mat.uniforms.u_mouse.value.set(uv.x, uv.y);
            console.log('RIPPLE AT UV:', uv.x.toFixed(3), uv.y.toFixed(3));
          }
        }
      } else {
        // Hide ripples when not hovering
        for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);
      }
    };
    el.addEventListener("pointermove", handler, { passive: true });
    return () => el.removeEventListener("pointermove", handler);
  }, [gl, camera, raycaster]);

  useEffect(() => {
    if (!USE_DEBUG_KEYS) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (!overlayMats.current.length) return;
      if (k === "1") overlayMats.current.forEach(m => m.uniforms.u_mode.value = 1);
      if (k === "2") { overlayMats.current.forEach(m => { m.uniforms.u_mode.value = 2; m.uniforms.u_mouse.value.set(0.5,0.5); }); }
      if (k === "3") overlayMats.current.forEach(m => m.uniforms.u_mode.value = 0);
      if (k === "4") overlayMats.current.forEach(m => m.uniforms.u_mode.value = 4);
      if (k === "5") overlayMats.current.forEach(m => m.uniforms.u_mode.value = 5);
      if (k === "6") overlayMats.current.forEach(m => m.uniforms.u_mode.value = 6);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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