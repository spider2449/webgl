import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { cutLogicalFaceBetweenEdges, cutLogicalFaceToEdge, cutLogicalFaceViaPath, cutLogicalFaceViaPoint } from '../src/modeling/cut-edge-endpoint';
import { buildTopology } from '../src/modeling/topology';

function point(geometry: THREE.BufferGeometry, topology: ReturnType<typeof buildTopology>, vertex: number) {
  const position = geometry.getAttribute('position');
  const raw = topology.vertices[vertex][0];
  return new THREE.Vector3(position.getX(raw), position.getY(raw), position.getZ(raw));
}

test('interior Knife bend creates one true logical interior vertex and two cut edges', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const before = JSON.stringify(plane.toJSON());
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const start = boundary[0];
  const end = boundary[2];
  const center = boundary
    .map(vertex => point(plane, input, vertex))
    .reduce((sum, value) => sum.add(value), new THREE.Vector3())
    .multiplyScalar(1 / boundary.length);
  const interior = center.clone().lerp(point(plane, input, boundary[1]), 0.2);

  const result = cutLogicalFaceViaPoint(plane, {
    face,
    start: { kind: 'vertex', vertex: start },
    interior: interior.toArray() as [number, number, number],
    end: { kind: 'vertex', vertex: end },
  }, input.polygonTriangles);

  expect(JSON.stringify(plane.toJSON())).toBe(before);
  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );

  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(5);
  expect(output.polygonEdges).toHaveLength(6);

  const interiorVertex = output.logicalVertices.find(vertex =>
    point(result.geometry, output, vertex).distanceToSquared(interior) < 1e-12
  );
  expect(interiorVertex).toBeDefined();
  expect(output.polygons.filter(polygon => polygon.includes(interiorVertex!))).toHaveLength(2);

  const startPosition = point(plane, input, start);
  const endPosition = point(plane, input, end);
  const remappedStart = output.logicalVertices.find(vertex =>
    point(result.geometry, output, vertex).distanceToSquared(startPosition) < 1e-12
  );
  const remappedEnd = output.logicalVertices.find(vertex =>
    point(result.geometry, output, vertex).distanceToSquared(endPosition) < 1e-12
  );
  expect(remappedStart).toBeDefined();
  expect(remappedEnd).toBeDefined();
  expect(output.polygonEdges.some(([a, b]) =>
    (a === remappedStart && b === interiorVertex) || (a === interiorVertex && b === remappedStart)
  )).toBe(true);
  expect(output.polygonEdges.some(([a, b]) =>
    (a === remappedEnd && b === interiorVertex) || (a === interiorVertex && b === remappedEnd)
  )).toBe(true);

  result.geometry.dispose();
  plane.dispose();
});

test('interior Knife bend inserts two edge endpoints before splitting the logical face', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const edgeId = (a: number, b: number) => input.polygonEdges.findIndex(([x, y]) =>
    (x === a && y === b) || (x === b && y === a)
  );
  const startEdge = edgeId(boundary[0], boundary[1]);
  const endEdge = edgeId(boundary[2], boundary[3]);
  expect(startEdge).toBeGreaterThanOrEqual(0);
  expect(endEdge).toBeGreaterThanOrEqual(0);

  const edgePoint = (edge: number, t: number) => {
    const [a, b] = input.polygonEdges[edge];
    return point(plane, input, a).lerp(point(plane, input, b), t);
  };
  const startExpected = edgePoint(startEdge, 0.3);
  const endExpected = edgePoint(endEdge, 0.65);
  const center = boundary
    .map(vertex => point(plane, input, vertex))
    .reduce((sum, value) => sum.add(value), new THREE.Vector3())
    .multiplyScalar(1 / boundary.length);
  const interior = center.clone().lerp(point(plane, input, boundary[1]), 0.15);

  const result = cutLogicalFaceViaPoint(plane, {
    face,
    start: { kind: 'edge', edge: startEdge, t: 0.3 },
    interior: interior.toArray() as [number, number, number],
    end: { kind: 'edge', edge: endEdge, t: 0.65 },
  }, input.polygonTriangles);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(7);
  expect(output.polygonEdges).toHaveLength(8);

  for (const expected of [startExpected, interior, endExpected]) {
    expect(output.logicalVertices.some(vertex =>
      point(result.geometry, output, vertex).distanceToSquared(expected) < 1e-12
    )).toBe(true);
  }

  result.geometry.dispose();
  plane.dispose();
});

test('interior Knife bend supports a concave logical face when both legs stay inside', () => {
  const geometry = new THREE.BufferGeometry();
  const points = [
    [0, 0, 0],
    [2, 0, 0],
    [1, 1, 0],
    [2, 2, 0],
    [0, 2, 0],
  ];
  const triangles = [
    points[0], points[1], points[2],
    points[0], points[2], points[4],
    points[2], points[3], points[4],
  ].flat();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();

  const groups = [[0, 1, 2]];
  const topology = buildTopology(
    geometry.getAttribute('position').array,
    geometry.index?.array,
    groups,
  );
  const findVertex = (expected: [number, number, number]) =>
    topology.logicalVertices.find(vertex =>
      point(geometry, topology, vertex).distanceToSquared(new THREE.Vector3(...expected)) < 1e-12
    );
  const start = findVertex([2, 0, 0]);
  const end = findVertex([2, 2, 0]);
  expect(start).toBeDefined();
  expect(end).toBeDefined();

  const result = cutLogicalFaceViaPoint(geometry, {
    face: 0,
    start: { kind: 'vertex', vertex: start! },
    interior: [0.5, 1, 0],
    end: { kind: 'vertex', vertex: end! },
  }, groups);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(6);
  expect(output.polygonEdges).toHaveLength(7);
  expect(output.logicalVertices.some(vertex =>
    point(result.geometry, output, vertex).distanceToSquared(new THREE.Vector3(0.5, 1, 0)) < 1e-12
  )).toBe(true);

  result.geometry.dispose();
  geometry.dispose();
});

