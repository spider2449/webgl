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

test('UI selects, moves and copies keys and GLB uses the resulting timing', async ({ page }) => {
  const select = page.getByLabel('Select keyframe', { exact: true });
  await select.selectOption('25');
  await page.getByLabel('Keyframe target frame').fill('49');
  await page.getByRole('button', { name: 'Move keyframe', exact: true }).click();
  await expect(select).toHaveValue('49');
  await expect(page.locator('#current-frame')).toHaveValue('49');
  await page.getByLabel('Keyframe target frame').fill('1');
  await page.getByRole('button', { name: 'Copy keyframe', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('already has a keyframe');
  await page.getByLabel('Keyframe target frame').fill('73');
  await page.getByRole('button', { name: 'Copy keyframe', exact: true }).click();
  await expect(select).toHaveValue('73');
  await expect(select.locator('option')).toHaveText(['Choose a keyframe', 'Frame 1', 'Frame 49', 'Frame 73']);
  await page.getByLabel('Animation interpolation', { exact: true }).selectOption('linear');
  const pending = page.waitForEvent('download'); await page.locator('#export-top').click();
  const download = await pending, stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks), jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const accessor = json.accessors[json.animations[0].samplers[0].input], view = json.bufferViews[accessor.bufferView];
  const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  expect(Array.from({ length: accessor.count }, (_, i) => glb.readFloatLE(offset + i * 4))).toEqual([0, 2, 3]);
  await page.locator('#copy-key').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/keyframe-timing.png' });
  await page.evaluate(() => { const e = (window as any).__forge; e.scrub(12); });
  await expect(page.locator('#move-key')).toBeDisabled();
  await select.selectOption('49');
  await expect(page.locator('#move-key')).toBeEnabled();
  await page.evaluate(() => (window as any).__forge.setEditMode(true));
  await expect(select).toBeDisabled();
  await expect(page.locator('#move-key')).toBeDisabled();
  await page.evaluate(() => (window as any).__forge.setEditMode(false));
  await expect(select).toBeEnabled();
  await expect(page.locator('#move-key')).toBeEnabled();
  await page.evaluate(() => { const e = (window as any).__forge; e.add('sphere'); });
  await expect(select).toBeDisabled();
  await expect(select.locator('option')).toHaveCount(1);
});
