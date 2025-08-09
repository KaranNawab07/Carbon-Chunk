import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// studio-ish light so base shading looks sane even if your model has PBR
const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.7);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(3, 5, 2);
scene.add(dir);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 4);

// ---------- shader (simple, smooth, localized) ----------
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;

  uniform float u_time;
  uniform vec2  u_mouse;      // UV space (0..1), or (-10,-10) to hide
  uniform float u_radius;     // 0..1 in UV units
  uniform float u_sigma;      // ring thickness (Gaussian sigma)
  uniform float u_speed;      // outward speed
  uniform float u_intensity;  // strength
  uniform vec3  u_baseColor;  // base tint
  uniform vec3  u_rippleColor;// ripple tint

  float radialMask(vec2 p, float r) {
    float d = length(p);
    float w = fwidth(d) * 2.0;
    return 1.0 - smoothstep(r - w, r + w, d);
  }

  float gaussianRing(float dist, float sigma, float t, float speed) {
    float rc = t * speed;             // ring center radius
    float x = (dist - rc) / max(sigma, 1e-4);
    float g = exp(-0.5 * x * x);
    float fw = fwidth(dist) * 1.5;
    float g2 = exp(-0.5 * ((dist - rc) / max(sigma + fw, 1e-4)) * ((dist - rc) / max(sigma + fw, 1e-4)));
    return mix(g, g2, 0.5);
  }

  void main() {
    // hide effect if mouse is "off"
    if (u_mouse.x < 0.0) {
      gl_FragColor = vec4(u_baseColor, 1.0);
      return;
    }

    vec2 p = vUv - u_mouse;           // local to cursor (UV)
    float area   = radialMask(p, u_radius);
    float ring   = gaussianRing(length(p), u_sigma, u_time, u_speed);
    float amount = area * ring * u_intensity;

    vec3 color = mix(u_baseColor, u_rippleColor, amount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------- load model and apply shader ----------
const loader = new GLTFLoader();
const uniforms = {
  u_time:       { value: 0 },
  u_mouse:      { value: new THREE.Vector2(-10, -10) }, // start hidden
  u_radius:     { value: 0.28 },
  u_sigma:      { value: 0.08 },
  u_speed:      { value: 0.6 },
  u_intensity:  { value: 0.6 },
  u_baseColor:  { value: new THREE.Color(0.06, 0.06, 0.06) },
  u_rippleColor:{ value: new THREE.Color(1.0, 1.0, 1.0) },
};

// make a unique material per mesh, so we can update u_mouse only on the hovered one
function makeMat() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(uniforms),
    vertexShader,
    fragmentShader,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

let meshes = []; // { mesh, mat }
let modelRoot = null;

loader.load(
  '/model.glb',
  (gltf) => {
    modelRoot = gltf.scene;

    // center + scale to ~2 units max dimension
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const scale = 2.0 / maxDim;
    modelRoot.scale.setScalar(scale);

    // apply shader to ALL meshes that have UVs
    modelRoot.traverse((child) => {
      if (child.isMesh && child.geometry && child.geometry.attributes.uv) {
        const mat = makeMat();
        child.userData.__origMat = child.material; // keep original just in case
        child.material = mat;
        meshes.push({ mesh: child, mat });
      }
    });

    // if nothing had UVs, apply to first mesh anyway (world UVs won't work here)
    if (meshes.length === 0) {
      console.warn('No UVs detected; ripple needs UVs for localization.');
    }

    scene.add(modelRoot);
  },
  undefined,
  (err) => {
    console.error('GLB load error:', err);
  }
);

// ---------- mouse → raycast → set per-mesh u_mouse ----------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function onPointerMove(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  if (!modelRoot || meshes.length === 0) return;

  raycaster.setFromCamera(mouseNDC, camera);

  // intersect all shader-applied meshes
  const objs = meshes.map(m => m.mesh);
  const hits = raycaster.intersectObjects(objs, true);

  if (hits.length) {
    const { object, uv } = hits[0];
    // set hovered mesh u_mouse = uv; all others off
    for (const entry of meshes) {
      if (entry.mesh === object && uv) {
        entry.mat.uniforms.u_mouse.value.set(uv.x, uv.y);
      } else {
        entry.mat.uniforms.u_mouse.value.set(-10, -10);
      }
    }
  } else {
    // hide ripple if not over any mesh
    for (const entry of meshes) {
      entry.mat.uniforms.u_mouse.value.set(-10, -10);
    }
  }
}
renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });

// ---------- animate ----------
renderer.setAnimationLoop((tMS) => {
  const t = tMS * 0.001;
  for (const entry of meshes) {
    entry.mat.uniforms.u_time.value = t;
  }
  // gentle autorotate for context
  if (modelRoot) modelRoot.rotation.y += 0.0035;
  renderer.render(scene, camera);
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});