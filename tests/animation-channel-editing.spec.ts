import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.position.set(0, 1, 2);
    e.selected.scale.set(1, 1, 1);
    e.insertKey();
    e.frame = 25;
    e.selected.position.set(8, 3, 4);
    e.selected.scale.set(2, 3, 4);
    e.insertKey();
    e.setAnimationInterpolation('linear');
  });
});

test('edits one scalar key channel and preserves unrelated channels through history and reload', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(25);
    const before = structuredClone(e.selected.userData.keyframes);
    e.editKeyChannel('position.x', 12);
    const afterPosition = structuredClone(e.selected.userData.keyframes);
    e.editKeyChannel('scale.z', 6);
    const afterScale = structuredClone(e.selected.userData.keyframes);
    e.scrub(13);
    const midpoint = { x: e.selected.position.x, y: e.selected.position.y, scaleZ: e.selected.scale.z };
    e.undo();
    const undo = structuredClone(e.selected.userData.keyframes);
    e.redo();
    const redo = structuredClone(e.selected.userData.keyframes);
    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restored = structuredClone(e.selected.userData.keyframes);
    return { before, afterPosition, afterScale, midpoint, undo, redo, restored };
  });

  expect(result.afterPosition[1].position).toEqual([12, 3, 4]);
  expect(result.afterPosition[1].scale).toEqual([2, 3, 4]);
  expect(result.afterScale[1].position).toEqual([12, 3, 4]);
  expect(result.afterScale[1].scale).toEqual([2, 3, 6]);
  expect(result.afterScale[0]).toEqual(result.before[0]);
  expect(result.midpoint).toEqual({ x: 6, y: 2, scaleZ: 3.5 });
  expect(result.undo).toEqual(result.afterPosition);
  expect(result.redo).toEqual(result.afterScale);
  expect(result.restored).toEqual(result.afterScale);
});

test('invalid scalar channel edits preserve scene and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const check = (action: () => void) => {
      const before = e.snapshot(), history = JSON.stringify(e.history), index = e.historyIndex, frame = e.frame;
      let rejected = false;
      try { action(); } catch { rejected = true; }
      return { rejected, unchanged: before === e.snapshot() && history === JSON.stringify(e.history) && index === e.historyIndex && frame === e.frame };
    };
    e.scrub(25);
    const invalidValue = check(() => e.editKeyChannel('position.x', Number.NaN));
    const invalidChannel = check(() => e.editKeyChannel('rotation.x', 1));
    e.scrub(12);
    const missingKey = check(() => e.editKeyChannel('position.y', 9));
    e.scrub(25); e.setEditMode(true);
    const editMode = check(() => e.editKeyChannel('scale.x', 2));
    e.setEditMode(false); e.playing = true;
    const playing = check(() => e.editKeyChannel('scale.x', 2));
    e.playing = false; e.select(null);
    const noSelection = check(() => e.editKeyChannel('position.z', 2));
    return { invalidValue, invalidChannel, missingKey, editMode, playing, noSelection };
  });
  expect(Object.values(result).every(item => item.rejected && item.unchanged)).toBe(true);
});

test('animation channel UI edits the selected key and GLB exports the authored value', async ({ page }) => {
  await page.getByLabel('Select keyframe', { exact: true }).selectOption('25');
  await page.getByLabel('Animation channel', { exact: true }).selectOption('position.x');
  await expect(page.getByLabel('Animation channel value', { exact: true })).toHaveValue('8');
  await page.getByLabel('Animation channel value', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Apply channel value', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('updated');
  expect(await page.evaluate(() => (window as any).__forge.selected.userData.keyframes[1].position[0])).toBe(12);

  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending, stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks), jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const positionChannel = json.animations[0].channels.find((channel: any) => channel.target.path === 'translation');
  const sampler = json.animations[0].samplers[positionChannel.sampler];
  const accessor = json.accessors[sampler.output], view = json.bufferViews[accessor.bufferView];
  const binaryStart = 28 + jsonLength;
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  expect(glb.readFloatLE(offset + 3 * 4)).toBeCloseTo(12);

  await page.getByLabel('Animation channel', { exact: true }).selectOption('scale.z');
  await expect(page.getByLabel('Animation channel value', { exact: true })).toHaveValue('4');
  await page.screenshot({ path: 'test-results/animation-channel-editing.png' });
});
