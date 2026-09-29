import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { extrudeLogicalFaceRegion } from '../src/modeling/modeling';
import { buildTopology } from '../src/modeling/topology';

function logicalTopology(geometry: THREE.BufferGeometry, groups: number[][] | true) {
  return buildTopology(
    geometry.getAttribute('position').array,
    geometry.index?.array,
    groups,
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

test('logical two-Quad region extrusion preserves caps and their shared internal edge', () => {
  const plane = new THREE.PlaneGeometry(4, 2, 2, 1);
  const sourceBefore = JSON.stringify(plane.toJSON());
  const before = logicalTopology(plane, true);

  const extrusion = extrudeLogicalFaceRegion(
    plane,
    [0, 1],
    0.5,
    before.polygonTriangles.map(group => [...group]),
  );
  expect(JSON.stringify(plane.toJSON())).toBe(sourceBefore);
  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);
  const position = extrusion.geometry.getAttribute('position');

  expect(extrusion.selectedFaces).toEqual([0, 1]);
  expect(extrusion.boundaryLoops).toBe(1);
  expect(extrusion.boundaryEdges).toBe(6);
  expect(extrusion.direction[2]).toBeCloseTo(1, 6);

  expect(after.logicalVertices).toHaveLength(12);
  expect(after.polygonEdges).toHaveLength(19);
  expect(after.polygons).toHaveLength(8);
  expect(after.polygonTriangles.flat()).toHaveLength(16);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);

  const shared = after.polygons[0].filter(vertex => after.polygons[1].includes(vertex));
  expect(shared).toHaveLength(2);
  expect(after.polygonEdges.some(([a, b]) => shared.includes(a) && shared.includes(b))).toBe(true);

  const capVertices = new Set([...after.polygons[0], ...after.polygons[1]]);
  for (const vertex of capVertices) {
    const point = new THREE.Vector3().fromBufferAttribute(position, after.vertices[vertex][0]);
    expect(point.z).toBeCloseTo(0.5, 6);
  }

  extrusion.geometry.dispose();
  plane.dispose();
});

test('logical region extrusion preserves cap UVs and assigns wall materials from adjacent logical faces', () => {
  const plane = new THREE.PlaneGeometry(4, 2, 2, 1);
  plane.clearGroups();
  plane.addGroup(0, 6, 2);
  plane.addGroup(6, 6, 3);
  const before = logicalTopology(plane, true);
  const sourceUV = plane.getAttribute('uv');

  const sourceFaceUVs = before.polygons.map(polygon =>
    [...new Set(polygon.map(vertex => {
      const buffer = before.vertices[vertex][0];
      return `${sourceUV.getX(buffer)},${sourceUV.getY(buffer)}`;
    }))].sort()
  );

  const extrusion = extrudeLogicalFaceRegion(
    plane,
    [0, 1],
    0.25,
    before.polygonTriangles.map(group => [...group]),
  );
  const uv = extrusion.geometry.getAttribute('uv');
  const outputFaceUVs = [0, 1].map(face =>
    [...new Set(extrusion.polygonTriangles[face].flatMap(triangle =>
      [0, 1, 2].map(corner => {
        const buffer = extrusion.geometry.index?.getX(triangle * 3 + corner) ?? triangle * 3 + corner;
        return `${uv.getX(buffer)},${uv.getY(buffer)}`;
      })
    ))].sort()
  );
  expect(outputFaceUVs).toEqual(sourceFaceUVs);

  const materialCounts = new Map<number, number>();
  for (const group of extrusion.geometry.groups) {
    materialCounts.set(
      group.materialIndex,
      (materialCounts.get(group.materialIndex) ?? 0) + group.count,
    );
  }
  expect(materialCounts.get(2)).toBe(24);
  expect(materialCounts.get(3)).toBe(24);

  extrusion.geometry.dispose();
  plane.dispose();
});

test('folded adjacent Cube faces extrude as one logical region with one common 3D translation', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const sourcePosition = box.getAttribute('position');
  const before = logicalTopology(box, true);
  const adjacent = before.polygons.flatMap((polygon, face) =>
    before.polygons.flatMap((other, candidate) => {
      if (candidate <= face) return [];
      return polygon.filter(vertex => other.includes(vertex)).length === 2
        ? [[face, candidate] as [number, number]]
        : [];
    })
  )[0];
  expect(adjacent).toBeDefined();

  const firstNormal = polygonNormal(before, sourcePosition, adjacent[0]);
  const secondNormal = polygonNormal(before, sourcePosition, adjacent[1]);
  expect(Math.abs(firstNormal.dot(secondNormal))).toBeLessThan(1e-6);

  const extrusion = extrudeLogicalFaceRegion(
    box,
    adjacent,
    0.25,
    before.polygonTriangles.map(group => [...group]),
  );
  const direction = new THREE.Vector3().fromArray(extrusion.direction);
  expect(direction.dot(firstNormal)).toBeGreaterThan(0);
  expect(direction.dot(secondNormal)).toBeGreaterThan(0);

  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);
  expect(extrusion.boundaryLoops).toBe(1);
  expect(extrusion.boundaryEdges).toBe(6);
  expect(after.logicalVertices).toHaveLength(14);
  expect(after.polygonEdges).toHaveLength(24);
  expect(after.polygons).toHaveLength(12);
  expect(after.polygonTriangles.flat()).toHaveLength(24);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);

  const shared = after.polygons[adjacent[0]].filter(vertex =>
    after.polygons[adjacent[1]].includes(vertex)
  );
  expect(shared).toHaveLength(2);
  expect(after.polygonEdges.some(([a, b]) => shared.includes(a) && shared.includes(b))).toBe(true);

  extrusion.geometry.dispose();
  box.dispose();
});

