import * as THREE from 'three';
import { cutLogicalFace } from './modeling';
import { buildTopology } from './topology';

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const POSITION_EPSILON_SQ = 1e-12;

type EdgePoint = {
  face: number;
  edge: number;
  t: number;
};

type CutEdgeEndpoint = EdgePoint & {
  vertex: number;
};

type CutBetweenEdges = {
  face: number;
  firstEdge: number;
  firstT: number;
  secondEdge: number;
  secondT: number;
};

function vertexPosition(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertex: number,
) {
  return new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertex][0]);
}

function boundaryHasEdge(boundary: number[], a: number, b: number) {
  const target = edgeKey(a, b);
  return boundary.some((vertex, index) => edgeKey(vertex, boundary[(index + 1) % boundary.length]) === target);
}

function validateInteriorT(t: number) {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new Error('Cut endpoint must lie strictly inside the logical edge.');
}

function samePosition(a: THREE.Vector3, b: THREE.Vector3) {
  return a.distanceToSquared(b) < POSITION_EPSILON_SQ;
}

function resolveBoundaryVertex(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  face: number,
  expected: THREE.Vector3,
) {
  return topology.polygons[face]?.find(vertex => samePosition(vertexPosition(topology, position, vertex), expected));
}

function resolveEdgeByPositions(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  face: number,
  expectedA: THREE.Vector3,
  expectedB: THREE.Vector3,
  t: number,
) {
  for (let edge = 0; edge < topology.polygonEdges.length; edge++) {
    const [a, b] = topology.polygonEdges[edge];
    if (!boundaryHasEdge(topology.polygons[face], a, b)) continue;
    const actualA = vertexPosition(topology, position, a);
    const actualB = vertexPosition(topology, position, b);
    if (samePosition(actualA, expectedA) && samePosition(actualB, expectedB)) return { edge, t };
    if (samePosition(actualA, expectedB) && samePosition(actualB, expectedA)) return { edge, t: 1 - t };
  }
  throw new Error('Knife target edge was not preserved after endpoint insertion.');
}

function insertLogicalEdgePoint(
  source: THREE.BufferGeometry,
  endpoint: EdgePoint,
  polygonTriangles?: number[][],
) {
  const position = source.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Cut endpoint requires position data.');
  const indexCount = source.index?.count ?? position.count;
  if (!indexCount || indexCount % 3) throw new Error('Cut endpoint requires triangle geometry.');

  const topology = buildTopology(position.array, source.index?.array, polygonTriangles ?? false);
  const { face, edge, t } = endpoint;
  if (!Number.isInteger(face) || !topology.polygons[face]) throw new Error('Select one valid logical face to cut.');
  if (!Number.isInteger(edge) || !topology.polygonEdges[edge]) throw new Error('Cut endpoint must lie on a logical edge.');
  validateInteriorT(t);

  const [edgeA, edgeB] = topology.polygonEdges[edge];
  const boundary = topology.polygons[face];
  if (!boundaryHasEdge(boundary, edgeA, edgeB)) throw new Error('Cut endpoint edge must bound the selected face.');

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
  const expected = vertexPosition(topology, position, edgeA).lerp(vertexPosition(topology, position, edgeB), t);
  const splitPosition = geometry.getAttribute('position');
  const inserted = resolveBoundaryVertex(splitTopology, splitPosition, face, expected);
  if (inserted === undefined) {
    geometry.dispose();
    throw new Error('Cut endpoint vertex was not created on the logical edge.');
  }

  return { geometry, polygonTriangles: splitGroups, position: expected };
}

/**
 * Insert a true logical vertex on an existing logical edge, then split one
 * incident logical face from an existing boundary vertex to that new point.
 */
