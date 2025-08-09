import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF, Environment } from "@react-three/drei";
import { createOverlayRipple } from "./shaders/overlayRipple";

const MODEL_URL = "/model.glb";
const DIAG = true; // re-enable for debugging

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

  // Animate time & autorotate
  useFrame((_, delta) => {
    for (const m of overlayMats.current) m.uniforms.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Load & prep once
  const { scene } = useGLTF(MODEL_URL);
  const prepared = useMemo(() => {
    const root = scene.clone(true);
    centerAndScaleToUnit(root, 2.0);

    // collect original meshes
    const targets: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        targets.push(child);
      }
    });

    overlayMats.current = [];
    hitTargets.current = [];

    for (const mesh of targets) {
      mesh.raycast = THREE.Mesh.prototype.raycast; // ensure raycastable

      const mat = createOverlayRipple() as THREE.ShaderMaterial;
      const hasUV = !!mesh.geometry.attributes?.uv;
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.raycast = () => {};        // overlays never intercept events
      overlay.renderOrder = 9999;        // always after base
      overlay.frustumCulled = mesh.frustumCulled;

      mesh.userData.__overlayAdded = true;
      mesh.add(overlay);

      overlayMats.current.push(mat);
      hitTargets.current.push(mesh);

      // Debug: log UV presence per mesh
      console.log("[overlay]", mesh.name || mesh.uuid, "hasUV=", hasUV);
    }

    // 🔎 Diagnostic pulse (visible without moving the mouse). Remove after verifying.
    if (DIAG) {
      for (const m of overlayMats.current) {
        m.uniforms.u_intensity.value = 2.0;  // extra bright
        m.uniforms.u_radius.value    = 0.8;  // larger
        m.uniforms.u_sigma.value     = 0.2;  // thicker
        m.uniforms.u_mouse.value.set(0.5, 0.5);
        m.uniforms.u_mouseWorld.value.set(0, 0, 0);
        m.uniforms.u_rippleColor.value.set(1.0, 0.0, 0.0); // bright red for visibility
      }
      console.log("[DIAG] Applied diagnostic settings to", overlayMats.current.length, "materials");
    }

    return root;
  }, [scene]);

  // Manual raycast from canvas to drive UV + world uniforms
  useEffect(() => {
    const el = gl.domElement;

    const handler = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera({ x, y }, camera);
      const hits = raycaster.intersectObjects(hitTargets.current, true);

      if (hits.length) {
        const hit = hits[0];
        const uv = (hit.uv ?? null) as THREE.Vector2 | null;
        const pt = hit.point;
        
        console.log("[raycast] hit:", hit.object.name || hit.object.uuid, "uv:", uv, "point:", pt);

        for (const m of overlayMats.current) {
          if (uv) m.uniforms.u_mouse.value.set(uv.x, uv.y);
          m.uniforms.u_mouseWorld.value.set(pt.x, pt.y, pt.z);
          // Boost intensity on hover for debugging
          m.uniforms.u_intensity.value = 3.0;
        }
      } else {
        // Reset intensity when not hovering
        for (const m of overlayMats.current) {
          m.uniforms.u_intensity.value = 0.35;
        }
      }
    };

    el.addEventListener("pointermove", handler, { passive: true });
    return () => el.removeEventListener("pointermove", handler);
  }, [gl, camera, raycaster]);

  return (
    <>
      <Environment preset="studio" />
      <group ref={groupRef} dispose={null}>
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