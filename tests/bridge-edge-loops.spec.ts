import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import {
  bridgeLogicalBoundaryLoops,
  deleteLogicalComponents,
} from '../src/modeling/modeling';
import {
  buildTopology,
  logicalMeshBoundaryEdges,
} from '../src/modeling/topology';

function logicalTopology(geometry: THREE.BufferGeometry, groups: number[][] | true) {
  const ids = geometry.userData.forgeLogicalVertexIds;
  return buildTopology(
    geometry.getAttribute('position').array,
    geometry.index?.array,
    groups,
    Array.isArray(ids) ? ids : undefined,
  );
}

function polygonNormal(
  topology: ReturnType<typeof buildTopology>,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  face: number,
) {
  const vertices = topology.polygons[face];
  const normal = new THREE.Vector3();
  for (let index = 0; index < vertices.length; index++) {
    const a = new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertices[index]][0]);
    const b = new THREE.Vector3().fromBufferAttribute(position, topology.vertices[vertices[(index + 1) % vertices.length]][0]);
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  return normal.normalize();
}

function oppositeCubeFaces(geometry: THREE.BufferGeometry, topology: ReturnType<typeof buildTopology>) {
  const position = geometry.getAttribute('position');
  const normals = topology.polygons.map((_, face) => polygonNormal(topology, position, face));
  const pair = normals.flatMap((normal, face) =>
    normals.flatMap((other, candidate) =>
      candidate > face && normal.dot(other) < -0.999999
        ? [[face, candidate] as [number, number]]
        : []
    )
  )[0];
  if (!pair) throw new Error('Cube opposite face pair not found.');
  return pair;
}

test('Bridge Edge Loops reconstructs a closed logical Cube from two opposite open Quad boundaries', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = logicalTopology(box, true);
  const keep = new Set(oppositeCubeFaces(box, before));
  const remove = before.polygons.flatMap((_, face) => keep.has(face) ? [] : [face]);

  const opened = deleteLogicalComponents(
    box,
    'face',
    remove,
    before.polygonTriangles.map(group => [...group]),
  );
  const openTopology = logicalTopology(opened.geometry, opened.polygonTriangles);
  const boundary = logicalMeshBoundaryEdges(openTopology);

  expect(openTopology.logicalVertices).toHaveLength(8);
  expect(openTopology.polygonEdges).toHaveLength(8);
  expect(openTopology.polygons).toHaveLength(2);
  expect(openTopology.polygonTriangles.flat()).toHaveLength(4);
  expect(boundary).toHaveLength(8);

  const bridge = bridgeLogicalBoundaryLoops(
    opened.geometry,
    boundary,
    opened.polygonTriangles,
  );
  const after = logicalTopology(bridge.geometry, bridge.polygonTriangles);
  const position = bridge.geometry.getAttribute('position');

  expect(bridge.bridgeFaceStart).toBe(2);
  expect(bridge.bridgeFaceCount).toBe(4);
  expect(bridge.loopEdgeCount).toBe(4);
  expect(Number.isInteger(bridge.alignmentShift)).toBe(true);

  expect(after.logicalVertices).toHaveLength(8);
  expect(after.polygonEdges).toHaveLength(12);
  expect(after.polygons).toHaveLength(6);
  expect(after.polygonTriangles.flat()).toHaveLength(12);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);
  expect(logicalMeshBoundaryEdges(after)).toEqual([]);

  for (let face = bridge.bridgeFaceStart; face < bridge.bridgeFaceStart + bridge.bridgeFaceCount; face++) {
    const polygon = after.polygons[face];
    const lengths = polygon.map((vertex, index) => {
      const next = polygon[(index + 1) % polygon.length];
      const a = new THREE.Vector3().fromBufferAttribute(position, after.vertices[vertex][0]);
      const b = new THREE.Vector3().fromBufferAttribute(position, after.vertices[next][0]);
      return a.distanceTo(b);
    });
    expect(lengths.every(length => Math.abs(length - 2) < 1e-6)).toBe(true);
  }

  expect(bridge.geometry.userData.forgeLogicalVertexIds).toHaveLength(position.count);

  bridge.geometry.dispose();
  opened.geometry.dispose();
  box.dispose();
});

test('Bridge Edge Loops rejects unequal loop counts and interior logical edges atomically', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
     1, -1, 0,
     0,  1, 0,

    -1, -1, 2,
     1, -1, 2,
     1,  1, 2,
    -1,  1, 2,
  ], 3));
  geometry.setIndex([
    0, 1, 2,
    3, 4, 5,
    3, 5, 6,
  ]);
  const topology = buildTopology(
    geometry.getAttribute('position').array,
    geometry.index!.array,
    [[0], [1, 2]],
  );
  const boundary = logicalMeshBoundaryEdges(topology);
  expect(boundary).toHaveLength(7);
  expect(() => bridgeLogicalBoundaryLoops(
    geometry,
    boundary,
    topology.polygonTriangles,
  )).toThrow('same edge count');

  const box = new THREE.BoxGeometry(2, 2, 2);
  const cube = logicalTopology(box, true);
  expect(() => bridgeLogicalBoundaryLoops(
    box,
    cube.polygonEdges.map((_, edge) => edge).slice(0, 8),
    cube.polygonTriangles,
  )).toThrow('open logical mesh boundary edges');

  geometry.dispose();
  box.dispose();
});

