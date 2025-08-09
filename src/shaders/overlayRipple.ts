import * as THREE from "three";

export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;   // in UV space (0..1)
  u_speed: number;
  u_size: number;
  u_intensity: number;
  u_radius: number;
  u_sharpness: number;
  u_rippleColor: THREE.Color; // emissive tint (additive)
  u_useUV: number;            // 1 if mesh has UVs, else 0 (triplanar fallback)
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:        { value: 0 },
    u_mouse:       { value: new THREE.Vector2(0.5, 0.5) },
    u_speed:       { value: 0.6 },
    u_size:        { value: 6.0 },
    u_intensity:   { value: 0.6 },
    u_radius:      { value: 0.18 },
    u_sharpness:   { value: 0.7 },
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
    uniform vec2  u_mouse;
    uniform float u_speed;
    uniform float u_size;
    uniform float u_intensity;
    uniform float u_radius;
    uniform float u_sharpness;
    uniform vec3  u_rippleColor;
    uniform float u_useUV;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

    float triFacet(vec2 p, float freq, float crisp){
      vec2 d0 = vec2(1.0, 0.0);
      vec2 d1 = rot(2.09439510239) * d0; // 120°
      vec2 d2 = rot(4.18879020479) * d0; // 240°
      float s0 = abs(sin(dot(p,d0) * freq));
      float s1 = abs(sin(dot(p,d1) * freq));
      float s2 = abs(sin(dot(p,d2) * freq));
      float m = min(s0, min(s1, s2));
      float expo = mix(1.0, 10.0, clamp(crisp, 0.0, 1.0));
      return pow(1.0 - m, expo);
    }

    float radialMask(vec2 p, float radius){
      float r = length(p);
      return 1.0 - smoothstep(radius*0.9, radius, r);
    }

    void main() {
      // Choose coordinate space
      vec2 coord2 = vUv;
      // If no UVs, derive a stable 2D from world pos & normal (simple triplanar-ish)
      if (u_useUV < 0.5) {
        vec3 n = normalize(abs(vWorldNormal) + 1e-5);
        vec2 pX = vWorldPos.yz;
        vec2 pY = vWorldPos.zx;
        vec2 pZ = vWorldPos.xy;
        coord2 = (pX*n.x + pY*n.y + pZ*n.z);
      }

      // Ripple center (UV space)
      vec2 p = coord2 - u_mouse;

      // Constrain the effect around cursor
      float mask = radialMask(p, u_radius);

      // Outward-moving ring
      float phase = length(p) * (u_size * 6.28318) - u_time * (u_speed * 6.28318);
      float ripple = sin(phase) * 0.5 + 0.5;
      
      // Apply sharpness
      ripple = pow(ripple, mix(0.5, 4.0, u_sharpness));
      
      // Combine with mask and intensity
      float finalRipple = ripple * mask * u_intensity;
      
      // Add triangular facet pattern for extra detail
      float facets = triFacet(coord2 * 20.0, 1.0, 0.3);
      finalRipple *= (0.7 + 0.3 * facets);
      
      // Output as additive color
      vec3 color = u_rippleColor * finalRipple;
      gl_FragColor = vec4(color, finalRipple);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Store uniforms reference for easy access
  (material as any).__rippleUniforms = material.uniforms;

  return material;
}