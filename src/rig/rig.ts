import * as THREE from 'three';
import type { Editor } from '../editor';

type RestPose = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
};

type RigVisual = {
  root: THREE.Group;
  joints: THREE.InstancedMesh;
  lines: THREE.LineSegments;
  bones: THREE.Bone[];
};

function hasBone(object: THREE.Object3D) {
  let found = false;
  object.traverse(child => { if (child instanceof THREE.Bone) found = true; });
  return found;
}

function captureRest(bone: THREE.Bone) {
  bone.userData.forgeRestPose = {
    position: bone.position.toArray(),
    quaternion: bone.quaternion.toArray(),
    scale: bone.scale.toArray(),
  } satisfies RestPose;
}

function readRest(bone: THREE.Bone): RestPose | null {
  const value = bone.userData.forgeRestPose as Partial<RestPose> | undefined;
  if (
    !value ||
    !Array.isArray(value.position) || value.position.length !== 3 ||
    !Array.isArray(value.quaternion) || value.quaternion.length !== 4 ||
    !Array.isArray(value.scale) || value.scale.length !== 3 ||
    ![...value.position, ...value.quaternion, ...value.scale].every(Number.isFinite)
  ) return null;
  return value as RestPose;
}

export function rigBones(rig: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  rig.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  return bones;
}

export function createArmature(name = 'Armature') {
  const rig = new THREE.Group();
  rig.name = name;
  rig.userData.forgeRig = { type: 'armature', version: 1 };

  const root = new THREE.Bone();
  root.name = 'Root';
  captureRest(root);
  rig.add(root);
  rig.updateMatrixWorld(true);
  return rig;
}

function uniqueBoneName(rig: THREE.Object3D, base = 'Bone') {
  const names = new Set(rigBones(rig).map(bone => bone.name));
  if (!names.has(base)) return base;
  let index = 1;
  while (names.has(`${base}.${String(index).padStart(3, '0')}`)) index++;
  return `${base}.${String(index).padStart(3, '0')}`;
}

function rootForSelection(content: THREE.Group, object: THREE.Object3D | null) {
  let node = object;
  while (node && node.parent && node.parent !== content) node = node.parent;
  return node && node.parent === content && hasBone(node) ? node : null;
}

export class RigSystem {
  private visuals = new Map<THREE.Object3D, RigVisual>();
  private ikTarget = new THREE.Object3D();
  private ikEnd: THREE.Bone | null = null;
  private ikChain: THREE.Bone[] = [];
  private worker: Worker | null = null;
  private preferredRigUuid: string | null = null;

  constructor(readonly editor: Editor) {
    this.ikTarget.name = 'IK Target';
    editor.scene.add(this.ikTarget);
    editor.beforeRender = () => this.updateVisuals();
    editor.pickOverride = raycaster => this.pick(raycaster);
    editor.transform.addEventListener('objectChange', () => {
      if (this.ikEnd && editor.transform.object === this.ikTarget) this.solveIK();
    });
    editor.addEventListener('change', () => {
      if (editor.transform.object !== this.ikTarget) this.ikEnd = null;
      const selectedRig = rootForSelection(editor.content, editor.selected);
      if (selectedRig) this.preferredRigUuid = selectedRig.uuid;
      this.sync();
    });
    this.sync();
  }

  get rigs() {
    return this.editor.content.children.filter(hasBone);
  }

  get activeRig(): THREE.Object3D | null {
    const selectedRig = rootForSelection(this.editor.content, this.editor.selected);
    if (selectedRig) return selectedRig;
    const preferred = this.preferredRigUuid
      ? this.editor.content.getObjectByProperty('uuid', this.preferredRigUuid)
      : null;
    if (preferred && preferred.parent === this.editor.content && hasBone(preferred)) return preferred;
    return this.rigs[0] ?? null;
  }

  setActiveRig(rig: THREE.Object3D) {
    if (rig.parent !== this.editor.content || !hasBone(rig)) throw new Error('Choose a scene armature.');
    this.preferredRigUuid = rig.uuid;
    this.editor.select(rig);
  }

  add() {
    const rig = createArmature(this.editor.uniqueName('Armature'));
    this.editor.content.add(rig);
    this.preferredRigUuid = rig.uuid;
    this.editor.select(rig);
    this.editor.commit();
    this.editor.focus();
    return rig;
  }

  addBone() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    const bones = rigBones(rig);
    const selected = this.editor.selected;
    const parent = selected instanceof THREE.Bone && bones.includes(selected)
      ? selected
      : bones.find(bone => !(bone.parent instanceof THREE.Bone));
    if (!parent) throw new Error('The armature has no root bone.');

