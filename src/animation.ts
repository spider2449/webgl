import * as THREE from 'three';
import type { Keyframe, KeyInterpolation, KeyTangentMode, ScalarAnimationChannel } from './editor';

export const animationChannels: ScalarAnimationChannel[] = [
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z',
];

const axes = ['x', 'y', 'z'] as const;

export function validKeyInterpolation(value: unknown): value is KeyInterpolation {
  return value === 'linear' || value === 'constant' || value === 'bezier';
}

export function validKeyTangentMode(value: unknown): value is KeyTangentMode {
  return value === 'free' || value === 'aligned' || value === 'auto';
}

export function validAnimationChannel(value: unknown): value is ScalarAnimationChannel {
  return typeof value === 'string' && animationChannels.includes(value as ScalarAnimationChannel);
}

export function validKeyCurves(value: unknown): value is Keyframe['curves'] {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([channel, curve]) => {
    if (!validAnimationChannel(channel) || !curve || typeof curve !== 'object' || Array.isArray(curve)) return false;
    const item = curve as { interpolation?: unknown; tangent?: unknown; left?: unknown; right?: unknown };
    if (Object.keys(item).some(key => key !== 'interpolation' && key !== 'tangent' && key !== 'left' && key !== 'right')) return false;
    if (item.interpolation !== undefined && !validKeyInterpolation(item.interpolation)) return false;
    if (item.tangent !== undefined && !validKeyTangentMode(item.tangent)) return false;
    for (const handle of [item.left, item.right]) {
      if (handle !== undefined && (!Array.isArray(handle) || handle.length !== 2 || handle.some(value => !Number.isFinite(value)))) return false;
    }
    return true;
  });
}

function cloneCurves(curves: Keyframe['curves']): Keyframe['curves'] {
  if (!curves) return undefined;
  return Object.fromEntries(Object.entries(curves).map(([channel, curve]) => [channel, {
    ...(curve!.interpolation ? { interpolation: curve!.interpolation } : {}),
    ...(curve!.tangent ? { tangent: curve!.tangent } : {}),
    ...(curve!.left ? { left: [...curve!.left] as [number, number] } : {}),
    ...(curve!.right ? { right: [...curve!.right] as [number, number] } : {}),
  }])) as Keyframe['curves'];
}

function cloneKeyframe(key: Keyframe, frame = key.frame): Keyframe {
  return {
    frame,
    position: [...key.position],
    quaternion: [...key.quaternion],
    scale: [...key.scale],
    ...(key.rotation ? { rotation: [...key.rotation] } : {}),
    ...(key.rotationOrder ? { rotationOrder: key.rotationOrder } : {}),
    ...(key.curves ? { curves: cloneCurves(key.curves) } : {}),
  };
}

export function effectiveSegmentInterpolation(
  key: Keyframe,
  channel: ScalarAnimationChannel,
): KeyInterpolation {
  return key.curves?.[channel]?.interpolation ?? 'linear';
}

export function animationChannelNativeValue(key: Keyframe, channel: ScalarAnimationChannel) {
  const [property, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', typeof axes[number]];
  const component = axes.indexOf(axis);
  if (property === 'position') return key.position[component];
  if (property === 'scale') return key.scale[component];
  if (key.rotation) return key.rotation[component];

  const order = key.rotationOrder ?? 'XYZ';
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(key.quaternion), order);
  return [euler.x, euler.y, euler.z][component];
}

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

export function bezierControlPoints(
  a: Keyframe,
  b: Keyframe,
  channel: ScalarAnimationChannel,
) {
  const va = animationChannelNativeValue(a, channel);
  const vb = animationChannelNativeValue(b, channel);
  const span = b.frame - a.frame;
  const right = a.curves?.[channel]?.right ?? [span / 3, (vb - va) / 3];
  const left = b.curves?.[channel]?.left ?? [-span / 3, -(vb - va) / 3];

  let x1 = THREE.MathUtils.clamp(a.frame + right[0], a.frame, b.frame);
  let x2 = THREE.MathUtils.clamp(b.frame + left[0], a.frame, b.frame);
  if (x1 > x2) {
    const middle = (x1 + x2) / 2;
    x1 = middle;
    x2 = middle;
  }
  return { x1, y1: va + right[1], x2, y2: vb + left[1], va, vb };
}

function bezierValue(
  a: Keyframe,
  b: Keyframe,
  channel: ScalarAnimationChannel,
  frame: number,
) {
  const { x1, y1, x2, y2, va, vb } = bezierControlPoints(a, b, channel);
  if (b.frame <= a.frame) return va;

  let low = 0;
  let high = 1;
  for (let index = 0; index < 28; index++) {
    const t = (low + high) / 2;
    const x = cubic(a.frame, x1, x2, b.frame, t);
    if (x < frame) low = t;
    else high = t;
  }
  return cubic(va, y1, y2, vb, (low + high) / 2);
}

