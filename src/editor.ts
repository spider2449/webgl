import * as THREE from 'three';
import { allAnimationFrames, animationChannels, effectiveBezierHandle, sampleAnimationChannel, trackKeys, validAnimationChannel, validAnimationTracks, validKeyInterpolation, validKeyTangentMode } from './animation/animation';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { GimbalControls } from './viewport/gimbal-controls';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createGrid, setGridPlane } from './viewport/grid';
import { extrudeTriangle, insetTriangle } from './modeling/extrude';
import { buildTopology, type MeshTopology, type ComponentMode } from './modeling/topology';
import { proportionalWeights } from './modeling/proportional';
import { subdivideEdges } from './modeling/subdivide';
import { extrudeRegion } from './modeling/extrude-region';
import { modelingJob, type ModelingOperation } from './modeling/modeling-worker-client';
import { validateModifierStack, type Modifier, type ModifierStack } from './modeling/modifiers';
import { createPrimitiveGeometry, defaultPrimitiveSettings, parsePrimitiveSettings, updatePrimitiveSetting, type Primitive, type PrimitiveSettings } from './modeling/primitives';

export type { Primitive } from './modeling/primitives';
export type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';
export type TransformOrientation = 'world' | 'local' | 'gimbal';
export type ScalarAnimationChannel = 'position.x' | 'position.y' | 'position.z' | 'rotation.x' | 'rotation.y' | 'rotation.z' | 'scale.x' | 'scale.y' | 'scale.z';
export type KeyInterpolation = 'constant' | 'linear' | 'bezier';
export type KeyTangentMode = 'free' | 'aligned' | 'auto';
export type ScalarKey = {
  frame: number;
  value: number;
  interpolation?: KeyInterpolation;
  tangent?: KeyTangentMode;
  left?: [number, number];
  right?: [number, number];
};
export type AnimationTrackMap = Partial<Record<ScalarAnimationChannel, ScalarKey[]>>;
export type AnimationRange = { start: number; end: number };
export type Project = { format: 'forge-studio'; version: 1; name: string; animationRange?: AnimationRange; previewRange?: AnimationRange; scene: ReturnType<THREE.Group['toJSON']> };
const MAX_HISTORY_BYTES = 24 * 1024 * 1024;
const MAX_ANIMATION_FRAME = 100_000;
const cloneScalarKey = (key: ScalarKey): ScalarKey => ({
  frame: key.frame,
  value: key.value,
  ...(key.interpolation ? { interpolation: key.interpolation } : {}),
  ...(key.tangent ? { tangent: key.tangent } : {}),
  ...(key.left ? { left: [...key.left] as [number, number] } : {}),
  ...(key.right ? { right: [...key.right] as [number, number] } : {}),
});
const cloneAnimationTracks = (tracks: AnimationTrackMap | undefined): AnimationTrackMap =>
  tracks ? Object.fromEntries(Object.entries(tracks).map(([channel, keys]) => [
    channel,
    (keys ?? []).map(cloneScalarKey),
  ])) as AnimationTrackMap : {};

