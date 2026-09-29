import * as THREE from 'three';
import { buildTopology, type MeshTopology } from './topology';

const logicalVertexIdentity = Symbol('logicalVertexIdentity');
type Corner = Record<string, number[]> & { [logicalVertexIdentity]?: number };
type Polygon = {
  corners: Corner[];
  material: number;
  referenceNormals?: THREE.Vector3[];
  forbiddenDiagonals?: Set<string>;
};
const key = (v: number[]) => v.join(',');
const positionEdgeKey = (a: Corner, b: Corner) => [key(a.position), key(b.position)].sort().join('|');
const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const vector = (c: Corner) => new THREE.Vector3().fromArray(c.position);
const logicalVertexIdsFromGeometry = (source: THREE.BufferGeometry, count: number): number[] | undefined => {
  const value = source.userData.forgeLogicalVertexIds;
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    value.some(id => !Number.isSafeInteger(id) || id < 0)
  ) {
    throw new Error('Invalid Forge logical vertex identity metadata.');
  }
  return value.map(id => Number(id));
};
const cornerIdentityKey = (corner: Corner) =>
  corner[logicalVertexIdentity] === undefined
    ? `p:${key(corner.position)}`
    : `i:${corner[logicalVertexIdentity]}`;
const attachLogicalVertexIds = (geometry: THREE.BufferGeometry, tokens: string[]) => {
  const position = geometry.getAttribute('position');
  if (tokens.length !== position.count) throw new Error('Logical vertex identity output does not match the position buffer.');
  const ids = new Map<string, number>();
  const logicalVertexIds = tokens.map(token => {
    let id = ids.get(token);
    if (id === undefined) {
      id = ids.size;
      ids.set(token, id);
    }
    return id;
  });
  geometry.userData.forgeLogicalVertexIds = logicalVertexIds;
};

export function inspectGeometry(source: THREE.BufferGeometry, logical: boolean | number[][] = false) {
  const p = source.getAttribute('position'), count = source.index?.count ?? p?.count ?? 0;
  if (!p || p.itemSize !== 3 || p.count > 100_000 || !count || count > 600_000 || count % 3) throw new Error('Modeling requires at most 100,000 vertices and 200,000 triangles.');
  if (Object.keys(source.morphAttributes).length || source.drawRange.start || source.drawRange.count !== Infinity) throw new Error('Morph targets and partial draw ranges are not supported.');
  for (const [name, a] of Object.entries(source.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color'].includes(name) || !(a instanceof THREE.BufferAttribute) || a.count !== p.count || a.itemSize < 1 || a.itemSize > 4) throw new Error(`Unsupported attribute: ${name}.`);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) if (!Number.isFinite(a.getComponent(i, j))) throw new Error('Non-finite mesh attribute.');
  }
  const indices = Array.from({ length: count }, (_, i) => source.index?.getX(i) ?? i);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= p.count)) throw new Error('Invalid triangle indices.');
  const materials = new Array<number>(count / 3).fill(0), occupied = new Set<number>();
  for (const g of source.groups) {
    if (![g.start, g.count].every(n => Number.isInteger(n) && n >= 0 && n % 3 === 0) || g.start + g.count > count) throw new Error('Invalid material groups.');
    for (let f = g.start / 3; f < (g.start + g.count) / 3; f++) {
      if (occupied.has(f)) throw new Error('Overlapping material groups.');
      occupied.add(f); materials[f] = g.materialIndex ?? 0;
    }
  }
  const coordinates = Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]).flat();
  const logicalVertexIds = logicalVertexIdsFromGeometry(source, p.count);
  const topology = buildTopology(coordinates, indices, logical, logicalVertexIds);
  const identityForBuffer = (index: number) =>
    logicalVertexIds?.[index] ?? topology.bufferToVertex[index];
  let nextLogicalVertexIdentity = 0;
  for (let index = 0; index < p.count; index++) {
    nextLogicalVertexIdentity = Math.max(nextLogicalVertexIdentity, identityForBuffer(index) + 1);
  }
  const read = (v: number) => new THREE.Vector3().fromBufferAttribute(p, topology.vertices[v][0]);
  const normals = topology.faces.map(face => {
    const [a, b, c] = face.map(read), n = b.sub(a).cross(c.sub(a));
    if (n.lengthSq() < 1e-16 || !Number.isFinite(n.lengthSq())) throw new Error('Degenerate triangle.');
    return n.normalize();
  });
  const uses = new Map<string, { face: number; a: number; b: number }[]>();
  topology.faces.forEach((face, f) => face.forEach((a, j) => {
    const b = face[(j + 1) % 3], k = edgeKey(a, b);
    const list = uses.get(k) ?? []; list.push({ face: f, a, b }); uses.set(k, list);
  }));
  for (const list of uses.values()) if (list.length > 2 || (list.length === 2 && list[0].a !== list[1].b)) throw new Error('Mesh must have consistently oriented manifold edges.');
  const polygons: Polygon[] = topology.faces.map((_, f) => ({ material: materials[f], corners: indices.slice(f * 3, f * 3 + 3).map(i => Object.fromEntries(Object.entries(source.attributes).filter(([name]) => name !== 'normal').map(([name, a]) => [name, Array.from({ length: a.itemSize }, (_, c) => a.getComponent(i, c))]))) }));
  return {
    topology,
    normals,
    uses,
    read,
    polygons,
    indices,
    materials,
    logicalVertexIds,
    identityForBuffer,
    nextLogicalVertexIdentity,
  };
}

function logicalSurface(source: THREE.BufferGeometry, inspection: ReturnType<typeof inspectGeometry>) {
  const { topology, read, indices, materials } = inspection;
  const readCorner = (index: number): Corner => {
    const corner = Object.fromEntries(
      Object.entries(source.attributes)
        .filter(([name]) => name !== 'normal')
        .map(([name, attribute]) => [name, Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component))]),
    ) as Corner;
    corner[logicalVertexIdentity] = inspection.identityForBuffer(index);
    return corner;
  };
  const polygons: Polygon[] = [], normals: THREE.Vector3[] = [];
  const uses = new Map<string, { face: number; a: number; b: number }[]>();

  topology.polygons.forEach((vertices, polygonId) => {
    const triangles = topology.polygonTriangles[polygonId];
    const material = materials[triangles[0]];
    if (triangles.some(face => materials[face] !== material)) throw new Error('Logical polygon crosses a material boundary.');
    const corners = vertices.map(vertex => {
      for (const face of triangles) {
        for (let corner = 0; corner < 3; corner++) if (topology.faces[face][corner] === vertex) return readCorner(indices[face * 3 + corner]);
      }
      throw new Error('Logical polygon corner is missing from its renderer triangles.');
    });
    const referenceNormals = vertices.map(vertex => {
      const normal = new THREE.Vector3();
      for (const triangle of triangles) {
        if (topology.faces[triangle]?.includes(vertex)) normal.add(inspection.normals[triangle]);
      }
      return normal.lengthSq() > 1e-16 ? normal.normalize() : new THREE.Vector3();
    });
    polygons.push({ corners, material, referenceNormals });

    const normal = new THREE.Vector3();
    for (let i = 0; i < vertices.length; i++) {
      const a = read(vertices[i]), b = read(vertices[(i + 1) % vertices.length]);
      normal.x += (a.y - b.y) * (a.z + b.z);
      normal.y += (a.z - b.z) * (a.x + b.x);
      normal.z += (a.x - b.x) * (a.y + b.y);
      const key = edgeKey(vertices[i], vertices[(i + 1) % vertices.length]);
      const list = uses.get(key) ?? [];
      list.push({ face: polygonId, a: vertices[i], b: vertices[(i + 1) % vertices.length] });
      uses.set(key, list);
    }
    if (normal.lengthSq() < 1e-16 || !Number.isFinite(normal.lengthSq())) throw new Error('Degenerate logical polygon.');
    normals.push(normal.normalize());
  });

  for (const list of uses.values()) if (list.length > 2 || (list.length === 2 && list[0].a !== list[1].b)) {
    throw new Error('Logical polygons must have consistently oriented manifold boundaries.');
  }
  return { polygons, normals, uses };
}

function interpolate(a: Corner, b: Corner, t: number): Corner {
  return Object.fromEntries(Object.keys(a).map(name => [name, a[name].map((v, i) => Math.fround(v + (b[name][i] - v) * t))]));
}

function clip(corners: Corner[], normal: THREE.Vector3, constant: number): { corners: Corner[]; cuts: Corner[] } {
  const result: Corner[] = [], cuts: Corner[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const da = vector(a).dot(normal) - constant, db = vector(b).dot(normal) - constant;
    if (da <= 0) result.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      // Canonical endpoint order keeps independently stored seam copies coincident.
      const forward = key(a.position) < key(b.position);
      const c = forward ? interpolate(a, b, da / (da - db)) : interpolate(b, a, db / (db - da));
      result.push(c); cuts.push(c);
    } else if (da === 0) cuts.push(a);
  }
  return { corners: result.filter((c, i) => key(c.position) !== key(result[(i + result.length - 1) % result.length].position)), cuts };
}

