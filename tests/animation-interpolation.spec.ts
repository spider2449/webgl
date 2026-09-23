import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('animation defaults to Linear and rejects removed legacy interpolation metadata', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 4, 2);
    object.scale.set(3, 5, 7);
    e.insertKey();

    e.scrub(7);
    const sampled = {
      position: object.position.toArray(),
      scale: object.scale.toArray(),
    };

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(7);
    const restored = {
      position: e.selected.position.toArray(),
      scale: e.selected.scale.toArray(),
    };

    const objectLegacy = JSON.parse(saved);
    objectLegacy.scene.object.children[0].userData.animationInterpolation = 'smooth';
    let objectLegacyRejected = false;
    try { e.load(objectLegacy); } catch { objectLegacyRejected = true; }

    const channelLegacy = JSON.parse(saved);
    channelLegacy.scene.object.children[0].userData.animationChannelInterpolation = { 'position.x': 'constant' };
    let channelLegacyRejected = false;
    try { e.load(channelLegacy); } catch { channelLegacyRejected = true; }

    return {
      sampled,
      restored,
      objectLegacyRejected,
      channelLegacyRejected,
      loadUnchanged: e.snapshot() === saved,
    };
  });

  expect(result.sampled.position[0]).toBeCloseTo(2, 6);
  expect(result.sampled.position[1]).toBeCloseTo(1, 6);
  expect(result.sampled.position[2]).toBeCloseTo(0.5, 6);
  expect(result.sampled.scale[0]).toBeCloseTo(1.5, 6);
  expect(result.sampled.scale[1]).toBeCloseTo(2, 6);
  expect(result.sampled.scale[2]).toBeCloseTo(2.5, 6);
  expect(result.restored).toEqual(result.sampled);
  expect(result.objectLegacyRejected).toBe(true);
  expect(result.channelLegacyRejected).toBe(true);
  expect(result.loadUnchanged).toBe(true);
});

test('different keys and channels evaluate independent Constant Linear and Bezier segments', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];

    e.frame = 1;
    object.position.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    e.insertKey();

    e.frame = 25;
    object.position.set(8, 8, 0);
    object.scale.set(3, 3, 3);
    e.insertKey();

    e.frame = 49;
    object.position.set(16, 0, 0);
    object.scale.set(5, 5, 5);
    e.insertKey();

    e.setKeyInterpolation(1, 'position.x', 'constant');
    e.setKeyInterpolation(1, 'position.y', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'linear');
    e.setKeyInterpolation(25, 'position.y', 'constant');
    e.setKeyInterpolation(1, 'scale.z', 'bezier');

    e.scrub(13);
    const first = {
      x: object.position.x,
      y: object.position.y,
      scaleZ: object.scale.z,
    };

    e.scrub(37);
    const second = {
      x: object.position.x,
      y: object.position.y,
      scaleZ: object.scale.z,
    };

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const curves = structuredClone(e.selected.userData.keyframes.map((key: any) => key.curves ?? null));

    return { first, second, curves };
  });

  expect(result.first.x).toBeCloseTo(0, 6);
  expect(result.first.y).toBeCloseTo(4, 5);
  expect(result.first.scaleZ).toBeCloseTo(2, 5);

  expect(result.second.x).toBeCloseTo(12, 6);
  expect(result.second.y).toBeCloseTo(8, 6);
  expect(result.second.scaleZ).toBeCloseTo(4, 6);

  expect(result.curves[0]['position.x'].interpolation).toBe('constant');
  expect(result.curves[0]['position.y'].interpolation).toBe('bezier');
  expect(result.curves[1]['position.x'].interpolation).toBe('linear');
  expect(result.curves[1]['position.y'].interpolation).toBe('constant');
});

