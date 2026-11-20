import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { contactDisplacements, stepSpring, type Spring } from './puffy-title-physics';

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

/** Blender's settled balloons with an on-demand, local soft-surface response. */
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

  type Surface = {
    mesh: Mesh;
    rest: Float32Array;
    normals: Float32Array;
    offsets: Float32Array;
    pressure: Spring;
    held: boolean;
    linger: number;
    dirty: boolean;
    radius: number;
    depth: number;
  };
  const surfaces = new Map<Mesh, Surface>();
  const activeSurfaces = new Set<Surface>();
  const raycaster = new Raycaster();
  const rayPoint = new Vector2();
  let pressedSurface: Surface | null = null;
  const materials = new Set<MeshStandardMaterial>();
  const originalColors = new Map<MeshStandardMaterial, number>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const rest = new Float32Array(position.count * 3);
    const normals = new Float32Array(normal.count * 3);
    for (let i = 0; i < position.count; i++) {
      rest.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
    }
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(rest.slice(), 3).setUsage(DynamicDrawUsage),
    );
    geometry.setAttribute(
      'normal',
      new Float32BufferAttribute(normals.slice(), 3).setUsage(DynamicDrawUsage),
    );
    geometry.computeBoundingBox();
    const extent = geometry.boundingBox!.getSize(new Vector3());
    const thickness = Math.min(extent.x, extent.y, extent.z);
    surfaces.set(object, {
      mesh: object,
      rest,
      normals,
      offsets: new Float32Array(rest.length),
      pressure: { value: 0, velocity: 0 },
      held: false,
      linger: 0,
      dirty: false,
      radius: Math.max(0.3, thickness * 0.6),
      depth: Math.min(0.25, thickness * 0.25),
    });
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      materials.add(material);
      originalColors.set(material, material.color.getHex());
    }
  });

  let disposed = false;
  let visible = true;
  let frame = 0;
  let previousTime = 0;
  let pointer: number | null = null;
  let downX = 0,
    downY = 0,
    originX = 0,
    originY = 0;
  const rotationX: Spring = { value: 0, velocity: 0 };
  const rotationY: Spring = { value: 0, velocity: 0 };
  let targetX = 0,
    targetY = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

  function syncTheme() {
    const light = document.documentElement.dataset.portalTheme !== 'dark';
    renderer.toneMappingExposure = light ? 0.86 : 1.04;
    world.environmentIntensity = light ? 0.72 : 0.95;
    key.intensity = light ? 1.9 : 2.8;
    rim.intensity = light ? 1.2 : 1.9;
    fill.intensity = light ? 0.5 : 0.9;
    for (const material of materials) {
      const name = material.name;
      const color = name.includes('Lime')
        ? 0x86b50c
        : name.includes('Lilac')
          ? 0x8b54cc
          : name.includes('Pearl')
            ? 0xb197ce
            : 0x652bb9;
      material.color.setHex(light ? color : originalColors.get(material)!);
      material.roughness = light ? 0.29 : 0.235;
    }
    host.dataset.titleTheme = light ? 'light' : 'dark';
    requestPaint();
  }
  const themeObserver = new MutationObserver(syncTheme);

  function restoreSurface(surface: Surface) {
    const geometry = surface.mesh.geometry;
    (geometry.getAttribute('position').array as Float32Array).set(surface.rest);
    (geometry.getAttribute('normal').array as Float32Array).set(surface.normals);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('normal').needsUpdate = true;
    surface.pressure = { value: 0, velocity: 0 };
    surface.held = false;
    surface.linger = 0;
    activeSurfaces.delete(surface);
  }
  function updateSurfaces(dt: number) {
    let changing = false;
    let largestDent = 0;
    for (const surface of activeSurfaces) {
      if (!surface.held) surface.linger = Math.max(0, surface.linger - dt);
      const target = surface.held || surface.linger > 0 ? 1 : 0;
      const before = surface.pressure.value;
      if (reduced.matches) surface.pressure = { value: target, velocity: 0 };
      else stepSpring(surface.pressure, target, dt, target ? 17 : 5.8);
      const amount = surface.pressure.value;
      largestDent = Math.max(largestDent, amount * surface.depth);
      if (amount === 0 && target === 0) {
        restoreSurface(surface);
        continue;
      }
      if (amount !== before || surface.dirty) {
        const geometry = surface.mesh.geometry;
        const position = geometry.getAttribute('position');
        const vertices = position.array as Float32Array;
        for (let i = 0; i < vertices.length; i++)
          vertices[i] = surface.rest[i] + surface.offsets[i] * amount;
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        surface.dirty = false;
      }
      if (surface.pressure.velocity || amount !== target || (!surface.held && surface.linger > 0))
        changing = true;
    }
    host.dataset.dent = largestDent.toFixed(4);
    host.dataset.dentMeshes = String(activeSurfaces.size);
    return changing;
  }
  function pressAt(clientX: number, clientY: number) {
    const rect = host.getBoundingClientRect();
    rayPoint.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    );
    world.updateMatrixWorld(true);
    raycaster.setFromCamera(rayPoint, camera);
    const hit = raycaster.intersectObjects([...surfaces.keys()], false)[0];
    if (!hit || !(hit.object instanceof Mesh) || !hit.face) return;
    const surface = surfaces.get(hit.object)!;
    const localPoint = hit.object.worldToLocal(hit.point.clone());
    const normal = hit.normal?.clone() || hit.face.normal.clone();
    // Compute each contact from rest coordinates, not from previously displaced vertices.
    // A bounded number of returning letters keeps rapid tapping inexpensive.
    if (!activeSurfaces.has(surface) && activeSurfaces.size >= 4)
      restoreSurface(activeSurfaces.values().next().value!);
    surface.offsets = contactDisplacements(
      surface.rest,
      surface.normals,
      [localPoint.x, localPoint.y, localPoint.z],
      [normal.x, normal.y, normal.z],
      surface.radius,
      surface.depth,
    );
    surface.held = true;
    surface.dirty = true;
    surface.linger = 0.14;
    pressedSurface = surface;
    activeSurfaces.add(surface);
    host.dataset.pressedLetter = hit.object.name;
    previousTime = 0;
    requestPaint();
  }

  function paint() {
    assembly.rotation.set(rotationX.value - 0.025, rotationY.value - 0.045, -0.012);
    host.dataset.rotation = `${rotationX.value.toFixed(4)},${rotationY.value.toFixed(4)}`;
    renderer.render(world, camera);
  }
  function tick(time: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.25) : 1 / 60;
    previousTime = time;
    if (reduced.matches) {
      rotationX.value = targetX;
      rotationY.value = targetY;
      rotationX.velocity = 0;
      rotationY.velocity = 0;
    } else {
      const frequency = pointer !== null || targetX !== 0 || targetY !== 0 ? 12 : 3.4;
      stepSpring(rotationX, targetX, dt, frequency);
      stepSpring(rotationY, targetY, dt, frequency);
      for (const [state, limit] of [
        [rotationX, 0.55],
        [rotationY, 1.05],
      ] as const) {
        if (Math.abs(state.value) > limit) {
          state.value = clamp(state.value, limit);
          state.velocity = 0;
        }
      }
    }
    const resting =
      rotationX.value === targetX &&
      rotationY.value === targetY &&
      rotationX.velocity === 0 &&
      rotationY.velocity === 0;
    const surfaceChanging = updateSurfaces(dt);
    paint();
    if (!resting || surfaceChanging) requestPaint();
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
    if (pressedSurface) pressedSurface.held = false;
    pressedSurface = null;
    host.classList.remove('is-dragging');
    if (active !== null && host.hasPointerCapture(active)) host.releasePointerCapture(active);
    reset();
  }
  function pointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
    pointer = event.pointerId;
    downX = event.clientX;
    downY = event.clientY;
    originX = rotationX.value;
    originY = rotationY.value;
    host.setPointerCapture(pointer);
    host.classList.add('is-dragging');
    host.focus({ preventScroll: true });
    pressAt(event.clientX, event.clientY);
  }
  function pointerMove(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 7 && pressedSurface) {
      pressedSurface.held = false;
      pressedSurface = null;
    }
    targetX = clamp(originX + (event.clientY - downY) * 0.006, 0.55);
    targetY = clamp(originY + (event.clientX - downX) * 0.007, 1.05);
    requestPaint();
  }
  function pointerEnd(event: PointerEvent) {
    if (pointer === event.pointerId) release();
  }
  function keyDown(event: KeyboardEvent) {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Escape', ' '].includes(
        event.key,
      )
    )
      return;
    event.preventDefault();
    if (event.key === ' ') {
      if (!event.repeat) {
        const rect = host.getBoundingClientRect();
        const object = [...surfaces.keys()][8];
        const front = new Vector3().fromBufferAttribute(
          object.geometry.getAttribute('position'),
          0,
        );
        let nearest = -Infinity;
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          const vertex = new Vector3().fromBufferAttribute(position, i);
          object.localToWorld(vertex);
          if (vertex.z > nearest) {
            nearest = vertex.z;
            front.copy(vertex);
          }
        }
        front.project(camera);
        pressAt(
          rect.left + ((front.x + 1) * rect.width) / 2,
          rect.top + ((1 - front.y) * rect.height) / 2,
        );
      }
      return;
    }
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
    if (event.key === ' ') release();
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
    themeObserver.disconnect();
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
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    renderer.domElement.remove();
    activeSurfaces.clear();
    surfaces.clear();
    materials.clear();
    originalColors.clear();
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
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-portal-theme'],
    });
    syncTheme();
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
