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
  u_triScale: number;            // size of crystalline facets (world units)
  u_triSharp: number;            // 0..1 facet sharpness
  // NEW — blob controls
  u_blobScale: number;           // higher → more blobby detail around cursor
  u_blobThreshold: number;       // shape fill; 0.45–0.65 range is good
  u_blobEdge: number;            // edge softness (anti-aliased)
  u_blobPulse: number;           // subtle temporal wobble
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
    u_triScale:      { value: 0.05 },  // facet size in world units
    u_triSharp:      { value: 0.20 },  // 0 = soft, 1 = sharp facets
    u_blobScale:     { value: 3.0 },   // higher → more blobby detail around cursor
    u_blobThreshold: { value: 0.55 },  // shape fill; 0.45–0.65 range is good
    u_blobEdge:      { value: 0.15 },  // edge softness (anti-aliased)
    u_blobPulse:     { value: 0.12 },  // subtle temporal wobble
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
    uniform float u_intensity;
    uniform vec3  u_rippleColor;
    uniform float u_worldRadiusMul;   // still used for local attenuation (but not a visible circle)

    uniform float u_triScale;         // facet modulation (world)
    uniform float u_triSharp;

    uniform float u_blobScale;        // noise frequency around cursor
    uniform float u_blobThreshold;    // fill threshold
    uniform float u_blobEdge;         // edge softness
    uniform float u_blobPulse;        // threshold wobble amount

    uniform int   u_mode;             // keep your debug modes if you want

    // --------- helpers: hash, value noise, fbm ----------
    float hash21(vec2 p){
      p = fract(p*vec2(123.34, 345.45));
      p += dot(p, p+34.345);
      return fract(p.x*p.y);
    }

    // simple 2D value noise
    float vnoise(in vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      vec2 u = f*f*(3.0 - 2.0*f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    // fbm with 4 octaves
    float fbm(vec2 p){
      float s = 0.0;
      float a = 0.5;
      for(int i=0;i<4;i++){
        s += a * vnoise(p);
        p *= 2.0;
        a *= 0.5;
      }
      return s;
    }

    // Triangular facet signal (same spirit as before)
    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
    float triSignal(vec2 p, float freq){
      vec2 d0 = vec2(1.0, 0.0);
      vec2 d1 = rot(2.09439510239) * d0; // 120°
      vec2 d2 = rot(4.18879020479) * d0; // 240°
      float f0 = abs(sin(dot(p, d0)*freq));
      float f1 = abs(sin(dot(p, d1)*freq));
      float f2 = abs(sin(dot(p, d2)*freq));
      float m = min(f0, min(f1, f2));
      float w0 = fwidth(dot(p, d0)*freq);
      float w1 = fwidth(dot(p, d1)*freq);
      float w2 = fwidth(dot(p, d2)*freq);
      float w  = max(w0, max(w1, w2));
      float edge = mix(0.55, 0.25, clamp(u_triSharp, 0.0, 1.0));
      return smoothstep(edge + w, edge - w, m);
    }

    // Triplanar facet blend (world space)
    float triTriplanar(vec3 wp, vec3 wn, float scale){
      vec3 n = normalize(abs(wn) + 1e-5);
      vec3 w = pow(n, vec3(4.0)); // bias toward dominant axis
      w /= (w.x + w.y + w.z);
      float s = max(scale, 1e-4);

      float vx = triSignal(wp.yz / s, 6.28318);
      float vy = triSignal(wp.xz / s, 6.28318);
      float vz = triSignal(wp.xy / s, 6.28318);
      return vx * w.x + vy * w.y + vz * w.z;
    }

    // Triplanar FBM blob centered at cursor (no UVs)
    float blobTriplanar(vec3 wp, vec3 wn, vec3 center, float scale){
      vec3 p = (wp - center) * scale;        // localize around cursor, scaled
      vec3 n = normalize(abs(wn) + 1e-5);
      vec3 w = pow(n, vec3(4.0));
      w /= (w.x + w.y + w.z);
      // project to 3 planes and combine
      float vx = fbm(p.yz);
      float vy = fbm(p.xz);
      float vz = fbm(p.xy);
      return vx*w.x + vy*w.y + vz*w.z;
    }

    void main(){
      // 1) Soft locality so the blob fades away with distance (not a hard circle)
      float distW = length(vWorldPos - u_mouseWorld);
      float farR  = u_worldRadiusMul;               // ~ model-scaled locality
      float soft  = 1.0 - smoothstep(farR*0.7, farR, distW);

      // 2) Random blob via triplanar FBM around the cursor
      float n = blobTriplanar(vWorldPos, vWorldNormal, u_mouseWorld, u_blobScale);

      // 3) Subtle animated threshold (wobble) so the blob breathes
      float pulse = u_blobPulse * sin(u_time*2.0 + n*6.28318);
      float th = clamp(u_blobThreshold + pulse, 0.0, 1.0);

      // 4) Edge smoothing (anti-aliased threshold)
      float fw = fwidth(n) * 2.0 + 1e-5;
      float blob = smoothstep(th - u_blobEdge - fw, th + u_blobEdge + fw, n);

      // 5) Facet modulation (crystalline feel), kept subtle
      float facet = triTriplanar(vWorldPos, vWorldNormal, u_triScale);
      facet = mix(1.0, facet, 0.35);

      // 6) Final amount
      float amt = blob * facet * soft * u_intensity;

      // Debug if needed
      if (u_mode == 4) { gl_FragColor = vec4(vec3(n), 1.0); return; }      // noise
      if (u_mode == 5) { gl_FragColor = vec4(vec3(blob), 1.0); return; }   // thresholded blob
      if (u_mode == 6) { gl_FragColor = vec4(vec3(soft), 1.0); return; }   // locality

      // Additive "neon vein" overlay
      gl_FragColor = vec4(u_rippleColor * amt, amt);
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