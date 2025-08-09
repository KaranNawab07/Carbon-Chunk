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
  const lastUV = useRef<THREE.Vector2 | null>(null);
  const lastPt = useRef<THREE.Vector3 | null>(null);
  const hideTimer = useRef<number | null>(null);
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

    console.log('Found base meshes:', baseMeshes.length);

    overlayMats.current = [];
    hitTargets.current = [];

    for (const mesh of baseMeshes) {
      mesh.raycast = THREE.Mesh.prototype.raycast;
      
      // Create shader material with ripple effect
      const shaderMat = createOverlayRipple();
      
      // Set ripple mode with visible settings
      shaderMat.uniforms.u_mode.value = 0;        // ripple mode
      shaderMat.uniforms.u_speed.value = 2.0;     // animation speed
      shaderMat.uniforms.u_radius.value = 0.30;   // ripple radius
      shaderMat.uniforms.u_sigma.value = 0.08;    // ring thickness
      shaderMat.uniforms.u_intensity.value = 0.45; // visibility
      
      const overlay = new THREE.Mesh(mesh.geometry, shaderMat);
      
      // Keep overlay glued to base surface
      overlay.position.set(0, 0, 0);
      
      // Overlay should never intercept pointer events
      overlay.raycast = () => {};
      overlay.renderOrder = 9999;
      overlay.frustumCulled = mesh.frustumCulled;
      
      console.log('Creating overlay for mesh:', mesh.name || 'unnamed');

      mesh.userData.__overlayAdded = true;
      
      // Add overlay as child of the mesh
      mesh.add(overlay);

      // Store the shader material
      overlayMats.current.push(shaderMat);
      hitTargets.current.push(mesh);
    }
    
    console.log('Created overlays:', overlayMats.current.length);
    console.log('Root children after overlay creation:', root.children.length);
    
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

      // cancel any pending hide (we got activity)
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      if (hits.length) {
        const hit = hits[0];
        const uv = (hit.uv ?? null) as THREE.Vector2 | null;
        const pt = hit.point;

        // remember last-known hit
        if (uv) {
          if (!lastUV.current) lastUV.current = new THREE.Vector2();
          lastUV.current.set(uv.x, uv.y);
        }
        if (!lastPt.current) lastPt.current = new THREE.Vector3();
        lastPt.current.copy(pt);

        // world point for all overlays
        if (lastPt.current) {
          for (const m of overlayMats.current) {
            m.uniforms.u_mouseWorld.value.copy(lastPt.current);
          }
        }

        // set UV center on the hit mesh's overlay; others keep their last UV
        if (uv) {
          let base: THREE.Object3D | null = hit.object;
          while (base && !(base as any).isMesh) base = base.parent;
          const overlay = base
            ? (base.children.find(
                (c: any) => c.isMesh && c.material && c.material.uniforms
              ) as THREE.Mesh | undefined)
            : undefined;

          if (overlay) {
            (overlay.material as THREE.ShaderMaterial).uniforms.u_mouse.value.set(uv.x, uv.y);
          }
          // keep showing last UV (prevents flicker)
          for (const m of overlayMats.current) {
            m.uniforms.u_mouse.value.copy(lastUV.current);
          }
        }
      } else {
        // no hit this frame — DO NOT blank immediately.
        // schedule a gentle hide in 250ms (user likely left the model)
        if (!hideTimer.current) {
          hideTimer.current = window.setTimeout(() => {
            lastUV.current = null;
            lastPt.current = null;
            for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);
            hideTimer.current = null;
          }, 250);
        }
      }
    };
    
    const onLeave = () => {
      if (hideTimer.current) { 
        window.clearTimeout(hideTimer.current); 
        hideTimer.current = null; 
      }
      lastUV.current = null;
      lastPt.current = null;
      for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);
    };
    
    el.addEventListener("pointermove", handler, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      el.removeEventListener("pointermove", handler);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, camera, raycaster]);

  useEffect(() => {
    if (!USE_DEBUG_KEYS) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      console.log('Key pressed:', k, 'Overlay materials:', overlayMats.current.length);
      if (!overlayMats.current.length) return;
      if (k === "1") {
        console.log('Setting mode 1 (UV debug)');
        overlayMats.current.forEach(m => m.uniforms.u_mode.value = 1);
      }
      if (k === "2") {
        console.log('Setting mode 2 (Red debug)');
        overlayMats.current.forEach(m => {
          m.uniforms.u_mode.value = 2;
          m.uniforms.u_mouse.value.set(0.5, 0.5);
        });
      }
      if (k === "3") {
        console.log('Setting mode 0 (Ripple)');
        overlayMats.current.forEach(m => m.uniforms.u_mode.value = 0);
      }
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