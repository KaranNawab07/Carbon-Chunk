import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import ModelViewer from './ModelViewer';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <div 
        style={{
          position: 'fixed',
          left: '12px',
          bottom: '12px',
          color: '#9aa0a6',
          font: '12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI"',
          background: 'rgba(20,20,20,.5)',
          padding: '8px 10px',
          borderRadius: '8px',
          zIndex: 1000
        }}
      >
        Hover the model: ripple should follow the cursor. Press 1-6 for debug modes.
      </div>
      <Canvas 
        dpr={[1, 2]} 
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 1);
          gl.domElement.style.cursor = 'crosshair';
        }}
      >
        <OrbitControls enableDamping dampingFactor={0.05} />
        <ModelViewer />
        <EffectComposer>
          <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.1} intensity={0.6} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}