function triangulateBoundary(
  corners: Corner[],
  referenceNormals?: THREE.Vector3[],
  forbiddenDiagonals?: Set<string>,
): Corner[][] {
  if (corners.length === 3) return [corners];

  // Project the 3D boundary onto a plane perpendicular to the Newell normal.
  // Unlike dropping one world axis, this also works for folded polygons such
  // as two Cube sides merged by deleting their shared modeling edge.
  const points = corners.map(vector);
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  if (normal.lengthSq() < 1e-16 || !Number.isFinite(normal.lengthSq())) {
    throw new Error('Result polygon collapses at mesh coordinate precision.');
  }
  normal.normalize();

  const absolute = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const helper = absolute[0] <= absolute[1] && absolute[0] <= absolute[2]
    ? new THREE.Vector3(1, 0, 0)
    : absolute[1] <= absolute[2]
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  const axisU = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const axisV = new THREE.Vector3().crossVectors(normal, axisU).normalize();
  const origin = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const projected = points.map(point => {
    const relative = point.clone().sub(origin);
    return [relative.dot(axisU), relative.dot(axisV)] as [number, number];
  });

  const cross = (a: number, b: number, d: number) =>
    (projected[b][0] - projected[a][0]) * (projected[d][1] - projected[a][1]) -
    (projected[b][1] - projected[a][1]) * (projected[d][0] - projected[a][0]);
  const signedArea = projected.reduce((sum, point, i) => {
    const next = projected[(i + 1) % projected.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-16) {
    throw new Error('Result polygon collapses at mesh coordinate precision.');
  }
  const winding = Math.sign(signedArea);
  const minX = Math.min(...projected.map(point => point[0])), maxX = Math.max(...projected.map(point => point[0]));
  const minY = Math.min(...projected.map(point => point[1])), maxY = Math.max(...projected.map(point => point[1]));
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const epsilon = extent * extent * 1e-12;

  // Modeling boundaries may intentionally contain collinear logical vertices,
  // for example when a pending Knife segment gets a new bend inserted directly
  // on that segment. Renderer tessellation must preserve those vertices without
  // emitting a zero-area triangle. Temporarily bridge over one truly collinear
  // boundary vertex, tessellate the reduced polygon, then split the renderer
  // triangle that owns the temporary boundary edge so the logical vertex is
  // represented by non-degenerate triangles on both sides of that edge.
  if (corners.length > 3) {
    for (let current = 0; current < corners.length; current++) {
      const previous = (current + corners.length - 1) % corners.length;
      const next = (current + 1) % corners.length;
      const span = points[next].clone().sub(points[previous]);
      const spanLengthSq = span.lengthSq();
      if (spanLengthSq <= 1e-16) continue;

      const offset = points[current].clone().sub(points[previous]);
      const t = offset.dot(span) / spanLengthSq;
      if (!Number.isFinite(t) || t <= 1e-8 || t >= 1 - 1e-8) continue;

      const closest = points[previous].clone().addScaledVector(span, t);
      if (closest.distanceToSquared(points[current]) > Math.max(spanLengthSq, 1) * 1e-12) continue;

      const previousCorner = corners[previous];
      const currentCorner = corners[current];
      const nextCorner = corners[next];
      const temporaryEdge = positionEdgeKey(previousCorner, nextCorner);
      const reducedCorners = corners.filter((_, index) => index !== current);
      const reducedNormals = referenceNormals?.length === corners.length
        ? referenceNormals.filter((_, index) => index !== current)
        : referenceNormals;
      let reducedForbidden = forbiddenDiagonals;
      if (forbiddenDiagonals?.has(temporaryEdge)) {
        reducedForbidden = new Set(forbiddenDiagonals);
        reducedForbidden.delete(temporaryEdge);
      }

      const triangles = triangulateBoundary(reducedCorners, reducedNormals, reducedForbidden);
      const owner = triangles.findIndex(triangle =>
        triangle.includes(previousCorner) && triangle.includes(nextCorner)
      );
      if (owner < 0) throw new Error('Result polygon cannot preserve its collinear boundary vertex.');

      const triangle = triangles[owner];
      const previousIndex = triangle.indexOf(previousCorner);
      const nextIndex = triangle.indexOf(nextCorner);
      const third = triangle.find(corner => corner !== previousCorner && corner !== nextCorner);
      if (!third) throw new Error('Result polygon cannot preserve its collinear boundary vertex.');

      let replacement: Corner[][];
      if ((previousIndex + 1) % 3 === nextIndex) {
        replacement = [
          [previousCorner, currentCorner, third],
          [currentCorner, nextCorner, third],
        ];
      } else if ((nextIndex + 1) % 3 === previousIndex) {
        replacement = [
          [nextCorner, currentCorner, third],
          [currentCorner, previousCorner, third],
        ];
      } else {
        throw new Error('Result polygon cannot preserve its collinear boundary vertex.');
      }

      if (forbiddenDiagonals && replacement.some(renderTriangle =>
        renderTriangle.some((corner, index) =>
          forbiddenDiagonals.has(positionEdgeKey(corner, renderTriangle[(index + 1) % renderTriangle.length]))
        )
      )) {
        throw new Error('Result polygon cannot be retessellated without recreating a deleted edge.');
      }

      triangles.splice(owner, 1, ...replacement);
      return triangles;
    }
  }

  const remaining = corners.map((_, index) => index);
  const triangles: Corner[][] = [];
  while (remaining.length > 3) {
    const ears: { position: number; previous: number; current: number; next: number; score: number }[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const previous = remaining[(i + remaining.length - 1) % remaining.length];
      const current = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (winding * cross(previous, current, next) <= epsilon) continue;

      let containsVertex = false;
      for (const candidate of remaining) {
        if (candidate === previous || candidate === current || candidate === next) continue;
        const a = winding * cross(previous, current, candidate);
        const b = winding * cross(current, next, candidate);
        const d = winding * cross(next, previous, candidate);
        if (a >= -epsilon && b >= -epsilon && d >= -epsilon) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;
      if (forbiddenDiagonals && [
        positionEdgeKey(corners[previous], corners[current]),
        positionEdgeKey(corners[current], corners[next]),
        positionEdgeKey(corners[next], corners[previous]),
      ].some(edge => forbiddenDiagonals.has(edge))) continue;

      let score = 0;
      if (referenceNormals?.length === corners.length) {
        const triangleNormal = points[current].clone().sub(points[previous])
          .cross(points[next].clone().sub(points[previous]));
        const area = triangleNormal.length();
        if (area <= 1e-12) continue;
        triangleNormal.normalize();
        const expected = referenceNormals[previous].clone()
          .add(referenceNormals[current])
          .add(referenceNormals[next]);
        if (expected.lengthSq() > 1e-16) score += triangleNormal.dot(expected.normalize()) * 1000;
        const perimeter =
          points[previous].distanceTo(points[current]) +
          points[current].distanceTo(points[next]) +
          points[next].distanceTo(points[previous]);
        score += area / Math.max(perimeter * perimeter, 1e-12);
      }
      if (forbiddenDiagonals) {
        const currentPosition = key(corners[current].position);
        if ([...forbiddenDiagonals].some(edge => edge.startsWith(`${currentPosition}|`) || edge.endsWith(`|${currentPosition}`))) {
          score += 10_000;
        }
      }
      ears.push({ position: i, previous, current, next, score });
      if (!referenceNormals) break;
    }
    if (!ears.length) throw new Error('Result polygon cannot be tessellated without changing its boundary.');
    const ear = referenceNormals
      ? ears.reduce((best, candidate) => candidate.score > best.score ? candidate : best)
      : ears[0];
    triangles.push([corners[ear.previous], corners[ear.current], corners[ear.next]]);
    remaining.splice(ear.position, 1);
  }

  const [a, b, d] = remaining;
  if (winding * cross(a, b, d) <= epsilon) throw new Error('Result polygon collapses at mesh coordinate precision.');
  if (forbiddenDiagonals && [
    positionEdgeKey(corners[a], corners[b]),
    positionEdgeKey(corners[b], corners[d]),
    positionEdgeKey(corners[d], corners[a]),
  ].some(edge => forbiddenDiagonals.has(edge))) {
    throw new Error('Result polygon cannot be retessellated without recreating a deleted edge.');
  }
  triangles.push([corners[a], corners[b], corners[d]]);
  return triangles;
}

function finishDetailed(polygons: Polygon[]) {
  const values: Record<string, number[]> = {}, sizes: Record<string, number> = {}, groups: { start: number; count: number; material: number }[] = [];
  const polygonTriangles: number[][] = [];
  const logicalVertexTokens: string[] = [];
  let count = 0;
  for (const { corners, material, referenceNormals, forbiddenDiagonals } of polygons) {
    if (corners.length < 3) continue;
    // Rendering tessellation is not modeling topology. Triangulate only with
    // existing polygon corners: never create centroid/interior vertices.
    const triangles = triangulateBoundary(corners, referenceNormals, forbiddenDiagonals);
    const triangleIds: number[] = [];
    for (const triangle of triangles) {
      const [a, b, c] = triangle.map(vector);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) throw new Error('Result collapses at mesh coordinate precision.');
      if (count + 3 > 600_000) throw new Error('Result exceeds 600,000 rendering vertices.');
      triangleIds.push(count / 3);
      const last = groups.at(-1);
      if (last?.material === material) last.count += 3; else groups.push({ start: count, count: 3, material });
      for (const corner of triangle) {
        logicalVertexTokens.push(cornerIdentityKey(corner));
        for (const [name, data] of Object.entries(corner)) {
          sizes[name] = data.length; (values[name] ??= []).push(...data);
        }
      }
      count += 3;
    }
    polygonTriangles.push(triangleIds);
  }
  if (!count) throw new Error('Operation would remove the mesh.');
  const geometry = new THREE.BufferGeometry();
  for (const [name, data] of Object.entries(values)) {
    if (data.some(v => !Number.isFinite(Math.fround(v)))) throw new Error('Result exceeds coordinate precision.');
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, sizes[name]));
  }
  groups.forEach(g => geometry.addGroup(g.start, g.count, g.material));
  attachLogicalVertexIds(geometry, logicalVertexTokens);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, polygonTriangles };
}

function finish(polygons: Polygon[]): THREE.BufferGeometry {
  return finishDetailed(polygons).geometry;
}

function translatedCorner(corner: Corner, offset: THREE.Vector3, identity?: number): Corner {
  const translated = Object.fromEntries(Object.entries(corner).map(([name, data]) => [
    name,
    name === 'position'
      ? [
          Math.fround(data[0] + offset.x),
          Math.fround(data[1] + offset.y),
          Math.fround(data[2] + offset.z),
        ]
      : [...data],
  ])) as Corner;
  if (identity !== undefined) translated[logicalVertexIdentity] = identity;
  return translated;
}

export function extrudeLogicalFace(
  source: THREE.BufferGeometry,
  face: number,
  distance: number,
  polygonTriangles?: number[][],
) {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) {
    throw new Error('Distance must be between 0.0001 and 1000 local units.');
  }
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const { polygons, normals } = logicalSurface(source, inspection);
  if (!Number.isInteger(face) || face < 0 || face >= polygons.length || !topology.polygons[face]) {
    throw new Error('Select one valid logical face for extrusion.');
  }

  const polygon = polygons[face];
  const normal = normals[face];
  const offset = normal.clone().multiplyScalar(distance);
  let nextLogicalVertexIdentity = inspection.nextLogicalVertexIdentity;
  const moved = polygon.corners.map(corner =>
    translatedCorner(corner, offset, nextLogicalVertexIdentity++)
  );
  for (let i = 0; i < polygon.corners.length; i++) {
    const before = vector(polygon.corners[i]);
    const after = vector(moved[i]);
    if (![after.x, after.y, after.z].every(Number.isFinite) || after.distanceToSquared(before) === 0) {
      throw new Error('Extrusion distance collapses at mesh coordinate precision.');
    }
  }

  const output = polygons.map((item, id) =>
    id === face ? { material: item.material, corners: moved } : item,
  );
  for (let edge = 0; edge < polygon.corners.length; edge++) {
    const next = (edge + 1) % polygon.corners.length;
    output.push({
      material: polygon.material,
      corners: [
        polygon.corners[edge],
        polygon.corners[next],
        moved[next],
        moved[edge],
      ],
    });
  }

  const result = finishDetailed(output);
  return { ...result, selectedFace: face };
}

