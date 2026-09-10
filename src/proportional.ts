import type { MeshTopology } from './topology';

// Distances are measured in local mesh coordinates at the start of a drag.
export function proportionalWeights(positions: ArrayLike<number>, topology: MeshTopology, selected: number[], radius: number, connected = false): Float32Array {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Proportional radius must be a finite positive number.');
  const seeds = [...new Set(selected.map(i => topology.bufferToVertex[i]))].map(v => topology.vertices[v][0]);
  const weights = new Float32Array(topology.bufferToVertex.length);
  const distances = connected ? connectedDistances(positions, topology, seeds, radius) : null;
  for (const copies of topology.vertices) {
    const i = copies[0];
    let distance = distances ? distances[topology.bufferToVertex[i]] : Infinity;
    if (!distances) for (const seed of seeds) distance = Math.min(distance, Math.hypot(
      positions[i * 3] - positions[seed * 3], positions[i * 3 + 1] - positions[seed * 3 + 1], positions[i * 3 + 2] - positions[seed * 3 + 2]));
    const t = Math.max(0, 1 - distance / radius);
    const weight = t * t * (3 - 2 * t);
    for (const copy of copies) weights[copy] = weight;
  }
  return weights;
}

// Multi-source Dijkstra over logical edges; seam copies share one distance.
function connectedDistances(positions: ArrayLike<number>, topology: MeshTopology, seeds: number[], radius: number): Float64Array {
  const distances = new Float64Array(topology.vertices.length).fill(Infinity);
  const neighbors: [number, number][][] = Array.from({ length: distances.length }, () => []);
  for (const [a, b] of topology.edges) {
    const i = topology.vertices[a][0] * 3, j = topology.vertices[b][0] * 3;
    const length = Math.hypot(positions[i] - positions[j], positions[i + 1] - positions[j + 1], positions[i + 2] - positions[j + 2]);
    neighbors[a].push([b, length]); neighbors[b].push([a, length]);
  }
  const heap: [number, number][] = [];
  const push = (entry: [number, number]) => {
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][1] <= entry[1]) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child++;
        if (heap[child][1] >= last[1]) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  for (const seed of seeds) {
    const v = topology.bufferToVertex[seed];
    distances[v] = 0; push([v, 0]);
  }
  while (heap.length) {
    const [v, distance] = pop();
    if (distance !== distances[v]) continue;
    for (const [neighbor, length] of neighbors[v]) {
      const next = distance + length;
      if (next >= radius || next >= distances[neighbor]) continue;
      distances[neighbor] = next; push([neighbor, next]);
    }
  }
  return distances;
}
