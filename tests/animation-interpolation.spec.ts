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


test('scalar channel interpolation overrides evaluate independently and survive project round trips', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    object.rotation.set(0, 0, 0, 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 8, 8);
    object.scale.set(3, 3, 3);
    object.rotation.set(0, Math.PI, 0, 'XYZ');
    e.insertKey();
    e.setAnimationInterpolation('linear');

    e.setAnimationChannelInterpolation('position.x', 'constant');
    e.setAnimationChannelInterpolation('position.y', 'smooth');
    e.setAnimationChannelInterpolation('position.z', 'linear');
    e.setAnimationChannelInterpolation('scale.z', 'smooth');
    e.setAnimationChannelInterpolation('rotation.y', 'constant');
    e.scrub(7);
    const linearDefault = {
      position: object.position.toArray(),
      scale: object.scale.toArray(),
      rotationY: object.rotation.y,
      overrides: structuredClone(object.userData.animationChannelInterpolation),
    };

    e.setAnimationInterpolation('smooth');
    e.scrub(7);
    const smoothDefault = {
      position: object.position.toArray(),
      scale: object.scale.toArray(),
      rotationY: object.rotation.y,
      overrides: structuredClone(object.userData.animationChannelInterpolation),
    };

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(7);
    const restored = {
      position: e.selected.position.toArray(),
      scale: e.selected.scale.toArray(),
      rotationY: e.selected.rotation.y,
      overrides: structuredClone(e.selected.userData.animationChannelInterpolation),
    };

    e.setAnimationChannelInterpolation('position.x', null);
    e.scrub(7);
    const cleared = e.selected.position.x;
    e.undo();
    e.scrub(7);
    const undo = e.selected.position.x;
    e.redo();
    e.scrub(7);
    const redo = e.selected.position.x;

    return { linearDefault, smoothDefault, restored, cleared, undo, redo };
  });

  expect(result.linearDefault.position[0]).toBeCloseTo(0, 6);
  expect(result.linearDefault.position[1]).toBeCloseTo(1.25, 6);
  expect(result.linearDefault.position[2]).toBeCloseTo(2, 6);
  expect(result.linearDefault.scale[2]).toBeCloseTo(1.3125, 6);
  expect(result.linearDefault.rotationY).toBeCloseTo(0, 6);
  expect(result.linearDefault.overrides).toEqual({
    'position.x': 'constant',
    'position.y': 'smooth',
    'position.z': 'linear',
    'scale.z': 'smooth',
    'rotation.y': 'constant',
  });

  expect(result.smoothDefault.position[0]).toBeCloseTo(0, 6);
  expect(result.smoothDefault.position[1]).toBeCloseTo(1.25, 6);
  expect(result.smoothDefault.position[2]).toBeCloseTo(2, 6);
  expect(result.smoothDefault.scale[2]).toBeCloseTo(1.3125, 6);
  expect(result.smoothDefault.rotationY).toBeCloseTo(0, 6);
  expect(result.restored).toEqual(result.smoothDefault);

  expect(result.cleared).toBeCloseTo(1.25, 6);
  expect(result.undo).toBeCloseTo(0, 6);
  expect(result.redo).toBeCloseTo(1.25, 6);
});

