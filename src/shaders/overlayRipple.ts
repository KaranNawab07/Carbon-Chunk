import * as THREE from "three";

export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;        // kept for compatibility (unused here)
  u_mouseWorld: THREE.Vector3;   // ← cursor hit in world space
  u_radius: number;              // base locality (paired with u_worldRadiusMul)
  u_sigma: number;               // unused in blob variant (left for future)
  u_speed: number;               // unused in blob variant (left for future)
  u_intensity: number;           // brightness
  u_baseColor: THREE.Color;      // debug only
  u_rippleColor: THREE.Color;    // additive "neon" color
  u_worldRadiusMul: number;      // locality falloff range, in world units
  u_useUV: number;               // FORCE 0 (world mode)
  u_mode: number;                // debug modes (0 normal, 4/5/6 diagnostics)
  // geometric facet (crystalline sheen)
  u_triScale: number;            // world facet size (smaller = finer)
  u_triSharp: number;            // 0..1 facet edge sharpness
  // blob (random shape) controls
  u_blobScale: number;           // noise frequency (higher = smaller detail)
  u_blobThreshold: number;       // fill level (lower = more filled)
  u_blobEdge: number;            // edge softness
  u_blobPulse: number;           // subtle wobble amount
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:          { value: 0 },
    u_mouse:         { value: new THREE.Vector2(-10, -10) },
    u_mouseWorld:    { value: new THREE.Vector3(0, 0, 0) },

    // subtle neon brightness
    u_intensity:     { value: 0.38 },
    u_rippleColor:   { value: new THREE.Color(1.0, 1.0, 1.0) },

    // locality: how far from the cursor the effect can appear (softly)
    u_radius:        { value: 0.26 },     // kept for compat
    u_worldRadiusMul:{ value: 2.8 },

    // facet (crystal) shimmer you liked at 0.05
    u_triScale:      { value: 0.05 },
    u_triSharp:      { value: 0.20 },

    // blob (random shape) parameters
    u_blobScale:     { value: 4.0 },
    u_blobThreshold: { value: 0.56 },
    u_blobEdge:      { value: 0.16 },
    u_blobPulse:     { value: 0.12 },

    // not used now but kept for toggles/future
    u_sigma:         { value: 0.07 },
    u_speed:         { value: 0.55 },

    // debug & mode
    u_baseColor:     { value: new THREE.Color(0.10, 0.10, 0.10) },
    u_useUV:         { value: 0.0 },  // ← always world mode
    u_mode:          { value: 0 },
  };

  if (initial) for (const k in initial) if ((uniforms as any)[k]) (uniforms as any)[k].value = (initial as any)[k];

  const vert = /* glsl */`
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
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
    uniform float u_intensity;
    uniform vec3  u_rippleColor;
    uniform float u_worldRadiusMul;

    uniform float u_triScale;
    uniform float u_triSharp;

    uniform float u_blobScale;
    uniform float u_blobThreshold;
    uniform float u_blobEdge;
    uniform float u_blobPulse;

    uniform int   u_mode;

    // --- small hash/noise helpers ---
    float hash21(vec2 p){
      p = fract(p*vec2(123.34, 345.45));
      p += dot(p, p+34.345);
      return fract(p.x*p.y);
    }
    float vnoise(in vec2 p){
      vec2 i = floor(p), f = fract(p);
      float a = hash21(i);
      float b = hash21(i + vec2(1.,0.));
      float c = hash21(i + vec2(0.,1.));
      float d = hash21(i + vec2(1.,1.));
      vec2 u = f*f*(3. - 2.*f);
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p){
      float s=0., a=0.5;
      for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.; a*=0.5; }
      return s;
    }

    // triangular facet signal
    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
    float triSignal(vec2 p, float freq){
      vec2 d0 = vec2(1.,0.);
      vec2 d1 = rot(2.09439510239)*d0; // 120°
      vec2 d2 = rot(4.18879020479)*d0; // 240°
      float f0 = abs(sin(dot(p,d0)*freq));
      float f1 = abs(sin(dot(p,d1)*freq));
      float f2 = abs(sin(dot(p,d2)*freq));
      float m  = min(f0, min(f1,f2));
      float w0 = fwidth(dot(p,d0)*freq);
      float w1 = fwidth(dot(p,d1)*freq);
      float w2 = fwidth(dot(p,d2)*freq);
      float w  = max(w0, max(w1,w2));
      float edge = mix(0.55, 0.25, clamp(u_triSharp,0.,1.));
      return smoothstep(edge + w, edge - w, m);
    }
    float triTriplanar(vec3 wp, vec3 wn, float scale){
      vec3 n = normalize(abs(wn) + 1e-5);
      vec3 w = pow(n, vec3(4.));
      w /= (w.x + w.y + w.z);
      float s = max(scale, 1e-4);
      float vx = triSignal(wp.yz/s, 6.28318);
      float vy = triSignal(wp.xz/s, 6.28318);
      float vz = triSignal(wp.xy/s, 6.28318);
      return vx*w.x + vy*w.y + vz*w.z;
    }
    float blobTriplanar(vec3 wp, vec3 wn, vec3 center, float scale){
      vec3 p = (wp - center) * scale;
      vec3 n = normalize(abs(wn) + 1e-5);
      vec3 w = pow(n, vec3(4.));
      w /= (w.x + w.y + w.z);
      float vx = fbm(p.yz);
      float vy = fbm(p.xz);
      float vz = fbm(p.xy);
      return vx*w.x + vy*w.y + vz*w.z;
    }

    void main(){
      // locality falloff (soft, no obvious circle)
      float distW = length(vWorldPos - u_mouseWorld);
      float soft  = 1.0 - smoothstep(u_worldRadiusMul*0.7, u_worldRadiusMul, distW);

      // triplanar FBM blob around cursor
      float n = blobTriplanar(vWorldPos, vWorldNormal, u_mouseWorld, u_blobScale);

      // animated threshold (gentle breathing)
      float pulse = u_blobPulse * sin(u_time*2.0 + n*6.28318);
      float th = clamp(u_blobThreshold + pulse, 0.0, 1.0);

      // anti-aliased edge
      float fw = fwidth(n) * 2.0 + 1e-5;
      float blob = smoothstep(th - u_blobEdge - fw, th + u_blobEdge + fw, n);

      // crystalline modulation (subtle)
      float facet = triTriplanar(vWorldPos, vWorldNormal, u_triScale);
      facet = mix(1.0, facet, 0.35);

      float amt = blob * facet * soft * u_intensity;

      // optional diagnostics
      if (u_mode == 4) { gl_FragColor = vec4(vec3(n), 1.0); return; }     // raw noise
      if (u_mode == 5) { gl_FragColor = vec4(vec3(blob), 1.0); return; }  // thresholded blob
      if (u_mode == 6) { gl_FragColor = vec4(vec3(soft), 1.0); return; }  // locality mask

      // additive overlay
      gl_FragColor = vec4(u_rippleColor * amt, amt);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: false,                   // co-planar with base mesh
    blending: THREE.AdditiveBlending,   // neon lift
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return mat as THREE.ShaderMaterial;
}