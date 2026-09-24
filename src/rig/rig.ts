import * as THREE from 'three';
import type { Editor } from '../editor';
export type ArmatureMode = 'edit' | 'pose';

export type ForgeArmatureMetadata = {
  type: 'armature';
  version: 1;
  preset?: string;
  [key: string]: unknown;
};

export function isForgeArmature(object: THREE.Object3D): boolean {
  const metadata = object.userData.forgeRig as Record<string, unknown> | undefined;
  return metadata?.type === 'armature' || typeof metadata?.skeleton === 'string';
}

export function rigBones(rig: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  rig.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  return bones;
}

export function createArmature(name = 'Armature'): THREE.Group {
  const rig = new THREE.Group();
  rig.name = name;
  rig.userData.forgeRig = { type: 'armature', version: 1 } satisfies ForgeArmatureMetadata;
  return rig;
}

function captureBoneRest(bone: THREE.Bone) {
  bone.userData.restPosition = bone.position.toArray();
  bone.userData.restQuaternion = bone.quaternion.toArray();
  bone.userData.restScale = bone.scale.toArray();
}

export function captureRestPose(rig: THREE.Object3D) {
  for (const bone of rigBones(rig)) captureBoneRest(bone);
}

export function createNativeArmature(): THREE.Group {
  const rig = createArmature();
  const root = new THREE.Bone();
  root.name = 'Bone';
  rig.add(root);
  captureRestPose(rig);
  return rig;
}

function restTransform(bone: THREE.Bone) {
  const position = bone.userData.restPosition;
  const quaternion = bone.userData.restQuaternion;
  const scale = bone.userData.restScale ?? [1, 1, 1];
  if (
    !Array.isArray(position) || position.length !== 3 || position.some(value => !Number.isFinite(value)) ||
    !Array.isArray(quaternion) || quaternion.length !== 4 || quaternion.some(value => !Number.isFinite(value)) ||
    !Array.isArray(scale) || scale.length !== 3 || scale.some(value => !Number.isFinite(value))
  ) throw new Error(`Bone "${bone.name || bone.uuid}" has no valid Forge rest pose.`);
  return { position, quaternion, scale };
}

