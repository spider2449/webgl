import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { bevelLogicalEdges } from '../src/modeling/modeling';
import { buildTopology } from '../src/modeling/topology';

function logicalTopology(geometry: THREE.BufferGeometry, groups: number[][]) {
  const ids = geometry.userData.forgeLogicalVertexIds;
  return buildTopology(
    geometry.getAttribute('position').array,
    geometry.index?.array,
    groups,
    Array.isArray(ids) ? ids : undefined,
  );
}

function expectClosedLogical(topology: ReturnType<typeof buildTopology>) {
  const uses = new Map<string, Array<[number, number]>>();
  for (const polygon of topology.polygons) {
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = uses.get(key) ?? [];
      list.push([a, b]);
      uses.set(key, list);
    }
  }
  for (const list of uses.values()) {
    expect(list).toHaveLength(2);
    expect(list[0][0]).toBe(list[1][1]);
    expect(list[0][1]).toBe(list[1][0]);
  }
}

test('three-segment logical Cube edge bevel creates three real profile faces', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(
    box.getAttribute('position').array,
    box.index?.array,
    true,
  );
  const edge = 0;

  const implicitOne = bevelLogicalEdges(
    box,
    [edge],
    0.2,
    input.polygonTriangles,
  );
  const explicitOne = bevelLogicalEdges(
    box,
    [edge],
    0.2,
    input.polygonTriangles,
    1,
  );
  expect(explicitOne.polygonTriangles).toEqual(implicitOne.polygonTriangles);
  expect(Array.from(explicitOne.geometry.getAttribute('position').array))
    .toEqual(Array.from(implicitOne.geometry.getAttribute('position').array));

  const bevel = bevelLogicalEdges(
    box,
    [edge],
    0.2,
    input.polygonTriangles,
    3,
  );
  const output = logicalTopology(bevel.geometry, bevel.polygonTriangles);

  expect(output.logicalVertices).toHaveLength(14);
  expect(output.polygonEdges).toHaveLength(21);
  expect(output.polygons).toHaveLength(9);
  expect(output.polygonTriangles.flat()).toHaveLength(24);
  expect(output.polygons.map(polygon => polygon.length).sort((a, b) => a - b))
    .toEqual([4, 4, 4, 4, 4, 4, 4, 7, 7]);
  expect(new Set(output.polygons.flat()).size).toBe(output.logicalVertices.length);
  expectClosedLogical(output);

  const ids = bevel.geometry.userData.forgeLogicalVertexIds;
  expect(Array.isArray(ids)).toBe(true);
  expect(ids).toHaveLength(bevel.geometry.getAttribute('position').count);

  bevel.geometry.dispose();
  explicitOne.geometry.dispose();
  implicitOne.geometry.dispose();
  box.dispose();
});

test('multi-segment bevel keeps a four-edge Cube corner loop closed at junctions', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(
    box.getAttribute('position').array,
    box.index?.array,
    true,
  );
  const position = box.getAttribute('position');
  const topEdges = input.polygonEdges
    .map((edge, id) => ({ edge, id }))
    .filter(({ edge: [a, b] }) =>
      position.getY(input.vertices[a][0]) === 1 &&
      position.getY(input.vertices[b][0]) === 1
    )
    .map(({ id }) => id);
  expect(topEdges).toHaveLength(4);

  const bevel = bevelLogicalEdges(
    box,
    topEdges,
    0.15,
    input.polygonTriangles,
    3,
  );
  const output = logicalTopology(bevel.geometry, bevel.polygonTriangles);

  expect(output.polygons).toHaveLength(input.polygons.length + topEdges.length * 3);
  expect(output.polygonTriangles.length).toBe(output.polygons.length);
  expect(output.logicalVertices.length).toBeGreaterThan(input.logicalVertices.length);
  expect(output.polygonEdges.length).toBeGreaterThan(input.polygonEdges.length);
  expect(new Set(output.polygons.flat()).size).toBe(output.logicalVertices.length);
  expectClosedLogical(output);

  expect(bevel.geometry.userData.forgeLogicalVertexIds)
    .toHaveLength(bevel.geometry.getAttribute('position').count);

  bevel.geometry.dispose();
  box.dispose();
});

test('multi-segment bevel validates segment count and bounded clipping work', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(
    box.getAttribute('position').array,
    box.index?.array,
    true,
  );

  for (const segments of [0, 1.5, 17]) {
    expect(() => bevelLogicalEdges(
      box,
      [0],
      0.1,
      input.polygonTriangles,
      segments,
    )).toThrow('integer between 1 and 16');
  }

  const dense = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4);
  const denseTopology = buildTopology(
    dense.getAttribute('position').array,
    dense.index?.array,
    true,
  );
  expect(denseTopology.polygonEdges.length).toBeGreaterThanOrEqual(33);
  expect(() => bevelLogicalEdges(
    dense,
    denseTopology.polygonEdges.map((_, edge) => edge).slice(0, 33),
    0.05,
    denseTopology.polygonTriangles,
    16,
  )).toThrow('512-plane work budget');

  dense.dispose();
  box.dispose();
});

test('RMB three-segment Bevel runs through the worker and Undo restores the Cube', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');

  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__forgeModelingSettings.bevelWidth = 0.2;
    (window as any).__forgeModelingSettings.bevelSegments = 3;
    return {
      undoDepth: e.undoDepth,
      snapshot: e.snapshot(),
    };
  });

  const canvas = page.locator('#viewport canvas');
  await canvas.click({ button: 'right', position: { x: 320, y: 220 } });
  const menu = page.locator('#viewport-context-menu');
  await expect(menu.getByLabel('Context bevel width', { exact: true })).toHaveValue('0.2');
  await expect(menu.getByLabel('Context bevel segments', { exact: true })).toHaveValue('3');
  await menu.getByRole('menuitem', { name: 'Bevel Edges', exact: true }).click();

  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Bevel complete · 3 segments');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      identityCount: e.selected.userData.forgeLogicalVertexIds?.length,
      positionCount: e.selected.geometry.getAttribute('position').count,
      primitive: e.selected.userData.forgePrimitive,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    vertices: 14,
    edges: 21,
    faces: 9,
    triangles: 24,
    stored: 9,
    identityCount: expect.any(Number),
    positionCount: expect.any(Number),
    primitive: undefined,
    undoDepth: before.undoDepth + 1,
  });

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.forgeLogicalVertexIds.length ===
      e.selected.geometry.getAttribute('position').count;
  })).toBe(true);

  await page.keyboard.press('Control+z');
  await page.waitForFunction((snapshot: string) =>
    (window as any).__forge.snapshot() === snapshot,
  before.snapshot);
});

