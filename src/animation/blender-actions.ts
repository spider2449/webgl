import * as THREE from 'three';
import { cloneAnimationTracks } from './animation';
import type { AnimationTrackMap } from '../editor';

export type AnimationActionMap = Record<string, AnimationTrackMap>;

export type AnimationActionState = {
  active: string | null;
  actions: AnimationActionMap;
};

function cloneActionMap(actions: AnimationActionMap | undefined): AnimationActionMap {
  const output: AnimationActionMap = {};
  for (const [name, tracks] of Object.entries(actions ?? {})) {
    output[name] = cloneAnimationTracks(tracks);
  }
  return output;
}

export function normalizeAnimationActionName(name: string, existing: Iterable<string>, fallback = 'Action') {
  const base = name.trim() || fallback;
  const used = new Set(existing);
  let candidate = base;
  let index = 1;
  while (used.has(candidate)) {
    candidate = `${base}.${String(index).padStart(3, '0')}`;
    index++;
  }
  return candidate;
}

export function ensureObjectAnimationActions(object: THREE.Object3D): AnimationActionState {
  const existing = cloneActionMap((object.userData.animationActions as AnimationActionMap | undefined) ?? {});
  const legacy = object.userData.animationTracks as AnimationTrackMap | undefined;

  if (!Object.keys(existing).length && legacy && Object.values(legacy).some(keys => (keys ?? []).length)) {
    const defaultName = normalizeAnimationActionName('Action', Object.keys(existing));
    existing[defaultName] = cloneAnimationTracks(legacy);
  }

  if (!Object.keys(existing).length) {
    object.userData.animationActions = {};
    object.userData.activeAnimationAction = null;
    object.userData.animationTracks = {};
    return { active: null, actions: {} };
  }

  const active = typeof object.userData.activeAnimationAction === 'string' && existing[object.userData.activeAnimationAction]
    ? object.userData.activeAnimationAction
    : Object.keys(existing)[0];

  object.userData.animationActions = cloneActionMap(existing);
  object.userData.activeAnimationAction = active;
  object.userData.animationTracks = cloneAnimationTracks(existing[active]);

  return { active, actions: cloneActionMap(existing) };
}

export function animationActionNames(object: THREE.Object3D): string[] {
  const state = ensureObjectAnimationActions(object);
  return Object.keys(state.actions);
}

export function setActiveAnimationAction(object: THREE.Object3D, name: string): string | null {
  const state = ensureObjectAnimationActions(object);
  if (!state.actions[name]) return null;
  object.userData.activeAnimationAction = name;
  object.userData.animationTracks = cloneAnimationTracks(state.actions[name]);
  object.userData.animationActions = cloneActionMap(state.actions);
  return name;
}

export function createAnimationAction(object: THREE.Object3D, name?: string): string | null {
  const state = ensureObjectAnimationActions(object);
  const nextName = normalizeAnimationActionName(name ?? 'Action', Object.keys(state.actions));
  state.actions[nextName] = cloneAnimationTracks((object.userData.animationTracks as AnimationTrackMap | undefined) ?? {});
  object.userData.animationActions = cloneActionMap(state.actions);
  object.userData.activeAnimationAction = nextName;
  object.userData.animationTracks = cloneAnimationTracks(state.actions[nextName]);
  return nextName;
}

export function duplicateAnimationAction(object: THREE.Object3D, sourceName?: string): string | null {
  const state = ensureObjectAnimationActions(object);
  const source = sourceName ?? state.active ?? Object.keys(state.actions)[0];
  if (!state.actions[source]) return null;
  const nextName = normalizeAnimationActionName(`${source}.copy`, Object.keys(state.actions));
  state.actions[nextName] = cloneAnimationTracks(state.actions[source]);
  object.userData.animationActions = cloneActionMap(state.actions);
  object.userData.activeAnimationAction = nextName;
  object.userData.animationTracks = cloneAnimationTracks(state.actions[nextName]);
  return nextName;
}

export function deleteAnimationAction(object: THREE.Object3D, name: string): boolean {
  const state = ensureObjectAnimationActions(object);
  if (!state.actions[name] || Object.keys(state.actions).length <= 1) return false;
  const { [name]: _removed, ...remaining } = state.actions;
  object.userData.animationActions = cloneActionMap(remaining);
  const nextActive = Object.keys(remaining)[0];
  object.userData.activeAnimationAction = nextActive;
  object.userData.animationTracks = cloneAnimationTracks(remaining[nextActive]);
  return true;
}
