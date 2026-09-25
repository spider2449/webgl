import { test, expect } from '@playwright/test';

async function dragBox(page: import('@playwright/test').Page, box: { left: number; top: number; right: number; bottom: number }, add = false) {
  if (add) await page.keyboard.down('Shift');
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.mouse.move(box.right, box.bottom, { steps: 4 });
  await page.mouse.up();
  if (add) await page.keyboard.up('Shift');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Object Mode drag-box selects multiple objects and Shift adds', async ({ page }) => {
  const points = await page.evaluate(() => {
    const e = (window as any).__forge;
    const sphere = e.add('sphere', false);
    sphere.position.x = 3;
    const cone = e.add('cone', false);
    cone.position.x = 6;
    e.commit();
    e.view('front');
    e.setTool('select');
    e.content.updateMatrixWorld(true);
    e.camera.updateMatrixWorld(true);
    const rect = e.host.getBoundingClientRect();
    const screen = (object: any) => {
      const point = object.getWorldPosition(object.position.clone().set(0, 0, 0)).project(e.camera);
      return {
        name: object.name,
        x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2,
      };
    };
    return e.content.children.map(screen);
  });

  const cube = points.find(point => point.name === 'Cube')!;
  const sphere = points.find(point => point.name.startsWith('Sphere'))!;
  const cone = points.find(point => point.name.startsWith('Cone'))!;
  await dragBox(page, {
    left: Math.min(cube.x, sphere.x) - 24,
    top: Math.min(cube.y, sphere.y) - 24,
    right: Math.max(cube.x, sphere.x) + 24,
    bottom: Math.max(cube.y, sphere.y) + 24,
  });

  expect(await page.evaluate(() => [...(window as any).__forge.selectedObjects].map((object: any) => object.name).sort())).toEqual(['Cube', 'Sphere']);
  await expect(page.locator('.viewport-box-select')).toBeHidden();

  await dragBox(page, {
    left: cone.x - 24,
    top: cone.y - 24,
    right: cone.x + 24,
    bottom: cone.y + 24,
  }, true);

  expect(await page.evaluate(() => [...(window as any).__forge.selectedObjects].map((object: any) => object.name).sort())).toEqual(['Cone', 'Cube', 'Sphere']);
});

test('Shift-click accumulates Object Mode selection and Select Tool stays gizmo-free', async ({ page }) => {
  const points = await page.evaluate(() => {
    const e = (window as any).__forge;
    const sphere = e.add('sphere', false);
    sphere.position.x = 3;
    e.commit();
    e.view('front');
    e.setTool('select');
    e.content.updateMatrixWorld(true);
    e.camera.updateMatrixWorld(true);
    const rect = e.host.getBoundingClientRect();
    return e.content.children.map((object: any) => {
      const point = object.getWorldPosition(object.position.clone().set(0, 0, 0)).project(e.camera);
      return {
        name: object.name,
        x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2,
      };
    });
  });

  const cube = points.find((point: any) => point.name === 'Cube')!;
  const sphere = points.find((point: any) => point.name.startsWith('Sphere'))!;
  await page.mouse.click(cube.x, cube.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(sphere.x, sphere.y);
  await page.keyboard.up('Shift');

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      names: [...e.selectedObjects].map((object: any) => object.name).sort(),
      active: e.selected?.name,
      helperCount: e.secondarySelectionBoxes.size,
      gizmoObject: e.transform.object?.name ?? null,
    };
  });
  expect(result.names).toEqual(['Cube', 'Sphere']);
  expect(result.active).toBe('Sphere');
  expect(result.helperCount).toBe(1);
  expect(result.gizmoObject).toBeNull();
  await expect(page.locator('#selection-label')).toContainText('2 objects selected');
});

test('Select Tool does not attach Move gizmo after Edit Mode component selection', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0, 0, 0);
    e.commit();
    e.view('front');
  });
  await page.locator('#mode').selectOption('edit');
  await page.locator('#tool-select').click();
  await expect(page.locator('#tool-select')).toHaveClass(/active/);
  await page.getByLabel('Mesh component').selectOption('edge');

  const point = await page.evaluate(() => {
    const e = (window as any).__forge;
    const mesh = e.selected, topology = e.meshTopology, position = mesh.geometry.getAttribute('position');
    const edge = topology.edges[0];
    const center = edge.reduce((sum: any, vertex: number) => {
      const index = topology.vertices[vertex][0];
      return sum.add(mesh.localToWorld(mesh.position.clone().set(position.getX(index), position.getY(index), position.getZ(index))));
    }, mesh.position.clone().set(0, 0, 0)).multiplyScalar(0.5);
    e.camera.updateMatrixWorld(true);
    center.project(e.camera);
    const rect = e.host.getBoundingClientRect();
    return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  });

  await page.mouse.click(point.x, point.y);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      selected: e.componentSelection.length,
      gizmoObject: e.transform.object?.name ?? null,
      edgeOverlay: e.selectedEdgeOverlay?.visible ?? false,
      edgeOverlayCount: e.selectedEdgeOverlay?.geometry.getAttribute('position')?.count ?? 0,
    };
  });
  expect(result.selected).toBe(1);
  expect(result.gizmoObject).toBeNull();
  expect(result.edgeOverlay).toBe(true);
  expect(result.edgeOverlayCount).toBe(2);
});

