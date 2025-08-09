import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'crosshair';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.7);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(3, 5, 2);
scene.add(dir);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---------- shader (very visible & AA) ----------
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
  uniform vec2  u_mouse;      // UV (0..1) or (-10,-10)=hidden
  uniform float u_radius;     // UV radius
  uniform float u_sigma;      // ring thickness
  uniform float u_speed;      // outward speed
  uniform float u_intensity;  // strength
  uniform vec3  u_baseColor;
  uniform vec3  u_rippleColor;

  float radialMask(vec2 p, float r){
    float d = length(p);
    float w = fwidth(d) * 2.0;
    return 1.0 - smoothstep(r - w, r + w, d);
  }
  float gaussianRing(float dist, float sigma, float t, float speed){
    float rc = t * speed;
    float x = (dist - rc) / max(sigma, 1e-4);
    float g = exp(-0.5 * x * x);
    float fw = fwidth(dist) * 1.5;
    float g2 = exp(-0.5 * ((dist - rc) / max(sigma + fw, 1e-4)) * ((dist - rc) / max(sigma + fw, 1e-4)));
    return mix(g, g2, 0.5);
  }
  void main(){
    vec3 base = u_baseColor;
    if (u_mouse.x < 0.0){
      gl_FragColor = vec4(base, 1.0);
      return;
    }
    vec2 p = vUv - u_mouse;
    float area   = radialMask(p, u_radius);
    float ring   = gaussianRing(length(p), u_sigma, u_time, u_speed);
    float amount = area * ring * u_intensity;
    vec3 color = mix(base, u_rippleColor, amount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------- load model and apply shader per mesh ----------
const loader = new GLTFLoader();
const uniformsTemplate = {
  u_time:       { value: 0 },
  u_mouse:      { value: new THREE.Vector2(-10, -10) }, // start hidden
  u_radius:     { value: 0.40 },  // BIG for diagnostics
  u_sigma:      { value: 0.12 },  // thick for diagnostics
  u_speed:      { value: 0.8 },
  u_intensity:  { value: 1.0 },   // strong for diagnostics
  u_baseColor:  { value: new THREE.Color(0.10, 0.10, 0.10) },
  u_rippleColor:{ value: new THREE.Color(1.0, 1.0, 1.0) },
};

function makeMat() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(uniformsTemplate),
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
}

let modelRoot = null;
const entries = []; // { mesh, mat, hasUV }
loader.load(
  '/model.glb',
  (gltf) => {
    modelRoot = gltf.scene;

    // center+scale
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const scale = 2.0 / maxDim;
    modelRoot.scale.setScalar(scale);

    // list meshes + UVs
    const withUV = [];
    const withoutUV = [];
    modelRoot.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const hasUV = !!child.geometry.attributes.uv;
        (hasUV ? withUV : withoutUV).push(child);
      }
    });
    console.log(`[diag] meshes with UV: ${withUV.length}, without UV: ${withoutUV.length}`);

    // apply shader ONLY to meshes with UV so we can LOCALIZE by UV
    withUV.forEach((mesh) => {
      const mat = makeMat();
      mesh.userData.__origMat = mesh.material;
      mesh.material = mat;
      entries.push({ mesh, mat, hasUV: true });
    });

    // highlight meshes without UV so you can see why ripple won't localize there
    withoutUV.forEach((mesh) => {
      mesh.material = new THREE.MeshStandardMaterial({ color: 0x4444aa, metalness: 0.1, roughness: 0.7 });
      entries.push({ mesh, mat: null, hasUV: false });
    });

    // add helpers so you can see scale/origin
    const bbox = new THREE.BoxHelper(modelRoot, 0x00ff88);
    scene.add(modelRoot, bbox);
  },
  undefined,
  (err) => console.error('GLB load error:', err)
);

// ---------- raycast & update hovered mesh UV ----------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function onPointerMove(ev) {
  if (!modelRoot || entries.length === 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);

  const uvMeshes = entries.filter(e => e.hasUV).map(e => e.mesh);
  const hits = raycaster.intersectObjects(uvMeshes, true);

  // reset all to hidden
  entries.forEach(e => {
    if (e.mat) e.mat.uniforms.u_mouse.value.set(-10, -10);
  });

  if (hits.length) {
    const hit = hits[0];
    const uv = hit.uv;
    if (uv) {
      // set ripple center on the hit mesh only
      const entry = entries.find(e => e.mesh === hit.object);
      if (entry && entry.mat) {
        entry.mat.uniforms.u_mouse.value.set(uv.x, uv.y);
      }
    }
  }
}
renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });

// ---------- animate ----------
renderer.setAnimationLoop((tMS) => {
  const t = tMS * 0.001;
  entries.forEach(e => { if (e.mat) e.mat.uniforms.u_time.value = t; });
  if (modelRoot) modelRoot.rotation.y += 0.0025;
  controls.update();
  renderer.render(scene, camera);
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});