export function extrudeLogicalFaceRegion(
  source: THREE.BufferGeometry,
  requestedFaces: number[],
  distance: number,
  polygonTriangles?: number[][],
) {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) {
    throw new Error('Distance must be between 0.0001 and 1000 local units.');
  }

  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology, read } = inspection;
  const surface = logicalSurface(source, inspection);
  const faces = [...new Set(requestedFaces)].sort((a, b) => a - b);
  if (
    !faces.length ||
    faces.some(face => !Number.isInteger(face) || !topology.polygons[face])
  ) {
    throw new Error('Select one or more valid logical faces for region extrusion.');
  }

  const selected = new Set(faces);
  const neighbors = new Map(faces.map(face => [face, [] as number[]]));
  for (const uses of surface.uses.values()) {
    const inside = uses.filter(use => selected.has(use.face));
    if (inside.length > 2) {
      throw new Error('Extrude Region requires manifold logical polygon boundaries.');
    }
    if (inside.length === 2) {
      neighbors.get(inside[0].face)!.push(inside[1].face);
      neighbors.get(inside[1].face)!.push(inside[0].face);
    }
  }

  const components: number[][] = [];
  const remainingFaces = new Set(faces);
  while (remainingFaces.size) {
    const seed = remainingFaces.values().next().value as number;
    const component: number[] = [];
    const pending = [seed];
    while (pending.length) {
      const face = pending.pop()!;
      if (!remainingFaces.delete(face)) continue;
      component.push(face);
      for (const next of neighbors.get(face) ?? []) if (remainingFaces.has(next)) pending.push(next);
    }
    component.sort((a, b) => a - b);
    components.push(component);
  }

  type BoundaryUse = { face: number; a: number; b: number };
  type RegionResult = {
    faces: number[];
    boundary: BoundaryUse[];
    boundaryLoops: number;
    direction: THREE.Vector3;
    offset: THREE.Vector3;
    movedIdentities: Map<number, number>;
  };

  let nextLogicalVertexIdentity = inspection.nextLogicalVertexIdentity;
  const regions: RegionResult[] = components.map(componentFaces => {
    const component = new Set(componentFaces);
    const boundary: BoundaryUse[] = [];

    for (const uses of surface.uses.values()) {
      const inside = uses.filter(use => component.has(use.face));
      if (!inside.length) continue;
      if (inside.length > 2) {
        throw new Error('Extrude Region requires manifold logical polygon boundaries.');
      }
      if (inside.length === 1) boundary.push(inside[0]);
    }

    if (!boundary.length) {
      throw new Error('Extrude Region requires every selected region to have a boundary.');
    }

    const outgoing = new Map<number, BoundaryUse>();
    const incoming = new Map<number, BoundaryUse>();
    for (const use of boundary) {
      if (outgoing.has(use.a) || incoming.has(use.b)) {
        throw new Error('Extrude Region boundary must consist of simple closed loops.');
      }
      outgoing.set(use.a, use);
      incoming.set(use.b, use);
    }
    const boundaryVertices = new Set([...outgoing.keys(), ...incoming.keys()]);
    if ([...boundaryVertices].some(vertex => !outgoing.has(vertex) || !incoming.has(vertex))) {
      throw new Error('Extrude Region boundary must consist of simple closed loops.');
    }

    const unvisited = new Set(boundary.map(use => edgeKey(use.a, use.b)));
    let boundaryLoops = 0;
    while (unvisited.size) {
      const firstKey = unvisited.values().next().value as string;
      const first = boundary.find(use => edgeKey(use.a, use.b) === firstKey);
      if (!first) throw new Error('Extrude Region boundary traversal failed.');
      let current = first;
      let count = 0;
      for (; count <= boundary.length; count++) {
        const id = edgeKey(current.a, current.b);
        if (!unvisited.has(id)) {
          if (current.a === first.a) break;
          throw new Error('Extrude Region boundary traversal crossed itself.');
        }
        unvisited.delete(id);
        if (current.b === first.a) break;
        const next = outgoing.get(current.b);
        if (!next) throw new Error('Extrude Region boundary is open.');
        current = next;
      }
      if (count < 2 || current.b !== first.a) {
        throw new Error('Extrude Region boundary must consist of closed loops.');
      }
      boundaryLoops++;
    }

    const direction = new THREE.Vector3();
    for (const face of componentFaces) {
      const points = surface.polygons[face].corners.map(vector);
      const weightedNormal = new THREE.Vector3();
      for (let index = 0; index < points.length; index++) {
        const a = points[index], b = points[(index + 1) % points.length];
        weightedNormal.x += (a.y - b.y) * (a.z + b.z);
        weightedNormal.y += (a.z - b.z) * (a.x + b.x);
        weightedNormal.z += (a.x - b.x) * (a.y + b.y);
      }
      direction.add(weightedNormal);
    }
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 1e-16) {
      throw new Error('Extrude Region cannot derive one outward direction from a selected region.');
    }
    direction.normalize();
    if (componentFaces.some(face => surface.normals[face].dot(direction) <= 1e-6)) {
      throw new Error('Extrude Region faces within one connected region do not share one outward extrusion hemisphere.');
    }

    const offset = direction.clone().multiplyScalar(distance);
    if (![offset.x, offset.y, offset.z].every(Number.isFinite) || offset.lengthSq() < 1e-16) {
      throw new Error('Extrude Region collapses at mesh coordinate precision.');
    }

    for (const use of boundary) {
      const edge = read(use.b).sub(read(use.a));
      if (!Number.isFinite(edge.lengthSq()) || edge.lengthSq() < 1e-16) {
        throw new Error('Extrude Region has a collapsed boundary edge.');
      }
      if (edge.cross(offset).lengthSq() < 1e-16) {
        throw new Error('Extrude Region direction collapses a boundary wall.');
      }
    }

    const movedIdentities = new Map<number, number>();
    for (const face of componentFaces) {
      for (const vertex of topology.polygons[face]) {
        if (!movedIdentities.has(vertex)) movedIdentities.set(vertex, nextLogicalVertexIdentity++);
      }
    }

    return { faces: componentFaces, boundary, boundaryLoops, direction, offset, movedIdentities };
  });

  const regionByFace = new Map<number, RegionResult>();
  for (const region of regions) {
    for (const face of region.faces) regionByFace.set(face, region);
  }

  const entries: EditedPolygon[] = topology.polygons.map((_, face) => {
    const polygon = surface.polygons[face];
    const region = regionByFace.get(face);
    if (!region) return { polygon, sourceFace: face };
    const vertices = topology.polygons[face];
    return {
      polygon: {
        material: polygon.material,
        corners: polygon.corners.map((corner, index) =>
          translatedCorner(corner, region.offset, region.movedIdentities.get(vertices[index]))
        ),
        referenceNormals: polygon.referenceNormals?.map(normal => normal.clone()),
      },
    };
  });

  for (const region of regions) {
    for (const use of region.boundary) {
      const vertices = topology.polygons[use.face];
      const local = vertices.findIndex((vertex, index) =>
        vertex === use.a && vertices[(index + 1) % vertices.length] === use.b
      );
      if (local < 0) throw new Error('Extrude Region could not resolve a boundary edge.');
      const polygon = surface.polygons[use.face];
      const next = (local + 1) % vertices.length;
      const a = polygon.corners[local];
      const b = polygon.corners[next];
      entries.push({
        polygon: {
          material: polygon.material,
          corners: [
            a,
            b,
            translatedCorner(b, region.offset, region.movedIdentities.get(use.b)),
            translatedCorner(a, region.offset, region.movedIdentities.get(use.a)),
          ],
        },
      });
    }
  }

  const result = finishEditedSurface(source, inspection, entries);
  return {
    ...result,
    selectedFaces: faces,
    regionCount: regions.length,
    boundaryEdges: regions.reduce((sum, region) => sum + region.boundary.length, 0),
    boundaryLoops: regions.reduce((sum, region) => sum + region.boundaryLoops, 0),
    regions: regions.map(region => ({
      faces: [...region.faces],
      boundaryEdges: region.boundary.length,
      boundaryLoops: region.boundaryLoops,
      direction: [region.direction.x, region.direction.y, region.direction.z] as [number, number, number],
    })),
  };
}

function cornerAtPoint(
  source: THREE.BufferGeometry,
  inspection: ReturnType<typeof inspectGeometry>,
  polygonId: number,
  point: THREE.Vector3,
): Corner {
  const { topology, indices } = inspection;
  const epsilon = 1e-6;
  for (const face of topology.polygonTriangles[polygonId] ?? []) {
    const raw = indices.slice(face * 3, face * 3 + 3);
    const positions = raw.map(index => new THREE.Vector3().fromBufferAttribute(source.getAttribute('position'), index));
    const v0 = positions[1].clone().sub(positions[0]);
    const v1 = positions[2].clone().sub(positions[0]);
    const v2 = point.clone().sub(positions[0]);
    const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1);
    const d20 = v2.dot(v0), d21 = v2.dot(v1);
    const denominator = d00 * d11 - d01 * d01;
    if (Math.abs(denominator) < 1e-16) continue;
    const v = (d11 * d20 - d01 * d21) / denominator;
    const w = (d00 * d21 - d01 * d20) / denominator;
    const u = 1 - v - w;
    if (u < -epsilon || v < -epsilon || w < -epsilon) continue;

    const corner: Corner = {};
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (name === 'normal') continue;
      corner[name] = Array.from({ length: attribute.itemSize }, (_, component) =>
        Math.fround(
          attribute.getComponent(raw[0], component) * u +
          attribute.getComponent(raw[1], component) * v +
          attribute.getComponent(raw[2], component) * w
        )
      );
    }
    corner.position = [Math.fround(point.x), Math.fround(point.y), Math.fround(point.z)];
    return corner;
  }
  throw new Error('Inset point cannot be interpolated from the selected polygon.');
}

