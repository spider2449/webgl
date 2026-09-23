import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Graph Editor is the sole animation UI and exposes nine independent channels', async ({ page }) => {
  await expect(page.getByLabel('Animation interpolation', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Animation channel', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await expect(graph).toBeVisible();
  await expect(page.locator('[data-graph-channel]')).toHaveCount(9);
  await expect(page.getByLabel('Selected key interpolation')).toBeVisible();
  await expect(page.getByLabel('Selected key tangent mode')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert key on selected channel' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove selected channel key' })).toBeDisabled();
  await expect(graph).toHaveAttribute('data-key-count', '0');
});

test('Graph Editor inserts and removes keys on only the active channel', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(10);
    e.selected.position.x = 5;
    e.commit();
  });
  await page.getByRole('button', { name: 'Insert key on selected channel' }).click();

  let tracks = await page.evaluate(() => structuredClone((window as any).__forge.selected.userData.animationTracks));
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([10]);
  expect(tracks['position.y']).toBeUndefined();

  await page.locator('[data-graph-channel="position.y"]').click();
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(20);
    e.selected.position.y = 7;
    e.commit();
  });
  await page.getByRole('button', { name: 'Insert key on selected channel' }).click();

  tracks = await page.evaluate(() => structuredClone((window as any).__forge.selected.userData.animationTracks));
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([10]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([20]);

  await page.locator('[data-graph-channel="position.x"]').click();
  const graph = page.getByLabel('Animation graph editor');
  await expect(graph.locator('.graph-key-point[data-frame="10"]')).toHaveCount(1);
  await graph.locator('.graph-key-point[data-frame="10"]').click();
  await page.getByRole('button', { name: 'Remove selected channel key' }).click();

  tracks = await page.evaluate(() => structuredClone((window as any).__forge.selected.userData.animationTracks));
  expect(tracks['position.x']).toBeUndefined();
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([20]);
});

test('one channel supports mixed per-key Bezier and Constant segments', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(25); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(49); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('bezier');
  await expect(graph.locator('.graph-handle[data-handle="right"]')).toHaveCount(1);

  await graph.locator('.graph-key-point[data-frame="25"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('constant');

  await expect(graph).toHaveAttribute('data-mode', 'mixed');
  await expect(page.locator('[data-graph-channel="position.x"] small')).toHaveText('MIX');

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(13); const first = e.selected.position.x;
    e.scrub(37); const second = e.selected.position.x;
    return {
      first,
      second,
      track: structuredClone(e.selected.userData.animationTracks['position.x']),
    };
  });

  expect(result.first).toBeCloseTo(4, 5);
  expect(result.second).toBeCloseTo(8, 6);
  expect(result.track[0].interpolation).toBe('bezier');
  expect(result.track[1].interpolation).toBe('constant');
});

test('rotation channel graph displays unwrapped multi-turn degrees', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(1);
    e.selected.rotation.y = 270 * Math.PI / 180;
    e.insertChannelKey('rotation.y');
    e.scrub(25);
    e.selected.rotation.y = 720 * Math.PI / 180;
    e.insertChannelKey('rotation.y');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.locator('[data-graph-channel="rotation.y"]').click();
  const graph = page.getByLabel('Animation graph editor');

  expect(Number(await graph.locator('.graph-key-point[data-frame="1"]').getAttribute('data-value'))).toBeCloseTo(270, 5);
  expect(Number(await graph.locator('.graph-key-point[data-frame="25"]').getAttribute('data-value'))).toBeCloseTo(720, 5);

  await page.evaluate(() => (window as any).__forge.scrub(13));
  expect(await page.evaluate(() => (window as any).__forge.selected.rotation.y * 180 / Math.PI)).toBeCloseTo(495, 4);
});

test('Aligned tangent pointer dragging couples the opposite scalar-key handle', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(25); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(49); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'bezier');
    e.scrub(25);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="25"]').click();
  await page.getByLabel('Selected key tangent mode').selectOption('aligned');

  const before = await page.evaluate(() => {
    const key = (window as any).__forge.selected.userData.animationTracks['position.x'][1];
    return { left: [...key.left], right: [...key.right], leftLength: Math.hypot(...key.left) };
  });

  const right = graph.locator('.graph-handle[data-handle="right"]');
  const box = await right.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 30, { steps: 8 });
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const key = (window as any).__forge.selected.userData.animationTracks['position.x'][1];
    const left = [...key.left], right = [...key.right];
    return {
      left,
      right,
      leftLength: Math.hypot(...left),
      cross: left[0] * right[1] - left[1] * right[0],
      dot: left[0] * right[0] + left[1] * right[1],
    };
  });

  expect(after.right).not.toEqual(before.right);
  expect(after.cross).toBeCloseTo(0, 6);
  expect(after.dot).toBeLessThan(0);
  expect(after.leftLength).toBeCloseTo(before.leftLength, 6);
});

test('Auto tangent handles recompute from neighboring scalar keys and are locked', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(25); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(49); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'bezier');
    e.setKeyTangentMode(25, 'position.x', 'auto');
    e.scrub(25);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="25"]').click();

  const handles = graph.locator('.graph-handle.auto');
  await expect(handles).toHaveCount(2);
  const initial = await handles.evaluateAll(nodes =>
    nodes.map(node => Number((node as SVGElement).dataset.handleValue))
  );
  expect(initial[0]).toBeCloseTo(8, 6);
  expect(initial[1]).toBeCloseTo(8, 6);

  const stored = await page.evaluate(() => structuredClone(
    (window as any).__forge.selected.userData.animationTracks['position.x'][1]
  ));
  expect(stored.tangent).toBe('auto');
  expect(stored.left).toBeUndefined();
  expect(stored.right).toBeUndefined();

  const right = graph.locator('.graph-handle[data-handle="right"]');
  const pathBefore = await graph.locator('.graph-curve').getAttribute('d');
  const box = await right.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 30, { steps: 5 });
  await page.mouse.up();
  expect(await graph.locator('.graph-curve').getAttribute('d')).toBe(pathBefore);

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.userData.animationTracks['position.x'][2].value = 16;
    e.commit();
    e.scrub(25);
  });

  const updated = await graph.locator('.graph-handle.auto').evaluateAll(nodes =>
    nodes.map(node => Number((node as SVGElement).dataset.handleValue))
  );
  expect(updated[0]).toBeLessThan(8);
  expect(updated[1]).toBeGreaterThan(8);
});
