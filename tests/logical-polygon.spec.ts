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

test('quad inset stays explicitly staged while polygon extrusion is supported', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    return e.snapshot();
  });

  await page.evaluate(() => (window as any).__forgeCommands.insetFace());
  await expect(page.locator('#toast')).toContainText('Quad/polygon inset is not implemented yet');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before);
});

test('Cube quad extrudes as logical polygons, keeps the cap selected, and survives repeat and reload', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const setup = await page.evaluate(() => {
    const e = (window as any).__forge, topology = e.meshTopology, position = e.selected.geometry.getAttribute('position');
    const face = topology.polygons.findIndex((polygon: number[]) =>
      polygon.every((vertex: number) => position.getY(topology.vertices[vertex][0]) === 1)
    );
    if (face < 0) throw new Error('Expected a top logical quad.');
    e.selectComponent(face);
    return { face, before: e.snapshot() };
  });

  await page.getByLabel('Extrusion distance').fill('0.5');
  await page.evaluate(() => (window as any).__forgeCommands.extrudeFace());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Face extruded');

  const first = await page.evaluate(face => {
    const e = (window as any).__forge, topology = e.meshTopology, position = e.selected.geometry.getAttribute('position');
    return {
      selection: e.componentSelection,
      polygons: topology.polygons.length,
      polygonEdges: topology.polygonEdges.length,
      triangles: topology.faces.length,
      vertices: topology.vertices.length,
      sizes: topology.polygons.map((polygon: number[]) => polygon.length),
      capY: topology.polygons[face].map((vertex: number) => position.getY(topology.vertices[vertex][0])),
      stored: e.selected.userData.forgePolygonTriangles?.length,
      logicalFlag: e.selected.userData.forgeLogicalQuads,
      boundaryVertices: new Set(topology.polygons.flat()).size,
    };
  }, setup.face);
  expect(first).toEqual({
    selection: [setup.face],
    polygons: 10,
    polygonEdges: 20,
    triangles: 20,
    vertices: 12,
    sizes: new Array(10).fill(4),
    capY: new Array(4).fill(1.5),
    stored: 10,
    logicalFlag: undefined,
    boundaryVertices: 12,
  });

  // Real viewport regression: after extrusion, both renderer triangles of a
  // newly created side Quad must raycast back to one logical polygon.
  const wallPoints = await page.evaluate(() => {
    const e = (window as any).__forge, mesh = e.selected, topology = e.meshTopology;
    const position = mesh.geometry.getAttribute('position');
    e.selected.rotation.set(0, 0, 0);
    e.selected.scale.set(1, 1, 1);
    e.view('front');
    e.setTool('select');

    const wall = topology.polygons.findIndex((polygon: number[]) => {
      const ys = polygon.map((vertex: number) => position.getY(topology.vertices[vertex][0]));
      return polygon.every((vertex: number) => position.getZ(topology.vertices[vertex][0]) === 1)
        && Math.min(...ys) === 1
        && Math.max(...ys) === 1.5;
    });
    if (wall < 0) throw new Error('Expected an extruded front side Quad.');
    const triangles = topology.polygonTriangles[wall];
    if (triangles.length !== 2) throw new Error('Extruded side must remain one logical Quad backed by two renderer triangles.');

    mesh.updateWorldMatrix(true, true);
    const rect = e.host.getBoundingClientRect();
    const center = (triangle: number) => {
      const point = topology.faces[triangle].reduce((sum: any, vertex: number) => {
        const index = topology.vertices[vertex][0];
        return sum.add(mesh.localToWorld(mesh.position.clone().set(
          position.getX(index),
          position.getY(index),
          position.getZ(index),
        )));
      }, mesh.position.clone().set(0, 0, 0)).multiplyScalar(1 / 3).project(e.camera);
      return {
        x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2,
      };
    };
    return { wall, a: center(triangles[0]), b: center(triangles[1]) };
  });

  await page.mouse.click(wallPoints.a.x, wallPoints.a.y);
  expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([wallPoints.wall]);
  await page.mouse.click(wallPoints.b.x, wallPoints.b.y);
  expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([wallPoints.wall]);
  await page.evaluate(face => (window as any).__forge.selectComponent(face), setup.face);

  await page.getByLabel('Extrusion distance').fill('0.25');
  await page.evaluate(() => (window as any).__forgeCommands.extrudeFace());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  const second = await page.evaluate(face => {
    const e = (window as any).__forge, topology = e.meshTopology, position = e.selected.geometry.getAttribute('position');
    const snapshot = e.snapshot();
    return {
      selection: e.componentSelection,
      polygons: topology.polygons.length,
      triangles: topology.faces.length,
      vertices: topology.vertices.length,
      capY: topology.polygons[face].map((vertex: number) => position.getY(topology.vertices[vertex][0])),
      stored: e.selected.userData.forgePolygonTriangles?.length,
      snapshot,
    };
  }, setup.face);
  expect(second.selection).toEqual([setup.face]);
  expect(second.polygons).toBe(14);
  expect(second.triangles).toBe(28);
  expect(second.vertices).toBe(16);
  expect(second.capY).toEqual(new Array(4).fill(1.75));
  expect(second.stored).toBe(14);

  await page.locator('#mode').selectOption('object');
  await page.evaluate(snapshot => (window as any).__forge.load(JSON.parse(snapshot)), second.snapshot);
  await page.locator('#mode').selectOption('edit');
  const restored = await page.evaluate(face => {
    const e = (window as any).__forge, topology = e.meshTopology, position = e.selected.geometry.getAttribute('position');
    return {
      polygons: topology.polygons.length,
      triangles: topology.faces.length,
      vertices: topology.vertices.length,
      capY: topology.polygons[face].map((vertex: number) => position.getY(topology.vertices[vertex][0])),
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  }, setup.face);
  expect(restored).toEqual({
    polygons: 14,
    triangles: 28,
    vertices: 16,
    capY: new Array(4).fill(1.75),
    stored: 14,
  });
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


test('Plane grid exposes one logical quad per parametric cell', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.add('plane');
    e.setPrimitiveParameter('widthSegments', 3);
    e.setPrimitiveParameter('heightSegments', 2);
  });
  await page.locator('#mode').selectOption('edit');
  const result = await page.evaluate(() => {
    const t = (window as any).__forge.meshTopology;
    return {
      triangles: t.faces.length,
      polygons: t.polygons.length,
      polygonEdges: t.polygonEdges.length,
      sizes: t.polygons.map((polygon: number[]) => polygon.length),
    };
  });
  expect(result).toEqual({
    triangles: 12,
    polygons: 6,
    polygonEdges: 17,
    sizes: [4, 4, 4, 4, 4, 4],
  });
});

