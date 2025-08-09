import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, ThreeEvent, useThree } from "@react-three/fiber";
import { Html, useGLTF, Environment, OrbitControls } from "@react-three/drei";
import { createRippleMaterial } from "./shaders/rippleMaterial";

const MODEL_URL = "/model.glb";
const DEBUG = true; // set to false after things look good

function centerAndScaleToUnit(object: THREE.Object3D, targetSize = 2) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // avoid NaNs for empty scenes
  if (!isFinite(size.x + size.y + size.z)) return;

  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const scale = targetSize / maxDim;
  object.scale.setScalar(scale);
}

export default function ModelViewer() {
  const groupRef = useRef<THREE.Group>(null);
  const { gl, scene: r3fScene } = useThree();

  // Shader material with brighter defaults for visibility
  const rippleMat = useMemo(
    () =>
      createRippleMaterial({
        u_baseColor: new THREE.Color(0.08, 0.08, 0.08),
        u_rippleColor: new THREE.Color(1.0, 1.0, 1.0),
        u_radius: 0.28,
        u_intensity: 0.85,
        u_size: 5.5,
        u_speed: 0.7,
        u_sharpness: 0.75,
      }),
    []
  );
  const u = (rippleMat as any).__rippleUniforms;

  // Load GLB
  const { scene } = useGLTF(MODEL_URL);
  const [meshCount, setMeshCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const cloned = useMemo(() => {
    const copy = scene.clone(true);
    centerAndScaleToUnit(copy, 2.0);

    let count = 0;
    copy.traverse((child: any) => {
      if (child.isMesh) {
        count++;
      }
    });
    setMeshCount(count);

    // Apply shader ONLY if UVs exist; otherwise use a visible fallback
    copy.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        if (child.geometry.attributes?.uv) {
          child.material = rippleMat;
        } else {
          child.material = new THREE.MeshStandardMaterial({
            color: 0x8888ff,
            metalness: 0.2,
            roughness: 0.6,
          });
          if (DEBUG) {
            console.warn(
              "[ModelViewer] Mesh has no UVs; using fallback material:",
              child.name || child.uuid
            );
          }
        }
        child.raycast = THREE.Mesh.prototype.raycast;
      }
    });

    return copy;
  }, [scene, rippleMat]);

  // Log on first render
  useEffect(() => {
    if (cloned) {
      setLoaded(true);
      if (DEBUG) {
        const names: string[] = [];
        cloned.traverse((c: any) => c.isMesh && names.push(c.name || c.uuid));
        console.log(
          `[ModelViewer] GLB loaded: ${meshCount} mesh(es). Names:`,
          names
        );
      }
    }
  }, [cloned, meshCount]);

  // Animate time + autorotate
  useFrame((_, delta) => {
    u.u_time.value += delta;
    if (groupRef.current) groupRef.current.rotation.y += 0.2 * delta;
  });

  // Pointer -> UV cursor
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) u.u_mouse.value.set(e.uv.x, e.uv.y);
  };

  // ---- DEBUG HELPERS ----
  const bboxRef = useRef<THREE.BoxHelper | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);
  const [showBBox, setShowBBox] = useState(DEBUG);
  const [useNormals, setUseNormals] = useState(false);

  useEffect(() => {
    if (!DEBUG || !cloned) return;

    // Axes helper
    if (!axesRef.current) {
      axesRef.current = new THREE.AxesHelper(1.5);
      axesRef.current.renderOrder = 9999;
      axesRef.current.layers.set(0);
      r3fScene.add(axesRef.current);
    }

    // Bounding box helper
    if (showBBox) {
      if (bboxRef.current) {
        r3fScene.remove(bboxRef.current);
        bboxRef.current.geometry.dispose();
        // @ts-ignore
        if (bboxRef.current.material) bboxRef.current.material.dispose?.();
      }
      bboxRef.current = new THREE.BoxHelper(cloned, 0x00ff88);
      r3fScene.add(bboxRef.current);
    } else {
      if (bboxRef.current) {
        r3fScene.remove(bboxRef.current);
        bboxRef.current.geometry.dispose();
        // @ts-ignore
        if (bboxRef.current.material) bboxRef.current.material.dispose?.();
        bboxRef.current = null;
      }
    }

    return () => {
      if (axesRef.current) {
        r3fScene.remove(axesRef.current);
        // @ts-ignore
        axesRef.current.geometry?.dispose?.();
        // @ts-ignore
        axesRef.current.material?.dispose?.();
        axesRef.current = null;
      }
      if (bboxRef.current) {
        r3fScene.remove(bboxRef.current);
        bboxRef.current.geometry.dispose();
        // @ts-ignore
        bboxRef.current.material?.dispose?.();
        bboxRef.current = null;
      }
    };
  }, [cloned, showBBox, r3fScene]);

  // Keyboard toggles
  useEffect(() => {
    if (!DEBUG) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b") setShowBBox((s) => !s);
      if (e.key.toLowerCase() === "n") setUseNormals((s) => !s);
      if (e.key.toLowerCase() === "r") {
        if (groupRef.current) groupRef.current.rotation.set(0, 0, 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Swap materials to normals if requested
  useEffect(() => {
    if (!cloned) return;
    cloned.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        if (useNormals) {
          child.userData.__origMat = child.material;
          child.material = new THREE.MeshNormalMaterial();
        } else if (child.userData.__origMat) {
          child.material = child.userData.__origMat;
          delete child.userData.__origMat;
        }
      }
    });
  }, [cloned, useNormals]);

  return (
    <>
      {!loaded && (
        <Html center>
          <div style={{ color: "white", fontFamily: "sans-serif" }}>
            Loading model…
          </div>
        </Html>
      )}

      {/* TEMP controls to help find the model; remove when done */}
      {DEBUG && <OrbitControls enableDamping dampingFactor={0.08} />}

      <Environment preset="studio" />

      <group ref={groupRef} onPointerMove={onPointerMove} dispose={null}>
        <primitive object={cloned} />
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);