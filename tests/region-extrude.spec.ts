import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { extrudeLogicalFaceRegion } from '../src/modeling/modeling';
import { buildTopology } from '../src/modeling/topology';

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
  expect(extrusion.regionCount).toBe(1);
  expect(extrusion.boundaryLoops).toBe(1);
  expect(extrusion.boundaryEdges).toBe(6);
  expect(extrusion.regions[0].direction[2]).toBeCloseTo(1, 6);

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
  expect(extrusion.regionCount).toBe(1);
  const direction = new THREE.Vector3().fromArray(extrusion.regions[0].direction);
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

  expect(extrusion.regionCount).toBe(1);
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

test('disconnected logical selections extrude as independent regions', () => {
  const plane = new THREE.PlaneGeometry(6, 2, 3, 1);
  const sourcePosition = plane.getAttribute('position');
  const strip = logicalTopology(plane, true);
  expect(strip.polygons).toHaveLength(3);

  const centerBefore = strip.polygons[1].map(vertex =>
    new THREE.Vector3().fromBufferAttribute(sourcePosition, strip.vertices[vertex][0]).toArray().join(',')
  ).sort();

  const extrusion = extrudeLogicalFaceRegion(
    plane,
    [0, 2],
    0.25,
    strip.polygonTriangles.map(group => [...group]),
  );
  const afterPosition = extrusion.geometry.getAttribute('position');
  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);

  expect(extrusion.selectedFaces).toEqual([0, 2]);
  expect(extrusion.regionCount).toBe(2);
  expect(extrusion.boundaryLoops).toBe(2);
  expect(extrusion.boundaryEdges).toBe(8);
  expect(extrusion.regions.map(region => region.faces)).toEqual([[0], [2]]);
  expect(extrusion.regions.every(region => region.direction[2] > 0.999999)).toBe(true);

  expect(after.logicalVertices).toHaveLength(16);
  expect(after.polygonEdges).toHaveLength(26);
  expect(after.polygons).toHaveLength(11);
  expect(after.polygonTriangles.flat()).toHaveLength(22);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);

  const centerAfter = after.polygons[1].map(vertex =>
    new THREE.Vector3().fromBufferAttribute(afterPosition, after.vertices[vertex][0]).toArray().join(',')
  ).sort();
  expect(centerAfter).toEqual(centerBefore);

  extrusion.geometry.dispose();
  plane.dispose();
});

test('vertex-touching disconnected regions keep coincident moved corners topologically distinct', () => {
  const plane = new THREE.PlaneGeometry(4, 4, 2, 2);
  const before = logicalTopology(plane, true);
  const pair = before.polygons.flatMap((polygon, face) =>
    before.polygons.flatMap((other, candidate) => {
      if (candidate <= face) return [];
      const shared = polygon.filter(vertex => other.includes(vertex));
      const sharedEdge = before.polygonEdges.some(([a, b]) =>
        shared.includes(a) && shared.includes(b)
      );
      return shared.length === 1 && !sharedEdge
        ? [[face, candidate] as [number, number]]
        : [];
    })
  )[0];
  expect(pair).toBeDefined();

  const extrusion = extrudeLogicalFaceRegion(
    plane,
    pair,
    0.25,
    before.polygonTriangles.map(group => [...group]),
  );
  expect(extrusion.regionCount).toBe(2);
  expect(extrusion.regions.map(region => region.faces)).toEqual([[pair[0]], [pair[1]]]);

  const ids = extrusion.geometry.userData.forgeLogicalVertexIds;
  expect(Array.isArray(ids)).toBe(true);
  expect(ids).toHaveLength(extrusion.geometry.getAttribute('position').count);

  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);
  const logicalIntersection = after.polygons[pair[0]].filter(vertex =>
    after.polygons[pair[1]].includes(vertex)
  );
  expect(logicalIntersection).toEqual([]);

  const position = extrusion.geometry.getAttribute('position');
  const capPositions = pair.map(face =>
    new Map(after.polygons[face].map(vertex => {
      const point = new THREE.Vector3().fromBufferAttribute(position, after.vertices[vertex][0]);
      return [point.toArray().join(','), vertex] as const;
    }))
  );
  const coincident = [...capPositions[0].keys()].filter(key => capPositions[1].has(key));
  expect(coincident).toHaveLength(1);
  expect(capPositions[0].get(coincident[0])).not.toBe(capPositions[1].get(coincident[0]));

  // Repeating the same two cap faces must preserve the topological split.
  const repeated = extrudeLogicalFaceRegion(
    extrusion.geometry,
    pair,
    0.25,
    extrusion.polygonTriangles,
  );
  const repeatedTopology = logicalTopology(repeated.geometry, repeated.polygonTriangles);
  expect(repeated.regionCount).toBe(2);
  expect(
    repeatedTopology.polygons[pair[0]].filter(vertex =>
      repeatedTopology.polygons[pair[1]].includes(vertex)
    )
  ).toEqual([]);

  repeated.geometry.dispose();
  extrusion.geometry.dispose();
  plane.dispose();
});

