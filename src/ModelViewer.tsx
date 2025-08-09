import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF, Environment } from "@react-three/drei";
import { createOverlayRipple } from "./shaders/overlayRipple";

const MODEL_URL = "/model.glb";
const USE_DEBUG_KEYS = true; // press 1..6 like the plain Three test

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

  // drive time + autorotate
  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // load GLB
  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    const baseMeshes: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        baseMeshes.push(child);
      }
    });

    overlayMats.current = [];
    hitTargets.current = [];

    console.log(`[diag] meshes found: ${baseMeshes.length}`);

    // add overlay child per mesh (keeps original materials)
    for (const mesh of baseMeshes) {
      mesh.raycast = THREE.Mesh.prototype.raycast; // ensure raycastable

      const hasUV = !!mesh.geometry.attributes?.uv;
      console.log(`[diag] mesh has UV: ${hasUV}`);

      const mat = createOverlayRipple();
      // SUPER aggressive diagnostics - should be impossible to miss
      mat.uniforms.u_mode.value = 4;        // raw ring
      mat.uniforms.u_speed.value = 0.0;     // freeze
      mat.uniforms.u_radius.value = 0.8;    // huge radius
      mat.uniforms.u_sigma.value = 0.2;     // thick ring
      mat.uniforms.u_intensity.value = 3.0; // super bright
      mat.uniforms.u_mouse.value.set(0.5, 0.5); // always show at center

      // your model has UVs — keep UV mode
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.raycast = () => {};     // never intercept pointer
      overlay.renderOrder = 9999;     // draw after base
      overlay.frustumCulled = mesh.frustumCulled;

      mesh.userData.__overlayAdded = true;
      mesh.add(overlay);

      overlayMats.current.push(mat);
      hitTargets.current.push(mesh);
    }

    return root;
  }, [scene]);

  // manual raycast from the canvas (bullet-proof cursor -> UVs)
  useEffect(() => {
    const el = gl.domElement;

    const handler = (ev: PointerEvent) => {
      if (hitTargets.current.length === 0) return;

      const rect = el.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera({ x, y }, camera);

      const hits = raycaster.intersectObjects(hitTargets.current, true);

      // hide UV ripple on all overlays by default
      for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);

      if (hits.length) {
        const hit = hits[0];
        const uv = hit.uv ?? null;
        const pt = hit.point;
        
        console.log(`[diag] hit detected, UV: ${uv ? `${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}` : 'none'}`);

        console.log(`[diag] hit detected, UV: ${uv ? `${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}` : 'none'}`);

        // world point for all overlays (in case you toggle world mode later)
        for (const m of overlayMats.current) m.uniforms.u_mouseWorld.value.copy(pt);

        // set UV center on the hit mesh only
        if (uv) {
          // find overlay material attached to that base mesh
          const base = hit.object as THREE.Mesh;
          const overlay = base.children.find(
            (c: any) => c.isMesh && c.material && c.material.uniforms
          ) as THREE.Mesh | undefined;

          if (overlay) {
            (overlay.material as THREE.ShaderMaterial).uniforms.u_mouse.value.set(uv.x, uv.y);
          }
        }
      }
    };

    el.addEventListener("pointermove", handler, { passive: true });
    return () => el.removeEventListener("pointermove", handler);
  }, [gl, camera, raycaster]);

  // optional: same debug keys as the standalone test (1..6)
  useEffect(() => {
    if (!USE_DEBUG_KEYS) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      if (!overlayMats.current.length) return;
      if (key === "1") { overlayMats.current.forEach(m => m.uniforms.u_mode.value = 1); console.log('[mode] UV gradient'); }
      if (key === "2") { overlayMats.current.forEach(m => { m.uniforms.u_mode.value = 2; m.uniforms.u_mouse.value.set(0.5,0.5); }); console.log('[mode] fixed pulse at center'); }
      if (key === "3") { overlayMats.current.forEach(m => m.uniforms.u_mode.value = 0); console.log('[mode] normal ripple'); }
      if (key === "4") { overlayMats.current.forEach(m => m.uniforms.u_mode.value = 4); console.log('[mode] raw ring'); }
      if (key === "5") { overlayMats.current.forEach(m => m.uniforms.u_mode.value = 5); console.log('[mode] area mask'); }
      if (key === "6") { overlayMats.current.forEach(m => m.uniforms.u_mode.value = 6); console.log('[mode] area*ring'); }
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
            <div style={{ color: "white", fontFamily: "system-ui, sans-serif" }}>
              Model failed to load. Place <b>model.glb</b> in <b>public/</b>.
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);