test('interior Knife bend rejects a concave path leg that exits through the notch', () => {
  const geometry = new THREE.BufferGeometry();
  const points = [
    [0, 0, 0],
    [2, 0, 0],
    [1, 1, 0],
    [2, 2, 0],
    [0, 2, 0],
  ];
  const triangles = [
    points[0], points[1], points[2],
    points[0], points[2], points[4],
    points[2], points[3], points[4],
  ].flat();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();

  const groups = [[0, 1, 2]];
  const topology = buildTopology(
    geometry.getAttribute('position').array,
    geometry.index?.array,
    groups,
  );
  const findVertex = (expected: [number, number, number]) =>
    topology.logicalVertices.find(vertex =>
      point(geometry, topology, vertex).distanceToSquared(new THREE.Vector3(...expected)) < 1e-12
    );
  const start = findVertex([2, 0, 0]);
  const end = findVertex([2, 2, 0]);
  expect(start).toBeDefined();
  expect(end).toBeDefined();

  expect(() => cutLogicalFaceViaPoint(geometry, {
    face: 0,
    start: { kind: 'vertex', vertex: start! },
    interior: [0.9, 0.1, 0],
    end: { kind: 'vertex', vertex: end! },
  }, groups)).toThrow(/leave the logical face boundary/);

  geometry.dispose();
});

test('multi-bend Knife path creates true logical vertices and edges for every interior bend', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const start = boundary[0];
  const end = boundary[2];
  const startPoint = point(plane, input, start);
  const endPoint = point(plane, input, end);
  const first = startPoint.clone().lerp(endPoint, 0.35).add(new THREE.Vector3(0.15, -0.1, 0));
  const second = startPoint.clone().lerp(endPoint, 0.65).add(new THREE.Vector3(-0.1, 0.15, 0));

  const result = cutLogicalFaceViaPath(plane, {
    face,
    start: { kind: 'vertex', vertex: start },
    interiors: [
      first.toArray() as [number, number, number],
      second.toArray() as [number, number, number],
    ],
    end: { kind: 'vertex', vertex: end },
  }, input.polygonTriangles);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(6);
  expect(output.polygonEdges).toHaveLength(7);

  const find = (expected: THREE.Vector3) => output.logicalVertices.find(vertex =>
    point(result.geometry, output, vertex).distanceToSquared(expected) < 1e-12
  );
  const mappedStart = find(startPoint);
  const mappedFirst = find(first);
  const mappedSecond = find(second);
  const mappedEnd = find(endPoint);
  expect(mappedStart).toBeDefined();
  expect(mappedFirst).toBeDefined();
  expect(mappedSecond).toBeDefined();
  expect(mappedEnd).toBeDefined();

  const hasEdge = (a: number | undefined, b: number | undefined) =>
    output.polygonEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  expect(hasEdge(mappedStart, mappedFirst)).toBe(true);
  expect(hasEdge(mappedFirst, mappedSecond)).toBe(true);
  expect(hasEdge(mappedSecond, mappedEnd)).toBe(true);
  expect(output.polygons.filter(polygon => polygon.includes(mappedFirst!))).toHaveLength(2);
  expect(output.polygons.filter(polygon => polygon.includes(mappedSecond!))).toHaveLength(2);

  result.geometry.dispose();
  plane.dispose();
});

test('edge-to-edge multi-bend Knife path preserves inserted boundary endpoints', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const edgeId = (a: number, b: number) => input.polygonEdges.findIndex(([x, y]) =>
    (x === a && y === b) || (x === b && y === a)
  );
  const startEdge = edgeId(boundary[0], boundary[1]);
  const endEdge = edgeId(boundary[2], boundary[3]);
  expect(startEdge).toBeGreaterThanOrEqual(0);
  expect(endEdge).toBeGreaterThanOrEqual(0);

  const edgePoint = (edge: number, t: number) => {
    const [a, b] = input.polygonEdges[edge];
    return point(plane, input, a).lerp(point(plane, input, b), t);
  };
  const startExpected = edgePoint(startEdge, 0.25);
  const endExpected = edgePoint(endEdge, 0.7);
  const first = startExpected.clone().lerp(endExpected, 0.35).add(new THREE.Vector3(0.12, 0.08, 0));
  const second = startExpected.clone().lerp(endExpected, 0.68).add(new THREE.Vector3(-0.08, -0.1, 0));

  const result = cutLogicalFaceViaPath(plane, {
    face,
    start: { kind: 'edge', edge: startEdge, t: 0.25 },
    interiors: [
      first.toArray() as [number, number, number],
      second.toArray() as [number, number, number],
    ],
    end: { kind: 'edge', edge: endEdge, t: 0.7 },
  }, input.polygonTriangles);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(8);
  expect(output.polygonEdges).toHaveLength(9);
  for (const expected of [startExpected, first, second, endExpected]) {
    expect(output.logicalVertices.some(vertex =>
      point(result.geometry, output, vertex).distanceToSquared(expected) < 1e-12
    )).toBe(true);
  }

  result.geometry.dispose();
  plane.dispose();
});

