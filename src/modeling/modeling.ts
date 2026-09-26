import * as THREE from 'three';
import { buildTopology } from './topology';

type Corner = Record<string, number[]>;
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
  const topology = buildTopology(coordinates, indices, logical);
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
  return { topology, normals, uses, read, polygons, indices, materials };
}

function logicalSurface(source: THREE.BufferGeometry, inspection: ReturnType<typeof inspectGeometry>) {
  const { topology, read, indices, materials } = inspection;
  const readCorner = (index: number): Corner => Object.fromEntries(
    Object.entries(source.attributes)
      .filter(([name]) => name !== 'normal')
      .map(([name, attribute]) => [name, Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component))]),
  );
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
  let count = 0;
  for (const { corners, material } of polygons) {
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
      for (const corner of triangle) for (const [name, data] of Object.entries(corner)) {
        sizes[name] = data.length; (values[name] ??= []).push(...data);
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
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, polygonTriangles };
}

function finish(polygons: Polygon[]): THREE.BufferGeometry {
  return finishDetailed(polygons).geometry;
}

function translatedCorner(corner: Corner, offset: THREE.Vector3): Corner {
  return Object.fromEntries(Object.entries(corner).map(([name, data]) => [
    name,
    name === 'position'
      ? [
          Math.fround(data[0] + offset.x),
          Math.fround(data[1] + offset.y),
          Math.fround(data[2] + offset.z),
        ]
      : [...data],
  ]));
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
  const moved = polygon.corners.map(corner => translatedCorner(corner, offset));
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
    if (winding * cross2(projected[i], projected[(i + 1) % projected.length], projected[(i + 2) % projected.length]) <= 1e-10) {
      throw new Error('Inset currently requires a convex polygon.');
    }
  }

  const lines = projected.map((a, i) => {
    const b = projected[(i + 1) % projected.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) throw new Error('Inset polygon has a collapsed boundary edge.');
    const inward: [number, number] = winding > 0 ? [-dy / length, dx / length] : [dy / length, -dx / length];
    return { normal: inward, constant: inward[0] * a[0] + inward[1] * a[1] + distance };
  });

  const inner2 = projected.map((_, i) => {
    const previous = lines[(i + lines.length - 1) % lines.length];
    const current = lines[i];
    const determinant = previous.normal[0] * current.normal[1] - previous.normal[1] * current.normal[0];
    if (Math.abs(determinant) < 1e-10) throw new Error('Inset cannot offset parallel adjacent edges.');
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

export function loopCutLogicalEdge(
  source: THREE.BufferGeometry,
  edge: number,
  polygonTriangles?: number[][],
) {
  const inspection = inspectGeometry(source, polygonTriangles ?? false);
  const { topology } = inspection;
  const { polygons } = logicalSurface(source, inspection);
  if (!Number.isInteger(edge) || edge < 0 || !topology.polygonEdges[edge]) {
    throw new Error('Select one valid logical quad boundary edge.');
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

  const start = edgeKey(...topology.polygonEdges[edge]);
  const queue = [start];
  const visitedEdges = new Set<string>();
  const splitFaces = new Map<number, number>();

  while (queue.length) {
    const key = queue.pop()!;
    if (visitedEdges.has(key)) continue;
    visitedEdges.add(key);
    const edgeUses = uses.get(key) ?? [];
    if (!edgeUses.length) throw new Error('Loop Cut cannot find the selected logical edge.');
    for (const use of edgeUses) {
      const vertices = topology.polygons[use.face];
      if (vertices.length !== 4) throw new Error('Loop Cut stops at triangles or n-gons; the selected ring must pass through quads.');
      const existing = splitFaces.get(use.face);
      if (existing !== undefined) {
        if (existing % 2 !== use.local % 2) throw new Error('Loop Cut ring intersects itself.');
        continue;
      }
      splitFaces.set(use.face, use.local);
      const opposite = (use.local + 2) % 4;
      queue.push(edgeKey(vertices[opposite], vertices[(opposite + 1) % 4]));
    }
  }
  if (!splitFaces.size) throw new Error('No logical quad ring found.');

  const extras: Polygon[] = [];
  const output = polygons.map((polygon, face) => {
    const local = splitFaces.get(face);
    if (local === undefined) return polygon;
    const corners = polygon.corners;
    const a = corners[local];
    const b = corners[(local + 1) % 4];
    const c = corners[(local + 2) % 4];
    const d = corners[(local + 3) % 4];
    const entry = interpolate(a, b, 0.5);
    const opposite = interpolate(c, d, 0.5);
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
  let count = 0;

  const rawCorner = (index: number): Corner => Object.fromEntries(
    Object.entries(source.attributes)
      .filter(([name]) => name !== 'normal')
      .map(([name, attribute]) => [
        name,
        Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component)),
      ]),
  );
  const appendTriangle = (triangle: Corner[], material: number, ids: number[]) => {
    const [a, b, d] = triangle.map(vector);
    if (b.sub(a).cross(d.sub(a)).lengthSq() < 1e-16) throw new Error('Result collapses at mesh coordinate precision.');
    if (count + 3 > 600_000) throw new Error('Result exceeds 600,000 rendering vertices.');
    ids.push(count / 3);
    const last = groups.at(-1);
    if (last?.material === material) last.count += 3;
    else groups.push({ start: count, count: 3, material });
    for (const corner of triangle) for (const [name, data] of Object.entries(corner)) {
      sizes[name] = data.length;
      (values[name] ??= []).push(...data);
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
