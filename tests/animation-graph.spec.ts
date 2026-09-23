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


test('Shift-click multi-selects channel keys and removes the selected set atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  await expect(graph).toHaveAttribute('data-selected-frames', '1,20');
  await expect(graph.locator('.graph-key-point.selected')).toHaveCount(2);
  await expect(page.getByLabel('Selected key interpolation')).toBeEnabled();
  await expect(page.getByLabel('Selected key tangent mode')).toBeDisabled();

  const remove = page.getByRole('button', { name: /Remove .*selected channel key/ });
  await expect(remove).toBeEnabled();
  await remove.click();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([40]);
  await expect(graph).toHaveAttribute('data-selected-frames', '');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40]);
});

test('multi-selected Graph keys batch-assign segment interpolation in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(20, 'position.x', 'constant');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  const interpolation = page.getByLabel('Selected key interpolation');
  await expect(interpolation).toBeEnabled();
  await expect(interpolation).toHaveValue('mixed');
  await interpolation.selectOption('linear');

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x']
      .slice(0, 2)
      .map((key: any) => key.interpolation ?? 'linear')
  )).toEqual(['linear', 'linear']);
  await expect(graph).toHaveAttribute('data-selected-frames', '1,20');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x']
      .slice(0, 2)
      .map((key: any) => key.interpolation ?? 'linear')
  )).toEqual(['bezier', 'constant']);
});

test('multi-selected Bezier keys batch-assign tangent mode in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(20, 'position.x', 'bezier');
    e.setKeyTangentMode(1, 'position.x', 'free');
    e.setKeyTangentMode(20, 'position.x', 'auto');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  const tangent = page.getByLabel('Selected key tangent mode');
  await expect(tangent).toBeEnabled();
  await expect(tangent).toHaveValue('mixed');
  await tangent.selectOption('aligned');

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x']
      .slice(0, 2)
      .map((key: any) => key.tangent ?? 'free')
  )).toEqual(['aligned', 'aligned']);
  await expect(graph).toHaveAttribute('data-selected-frames', '1,20');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x']
      .slice(0, 2)
      .map((key: any) => key.tangent ?? 'free')
  )).toEqual(['free', 'auto']);
});

test('Graph Time Scale retimes selected keys around the selection midpoint in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(30); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(50); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(80); e.selected.position.x = 24; e.insertChannelKey('position.x');
    e.scrub(30);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const timeScale = page.getByLabel('Selected key time scale');
  const apply = page.getByRole('button', { name: 'Scale', exact: true });

  await expect(timeScale).toBeDisabled();
  await expect(apply).toBeDisabled();

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="30"]').click();
  await graph.locator('.graph-key-point[data-frame="40"]').click();
  await graph.locator('.graph-key-point[data-frame="50"]').click();
  await page.keyboard.up('Shift');

  await expect(timeScale).toBeEnabled();
  await expect(apply).toBeEnabled();
  await timeScale.fill('2');
  await apply.click();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([20, 40, 60, 80]);
  await expect(graph).toHaveAttribute('data-selected-frames', '20,40,60');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([30, 40, 50, 80]);
});

test('Graph Time Scale rejects collisions atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(30); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(45); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(30);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="30"]').click();
  await graph.locator('.graph-key-point[data-frame="40"]').click();
  await page.keyboard.up('Shift');

  await page.getByLabel('Selected key time scale').fill('2');
  await page.getByRole('button', { name: 'Scale', exact: true }).click();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([30, 40, 45]);
  await expect(graph).toHaveAttribute('data-selected-frames', '30,40');
  await expect(page.locator('#toast')).toContainText('collide');
});

test('Graph Time Scale rejects rounded frame collapse atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(30); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(32); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(30);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="30"]').click();
  await graph.locator('.graph-key-point[data-frame="32"]').click();
  await page.keyboard.up('Shift');

  await page.getByLabel('Selected key time scale').fill('0.1');
  await page.getByRole('button', { name: 'Scale', exact: true }).click();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([30, 32]);
  await expect(graph).toHaveAttribute('data-selected-frames', '30,32');
  await expect(page.locator('#toast')).toContainText('same frame');
});

test('Graph Time Scale rejects out-of-range targets atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(10); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(10);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="10"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  await page.getByLabel('Selected key time scale').fill('3');
  await page.getByRole('button', { name: 'Scale', exact: true }).click();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([10, 20]);
  await expect(graph).toHaveAttribute('data-selected-frames', '10,20');
  await expect(page.locator('#toast')).toContainText('1–250');
});

test('dragging a multi-selection moves every selected key by one shared delta', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();
  const frameX = (frame: number) =>
    graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  const anchor = graph.locator('.graph-key-point[data-frame="20"]');
  const box = await anchor.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;

  await page.mouse.move(box!.x + box!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(frameX(30), y, { steps: 8 });
  await page.mouse.up();

  const moved = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks['position.x'])
  );
  expect(moved.map((key: any) => key.frame)).toEqual([11, 30, 40]);
  expect(moved.map((key: any) => key.value)).toEqual([0, 8, 16]);
  await expect(graph).toHaveAttribute('data-selected-frames', '11,30');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40]);
});

