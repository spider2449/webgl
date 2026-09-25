export type ComponentMode = 'vertex' | 'edge' | 'face';
export type MeshTopology = {
  vertices: number[][];
  bufferToVertex: number[];
  // Render-triangle connectivity remains authoritative for geometry operations.
  edges: [number, number][];
  faces: [number, number, number][];
  // Modeling polygons group one or more render triangles. Imported/unknown
  // geometry defaults to one triangle per polygon.
  polygons: number[][];
  polygonTriangles: number[][];
  triangleToPolygon: number[];
  polygonEdges: [number, number][];
  polygonEdgeToEdge: number[];
};

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function identityPolygonGroups(faceCount: number) {
  return Array.from({ length: faceCount }, (_, face) => [face]);
}

function validPolygonGroups(value: unknown, faceCount: number): number[][] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const group of value) {
    if (!Array.isArray(group) || !group.length) return null;
    const triangles: number[] = [];
    for (const triangle of group) {
      if (!Number.isInteger(triangle) || triangle < 0 || triangle >= faceCount || seen.has(triangle)) return null;
      seen.add(triangle);
      triangles.push(triangle);
    }
    groups.push(triangles);
  }
  return seen.size === faceCount ? groups : null;
}

function polygonBoundary(faces: [number, number, number][], triangles: number[]): number[] | null {
  const uses = new Map<string, { a: number; b: number; count: number }>();
  for (const triangle of triangles) {
    const face = faces[triangle];
    if (!face) return null;
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = edgeKey(a, b);
      const previous = uses.get(key);
      if (previous) previous.count++;
      else uses.set(key, { a, b, count: 1 });
    }
  }
  const boundary = [...uses.values()].filter(edge => edge.count === 1);
  const groupVertices = new Set(triangles.flatMap(triangle => [...faces[triangle]]));
  if (
    boundary.length < 3 ||
    boundary.length !== groupVertices.size ||
    [...uses.values()].some(edge => edge.count > 2)
  ) return null;
  const next = new Map<number, number>();
  const incoming = new Set<number>();
  for (const { a, b } of boundary) {
    if (next.has(a) || incoming.has(b)) return null;
    next.set(a, b);
    incoming.add(b);
  }
  const start = boundary[0].a, polygon = [start];
  let current = start;
  for (let i = 0; i < boundary.length; i++) {
    const following = next.get(current);
    if (following === undefined) return null;
    current = following;
    if (current === start) return polygon.length === boundary.length ? polygon : null;
    polygon.push(current);
  }
  return null;
}

// Triangle topology owns render connectivity separately from modeling polygons.
// Exact coincident positions share a vertex, including normal and UV seams.
// polygonTriangles may group render triangles into logical modeling polygons.
export function buildTopology(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>,
  polygonTriangles?: unknown,
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

  let groups = validPolygonGroups(polygonTriangles, faces.length) ?? identityPolygonGroups(faces.length);
  let polygons = groups.map(group => polygonBoundary(faces, group));
  if (polygons.some(polygon => !polygon)) {
    groups = identityPolygonGroups(faces.length);
    polygons = groups.map(group => [...faces[group[0]]]);
  }

  const safePolygons = polygons as number[][];
  const triangleToPolygon = new Array<number>(faces.length);
  groups.forEach((triangles, polygon) => triangles.forEach(triangle => { triangleToPolygon[triangle] = polygon; }));

  const polygonEdges: [number, number][] = [];
  const polygonEdgeToEdge: number[] = [];
  const polygonEdgeIds = new Set<string>();
  for (const polygon of safePolygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], key = edgeKey(a, b);
      if (a === b || polygonEdgeIds.has(key)) continue;
      const renderEdge = edgeIds.get(key);
      if (renderEdge === undefined) continue;
      polygonEdgeIds.add(key);
      polygonEdges.push([Math.min(a, b), Math.max(a, b)]);
      polygonEdgeToEdge.push(renderEdge);
    }
  }

  return {
    vertices,
    bufferToVertex,
    edges,
    faces,
    polygons: safePolygons,
    polygonTriangles: groups,
    triangleToPolygon,
    polygonEdges,
    polygonEdgeToEdge,
  };
}