test('disconnected Cube regions derive independent outward extrusion directions', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const position = box.getAttribute('position');
  const cube = logicalTopology(box, true);
  const normals = cube.polygons.map((_, face) => polygonNormal(cube, position, face));
  const opposite = normals.flatMap((normal, face) =>
    normals.flatMap((other, candidate) =>
      candidate > face && normal.dot(other) < -0.999999
        ? [[face, candidate] as [number, number]]
        : []
    )
  )[0];
  expect(opposite).toBeDefined();

  const extrusion = extrudeLogicalFaceRegion(
    box,
    opposite,
    0.25,
    cube.polygonTriangles.map(group => [...group]),
  );

  expect(extrusion.regionCount).toBe(2);
  expect(extrusion.boundaryLoops).toBe(2);
  expect(extrusion.boundaryEdges).toBe(8);
  expect(extrusion.regions.map(region => region.faces)).toEqual([[opposite[0]], [opposite[1]]]);

  for (const region of extrusion.regions) {
    const direction = new THREE.Vector3().fromArray(region.direction);
    expect(direction.dot(normals[region.faces[0]])).toBeGreaterThan(0.999999);
  }

  const after = logicalTopology(extrusion.geometry, extrusion.polygonTriangles);
  expect(after.logicalVertices).toHaveLength(16);
  expect(after.polygonEdges).toHaveLength(28);
  expect(after.polygons).toHaveLength(14);
  expect(after.polygonTriangles.flat()).toHaveLength(28);
  expect(after.polygons.every(polygon => polygon.length === 4)).toBe(true);

  extrusion.geometry.dispose();
  box.dispose();
});