export function insetLogicalFace(
  source: THREE.BufferGeometry,
  face: number,
  distance: number,
  polygonTriangles?: number[][],
) {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) {
    throw new Error('Inset distance must be between 0.0001 and 1000 local units.');
  }
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const { polygons, normals } = logicalSurface(source, inspection);
  if (!Number.isInteger(face) || face < 0 || face >= polygons.length || !topology.polygons[face]) {
    throw new Error('Select one valid logical face for inset.');
  }

  const polygon = polygons[face];
  const points = polygon.corners.map(vector);
  if (points.length < 3) throw new Error('Inset requires a polygon face.');
  const normal = normals[face];
  const origin = points[0];
  const u = points[1].clone().sub(origin).normalize();
  const v = normal.clone().cross(u).normalize();
  const projected = points.map(point => {
    const relative = point.clone().sub(origin);
    return [relative.dot(u), relative.dot(v)] as [number, number];
  });
  const cross2 = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area2 = projected.reduce((sum, point, i) => {
    const next = projected[(i + 1) % projected.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(area2) < 1e-12) throw new Error('Inset polygon is degenerate.');
  const winding = Math.sign(area2);
  for (let i = 0; i < projected.length; i++) {
    if (winding * cross2(projected[i], projected[(i + 1) % projected.length], projected[(i + 2) % projected.length]) < -1e-10) {
      throw new Error('Inset currently requires a convex polygon.');
    }
  }

  const lines = projected.map((a, i) => {
    const b = projected[(i + 1) % projected.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) throw new Error('Inset polygon has a collapsed boundary edge.');
    const direction: [number, number] = [dx / length, dy / length];
    const inward: [number, number] = winding > 0 ? [-direction[1], direction[0]] : [direction[1], -direction[0]];
    return { normal: inward, direction, constant: inward[0] * a[0] + inward[1] * a[1] + distance };
  });

  const inner2 = projected.map((point, i) => {
    const previous = lines[(i + lines.length - 1) % lines.length];
    const current = lines[i];
    const determinant = previous.normal[0] * current.normal[1] - previous.normal[1] * current.normal[0];
    if (Math.abs(determinant) < 1e-10) {
      const directionDot =
        previous.direction[0] * current.direction[0] +
        previous.direction[1] * current.direction[1];
      const normalDot =
        previous.normal[0] * current.normal[0] +
        previous.normal[1] * current.normal[1];
      if (directionDot < 1 - 1e-8 || normalDot < 1 - 1e-8) {
        throw new Error('Inset polygon contains a zero-width turn.');
      }
      return [
        point[0] + current.normal[0] * distance,
        point[1] + current.normal[1] * distance,
      ] as [number, number];
    }
    const x = (previous.constant * current.normal[1] - previous.normal[1] * current.constant) / determinant;
    const y = (previous.normal[0] * current.constant - previous.constant * current.normal[0]) / determinant;
    return [x, y] as [number, number];
  });

  const innerArea2 = inner2.reduce((sum, point, i) => {
    const next = inner2[(i + 1) % inner2.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const tolerance = Math.max(1e-8, Math.abs(area2) * 1e-8);
  if (Math.sign(innerArea2) !== winding || Math.abs(innerArea2) <= tolerance) {
    throw new Error('Inset distance exceeds the polygon inradius.');
  }
  for (const point of inner2) {
    if (lines.some(line => line.normal[0] * point[0] + line.normal[1] * point[1] < line.constant - 1e-7)) {
      throw new Error('Inset distance exceeds the polygon inradius.');
    }
  }

  const innerPoints = inner2.map(([x, y]) => origin.clone().addScaledVector(u, x).addScaledVector(v, y));
  const inner = innerPoints.map(point => cornerAtPoint(source, inspection, face, point));
  const output = polygons.map((item, id) => id === face ? { material: item.material, corners: inner } : item);
  for (let edge = 0; edge < polygon.corners.length; edge++) {
    const next = (edge + 1) % polygon.corners.length;
    output.push({
      material: polygon.material,
      corners: [polygon.corners[edge], polygon.corners[next], inner[next], inner[edge]],
    });
  }
  return finishDetailed(output);
}

export function insetLogicalFaceRegion(
  source: THREE.BufferGeometry,
  requestedFaces: number[],
  distance: number,
  polygonTriangles?: number[][],
) {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) {
    throw new Error('Inset distance must be between 0.0001 and 1000 local units.');
  }

  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology, read } = inspection;
  const surface = logicalSurface(source, inspection);
  const faces = [...new Set(requestedFaces)].sort((a, b) => a - b);
  if (
    faces.length < 2 ||
    faces.some(face => !Number.isInteger(face) || !topology.polygons[face])
  ) {
    throw new Error('Inset Region requires at least two valid logical faces.');
  }

  const selected = new Set(faces);
  const selectedVertices = [...new Set(faces.flatMap(face => topology.polygons[face]))];
  const bounds = new THREE.Box3();
  selectedVertices.forEach(vertex => bounds.expandByPoint(read(vertex)));
  const tolerance = Math.max(1e-7, bounds.getSize(new THREE.Vector3()).length() * 1e-6);
  const referenceNormal = surface.normals[faces[0]].clone();
  const origin = read(topology.polygons[faces[0]][0]);
  const planarRegion = faces.every(face =>
    surface.normals[face].dot(referenceNormal) >= 1 - 1e-6 &&
    topology.polygons[face].every(vertex =>
      Math.abs(read(vertex).clone().sub(origin).dot(referenceNormal)) <= tolerance
    )
  );

  type RegionUse = { face: number; local: number; a: number; b: number };
  const edgeUses = new Map<string, RegionUse[]>();
  topology.polygons.forEach((polygon, face) => {
    for (let local = 0; local < polygon.length; local++) {
      const a = polygon[local];
      const b = polygon[(local + 1) % polygon.length];
      const list = edgeUses.get(edgeKey(a, b)) ?? [];
      list.push({ face, local, a, b });
      edgeUses.set(edgeKey(a, b), list);
    }
  });

  const neighbors = new Map(faces.map(face => [face, [] as number[]]));
  const boundary: RegionUse[] = [];
  for (const uses of edgeUses.values()) {
    const inside = uses.filter(use => selected.has(use.face));
    if (!inside.length) continue;
    if (inside.length === 2) {
      neighbors.get(inside[0].face)!.push(inside[1].face);
      neighbors.get(inside[1].face)!.push(inside[0].face);
    } else if (inside.length === 1) {
      boundary.push(inside[0]);
    } else {
      throw new Error('Inset Region requires manifold logical polygon boundaries.');
    }
  }

  const reached = new Set<number>();
  const pending = [faces[0]];
  while (pending.length) {
    const face = pending.pop()!;
    if (reached.has(face)) continue;
    reached.add(face);
    for (const next of neighbors.get(face) ?? []) if (!reached.has(next)) pending.push(next);
  }
  if (reached.size !== faces.length) {
    throw new Error('Inset Region requires one edge-connected logical face region.');
  }
  if (!boundary.length) throw new Error('Inset Region requires a region boundary.');

  const outgoing = new Map<number, RegionUse>();
  const incoming = new Map<number, RegionUse>();
  for (const use of boundary) {
    if (outgoing.has(use.a) || incoming.has(use.b)) {
      throw new Error('Inset Region boundary must consist of simple closed loops.');
    }
    outgoing.set(use.a, use);
    incoming.set(use.b, use);
  }
  const boundaryVertices = new Set([...outgoing.keys(), ...incoming.keys()]);
  if ([...boundaryVertices].some(vertex => !outgoing.has(vertex) || !incoming.has(vertex))) {
    throw new Error('Inset Region boundary must consist of simple closed loops.');
  }

  const unvisited = new Set(boundary.map(use => `${use.face}:${use.local}`));
  const loops: RegionUse[][] = [];
  while (unvisited.size) {
    const firstId = unvisited.values().next().value as string;
    const first = boundary.find(use => `${use.face}:${use.local}` === firstId);
    if (!first) throw new Error('Inset Region boundary traversal failed.');
    const loop: RegionUse[] = [];
    let current = first;
    for (let steps = 0; steps <= boundary.length; steps++) {
      const id = `${current.face}:${current.local}`;
      if (!unvisited.has(id)) {
        if (current.a === first.a) break;
        throw new Error('Inset Region boundary traversal crossed itself.');
      }
      loop.push(current);
      unvisited.delete(id);
      if (current.b === first.a) break;
      const next = outgoing.get(current.b);
      if (!next) throw new Error('Inset Region boundary is open.');
      current = next;
    }
    if (loop.length < 3 || loop.at(-1)!.b !== first.a) {
      throw new Error('Inset Region boundary must consist of closed loops.');
    }
    loops.push(loop);
  }

  const innerPosition = new Map<number, THREE.Vector3>();

  if (planarRegion) {
    const firstBoundary = boundary[0];
    const axisU = read(firstBoundary.b).sub(read(firstBoundary.a));
    if (axisU.lengthSq() < 1e-16) throw new Error('Inset Region has a collapsed boundary edge.');
    axisU.normalize();
    const axisV = referenceNormal.clone().cross(axisU).normalize();
    const project = (point: THREE.Vector3) => {
      const relative = point.clone().sub(origin);
      return [relative.dot(axisU), relative.dot(axisV)] as [number, number];
    };
    const lift = ([x, y]: [number, number]) =>
      origin.clone().addScaledVector(axisU, x).addScaledVector(axisV, y);

    const projected = new Map<number, [number, number]>();
    for (const vertex of selectedVertices) projected.set(vertex, project(read(vertex)));

    const inner2 = new Map<number, [number, number]>();
    const signedArea2 = (points: [number, number][]) => points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);

    for (const loop of loops) {
      const original = loop.map(use => projected.get(use.a)!);
      const originalArea = signedArea2(original);
      if (!Number.isFinite(originalArea) || Math.abs(originalArea) < tolerance * tolerance) {
        throw new Error('Inset Region boundary loop is degenerate.');
      }

      for (let index = 0; index < loop.length; index++) {
        const previousUse = loop[(index + loop.length - 1) % loop.length];
        const currentUse = loop[index];
        const previousA = projected.get(previousUse.a)!;
        const previousB = projected.get(previousUse.b)!;
        const currentA = projected.get(currentUse.a)!;
        const currentB = projected.get(currentUse.b)!;

        const previousDx = previousB[0] - previousA[0];
        const previousDy = previousB[1] - previousA[1];
        const currentDx = currentB[0] - currentA[0];
        const currentDy = currentB[1] - currentA[1];
        const previousLength = Math.hypot(previousDx, previousDy);
        const currentLength = Math.hypot(currentDx, currentDy);
        if (previousLength < tolerance || currentLength < tolerance) {
          throw new Error('Inset Region has a collapsed boundary edge.');
        }

        const previousNormal: [number, number] = [-previousDy / previousLength, previousDx / previousLength];
        const currentNormal: [number, number] = [-currentDy / currentLength, currentDx / currentLength];
        const previousConstant =
          previousNormal[0] * previousB[0] +
          previousNormal[1] * previousB[1] +
          distance;
        const currentConstant =
          currentNormal[0] * currentA[0] +
          currentNormal[1] * currentA[1] +
          distance;
        const determinant =
          previousNormal[0] * currentNormal[1] -
          previousNormal[1] * currentNormal[0];

        let point: [number, number];
        if (Math.abs(determinant) < 1e-10) {
          const directionDot =
            (previousDx / previousLength) * (currentDx / currentLength) +
            (previousDy / previousLength) * (currentDy / currentLength);
          const normalDot =
            previousNormal[0] * currentNormal[0] +
            previousNormal[1] * currentNormal[1];
          if (directionDot < 1 - 1e-8 || normalDot < 1 - 1e-8) {
            throw new Error('Inset Region boundary contains a zero-width turn.');
          }
          point = [
            currentA[0] + currentNormal[0] * distance,
            currentA[1] + currentNormal[1] * distance,
          ];
        } else {
          point = [
            (previousConstant * currentNormal[1] - previousNormal[1] * currentConstant) / determinant,
            (previousNormal[0] * currentConstant - previousConstant * currentNormal[0]) / determinant,
          ];
        }
        if (!point.every(Number.isFinite)) throw new Error('Inset Region exceeds mesh coordinate precision.');
        inner2.set(currentUse.a, point);
      }

      const insetPoints = loop.map(use => inner2.get(use.a)!);
      const insetArea = signedArea2(insetPoints);
      if (
        !Number.isFinite(insetArea) ||
        Math.sign(insetArea) !== Math.sign(originalArea) ||
        Math.abs(insetArea) <= tolerance * tolerance
      ) {
        throw new Error('Inset distance collapses a region boundary loop.');
      }
    }

    const segmentIntersection = (
      a: [number, number],
      b: [number, number],
      c: [number, number],
      d: [number, number],
    ) => {
      const cross = (p: [number, number], q: [number, number], r: [number, number]) =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const epsilon = Math.max(1e-10, tolerance * 1e-3);
      const abC = cross(a, b, c), abD = cross(a, b, d);
      const cdA = cross(c, d, a), cdB = cross(c, d, b);
      const on = (p: [number, number], q: [number, number], r: [number, number]) =>
        Math.abs(cross(p, q, r)) <= epsilon &&
        r[0] >= Math.min(p[0], q[0]) - epsilon &&
        r[0] <= Math.max(p[0], q[0]) + epsilon &&
        r[1] >= Math.min(p[1], q[1]) - epsilon &&
        r[1] <= Math.max(p[1], q[1]) + epsilon;
      if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
          ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
      return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
    };

    const innerSegments = loops.flatMap((loop, loopIndex) =>
      loop.map((use, edgeIndex) => ({
        loopIndex,
        edgeIndex,
        count: loop.length,
        a: inner2.get(use.a)!,
        b: inner2.get(use.b)!,
      }))
    );
    for (let i = 0; i < innerSegments.length; i++) {
      for (let j = i + 1; j < innerSegments.length; j++) {
        const a = innerSegments[i], b = innerSegments[j];
        const adjacent =
          a.loopIndex === b.loopIndex &&
          (a.edgeIndex === b.edgeIndex ||
            (a.edgeIndex + 1) % a.count === b.edgeIndex ||
            (b.edgeIndex + 1) % b.count === a.edgeIndex);
        if (adjacent) continue;
        if (segmentIntersection(a.a, a.b, b.a, b.b)) {
          throw new Error('Inset distance causes region boundary loops to intersect.');
        }
      }
    }

    for (const [vertex, point] of inner2) {
      const lifted = lift(point);
      lifted.set(Math.fround(lifted.x), Math.fround(lifted.y), Math.fround(lifted.z));
      if (![lifted.x, lifted.y, lifted.z].every(Number.isFinite)) {
        throw new Error('Inset Region exceeds mesh coordinate precision.');
      }
      innerPosition.set(vertex, lifted);
    }
  } else {
    const inwardFor = (use: RegionUse) => {
      const edge = read(use.b).sub(read(use.a));
      const length = edge.length();
      if (!Number.isFinite(length) || length < tolerance) {
        throw new Error('Inset Region has a collapsed boundary edge.');
      }
      const inward = surface.normals[use.face].clone().cross(edge.multiplyScalar(1 / length));
      if (!Number.isFinite(inward.lengthSq()) || inward.lengthSq() < 1e-16) {
        throw new Error('Inset Region boundary direction is invalid.');
      }
      return inward.normalize();
    };

    for (const loop of loops) {
      for (let index = 0; index < loop.length; index++) {
        const previousUse = loop[(index + loop.length - 1) % loop.length];
        const currentUse = loop[index];
        const previousInward = inwardFor(previousUse);
        const currentInward = inwardFor(currentUse);
        const alignment = THREE.MathUtils.clamp(previousInward.dot(currentInward), -1, 1);
        if (alignment <= -1 + 1e-8) {
          throw new Error('Inset Region boundary contains a zero-width turn.');
        }

        const denominator = 1 + alignment;
        const delta = previousInward.add(currentInward).multiplyScalar(distance / denominator);
        const point = read(currentUse.a).add(delta);
        point.set(Math.fround(point.x), Math.fround(point.y), Math.fround(point.z));
        if (
          ![point.x, point.y, point.z].every(Number.isFinite) ||
          point.distanceToSquared(read(currentUse.a)) < Math.max(1e-16, tolerance * tolerance * 1e-6)
        ) {
          throw new Error('Inset Region collapses at mesh coordinate precision.');
        }
        innerPosition.set(currentUse.a, point);
      }
    }
  }

  const movedCorner = (corner: Corner, point: THREE.Vector3): Corner => ({
    ...Object.fromEntries(Object.entries(corner).map(([name, data]) => [name, [...data]])),
    position: [point.x, point.y, point.z],
  });

  const innerPolygons = new Map<number, Polygon>();
  for (const face of faces) {
    const sourcePolygon = surface.polygons[face];
    const vertices = topology.polygons[face];
    const corners = vertices.map((vertex, index) => {
      const point = innerPosition.get(vertex);
      if (!point) return sourcePolygon.corners[index];
      try {
        return cornerAtPoint(source, inspection, face, point);
      } catch {
        return movedCorner(sourcePolygon.corners[index], point);
      }
    });
    innerPolygons.set(face, {
      material: sourcePolygon.material,
      corners,
      referenceNormals: sourcePolygon.referenceNormals?.map(normal => normal.clone()),
    });
  }

  const entries: EditedPolygon[] = topology.polygons.map((_, face) =>
    selected.has(face)
      ? { polygon: innerPolygons.get(face)! }
      : { polygon: surface.polygons[face], sourceFace: face }
  );
  for (const use of boundary) {
    const outer = surface.polygons[use.face];
    const inner = innerPolygons.get(use.face)!;
    const next = (use.local + 1) % outer.corners.length;
    entries.push({
      polygon: {
        material: outer.material,
        corners: [
          outer.corners[use.local],
          outer.corners[next],
          inner.corners[next],
          inner.corners[use.local],
        ],
      },
    });
  }

  const result = finishEditedSurface(source, inspection, entries);
  return {
    ...result,
    selectedFaces: faces,
    boundaryLoops: loops.length,
    boundaryEdges: boundary.length,
  };
}

export function cutLogicalFace(
  source: THREE.BufferGeometry,
  face: number,
  vertices: [number, number],
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const { polygons } = logicalSurface(source, inspection);
  if (!Number.isInteger(face) || face < 0 || face >= topology.polygons.length || !polygons[face]) {
    throw new Error('Select one valid logical face to cut.');
  }
  if (
    !Array.isArray(vertices) ||
    vertices.length !== 2 ||
    vertices[0] === vertices[1] ||
    vertices.some(vertex => !Number.isInteger(vertex))
  ) throw new Error('Cut Face requires exactly two distinct logical vertices.');

  const boundary = topology.polygons[face];
  const start = boundary.indexOf(vertices[0]);
  const end = boundary.indexOf(vertices[1]);
  if (start < 0 || end < 0) throw new Error('Both cut vertices must lie on the same logical face boundary.');

  const size = boundary.length;
  const forward = (end - start + size) % size;
  if (forward === 1 || forward === size - 1) {
    throw new Error('The selected vertices already share a logical boundary edge.');
  }

  const walk = (from: number, to: number) => {
    const indices: number[] = [];
    for (let index = from; ; index = (index + 1) % size) {
      indices.push(index);
      if (index === to) break;
      if (indices.length > size) throw new Error('Cut Face boundary traversal failed.');
    }
    return indices;
  };

  const sourcePolygon = polygons[face];
  const makePolygon = (indices: number[]): Polygon => {
    if (indices.length < 3) throw new Error('Cut Face would create an invalid polygon.');
    return {
      material: sourcePolygon.material,
      corners: indices.map(index => sourcePolygon.corners[index]),
      referenceNormals: sourcePolygon.referenceNormals
        ? indices.map(index => sourcePolygon.referenceNormals![index])
        : undefined,
    };
  };

  const first = makePolygon(walk(start, end));
  const second = makePolygon(walk(end, start));
  const entries: EditedPolygon[] = [];
  for (let polygon = 0; polygon < topology.polygons.length; polygon++) {
    if (polygon === face) {
      entries.push({ polygon: first }, { polygon: second });
    } else {
      entries.push({ polygon: polygons[polygon], sourceFace: polygon });
    }
  }

  return finishEditedSurface(source, inspection, entries);
}

type KnifePoint3 = [number, number, number];
type KnifePoint2 = { x: number; y: number };

function knifeFaceValidationContext(
  source: THREE.BufferGeometry,
  topology: MeshTopology,
  face: number,
) {
  if (!Number.isInteger(face) || !topology.polygons[face]) {
    throw new Error('Select one valid logical face for the Knife path.');
  }

  const position = source.getAttribute('position');
  const boundary = topology.polygons[face];
  const boundaryPoints = boundary.map(vertex =>
    new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0])
  );
  const triangleIds = topology.polygonTriangles[face];

  const triangleNormal = (triangle: number) => {
    const logical = topology.faces[triangle];
    if (!logical || logical.length !== 3) return null;
    const points = logical.map(vertex =>
      new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0])
    );
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.lengthSq() < 1e-16) return null;
    return normal.normalize();
  };
  const reference = triangleNormal(triangleIds[0]);
  if (!reference || triangleIds.some(triangle => {
    const normal = triangleNormal(triangle);
    return !normal || normal.dot(reference) < 0.999999;
  })) {
    throw new Error('Interior Knife path currently requires one planar logical face.');
  }

  const absNormal = [Math.abs(reference.x), Math.abs(reference.y), Math.abs(reference.z)];
  const dropAxis = absNormal.indexOf(Math.max(...absNormal));
  const project2 = (point: THREE.Vector3): KnifePoint2 =>
    dropAxis === 0 ? { x: point.y, y: point.z }
      : dropAxis === 1 ? { x: point.x, y: point.z }
        : { x: point.x, y: point.y };

  return {
    position,
    boundary,
    boundaryPoints,
    projectedBoundary: boundaryPoints.map(project2),
    triangleIds,
    project2,
  };
}

