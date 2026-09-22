import * as THREE from 'three';
import type { Keyframe } from './editor';

export type AnimationInterpolation = 'linear' | 'constant' | 'smooth';
export function validInterpolation(value: unknown): value is AnimationInterpolation {
  return value === 'linear' || value === 'constant' || value === 'smooth';
}

function cloneKeyframe(key: Keyframe, frame = key.frame): Keyframe {
  return {
    frame,
    position: [...key.position],
    quaternion: [...key.quaternion],
    scale: [...key.scale],
    ...(key.rotation ? { rotation: [...key.rotation] } : {}),
    ...(key.rotationOrder ? { rotationOrder: key.rotationOrder } : {}),
  };
}

export function sampleAnimation(keys: Keyframe[], frame: number, mode: AnimationInterpolation): Keyframe {
  const exact = keys.find(key => key.frame === frame);
  if (exact) return cloneKeyframe(exact, frame);

  const end = keys.findIndex(k => k.frame >= frame);
  const b = keys[end === -1 ? keys.length - 1 : end];
  const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
  let t = a.frame === b.frame ? 0 : THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);
  if (mode === 'constant') t = t < 1 ? 0 : 1;
  if (mode === 'smooth') t = t * t * (3 - 2 * t);

  const aOrder = a.rotationOrder ?? 'XYZ';
  const bOrder = b.rotationOrder ?? 'XYZ';
  const hasContinuousRotation = !!a.rotation && !!b.rotation && aOrder === bOrder;
  const rotation = hasContinuousRotation
    ? a.rotation!.map((value, index) => THREE.MathUtils.lerp(value, b.rotation![index], t))
    : undefined;
  const quaternion = rotation
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], aOrder)).toArray()
    : new THREE.Quaternion().fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion), t).toArray();

  return {
    frame,
    position: new THREE.Vector3().fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position), t).toArray(),
    quaternion,
    scale: new THREE.Vector3().fromArray(a.scale).lerp(new THREE.Vector3().fromArray(b.scale), t).toArray(),
    ...(rotation ? { rotation, rotationOrder: aOrder } : {}),
  };
}

function exportSamples(keys: Keyframe[], mode: AnimationInterpolation): Keyframe[] {
  const hasContinuousRotation = keys.some(key => key.rotation);
  if (!hasContinuousRotation) {
    return mode === 'smooth' ? keys.flatMap((key, index) => index === keys.length - 1 ? [key] :
      Array.from({ length: 32 }, (_, step) => sampleAnimation(keys, key.frame + (keys[index + 1].frame - key.frame) * step / 32, mode))) : keys;
  }

  const samples: Keyframe[] = [];
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index], next = keys[index + 1];
    const frameSpan = Math.max(1, next.frame - key.frame);
    const angularSpan = key.rotation && next.rotation
      ? Math.max(...key.rotation.map((value, axis) => Math.abs(next.rotation![axis] - value)))
      : 0;
    const angularSteps = Math.ceil(angularSpan / (Math.PI / 2));
    const steps = mode === 'constant' ? 1 : Math.max(1, Math.ceil(frameSpan), angularSteps, mode === 'smooth' ? 32 : 1);
    for (let step = 0; step < steps; step++) {
      samples.push(sampleAnimation(keys, key.frame + frameSpan * step / steps, mode));
    }
  }
  samples.push(sampleAnimation(keys, keys[keys.length - 1].frame, mode));
  return samples;
}

export function animationTracks(object: THREE.Object3D): THREE.KeyframeTrack[] {
  const keys: Keyframe[] = object.userData.keyframes ?? [];
  if (!keys.length) return [];
  const mode: AnimationInterpolation = object.userData.animationInterpolation ?? 'linear';
  const samples = exportSamples(keys, mode);
  const times = samples.map(k => (k.frame - 1) / 24);
  const interpolation = mode === 'constant' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
  return [
    new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, samples.flatMap(k => k.position), interpolation),
    new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, samples.flatMap(k => k.quaternion), interpolation),
    new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, samples.flatMap(k => k.scale), interpolation),
  ];
}
