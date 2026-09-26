import * as THREE from 'three';
import { cutLogicalFace } from './modeling';
import { buildTopology } from './topology';

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

type CutEdgeEndpoint = {
  face: number;
  vertex: number;
  edge: number;
  t: number;
};

/**
 * Insert a true logical vertex on an existing logical edge, then split one
 * incident logical face from an existing boundary vertex to that new point.
 *
 * This is deliberately a single-face Knife building block: it does not walk
 * across faces and it does not accept arbitrary surface points.
 */
export function cutLogicalFaceToEdge(
  source: THREE.BufferGeometry,
  endpoint: CutEdgeEndpoint,
  polygonTriangles?: number[][],
) {
  const position = source.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Cut endpoint requires position data.');
  const indexCount = source.index?.count ?? position.count;
  if (!indexCount || indexCount % 3) throw new Error('Cut endpoint requires triangle geometry.');

  const topology = buildTopology(position.array, source.index?.array, polygonTriangles ?? false);
  const { face, vertex, edge, t } = endpoint;
  if (!Number.isInteger(face) || !topology.polygons[face]) throw new Error('Select one valid logical face to cut.');
  if (!Number.isInteger(vertex) || !topology.polygons[face].includes(vertex)) throw new Error('Cut start must be a logical vertex on the selected face.');
  if (!Number.isInteger(edge) || !topology.polygonEdges[edge]) throw new Error('Cut endpoint must lie on a logical edge.');
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new Error('Cut endpoint must lie strictly inside the logical edge.');

  const [edgeA, edgeB] = topology.polygonEdges[edge];
  const boundary = topology.polygons[face];
  const boundaryEdges = new Set(boundary.map((a, i) => edgeKey(a, boundary[(i + 1) % boundary.length])));
  if (!boundaryEdges.has(edgeKey(edgeA, edgeB))) throw new Error('Cut endpoint edge must bound the selected face.');
  if (vertex === edgeA || vertex === edgeB) throw new Error('Cut start cannot be an endpoint of the target edge.');

  const attributes = Object.entries(source.attributes);
  for (const [name, attribute] of attributes) {
    if (!(attribute instanceof THREE.BufferAttribute) || attribute.count !== position.count) throw new Error(`Unsupported attribute: ${name}.`);
  }
  const sourceIndices = Array.from({ length: indexCount }, (_, i) => source.index?.getX(i) ?? i);
  const rawToLogical = new Map<number, number>();
  topology.vertices.forEach((raw, logical) => raw.forEach(index => rawToLogical.set(index, logical)));

  const values: Record<string, number[]> = {};
  const sizes: Record<string, number> = {};
  const groups: { start: number; count: number; material: number }[] = [];
  const triangleMaterials = new Array<number>(indexCount / 3).fill(0);
  for (const group of source.groups) {
    for (let triangle = group.start / 3; triangle < (group.start + group.count) / 3; triangle++) {
      triangleMaterials[triangle] = group.materialIndex ?? 0;
    }
  }

  const read = (raw: number) => Object.fromEntries(attributes.map(([name, attribute]) => [
    name,
    Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(raw, component)),
  ]));
  const interpolate = (a: ReturnType<typeof read>, b: ReturnType<typeof read>) => Object.fromEntries(
    Object.keys(a).map(name => [name, a[name].map((value, component) => Math.fround(value + (b[name][component] - value) * t))]),
  );
  const append = (corners: ReturnType<typeof read>[], material: number) => {
    const last = groups.at(-1);
    if (last?.material === material) last.count += 3;
    else groups.push({ start: groups.reduce((sum, group) => sum + group.count, 0), count: 3, material });
    for (const corner of corners) for (const [name, data] of Object.entries(corner)) {
      sizes[name] = data.length;
      (values[name] ??= []).push(...data);
    }
  };

  const oldToNewTriangles = new Map<number, number[]>();
  let outputTriangle = 0;
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle++) {
    const raw = sourceIndices.slice(triangle * 3, triangle * 3 + 3);
    const logical = raw.map(index => rawToLogical.get(index));
    const localA = logical.indexOf(edgeA), localB = logical.indexOf(edgeB);
    if (localA < 0 || localB < 0) {
      append(raw.map(read), triangleMaterials[triangle]);
      oldToNewTriangles.set(triangle, [outputTriangle++]);
      continue;
    }

    const third = [0, 1, 2].find(local => local !== localA && local !== localB)!;
    const orientedAFirst = (localA + 1) % 3 === localB;
    const firstLocal = orientedAFirst ? localA : localB;
    const secondLocal = orientedAFirst ? localB : localA;
    const firstLogical = logical[firstLocal]!;
    const first = read(raw[firstLocal]);
    const second = read(raw[secondLocal]);
    const split = firstLogical === edgeA ? interpolate(first, second) : interpolate(second, first);
    const other = read(raw[third]);
    append([first, split, other], triangleMaterials[triangle]);
    append([split, second, other], triangleMaterials[triangle]);
    oldToNewTriangles.set(triangle, [outputTriangle, outputTriangle + 1]);
    outputTriangle += 2;
  }

  const geometry = new THREE.BufferGeometry();
  for (const [name, data] of Object.entries(values)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, sizes[name]));
  groups.forEach(group => geometry.addGroup(group.start, group.count, group.material));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const splitGroups = topology.polygonTriangles.map(group => group.flatMap(triangle => oldToNewTriangles.get(triangle) ?? []));
  const splitTopology = buildTopology(geometry.getAttribute('position').array, geometry.index?.array, splitGroups);
  const sourceStart = new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0]);
  const sourceA = new THREE.Vector3().fromBufferAttribute(position, topology.vertices[edgeA][0]);
  const sourceB = new THREE.Vector3().fromBufferAttribute(position, topology.vertices[edgeB][0]);
  const expected = sourceA.clone().lerp(sourceB, t);
  const splitPosition = geometry.getAttribute('position');
  const splitBoundary = splitTopology.polygons[face];
  const atPosition = (candidate: number, expectedPosition: THREE.Vector3) => {
    const raw = splitTopology.vertices[candidate][0];
    return new THREE.Vector3().fromBufferAttribute(splitPosition, raw).distanceToSquared(expectedPosition) < 1e-12;
  };
  // Retessellating the target edge rebuilds renderer triangles and can change
  // logical vertex IDs. Re-resolve both endpoints on the preserved logical
  // face boundary instead of assuming source IDs survive that rebuild.
  const mappedStart = splitBoundary.find(candidate => atPosition(candidate, sourceStart));
  if (mappedStart === undefined) throw new Error('Cut start vertex was not preserved on the logical face boundary.');
  const inserted = splitBoundary.find(candidate => candidate !== mappedStart && atPosition(candidate, expected));
  if (inserted === undefined) throw new Error('Cut endpoint vertex was not created on the logical edge.');

  const result = cutLogicalFace(geometry, face, [mappedStart, inserted], splitGroups);
  geometry.dispose();
  return result;
}
