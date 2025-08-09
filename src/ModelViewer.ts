import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class ModelViewer {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private loader: GLTFLoader
  private currentModel: THREE.Group | null = null
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private modelSelect: HTMLSelectElement
  private resetButton: HTMLButtonElement
  private loadingElement: HTMLElement
  private instructionsElement: HTMLElement

  constructor() {
    this.canvas = document.getElementById('three-canvas') as HTMLCanvasElement
    this.container = document.getElementById('viewer-container') as HTMLElement
    this.modelSelect = document.getElementById('modelSelect') as HTMLSelectElement
    this.resetButton = document.getElementById('resetCamera') as HTMLButtonElement
    this.loadingElement = document.getElementById('loading') as HTMLElement
    this.instructionsElement = document.getElementById('instructions') as HTMLElement

    // Initialize Three.js components
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas,
      antialias: true,
      alpha: true
    })
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.loader = new GLTFLoader()

    this.setupScene()
    this.setupEventListeners()
  }

  private setupScene(): void {
    // Set up renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    // Set up scene
    this.scene.background = new THREE.Color(0xf0f0f0)

    // Set up camera
    this.camera.position.set(5, 5, 5)
    this.camera.lookAt(0, 0, 0)

    // Set up controls
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.screenSpacePanning = false
    this.controls.minDistance = 1
    this.controls.maxDistance = 100

    // Add lights
    this.addLights()

    // Add grid
    const gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0xcccccc)
    this.scene.add(gridHelper)
  }

  private addLights(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
    this.scene.add(ambientLight)

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    directionalLight.shadow.camera.left = -10
    directionalLight.shadow.camera.right = 10
    directionalLight.shadow.camera.top = 10
    directionalLight.shadow.camera.bottom = -10
    this.scene.add(directionalLight)

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
    fillLight.position.set(-5, 0, -5)
    this.scene.add(fillLight)
  }

  private setupEventListeners(): void {
    // Model selection
    this.modelSelect.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement
      if (target.value) {
        this.loadModel(target.value)
      } else {
        this.clearModel()
      }
    })

    // Reset camera button
    this.resetButton.addEventListener('click', () => {
      this.resetCamera()
    })

    // Window resize
    window.addEventListener('resize', () => {
      this.onWindowResize()
    })
  }

  private async loadModel(filename: string): Promise<void> {
    this.showLoading(true)
    this.hideInstructions()

    try {
      // Clear existing model
      this.clearModel()

      // Load new model
      const gltf = await this.loader.loadAsync(filename)
      this.currentModel = gltf.scene

      // Enable shadows
      this.currentModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      // Add to scene
      this.scene.add(this.currentModel)

      // Fit camera to model
      this.fitCameraToModel()

      console.log('Model loaded successfully:', filename)
    } catch (error) {
      console.error('Error loading model:', error)
      alert('Failed to load model. Please check the console for details.')
    } finally {
      this.showLoading(false)
    }
  }

  private clearModel(): void {
    if (this.currentModel) {
      this.scene.remove(this.currentModel)
      this.currentModel = null
    }
    this.showInstructions()
  }

  private fitCameraToModel(): void {
    if (!this.currentModel) return

    const box = new THREE.Box3().setFromObject(this.currentModel)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = this.camera.fov * (Math.PI / 180)
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))

    cameraZ *= 2 // Add some padding

    this.camera.position.set(cameraZ, cameraZ * 0.7, cameraZ)
    this.camera.lookAt(center)
    this.controls.target.copy(center)
    this.controls.update()
  }

  private resetCamera(): void {
    if (this.currentModel) {
      this.fitCameraToModel()
    } else {
      this.camera.position.set(5, 5, 5)
      this.camera.lookAt(0, 0, 0)
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    }
  }

  private showLoading(show: boolean): void {
    if (show) {
      this.loadingElement.classList.remove('hidden')
    } else {
      this.loadingElement.classList.add('hidden')
    }
  }

  private showInstructions(): void {
    this.instructionsElement.classList.remove('hidden')
  }

  private hideInstructions(): void {
    this.instructionsElement.classList.add('hidden')
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  public init(): void {
    // Auto-load Model 2
    this.loadModel('b6ae0504-48ae-4708-a8f3-619e3b46318e_textured_mesh.glb')
    this.animate()
  }
}