test('multi-bend Knife path rejects self-intersection', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const positions = boundary.map(vertex => point(plane, input, vertex));
  const start = positions.findIndex(value => value.distanceToSquared(new THREE.Vector3(-1, -1, 0)) < 1e-12);
  const end = positions.findIndex(value => value.distanceToSquared(new THREE.Vector3(1, -1, 0)) < 1e-12);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThanOrEqual(0);

  expect(() => cutLogicalFaceViaPath(plane, {
    face,
    start: { kind: 'vertex', vertex: boundary[start] },
    interiors: [
      [0.7, 0.7, 0],
      [-0.7, 0.7, 0],
    ],
    end: { kind: 'vertex', vertex: boundary[end] },
  }, input.polygonTriangles)).toThrow(/self-intersect/);

  plane.dispose();
});

test('edge endpoint cut inserts one logical midpoint and splits only the selected face', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const vertex = boundary[0];
  const edgeA = boundary[1], edgeB = boundary[2];
  const edge = input.polygonEdges.findIndex(([a, b]) =>
    (a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)
  );
  expect(edge).toBeGreaterThanOrEqual(0);

  const result = cutLogicalFaceToEdge(box, { face, vertex, edge, t: 0.5 }, input.polygonTriangles);
  expect(JSON.stringify(box.toJSON())).toBe(before);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(7);
  expect(output.logicalVertices).toHaveLength(9);
  expect(output.polygonEdges).toHaveLength(14);
  expect(output.faces).toHaveLength(14);

  const midpoint = point(box, input, edgeA).add(point(box, input, edgeB)).multiplyScalar(0.5);
  const inserted = output.logicalVertices.find(candidate => point(result.geometry, output, candidate).distanceToSquared(midpoint) < 1e-12);
  expect(inserted).toBeDefined();
  expect(output.polygons.filter(polygon => polygon.includes(inserted!))).toHaveLength(3);
  expect(output.polygons.some(polygon => polygon.includes(vertex) && polygon.includes(inserted!))).toBe(true);
  expect(new Set(output.polygons.flat()).size).toBe(output.logicalVertices.length);
});

test('edge endpoint cut remaps the start vertex after retessellation on every Cube face', () => {
  for (let face = 0; face < 6; face++) {
    const box = new THREE.BoxGeometry(2, 2, 2);
    const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
    const boundary = input.polygons[face];
    const vertex = boundary[0];
    const edgeA = boundary[1], edgeB = boundary[2];
    const edge = input.polygonEdges.findIndex(([a, b]) =>
      (a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)
    );
    expect(edge).toBeGreaterThanOrEqual(0);

    const result = cutLogicalFaceToEdge(box, { face, vertex, edge, t: 0.35 }, input.polygonTriangles);
    const output = buildTopology(
      result.geometry.getAttribute('position').array,
      result.geometry.index?.array,
      result.polygonTriangles,
    );
    expect(output.polygons).toHaveLength(7);
    expect(output.logicalVertices).toHaveLength(9);
    expect(output.polygons.some(polygon => polygon.length === 3)).toBe(true);
    result.geometry.dispose();
    box.dispose();
  }
});

test('edge-to-edge Knife inserts two logical edge points and splits one face', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const before = JSON.stringify(plane.toJSON());
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const findEdge = (a: number, b: number) => input.polygonEdges.findIndex(([x, y]) =>
    (x === a && y === b) || (x === b && y === a)
  );
  const firstEdge = findEdge(boundary[0], boundary[1]);
  const secondEdge = findEdge(boundary[2], boundary[3]);
  expect(firstEdge).toBeGreaterThanOrEqual(0);
  expect(secondEdge).toBeGreaterThanOrEqual(0);

  const firstExpected = point(plane, input, input.polygonEdges[firstEdge][0])
    .lerp(point(plane, input, input.polygonEdges[firstEdge][1]), 0.25);
  const secondExpected = point(plane, input, input.polygonEdges[secondEdge][0])
    .lerp(point(plane, input, input.polygonEdges[secondEdge][1]), 0.7);

  const result = cutLogicalFaceBetweenEdges(plane, {
    face,
    firstEdge,
    firstT: 0.25,
    secondEdge,
    secondT: 0.7,
  }, input.polygonTriangles);
  expect(JSON.stringify(plane.toJSON())).toBe(before);

  const output = buildTopology(
    result.geometry.getAttribute('position').array,
    result.geometry.index?.array,
    result.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(6);
  expect(output.polygonEdges).toHaveLength(7);
  expect(output.logicalVertices.some(vertex => point(result.geometry, output, vertex).distanceToSquared(firstExpected) < 1e-12)).toBe(true);
  expect(output.logicalVertices.some(vertex => point(result.geometry, output, vertex).distanceToSquared(secondExpected) < 1e-12)).toBe(true);
  expect(output.polygons.every(polygon => polygon.length >= 3)).toBe(true);

  result.geometry.dispose();
  plane.dispose();
});