test('logical region extrusion still rejects closed regions without boundaries and invalid distance', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const cube = logicalTopology(box, true);
  expect(() => extrudeLogicalFaceRegion(
    box,
    cube.polygons.map((_, face) => face),
    0.25,
    cube.polygonTriangles.map(group => [...group]),
  )).toThrow('region to have a boundary');

  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const single = logicalTopology(plane, true);
  expect(() => extrudeLogicalFaceRegion(
    plane,
    [0],
    -1,
    single.polygonTriangles.map(group => [...group]),
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
  await expect(page.locator('#toast')).toContainText('Selected face regions extruded');

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

test('UI vertex-touching diagonal faces extrude separately without non-manifold welding', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="plane"]').click();
  await page.getByLabel('Primitive Segments X').fill('2');
  await page.getByLabel('Primitive Segments X').press('Enter');
  await page.getByLabel('Primitive Segments Y').fill('2');
  await page.getByLabel('Primitive Segments Y').press('Enter');

  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    const pair = e.meshTopology.polygons.flatMap((polygon: number[], face: number) =>
      e.meshTopology.polygons.flatMap((other: number[], candidate: number) => {
        if (candidate <= face) return [];
        const shared = polygon.filter((vertex: number) => other.includes(vertex));
        const sharedEdge = e.meshTopology.polygonEdges.some(([a, b]: [number, number]) =>
          shared.includes(a) && shared.includes(b)
        );
        return shared.length === 1 && !sharedEdge ? [[face, candidate]] : [];
      })
    )[0];
    e.selectComponent(pair[0]);
    e.selectComponent(pair[1], true);
    (window as any).__forgeModelingSettings.extrudeDistance = 0.25;
    return {
      pair,
      selectedUuid: e.selected.uuid,
      snapshot: e.snapshot(),
      undoDepth: e.undoDepth,
    };
  });

  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Selected face regions extruded');

  expect(await page.evaluate((pair: number[]) => {
    const e = (window as any).__forge;
    const first = e.meshTopology.polygons[pair[0]];
    const second = e.meshTopology.polygons[pair[1]];
    const position = e.selected.geometry.getAttribute('position');
    const positions = (polygon: number[]) => polygon.map(vertex => {
      const buffer = e.meshTopology.vertices[vertex][0];
      return [position.getX(buffer), position.getY(buffer), position.getZ(buffer)].join(',');
    });
    const firstPositions = positions(first);
    const secondPositions = positions(second);
    return {
      mode: e.componentMode,
      selection: [...e.componentSelection],
      sharedLogicalVertices: first.filter((vertex: number) => second.includes(vertex)),
      coincidentCapPositions: firstPositions.filter((value: string) => secondPositions.includes(value)),
      storedVertexIds: e.selected.userData.forgeLogicalVertexIds?.length,
      bufferVertices: position.count,
      undoDepth: e.undoDepth,
    };
  }, before.pair)).toEqual({
    mode: 'face',
    selection: before.pair,
    sharedLogicalVertices: [],
    coincidentCapPositions: [expect.any(String)],
    storedVertexIds: expect.any(Number),
    bufferVertices: expect.any(Number),
    undoDepth: before.undoDepth + 1,
  });

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.forgeLogicalVertexIds.length ===
      e.selected.geometry.getAttribute('position').count;
  })).toBe(true);

  const extrudedSnapshot = await page.evaluate(() => (window as any).__forge.snapshot());

  await page.keyboard.press('Control+z');
  await page.waitForFunction((snapshot: string) =>
    (window as any).__forge.snapshot() === snapshot,
  before.snapshot);

  await page.evaluate(({ snapshot, uuid }: { snapshot: string; uuid: string }) => {
    const e = (window as any).__forge;
    e.load(JSON.parse(snapshot));
    const restored = e.content.getObjectByProperty('uuid', uuid);
    if (!restored) throw new Error('Extruded Plane was not restored by project load.');
    e.select(restored);
  }, { snapshot: extrudedSnapshot, uuid: before.selectedUuid });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  expect(await page.evaluate((pair: number[]) => {
    const e = (window as any).__forge;
    const first = e.meshTopology.polygons[pair[0]];
    const second = e.meshTopology.polygons[pair[1]];
    const position = e.selected.geometry.getAttribute('position');
    const positions = (polygon: number[]) => polygon.map((vertex: number) => {
      const buffer = e.meshTopology.vertices[vertex][0];
      return [position.getX(buffer), position.getY(buffer), position.getZ(buffer)].join(',');
    });
    const firstPositions = positions(first);
    const secondPositions = positions(second);
    return {
      sharedLogicalVertices: first.filter((vertex: number) => second.includes(vertex)),
      coincidentCapPositions: firstPositions.filter((value: string) => secondPositions.includes(value)),
      identityCount: e.selected.userData.forgeLogicalVertexIds?.length,
      bufferVertices: position.count,
    };
  }, before.pair)).toEqual({
    sharedLogicalVertices: [],
    coincidentCapPositions: [expect.any(String)],
    identityCount: expect.any(Number),
    bufferVertices: expect.any(Number),
  });

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.forgeLogicalVertexIds.length ===
      e.selected.geometry.getAttribute('position').count;
  })).toBe(true);
});

test('UI disconnected face selection extrudes as separate logical regions in one Undo step', async ({ page }) => {
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
    (window as any).__forgeModelingSettings.extrudeDistance = 0.25;
    return {
      snapshot: e.snapshot(),
      undoDepth: e.undoDepth,
    };
  });

  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Selected face regions extruded');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      mode: e.componentMode,
      selection: [...e.componentSelection],
      vertices: e.meshTopology.logicalVertices.length,
      edges: e.meshTopology.polygonEdges.length,
      faces: e.meshTopology.polygons.length,
      triangles: e.meshTopology.polygonTriangles.flat().length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      undoDepth: e.undoDepth,
    };
  })).toEqual({
    mode: 'face',
    selection: [0, 2],
    vertices: 16,
    edges: 26,
    faces: 11,
    triangles: 22,
    stored: 11,
    undoDepth: before.undoDepth + 1,
  });

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const e = (window as any).__forge;
    return e.meshTopology?.logicalVertices.length === 8 &&
      e.meshTopology?.polygons.length === 3 &&
      e.meshTopology?.polygonTriangles.flat().length === 6;
  });
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before.snapshot);
});
