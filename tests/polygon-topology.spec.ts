import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('native cube exposes six quad faces and twelve modeling edges', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.locator('#tool-select').click();
  await page.getByLabel('Mesh component').selectOption('face');

  const point = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.view('front');
    e.camera.updateMatrixWorld(true);
    e.content.updateMatrixWorld(true);
    const rect = e.host.getBoundingClientRect();
    const world = e.selected.position.clone();
    world.z += 1;
    const projected = world.project(e.camera);
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  });

  await page.mouse.click(point.x, point.y);

  const selected = await page.evaluate(() => {
    const e = (window as any).__forge;
    const t = e.meshTopology;
    const face = e.componentSelection[0];
    return {
      triangles: t.faces.length,
      triangleEdges: t.edges.length,
      polygons: t.polygons.length,
      polygonEdges: t.polygonEdges.length,
      selection: e.componentSelection.length,
      selectedVertices: t.polygons[face]?.length ?? 0,
      selectedTriangles: t.polygonTriangles[face]?.length ?? 0,
      overlayVertices: e.selectedFaceOverlay?.geometry?.getAttribute('position')?.count ?? 0,
    };
  });

  expect(selected).toEqual({
    triangles: 12,
    triangleEdges: 18,
    polygons: 6,
    polygonEdges: 12,
    selection: 1,
    selectedVertices: 4,
    selectedTriangles: 2,
    overlayVertices: 6,
  });

  await page.getByLabel('Mesh component').selectOption('edge');
  const edgeState = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      topologyEdges: e.meshTopology.polygonEdges.length,
      renderedSegments: (e.componentEdges.geometry.getAttribute('position').count ?? 0) / 2,
    };
  });
  expect(edgeState).toEqual({ topologyEdges: 12, renderedSegments: 12 });
});

test('primitive regeneration and Forge reload retain logical quad metadata', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setPrimitiveParameter('width', 2.75);
    e.setPrimitiveParameter('heightSegments', 2);
    e.setEditMode(true);
    const before = {
      polygons: e.meshTopology.polygons.length,
      quadCount: e.meshTopology.polygons.filter((face: number[]) => face.length === 4).length,
      polygonEdges: e.meshTopology.polygonEdges.length,
    };
    e.setEditMode(false);
    const snapshot = e.snapshot();
    e.load(JSON.parse(snapshot));
    e.setEditMode(true);
    const after = {
      polygons: e.meshTopology.polygons.length,
      quadCount: e.meshTopology.polygons.filter((face: number[]) => face.length === 4).length,
      polygonEdges: e.meshTopology.polygonEdges.length,
    };
    return { before, after };
  });

  expect(result.before.polygons).toBe(10);
  expect(result.before.quadCount).toBe(10);
  expect(result.before.polygonEdges).toBeGreaterThan(12);
  expect(result.after).toEqual(result.before);
});

test('subdivided plane uses grid quads without render diagonals as modeling edges', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const plane = e.add('plane');
    e.setPrimitiveParameter('widthSegments', 2);
    e.setPrimitiveParameter('heightSegments', 2);
    e.setEditMode(true);
    const t = e.meshTopology;
    return {
      triangles: t.faces.length,
      triangleEdges: t.edges.length,
      polygons: t.polygons.length,
      quads: t.polygons.filter((face: number[]) => face.length === 4).length,
      polygonEdges: t.polygonEdges.length,
    };
  });

  expect(result).toEqual({
    triangles: 8,
    triangleEdges: 16,
    polygons: 4,
    quads: 4,
    polygonEdges: 12,
  });
});


test('quad extrusion preserves one logical cap and creates quad walls across repeats', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0, 0, 0);
    e.setEditMode(true);
    e.setComponentMode('face');

    const positions = e.selected.geometry.getAttribute('position');
    const front = e.meshTopology.polygons.findIndex((face: number[]) =>
      face.every(vertex => positions.getZ(e.meshTopology.vertices[vertex][0]) === 1)
    );
    e.selectComponent(front);

    const firstFaces = e.componentFaceTriangles(front);
    await e.runModeling({ kind: 'region', faces: firstFaces, distance: 0.5 });
    const firstSelection = e.componentSelection[0];
    const first = {
      triangles: e.stats().triangles,
      polygons: e.meshTopology.polygons.length,
      quads: e.meshTopology.polygons.filter((face: number[]) => face.length === 4).length,
      capVertices: e.meshTopology.polygons[firstSelection].length,
      capTriangles: e.componentFaceTriangles(firstSelection).length,
      selected: [...e.componentSelection],
    };

    const secondFaces = e.componentFaceTriangles(firstSelection);
    await e.runModeling({ kind: 'region', faces: secondFaces, distance: 0.5 });
    const secondSelection = e.componentSelection[0];
    const second = {
      triangles: e.stats().triangles,
      polygons: e.meshTopology.polygons.length,
      quads: e.meshTopology.polygons.filter((face: number[]) => face.length === 4).length,
      capVertices: e.meshTopology.polygons[secondSelection].length,
      capTriangles: e.componentFaceTriangles(secondSelection).length,
      selected: [...e.componentSelection],
    };

    return { front, first, second };
  });

  expect(result.first).toEqual({
    triangles: 20,
    polygons: 10,
    quads: 10,
    capVertices: 4,
    capTriangles: 2,
    selected: [result.front],
  });
  expect(result.second).toEqual({
    triangles: 28,
    polygons: 14,
    quads: 14,
    capVertices: 4,
    capTriangles: 2,
    selected: [result.front],
  });
});