export class Editor extends EventTarget {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
  readonly scene = new THREE.Scene();
  readonly content = new THREE.Group();
  readonly perspective = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
  readonly orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 2000);
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;
  readonly gimbal: GimbalControls;
  readonly grid = createGrid();
  readonly selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xf3c27d);
  private readonly secondarySelectionBoxes = new Map<THREE.Object3D, THREE.BoxHelper>();
  selected: THREE.Object3D | null = null;
  readonly selectedObjects = new Set<THREE.Object3D>();
  modelingBusy = false;
  private cancelJob: (() => void) | null = null;
  private modelingVersion = 0;
  name = 'Untitled scene';
  frame = 1;
  frameStart = 1;
  frameEnd = 250;
  previewStart: number | null = null;
  previewEnd: number | null = null;
  playing = false;
  renderedFrames = 0;
  editMode = false;
  weightMode = false;
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
  private selectedVertexOverlay: THREE.Points | null = null;
  private selectedEdgeOverlay: LineSegments2 | null = null;
  private activeEdgeOverlay: LineSegments2 | null = null;
  private selectedFaceOverlay: THREE.Mesh | null = null;
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
  private boxSelectOverlay!: HTMLDivElement;
  private boxSelectDrag: { pointerId: number; start: THREE.Vector2; current: THREE.Vector2; mode: 'replace' | 'add' | 'toggle'; active: boolean } | null = null;
  private rotationDragObject: THREE.Object3D | null = null;
  private rotationDragReference = new THREE.Vector3();
  private rotationDragMatrix = new THREE.Matrix4();
  private animationKeyDrag: { object: THREE.Object3D; sourceFrames: number[]; anchorFrame: number; channel: ScalarAnimationChannel; copy: boolean; changed: boolean; originalTrack: ScalarKey[]; pendingCopy?: { frameDelta: number; valueDelta: number } } | null = null;
  private animationHandleDrag: { object: THREE.Object3D; frame: number; channel: ScalarAnimationChannel; side: 'left' | 'right'; changed: boolean; originalTrack: ScalarKey[] } | null = null;
  transformOrientation: TransformOrientation = 'world';
  private transformTool: 'select' | 'translate' | 'rotate' | 'scale' = 'translate';
  private viewStyle = 'material';
  private solid = new THREE.MeshStandardMaterial({ color: 0x666a70, roughness: 0.9, metalness: 0 });
  private wire = new THREE.MeshBasicMaterial({ color: 0x555a62, wireframe: true });
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
    this.boxSelectOverlay = document.createElement('div');
    this.boxSelectOverlay.className = 'viewport-box-select';
    this.boxSelectOverlay.hidden = true;
    this.renderer.domElement.after(this.boxSelectOverlay);
    this.gimbal = new GimbalControls(host, this.camera);
    this.gimbal.onDraggingChange = dragging => { this.orbit.enabled = !dragging; if (dragging) this.suppressClick = true; };
    this.gimbal.onChange = () => {
      this.updateSelection();
      this.emit('transform');
      this.invalidate();
    };
    this.gimbal.onCommit = () => this.commit();
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
    this.scene.add(this.transform.getHelper(), this.gimbal.group);
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
      if (this.transform.mode === 'rotate' && this.transformOrientation !== 'gimbal') this.unwrapRotationDrag();
      if (this.editMode && !this.weightMode) this.updateVertex();
      this.updateSelection();
      this.emit('transform');
      this.invalidate();
    });
    this.transform.addEventListener('change', () => this.invalidate());
    // Shift selection must also work where a selected component meets the gizmo.
    let selectionPointer: number | null = null;
    this.renderer.domElement.addEventListener('pointerdown', e => {
      if ((e.shiftKey || e.ctrlKey || (this.editMode && !this.weightMode && this.snapTargetPending)) && e.button === 0 && !this.transform.dragging) {
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
      if (e.button === 0 && !e.altKey && !this.transform.dragging && !this.playing && !this.modelingBusy && !this.snapTargetPending) {
        const rect = host.getBoundingClientRect();
        const start = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
        this.boxSelectDrag = { pointerId: e.pointerId, start, current: start.clone(), mode: e.ctrlKey ? 'toggle' : e.shiftKey ? 'add' : 'replace', active: false };
      } else this.boxSelectDrag = null;
    });
    this.renderer.domElement.addEventListener('pointermove', e => {
      const drag = this.boxSelectDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (this.transform.dragging || this.suppressClick || this.snapTargetPending) {
        this.cancelBoxSelection();
        return;
      }
      const rect = host.getBoundingClientRect();
      drag.current.set(e.clientX - rect.left, e.clientY - rect.top);
      if (!drag.active && drag.start.distanceTo(drag.current) > 4) {
        drag.active = true;
        this.transform.enabled = false;
        this.orbit.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.boxSelectOverlay.hidden = false;
      }
      if (drag.active) this.updateBoxSelectOverlay(drag.start, drag.current);
    });
    this.renderer.domElement.addEventListener('pointerup', e => {
      const box = this.boxSelectDrag;
      if (box && box.pointerId === e.pointerId && box.active) {
        const end = box.current.clone();
        const start = box.start.clone();
        const mode = box.mode;
        this.finishBoxSelection(e.pointerId);
        this.applyBoxSelection(start, end, mode);
        return;
      }
      if (box && box.pointerId === e.pointerId) this.boxSelectDrag = null;
      if (e.button !== 0 || this.suppressClick || this.mouseDown.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return;
      const rect = host.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      if (this.editMode) {
        if (this.weightMode) {
          this.pickVertex(e.shiftKey);
        } else if (this.snapTargetPending) {
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
    this.renderer.domElement.addEventListener('pointercancel', e => { restoreTransform(e); this.cancelBoxSelection(); });
    this.renderer.domElement.addEventListener('lostpointercapture', e => { restoreTransform(e); if (this.boxSelectDrag?.pointerId === e.pointerId) this.cancelBoxSelection(); });
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  get boxSelecting() { return !!this.boxSelectDrag?.active; }
  cancelBoxSelection() {
    const drag = this.boxSelectDrag;
    if (!drag) return false;
    const pointerId = drag.pointerId;
    this.boxSelectDrag = null;
    this.boxSelectOverlay.hidden = true;
    if (this.renderer.domElement.hasPointerCapture(pointerId)) this.renderer.domElement.releasePointerCapture(pointerId);
    this.transform.enabled = true;
    this.orbit.enabled = true;
    return true;
  }
  private finishBoxSelection(pointerId: number) {
    this.boxSelectDrag = null;
    this.boxSelectOverlay.hidden = true;
    if (this.renderer.domElement.hasPointerCapture(pointerId)) this.renderer.domElement.releasePointerCapture(pointerId);
    this.transform.enabled = true;
    this.orbit.enabled = true;
  }
  private updateBoxSelectOverlay(start: THREE.Vector2, end: THREE.Vector2) {
    const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
    this.boxSelectOverlay.style.left = `${left}px`;
    this.boxSelectOverlay.style.top = `${top}px`;
    this.boxSelectOverlay.style.width = `${Math.abs(end.x - start.x)}px`;
    this.boxSelectOverlay.style.height = `${Math.abs(end.y - start.y)}px`;
  }
  private applyBoxSelection(start: THREE.Vector2, end: THREE.Vector2, mode: 'replace' | 'add' | 'toggle') {
    this.modelingVersion++;
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    const rect = this.host.getBoundingClientRect();
    const projectToScreen = (point: THREE.Vector3) => {
      const projected = point.clone().project(this.camera);
      return {
        x: (projected.x + 1) * rect.width * 0.5,
        y: (1 - projected.y) * rect.height * 0.5,
        z: projected.z,
      };
    };
    const inside = (point: THREE.Vector3) => {
      const screen = projectToScreen(point);
      return screen.z >= -1 && screen.z <= 1 && screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom;
    };
    const edgeBoxOverlapPixels = (a: THREE.Vector3, b: THREE.Vector3) => {
      const start = projectToScreen(a), endPoint = projectToScreen(b);
      if ((start.z < -1 && endPoint.z < -1) || (start.z > 1 && endPoint.z > 1)) return 0;
      const dx = endPoint.x - start.x, dy = endPoint.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return 0;
      let t0 = 0, t1 = 1;
      const clip = (p: number, q: number) => {
        if (Math.abs(p) < 1e-12) return q >= 0;
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
        return true;
      };
      if (
        !clip(-dx, start.x - left) ||
        !clip(dx, right - start.x) ||
        !clip(-dy, start.y - top) ||
        !clip(dy, bottom - start.y) ||
        t0 > t1
      ) return 0;
      return Math.max(0, t1 - t0) * length;
    };
    this.camera.updateMatrixWorld(true);
    this.content.updateMatrixWorld(true);

    if (this.editMode && this.selected instanceof THREE.Mesh && this.topology) {
      const positions = this.selected.geometry.getAttribute('position');
      const vertexPoint = (vertex: number) => this.selected!.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, this.topology!.vertices[vertex][0]));
      const hits: number[] = [];
      if (this.componentMode === 'vertex') {
        this.topology.vertices.forEach((_, vertex) => { if (inside(vertexPoint(vertex))) hits.push(vertex); });
      } else if (this.componentMode === 'edge') {
        this.topology.polygonEdges.forEach((edge, id) => {
          const a = vertexPoint(edge[0]), b = vertexPoint(edge[1]);
          const screenA = projectToScreen(a), screenB = projectToScreen(b);
          const screenLength = Math.hypot(screenB.x - screenA.x, screenB.y - screenA.y);
          const requiredOverlap = Math.min(4, screenLength * 0.5);
          if (requiredOverlap > 0 && edgeBoxOverlapPixels(a, b) >= requiredOverlap) hits.push(id);
        });
      } else {
        this.topology.polygons.forEach((face, id) => {
          const center = face.reduce((sum, vertex) => sum.add(vertexPoint(vertex)), new THREE.Vector3()).multiplyScalar(1 / face.length);
          if (inside(center)) hits.push(id);
        });
      }
      if (mode === 'replace') this.selectedComponents.clear();
      if (mode === 'toggle') {
        hits.forEach(id => {
          if (this.selectedComponents.has(id)) this.selectedComponents.delete(id);
          else this.selectedComponents.add(id);
        });
      } else hits.forEach(id => this.selectedComponents.add(id));
      this.selectedFace = this.componentMode === 'face' && this.selectedComponents.size === 1 ? [...this.selectedComponents][0] : null;
      const vertices = [...this.selectedComponents].flatMap(id => this.componentMode === 'vertex' ? [id] : this.componentMode === 'edge' ? this.topology!.polygonEdges[id] : this.topology!.polygons[id]);
      this.selectComponentVertices(vertices);
      this.emit('component-selection');
      this.emit();
      return;
    }

    const roots: THREE.Object3D[] = [];
    for (const child of this.content.children) {
      if (this.isCollection(child)) roots.push(...child.children);
      else roots.push(child);
    }
    const hits = roots.filter(object => {
      if (!this.isVisible(object) || object instanceof THREE.Bone || object instanceof THREE.Points) return false;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return false;
      const min = bounds.min, max = bounds.max;
      const corners = [
        [min.x, min.y, min.z], [min.x, min.y, max.z], [min.x, max.y, min.z], [min.x, max.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z], [max.x, max.y, min.z], [max.x, max.y, max.z],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z).project(this.camera))
        .filter(point => point.z >= -1 && point.z <= 1);
      if (!corners.length) return false;
      const objectLeft = Math.min(...corners.map(point => (point.x + 1) * rect.width * 0.5));
      const objectRight = Math.max(...corners.map(point => (point.x + 1) * rect.width * 0.5));
      const objectTop = Math.min(...corners.map(point => (1 - point.y) * rect.height * 0.5));
      const objectBottom = Math.max(...corners.map(point => (1 - point.y) * rect.height * 0.5));
      return objectRight >= left && objectLeft <= right && objectBottom >= top && objectTop <= bottom;
    });
    if (mode === 'replace') this.selectedObjects.clear();
    if (mode === 'toggle') {
      hits.forEach(object => {
        if (this.selectedObjects.has(object)) this.selectedObjects.delete(object);
        else this.selectedObjects.add(object);
      });
    } else hits.forEach(object => this.selectedObjects.add(object));
    this.selected = [...this.selectedObjects].at(-1) ?? null;
    this.syncTransformControls();
    this.updateSelection();
    this.emit();
    this.invalidate();
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
        const playback = this.playbackRange;
        const span = playback.end - playback.start + 1;
        const phase = (this.playbackFrame - playback.start + (time - this.playbackStart) / 1000 * 24) % span;
        this.frame = playback.start + Math.min(phase, playback.end - playback.start);
        this.evaluateAnimation();
        this.emit('frame');
        this.emit('transform');
      }
      this.render();
      if (this.playing) this.invalidate();
    });
  }
  render() {
    this.beforeRender?.();
    this.gimbal.update();
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    if (this.viewStyle !== 'material') this.content.traverse(o => {
      if (o instanceof THREE.Mesh && o.userData.forgeEditorHelper !== true) {
        originals.set(o, o.material);
        o.material = this.viewStyle === 'wire' ? this.wire : this.solid;
      }
    });
    this.renderer.render(this.scene, this.camera);
    originals.forEach((material, mesh) => mesh.material = material);
    this.renderedFrames++;
    this.emit('stats');
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(width, height);
    if (this.selectedEdgeOverlay) (this.selectedEdgeOverlay.material as LineMaterial).resolution.set(width, height);
    if (this.activeEdgeOverlay) (this.activeEdgeOverlay.material as LineMaterial).resolution.set(width, height);
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
    this.select(cube);
    this.commit();
  }
  add(kind: Primitive, commit = true) {
    this.setEditMode(false);
    const settings = defaultPrimitiveSettings(kind);
    const geometry = createPrimitiveGeometry(settings);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x666a70, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
    mesh.userData.forgePrimitive = settings;
    mesh.name = this.uniqueName(kind[0].toUpperCase() + kind.slice(1));
    mesh.position.y = kind === 'plane' ? 0 : kind === 'torus' ? 1.35 : kind === 'icosphere' ? 1.2 : 1;
    if (kind === 'plane') mesh.rotation.x = -Math.PI / 2;
    this.content.add(mesh);
    this.select(mesh);
    if (commit) this.commit();
    return mesh;
  }
  get primitiveSettings(): PrimitiveSettings | null {
    if (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh) return null;
    const value = this.selected.userData.forgePrimitive;
    if (value === undefined) return null;
    try { return parsePrimitiveSettings(value); } catch { return null; }
  }
  setPrimitiveParameter(key: string, value: number) {
    if (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.editMode || this.playing || this.selected.userData.modifierStack) {
      throw new Error('Select an editable parametric primitive in Object Mode first.');
    }
    const current = this.primitiveSettings;
    if (!current) throw new Error('The selected mesh is no longer parametric.');
    const next = updatePrimitiveSetting(current, key, value);
    const geometry = createPrimitiveGeometry(next);
    const oldCount = this.selected.geometry.getAttribute('position').count;
    const newCount = geometry.getAttribute('position').count;
    if (this.stats().vertices - oldCount + newCount > 2_000_000) {
      geometry.dispose();
      throw new Error('Primitive subdivisions would exceed the scene vertex limit.');
    }
    this.replaceGeometry(this.selected, geometry);
    this.selected.userData.forgePrimitive = next;
    this.commit();
    return next;
  }
  applyPrimitive() {
    if (!(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.editMode) {
      throw new Error('Select a parametric primitive in Object Mode first.');
    }
    if (this.selected.userData.forgePrimitive === undefined) return false;
    delete this.selected.userData.forgePrimitive;
    this.commit();
    return true;
  }
  private markPrimitiveApplied(mesh: THREE.Mesh) {
    if (mesh.userData.forgePrimitive !== undefined) delete mesh.userData.forgePrimitive;
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
    this.syncTransformControls();
    this.updateSelection();
    this.emit();
    this.invalidate();
  }
  updateSelection() {
    for (const [object, helper] of [...this.secondarySelectionBoxes]) {
      if (this.editMode || !this.selectedObjects.has(object) || object === this.selected || !this.isVisible(object)) {
        helper.removeFromParent();
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
        this.secondarySelectionBoxes.delete(object);
      }
    }

    if (!this.editMode) {
      for (const object of this.selectedObjects) {
        if (object === this.selected || object instanceof THREE.Bone || !this.isVisible(object)) continue;
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) continue;
        let helper = this.secondarySelectionBoxes.get(object);
        if (!helper) {
          helper = new THREE.BoxHelper(object, 0x8fb7d9);
          helper.renderOrder = 20;
          (helper.material as THREE.LineBasicMaterial).depthTest = false;
          this.secondarySelectionBoxes.set(object, helper);
          this.scene.add(helper);
        } else helper.update();
      }
    }

    this.selectionBox.visible = !!this.selected && this.selected.visible && !this.editMode && !(this.selected instanceof THREE.Bone);
    if (this.selected) {
      const bounds = new THREE.Box3().setFromObject(this.selected);
      if (bounds.isEmpty()) this.selectionBox.visible = false;
      else {
        this.selectionBox.setFromObject(this.selected);
        this.selectionBox.renderOrder = 21;
        (this.selectionBox.material as THREE.LineBasicMaterial).depthTest = false;
      }
    }
  }
  private syncTransformControls() {
    const mode = this.editMode && this.transformTool !== 'select' ? 'translate' : this.transformTool;
    const useGimbal = !this.editMode && mode === 'rotate' && this.transformOrientation === 'gimbal' && !!this.selected?.visible;
    this.gimbal.attach(this.selected);
    this.gimbal.setEnabled(useGimbal);
    if (this.weightMode || useGimbal || mode === 'select') {
      this.transform.detach();
    } else if (this.editMode && this.vertexIndices.length) {
      this.transform.attach(this.vertexProxy);
    } else if (!this.editMode && this.selected?.visible) {
      this.transform.attach(this.selected);
    } else {
      this.transform.detach();
    }
  }
  setTransformOrientation(orientation: TransformOrientation) {
    if (orientation !== 'world' && orientation !== 'local' && orientation !== 'gimbal') throw new Error('Unsupported transform orientation.');
    this.transformOrientation = orientation;
    this.transform.setSpace(orientation === 'world' ? 'world' : 'local');
    this.syncTransformControls();
    this.invalidate();
  }
  setTransformSnapping(enabled: boolean) {
    this.transform.setTranslationSnap(enabled ? 0.5 : null);
    this.transform.setRotationSnap(enabled ? Math.PI / 12 : null);
    this.transform.setScaleSnap(enabled ? 0.1 : null);
    this.gimbal.rotationSnap = enabled ? Math.PI / 12 : null;
  }
  setTool(mode: 'translate' | 'rotate' | 'scale' | 'select') {
    this.transformTool = mode;
    this.transform.setMode(this.editMode ? 'translate' : mode === 'select' ? 'translate' : mode);
    this.transform.setSpace(this.transformOrientation === 'world' ? 'world' : 'local');
    if (mode === 'select') {
      this.gimbal.setEnabled(false);
      this.transform.detach();
    } else {
      this.syncTransformControls();
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
  setShading(value: string) {
    this.viewStyle = value;
    this.refreshComponents();
    this.invalidate();
  }
  setQuality(value: string) { this.renderer.setPixelRatio(Math.min(devicePixelRatio, value === 'high' ? 2 : value === 'low' ? 1 : 1.5)); this.resize(); }
  view(axis: 'front' | 'right' | 'top' | 'perspective') {
    const distance = Math.max(0.001, this.camera.position.distanceTo(this.orbit.target));
    const next = axis === 'perspective' ? this.perspective : this.orthographic;
    const direction =
      axis === 'front' ? new THREE.Vector3(0, 0, 1) :
      axis === 'right' ? new THREE.Vector3(1, 0, 0) :
      axis === 'top' ? new THREE.Vector3(0, 1, 0) :
      new THREE.Vector3(1, 0.75, 1.25).normalize();
    const up = axis === 'top' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);

    if (next === this.orthographic && this.camera !== this.orthographic) {
      this.orthographic.zoom = 14 / Math.max(1, distance * 0.77);
      this.orthographic.updateProjectionMatrix();
    }
    this.camera = next;
    this.orbit.object = next;
    this.transform.camera = next;
    this.gimbal.setCamera(next);
    this.camera.up.copy(up);
    this.camera.position.copy(this.orbit.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.orbit.target);
    setGridPlane(this.grid, axis);
    this.orbit.update();
    this.invalidate();
    this.emit('view');
  }
  toggleProjection() {
    const next = this.camera === this.perspective ? this.orthographic : this.perspective;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    next.up.copy(this.camera.up);
    if (next === this.orthographic) { next.zoom = 14 / Math.max(1, this.camera.position.distanceTo(this.orbit.target) * 0.77); next.updateProjectionMatrix(); }
    this.camera = next;
    this.orbit.object = next;
    this.transform.camera = next;
    this.gimbal.setCamera(next);
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
    this.markPrimitiveApplied(this.selected);
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
  setEditMode(enabled: boolean, preparedTopology?: MeshTopology, weightMode = false) {
    this.modelingVersion++;
    this.cancelVertexSnap();
    const nextWeightMode = enabled && weightMode;
    if (enabled && (!(this.selected instanceof THREE.Mesh) || (!nextWeightMode && this.selected instanceof THREE.SkinnedMesh) || this.playing || this.selected.userData.modifierStack)) return false;
    this.weightMode = nextWeightMode;
    this.editMode = enabled;
    if (this.weightMode) this.componentMode = 'vertex';
    this.selectedComponents.clear();
    this.componentDrag = null;
    this.vertexIndices = [];
    this.selectedFace = null;
    this.transform.detach();
    this.gimbal.setEnabled(false);
    if (this.vertexPoints) {
      this.vertexPoints.removeFromParent();
      this.componentEdges?.geometry.dispose();
      if (this.componentEdges) (this.componentEdges.material as THREE.Material).dispose();
      this.componentEdges = null;
      for (const overlay of [this.selectedVertexOverlay, this.selectedEdgeOverlay, this.activeEdgeOverlay, this.selectedFaceOverlay]) {
        overlay?.geometry.dispose();
        if (overlay) (overlay.material as THREE.Material).dispose();
      }
      this.selectedVertexOverlay = null;
      this.selectedEdgeOverlay = null;
      this.activeEdgeOverlay = null;
      this.selectedFaceOverlay = null;
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
      this.topology = preparedTopology ?? buildTopology(position.array, this.selected.geometry.index?.array, this.selected.geometry.userData.forgePolygonTriangles);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(position.count * 3).fill(1), 3));
      (this.vertexPoints.material as THREE.PointsMaterial).vertexColors = true;
      this.componentEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x454b54, transparent: true, opacity: 0.9, depthTest: false }));
      this.componentEdges.renderOrder = 9;
      this.selectedVertexOverlay = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffcf85, size: 10, sizeAttenuation: false, depthTest: false }));
      this.selectedVertexOverlay.userData.forgeEditorHelper = true;
      this.selectedVertexOverlay.renderOrder = 12;

      const selectedEdgeMaterial = new LineMaterial({ color: 0xffa94d, linewidth: 5, worldUnits: false, depthTest: false, depthWrite: false });
      selectedEdgeMaterial.resolution.copy(this.renderer.getSize(new THREE.Vector2()));
      this.selectedEdgeOverlay = new LineSegments2(new LineSegmentsGeometry(), selectedEdgeMaterial);
      this.selectedEdgeOverlay.userData.forgeEditorHelper = true;
      this.selectedEdgeOverlay.renderOrder = 13;

      const activeEdgeMaterial = new LineMaterial({ color: 0xfff2db, linewidth: 2, worldUnits: false, depthTest: false, depthWrite: false });
      activeEdgeMaterial.resolution.copy(this.renderer.getSize(new THREE.Vector2()));
      this.activeEdgeOverlay = new LineSegments2(new LineSegmentsGeometry(), activeEdgeMaterial);
      this.activeEdgeOverlay.userData.forgeEditorHelper = true;
      this.activeEdgeOverlay.renderOrder = 14;

      this.selectedFaceOverlay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffb95f, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      this.selectedFaceOverlay.userData.forgeEditorHelper = true;
      this.selectedFaceOverlay.renderOrder = 11;
      this.vertexPoints.add(this.componentEdges, this.selectedVertexOverlay, this.selectedEdgeOverlay, this.activeEdgeOverlay, this.selectedFaceOverlay);
      this.refreshComponents();
    } else {
      this.syncTransformControls();
    }
    this.updateSelection();
    this.emit('mode');
    this.invalidate();
    return true;
  }
  setWeightMode(enabled: boolean) {
    if (!enabled) return this.setEditMode(false);
    if (!(this.selected instanceof THREE.SkinnedMesh) || this.playing) return false;
    return this.setEditMode(true, undefined, true);
  }
  setComponentMode(mode: ComponentMode) {
    if (this.weightMode && mode !== 'vertex') throw new Error('Weight Mode supports vertex selection only.');
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
    const edgeMaterial = this.componentEdges.material as THREE.LineBasicMaterial;
    edgeMaterial.color.setHex(this.viewStyle === 'wire' ? 0x9aa1aa : 0x454b54);
    edgeMaterial.opacity = this.viewStyle === 'wire' ? 1 : 0.9;
    const position = this.selected.geometry.getAttribute('position');
    let edges = this.componentEdges.geometry.getAttribute('position');
    if (!edges || edges.count !== this.topology.polygonEdges.length * 2) {
      edges = new THREE.Float32BufferAttribute(new Float32Array(this.topology.polygonEdges.length * 6), 3);
      this.componentEdges.geometry.setAttribute('position', edges);
    }
    let cursor = 0;
    for (const edge of this.topology.polygonEdges) for (const vertex of edge) {
      const i = this.topology.vertices[vertex][0];
      edges.setXYZ(cursor++, position.getX(i), position.getY(i), position.getZ(i));
    }
    edges.needsUpdate = true;
    this.componentEdges.geometry.computeBoundingSphere();
    this.componentEdges.visible = this.componentMode !== 'vertex' || (this.snapTargetPending && this.snapTargetKind === 'edge');
    const colors = this.vertexPoints.geometry.getAttribute('color');
    const selected = new Set(this.vertexIndices);
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, 1, selected.has(i) ? 0.45 : 1, selected.has(i) ? 0.12 : 1);
    colors.needsUpdate = true;

    if (this.selectedVertexOverlay && this.selectedEdgeOverlay && this.activeEdgeOverlay && this.selectedFaceOverlay) {
      const vertexValues: number[] = [];
      const edgeValues: number[] = [];
      const activeEdgeValues: number[] = [];
      const faceValues: number[] = [];
      const pushVertex = (vertex: number, target: number[]) => {
        const index = this.topology!.vertices[vertex][0];
        target.push(position.getX(index), position.getY(index), position.getZ(index));
      };

      if (this.componentMode === 'vertex') {
        for (const vertex of this.selectedComponents) pushVertex(vertex, vertexValues);
      } else if (this.componentMode === 'edge') {
        for (const edgeId of this.selectedComponents) {
          const edge = this.topology.polygonEdges[edgeId];
          if (!edge) continue;
          pushVertex(edge[0], edgeValues);
          pushVertex(edge[1], edgeValues);
        }
        const activeEdgeId = [...this.selectedComponents].at(-1);
        const activeEdge = activeEdgeId === undefined ? undefined : this.topology.polygonEdges[activeEdgeId];
        if (activeEdge) {
          pushVertex(activeEdge[0], activeEdgeValues);
          pushVertex(activeEdge[1], activeEdgeValues);
        }
      } else {
        for (const faceId of this.selectedComponents) {
          const triangles = this.topology.polygonTriangles[faceId];
          if (!triangles) continue;
          triangles.forEach(triangle => this.topology!.faces[triangle]?.forEach(vertex => pushVertex(vertex, faceValues)));
        }
      }

      this.selectedVertexOverlay.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertexValues, 3));
      (this.selectedEdgeOverlay.geometry as LineSegmentsGeometry).setPositions(edgeValues);
      (this.activeEdgeOverlay.geometry as LineSegmentsGeometry).setPositions(activeEdgeValues);
      this.selectedFaceOverlay.geometry.setAttribute('position', new THREE.Float32BufferAttribute(faceValues, 3));
      this.selectedVertexOverlay.visible = this.componentMode === 'vertex' && vertexValues.length > 0;
      this.selectedEdgeOverlay.visible = this.componentMode === 'edge' && edgeValues.length > 0;
      this.activeEdgeOverlay.visible = this.componentMode === 'edge' && activeEdgeValues.length > 0;
      this.selectedFaceOverlay.visible = this.componentMode === 'face' && faceValues.length > 0;
      if (vertexValues.length) this.selectedVertexOverlay.geometry.computeBoundingSphere();
      if (edgeValues.length) this.selectedEdgeOverlay.computeLineDistances();
      if (activeEdgeValues.length) this.activeEdgeOverlay.computeLineDistances();
      if (faceValues.length) this.selectedFaceOverlay.geometry.computeBoundingSphere();
    }
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
      if (hit?.faceIndex !== undefined && hit.faceIndex !== null) component = this.topology.triangleToPolygon[hit.faceIndex];
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
    const vertices = [...this.selectedComponents].flatMap(id => this.componentMode === 'vertex' ? [id] : this.componentMode === 'edge' ? this.topology!.polygonEdges[id] : this.topology!.polygons[id]);
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
      if (!this.weightMode && this.transformTool !== 'select') {
        this.transform.setMode('translate');
        this.transform.attach(this.vertexProxy);
      }
    }
    this.refreshComponents();
    this.invalidate();
  }
  private captureSubdivisionEdges(edgeIds: number[]): [[number, number, number], [number, number, number]][] {
    if (!this.topology || !(this.selected instanceof THREE.Mesh)) return [];
    const positions = this.selected.geometry.getAttribute('position');
    return edgeIds.map(id => this.topology!.polygonEdges[id]).filter((edge): edge is [number, number] => !!edge).map(edge =>
      edge.map(vertex => {
        const index = this.topology!.vertices[vertex][0];
        return [positions.getX(index), positions.getY(index), positions.getZ(index)] as [number, number, number];
      }) as [[number, number, number], [number, number, number]]
    );
  }
  private restoreSubdivisionSelection(mode: ComponentMode, oldEdges: [[number, number, number], [number, number, number]][], midpointIndex: number) {
    if (!this.topology || !(this.selected instanceof THREE.Mesh)) return;
    this.setComponentMode(mode);
    const midpointVertices = new Set(this.topology.bufferToVertex.slice(midpointIndex));
    if (mode === 'vertex') {
      const vertices = [...midpointVertices];
      this.selectedComponents = new Set(vertices);
      this.selectComponentVertices(vertices);
    } else if (mode === 'edge' && oldEdges.length) {
      const positions = this.selected.geometry.getAttribute('position');
      const positionKey = (value: [number, number, number]) => `${value[0]},${value[1]},${value[2]}`;
      const vertexByPosition = new Map<string, number>();
      this.topology.vertices.forEach((copies, vertex) => {
        const index = copies[0];
        vertexByPosition.set(positionKey([positions.getX(index), positions.getY(index), positions.getZ(index)]), vertex);
      });
      const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edgeByKey = new Map(this.topology.polygonEdges.map((edge, id) => [edgeKey(edge[0], edge[1]), id]));
      const splitEdges: number[] = [];
      for (const [aPosition, bPosition] of oldEdges) {
        const midpointPosition: [number, number, number] = [
          Math.fround((aPosition[0] + bPosition[0]) * 0.5),
          Math.fround((aPosition[1] + bPosition[1]) * 0.5),
          Math.fround((aPosition[2] + bPosition[2]) * 0.5),
        ];
        const a = vertexByPosition.get(positionKey(aPosition));
        const b = vertexByPosition.get(positionKey(bPosition));
        const midpoint = vertexByPosition.get(positionKey(midpointPosition));
        if (a === undefined || b === undefined || midpoint === undefined) continue;
        const first = edgeByKey.get(edgeKey(a, midpoint));
        const second = edgeByKey.get(edgeKey(midpoint, b));
        if (first !== undefined && second !== undefined) splitEdges.push(first, second);
      }
      this.selectedComponents = new Set(splitEdges);
      this.selectComponentVertices([...this.selectedComponents].flatMap(id => this.topology!.polygonEdges[id]));
    } else {
      this.selectedComponents.clear();
      this.selectedFace = null;
      this.selectComponentVertices();
    }
    this.emit('component-selection');
  }
  extrudeFace(distance: number, inset = false) {
    if (!this.editMode || this.componentMode !== 'face' || this.selectedFace === null || !(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing) throw new Error('Select exactly one face in Edit Mode first.');
    const mesh = this.selected, polygon = this.selectedFace, triangles = this.componentFaceTriangles(polygon);
    if (triangles.length !== 1) throw new Error('Quad / polygon extrusion and inset are not implemented in this transition step.');
    const face = triangles[0];
    if (this.stats().vertices + 15 > 2_000_000) throw new Error('Triangle editing would exceed the scene vertex limit.');
    const original = mesh.geometry;
    const geometry = inset ? insetTriangle(original, face, distance) : extrudeTriangle(original, face, distance);
    this.markPrimitiveApplied(mesh);
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
    if (!this.editMode || this.componentMode !== 'face' || !this.selectedComponents.size || !(this.selected instanceof THREE.Mesh) || this.selected instanceof THREE.SkinnedMesh || this.playing || this.transform.dragging) throw new Error('Select connected coplanar faces in Edit Mode and finish the current drag first.');
    if (!this.selectedFacesAreTriangles()) throw new Error('Quad / polygon region extrusion is not implemented in this transition step.');
    const faces = [...this.selectedComponents].flatMap(face => this.componentFaceTriangles(face)), mesh = this.selected, original = mesh.geometry;
    const geometry = extrudeRegion(original, faces, distance);
    if (this.stats().vertices + geometry.getAttribute('position').count - original.getAttribute('position').count > 2_000_000) {
      geometry.dispose(); throw new Error('Region extrusion would exceed the scene vertex limit.');
    }
    this.markPrimitiveApplied(mesh);
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
    const selectedEdgeIds = [...this.selectedComponents];
    const oldEdges = this.captureSubdivisionEdges(selectedEdgeIds);
    const endpoints = selectedEdgeIds.map(id => this.topology!.polygonEdges[id].map(v => this.topology!.vertices[v][0]) as [number, number]);
    const mesh = this.selected, original = mesh.geometry, midpointIndex = original.getAttribute('position').count;
    const geometry = subdivideEdges(original, endpoints);
    if (this.stats().vertices + geometry.getAttribute('position').count - midpointIndex > 2_000_000) {
      geometry.dispose();
      throw new Error('Subdivision would exceed the scene vertex limit.');
    }
    this.markPrimitiveApplied(mesh);
    this.setEditMode(false);
    mesh.geometry = geometry;
    let retained = false;
    this.content.traverse(object => { if (object instanceof THREE.Mesh && object.geometry === original) retained = true; });
    if (!retained) original.dispose();
    this.setEditMode(true);
    this.restoreSubdivisionSelection('edge', oldEdges, midpointIndex);
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
    if (!Number.isInteger(edge) || !this.topology.polygonEdges[edge]) throw new Error('Invalid snap target edge.');
    const indices = this.topology.polygonEdges[edge].map(vertex => this.topology!.vertices[vertex][0]);
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
    this.markPrimitiveApplied(this.selected);
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
  get selectedVertexBufferIndices() { return [...new Set(this.vertexIndices)]; }
  get selectedLogicalVertexCount() { return this.componentMode === 'vertex' ? this.selectedComponents.size : 0; }
  get meshTopology() { return this.topology; }
  componentEdgeToTriangleEdge(edge: number) {
    return this.topology?.polygonEdgeToEdge[edge];
  }
  componentFaceTriangles(face: number) {
    return this.topology?.polygonTriangles[face] ? [...this.topology.polygonTriangles[face]] : [];
  }
  selectedFacesAreTriangles() {
    return this.componentMode === 'face' && [...this.selectedComponents].every(face => this.topology?.polygonTriangles[face]?.length === 1);
  }
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
      const oldEdges = oldMode === 'edge' ? this.captureSubdivisionEdges(oldSelection) : [];
      const midpoint = meshes[0].geometry.getAttribute('position').count;
      this.setEditMode(false);
      meshes.forEach(mesh => this.markPrimitiveApplied(mesh));
      meshes.forEach((mesh, i) => this.replaceGeometry(mesh, results[i])); results.length = 0;
      if (editing) {
        this.setEditMode(true, topologies[0]);
        if (operation.kind === 'subdivide') {
          this.restoreSubdivisionSelection(oldMode, oldEdges, midpoint);
        } else if (operation.kind === 'subdivide-all') {
          this.setComponentMode(oldMode);
        } else if (['uv', 'inset', 'extrude', 'region'].includes(operation.kind)) {
          this.setComponentMode(oldMode); this.selectedComponents = new Set(oldSelection);
          this.selectedFace = oldSelection.length === 1 ? oldSelection[0] : null;
          this.selectComponentVertices(oldSelection.flatMap(f => this.topology!.polygons[f]));
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
      if (items.length) this.markPrimitiveApplied(mesh);
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
    if (!this.editMode || this.weightMode || !(this.selected instanceof THREE.Mesh) || !this.topology || !this.vertexIndices.length) return;
    this.markPrimitiveApplied(this.selected);
    const attribute = this.selected.geometry.getAttribute('position');
    const positions = Array.from({ length: attribute.count }, (_, i) => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]).flat();
    const weights = this.proportionalEnabled ? proportionalWeights(positions, this.topology, this.vertexIndices, this.proportionalRadius, this.proportionalConnected) : new Float32Array(attribute.count);
    if (!this.proportionalEnabled) for (const i of this.vertexIndices) weights[i] = 1;
    this.componentDrag = { positions, weights, center: this.componentCenter.clone() };
  }
  private updateVertex(target?: THREE.Vector3) {
    if (this.weightMode || !(this.selected instanceof THREE.Mesh) || !this.vertexPoints) return;
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
    try { return JSON.stringify({
      format: 'forge-studio',
      version: 1,
      name: this.name,
      animationRange: { start: this.frameStart, end: this.frameEnd },
      ...(this.previewRange ? { previewRange: this.previewRange } : {}),
      scene: this.content.toJSON(),
    } satisfies Project); }
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
  get undoDepth() { return Math.max(0, this.historyIndex); }
  get redoDepth() { return Math.max(0, this.history.length - this.historyIndex - 1); }
  undo() { if (this.canUndo) this.restoreHistory(--this.historyIndex); }
  redo() { if (this.canRedo) this.restoreHistory(++this.historyIndex); }
  private restoreHistory(index: number) {
    const id = this.selected?.uuid;
    const restoreEditMode = this.editMode && !this.weightMode;
    const componentMode = this.componentMode;
    this.load(JSON.parse(this.history[index]), false);
    const selected = this.content.getObjectByProperty('uuid', id ?? '') ?? this.content.children[0] ?? null;
    this.select(selected);
    if (restoreEditMode && selected instanceof THREE.Mesh && !(selected instanceof THREE.SkinnedMesh) && !selected.userData.modifierStack) {
      this.setEditMode(true);
      if (this.componentMode !== componentMode) this.setComponentMode(componentMode);
    }
    this.emit('commit');
  }
  load(project: Project, commit = true) {
    if (project.format !== 'forge-studio' || project.version !== 1 || !project.scene?.object) throw new Error('This is not a supported Forge project.');
    const range = project.animationRange ?? { start: 1, end: 250 };
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 1 ||
      range.end > MAX_ANIMATION_FRAME ||
      range.end <= range.start
    ) throw new Error(`Animation range must use integer frames from 1 to ${MAX_ANIMATION_FRAME} with Start before End.`);
    const preview = project.previewRange;
    if (preview !== undefined && (
      !Number.isInteger(preview.start) ||
      !Number.isInteger(preview.end) ||
      preview.start < range.start ||
      preview.end > range.end ||
      preview.end <= preview.start
    )) throw new Error('Preview range must stay inside the Scene Frame Range with Start before End.');
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
      if (o instanceof THREE.Mesh) {
        vertices += o.geometry.getAttribute('position')?.count ?? 0;
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          if (material instanceof THREE.MeshStandardMaterial) {
            const legacyBright =
              material.color.getHex() === 0xb8b6b2 &&
              Math.abs(material.roughness - 0.42) < 1e-9 &&
              Math.abs(material.metalness - 0.12) < 1e-9;
            const interimGray =
              material.color.getHex() === 0x888c92 &&
              Math.abs(material.roughness - 0.55) < 1e-9 &&
              Math.abs(material.metalness - 0.05) < 1e-9;
            if (legacyBright || interimGray) {
              material.color.setHex(0x666a70);
              material.roughness = 0.8;
              material.metalness = 0;
              material.needsUpdate = true;
            }
          }
        }
      }
      if (o.userData.modifierStack !== undefined) {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) throw new Error('Only ordinary meshes support modifiers.');
        validateModifierStack(o.userData.modifierStack);
      }
      if (o.userData.forgePrimitive !== undefined) {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) throw new Error('Only ordinary meshes support primitive parameters.');
        parsePrimitiveSettings(o.userData.forgePrimitive);
      }
      if ('animationInterpolation' in o.userData || 'animationChannelInterpolation' in o.userData || 'keyframes' in o.userData) {
        throw new Error('Legacy animation metadata is unsupported.');
      }
      if (!validAnimationTracks(o.userData.animationTracks, 1, MAX_ANIMATION_FRAME)) throw new Error('Invalid animation tracks.');
    }); } catch (error) { this.disposeObject(root); throw error; }
    if (vertices > 2_000_000) { this.disposeObject(root); throw new Error('Scene exceeds the 2 million vertex limit.'); }
    this.playing = false;
    this.select(null);
    this.disposeObject(this.content);
    this.content.clear();
    this.content.add(...root.children.slice());
    this.name = typeof project.name === 'string' ? project.name.slice(0, 100) : 'Untitled scene';
    this.frameStart = range.start;
    this.frameEnd = range.end;
    this.previewStart = preview?.start ?? null;
    this.previewEnd = preview?.end ?? null;
    this.frame = THREE.MathUtils.clamp(this.frame, this.frameStart, this.frameEnd);
    this.playbackFrame = THREE.MathUtils.clamp(this.frame, this.playbackRange.start, this.playbackRange.end);
    this.select(this.content.children[0] ?? null);
    this.evaluateAnimation();
    this.emit('range');
    this.emit('frame');
    if (commit) this.commit();
  }
  newProject() {
    this.playing = false;
    this.select(null);
    this.disposeObject(this.content);
    this.content.clear();
    this.name = 'Untitled scene';
    this.frameStart = 1;
    this.frameEnd = 250;
    this.previewStart = null;
    this.previewEnd = null;
    this.frame = 1;
    this.playbackFrame = 1;
    this.seed();
  }

  get animationRange(): AnimationRange { return { start: this.frameStart, end: this.frameEnd }; }
  get previewRange(): AnimationRange | null {
    return this.previewStart !== null && this.previewEnd !== null
      ? { start: this.previewStart, end: this.previewEnd }
      : null;
  }
  get playbackRange(): AnimationRange { return this.previewRange ?? this.animationRange; }

  private authoredFrame(frame: number) {
    return Number.isInteger(frame) && frame >= 1 && frame <= MAX_ANIMATION_FRAME;
  }

  private frameInRange(frame: number) {
    return Number.isInteger(frame) && frame >= this.frameStart && frame <= this.frameEnd;
  }

  private animationRangeLabel() {
    return `${this.frameStart}–${this.frameEnd}`;
  }

  private authoredFrameLabel() {
    return `1–${MAX_ANIMATION_FRAME}`;
  }

  setAnimationRange(start: number, end: number) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end > MAX_ANIMATION_FRAME ||
      end <= start
    ) throw new Error(`Animation range must use integer frames from 1 to ${MAX_ANIMATION_FRAME} with Start before End.`);
    if (this.playing || this.animationKeyDrag || this.animationHandleDrag) throw new Error('Pause playback and finish animation editing before changing the time range.');
    if (start === this.frameStart && end === this.frameEnd) return false;

    this.frameStart = start;
    this.frameEnd = end;
    if (
      this.previewStart !== null &&
      this.previewEnd !== null &&
      (this.previewStart < start || this.previewEnd > end)
    ) {
      this.previewStart = null;
      this.previewEnd = null;
    }
    this.frame = THREE.MathUtils.clamp(this.frame, start, end);
    this.playbackFrame = THREE.MathUtils.clamp(this.frame, this.playbackRange.start, this.playbackRange.end);
    this.evaluateAnimation();
    this.emit('range');
    this.emit('frame');
    this.emit('animation');
    this.emit('transform');
    this.commit();
    return true;
  }
  setPreviewRange(start: number, end: number) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < this.frameStart ||
      end > this.frameEnd ||
      end <= start
    ) throw new Error(`Preview range must stay inside ${this.animationRangeLabel()} with Start before End.`);
    if (this.playing || this.animationKeyDrag || this.animationHandleDrag) {
      throw new Error('Pause playback and finish animation editing before changing the Preview Range.');
    }
    if (this.previewStart === start && this.previewEnd === end) return false;

    this.previewStart = start;
    this.previewEnd = end;
    this.playbackFrame = THREE.MathUtils.clamp(this.frame, start, end);
    this.emit('range');
    this.emit('frame');
    this.commit();
    return true;
  }

  clearPreviewRange() {
    if (this.previewStart === null || this.previewEnd === null) return false;
    if (this.playing || this.animationKeyDrag || this.animationHandleDrag) {
      throw new Error('Pause playback and finish animation editing before clearing the Preview Range.');
    }

    this.previewStart = null;
    this.previewEnd = null;
    this.playbackFrame = this.frame;
    this.emit('range');
    this.emit('frame');
    this.commit();
    return true;
  }

  private channelNativeValue(object: THREE.Object3D, channel: ScalarAnimationChannel) {
    const [property, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
    return object[property][axis];
  }

  private setAnimationTrack(object: THREE.Object3D, channel: ScalarAnimationChannel, keys: ScalarKey[]) {
    const tracks = cloneAnimationTracks(object.userData.animationTracks as AnimationTrackMap | undefined);
    if (keys.length) tracks[channel] = keys.map(cloneScalarKey).sort((a, b) => a.frame - b.frame);
    else delete tracks[channel];
    if (Object.values(tracks).some(track => track?.length)) object.userData.animationTracks = tracks;
    else delete object.userData.animationTracks;
  }

  private upsertChannelKey(object: THREE.Object3D, channel: ScalarAnimationChannel, frame: number, value: number) {
    const keys = trackKeys(object.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const existing = keys.find(key => key.frame === frame);
    const next: ScalarKey = existing ? { ...cloneScalarKey(existing), value } : { frame, value };
    const filtered = keys.filter(key => key.frame !== frame);
    filtered.push(next);
    this.setAnimationTrack(object, channel, filtered);
  }

  insertChannelKey(channel: ScalarAnimationChannel) {
    if (!validAnimationChannel(channel) || !this.selected || this.editMode || this.playing) return false;
    const frame = Math.round(this.frame);
    this.upsertChannelKey(this.selected, channel, frame, this.channelNativeValue(this.selected, channel));
    this.commit();
    return true;
  }

  removeChannelKey(channel: ScalarAnimationChannel, frame = Math.round(this.frame)) {
    if (!validAnimationChannel(channel) || !this.selected || this.editMode || this.playing) return false;
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel);
    if (!keys.some(key => key.frame === frame)) return false;
    this.setAnimationTrack(this.selected, channel, keys.filter(key => key.frame !== frame));
    this.evaluateAnimation();
    this.commit();
    return true;
  }

  setKeyInterpolation(frame: number, channel: ScalarAnimationChannel, mode: KeyInterpolation) {
    return this.setKeyInterpolations([frame], channel, mode);
  }

  setKeyInterpolations(frames: number[], channel: ScalarAnimationChannel, mode: KeyInterpolation) {
    if (!validAnimationChannel(channel) || !validKeyInterpolation(mode) || frames.some(frame => !this.authoredFrame(frame))) {
      throw new Error('Invalid key interpolation.');
    }
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const uniqueFrames = [...new Set(frames)];
    if (!uniqueFrames.length) throw new Error('Choose an authored channel key first.');

    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const indices = uniqueFrames.map(frame => keys.findIndex(key => key.frame === frame));
    if (indices.some(index => index < 0)) throw new Error('Choose authored channel keys first.');

    const editableIndices = indices.filter(index => index < keys.length - 1).sort((a, b) => a - b);
    if (!editableIndices.length) throw new Error('The selected channel keys have no outbound segments.');

    for (const index of editableIndices) {
      const key = keys[index];
      key.interpolation = mode;
      if (mode === 'bezier') {
        const next = keys[index + 1];
        const span = next.frame - key.frame;
        const delta = next.value - key.value;
        if ((key.tangent ?? 'free') !== 'auto' && !key.right) key.right = [span / 3, delta / 3];
        if ((next.tangent ?? 'free') !== 'auto' && !next.left) next.left = [-span / 3, -delta / 3];
      }
    }

    this.setAnimationTrack(this.selected, channel, keys);
    this.evaluateAnimation();
    this.commit();
    return true;
  }

  setKeyTangentMode(frame: number, channel: ScalarAnimationChannel, mode: KeyTangentMode) {
    return this.setKeyTangentModes([frame], channel, mode);
  }

  setKeyTangentModes(frames: number[], channel: ScalarAnimationChannel, mode: KeyTangentMode) {
    if (!validAnimationChannel(channel) || !validKeyTangentMode(mode) || frames.some(frame => !this.authoredFrame(frame))) {
      throw new Error('Invalid key tangent mode.');
    }
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const uniqueFrames = [...new Set(frames)];
    if (!uniqueFrames.length) throw new Error('Choose an authored channel key first.');

    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const indices = uniqueFrames.map(frame => keys.findIndex(key => key.frame === frame));
    if (indices.some(index => index < 0)) throw new Error('Choose authored channel keys first.');

    const eligibleIndices = indices
      .filter(index => {
        const incomingBezier = index > 0 && (keys[index - 1].interpolation ?? 'linear') === 'bezier';
        const outgoingBezier = index < keys.length - 1 && (keys[index].interpolation ?? 'linear') === 'bezier';
        return incomingBezier || outgoingBezier;
      })
      .sort((a, b) => a - b);
    if (!eligibleIndices.length) throw new Error('Tangent mode requires a Bezier segment.');

    for (const index of eligibleIndices) {
      const incomingBezier = index > 0 && (keys[index - 1].interpolation ?? 'linear') === 'bezier';
      const outgoingBezier = index < keys.length - 1 && (keys[index].interpolation ?? 'linear') === 'bezier';
      const left = incomingBezier ? effectiveBezierHandle(keys, index, 'left') : null;
      const right = outgoingBezier ? effectiveBezierHandle(keys, index, 'right') : null;
      const key = keys[index];
      key.tangent = mode;

      if (mode === 'auto') {
        delete key.left;
        delete key.right;
      } else {
        if (left) key.left = [...left];
        if (right) key.right = [...right];
        if (mode === 'aligned' && left && right) {
          const rightLength = Math.hypot(right[0], right[1]);
          const leftLength = Math.hypot(left[0], left[1]);
          if (rightLength > 1e-12 && leftLength > 1e-12) {
            let aligned: [number, number] = [
              -right[0] / rightLength * leftLength,
              -right[1] / rightLength * leftLength,
            ];
            const previous = keys[index - 1];
            const previousRight = effectiveBezierHandle(keys, index - 1, 'right');
            const minimumLeftFrame = previousRight
              ? THREE.MathUtils.clamp(previous.frame + previousRight[0], previous.frame, key.frame)
              : previous.frame;
            const maxLeftDx = key.frame - minimumLeftFrame;
            if (Math.abs(aligned[0]) > maxLeftDx && Math.abs(aligned[0]) > 1e-12) {
              const scale = maxLeftDx / Math.abs(aligned[0]);
              aligned = [aligned[0] * scale, aligned[1] * scale];
            }
            key.left = aligned;
          }
        }
      }
    }

    this.setAnimationTrack(this.selected, channel, keys);
    this.evaluateAnimation();
    this.commit();
    return true;
  }

  beginAnimationHandleDrag(frame: number, channel: ScalarAnimationChannel, side: 'left' | 'right') {
    if (!Number.isInteger(frame) || !validAnimationChannel(channel) || !this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel);
    const index = keys.findIndex(key => key.frame === frame);
    if (index < 0) return false;
    const enabled = side === 'right'
      ? index < keys.length - 1 && (keys[index].interpolation ?? 'linear') === 'bezier'
      : index > 0 && (keys[index - 1].interpolation ?? 'linear') === 'bezier';
    if (!enabled) return false;
    this.animationHandleDrag = {
      object: this.selected,
      frame,
      channel,
      side,
      changed: false,
      originalTrack: keys.map(cloneScalarKey),
    };
    return true;
  }

  previewAnimationHandleDrag(targetFrame: number, displayValue: number) {
    const drag = this.animationHandleDrag;
    if (!drag || this.selected !== drag.object || this.editMode || this.playing || !Number.isFinite(targetFrame) || !Number.isFinite(displayValue)) return false;
    const keys = drag.originalTrack.map(cloneScalarKey);
    const index = keys.findIndex(key => key.frame === drag.frame);
    if (index < 0) return false;
    const key = keys[index];
    const targetValue = drag.channel.startsWith('rotation.') ? THREE.MathUtils.degToRad(displayValue) : displayValue;

    let minimumFrame: number;
    let maximumFrame: number;
    if (drag.side === 'right') {
      if (index >= keys.length - 1 || (key.interpolation ?? 'linear') !== 'bezier') return false;
      const next = keys[index + 1];
      const opposite = effectiveBezierHandle(keys, index + 1, 'left')!;
      minimumFrame = key.frame;
      maximumFrame = THREE.MathUtils.clamp(next.frame + opposite[0], key.frame, next.frame);
    } else {
      if (index === 0 || (keys[index - 1].interpolation ?? 'linear') !== 'bezier') return false;
      const previous = keys[index - 1];
      const opposite = effectiveBezierHandle(keys, index - 1, 'right')!;
      minimumFrame = THREE.MathUtils.clamp(previous.frame + opposite[0], previous.frame, key.frame);
      maximumFrame = key.frame;
    }

    const clampedFrame = THREE.MathUtils.clamp(targetFrame, minimumFrame, maximumFrame);
    const originalHandle = effectiveBezierHandle(drag.originalTrack, index, drag.side);
    if (!originalHandle) return false;
    const originalFrame = key.frame + originalHandle[0];
    const originalValue = key.value + originalHandle[1];
    const changed = Math.abs(clampedFrame - originalFrame) > 1e-9 || Math.abs(targetValue - originalValue) > 1e-9;
    drag.changed = changed;
    if (!changed) {
      this.setAnimationTrack(drag.object, drag.channel, drag.originalTrack);
      this.evaluateAnimation();
      this.emit('animation');
      this.emit('transform');
      this.invalidate();
      return { frame: clampedFrame, value: displayValue };
    }

    if ((key.tangent ?? 'free') === 'auto') {
      key.tangent = 'aligned';
      const left = effectiveBezierHandle(drag.originalTrack, index, 'left');
      const right = effectiveBezierHandle(drag.originalTrack, index, 'right');
      if (left) key.left = [...left];
      if (right) key.right = [...right];
    }

    const dragged: [number, number] = [clampedFrame - key.frame, targetValue - key.value];
    key[drag.side] = dragged;

    if ((key.tangent ?? 'free') === 'aligned') {
      const oppositeSide = drag.side === 'left' ? 'right' : 'left';
      const oppositeRelevant = oppositeSide === 'left'
        ? index > 0 && (keys[index - 1].interpolation ?? 'linear') === 'bezier'
        : index < keys.length - 1 && (keys[index].interpolation ?? 'linear') === 'bezier';
      const opposite = oppositeRelevant ? effectiveBezierHandle(keys, index, oppositeSide) : null;
      const draggedLength = Math.hypot(dragged[0], dragged[1]);
      const oppositeLength = opposite ? Math.hypot(opposite[0], opposite[1]) : 0;
      if (opposite && draggedLength > 1e-12 && oppositeLength > 1e-12) {
        let aligned: [number, number] = [
          -dragged[0] / draggedLength * oppositeLength,
          -dragged[1] / draggedLength * oppositeLength,
        ];
        let maxDx: number;
        if (oppositeSide === 'left') {
          const previous = keys[index - 1];
          const previousRight = effectiveBezierHandle(keys, index - 1, 'right');
          const minimum = previousRight
            ? THREE.MathUtils.clamp(previous.frame + previousRight[0], previous.frame, key.frame)
            : previous.frame;
          maxDx = key.frame - minimum;
        } else {
          const next = keys[index + 1];
          const nextLeft = effectiveBezierHandle(keys, index + 1, 'left');
          const maximum = nextLeft
            ? THREE.MathUtils.clamp(next.frame + nextLeft[0], key.frame, next.frame)
            : next.frame;
          maxDx = maximum - key.frame;
        }
        if (Math.abs(aligned[0]) > maxDx && Math.abs(aligned[0]) > 1e-12) {
          const scale = maxDx / Math.abs(aligned[0]);
          aligned = [aligned[0] * scale, aligned[1] * scale];
        }
        key[oppositeSide] = aligned;
      }
    }

    this.setAnimationTrack(drag.object, drag.channel, keys);
    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    return { frame: clampedFrame, value: displayValue };
  }

  endAnimationHandleDrag(cancel = false) {
    const drag = this.animationHandleDrag;
    if (!drag) return false;
    this.animationHandleDrag = null;
    if (cancel) {
      this.setAnimationTrack(drag.object, drag.channel, drag.originalTrack);
      this.evaluateAnimation();
      this.emit('animation');
      this.emit('transform');
      this.invalidate();
      return true;
    }
    if (!drag.changed) return false;
    this.commit();
    return true;
  }

  editAnimationHandle(
    frame: number,
    channel: ScalarAnimationChannel,
    side: 'left' | 'right',
    targetFrame: number,
    displayValue: number,
  ) {
    if (!Number.isInteger(frame) || !validAnimationChannel(channel) || (side !== 'left' && side !== 'right') || !Number.isFinite(targetFrame) || !Number.isFinite(displayValue)) {
      throw new Error('Choose a valid Bezier handle with finite Frame / Value coordinates.');
    }
    if (!this.beginAnimationHandleDrag(frame, channel, side)) {
      throw new Error('Choose one editable Bezier handle first.');
    }
    const preview = this.previewAnimationHandleDrag(targetFrame, displayValue);
    if (!preview) {
      this.endAnimationHandleDrag(true);
      throw new Error('The Bezier handle could not be edited.');
    }
    if (Math.abs(preview.frame - targetFrame) > 1e-9) {
      this.endAnimationHandleDrag(true);
      throw new Error('Handle Frame must stay within the editable Bezier segment.');
    }
    const changed = this.endAnimationHandleDrag(false);
    return changed ? preview : false;
  }

  keyObjectTransform(object: THREE.Object3D, frame = Math.round(this.frame)) {
    for (const channel of animationChannels) {
      this.upsertChannelKey(object, channel, frame, this.channelNativeValue(object, channel));
    }
  }

  insertKey() {
    if (!this.selected || this.editMode || this.playing) return false;
    this.keyObjectTransform(this.selected);
    this.commit();
    return true;
  }

  beginAnimationKeyDrag(sourceFrames: number[], anchorFrame: number, channel: ScalarAnimationChannel, copy = false) {
    const uniqueFrames = [...new Set(sourceFrames)].sort((a, b) => a - b);
    if (!uniqueFrames.length || !Number.isFinite(anchorFrame) || !validAnimationChannel(channel) || !this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel);
    if (!uniqueFrames.includes(anchorFrame) || uniqueFrames.some(frame => !keys.some(key => key.frame === frame))) return false;
    this.animationKeyDrag = {
      object: this.selected,
      sourceFrames: uniqueFrames,
      anchorFrame,
      channel,
      copy,
      changed: false,
      originalTrack: keys.map(cloneScalarKey),
    };
    return true;
  }

  previewAnimationKeyDrag(targetFrame: number, channel: ScalarAnimationChannel, displayValue: number) {
    const drag = this.animationKeyDrag;
    if (!drag || channel !== drag.channel || this.selected !== drag.object || this.editMode || this.playing) return false;
    if (!this.authoredFrame(targetFrame) || !Number.isFinite(displayValue)) return false;

    const anchor = drag.originalTrack.find(key => key.frame === drag.anchorFrame);
    if (!anchor) return false;
    const targetValue = channel.startsWith('rotation.') ? THREE.MathUtils.degToRad(displayValue) : displayValue;
    const frameDelta = targetFrame - drag.anchorFrame;
    const valueDelta = targetValue - anchor.value;
    const sourceSet = new Set(drag.sourceFrames);
    const targetFrames = drag.sourceFrames.map(frame => frame + frameDelta);
    const changed = frameDelta !== 0 || Math.abs(valueDelta) > 1e-12;

    const rejectPreview = () => {
      drag.changed = false;
      delete drag.pendingCopy;
      if (!drag.copy) this.setAnimationTrack(drag.object, drag.channel, drag.originalTrack);
      this.frame = drag.anchorFrame;
      this.evaluateAnimation();
      this.emit('frame');
      this.emit('animation');
      this.emit('transform');
      this.invalidate();
      return false;
    };

    if (targetFrames.some(frame => !this.authoredFrame(frame))) return rejectPreview();
    if (new Set(targetFrames).size !== targetFrames.length) return rejectPreview();

    const occupied = new Set(
      drag.originalTrack
        .filter(key => drag.copy || !sourceSet.has(key.frame))
        .map(key => key.frame),
    );
    if (targetFrames.some(frame => occupied.has(frame))) return rejectPreview();

    if (drag.copy) {
      drag.changed = true;
      drag.pendingCopy = { frameDelta, valueDelta };
      this.frame = targetFrame;
      this.evaluateAnimation();
      this.emit('frame');
      this.emit('transform');
      this.invalidate();
      return true;
    }

    if (!changed) return true;
    drag.changed = true;
    const next = drag.originalTrack.map(key => {
      if (!sourceSet.has(key.frame)) return cloneScalarKey(key);
      const edited = cloneScalarKey(key);
      edited.frame += frameDelta;
      edited.value += valueDelta;
      return edited;
    });
    this.setAnimationTrack(drag.object, channel, next);
    this.frame = targetFrame;
    this.evaluateAnimation();
    this.emit('frame');
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    return true;
  }

  endAnimationKeyDrag(cancel = false) {
    const drag = this.animationKeyDrag;
    if (!drag) return false;
    this.animationKeyDrag = null;

    if (cancel) {
      if (!drag.copy) this.setAnimationTrack(drag.object, drag.channel, drag.originalTrack);
      this.scrub(drag.anchorFrame);
      return true;
    }

    if (!drag.changed) return false;

    if (drag.copy) {
      const pending = drag.pendingCopy;
      if (!pending) {
        this.scrub(drag.anchorFrame);
        return false;
      }
      const sourceSet = new Set(drag.sourceFrames);
      const copies = drag.originalTrack
        .filter(key => sourceSet.has(key.frame))
        .map(key => {
          const copied = cloneScalarKey(key);
          copied.frame += pending.frameDelta;
          copied.value += pending.valueDelta;
          return copied;
        });
      this.setAnimationTrack(drag.object, drag.channel, [
        ...drag.originalTrack.map(cloneScalarKey),
        ...copies,
      ]);
      this.frame = drag.anchorFrame + pending.frameDelta;
      this.evaluateAnimation();
      this.emit('animation');
      this.emit('transform');
      this.invalidate();
    }

    this.commit();
    return true;
  }

  moveTimelineKeys(sourceFrames: number[], frameDelta: number) {
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const uniqueFrames = [...new Set(sourceFrames)].sort((a, b) => a - b);
    if (!uniqueFrames.length || uniqueFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Choose authored Timeline keys within frames ${this.animationRangeLabel()}.`);
    }
    if (!Number.isInteger(frameDelta)) throw new Error('Timeline key movement must use whole frames.');
    if (frameDelta === 0) return false;

    const targetFrames = uniqueFrames.map(frame => frame + frameDelta);
    if (targetFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Timeline key move would leave the ${this.animationRangeLabel()} frame range.`);
    }

    const tracks = this.selected.userData.animationTracks as AnimationTrackMap | undefined;
    const sourceSet = new Set(uniqueFrames);
    const authoredFrames = new Set(allAnimationFrames(tracks));
    if (uniqueFrames.some(frame => !authoredFrames.has(frame))) {
      throw new Error('Choose authored Timeline keys first.');
    }

    const movedChannels = animationChannels.filter(channel =>
      trackKeys(tracks, channel).some(key => sourceSet.has(key.frame))
    );
    if (!movedChannels.length) return false;

    for (const channel of movedChannels) {
      const keys = trackKeys(tracks, channel);
      const occupied = new Set(keys.filter(key => !sourceSet.has(key.frame)).map(key => key.frame));
      const targets = keys
        .filter(key => sourceSet.has(key.frame))
        .map(key => key.frame + frameDelta);
      if (targets.some(frame => occupied.has(frame))) {
        const collision = targets.find(frame => occupied.has(frame));
        throw new Error(`Timeline key move would collide on ${channel} at frame ${collision}.`);
      }
    }

    for (const channel of movedChannels) {
      const next = trackKeys(tracks, channel).map(key => {
        const edited = cloneScalarKey(key);
        if (sourceSet.has(edited.frame)) edited.frame += frameDelta;
        return edited;
      });
      this.setAnimationTrack(this.selected, channel, next);
    }

    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return { frames: targetFrames, channels: movedChannels };
  }

  moveTimelineKey(sourceFrame: number, targetFrame: number) {
    if (!this.frameInRange(sourceFrame) || !this.frameInRange(targetFrame)) {
      throw new Error(`Timeline key frames must stay within ${this.animationRangeLabel()}.`);
    }
    if (sourceFrame === targetFrame) {
      this.scrub(sourceFrame);
      return false;
    }
    const moved = this.moveTimelineKeys([sourceFrame], targetFrame - sourceFrame);
    if (!moved) return false;
    this.scrub(targetFrame);
    return moved.channels;
  }

  duplicateTimelineKeys(sourceFrames: number[], frameDelta: number) {
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const uniqueFrames = [...new Set(sourceFrames)].sort((a, b) => a - b);
    if (!uniqueFrames.length || uniqueFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Choose authored Timeline keys within frames ${this.animationRangeLabel()}.`);
    }
    if (!Number.isInteger(frameDelta) || frameDelta === 0) {
      throw new Error('Timeline key duplication must move by at least one whole frame.');
    }

    const targetFrames = uniqueFrames.map(frame => frame + frameDelta);
    if (targetFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Duplicated Timeline keys would leave the ${this.animationRangeLabel()} frame range.`);
    }

    const tracks = this.selected.userData.animationTracks as AnimationTrackMap | undefined;
    const sourceSet = new Set(uniqueFrames);
    const authoredFrames = new Set(allAnimationFrames(tracks));
    if (uniqueFrames.some(frame => !authoredFrames.has(frame))) {
      throw new Error('Choose authored Timeline keys first.');
    }

    const copiedChannels = animationChannels.filter(channel =>
      trackKeys(tracks, channel).some(key => sourceSet.has(key.frame))
    );
    if (!copiedChannels.length) return false;

    for (const channel of copiedChannels) {
      const keys = trackKeys(tracks, channel);
      const occupied = new Set(keys.map(key => key.frame));
      const targets = keys
        .filter(key => sourceSet.has(key.frame))
        .map(key => key.frame + frameDelta);
      if (targets.some(frame => occupied.has(frame))) {
        const collision = targets.find(frame => occupied.has(frame));
        throw new Error(`Timeline key duplication would collide on ${channel} at frame ${collision}.`);
      }
    }

    for (const channel of copiedChannels) {
      const keys = trackKeys(tracks, channel).map(cloneScalarKey);
      const copies = keys
        .filter(key => sourceSet.has(key.frame))
        .map(key => ({ ...cloneScalarKey(key), frame: key.frame + frameDelta }));
      this.setAnimationTrack(this.selected, channel, [...keys, ...copies]);
    }

    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return { frames: targetFrames, channels: copiedChannels };
  }

  removeTimelineKeys(frames: number[]) {
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;
    const uniqueFrames = [...new Set(frames)].sort((a, b) => a - b);
    if (!uniqueFrames.length || uniqueFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Choose authored Timeline keys within frames ${this.animationRangeLabel()}.`);
    }

    const tracks = this.selected.userData.animationTracks as AnimationTrackMap | undefined;
    const sourceSet = new Set(uniqueFrames);
    const authoredFrames = new Set(allAnimationFrames(tracks));
    if (uniqueFrames.some(frame => !authoredFrames.has(frame))) {
      throw new Error('Choose authored Timeline keys first.');
    }

    const changedChannels = animationChannels.filter(channel =>
      trackKeys(tracks, channel).some(key => sourceSet.has(key.frame))
    );
    if (!changedChannels.length) return false;

    for (const channel of changedChannels) {
      const next = trackKeys(tracks, channel)
        .filter(key => !sourceSet.has(key.frame))
        .map(cloneScalarKey);
      this.setAnimationTrack(this.selected, channel, next);
    }

    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return changedChannels;
  }

  scaleTimelineKeyTimes(frames: number[], factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error('Timeline time scale must be a positive finite number.');
    }
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;

    const uniqueFrames = [...new Set(frames)].sort((a, b) => a - b);
    if (uniqueFrames.length < 2 || uniqueFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error('Select at least two authored Timeline keys to scale timing.');
    }

    const tracks = this.selected.userData.animationTracks as AnimationTrackMap | undefined;
    const authoredFrames = new Set(allAnimationFrames(tracks));
    if (uniqueFrames.some(frame => !authoredFrames.has(frame))) {
      throw new Error('Choose authored Timeline keys first.');
    }

    const pivot = (uniqueFrames[0] + uniqueFrames[uniqueFrames.length - 1]) / 2;
    const targetFrames = uniqueFrames.map(frame => Math.round(pivot + (frame - pivot) * factor));
    if (targetFrames.some(frame => !this.frameInRange(frame))) {
      throw new Error(`Scaled Timeline keys would leave the ${this.animationRangeLabel()} frame range.`);
    }
    if (new Set(targetFrames).size !== targetFrames.length) {
      throw new Error('Scaled Timeline keys would collapse onto the same frame.');
    }
    if (targetFrames.every((frame, index) => frame === uniqueFrames[index])) return false;

    const sourceSet = new Set(uniqueFrames);
    const targetBySource = new Map(uniqueFrames.map((frame, index) => [frame, targetFrames[index]]));
    const changedChannels = animationChannels.filter(channel =>
      trackKeys(tracks, channel).some(key => sourceSet.has(key.frame))
    );

    for (const channel of changedChannels) {
      const keys = trackKeys(tracks, channel);
      const occupied = new Set(keys.filter(key => !sourceSet.has(key.frame)).map(key => key.frame));
      const targets = keys
        .filter(key => sourceSet.has(key.frame))
        .map(key => targetBySource.get(key.frame)!);
      if (targets.some(frame => occupied.has(frame))) {
        const collision = targets.find(frame => occupied.has(frame));
        throw new Error(`Scaled Timeline keys would collide on ${channel} at frame ${collision}.`);
      }
    }

    for (const channel of changedChannels) {
      const next = trackKeys(tracks, channel).map(key => {
        const target = targetBySource.get(key.frame);
        if (target === undefined) return cloneScalarKey(key);
        return { ...cloneScalarKey(key), frame: target };
      });
      this.setAnimationTrack(this.selected, channel, next);
    }

    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return { frames: targetFrames, channels: changedChannels };
  }

  scaleChannelKeyTimes(channel: ScalarAnimationChannel, frames: number[], factor: number) {
    if (!validAnimationChannel(channel) || !Number.isFinite(factor) || factor <= 0) {
      throw new Error('Time scale must be a positive finite number.');
    }
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;

    const uniqueFrames = [...new Set(frames)].sort((a, b) => a - b);
    if (uniqueFrames.length < 2 || uniqueFrames.some(frame => !this.authoredFrame(frame))) {
      throw new Error('Select at least two authored channel keys to scale timing.');
    }

    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const sourceSet = new Set(uniqueFrames);
    if (uniqueFrames.some(frame => !keys.some(key => key.frame === frame))) {
      throw new Error('Choose authored channel keys first.');
    }

    const pivot = (uniqueFrames[0] + uniqueFrames[uniqueFrames.length - 1]) / 2;
    const targetFrames = uniqueFrames.map(frame => Math.round(pivot + (frame - pivot) * factor));
    if (targetFrames.some(frame => !this.authoredFrame(frame))) {
      throw new Error(`Scaled keys would leave the supported ${this.authoredFrameLabel()} frame domain.`);
    }
    if (new Set(targetFrames).size !== targetFrames.length) {
      throw new Error('Scaled keys would collapse onto the same frame.');
    }

    const occupied = new Set(keys.filter(key => !sourceSet.has(key.frame)).map(key => key.frame));
    if (targetFrames.some(frame => occupied.has(frame))) {
      throw new Error('Scaled keys would collide with an unselected key.');
    }
    if (targetFrames.every((frame, index) => frame === uniqueFrames[index])) return false;

    const targetBySource = new Map(uniqueFrames.map((frame, index) => [frame, targetFrames[index]]));
    const next = keys.map(key => {
      const target = targetBySource.get(key.frame);
      if (target === undefined) return cloneScalarKey(key);
      const edited = cloneScalarKey(key);
      edited.frame = target;
      return edited;
    });

    this.setAnimationTrack(this.selected, channel, next);
    this.evaluateAnimation();
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return targetFrames;
  }

  removeChannelKeys(channel: ScalarAnimationChannel, frames: number[]) {
    if (!validAnimationChannel(channel) || !this.selected || this.editMode || this.playing) return false;
    const frameSet = new Set(frames.filter(frame => this.authoredFrame(frame)));
    if (!frameSet.size) return false;
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel);
    if (![...frameSet].every(frame => keys.some(key => key.frame === frame))) return false;
    this.setAnimationTrack(this.selected, channel, keys.filter(key => !frameSet.has(key.frame)));
    this.evaluateAnimation();
    this.commit();
    return true;
  }

  editChannelKey(channel: ScalarAnimationChannel, sourceFrame: number, targetFrame: number, displayValue: number) {
    if (!validAnimationChannel(channel) || !Number.isInteger(sourceFrame) || !this.authoredFrame(targetFrame) || !Number.isFinite(displayValue)) {
      throw new Error(`Enter an integer frame within ${this.authoredFrameLabel()} and a finite key value.`);
    }
    if (!this.selected || this.editMode || this.playing || this.animationKeyDrag || this.animationHandleDrag) return false;

    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const sourceIndex = keys.findIndex(key => key.frame === sourceFrame);
    if (sourceIndex < 0) throw new Error('Choose one authored channel key first.');
    if (targetFrame !== sourceFrame && keys.some((key, index) => index !== sourceIndex && key.frame === targetFrame)) {
      throw new Error(`The target frame already has a key on ${channel}.`);
    }

    const targetValue = channel.startsWith('rotation.') ? THREE.MathUtils.degToRad(displayValue) : displayValue;
    const source = keys[sourceIndex];
    const frameChanged = targetFrame !== sourceFrame;
    const valueChanged = Math.abs(targetValue - source.value) > 1e-12;
    if (!frameChanged && !valueChanged) return false;

    const edited = cloneScalarKey(source);
    edited.frame = targetFrame;
    edited.value = targetValue;
    keys[sourceIndex] = edited;
    this.setAnimationTrack(this.selected, channel, keys);

    this.frame = targetFrame;
    this.evaluateAnimation();
    this.emit('frame');
    this.emit('animation');
    this.emit('transform');
    this.invalidate();
    this.commit();
    return { frame: targetFrame, value: displayValue };
  }

  editKeyChannel(channel: ScalarAnimationChannel, displayValue: number) {
    if (!Number.isFinite(displayValue)) throw new Error('Enter a finite channel value.');
    if (!this.selected || this.editMode || this.playing) throw new Error('Select an object in Object Mode and pause playback first.');
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const frame = Math.round(this.frame);
    const key = keys.find(item => item.frame === frame);
    if (!key) throw new Error('Move to an existing channel key first.');
    const value = channel.startsWith('rotation.') ? THREE.MathUtils.degToRad(displayValue) : displayValue;
    if (Math.abs(key.value - value) < 1e-12) return;
    key.value = value;
    this.setAnimationTrack(this.selected, channel, keys);
    this.scrub(frame);
    this.commit();
  }

  retimeChannelKey(channel: ScalarAnimationChannel, targetFrame: number, copy = false) {
    if (!validAnimationChannel(channel) || !this.authoredFrame(targetFrame)) {
      throw new Error(`Choose a supported channel and integer frame within ${this.authoredFrameLabel()}.`);
    }
    if (!this.selected || this.editMode || this.playing) throw new Error('Select an object in Object Mode and pause playback first.');
    const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel).map(cloneScalarKey);
    const sourceFrame = Math.round(this.frame);
    const source = keys.find(key => key.frame === sourceFrame);
    if (!source) throw new Error('Move to an existing channel key first.');
    if (!copy && targetFrame === sourceFrame) return;
    if (keys.some(key => key.frame === targetFrame)) throw new Error('The target frame already has a key on this channel.');
    const next = copy ? keys : keys.filter(key => key.frame !== sourceFrame);
    next.push({ ...cloneScalarKey(source), frame: targetFrame });
    this.setAnimationTrack(this.selected, channel, next);
    this.scrub(targetFrame);
    this.commit();
  }

  removeKey() {
    if (!this.selected) return;
    const frame = Math.round(this.frame);
    for (const channel of animationChannels) {
      const keys = trackKeys(this.selected.userData.animationTracks as AnimationTrackMap | undefined, channel);
      if (keys.some(key => key.frame === frame)) {
        this.setAnimationTrack(this.selected, channel, keys.filter(key => key.frame !== frame));
      }
    }
    this.evaluateAnimation();
    this.commit();
  }

  scrub(frame: number) {
    if (this.weightMode) return false;
    this.frame = THREE.MathUtils.clamp(frame, this.frameStart, this.frameEnd);
    this.evaluateAnimation();
    this.emit('frame');
    this.emit('transform');
    this.invalidate();
    return true;
  }
  togglePlayback() {
    if (this.weightMode) return false;
    this.setEditMode(false);
    this.playing = !this.playing;
    const playback = this.playbackRange;
    this.frame = THREE.MathUtils.clamp(this.frame, playback.start, playback.end);
    this.playbackStart = performance.now();
    this.playbackFrame = this.frame;
    this.emit('frame');
    this.invalidate();
    return true;
  }

  evaluateAnimation() {
    this.content.traverse(object => {
      const tracks = object.userData.animationTracks as AnimationTrackMap | undefined;
      if (!tracks || !Object.values(tracks).some(keys => keys?.length)) return;

      const position = [object.position.x, object.position.y, object.position.z];
      const rotation = [object.rotation.x, object.rotation.y, object.rotation.z];
      const scale = [object.scale.x, object.scale.y, object.scale.z];

      (['x','y','z'] as const).forEach((axis, component) => {
        const positionChannel = `position.${axis}` as ScalarAnimationChannel;
        const rotationChannel = `rotation.${axis}` as ScalarAnimationChannel;
        const scaleChannel = `scale.${axis}` as ScalarAnimationChannel;
        if (trackKeys(tracks, positionChannel).length) position[component] = sampleAnimationChannel(tracks, this.frame, positionChannel, position[component]);
        if (trackKeys(tracks, rotationChannel).length) rotation[component] = sampleAnimationChannel(tracks, this.frame, rotationChannel, rotation[component]);
        if (trackKeys(tracks, scaleChannel).length) scale[component] = sampleAnimationChannel(tracks, this.frame, scaleChannel, scale[component]);
      });

      object.position.set(position[0], position[1], position[2]);
      object.rotation.set(rotation[0], rotation[1], rotation[2], object.rotation.order);
      object.scale.set(scale[0], scale[1], scale[2]);
    });
    this.updateSelection();
  }

  stats() {
    let vertices = 0, triangles = 0;
    this.content.traverse(o => {
      if (o instanceof THREE.Mesh && o.userData.forgeEditorHelper !== true) {
        vertices += o.geometry.getAttribute('position')?.count ?? 0;
        triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3;
      }
    });
    return { objects: this.content.children.filter(object => !this.isCollection(object)).length + this.collections.reduce((count, collection) => count + collection.children.length, 0), vertices, triangles: Math.round(triangles), calls: this.renderer.info.render.calls, frames: this.renderedFrames };
  }
}
