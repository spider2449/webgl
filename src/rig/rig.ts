import * as THREE from 'three';
import type { Editor } from '../editor';
import { SOMA77 } from './soma77';

export const RIG_SOURCE = 'https://github.com/nv-tlabs/kimodo/tree/1aece8c124d73d255ceff5086d983b844c9f4e94/kimodo/assets/skeletons/somaskel77';
export function rigBones(rig: THREE.Object3D): THREE.Bone[] {
  const byName = new Map<string, THREE.Bone>();
  rig.traverse(o => { if (o instanceof THREE.Bone) byName.set(o.name, o); });
  return SOMA77.map(j => byName.get(j.name)!).filter(Boolean);
}
export function createSomaRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'Kimodo SOMA77';
  rig.userData.forgeRig = { skeleton: 'somaskel77', source: RIG_SOURCE, units: 'meters', up: 'Y', rest: 'native-neutral', version: 1 };
  const bones = new Map<string, THREE.Bone>();
  const positions = new Map(SOMA77.map(j => [j.name, new THREE.Vector3(...j.position)]));
  for (const joint of SOMA77) {
    const bone = new THREE.Bone();
    bone.name = joint.name;
    bone.position.copy(positions.get(joint.name)!);
    if (joint.parent) bone.position.sub(positions.get(joint.parent)!);
    bone.userData.restPosition = bone.position.toArray();
    bone.userData.restQuaternion = bone.quaternion.toArray();
    (joint.parent ? bones.get(joint.parent)! : rig).add(bone);
    bones.set(joint.name, bone);
  }
  // Ground the display container without changing the model's zero Hips offset.
  rig.position.y = -Math.min(...SOMA77.map(j => j.position[1]));
  rig.updateMatrixWorld(true);
  return rig;
}

type RigVisual = { root: THREE.Group; joints: THREE.InstancedMesh; lines: THREE.LineSegments; bones: THREE.Bone[] };
export class RigSystem {
  private visuals = new Map<THREE.Object3D, RigVisual>();
  private ikTarget = new THREE.Object3D();
  private ikEnd: THREE.Bone | null = null;
  private ikChain: THREE.Bone[] = [];
  private worker: Worker | null = null;
  constructor(readonly editor: Editor) {
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
  get rigs() { return this.editor.content.children.filter(o => o.userData.forgeRig?.skeleton === 'somaskel77'); }
  get activeRig(): THREE.Object3D | null {
    let node = this.editor.selected;
    while (node) { if (node.userData.forgeRig?.skeleton === 'somaskel77') return node; node = node.parent; }
    return this.rigs[0] ?? null;
  }
  add() {
    const rig = createSomaRig();
    rig.name = this.editor.uniqueName(rig.name);
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
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(0, bones.length - 1) * 6), 3));
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
        const radius = (bone.name.includes('Hand') && bone.name !== 'LeftHand' && bone.name !== 'RightHand' ? 0.009 : 0.017) * rigScale;
        matrix.makeScale(radius * (selected ? 1.5 : 1), radius * (selected ? 1.5 : 1), radius * (selected ? 1.5 : 1));
        matrix.setPosition(position);
        visual.joints.setMatrixAt(i, matrix);
        visual.joints.setColorAt(i, new THREE.Color(selected ? 0xffc17b : bone.name.startsWith('Left') ? 0x91b6d3 : bone.name.startsWith('Right') ? 0xd89b96 : 0xc3c8bd));
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
    if (!rig) throw new Error('Create or select a Kimodo rig first.');
    for (const bone of rigBones(rig)) { bone.position.fromArray(bone.userData.restPosition); bone.quaternion.fromArray(bone.userData.restQuaternion); bone.scale.set(1,1,1); }
    this.ikEnd = null;
    this.editor.select(rig);
    this.editor.commit();
  }
  keyPose() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create a Kimodo rig first.');
    const frame = Math.round(this.editor.frame);
    for (const bone of rigBones(rig)) this.editor.keyObjectTransform(bone, frame);
    this.editor.commit();
  }
  enableIK(name: string) {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create a Kimodo rig first.');
    const end = rigBones(rig).find(b => b.name === name);
    if (!end || !(end.parent instanceof THREE.Bone) || !(end.parent.parent instanceof THREE.Bone)) throw new Error('IK chain is unavailable.');
    this.editor.playing = false;
    this.editor.select(end);
    this.ikEnd = end;
    this.ikChain = [end.parent, end.parent.parent];
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
    if (!rig) throw new Error('Create a Kimodo rig first.');
    const bones = rigBones(rig);
    if (bones.some(b => b.quaternion.angleTo(new THREE.Quaternion().fromArray(b.userData.restQuaternion)) > 1e-5 || b.position.distanceTo(new THREE.Vector3().fromArray(b.userData.restPosition)) > 1e-5 || b.scale.distanceTo(new THREE.Vector3(1,1,1)) > 1e-5)) throw new Error('Reset the rig to its rest pose before binding.');
    const attribute = mesh.geometry.getAttribute('position');
    if (attribute.count > 100_000) throw new Error('Automatic binding supports up to 100,000 vertices per mesh.');
    this.editor.setEditMode(false);
    this.editor.content.updateMatrixWorld(true);
    const checkpoint = this.editor.snapshot();
    const positions = new Float32Array(attribute.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i++) point.fromBufferAttribute(attribute,i).applyMatrix4(mesh.matrixWorld).toArray(positions,i*3);
    const segments: number[] = [];
    for (const child of bones) if (child.parent instanceof THREE.Bone) {
      const start = child.parent.getWorldPosition(new THREE.Vector3()), end = child.getWorldPosition(new THREE.Vector3());
      segments.push(...start.toArray(), ...end.toArray(), bones.indexOf(child.parent));
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
  addPreview() {
    const rig = this.activeRig;
    if (!rig) throw new Error('Create a Kimodo rig first.');
    const bones = rigBones(rig);
    if (bones.some(b => b.quaternion.angleTo(new THREE.Quaternion().fromArray(b.userData.restQuaternion)) > 1e-5)) throw new Error('Reset the rig before adding the preview.');
    const positions: number[] = [], normals: number[] = [], indices: number[] = [], weights: number[] = [];
    const inverse = rig.matrixWorld.clone().invert();
    for (const child of bones) {
      if (!(child.parent instanceof THREE.Bone) || /Hand|Eye|Jaw|HeadEnd|ToeEnd/.test(child.name)) continue;
      const start = child.parent.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
      const end = child.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
      const direction = end.clone().sub(start);
      const radius = /Leg|Shin/.test(child.name) ? 0.055 : /Spine|Chest/.test(child.name) ? 0.12 : 0.035;
      const geometry = new THREE.CylinderGeometry(radius*0.8,radius,direction.length(),10,3).toNonIndexed();
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
      geometry.translate(...start.clone().add(end).multiplyScalar(0.5).toArray());
      positions.push(...Array.from(geometry.getAttribute('position').array));
      normals.push(...Array.from(geometry.getAttribute('normal').array));
      const index = bones.indexOf(child.parent);
      for (let i = 0; i < geometry.getAttribute('position').count; i++) { indices.push(index,0,0,0); weights.push(1,0,0,0); }
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const mesh = new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial({color:0x697d82,roughness:0.55,metalness:0.2}));
    mesh.name = 'Rig preview';
    mesh.frustumCulled = false;
    rig.add(mesh); rig.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    this.editor.commit();
  }
}
