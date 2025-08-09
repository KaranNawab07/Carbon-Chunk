import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
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
  const hitTargets = useRef<THREE.Mesh[]>([]);
  const { gl, camera, size } = useThree();
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

    // 1) Collect ONLY original meshes
    const targets: THREE.Mesh[] = [];
    root.traverse((child: any) => {
      if (child.isMesh && child.geometry && !child.userData.__overlayAdded) {
        targets.push(child);
      }
    });

    // 2) Create overlays in a separate pass
    overlayMats.current = [];
    hitTargets.current = [];

    for (const mesh of targets) {
      // Base mesh should receive raycasts (we'll raycast manually anyway)
      mesh.raycast = THREE.Mesh.prototype.raycast;

      // Fresh overlay material (additive) — DOES NOT replace your base PBR
      const mat = createOverlayRipple({
        // subtle, but you can tweak:
        // u_intensity: 0.35, u_radius: 0.26, u_sigma: 0.07, u_size: 4.0, u_speed: 0.5, u_facetMix: 0.2
      }) as THREE.ShaderMaterial;

      // UV vs World mode per mesh
      const hasUV = !!mesh.geometry.attributes?.uv;
      mat.uniforms.u_useUV.value = hasUV ? 1.0 : 0.0;

      // Overlay mesh
      const overlay = new THREE.Mesh(mesh.geometry, mat);
      overlay.raycast = () => {};           // never intercept pointer
      overlay.renderOrder = 9999;           // always after base
      overlay.frustumCulled = mesh.frustumCulled;

      mesh.userData.__overlayAdded = true;
      mesh.add(overlay);

      overlayMats.current.push(mat);
      hitTargets.current.push(mesh);        // we raycast base meshes only
    }

    return root;
  }, [scene]);

  // Manual raycast on the canvas to drive u_mouse (UV) & u_mouseWorld (world)
  useEffect(() => {
    const el = gl.domElement;

    const handler = (ev: PointerEvent) => {
      // Convert to normalized device coords
      const rect = el.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera({ x, y }, camera);
      // Intersect base meshes only
      const hits = raycaster.intersectObjects(hitTargets.current, true);

      if (hits && hits.length) {
        const hit = hits[0];
        const uv = (hit.uv ?? null) as THREE.Vector2 | null;
        const pt = hit.point;

        for (const m of overlayMats.current) {
          if (uv) m.uniforms.u_mouse.value.set(uv.x, uv.y);
          m.uniforms.u_mouseWorld.value.set(pt.x, pt.y, pt.z);
        }
      }
    };

    el.addEventListener("pointermove", handler, { passive: true });
    return () => el.removeEventListener("pointermove", handler);
  }, [gl, camera, size.width, size.height, raycaster]);

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