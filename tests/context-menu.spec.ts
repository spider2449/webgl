import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

async function rightClickViewport(page: import('@playwright/test').Page, x = 320, y = 220) {
  const canvas = page.locator('#viewport canvas');
  await canvas.click({ button: 'right', position: { x, y } });
  await expect(page.locator('#viewport-context-menu')).toBeVisible();
}

async function setRange(locator: import('@playwright/test').Locator, value: string) {
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('replaced modeling actions and parameters are removed from Properties', async ({ page }) => {
  for (const id of ['extrude-face','extrude-region','inset-face','bevel-edges','loop-cut','subdivide-edge','vertex-snap','smooth','flat','extrude-distance','inset-distance','bevel-width','snap-target-kind']) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }
  await expect(page.locator('#mirror')).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: 'Modeling status' })).toBeVisible();
  await expect(page.getByLabel('Proportional editing', { exact: true })).toBeVisible();
});

test('RMB opens a Blender-style object context menu and is reserved from viewport pan', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__forge.orbit.mouseButtons.RIGHT)).toBeNull();

  await rightClickViewport(page);
  const menu = page.locator('#viewport-context-menu');
  await expect(menu.getByText('Object Context', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Move G' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rotate R' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scale S' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Duplicate Shift D' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete Del' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Extrude Face' })).toHaveCount(0);
  await expect(page.locator('.navigation-help')).toContainText('RMB');
  await expect(page.locator('.navigation-help')).toContainText('Context');
});

test('Face context exposes inline Extrude and Inset sliders with numeric entry and retained values', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await rightClickViewport(page);

  const menu = page.locator('#viewport-context-menu');
  const extrudeNumber = menu.getByLabel('Context extrude distance', { exact: true });
  const extrudeSlider = menu.getByLabel('Context extrude distance slider', { exact: true });
  const insetNumber = menu.getByLabel('Context inset distance', { exact: true });
  const insetSlider = menu.getByLabel('Context inset distance slider', { exact: true });

  await expect(extrudeNumber).toHaveValue('0.5');
  await expect(extrudeSlider).toHaveValue('0.5');
  await expect(insetNumber).toHaveValue('0.1');
  await expect(insetSlider).toHaveValue('0.1');

  await setRange(extrudeSlider, '1.2');
  await expect(extrudeNumber).toHaveValue('1.2');
  await extrudeNumber.fill('2.5');
  await extrudeNumber.press('Tab');
  expect(await page.evaluate(() => (window as any).__forgeModelingSettings.extrudeDistance)).toBe(2.5);

  await setRange(insetSlider, '0.35');
  await expect(insetNumber).toHaveValue('0.35');
  expect(await page.evaluate(() => (window as any).__forgeModelingSettings.insetDistance)).toBe(0.35);

  await page.keyboard.press('Escape');
  await rightClickViewport(page);
  await expect(page.locator('#viewport-context-menu').getByLabel('Context extrude distance', { exact: true })).toHaveValue('2.5');
  await expect(page.locator('#viewport-context-menu').getByLabel('Context inset distance', { exact: true })).toHaveValue('0.35');
});

test('Edge context exposes inline Bevel width and Enter executes with the typed value', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__contextCalls = [];
    e.runModeling = async (operation: unknown) => { (window as any).__contextCalls.push(operation); };
  });
  await rightClickViewport(page);

  const menu = page.locator('#viewport-context-menu');
  const bevelNumber = menu.getByLabel('Context bevel width', { exact: true });
  const bevelSlider = menu.getByLabel('Context bevel width slider', { exact: true });
  await setRange(bevelSlider, '0.4');
  await expect(bevelNumber).toHaveValue('0.4');
  await bevelNumber.fill('0.65');
  await bevelNumber.press('Enter');
  await expect(menu).toBeHidden();

  expect(await page.evaluate(() => (window as any).__contextCalls[0])).toMatchObject({
    kind: 'bevel',
    width: 0.65,
  });
});