test('RMB Bridge Edge Loops closes two Cube boundary loops and selects the new Quad strip', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.getByRole('button', { name: 'Toggle geometry statistics' }).click();
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    const position = e.selected.geometry.getAttribute('position');
    const normals = e.meshTopology.polygons.map((polygon: number[]) => {
      const normal = { x: 0, y: 0, z: 0 };
      for (let index = 0; index < polygon.length; index++) {
        const aBuffer = e.meshTopology.vertices[polygon[index]][0];
        const bBuffer = e.meshTopology.vertices[polygon[(index + 1) % polygon.length]][0];
        const a = [position.getX(aBuffer), position.getY(aBuffer), position.getZ(aBuffer)];
        const b = [position.getX(bBuffer), position.getY(bBuffer), position.getZ(bBuffer)];
        normal.x += (a[1] - b[1]) * (a[2] + b[2]);
        normal.y += (a[2] - b[2]) * (a[0] + b[0]);
        normal.z += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const length = Math.hypot(normal.x, normal.y, normal.z);
      return [normal.x / length, normal.y / length, normal.z / length];
    });
    const opposite = normals.flatMap((normal: number[], face: number) =>
      normals.flatMap((other: number[], candidate: number) =>
        candidate > face &&
        normal[0] * other[0] + normal[1] * other[1] + normal[2] * other[2] < -0.999999
          ? [[face, candidate]]
          : []
      )
    )[0];
    const keep = new Set(opposite);
    const remove = e.meshTopology.polygons.flatMap((_: number[], face: number) => keep.has(face) ? [] : [face]);
    remove.forEach((face: number, index: number) => e.selectComponent(face, index > 0));
    return {
      undoDepth: e.undoDepth,
      removeCount: remove.length,
    };
  });

  expect(before.removeCount).toBe(4);
  await page.evaluate(() => (window as any).__forgeCommands.deleteComponents());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Faces deleted');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    vertices: 8,
    edges: 8,
    faces: 2,
    triangles: 4,
    undoDepth: before.undoDepth + 1,
  });

  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => (window as any).__forgeCommands.selectMeshBoundaryEdges());
  await expect(page.locator('#toast')).toContainText('Selected 8 open logical boundary edges');
  expect(await page.evaluate(() => (window as any).__forge.componentSelection.length)).toBe(8);

  const canvas = page.locator('#viewport canvas');
  await canvas.click({ button: 'right', position: { x: 320, y: 220 } });
  const menu = page.locator('#viewport-context-menu');
  await expect(menu).toBeVisible();
  const bridge = menu.getByRole('menuitem', { name: 'Bridge Edge Loops', exact: true });
  await expect(bridge).toBeEnabled();
  await bridge.click();

  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Boundary loops bridged with logical Quads');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    const edgeUses = new Map<string, number>();
    for (const polygon of e.meshTopology.polygons) {
      for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index], b = polygon[(index + 1) % polygon.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
      }
    }
    return {
      mode: e.componentMode,
      selection: [...e.componentSelection],
      selectedSides: [...e.componentSelection].map((face: number) => e.meshTopology.polygons[face].length),
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      openEdges: [...edgeUses.values()].filter(count => count === 1).length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      identityCount: e.selected.userData.forgeLogicalVertexIds?.length,
      positionCount: e.selected.geometry.getAttribute('position').count,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    mode: 'face',
    selection: [2, 3, 4, 5],
    selectedSides: [4, 4, 4, 4],
    vertices: 8,
    edges: 12,
    faces: 6,
    triangles: 12,
    openEdges: 0,
    stored: 6,
    identityCount: expect.any(Number),
    positionCount: expect.any(Number),
    undoDepth: before.undoDepth + 2,
  });
  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.forgeLogicalVertexIds.length ===
      e.selected.geometry.getAttribute('position').count;
  })).toBe(true);
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 8 · E 12 · F 4 · T 8');

  // The whole 4-face side band has no single rigid outward translation direction,
  // so current Extrude Region must reject it without changing the mesh.
  const bridgedSnapshot = await page.evaluate(() => (window as any).__forge.snapshot());
  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('cannot derive one outward direction');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(bridgedSnapshot);

  // A single newly bridged logical Quad must remain a normal polygon-native face.
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(2);
    (window as any).__forgeModelingSettings.extrudeDistance = 0.5;
  });
  await page.evaluate(() => (window as any).__forgeCommands.extrudeFace());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Face extruded');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      mode: e.componentMode,
      selection: [...e.componentSelection],
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      identityCount: e.selected.userData.forgeLogicalVertexIds?.length,
      positionCount: e.selected.geometry.getAttribute('position').count,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    mode: 'face',
    selection: [2],
    vertices: 12,
    edges: 20,
    faces: 10,
    triangles: 20,
    identityCount: expect.any(Number),
    positionCount: expect.any(Number),
    undoDepth: before.undoDepth + 3,
  });

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.forgeLogicalVertexIds.length ===
      e.selected.geometry.getAttribute('position').count;
  })).toBe(true);

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const e = (window as any).__forge;
    return e.meshTopology?.logicalVertices.length === 8 &&
      e.meshTopology?.polygons.length === 6 &&
      e.meshTopology?.polygonTriangles.flat().length === 12;
  });

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const e = (window as any).__forge;
    return e.meshTopology?.polygons.length === 2 &&
      e.meshTopology?.polygonTriangles.flat().length === 4;
  });
});

