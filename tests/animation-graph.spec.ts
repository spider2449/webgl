import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Graph Editor visualizes Linear, Constant and Smooth for the selected scalar channel', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 0, 0);
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(7);
  });

  const graph = page.getByLabel('Animation graph editor');
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(graph).toBeVisible();
  await expect(graph).toHaveAttribute('data-channel', 'position.x');
  await expect(graph).toHaveAttribute('data-mode', 'linear');
  const channelButtons = page.locator('[data-graph-channel]');
  await expect(channelButtons).toHaveCount(9);
  await expect(page.locator('[data-graph-channel="position.x"]')).toHaveClass(/active/);
  await expect(page.locator('[data-graph-channel="position.x"] small')).toHaveText('LIN');
  await expect(graph.locator('.graph-key-point')).toHaveCount(2);
  await expect(page.locator('#animation-graph-title')).toHaveText('Location X');
  await expect(page.locator('#animation-graph-detail')).toContainText('Linear');

  const linearPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(linearPath).toBeTruthy();
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('33');

  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('constant');
  await expect(graph).toHaveAttribute('data-mode', 'constant');
  await expect(page.locator('#animation-graph-detail')).toContainText('Constant');
  const constantPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(constantPath).not.toBe(linearPath);
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('4');

  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('smooth');
  await expect(graph).toHaveAttribute('data-mode', 'smooth');
  await expect(page.locator('#animation-graph-detail')).toContainText('Smooth');
  await expect(page.locator('[data-graph-channel="position.x"] small')).toHaveText('SMT');
  const smoothPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(smoothPath).not.toBe(linearPath);
  expect(smoothPath).not.toBe(constantPath);
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('33');

  await page.evaluate(() => (window as any).__forge.scrub(13));
  await expect(graph.locator('.graph-playhead')).toHaveAttribute('data-frame', '13');

  const keyValues = await graph.locator('.graph-key-point').evaluateAll(nodes =>
    nodes.map(node => ({
      frame: Number((node as SVGElement).dataset.frame),
      value: Number((node as SVGElement).dataset.value),
    }))
  );
  expect(keyValues).toEqual([{ frame: 1, value: 0 }, { frame: 25, value: 8 }]);

  await graph.screenshot({ path: 'test-results/animation-graph-editor.png' });
});

test('Graph Editor preserves unwrapped multi-turn rotation values', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.rotation.set(0, 270 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.rotation.set(0, 720 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(13);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.locator('[data-graph-channel="rotation.y"]').click();
  await expect(page.getByLabel('Animation channel', { exact: true })).toHaveValue('rotation.y');

  const graph = page.getByLabel('Animation graph editor');
  await expect(graph).toHaveAttribute('data-channel', 'rotation.y');
  await expect(graph).toHaveAttribute('data-mode', 'linear');
  await expect(page.locator('#animation-graph-title')).toHaveText('Rotation Y');

  const values = await graph.locator('.graph-key-point').evaluateAll(nodes =>
    nodes.map(node => Number((node as SVGElement).dataset.value))
  );
  expect(values[0]).toBeCloseTo(270, 6);
  expect(values[1]).toBeCloseTo(720, 6);

  const detail = await page.locator('#animation-graph-detail').textContent();
  expect(detail).toContain('Linear');
  expect(detail).toContain('to');
});


test('Graph Editor drags a scalar key value and commits one undoable edit', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 0, 0);
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(25);
  });
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const graph = page.getByLabel('Animation graph editor');
  const marker = graph.locator('.graph-key-point[data-frame="25"]');
  const box = await marker.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 36, { steps: 8 });
  await page.mouse.up();

  const edited = await page.evaluate(() => {
    const e = (window as any).__forge;
    const key = e.selected.userData.keyframes.find((item: any) => item.frame === 25);
    return { value: key.position[0], frame: e.frame, objectValue: e.selected.position.x, canUndo: e.canUndo };
  });
  expect(edited.value).toBeGreaterThan(8);
  expect(edited.objectValue).toBeCloseTo(edited.value, 6);
  expect(edited.frame).toBe(25);
  expect(edited.canUndo).toBe(true);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() => {
    const e = (window as any).__forge;
    return e.selected.userData.keyframes.find((item: any) => item.frame === 25).position[0];
  });
  expect(restored).toBeCloseTo(8, 6);
});

test('Graph Editor horizontal drag retimes the whole transform key and rejects occupied frames', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 2, 3);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 4, 5);
    e.insertKey();
    e.scrub(1);
  });
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();
  const marker = graph.locator('.graph-key-point[data-frame="1"]');
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();

  const frameX = (frame: number) => graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;
  const centerY = markerBox!.y + markerBox!.height / 2;

  await page.mouse.move(markerBox!.x + markerBox!.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(frameX(10), centerY, { steps: 8 });
  await page.mouse.up();

  let keys = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => ({
    frame: key.frame,
    position: [...key.position],
  })));
  expect(keys.map((key: any) => key.frame)).toEqual([10, 25]);
  expect(keys[0].position).toEqual([0, 2, 3]);

  await page.evaluate(() => (window as any).__forge.undo());
  keys = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(keys).toEqual([1, 25]);

  const restoredMarker = graph.locator('.graph-key-point[data-frame="1"]');
  const restoredBox = await restoredMarker.boundingBox();
  expect(restoredBox).not.toBeNull();
  await page.mouse.move(restoredBox!.x + restoredBox!.width / 2, restoredBox!.y + restoredBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameX(25), restoredBox!.y + restoredBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  keys = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(keys).toEqual([1, 25]);
});
