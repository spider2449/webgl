import * as THREE from 'three';
import type { Keyframe } from './editor';

export type AnimationInterpolation = 'linear' | 'constant' | 'smooth';
export function validInterpolation(value: unknown): value is AnimationInterpolation {
  return value === 'linear' || value === 'constant' || value === 'smooth';
}

export function sampleAnimation(keys: Keyframe[], frame: number, mode: AnimationInterpolation): Keyframe {
  const end = keys.findIndex(k => k.frame >= frame);
  const b = keys[end === -1 ? keys.length - 1 : end];
  const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
  let t = a.frame === b.frame ? 0 : THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);
  if (mode === 'constant') t = t < 1 ? 0 : 1;
  if (mode === 'smooth') t = t * t * (3 - 2 * t);
  return {
    frame,
    position: new THREE.Vector3().fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position), t).toArray(),
    quaternion: new THREE.Quaternion().fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion), t).toArray(),
    scale: new THREE.Vector3().fromArray(a.scale).lerp(new THREE.Vector3().fromArray(b.scale), t).toArray(),
  };
}

export function animationTracks(object: THREE.Object3D): THREE.KeyframeTrack[] {
  const keys: Keyframe[] = object.userData.keyframes ?? [];
  if (!keys.length) return [];
  const mode: AnimationInterpolation = object.userData.animationInterpolation ?? 'linear';
  const samples = mode === 'smooth' ? keys.flatMap((key, index) => index === keys.length - 1 ? [key] :
    Array.from({ length: 32 }, (_, step) => sampleAnimation(keys, key.frame + (keys[index + 1].frame - key.frame) * step / 32, mode))) : keys;
  const times = samples.map(k => (k.frame - 1) / 24);
  const interpolation = mode === 'constant' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
  return [
    new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, samples.flatMap(k => k.position), interpolation),
    new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, samples.flatMap(k => k.quaternion), interpolation),
    new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, samples.flatMap(k => k.scale), interpolation),
  ];
}
