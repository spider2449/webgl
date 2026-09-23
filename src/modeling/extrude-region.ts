import * as THREE from 'three';
import { buildTopology } from './topology';

export function extrudeRegion(source: THREE.BufferGeometry, requested: number[], distance: number): THREE.BufferGeometry {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) throw new Error('Distance must be between 0.0001 and 1000 local units.');
  const position = source.getAttribute('position'), count = source.index?.count ?? position?.count ?? 0;
  if (!position || position.itemSize !== 3 || position.count > 100_000 || count > 600_000 || count % 3) throw new Error('Region extrusion requires at most 100,000 vertices and 200,000 triangles.');
  const faces = [...new Set(requested)].sort((a, b) => a - b);
  if (!faces.length || faces.some(f => !Number.isInteger(f) || f < 0 || f >= count / 3)) throw new Error('Select valid triangle faces for region extrusion.');
  if (Object.keys(source.morphAttributes).length || source.drawRange.start !== 0 || source.drawRange.count !== Infinity) throw new Error('Region extrusion does not support morph targets or partial draw ranges.');
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color'].includes(name) || !(attribute instanceof THREE.BufferAttribute) || attribute.count !== position.count || attribute.itemSize < 1 || attribute.itemSize > 4) throw new Error(`Region extrusion does not support the ${name} attribute layout.`);
  }
  for (const group of source.groups) if (![group.start, group.count].every(v => Number.isInteger(v) && v >= 0 && v % 3 === 0) || group.start + group.count > count) throw new Error('Region extrusion requires triangle-aligned material groups.');
  const indices = Array.from({ length: count }, (_, i) => source.index ? source.index.getX(i) : i);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= position.count)) throw new Error('Mesh contains invalid triangle indices.');
  const positions = Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)]).flat();
  if (positions.some(v => !Number.isFinite(v))) throw new Error('Mesh contains invalid coordinates.');
  const topology = buildTopology(positions, indices), selected = new Set(faces);
  const read = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i);
  const origin = read(indices[faces[0] * 3]);
  const normal = read(indices[faces[0] * 3 + 1]).sub(origin).cross(read(indices[faces[0] * 3 + 2]).sub(origin)).normalize();
  const bounds = new THREE.Box3();
  for (const face of faces) for (let j = 0; j < 3; j++) bounds.expandByPoint(read(indices[face * 3 + j]));
  const tolerance = Math.max(1e-7, bounds.getSize(new THREE.Vector3()).length() * 1e-6);
  for (const face of faces) {
    const [a, b, c] = indices.slice(face * 3, face * 3 + 3).map(read);
    const faceNormal = b.clone().sub(a).cross(c.clone().sub(a));
    if (!Number.isFinite(faceNormal.lengthSq()) || faceNormal.lengthSq() < 1e-16) throw new Error('Cannot extrude a degenerate triangle.');
    if (faceNormal.normalize().dot(normal) < 1 - 1e-6 || [a, b, c].some(p => Math.abs(p.clone().sub(origin).dot(normal)) > tolerance)) throw new Error('Region faces must be coplanar and consistently oriented.');
  }
  type Use = { face: number; a: number; b: number; first: number; second: number };
  const edgeUses = new Map<string, Use[]>();
  topology.faces.forEach((vertices, face) => {
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const use = { face, a, b, first: indices[face * 3 + j], second: indices[face * 3 + (j + 1) % 3] };
      const list = edgeUses.get(key); if (list) list.push(use); else edgeUses.set(key, [use]);
    }
  });
  const neighbors = new Map(faces.map(f => [f, [] as number[]])), boundary: Use[] = [];
  for (const uses of edgeUses.values()) {
    const inside = uses.filter(use => selected.has(use.face));
    if (!inside.length) continue;
    if (uses.length > 2 || uses.some(use => use.a === use.b) || (uses.length === 2 && (uses[0].a !== uses[1].b || uses[0].b !== uses[1].a))) throw new Error('Region requires manifold edges with consistent winding.');
    if (inside.length === 1) boundary.push(inside[0]);
    else { neighbors.get(inside[0].face)!.push(inside[1].face); neighbors.get(inside[1].face)!.push(inside[0].face); }
  }
  const reached = new Set<number>(), pending = [faces[0]];
  while (pending.length) {
    const face = pending.pop()!; if (reached.has(face)) continue;
    reached.add(face); for (const next of neighbors.get(face)!) if (!reached.has(next)) pending.push(next);
  }
  if (reached.size !== faces.length) throw new Error('Select one edge-connected planar region.');
  const incoming = new Map<number, number>(), outgoing = new Map<number, number>();
  for (const edge of boundary) { outgoing.set(edge.a, (outgoing.get(edge.a) ?? 0) + 1); incoming.set(edge.b, (incoming.get(edge.b) ?? 0) + 1); }
  if (!boundary.length || [...new Set([...incoming.keys(), ...outgoing.keys()])].some(v => incoming.get(v) !== 1 || outgoing.get(v) !== 1)) throw new Error('Region boundary must consist of simple closed loops.');
  const offset = normal.clone().multiplyScalar(distance);
  const moved = (i: number) => { const p = read(i).add(offset); return p.set(Math.fround(p.x), Math.fround(p.y), Math.fround(p.z)); };
  const capVertices = [...new Set(faces.flatMap(face => indices.slice(face * 3, face * 3 + 3)))];
  for (const i of capVertices) {
    const p = moved(i);
    if (![p.x, p.y, p.z].every(Number.isFinite) || p.clone().sub(read(i)).dot(normal) <= 0) throw new Error('Region extrusion collapses at mesh coordinate precision.');
  }
  for (const face of faces) {
    const [a, b, c] = indices.slice(face * 3, face * 3 + 3).map(moved);
    const area = b.sub(a).cross(c.sub(a)).dot(normal);
    if (!Number.isFinite(area) || area <= 0) throw new Error('Region cap collapses at mesh coordinate precision.');
  }
  for (const edge of boundary) {
    const a = read(edge.first), b = read(edge.second), c = moved(edge.second), d = moved(edge.first);
    const expected = b.clone().sub(a).cross(offset);
    if (![b.clone().sub(a).cross(c.clone().sub(a)).dot(expected), c.clone().sub(a).cross(d.clone().sub(a)).dot(expected)].every(v => Number.isFinite(v) && v > 0)) throw new Error('Region wall collapses at mesh coordinate precision.');
  }
  const copies = capVertices.map(index => ({ index, moved: true }));
  const caps = new Map(capVertices.map((index, i) => [index, position.count + i]));
  const outputIndices = [...indices];
  for (const face of faces) for (let j = 0; j < 3; j++) outputIndices[face * 3 + j] = caps.get(indices[face * 3 + j])!;
  const wallGroups: { start: number; material: number }[] = [];
  for (const edge of boundary) {
    const start = position.count + copies.length;
    copies.push({ index: edge.first, moved: false }, { index: edge.second, moved: false }, { index: edge.second, moved: true }, { index: edge.first, moved: true });
    wallGroups.push({ start: outputIndices.length, material: source.groups.find(g => edge.face * 3 >= g.start && edge.face * 3 + 3 <= g.start + g.count)?.materialIndex ?? 0 });
    outputIndices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === 'normal') continue;
    const output = new THREE.Float32BufferAttribute(new Float32Array((position.count + copies.length) * attribute.itemSize), attribute.itemSize);
    for (let i = 0; i < output.count; i++) {
      const copy = i < position.count ? { index: i, moved: false } : copies[i - position.count];
      for (let component = 0; component < attribute.itemSize; component++) output.setComponent(i, component, name === 'position' && copy.moved ? moved(copy.index).getComponent(component) : attribute.getComponent(copy.index, component));
    }
    result.setAttribute(name, output);
  }
  result.setIndex(outputIndices);
  for (const group of source.groups) result.addGroup(group.start, group.count, group.materialIndex);
  if (source.groups.length) for (const group of wallGroups) result.addGroup(group.start, 6, group.material);
  result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}