test('rotation channel interpolation upgrades legacy quaternion keys and malformed overrides fail closed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.rotation.set(10 * Math.PI / 180, 20 * Math.PI / 180, 30 * Math.PI / 180, 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.rotation.set(40 * Math.PI / 180, 50 * Math.PI / 180, 60 * Math.PI / 180, 'XYZ');
    e.insertKey();

    const before = object.userData.keyframes.map((key: any) => [...key.quaternion]);
    object.userData.keyframes.forEach((key: any) => { delete key.rotation; delete key.rotationOrder; });
    e.setAnimationChannelInterpolation('rotation.y', 'smooth');
    const upgraded = object.userData.keyframes.map((key: any) => ({
      rotation: [...key.rotation],
      rotationOrder: key.rotationOrder,
      quaternion: [...key.quaternion],
    }));
    const dots = upgraded.map((key: any, index: number) =>
      Math.abs(key.quaternion.reduce((sum: number, value: number, component: number) => sum + value * before[index][component], 0))
    );

    const validSaved = e.snapshot();
    const malformedChannel = JSON.parse(validSaved);
    malformedChannel.scene.object.children[0].userData.animationChannelInterpolation = { 'position.w': 'smooth' };
    let invalidChannelRejected = false;
    try { e.load(malformedChannel); } catch { invalidChannelRejected = true; }

    const missingEuler = JSON.parse(validSaved);
    const target = missingEuler.scene.object.children[0];
    target.userData.animationChannelInterpolation = { 'rotation.y': 'constant' };
    target.userData.keyframes.forEach((key: any) => { delete key.rotation; delete key.rotationOrder; });
    let missingEulerRejected = false;
    try { e.load(missingEuler); } catch { missingEulerRejected = true; }

    const mixedOrder = JSON.parse(validSaved);
    const mixedTarget = mixedOrder.scene.object.children[0];
    mixedTarget.userData.animationChannelInterpolation = { 'rotation.y': 'smooth' };
    mixedTarget.userData.keyframes[0].rotationOrder = 'XYZ';
    mixedTarget.userData.keyframes[1].rotationOrder = 'ZYX';
    let mixedOrderRejected = false;
    try { e.load(mixedOrder); } catch { mixedOrderRejected = true; }

    return {
      upgraded: upgraded.map((key: any) => ({
        rotation: key.rotation.map((value: number) => value * 180 / Math.PI),
        rotationOrder: key.rotationOrder,
      })),
      dots,
      invalidChannelRejected,
      missingEulerRejected,
      mixedOrderRejected,
      loadUnchanged: e.snapshot() === validSaved,
    };
  });

  expect(result.upgraded[0].rotationOrder).toBe('XYZ');
  expect(result.upgraded[1].rotationOrder).toBe('XYZ');
  expect(result.upgraded[0].rotation[0]).toBeCloseTo(10, 5);
  expect(result.upgraded[0].rotation[1]).toBeCloseTo(20, 5);
  expect(result.upgraded[0].rotation[2]).toBeCloseTo(30, 5);
  expect(result.dots.every((dot: number) => Math.abs(dot - 1) < 1e-10)).toBe(true);
  expect(result.invalidChannelRejected).toBe(true);
  expect(result.missingEulerRejected).toBe(true);
  expect(result.mixedOrderRejected).toBe(true);
  expect(result.loadUnchanged).toBe(true);
});

test('channel interpolation UI drives mixed playback and baked GLB export', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 8, 0);
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(7);
  });

  await page.getByLabel('Animation channel', { exact: true }).selectOption('position.x');
  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('constant');
  await page.getByLabel('Animation channel', { exact: true }).selectOption('position.y');
  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('smooth');

  const sampled = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(7);
    return {
      x: e.selected.position.x,
      y: e.selected.position.y,
      overrides: structuredClone(e.selected.userData.animationChannelInterpolation),
    };
  });
  expect(sampled.x).toBeCloseTo(0, 6);
  expect(sampled.y).toBeCloseTo(1.25, 6);
  expect(sampled.overrides).toEqual({ 'position.x': 'constant', 'position.y': 'smooth' });

  await page.getByLabel('Animation channel', { exact: true }).selectOption('position.x');
  await expect(page.getByLabel('Animation channel interpolation', { exact: true })).toHaveValue('constant');

  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const channel = json.animations[0].channels.find((item: any) => item.target.path === 'translation');
  const sampler = json.animations[0].samplers[channel.sampler];
  expect(sampler.interpolation).toBe('LINEAR');
  expect(json.accessors[sampler.input].count).toBe(34);

  const accessor = json.accessors[sampler.output];
  const view = json.bufferViews[accessor.bufferView];
  const binaryStart = 28 + jsonLength;
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const sample8 = offset + 8 * 3 * 4;
  expect(glb.readFloatLE(sample8)).toBeCloseTo(0, 5);
  expect(glb.readFloatLE(sample8 + 4)).toBeCloseTo(1.25, 4);
  const nearEnd = offset + 32 * 3 * 4;
  const endpoint = offset + 33 * 3 * 4;
  expect(glb.readFloatLE(nearEnd)).toBeCloseTo(0, 4);
  expect(glb.readFloatLE(endpoint)).toBeCloseTo(8, 4);

  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('');
  expect(await page.evaluate(() => (window as any).__forge.selected.userData.animationChannelInterpolation?.['position.x'])).toBeUndefined();
  await expect(page.getByLabel('Animation channel interpolation', { exact: true })).toHaveValue('');
});
