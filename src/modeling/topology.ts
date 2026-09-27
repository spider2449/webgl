export type ComponentMode = 'vertex' | 'edge' | 'face';
export type MeshTopology = {
  // Renderer-welded vertices used by triangle data and attribute updates.
  vertices: number[][];
  bufferToVertex: number[];
  // Modeling vertices: only welded vertices that occur on a logical polygon boundary.
  // Renderer-only interior tessellation vertices are deliberately excluded.
  logicalVertices: number[];
  // Renderer substrate: individual triangles and every renderer triangle edge.
  edges: [number, number][];
  faces: [number, number, number][];
  // Modeling layer: logical polygons and only their editable boundary edges.
  polygons: number[][];
  polygonTriangles: number[][];
  triangleToPolygon: number[];
  polygonEdges: [number, number][];
  polygonEdgeToEdge: number[];
};

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function orderedBoundary(faces: MeshTopology['faces'], triangleIds: number[]): number[] | null {
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (const faceId of triangleIds) {
    const face = faces[faceId];
    if (!face) return null;
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = edgeKey(a, b);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { a, b, count: 1 });
    }
  }

  const boundary = [...counts.values()].filter(edge => edge.count === 1);
  if (boundary.length < 3 || [...counts.values()].some(edge => edge.count > 2)) return null;

  // Consistently oriented renderer triangles leave one directed cycle around the
  // logical polygon once shared triangulation edges are removed.
  const next = new Map<number, number>(), incoming = new Map<number, number>();
  for (const edge of boundary) {
    if (next.has(edge.a) || incoming.has(edge.b)) return null;
    next.set(edge.a, edge.b);
    incoming.set(edge.b, edge.a);
  }
  if (next.size !== boundary.length || incoming.size !== boundary.length) return null;

  const start = boundary[0].a, result: number[] = [];
  let current = start;
  while (result.length <= boundary.length) {
    if (result.includes(current)) break;
    result.push(current);
    const following = next.get(current);
    if (following === undefined) return null;
    current = following;
    if (current === start) break;
  }
  return current === start && result.length === boundary.length ? result : null;
}

function explicitPolygons(faces: MeshTopology['faces'], groups: number[][]) {
  if (!groups.length) throw new Error('Logical polygon groups cannot be empty.');
  const seen = new Set<number>();
  const polygons: number[][] = [], polygonTriangles: number[][] = [];
  const triangleToPolygon = new Array<number>(faces.length);

  for (const group of groups) {
    if (!Array.isArray(group) || !group.length || group.some(face => !Number.isInteger(face) || face < 0 || face >= faces.length || seen.has(face))) {
      throw new Error('Invalid logical polygon triangle groups.');
    }
    const triangles = [...group];
    const polygon = orderedBoundary(faces, triangles);
    if (!polygon) throw new Error('Logical polygon triangles do not form one oriented boundary.');
    const id = polygons.length;
    polygons.push(polygon);
    polygonTriangles.push(triangles);
    for (const face of triangles) { seen.add(face); triangleToPolygon[face] = id; }
  }
  if (seen.size !== faces.length) throw new Error('Logical polygon groups must cover every renderer triangle exactly once.');
  return { polygons, polygonTriangles, triangleToPolygon };
}

// The third argument controls only the modeling layer. false exposes renderer
// triangles as logical triangles; true pairs the known consecutive triangle
// layout emitted by Forge Cube/Plane; explicit groups preserve arbitrary logical
// polygons after topology-changing polygon-native operations such as Bevel.
export function buildTopology(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>,
  logical: boolean | number[][] = false,
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

  let polygons: number[][] = [], polygonTriangles: number[][] = [], triangleToPolygon: number[] = [];
  if (Array.isArray(logical)) {
    ({ polygons, polygonTriangles, triangleToPolygon } = explicitPolygons(faces, logical));
  } else if (logical) {
    triangleToPolygon = new Array<number>(faces.length);
    for (let face = 0; face < faces.length; face += 2) {
      const next = face + 1;
      const pair = next < faces.length ? [face, next] : [face];
      const quad = pair.length === 2 ? orderedBoundary(faces, pair) : null;
      if (quad?.length === 4 && new Set([...faces[face], ...faces[next]]).size === 4) {
        const id = polygons.length;
        polygons.push(quad); polygonTriangles.push(pair);
        triangleToPolygon[face] = id; triangleToPolygon[next] = id;
      } else {
        const id = polygons.length;
        polygons.push([...faces[face]]); polygonTriangles.push([face]); triangleToPolygon[face] = id;
        if (next < faces.length) {
          const fallback = polygons.length;
          polygons.push([...faces[next]]); polygonTriangles.push([next]); triangleToPolygon[next] = fallback;
        }
      }
    }
  } else {
    triangleToPolygon = new Array<number>(faces.length);
    faces.forEach((face, id) => {
      polygons.push([...face]);
      polygonTriangles.push([id]);
      triangleToPolygon[id] = id;
    });
  }

  const logicalVertices = [...new Set(polygons.flat())].sort((a, b) => a - b);
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
    logicalVertices,
    edges,
    faces,
    polygons,
    polygonTriangles,
    triangleToPolygon,
    polygonEdges,
    polygonEdgeToEdge,
  };
}
