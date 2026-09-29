export type ComponentMode = 'vertex' | 'edge' | 'face';
export type FaceSideKind = 'triangles' | 'quads' | 'ngons';
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
  logicalVertexIds?: ArrayLike<number>,
): MeshTopology {
  const bufferCount = positions.length / 3;
  if (!Number.isInteger(bufferCount)) throw new Error('Position buffer must contain complete XYZ coordinates.');
  if (logicalVertexIds && logicalVertexIds.length !== bufferCount) {
    throw new Error('Logical vertex identity metadata does not match the position buffer.');
  }

  const vertices: number[][] = [], bufferToVertex: number[] = [];
  const byIdentity = new Map<string, number>();
  const identityPosition = new Map<number, string>();
  for (let i = 0; i < bufferCount; i++) {
    const positionKey = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    let identityKey = `p:${positionKey}`;
    if (logicalVertexIds) {
      const identity = Number(logicalVertexIds[i]);
      if (!Number.isSafeInteger(identity) || identity < 0) {
        throw new Error('Logical vertex identity metadata contains an invalid ID.');
      }
      const previousPosition = identityPosition.get(identity);
      if (previousPosition !== undefined && previousPosition !== positionKey) {
        throw new Error('One logical vertex identity refers to multiple positions.');
      }
      identityPosition.set(identity, positionKey);
      identityKey = `i:${identity}`;
    }
    let vertex = byIdentity.get(identityKey);
    if (vertex === undefined) {
      vertex = vertices.length;
      byIdentity.set(identityKey, vertex);
      vertices.push([]);
    }
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

export function linkedLogicalComponents(
  topology: MeshTopology,
  mode: ComponentMode,
  seeds: number[],
) {
  const uniqueSeeds = [...new Set(seeds)];
  if (!uniqueSeeds.length) return [];

  if (mode === 'vertex') {
    const logical = new Set(topology.logicalVertices);
    if (uniqueSeeds.some(vertex => !logical.has(vertex))) throw new Error('Select valid logical vertices.');

    const neighbors = new Map<number, number[]>();
    for (const [a, b] of topology.polygonEdges) {
      const aNeighbors = neighbors.get(a) ?? [];
      aNeighbors.push(b);
      neighbors.set(a, aNeighbors);
      const bNeighbors = neighbors.get(b) ?? [];
      bNeighbors.push(a);
      neighbors.set(b, bNeighbors);
    }

    const visited = new Set<number>();
    const queue = [...uniqueSeeds];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const vertex = queue[cursor];
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const next of neighbors.get(vertex) ?? []) if (!visited.has(next)) queue.push(next);
    }
    return topology.logicalVertices.filter(vertex => visited.has(vertex));
  }

  if (mode === 'edge') {
    if (uniqueSeeds.some(edge => !topology.polygonEdges[edge])) throw new Error('Select valid logical edges.');

    const vertexEdges = new Map<number, number[]>();
    topology.polygonEdges.forEach(([a, b], edge) => {
      for (const vertex of [a, b]) {
        const list = vertexEdges.get(vertex) ?? [];
        list.push(edge);
        vertexEdges.set(vertex, list);
      }
    });

    const visited = new Set<number>();
    const queue = [...uniqueSeeds];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const edge = queue[cursor];
      if (visited.has(edge)) continue;
      visited.add(edge);
      for (const vertex of topology.polygonEdges[edge]) {
        for (const next of vertexEdges.get(vertex) ?? []) if (!visited.has(next)) queue.push(next);
      }
    }
    return topology.polygonEdges.flatMap((_, edge) => visited.has(edge) ? [edge] : []);
  }

  if (uniqueSeeds.some(face => !topology.polygons[face])) throw new Error('Select valid logical faces.');

  const edgeFaces = new Map<string, number[]>();
  topology.polygons.forEach((polygon, face) => {
    for (let local = 0; local < polygon.length; local++) {
      const key = edgeKey(polygon[local], polygon[(local + 1) % polygon.length]);
      const list = edgeFaces.get(key) ?? [];
      list.push(face);
      edgeFaces.set(key, list);
    }
  });

  const neighbors = new Map<number, number[]>();
  for (const faces of edgeFaces.values()) {
    if (faces.length < 2) continue;
    for (const face of faces) {
      const list = neighbors.get(face) ?? [];
      for (const other of faces) if (other !== face && !list.includes(other)) list.push(other);
      neighbors.set(face, list);
    }
  }

  const visited = new Set<number>();
  const queue = [...uniqueSeeds];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const face = queue[cursor];
    if (visited.has(face)) continue;
    visited.add(face);
    for (const next of neighbors.get(face) ?? []) if (!visited.has(next)) queue.push(next);
  }
  return topology.polygons.flatMap((_, face) => visited.has(face) ? [face] : []);
}

