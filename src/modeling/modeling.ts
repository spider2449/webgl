import * as THREE from 'three';
import { buildTopology } from './topology';

type Corner = Record<string, number[]>;
type Polygon = { corners: Corner[]; material: number };
const key = (v: number[]) => v.join(',');
const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const vector = (c: Corner) => new THREE.Vector3().fromArray(c.position);

export function inspectGeometry(source: THREE.BufferGeometry, pairTriangles = false) {
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
  const topology = buildTopology(coordinates, indices, pairTriangles);
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
  return { topology, normals, uses, read, polygons };
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

function finish(polygons: Polygon[]): THREE.BufferGeometry {
  const values: Record<string, number[]> = {}, sizes: Record<string, number> = {}, groups: { start: number; count: number; material: number }[] = [];
  let count = 0;
  for (const { corners, material } of polygons) {
    if (corners.length < 3) continue;
    const center = Object.fromEntries(Object.keys(corners[0]).map(name => [name, corners[0][name].map((_, j) => Math.fround(corners.reduce((sum, c) => sum + c[name][j], 0) / corners.length))]));
    const triangles = corners.length === 3 ? [corners] : corners.map((c, i) => [center, c, corners[(i + 1) % corners.length]]);
    for (const triangle of triangles) {
      const [a, b, c] = triangle.map(vector);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) throw new Error('Result collapses at mesh coordinate precision.');
      if (count + 3 > 600_000) throw new Error('Result exceeds 600,000 rendering vertices.');
      const last = groups.at(-1);
      if (last?.material === material) last.count += 3; else groups.push({ start: count, count: 3, material });
      for (const corner of triangle) for (const [name, data] of Object.entries(corner)) {
        sizes[name] = data.length; (values[name] ??= []).push(...data);
      }
      count += 3;
    }
  }
  if (!count) throw new Error('Operation would remove the mesh.');
  const result = new THREE.BufferGeometry();
  for (const [name, data] of Object.entries(values)) {
    if (data.some(v => !Number.isFinite(Math.fround(v)))) throw new Error('Result exceeds coordinate precision.');
    result.setAttribute(name, new THREE.Float32BufferAttribute(data, sizes[name]));
  }
  groups.forEach(g => result.addGroup(g.start, g.count, g.material));
  result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

export function bevelEdges(source: THREE.BufferGeometry, edges: number[], width: number) {
  if (!Number.isFinite(width) || width < 0.0001 || width > 1000) throw new Error('Bevel width must be between 0.0001 and 1000.');
  const { topology: t, normals, uses, read, polygons } = inspectGeometry(source);
  if (!edges.length || new Set(edges).size > 128 || edges.some(e => !Number.isInteger(e) || !t.edges[e])) throw new Error('Select at most 128 valid sharp edges.');
  if ([...uses.values()].some(u => u.length !== 2)) throw new Error('Bevel requires a closed convex mesh.');
  const points = t.vertices.map((_, i) => read(i)), bounds = new THREE.Box3().setFromPoints(points);
  const epsilon = Math.max(1e-7, bounds.getSize(new THREE.Vector3()).length() * 1e-6);
  if (points.length * t.faces.length > 20_000_000) throw new Error('Convex bevel validation exceeds the work budget.');
  for (let f = 0; f < t.faces.length; f++) {
    const d = read(t.faces[f][0]).dot(normals[f]);
    if (points.some(p => p.dot(normals[f]) > d + epsilon)) throw new Error('Bevel requires a consistently oriented convex mesh.');
  }
  const planes = [...new Set(edges)].sort((a, b) => a - b).map(e => {
    const [a, b] = t.edges[e], adjacent = uses.get(edgeKey(a, b))!;
    const n1 = normals[adjacent[0].face], n2 = normals[adjacent[1].face];
    if (n1.dot(n2) > 1 - 1e-6) throw new Error('Select sharp edges, not coplanar triangle diagonals.');
    const normal = n1.clone().add(n2).normalize();
    const inset = width * Math.sqrt((1 - n1.dot(n2)) / 2);
    if (width >= read(a).distanceTo(read(b)) / 2) throw new Error('Bevel width is too large for the selected edge.');
    const constant = read(a).dot(normal) - inset;
    if (points.some((p, i) => i !== a && i !== b && p.dot(normal) > constant + epsilon)) throw new Error('Bevel width would remove unrelated vertices.');
    return { normal, constant, material: polygons[adjacent[0].face].material };
  });
  let output = polygons;
  for (const plane of planes) {
    const cuts = new Map<string, Corner>(), next: Polygon[] = [];
    for (const polygon of output) {
      const clipped = clip(polygon.corners, plane.normal, plane.constant);
      if (clipped.corners.length >= 3) next.push({ ...polygon, corners: clipped.corners });
      clipped.cuts.forEach(c => cuts.set(key(c.position), c));
    }
    const cap = [...cuts.values()];
    if (cap.length < 3) throw new Error('Bevel width removes a selected edge or collapses its cap.');
    const center = cap.reduce((sum, c) => sum.add(vector(c)), new THREE.Vector3()).divideScalar(cap.length);
    const u = vector(cap[0]).sub(center).normalize(), v = plane.normal.clone().cross(u);
    cap.sort((a, b) => Math.atan2(vector(a).sub(center).dot(v), vector(a).sub(center).dot(u)) - Math.atan2(vector(b).sub(center).dot(v), vector(b).sub(center).dot(u)));
    next.push({ corners: cap, material: plane.material }); output = next;
  }
  return finish(output);
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
