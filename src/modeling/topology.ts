export type ComponentMode = 'vertex' | 'edge' | 'face';
export type MeshTopology = {
  vertices: number[][];
  bufferToVertex: number[];
  // Renderer/modeling substrate: individual triangles and every triangle edge.
  edges: [number, number][];
  faces: [number, number, number][];
  // Viewport modeling layer: logical polygons and only their boundary edges.
  polygons: number[][];
  polygonTriangles: number[][];
  triangleToPolygon: number[];
  polygonEdges: [number, number][];
  polygonEdgeToEdge: number[];
};

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function orderedPairBoundary(a: [number, number, number], b: [number, number, number]): number[] | null {
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (const face of [a, b]) for (let i = 0; i < 3; i++) {
    const x = face[i], y = face[(i + 1) % 3], key = edgeKey(x, y);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { a: x, b: y, count: 1 });
  }
  const boundary = [...counts.values()].filter(edge => edge.count === 1);
  if (boundary.length !== 4 || new Set([...a, ...b]).size !== 4) return null;

  const neighbors = new Map<number, number[]>();
  for (const edge of boundary) {
    neighbors.set(edge.a, [...(neighbors.get(edge.a) ?? []), edge.b]);
    neighbors.set(edge.b, [...(neighbors.get(edge.b) ?? []), edge.a]);
  }
  if ([...neighbors.values()].some(list => list.length !== 2)) return null;

  const start = boundary[0].a;
  const result = [start];
  let previous = -1, current = start;
  while (result.length < 4) {
    const next = neighbors.get(current)!.find(vertex => vertex !== previous);
    if (next === undefined || result.includes(next)) return null;
    result.push(next);
    previous = current;
    current = next;
  }
  if (!neighbors.get(current)!.includes(start)) return null;
  return result;
}

// Triangle topology owns renderer/modeling connectivity. When pairTriangles is
// enabled, consecutive triangle pairs are additionally exposed as logical quads.
// Three.js PlaneGeometry and BoxGeometry emit exactly two consecutive triangles
// per grid cell, so this mode is intentionally used only for Forge Plane/Cube
// parametric primitives.
export function buildTopology(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>,
  pairTriangles = false,
): MeshTopology {
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
  const edgeIds = new Map<string, number>();
  const count = indices?.length ?? bufferToVertex.length;
  for (let i = 0; i + 2 < count; i += 3) {
    const face = [0, 1, 2].map(offset => bufferToVertex[indices ? indices[i + offset] : i + offset]) as [number, number, number];
    faces.push(face);
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], key = edgeKey(a, b);
      if (a !== b && !edgeIds.has(key)) {
        edgeIds.set(key, edges.length);
        edges.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
  }

  const polygons: number[][] = [];
  const polygonTriangles: number[][] = [];
  const triangleToPolygon = new Array<number>(faces.length);

  if (pairTriangles) {
    for (let face = 0; face < faces.length; face += 2) {
      const next = face + 1;
      const quad = next < faces.length ? orderedPairBoundary(faces[face], faces[next]) : null;
      const polygon = quad ?? [...faces[face]];
      const id = polygons.length;
      polygons.push(polygon);
      polygonTriangles.push(quad ? [face, next] : [face]);
      triangleToPolygon[face] = id;
      if (quad) triangleToPolygon[next] = id;
      else if (next < faces.length) {
        const fallback = polygons.length;
        polygons.push([...faces[next]]);
        polygonTriangles.push([next]);
        triangleToPolygon[next] = fallback;
      }
    }
  } else {
    faces.forEach((face, id) => {
      polygons.push([...face]);
      polygonTriangles.push([id]);
      triangleToPolygon[id] = id;
    });
  }

  const polygonEdges: [number, number][] = [], polygonEdgeToEdge: number[] = [];
  const seenPolygonEdges = new Set<string>();
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], key = edgeKey(a, b);
    if (a === b || seenPolygonEdges.has(key)) continue;
    const sourceEdge = edgeIds.get(key);
    if (sourceEdge === undefined) throw new Error('Logical polygon boundary is not a renderer edge.');
    seenPolygonEdges.add(key);
    polygonEdges.push([Math.min(a, b), Math.max(a, b)]);
    polygonEdgeToEdge.push(sourceEdge);
  }

  return {
    vertices,
    bufferToVertex,
    edges,
    faces,
    polygons,
    polygonTriangles,
    triangleToPolygon,
    polygonEdges,
    polygonEdgeToEdge,
  };
}
