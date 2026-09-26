import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { cutLogicalFaceToEdge } from '../src/modeling/cut-edge-endpoint';
import { buildTopology } from '../src/modeling/topology';

function point(geometry: THREE.BufferGeometry, topology: ReturnType<typeof buildTopology>, vertex: number) {
  const position = geometry.getAttribute('position');
  const raw = topology.vertices[vertex][0];
  return new THREE.Vector3(position.getX(raw), position.getY(raw), position.getZ(raw));
}

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
  }))).toEqual({ pending: true, kind: 'knife-edge', guides: true });

  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy && !(window as any).__forge.snapTargetPending);
  await expect(page.locator('#toast')).toContainText('Knife cut complete');

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
