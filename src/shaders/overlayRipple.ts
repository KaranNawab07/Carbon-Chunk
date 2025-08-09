import * as THREE from "three";

export type RippleUniforms = {
  u_time: number;
  u_mouse: THREE.Vector2;
  u_mouseWorld: THREE.Vector3;
  u_radius: number;
  u_sigma: number;
  u_speed: number;
  u_intensity: number;
  u_baseColor: THREE.Color;
  u_rippleColor: THREE.Color;
  u_worldRadiusMul: number;
  u_useUV: number;
  u_mode: number;
};

export function createOverlayRipple(initial?: Partial<RippleUniforms>) {
  const uniforms = {
    u_time:          { value: 0 },
    u_mouse:         { value: new THREE.Vector2(-10, -10) },
    u_mouseWorld:    { value: new THREE.Vector3(0, 0, 0) },
    u_radius:        { value: 0.3 },
    u_sigma:         { value: 0.05 },
    u_speed:         { value: 2.0 },
    u_intensity:     { value: 1.0 },
    u_baseColor:     { value: new THREE.Color(0.10, 0.10, 0.10) },
    u_rippleColor:   { value: new THREE.Color(1.0, 1.0, 1.0) },
    u_worldRadiusMul:{ value: 2.8 },
    u_useUV:         { value: 1.0 },
    u_mode:          { value: 0 },
  };

  if (initial) for (const k in initial) if ((uniforms as any)[k]) (uniforms as any)[k].value = (initial as any)[k];

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

    void main(){
      // Debug modes
      if (u_mode == 1) { 
        gl_FragColor = vec4(vUv, 0.0, 1.0); 
        return; 
      }
      
      if (u_mode == 2) { 
        // Show bright red everywhere to confirm overlay is rendering
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(1.0, 0.0, 0.0, 0.5);
        return; 
      }

      // Hide if mouse is off-screen (but show some debug info)
      if (u_mouse.x < 0.0 || u_mouse.y < 0.0) {
        // Show faint blue when mouse is off-screen to confirm shader is running
        gl_FragColor = vec4(0.0, 0.0, 0.2, 0.3);
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      // Calculate distance from mouse position
      vec2 diff = vUv - u_mouse;
      float dist = length(diff);
      
      // Create expanding ring
      float ringRadius = mod(u_time * u_speed, u_radius);
      float ringWidth = u_sigma;
      
      // Ring intensity based on distance from ring edge
      float ringDist = abs(dist - ringRadius);
      float ringIntensity = 1.0 - smoothstep(0.0, ringWidth, ringDist);
      
      // Fade out as ring expands
      float fadeFactor = 1.0 - (ringRadius / u_radius);
      
      // Only show within max radius
      float mask = 1.0 - smoothstep(u_radius - 0.05, u_radius, dist);
      
      // Make it MUCH more visible
      float finalIntensity = ringIntensity * fadeFactor * mask * u_intensity * 5.0;
      
      // Force bright white for visibility
      gl_FragColor = vec4(1.0, 1.0, 1.0, finalIntensity);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  return mat as THREE.ShaderMaterial;
}