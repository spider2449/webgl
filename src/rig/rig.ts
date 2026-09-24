import * as THREE from 'three';
import type { Editor } from '../editor';
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

export function captureRestPose(rig: THREE.Object3D) {
  for (const bone of rigBones(rig)) {
    bone.userData.restPosition = bone.position.toArray();
    bone.userData.restQuaternion = bone.quaternion.toArray();
    bone.userData.restScale = bone.scale.toArray();
  }
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
  constructor(readonly editor: Editor, private readonly createDefaultArmature?: () => THREE.Group) {
    editor.scene.add(this.ikTarget);
    editor.beforeRender = () => this.updateVisuals();
    editor.pickOverride = raycaster => this.pick(raycaster);
    editor.transform.addEventListener('objectChange', () => { if (this.ikEnd && editor.transform.object === this.ikTarget) this.solveIK(); });
    editor.addEventListener('change', () => {
      if (editor.transform.object !== this.ikTarget) this.ikEnd = null;
      this.sync();
    });
    this.sync();
  }
  get rigs() { return this.editor.content.children.filter(isForgeArmature); }
  get activeRig(): THREE.Object3D | null {
    let node = this.editor.selected;
    while (node) { if (isForgeArmature(node)) return node; node = node.parent; }
    return this.rigs[0] ?? null;
  }
  add(armature?: THREE.Group) {
    const rig = armature ?? this.createDefaultArmature?.();
    if (!rig) throw new Error('No armature factory is configured.');
    if (!isForgeArmature(rig)) throw new Error('The object is not a Forge armature.');
    if (!rigBones(rig).length) throw new Error('An armature must contain at least one bone.');
    rig.name = this.editor.uniqueName(rig.name || 'Armature');
    this.editor.content.add(rig);
    this.editor.select(rig);
    this.editor.commit();
    this.editor.focus();
    return rig;
  }
  sync() {
    const current = new Set(this.rigs);
    for (const [rig, visual] of this.visuals) if (!current.has(rig)) {
      visual.root.removeFromParent();
      this.editor.disposeObject(visual.root);
      visual.lines.geometry.dispose();
      (visual.lines.material as THREE.Material).dispose();
      this.visuals.delete(rig);
    }
    for (const rig of current) if (!this.visuals.has(rig)) {
      const bones = rigBones(rig);
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
    const bones = rigBones(rig);
    const rest = bones.map(restTransform);
    bones.forEach((bone, index) => {
      bone.position.fromArray(rest[index].position);
      bone.quaternion.fromArray(rest[index].quaternion);
      bone.scale.fromArray(rest[index].scale);
    });
    this.ikEnd = null;
    this.editor.select(rig);
    this.editor.commit();
  }
  keyPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
    const frame = Math.round(this.editor.frame);
    for (const bone of rigBones(rig)) this.editor.keyObjectTransform(bone, frame);
    this.editor.commit();
  }
  enableIK(end: THREE.Bone, chainLength = 2) {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create or select an armature first.');
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
  async bindSelected() {
    if (this.worker) throw new Error('A skin binding job is already running.');
    const mesh = this.editor.selected;
    const rig = this.activeRig;
    if (!(mesh instanceof THREE.Mesh) || mesh instanceof THREE.SkinnedMesh || mesh.parent !== this.editor.content) throw new Error('Select a standalone mesh to bind.');
    if (mesh.userData.modifierStack || this.editor.modelingBusy) throw new Error('Apply modifiers and finish modeling before skin binding.');
    if (!rig) throw new Error('Create or select an armature first.');
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
    const boneIndex = new Map(bones.map((bone, index) => [bone, index]));
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
