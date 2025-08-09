import * as THREE from "three";

export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;
  u_mouseWorld: THREE.Vector3;
  u_radius: number;
  u_sigma: number;
  u_speed: number;
  u_intensity: number;
  u_baseColor: THREE.Color;   // for debug modes that render base color
  u_rippleColor: THREE.Color; // additive tint (white vein)
  u_worldRadiusMul: number;   // only used if you flip to world mode later
  u_useUV: number;            // 1 = UV mode (your model has UVs)
  u_mode: number;             // 0,1,2,4,5,6 (debug/diagnostic)
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:          { value: 0 },
    u_mouse:         { value: new THREE.Vector2(-10, -10) }, // hidden until hit
    u_mouseWorld:    { value: new THREE.Vector3(0, 0, 0) },
    u_radius:        { value: 0.40 },     // generous defaults; tune later
    u_sigma:         { value: 0.10 },
    u_speed:         { value: 0.8 },
    u_intensity:     { value: 1.0 },
    u_baseColor:     { value: new THREE.Color(0.10, 0.10, 0.10) },
    u_rippleColor:   { value: new THREE.Color(1.0, 1.0, 1.0) },
    u_worldRadiusMul:{ value: 2.8 },
    u_useUV:         { value: 1.0 },
    u_mode:          { value: 0 },
  };

  if (initial) {
    for (const k in initial) {
      // @ts-ignore
      if (uniforms[k]) uniforms[k].value = (initial as any)[k];
    }
  }

  const vert = /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const frag = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    uniform float u_time;
    uniform vec2  u_mouse;
    uniform vec3  u_mouseWorld;
    uniform float u_radius;
    uniform float u_sigma;
    uniform float u_speed;
    uniform float u_intensity;
    uniform vec3  u_baseColor;
    uniform vec3  u_rippleColor;
    uniform float u_worldRadiusMul;
    uniform float u_useUV;
    uniform int   u_mode;

    float radialMask(float d, float r){
      float w = fwidth(d) * 2.0;
      return 1.0 - smoothstep(r - w, r + w, d);
    }
    float gaussianRing(float dist, float sigma, float t, float speed){
      float rc = fract(t * speed) * 0.7;  // keeps the ring on-mesh forever
      float x = (dist - rc) / max(sigma, 1e-4);
      float g = exp(-0.5 * x * x);
      float fw = fwidth(dist) * 1.5;
      float g2 = exp(-0.5 * ((dist - rc) / max(sigma + fw, 1e-4)) * ((dist - rc) / max(sigma + fw, 1e-4)));
      return mix(g, g2, 0.5);
    }

    void main(){
      // UV gradient debug
      if (u_mode == 1) {
        gl_FragColor = vec4(vUv, 0.0, 1.0);
        return;
      }

      // choose center: fixed (mode 2) or mouse
      vec2 center = (u_mode == 2) ? vec2(0.5) : u_mouse;

      // --- UV path (your model has UVs) ---
      if (u_useUV > 0.5 && center.x >= 0.0) {
        vec2 p = vUv - center;
        float d = length(p);
        float area = radialMask(d, u_radius);
        float ring = gaussianRing(d, u_sigma, u_time, u_speed);
        float amt  = area * ring * u_intensity;

        // Debug raw outputs
        if (u_mode == 4) { gl_FragColor = vec4(vec3(ring), 1.0); return; }
        if (u_mode == 5) { gl_FragColor = vec4(vec3(area), 1.0); return; }
        if (u_mode == 6) { gl_FragColor = vec4(vec3(area * ring), 1.0); return; }

        // Additive overlay (alpha = amt), does not change base materials
        gl_FragColor = vec4(u_rippleColor * amt, amt);
        return;
      }

      // --- World fallback (not used for you, kept for safety) ---
      float d = length(vWorldPos - u_mouseWorld);
      float r = u_radius * u_worldRadiusMul;
      float area = 1.0 - smoothstep(r - fwidth(d)*2.0, r + fwidth(d)*2.0, d);
      float ring = gaussianRing(d, u_sigma * 0.5, u_time, u_speed);
      float amt  = area * ring * u_intensity;

      if (u_mode == 4) { gl_FragColor = vec4(vec3(ring), 1.0); return; }
      if (u_mode == 5) { gl_FragColor = vec4(vec3(area), 1.0); return; }
      if (u_mode == 6) { gl_FragColor = vec4(vec3(area * ring), 1.0); return; }

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