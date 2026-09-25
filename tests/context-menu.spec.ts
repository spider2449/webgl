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
  await expect(menu.getByRole('menuitem', { name: 'Snap Selection…' })).toBeVisible();
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
  await expect(menu.getByRole('menuitem', { name: 'Bevel Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Subdivide Edges' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Loop Cut' })).toBeVisible();
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
  await expect(menu.getByRole('menuitem', { name: 'Extrude Face' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Extrude Region' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Inset Face' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bevel Edges' })).toHaveCount(0);
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
