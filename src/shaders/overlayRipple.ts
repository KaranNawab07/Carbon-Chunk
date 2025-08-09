import * as THREE from "three";

/**
 * Smooth, subtle, anti-aliased ripple overlay.
 * - Additive only (does not alter your base materials)
 * - Gaussian ring with fwidth-based smoothing (no "electric" banding)
 * - Tri/crystal modulation is anti-aliased and very gentle by default
 */
export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;     // UV space [0..1]
  u_speed: number;            // outward speed (units/sec)
  u_size: number;             // facet frequency
  u_intensity: number;        // overall brightness
  u_radius: number;           // area around cursor (UV units)
  u_sigma: number;            // ring thickness (Gaussian sigma)
  u_facetMix: number;         // 0..1 how much crystal structure to mix in
  u_rippleColor: THREE.Color; // additive tint
  u_useUV: number;            // 1 = use UV, 0 = world fallback
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:        { value: 0 },
    u_mouse:       { value: new THREE.Vector2(0.5, 0.5) },
    u_speed:       { value: 0.5 },                          // slower = calmer
    u_size:        { value: 4.0 },                          // gentler facets
    u_intensity:   { value: 0.35 },                         // subtle by default
    u_radius:      { value: 0.26 },                         // a bit larger area
    u_sigma:       { value: 0.06 },                         // thicker ring
    u_facetMix:    { value: 0.25 },                         // light crystal feel
    u_rippleColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    u_useUV:       { value: 1.0 },
  };

  // apply overrides
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
    uniform vec2  u_mouse;
    uniform float u_speed;
    uniform float u_size;
    uniform float u_intensity;
    uniform float u_radius;
    uniform float u_sigma;
    uniform float u_facetMix;
    uniform vec3  u_rippleColor;
    uniform float u_useUV;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    // 2D rotate
    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

    // Anti-aliased triangle/hex "facet" mask, returns 0..1 (soft)
    // Built from 3 stripe fields; edges are smoothed using fwidth.
    float facetAA(vec2 p, float freq){
      vec2 d0 = vec2(1.0, 0.0);
      vec2 d1 = rot(2.09439510239) * d0; // 120°
      vec2 d2 = rot(4.18879020479) * d0; // 240°

      float f0 = dot(p, d0) * freq;
      float f1 = dot(p, d1) * freq;
      float f2 = dot(p, d2) * freq;

      // Stripe fields using sin; convert to "distance" from stripe center
      float s0 = abs(sin(f0));
      float s1 = abs(sin(f1));
      float s2 = abs(sin(f2));
      float m = min(s0, min(s1, s2));

      // Derivative-based smoothing width (prevents pixel shimmer)
      float w0 = fwidth(f0);
      float w1 = fwidth(f1);
      float w2 = fwidth(f2);
      float w  = max(w0, max(w1, w2));

      // Map lower "m" to stronger mask, with AA edge
      // 0.5 threshold gives soft triangular facets
      return smoothstep(0.55 + w, 0.35 - w, m);
    }

    // Smooth circular falloff around cursor (AA edge)
    float radialMask(vec2 p, float radius){
      float r = length(p);
      float w = fwidth(r) * 2.0;
      return 1.0 - smoothstep(radius - w, radius + w, r);
    }

    // Gaussian ring, anti-aliased (no hard bands)
    float gaussianRing(float dist, float radius, float sigma){
      // ring center moves outwards with time
      float r = u_time * u_speed;
      float x = (dist - r) / max(sigma, 1e-4);
      float g = exp(-0.5 * x * x);
      // widen slightly by derivatives to avoid pixelation at distance
      float fw = fwidth(dist) * 1.5;
      float gAA = mix(g, exp(-0.5 * ((dist - r) / max(sigma + fw, 1e-4)) *
                              ((dist - r) / max(sigma + fw, 1e-4))), 0.5);
      return gAA;
    }

    void main(){
      // Choose UV or a stable world fallback
      vec2 uv2 = vUv;
      if (u_useUV < 0.5) {
        vec3 n = normalize(abs(vWorldNormal) + 1e-5);
        vec2 pX = vWorldPos.yz;
        vec2 pY = vWorldPos.zx;
        vec2 pZ = vWorldPos.xy;
        uv2 = (pX*n.x + pY*n.y + pZ*n.z);
      }

      // Local coords relative to cursor (UV space)
      vec2 p = uv2 - u_mouse;

      // Soft area mask around cursor
      float area = radialMask(p, u_radius);

      // Distance for ring
      float dist = length(p);

      // Smooth Gaussian ring
      float ring = gaussianRing(dist, 0.0, u_sigma);

      // Very gentle crystalline modulation (anti-aliased)
      vec2 flow = vec2(0.08, -0.05) * u_time;
      float facets = facetAA(uv2 + flow, u_size * 6.28318);

      // Layering: ring is primary, facets lightly modulate amplitude
      float ripple = mix(ring, ring * facets, clamp(u_facetMix, 0.0, 1.0));

      // Final strength (subtle by default)
      float strength = ripple * area * u_intensity;

      // Additive light; clamp to keep it elegant
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