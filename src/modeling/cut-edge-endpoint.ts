import * as THREE from 'three';
import { cutLogicalFace, cutLogicalFaceViaInteriorPath } from './modeling';
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


export type KnifeBoundaryEndpoint =
  | { kind: 'vertex'; vertex: number }
  | { kind: 'edge'; edge: number; t: number };

export type CutViaInteriorPath = {
  face: number;
  start: KnifeBoundaryEndpoint;
  interiors: [number, number, number][];
  end: KnifeBoundaryEndpoint;
};

export type CutViaInteriorPoint = {
  face: number;
  start: KnifeBoundaryEndpoint;
  interior: [number, number, number];
  end: KnifeBoundaryEndpoint;
};

function endpointPosition(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  endpoint: KnifeBoundaryEndpoint,
) {
  if (endpoint.kind === 'vertex') {
    if (!Number.isInteger(endpoint.vertex) || !topology.logicalVertices.includes(endpoint.vertex)) {
      throw new Error('Knife endpoint must be a logical vertex.');
    }
    return vertexPosition(topology, position, endpoint.vertex);
  }

  if (!Number.isInteger(endpoint.edge) || !topology.polygonEdges[endpoint.edge]) {
    throw new Error('Knife endpoint must lie on a logical edge.');
  }
  validateInteriorT(endpoint.t);
  const [a, b] = topology.polygonEdges[endpoint.edge];
  return vertexPosition(topology, position, a).lerp(vertexPosition(topology, position, b), endpoint.t);
}

function resolveBoundaryEdgeAtPosition(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  face: number,
  expected: THREE.Vector3,
) {
  const boundary = topology.polygons[face];
  if (!boundary) throw new Error('Knife face is no longer available.');

  const candidates: { edge: number; t: number; distanceSq: number }[] = [];
  for (let edge = 0; edge < topology.polygonEdges.length; edge++) {
    const [aVertex, bVertex] = topology.polygonEdges[edge];
    if (!boundaryHasEdge(boundary, aVertex, bVertex)) continue;
    const a = vertexPosition(topology, position, aVertex);
    const b = vertexPosition(topology, position, bVertex);
    const direction = b.clone().sub(a);
    const lengthSq = direction.lengthSq();
    if (lengthSq < 1e-16) continue;
    const t = expected.clone().sub(a).dot(direction) / lengthSq;
    if (!Number.isFinite(t) || t <= 1e-6 || t >= 1 - 1e-6) continue;
    const projected = a.clone().lerp(b, t);
    const distanceSq = projected.distanceToSquared(expected);
    if (distanceSq < POSITION_EPSILON_SQ) candidates.push({ edge, t, distanceSq });
  }
  if (!candidates.length) throw new Error('Knife boundary point is no longer inside a logical edge.');
  candidates.sort((a, b) => a.distanceSq - b.distanceSq || a.edge - b.edge);
  return candidates[0];
}

/**
 * Commit one valid boundary -> interior -> boundary Knife bend as two modeling
 * edges that split one logical face. Interior points are never committed as a
 * dangling endpoint: they only become topology when both boundary endpoints
 * are known.
 */
export function cutLogicalFaceViaPath(
  source: THREE.BufferGeometry,
  cut: CutViaInteriorPath,
  polygonTriangles?: number[][],
) {
  const position = source.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Interior Knife path requires position data.');
  const topology = buildTopology(position.array, source.index?.array, polygonTriangles ?? false);
  if (!Number.isInteger(cut.face) || !topology.polygons[cut.face]) {
    throw new Error('Select one valid logical face for the Knife path.');
  }
  if (!cut.interiors.length) throw new Error('Interior Knife path requires at least one bend point.');

  const startExpected = endpointPosition(topology, position, cut.start);
  const endExpected = endpointPosition(topology, position, cut.end);
  if (samePosition(startExpected, endExpected)) throw new Error('Knife path endpoints must be distinct.');

  let current = source;
  let groups = polygonTriangles;
  let ownsCurrent = false;

  const insertEndpointIfNeeded = (endpoint: KnifeBoundaryEndpoint, expected: THREE.Vector3) => {
    if (endpoint.kind === 'vertex') return;
    const currentPosition = current.getAttribute('position');
    const currentTopology = buildTopology(currentPosition.array, current.index?.array, groups ?? false);
    const remapped = resolveBoundaryEdgeAtPosition(currentTopology, currentPosition, cut.face, expected);
    const inserted = insertLogicalEdgePoint(
      current,
      { face: cut.face, edge: remapped.edge, t: remapped.t },
      groups,
    );
    if (ownsCurrent) current.dispose();
    current = inserted.geometry;
    groups = inserted.polygonTriangles;
    ownsCurrent = true;
  };

  try {
    insertEndpointIfNeeded(cut.start, startExpected);
    insertEndpointIfNeeded(cut.end, endExpected);

    const currentPosition = current.getAttribute('position');
    const currentTopology = buildTopology(currentPosition.array, current.index?.array, groups ?? false);
    const startVertex = resolveBoundaryVertex(currentTopology, currentPosition, cut.face, startExpected);
    const endVertex = resolveBoundaryVertex(currentTopology, currentPosition, cut.face, endExpected);
    if (startVertex === undefined || endVertex === undefined) {
      throw new Error('Knife path endpoints were not preserved on the logical face boundary.');
    }

    return cutLogicalFaceViaInteriorPath(
      current,
      cut.face,
      [startVertex, endVertex],
      cut.interiors,
      groups,
    );
  } finally {
    if (ownsCurrent) current.dispose();
  }
}

/**
 * Backwards-compatible single-bend wrapper.
 */
export function cutLogicalFaceViaPoint(
  source: THREE.BufferGeometry,
  cut: CutViaInteriorPoint,
  polygonTriangles?: number[][],
) {
  return cutLogicalFaceViaPath(source, {
    face: cut.face,
    start: cut.start,
    interiors: [cut.interior],
    end: cut.end,
  }, polygonTriangles);
}