function knifeBoundaryEdgesForPoint(
  boundaryPoints: THREE.Vector3[],
  point: THREE.Vector3,
) {
  const result = new Set<number>();
  for (let edge = 0; edge < boundaryPoints.length; edge++) {
    const nearest = new THREE.Line3(
      boundaryPoints[edge],
      boundaryPoints[(edge + 1) % boundaryPoints.length],
    ).closestPointToPoint(point, true, new THREE.Vector3());
    if (nearest.distanceToSquared(point) < 1e-12) result.add(edge);
  }
  return result;
}

function knifePointStrictlyInsideFace(
  source: THREE.BufferGeometry,
  topology: MeshTopology,
  triangleIds: number[],
  boundaryPoints: THREE.Vector3[],
  point: THREE.Vector3,
) {
  if (knifeBoundaryEdgesForPoint(boundaryPoints, point).size) return false;
  const position = source.getAttribute('position');
  for (const triangle of triangleIds) {
    const logical = topology.faces[triangle];
    if (!logical || logical.length !== 3) continue;
    const points = logical.map(vertex =>
      new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0])
    );
    const closest = new THREE.Triangle(points[0], points[1], points[2])
      .closestPointToPoint(point, new THREE.Vector3());
    if (closest.distanceToSquared(point) <= 1e-10) return true;
  }
  return false;
}

function validateKnifeSegmentAgainstBoundary(
  projectedBoundary: KnifePoint2[],
  start: KnifePoint2,
  end: KnifePoint2,
  allowedStartEdges: Set<number>,
  allowedEndEdges: Set<number>,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const EPSILON = 1e-9;
  if (lengthSq < EPSILON * EPSILON) {
    throw new Error('Knife path contains duplicate consecutive points.');
  }

  const dotAlong = (point: KnifePoint2) =>
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;

  for (let edge = 0; edge < projectedBoundary.length; edge++) {
    const a = projectedBoundary[edge];
    const b = projectedBoundary[(edge + 1) % projectedBoundary.length];
    const sx = b.x - a.x, sy = b.y - a.y;
    const denominator = dx * sy - dy * sx;
    const ax = a.x - start.x, ay = a.y - start.y;

    if (Math.abs(denominator) < EPSILON) {
      if (Math.abs(ax * dy - ay * dx) >= EPSILON) continue;
      const ta = dotAlong(a), tb = dotAlong(b);
      const overlapStart = Math.max(0, Math.min(ta, tb));
      const overlapEnd = Math.min(1, Math.max(ta, tb));
      if (overlapEnd - overlapStart > EPSILON) {
        throw new Error('Interior Knife path would overlap the logical face boundary.');
      }
      continue;
    }

    const t = (ax * sy - ay * sx) / denominator;
    const u = (ax * dy - ay * dx) / denominator;
    if (u < -EPSILON || u > 1 + EPSILON || t < -EPSILON || t > 1 + EPSILON) continue;

    if (t > EPSILON && t < 1 - EPSILON) {
      throw new Error('Interior Knife path would leave the logical face boundary.');
    }
    if (Math.abs(t) <= EPSILON && !allowedStartEdges.has(edge)) {
      throw new Error('Interior Knife path touches a non-incident logical boundary.');
    }
    if (Math.abs(t - 1) <= EPSILON && !allowedEndEdges.has(edge)) {
      throw new Error('Interior Knife path touches a non-incident logical boundary.');
    }
  }
}

function knifeSegmentsIntersect(
  a: KnifePoint2,
  b: KnifePoint2,
  c: KnifePoint2,
  d: KnifePoint2,
) {
  const EPSILON = 1e-9;
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  const cx = c.x - a.x, cy = c.y - a.y;

  if (Math.abs(denominator) < EPSILON) {
    if (Math.abs(cx * ry - cy * rx) >= EPSILON) return false;
    const lengthSq = rx * rx + ry * ry;
    if (lengthSq < EPSILON * EPSILON) return true;
    const tc = (cx * rx + cy * ry) / lengthSq;
    const td = ((d.x - a.x) * rx + (d.y - a.y) * ry) / lengthSq;
    return Math.min(1, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)) >= -EPSILON;
  }

  const t = (cx * sy - cy * sx) / denominator;
  const u = (cx * ry - cy * rx) / denominator;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON;
}

export function validateLogicalFaceInteriorKnifePath(
  source: THREE.BufferGeometry,
  topology: MeshTopology,
  face: number,
  startBoundary: KnifePoint3,
  interiors: KnifePoint3[],
  endBoundary?: KnifePoint3,
) {
  if (
    startBoundary.some(value => !Number.isFinite(value)) ||
    interiors.some(point => point.some(value => !Number.isFinite(value))) ||
    endBoundary?.some(value => !Number.isFinite(value))
  ) throw new Error('Knife path points must contain finite local coordinates.');
  if (!interiors.length) throw new Error('Knife path requires at least one interior bend point.');

  const context = knifeFaceValidationContext(source, topology, face);
  const start = new THREE.Vector3(...startBoundary);
  const startEdges = knifeBoundaryEdgesForPoint(context.boundaryPoints, start);
  if (!startEdges.size) throw new Error('Knife path start must lie on the logical face boundary.');

  const interiorVectors = interiors.map(point => new THREE.Vector3(...point));
  for (const point of interiorVectors) {
    if (!knifePointStrictlyInsideFace(source, topology, context.triangleIds, context.boundaryPoints, point)) {
      throw new Error('Knife bend points must lie strictly inside the selected logical face.');
    }
  }

  const end = endBoundary ? new THREE.Vector3(...endBoundary) : null;
  const endEdges = end ? knifeBoundaryEdgesForPoint(context.boundaryPoints, end) : new Set<number>();
  if (end && !endEdges.size) throw new Error('Knife path end must lie on the logical face boundary.');

  const points = [start, ...interiorVectors, ...(end ? [end] : [])];
  const projected = points.map(context.project2);
  for (let index = 0; index + 1 < projected.length; index++) {
    validateKnifeSegmentAgainstBoundary(
      context.projectedBoundary,
      projected[index],
      projected[index + 1],
      index === 0 ? startEdges : new Set<number>(),
      end && index === projected.length - 2 ? endEdges : new Set<number>(),
    );
  }

  for (let first = 0; first + 1 < projected.length; first++) {
    for (let second = first + 1; second + 1 < projected.length; second++) {
      if (second === first + 1) {
        const a = projected[first], b = projected[first + 1], c = projected[second + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const bcx = c.x - b.x, bcy = c.y - b.y;
        const cross = abx * bcy - aby * bcx;
        const dot = abx * bcx + aby * bcy;
        if (Math.abs(cross) < 1e-9 && dot <= 0) {
          throw new Error('Knife path cannot reverse or overlap at an interior bend.');
        }
        continue;
      }
      if (knifeSegmentsIntersect(
        projected[first],
        projected[first + 1],
        projected[second],
        projected[second + 1],
      )) {
        throw new Error('Knife path cannot self-intersect.');
      }
    }
  }
}

export function validateLogicalFaceInteriorKnifeLeg(
  source: THREE.BufferGeometry,
  topology: MeshTopology,
  face: number,
  boundaryPoint: KnifePoint3,
  interior: KnifePoint3,
) {
  validateLogicalFaceInteriorKnifePath(source, topology, face, boundaryPoint, [interior]);
}

export function cutLogicalFaceViaInteriorPath(
  source: THREE.BufferGeometry,
  face: number,
  vertices: [number, number],
  interiors: KnifePoint3[],
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology, indices } = inspection;
  const surface = logicalSurface(source, inspection);
  const sourcePolygon = surface.polygons[face];
  if (!Number.isInteger(face) || !topology.polygons[face] || !sourcePolygon) {
    throw new Error('Select one valid logical face to cut.');
  }
  if (
    !Array.isArray(vertices) ||
    vertices.length !== 2 ||
    vertices[0] === vertices[1] ||
    vertices.some(vertex => !Number.isInteger(vertex))
  ) throw new Error('Interior Knife path requires two distinct logical boundary vertices.');
  if (
    !Array.isArray(interiors) ||
    !interiors.length ||
    interiors.some(point => point.length !== 3 || point.some(value => !Number.isFinite(value)))
  ) throw new Error('Interior Knife path requires one or more finite interior points.');

  const boundary = topology.polygons[face];
  const start = boundary.indexOf(vertices[0]);
  const end = boundary.indexOf(vertices[1]);
  if (start < 0 || end < 0) throw new Error('Interior Knife endpoints must lie on the selected logical face boundary.');

  const triangleIds = topology.polygonTriangles[face];
  const position = source.getAttribute('position');
  const boundaryPoints = boundary.map(vertex =>
    new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0])
  );
  validateLogicalFaceInteriorKnifePath(
    source,
    topology,
    face,
    boundaryPoints[start].toArray() as KnifePoint3,
    interiors,
    boundaryPoints[end].toArray() as KnifePoint3,
  );

  const readCorner = (raw: number): Corner => Object.fromEntries(
    Object.entries(source.attributes)
      .filter(([name]) => name !== 'normal')
      .map(([name, attribute]) => [
        name,
        Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(raw, component)),
      ]),
  );

  const interpolateInterior = (expected: THREE.Vector3) => {
    for (const triangle of triangleIds) {
      const raw = indices.slice(triangle * 3, triangle * 3 + 3);
      const points = raw.map(index => new THREE.Vector3().fromBufferAttribute(position, index));
      const closest = new THREE.Triangle(points[0], points[1], points[2])
        .closestPointToPoint(expected, new THREE.Vector3());
      if (closest.distanceToSquared(expected) > 1e-10) continue;
      const barycentric = THREE.Triangle.getBarycoord(
        expected,
        points[0],
        points[1],
        points[2],
        new THREE.Vector3(),
      );
      if (!barycentric || Math.min(barycentric.x, barycentric.y, barycentric.z) < -1e-7) continue;

      const rawCorners = raw.map(readCorner);
      const weights = [barycentric.x, barycentric.y, barycentric.z];
      const corner = Object.fromEntries(
        Object.keys(rawCorners[0]).map(name => [
          name,
          rawCorners[0][name].map((_, component) => Math.fround(
            rawCorners.reduce((sum, sourceCorner, cornerIndex) =>
              sum + sourceCorner[name][component] * weights[cornerIndex], 0),
          )),
        ]),
      ) as Corner;
      return { corner, normal: inspection.normals[triangle].clone() };
    }
    throw new Error('Knife bend point must lie inside the selected logical face.');
  };

  const interiorData = interiors.map(point => interpolateInterior(new THREE.Vector3(...point)));

  const size = boundary.length;
  const walk = (from: number, to: number) => {
    const result: number[] = [];
    for (let index = from; ; index = (index + 1) % size) {
      result.push(index);
      if (index === to) break;
      if (result.length > size) throw new Error('Interior Knife boundary traversal failed.');
    }
    return result;
  };

  const makePolygon = (
    indices: number[],
    cut: { corner: Corner; normal: THREE.Vector3 }[],
  ): Polygon => ({
    material: sourcePolygon.material,
    corners: [
      ...indices.map(index => sourcePolygon.corners[index]),
      ...cut.map(entry => entry.corner),
    ],
    referenceNormals: sourcePolygon.referenceNormals
      ? [
          ...indices.map(index => sourcePolygon.referenceNormals![index]),
          ...cut.map(entry => entry.normal.clone()),
        ]
      : undefined,
  });

  // The first polygon walks the source boundary start -> end, then returns
  // along the Knife path end -> ... -> start. The second walks the opposite
  // source boundary and follows the Knife path start -> ... -> end.
  const first = makePolygon(walk(start, end), [...interiorData].reverse());
  const second = makePolygon(walk(end, start), interiorData);
  if (first.corners.length < 3 || second.corners.length < 3) {
    throw new Error('Interior Knife path would create an invalid polygon.');
  }

  const entries: EditedPolygon[] = [];
  for (let polygon = 0; polygon < topology.polygons.length; polygon++) {
    if (polygon === face) entries.push({ polygon: first }, { polygon: second });
    else entries.push({ polygon: surface.polygons[polygon], sourceFace: polygon });
  }
  return finishEditedSurface(source, inspection, entries);
}

