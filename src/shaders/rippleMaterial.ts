import * as THREE from "three";

export function createRippleMaterial() {
  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float u_time;
    uniform vec2 u_mouse;
    
    void main() {
      vUv = uv;
      vPosition = position;
      
      vec3 pos = position;
      float dist = distance(uv, u_mouse);
      float ripple = sin(dist * 20.0 - u_time * 5.0) * 0.02 * exp(-dist * 3.0);
      pos += normal * ripple;
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform sampler2D u_texture;
    
    void main() {
      vec2 uv = vUv;
      
      // Ripple effect
      float dist = distance(uv, u_mouse);
      float ripple = sin(dist * 15.0 - u_time * 4.0) * 0.1 * exp(-dist * 2.0);
      uv += ripple * 0.02;
      
      // Sample texture
      vec4 texColor = texture2D(u_texture, uv);
      
      // Add some shimmer
      float shimmer = sin(u_time * 2.0 + vPosition.x * 10.0 + vPosition.y * 10.0) * 0.1 + 0.9;
      
      gl_FragColor = vec4(texColor.rgb * shimmer, texColor.a);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      u_time: { value: 0.0 },
      u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
      u_texture: { value: new THREE.Texture() }
    },
    transparent: true,
  });

  // Store uniforms reference for easy access
  (material as any).__rippleUniforms = material.uniforms;

  return material;
}