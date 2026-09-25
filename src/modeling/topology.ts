export type ComponentMode = 'vertex' | 'edge' | 'face';
export type MeshTopology = {
  vertices: number[][];
  bufferToVertex: number[];
  edges: [number, number][];
  faces: [number, number, number][];
};

// Triangle topology owns logical connectivity separately from rendering buffers.
// Exact coincident positions share a vertex, including normal and UV seams.
export function buildTopology(positions: ArrayLike<number>, indices?: ArrayLike<number>): MeshTopology {
  const vertices: number[][] = [], bufferToVertex: number[] = [];
  const byPosition = new Map<string, number>();

  // Three.js primitives duplicate vertices across UV/normal seams. Regenerating
  // parametric geometry can move mathematically identical seam positions by a
  // few Float32 ULPs, so exact string equality makes one visible vertex split
  // into multiple logical vertices. Quantize per axis at one millionth of the
  // local extent: safely below the supported primitive subdivision spacing,
  // while keeping seam copies topologically stable after parameter changes.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length / 3; i++) for (let axis = 0; axis < 3; axis++) {
    const value = positions[i * 3 + axis];
    if (value < min[axis]) min[axis] = value;
    if (value > max[axis]) max[axis] = value;
  }
  const epsilon = min.map((value, axis) => Math.max((max[axis] - value) * 1e-6, 1e-9));
  const positionKey = (i: number) => [0, 1, 2]
    .map(axis => Math.round((positions[i * 3 + axis] - min[axis]) / epsilon[axis]))
    .join(':');

  for (let i = 0; i < positions.length / 3; i++) {
    const key = positionKey(i);
    let vertex = byPosition.get(key);
    if (vertex === undefined) { vertex = vertices.length; byPosition.set(key, vertex); vertices.push([]); }
    vertices[vertex].push(i);
    bufferToVertex.push(vertex);
  }
  const faces: MeshTopology['faces'] = [], edges: MeshTopology['edges'] = [];
  const seen = new Set<string>();
  const count = indices?.length ?? bufferToVertex.length;
  for (let i = 0; i + 2 < count; i += 3) {
    const face = [0, 1, 2].map(offset => bufferToVertex[indices ? indices[i + offset] : i + offset]) as [number, number, number];
    faces.push(face);
    for (let j = 0; j < 3; j++) {
      const a = Math.min(face[j], face[(j + 1) % 3]), b = Math.max(face[j], face[(j + 1) % 3]);
      const key = `${a}:${b}`;
      if (a !== b && !seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  return { vertices, bufferToVertex, edges, faces };
}