export function growLogicalComponents(
  topology: MeshTopology,
  mode: ComponentMode,
  seeds: number[],
) {
  const uniqueSeeds = [...new Set(seeds)];
  if (!uniqueSeeds.length) return [];

  if (mode === 'vertex') {
    const logical = new Set(topology.logicalVertices);
    if (uniqueSeeds.some(vertex => !logical.has(vertex))) throw new Error('Select valid logical vertices.');
    const seedSet = new Set(uniqueSeeds);
    const result = new Set(uniqueSeeds);
    for (const [a, b] of topology.polygonEdges) {
      if (seedSet.has(a) || seedSet.has(b)) {
        result.add(a);
        result.add(b);
      }
    }
    return topology.logicalVertices.filter(vertex => result.has(vertex));
  }

  if (mode === 'edge') {
    if (uniqueSeeds.some(edge => !topology.polygonEdges[edge])) throw new Error('Select valid logical edges.');
    const seedVertices = new Set<number>();
    for (const edge of uniqueSeeds) {
      for (const vertex of topology.polygonEdges[edge]) seedVertices.add(vertex);
    }
    return topology.polygonEdges.flatMap((edge, id) =>
      uniqueSeeds.includes(id) || edge.some(vertex => seedVertices.has(vertex)) ? [id] : []
    );
  }

  if (uniqueSeeds.some(face => !topology.polygons[face])) throw new Error('Select valid logical faces.');

  const seedEdgeKeys = new Set<string>();
  for (const face of uniqueSeeds) {
    const polygon = topology.polygons[face];
    for (let local = 0; local < polygon.length; local++) {
      seedEdgeKeys.add(edgeKey(polygon[local], polygon[(local + 1) % polygon.length]));
    }
  }

  return topology.polygons.flatMap((polygon, face) => {
    if (uniqueSeeds.includes(face)) return [face];
    for (let local = 0; local < polygon.length; local++) {
      if (seedEdgeKeys.has(edgeKey(polygon[local], polygon[(local + 1) % polygon.length]))) return [face];
    }
    return [];
  });
}