test('Edge context exposes retained integer subdivision cuts', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__contextCalls = [];
    (window as any).__forgeModelingSettings.subdivideCuts = 1;
    e.runModeling = async (operation: unknown) => { (window as any).__contextCalls.push(operation); };
  });
  await rightClickViewport(page);

  let menu = page.locator('#viewport-context-menu');
  const cutsNumber = menu.getByLabel('Context subdivision cuts', { exact: true });
  const cutsSlider = menu.getByLabel('Context subdivision cuts slider', { exact: true });
  await expect(cutsNumber).toHaveValue('1');
  await expect(cutsSlider).toHaveValue('1');
  await setRange(cutsSlider, '4');
  await expect(cutsNumber).toHaveValue('4');
  await cutsNumber.fill('3');
  await cutsNumber.press('Enter');
  await expect(menu).toBeHidden();

  expect(await page.evaluate(() => (window as any).__contextCalls[0])).toMatchObject({
    kind: 'subdivide',
    cuts: 3,
  });

  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  const retained = menu.getByLabel('Context subdivision cuts', { exact: true });
  await expect(retained).toHaveValue('3');
  await retained.fill('2.5');
  await retained.press('Enter');
  await expect(menu).toBeVisible();
  await expect(page.locator('#toast')).toContainText('whole number between 1 and 32');
  await expect(retained).toHaveValue('3');
  expect(await page.evaluate(() => (window as any).__contextCalls)).toHaveLength(1);
  await page.keyboard.press('Escape');
});

test('Edge context exposes inline Loop position and Enter sends the retained factor', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__contextCalls = [];
    (window as any).__forgeModelingSettings.loopPosition = 0.5;
    e.runModeling = async (operation: unknown) => { (window as any).__contextCalls.push(operation); };
  });
  await rightClickViewport(page);

  const menu = page.locator('#viewport-context-menu');
  const loopNumber = menu.getByLabel('Context loop cut position', { exact: true });
  const loopSlider = menu.getByLabel('Context loop cut position slider', { exact: true });
  await expect(loopNumber).toHaveValue('0.5');
  await expect(loopSlider).toHaveValue('0.5');
  await setRange(loopSlider, '0.3');
  await expect(loopNumber).toHaveValue('0.3');
  await loopNumber.fill('0.25');
  await loopNumber.press('Enter');
  await expect(menu).toBeHidden();

  expect(await page.evaluate(() => (window as any).__contextCalls[0])).toMatchObject({
    kind: 'loop',
    factor: 0.25,
  });

  await rightClickViewport(page);
  await expect(page.locator('#viewport-context-menu').getByLabel('Context loop cut position', { exact: true })).toHaveValue('0.25');
});

test('Vertex context keeps Snap target beside Snap Selection and Enter starts the chosen target mode', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await rightClickViewport(page);

  const menu = page.locator('#viewport-context-menu');
  const snapTarget = menu.getByLabel('Context snap target', { exact: true });
  await snapTarget.selectOption('surface');
  expect(await page.evaluate(() => (window as any).__forgeModelingSettings.snapTarget)).toBe('surface');
  await snapTarget.press('Enter');
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => ({
    pending: (window as any).__forge.snapTargetPending,
    kind: (window as any).__forge.snapTargetKind,
  }))).toEqual({ pending: true, kind: 'surface' });
});

test('Vertex context exposes Knife snap control and allows Knife without a preselected start vertex', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');
  expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([]);

  await rightClickViewport(page);
  const menu = page.locator('#viewport-context-menu');
  const knifeSnap = menu.getByLabel('Context Knife snap', { exact: true });
  await expect(knifeSnap).toHaveValue('vertex-edge');
  await expect(menu.getByRole('menuitem', { name: 'Knife K' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Knife K' })).toBeEnabled();

  await knifeSnap.selectOption('edge-only');
  expect(await page.evaluate(() => (window as any).__forgeModelingSettings.knifeSnap)).toBe('edge-only');
  await knifeSnap.press('Enter');
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => ({
    pending: (window as any).__forge.snapTargetPending,
    kind: (window as any).__forge.snapTargetKind,
  }))).toEqual({ pending: true, kind: 'knife' });
  await page.keyboard.press('Escape');

  await page.evaluate(() => { (window as any).__forgeModelingSettings.knifeSnap = 'vertex-edge'; });
});