type RigVisual = { root: THREE.Group; joints: THREE.InstancedMesh; lines: THREE.LineSegments; bones: THREE.Bone[] };
export class RigSystem {
  private visuals = new Map<THREE.Object3D, RigVisual>();
  private ikTarget = new THREE.Object3D();
  private ikEnd: THREE.Bone | null = null;
  private ikChain: THREE.Bone[] = [];
  private worker: Worker | null = null;
  private editRig: THREE.Object3D | null = null;
  private weightMesh: THREE.SkinnedMesh | null = null;
  private weightBoneIndex = 0;
  constructor(readonly editor: Editor) {
    editor.scene.add(this.ikTarget);
    editor.beforeRender = () => this.updateVisuals();
    editor.pickOverride = raycaster => this.pick(raycaster);
    editor.transform.addEventListener('objectChange', () => { if (this.ikEnd && editor.transform.object === this.ikTarget) this.solveIK(); });
    editor.addEventListener('change', () => {
      if (editor.transform.object !== this.ikTarget) this.ikEnd = null;
      if (this.weightMesh && (!editor.weightMode || editor.selected !== this.weightMesh)) {
        this.weightMesh = null;
        this.weightBoneIndex = 0;
      }
      this.sync();
    });
    editor.addEventListener('transform', () => {
      const bone = editor.selected;
      if (!editor.playing && bone instanceof THREE.Bone && this.editRig && this.rigFor(bone) === this.editRig) captureBoneRest(bone);
    });
    this.sync();
  }
  get rigs() { return this.editor.content.children.filter(isForgeArmature); }
  get activeRig(): THREE.Object3D | null {
    let node = this.editor.selected;
    while (node) { if (isForgeArmature(node)) return node; node = node.parent; }
    return this.rigs[0] ?? null;
  }
  get mode(): ArmatureMode {
    return this.activeRig && this.activeRig === this.editRig ? 'edit' : 'pose';
  }
  get weightEditing() { return !!this.weightMesh && this.editor.weightMode && this.editor.selected === this.weightMesh; }
  get activeWeightMesh() { return this.weightEditing ? this.weightMesh : null; }
  get weightBones() { return this.activeWeightMesh?.skeleton.bones ?? []; }
  get activeWeightBone() { return this.weightBones[this.weightBoneIndex] ?? null; }
  private rigFor(object: THREE.Object3D | null): THREE.Object3D | null {
    let node = object;
    while (node) {
      if (isForgeArmature(node)) return node;
      node = node.parent;
    }
    return null;
  }
  private rigHasSkin(rig: THREE.Object3D) {
    let found = false;
    rig.traverse(object => { if (object instanceof THREE.SkinnedMesh) found = true; });
    return found;
  }
  private rigHasAnimation(rig: THREE.Object3D) {
    return rigBones(rig).some(bone => {
      const tracks = bone.userData.animationTracks as Record<string, unknown> | undefined;
      return !!tracks && Object.values(tracks).some(track => Array.isArray(track) && track.length > 0);
    });
  }
  private assertEditableRig(rig: THREE.Object3D) {
    const metadata = rig.userData.forgeRig as ForgeArmatureMetadata | undefined;
    if (metadata?.preset || typeof metadata?.skeleton === 'string') throw new Error('Preset armatures are pose-only. Create a Forge armature to edit its hierarchy.');
    if (this.rigHasSkin(rig)) throw new Error('Armature Edit mode is unavailable after skin binding. Edit the rest skeleton before binding.');
    if (this.rigHasAnimation(rig)) throw new Error('Armature Edit mode is unavailable after bone animation is authored. Edit the rest skeleton before keying poses.');
  }
  private applyRestPose(rig: THREE.Object3D) {
    const bones = rigBones(rig);
    const rest = bones.map(restTransform);
    bones.forEach((bone, index) => {
      bone.position.fromArray(rest[index].position);
      bone.quaternion.fromArray(rest[index].quaternion);
      bone.scale.fromArray(rest[index].scale);
    });
  }
  private uniqueBoneName(rig: THREE.Object3D, base = 'Bone') {
    const names = new Set(rigBones(rig).map(bone => bone.name));
    if (!names.has(base)) return base;
    let index = 1;
    while (names.has(`${base}.${String(index).padStart(3, '0')}`)) index++;
    return `${base}.${String(index).padStart(3, '0')}`;
  }
  add(armature: THREE.Group = createNativeArmature()) {
    const rig = armature;
    this.editRig = null;
    if (!isForgeArmature(rig)) throw new Error('The object is not a Forge armature.');
    if (!rigBones(rig).length) throw new Error('An armature must contain at least one bone.');
    rig.name = this.editor.uniqueName(rig.name || 'Armature');
    this.editor.content.add(rig);
    this.editor.select(rig);
    this.editor.commit();
    this.editor.focus();
    return rig;
  }
  setMode(mode: ArmatureMode) {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    if (mode === 'edit') {
      this.assertEditableRig(rig);
      this.editor.playing = false;
      this.applyRestPose(rig);
      this.editRig = rig;
      this.ikEnd = null;
      const selected = this.editor.selected;
      const bone = selected instanceof THREE.Bone && this.rigFor(selected) === rig ? selected : rigBones(rig)[0];
      this.editor.select(bone ?? rig);
      this.editor.commit();
    } else {
      this.editRig = null;
      this.ikEnd = null;
      this.editor.emit();
      this.editor.invalidate();
    }
  }
  captureEditedRest() {
    const bone = this.editor.selected;
    if (!(bone instanceof THREE.Bone) || !this.editRig || this.rigFor(bone) !== this.editRig) return false;
    captureBoneRest(bone);
    return true;
  }
  addRootBone() {
    const rig = this.activeRig;
    if (!rig || this.editRig !== rig) throw new Error('Switch the active armature to Edit mode first.');
    this.assertEditableRig(rig);
    const roots = rigBones(rig).filter(bone => !(bone.parent instanceof THREE.Bone));
    const bone = new THREE.Bone();
    bone.name = this.uniqueBoneName(rig);
    bone.position.set(roots.length, 0, 0);
    rig.add(bone);
    captureBoneRest(bone);
    this.editor.select(bone);
    this.editor.commit();
    return bone;
  }
  extrudeSelectedBone(length = 1) {
    const rig = this.activeRig;
    if (!rig || this.editRig !== rig) throw new Error('Switch the active armature to Edit mode first.');
    this.assertEditableRig(rig);
    const parent = this.editor.selected;
    if (!(parent instanceof THREE.Bone) || this.rigFor(parent) !== rig) throw new Error('Select a bone to extrude.');
    if (!Number.isFinite(length) || length <= 0) throw new Error('Bone extrusion length must be positive.');
    const bone = new THREE.Bone();
    bone.name = this.uniqueBoneName(rig);
    bone.position.set(0, length, 0);
    parent.add(bone);
    captureBoneRest(bone);
    this.editor.select(bone);
    this.editor.commit();
    return bone;
  }
  reparentSelectedBone(parent: THREE.Bone | null) {
    const rig = this.activeRig;
    if (!rig || this.editRig !== rig) throw new Error('Switch the active armature to Edit mode first.');
    this.assertEditableRig(rig);
    const bone = this.editor.selected;
    if (!(bone instanceof THREE.Bone) || this.rigFor(bone) !== rig) throw new Error('Select a bone to reparent.');
    const bones = rigBones(rig);
    if (parent && !bones.includes(parent)) throw new Error('Choose a parent bone from the active armature.');
    let node: THREE.Object3D | null = parent;
    while (node) {
      if (node === bone) throw new Error('A bone cannot be parented to itself or one of its descendants.');
      node = node.parent;
    }
    const target: THREE.Object3D = parent ?? rig;
    if (bone.parent === target) return bone;
    this.editor.content.updateMatrixWorld(true);
    target.attach(bone);
    captureBoneRest(bone);
    this.editor.select(bone);
    this.editor.commit();
    return bone;
  }
  deleteSelectedBone() {
    const rig = this.activeRig;
    if (!rig || this.editRig !== rig) throw new Error('Switch the active armature to Edit mode first.');
    this.assertEditableRig(rig);
    const bone = this.editor.selected;
    if (!(bone instanceof THREE.Bone) || this.rigFor(bone) !== rig) throw new Error('Select a bone to delete.');
    const bones = rigBones(rig);
    if (bones.length <= 1) throw new Error('An armature must keep at least one bone.');

    const targetParent: THREE.Object3D = bone.parent instanceof THREE.Bone ? bone.parent : rig;
    const children = [...bone.children];
    this.editor.content.updateMatrixWorld(true);
    for (const child of children) {
      targetParent.attach(child);
      if (child instanceof THREE.Bone) captureBoneRest(child);
    }
    bone.removeFromParent();

    const next = targetParent instanceof THREE.Bone
      ? targetParent
      : rigBones(rig).find(candidate => candidate !== bone) ?? rig;
    this.editor.select(next);
    this.editor.commit();
    return next;
  }
  sync() {
    const current = new Set(this.rigs);
    if (this.editRig && !current.has(this.editRig)) this.editRig = null;
    const disposeVisual = (rig: THREE.Object3D, visual: RigVisual) => {
      visual.root.removeFromParent();
      this.editor.disposeObject(visual.root);
      visual.lines.geometry.dispose();
      (visual.lines.material as THREE.Material).dispose();
      this.visuals.delete(rig);
    };
    for (const [rig, visual] of this.visuals) if (!current.has(rig)) disposeVisual(rig, visual);
    for (const rig of current) {
      const bones = rigBones(rig);
      const previous = this.visuals.get(rig);
      if (previous && previous.bones.length === bones.length && previous.bones.every((bone, index) => bone === bones[index])) continue;
      if (previous) disposeVisual(rig, previous);
      const root = new THREE.Group();
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 }), bones.length);
      joints.renderOrder = 21;
      joints.frustumCulled = false;
      const geometry = new THREE.BufferGeometry();
      const edgeCount = bones.filter(bone => bone.parent instanceof THREE.Bone).length;
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeCount * 6), 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xaac9c7, depthTest: false, transparent: true, opacity: 0.85 }));
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
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), parent = new THREE.Vector3();
    for (const [rig, visual] of this.visuals) {
      visual.root.visible = rig.visible;
      const lines = visual.lines.geometry.getAttribute('position');
      const rigScale = rig.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
      let line = 0;
      visual.bones.forEach((bone, i) => {
        bone.getWorldPosition(position);
        const selected = this.editor.selected === bone;
        const radius = 0.017 * rigScale;
        matrix.makeScale(radius * (selected ? 1.5 : 1), radius * (selected ? 1.5 : 1), radius * (selected ? 1.5 : 1));
        matrix.setPosition(position);
        visual.joints.setMatrixAt(i, matrix);
        visual.joints.setColorAt(i, new THREE.Color(selected ? 0xffc17b : 0xc3c8bd));
        if (bone.parent instanceof THREE.Bone) { bone.parent.getWorldPosition(parent); lines.setXYZ(line++, parent.x, parent.y, parent.z); lines.setXYZ(line++, position.x, position.y, position.z); }
      });
      visual.joints.instanceMatrix.needsUpdate = true;
      if (visual.joints.instanceColor) visual.joints.instanceColor.needsUpdate = true;
      lines.needsUpdate = true;
      visual.joints.computeBoundingSphere();
    }
  }
  private pick(raycaster: THREE.Raycaster): THREE.Object3D | null {
    for (const [rig, visual] of this.visuals) {
      if (!rig.visible) continue;
      const hit = raycaster.intersectObject(visual.joints)[0];
      if (hit?.instanceId !== undefined) return visual.bones[hit.instanceId];
    }
    return null;
  }
  resetPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    this.applyRestPose(rig);
    this.ikEnd = null;
    this.editor.select(rig);
    this.editor.commit();
  }
  keyPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    if (this.editRig === rig) throw new Error('Switch to Pose mode before keying the armature.');
    const frame = Math.round(this.editor.frame);
    for (const bone of rigBones(rig)) this.editor.keyObjectTransform(bone, frame);
    this.editor.commit();
  }
  enableIK(end: THREE.Bone, chainLength = 2) {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    if (this.editRig === rig) throw new Error('Switch to Pose mode before using IK.');
    const bones = rigBones(rig);
    if (!bones.includes(end)) throw new Error('Choose an end bone from the active armature.');
    if (!Number.isInteger(chainLength) || chainLength < 1) throw new Error('IK chain length must be a positive integer.');
    const chain: THREE.Bone[] = [];
    let parent = end.parent;
    while (parent instanceof THREE.Bone && chain.length < chainLength) {
      chain.push(parent);
      parent = parent.parent;
    }
    if (!chain.length) throw new Error('IK chain is unavailable.');
    this.editor.playing = false;
    this.editor.select(end);
    this.ikEnd = end;
    this.ikChain = chain;
    end.getWorldPosition(this.ikTarget.position);
    this.editor.transform.setMode('translate');
    this.editor.transform.setSpace('world');
    this.editor.transform.attach(this.ikTarget);
    this.editor.invalidate();
  }
  private solveIK() {
    if (!this.ikEnd) return;
    const target = this.ikTarget.position;
    for (let iteration = 0; iteration < 16; iteration++) {
      for (const bone of this.ikChain) {
        this.editor.content.updateMatrixWorld(true);
        const origin = bone.getWorldPosition(new THREE.Vector3());
        const endpoint = this.ikEnd.getWorldPosition(new THREE.Vector3());
        const from = endpoint.sub(origin).normalize();
        const to = target.clone().sub(origin).normalize();
        if (from.lengthSq() < 0.1 || to.lengthSq() < 0.1) continue;
        const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        bone.quaternion.copy(parent.multiply(delta).multiply(world)).normalize();
      }
      this.editor.content.updateMatrixWorld(true);
      if (this.ikEnd.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 0.001) break;
    }
    this.editor.emit('transform');
    this.editor.invalidate();
  }
  beginWeightEdit() {
    const mesh = this.editor.selected;
    if (!(mesh instanceof THREE.SkinnedMesh)) throw new Error('Select a bound skinned mesh first.');
    const rig = this.rigFor(mesh);
    if (!rig) throw new Error('The selected skin is not inside a Forge armature.');
    if (this.editRig === rig) throw new Error('Switch the armature to Pose mode before editing weights.');
    if (!mesh.geometry.getAttribute('skinIndex') || !mesh.geometry.getAttribute('skinWeight')) throw new Error('The selected skin has no editable skin weights.');
    this.editor.playing = false;
    this.applyRestPose(rig);
    this.weightMesh = mesh;
    this.weightBoneIndex = 0;
    if (!this.editor.setWeightMode(true)) {
      this.weightMesh = null;
      throw new Error('Weight Mode could not start for the selected skin.');
    }
    this.editor.commit();
    this.editor.emit('weight');
    return mesh;
  }
  endWeightEdit() {
    if (!this.weightEditing) return false;
    this.editor.setWeightMode(false);
    this.weightMesh = null;
    this.weightBoneIndex = 0;
    this.editor.emit('weight');
    return true;
  }
  setWeightBone(bone: THREE.Bone | number) {
    const bones = this.weightBones;
    if (!bones.length) throw new Error('Start Weight Mode on a bound skin first.');
    const index = typeof bone === 'number' ? bone : bones.indexOf(bone);
    if (!Number.isInteger(index) || index < 0 || index >= bones.length) throw new Error('Choose a bone from the active skin.');
    this.weightBoneIndex = index;
    this.editor.emit('weight');
    return bones[index];
  }
  private weightAttributes() {
    const mesh = this.activeWeightMesh;
    if (!mesh) throw new Error('Start Weight Mode on a bound skin first.');
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!indices || !weights || indices.itemSize !== 4 || weights.itemSize !== 4 || indices.count !== weights.count) throw new Error('The active skin has invalid four-influence weights.');
    return { mesh, indices, weights };
  }
  private selectedWeightVertices() {
    const vertices = this.editor.selectedVertexBufferIndices;
    if (!vertices.length) throw new Error('Select one or more skin vertices first.');
    return vertices;
  }
  weightSelectionSummary() {
    if (!this.weightEditing) return { vertices: 0, buffers: 0, average: 0, min: 0, max: 0 };
    const { indices, weights } = this.weightAttributes();
    const vertices = this.editor.selectedVertexBufferIndices;
    if (!vertices.length) return { vertices: 0, buffers: 0, average: 0, min: 0, max: 0 };
    const values = vertices.map(vertex => {
      const ids = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)];
      const influence = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)];
      return influence.reduce((sum, value, slot) => sum + (Math.round(ids[slot]) === this.weightBoneIndex ? value : 0), 0);
    });
    return {
      vertices: this.editor.selectedLogicalVertexCount,
      buffers: vertices.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
  assignSelectedWeight(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Skin weight must be between 0 and 1.');
    const { mesh, indices, weights } = this.weightAttributes();
    const vertices = this.selectedWeightVertices();
    const boneCount = mesh.skeleton.bones.length;
    if (boneCount < 1) throw new Error('The active skin has no skeleton bones.');
    const epsilon = 1e-8;

    for (const vertex of vertices) {
      const ids = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)].map(id => Math.round(id));
      const influence = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)];
      let slot = ids.findIndex(id => id === this.weightBoneIndex);
      if (slot < 0) {
        if (value <= epsilon) continue;
        slot = influence.findIndex(weight => weight <= epsilon);
        if (slot < 0) slot = influence.reduce((best, weight, index) => weight < influence[best] ? index : best, 0);
        ids[slot] = this.weightBoneIndex;
        influence[slot] = 0;
      }

      influence[slot] = value;
      const others = [0, 1, 2, 3].filter(index => index !== slot);
      const otherSum = others.reduce((sum, index) => sum + Math.max(0, influence[index]), 0);
      const remainder = 1 - value;
      if (remainder <= epsilon) {
        others.forEach(index => influence[index] = 0);
      } else if (otherSum > epsilon) {
        const scale = remainder / otherSum;
        others.forEach(index => influence[index] = Math.max(0, influence[index]) * scale);
      } else {
        if (boneCount < 2) throw new Error('A one-bone skin must keep weight 1 on its only bone.');
        const fallbackBone = this.weightBoneIndex === 0 ? 1 : 0;
        const fallbackSlot = others[0];
        others.forEach(index => influence[index] = 0);
        ids[fallbackSlot] = fallbackBone;
        influence[fallbackSlot] = remainder;
      }
      indices.setXYZW(vertex, ids[0], ids[1], ids[2], ids[3]);
      weights.setXYZW(vertex, influence[0], influence[1], influence[2], influence[3]);
    }
    indices.needsUpdate = true;
    weights.needsUpdate = true;
    this.editor.commit();
    this.editor.emit('weight');
    return this.weightSelectionSummary();
  }
  normalizeSelectedWeights() {
    const { indices, weights } = this.weightAttributes();
    const vertices = this.selectedWeightVertices();
    for (const vertex of vertices) {
      const influence = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)].map(value => Math.max(0, value));
      const sum = influence.reduce((total, value) => total + value, 0);
      if (sum <= 1e-8) {
        indices.setXYZW(vertex, 0, 0, 0, 0);
        weights.setXYZW(vertex, 1, 0, 0, 0);
      } else {
        weights.setXYZW(vertex, influence[0] / sum, influence[1] / sum, influence[2] / sum, influence[3] / sum);
      }
    }
    indices.needsUpdate = true;
    weights.needsUpdate = true;
    this.editor.commit();
    this.editor.emit('weight');
    return this.weightSelectionSummary();
  }

  async bindSelected() {
    if (this.worker) throw new Error('A skin binding job is already running.');
    const mesh = this.editor.selected;
    const rig = this.activeRig;
    if (!(mesh instanceof THREE.Mesh) || mesh instanceof THREE.SkinnedMesh || mesh.parent !== this.editor.content) throw new Error('Select a standalone mesh to bind.');
    if (mesh.userData.modifierStack || this.editor.modelingBusy) throw new Error('Apply modifiers and finish modeling before skin binding.');
    if (!rig) throw new Error('Create or select an armature first.');
    if (this.editRig === rig) throw new Error('Switch to Pose mode before binding a mesh.');
    const bones = rigBones(rig);
    if (!bones.length) throw new Error('The active armature has no bones.');
    const rest = bones.map(restTransform);
    if (bones.some((bone, index) =>
      bone.quaternion.angleTo(new THREE.Quaternion().fromArray(rest[index].quaternion)) > 1e-5 ||
      bone.position.distanceTo(new THREE.Vector3().fromArray(rest[index].position)) > 1e-5 ||
      bone.scale.distanceTo(new THREE.Vector3().fromArray(rest[index].scale)) > 1e-5
    )) throw new Error('Reset the armature to its rest pose before binding.');
    const attribute = mesh.geometry.getAttribute('position');
    if (attribute.count > 100_000) throw new Error('Automatic binding supports up to 100,000 vertices per mesh.');
    this.editor.setEditMode(false);
    this.editor.content.updateMatrixWorld(true);
    const checkpoint = this.editor.snapshot();
    const positions = new Float32Array(attribute.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i++) point.fromBufferAttribute(attribute,i).applyMatrix4(mesh.matrixWorld).toArray(positions,i*3);
    const segments: number[] = [];
    const boneIndex = new Map<THREE.Bone, number>(bones.map((bone, index) => [bone, index] as const));
    for (const bone of bones) {
      const children = bone.children.filter((child): child is THREE.Bone => child instanceof THREE.Bone);
      if (children.length) {
        const start = bone.getWorldPosition(new THREE.Vector3());
        for (const child of children) {
          const end = child.getWorldPosition(new THREE.Vector3());
          segments.push(...start.toArray(), ...end.toArray(), boneIndex.get(bone)!);
        }
      } else if (bone.parent instanceof THREE.Bone) {
        const start = bone.parent.getWorldPosition(new THREE.Vector3());
        const end = bone.getWorldPosition(new THREE.Vector3());
        segments.push(...start.toArray(), ...end.toArray(), boneIndex.get(bone)!);
      } else {
        const point = bone.getWorldPosition(new THREE.Vector3());
        segments.push(...point.toArray(), ...point.toArray(), boneIndex.get(bone)!);
      }
    }
    const segmentArray = new Float32Array(segments);
    this.worker = new Worker(new URL('./weights.worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<{indices: Uint16Array; weights: Float32Array}>((resolve,reject) => {
        this.worker!.onmessage = event => resolve(event.data);
        this.worker!.onerror = () => reject(new Error('The skinning worker failed.'));
        this.worker!.postMessage({ positions, segments: segmentArray }, [positions.buffer, segmentArray.buffer]);
      });
      if (checkpoint !== this.editor.snapshot()) throw new Error('The scene changed during binding. Run the binding again.');
      const geometry = new THREE.BufferGeometry().copy(mesh.geometry);
      geometry.applyMatrix4(new THREE.Matrix4().copy(rig.matrixWorld).invert().multiply(mesh.matrixWorld));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(result.indices,4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(result.weights,4));
      const material = Array.isArray(mesh.material) ? mesh.material.map(m=>m.clone()) : mesh.material.clone();
      const skinned = new THREE.SkinnedMesh(geometry,material);
      skinned.name = mesh.name;
      skinned.frustumCulled = false;
      rig.add(skinned);
      rig.updateMatrixWorld(true);
      skinned.bind(new THREE.Skeleton(bones));
      mesh.removeFromParent();
      this.editor.disposeObject(mesh);
      this.editor.select(skinned);
      this.editor.commit();
      return skinned;
    } finally { this.worker?.terminate(); this.worker = null; }
  }

}