test('edge endpoint cut interpolates per-corner UV and color attributes at arbitrary t', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const position = plane.getAttribute('position');
  const colors: number[] = [];
  for (let raw = 0; raw < position.count; raw++) {
    colors.push(raw / Math.max(1, position.count - 1), 0.25, 1 - raw / Math.max(1, position.count - 1));
  }
  plane.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const input = buildTopology(position.array, plane.index?.array, true);
  const boundary = input.polygons[0];
  const vertex = boundary[0];
  const edgeA = boundary[1], edgeB = boundary[2];
  const edge = input.polygonEdges.findIndex(([a, b]) =>
    (a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)
  );
  const t = 0.25;

  const result = cutLogicalFaceToEdge(plane, { face: 0, vertex, edge, t }, input.polygonTriangles);
  const output = buildTopology(result.geometry.getAttribute('position').array, result.geometry.index?.array, result.polygonTriangles);
  expect(output.polygons).toHaveLength(2);
  expect(output.logicalVertices).toHaveLength(5);

  const expected = point(plane, input, edgeA).lerp(point(plane, input, edgeB), t);
  const inserted = output.logicalVertices.find(candidate => point(result.geometry, output, candidate).distanceToSquared(expected) < 1e-12);
  expect(inserted).toBeDefined();

  const resultUv = result.geometry.getAttribute('uv');
  const resultColor = result.geometry.getAttribute('color');
  const rawCopies = output.vertices[inserted!];
  expect(rawCopies.length).toBeGreaterThan(0);
  for (const raw of rawCopies) {
    expect(Number.isFinite(resultUv.getX(raw))).toBe(true);
    expect(Number.isFinite(resultUv.getY(raw))).toBe(true);
    expect(Number.isFinite(resultColor.getX(raw))).toBe(true);
    expect(Number.isFinite(resultColor.getY(raw))).toBe(true);
    expect(Number.isFinite(resultColor.getZ(raw))).toBe(true);
  }
});

test('edge endpoint cut rejects endpoints and edges outside the selected face', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const boundary = input.polygons[0];
  const incident = input.polygonEdges.findIndex(([a, b]) => a === boundary[0] || b === boundary[0]);
  expect(() => cutLogicalFaceToEdge(box, { face: 0, vertex: boundary[0], edge: incident, t: 0.5 }, input.polygonTriangles)).toThrow(/cannot be an endpoint/);

  const outside = input.polygonEdges.findIndex(([a, b]) => !boundary.includes(a) && !boundary.includes(b));
  expect(outside).toBeGreaterThanOrEqual(0);
  expect(() => cutLogicalFaceToEdge(box, { face: 0, vertex: boundary[0], edge: outside, t: 0.5 }, input.polygonTriangles)).toThrow(/must bound/);
  expect(() => cutLogicalFaceToEdge(box, { face: 0, vertex: boundary[0], edge: outside, t: 0 }, input.polygonTriangles)).toThrow(/strictly inside/);
});


test('viewport Knife cuts from one selected logical vertex to a clicked point on an existing logical edge', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.view('front');
  });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const vertex = boundary[0];
    const wanted = new Set([boundary[1], boundary[2]]);
    const edge = topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 && wanted.has(candidate[0]) && wanted.has(candidate[1])
    );
    if (edge < 0) throw new Error('Expected an opposite logical edge.');
    e.selectComponent(vertex);

    const [edgeA, edgeB] = topology.polygonEdges[edge];
    const a = mesh.position.clone().fromBufferAttribute(position, topology.vertices[edgeA][0]);
    const b = mesh.position.clone().fromBufferAttribute(position, topology.vertices[edgeB][0]);
    const local = a.clone().lerp(b, 0.35);
    mesh.updateWorldMatrix(true, true);
    e.camera.updateMatrixWorld(true);
    const projected = mesh.localToWorld(local.clone()).project(e.camera);
    const rect = e.host.getBoundingClientRect();
    return {
      before: e.snapshot(),
      local: local.toArray(),
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  });

  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({
    pending: (window as any).__forge.snapTargetPending,
    kind: (window as any).__forge.snapTargetKind,
    guides: (window as any).__forge.componentEdges.visible,
  }))).toEqual({ pending: true, kind: 'knife', guides: true });

  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(false);

  const result = await page.evaluate(expected => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const found = topology.logicalVertices.some((vertex: number) => {
      const raw = topology.vertices[vertex][0];
      return Math.hypot(
        position.getX(raw) - expected[0],
        position.getY(raw) - expected[1],
        position.getZ(raw) - expected[2],
      ) < 1e-5;
    });
    const after = e.snapshot();
    e.undo();
    return {
      polygons: topology.polygons.length,
      logicalVertices: topology.logicalVertices.length,
      found,
      after,
      undone: e.snapshot(),
    };
  }, target.local);

  expect(result.polygons).toBe(7);
  expect(result.logicalVertices).toBe(9);
  expect(result.found).toBe(true);
  expect(result.after).not.toBe(target.before);
  expect(result.undone).toBe(target.before);
});