test('Edit Mode RMB menu changes with Vertex, Edge and Face component mode', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');

  await page.getByLabel('Mesh component').selectOption('vertex');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await rightClickViewport(page);
  let menu = page.locator('#viewport-context-menu');
  await expect(menu.getByText('Vertex Context', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Move G' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rotate R' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scale S' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Linked' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Invert Selection' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Knife K' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Knife K' })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Cut Face' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Cut Face' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Snap Selection…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete Vertices Del' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bevel Edges' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => ({
    editMode: (window as any).__forge.editMode,
    mode: (window as any).__forge.componentMode,
    selected: (window as any).__forge.componentSelection,
  }))).toEqual({ editMode: true, mode: 'vertex', selected: [0] });

  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  await expect(menu.getByText('Edge Context', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Move G' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rotate R' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scale S' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Linked' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Invert Selection' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Non-Manifold Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Mesh Boundary' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bevel Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Subdivide Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Loop Cut' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete Edges Del' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Extrude Face' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  await expect(menu.getByText('Face Context', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Move G' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rotate R' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scale S' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Linked' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Invert Selection' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select Boundary Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Extrude Face' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Extrude Region' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Inset Face' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete Faces Del' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bevel Edges' })).toHaveCount(0);
});

test('RMB Select Linked expands the current logical Cube island without history', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  const initialUndoDepth = await page.evaluate(() => (window as any).__forge.undoDepth);

  for (const [mode, expected] of [['vertex', 8], ['edge', 12], ['face', 6]] as const) {
    await page.getByLabel('Mesh component').selectOption(mode);
    await page.evaluate(() => (window as any).__forge.selectComponent(0));
    const beforeEdgeOverlayGeometry = mode === 'edge'
      ? await page.evaluate(() => (window as any).__forge.selectedEdgeOverlay.geometry.uuid)
      : null;
    await rightClickViewport(page);
    const menu = page.locator('#viewport-context-menu');
    await expect(menu.getByRole('menuitem', { name: 'Select Linked' })).toBeEnabled();
    await menu.getByRole('menuitem', { name: 'Select Linked' }).click();
    await expect(page.locator('#toast')).toContainText(`Selected ${expected} linked logical components`);

    expect(await page.evaluate(currentMode => {
      const e = (window as any).__forge;
      const selection = [...e.componentSelection];
      return {
        mode: e.componentMode,
        count: selection.length,
        active: currentMode === 'edge' ? selection.at(-1) : null,
        selectedOverlaySegments: currentMode === 'edge'
          ? e.selectedEdgeOverlay.geometry.instanceCount
          : null,
        selectedOverlayWidth: currentMode === 'edge'
          ? e.selectedEdgeOverlay.material.linewidth
          : null,
        activeOverlaySegments: currentMode === 'edge'
          ? e.activeEdgeOverlay.geometry.instanceCount
          : null,
        overlayGeometry: currentMode === 'edge'
          ? e.selectedEdgeOverlay.geometry.uuid
          : null,
        undoDepth: e.undoDepth,
      };
    }, mode)).toEqual({
      mode,
      count: expected,
      active: mode === 'edge' ? 0 : null,
      selectedOverlaySegments: mode === 'edge' ? 12 : null,
      selectedOverlayWidth: mode === 'edge' ? 4 : null,
      activeOverlaySegments: mode === 'edge' ? 1 : null,
      overlayGeometry: mode === 'edge' ? expect.any(String) : null,
      undoDepth: initialUndoDepth,
    });
    if (mode === 'edge') {
      const afterEdgeOverlayGeometry = await page.evaluate(() => (window as any).__forge.selectedEdgeOverlay.geometry.uuid);
      expect(afterEdgeOverlayGeometry).not.toBe(beforeEdgeOverlayGeometry);
    }
  }
});