export function cutLogicalFaceViaInteriorPoint(
  source: THREE.BufferGeometry,
  face: number,
  vertices: [number, number],
  interior: KnifePoint3,
  polygonTriangles?: number[][],
) {
  return cutLogicalFaceViaInteriorPath(source, face, vertices, [interior], polygonTriangles);
}

export function subdivideLogicalEdges(
  source: THREE.BufferGeometry,
  edges: number[],
  polygonTriangles?: number[][],
  cuts = 1,
) {
  if (!Number.isInteger(cuts) || cuts < 1 || cuts > 32) {
    throw new Error('Subdivision cuts must be an integer between 1 and 32.');
  }

  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology, read } = inspection;
  const { polygons } = logicalSurface(source, inspection);
  if (!Array.isArray(edges) || !edges.length) throw new Error('Select one or more logical edges.');
  if (edges.some(edge => !Number.isInteger(edge) || edge < 0 || !topology.polygonEdges[edge])) {
    throw new Error('Select valid logical edges.');
  }

  const selected = new Set(edges);
  const edgeByKey = new Map(topology.polygonEdges.map((edge, id) => [edgeKey(edge[0], edge[1]), id]));
  const occupied = new Set(topology.vertices.map(copies => {
    const point = new THREE.Vector3().fromBufferAttribute(source.getAttribute('position'), copies[0]);
    return key(point.toArray());
  }));
  const pointsByEdge = new Map<number, number[][]>();

  for (const edge of selected) {
    const [a, b] = topology.polygonEdges[edge];
    const firstPosition = read(a).toArray();
    const secondPosition = read(b).toArray();
    const forward = key(firstPosition) < key(secondPosition);
    const first = forward ? firstPosition : secondPosition;
    const second = forward ? secondPosition : firstPosition;
    const points: number[][] = [];

    for (let cut = 1; cut <= cuts; cut++) {
      const factor = cut / (cuts + 1);
      const point = first.map((value, component) =>
        Math.fround(value + (second[component] - value) * factor)
      );
      if (
        point.some(value => !Number.isFinite(value)) ||
        point.every((value, component) => value === first[component]) ||
        point.every((value, component) => value === second[component])
      ) {
        throw new Error('Subdivision collapses at mesh coordinate precision.');
      }
      const pointKey = key(point);
      if (occupied.has(pointKey)) {
        throw new Error('Subdivision point already contains a mesh vertex or another cut point.');
      }
      occupied.add(pointKey);
      points.push(point);
    }
    pointsByEdge.set(edge, points);
  }

  const output = polygons.map((polygon, polygonId) => {
    const vertices = topology.polygons[polygonId];
    const corners: Corner[] = [];
    const referenceNormals: THREE.Vector3[] | undefined = polygon.referenceNormals ? [] : undefined;

    for (let local = 0; local < vertices.length; local++) {
      const next = (local + 1) % vertices.length;
      const a = polygon.corners[local];
      const b = polygon.corners[next];
      corners.push(a);
      referenceNormals?.push(polygon.referenceNormals![local].clone());

      const edge = edgeByKey.get(edgeKey(vertices[local], vertices[next]));
      if (edge === undefined || !selected.has(edge)) continue;

      const canonicalPoints = pointsByEdge.get(edge)!;
      const forward = key(a.position) < key(b.position);
      for (let cut = 1; cut <= cuts; cut++) {
        const localFactor = cut / (cuts + 1);
        const canonicalIndex = forward ? cut - 1 : cuts - cut;
        const inserted = interpolate(a, b, localFactor);
        inserted.position = [...canonicalPoints[canonicalIndex]];
        corners.push(inserted);

        if (referenceNormals) {
          const normal = polygon.referenceNormals![local].clone().multiplyScalar(1 - localFactor)
            .addScaledVector(polygon.referenceNormals![next], localFactor);
          if (normal.lengthSq() > 1e-16) normal.normalize();
          else normal.copy(polygon.referenceNormals![local]);
          referenceNormals.push(normal);
        }
      }
    }

    return { material: polygon.material, corners, referenceNormals };
  });

  return finishDetailed(output);
}

export function loopCutLogicalEdge(
  source: THREE.BufferGeometry,
  edge: number,
  polygonTriangles?: number[][],
  factor = 0.5,
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const { polygons } = logicalSurface(source, inspection);
  if (!Number.isInteger(edge) || edge < 0 || !topology.polygonEdges[edge]) {
    throw new Error('Select one valid logical quad boundary edge.');
  }
  if (!Number.isFinite(factor) || factor < 0.01 || factor > 0.99) {
    throw new Error('Loop Cut position must be between 0.01 and 0.99.');
  }

  const uses = new Map<string, { face: number; local: number }[]>();
  topology.polygons.forEach((vertices, face) => {
    vertices.forEach((a, local) => {
      const b = vertices[(local + 1) % vertices.length];
      const key = edgeKey(a, b);
      const list = uses.get(key) ?? [];
      list.push({ face, local });
      uses.set(key, list);
    });
  });

  // polygonEdges are stored in canonical min->max vertex order. Carry the
  // cut factor in that canonical orientation while traversing the quad ring.
  // Each face converts it back to its own directed boundary orientation. The
  // opposite boundary edge runs in the reverse direction around the quad, so
  // that edge uses 1 - localFactor before the canonical factor is propagated
  // into the neighboring face. This matters away from 0.5 because a midpoint
  // hides both reversals.
  const start = edgeKey(...topology.polygonEdges[edge]);
  const queue: { key: string; factor: number }[] = [{ key: start, factor }];
  const visitedEdges = new Map<string, number>();
  const splitFaces = new Map<number, { local: number; factor: number }>();

  while (queue.length) {
    const current = queue.pop()!;
    const visitedFactor = visitedEdges.get(current.key);
    if (visitedFactor !== undefined) {
      if (Math.abs(visitedFactor - current.factor) > 1e-9) {
        throw new Error('Loop Cut ring has inconsistent edge orientation.');
      }
      continue;
    }
    visitedEdges.set(current.key, current.factor);

    const edgeUses = uses.get(current.key) ?? [];
    if (!edgeUses.length) throw new Error('Loop Cut cannot find the selected logical edge.');
    for (const use of edgeUses) {
      const vertices = topology.polygons[use.face];
      if (vertices.length !== 4) throw new Error('Loop Cut stops at triangles or n-gons; the selected ring must pass through quads.');

      const localA = vertices[use.local];
      const localB = vertices[(use.local + 1) % 4];
      const localFactor = localA < localB ? current.factor : 1 - current.factor;
      const existing = splitFaces.get(use.face);
      if (existing !== undefined) {
        if (existing.local % 2 !== use.local % 2) throw new Error('Loop Cut ring intersects itself.');
        const expectedFactor = existing.local === use.local ? existing.factor : 1 - existing.factor;
        if (Math.abs(expectedFactor - localFactor) > 1e-9) {
          throw new Error('Loop Cut ring has inconsistent edge orientation.');
        }
        continue;
      }

      splitFaces.set(use.face, { local: use.local, factor: localFactor });
      const opposite = (use.local + 2) % 4;
      const oppositeA = vertices[opposite];
      const oppositeB = vertices[(opposite + 1) % 4];
      const oppositeLocalFactor = 1 - localFactor;
      const oppositeFactor = oppositeA < oppositeB ? oppositeLocalFactor : 1 - oppositeLocalFactor;
      queue.push({ key: edgeKey(oppositeA, oppositeB), factor: oppositeFactor });
    }
  }
  if (!splitFaces.size) throw new Error('No logical quad ring found.');

  const extras: Polygon[] = [];
  const output = polygons.map((polygon, face) => {
    const split = splitFaces.get(face);
    if (!split) return polygon;
    const { local, factor: localFactor } = split;
    const corners = polygon.corners;
    const a = corners[local];
    const b = corners[(local + 1) % 4];
    const c = corners[(local + 2) % 4];
    const d = corners[(local + 3) % 4];
    const entry = interpolate(a, b, localFactor);
    const opposite = interpolate(c, d, 1 - localFactor);
    extras.push({ material: polygon.material, corners: [entry, b, c, opposite] });
    return { material: polygon.material, corners: [a, entry, opposite, d] };
  });
  return finishDetailed([...output, ...extras]);
}

type EditedPolygon = { polygon: Polygon; sourceFace?: number };

