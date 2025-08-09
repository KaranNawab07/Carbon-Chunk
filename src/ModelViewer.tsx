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

    console.log('Found base meshes:', baseMeshes.length);

    overlayMats.current = [];
    hitTargets.current = [];

    for (const mesh of baseMeshes) {
      mesh.raycast = THREE.Mesh.prototype.raycast;
      
      // Create a simple test material first
      const testMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });
      
      const overlay = new THREE.Mesh(mesh.geometry, testMat);
      
      // Copy all transform properties
      overlay.position.copy(mesh.position);
      overlay.rotation.copy(mesh.rotation);
      overlay.scale.copy(mesh.scale);
      overlay.quaternion.copy(mesh.quaternion);
      overlay.updateMatrix();
      
      // Disable raycasting for overlay
      overlay.raycast = () => {};
      
      // Force overlay to render on top with specific settings
      overlay.renderOrder = 1000;
      overlay.frustumCulled = false;
      overlay.matrixAutoUpdate = true;
      overlay.visible = true;
      
      // Force material to be visible
      testMat.visible = true;
      testMat.needsUpdate = true;
      
      console.log('Creating overlay for mesh:', mesh.name || 'unnamed');
      console.log('Overlay position:', overlay.position);
      console.log('Overlay visible:', overlay.visible);
      console.log('Material transparent:', mat.transparent);
      console.log('Material visible:', mat.visible);
      console.log('Overlay geometry vertices:', overlay.geometry.attributes.position?.count);

      mesh.userData.__overlayAdded = true;
      
      // Add overlay directly to root to ensure it's in the scene
      root.add(overlay);

      // Store the test material for now
      overlayMats.current.push(testMat as any);
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

      console.log('Raycast hits:', hits.length);

      for (const m of overlayMats.current) m.uniforms.u_mouse.value.set(-10, -10);

      if (hits.length) {
        const hit = hits[0];
        const uv = hit.uv ?? null;
        const pt = hit.point;

        console.log('Hit UV:', uv?.x.toFixed(3), uv?.y.toFixed(3));

        for (const m of overlayMats.current) m.uniforms.u_mouseWorld.value.copy(pt);

        if (uv) {
          // Update ALL overlay materials with the UV position
          for (const mat of overlayMats.current) {
            mat.uniforms.u_mouse.value.set(uv.x, uv.y);
          }
          console.log('RIPPLE AT UV:', uv.x.toFixed(3), uv.y.toFixed(3));
          console.log('Updated', overlayMats.current.length, 'overlay materials');
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