test('RMB Invert Selection complements logical components without history', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  const initialUndoDepth = await page.evaluate(() => (window as any).__forge.undoDepth);

  for (const [mode, total] of [['vertex', 8], ['edge', 12], ['face', 6]] as const) {
    await page.getByLabel('Mesh component').selectOption(mode);
    await page.evaluate(() => (window as any).__forge.selectComponent(0));

    await rightClickViewport(page);
    let menu = page.locator('#viewport-context-menu');
    await expect(menu.getByRole('menuitem', { name: 'Invert Selection' })).toBeEnabled();
    await menu.getByRole('menuitem', { name: 'Invert Selection' }).click();
    await expect(page.locator('#toast')).toContainText(`Selection inverted; ${total - 1} logical components selected`);

    expect(await page.evaluate(currentMode => {
      const e = (window as any).__forge;
      const selection = [...e.componentSelection];
      return {
        mode: e.componentMode,
        selection,
        containsSeed: selection.includes(0),
        edgeOverlay: currentMode === 'edge' ? e.selectedEdgeOverlay.geometry.instanceCount : null,
        activeEdge: currentMode === 'edge' ? selection.at(-1) : null,
        undoDepth: e.undoDepth,
      };
    }, mode)).toEqual({
      mode,
      selection: expect.any(Array),
      containsSeed: false,
      edgeOverlay: mode === 'edge' ? 11 : null,
      activeEdge: mode === 'edge' ? 11 : null,
      undoDepth: initialUndoDepth,
    });
    expect(await page.evaluate(() => (window as any).__forge.componentSelection.length)).toBe(total - 1);

    await rightClickViewport(page);
    menu = page.locator('#viewport-context-menu');
    await menu.getByRole('menuitem', { name: 'Invert Selection' }).click();
    expect(await page.evaluate(() => (window as any).__forge.componentSelection)).toEqual([0]);

    await page.evaluate(() => (window as any).__forge.selectComponent(undefined));
    await rightClickViewport(page);
    menu = page.locator('#viewport-context-menu');
    await expect(menu.getByRole('menuitem', { name: 'Invert Selection' })).toBeEnabled();
    await menu.getByRole('menuitem', { name: 'Invert Selection' }).click();
    expect(await page.evaluate(() => (window as any).__forge.componentSelection.length)).toBe(total);

    await rightClickViewport(page);
    menu = page.locator('#viewport-context-menu');
    await menu.getByRole('menuitem', { name: 'Invert Selection' }).click();
    expect(await page.evaluate(currentMode => {
      const e=(window as any).__forge;
      return {
        count:e.componentSelection.length,
        selectedOverlay:currentMode === 'edge' ? e.selectedEdgeOverlay.geometry.instanceCount : null,
        activeOverlay:currentMode === 'edge' ? e.activeEdgeOverlay.geometry.instanceCount : null,
        undoDepth:e.undoDepth,
      };
    }, mode)).toEqual({
      count:0,
      selectedOverlay:mode === 'edge' ? 0 : null,
      activeOverlay:mode === 'edge' ? 0 : null,
      undoDepth:initialUndoDepth,
    });
  }
});

test('RMB Select Non-Manifold Edges selects open logical edges and preserves closed-manifold selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle geometry statistics' }).click();

  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="plane"]').click();
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const initialUndoDepth = await page.evaluate(() => (window as any).__forge.undoDepth);

  await rightClickViewport(page);
  let menu = page.locator('#viewport-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Select Non-Manifold Edges', exact: true })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Select Non-Manifold Edges', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Selected 4 logical non-manifold edges');

  expect(await page.evaluate(() => {
    const e=(window as any).__forge;
    return {
      count:e.componentSelection.length,
      overlay:e.selectedEdgeOverlay.geometry.instanceCount,
      active:e.componentSelection.at(-1),
      undoDepth:e.undoDepth,
    };
  })).toEqual({
    count:4,
    overlay:4,
    active:3,
    undoDepth:initialUndoDepth,
  });
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 4 · E 4 · F 1 · T 2');

  await page.locator('#mode').selectOption('object');
  await page.locator('.object-row', { hasText: 'Cube' }).click();
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  const before = await page.evaluate(() => ({
    selection:[...(window as any).__forge.componentSelection],
    undoDepth:(window as any).__forge.undoDepth,
  }));

  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  await menu.getByRole('menuitem', { name: 'Select Non-Manifold Edges', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Mesh has no logical non-manifold edges');

  expect(await page.evaluate(() => ({
    mode:(window as any).__forge.componentMode,
    selection:[...(window as any).__forge.componentSelection],
    undoDepth:(window as any).__forge.undoDepth,
  }))).toEqual({
    mode:'edge',
    selection:before.selection,
    undoDepth:before.undoDepth,
  });
});