function finishEditedSurface(
  source: THREE.BufferGeometry,
  inspection: ReturnType<typeof inspectGeometry>,
  entries: EditedPolygon[],
) {
  const { topology, indices, materials } = inspection;
  const values: Record<string, number[]> = {};
  const sizes: Record<string, number> = {};
  const groups: { start: number; count: number; material: number }[] = [];
  const polygonTriangles: number[][] = [];
  const logicalVertexTokens: string[] = [];
  let count = 0;

  const rawCorner = (index: number): Corner => {
    const corner = Object.fromEntries(
      Object.entries(source.attributes)
        .filter(([name]) => name !== 'normal')
        .map(([name, attribute]) => [
          name,
          Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component)),
        ]),
    ) as Corner;
    corner[logicalVertexIdentity] = inspection.identityForBuffer(index);
    return corner;
  };
  const appendTriangle = (triangle: Corner[], material: number, ids: number[]) => {
    const [a, b, d] = triangle.map(vector);
    if (b.sub(a).cross(d.sub(a)).lengthSq() < 1e-16) throw new Error('Result collapses at mesh coordinate precision.');
    if (count + 3 > 600_000) throw new Error('Result exceeds 600,000 rendering vertices.');
    ids.push(count / 3);
    const last = groups.at(-1);
    if (last?.material === material) last.count += 3;
    else groups.push({ start: count, count: 3, material });
    for (const corner of triangle) {
      logicalVertexTokens.push(cornerIdentityKey(corner));
      for (const [name, data] of Object.entries(corner)) {
        sizes[name] = data.length;
        (values[name] ??= []).push(...data);
      }
    }
    count += 3;
  };

  for (const entry of entries) {
    const triangleIds: number[] = [];
    if (entry.sourceFace !== undefined) {
      for (const triangle of topology.polygonTriangles[entry.sourceFace]) {
        const raw = indices.slice(triangle * 3, triangle * 3 + 3);
        appendTriangle(raw.map(rawCorner), materials[triangle], triangleIds);
      }
    } else {
      const triangles = triangulateBoundary(
        entry.polygon.corners,
        entry.polygon.referenceNormals,
        entry.polygon.forbiddenDiagonals,
      );
      for (const triangle of triangles) appendTriangle(triangle, entry.polygon.material, triangleIds);
    }
    polygonTriangles.push(triangleIds);
  }

  if (!count) throw new Error('Operation would remove the mesh.');
  const geometry = new THREE.BufferGeometry();
  for (const [name, data] of Object.entries(values)) {
    if (data.some(value => !Number.isFinite(Math.fround(value)))) throw new Error('Result exceeds coordinate precision.');
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, sizes[name]));
  }
  groups.forEach(group => geometry.addGroup(group.start, group.count, group.material));
  attachLogicalVertexIds(geometry, logicalVertexTokens);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  inspectGeometry(geometry, polygonTriangles);
  return { geometry, polygonTriangles };
}

function polygonFromTriangleGroup(
  source: THREE.BufferGeometry,
  inspection: ReturnType<typeof inspectGeometry>,
  polygonId: number,
): Polygon {
  const { topology, indices, materials, normals } = inspection;
  const triangles = topology.polygonTriangles[polygonId];
  const vertices = topology.polygons[polygonId];
  const rawCorner = (index: number): Corner => Object.fromEntries(
    Object.entries(source.attributes)
      .filter(([name]) => name !== 'normal')
      .map(([name, attribute]) => [
        name,
        Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component)),
      ]),
  );
  const corners = vertices.map(vertex => {
    for (const triangle of triangles) {
      for (let corner = 0; corner < 3; corner++) {
        if (topology.faces[triangle][corner] === vertex) return rawCorner(indices[triangle * 3 + corner]);
      }
    }
    throw new Error('Logical polygon corner is missing from its renderer triangles.');
  });
  const referenceNormals = vertices.map(vertex => {
    const normal = new THREE.Vector3();
    for (const triangle of triangles) {
      if (topology.faces[triangle]?.includes(vertex)) normal.add(normals[triangle]);
    }
    return normal.lengthSq() > 1e-16 ? normal.normalize() : new THREE.Vector3();
  });
  return {
    corners,
    referenceNormals,
    material: materials[triangles[0]] ?? 0,
  };
}

function mergedPolygonGroups(
  topology: ReturnType<typeof buildTopology>,
  selectedEdges: number[],
) {
  const parent = topology.polygons.map((_, face) => face);
  const find = (face: number): number => parent[face] === face ? face : (parent[face] = find(parent[face]));
  const join = (a: number, b: number) => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (const edge of selectedEdges) {
    if (!Number.isInteger(edge) || !topology.polygonEdges[edge]) throw new Error('Invalid logical edge selection.');
    const [a, b] = topology.polygonEdges[edge];
    const key = edgeKey(a, b);
    const faces = topology.polygons.flatMap((polygon, face) =>
      polygon.some((vertex, index) => edgeKey(vertex, polygon[(index + 1) % polygon.length]) === key) ? [face] : []
    );
    if (faces.length !== 2) throw new Error('Delete Edge requires a manifold edge shared by exactly two faces.');
    join(faces[0], faces[1]);
  }

  const regions = new Map<number, number[]>();
  for (let face = 0; face < topology.polygons.length; face++) {
    const root = find(face);
    const region = regions.get(root) ?? [];
    region.push(face);
    regions.set(root, region);
  }
  return [...regions.values()].sort((a, b) => Math.min(...a) - Math.min(...b));
}

export function mergeLogicalVerticesAtCenter(
  source: THREE.BufferGeometry,
  vertices: [number, number],
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const surface = logicalSurface(source, inspection);
  if (
    !Array.isArray(vertices) ||
    vertices.length !== 2 ||
    vertices[0] === vertices[1] ||
    vertices.some(vertex => !Number.isInteger(vertex) || !topology.logicalVertices.includes(vertex))
  ) {
    throw new Error('Merge at Center requires exactly two distinct logical vertices.');
  }

  const [first, second] = vertices;
  const sharedEdge = topology.polygonEdges.some(([a, b]) =>
    (a === first && b === second) || (a === second && b === first)
  );
  if (!sharedEdge) throw new Error('Merge at Center currently requires two vertices that share a logical edge.');

  const position = source.getAttribute('position');
  const point = (vertex: number) =>
    new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0]);
  const midpointVector = point(first).add(point(second)).multiplyScalar(0.5);
  const midpoint = [
    Math.fround(midpointVector.x),
    Math.fround(midpointVector.y),
    Math.fround(midpointVector.z),
  ];
  if (midpoint.some(value => !Number.isFinite(value))) {
    throw new Error('Merged vertex exceeds mesh coordinate precision.');
  }
  const midpointOccupied = topology.logicalVertices.some(vertex => {
    if (vertex === first || vertex === second) return false;
    const existing = point(vertex);
    return (
      Math.fround(existing.x) === midpoint[0] &&
      Math.fround(existing.y) === midpoint[1] &&
      Math.fround(existing.z) === midpoint[2]
    );
  });
  if (midpointOccupied) {
    throw new Error('Merge at Center midpoint already contains another logical vertex.');
  }

  const selected = new Set(vertices);
  const entries: EditedPolygon[] = [];
  const mergedNormal = (a: THREE.Vector3, b: THREE.Vector3) => {
    const normal = a.clone().add(b);
    if (normal.lengthSq() < 1e-16) return a.clone();
    return normal.normalize();
  };
  const movedCorner = (corner: Corner): Corner => Object.fromEntries(
    Object.entries(corner).map(([name, data]) => [
      name,
      name === 'position' ? [...midpoint] : [...data],
    ]),
  );

  for (let face = 0; face < topology.polygons.length; face++) {
    const boundary = topology.polygons[face];
    const selectedIndices = boundary.flatMap((vertex, index) => selected.has(vertex) ? [index] : []);
    if (!selectedIndices.length) {
      entries.push({ polygon: surface.polygons[face], sourceFace: face });
      continue;
    }

    const polygon = surface.polygons[face];
    const corners = polygon.corners.map(corner => corner);
    const referenceNormals = polygon.referenceNormals?.map(normal => normal.clone());

    if (selectedIndices.length === 2) {
      const [firstIndex, secondIndex] = selectedIndices;
      const adjacentForward = (firstIndex + 1) % boundary.length === secondIndex;
      const adjacentBackward = (secondIndex + 1) % boundary.length === firstIndex;
      if (!adjacentForward && !adjacentBackward) {
        throw new Error('Merge at Center would collapse non-adjacent corners of one logical polygon.');
      }

      const keep = adjacentForward ? firstIndex : secondIndex;
      const remove = adjacentForward ? secondIndex : firstIndex;
      const merged = interpolate(polygon.corners[keep], polygon.corners[remove], 0.5);
      merged.position = [...midpoint];

      const nextCorners = corners.flatMap((corner, index) =>
        index === remove ? [] : [index === keep ? merged : corner]
      );
      if (nextCorners.length < 3) continue;

      const nextNormals = referenceNormals
        ? referenceNormals.flatMap((normal, index) =>
            index === remove
              ? []
              : [index === keep ? mergedNormal(referenceNormals[keep], referenceNormals[remove]) : normal]
          )
        : undefined;
      entries.push({
        polygon: {
          material: polygon.material,
          corners: nextCorners,
          referenceNormals: nextNormals,
        },
      });
      continue;
    }

    const index = selectedIndices[0];
    corners[index] = movedCorner(corners[index]);
    entries.push({
      polygon: {
        material: polygon.material,
        corners,
        referenceNormals,
      },
    });
  }

  if (!entries.length) throw new Error('Merge at Center would remove the entire mesh.');
  return { ...finishEditedSurface(source, inspection, entries), mergedPosition: midpoint as [number, number, number] };
}

export function fillLogicalBoundaryFace(
  source: THREE.BufferGeometry,
  edges: number[],
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const surface = logicalSurface(source, inspection);
  const selectedEdges = [...new Set(edges)];
  if (
    selectedEdges.length < 3 ||
    selectedEdges.length > 4096 ||
    selectedEdges.some(edge => !Number.isInteger(edge) || !topology.polygonEdges[edge])
  ) {
    throw new Error('Fill Boundary requires one selected logical boundary loop with at least three edges.');
  }

  type DirectedBoundaryEdge = {
    edge: number;
    face: number;
    from: number;
    to: number;
    fromCorner: Corner;
    material: number;
  };

  const records: DirectedBoundaryEdge[] = selectedEdges.map(edge => {
    const [a, b] = topology.polygonEdges[edge];
    const uses = surface.uses.get(edgeKey(a, b)) ?? [];
    if (uses.length !== 1) {
      throw new Error('Fill Boundary requires open logical mesh boundary edges.');
    }
    const use = uses[0];
    const polygon = topology.polygons[use.face];
    const local = polygon.findIndex((vertex, index) =>
      vertex === use.a && polygon[(index + 1) % polygon.length] === use.b
    );
    if (local < 0) throw new Error('Fill Boundary could not resolve logical edge orientation.');
    const sourcePolygon = surface.polygons[use.face];
    const fromIndex = (local + 1) % polygon.length;
    return {
      edge,
      face: use.face,
      from: use.b,
      to: use.a,
      fromCorner: sourcePolygon.corners[fromIndex],
      material: sourcePolygon.material,
    };
  });

  const outgoing = new Map<number, DirectedBoundaryEdge>();
  const incoming = new Map<number, DirectedBoundaryEdge>();
  for (const record of records) {
    if (outgoing.has(record.from) || incoming.has(record.to)) {
      throw new Error('Fill Boundary selection must form one simple closed logical loop.');
    }
    outgoing.set(record.from, record);
    incoming.set(record.to, record);
  }

  const vertices = new Set(records.flatMap(record => [record.from, record.to]));
  if (
    vertices.size !== records.length ||
    [...vertices].some(vertex => !outgoing.has(vertex) || !incoming.has(vertex))
  ) {
    throw new Error('Fill Boundary selection must form one simple closed logical loop.');
  }

  const activeEdge = selectedEdges.at(-1)!;
  const start = records.find(record => record.edge === activeEdge)!;
  const loop: DirectedBoundaryEdge[] = [];
  const visited = new Set<number>();
  let current = start;
  while (!visited.has(current.edge)) {
    loop.push(current);
    visited.add(current.edge);
    const next = outgoing.get(current.to);
    if (!next) throw new Error('Fill Boundary selection is open.');
    current = next;
  }
  if (
    current.edge !== start.edge ||
    current.from !== start.from ||
    visited.size !== records.length
  ) {
    throw new Error('Fill Boundary selection must contain exactly one closed logical loop.');
  }

  const loopVertices = loop.map(record => record.from);
  const loopVertexSet = new Set(loopVertices);
  if (topology.polygons.some(polygon =>
    polygon.length === loopVertices.length &&
    polygon.every(vertex => loopVertexSet.has(vertex))
  )) {
    throw new Error('Fill Boundary loop already bounds a logical face.');
  }

  const cloneCorner = (corner: Corner): Corner => Object.fromEntries(
    Object.entries(corner).map(([name, data]) => [name, [...data]])
  );
  const fill: Polygon = {
    material: start.material,
    corners: loop.map(record => cloneCorner(record.fromCorner)),
  };
  const entries: EditedPolygon[] = topology.polygons.map((_, face) => ({
    polygon: surface.polygons[face],
    sourceFace: face,
  }));
  const filledFace = entries.length;
  entries.push({ polygon: fill });

  return {
    ...finishEditedSurface(source, inspection, entries),
    filledFace,
    boundaryEdges: selectedEdges.length,
  };
}

