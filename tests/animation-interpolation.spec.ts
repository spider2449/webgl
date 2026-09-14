import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('interpolation evaluates transforms, endpoints and preserves history and projects', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.position.set(0, 0, 0); object.scale.setScalar(1); object.quaternion.identity(); e.insertKey();
    e.frame = 25; object.position.x = 8; object.scale.setScalar(3); object.rotation.z = Math.PI; e.insertKey();
    e.scrub(7); const linear = object.position.x;
    e.setAnimationInterpolation('smooth');
    const smooth = { x: object.position.x, scale: object.scale.x, angle: object.rotation.z };
    e.undo(); const undo = e.selected.userData.animationInterpolation ?? 'linear';
    e.redo(); const redo = e.selected.userData.animationInterpolation;
    const saved = e.snapshot(); e.load(JSON.parse(saved)); e.scrub(7);
    const restored = e.selected.position.x;
    e.setAnimationInterpolation('constant');
    e.scrub(24.9); const held = e.selected.position.x;
    e.scrub(25); const boundary = e.selected.position.x;
    e.scrub(250); const after = e.selected.position.x;
    const before = e.snapshot();
    let invalid = false; try { e.setAnimationInterpolation('bad'); } catch { invalid = true; }
    const unchanged = before === e.snapshot();
    const project = JSON.parse(before);
    project.scene.object.children[0].userData.animationInterpolation = 'bad';
    let rejected = false; try { e.load(project); } catch { rejected = true; }
    return { linear, smooth, undo, redo, restored, held, boundary, after, invalid, unchanged, rejected, loadUnchanged: before === e.snapshot() };
  });
  expect(result.linear).toBe(2);
  expect(result.smooth.x).toBe(1.25);
  expect(result.smooth.scale).toBe(1.3125);
  expect(result.smooth.angle).toBeCloseTo(Math.PI * 0.15625);
  expect(result).toMatchObject({ undo: 'linear', redo: 'smooth', restored: 1.25, held: 0, boundary: 8, after: 8, invalid: true, unchanged: true, rejected: true, loadUnchanged: true });
});

test('property selector follows selection and exports STEP and sampled smooth GLB tracks', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge; e.selected.position.x = 0; e.insertKey();
    e.frame = 25; e.selected.position.x = 8; e.insertKey(); e.scrub(7);
  });
  await page.getByLabel('Animation interpolation', { exact: true }).selectOption('constant');
  expect(await page.evaluate(() => (window as any).__forge.selected.position.x)).toBe(0);
  for (const mode of ['constant', 'smooth']) {
    await page.getByLabel('Animation interpolation', { exact: true }).selectOption(mode);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-top').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const glb = Buffer.concat(chunks);
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const samplers = json.animations[0].samplers;
    expect(samplers.every((s: any) => s.interpolation === (mode === 'constant' ? 'STEP' : 'LINEAR'))).toBe(true);
    expect(json.accessors[samplers[0].input].count).toBe(mode === 'constant' ? 2 : 33);
    if (mode === 'smooth') {
      const accessor = json.accessors[samplers[0].output];
      const view = json.bufferViews[accessor.bufferView];
      const offset = 20 + glb.readUInt32LE(12) + 8 + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      expect(glb.readFloatLE(offset + 8 * 3 * 4)).toBeCloseTo(1.25);
    }
  }
  await page.evaluate(() => { const e = (window as any).__forge; e.add('sphere'); });
  await expect(page.getByLabel('Animation interpolation', { exact: true })).toHaveValue('linear');
  await page.evaluate(() => { const e = (window as any).__forge; e.select(e.content.getObjectByName('Cube')); });
  await expect(page.getByLabel('Animation interpolation', { exact: true })).toHaveValue('smooth');
  await page.locator('#animation-interpolation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/animation-interpolation.png' });
});