test('RMB Select Mesh Boundary selects open logical edges and preserves closed-mesh selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle geometry statistics' }).click();

  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="plane"]').click();
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const initialUndoDepth = await page.evaluate(() => (window as any).__forge.undoDepth);

  await rightClickViewport(page);
  let menu = page.locator('#viewport-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Select Mesh Boundary', exact: true })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Select Mesh Boundary', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Selected 4 open logical boundary edges');

  expect(await page.evaluate(() => {
    const e=(window as any).__forge;
    return {
      count:e.componentSelection.length,
      logicalEdges:e.meshTopology.polygonEdges.length,
      overlay:e.selectedEdgeOverlay.geometry.instanceCount,
      active:e.componentSelection.at(-1),
      undoDepth:e.undoDepth,
    };
  })).toEqual({
    count:4,
    logicalEdges:4,
    overlay:4,
    active:3,
    undoDepth:initialUndoDepth,
  });
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 4 · E 4 · F 1 · T 2');

  await page.locator('#mode').selectOption('object');
  await page.locator('.object-row', { hasText: 'Cube' }).click();
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  const before = await page.evaluate(() => ({
    selection:[...(window as any).__forge.componentSelection],
    undoDepth:(window as any).__forge.undoDepth,
  }));

  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  await menu.getByRole('menuitem', { name: 'Select Mesh Boundary', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Mesh has no open logical boundary edges');

  expect(await page.evaluate(() => ({
    mode:(window as any).__forge.componentMode,
    selection:[...(window as any).__forge.componentSelection],
    undoDepth:(window as any).__forge.undoDepth,
  }))).toEqual({
    mode:'edge',
    selection:before.selection,
    undoDepth:before.undoDepth,
  });
});

test('RMB Select Boundary Edges converts a face region to its logical perimeter without history', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');

  const setup = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology;
    const edgeKey = (a:number,b:number) => `${Math.min(a,b)}:${Math.max(a,b)}`;
    const uses = new Map<string, number[]>();
    t.polygons.forEach((polygon:number[], face:number) => {
      for (let local=0; local<polygon.length; local++) {
        const key=edgeKey(polygon[local], polygon[(local+1)%polygon.length]);
        const list=uses.get(key) ?? [];
        list.push(face);
        uses.set(key,list);
      }
    });
    const pair=[...uses.values()].find((faces:number[])=>faces.length===2);
    if (!pair) throw new Error('Expected adjacent Cube faces.');
    e.selectComponent(pair[0]);
    e.selectComponent(pair[1], true);

    const selected = new Set(pair);
    const expected = t.polygonEdges.flatMap((edge:number[], id:number) => {
      const key=edgeKey(edge[0],edge[1]);
      const count=(uses.get(key) ?? []).filter((face:number)=>selected.has(face)).length;
      return count===1 ? [id] : [];
    });
    return { pair, expected, undoDepth:e.undoDepth };
  });

  await rightClickViewport(page);
  const menu = page.locator('#viewport-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Select Boundary Edges' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Select Boundary Edges' }).click();
  await expect(page.locator('#toast')).toContainText('Selected 6 logical boundary edges');

  expect(await page.evaluate(expected => {
    const e=(window as any).__forge;
    return {
      mode:e.componentMode,
      selection:[...e.componentSelection].sort((a:number,b:number)=>a-b),
      overlay:e.selectedEdgeOverlay.geometry.instanceCount,
      undoDepth:e.undoDepth,
    };
  }, setup.expected)).toEqual({
    mode:'edge',
    selection:[...setup.expected].sort((a:number,b:number)=>a-b),
    overlay:6,
    undoDepth:setup.undoDepth,
  });
});