test('viewport Knife cuts edge-to-edge with two clicks when no start vertex is selected', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const edgeId = (a: number, b: number) => topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 && ((candidate[0] === a && candidate[1] === b) || (candidate[0] === b && candidate[1] === a))
    );
    const firstEdge = edgeId(boundary[0], boundary[1]);
    const secondEdge = edgeId(boundary[2], boundary[3]);
    if (firstEdge < 0 || secondEdge < 0) throw new Error('Expected opposite logical edges.');

    const screenPoint = (edge: number, t: number) => {
      const [aVertex, bVertex] = topology.polygonEdges[edge];
      const a = mesh.position.clone().fromBufferAttribute(position, topology.vertices[aVertex][0]);
      const b = mesh.position.clone().fromBufferAttribute(position, topology.vertices[bVertex][0]);
      const local = a.clone().lerp(b, t);
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(local.clone()).project(e.camera);
      const rect = e.host.getBoundingClientRect();
      return {
        local: local.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };

    return {
      before: e.snapshot(),
      first: screenPoint(firstEdge, 0.3),
      second: screenPoint(secondEdge, 0.65),
      selected: e.componentSelection,
    };
  });
  expect(target.selected).toEqual([]);

  await page.keyboard.press('k');
  expect(await page.evaluate(() => ({
    pending: (window as any).__forge.snapTargetPending,
    kind: (window as any).__forge.snapTargetKind,
  }))).toEqual({ pending: true, kind: 'knife' });

  await page.mouse.click(target.first.x, target.first.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(true);

  await page.mouse.click(target.second.x, target.second.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(false);

  const result = await page.evaluate(expected => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const contains = (point: number[]) => topology.logicalVertices.some((vertex: number) => {
      const raw = topology.vertices[vertex][0];
      return Math.hypot(
        position.getX(raw) - point[0],
        position.getY(raw) - point[1],
        position.getZ(raw) - point[2],
      ) < 1e-5;
    });
    const after = e.snapshot();
    e.undo();
    return {
      polygons: topology.polygons.length,
      logicalVertices: topology.logicalVertices.length,
      firstFound: contains(expected.first),
      secondFound: contains(expected.second),
      after,
      undone: e.snapshot(),
    };
  }, { first: target.first.local, second: target.second.local });

  expect(result.polygons).toBe(7);
  expect(result.logicalVertices).toBe(10);
  expect(result.firstFound).toBe(true);
  expect(result.secondFound).toBe(true);
  expect(result.after).not.toBe(target.before);
  expect(result.undone).toBe(target.before);
});


test('Knife snaps directly to a logical vertex and continues cutting without pressing K again', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const edgeId = (a: number, b: number) => topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 && ((candidate[0] === a && candidate[1] === b) || (candidate[0] === b && candidate[1] === a))
    );
    const firstEdge = edgeId(boundary[1], boundary[2]);
    const secondEdge = edgeId(boundary[2], boundary[3]);
    if (firstEdge < 0 || secondEdge < 0) throw new Error('Expected two logical target edges.');

    const rect = e.host.getBoundingClientRect();
    const screenLocal = (local: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(local.clone()).project(e.camera);
      return {
        local: local.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    const vertexPoint = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const edgePoint = (edge: number, t: number) => {
      const [aVertex, bVertex] = topology.polygonEdges[edge];
      return vertexPoint(aVertex).lerp(vertexPoint(bVertex), t);
    };

    return {
      before: e.snapshot(),
      start: screenLocal(vertexPoint(boundary[0])),
      first: screenLocal(edgePoint(firstEdge, 0.35)),
      second: screenLocal(edgePoint(secondEdge, 0.55)),
    };
  });

  expect(await page.evaluate(() => (window as any).__forgeModelingSettings.knifeSnap)).toBe('vertex-edge');
  await page.keyboard.press('k');
  await page.mouse.click(target.start.x, target.start.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(true);
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  await page.mouse.click(target.first.x, target.first.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');

  const afterFirst = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      snapshot: e.snapshot(),
      polygons: e.meshTopology.polygons.length,
      logicalVertices: e.meshTopology.logicalVertices.length,
    };
  });
  expect(afterFirst.polygons).toBe(7);
  expect(afterFirst.logicalVertices).toBe(9);

  // No second K: the first cut endpoint is automatically the next start point.
  await page.mouse.click(target.second.x, target.second.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');

  const result = await page.evaluate(expected => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const contains = (point: number[]) => topology.logicalVertices.some((vertex: number) => {
      const raw = topology.vertices[vertex][0];
      return Math.hypot(
        position.getX(raw) - point[0],
        position.getY(raw) - point[1],
        position.getZ(raw) - point[2],
      ) < 1e-5;
    });
    return {
      snapshot: e.snapshot(),
      polygons: topology.polygons.length,
      logicalVertices: topology.logicalVertices.length,
      firstFound: contains(expected.first),
      secondFound: contains(expected.second),
      pending: e.snapTargetPending,
    };
  }, { first: target.first.local, second: target.second.local });

  expect(result.polygons).toBe(8);
  expect(result.logicalVertices).toBe(10);
  expect(result.firstFound).toBe(true);
  expect(result.secondFound).toBe(true);
  expect(result.pending).toBe(true);

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__forge.snapTargetPending)).toBe(false);

  const undo = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.undo();
    const afterOneUndo = e.snapshot();
    e.undo();
    return { afterOneUndo, afterTwoUndo: e.snapshot() };
  });
  expect(undo.afterOneUndo).toBe(afterFirst.snapshot);
  expect(undo.afterTwoUndo).toBe(target.before);
});