test('per-key Bezier curves validate, persist and bake evaluated values into GLB', async ({ page }) => {
  const setup = await page.evaluate(() => {
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

    e.scrub(7);
    const expectedAtFrame7 = e.selected.position.x;
    const saved = e.snapshot();

    const invalidMode = JSON.parse(saved);
    invalidMode.scene.object.children[0].userData.keyframes[0].curves['position.x'].interpolation = 'catmull';
    let invalidModeRejected = false;
    try { e.load(invalidMode); } catch { invalidModeRejected = true; }

    const invalidHandle = JSON.parse(saved);
    invalidHandle.scene.object.children[0].userData.keyframes[0].curves['position.x'].right = [8, null];
    let invalidHandleRejected = false;
    try { e.load(invalidHandle); } catch { invalidHandleRejected = true; }

    const unknownField = JSON.parse(saved);
    unknownField.scene.object.children[0].userData.keyframes[0].curves['position.x'].tension = 0.5;
    let unknownFieldRejected = false;
    try { e.load(unknownField); } catch { unknownFieldRejected = true; }

    e.load(JSON.parse(saved));
    return {
      expectedAtFrame7,
      curves: structuredClone(e.selected.userData.keyframes.map((key: any) => key.curves?.['position.x'] ?? null)),
      invalidModeRejected,
      invalidHandleRejected,
      unknownFieldRejected,
    };
  });

  expect(setup.expectedAtFrame7).toBeGreaterThan(2);
  expect(setup.curves[0].interpolation).toBe('bezier');
  expect(setup.curves[0].right[0]).toBeCloseTo(8, 6);
  expect(setup.curves[0].right[1]).toBeCloseTo(6, 6);
  expect(setup.curves[1].left[0]).toBeCloseTo(-8, 6);
  expect(setup).toMatchObject({
    invalidModeRejected: true,
    invalidHandleRejected: true,
    unknownFieldRejected: true,
  });

  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const translationChannel = json.animations[0].channels.find((item: any) => item.target.path === 'translation');
  const sampler = json.animations[0].samplers[translationChannel.sampler];
  expect(sampler.interpolation).toBe('LINEAR');
  expect(json.accessors[sampler.input].count).toBe(33);

  const accessor = json.accessors[sampler.output];
  const view = json.bufferViews[accessor.bufferView];
  const binaryStart = 28 + jsonLength;
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const frame7Sample = offset + 8 * 3 * 4;
  expect(glb.readFloatLE(frame7Sample)).toBeCloseTo(setup.expectedAtFrame7, 4);
});

test('Constant per-key segments bake hold behavior into GLB', async ({ page }) => {
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
    e.setKeyInterpolation(1, 'position.x', 'constant');
  });

  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const glb = Buffer.concat(chunks);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const channel = json.animations[0].channels.find((item: any) => item.target.path === 'translation');
  const sampler = json.animations[0].samplers[channel.sampler];
  expect(sampler.interpolation).toBe('LINEAR');
  expect(json.accessors[sampler.input].count).toBe(3);

  const accessor = json.accessors[sampler.output];
  const view = json.bufferViews[accessor.bufferView];
  const binaryStart = 28 + jsonLength;
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  expect(glb.readFloatLE(offset)).toBeCloseTo(0, 6);
  expect(glb.readFloatLE(offset + 3 * 4)).toBeCloseTo(0, 4);
  expect(glb.readFloatLE(offset + 6 * 4)).toBeCloseTo(8, 4);
});

test('tangent modes persist and malformed tangent metadata fails closed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];

    e.frame = 1; object.position.set(0, 0, 0); e.insertKey();
    e.frame = 25; object.position.set(8, 0, 0); e.insertKey();
    e.frame = 49; object.position.set(16, 0, 0); e.insertKey();

    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'bezier');
    e.setKeyTangentMode(25, 'position.x', 'aligned');

    const alignedSaved = e.snapshot();
    e.load(JSON.parse(alignedSaved));
    const aligned = structuredClone(
      e.selected.userData.keyframes.find((key: any) => key.frame === 25).curves['position.x']
    );

    e.setKeyTangentMode(25, 'position.x', 'auto');
    const autoSaved = e.snapshot();
    e.load(JSON.parse(autoSaved));
    const auto = structuredClone(
      e.selected.userData.keyframes.find((key: any) => key.frame === 25).curves['position.x']
    );

    const invalid = JSON.parse(autoSaved);
    invalid.scene.object.children[0].userData.keyframes[1].curves['position.x'].tangent = 'vector';
    let invalidRejected = false;
    try { e.load(invalid); } catch { invalidRejected = true; }

    return {
      aligned,
      auto,
      invalidRejected,
      unchangedAfterReject: e.snapshot() === autoSaved,
    };
  });

  expect(result.aligned.tangent).toBe('aligned');
  expect(result.aligned.left).toHaveLength(2);
  expect(result.aligned.right).toHaveLength(2);
  expect(result.auto.tangent).toBe('auto');
  expect(result.auto.left).toBeUndefined();
  expect(result.auto.right).toBeUndefined();
  expect(result.invalidRejected).toBe(true);
  expect(result.unchangedAfterReject).toBe(true);
});