test('RMB Cut Face splits a Cube quad between two selected opposite vertices', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');
  const setup = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology;
    const face = 0;
    const polygon = t.polygons[face];
    const vertices = [polygon[0], polygon[2]];
    const position = e.selected.geometry.getAttribute('position');
    const points = vertices.map((vertex: number) => {
      const index = t.vertices[vertex][0];
      return [position.getX(index), position.getY(index), position.getZ(index)].join(',');
    });
    e.selectComponent(vertices[0]);
    e.selectComponent(vertices[1], true);
    return { points };
  });

  await rightClickViewport(page);
  const menu = page.locator('#viewport-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Cut Face' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Cut Face' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Face cut');

  expect(await page.evaluate(points => {
    const e = (window as any).__forge, t = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const edgeExists = t.polygonEdges.some(([a,b]: [number,number]) => {
      const read = (vertex: number) => {
        const index = t.vertices[vertex][0];
        return [position.getX(index), position.getY(index), position.getZ(index)].join(',');
      };
      return points.includes(read(a)) && points.includes(read(b));
    });
    return {
      polygons: t.polygons.length,
      triangles: t.faces.length,
      sizes: t.polygons.map((polygon: number[]) => polygon.length).sort((a:number,b:number)=>a-b),
      edges: t.polygonEdges.length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
      mode: e.componentMode,
      selection: e.componentSelection,
      edgeExists,
    };
  }, setup.points)).toEqual({
    polygons: 7,
    triangles: 12,
    sizes: [3,3,4,4,4,4,4],
    edges: 13,
    stored: 7,
    mode: 'vertex',
    selection: [],
    edgeExists: true,
  });
});

test('RMB Bevel mutates the default Cube through the real worker path', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__forgeModelingSettings.bevelWidth = 0.1;
    return { polygons: e.meshTopology.polygons.length, vertices: e.meshTopology.vertices.length };
  });
  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Bevel Edges' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Bevel complete');
  const after = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      polygons: e.meshTopology.polygons.length,
      vertices: e.meshTopology.vertices.length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  });
  expect(after.polygons).toBeGreaterThan(before.polygons);
  expect(after.vertices).toBeGreaterThan(before.vertices);
  expect(after.stored).toBe(after.polygons);
});