test('Knife hover preview follows the edge, snaps to logical vertices, and shows the pending segment before click', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const edge = topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 &&
      ((candidate[0] === boundary[1] && candidate[1] === boundary[2]) ||
       (candidate[0] === boundary[2] && candidate[1] === boundary[1]))
    );
    if (edge < 0) throw new Error('Expected a logical preview edge.');

    const rect = e.host.getBoundingClientRect();
    const vertexPoint = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const screenLocal = (local: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(local.clone()).project(e.camera);
      return {
        local: local.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    const [edgeA, edgeB] = topology.polygonEdges[edge];
    return {
      before: e.snapshot(),
      startVertex: screenLocal(vertexPoint(boundary[0])),
      snapVertex: screenLocal(vertexPoint(boundary[1])),
      edgePoint: screenLocal(vertexPoint(edgeA).lerp(vertexPoint(edgeB), 0.42)),
    };
  });

  await page.keyboard.press('k');

  // Before the start click, hovering an edge shows the exact candidate point.
  await page.mouse.move(target.edgePoint.x, target.edgePoint.y);
  let preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.pointVisible).toBe(true);
  expect(preview.lineVisible).toBe(false);
  expect(preview.target.kind).toBe('edge');
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.edgePoint.local[index], 5));

  // Moving onto a logical vertex must stop/snap the preview exactly at that vertex.
  await page.mouse.move(target.snapVertex.x, target.snapVertex.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.pointVisible).toBe(true);
  expect(preview.lineVisible).toBe(false);
  expect(preview.target.kind).toBe('vertex');
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.snapVertex.local[index], 5));
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  // Pick a start vertex, then hover the destination: the uncommitted segment is visible.
  await page.mouse.click(target.startVertex.x, target.startVertex.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');
  await page.mouse.move(target.edgePoint.x, target.edgePoint.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.pointVisible).toBe(true);
  expect(preview.lineVisible).toBe(true);
  expect(preview.target.kind).toBe('edge');
  preview.anchor.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.startVertex.local[index], 5));
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.edgePoint.local[index], 5));
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  await page.keyboard.press('Escape');
  const ended = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(ended.pointVisible).toBe(false);
  expect(ended.lineVisible).toBe(false);
  expect(ended.anchor).toBeNull();
  expect(ended.target).toBeNull();
});


test('Knife preview marks invalid endpoints before click and uses the same validity for commit', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const edgeId = (a: number, b: number) => topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 && ((candidate[0] === a && candidate[1] === b) || (candidate[0] === b && candidate[1] === a))
    );
    const invalidEdge = edgeId(boundary[0], boundary[1]);
    const validEdge = edgeId(boundary[1], boundary[2]);
    if (invalidEdge < 0 || validEdge < 0) throw new Error('Expected logical target edges.');

    const rect = e.host.getBoundingClientRect();
    const vertexPoint = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const screenLocal = (local: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(local.clone()).project(e.camera);
      return {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    const edgePoint = (edge: number, t: number) => {
      const [aVertex, bVertex] = topology.polygonEdges[edge];
      return vertexPoint(aVertex).lerp(vertexPoint(bVertex), t);
    };

    return {
      before: e.snapshot(),
      start: screenLocal(vertexPoint(boundary[0])),
      invalid: screenLocal(edgePoint(invalidEdge, 0.5)),
      valid: screenLocal(edgePoint(validEdge, 0.5)),
    };
  });

  await page.keyboard.press('k');
  await page.mouse.click(target.start.x, target.start.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');

  await page.mouse.move(target.invalid.x, target.invalid.y);
  let preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.lineVisible).toBe(true);
  expect(preview.validity).toBe('invalid');

  await page.mouse.click(target.invalid.x, target.invalid.y);
  await expect(page.locator('#toast')).toContainText('Choose a non-incident edge');
  expect(await page.evaluate(() => ({
    snapshot: (window as any).__forge.snapshot(),
    pending: (window as any).__forge.snapTargetPending,
  }))).toEqual({ snapshot: target.before, pending: true });

  await page.mouse.move(target.valid.x, target.valid.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.lineVisible).toBe(true);
  expect(preview.validity).toBe('valid');

  await page.mouse.click(target.valid.x, target.valid.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).not.toBe(target.before);

  await page.keyboard.press('Escape');
});


test('Knife vertex snap stays locked until the cursor leaves the larger release radius', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');

    const boundary = topology.polygons[face];
    const aVertex = boundary[0];
    const bVertex = boundary[1];
    const a = mesh.position.clone().fromBufferAttribute(position, topology.vertices[aVertex][0]);
    const b = mesh.position.clone().fromBufferAttribute(position, topology.vertices[bVertex][0]);
    mesh.updateWorldMatrix(true, true);
    e.camera.updateMatrixWorld(true);
    const worldA = mesh.localToWorld(a.clone());
    const worldB = mesh.localToWorld(b.clone());
    const edgeLength = worldA.distanceTo(worldB);
    const threshold = e.camera.position.distanceTo(e.orbit.target) * 0.012;

    const nearT = Math.min(0.35, Math.max(0.02, threshold * 1.4 / edgeLength));
    const farT = Math.min(0.45, Math.max(nearT + 0.06, threshold * 2.6 / edgeLength));
    if (!(nearT < farT && farT < 0.5)) throw new Error('Expected usable hysteresis test points.');

    const rect = e.host.getBoundingClientRect();
    const screenLocal = (local: any) => {
      const projected = mesh.localToWorld(local.clone()).project(e.camera);
      return {
        local: local.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };

    return {
      vertex: screenLocal(a),
      near: screenLocal(a.clone().lerp(b, nearT)),
      far: screenLocal(a.clone().lerp(b, farT)),
    };
  });

  await page.keyboard.press('k');

  await page.mouse.move(target.vertex.x, target.vertex.y);
  let preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.target.kind).toBe('vertex');
  expect(preview.lockedVertex).not.toBeNull();

  // This point is outside the normal acquire radius but inside the 2x release
  // radius, so the Knife preview should stay pinned to the same logical vertex.
  await page.mouse.move(target.near.x, target.near.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.target.kind).toBe('vertex');
  expect(preview.lockedVertex).not.toBeNull();
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.vertex.local[index], 5));

  // Moving clearly beyond the release radius unlocks and resumes edge tracking.
  await page.mouse.move(target.far.x, target.far.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.target.kind).toBe('edge');
  expect(preview.lockedVertex).toBeNull();
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.far.local[index], 4));

  await page.keyboard.press('Escape');
});


