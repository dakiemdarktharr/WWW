import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type TitleScene = { reset: () => void; dispose: () => void };

function disposeModel(root: Object3D) {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value)
          textures.add(value as Texture);
      }
    }
  });
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap)
      texture.image.close();
  }
  for (const material of materials) material.dispose();
}

/** Baked Blender geometry; only the user's rotation is animated on the client. */
export async function createTitleScene(
  host: HTMLDivElement,
  signal: AbortSignal,
  onContextLost: () => void,
): Promise<TitleScene> {
  const bytes = await fetch('/art/kivuno-puffy-title.glb', { signal }).then((response) => {
    if (!response.ok) throw new Error('Title artwork unavailable');
    return response.arrayBuffer();
  });
  const gltf = await new GLTFLoader().parseAsync(bytes, '/art/');
  if (signal.aborted) {
    disposeModel(gltf.scene);
    throw new DOMException('Aborted', 'AbortError');
  }
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (error) {
    disposeModel(gltf.scene);
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const world = new Scene();
  let environmentMap: WebGLRenderTarget | null = null;
  world.environmentIntensity = 1.05;
  const key = new DirectionalLight(0xffffff, 3.2);
  key.position.set(-4, 7, 8);
  world.add(key);
  const rim = new DirectionalLight(0xe4d7ff, 2.2);
  rim.position.set(6, 2, 5);
  world.add(rim);
  const fill = new DirectionalLight(0xf1ffd2, 1.1);
  fill.position.set(-6, -3, 4);
  world.add(fill);

  const bounds = new Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new Vector3());
  gltf.scene.position.sub(bounds.getCenter(new Vector3()));
  const assembly = new Group();
  // Pitch before yaw keeps the wide wordmark inside the camera at diagonal drags.
  assembly.rotation.order = 'YXZ';
  assembly.add(gltf.scene);
  world.add(assembly);
  const camera = new OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 24);
  camera.lookAt(0, 0, 0);

  let disposed = false;
  let visible = true;
  let frame = 0;
  let previousTime = 0;
  let pointer: number | null = null;
  let downX = 0,
    downY = 0,
    originX = 0,
    originY = 0;
  let x = 0,
    y = 0,
    vx = 0,
    vy = 0,
    targetX = 0,
    targetY = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

  function paint() {
    assembly.rotation.set(x - 0.025, y - 0.045, -0.012);
    host.dataset.rotation = `${x.toFixed(4)},${y.toFixed(4)}`;
    renderer.render(world, camera);
  }
  function tick(time: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.25) : 1 / 60;
    previousTime = time;
    if (reduced.matches) {
      x = targetX;
      y = targetY;
      vx = 0;
      vy = 0;
    } else {
      // Small integration steps keep the spring stable without slowing its clock
      // on low-frame-rate devices or software WebGL renderers.
      const steps = Math.ceil(dt * 120);
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        vx += ((targetX - x) * 190 - vx * 24) * step;
        vy += ((targetY - y) * 190 - vy * 24) * step;
        x += vx * step;
        y += vy * step;
      }
    }
    const resting =
      Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(vx) + Math.abs(vy) < 0.00015;
    if (resting) {
      x = targetX;
      y = targetY;
      vx = 0;
      vy = 0;
    }
    paint();
    if (!resting) requestPaint();
  }
  function requestPaint() {
    if (!disposed && !frame && visible && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function reset() {
    targetX = 0;
    targetY = 0;
    previousTime = 0;
    requestPaint();
  }
  function release() {
    const active = pointer;
    pointer = null;
    host.classList.remove('is-dragging');
    if (active !== null && host.hasPointerCapture(active)) host.releasePointerCapture(active);
    reset();
  }
  function pointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
    pointer = event.pointerId;
    downX = event.clientX;
    downY = event.clientY;
    originX = x;
    originY = y;
    host.setPointerCapture(pointer);
    host.classList.add('is-dragging');
    host.focus({ preventScroll: true });
  }
  function pointerMove(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    targetX = clamp(originX + (event.clientY - downY) * 0.006, 0.55);
    targetY = clamp(originY + (event.clientX - downX) * 0.007, 1.05);
    requestPaint();
  }
  function pointerEnd(event: PointerEvent) {
    if (pointer === event.pointerId) release();
  }
  function keyDown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Escape'].includes(event.key))
      return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'Escape') {
      release();
      return;
    }
    if (event.key === 'ArrowLeft') targetY = clamp(targetY - 0.15, 1.05);
    if (event.key === 'ArrowRight') targetY = clamp(targetY + 0.15, 1.05);
    if (event.key === 'ArrowUp') targetX = clamp(targetX - 0.12, 0.55);
    if (event.key === 'ArrowDown') targetX = clamp(targetX + 0.12, 0.55);
    requestPaint();
  }
  function keyUp(event: KeyboardEvent) {
    if (event.key.startsWith('Arrow')) reset();
  }
  function resize() {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const halfHeight = Math.max(size.y * 0.55, (size.x * 0.55) / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestPaint();
  }
  function visibilityChanged() {
    if (document.hidden) release();
    else {
      previousTime = 0;
      requestPaint();
    }
  }
  function contextLost(event: Event) {
    event.preventDefault();
    dispose();
    onContextLost();
  }
  const resizeObserver = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) {
      release();
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      previousTime = 0;
      requestPaint();
    }
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersection.disconnect();
    host.removeEventListener('pointerdown', pointerDown);
    host.removeEventListener('pointermove', pointerMove);
    host.removeEventListener('pointerup', pointerEnd);
    host.removeEventListener('pointercancel', pointerEnd);
    host.removeEventListener('lostpointercapture', pointerEnd);
    host.removeEventListener('keydown', keyDown);
    host.removeEventListener('keyup', keyUp);
    host.removeEventListener('blur', release);
    document.removeEventListener('visibilitychange', visibilityChanged);
    reduced.removeEventListener('change', reset);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    environmentMap?.dispose();
    disposeModel(gltf.scene);
    renderer.dispose();
    renderer.domElement.remove();
  }
  try {
    const environment = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    try {
      environmentMap = pmrem.fromScene(environment, 0.025);
      world.environment = environmentMap.texture;
    } finally {
      environment.dispose();
      pmrem.dispose();
    }
    host.addEventListener('pointerdown', pointerDown);
    host.addEventListener('pointermove', pointerMove);
    host.addEventListener('pointerup', pointerEnd);
    host.addEventListener('pointercancel', pointerEnd);
    host.addEventListener('lostpointercapture', pointerEnd);
    host.addEventListener('keydown', keyDown);
    host.addEventListener('keyup', keyUp);
    host.addEventListener('blur', release);
    document.addEventListener('visibilitychange', visibilityChanged);
    reduced.addEventListener('change', reset);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    host.append(renderer.domElement);
    resizeObserver.observe(host);
    intersection.observe(host);
    resize();
    paint();
    return { reset, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
