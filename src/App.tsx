import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import ModelViewer from './ModelViewer';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc' }}>
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '1rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        zIndex: 10,
        position: 'relative'
      }}>
        <h1 style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          color: '#1e293b',
          margin: 0
        }}>
          3D Model Viewer with Overlay Ripple Effects
        </h1>
        <div style={{ color: '#64748b', fontSize: '0.875rem', textAlign: 'right' }}>
          <div>Hover over the model to see ripple effects</div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Additive overlay preserves original materials
          </div>
        </div>
      </div>
      
      <div style={{ height: 'calc(100vh - 80px)' }}>
        <Canvas
          dpr={[1, 2]}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 1)}
          camera={{ fov: 45, near: 0.1, far: 1000, position: [0, 0, 4] }}
        >
          <ambientLight intensity={2.5} />
          <directionalLight position={[10, 10, 5]} intensity={3.0} castShadow />
          <directionalLight position={[-5, 0, -5]} intensity={2.0} />
          <directionalLight position={[0, 15, 0]} intensity={1.5} />
          <directionalLight position={[0, 5, -10]} intensity={1.2} />
          <directionalLight position={[15, 5, 0]} intensity={1.0} />
          
          <Suspense fallback={
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="gray" />
            </mesh>
          }>
            <ModelViewer />
          </Suspense>
          
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            minDistance={1}
            maxDistance={100}
          />
          
          <Environment preset="studio" />
        </Canvas>
      </div>
    </div>
  );
}

export default App;