test('Edge-only Knife does not proximity-snap near vertices but accepts an intentional vertex click', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    (window as any).__forgeModelingSettings.knifeSnap = 'edge-only';
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const edge = topology.polygonEdges.findIndex((candidate: number[]) =>
      candidate.length === 2 &&
      ((candidate[0] === boundary[0] && candidate[1] === boundary[1]) ||
       (candidate[0] === boundary[1] && candidate[1] === boundary[0]))
    );
    if (edge < 0) throw new Error('Expected a logical edge.');

    const rect = e.host.getBoundingClientRect();
    const local = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const screen = (point: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(point.clone()).project(e.camera);
      return {
        local: point.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    const [aVertex, bVertex] = topology.polygonEdges[edge];
    const a = local(aVertex), b = local(bVertex);
    const worldA = mesh.localToWorld(a.clone());
    const worldB = mesh.localToWorld(b.clone());
    const threshold = e.camera.position.distanceTo(e.orbit.target) * 0.012;
    const edgeLength = worldA.distanceTo(worldB);
    const nearT = Math.min(0.08, Math.max(0.015, threshold * 0.45 / edgeLength));

    return {
      before: e.snapshot(),
      endpoint: screen(a),
      near: screen(a.clone().lerp(b, nearT)),
      interior: screen(a.clone().lerp(b, 0.25)),
    };
  });

  await page.keyboard.press('k');

  // Even inside the normal Vertex + Edge acquire radius, Edge only must keep
  // following the edge instead of snapping/sticking to the logical vertex.
  await page.mouse.move(target.near.x, target.near.y);
  let preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.pointVisible).toBe(true);
  expect(preview.target.kind).toBe('edge');
  expect(preview.target.t).toBeGreaterThan(0);
  expect(preview.lockedVertex).toBeNull();
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.near.local[index], 4));

  // An intentional click directly on the visible logical point is still
  // accepted as a vertex start; this is a click hit, not proximity snapping.
  await page.mouse.click(target.endpoint.x, target.endpoint.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');
  expect(await page.evaluate(() => ({
    snapshot: (window as any).__forge.snapshot(),
    pending: (window as any).__forge.snapTargetPending,
    anchor: (window as any).__forge.knifePreviewState.anchor,
  }))).toEqual({
    snapshot: target.before,
    pending: true,
    anchor: target.endpoint.local,
  });

  // Edge-only hover continues tracking interior edge positions after that click.
  await page.mouse.move(target.interior.x, target.interior.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.pointVisible).toBe(true);
  expect(preview.target.kind).toBe('edge');
  expect(preview.target.t).toBeGreaterThan(0);
  expect(preview.target.t).toBeLessThan(1);
  expect(preview.lockedVertex).toBeNull();
  preview.point.forEach((value: number, index: number) => expect(value).toBeCloseTo(target.interior.local[index], 4));

  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__forgeModelingSettings.knifeSnap = 'vertex-edge'; });
});


test('viewport Knife keeps a face bend pending until a same-face boundary endpoint completes it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');

    const boundary = topology.polygons[face];
    const local = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const boundaryPoints = boundary.map(local);
    const center = boundaryPoints
      .reduce((sum: any, value: any) => sum.add(value), mesh.position.clone().set(0, 0, 0))
      .multiplyScalar(1 / boundaryPoints.length);
    const interior = center.clone().lerp(boundaryPoints[1], 0.2);

    const rect = e.host.getBoundingClientRect();
    const screen = (point: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(point.clone()).project(e.camera);
      return {
        local: point.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };

    return {
      before: e.snapshot(),
      face,
      start: screen(boundaryPoints[0]),
      interior: screen(interior),
      end: screen(boundaryPoints[2]),
    };
  });

  await page.keyboard.press('k');
  await page.mouse.click(target.start.x, target.start.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');

  await page.mouse.move(target.interior.x, target.interior.y);
  let preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.target.kind).toBe('face');
  expect(preview.target.face).toBe(target.face);
  expect(preview.validity).toBe('valid');

  await page.mouse.click(target.interior.x, target.interior.y);
  await expect(page.locator('#toast')).toContainText('Knife bend point set');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.anchor).not.toBeNull();
  preview.anchor.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.interior.local[index], 4)
  );
  expect(preview.pendingPointVisible).toBe(true);
  expect(preview.pendingLineVisible).toBe(true);
  preview.pendingStart.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.start.local[index], 4)
  );
  preview.pendingBend.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.interior.local[index], 4)
  );

  await page.mouse.move(target.end.x, target.end.y);
  preview = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(preview.target.kind).toBe('vertex');
  expect(preview.validity).toBe('valid');

  await page.mouse.click(target.end.x, target.end.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');

  const result = await page.evaluate(expected => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const findVertex = (point: number[]) => topology.logicalVertices.find((vertex: number) => {
      const raw = topology.vertices[vertex][0];
      return Math.hypot(
        position.getX(raw) - point[0],
        position.getY(raw) - point[1],
        position.getZ(raw) - point[2],
      ) < 1e-5;
    });
    const interiorVertex = findVertex(expected.interior);
    const endVertex = findVertex(expected.end);
    return {
      snapshot: e.snapshot(),
      polygons: topology.polygons.length,
      logicalVertices: topology.logicalVertices.length,
      polygonEdges: topology.polygonEdges.length,
      interiorFound: interiorVertex !== undefined,
      interiorUses: interiorVertex === undefined
        ? 0
        : topology.polygons.filter((polygon: number[]) => polygon.includes(interiorVertex)).length,
      endFound: endVertex !== undefined,
      pending: e.snapTargetPending,
      anchor: e.knifePreviewState.anchor,
      pendingPointVisible: e.knifePreviewState.pendingPointVisible,
      pendingLineVisible: e.knifePreviewState.pendingLineVisible,
    };
  }, { interior: target.interior.local, end: target.end.local });

  expect(result.snapshot).not.toBe(target.before);
  expect(result.polygons).toBe(7);
  expect(result.logicalVertices).toBe(9);
  expect(result.polygonEdges).toBe(14);
  expect(result.interiorFound).toBe(true);
  expect(result.interiorUses).toBe(2);
  expect(result.endFound).toBe(true);
  expect(result.pending).toBe(true);
  expect(result.pendingPointVisible).toBe(false);
  expect(result.pendingLineVisible).toBe(false);
  result.anchor.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.end.local[index], 4)
  );

  await page.keyboard.press('Escape');
});


