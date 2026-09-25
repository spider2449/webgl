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
  for (let i = 0; i < positions.length / 3; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
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
