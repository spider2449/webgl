import * as THREE from 'three';
import type { AnimationTrackMap } from '../editor';
import { objectAnimationActionState } from './blender-actions';

export function activeAnimationTracks(object: THREE.Object3D): AnimationTrackMap {
  const state = objectAnimationActionState(object);
  if (!state.active || !state.actions[state.active]) return (object.userData.animationTracks as AnimationTrackMap | undefined) ?? {};
  return state.actions[state.active];
}

export function setActiveAnimationAction(object: THREE.Object3D, name: string): string | null {
  const state = objectAnimationActionState(object);
  if (!state.actions[name]) return null;
  object.userData.activeAnimationAction = name;
  object.userData.animationActions = { ...state.actions };
  object.userData.animationTracks = state.actions[name];
  return name;
}
