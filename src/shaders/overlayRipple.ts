import * as THREE from "three";

/**
 * Smooth, subtle, anti-aliased ripple overlay.
 * - Additive only (does not alter base materials)
 * - Uses UV when available; else uses world-space distance
 */
export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;       // UV space [0..1]
  u_mouseWorld: THREE.Vector3;  // world-space cursor hit
  u_speed: number;
  u_size: number;
  u_intensity: number;
  u_radius: number;             // UV-space radius
  u_sigma: number;              // ring thickness
  u_facetMix: number;           // 0..1 crystalline mix
  u_rippleColor: THREE.Color;
  u_useUV: number;              // 1 = use UV; 0 = world
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:        { value: 0 },
    u_mouse:       { value: new THREE.Vector2(0.5, 0.5) },
    u_mouseWorld:  { value: new THREE.Vector3(0, 0, 0) },
    u_speed:       { value: 0.5 },
    u_size:        { value: 4.0 },
    u_intensity:   { value: 0.55 },            // boosted for visibility (tune later)
    u_radius:      { value: 0.34 },            // boosted for visibility (tune later)
    u_sigma:       { value: 0.08 },            // boosted for visibility (tune later)
    u_facetMix:    { value: 0.22 },
    u_rippleColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    u_useUV:       { value: 1.0 },
  };

  if (initial) {
    for (const k in initial) {
      // @ts-ignore
      if (uniforms[k]) uniforms[k].value = (initial as any)[k];
    }
  }

  const vert = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const frag = /* glsl */`
    precision highp float;

    uniform float u_time;
    uniform vec2  u_mouse;        // UV
    uniform vec3  u_mouseWorld;   // world
    uniform float u_speed;
    uniform float u_size;
    uniform float u_intensity;
    uniform float u_radius;       // UV-space radius
    uniform float u_sigma;
    uniform float u_facetMix;
    uniform vec3  u_rippleColor;
    uniform float u_useUV;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

    float facetAA(vec2 p, float freq){
      vec2 d0 = vec2(1.0, 0.0);
      vec2 d1 = rot(2.09439510239) * d0;
      vec2 d2 = rot(4.18879020479) * d0;
      float f0 = dot(p, d0) * freq;
      float f1 = dot(p, d1) * freq;
      float f2 = dot(p, d2) * freq;
      float s0 = abs(sin(f0));
      float s1 = abs(sin(f1));
      float s2 = abs(sin(f2));
      float m = min(s0, min(s1, s2));
      float w0 = fwidth(f0), w1 = fwidth(f1), w2 = fwidth(f2);
      float w  = max(w0, max(w1, w2));
      return smoothstep(0.55 + w, 0.35 - w, m);
    }

    float radialMask(vec2 p, float radius){
      float r = length(p);
      float w = fwidth(r) * 2.0;
      return 1.0 - smoothstep(radius - w, radius + w, r);
    }

    float gaussianRing(float dist, float sigma){
      float r = u_time * u_speed;
      float x = (dist - r) / max(sigma, 1e-4);
      float g = exp(-0.5 * x * x);
      float fw = fwidth(dist) * 1.5;
      float gAA = mix(g, exp(-0.5 * ((dist - r) / max(sigma + fw, 1e-4)) *
                              ((dist - r) / max(sigma + fw, 1e-4))), 0.5);
      return gAA;
    }

    void main(){
      // --- Choose coordinate space & compute distance/masks ---
      float ringVal;
      float areaMask;
      float facet = 1.0;

      if (u_useUV > 0.5) {
        // UV space
        vec2 p = vUv - u_mouse;
        float distUV = length(p);
        areaMask = radialMask(p, u_radius);
        ringVal = gaussianRing(distUV, u_sigma);

        vec2 flow = vec2(0.08, -0.05) * u_time;
        facet = facetAA(vUv + flow, u_size * 6.28318);
      } else {
        // World space (fallback when no UVs)
        float distW = length(vWorldPos - u_mouseWorld);
        // Convert a UV-ish radius to world units via normal-based scale
        // Heuristic: scale radius by local variation to keep size reasonable
        float worldRadius = u_radius * 2.0; // try 2.0–3.0 for your model
        float wfw = fwidth(distW) * 2.0;
        areaMask = 1.0 - smoothstep(worldRadius - wfw, worldRadius + wfw, distW);
        ringVal = gaussianRing(distW, u_sigma * 0.5); // slightly thinner in world space

        // Minimal facet modulation in world fallback (soft)
        vec3 n = normalize(abs(vWorldNormal) + 1e-5);
        vec2 proj = mix(vWorldPos.yz, vWorldPos.xy, n.z);
        vec2 flow = vec2(0.06, -0.04) * u_time;
        facet = facetAA(proj + flow, (u_size * 6.28318) * 0.6);
      }

      float ripple = mix(ringVal, ringVal * facet, clamp(u_facetMix, 0.0, 1.0));
      float strength = ripple * areaMask * u_intensity;

      vec3 addLight = u_rippleColor * strength;
      gl_FragColor = vec4(addLight, strength);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  return mat;
}