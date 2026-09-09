import type { MeshTopology } from './topology';

// Distances are measured in local mesh coordinates at the start of a drag.
export function proportionalWeights(positions: ArrayLike<number>, topology: MeshTopology, selected: number[], radius: number): Float32Array {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Proportional radius must be a finite positive number.');
  const seeds = [...new Set(selected.map(i => topology.bufferToVertex[i]))].map(v => topology.vertices[v][0]);
  const weights = new Float32Array(topology.bufferToVertex.length);
  for (const copies of topology.vertices) {
    const i = copies[0];
    let distance = Infinity;
    for (const seed of seeds) distance = Math.min(distance, Math.hypot(
      positions[i * 3] - positions[seed * 3], positions[i * 3 + 1] - positions[seed * 3 + 1], positions[i * 3 + 2] - positions[seed * 3 + 2]));
    const t = Math.max(0, 1 - distance / radius);
    const weight = t * t * (3 - 2 * t);
    for (const copy of copies) weights[copy] = weight;
  }
  return weights;
}
