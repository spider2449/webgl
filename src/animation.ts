import * as THREE from 'three';
import type {
  AnimationTrackMap,
  KeyInterpolation,
  KeyTangentMode,
  ScalarAnimationChannel,
  ScalarKey,
} from './editor';

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

export function validScalarKey(value: unknown): value is ScalarKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  if (Object.keys(key).some(name => !['frame','value','interpolation','tangent','left','right'].includes(name))) return false;
  if (!Number.isFinite(key.frame) || !Number.isFinite(key.value)) return false;
  if (key.interpolation !== undefined && !validKeyInterpolation(key.interpolation)) return false;
  if (key.tangent !== undefined && !validKeyTangentMode(key.tangent)) return false;
  for (const handle of [key.left, key.right]) {
    if (handle !== undefined && (
      !Array.isArray(handle) ||
      handle.length !== 2 ||
      handle.some(component => !Number.isFinite(component))
    )) return false;
  }
  return true;
}

export function validAnimationTracks(value: unknown): value is AnimationTrackMap {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([channel, keys]) => {
    if (!validAnimationChannel(channel) || !Array.isArray(keys)) return false;
    if (keys.some(key => !validScalarKey(key))) return false;
    const frames = keys.map(key => (key as ScalarKey).frame);
    return frames.every((frame, index) =>
      Number.isInteger(frame) &&
      frame >= 1 &&
      frame <= 250 &&
      (index === 0 || frame > frames[index - 1])
    );
  });
}

export function cloneScalarKey(key: ScalarKey): ScalarKey {
  return {
    frame: key.frame,
    value: key.value,
    ...(key.interpolation ? { interpolation: key.interpolation } : {}),
    ...(key.tangent ? { tangent: key.tangent } : {}),
    ...(key.left ? { left: [...key.left] as [number, number] } : {}),
    ...(key.right ? { right: [...key.right] as [number, number] } : {}),
  };
}

export function cloneAnimationTracks(tracks: AnimationTrackMap | undefined): AnimationTrackMap {
  return tracks ? Object.fromEntries(Object.entries(tracks).map(([channel, keys]) => [
    channel,
    (keys ?? []).map(cloneScalarKey),
  ])) as AnimationTrackMap : {};
}

export function trackKeys(tracks: AnimationTrackMap | undefined, channel: ScalarAnimationChannel): ScalarKey[] {
  return tracks?.[channel] ?? [];
}

export function effectiveSegmentInterpolation(key: ScalarKey): KeyInterpolation {
  return key.interpolation ?? 'linear';
}

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function segmentSlope(a: ScalarKey, b: ScalarKey) {
  const span = b.frame - a.frame;
  return span > 0 ? (b.value - a.value) / span : 0;
}

function automaticSlope(keys: ScalarKey[], index: number) {
  if (keys.length < 2) return 0;
  if (index <= 0) return segmentSlope(keys[0], keys[1]);
  if (index >= keys.length - 1) return segmentSlope(keys[keys.length - 2], keys[keys.length - 1]);

  const previous = keys[index - 1];
  const key = keys[index];
  const next = keys[index + 1];
  const h0 = key.frame - previous.frame;
  const h1 = next.frame - key.frame;
  const d0 = segmentSlope(previous, key);
  const d1 = segmentSlope(key, next);
  if (h0 <= 0 || h1 <= 0 || d0 === 0 || d1 === 0 || Math.sign(d0) !== Math.sign(d1)) return 0;

  const w1 = 2 * h1 + h0;
  const w2 = h1 + 2 * h0;
  return (w1 + w2) / (w1 / d0 + w2 / d1);
}

export function effectiveBezierHandle(
  keys: ScalarKey[],
  index: number,
  side: 'left' | 'right',
): [number, number] | null {
  const key = keys[index];
  if (!key) return null;
  const tangent = key.tangent ?? 'free';

  if (side === 'left') {
    if (index <= 0) return null;
    const previous = keys[index - 1];
    const span = key.frame - previous.frame;
    if (span <= 0) return null;
    if (tangent === 'auto') {
      const dx = -span / 3;
      return [dx, automaticSlope(keys, index) * dx];
    }
    return key.left ?? [-span / 3, -(key.value - previous.value) / 3];
  }

  if (index >= keys.length - 1) return null;
  const next = keys[index + 1];
  const span = next.frame - key.frame;
  if (span <= 0) return null;
  if (tangent === 'auto') {
    const dx = span / 3;
    return [dx, automaticSlope(keys, index) * dx];
  }
  return key.right ?? [span / 3, (next.value - key.value) / 3];
}

export function bezierControlPoints(keys: ScalarKey[], index: number) {
  const a = keys[index];
  const b = keys[index + 1];
  if (!a || !b) throw new Error('Bezier segment requires two keys.');
  const right = effectiveBezierHandle(keys, index, 'right')!;
  const left = effectiveBezierHandle(keys, index + 1, 'left')!;

  let x1 = THREE.MathUtils.clamp(a.frame + right[0], a.frame, b.frame);
  let x2 = THREE.MathUtils.clamp(b.frame + left[0], a.frame, b.frame);
  if (x1 > x2) {
    const middle = (x1 + x2) / 2;
    x1 = middle;
    x2 = middle;
  }
  return {
    x1,
    y1: a.value + right[1],
    x2,
    y2: b.value + left[1],
    va: a.value,
    vb: b.value,
  };
}