export function shrinkLogicalComponents(
  topology: MeshTopology,
  mode: ComponentMode,
  selectedComponents: number[],
) {
  const selected = [...new Set(selectedComponents)];
  if (!selected.length) return [];

  if (mode === 'vertex') {
    const logical = new Set(topology.logicalVertices);
    if (selected.some(vertex => !logical.has(vertex))) throw new Error('Select valid logical vertices.');
    const selectedSet = new Set(selected);
    const neighbors = new Map<number, Set<number>>();
    for (const [a, b] of topology.polygonEdges) {
      const aNeighbors = neighbors.get(a) ?? new Set<number>();
      aNeighbors.add(b);
      neighbors.set(a, aNeighbors);
      const bNeighbors = neighbors.get(b) ?? new Set<number>();
      bNeighbors.add(a);
      neighbors.set(b, bNeighbors);
    }
    return topology.logicalVertices.filter(vertex =>
      selectedSet.has(vertex) &&
      [...(neighbors.get(vertex) ?? [])].every(neighbor => selectedSet.has(neighbor))
    );
  }

  if (mode === 'edge') {
    if (selected.some(edge => !topology.polygonEdges[edge])) throw new Error('Select valid logical edges.');
    const selectedSet = new Set(selected);
    const vertexEdges = new Map<number, Set<number>>();
    topology.polygonEdges.forEach(([a, b], edge) => {
      for (const vertex of [a, b]) {
        const edges = vertexEdges.get(vertex) ?? new Set<number>();
        edges.add(edge);
        vertexEdges.set(vertex, edges);
      }
    });

    return topology.polygonEdges.flatMap(([a, b], edge) => {
      if (!selectedSet.has(edge)) return [];
      const adjacent = new Set<number>([
        ...(vertexEdges.get(a) ?? []),
        ...(vertexEdges.get(b) ?? []),
      ]);
      adjacent.delete(edge);
      return [...adjacent].every(next => selectedSet.has(next)) ? [edge] : [];
    });
  }

  if (selected.some(face => !topology.polygons[face])) throw new Error('Select valid logical faces.');

  const selectedSet = new Set(selected);
  const edgeFaces = new Map<string, number[]>();
  topology.polygons.forEach((polygon, face) => {
    for (let local = 0; local < polygon.length; local++) {
      const key = edgeKey(polygon[local], polygon[(local + 1) % polygon.length]);
      const faces = edgeFaces.get(key) ?? [];
      faces.push(face);
      edgeFaces.set(key, faces);
    }
  });

  return topology.polygons.flatMap((polygon, face) => {
    if (!selectedSet.has(face)) return [];
    for (let local = 0; local < polygon.length; local++) {
      const faces = edgeFaces.get(edgeKey(polygon[local], polygon[(local + 1) % polygon.length])) ?? [];
      if (faces.some(next => next !== face && !selectedSet.has(next))) return [];
    }
    return [face];
  });
}

export function logicalFaceBoundaryEdges(topology: MeshTopology, faces: number[]) {
  const selected = new Set(faces);
  if (!selected.size) return [];
  if ([...selected].some(face => !topology.polygons[face])) throw new Error('Select valid logical faces.');

  const edgeByKey = new Map(topology.polygonEdges.map((edge, id) => [edgeKey(edge[0], edge[1]), id]));
  const selectedUses = new Map<number, number>();

  for (const face of selected) {
    const polygon = topology.polygons[face];
    for (let local = 0; local < polygon.length; local++) {
      const edge = edgeByKey.get(edgeKey(polygon[local], polygon[(local + 1) % polygon.length]));
      if (edge === undefined) throw new Error('Logical face boundary edge is missing.');
      selectedUses.set(edge, (selectedUses.get(edge) ?? 0) + 1);
    }
  }

  return topology.polygonEdges.flatMap((_, edge) => selectedUses.get(edge) === 1 ? [edge] : []);
}

export function logicalMeshBoundaryEdges(topology: MeshTopology) {
  return logicalFaceBoundaryEdges(topology, topology.polygons.map((_, face) => face));
}

export function logicalNonManifoldEdges(topology: MeshTopology) {
  const edgeByKey = new Map(topology.polygonEdges.map((edge, id) => [edgeKey(edge[0], edge[1]), id]));
  const uses = new Map<number, number>();
  topology.polygons.forEach(polygon => {
    for (let local = 0; local < polygon.length; local++) {
      const edge = edgeByKey.get(edgeKey(polygon[local], polygon[(local + 1) % polygon.length]));
      if (edge === undefined) throw new Error('Logical polygon boundary edge is missing.');
      uses.set(edge, (uses.get(edge) ?? 0) + 1);
    }
  });
  return topology.polygonEdges.flatMap((_, edge) => (uses.get(edge) ?? 0) !== 2 ? [edge] : []);
}