for (const mode of ['vertex', 'edge', 'face'] as const) {
  test(`Edit Mode drag-box selects ${mode} components without changing selection type`, async ({ page }) => {
    await page.evaluate(() => {
      const e = (window as any).__forge;
      e.selected.rotation.set(0, 0, 0);
      e.selected.scale.set(1, 1, 1);
      e.commit();
      e.view('front');
      e.setTool('select');
    });
    await page.locator('#mode').selectOption('edit');
    await page.getByLabel('Mesh component').selectOption(mode);

    const target = await page.evaluate((mode) => {
      const e = (window as any).__forge;
      const mesh = e.selected;
      const topology = e.meshTopology;
      const position = mesh.geometry.getAttribute('position');
      mesh.updateMatrixWorld(true);
      e.camera.updateMatrixWorld(true);
      const rect = e.host.getBoundingClientRect();
      const world = (vertex: number) => mesh.localToWorld(mesh.position.clone().set(
        position.getX(topology.vertices[vertex][0]),
        position.getY(topology.vertices[vertex][0]),
        position.getZ(topology.vertices[vertex][0]),
      ));
      let point;
      if (mode === 'vertex') {
        point = world(topology.vertices.length - 1);
      } else if (mode === 'edge') {
        const edge = topology.edges[Math.floor(topology.edges.length / 2)];
        point = world(edge[0]).add(world(edge[1])).multiplyScalar(0.5);
      } else {
        const face = topology.faces[Math.floor(topology.faces.length / 2)];
        point = face.reduce((sum: any, vertex: number) => sum.add(world(vertex)), mesh.position.clone().set(0, 0, 0)).multiplyScalar(1 / 3);
      }
      point.project(e.camera);
      return {
        x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2,
      };
    }, mode);

    await dragBox(page, { left: target.x - 14, top: target.y - 14, right: target.x + 14, bottom: target.y + 14 });

    const result = await page.evaluate(() => {
      const e = (window as any).__forge;
      return { mode: e.componentMode, selected: e.componentSelection.length, editMode: e.editMode };
    });
    expect(result.editMode).toBe(true);
    expect(result.mode).toBe(mode);
    expect(result.selected).toBeGreaterThan(0);
  });
}

test('face selection overlay does not change scene geometry stats', async ({ page }) => {
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.stats();
  });

  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.locator('#tool-select').click();

  const point = await page.evaluate(() => {
    const e = (window as any).__forge;
    const mesh = e.selected, topology = e.meshTopology, position = mesh.geometry.getAttribute('position');
    const face = topology.faces[0];
    const center = face.reduce((sum: any, vertex: number) => {
      const index = topology.vertices[vertex][0];
      return sum.add(mesh.localToWorld(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index))));
    }, new THREE.Vector3()).multiplyScalar(1 / 3);
    e.camera.updateMatrixWorld(true);
    center.project(e.camera);
    const rect = e.host.getBoundingClientRect();
    return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  });

  await page.mouse.click(point.x, point.y);
  const after = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      stats: e.stats(),
      selectedFaces: e.componentSelection.length,
      helper: e.selectedFaceOverlay?.userData.forgeEditorHelper === true,
    };
  });
  expect(after.selectedFaces).toBe(1);
  expect(after.helper).toBe(true);
  expect(after.stats.vertices).toBe(before.vertices);
  expect(after.stats.triangles).toBe(before.triangles);
});

test('Escape cancels an active viewport box without changing selection', async ({ page }) => {
  const box = await page.evaluate(() => {
    const e = (window as any).__forge;
    const sphere = e.add('sphere', false);
    sphere.position.x = 3;
    e.commit();
    e.view('front');
    e.setTool('select');
    e.select(e.content.children[0]);
    const rect = e.host.getBoundingClientRect();
    return {
      left: rect.left + 40,
      top: rect.top + 40,
      right: rect.right - 40,
      bottom: rect.bottom - 40,
    };
  });

  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.mouse.move(box.right, box.bottom, { steps: 4 });
  await expect.poll(() => page.evaluate(() => (window as any).__forge.boxSelecting)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__forge.boxSelecting)).toBe(false);
  await page.mouse.up();

  expect(await page.evaluate(() => [...(window as any).__forge.selectedObjects].map((object: any) => object.name))).toEqual(['Cube']);
  await expect(page.locator('.viewport-box-select')).toBeHidden();
});
