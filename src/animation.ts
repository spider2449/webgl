import * as THREE from 'three';
import type { Keyframe, ScalarAnimationChannel } from './editor';

export type AnimationInterpolation = 'linear' | 'constant' | 'smooth';
export type AnimationChannelInterpolation = Partial<Record<ScalarAnimationChannel, AnimationInterpolation>>;

export const animationChannels: ScalarAnimationChannel[] = [
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z',
];

export function validInterpolation(value: unknown): value is AnimationInterpolation {
  return value === 'linear' || value === 'constant' || value === 'smooth';
}

export function validAnimationChannel(value: unknown): value is ScalarAnimationChannel {
  return typeof value === 'string' && animationChannels.includes(value as ScalarAnimationChannel);
}

export function validChannelInterpolation(value: unknown): value is AnimationChannelInterpolation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([channel, mode]) => validAnimationChannel(channel) && validInterpolation(mode));
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

function interpolationT(mode: AnimationInterpolation, t: number) {
  if (mode === 'constant') return t < 1 ? 0 : 1;
  if (mode === 'smooth') return t * t * (3 - 2 * t);
  return t;
}

function modeFor(channel: ScalarAnimationChannel, fallback: AnimationInterpolation, overrides: AnimationChannelInterpolation) {
  return overrides[channel] ?? fallback;
}

export function sampleAnimation(
  keys: Keyframe[],
  frame: number,
  mode: AnimationInterpolation,
  overrides: AnimationChannelInterpolation = {},
): Keyframe {
  const exact = keys.find(key => key.frame === frame);
  if (exact) return cloneKeyframe(exact, frame);

  const end = keys.findIndex(k => k.frame >= frame);
  const b = keys[end === -1 ? keys.length - 1 : end];
  const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
  const t = a.frame === b.frame ? 0 : THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);
  const axes = ['x', 'y', 'z'] as const;

  const position = a.position.map((value, index) =>
    THREE.MathUtils.lerp(value, b.position[index], interpolationT(modeFor(`position.${axes[index]}`, mode, overrides), t))
  );
  const scale = a.scale.map((value, index) =>
    THREE.MathUtils.lerp(value, b.scale[index], interpolationT(modeFor(`scale.${axes[index]}`, mode, overrides), t))
  );

  const aOrder = a.rotationOrder ?? 'XYZ';
  const bOrder = b.rotationOrder ?? 'XYZ';
  const hasContinuousRotation = !!a.rotation && !!b.rotation && aOrder === bOrder;
  const rotation = hasContinuousRotation
    ? a.rotation!.map((value, index) =>
      THREE.MathUtils.lerp(value, b.rotation![index], interpolationT(modeFor(`rotation.${axes[index]}`, mode, overrides), t))
    )
    : undefined;
  const quaternion = rotation
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], aOrder)).toArray()
    : new THREE.Quaternion().fromArray(a.quaternion)
      .slerp(new THREE.Quaternion().fromArray(b.quaternion), interpolationT(mode, t)).toArray();

  return {
    frame,
    position,
    quaternion,
    scale,
    ...(rotation ? { rotation, rotationOrder: aOrder } : {}),
  };
}

function legacyExportSamples(keys: Keyframe[], mode: AnimationInterpolation): Keyframe[] {
  if (mode === 'smooth') {
    return keys.flatMap((key, index) => index === keys.length - 1 ? [key] :
      Array.from({ length: 32 }, (_, step) => sampleAnimation(keys, key.frame + (keys[index + 1].frame - key.frame) * step / 32, mode)));
  }
  if (mode === 'constant' || !keys.some(key => key.rotation)) return keys;

  const samples: Keyframe[] = [];
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index], next = keys[index + 1];
    const frameSpan = next.frame - key.frame;
    const sameOrder = (key.rotationOrder ?? 'XYZ') === (next.rotationOrder ?? 'XYZ');
    const angularSpan = key.rotation && next.rotation && sameOrder
      ? Math.max(...key.rotation.map((value, axis) => Math.abs(next.rotation![axis] - value)))
      : 0;
    const steps = angularSpan >= Math.PI - 1e-9 ? Math.max(2, Math.ceil(angularSpan / (Math.PI / 2))) : 1;
    for (let step = 0; step < steps; step++) {
      samples.push(step === 0 ? cloneKeyframe(key) : sampleAnimation(keys, key.frame + frameSpan * step / steps, mode));
    }
  }
  samples.push(cloneKeyframe(keys[keys.length - 1]));
  return samples;
}

function bakedExportSamples(
  keys: Keyframe[],
  mode: AnimationInterpolation,
  overrides: AnimationChannelInterpolation,
): Keyframe[] {
  const samples: Keyframe[] = [];
  const effectiveModes = animationChannels.map(channel => modeFor(channel, mode, overrides));
  const hasSmooth = effectiveModes.includes('smooth');
  const hasConstant = effectiveModes.includes('constant');

  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index], next = keys[index + 1];
    const frameSpan = next.frame - key.frame;
    const sameOrder = (key.rotationOrder ?? 'XYZ') === (next.rotationOrder ?? 'XYZ');
    const angularSpan = key.rotation && next.rotation && sameOrder
      ? Math.max(...key.rotation.map((value, axis) => Math.abs(next.rotation![axis] - value)))
      : 0;
    const angularSteps = angularSpan >= Math.PI - 1e-9 ? Math.max(2, Math.ceil(angularSpan / (Math.PI / 2))) : 1;
    const steps = Math.max(hasSmooth ? 32 : 1, angularSteps);

    for (let step = 0; step < steps; step++) {
      const sampleFrame = key.frame + frameSpan * step / steps;
      samples.push(step === 0 ? cloneKeyframe(key) : sampleAnimation(keys, sampleFrame, mode, overrides));
    }
    if (hasConstant && frameSpan > 0) {
      const epsilon = Math.min(1e-4, frameSpan * 1e-6);
      const nearEnd = next.frame - epsilon;
      if (nearEnd > key.frame) samples.push(sampleAnimation(keys, nearEnd, mode, overrides));
    }
  }
  samples.push(cloneKeyframe(keys[keys.length - 1]));
  return samples;
}

export function animationTracks(object: THREE.Object3D): THREE.KeyframeTrack[] {
  const keys: Keyframe[] = object.userData.keyframes ?? [];
  if (!keys.length) return [];
  const mode: AnimationInterpolation = object.userData.animationInterpolation ?? 'linear';
  const overrides: AnimationChannelInterpolation = object.userData.animationChannelInterpolation ?? {};
  const hasEffectiveOverrides = Object.values(overrides).some(override => override !== mode);
  const samples = hasEffectiveOverrides ? bakedExportSamples(keys, mode, overrides) : legacyExportSamples(keys, mode);
  const times = samples.map(k => (k.frame - 1) / 24);
  const interpolation = !hasEffectiveOverrides && mode === 'constant' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
  return [
    new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, samples.flatMap(k => k.position), interpolation),
    new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, samples.flatMap(k => k.quaternion), interpolation),
    new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, samples.flatMap(k => k.scale), interpolation),
  ];
}