export function logicalEdgesByLength(
  topology: MeshTopology,
  positions: ArrayLike<number>,
  referenceEdge: number,
  relativeTolerance: number,
) {
  if (!topology.polygonEdges[referenceEdge]) throw new Error('Select a valid logical reference edge.');
  if (!Number.isFinite(relativeTolerance) || relativeTolerance < 0 || relativeTolerance > 1) {
    throw new Error('Edge length tolerance must be between 0% and 100%.');
  }

  const point = (vertex: number) => {
    const buffer = topology.vertices[vertex]?.[0];
    if (buffer === undefined || !Number.isInteger(buffer)) {
      throw new Error('Logical edge positions are invalid.');
    }
    const offset = buffer * 3;
    const value: [number, number, number] = [
      Number(positions[offset]),
      Number(positions[offset + 1]),
      Number(positions[offset + 2]),
    ];
    if (value.some(component => !Number.isFinite(component))) {
      throw new Error('Logical edge positions are invalid.');
    }
    return value;
  };

  const length = ([a, b]: [number, number]) => {
    const pa = point(a), pb = point(b);
    return Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  };

  const referenceLength = length(topology.polygonEdges[referenceEdge]);
  if (!Number.isFinite(referenceLength)) throw new Error('Logical edge length is invalid.');
  const numericTolerance = Math.max(
    Number.EPSILON * 32 * Math.max(1, referenceLength),
    referenceLength * relativeTolerance,
  );

  return topology.polygonEdges.flatMap((edge, id) =>
    Math.abs(length(edge) - referenceLength) <= numericTolerance ? [id] : []
  );
}

