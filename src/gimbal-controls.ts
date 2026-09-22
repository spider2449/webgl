import * as THREE from 'three';

export type GimbalAxis = 'X' | 'Y' | 'Z';

type DragState = {
  axis: GimbalAxis;
  axisWorld: THREE.Vector3;
  center: THREE.Vector3;
  previous: THREE.Vector3;
  start: THREE.Vector3;
  angle: number;
};

export class GimbalControls {
  readonly group = new THREE.Group();
  private readonly rings = new Map<GimbalAxis, THREE.LineLoop>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly parentWorld = new THREE.Quaternion();
  private readonly partial = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private drag: DragState | null = null;
  private object: THREE.Object3D | null = null;
  private camera: THREE.Camera;
  enabled = false;
  rotationSnap: number | null = null;
  onChange: (() => void) | null = null;
  onCommit: (() => void) | null = null;
  onDraggingChange: ((dragging: boolean) => void) | null = null;

  constructor(private readonly host: HTMLElement, camera: THREE.Camera) {
    this.camera = camera;
    this.group.visible = false;
    this.group.renderOrder = 1000;
    const definitions: [GimbalAxis, number, number][] = [
      ['X', 1.00, 0xff5d5d],
      ['Y', 0.92, 0x63d471],
      ['Z', 0.84, 0x5f8cff],
    ];
    for (const [axis, radius, color] of definitions) {
      const points = Array.from({ length: 96 }, (_, index) => {
        const angle = index / 96 * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      const ring = new THREE.LineLoop(geometry, material);
      ring.userData.gimbalAxis = axis;
      ring.renderOrder = 1001;
      this.rings.set(axis, ring);
      this.group.add(ring);
    }

    const canvas = host.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Gimbal controls require the viewport canvas.');
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointermove', this.pointerMove, true);
    canvas.addEventListener('pointerup', this.pointerUp, true);
    canvas.addEventListener('pointercancel', this.pointerUp, true);
  }

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
    this.update();
  }

  attach(object: THREE.Object3D | null) {
    this.object = object;
    this.update();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.drag = null;
    this.update();
  }

  update() {
    const object = this.object;
    this.group.visible = this.enabled && !!object?.visible;
    if (!this.group.visible || !object) return;

    object.updateWorldMatrix(true, false);
    object.getWorldPosition(this.center);
    this.group.position.copy(this.center);
    this.group.quaternion.identity();

    const distance = this.camera.position.distanceTo(this.center);
    const scale = this.camera instanceof THREE.OrthographicCamera
      ? Math.max(0.5, (this.camera.top - this.camera.bottom) * 0.09 / this.camera.zoom)
      : Math.max(0.25, distance * 0.085);
    this.group.scale.setScalar(scale);

    const axes = this.gimbalAxesWorld(object);
    const normal = new THREE.Vector3(0, 0, 1);
    for (const key of ['X', 'Y', 'Z'] as const) {
      this.rings.get(key)!.quaternion.setFromUnitVectors(normal, axes[key]);
    }
    this.group.updateMatrixWorld(true);
  }

  private gimbalAxesWorld(object: THREE.Object3D): Record<GimbalAxis, THREE.Vector3> {
    const order = object.rotation.order;
    const values: Record<GimbalAxis, number> = {
      X: object.rotation.x,
      Y: object.rotation.y,
      Z: object.rotation.z,
    };
    const units: Record<GimbalAxis, THREE.Vector3> = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
    const parent = object.parent;
    if (parent) parent.getWorldQuaternion(this.parentWorld);
    else this.parentWorld.identity();

    this.partial.identity();
    const result = {} as Record<GimbalAxis, THREE.Vector3>;
    for (const character of order) {
      const axis = character as GimbalAxis;
      result[axis] = units[axis].clone().applyQuaternion(this.partial).applyQuaternion(this.parentWorld).normalize();
      this.partial.multiply(new THREE.Quaternion().setFromAxisAngle(units[axis], values[axis]));
    }
    return result;
  }

  private rayFromEvent(event: PointerEvent) {
    const rect = this.host.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.enabled || !this.object || event.button !== 0) return;
    this.update();
    this.rayFromEvent(event);
    const distance = this.camera.position.distanceTo(this.center);
    this.raycaster.params.Line = { threshold: Math.max(0.04, distance * 0.012) };
    const intersection = this.raycaster.intersectObjects([...this.rings.values()], false)[0];
    const axis = intersection?.object.userData.gimbalAxis as GimbalAxis | undefined;
    if (!axis) return;

    const axisWorld = this.gimbalAxesWorld(this.object)[axis].clone();
    this.plane.setFromNormalAndCoplanarPoint(axisWorld, this.center);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;
    const previous = this.hit.clone().sub(this.center).normalize();
    if (!Number.isFinite(previous.x) || previous.lengthSq() < 0.5) return;

    this.drag = {
      axis,
      axisWorld,
      center: this.center.clone(),
      previous,
      start: new THREE.Vector3(this.object.rotation.x, this.object.rotation.y, this.object.rotation.z),
      angle: 0,
    };
    this.onDraggingChange?.(true);
    event.preventDefault();
    event.stopImmediatePropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || !this.object) return;
    this.rayFromEvent(event);
    this.plane.setFromNormalAndCoplanarPoint(drag.axisWorld, drag.center);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;
    const current = this.hit.clone().sub(drag.center).normalize();
    if (!Number.isFinite(current.x) || current.lengthSq() < 0.5) return;

    const cross = drag.previous.clone().cross(current);
    const step = Math.atan2(drag.axisWorld.dot(cross), THREE.MathUtils.clamp(drag.previous.dot(current), -1, 1));
    drag.angle += step;
    drag.previous.copy(current);

    const applied = this.rotationSnap
      ? Math.round(drag.angle / this.rotationSnap) * this.rotationSnap
      : drag.angle;
    const next = drag.start.clone();
    const component = drag.axis.toLowerCase() as 'x' | 'y' | 'z';
    next[component] += applied;
    this.object.rotation.set(next.x, next.y, next.z, this.object.rotation.order);
    this.update();
    this.onChange?.();

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private pointerUp = (event: PointerEvent) => {
    if (!this.drag) return;
    this.drag = null;
    this.onDraggingChange?.(false);
    this.onCommit?.();
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };
}
