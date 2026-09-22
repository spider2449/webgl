import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Object panel no longer exposes the legacy Animation controls', async ({ page }) => {
  await expect(page.getByLabel('Animation interpolation', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Select keyframe', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Animation channel', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Animation channel interpolation', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Animation channel value', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move keyframe', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy keyframe', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(page.getByLabel('Animation graph editor')).toBeVisible();
  await expect(page.locator('[data-graph-channel]')).toHaveCount(9);
  await expect(page.getByLabel('Selected key interpolation')).toBeVisible();
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
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('3');

  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('constant');
  await expect(graph).toHaveAttribute('data-mode', 'constant');
  await expect(page.locator('#animation-graph-detail')).toContainText('Constant');
  const constantPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(constantPath).not.toBe(linearPath);
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('4');

  await page.getByLabel('Selected key interpolation').selectOption('');
  await page.evaluate(() => (window as any).__forge.setAnimationInterpolation('smooth'));
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
  await expect(page.locator('[data-graph-channel="rotation.y"]')).toHaveClass(/active/);

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

  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('bezier');
  const handleValue = Number(await graph.locator('.graph-handle[data-handle="right"]').getAttribute('data-handle-value'));
  expect(handleValue).toBeCloseTo(420, 4);
  const nativeHandleDegrees = await page.evaluate(() => {
    const right = (window as any).__forge.selected.userData.keyframes[0].curves['rotation.y'].right;
    return right[1] * 180 / Math.PI;
  });
  expect(nativeHandleDegrees).toBeCloseTo(150, 5);
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
  expect(keys).toHaveLength(2);
  expect(keys).toContain(25);
  expect(new Set(keys).size).toBe(2);
  expect(keys.filter((frame: number) => frame !== 25)[0]).toBeLessThan(25);
});


test('Graph Editor supports per-key outbound interpolation with mixed segments', async ({ page }) => {
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
    e.frame = 49;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(1);
  });
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('bezier');
  await expect(page.getByLabel('Selected key interpolation')).toHaveValue('bezier');
  await expect(graph.locator('.graph-handle[data-handle="right"]')).toHaveCount(1);

  await graph.locator('.graph-key-point[data-frame="25"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('constant');
  await expect(graph).toHaveAttribute('data-mode', 'mixed');
  await expect(page.locator('[data-graph-channel="position.x"] small')).toHaveText('MIX');
  await expect(graph.locator('.graph-handle[data-handle="left"]')).toHaveCount(1);

  const stored = await page.evaluate(() => {
    const e = (window as any).__forge;
    const keys = e.selected.userData.keyframes;
    e.scrub(13);
    const firstMidpoint = e.selected.position.x;
    e.scrub(37);
    const secondMidpoint = e.selected.position.x;
    return {
      first: structuredClone(keys[0].curves['position.x']),
      second: structuredClone(keys[1].curves['position.x']),
      firstMidpoint,
      secondMidpoint,
      saved: e.snapshot(),
    };
  });

  expect(stored.first.interpolation).toBe('bezier');
  expect(stored.first.right[0]).toBeCloseTo(8, 6);
  expect(stored.first.right[1]).toBeCloseTo(8 / 3, 6);
  expect(stored.second.interpolation).toBe('constant');
  expect(stored.second.left[0]).toBeCloseTo(-8, 6);
  expect(stored.second.left[1]).toBeCloseTo(-8 / 3, 6);
  expect(stored.firstMidpoint).toBeCloseTo(4, 5);
  expect(stored.secondMidpoint).toBeCloseTo(8, 6);

  const restored = await page.evaluate((saved) => {
    const e = (window as any).__forge;
    e.load(JSON.parse(saved));
    return e.selected.userData.keyframes.map((key: any) => key.curves?.['position.x'] ?? null);
  }, stored.saved);
  expect(restored[0].interpolation).toBe('bezier');
  expect(restored[1].interpolation).toBe('constant');

  await graph.locator('.graph-key-point[data-frame="49"]').click();
  await expect(page.getByLabel('Selected key interpolation')).toBeDisabled();
});

test('Graph Editor tangent handles change the real Bezier curve and undo in one step', async ({ page }) => {
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
    e.scrub(1);
  });
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await page.getByLabel('Selected key interpolation').selectOption('bezier');

  let handle = graph.locator('.graph-handle[data-handle="right"]');
  const beforeBox = await handle.boundingBox();
  expect(beforeBox).not.toBeNull();
  const pathBefore = await graph.locator('.graph-curve').getAttribute('d');
  await page.mouse.move(beforeBox!.x + beforeBox!.width / 2, beforeBox!.y + beforeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeBox!.x + beforeBox!.width / 2, beforeBox!.y - 32, { steps: 8 });
  const pathDuring = await graph.locator('.graph-curve').getAttribute('d');
  expect(pathDuring).not.toBe(pathBefore);
  await page.mouse.up();

  const edited = await page.evaluate(() => {
    const e = (window as any).__forge;
    const right = e.selected.userData.keyframes[0].curves['position.x'].right;
    e.scrub(13);
    return { right: [...right], midpoint: e.selected.position.x };
  });
  expect(edited.right[0]).toBeCloseTo(8, 1);
  expect(edited.right[1]).toBeGreaterThan(8 / 3);
  expect(edited.midpoint).toBeGreaterThan(4);

  await page.evaluate(() => (window as any).__forge.undo());
  const undone = await page.evaluate(() => {
    const e = (window as any).__forge;
    const curve = e.selected.userData.keyframes[0].curves['position.x'];
    e.scrub(13);
    return { interpolation: curve.interpolation, right: [...curve.right], midpoint: e.selected.position.x };
  });
  expect(undone.interpolation).toBe('bezier');
  expect(undone.right[0]).toBeCloseTo(8, 6);
  expect(undone.right[1]).toBeCloseTo(8 / 3, 6);
  expect(undone.midpoint).toBeCloseTo(4, 5);

  await page.evaluate(() => (window as any).__forge.redo());
  const redone = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(13);
    return {
      right: [...e.selected.userData.keyframes[0].curves['position.x'].right],
      midpoint: e.selected.position.x,
    };
  });
  expect(redone.right[1]).toBeGreaterThan(8 / 3);
  expect(redone.midpoint).toBeGreaterThan(4);
});


test('key curve metadata survives reinsert, retime and copy workflows', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];

    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 0, 0);
    e.insertKey();

    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.beginAnimationHandleDrag(1, 'position.x', 'right');
    e.previewAnimationHandleDrag(9, 6);
    e.endAnimationHandleDrag();

    e.scrub(1);
    object.position.x = 1;
    e.insertKey();
    const afterReinsert = structuredClone(object.userData.keyframes.find((key: any) => key.frame === 1).curves['position.x']);

    e.scrub(1);
    e.retimeKey(10, false);
    const afterMove = structuredClone(object.userData.keyframes.find((key: any) => key.frame === 10).curves['position.x']);

    e.scrub(10);
    e.retimeKey(15, true);
    const afterCopy = structuredClone(object.userData.keyframes.find((key: any) => key.frame === 15).curves['position.x']);

    return {
      afterReinsert,
      afterMove,
      afterCopy,
      frames: object.userData.keyframes.map((key: any) => key.frame),
    };
  });

  for (const curve of [result.afterReinsert, result.afterMove, result.afterCopy]) {
    expect(curve.interpolation).toBe('bezier');
    expect(curve.right[0]).toBeCloseTo(8, 6);
    expect(curve.right[1]).toBeCloseTo(6, 6);
  }
  expect(result.frames).toEqual([10, 15, 25]);
});
