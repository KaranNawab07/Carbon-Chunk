import * as THREE from "three";

export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;        // unused in world mode (kept for compatibility)
  u_mouseWorld: THREE.Vector3;   // cursor hit in world space
  u_radius: number;              // base radius (unitless)
  u_sigma: number;               // ring thickness
  u_speed: number;               // ring speed (wrapped)
  u_intensity: number;           // brightness
  u_baseColor: THREE.Color;      // not drawn (overlay is additive), kept for debug
  u_rippleColor: THREE.Color;    // vein color
  u_worldRadiusMul: number;      // scales radius to model scale
  u_useUV: number;               // will set to 0.0 in code (world mode)
  u_mode: number;                // debug modes if you still want them (0 default)
  // NEW:
  u_triScale: number;            // size of crystalline facets (world units)
  u_triSharp: number;            // 0..1 facet sharpness
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:          { value: 0 },
    u_mouse:         { value: new THREE.Vector2(-10, -10) },
    u_mouseWorld:    { value: new THREE.Vector3(0, 0, 0) },
    u_radius:        { value: 0.26 },
    u_sigma:         { value: 0.07 },
    u_speed:         { value: 0.55 },
    u_intensity:     { value: 0.38 },
    u_baseColor:     { value: new THREE.Color(0.10, 0.10, 0.10) },
    u_rippleColor:   { value: new THREE.Color(1.0, 1.0, 1.0) },
    u_worldRadiusMul:{ value: 2.6 },   // tweak per model size
    u_useUV:         { value: 0.0 },   // FORCE WORLD MODE
    u_mode:          { value: 0 },
    u_triScale:      { value: 0.10 },  // facet size in world units
    u_triSharp:      { value: 0.25 },  // 0 = soft, 1 = sharp facets
  };

  if (initial) for (const k in initial) if ((uniforms as any)[k]) (uniforms as any)[k].value = (initial as any)[k];

  const vert = /* glsl */`
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      // normal in world space for triplanar weighting
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const frag = /* glsl */`
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    uniform float u_time;
    uniform vec3  u_mouseWorld;
    uniform float u_radius;
    uniform float u_sigma;
    uniform float u_speed;
    uniform float u_intensity;
    uniform vec3  u_rippleColor;
    uniform float u_worldRadiusMul;
    uniform int   u_mode;

    uniform float u_triScale;   // facet size (world units)
    uniform float u_triSharp;   // 0..1

    // --- helpers ---
    float wrappedRingCenter(float t, float speed) {
      return fract(t * speed) * 0.7; // keeps ring on visible range
    }

    float gaussianRing(float dist, float sigma, float t, float speed){
      float rc = wrappedRingCenter(t, speed);
      float x = (dist - rc) / max(sigma, 1e-4);
      float g = exp(-0.5 * x * x);
      float fw = fwidth(dist) * 1.5;
      float g2 = exp(-0.5 * ((dist - rc) / max(sigma + fw, 1e-4)) * ((dist - rc) / max(sigma + fw, 1e-4)));
      return mix(g, g2, 0.5);
    }

    // Triangular (equilateral) grid signal, anti-aliased
    float triSignal(vec2 p, float freq){
      // 3 directions at 0°, 120°, 240°
      const float TAU = 6.28318530718;
      float a0 = 0.0;
      float a1 = 2.09439510239;  // 120°
      float a2 = 4.18879020479;  // 240°
      vec2 d0 = vec2(cos(a0), sin(a0));
      vec2 d1 = vec2(cos(a1), sin(a1));
      vec2 d2 = vec2(cos(a2), sin(a2));
      float f0 = sin(dot(p, d0) * freq);
      float f1 = sin(dot(p, d1) * freq);
      float f2 = sin(dot(p, d2) * freq);
      float m  = min(abs(f0), min(abs(f1), abs(f2)));
      // derivative-based AA
      float w0 = fwidth(dot(p, d0) * freq);
      float w1 = fwidth(dot(p, d1) * freq);
      float w2 = fwidth(dot(p, d2) * freq);
      float w  = max(w0, max(w1, w2));
      // sharper facets with u_triSharp
      float edge = mix(0.55, 0.25, clamp(u_triSharp, 0.0, 1.0));
      return smoothstep(edge + w, edge - w, m);
    }

    // Triplanar contribution of the triSignal
    float triTriplanar(vec3 wp, vec3 wn, float scale, float freqMul){
      vec3 n = normalize(abs(wn) + 1e-5);
      vec3 w = pow(n, vec3(4.0));            // bias projection by dominant normal axis
      w /= (w.x + w.y + w.z);                 // normalize weights

      float s = max(scale, 1e-4);             // world -> UV-ish scale
      vec2 px = wp.yz / s;                    // project to YZ (X-facing)
      vec2 py = wp.xz / s;                    // project to XZ (Y-facing)
      vec2 pz = wp.xy / s;                    // project to XY (Z-facing)

      float freq = 6.28318 * freqMul;         // ≈ 2π * frequency
      float vx = triSignal(px, freq);
      float vy = triSignal(py, freq);
      float vz = triSignal(pz, freq);

      return vx * w.x + vy * w.y + vz * w.z;  // weighted blend
    }

    void main(){
      // World-space ripple (no UVs)
      float distW = length(vWorldPos - u_mouseWorld);
      float r     = u_radius * u_worldRadiusMul;
      float area  = 1.0 - smoothstep(r - fwidth(distW)*2.0, r + fwidth(distW)*2.0, distW);
      float ring  = gaussianRing(distW, u_sigma, u_time, u_speed);

      // Geometric facet modulation in world space (no seams)
      float facet = triTriplanar(vWorldPos, vWorldNormal, u_triScale, 1.0);
      // soften facet participation slightly so it stays silky
      facet = mix(1.0, facet, 0.35);

      // Final amount
      float amt = area * ring * facet * u_intensity;

      // Debug modes if you need them (optional)
      if (u_mode == 4) { gl_FragColor = vec4(vec3(ring), 1.0); return; }
      if (u_mode == 5) { gl_FragColor = vec4(vec3(area), 1.0); return; }
      if (u_mode == 6) { gl_FragColor = vec4(vec3(area * ring), 1.0); return; }

      // Additive neon overlay
      vec3 addLight = u_rippleColor * amt;
      gl_FragColor = vec4(addLight, amt);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return mat as THREE.ShaderMaterial;
}