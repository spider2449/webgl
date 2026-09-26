import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { cutLogicalFaceBetweenEdges, cutLogicalFaceToEdge } from '../src/modeling/cut-edge-endpoint';
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