export function sampleAnimationChannel(
  keys: Keyframe[],
  frame: number,
  channel: ScalarAnimationChannel,
) {
  if (!keys.length) return 0;
  const exact = keys.find(key => key.frame === frame);
  if (exact) return animationChannelNativeValue(exact, channel);

  const end = keys.findIndex(key => key.frame >= frame);
  const b = keys[end === -1 ? keys.length - 1 : end];
  const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
  if (a.frame === b.frame) return animationChannelNativeValue(a, channel);

  const mode = effectiveSegmentInterpolation(a, channel);
  const va = animationChannelNativeValue(a, channel);
  const vb = animationChannelNativeValue(b, channel);
  const t = THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);

  if (mode === 'constant') return va;
  if (mode === 'bezier') return bezierValue(a, b, channel, frame);
  return THREE.MathUtils.lerp(va, vb, t);
}

export function sampleAnimation(keys: Keyframe[], frame: number): Keyframe {
  const exact = keys.find(key => key.frame === frame);
  if (exact) return cloneKeyframe(exact, frame);

  const end = keys.findIndex(key => key.frame >= frame);
  const b = keys[end === -1 ? keys.length - 1 : end];
  const a = keys[Math.max(0, (end === -1 ? keys.length : end) - 1)];
  const t = a.frame === b.frame ? 0 : THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);

  const position = axes.map(axis => sampleAnimationChannel(keys, frame, `position.${axis}`));
  const scale = axes.map(axis => sampleAnimationChannel(keys, frame, `scale.${axis}`));

  const aOrder = a.rotationOrder ?? 'XYZ';
  const bOrder = b.rotationOrder ?? 'XYZ';
  const hasContinuousRotation = !!a.rotation && !!b.rotation && aOrder === bOrder;
  const rotation = hasContinuousRotation
    ? axes.map(axis => sampleAnimationChannel(keys, frame, `rotation.${axis}`))
    : undefined;
  const quaternion = rotation
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], aOrder)).toArray()
    : new THREE.Quaternion().fromArray(a.quaternion)
      .slerp(new THREE.Quaternion().fromArray(b.quaternion), t).toArray();

  return {
    frame,
    position,
    quaternion,
    scale,
    ...(rotation ? { rotation, rotationOrder: aOrder } : {}),
  };
}

function linearExportSamples(keys: Keyframe[]): Keyframe[] {
  const samples: Keyframe[] = [];
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    const next = keys[index + 1];
    const frameSpan = next.frame - key.frame;
    const sameOrder = (key.rotationOrder ?? 'XYZ') === (next.rotationOrder ?? 'XYZ');
    const angularSpan = key.rotation && next.rotation && sameOrder
      ? Math.max(...key.rotation.map((value, axis) => Math.abs(next.rotation![axis] - value)))
      : 0;
    const steps = angularSpan >= Math.PI - 1e-9 ? Math.max(2, Math.ceil(angularSpan / (Math.PI / 2))) : 1;
    for (let step = 0; step < steps; step++) {
      samples.push(step === 0 ? cloneKeyframe(key) : sampleAnimation(keys, key.frame + frameSpan * step / steps));
    }
  }
  samples.push(cloneKeyframe(keys[keys.length - 1]));
  return samples;
}

function bakedExportSamples(keys: Keyframe[]): Keyframe[] {
  const samples: Keyframe[] = [];

  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    const next = keys[index + 1];
    const frameSpan = next.frame - key.frame;
    const segmentModes = animationChannels.map(channel => effectiveSegmentInterpolation(key, channel));
    const hasBezier = segmentModes.includes('bezier');
    const hasConstant = segmentModes.includes('constant');
    const sameOrder = (key.rotationOrder ?? 'XYZ') === (next.rotationOrder ?? 'XYZ');
    const angularSpan = key.rotation && next.rotation && sameOrder
      ? Math.max(...key.rotation.map((value, axis) => Math.abs(next.rotation![axis] - value)))
      : 0;
    const angularSteps = angularSpan >= Math.PI - 1e-9 ? Math.max(2, Math.ceil(angularSpan / (Math.PI / 2))) : 1;
    const steps = Math.max(hasBezier ? 32 : 1, angularSteps);

    for (let step = 0; step < steps; step++) {
      const sampleFrame = key.frame + frameSpan * step / steps;
      samples.push(step === 0 ? cloneKeyframe(key) : sampleAnimation(keys, sampleFrame));
    }
    if (hasConstant && frameSpan > 0) {
      const epsilon = Math.min(1e-4, frameSpan * 1e-6);
      const nearEnd = next.frame - epsilon;
      if (nearEnd > key.frame) samples.push(sampleAnimation(keys, nearEnd));
    }
  }
  samples.push(cloneKeyframe(keys[keys.length - 1]));
  return samples;
}

export function animationTracks(object: THREE.Object3D): THREE.KeyframeTrack[] {
  const keys: Keyframe[] = object.userData.keyframes ?? [];
  if (!keys.length) return [];

  const hasNonLinear = keys.slice(0, -1).some(key =>
    animationChannels.some(channel => effectiveSegmentInterpolation(key, channel) !== 'linear')
  );
  const samples = hasNonLinear ? bakedExportSamples(keys) : linearExportSamples(keys);
  const times = samples.map(key => (key.frame - 1) / 24);

  return [
    new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, samples.flatMap(key => key.position), THREE.InterpolateLinear),
    new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, samples.flatMap(key => key.quaternion), THREE.InterpolateLinear),
    new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, samples.flatMap(key => key.scale), THREE.InterpolateLinear),
  ];
}
