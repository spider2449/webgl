import * as THREE from 'three';
import { buildTopology } from './topology';

// Endpoints are rendering-buffer indices; logical connectivity joins exact seams.
export function subdivideEdge(source: THREE.BufferGeometry, endpoints: [number, number]): THREE.BufferGeometry {
  return subdivideEdges(source, [endpoints]);
}

export function subdivideEdges(source: THREE.BufferGeometry, edges: [number, number][]): THREE.BufferGeometry {
  const position = source.getAttribute('position');
  const count = source.index?.count ?? position?.count ?? 0;
  if (!position || position.itemSize !== 3 || position.count > 100_000 || count > 600_000 || count % 3 !== 0) throw new Error('Subdivision requires at most 100,000 vertices and 200,000 triangles.');
  if (Object.keys(source.morphAttributes).length || source.drawRange.start !== 0 || source.drawRange.count !== Infinity) throw new Error('Subdivision does not support morph targets or partial draw ranges.');
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color'].includes(name) || !(attribute instanceof THREE.BufferAttribute) || attribute.count !== position.count || attribute.itemSize < 1 || attribute.itemSize > 4) throw new Error(`Subdivision does not support the ${name} attribute layout.`);
  }
  const indices = Array.from({ length: count }, (_, i) => source.index ? source.index.getX(i) : i);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= position.count)) throw new Error('Mesh contains invalid triangle indices.');
  if (!edges.length) throw new Error('Select at least one edge.');
  if (edges.some(edge => edge.length !== 2 || edge.some(i => !Number.isInteger(i) || i < 0 || i >= position.count))) throw new Error('Invalid edge endpoints.');
  for (const group of source.groups) {
    if (![group.start, group.count].every(v => Number.isInteger(v) && v >= 0 && v % 3 === 0) || group.start + group.count > count) throw new Error('Subdivision requires triangle-aligned material groups.');
  }
  const coordinates = Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)]).flat();
  if (coordinates.some(v => !Number.isFinite(v))) throw new Error('Mesh contains invalid coordinates.');
  const topology = buildTopology(coordinates, indices);
  const read = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i);
  const keyOf = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const positionKey = (v: THREE.Vector3) => `${v.x},${v.y},${v.z}`;
  const occupied = new Set(topology.vertices.map(copies => positionKey(read(copies[0]))));
  const selected = new Map<string, { midpoint: THREE.Vector3; incident: { face: number; direction: number }[] }>();
  for (const endpoints of edges) {
    const [first, second] = endpoints.map(i => topology.bufferToVertex[i]);
    if (first === second) throw new Error('Select a non-degenerate edge.');
    const key = keyOf(first, second);
    if (selected.has(key)) continue;
    const a = read(endpoints[0]), b = read(endpoints[1]);
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    midpoint.set(Math.fround(midpoint.x), Math.fround(midpoint.y), Math.fround(midpoint.z));
    if (![midpoint.x, midpoint.y, midpoint.z].every(Number.isFinite) || midpoint.equals(a) || midpoint.equals(b)) throw new Error('Subdivision collapses at mesh coordinate precision.');
    if (occupied.has(positionKey(midpoint))) throw new Error('Edge midpoint already contains a mesh vertex or another midpoint.');
    occupied.add(positionKey(midpoint));
    selected.set(key, { midpoint, incident: [] });
  }
  topology.faces.forEach((face, id) => {
    for (let j = 0; j < 3; j++) {
      const x = face[j], y = face[(j + 1) % 3];
      selected.get(keyOf(x, y))?.incident.push({ face: id, direction: x < y ? 1 : -1 });
    }
  });
  for (const { incident } of selected.values()) {
    if (!incident.length) throw new Error('Selected endpoints do not form an edge.');
    if (incident.length > 2 || (incident.length === 2 && (incident[0].face === incident[1].face || incident[0].direction === incident[1].direction))) throw new Error('Subdivision requires a manifold edge with consistent winding.');
  }
  const copies: [number, number][] = [], midpointIndices = new Map<string, number>();
  const copyPositions: THREE.Vector3[] = [];
  const outputIndices: number[] = [], offsets: number[] = [];
  for (let face = 0; face < count / 3; face++) {
    offsets.push(outputIndices.length);
    const corners = indices.slice(face * 3, face * 3 + 3);
    const mids = corners.map((x, j) => {
      const y = corners[(j + 1) % 3];
      const entry = selected.get(keyOf(topology.bufferToVertex[x], topology.bufferToVertex[y]));
      if (!entry) return -1;
      const key = keyOf(x, y);
      let mid = midpointIndices.get(key);
      if (mid === undefined) {
        mid = position.count + copies.length; midpointIndices.set(key, mid);
        copies.push([x, y]); copyPositions.push(entry.midpoint);
      }
      return mid;
    });
    const splitCount = mids.filter(i => i >= 0).length;
    if (!splitCount) { outputIndices.push(...corners); continue; }
    let triangles: number[];
    if (splitCount === 3) {
      const [a, b, c] = corners, [ab, bc, ca] = mids;
      triangles = [a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca];
    } else if (splitCount === 2) {
      // Rotate so the two split edges are AB and BC; the shared corner is B.
      const j = mids.findIndex((mid, i) => mid >= 0 && mids[(i + 1) % 3] >= 0);
      const a = corners[j], b = corners[(j + 1) % 3], c = corners[(j + 2) % 3];
      const ab = mids[j], bc = mids[(j + 1) % 3];
      triangles = [ab, b, bc, a, ab, c, ab, bc, c];
    } else {
      const j = mids.findIndex(mid => mid >= 0);
      const a = corners[j], b = corners[(j + 1) % 3], c = corners[(j + 2) % 3];
      triangles = [a, mids[j], c, mids[j], b, c];
    }
    const [p, q, r] = corners.map(read), normal = q.sub(p).cross(r.sub(p));
    const outputPosition = (i: number) => i < position.count ? read(i) : copyPositions[i - position.count].clone();
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = triangles.slice(i, i + 3).map(outputPosition);
      const area = b.sub(a).cross(c.sub(a)).dot(normal);
      if (!Number.isFinite(area) || area <= 0) throw new Error('Subdivision produces a degenerate triangle at mesh coordinate precision.');
    }
    outputIndices.push(...triangles);
  }
  offsets.push(outputIndices.length);
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === 'normal') continue;
    const output = new THREE.Float32BufferAttribute(new Float32Array((position.count + copies.length) * attribute.itemSize), attribute.itemSize);
    for (let i = 0; i < output.count; i++) for (let component = 0; component < attribute.itemSize; component++) {
      const pair = copies[i - position.count];
      const value = i < position.count ? attribute.getComponent(i, component) : name === 'position' ? copyPositions[i - position.count].getComponent(component) : (attribute.getComponent(pair[0], component) + attribute.getComponent(pair[1], component)) / 2;
      output.setComponent(i, component, value);
    }
    result.setAttribute(name, output);
  }
  result.setIndex(outputIndices);
  for (const group of source.groups) result.addGroup(offsets[group.start / 3], offsets[(group.start + group.count) / 3] - offsets[group.start / 3], group.materialIndex);
  result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}
