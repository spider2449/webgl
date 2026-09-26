import * as THREE from 'three';
import type { Modifier } from './modifiers';
export type ModelingOperation =
  | { kind: 'bevel'; edges: number[]; width: number; polygonTriangles?: number[][] }
  | { kind: 'loop'; edge: number; polygonTriangles?: number[][] }
  | { kind: 'uv'; faces: number[]; operation: 'project' | 'transform'; values: number[] }
  | { kind: 'modifiers'; items: Modifier[] }
  | { kind: 'extrude'; face: number; distance: number; polygonTriangles?: number[][] }
  | { kind: 'inset'; face: number; distance: number; polygonTriangles?: number[][] }
  | { kind: 'delete-components'; mode: 'vertex' | 'edge' | 'face'; components: number[]; polygonTriangles?: number[][] }
  | { kind: 'cut-face'; face: number; vertices: [number, number]; polygonTriangles?: number[][] }
  | { kind: 'cut-face-edge'; face: number; vertex: number; edge: number; t: number; polygonTriangles?: number[][] }
  | { kind: 'region'; faces: number[]; distance: number }
  | { kind: 'subdivide'; edges: [number, number][] }
  | { kind: 'subdivide-all' }
  | { kind: 'topology'; pairTriangles?: boolean; polygonTriangles?: number[][] };

export function modelingJob(geometry: THREE.BufferGeometry, operation: ModelingOperation) {
  const source = geometry.toJSON();
  if (JSON.stringify(source).length > 32 * 1024 * 1024) throw new Error('Worker payload exceeds 32 MB.');
  const worker = new Worker(new URL('./modeling.worker.ts', import.meta.url), { type: 'module' });
  let rejectJob: (error: Error) => void;
  const promise = new Promise<{ geometry?: ReturnType<THREE.BufferGeometry['toJSON']>; topology?: import('./topology').MeshTopology; milliseconds: number }>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = event => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data);
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Modeling worker failed.')); };
    worker.postMessage({ source, operation });
  });
  const timer = setTimeout(() => { cleanup(); rejectJob(new Error('Modeling worker timed out.')); }, 60_000);
  function cleanup() { clearTimeout(timer); worker.terminate(); }
  return { promise, cancel() { cleanup(); rejectJob(new Error('Modeling operation cancelled.')); } };
}