function bezierValue(keys: ScalarKey[], index: number, frame: number) {
  const a = keys[index];
  const b = keys[index + 1];
  const { x1, y1, x2, y2, va, vb } = bezierControlPoints(keys, index);
  if (b.frame <= a.frame) return va;

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const t = (low + high) / 2;
    const x = cubic(a.frame, x1, x2, b.frame, t);
    if (x < frame) low = t;
    else high = t;
  }
  return cubic(va, y1, y2, vb, (low + high) / 2);
}

export function sampleScalarTrack(keys: ScalarKey[], frame: number, fallback = 0) {
  if (!keys.length) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;

  const exact = keys.find(key => key.frame === frame);
  if (exact) return exact.value;

  const bIndex = keys.findIndex(key => key.frame > frame);
  const aIndex = Math.max(0, bIndex - 1);
  const a = keys[aIndex];
  const b = keys[bIndex];
  const mode = effectiveSegmentInterpolation(a);
  const t = THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);

  if (mode === 'constant') return a.value;
  if (mode === 'bezier') return bezierValue(keys, aIndex, frame);
  return THREE.MathUtils.lerp(a.value, b.value, t);
}

export function sampleAnimationChannel(
  tracks: AnimationTrackMap | undefined,
  frame: number,
  channel: ScalarAnimationChannel,
  fallback = 0,
) {
  return sampleScalarTrack(trackKeys(tracks, channel), frame, fallback);
}

export function allAnimationFrames(tracks: AnimationTrackMap | undefined) {
  const frames = new Set<number>();
  for (const keys of Object.values(tracks ?? {})) {
    for (const key of keys ?? []) frames.add(key.frame);
  }
  return [...frames].sort((a, b) => a - b);
}

function propertyChannels(property: 'position' | 'rotation' | 'scale') {
  return axes.map(axis => `${property}.${axis}` as ScalarAnimationChannel);
}

function sampledFramesForGroup(
  tracks: AnimationTrackMap,
  property: 'position' | 'rotation' | 'scale',
  object: THREE.Object3D,
) {
  const channels = propertyChannels(property);
  const frames = new Set<number>();

  for (const channel of channels) {
    const keys = trackKeys(tracks, channel);
    for (const key of keys) frames.add(key.frame);
    for (let index = 0; index < keys.length - 1; index++) {
      const key = keys[index];
      const next = keys[index + 1];
      const span = next.frame - key.frame;
      const mode = effectiveSegmentInterpolation(key);

      if (mode === 'bezier') {
        for (let step = 1; step < 32; step++) frames.add(key.frame + span * step / 32);
      }
      if (mode === 'constant' && span > 0) {
        const epsilon = Math.min(1e-4, span * 1e-6);
        const nearEnd = next.frame - epsilon;
        if (nearEnd > key.frame) frames.add(nearEnd);
      }
    }
  }

  let sorted = [...frames].sort((a, b) => a - b);
  if (property === 'rotation' && sorted.length > 1) {
    const extra = new Set<number>();
    for (let index = 0; index < sorted.length - 1; index++) {
      const a = sorted[index];
      const b = sorted[index + 1];
      const valuesA = channels.map((channel, axis) =>
        sampleAnimationChannel(tracks, a, channel, object.rotation.getComponent(axis))
      );
      const valuesB = channels.map((channel, axis) =>
        sampleAnimationChannel(tracks, b, channel, object.rotation.getComponent(axis))
      );
      const angularSpan = Math.max(...valuesA.map((value, axis) => Math.abs(valuesB[axis] - value)));
      const steps = angularSpan >= Math.PI - 1e-9
        ? Math.max(2, Math.ceil(angularSpan / (Math.PI / 2)))
        : 1;
      for (let step = 1; step < steps; step++) extra.add(a + (b - a) * step / steps);
    }
    sorted = [...new Set([...sorted, ...extra])].sort((a, b) => a - b);
  }
  return sorted;
}

export function animationTracks(object: THREE.Object3D): THREE.KeyframeTrack[] {
  const tracks = (object.userData.animationTracks ?? {}) as AnimationTrackMap;
  const output: THREE.KeyframeTrack[] = [];

  for (const property of ['position','rotation','scale'] as const) {
    const channels = propertyChannels(property);
    if (!channels.some(channel => trackKeys(tracks, channel).length)) continue;

    const frames = sampledFramesForGroup(tracks, property, object);
    if (!frames.length) continue;
    const times = frames.map(frame => (frame - 1) / 24);

    if (property === 'rotation') {
      const values = frames.flatMap(frame => {
        const rotation = channels.map((channel, axis) =>
          sampleAnimationChannel(tracks, frame, channel, object.rotation.getComponent(axis))
        );
        return new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], object.rotation.order))
          .toArray();
      });
      output.push(new THREE.QuaternionKeyframeTrack(
        `${object.uuid}.quaternion`,
        times,
        values,
        THREE.InterpolateLinear,
      ));
      continue;
    }

    const vector = property === 'position' ? object.position : object.scale;
    const values = frames.flatMap(frame =>
      channels.map((channel, axis) => sampleAnimationChannel(tracks, frame, channel, vector.getComponent(axis)))
    );
    output.push(new THREE.VectorKeyframeTrack(
      `${object.uuid}.${property}`,
      times,
      values,
      THREE.InterpolateLinear,
    ));
  }

  return output;
}