test('logical region extrusion preserves a planar hole and its unselected center face', () => {
  const plane = new THREE.PlaneGeometry(3, 3, 3, 3);
  const sourcePosition = plane.getAttribute('position');
  const before = logicalTopology(plane, true);

  const centroid = (face: number) =>
    before.polygons[face].reduce(
      (sum, vertex) => sum.add(
        new THREE.Vector3().fromBufferAttribute(sourcePosition, before.vertices[vertex][0])
      ),
      new THREE.Vector3(),
    ).multiplyScalar(1 / before.polygons[face].length);

  const centerFace = before.polygons
    .map((_, face) => ({ face, distance: centroid(face).lengthSq() }))
    .sort((a, b) => a.distance - b.distance)[0].face;
  const selected = before.polygons.flatMap((_, face) => face === centerFace ? [] : [face]);
  const centerBefore = before.polygons[centerFace].map(vertex => {
    const point = new THREE.Vector3().fromBufferAttribute(sourcePosition, before.vertices[vertex][0]);
    return point.toArray().join(',');
  }).sort();

  const extrusion = extrudeLogicalFaceRegion(
    plane,
    selected,
    0.25,
    before.polygonTriangles.map(group => [...group]),
  );
  const afterPosition = extrusion.geometry.getAttribute('position');
  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);

  expect(extrusion.boundaryLoops).toBe(2);
  expect(extrusion.boundaryEdges).toBe(16);
  expect(extrusion.selectedFaces).toEqual(selected);
  expect(after.polygons).toHaveLength(25);
  expect(after.polygonTriangles.flat()).toHaveLength(50);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);

  const centerAfter = after.polygons[centerFace].map(vertex => {
    const point = new THREE.Vector3().fromBufferAttribute(afterPosition, after.vertices[vertex][0]);
    return point.toArray().join(',');
  }).sort();
  expect(centerAfter).toEqual(centerBefore);

  extrusion.geometry.dispose();
  plane.dispose();
});

test('logical region extrusion rejects disconnected regions and regions without one outward direction', () => {
  const plane = new THREE.PlaneGeometry(6, 2, 3, 1);
  const strip = logicalTopology(plane, true);
  expect(strip.polygons).toHaveLength(3);
  expect(() => extrudeLogicalFaceRegion(
    plane,
    [0, 2],
    0.25,
    strip.polygonTriangles.map(group => [...group]),
  )).toThrow('edge-connected');

  const box = new THREE.BoxGeometry(2, 2, 2);
  const cube = logicalTopology(box, true);
  expect(() => extrudeLogicalFaceRegion(
    box,
    cube.polygons.map((_, face) => face),
    0.25,
    cube.polygonTriangles.map(group => [...group]),
  )).toThrow('region boundary');

  expect(() => extrudeLogicalFaceRegion(
    plane,
    [0],
    -1,
    strip.polygonTriangles.map(group => [...group]),
  )).toThrow('Distance');

  box.dispose();
  plane.dispose();
});

test('real logical face region extrusion repeats, preserves selection, and undoes to the segmented Plane', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="plane"]').click();
  await page.getByLabel('Primitive Segments X').fill('2');
  await page.getByLabel('Primitive Segments X').press('Enter');

  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    e.selectComponent(1, true);
    (window as any).__forgeModelingSettings.extrudeDistance = 0.5;
    return {
      undoDepth: e.undoDepth,
      snapshot: e.snapshot(),
    };
  });

  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Face region extruded');

  const first = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      mode: e.componentMode,
      selection: [...e.componentSelection],
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      polygonSizes: e.meshTopology.polygons.map((polygon: number[]) => polygon.length),
      primitive: e.selected.userData.forgePrimitive,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      undoDepth: e.undoDepth,
    };
  });
  expect(first).toEqual({
    mode: 'face',
    selection: [0, 1],
    vertices: 12,
    edges: 19,
    faces: 8,
    triangles: 16,
    polygonSizes: Array(8).fill(4),
    primitive: undefined,
    stored: 8,
    undoDepth: before.undoDepth + 1,
  });

  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      selection: [...e.componentSelection],
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    selection: [0, 1],
    vertices: 18,
    edges: 31,
    faces: 14,
    triangles: 28,
    stored: 14,
    undoDepth: before.undoDepth + 2,
  });

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const e = (window as any).__forge;
    return e.meshTopology?.logicalVertices.length === 6 &&
      e.meshTopology?.polygons.length === 2 &&
      e.meshTopology?.polygonTriangles.flat().length === 4;
  });
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before.snapshot);
});

test('UI region rejection preserves geometry and logical face selection', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="plane"]').click();
  await page.getByLabel('Primitive Segments X').fill('3');
  await page.getByLabel('Primitive Segments X').press('Enter');
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    e.selectComponent(2, true);
    return {
      snapshot: e.snapshot(),
      selection: [...e.componentSelection],
      undoDepth: e.undoDepth,
    };
  });

  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('edge-connected');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      snapshot: e.snapshot(),
      selection: [...e.componentSelection],
      undoDepth: e.undoDepth,
    };
  })).toEqual(before);
});