test('multi-key drag collision is all-or-nothing', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();
  const frameX = (frame: number) =>
    graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  const anchor = graph.locator('.graph-key-point[data-frame="20"]');
  const box = await anchor.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;

  await page.mouse.move(box!.x + box!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(frameX(40), y, { steps: 8 });
  await page.mouse.up();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40]);
  await expect(graph).toHaveAttribute('data-selected-frames', '1,20');
});

test('Alt-drag multi-selection shows ghosts and commits all copies only on release', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 16; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();
  const frameX = (frame: number) =>
    graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;

  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="1"]').click();
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await page.keyboard.up('Shift');

  const anchor = graph.locator('.graph-key-point[data-frame="20"]');
  const box = await anchor.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;

  await page.keyboard.down('Alt');
  await page.mouse.move(box!.x + box!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(frameX(60), y, { steps: 8 });

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40]);
  await expect(graph.locator('.graph-key-point.ghost')).toHaveCount(2);
  const ghostFrames = await graph.locator('.graph-key-point.ghost').evaluateAll(nodes =>
    nodes.map(node => Number((node as SVGElement).dataset.frame)).sort((a, b) => a - b)
  );
  expect(ghostFrames).toEqual([41, 60]);

  await page.mouse.up();
  await page.keyboard.up('Alt');

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40, 41, 60]);
  await expect(graph).toHaveAttribute('data-selected-frames', '41,60');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 20, 40]);
});


test('plain Graph key selection does not create an undo entry', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(1); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  const before = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  await graph.locator('.graph-key-point[data-frame="20"]').click();

  const after = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  expect(after).toEqual(before);
  await expect(graph).toHaveAttribute('data-selected-frames', '20');
  await expect(page.locator('#current-frame')).toHaveValue('20');
});


test('empty-graph box drag replaces the active-channel key selection without history', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(60); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="60"]').click();

  const before = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  const a = await graph.locator('.graph-key-point[data-frame="20"]').boundingBox();
  const b = await graph.locator('.graph-key-point[data-frame="40"]').boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();

  await page.mouse.move(a!.x - 8, a!.y - 8);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width + 8, b!.y + b!.height + 8, { steps: 8 });

  await expect(graph.locator('.graph-selection-box')).toHaveAttribute('visibility', 'visible');
  await expect(graph).toHaveAttribute('data-selected-frames', '20,40');

  await page.mouse.up();
  await expect(graph.locator('.graph-selection-box')).toHaveAttribute('visibility', 'hidden');
  await expect(graph).toHaveAttribute('data-selected-frames', '20,40');

  const after = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));
  expect(after).toEqual(before);
});

test('Shift-box drag adds keys to the existing Graph selection', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(60); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="60"]').click();

  const a = await graph.locator('.graph-key-point[data-frame="20"]').boundingBox();
  const b = await graph.locator('.graph-key-point[data-frame="40"]').boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();

  await page.keyboard.down('Shift');
  await page.mouse.move(a!.x - 8, a!.y - 8);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width + 8, b!.y + b!.height + 8, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(graph).toHaveAttribute('data-selected-frames', '20,40,60');
  await expect(graph.locator('.graph-key-point.selected')).toHaveCount(3);
  await expect(page.getByLabel('Selected key interpolation')).toBeEnabled();
  await expect(page.getByLabel('Selected key tangent mode')).toBeDisabled();
});

test('Escape cancels Graph box selection and restores the pre-drag selection', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(60); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="60"]').click();

  const before = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  const a = await graph.locator('.graph-key-point[data-frame="20"]').boundingBox();
  const b = await graph.locator('.graph-key-point[data-frame="40"]').boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();

  await page.mouse.move(a!.x - 8, a!.y - 8);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width + 8, b!.y + b!.height + 8, { steps: 8 });
  await expect(graph).toHaveAttribute('data-selected-frames', '20,40');

  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(graph).toHaveAttribute('data-selected-frames', '60');
  await expect(graph.locator('.graph-selection-box')).toHaveAttribute('visibility', 'hidden');
  await expect(graph.locator('.graph-key-point[data-frame="60"]')).toHaveClass(/selected/);

  const after = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));
  expect(after).toEqual(before);
});


test('Escape clears Graph key selection before object selection', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20);
    e.selected.position.x = 4;
    e.insertChannelKey('position.x');
    e.scrub(20);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await expect(graph).toHaveAttribute('data-selected-frames', '20');

  const selectedUuid = await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null);
  expect(selectedUuid).not.toBeNull();

  await page.keyboard.press('Escape');

  await expect(graph).toHaveAttribute('data-selected-frames', '');
  expect(await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null)).toBe(selectedUuid);
});
