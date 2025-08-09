import * as THREE from "three";

export function createRippleMaterial(options: any = {}) {
  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform float u_radius;
    uniform float u_intensity;
    
    void main() {
      vUv = uv;
      vPosition = position;
      
      vec3 pos = position;
      float dist = distance(uv, u_mouse);
      float ripple = sin(dist * 20.0 - u_time * 5.0) * u_intensity * 0.02 * exp(-dist / u_radius);
      pos += normal * ripple;
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform vec3 u_baseColor;
    uniform vec3 u_rippleColor;
    uniform float u_radius;
    uniform float u_intensity;
    uniform float u_size;
    uniform float u_speed;
    uniform float u_sharpness;
    
    void main() {
      vec2 uv = vUv;
      
      // Ripple effect
      float dist = distance(uv, u_mouse);
      float ripple = sin(dist * u_size - u_time * u_speed) * u_intensity * 0.1 * exp(-dist / u_radius);
      uv += ripple * 0.02;
      
      // Color mixing
      float rippleStrength = abs(ripple) * u_sharpness;
      vec3 color = mix(u_baseColor, u_rippleColor, rippleStrength);
      
      // Add some shimmer
      float shimmer = sin(u_time * 2.0 + vPosition.x * 10.0 + vPosition.y * 10.0) * 0.1 + 0.9;
      
      gl_FragColor = vec4(color * shimmer, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      u_time: { value: 0.0 },
      u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
      u_baseColor: { value: options.u_baseColor || new THREE.Color(0.2, 0.2, 0.2) },
      u_rippleColor: { value: options.u_rippleColor || new THREE.Color(1.0, 1.0, 1.0) },
      u_radius: { value: options.u_radius || 0.3 },
      u_intensity: { value: options.u_intensity || 1.0 },
      u_size: { value: options.u_size || 15.0 },
      u_speed: { value: options.u_speed || 4.0 },
      u_sharpness: { value: options.u_sharpness || 1.0 }
    },
    transparent: true,
  });

  // Store uniforms reference for easy access
  (material as any).__rippleUniforms = material.uniforms;

  return material;
}