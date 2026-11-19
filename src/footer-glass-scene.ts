import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type FooterGlassScene = { setVisible: (visible: boolean) => void; dispose: () => void };

/** A textured photograph behind a real transmissive, corrugated optical surface. */
export async function createFooterGlassScene(
  host: HTMLDivElement,
  footer: HTMLElement,
  signal: AbortSignal,
  onContextLost: () => void,
): Promise<FooterGlassScene> {
  const response = await fetch('/art/kivuno-flower-collage.webp', { signal });
  if (!response.ok) throw new Error('Footer photograph unavailable.');
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException('Aborted', 'AbortError');
  }
  const photograph = new Texture(bitmap);
  photograph.flipY = false;
  photograph.colorSpace = SRGBColorSpace;
  photograph.needsUpdate = true;

  let renderer: WebGLRenderer | null = null;
  let environmentMap: WebGLRenderTarget | null = null;
  let paneGeometry: PlaneGeometry | null = null;
  let disposed = false;
  let visible = true;
  let frame = 0;
  let resizeObserver: ResizeObserver | null = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const world = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 40);
  camera.position.z = 10;
  const photoGeometry = new PlaneGeometry(2, 2);
  const photoMaterial = new MeshBasicMaterial({ map: photograph, toneMapped: false });
  const photo = new Mesh(photoGeometry, photoMaterial);
  photo.position.z = -0.8;
  world.add(photo);
  const glassMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    transmission: 1,
    thickness: 0.72,
    ior: 1.47,
    roughness: 0.095,
    dispersion: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.075,
    attenuationColor: new Color(0xf4f0ff),
    attenuationDistance: 18,
    envMapIntensity: 0.32,
  });
  const pane = new Mesh<PlaneGeometry, MeshPhysicalMaterial>(undefined, glassMaterial);
  // Replace the automatically created placeholder immediately on the first resize.
  pane.geometry.dispose();
  world.add(pane);
  const key = new DirectionalLight(0xfffcf5, 1.8);
  key.position.set(-5, 7, 8);
  world.add(key);
  const rim = new DirectionalLight(0xe8dcff, 0.5);
  rim.position.set(6, 2, 5);
  world.add(rim);

  function paint() {
    frame = 0;
    if (!disposed && visible && !document.hidden && renderer) renderer.render(world, camera);
  }
  function requestPaint() {
    if (!disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(paint);
  }
  function setVisible(next: boolean) {
    visible = next;
    if (next) requestPaint();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }
  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height || !renderer || disposed) return;
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    const viewHeight = 2 * Math.tan((35 * Math.PI) / 360) * 10;
    const photoHeight = viewHeight * 1.08;
    photo.scale.set((photoHeight * aspect) / 2, photoHeight / 2, 1);

    // Match CSS object-fit: cover; keep the botanical photograph recognizable.
    const imageAspect = bitmap.width / bitmap.height;
    photograph.repeat.set(Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect));
    const photoPositionX = width <= 700 ? 0.56 : 0.5;
    photograph.offset.set(
      (1 - photograph.repeat.x) * photoPositionX,
      (1 - photograph.repeat.y) / 2,
    );
    photograph.updateMatrix();

    const flutes = width <= 700 ? 7 : 18;
    const paneWidth = viewHeight * aspect * 1.035;
    const paneHeight = viewHeight * 1.035;
    const next = new PlaneGeometry(paneWidth, paneHeight, flutes * 24, 40);
    const positions = next.attributes.position;
    const pitch = paneWidth / flutes;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const phase = (x / pitch) * Math.PI * 2 + Math.sin(y * 0.38) * 0.11;
      // Surface normals, thickness and IOR bend the actual photograph in the transmission pass.
      const flute = Math.cos(phase) * pitch * 0.15;
      const bow = 0.055 * Math.cos((y / paneHeight) * Math.PI);
      positions.setZ(i, 0.12 + flute + bow);
    }
    next.computeVertexNormals();
    paneGeometry?.dispose();
    paneGeometry = next;
    pane.geometry = next;
    requestPaint();
  }
  function pointerMove(event: PointerEvent) {
    if (reduced.matches || !visible || event.pointerType !== 'mouse') return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    const next = -5 + x * 1.5;
    if (Math.abs(key.position.x - next) < 0.08) return;
    key.position.x = next;
    requestPaint();
  }
  function resetLight() {
    key.position.x = -5;
    requestPaint();
  }
  function visibilityChanged() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else requestPaint();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    dispose();
    onContextLost();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    footer.removeEventListener('pointermove', pointerMove);
    footer.removeEventListener('pointerleave', resetLight);
    document.removeEventListener('visibilitychange', visibilityChanged);
    reduced.removeEventListener('change', resetLight);
    renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
    paneGeometry?.dispose();
    photoGeometry.dispose();
    photoMaterial.dispose();
    glassMaterial.dispose();
    photograph.dispose();
    bitmap.close();
    environmentMap?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.domElement.remove();
    }
  }

  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.transmissionResolutionScale = 0.75;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.setAttribute('data-footer-glass-canvas', '');
    const environment = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    try {
      environmentMap = pmrem.fromScene(environment, 0.04);
      world.environment = environmentMap.texture;
    } finally {
      environment.dispose();
      pmrem.dispose();
    }
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    footer.addEventListener('pointermove', pointerMove, { passive: true });
    footer.addEventListener('pointerleave', resetLight);
    document.addEventListener('visibilitychange', visibilityChanged);
    reduced.addEventListener('change', resetLight);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    host.appendChild(renderer.domElement);
    resize();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return { setVisible, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
