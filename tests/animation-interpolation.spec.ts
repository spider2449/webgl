import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('transform key insertion authors nine independent scalar tracks and legacy keyframes fail closed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;

    e.frame = 1;
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    e.insertKey();

    e.frame = 25;
    object.position.set(8, 4, 2);
    object.rotation.set(0, Math.PI, 0);
    object.scale.set(3, 5, 7);
    e.insertKey();

    const tracks = structuredClone(object.userData.animationTracks);
    e.scrub(7);
    const sampled = {
      position: object.position.toArray(),
      rotationY: object.rotation.y,
      scale: object.scale.toArray(),
    };

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(7);
    const restored = {
      position: e.selected.position.toArray(),
      rotationY: e.selected.rotation.y,
      scale: e.selected.scale.toArray(),
    };

    const legacy = JSON.parse(saved);
    legacy.scene.object.children[0].userData.keyframes = [{
      frame: 1,
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }];
    let legacyRejected = false;
    try { e.load(legacy); } catch { legacyRejected = true; }

    const malformed = JSON.parse(saved);
    malformed.scene.object.children[0].userData.animationTracks['position.x'][0].value = null;
    let malformedRejected = false;
    try { e.load(malformed); } catch { malformedRejected = true; }

    return {
      tracks,
      sampled,
      restored,
      legacyRejected,
      malformedRejected,
      unchangedAfterReject: e.snapshot() === saved,
    };
  });

  expect(Object.keys(result.tracks)).toHaveLength(9);
  for (const keys of Object.values(result.tracks) as any[][]) {
    expect(keys.map(key => key.frame)).toEqual([1, 25]);
  }
  expect(result.sampled.position[0]).toBeCloseTo(2, 6);
  expect(result.sampled.position[1]).toBeCloseTo(1, 6);
  expect(result.sampled.position[2]).toBeCloseTo(0.5, 6);
  expect(result.sampled.rotationY).toBeCloseTo(Math.PI / 4, 6);
  expect(result.sampled.scale[0]).toBeCloseTo(1.5, 6);
  expect(result.sampled.scale[1]).toBeCloseTo(2, 6);
  expect(result.sampled.scale[2]).toBeCloseTo(2.5, 6);
  expect(result.restored).toEqual(result.sampled);
  expect(result.legacyRejected).toBe(true);
  expect(result.malformedRejected).toBe(true);
  expect(result.unchangedAfterReject).toBe(true);
});

test('scalar channels own independent key times and segment interpolation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;

    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();

    e.frame = 25;
    object.position.set(8, 8, 0);
    e.insertKey();

    e.frame = 49;
    object.position.set(16, 0, 0);
    e.insertKey();

    e.scrub(25);
    e.retimeChannelKey('position.x', 37);
    e.setKeyInterpolation(1, 'position.x', 'constant');
    e.setKeyInterpolation(1, 'position.y', 'bezier');
    e.setKeyInterpolation(25, 'position.y', 'constant');

    e.scrub(19);
    const first = { x: object.position.x, y: object.position.y };
    e.scrub(31);
    const second = { x: object.position.x, y: object.position.y };

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const tracks = structuredClone(e.selected.userData.animationTracks);

    return { first, second, tracks };
  });

  expect(result.tracks['position.x'].map((key: any) => key.frame)).toEqual([1, 37, 49]);
  expect(result.tracks['position.y'].map((key: any) => key.frame)).toEqual([1, 25, 49]);
  expect(result.tracks['position.x'][0].interpolation).toBe('constant');
  expect(result.tracks['position.y'][0].interpolation).toBe('bezier');
  expect(result.tracks['position.y'][1].interpolation).toBe('constant');

  expect(result.first.x).toBeCloseTo(0, 6);
  expect(result.first.y).toBeGreaterThan(0);
  expect(result.first.y).toBeLessThan(8);
  expect(result.second.x).toBeGreaterThan(0);
  expect(result.second.x).toBeLessThan(8);
  expect(result.second.y).toBeCloseTo(8, 6);
});

test('Bezier scalar tracks persist and bake evaluated values into GLB', async ({ page }) => {
  const setup = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;

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
    invalidMode.scene.object.children[0].userData.animationTracks['position.x'][0].interpolation = 'catmull';
    let invalidModeRejected = false;
    try { e.load(invalidMode); } catch { invalidModeRejected = true; }

    const invalidHandle = JSON.parse(saved);
    invalidHandle.scene.object.children[0].userData.animationTracks['position.x'][0].right = [8, null];
    let invalidHandleRejected = false;
    try { e.load(invalidHandle); } catch { invalidHandleRejected = true; }

    const unknownField = JSON.parse(saved);
    unknownField.scene.object.children[0].userData.animationTracks['position.x'][0].tension = 0.5;
    let unknownFieldRejected = false;
    try { e.load(unknownField); } catch { unknownFieldRejected = true; }

    e.load(JSON.parse(saved));
    return {
      expectedAtFrame7,
      track: structuredClone(e.selected.userData.animationTracks['position.x']),
      invalidModeRejected,
      invalidHandleRejected,
      unknownFieldRejected,
    };
  });

  expect(setup.expectedAtFrame7).toBeGreaterThan(2);
  expect(setup.track[0].interpolation).toBe('bezier');
  expect(setup.track[0].right[0]).toBeCloseTo(8, 6);
  expect(setup.track[0].right[1]).toBeCloseTo(6, 6);
  expect(setup.track[1].left[0]).toBeCloseTo(-8, 6);
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

test('Constant scalar segments bake hold behavior into GLB', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
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

test('tangent modes persist on scalar keys and malformed tangent metadata fails closed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;

    e.frame = 1; object.position.x = 0; e.insertKey();
    e.frame = 25; object.position.x = 8; e.insertKey();
    e.frame = 49; object.position.x = 16; e.insertKey();

    e.setKeyInterpolation(1, 'position.x', 'bezier');
    e.setKeyInterpolation(25, 'position.x', 'bezier');
    e.setKeyTangentMode(25, 'position.x', 'aligned');

    const alignedSaved = e.snapshot();
    e.load(JSON.parse(alignedSaved));
    const aligned = structuredClone(e.selected.userData.animationTracks['position.x'][1]);

    e.setKeyTangentMode(25, 'position.x', 'auto');
    const autoSaved = e.snapshot();
    e.load(JSON.parse(autoSaved));
    const auto = structuredClone(e.selected.userData.animationTracks['position.x'][1]);

    const invalid = JSON.parse(autoSaved);
    invalid.scene.object.children[0].userData.animationTracks['position.x'][1].tangent = 'vector';
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
