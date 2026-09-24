import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
});

async function seedPositionBezier(page: any, tangent: 'free' | 'aligned' | 'auto' = 'free') {
  await page.evaluate((mode) => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(25); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(49); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'bezier');
    e.setKeyTangentMode(25, 'position.x', mode);
    e.scrub(25);
  }, tangent);
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="25"]').click();
  return graph;
}

test('Bezier handle modes have visible Graph and inspector states', async ({ page }) => {
  const graph = await seedPositionBezier(page, 'free');
  const inspector = page.getByLabel('Bezier handle inspector');

  await expect(inspector).toBeVisible();
  await expect(page.locator('#graph-handle-mode')).toHaveText('FREE · independent');
  await expect(graph.locator('.graph-handle.free')).toHaveCount(2);
  await expect(graph.locator('.graph-handle-line.free')).toHaveCount(2);

  await page.getByLabel('Selected key tangent mode').selectOption('aligned');
  await expect(page.locator('#graph-handle-mode')).toHaveText('ALIGNED · linked');
  await expect(graph.locator('.graph-handle.aligned')).toHaveCount(2);
  await expect(graph.locator('.graph-handle-line.aligned')).toHaveCount(2);

  await page.getByLabel('Selected key tangent mode').selectOption('auto');
  await expect(page.locator('#graph-handle-mode')).toHaveText('AUTO · edit → ALIGNED');
  await expect(graph.locator('.graph-handle.auto')).toHaveCount(2);
  await expect(graph.locator('.graph-handle-line.auto')).toHaveCount(2);
});

test('Free Handle Inspector edits one side precisely and undo restores it', async ({ page }) => {
  const graph = await seedPositionBezier(page, 'free');

  await page.getByLabel('Selected Bezier handle side').selectOption('right');
  const frame = page.getByLabel('Selected Bezier handle frame');
  const value = page.getByLabel('Selected Bezier handle value');
  await expect(frame).toHaveValue('33');
  expect(Number(await value.inputValue())).toBeCloseTo(5.333333, 5);

  const before = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));

  await frame.fill('31');
  await value.fill('12');
  await page.getByRole('button', { name: 'Apply Bezier handle Frame and Value' }).click();

  const edited = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));
  expect(edited.tangent).toBe('free');
  expect(edited.right).toEqual([6, 4]);
  expect(edited.left).toEqual(before.left);
  await expect(graph.locator('.graph-handle[data-handle="right"]')).toHaveAttribute('data-handle-frame', '31');
  await expect(page.locator('#graph-handle-mode')).toHaveText('FREE · independent');

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));
  expect(restored.right).toEqual(before.right);
  expect(restored.left).toEqual(before.left);
});

test('Aligned Handle Inspector keeps the opposite handle collinear and preserves its length', async ({ page }) => {
  await seedPositionBezier(page, 'aligned');

  const before = await page.evaluate(() => {
    const key = (window as any).__forge.selected.userData.animationTracks['position.x'][1];
    return { left: [...key.left], leftLength: Math.hypot(...key.left) };
  });

  await page.getByLabel('Selected Bezier handle side').selectOption('right');
  await page.getByLabel('Selected Bezier handle frame').fill('31');
  await page.getByLabel('Selected Bezier handle value').fill('12');
  await page.getByRole('button', { name: 'Apply Bezier handle Frame and Value' }).click();

  const after = await page.evaluate(() => {
    const key = (window as any).__forge.selected.userData.animationTracks['position.x'][1];
    const left = [...key.left], right = [...key.right];
    return {
      tangent: key.tangent,
      left,
      right,
      leftLength: Math.hypot(...left),
      cross: left[0] * right[1] - left[1] * right[0],
      dot: left[0] * right[0] + left[1] * right[1],
    };
  });

  expect(after.tangent).toBe('aligned');
  expect(after.right).toEqual([6, 4]);
  expect(after.cross).toBeCloseTo(0, 6);
  expect(after.dot).toBeLessThan(0);
  expect(after.leftLength).toBeCloseTo(before.leftLength, 6);
  await expect(page.locator('#graph-handle-mode')).toHaveText('ALIGNED · linked');
});

test('Aligned pointer drag previews the coupled opposite handle before pointerup', async ({ page }) => {
  const graph = await seedPositionBezier(page, 'aligned');

  const left = graph.locator('.graph-handle[data-handle="left"]');
  const right = graph.locator('.graph-handle[data-handle="right"]');
  const leftBefore = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(leftBefore).not.toBeNull();
  expect(rightBox).not.toBeNull();

  await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y - 30, { steps: 6 });

  const leftDuring = await left.boundingBox();
  expect(leftDuring).not.toBeNull();
  expect(Math.abs(leftDuring!.x - leftBefore!.x) + Math.abs(leftDuring!.y - leftBefore!.y)).toBeGreaterThan(1);
  await expect(graph.locator('.graph-handle.aligned')).toHaveCount(2);

  await page.mouse.up();
});

test('editing an Auto handle precisely converts it to Aligned and undo restores Auto', async ({ page }) => {
  const graph = await seedPositionBezier(page, 'auto');

  await expect(graph.locator('.graph-handle.auto')).toHaveCount(2);
  await page.getByLabel('Selected Bezier handle side').selectOption('right');
  await page.getByLabel('Selected Bezier handle frame').fill('31');
  await page.getByLabel('Selected Bezier handle value').fill('12');
  await page.getByRole('button', { name: 'Apply Bezier handle Frame and Value' }).click();

  const edited = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));
  expect(edited.tangent).toBe('aligned');
  expect(edited.right).toEqual([6, 4]);
  expect(edited.left).toBeDefined();
  await expect(graph.locator('.graph-handle.aligned')).toHaveCount(2);
  await expect(page.getByLabel('Selected key tangent mode')).toHaveValue('aligned');
  await expect(page.locator('#graph-handle-mode')).toHaveText('ALIGNED · linked');

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));
  expect(restored.tangent).toBe('auto');
  expect(restored.left).toBeUndefined();
  expect(restored.right).toBeUndefined();
});

test('Bezier Handle Inspector displays and edits rotation handle values in degrees', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.rotation.y = 270 * Math.PI / 180; e.insertChannelKey('rotation.y');
    e.scrub(25); e.selected.rotation.y = 540 * Math.PI / 180; e.insertChannelKey('rotation.y');
    e.scrub(49); e.selected.rotation.y = 720 * Math.PI / 180; e.insertChannelKey('rotation.y');
    e.setKeyInterpolation(1, 'rotation.y', 'bezier');
    e.setKeyInterpolation(25, 'rotation.y', 'bezier');
    e.setKeyTangentMode(25, 'rotation.y', 'free');
    e.scrub(25);
  });

  await page.getByRole('button', { name: 'Graph channel Rotation Y' }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="25"]').click();
  await page.getByLabel('Selected Bezier handle side').selectOption('right');

  await expect(page.locator('#graph-handle-value-unit')).toHaveText('°');
  await expect(page.getByLabel('Selected Bezier handle frame')).toHaveValue('33');
  expect(Number(await page.getByLabel('Selected Bezier handle value').inputValue())).toBeCloseTo(600, 5);

  await page.getByLabel('Selected Bezier handle value').fill('630');
  await page.getByRole('button', { name: 'Apply Bezier handle Frame and Value' }).click();

  const right = await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['rotation.y'][1].right
  );
  expect(right[0]).toBeCloseTo(8, 8);
  expect(right[1] * 180 / Math.PI).toBeCloseTo(90, 6);
});