export function cutLogicalFaceToEdge(
  source: THREE.BufferGeometry,
  endpoint: CutEdgeEndpoint,
  polygonTriangles?: number[][],
) {
  const position = source.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Cut endpoint requires position data.');
  const topology = buildTopology(position.array, source.index?.array, polygonTriangles ?? false);
  const { face, vertex, edge, t } = endpoint;
  if (!Number.isInteger(face) || !topology.polygons[face]) throw new Error('Select one valid logical face to cut.');
  if (!Number.isInteger(vertex) || !topology.polygons[face].includes(vertex)) throw new Error('Cut start must be a logical vertex on the selected face.');
  if (!Number.isInteger(edge) || !topology.polygonEdges[edge]) throw new Error('Cut endpoint must lie on a logical edge.');
  validateInteriorT(t);

  const [edgeA, edgeB] = topology.polygonEdges[edge];
  if (!boundaryHasEdge(topology.polygons[face], edgeA, edgeB)) throw new Error('Cut endpoint edge must bound the selected face.');
  if (vertex === edgeA || vertex === edgeB) throw new Error('Cut start cannot be an endpoint of the target edge.');

  const startPosition = vertexPosition(topology, position, vertex);
  const inserted = insertLogicalEdgePoint(source, { face, edge, t }, polygonTriangles);
  try {
    const splitPosition = inserted.geometry.getAttribute('position');
    const splitTopology = buildTopology(splitPosition.array, inserted.geometry.index?.array, inserted.polygonTriangles);
    const mappedStart = resolveBoundaryVertex(splitTopology, splitPosition, face, startPosition);
    const mappedEnd = resolveBoundaryVertex(splitTopology, splitPosition, face, inserted.position);
    if (mappedStart === undefined) throw new Error('Cut start vertex was not preserved on the logical face boundary.');
    if (mappedEnd === undefined) throw new Error('Cut endpoint vertex was not created on the logical edge.');
    return cutLogicalFace(inserted.geometry, face, [mappedStart, mappedEnd], inserted.polygonTriangles);
  } finally {
    inserted.geometry.dispose();
  }
}

/**
 * Insert two true logical vertices on two existing logical edges of one face,
 * then cut directly between those inserted points.
 */
export function cutLogicalFaceBetweenEdges(
  source: THREE.BufferGeometry,
  cut: CutBetweenEdges,
  polygonTriangles?: number[][],
) {
  const position = source.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Knife requires position data.');
  const topology = buildTopology(position.array, source.index?.array, polygonTriangles ?? false);
  const { face, firstEdge, firstT, secondEdge, secondT } = cut;
  if (!Number.isInteger(face) || !topology.polygons[face]) throw new Error('Select one valid logical face to cut.');
  if (!Number.isInteger(firstEdge) || !topology.polygonEdges[firstEdge] || !Number.isInteger(secondEdge) || !topology.polygonEdges[secondEdge]) {
    throw new Error('Knife endpoints must lie on valid logical edges.');
  }
  if (firstEdge === secondEdge) throw new Error('Knife endpoints must lie on two different logical edges.');
  validateInteriorT(firstT);
  validateInteriorT(secondT);

  const [firstA, firstB] = topology.polygonEdges[firstEdge];
  const [secondA, secondB] = topology.polygonEdges[secondEdge];
  const boundary = topology.polygons[face];
  if (!boundaryHasEdge(boundary, firstA, firstB) || !boundaryHasEdge(boundary, secondA, secondB)) {
    throw new Error('Both Knife edges must bound the selected logical face.');
  }

  const firstExpected = vertexPosition(topology, position, firstA).lerp(vertexPosition(topology, position, firstB), firstT);
  const secondAExpected = vertexPosition(topology, position, secondA);
  const secondBExpected = vertexPosition(topology, position, secondB);
  const secondExpected = secondAExpected.clone().lerp(secondBExpected, secondT);

  const first = insertLogicalEdgePoint(source, { face, edge: firstEdge, t: firstT }, polygonTriangles);
  try {
    const firstPosition = first.geometry.getAttribute('position');
    const firstTopology = buildTopology(firstPosition.array, first.geometry.index?.array, first.polygonTriangles);
    const remappedSecond = resolveEdgeByPositions(firstTopology, firstPosition, face, secondAExpected, secondBExpected, secondT);
    const second = insertLogicalEdgePoint(
      first.geometry,
      { face, edge: remappedSecond.edge, t: remappedSecond.t },
      first.polygonTriangles,
    );
    try {
      const secondPosition = second.geometry.getAttribute('position');
      const secondTopology = buildTopology(secondPosition.array, second.geometry.index?.array, second.polygonTriangles);
      const firstVertex = resolveBoundaryVertex(secondTopology, secondPosition, face, firstExpected);
      const secondVertex = resolveBoundaryVertex(secondTopology, secondPosition, face, secondExpected);
      if (firstVertex === undefined || secondVertex === undefined) throw new Error('Knife endpoints were not preserved on the logical face boundary.');
      return cutLogicalFace(second.geometry, face, [firstVertex, secondVertex], second.polygonTriangles);
    } finally {
      second.geometry.dispose();
    }
  } finally {
    first.geometry.dispose();
  }
}