export function logicalSharpEdges(
  topology: MeshTopology,
  positions: ArrayLike<number>,
  minimumAngleRadians: number,
) {
  if (!Number.isFinite(minimumAngleRadians) || minimumAngleRadians < 0 || minimumAngleRadians > Math.PI) {
    throw new Error('Sharp edge angle must be between 0 and 180 degrees.');
  }

  const point = (vertex: number) => {
    const buffer = topology.vertices[vertex]?.[0];
    if (buffer === undefined || !Number.isInteger(buffer)) {
      throw new Error('Logical edge positions are invalid.');
    }
    const offset = buffer * 3;
    const value: [number, number, number] = [
      Number(positions[offset]),
      Number(positions[offset + 1]),
      Number(positions[offset + 2]),
    ];
    if (value.some(component => !Number.isFinite(component))) {
      throw new Error('Logical edge positions are invalid.');
    }
    return value;
  };
  const dot = (a: [number, number, number], b: [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const normalCache = new Map<number, [number, number, number]>();
  const normal = (face: number) => {
    const cached = normalCache.get(face);
    if (cached) return cached;
    const polygon = topology.polygons[face];
    if (!polygon) throw new Error('Logical edge references an invalid polygon.');
    const points = polygon.map(point);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length < 1e-12) {
      throw new Error('Cannot classify a degenerate logical face angle.');
    }
    const value: [number, number, number] = [nx / length, ny / length, nz / length];
    normalCache.set(face, value);
    return value;
  };

  const edgeFaces = new Map<string, number[]>();
  topology.polygons.forEach((polygon, face) => {
    for (let local = 0; local < polygon.length; local++) {
      const key = edgeKey(polygon[local], polygon[(local + 1) % polygon.length]);
      const faces = edgeFaces.get(key) ?? [];
      faces.push(face);
      edgeFaces.set(key, faces);
    }
  });

  const maximumDot = Math.cos(minimumAngleRadians);
  return topology.polygonEdges.flatMap((edge, id) => {
    const faces = edgeFaces.get(edgeKey(edge[0], edge[1])) ?? [];
    if (faces.length !== 2) return [];
    const faceDot = Math.max(-1, Math.min(1, dot(normal(faces[0]), normal(faces[1]))));
    return faceDot <= maximumDot + 1e-12 ? [id] : [];
  });
}

export function logicalFacesBySides(topology: MeshTopology, kind: FaceSideKind) {
  return topology.polygons.flatMap((polygon, face) => {
    const matches =
      kind === 'triangles'
        ? polygon.length === 3
        : kind === 'quads'
          ? polygon.length === 4
          : polygon.length >= 5;
    return matches ? [face] : [];
  });
}

export function logicalCoplanarFaces(
  topology: MeshTopology,
  positions: ArrayLike<number>,
  seeds: number[],
) {
  const uniqueSeeds = [...new Set(seeds)];
  if (!uniqueSeeds.length || uniqueSeeds.some(face => !topology.polygons[face])) {
    throw new Error('Select valid logical seed faces.');
  }

  const point = (vertex: number) => {
    const buffer = topology.vertices[vertex]?.[0];
    if (buffer === undefined || !Number.isInteger(buffer)) {
      throw new Error('Logical face positions are invalid.');
    }
    const offset = buffer * 3;
    const value: [number, number, number] = [
      Number(positions[offset]),
      Number(positions[offset + 1]),
      Number(positions[offset + 2]),
    ];
    if (value.some(component => !Number.isFinite(component))) {
      throw new Error('Logical face positions are invalid.');
    }
    return value;
  };
  const dot = (a: [number, number, number], b: [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const plane = (face: number) => {
    const polygon = topology.polygons[face];
    const points = polygon.map(point);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length < 1e-12) throw new Error('Cannot select a degenerate logical face plane.');
    const normal: [number, number, number] = [nx / length, ny / length, nz / length];
    return { normal, constant: dot(normal, points[0]), points };
  };

  const reference = plane(uniqueSeeds[0]);
  const seedPoints = uniqueSeeds.flatMap(face => topology.polygons[face].map(point));
  const firstSeedPoint = seedPoints[0];
  if (!firstSeedPoint) throw new Error('Select valid logical seed faces.');
  const min = [...firstSeedPoint], max = [...firstSeedPoint];
  for (const p of seedPoints) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], p[axis]);
    max[axis] = Math.max(max[axis], p[axis]);
  }
  const tolerance = Math.max(
    1e-7,
    Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-6,
  );

  const onReferencePlane = (face: number) => {
    const candidate = plane(face);
    if (dot(candidate.normal, reference.normal) < 1 - 1e-6) return false;
    return candidate.points.every(p =>
      Math.abs(dot(reference.normal, p) - reference.constant) <= tolerance
    );
  };

  if (uniqueSeeds.some(face => !onReferencePlane(face))) {
    throw new Error('Selected seed faces must be coplanar and consistently oriented.');
  }

  const edgeFaces = new Map<string, number[]>();
  topology.polygons.forEach((polygon, face) => {
    for (let local = 0; local < polygon.length; local++) {
      const key = edgeKey(polygon[local], polygon[(local + 1) % polygon.length]);
      const faces = edgeFaces.get(key) ?? [];
      faces.push(face);
      edgeFaces.set(key, faces);
    }
  });
  const neighbors = new Map<number, number[]>();
  for (const faces of edgeFaces.values()) {
    if (faces.length < 2) continue;
    for (const face of faces) {
      const list = neighbors.get(face) ?? [];
      for (const other of faces) if (other !== face && !list.includes(other)) list.push(other);
      neighbors.set(face, list);
    }
  }

  const visited = new Set<number>();
  const queue = [uniqueSeeds[0]];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const face = queue[cursor];
    if (visited.has(face)) continue;
    visited.add(face);
    for (const next of neighbors.get(face) ?? []) {
      if (!visited.has(next) && onReferencePlane(next)) queue.push(next);
    }
  }
  if (uniqueSeeds.some(face => !visited.has(face))) {
    throw new Error('Selected seed faces must belong to one edge-connected coplanar region.');
  }
  return topology.polygons.flatMap((_, face) => visited.has(face) ? [face] : []);
}
