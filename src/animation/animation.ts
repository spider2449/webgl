import * as THREE from 'three';
import type {
  AnimationTrackMap,
  KeyInterpolation,
  KeyTangentMode,
  ScalarAnimationChannel,
  ScalarKey,
} from '../editor';

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

export function validAnimationTracks(
  value: unknown,
  frameStart = 1,
  frameEnd = 250,
): value is AnimationTrackMap {
  if (value === undefined) return true;
  if (!Number.isInteger(frameStart) || !Number.isInteger(frameEnd) || frameStart < 1 || frameEnd <= frameStart) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([channel, keys]) => {
    if (!validAnimationChannel(channel) || !Array.isArray(keys)) return false;
    if (keys.some(key => !validScalarKey(key))) return false;
    const frames = keys.map(key => (key as ScalarKey).frame);
    return frames.every((frame, index) =>
      Number.isInteger(frame) &&
      frame >= frameStart &&
      frame <= frameEnd &&
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

export type ImportedAnimationSummary = {
  frameEnd: number;
  targets: number;
  sourceTracks: number;
  scalarKeys: number;
  firstTarget: THREE.Object3D | null;
};

const GLB_IMPORT_FPS = 24;
const GLB_IMPORT_MAX_FRAME = 100_000;
const GLB_IMPORT_MAX_SCALAR_KEYS = 250_000;

function resolveImportedAnimationTarget(root: THREE.Object3D, token: string) {
  if (!token) return root;
  const uuidMatches: THREE.Object3D[] = [];
  const nameMatches: THREE.Object3D[] = [];
  root.traverse(object => {
    if (object.uuid === token) uuidMatches.push(object);
    if (object.name === token) nameMatches.push(object);
  });
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) throw new Error(`GLB animation target "${token}" is ambiguous.`);
  if (nameMatches.length === 1) return nameMatches[0];
  if (!nameMatches.length) throw new Error(`GLB animation target "${token}" was not found in the imported scene.`);
  throw new Error(`GLB animation target "${token}" is ambiguous; animated node names must be unique.`);
}

function continuousEulerFromQuaternion(
  quaternion: THREE.Quaternion,
  order: THREE.EulerOrder,
  reference: THREE.Vector3,
) {
  const primaryEuler = new THREE.Euler().setFromQuaternion(quaternion, order);
  const primary = new THREE.Vector3(primaryEuler.x, primaryEuler.y, primaryEuler.z);
  const turn = Math.PI * 2;
  const unwrap = (value: number, target: number) => value + Math.round((target - value) / turn) * turn;
  const nearest = (candidate: THREE.Vector3) => new THREE.Vector3(
    unwrap(candidate.x, reference.x),
    unwrap(candidate.y, reference.y),
    unwrap(candidate.z, reference.z),
  );

  if (order === 'XYZ' && Math.abs(Math.cos(primary.y)) < 1e-3) {
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    const elements = matrix.elements;
    const theta = Math.atan2(elements[6], elements[5]);
    const positive = Math.sin(primary.y) >= 0;
    const referenceCombination = positive ? reference.x + reference.z : reference.x - reference.z;
    const compatibleCombination = unwrap(theta, referenceCombination);
    const delta = compatibleCombination - referenceCombination;
    return new THREE.Vector3(
      reference.x + delta / 2,
      unwrap(primary.y, reference.y),
      reference.z + (positive ? delta / 2 : -delta / 2),
    );
  }

  const alternate = primary.clone();
  const first = order[0].toLowerCase() as 'x' | 'y' | 'z';
  const middle = order[1].toLowerCase() as 'x' | 'y' | 'z';
  const last = order[2].toLowerCase() as 'x' | 'y' | 'z';
  alternate[first] += Math.PI;
  alternate[middle] = Math.PI - alternate[middle];
  alternate[last] += Math.PI;

  const candidates = [nearest(primary), nearest(alternate)];
  return candidates.reduce((a, b) =>
    a.distanceToSquared(reference) <= b.distanceToSquared(reference) ? a : b
  );
}

export function importAnimationClip(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  options: {
    fps?: number;
    maxFrame?: number;
    maxScalarKeys?: number;
  } = {},
): ImportedAnimationSummary {
  const fps = options.fps ?? GLB_IMPORT_FPS;
  const maxFrame = options.maxFrame ?? GLB_IMPORT_MAX_FRAME;
  const maxScalarKeys = options.maxScalarKeys ?? GLB_IMPORT_MAX_SCALAR_KEYS;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('GLB animation import requires a positive finite frame rate.');
  if (!Number.isInteger(maxFrame) || maxFrame < 2) throw new Error('GLB animation import frame limit is invalid.');
  if (!Number.isInteger(maxScalarKeys) || maxScalarKeys < 1) throw new Error('GLB animation import key limit is invalid.');
  if (!clip.tracks.length) return { frameEnd: 1, targets: 0, sourceTracks: 0, scalarKeys: 0, firstTarget: null };

  let duration = 0;
  for (const track of clip.tracks) {
    if (!track.times.length) throw new Error(`GLB animation track "${track.name}" has no key times.`);
    let previous = -Infinity;
    for (const time of track.times) {
      if (!Number.isFinite(time) || time < 0 || time < previous) {
        throw new Error(`GLB animation track "${track.name}" has invalid key times.`);
      }
      previous = time;
      duration = Math.max(duration, time);
    }
  }

  const frameEnd = Math.ceil(duration * fps - 1e-9) + 1;
  if (frameEnd > maxFrame) {
    throw new Error(`GLB animation reaches frame ${frameEnd}, beyond Forge's supported frame ${maxFrame}.`);
  }

  const estimatedScalarKeys = clip.tracks.length * 3 * frameEnd;
  if (estimatedScalarKeys > maxScalarKeys) {
    throw new Error(
      `GLB animation would create about ${estimatedScalarKeys.toLocaleString()} scalar keys; the import limit is ${maxScalarKeys.toLocaleString()}.`,
    );
  }

  const pending = new Map<THREE.Object3D, AnimationTrackMap>();
  const seen = new Set<string>();
  let scalarKeys = 0;

  for (const track of clip.tracks) {
    const match = /^(.*)\.(position|quaternion|scale)$/.exec(track.name);
    if (!match) {
      const property = track.name.slice(track.name.lastIndexOf('.') + 1);
      throw new Error(
        property === 'morphTargetInfluences'
          ? 'GLB morph-target animation is not editable in Forge yet.'
          : `GLB animation track "${track.name}" targets an unsupported property.`,
      );
    }

    const [, targetToken, property] = match as [string, string, 'position' | 'quaternion' | 'scale'];
    const target = resolveImportedAnimationTarget(root, targetToken);
    const identity = `${target.uuid}:${property}`;
    if (seen.has(identity)) {
      throw new Error(`GLB animation contains multiple "${property}" tracks for "${target.name || target.uuid}".`);
    }
    seen.add(identity);

    const expectedSize = property === 'quaternion' ? 4 : 3;
    const output = new Float32Array(expectedSize);
    const interpolant = track.createInterpolant(output);
    const discrete = track.getInterpolation() === THREE.InterpolateDiscrete;
    const targetTracks = pending.get(target) ?? {};
    pending.set(target, targetTracks);

    const channels = property === 'quaternion'
      ? propertyChannels('rotation')
      : propertyChannels(property);
    const keys = channels.map(() => [] as ScalarKey[]);
    let rotationReference = new THREE.Vector3(target.rotation.x, target.rotation.y, target.rotation.z);
    const quaternion = new THREE.Quaternion();

    for (let frame = 1; frame <= frameEnd; frame++) {
      const time = Math.min((frame - 1) / fps, duration);
      const sample = interpolant.evaluate(time);
      if (property === 'quaternion') {
        quaternion.set(Number(sample[0]), Number(sample[1]), Number(sample[2]), Number(sample[3]));
        if (![quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite) || quaternion.lengthSq() < 1e-12) {
          throw new Error(`GLB animation track "${track.name}" contains an invalid quaternion sample.`);
        }
        quaternion.normalize();
        const rotation = continuousEulerFromQuaternion(quaternion, target.rotation.order, rotationReference);
        rotationReference = rotation;
        [rotation.x, rotation.y, rotation.z].forEach((value, axis) => {
          keys[axis].push({
            frame,
            value,
            ...(discrete ? { interpolation: 'constant' as const } : {}),
          });
        });
      } else {
        for (let axis = 0; axis < 3; axis++) {
          const value = Number(sample[axis]);
          if (!Number.isFinite(value)) throw new Error(`GLB animation track "${track.name}" contains a non-finite sample.`);
          keys[axis].push({
            frame,
            value,
            ...(discrete ? { interpolation: 'constant' as const } : {}),
          });
        }
      }
    }

    channels.forEach((channel, axis) => {
      targetTracks[channel] = keys[axis];
      scalarKeys += keys[axis].length;
    });
  }

  if (scalarKeys > maxScalarKeys) {
    throw new Error(`GLB animation exceeds the ${maxScalarKeys.toLocaleString()} scalar-key import limit.`);
  }

  for (const [target, tracks] of pending) target.userData.animationTracks = tracks;

  return {
    frameEnd,
    targets: pending.size,
    sourceTracks: clip.tracks.length,
    scalarKeys,
    firstTarget: pending.keys().next().value ?? null,
  };
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
      const fallback = [object.rotation.x, object.rotation.y, object.rotation.z];
      const valuesA = channels.map((channel, axis) =>
        sampleAnimationChannel(tracks, a, channel, fallback[axis])
      );
      const valuesB = channels.map((channel, axis) =>
        sampleAnimationChannel(tracks, b, channel, fallback[axis])
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
      const fallback = [object.rotation.x, object.rotation.y, object.rotation.z];
      const values = frames.flatMap(frame => {
        const rotation = channels.map((channel, axis) =>
          sampleAnimationChannel(tracks, frame, channel, fallback[axis])
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