test('RMB Loop Cut splits the default Cube logical quad ring at the configured position', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const expected = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology, p = e.selected.geometry.getAttribute('position');
    const [a, b] = t.polygonEdges[0];
    const ai = t.vertices[a][0], bi = t.vertices[b][0];
    const start = [p.getX(ai), p.getY(ai), p.getZ(ai)];
    const end = [p.getX(bi), p.getY(bi), p.getZ(bi)];
    const delta = end.map((value, index) => Math.abs(value - start[index]));
    const axis = delta.indexOf(Math.max(...delta));
    const originalVertices = t.logicalVertices.map((vertex: number) => {
      const i = t.vertices[vertex][0];
      return `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    });
    e.selectComponent(0);
    (window as any).__forgeModelingSettings.loopPosition = 0.3;
    const point = start.map((value, index) => value + (end[index] - value) * 0.3);
    return { point, axis, coordinate: point[axis], originalVertices };
  });
  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Loop Cut' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Loop cut complete');
  expect(await page.evaluate(expectedLoop => {
    const e = (window as any).__forge, t = e.meshTopology;
    const p = e.selected.geometry.getAttribute('position');
    const positioned = t.logicalVertices.some((vertex: number) => {
      const i = t.vertices[vertex][0];
      return Math.hypot(
        p.getX(i) - expectedLoop.point[0],
        p.getY(i) - expectedLoop.point[1],
        p.getZ(i) - expectedLoop.point[2],
      ) < 1e-6;
    });
    const aligned = t.logicalVertices.filter((vertex: number) => {
      const i = t.vertices[vertex][0];
      const values = [p.getX(i), p.getY(i), p.getZ(i)];
      return Math.abs(values[expectedLoop.axis] - expectedLoop.coordinate) < 1e-6;
    }).length;
    const original = new Set(expectedLoop.originalVertices);
    const selection = [...e.componentSelection];
    const selectedLoopEdges = selection.every((edgeId: number) =>
      t.polygonEdges[edgeId].every((vertex: number) => {
        const i = t.vertices[vertex][0];
        return !original.has(`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`);
      })
    );
    return {
      polygons: t.polygons.length,
      vertices: t.vertices.length,
      triangles: t.faces.length,
      sizes: t.polygons.map((polygon: number[]) => polygon.length),
      stored: e.selected.userData.forgePolygonTriangles?.length,
      mode: e.componentMode,
      positioned,
      aligned,
      selectionCount: selection.length,
      selectedLoopEdges,
    };
  }, expected)).toEqual({
    polygons: 10,
    vertices: 12,
    triangles: 20,
    sizes: new Array(10).fill(4),
    stored: 10,
    mode: 'edge',
    positioned: true,
    aligned: 4,
    selectionCount: 4,
    selectedLoopEdges: true,
  });
});

test('RMB Inset Face insets a default Cube quad instead of rejecting renderer-backed polygons', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__forgeModelingSettings.insetDistance = 0.1;
  });
  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Inset Face' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Face inset');
  expect(await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology;
    return {
      polygons: t.polygons.length,
      vertices: t.vertices.length,
      triangles: t.faces.length,
      selection: e.componentSelection,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  })).toEqual({
    polygons: 10,
    vertices: 12,
    triangles: 20,
    selection: [0],
    stored: 10,
  });
});

test('Delete key removes selected Edit Mode faces without deleting the object', async ({ page }) => {
  const mode = page.locator('#mode');
  await mode.selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    return { uuid: e.selected.uuid, snapshot: e.snapshot() };
  });
  await page.getByLabel('Mesh component').evaluate((element: HTMLSelectElement) => element.blur());
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Faces deleted');

  expect(await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      uuid: e.selected?.uuid,
      editMode: e.editMode,
      mode: e.componentMode,
      selection: e.componentSelection,
      polygons: e.meshTopology.polygons.length,
      triangles: e.meshTopology.faces.length,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  })).toEqual({
    uuid: before.uuid,
    editMode: true,
    mode: 'face',
    selection: [],
    polygons: 5,
    triangles: 10,
    stored: 5,
  });

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before.snapshot);
});

test('RMB Delete Edges merges adjacent faces and retessellates the affected surface', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology;
    const edge = t.polygonEdges[0];
    const position = e.selected.geometry.getAttribute('position');
    const point = (vertex: number) => {
      const index = t.vertices[vertex][0];
      return [position.getX(index), position.getY(index), position.getZ(index)];
    };
    e.selectComponent(0);
    return {
      edge: [point(edge[0]), point(edge[1])],
      triangles: t.faces.length,
    };
  });

  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Delete Edges Del' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Edges deleted; adjacent faces merged');

  expect(await page.evaluate(edge => {
    const e = (window as any).__forge, t = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const key = (point: number[]) => point.join(',');
    const deleted = new Set(edge.map(key));
    const rendererStillUsesDeletedEdge = t.edges.some(([a,b]: [number,number]) => {
      const read = (vertex: number) => {
        const index = t.vertices[vertex][0];
        return key([position.getX(index), position.getY(index), position.getZ(index)]);
      };
      return deleted.has(read(a)) && deleted.has(read(b));
    });
    return {
      polygons: t.polygons.length,
      triangles: t.faces.length,
      logicalVertices: t.logicalVertices.length,
      edges: t.polygonEdges.length,
      sizes: t.polygons.map((polygon: number[]) => polygon.length).sort((a:number,b:number)=>a-b),
      rendererStillUsesDeletedEdge,
      selection: e.componentSelection,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  }, before.edge)).toEqual({
    polygons: 5,
    triangles: before.triangles,
    logicalVertices: 8,
    edges: 11,
    sizes: [4,4,4,4,6],
    rendererStillUsesDeletedEdge: false,
    selection: [],
    stored: 5,
  });
});

test('RMB Delete Vertices removes the point and retessellates every affected face', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('vertex');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology;
    const vertex = t.logicalVertices[0];
    const position = e.selected.geometry.getAttribute('position');
    const index = t.vertices[vertex][0];
    const point = [position.getX(index), position.getY(index), position.getZ(index)];
    e.selectComponent(vertex);
    return { vertex, point };
  });

  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Delete Vertices Del' }).click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Vertices deleted; surrounding faces reconnected');

  expect(await page.evaluate(({ point }) => {
    const e = (window as any).__forge, t = e.meshTopology;
    const position = e.selected.geometry.getAttribute('position');
    const stillExists = t.vertices.some((copies: number[]) => {
      const index = copies[0];
      return position.getX(index) === point[0] && position.getY(index) === point[1] && position.getZ(index) === point[2];
    });
    return {
      polygons: t.polygons.length,
      triangles: t.faces.length,
      logicalVertices: t.logicalVertices.length,
      edges: t.polygonEdges.length,
      sizes: t.polygons.map((polygon: number[]) => polygon.length).sort((a:number,b:number)=>a-b),
      stillExists,
      helperPointCount: e.vertexPoints.geometry.index?.count ?? e.vertexPoints.geometry.getAttribute('position').count,
      selection: e.componentSelection,
      stored: e.selected.userData.forgePolygonTriangles?.length,
    };
  }, before)).toEqual({
    polygons: 6,
    triangles: 9,
    logicalVertices: 7,
    edges: 12,
    sizes: [3,3,3,4,4,4],
    stillExists: false,
    helperPointCount: 7,
    selection: [],
    stored: 6,
  });
});

test('Edit Mode context Rotate and Scale commands switch the component gizmo', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));

  await rightClickViewport(page);
  let menu = page.locator('#viewport-context-menu');
  await menu.getByRole('menuitem', { name: 'Rotate R' }).click();
  expect(await page.evaluate(() => (window as any).__forge.transform.mode)).toBe('rotate');

  await rightClickViewport(page);
  menu = page.locator('#viewport-context-menu');
  await menu.getByRole('menuitem', { name: 'Scale S' }).click();
  expect(await page.evaluate(() => (window as any).__forge.transform.mode)).toBe('scale');
});

test('Face context action reuses the existing polygon Extrude operator and closes the menu', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponent(0);
    (window as any).__contextCalls = [];
    e.runModeling = async (operation: unknown) => { (window as any).__contextCalls.push(operation); };
  });

  await rightClickViewport(page);
  await page.locator('#viewport-context-menu').getByRole('menuitem', { name: 'Extrude Face' }).click();
  await expect(page.locator('#viewport-context-menu')).toBeHidden();

  expect(await page.evaluate(() => (window as any).__contextCalls[0])).toMatchObject({
    kind: 'extrude',
    face: 0,
  });
});

test('context menu stays inside the viewport and supports keyboard navigation', async ({ page }) => {
  const viewport = page.locator('#viewport');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Viewport is unavailable.');

  await rightClickViewport(page, Math.max(1, box.width - 3), Math.max(1, box.height - 3));
  const menu = page.locator('#viewport-context-menu');
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('Context menu is unavailable.');

  expect(menuBox.x).toBeGreaterThanOrEqual(box.x);
  expect(menuBox.y).toBeGreaterThanOrEqual(box.y);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(box.y + box.height + 1);

  const first = menu.locator('button:not(:disabled)').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('button:not(:disabled)').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