test('viewport Knife keeps multiple interior bends pending and commits the full polyline at the boundary', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.view('front'));
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');

  const target = await page.evaluate(() => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const mesh = e.selected;
    const position = mesh.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a front logical quad.');
    const boundary = topology.polygons[face];
    const local = (vertex: number) =>
      mesh.position.clone().fromBufferAttribute(position, topology.vertices[vertex][0]);
    const startLocal = local(boundary[0]);
    const endLocal = local(boundary[2]);
    const bend1 = startLocal.clone().lerp(endLocal, 0.35).add(mesh.position.clone().set(0.15, -0.1, 0));
    const bend2 = startLocal.clone().lerp(endLocal, 0.65).add(mesh.position.clone().set(-0.1, 0.15, 0));

    const rect = e.host.getBoundingClientRect();
    const screen = (point: any) => {
      mesh.updateWorldMatrix(true, true);
      e.camera.updateMatrixWorld(true);
      const projected = mesh.localToWorld(point.clone()).project(e.camera);
      return {
        local: point.toArray(),
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    return {
      before: e.snapshot(),
      start: screen(startLocal),
      bend1: screen(bend1),
      bend2: screen(bend2),
      end: screen(endLocal),
    };
  });

  await page.keyboard.press('k');
  await page.mouse.click(target.start.x, target.start.y);
  await expect(page.locator('#toast')).toContainText('Knife start set');

  await page.mouse.click(target.bend1.x, target.bend1.y);
  await expect(page.locator('#toast')).toContainText('Knife bend point added');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  await page.mouse.click(target.bend2.x, target.bend2.y);
  await expect(page.locator('#toast')).toContainText('Knife bend point added');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(target.before);

  const pending = await page.evaluate(() => (window as any).__forge.knifePreviewState);
  expect(pending.pendingPointVisible).toBe(true);
  expect(pending.pendingLineVisible).toBe(true);
  expect(pending.pendingPath).toHaveLength(3);
  for (const [actual, expected] of [
    [pending.pendingPath[0], target.start.local],
    [pending.pendingPath[1], target.bend1.local],
    [pending.pendingPath[2], target.bend2.local],
  ]) {
    actual.forEach((value: number, index: number) => expect(value).toBeCloseTo(expected[index], 4));
  }
  pending.anchor.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.bend2.local[index], 4)
  );

  await page.mouse.move(target.end.x, target.end.y);
  expect((await page.evaluate(() => (window as any).__forge.knifePreviewState)).validity).toBe('valid');

  await page.mouse.click(target.end.x, target.end.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && (window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife segment complete');

  const result = await page.evaluate(expected => {
    const e = (window as any).__forge;
    const topology = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const findVertex = (point: number[]) => topology.logicalVertices.find((vertex: number) => {
      const raw = topology.vertices[vertex][0];
      return Math.hypot(
        position.getX(raw) - point[0],
        position.getY(raw) - point[1],
        position.getZ(raw) - point[2],
      ) < 1e-5;
    });
    const first = findVertex(expected.bend1);
    const second = findVertex(expected.bend2);
    return {
      snapshot: e.snapshot(),
      polygons: topology.polygons.length,
      logicalVertices: topology.logicalVertices.length,
      polygonEdges: topology.polygonEdges.length,
      firstFound: first !== undefined,
      secondFound: second !== undefined,
      firstUses: first === undefined ? 0 : topology.polygons.filter((polygon: number[]) => polygon.includes(first)).length,
      secondUses: second === undefined ? 0 : topology.polygons.filter((polygon: number[]) => polygon.includes(second)).length,
      pendingPath: e.knifePreviewState.pendingPath,
      pendingPointVisible: e.knifePreviewState.pendingPointVisible,
      pendingLineVisible: e.knifePreviewState.pendingLineVisible,
      pending: e.snapTargetPending,
      anchor: e.knifePreviewState.anchor,
    };
  }, { bend1: target.bend1.local, bend2: target.bend2.local });

  expect(result.snapshot).not.toBe(target.before);
  expect(result.polygons).toBe(7);
  expect(result.logicalVertices).toBe(10);
  expect(result.polygonEdges).toBe(15);
  expect(result.firstFound).toBe(true);
  expect(result.secondFound).toBe(true);
  expect(result.firstUses).toBe(2);
  expect(result.secondUses).toBe(2);
  expect(result.pendingPath).toEqual([]);
  expect(result.pendingPointVisible).toBe(false);
  expect(result.pendingLineVisible).toBe(false);
  expect(result.pending).toBe(true);
  result.anchor.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(target.end.local[index], 4)
  );

  await page.keyboard.press('Escape');
});