    const bone = new THREE.Bone();
    bone.name = uniqueBoneName(rig);
    bone.position.set(0, 0.25, 0);
    captureRest(bone);
    parent.add(bone);
    rig.updateMatrixWorld(true);
    this.editor.select(bone);
    this.editor.commit();
    return bone;
  }

  setRestPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    const bones = rigBones(rig);
    if (!bones.length) throw new Error('The armature has no bones.');
    for (const bone of bones) captureRest(bone);
    rig.userData.forgeRig = { type: 'armature', version: 1 };
    this.editor.commit();
  }

  resetPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    const bones = rigBones(rig);
    const poses = bones.map(readRest);
    if (poses.some(pose => !pose)) throw new Error('Set a Forge rest pose for this armature first.');

    bones.forEach((bone, index) => {
      const pose = poses[index]!;
      bone.position.fromArray(pose.position);
      bone.quaternion.fromArray(pose.quaternion);
      bone.scale.fromArray(pose.scale);
    });
    this.ikEnd = null;
    rig.updateMatrixWorld(true);
    this.editor.select(rig);
    this.editor.commit();
  }

  keyPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    const bones = rigBones(rig);
    if (!bones.length) throw new Error('The armature has no bones.');
    const frame = Math.round(this.editor.frame);
    for (const bone of bones) this.editor.keyObjectTransform(bone, frame);
    this.editor.commit();
  }

  enableIK() {
    const rig = this.activeRig;
    const end = this.editor.selected;
    if (!rig || !(end instanceof THREE.Bone) || !rigBones(rig).includes(end)) {
      throw new Error('Select an end bone in the active armature first.');
    }
    if (!(end.parent instanceof THREE.Bone) || !(end.parent.parent instanceof THREE.Bone)) {
      throw new Error('IK requires the selected bone to have a parent and grandparent bone.');
    }

    this.editor.playing = false;
    this.ikEnd = end;
    this.ikChain = [end.parent, end.parent.parent];
    end.getWorldPosition(this.ikTarget.position);
    this.editor.transform.setMode('translate');
    this.editor.transform.setSpace('world');
    this.editor.transform.attach(this.ikTarget);
    this.editor.invalidate();
  }

  sync() {
    const current = new Set(this.rigs);
    for (const [rig, visual] of this.visuals) {
      if (current.has(rig)) continue;
      visual.root.removeFromParent();
      visual.joints.geometry.dispose();
      (visual.joints.material as THREE.Material).dispose();
      visual.lines.geometry.dispose();
      (visual.lines.material as THREE.Material).dispose();
      this.visuals.delete(rig);
    }

    for (const rig of current) {
      const bones = rigBones(rig);
      const existing = this.visuals.get(rig);
      if (existing && existing.bones.length === bones.length && existing.bones.every((bone, i) => bone === bones[i])) continue;
      if (existing) {
        existing.root.removeFromParent();
        existing.joints.geometry.dispose();
        (existing.joints.material as THREE.Material).dispose();
        existing.lines.geometry.dispose();
        (existing.lines.material as THREE.Material).dispose();
        this.visuals.delete(rig);
      }

      const root = new THREE.Group();
      root.name = 'Armature helpers';
      const joints = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 }),
        bones.length,
      );
      joints.renderOrder = 21;
      joints.frustumCulled = false;

      const segmentCount = bones.filter(bone => bone.parent instanceof THREE.Bone).length;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xaac9c7, depthTest: false, transparent: true, opacity: 0.85 }),
      );
      lines.renderOrder = 20;
      lines.frustumCulled = false;

      root.add(joints, lines);
      this.editor.scene.add(root);
      this.visuals.set(rig, { root, joints, lines, bones });
    }
    this.updateVisuals();
  }

  updateVisuals() {
    this.editor.content.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const parentPosition = new THREE.Vector3();

    for (const [rig, visual] of this.visuals) {
      visual.root.visible = rig.visible;
      const linePositions = visual.lines.geometry.getAttribute('position');
      const points = visual.bones.map(bone => bone.getWorldPosition(new THREE.Vector3()));
      const bounds = new THREE.Box3();
      for (const point of points) bounds.expandByPoint(point);
      const diagonal = bounds.isEmpty() ? 1 : bounds.getSize(new THREE.Vector3()).length();
      const radius = THREE.MathUtils.clamp(diagonal * 0.012, 0.005, 0.05);

      let line = 0;
      visual.bones.forEach((bone, index) => {
        bone.getWorldPosition(position);
        const selected = this.editor.selected === bone;
        const jointRadius = radius * (selected ? 1.5 : 1);
        matrix.makeScale(jointRadius, jointRadius, jointRadius);
        matrix.setPosition(position);
        visual.joints.setMatrixAt(index, matrix);
        visual.joints.setColorAt(index, new THREE.Color(selected ? 0xffc17b : 0xc3c8bd));

        if (bone.parent instanceof THREE.Bone) {
          bone.parent.getWorldPosition(parentPosition);
          linePositions.setXYZ(line++, parentPosition.x, parentPosition.y, parentPosition.z);
          linePositions.setXYZ(line++, position.x, position.y, position.z);
        }
      });

      visual.joints.instanceMatrix.needsUpdate = true;
      if (visual.joints.instanceColor) visual.joints.instanceColor.needsUpdate = true;
      linePositions.needsUpdate = true;
      visual.joints.computeBoundingSphere();
    }
  }

  private pick(raycaster: THREE.Raycaster): THREE.Object3D | null {
    for (const [rig, visual] of this.visuals) {
      if (!rig.visible) continue;
      const hit = raycaster.intersectObject(visual.joints)[0];
      if (hit?.instanceId !== undefined) {
        this.preferredRigUuid = rig.uuid;
        return visual.bones[hit.instanceId];
      }
    }
    return null;
  }

  private solveIK() {
    if (!this.ikEnd) return;
    const target = this.ikTarget.position;
    for (let iteration = 0; iteration < 16; iteration++) {
      for (const bone of this.ikChain) {
        this.editor.content.updateMatrixWorld(true);
        const origin = bone.getWorldPosition(new THREE.Vector3());
        const endpoint = this.ikEnd.getWorldPosition(new THREE.Vector3());
        const from = endpoint.sub(origin);
        const to = target.clone().sub(origin);
        if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue;
        from.normalize();
        to.normalize();

        const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        bone.quaternion.copy(parentWorld.multiply(delta).multiply(world)).normalize();
      }
      this.editor.content.updateMatrixWorld(true);
      if (this.ikEnd.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 0.001) break;
    }
    this.editor.emit('transform');
    this.editor.invalidate();
  }

  async bindSelected() {
    if (this.worker) throw new Error('A skin binding job is already running.');
    const mesh = this.editor.selected;
    const rig = this.activeRig;
    if (!(mesh instanceof THREE.Mesh) || mesh instanceof THREE.SkinnedMesh || mesh.parent !== this.editor.content) {
      throw new Error('Select a standalone mesh to bind.');
    }
    if (mesh.userData.modifierStack || this.editor.modelingBusy) {
      throw new Error('Apply modifiers and finish modeling before skin binding.');
    }
    if (!rig) throw new Error('Create or select an armature first.');

    const bones = rigBones(rig);
    if (bones.length > 65535) throw new Error('Skin binding supports at most 65,535 bones.');
    if (!bones.some(bone => bone.parent instanceof THREE.Bone)) {
      throw new Error('Skin binding requires at least one connected bone segment.');
    }

    const poses = bones.map(readRest);
    if (poses.some(pose => !pose)) throw new Error('Set a Forge rest pose for this armature before binding.');
    const atRest = bones.every((bone, index) => {
      const pose = poses[index]!;
      return (
        bone.position.distanceTo(new THREE.Vector3().fromArray(pose.position)) <= 1e-5 &&
        bone.quaternion.angleTo(new THREE.Quaternion().fromArray(pose.quaternion)) <= 1e-5 &&
        bone.scale.distanceTo(new THREE.Vector3().fromArray(pose.scale)) <= 1e-5
      );
    });
    if (!atRest) throw new Error('Reset the armature to its Forge rest pose before binding.');

    const attribute = mesh.geometry.getAttribute('position');
    if (!attribute) throw new Error('The selected mesh has no position attribute.');
    if (attribute.count > 100_000) throw new Error('Automatic binding supports up to 100,000 vertices per mesh.');

    this.editor.setEditMode(false);
    this.editor.content.updateMatrixWorld(true);
    const checkpoint = this.editor.snapshot();
    const positions = new Float32Array(attribute.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    }

    const boneIndex = new Map(bones.map((bone, index) => [bone, index]));
    const segments: number[] = [];
    for (const child of bones) {
      if (!(child.parent instanceof THREE.Bone)) continue;
      const parentIndex = boneIndex.get(child.parent);
      if (parentIndex === undefined) continue;
      const start = child.parent.getWorldPosition(new THREE.Vector3());
      const end = child.getWorldPosition(new THREE.Vector3());
      segments.push(...start.toArray(), ...end.toArray(), parentIndex);
    }
    const segmentArray = new Float32Array(segments);

    this.worker = new Worker(new URL('./weights.worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<{ indices: Uint16Array; weights: Float32Array }>((resolve, reject) => {
        this.worker!.onmessage = event => resolve(event.data);
        this.worker!.onerror = () => reject(new Error('The skinning worker failed.'));
        this.worker!.postMessage({ positions, segments: segmentArray }, [positions.buffer, segmentArray.buffer]);
      });

      if (checkpoint !== this.editor.snapshot()) {
        throw new Error('The scene changed during binding. Run the binding again.');
      }

      const geometry = new THREE.BufferGeometry().copy(mesh.geometry);
      geometry.applyMatrix4(new THREE.Matrix4().copy(rig.matrixWorld).invert().multiply(mesh.matrixWorld));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(result.indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(result.weights, 4));
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(item => item.clone())
        : mesh.material.clone();
      const skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.name = mesh.name;
      skinned.frustumCulled = false;

      rig.add(skinned);
      rig.updateMatrixWorld(true);
      skinned.bind(new THREE.Skeleton(bones));
      mesh.removeFromParent();
      this.editor.disposeObject(mesh);
      this.preferredRigUuid = rig.uuid;
      this.editor.select(skinned);
      this.editor.commit();
      return skinned;
    } finally {
      this.worker?.terminate();
      this.worker = null;
    }
  }
}