export function deleteLogicalComponents(
  source: THREE.BufferGeometry,
  mode: 'vertex' | 'edge' | 'face',
  components: number[],
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const surface = logicalSurface(source, inspection);
  const selected = [...new Set(components)];
  if (!selected.length) throw new Error('Select mesh components to delete.');

  if (mode === 'vertex') {
    if (selected.some(vertex => !Number.isInteger(vertex) || !topology.logicalVertices.includes(vertex))) {
      throw new Error('Invalid logical vertex selection.');
    }
    const selectedVertices = new Set(selected);
    const entries: EditedPolygon[] = [];
    for (let face = 0; face < topology.polygons.length; face++) {
      const boundary = topology.polygons[face];
      const keep = boundary.map((vertex, index) => ({ vertex, index })).filter(item => !selectedVertices.has(item.vertex));
      if (keep.length === boundary.length) {
        entries.push({ polygon: surface.polygons[face], sourceFace: face });
        continue;
      }
      if (keep.length < 3) continue;
      entries.push({
        polygon: {
          material: surface.polygons[face].material,
          corners: keep.map(item => surface.polygons[face].corners[item.index]),
          referenceNormals: keep.map(item => surface.polygons[face].referenceNormals![item.index]),
        },
      });
    }
    if (!entries.length) throw new Error('Delete Vertex would remove the entire mesh.');
    return finishEditedSurface(source, inspection, entries);
  }

  if (mode === 'edge') {
    const regions = mergedPolygonGroups(topology, selected);
    const groups = regions.map(region => region.flatMap(face => topology.polygonTriangles[face]));
    const mergedInspection = inspectGeometry(source, groups);
    const selectedPositionEdges = new Set(selected.map(edge => {
      const [a, b] = topology.polygonEdges[edge];
      const position = source.getAttribute('position');
      const corner = (vertex: number): Corner => ({
        position: [
          position.getX(topology.vertices[vertex][0]),
          position.getY(topology.vertices[vertex][0]),
          position.getZ(topology.vertices[vertex][0]),
        ],
      });
      return positionEdgeKey(corner(a), corner(b));
    }));
    const entries: EditedPolygon[] = regions.map((region, polygonId) => {
      if (region.length === 1) return { polygon: surface.polygons[region[0]], sourceFace: region[0] };
      const polygon = polygonFromTriangleGroup(source, mergedInspection, polygonId);
      polygon.forbiddenDiagonals = selectedPositionEdges;
      return { polygon };
    });
    return finishEditedSurface(source, inspection, entries);
  }

  if (selected.some(face => !Number.isInteger(face) || !topology.polygons[face])) {
    throw new Error('Invalid logical face selection.');
  }
  const removed = new Set(selected);
  if (removed.size === topology.polygons.length) {
    throw new Error('Delete would remove the entire mesh; delete the object in Object Mode instead.');
  }
  const entries = topology.polygons.flatMap((_, face) =>
    removed.has(face) ? [] : [{ polygon: surface.polygons[face], sourceFace: face }]
  );
  return finishEditedSurface(source, inspection, entries);
}

export function bevelLogicalEdges(source: THREE.BufferGeometry, edges: number[], width: number, polygonTriangles?: number[][]) {
  if (!Number.isFinite(width) || width < 0.0001 || width > 1000) throw new Error('Bevel width must be between 0.0001 and 1000.');
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology: t, read } = inspection;
  const { polygons, normals, uses } = logicalSurface(source, inspection);
  if (!edges.length || new Set(edges).size > 128 || edges.some(edge => !Number.isInteger(edge) || !t.polygonEdges[edge])) {
    throw new Error('Select at most 128 valid logical boundary edges.');
  }
  if ([...uses.values()].some(use => use.length !== 2)) throw new Error('Bevel requires a closed convex polygon mesh.');
  const points = t.vertices.map((_, i) => read(i)), bounds = new THREE.Box3().setFromPoints(points);
  const epsilon = Math.max(1e-7, bounds.getSize(new THREE.Vector3()).length() * 1e-6);
  if (points.length * t.polygons.length > 20_000_000) throw new Error('Convex bevel validation exceeds the work budget.');
  for (let face = 0; face < t.polygons.length; face++) {
    const d = read(t.polygons[face][0]).dot(normals[face]);
    if (points.some(point => point.dot(normals[face]) > d + epsilon)) throw new Error('Bevel requires a consistently oriented convex mesh.');
  }
  const planes = [...new Set(edges)].sort((a, b) => a - b).map(edge => {
    const [a, b] = t.polygonEdges[edge], adjacent = uses.get(edgeKey(a, b));
    if (!adjacent || adjacent.length !== 2) throw new Error('Selected logical edge is not shared by two polygons.');
    const n1 = normals[adjacent[0].face], n2 = normals[adjacent[1].face];
    if (n1.dot(n2) > 1 - 1e-6) throw new Error('Select sharp edges, not coplanar triangle diagonals.');
    const normal = n1.clone().add(n2).normalize();
    const inset = width * Math.sqrt((1 - n1.dot(n2)) / 2);
    if (width >= read(a).distanceTo(read(b)) / 2) throw new Error('Bevel width is too large for the selected edge.');
    const constant = read(a).dot(normal) - inset;
    if (points.some((point, i) => i !== a && i !== b && point.dot(normal) > constant + epsilon)) throw new Error('Bevel width would remove unrelated vertices.');
    return { normal, constant, material: polygons[adjacent[0].face].material };
  });

  let output = polygons;
  for (const plane of planes) {
    const cuts = new Map<string, Corner>(), next: Polygon[] = [];
    for (const polygon of output) {
      const clipped = clip(polygon.corners, plane.normal, plane.constant);
      if (clipped.corners.length >= 3) next.push({ ...polygon, corners: clipped.corners });
      clipped.cuts.forEach(corner => cuts.set(key(corner.position), corner));
    }
    const cap = [...cuts.values()];
    if (cap.length < 3) throw new Error('Bevel width removes a selected edge or collapses its cap.');
    const center = cap.reduce((sum, corner) => sum.add(vector(corner)), new THREE.Vector3()).divideScalar(cap.length);
    const u = vector(cap[0]).sub(center).normalize(), v = plane.normal.clone().cross(u);
    cap.sort((a, b) => Math.atan2(vector(a).sub(center).dot(v), vector(a).sub(center).dot(u)) - Math.atan2(vector(b).sub(center).dot(v), vector(b).sub(center).dot(u)));
    next.push({ corners: cap, material: plane.material });
    output = next;
  }
  return finishDetailed(output);
}

export function bevelEdges(source: THREE.BufferGeometry, edges: number[], width: number) {
  return bevelLogicalEdges(source, edges, width).geometry;
}

export function loopCut(source: THREE.BufferGeometry, edge: number) {
  const { topology: t, normals, uses, read, polygons } = inspectGeometry(source);
  if (!Number.isInteger(edge) || !t.edges[edge]) throw new Error('Select one quad boundary edge.');
  const pairs = new Map<number, { faces: number[]; boundary: number[] }>();
  for (const list of uses.values()) {
    if (list.length !== 2) continue;
    const [x, y] = list;
    if (normals[x.face].dot(normals[y.face]) < 1 - 1e-6) continue;
    const diagonal = read(x.a).distanceToSquared(read(x.b));
    if (![x.face, y.face].every(f => t.faces[f].every((a, j, face) => read(a).distanceToSquared(read(face[(j + 1) % 3])) <= diagonal + 1e-8))) continue;
    const c = t.faces[x.face].find(v => v !== x.a && v !== x.b)!, d = t.faces[y.face].find(v => v !== x.a && v !== x.b)!;
    const boundary = [x.a, d, x.b, c];
    const n = normals[x.face];
    if (boundary.some((a, i) => read(boundary[(i + 1) % 4]).sub(read(a)).cross(read(boundary[(i + 2) % 4]).sub(read(boundary[(i + 1) % 4]))).dot(n) <= 1e-10)) continue;
    if (pairs.has(x.face) || pairs.has(y.face)) throw new Error('Ambiguous quad pairing.');
    const pair = { faces: [x.face, y.face], boundary }; pairs.set(x.face, pair); pairs.set(y.face, pair);
  }
  const start = edgeKey(...t.edges[edge]), queue = [start], visited = new Set<string>(), split = new Map<number, { normal: THREE.Vector3; constant: number; parity: number }>();
  while (queue.length) {
    const k = queue.pop()!; if (visited.has(k)) continue; visited.add(k);
    for (const use of uses.get(k) ?? []) {
      const quad = pairs.get(use.face);
      if (!quad) throw new Error('Loop crosses a triangle or unsupported quad.');
      const j = quad.boundary.findIndex((v, i, vs) => edgeKey(v, vs[(i + 1) % 4]) === k);
      if (j < 0) throw new Error('Select a quad boundary, not its diagonal.');
      if (split.has(use.face)) {
        if (split.get(use.face)!.parity !== j % 2) throw new Error('Loop intersects itself in a quad.');
        continue;
      }
      const vs = quad.boundary, p = read(vs[j]).add(read(vs[(j + 1) % 4])).multiplyScalar(0.5), q = read(vs[(j + 2) % 4]).add(read(vs[(j + 3) % 4])).multiplyScalar(0.5);
      const normal = q.sub(p).cross(normals[use.face]).normalize(), plane = { normal, constant: normal.dot(p), parity: j % 2 };
      quad.faces.forEach(f => split.set(f, plane)); queue.push(edgeKey(vs[(j + 2) % 4], vs[(j + 3) % 4]));
    }
  }
  if (!split.size) throw new Error('No quad ring found.');
  return finish(polygons.flatMap((polygon, f) => {
    const plane = split.get(f); if (!plane) return [polygon];
    return [1, -1].map(sign => ({ ...polygon, corners: clip(polygon.corners, plane.normal.clone().multiplyScalar(sign), plane.constant * sign).corners }));
  }));
}

export function editUV(source: THREE.BufferGeometry, faces: number[], operation: 'project' | 'transform', values: number[]) {
  faces = [...new Set(faces)];
  const { polygons } = inspectGeometry(source);
  if (!faces.length || faces.some(f => !Number.isInteger(f) || !polygons[f])) throw new Error('Select triangle faces for UV editing.');
  if (values.some(v => !Number.isFinite(v) || Math.abs(v) > 10000) || values.length !== 5 || values[3] === 0 || values[4] === 0) throw new Error('Invalid UV transform.');
  const selected = new Set(faces), corners = faces.flatMap(f => polygons[f].corners);
  if (operation === 'project') {
    const n = new THREE.Vector3();
    faces.forEach(f => { const [a, b, c] = polygons[f].corners.map(vector); n.add(b.sub(a).cross(c.sub(a))); });
    if (n.lengthSq() < 1e-16) throw new Error('Projection faces need a nonzero average normal.');
    n.normalize(); const axis = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), u = axis.cross(n).normalize(), v = n.clone().cross(u);
    corners.forEach(c => { c.uv = [vector(c).dot(u), vector(c).dot(v)]; });
  } else if (corners.some(c => !c.uv || c.uv.length !== 2)) throw new Error('Project UVs before transforming them.');
  const center = [0, 1].map(j => corners.reduce((sum, c) => sum + c.uv[j], 0) / corners.length), angle = values[2] * Math.PI / 180;
  for (const c of corners) {
    const x = (c.uv[0] - center[0]) * values[3], y = (c.uv[1] - center[1]) * values[4];
    c.uv = [center[0] + x * Math.cos(angle) - y * Math.sin(angle) + values[0], center[1] + x * Math.sin(angle) + y * Math.cos(angle) + values[1]];
  }
  polygons.forEach((p, f) => { if (!selected.has(f)) p.corners.forEach(c => { c.uv ??= [0, 0]; }); });
  const result = source.index ? source.toNonIndexed() : source.clone();
  const valuesUV = polygons.flatMap(p => p.corners.flatMap(c => c.uv));
  if (valuesUV.some(v => !Number.isFinite(Math.fround(v)))) { result.dispose(); throw new Error('UV coordinates exceed precision.'); }
  result.setAttribute('uv', new THREE.Float32BufferAttribute(valuesUV, 2));
  return result;
}
