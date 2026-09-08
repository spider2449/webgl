import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createGrid } from './grid';

export type Primitive = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'icosphere';
export type Keyframe = { frame: number; position: number[]; quaternion: number[]; scale: number[] };
export type Project = { format: 'forge-studio'; version: 1; name: string; scene: ReturnType<THREE.Group['toJSON']> };
const MAX_HISTORY_BYTES = 24 * 1024 * 1024;

export class Editor extends EventTarget {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
  readonly scene = new THREE.Scene();
  readonly content = new THREE.Group();
  readonly perspective = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
  readonly orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 2000);
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;
  readonly grid = createGrid();
  readonly selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xd6ac78);
  selected: THREE.Object3D | null = null;
  name = 'Untitled scene';
  frame = 1;
  playing = false;
  renderedFrames = 0;
  editMode = false;
  beforeRender: (() => void) | null = null;
  pickOverride: ((raycaster: THREE.Raycaster) => THREE.Object3D | null) | null = null;
  private vertexPoints: THREE.Points | null = null;
  private vertexProxy = new THREE.Object3D();
  private vertexIndices: number[] = [];
  private history: string[] = [];
  private historyIndex = -1;
  private pending = false;
  private playbackStart = 0;
  private playbackFrame = 1;
  private raycaster = new THREE.Raycaster();
  private mouseDown = new THREE.Vector2();
  private suppressClick = false;
  private viewStyle = 'material';
  private solid = new THREE.MeshStandardMaterial({ color: 0xadb0b7, roughness: 0.8 });
  private wire = new THREE.MeshBasicMaterial({ color: 0xaac7d7, wireframe: true });
  private resizeObserver: ResizeObserver;

  constructor(readonly host: HTMLElement) {
    super();
    this.scene.background = new THREE.Color(0x25282e);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D viewport');
    this.content.name = 'Scene Collection';
    this.scene.add(this.content, this.grid);
    this.scene.add(new THREE.HemisphereLight(0xe4edff, 0x777078, 2.4));
    const key = new THREE.DirectionalLight(0xffedda, 3.5);
    key.position.set(4, 7, 5);
    const fill = new THREE.DirectionalLight(0xb7ccff, 2);
    fill.position.set(-5, 3, -4);
    this.scene.add(key, fill, this.selectionBox, this.vertexProxy);
    this.selectionBox.visible = false;
    this.camera.position.set(8, 6, 10);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.9, 0);
    this.orbit.enableDamping = false;
    this.orbit.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.orbit.addEventListener('change', () => this.invalidate());
    this.orbit.update();
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      if (e.value) this.suppressClick = true;
      else this.commit();
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.editMode) this.updateVertex();
      this.updateSelection();
      this.emit('transform');
      this.invalidate();
    });
    this.transform.addEventListener('change', () => this.invalidate());
    this.renderer.domElement.addEventListener('pointerdown', e => {
      this.mouseDown.set(e.clientX, e.clientY);
      this.suppressClick = this.transform.dragging;
    });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (e.button !== 0 || this.suppressClick || this.mouseDown.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return;
      const rect = host.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      if (this.editMode) { this.pickVertex(); return; }
      const special = this.pickOverride?.(this.raycaster);
      if (special) { this.select(special); this.setTool('rotate'); return; }
      const hit = this.raycaster.intersectObjects(this.content.children, true).find(h => this.isVisible(h.object));
      let object = hit?.object ?? null;
      while (object && object.parent !== this.content) object = object.parent;
      this.select(object);
    });
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  emit(type = 'change') { this.dispatchEvent(new Event(type)); }
  isVisible(object: THREE.Object3D): boolean { return object.visible && (!object.parent || this.isVisible(object.parent)); }
  invalidate() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(time => {
      this.pending = false;
      if (this.playing) {
        this.frame = 1 + ((this.playbackFrame - 1 + (time - this.playbackStart) / 1000 * 24) % 250);
        this.evaluateAnimation();
        this.emit('frame');
      }
      this.render();
      if (this.playing) this.invalidate();
    });
  }
  render() {
    this.beforeRender?.();
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    if (this.viewStyle !== 'material') this.content.traverse(o => {
      if (o instanceof THREE.Mesh) { originals.set(o, o.material); o.material = this.viewStyle === 'wire' ? this.wire : this.solid; }
    });
    this.renderer.render(this.scene, this.camera);
    originals.forEach((material, mesh) => mesh.material = material);
    this.renderedFrames++;
    this.emit('stats');
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    const extent = 7;
    this.orthographic.left = -extent * width / height;
    this.orthographic.right = extent * width / height;
    this.orthographic.top = extent;
    this.orthographic.bottom = -extent;
    this.orthographic.updateProjectionMatrix();
    this.invalidate();
  }
  seed() {
    const cube = this.add('cube', false);
    cube.name = 'Cube';
    cube.rotation.y = Math.PI / 9;
    this.select(cube);
    this.commit();
  }
  add(kind: Primitive, commit = true) {
    this.setEditMode(false);
    const geometries = {
      cube: () => new THREE.BoxGeometry(2, 2, 2),
      sphere: () => new THREE.SphereGeometry(1, 32, 20),
      cylinder: () => new THREE.CylinderGeometry(1, 1, 2, 32),
      cone: () => new THREE.ConeGeometry(1, 2, 32),
      torus: () => new THREE.TorusGeometry(1, 0.32, 16, 48),
      plane: () => new THREE.PlaneGeometry(4, 4),
      icosphere: () => new THREE.IcosahedronGeometry(1.2, 2),
    };
    const primitiveGeometry = geometries[kind]();
    const geometry = new THREE.BufferGeometry().copy(primitiveGeometry);
    primitiveGeometry.dispose();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8b6b2, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide }));
    mesh.name = this.uniqueName(kind[0].toUpperCase() + kind.slice(1));
    mesh.position.y = kind === 'plane' ? 0 : kind === 'torus' ? 1.35 : kind === 'icosphere' ? 1.2 : 1;
    if (kind === 'plane') mesh.rotation.x = -Math.PI / 2;
    this.content.add(mesh);
    this.select(mesh);
    if (commit) this.commit();
    return mesh;
  }
  uniqueName(base: string) {
    const names = new Set(this.content.children.map(o => o.name));
    if (!names.has(base)) return base;
    let i = 1;
    while (names.has(`${base}.${String(i).padStart(3, '0')}`)) i++;
    return `${base}.${String(i).padStart(3, '0')}`;
  }
  select(object: THREE.Object3D | null) {
    if (object !== this.selected) this.setEditMode(false);
    this.selected = object;
    if (object && object.visible) this.transform.attach(object);
    else this.transform.detach();
    this.updateSelection();
    this.emit();
    this.invalidate();
  }
  updateSelection() {
    this.selectionBox.visible = !!this.selected && this.selected.visible && !this.editMode && !(this.selected instanceof THREE.Bone);
    if (this.selected) {
      const bounds = new THREE.Box3().setFromObject(this.selected);
      if (bounds.isEmpty()) this.selectionBox.visible = false;
      else this.selectionBox.setFromObject(this.selected);
    }
  }
  setTool(mode: 'translate' | 'rotate' | 'scale' | 'select') {
    if (mode === 'select') this.transform.detach();
    else {
      this.transform.setMode(this.editMode ? 'translate' : mode);
      if (this.editMode && this.vertexIndices.length) this.transform.attach(this.vertexProxy);
      else if (!this.editMode && this.selected?.visible) this.transform.attach(this.selected);
    }
    this.invalidate();
  }
  duplicate() {
    if (!this.selected) return;
    if (this.selected instanceof THREE.Bone || this.selected instanceof THREE.SkinnedMesh) return;
    this.setEditMode(false);
    const copy = cloneSkeleton(this.selected);
    copy.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry = o.geometry.clone();
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      }
    });
    copy.name = this.uniqueName(this.selected.name);
    copy.position.x += 2.5;
    this.content.add(copy);
    this.select(copy);
    this.commit();
  }
  remove() {
    if (!this.selected) return;
    if (this.selected instanceof THREE.Bone) return;
    const target = this.selected;
    this.select(null);
    target.removeFromParent();
    this.disposeObject(target);
    this.commit();
  }
  disposeObject(object: THREE.Object3D) {
    const resources = new Set<{ dispose(): void }>();
    const retained = new Set<{ dispose(): void }>();
    const removedNodes = new Set<THREE.Object3D>();
    object.traverse(o => removedNodes.add(o));
    const collect = (o: THREE.Object3D, target: Set<{ dispose(): void }>) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        if (o instanceof THREE.SkinnedMesh) target.add(o.skeleton);
        target.add(o.geometry);
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          target.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) target.add(value);
        }
      }
    };
    object.traverse(o => collect(o,resources));
    this.content.traverse(o => { if (!removedNodes.has(o)) collect(o,retained); });
    resources.forEach(r => { if (!retained.has(r)) r.dispose(); });
  }
  setShading(value: string) { this.viewStyle = value; this.invalidate(); }
  setQuality(value: string) { this.renderer.setPixelRatio(Math.min(devicePixelRatio, value === 'high' ? 2 : value === 'low' ? 1 : 1.5)); this.resize(); }
  view(axis: 'front' | 'right' | 'top' | 'perspective') {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const direction = axis === 'front' ? new THREE.Vector3(0, 0, 1) : axis === 'right' ? new THREE.Vector3(1, 0, 0) : axis === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(1, 0.75, 1.25).normalize();
    this.camera.position.copy(this.orbit.target).addScaledVector(direction, distance);
    this.orbit.update();
    this.invalidate();
  }
  toggleProjection() {
    const next = this.camera === this.perspective ? this.orthographic : this.perspective;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    if (next === this.orthographic) { next.zoom = 14 / Math.max(1, this.camera.position.distanceTo(this.orbit.target) * 0.77); next.updateProjectionMatrix(); }
    this.camera = next;
    this.orbit.object = next;
    this.transform.camera = next;
    this.orbit.update();
    this.invalidate();
    this.emit('view');
  }
  focus(all = false) {
    const target = all ? this.content : this.selected ?? this.content;
    const bounds = new THREE.Box3().setFromObject(target);
    target.traverse(o => { if (o instanceof THREE.Bone) bounds.expandByPoint(o.getWorldPosition(new THREE.Vector3())); });
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()).length();
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, Math.max(2, size * 1.6));
    this.orthographic.zoom = 10 / Math.max(1, size);
    this.orthographic.updateProjectionMatrix();
    this.orbit.update();
    this.invalidate();
  }
  get material(): THREE.MeshStandardMaterial | null {
    if (!(this.selected instanceof THREE.Mesh)) return null;
    const m = Array.isArray(this.selected.material) ? this.selected.material[0] : this.selected.material;
    return m instanceof THREE.MeshStandardMaterial ? m : null;
  }
  smooth(flat: boolean) {
    if (!this.selected) return;
    this.selected.traverse(o => {
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if ('flatShading' in m) { m.flatShading = flat; m.needsUpdate = true; }
      }
    });
    this.commit();
  }
  mirror() {
    if (!(this.selected instanceof THREE.Mesh)) return false;
    this.setEditMode(false);
    const geometry = this.selected.geometry;
    geometry.scale(-1, 1, 1);
    if (geometry.index) {
      const a = geometry.index.array;
      for (let i = 0; i < a.length; i += 3) [a[i], a[i + 2]] = [a[i + 2], a[i]];
      geometry.index.needsUpdate = true;
    } else {
      for (const attribute of Object.values(geometry.attributes) as THREE.BufferAttribute[]) {
        const a = attribute.array;
        const stride = attribute.itemSize;
        for (let i = 0; i < attribute.count; i += 3) for (let j = 0; j < stride; j++) {
          const first = i * stride + j, last = (i + 2) * stride + j;
          [a[first], a[last]] = [a[last], a[first]];
        }
        attribute.needsUpdate = true;
      }
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.commit();
    return true;
  }
  setEditMode(enabled: boolean) {
    if (enabled && (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing)) return false;
    this.editMode = enabled;
    this.vertexIndices = [];
    this.transform.detach();
    if (this.vertexPoints) {
      this.vertexPoints.removeFromParent();
      this.vertexPoints.geometry.dispose();
      (this.vertexPoints.material as THREE.Material).dispose();
      this.vertexPoints = null;
    }
    if (enabled && this.selected instanceof THREE.Mesh) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', this.selected.geometry.getAttribute('position').clone());
      this.vertexPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xf4be75, size: 6, sizeAttenuation: false, depthTest: false }));
      this.vertexPoints.renderOrder = 10;
      this.selected.add(this.vertexPoints);
    } else if (this.selected?.visible) this.transform.attach(this.selected);
    this.updateSelection();
    this.emit('mode');
    this.invalidate();
    return true;
  }
  private pickVertex() {
    if (!this.vertexPoints || !(this.selected instanceof THREE.Mesh)) return;
    this.raycaster.params.Points.threshold = this.camera.position.distanceTo(this.orbit.target) * 0.012;
    const hit = this.raycaster.intersectObject(this.vertexPoints)[0];
    if (!hit || hit.index === undefined) return;
    const positions = this.selected.geometry.getAttribute('position');
    const local = new THREE.Vector3().fromBufferAttribute(positions, hit.index);
    this.vertexIndices = [];
    for (let i = 0; i < positions.count; i++) if (new THREE.Vector3().fromBufferAttribute(positions, i).distanceToSquared(local) < 1e-10) this.vertexIndices.push(i);
    this.vertexProxy.position.copy(this.selected.localToWorld(local));
    this.transform.setMode('translate');
    this.transform.attach(this.vertexProxy);
    this.invalidate();
  }
  private updateVertex() {
    if (!(this.selected instanceof THREE.Mesh) || !this.vertexPoints) return;
    const local = this.selected.worldToLocal(this.vertexProxy.position.clone());
    const position = this.selected.geometry.getAttribute('position');
    const points = this.vertexPoints.geometry.getAttribute('position');
    for (const i of this.vertexIndices) { position.setXYZ(i, local.x, local.y, local.z); points.setXYZ(i, local.x, local.y, local.z); }
    position.needsUpdate = points.needsUpdate = true;
    this.selected.geometry.computeVertexNormals();
    this.selected.geometry.computeBoundingSphere();
    this.selected.geometry.computeBoundingBox();
    this.vertexPoints.geometry.computeBoundingSphere();
  }
  snapshot(): string {
    // Stabilize lazily computed geometry metadata before history and worker comparisons.
    this.content.traverse(o => { if (o instanceof THREE.Mesh && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); });
    const points = this.vertexPoints;
    points?.removeFromParent();
    try { return JSON.stringify({ format: 'forge-studio', version: 1, name: this.name, scene: this.content.toJSON() } satisfies Project); }
    finally { if (points && this.selected) this.selected.add(points); }
  }
  commit() {
    const snapshot = this.snapshot();
    if (snapshot.length * 2 > MAX_HISTORY_BYTES) {
      this.history = [];
      this.historyIndex = -1;
      this.emit('history-limit');
    } else if (snapshot !== this.history[this.historyIndex]) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(snapshot);
      let bytes = this.history.reduce((sum, s) => sum + s.length * 2, 0);
      while (this.history.length > 1 && (this.history.length > 40 || bytes > MAX_HISTORY_BYTES)) bytes -= this.history.shift()!.length * 2;
      this.historyIndex = this.history.length - 1;
    }
    this.updateSelection();
    this.emit();
    this.emit('commit');
    this.invalidate();
  }
  get canUndo() { return this.historyIndex > 0; }
  get canRedo() { return this.historyIndex < this.history.length - 1; }
  undo() { if (this.canUndo) this.restoreHistory(--this.historyIndex); }
  redo() { if (this.canRedo) this.restoreHistory(++this.historyIndex); }
  private restoreHistory(index: number) {
    const id = this.selected?.uuid;
    this.load(JSON.parse(this.history[index]), false);
    this.select(this.content.getObjectByProperty('uuid', id ?? '') ?? this.content.children[0] ?? null);
    this.emit('commit');
  }
  load(project: Project, commit = true) {
    if (project.format !== 'forge-studio' || project.version !== 1 || !project.scene?.object) throw new Error('This is not a supported Forge project.');
    const text = JSON.stringify(project);
    if (text.length > 32 * 1024 * 1024) throw new Error('Project exceeds the 32 MB limit.');
    let storedVertices = 0;
    const geometries = (project.scene as typeof project.scene & { geometries?: { type: string; data?: { attributes?: Record<string, { array?: number[]; itemSize?: number }> } }[] }).geometries ?? [];
    for (const geometry of geometries) {
      if (geometry.type !== 'BufferGeometry') throw new Error('Projects must contain explicit buffer geometry.');
      const positions = geometry.data?.attributes?.position;
      if (!positions?.array || positions.itemSize !== 3 || positions.array.length % 3 !== 0 || positions.array.some(v => !Number.isFinite(v))) throw new Error('Invalid mesh positions.');
      storedVertices += positions.array.length / 3;
    }
    if (storedVertices > 2_000_000) throw new Error('Scene exceeds the 2 million vertex limit.');
    for (const image of (project.scene as typeof project.scene & { images?: { url: unknown }[] }).images ?? []) {
      const urls = Array.isArray(image.url) ? image.url : [image.url];
      if (urls.some((url: unknown) => typeof url === 'string' && !url.startsWith('data:image/'))) throw new Error('External image URLs are not supported. Use embedded assets.');
    }
    const root = new THREE.ObjectLoader().parse(project.scene);
    if (!(root instanceof THREE.Group)) { this.disposeObject(root); throw new Error('Project scene must be a group.'); }
    let vertices = 0;
    root.traverse(o => {
      if (o instanceof THREE.Mesh) vertices += o.geometry.getAttribute('position')?.count ?? 0;
      if (o.userData.keyframes) {
        if (!Array.isArray(o.userData.keyframes) || o.userData.keyframes.some((k: Keyframe) => !Number.isFinite(k.frame) || ![k.position, k.quaternion, k.scale].every((v, i) => Array.isArray(v) && v.length === (i === 1 ? 4 : 3) && v.every(Number.isFinite)))) throw new Error('Invalid animation keyframes.');
      }
    });
    if (vertices > 2_000_000) { this.disposeObject(root); throw new Error('Scene exceeds the 2 million vertex limit.'); }
    this.playing = false;
    this.select(null);
    this.disposeObject(this.content);
    this.content.clear();
    this.content.add(...root.children.slice());
    this.name = typeof project.name === 'string' ? project.name.slice(0, 100) : 'Untitled scene';
    this.select(this.content.children[0] ?? null);
    if (commit) this.commit();
  }
  newProject() { this.playing = false; this.select(null); this.disposeObject(this.content); this.content.clear(); this.name = 'Untitled scene'; this.frame = 1; this.seed(); }
  insertKey() {
    if (!this.selected || this.editMode) return false;
    const keys: Keyframe[] = this.selected.userData.keyframes ?? [];
    const frame = Math.round(this.frame);
    const next = keys.filter(k => k.frame !== frame);
    next.push({ frame, position: this.selected.position.toArray(), quaternion: this.selected.quaternion.toArray(), scale: this.selected.scale.toArray() });
    this.selected.userData.keyframes = next.sort((a, b) => a.frame - b.frame);
    this.commit();
    return true;
  }
  removeKey() {
    if (!this.selected) return;
    this.selected.userData.keyframes = (this.selected.userData.keyframes ?? []).filter((k: Keyframe) => k.frame !== Math.round(this.frame));
    this.commit();
  }
  scrub(frame: number) { this.frame = THREE.MathUtils.clamp(frame, 1, 250); this.evaluateAnimation(); this.emit('frame'); this.emit('transform'); this.invalidate(); }
  togglePlayback() {
    this.setEditMode(false);
    this.playing = !this.playing;
    this.playbackStart = performance.now();
    this.playbackFrame = this.frame;
    this.emit('frame');
    this.invalidate();
  }
  evaluateAnimation() {
    this.content.traverse(o => {
      const keys = o.userData.keyframes as Keyframe[] | undefined;
      if (!keys?.length) return;
      const end = keys.findIndex(k => k.frame >= this.frame);
      const b = keys[end === -1 ? keys.length - 1 : end];
      const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
      const t = a.frame === b.frame ? 0 : THREE.MathUtils.clamp((this.frame - a.frame) / (b.frame - a.frame), 0, 1);
      o.position.fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position), t);
      o.quaternion.fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion), t);
      o.scale.fromArray(a.scale).lerp(new THREE.Vector3().fromArray(b.scale), t);
    });
    this.updateSelection();
  }
  stats() {
    let vertices = 0, triangles = 0;
    this.content.traverse(o => { if (o instanceof THREE.Mesh) { vertices += o.geometry.getAttribute('position')?.count ?? 0; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3; } });
    return { objects: this.content.children.length, vertices, triangles: Math.round(triangles), calls: this.renderer.info.render.calls, frames: this.renderedFrames };
  }
}
