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

// ---------- shader (UV if available, else world fallback) ----------
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  uniform float u_time;
  uniform vec2  u_mouse;         // UV (0..1) or (-10,-10) = off
  uniform vec3  u_mouseWorld;    // world hit (always set)
  uniform float u_useUV;         // 1 = use UV mode, 0 = world mode
  uniform float u_worldRadiusMul;// world radius multiplier
  uniform float u_radius;        // UV radius
  uniform float u_sigma;         // ring thickness
  uniform float u_speed;         // outward speed
  uniform float u_intensity;     // strength
  uniform vec3  u_baseColor;
  uniform vec3  u_rippleColor;

  float radialMask(float d, float r){
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

    // choose UV or world mode
    if (u_useUV > 0.5 && u_mouse.x >= 0.0) {
      vec2 p = vUv - u_mouse;
      float d = length(p);
      float area = radialMask(d, u_radius);
      float ring = gaussianRing(d, u_sigma, u_time, u_speed);
      float amt  = area * ring * u_intensity;
      vec3 color = mix(base, u_rippleColor, amt);
      gl_FragColor = vec4(color, 1.0);
    } else {
      // world fallback (works even without UVs)
      float d = length(vWorldPos - u_mouseWorld);
      float r = u_radius * u_worldRadiusMul;  // scale UV-ish radius to world
      float warea = 1.0 - smoothstep(r - fwidth(d)*2.0, r + fwidth(d)*2.0, d);
      float wring = gaussianRing(d, u_sigma * 0.5, u_time, u_speed);
      float amt   = warea * wring * u_intensity;
      vec3 color  = mix(base, u_rippleColor, amt);
      gl_FragColor = vec4(color, 1.0);
    }
  }
`;

// ---------- materials ----------
const uniformsTemplate = {
  u_time:          { value: 0 },
  u_mouse:         { value: new THREE.Vector2(-10, -10) }, // start hidden
  u_mouseWorld:    { value: new THREE.Vector3(0, 0, 0) },
  u_useUV:         { value: 1.0 },     // set per mesh below
  u_worldRadiusMul:{ value: 2.8 },     // bigger world radius
  u_radius:        { value: 0.40 },    // BIG for diagnostics
  u_sigma:         { value: 0.12 },    // thick for diagnostics
  u_speed:         { value: 0.8 },
  u_intensity:     { value: 1.0 },     // strong for diagnostics
  u_baseColor:     { value: new THREE.Color(0.10, 0.10, 0.10) },
  u_rippleColor:   { value: new THREE.Color(1.0, 1.0, 1.0) },
};

function makeMat(useUV) {
  const u = THREE.UniformsUtils.clone(uniformsTemplate);
  u.u_useUV.value = useUV ? 1.0 : 0.0;
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
}

// ---------- load model ----------
const loader = new GLTFLoader();
let modelRoot = null;
const entries = []; // { mesh, mat, hasUV }

loader.load(
  '/model.glb',
  (gltf) => {
    modelRoot = gltf.scene;

    // center+scale to ~2 units
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    modelRoot.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const scale = 2.0 / maxDim;
    modelRoot.scale.setScalar(scale);

    const withUV = [];
    const withoutUV = [];
    modelRoot.traverse((child) => {
      if (child.isMesh && child.geometry) {
        (child.geometry.attributes.uv ? withUV : withoutUV).push(child);
      }
    });
    console.log(`[diag] meshes with UV: ${withUV.length}, without UV: ${withoutUV.length}`);

    // Apply shader to ALL meshes: UV mode for those with UV, world mode for others
    modelRoot.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const hasUV = !!child.geometry.attributes.uv;
        const mat = makeMat(hasUV);
        child.userData.__origMat = child.material;
        child.material = mat;
        entries.push({ mesh: child, mat, hasUV });
      }
    });

    // Helper: bbox so you see scale/origin
    const bbox = new THREE.BoxHelper(modelRoot, 0x00ff88);
    scene.add(modelRoot, bbox);
  },
  undefined,
  (err) => console.error('GLB load error:', err)
);

// ---------- hit marker (red sphere) ----------
const hitMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.015, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xff3333 })
);
hitMarker.visible = false;
scene.add(hitMarker);

// ---------- raycast & update uniforms ----------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function onPointerMove(ev) {
  if (!modelRoot || entries.length === 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);

  // Intersect ALL meshes (UV and non-UV)
  const objs = entries.map(e => e.mesh);
  const hits = raycaster.intersectObjects(objs, true);

  // default: hide UV ripple on all
  for (const e of entries) {
    e.mat.uniforms.u_mouse.value.set(-10, -10);
  }

  if (hits.length) {
    const hit = hits[0];
    const uv = hit.uv ?? null;
    const pt = hit.point;

    // Move hit marker
    hitMarker.position.copy(pt);
    hitMarker.visible = true;

    // Update world position on ALL materials (world fallback uses this)
    for (const e of entries) {
      e.mat.uniforms.u_mouseWorld.value.copy(pt);
    }

    // If the hit mesh has UVs, set its UV center; others stay hidden in UV mode
    const entry = entries.find(e => e.mesh === hit.object);
    if (entry && entry.hasUV && uv) {
      entry.mat.uniforms.u_mouse.value.set(uv.x, uv.y);
    }
  } else {
    hitMarker.visible = false;
  }
}
renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });

// ---------- animate ----------
renderer.setAnimationLoop((tMS) => {
  const t = tMS * 0.001;
  for (const e of entries) e.mat.uniforms.u_time.value = t;
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