test('modeling UI maps logical edge and face selections to renderer topology', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');

  const edgeMapping = await page.evaluate(() => {
    const e = (window as any).__forge, topology = e.meshTopology;
    e.setComponentMode('edge');
    const logicalEdge = topology.polygonEdgeToEdge.findIndex((rendererEdge: number, id: number) => rendererEdge !== id);
    if (logicalEdge < 0) throw new Error('Expected a non-identity logical edge mapping.');
    e.selectComponent(logicalEdge);
    (window as any).__modelingCalls = [];
    e.runModeling = async (operation: unknown) => { (window as any).__modelingCalls.push(operation); };
    return { logicalEdge, groups: topology.polygonTriangles.map((group: number[]) => [...group]) };
  });

  await page.evaluate(() => (window as any).__forgeCommands.bevelEdges());
  expect(await page.evaluate(() => (window as any).__modelingCalls[0])).toMatchObject({
    kind: 'bevel',
    edges: [edgeMapping.logicalEdge],
    polygonTriangles: edgeMapping.groups,
  });

  const triangles = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setComponentMode('face');
    e.selectComponent(0);
    return [...e.meshTopology.polygonTriangles[0]];
  });
  await page.locator('summary').filter({ hasText: 'UV editor' }).click();
  await page.locator('#uv-project').click();
  expect(await page.evaluate(() => (window as any).__modelingCalls[1])).toMatchObject({
    kind: 'uv',
    faces: triangles,
  });
});

