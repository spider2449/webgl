import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.position.x = 0; e.insertKey();
    e.frame = 25; e.selected.position.x = 8; e.insertKey();
    e.setAnimationInterpolation('smooth');
  });
});

test('move and copy preserve pose, interpolation, unrelated objects and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, cube = e.selected;
    const source = structuredClone(cube.userData.keyframes[1]);
    e.add('sphere'); const sphere = e.selected; e.insertKey();
    const other = JSON.stringify(sphere.toJSON()); e.select(cube);
    e.retimeKey(49);
    const moved = structuredClone(cube.userData.keyframes);
    const isolated = JSON.stringify(sphere.toJSON()) === other;
    e.scrub(13); const value = cube.position.x;
    e.scrub(49); e.retimeKey(73, true);
    const copied = structuredClone(cube.userData.keyframes);
    const independent = cube.userData.keyframes[1].position !== cube.userData.keyframes[2].position;
    const followed = e.frame;
    e.undo(); const undone = structuredClone(e.selected.userData.keyframes);
    e.redo(); const redone = structuredClone(e.selected.userData.keyframes);
    e.load(JSON.parse(e.snapshot()));
    const restored = e.content.getObjectByName('Cube');
    return { source, moved, copied, isolated, independent, value, followed, undone, redone,
      restored: restored.userData.keyframes, mode: restored.userData.animationInterpolation };
  });
  expect(result.moved.map(k => k.frame)).toEqual([1, 49]);
  expect(result.moved[1]).toEqual({ ...result.source, frame: 49 });
  expect(result.copied).toEqual([...result.moved, { ...result.source, frame: 73 }]);
  expect(result).toMatchObject({ isolated: true, independent: true, value: 1.25, followed: 73, mode: 'smooth' });
  expect(result.undone).toEqual(result.moved);
  expect(result.redone).toEqual(result.copied);
  expect(result.restored).toEqual(result.copied);
});

test('invalid timing requests preserve scene, frame and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const check = (target: number, copy = false) => {
      const before = e.snapshot(), frame = e.frame, history = JSON.stringify(e.history), index = e.historyIndex;
      let rejected = false; try { e.retimeKey(target, copy); } catch { rejected = true; }
      return { rejected, unchanged: before === e.snapshot() && e.frame === frame && history === JSON.stringify(e.history) && index === e.historyIndex };
    };
    const invalid = [0, 251, 1.5, NaN, Infinity, 1].map(n => check(n));
    invalid.push(check(25, true));
    const noop = check(25);
    e.scrub(12); invalid.push(check(49));
    e.scrub(24.9); invalid.push(check(49));
    e.scrub(25); e.setEditMode(true); invalid.push(check(49)); e.setEditMode(false);
    e.playing = true; invalid.push(check(49)); e.playing = false;
    e.select(null); invalid.push(check(49));
    return { invalid, noop };
  });
  expect(result.invalid.every(r => r.rejected && r.unchanged)).toBe(true);
  expect(result.noop).toEqual({ rejected: false, unchanged: true });
});

test('Graph Editor moves and Alt-drags copies while GLB uses the resulting timing', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();
  const frameX = (frame: number) => graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;

  const moveMarker = graph.locator('.graph-key-point[data-frame="25"]');
  const moveBox = await moveMarker.boundingBox();
  expect(moveBox).not.toBeNull();
  const moveY = moveBox!.y + moveBox!.height / 2;
  await page.mouse.move(moveBox!.x + moveBox!.width / 2, moveY);
  await page.mouse.down();
  await page.mouse.move(frameX(49), moveY, { steps: 10 });
  await page.mouse.up();

  let frames = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(frames).toEqual([1, 49]);
  await expect(page.locator('#current-frame')).toHaveValue('49');

  const copyMarker = graph.locator('.graph-key-point[data-frame="49"]');
  const copyBox = await copyMarker.boundingBox();
  expect(copyBox).not.toBeNull();
  const copyY = copyBox!.y + copyBox!.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(copyBox!.x + copyBox!.width / 2, copyY);
  await page.mouse.down();
  await page.mouse.move(frameX(73), copyY, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  frames = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(frames).toEqual([1, 49, 73]);
  expect(await page.evaluate(() => {
    const keys = (window as any).__forge.selected.userData.keyframes;
    return keys[1].position !== keys[2].position && keys[1].frame === 49 && keys[2].frame === 73;
  })).toBe(true);

  await page.evaluate(() => (window as any).__forge.undo());
  frames = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(frames).toEqual([1, 49]);
  await page.evaluate(() => (window as any).__forge.redo());
  frames = await page.evaluate(() => (window as any).__forge.selected.userData.keyframes.map((key: any) => key.frame));
  expect(frames).toEqual([1, 49, 73]);

  await page.evaluate(() => (window as any).__forge.setAnimationInterpolation('linear'));
  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending, stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks), jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const accessor = json.accessors[json.animations[0].samplers[0].input], view = json.bufferViews[accessor.bufferView];
  const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  expect(Array.from({ length: accessor.count }, (_, i) => glb.readFloatLE(offset + i * 4))).toEqual([0, 2, 3]);

  await graph.screenshot({ path: 'test-results/keyframe-timing.png' });
});

