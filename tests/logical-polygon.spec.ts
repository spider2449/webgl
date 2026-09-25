import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Cube viewport topology exposes six quads and twelve boundary edges', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const t = e.meshTopology;
    return {
      vertices: t.vertices.length,
      triangleEdges: t.edges.length,
      triangles: t.faces.length,
      polygonEdges: t.polygonEdges.length,
      polygons: t.polygons.length,
      sizes: t.polygons.map((face: number[]) => face.length),
      mapping: t.triangleToPolygon,
      logicalFlag: e.selected.userData.forgeLogicalQuads,
    };
  });
  expect(result.vertices).toBe(8);
  expect(result.triangleEdges).toBe(18);
  expect(result.triangles).toBe(12);
  expect(result.polygonEdges).toBe(12);
  expect(result.polygons).toBe(6);
  expect(result.sizes).toEqual([4, 4, 4, 4, 4, 4]);
  expect(result.mapping).toEqual([0,0,1,1,2,2,3,3,4,4,5,5]);
  expect(result.logicalFlag).toBe(true);
});

test('both renderer triangles on a Cube side select the same logical quad', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0, 0, 0);
    e.selected.scale.set(1, 1, 1);
    e.view('front');
  });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.locator('#tool-select').click();

  const points = await page.evaluate(() => {
    const e = (window as any).__forge, mesh = e.selected, t = e.meshTopology;
    const position = mesh.geometry.getAttribute('position');
    const rect = e.host.getBoundingClientRect();
    const front = t.polygons.findIndex((polygon: number[]) => polygon.every(v => position.getZ(t.vertices[v][0]) === 1));
    const triangles = t.polygonTriangles[front];
    const center = (triangle: number) => {
      const face = t.faces[triangle];
      const p = face.reduce((sum: any, vertex: number) => {
        const index = t.vertices[vertex][0];
        return sum.add(mesh.localToWorld(mesh.position.clone().set(position.getX(index), position.getY(index), position.getZ(index))));
      }, mesh.position.clone().set(0, 0, 0)).multiplyScalar(1 / 3).project(e.camera);
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    };
    return { front, a: center(triangles[0]), b: center(triangles[1]) };
  });

  await page.mouse.click(points.a.x, points.a.y);
  expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([points.front]);

  await page.mouse.click(points.b.x, points.b.y);
  expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([points.front]);
});

test('non-topology component movement preserves logical quad identity across Edit Mode re-entry', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    e.setTool('translate');
    e.vertexProxy.position.x += 0.2;
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    e.transform.dispatchEvent({ type: 'objectChange' });
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
  });

  expect(await page.evaluate(() => ({
    primitive: (window as any).__forge.selected.userData.forgePrimitive,
    logical: (window as any).__forge.selected.userData.forgeLogicalQuads,
  }))).toEqual({ primitive: undefined, logical: true });

  await page.locator('#mode').selectOption('object');
  await page.locator('#mode').selectOption('edit');
  expect(await page.evaluate(() => ({
    polygons: (window as any).__forge.meshTopology.polygons.length,
    edges: (window as any).__forge.meshTopology.polygonEdges.length,
  }))).toEqual({ polygons: 6, edges: 12 });
});