test('UV editing restores the logical quad selection after renderer-triangle work', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await page.locator('summary').filter({ hasText: 'UV editor' }).click();

  await page.locator('#uv-project').click();
  await expect(page.locator('#toast')).toContainText('Modeling operation complete.');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      selection: e.componentSelection,
      polygons: e.meshTopology.polygons.length,
      logicalFlag: e.selected.userData.forgeLogicalQuads,
      primitive: e.selected.userData.forgePrimitive,
    };
  })).toEqual({
    selection: [0],
    polygons: 6,
    logicalFlag: true,
    primitive: undefined,
  });
});


test('beveling the Cube top preserves logical polygons across Edit Mode and project reload', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const selected = await page.evaluate(() => {
    const e = (window as any).__forge, topology = e.meshTopology, position = e.selected.geometry.getAttribute('position');
    const edges = topology.polygonEdges
      .map((edge: number[], id: number) => ({ edge, id }))
      .filter(({ edge }: { edge: number[] }) => edge.every(vertex => position.getY(topology.vertices[vertex][0]) === 1))
      .map(({ id }: { id: number }) => id);
    if (edges.length !== 4) throw new Error('Expected four logical top boundary edges.');
    edges.forEach((id: number, index: number) => e.selectComponent(id, index > 0));
    return edges;
  });
  expect(selected).toHaveLength(4);

  await page.locator('#bevel-width').fill('0.1');
  await page.evaluate(() => (window as any).__forgeCommands.bevelEdges());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Bevel complete.');

  const after = await page.evaluate(() => {
    const e = (window as any).__forge, topology = e.meshTopology;
    return {
      polygons: topology.polygons.length,
      polygonEdges: topology.polygonEdges.length,
      rendererEdges: topology.edges.length,
      multiTrianglePolygons: topology.polygonTriangles.filter((group: number[]) => group.length > 1).length,
      stored: e.selected.userData.forgePolygonTriangles,
      logicalFlag: e.selected.userData.forgeLogicalQuads,
      boundaryVertices: new Set(topology.polygons.flat()).size,
      renderVertices: topology.vertices.length,
      snapshot: e.snapshot(),
    };
  });
  expect(after.polygons).toBeGreaterThan(6);
  expect(after.polygonEdges).toBeLessThan(after.rendererEdges);
  expect(after.multiTrianglePolygons).toBeGreaterThan(0);
  expect(after.stored).toHaveLength(after.polygons);
  expect(after.logicalFlag).toBeUndefined();
  expect(after.renderVertices).toBe(after.boundaryVertices);

  await page.locator('#mode').selectOption('object');
  await page.locator('#mode').selectOption('edit');
  expect(await page.evaluate(() => {
    const topology = (window as any).__forge.meshTopology;
    return { polygons: topology.polygons.length, polygonEdges: topology.polygonEdges.length, rendererEdges: topology.edges.length };
  })).toEqual({ polygons: after.polygons, polygonEdges: after.polygonEdges, rendererEdges: after.rendererEdges });

  await page.evaluate(snapshot => (window as any).__forge.load(JSON.parse(snapshot)), after.snapshot);
  await page.locator('#mode').selectOption('edit');
  expect(await page.evaluate(() => {
    const e = (window as any).__forge, topology = e.meshTopology;
    return {
      polygons: topology.polygons.length,
      polygonEdges: topology.polygonEdges.length,
      rendererEdges: topology.edges.length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  })).toEqual({ polygons: after.polygons, polygonEdges: after.polygonEdges, rendererEdges: after.rendererEdges, stored: after.polygons });
});
