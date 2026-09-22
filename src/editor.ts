import * as THREE from 'three';
import { sampleAnimation, validInterpolation, type AnimationInterpolation } from './animation';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createGrid } from './grid';
import { extrudeTriangle, insetTriangle } from './extrude';
import { buildTopology, type MeshTopology, type ComponentMode } from './topology';
import { proportionalWeights } from './proportional';
import { subdivideEdges } from './subdivide';
import { extrudeRegion } from './extrude-region';
import { modelingJob, type ModelingOperation } from './modeling-worker-client';
import { validateModifierStack, type Modifier, type ModifierStack } from './modifiers';

export type Primitive = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'icosphere';
export type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';
export type Keyframe = { frame: number; position: number[]; quaternion: number[]; scale: number[]; rotation?: number[]; rotationOrder?: EulerOrder };
export type ScalarAnimationChannel = 'position.x' | 'position.y' | 'position.z' | 'scale.x' | 'scale.y' | 'scale.z';
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
  readonly selectedObjects = new Set<THREE.Object3D>();
  modelingBusy = false;
  private cancelJob: (() => void) | null = null;
  private modelingVersion = 0;
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
  componentMode: ComponentMode = 'vertex';
  private selectedFace: number | null = null;
  private selectedComponents = new Set<number>();
  private topology: MeshTopology | null = null;
  private componentEdges: THREE.LineSegments | null = null;
  private componentCenter = new THREE.Vector3();
  private proportionalEnabled = false;
  private proportionalRadius = 2;
  private proportionalConnected = false;
  snapTargetPending = false;
  snapTargetKind: 'vertex' | 'edge' | 'surface' = 'vertex';
  private componentDrag: { positions: number[]; weights: Float32Array; center: THREE.Vector3 } | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private pending = false;
  private playbackStart = 0;
  private playbackFrame = 1;
  private raycaster = new THREE.Raycaster();
  private mouseDown = new THREE.Vector2();
  private suppressClick = false;
  private rotationDragObject: THREE.Object3D | null = null;
  private rotationDragReference = new THREE.Vector3();
  private rotationDragMatrix = new THREE.Matrix4();
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
      if (e.value) {
        this.suppressClick = true;
        this.beginComponentDrag();
        this.beginRotationDrag();
      } else {
        this.componentDrag = null;
        this.rotationDragObject = null;
        this.commit();
      }
    });
    this.transform.addEventListener('objectChange', () => {
      this.unwrapRotationDrag();
      if (this.editMode) this.updateVertex();
      this.updateSelection();
      this.emit('transform');
      this.invalidate();
    });
    this.transform.addEventListener('change', () => this.invalidate());
    // Shift selection must also work where a selected component meets the gizmo.
    let selectionPointer: number | null = null;
    this.renderer.domElement.addEventListener('pointerdown', e => {
      if ((e.shiftKey || (this.editMode && this.snapTargetPending)) && e.button === 0 && !this.transform.dragging) {
        selectionPointer = e.pointerId;
        this.transform.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
      }
    }, true);
    const restoreTransform = (e: PointerEvent) => {
      if (e.pointerId === selectionPointer) { selectionPointer = null; this.transform.enabled = true; }
    };
    this.renderer.domElement.addEventListener('pointerdown', e => {
      this.mouseDown.set(e.clientX, e.clientY);
      this.suppressClick = this.transform.dragging;
    });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (e.button !== 0 || this.suppressClick || this.mouseDown.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return;
      const rect = host.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      if (this.editMode) {
        if (this.snapTargetPending) {
          const threshold = this.camera.position.distanceTo(this.orbit.target) * 0.012;
          try {
            if (this.snapTargetKind === 'surface' && this.selected instanceof THREE.Mesh && this.topology) {
              this.selected.updateWorldMatrix(true, false);
              const hit = this.raycaster.intersectObject(this.selected, false)[0];
              if (hit?.faceIndex !== undefined && hit.faceIndex !== null) {
                const attribute = this.selected.geometry.getAttribute('position');
                const points = this.topology.faces[hit.faceIndex].map(v => this.selected!.localToWorld(new THREE.Vector3().fromBufferAttribute(attribute, this.topology!.vertices[v][0])));
                const weights = THREE.Triangle.getBarycoord(hit.point, points[0], points[1], points[2], new THREE.Vector3());
                if (!weights) throw new Error('Cannot snap to a collapsed surface.');
                this.snapSelectionToSurface(hit.faceIndex, weights.toArray());
              }
            } else if (this.snapTargetKind === 'edge' && this.componentEdges) {
              this.raycaster.params.Line.threshold = threshold;
              const hit = this.raycaster.intersectObject(this.componentEdges, false)[0];
              if (hit?.index !== undefined) this.snapSelectionToEdge(Math.floor(hit.index / 2));
            } else {
              this.raycaster.params.Points.threshold = threshold;
              const hit = this.vertexPoints && this.raycaster.intersectObject(this.vertexPoints, false)[0];
              if (hit && hit.index !== undefined && this.topology && !this.vertexIndices.includes(hit.index)) {
                this.snapSelectionToVertex(this.topology.bufferToVertex[hit.index]);
              }
            }
          } catch (error) { this.dispatchEvent(new CustomEvent('snap-error', { detail: (error as Error).message })); }
        } else this.pickVertex(e.shiftKey);
        return;
      }
      const special = this.pickOverride?.(this.raycaster);
      if (special) { this.select(special); this.setTool('rotate'); return; }
      const hit = this.raycaster.intersectObjects(this.content.children, true).find(h => this.isVisible(h.object));
      let object = hit?.object ?? null;
      while (object && object.parent && object.parent !== this.content && !this.isCollection(object.parent)) object = object.parent;
      this.select(object, e.shiftKey);
    });
    this.renderer.domElement.addEventListener('pointerup', restoreTransform);
    this.renderer.domElement.addEventListener('pointercancel', restoreTransform);
    this.renderer.domElement.addEventListener('lostpointercapture', restoreTransform);
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  private beginRotationDrag() {
    const object = !this.editMode && this.transform.mode === 'rotate' && this.transform.object === this.selected ? this.selected : null;
    this.rotationDragObject = object;
    if (object) this.rotationDragReference.set(object.rotation.x, object.rotation.y, object.rotation.z);
  }
  private unwrapRotationDrag() {
    const object = this.rotationDragObject;
    if (!object || this.transform.object !== object) return;
    const turn = Math.PI * 2;
    const reference = this.rotationDragReference;
    const unwrap = (value: number, target: number) => value + Math.round((target - value) / turn) * turn;
    const nearest = (candidate: THREE.Vector3) => new THREE.Vector3(
      unwrap(candidate.x, reference.x),
      unwrap(candidate.y, reference.y),
      unwrap(candidate.z, reference.z),
    );

    const primary = new THREE.Vector3(object.rotation.x, object.rotation.y, object.rotation.z);
    const order = object.rotation.order;

    // Three.js XYZ decomposition has its singular branch on the middle Y axis.
    // At |Y| = 90° the quaternion fixes only X+Z (positive Y) or X-Z
    // (negative Y), leaving infinitely many equivalent Euler triples. Preserve
    // continuity by choosing the singular solution nearest the previous drag
    // value instead of accepting the canonical z=0 decomposition.
    if (order === 'XYZ' && Math.abs(Math.cos(primary.y)) < 1e-3) {
      this.rotationDragMatrix.makeRotationFromQuaternion(object.quaternion);
      const elements = this.rotationDragMatrix.elements;
      const theta = Math.atan2(elements[6], elements[5]);
      const positive = Math.sin(primary.y) >= 0;
      const referenceCombination = positive ? reference.x + reference.z : reference.x - reference.z;
      const compatibleCombination = unwrap(theta, referenceCombination);
      const delta = compatibleCombination - referenceCombination;
      const x = reference.x + delta / 2;
      const z = reference.z + (positive ? delta / 2 : -delta / 2);
      const y = unwrap(primary.y, reference.y);
      object.rotation.set(x, y, z, order);
      reference.set(x, y, z);
      return;
    }

    const alternate = primary.clone();
    const first = order[0].toLowerCase() as 'x' | 'y' | 'z';
    const middle = order[1].toLowerCase() as 'x' | 'y' | 'z';
    const last = order[2].toLowerCase() as 'x' | 'y' | 'z';
    alternate[first] += Math.PI;
    alternate[middle] = Math.PI - alternate[middle];
    alternate[last] += Math.PI;

    const candidates = [nearest(primary), nearest(alternate)];
    const best = candidates.reduce((a, b) =>
      a.distanceToSquared(reference) <= b.distanceToSquared(reference) ? a : b
    );
    object.rotation.set(best.x, best.y, best.z, order);
    reference.copy(best);
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
  get collections(): THREE.Group[] {
    return this.content.children.filter((object): object is THREE.Group => object instanceof THREE.Group && object.userData.forgeCollection === true);
  }
  private isCollection(object: THREE.Object3D | null): object is THREE.Group {
    return object instanceof THREE.Group && object.userData.forgeCollection === true && object.parent === this.content;
  }
  private isSceneMember(object: THREE.Object3D): boolean {
    return object.parent === this.content || this.isCollection(object.parent);
  }
  uniqueCollectionName(base = 'Collection') {
    const names = new Set(this.collections.map(collection => collection.name));
    if (!names.has(base)) return base;
    let i = 1;
    while (names.has(`${base}.${String(i).padStart(3, '0')}`)) i++;
    return `${base}.${String(i).padStart(3, '0')}`;
  }
  createCollection(name = 'Collection') {
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) throw new Error('Collection name cannot be empty.');
    const collection = new THREE.Group();
    collection.name = this.uniqueCollectionName(trimmed);
    collection.userData.forgeCollection = true;
    this.content.add(collection);
    this.commit();
    return collection;
  }
  moveSelectedToCollection(collection: THREE.Object3D) {
    if (this.editMode || this.playing || this.modelingBusy || !this.selectedObjects.size) throw new Error('Select objects in Object Mode first.');
    if (!this.isCollection(collection)) throw new Error('Choose a scene collection.');
    const objects = [...this.selectedObjects];
    if (objects.some(object => !this.isSceneMember(object) || object instanceof THREE.Bone || this.isCollection(object))) throw new Error('Only scene objects can be moved into a collection.');
    objects.forEach(object => collection.add(object));
    this.commit();
  }
  unlinkSelectedFromCollection() {
    if (this.editMode || this.playing || this.modelingBusy || !this.selectedObjects.size) throw new Error('Select objects in Object Mode first.');
    const objects = [...this.selectedObjects];
    if (objects.some(object => !this.isCollection(object.parent))) throw new Error('Select objects inside a collection first.');
    objects.forEach(object => this.content.add(object));
    this.commit();
  }
  deleteCollection(collection: THREE.Object3D) {
    if (!this.isCollection(collection)) throw new Error('Choose a scene collection.');
    if (collection.children.length) throw new Error('Only empty collections can be deleted.');
    collection.removeFromParent();
    this.commit();
  }
  uniqueName(base: string) {
    const names = new Set<string>();
    this.content.traverse(object => names.add(object.name));
    if (!names.has(base)) return base;
    let i = 1;
    while (names.has(`${base}.${String(i).padStart(3, '0')}`)) i++;
    return `${base}.${String(i).padStart(3, '0')}`;
  }
  select(object: THREE.Object3D | null, toggle = false) {
    if (toggle && !object) return;
    this.modelingVersion++;
    if (!toggle) this.selectedObjects.clear();
    if (object) {
      if (toggle && this.selectedObjects.has(object)) { this.selectedObjects.delete(object); object = [...this.selectedObjects].at(-1) ?? null; }
      else this.selectedObjects.add(object);
    }
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
    const parent = this.isCollection(this.selected.parent) ? this.selected.parent : this.content;
    parent.add(copy);
    this.select(copy);
    this.commit();
  }
  duplicateLinked() {
    if (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.selected.userData.modifierStack) return false;
    this.setEditMode(false);
    const source = this.selected;
    const copy = source.clone(false) as THREE.Mesh;
    copy.geometry = source.geometry;
    copy.material = source.material;
    copy.name = this.uniqueName(source.name);
    copy.position.x += 2.5;
    const parent = this.isCollection(source.parent) ? source.parent : this.content;
    parent.add(copy);
    this.select(copy);
    this.commit();
    return true;
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
  private paintMaterial(): THREE.MeshStandardMaterial {
    if (!(this.selected instanceof THREE.Mesh) || !this.selected.geometry.getAttribute('uv')) throw new Error('Select a mesh with UV coordinates first.');
    const materials = Array.isArray(this.selected.material) ? this.selected.material : [this.selected.material];
    const current = materials[0];
    if (!(current instanceof THREE.MeshStandardMaterial)) throw new Error('Select a mesh with a standard material first.');
    let users = 0;
    this.content.traverse(object => {
      if (object instanceof THREE.Mesh && (Array.isArray(object.material) ? object.material : [object.material]).includes(current)) users++;
    });
    if (users > 1) {
      const copy = current.clone();
      if (Array.isArray(this.selected.material)) this.selected.material[0] = copy;
      else this.selected.material = copy;
      return copy;
    }
    return current;
  }
  get texturePaintCanvas(): HTMLCanvasElement | null {
    const material = this.material;
    return material?.map?.image instanceof HTMLCanvasElement ? material.map.image : null;
  }
  get texturePaintImage(): HTMLImageElement | null {
    const image = this.material?.map?.image;
    return image instanceof HTMLImageElement ? image : null;
  }
  private installTextureCanvas(material: THREE.MeshStandardMaterial, canvas: HTMLCanvasElement, baseColor: string) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.color.set(0xffffff);
    material.userData.forgePaintBaseColor = baseColor;
    material.needsUpdate = true;
  }
  ensureTexturePaint() {
    const material = this.paintMaterial();
    if (material.map?.image instanceof HTMLCanvasElement && material.map.image.width === 256 && material.map.image.height === 256) return material.map.image;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Texture painting is unavailable in this browser.');
    const baseColor = typeof material.userData.forgePaintBaseColor === 'string' ? material.userData.forgePaintBaseColor : `#${material.color.getHexString()}`;
    context.fillStyle = baseColor; context.fillRect(0, 0, canvas.width, canvas.height);
    const source = material.map?.image;
    if (source && !(source instanceof HTMLCanvasElement)) {
      try { context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height); } catch { /* Keep the base-color canvas when an image is not ready. */ }
    }
    this.installTextureCanvas(material, canvas, baseColor);
    this.commit();
    return canvas;
  }
  async importTexture(file: File) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Texture exceeds the 8 MB limit.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG or WebP texture.');
    const dataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Texture could not be read.'));
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Texture could not be read.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onerror = () => reject(new Error('Texture could not be decoded.'));
      element.onload = () => resolve(element);
      element.src = dataURL;
    });
    const material = this.paintMaterial();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Texture management is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const baseColor = typeof material.userData.forgePaintBaseColor === 'string' ? material.userData.forgePaintBaseColor : `#${material.color.getHexString()}`;
    this.installTextureCanvas(material, canvas, baseColor);
    material.userData.forgePaintSourceName = file.name.slice(0, 100);
    this.commit();
  }
  paintTextureAt(x: number, y: number, color: string, radius: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0 || radius > 128 || !/^#[\da-f]{6}$/i.test(color)) throw new Error('Enter a valid paint color and brush size.');
    const material = this.paintMaterial();
    const canvas = this.ensureTexturePaint();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Texture painting is unavailable in this browser.');
    context.fillStyle = color;
    context.beginPath();
    context.arc(THREE.MathUtils.clamp(x, 0, 1) * canvas.width, THREE.MathUtils.clamp(y, 0, 1) * canvas.height, radius, 0, Math.PI * 2);
    context.fill();
    if (material.map) material.map.needsUpdate = true;
    material.needsUpdate = true;
    this.invalidate();
  }
  clearTexturePaint() {
    const material = this.paintMaterial();
    const canvas = this.ensureTexturePaint();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Texture painting is unavailable in this browser.');
    context.fillStyle = typeof material.userData.forgePaintBaseColor === 'string' ? material.userData.forgePaintBaseColor : '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (material.map) material.map.needsUpdate = true;
    material.needsUpdate = true;
    this.commit();
  }
  finishTexturePaint() { this.commit(); }
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
    if (this.selected.userData.modifierStack) return false;
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
  async enterEditMode(enabled: boolean) {
    if (!enabled || !(this.selected instanceof THREE.Mesh) || this.selected.geometry.getAttribute('position').count < 10_000) return this.setEditMode(enabled);
    if (this.modelingBusy || this.selected instanceof THREE.SkinnedMesh || this.selected.userData.modifierStack || this.playing) return false;
    const mesh = this.selected, before = this.snapshot(), version = this.modelingVersion;
    this.modelingBusy = true; this.emit('modeling');
    try {
      const job = modelingJob(mesh.geometry, { kind: 'topology' }); this.cancelJob = job.cancel;
      const result = await job.promise;
      if (this.selected !== mesh || this.snapshot() !== before || this.modelingVersion !== version) throw new Error('Scene changed; discarded topology result.');
      return this.setEditMode(true, result.topology);
    } finally { this.cancelJob = null; this.modelingBusy = false; this.emit('modeling'); }
  }
  setEditMode(enabled: boolean, preparedTopology?: MeshTopology) {
    this.modelingVersion++;
    this.cancelVertexSnap();
    if (enabled && (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing || this.selected.userData.modifierStack)) return false;
    this.editMode = enabled;
    this.selectedComponents.clear();
    this.componentDrag = null;
    this.vertexIndices = [];
    this.selectedFace = null;
    this.transform.detach();
    if (this.vertexPoints) {
      this.vertexPoints.removeFromParent();
      this.componentEdges?.geometry.dispose();
      if (this.componentEdges) (this.componentEdges.material as THREE.Material).dispose();
      this.componentEdges = null;
      this.topology = null;
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
      const position = this.selected.geometry.getAttribute('position');
      this.topology = preparedTopology ?? buildTopology(position.array, this.selected.geometry.index?.array);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(position.count * 3).fill(1), 3));
      (this.vertexPoints.material as THREE.PointsMaterial).vertexColors = true;
      this.componentEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe4b578, transparent: true, opacity: 0.65, depthTest: false }));
      this.componentEdges.renderOrder = 9;
      this.vertexPoints.add(this.componentEdges);
      this.refreshComponents();
    } else if (this.selected?.visible) this.transform.attach(this.selected);
    this.updateSelection();
    this.emit('mode');
    this.invalidate();
    return true;
  }
  setComponentMode(mode: ComponentMode) {
    this.modelingVersion++;
    this.cancelVertexSnap();
    this.componentDrag = null;
    this.componentMode = mode;
    this.selectedComponents.clear();
    this.vertexIndices = [];
    this.selectedFace = null;
    if (this.editMode) this.transform.detach();
    this.refreshComponents();
    this.emit('mode');
    this.invalidate();
  }
  private refreshComponents() {
    if (!this.vertexPoints || !this.componentEdges || !this.topology || !(this.selected instanceof THREE.Mesh)) return;
    const position = this.selected.geometry.getAttribute('position');
    let edges = this.componentEdges.geometry.getAttribute('position');
    if (!edges || edges.count !== this.topology.edges.length * 2) {
      edges = new THREE.Float32BufferAttribute(new Float32Array(this.topology.edges.length * 6), 3);
      this.componentEdges.geometry.setAttribute('position', edges);
    }
    let cursor = 0;
    for (const edge of this.topology.edges) for (const vertex of edge) {
      const i = this.topology.vertices[vertex][0];
      edges.setXYZ(cursor++, position.getX(i), position.getY(i), position.getZ(i));
    }
    edges.needsUpdate = true;
    this.componentEdges.geometry.computeBoundingSphere();
    this.componentEdges.visible = this.componentMode !== 'vertex' || (this.snapTargetPending && this.snapTargetKind === 'edge');
    const colors = this.vertexPoints.geometry.getAttribute('color');
    const selected = new Set(this.vertexIndices);
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, 1, selected.has(i) ? 0.3 : 1, selected.has(i) ? 0.05 : 1);
    colors.needsUpdate = true;
  }
  private pickVertex(toggle = false) {
    if (!this.vertexPoints || !this.topology || !(this.selected instanceof THREE.Mesh)) return;
    let component: number | undefined;
    const threshold = this.camera.position.distanceTo(this.orbit.target) * 0.012;
    if (this.componentMode === 'vertex') {
      this.raycaster.params.Points.threshold = threshold;
      const hit = this.raycaster.intersectObject(this.vertexPoints, false)[0];
      if (hit?.index !== undefined) component = this.topology.bufferToVertex[hit.index];
    } else if (this.componentMode === 'edge' && this.componentEdges) {
      this.raycaster.params.Line.threshold = threshold;
      const hit = this.raycaster.intersectObject(this.componentEdges, false)[0];
      if (hit?.index !== undefined) component = Math.floor(hit.index / 2);
    } else {
      const hit = this.raycaster.intersectObject(this.selected, false)[0];
      if (hit?.faceIndex !== undefined && hit.faceIndex !== null) component = hit.faceIndex;
    }
    this.selectComponent(component, toggle);
  }
  private selectComponent(component: number | undefined, toggle = false) {
    this.modelingVersion++;
    if (!this.topology) return;
    if (!toggle) this.selectedComponents.clear();
    if (component !== undefined) {
      if (toggle && this.selectedComponents.has(component)) this.selectedComponents.delete(component);
      else this.selectedComponents.add(component);
    }
    this.selectedFace = this.componentMode === 'face' && this.selectedComponents.size === 1 ? [...this.selectedComponents][0] : null;
    const vertices = [...this.selectedComponents].flatMap(id => this.componentMode === 'vertex' ? [id] : this.componentMode === 'edge' ? this.topology!.edges[id] : this.topology!.faces[id]);
    this.selectComponentVertices(vertices);
    this.emit('component-selection');
  }
  private selectComponentVertices(vertices?: number[]) {
    this.componentDrag = null;
    this.vertexIndices = [];
    this.transform.detach();
    if (!(this.selected instanceof THREE.Mesh) || !this.topology) return;
    if (vertices?.length) {
      const positions = this.selected.geometry.getAttribute('position');
      this.componentCenter.set(0, 0, 0);
      const unique = [...new Set(vertices)];
      for (const vertex of unique) {
        this.vertexIndices.push(...this.topology.vertices[vertex]);
        this.componentCenter.add(new THREE.Vector3().fromBufferAttribute(positions, this.topology.vertices[vertex][0]));
      }
      this.componentCenter.divideScalar(unique.length);
      this.vertexProxy.position.copy(this.selected.localToWorld(this.componentCenter.clone()));
      this.transform.setMode('translate');
      this.transform.attach(this.vertexProxy);
    }
    this.refreshComponents();
    this.invalidate();
  }
  extrudeFace(distance: number, inset = false) {
    if (!this.editMode || this.componentMode !== 'face' || this.selectedFace === null || !(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing) throw new Error('Select exactly one triangle face in Edit Mode first.');
    const mesh = this.selected, face = this.selectedFace;
    if (this.stats().vertices + 15 > 2_000_000) throw new Error('Triangle editing would exceed the scene vertex limit.');
    const original = mesh.geometry;
    const geometry = inset ? insetTriangle(original, face, distance) : extrudeTriangle(original, face, distance);
    this.setEditMode(false);
    mesh.geometry = geometry;
    let retained = false;
    this.content.traverse(object => { if (object instanceof THREE.Mesh && object.geometry === original) retained = true; });
    if (!retained) original.dispose();
    this.setEditMode(true);
    this.selectComponent(face);
    this.commit();
  }
  extrudePlanarRegion(distance: number) {
    if (!this.editMode || this.componentMode !== 'face' || !this.selectedComponents.size || !(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing || this.transform.dragging) throw new Error('Select connected coplanar triangle faces in Edit Mode and finish the current drag first.');
    const faces = [...this.selectedComponents], mesh = this.selected, original = mesh.geometry;
    const geometry = extrudeRegion(original, faces, distance);
    if (this.stats().vertices + geometry.getAttribute('position').count - original.getAttribute('position').count > 2_000_000) {
      geometry.dispose(); throw new Error('Region extrusion would exceed the scene vertex limit.');
    }
    this.setEditMode(false);
    mesh.geometry = geometry;
    let retained = false;
    this.content.traverse(object => { if (object instanceof THREE.Mesh && object.geometry === original) retained = true; });
    if (!retained) original.dispose();
    this.setEditMode(true);
    this.selectedComponents = new Set(faces);
    this.selectedFace = faces.length === 1 ? faces[0] : null;
    this.selectComponentVertices(faces.flatMap(face => this.topology!.faces[face]));
    this.commit();
  }
  subdivideSelectedEdge() {
    if (!this.editMode || this.componentMode !== 'edge' || !this.selectedComponents.size || !this.topology || !(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing || this.transform.dragging) throw new Error('Select one or more edges in Edit Mode and finish the current drag first.');
    const endpoints = [...this.selectedComponents].map(id => this.topology!.edges[id].map(v => this.topology!.vertices[v][0]) as [number, number]);
    const mesh = this.selected, original = mesh.geometry, midpointIndex = original.getAttribute('position').count;
    const geometry = subdivideEdges(original, endpoints);
    if (this.stats().vertices + geometry.getAttribute('position').count - midpointIndex > 2_000_000) {
      geometry.dispose();
      throw new Error('Subdivision would exceed the scene vertex limit.');
    }
    this.setEditMode(false);
    mesh.geometry = geometry;
    let retained = false;
    this.content.traverse(object => { if (object instanceof THREE.Mesh && object.geometry === original) retained = true; });
    if (!retained) original.dispose();
    this.setEditMode(true);
    this.setComponentMode('vertex');
    const midpoints = [...new Set(this.topology!.bufferToVertex.slice(midpointIndex))];
    this.selectedComponents = new Set(midpoints);
    this.selectComponentVertices(midpoints);
    this.commit();
  }
  cancelVertexSnap() {
    if (!this.snapTargetPending) return;
    this.snapTargetPending = false;
    this.refreshComponents();
    this.invalidate();
    this.emit('snap-target');
  }
  beginVertexSnap(kind: 'vertex' | 'edge' | 'surface' = 'vertex') {
    if (!this.editMode || !this.vertexIndices.length || this.playing || this.transform.dragging) throw new Error('Select mesh components in Edit Mode and finish the current drag first.');
    this.snapTargetKind = kind;
    this.snapTargetPending = true;
    this.refreshComponents();
    this.invalidate();
    this.emit('snap-target');
  }
  snapSelectionToVertex(vertex: number) {
    if (!this.editMode || !this.topology || !(this.selected instanceof THREE.Mesh) || !this.vertexIndices.length || this.playing || this.transform.dragging) throw new Error('Select mesh components in Edit Mode and finish the current drag first.');
    if (!Number.isInteger(vertex) || !this.topology.vertices[vertex]) throw new Error('Invalid snap target vertex.');
    const targetIndex = this.topology.vertices[vertex][0];
    if (this.vertexIndices.includes(targetIndex)) throw new Error('Choose an unselected target vertex.');
    const attribute = this.selected.geometry.getAttribute('position');
    const target = new THREE.Vector3().fromBufferAttribute(attribute, targetIndex);
    this.snapSelectionToPoint(target);
  }
  snapSelectionToEdge(edge: number) {
    if (!this.editMode || !this.topology || !(this.selected instanceof THREE.Mesh) || !this.vertexIndices.length || this.playing || this.transform.dragging) throw new Error('Select mesh components in Edit Mode and finish the current drag first.');
    if (!Number.isInteger(edge) || !this.topology.edges[edge]) throw new Error('Invalid snap target edge.');
    const indices = this.topology.edges[edge].map(vertex => this.topology!.vertices[vertex][0]);
    if (indices.some(index => this.vertexIndices.includes(index))) throw new Error('Choose an edge with both endpoints unselected.');
    const attribute = this.selected.geometry.getAttribute('position');
    const target = new THREE.Vector3().fromBufferAttribute(attribute, indices[0])
      .lerp(new THREE.Vector3().fromBufferAttribute(attribute, indices[1]), 0.5);
    this.snapSelectionToPoint(target);
  }
  private snapSelectionToPoint(target: THREE.Vector3) {
    if (!(this.selected instanceof THREE.Mesh)) return;
    const attribute = this.selected.geometry.getAttribute('position');
    const delta = target.clone().sub(this.componentCenter);
    if (![delta.x, delta.y, delta.z].every(Number.isFinite)) throw new Error('Invalid snap coordinates.');
    const positions = Array.from({ length: attribute.count }, (_, i) => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]).flat();
    const weights = new Float32Array(attribute.count);
    for (const i of this.vertexIndices) {
      if (![positions[i * 3] + delta.x, positions[i * 3 + 1] + delta.y, positions[i * 3 + 2] + delta.z].every(v => Number.isFinite(Math.fround(v)))) throw new Error('Snap would exceed mesh coordinate precision.');
      weights[i] = 1;
    }
    this.componentDrag = { positions, weights, center: this.componentCenter.clone() };
    this.vertexProxy.position.copy(this.selected.localToWorld(target.clone()));
    this.updateVertex(target);
    this.componentDrag = null;
    this.cancelVertexSnap();
    this.commit();
    this.emit('snap-complete');
  }
  snapSelectionToSurface(face: number, weights: number[]) {
    if (!this.editMode || !this.topology || !(this.selected instanceof THREE.Mesh) || !this.vertexIndices.length || this.playing || this.transform.dragging) throw new Error('Select mesh components in Edit Mode first.');
    if (!Number.isInteger(face) || !this.topology.faces[face] || weights.length !== 3 || weights.some(w => !Number.isFinite(w) || w < -1e-7 || w > 1 + 1e-7) || Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error('Invalid surface target.');
    const indices = this.topology.faces[face].map(v => this.topology!.vertices[v][0]);
    if (indices.some(i => this.vertexIndices.includes(i))) throw new Error('Choose a triangle with all three vertices unselected.');
    const target = new THREE.Vector3(), attribute = this.selected.geometry.getAttribute('position');
    const clamped = weights.map(w => Math.max(0, Math.min(1, w))), sum = clamped.reduce((a, b) => a + b, 0);
    indices.forEach((i, j) => target.addScaledVector(new THREE.Vector3().fromBufferAttribute(attribute, i), clamped[j] / sum));
    this.snapSelectionToPoint(target);
  }

  get componentSelection() { return [...this.selectedComponents]; }
  get meshTopology() { return this.topology; }
  cancelModeling() { this.cancelJob?.(); }
  private replaceGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry) {
    const old = mesh.geometry; mesh.geometry = geometry;
    let retained = false;
    this.content.traverse(o => { if (o instanceof THREE.Mesh && o.geometry === old) retained = true; });
    if (!retained) old.dispose();
  }
  async runModeling(operation: ModelingOperation, batch = false) {
    if (this.modelingBusy || this.playing || this.transform.dragging) throw new Error('Finish the current operation first.');
    const targets = batch ? [...this.selectedObjects] : [this.selected];
    if (!targets.length || targets.some(o => !(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || o.userData.modifierStack)) throw new Error('Select ordinary meshes without unapplied modifiers.');
    const meshes = targets as THREE.Mesh[], before = this.snapshot(), active = this.selected, editing = this.editMode, version = this.modelingVersion;
    const results: THREE.BufferGeometry[] = [], topologies: (MeshTopology | undefined)[] = [];
    this.modelingBusy = true; this.emit('modeling');
    try {
      for (const mesh of meshes) {
        let op = operation;
        if (batch && operation.kind === 'subdivide') {
          op = { kind: 'subdivide-all' };
        }
        const job = modelingJob(mesh.geometry, op); this.cancelJob = job.cancel;
        const result = await job.promise;
        if (!result.geometry) throw new Error('No geometry result.');
        results.push(new THREE.BufferGeometryLoader().parse(result.geometry));
        topologies.push(result.topology);
      }
      if (this.snapshot() !== before || this.modelingVersion !== version || this.selected !== active || this.editMode !== editing || (batch && (meshes.length !== this.selectedObjects.size || meshes.some(m => !this.selectedObjects.has(m))))) throw new Error('Scene or selection changed; discarded the modeling result.');
      const total = this.stats().vertices + results.reduce((sum, g, i) => sum + g.getAttribute('position').count - meshes[i].geometry.getAttribute('position').count, 0);
      if (total > 2_000_000) throw new Error('Modeling exceeds the scene vertex budget.');
      const oldMode = this.componentMode, oldSelection = this.componentSelection;
      const midpoint = meshes[0].geometry.getAttribute('position').count;
      this.setEditMode(false);
      meshes.forEach((mesh, i) => this.replaceGeometry(mesh, results[i])); results.length = 0;
      if (editing) {
        this.setEditMode(true, topologies[0]);
        if (operation.kind === 'subdivide') {
          this.setComponentMode('vertex');
          const ids = [...new Set(this.topology!.bufferToVertex.slice(midpoint))]; this.selectedComponents = new Set(ids); this.selectComponentVertices(ids);
        } else if (['uv', 'inset', 'extrude', 'region'].includes(operation.kind)) {
          this.setComponentMode(oldMode); this.selectedComponents = new Set(oldSelection);
          this.selectedFace = oldSelection.length === 1 ? oldSelection[0] : null;
          this.selectComponentVertices(oldSelection.flatMap(f => this.topology!.faces[f]));
        }
      }
      this.commit();
    } finally { results.forEach(g => g.dispose()); this.cancelJob = null; this.modelingBusy = false; this.emit('modeling'); }
  }

  async setModifiers(items: Modifier[]) {
    if (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.modelingBusy || this.playing || this.transform.dragging) throw new Error('Select a mesh and finish the current operation.');
    const mesh = this.selected, before = this.snapshot(), version = this.modelingVersion, stored = mesh.userData.modifierStack as ModifierStack | undefined;
    const source = stored ? new THREE.BufferGeometryLoader().parse(stored.source) : mesh.geometry.clone();
    const sourceJSON = source.toJSON();
    this.modelingBusy = true; this.emit('modeling');
    try {
      const job = modelingJob(source, { kind: 'modifiers', items }); this.cancelJob = job.cancel;
      const response = await job.promise;
      if (this.selected !== mesh || this.snapshot() !== before || this.modelingVersion !== version) throw new Error('Scene changed; discarded modifier result.');
      const geometry = new THREE.BufferGeometryLoader().parse(response.geometry!);
      if (this.stats().vertices - mesh.geometry.getAttribute('position').count + geometry.getAttribute('position').count > 2_000_000) { geometry.dispose(); throw new Error('Modifier exceeds the scene vertex budget.'); }
      this.setEditMode(false); this.replaceGeometry(mesh, geometry);
      if (items.length) mesh.userData.modifierStack = { source: sourceJSON, items: structuredClone(items) } satisfies ModifierStack;
      else delete mesh.userData.modifierStack;
      this.commit();
    } finally { source.dispose(); this.cancelJob = null; this.modelingBusy = false; this.emit('modeling'); }
  }
  applyModifiers() {
    if (!(this.selected instanceof THREE.Mesh) || this.modelingBusy || this.playing || this.transform.dragging) throw new Error('Finish the current operation first.');
    delete this.selected.userData.modifierStack; this.commit();
  }

  transformObjects(kind: 'translate' | 'rotate' | 'scale', values: number[]) {
    if (this.editMode || this.playing || this.transform.dragging || this.modelingBusy || !this.selectedObjects.size) throw new Error('Select objects in Object Mode first.');
    if (values.length !== 3 || values.some(v => !Number.isFinite(v) || Math.abs(v) > 10000) || (kind === 'scale' && values.some(v => Math.abs(v) < 0.001))) throw new Error('Invalid object transform.');
    const objects = [...this.selectedObjects];
    if (objects.some(o => !this.isSceneMember(o) || o instanceof THREE.Bone || this.isCollection(o))) throw new Error('Group transforms require scene objects.');
    const center = objects.reduce((sum, o) => sum.add(o.position), new THREE.Vector3()).divideScalar(objects.length);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...values.map(v => v * Math.PI / 180) as [number, number, number]));
    // Uniform group scale is representable without introducing shear on rotated objects.
    if (kind === 'scale' && (values[0] !== values[1] || values[1] !== values[2])) throw new Error('Group scale must be uniform on all three axes.');
    const prepared = objects.map(o => {
      const position = o.position.clone(), quaternion = o.quaternion.clone(), scale = o.scale.clone();
      if (kind === 'translate') position.add(new THREE.Vector3().fromArray(values));
      if (kind === 'rotate') { position.sub(center).applyQuaternion(rotation).add(center); quaternion.premultiply(rotation); }
      if (kind === 'scale') { position.sub(center).multiplyScalar(values[0]).add(center); scale.multiplyScalar(values[0]); }
      if ([...position.toArray(), ...scale.toArray()].some(v => !Number.isFinite(v) || Math.abs(v) > 10000)) throw new Error('Group transform exceeds coordinate limits.');
      return { o, position, quaternion, scale };
    });
    prepared.forEach(({ o, position, quaternion, scale }) => { o.position.copy(position); o.quaternion.copy(quaternion); o.scale.copy(scale); }); this.commit();
  }
  setProportionalEditing(enabled: boolean, radius: number, connected = false) {
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Proportional radius must be a finite positive number.');
    if (this.transform.dragging) throw new Error('Finish the current drag before changing proportional editing.');
    this.proportionalEnabled = enabled;
    this.proportionalRadius = radius;
    this.proportionalConnected = connected;
    this.componentDrag = null;
  }
  private beginComponentDrag() {
    this.componentDrag = null;
    if (!this.editMode || !(this.selected instanceof THREE.Mesh) || !this.topology || !this.vertexIndices.length) return;
    const attribute = this.selected.geometry.getAttribute('position');
    const positions = Array.from({ length: attribute.count }, (_, i) => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]).flat();
    const weights = this.proportionalEnabled ? proportionalWeights(positions, this.topology, this.vertexIndices, this.proportionalRadius, this.proportionalConnected) : new Float32Array(attribute.count);
    if (!this.proportionalEnabled) for (const i of this.vertexIndices) weights[i] = 1;
    this.componentDrag = { positions, weights, center: this.componentCenter.clone() };
  }
  private updateVertex(target?: THREE.Vector3) {
    if (!(this.selected instanceof THREE.Mesh) || !this.vertexPoints) return;
    if (!this.componentDrag) this.beginComponentDrag();
    if (!this.componentDrag) return;
    const { positions, weights, center } = this.componentDrag;
    const local = target ?? this.selected.worldToLocal(this.vertexProxy.position.clone());
    const delta = local.clone().sub(center);
    const position = this.selected.geometry.getAttribute('position');
    const points = this.vertexPoints.geometry.getAttribute('position');
    for (let i = 0; i < weights.length; i++) {
      if (!weights[i]) continue;
      const x = positions[i * 3] + delta.x * weights[i], y = positions[i * 3 + 1] + delta.y * weights[i], z = positions[i * 3 + 2] + delta.z * weights[i];
      position.setXYZ(i, x, y, z);
      points.setXYZ(i, x, y, z);
    }
    this.componentCenter.copy(local);
    position.needsUpdate = points.needsUpdate = true;
    this.selected.geometry.computeVertexNormals();
    this.selected.geometry.computeBoundingSphere();
    this.selected.geometry.computeBoundingBox();
    this.vertexPoints.geometry.computeBoundingSphere();
    this.refreshComponents();
  }
  snapshot(): string {
    this.content.updateMatrixWorld(true);
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
    try { root.traverse(o => {
      if (o instanceof THREE.Mesh) vertices += o.geometry.getAttribute('position')?.count ?? 0;
      if (o.userData.modifierStack !== undefined) {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) throw new Error('Only ordinary meshes support modifiers.');
        validateModifierStack(o.userData.modifierStack);
      }
      if (o.userData.animationInterpolation !== undefined && !validInterpolation(o.userData.animationInterpolation)) throw new Error('Invalid animation interpolation.');
      if (o.userData.keyframes) {
        if (!Array.isArray(o.userData.keyframes) || o.userData.keyframes.some((k: Keyframe) =>
          !Number.isFinite(k.frame) ||
          ![k.position, k.quaternion, k.scale].every((v, i) => Array.isArray(v) && v.length === (i === 1 ? 4 : 3) && v.every(Number.isFinite)) ||
          (k.rotation !== undefined && (!Array.isArray(k.rotation) || k.rotation.length !== 3 || !k.rotation.every(Number.isFinite))) ||
          (k.rotationOrder !== undefined && !['XYZ','YZX','ZXY','XZY','YXZ','ZYX'].includes(k.rotationOrder))
        )) throw new Error('Invalid animation keyframes.');
      }
    }); } catch (error) { this.disposeObject(root); throw error; }
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
  setAnimationInterpolation(mode: AnimationInterpolation) {
    if (!validInterpolation(mode)) throw new Error('Invalid animation interpolation.');
    if (!this.selected || this.editMode) return false;
    if ((this.selected.userData.animationInterpolation ?? 'linear') === mode) return true;
    this.selected.userData.animationInterpolation = mode;
    this.evaluateAnimation();
    this.commit();
    return true;
  }
  insertKey() {
    if (!this.selected || this.editMode) return false;
    const keys: Keyframe[] = this.selected.userData.keyframes ?? [];
    const frame = Math.round(this.frame);
    const next = keys.filter(k => k.frame !== frame);
    next.push({
      frame,
      position: this.selected.position.toArray(),
      quaternion: this.selected.quaternion.toArray(),
      scale: this.selected.scale.toArray(),
      rotation: [this.selected.rotation.x, this.selected.rotation.y, this.selected.rotation.z],
      rotationOrder: this.selected.rotation.order,
    });
    this.selected.userData.keyframes = next.sort((a, b) => a.frame - b.frame);
    this.commit();
    return true;
  }
  editKeyChannel(channel: ScalarAnimationChannel, value: number) {
    if (!Number.isFinite(value)) throw new Error('Enter a finite channel value.');
    if (!this.selected || this.editMode || this.playing) throw new Error('Select an object in Object Mode and pause playback first.');
    const [property, axis] = channel.split('.') as ['position' | 'scale', 'x' | 'y' | 'z'];
    if ((property !== 'position' && property !== 'scale') || !['x', 'y', 'z'].includes(axis)) throw new Error('Choose a supported animation channel.');
    const keys: Keyframe[] = this.selected.userData.keyframes ?? [];
    const source = keys.find(key => key.frame === this.frame);
    if (!source) throw new Error('Move to an existing keyframe first.');
    const component = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const current = property === 'position' ? source.position[component] : source.scale[component];
    if (current === value) return;
    this.selected.userData.keyframes = keys.map(key => key === source ? {
      frame: key.frame,
      position: property === 'position' ? key.position.map((item, index) => index === component ? value : item) : [...key.position],
      quaternion: [...key.quaternion],
      scale: property === 'scale' ? key.scale.map((item, index) => index === component ? value : item) : [...key.scale],
      ...(key.rotation ? { rotation: [...key.rotation] } : {}),
      ...(key.rotationOrder ? { rotationOrder: key.rotationOrder } : {}),
    } : key);
    this.scrub(source.frame);
    this.commit();
  }
  retimeKey(targetFrame: number, copy = false) {
    if (!Number.isInteger(targetFrame) || targetFrame < 1 || targetFrame > 250) throw new Error('Choose an integer frame from 1 to 250.');
    if (!this.selected || this.editMode || this.playing) throw new Error('Select an object in Object Mode and pause playback first.');
    const keys: Keyframe[] = this.selected.userData.keyframes ?? [];
    const source = keys.find(key => key.frame === this.frame);
    if (!source) throw new Error('Move to an existing keyframe first.');
    if (!copy && targetFrame === source.frame) return;
    if (keys.some(key => key.frame === targetFrame)) throw new Error('The target frame already has a keyframe.');
    const next = copy ? [...keys] : keys.filter(key => key !== source);
    next.push({
      frame: targetFrame,
      position: [...source.position],
      quaternion: [...source.quaternion],
      scale: [...source.scale],
      ...(source.rotation ? { rotation: [...source.rotation] } : {}),
      ...(source.rotationOrder ? { rotationOrder: source.rotationOrder } : {}),
    });
    this.selected.userData.keyframes = next.sort((a, b) => a.frame - b.frame);
    this.scrub(targetFrame);
    this.commit();
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
      const sample = sampleAnimation(keys, this.frame, o.userData.animationInterpolation ?? 'linear');
      o.position.fromArray(sample.position);
      if (sample.rotation) {
        o.rotation.set(sample.rotation[0], sample.rotation[1], sample.rotation[2], sample.rotationOrder ?? o.rotation.order);
      } else {
        o.quaternion.fromArray(sample.quaternion);
      }
      o.scale.fromArray(sample.scale);
    });
    this.updateSelection();
  }
  stats() {
    let vertices = 0, triangles = 0;
    this.content.traverse(o => { if (o instanceof THREE.Mesh) { vertices += o.geometry.getAttribute('position')?.count ?? 0; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3; } });
    return { objects: this.content.children.filter(object => !this.isCollection(object)).length + this.collections.reduce((count, collection) => count + collection.children.length, 0), vertices, triangles: Math.round(triangles), calls: this.renderer.info.render.calls, frames: this.renderedFrames };
  }
}
