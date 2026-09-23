import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.frame = 1;
    e.selected.position.x = 0;
    e.insertKey();
    e.frame = 25;
    e.selected.position.x = 8;
    e.insertKey();
  });
});

test('channel move and copy preserve other channel timing, unrelated objects and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const cube = e.selected;
    const source = structuredClone(cube.userData.animationTracks['position.x'][1]);

    e.add('sphere');
    const sphere = e.selected;
    e.insertKey();
    const other = JSON.stringify(sphere.toJSON());

    e.select(cube);
    e.scrub(25);
    e.retimeChannelKey('position.x', 49);

    const movedX = structuredClone(cube.userData.animationTracks['position.x']);
    const untouchedY = structuredClone(cube.userData.animationTracks['position.y']);
    const isolated = JSON.stringify(sphere.toJSON()) === other;

    e.scrub(13);
    const value = cube.position.x;

    e.scrub(49);
    e.retimeChannelKey('position.x', 73, true);
    const copiedX = structuredClone(cube.userData.animationTracks['position.x']);
    const followed = e.frame;

    e.undo();
    const undone = structuredClone(e.selected.userData.animationTracks['position.x']);
    e.redo();
    const redone = structuredClone(e.selected.userData.animationTracks['position.x']);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restored = e.content.getObjectByName('Cube');

    return {
      source,
      movedX,
      untouchedY,
      copiedX,
      isolated,
      value,
      followed,
      undone,
      redone,
      restoredX: structuredClone(restored.userData.animationTracks['position.x']),
      restoredY: structuredClone(restored.userData.animationTracks['position.y']),
    };
  });

  expect(result.movedX.map((key: any) => key.frame)).toEqual([1, 49]);
  expect(result.movedX[1]).toEqual({ ...result.source, frame: 49 });
  expect(result.untouchedY.map((key: any) => key.frame)).toEqual([1, 25]);
  expect(result.copiedX).toEqual([...result.movedX, { ...result.source, frame: 73 }]);
  expect(result).toMatchObject({ isolated: true, value: 2, followed: 73 });
  expect(result.undone).toEqual(result.movedX);
  expect(result.redone).toEqual(result.copiedX);
  expect(result.restoredX).toEqual(result.copiedX);
  expect(result.restoredY).toEqual(result.untouchedY);
});

test('invalid channel timing requests preserve scene, frame and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const check = (target: number, copy = false) => {
      const before = e.snapshot();
      const frame = e.frame;
      const history = JSON.stringify(e.history);
      const index = e.historyIndex;
      let rejected = false;
      try { e.retimeChannelKey('position.x', target, copy); } catch { rejected = true; }
      return {
        rejected,
        unchanged:
          before === e.snapshot() &&
          e.frame === frame &&
          history === JSON.stringify(e.history) &&
          index === e.historyIndex,
      };
    };

    const invalid = [0, 251, 1.5, NaN, Infinity, 1].map(target => check(target));
    invalid.push(check(25, true));
    const noop = check(25);

    e.scrub(12);
    invalid.push(check(49));
    e.scrub(25);
    e.setEditMode(true);
    invalid.push(check(49));
    e.setEditMode(false);
    e.playing = true;
    invalid.push(check(49));
    e.playing = false;
    e.select(null);
    invalid.push(check(49));

    return { invalid, noop };
  });

  expect(result.invalid.every((item: any) => item.rejected && item.unchanged)).toBe(true);
  expect(result.noop).toEqual({ rejected: false, unchanged: true });
});

test('Graph Editor moves and Alt-drags only the active channel while GLB uses union timing', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();

  const frameX = (frame: number) =>
    graphBox!.x + (48 + (frame - 1) / 249 * 924) / 1000 * graphBox!.width;

  const moveMarker = graph.locator('.graph-key-point[data-frame="25"]');
  const moveBox = await moveMarker.boundingBox();
  expect(moveBox).not.toBeNull();
  const moveY = moveBox!.y + moveBox!.height / 2;

  await page.mouse.move(moveBox!.x + moveBox!.width / 2, moveY);
  await page.mouse.down();
  await page.mouse.move(frameX(49), moveY, { steps: 10 });
  await page.mouse.up();

  let tracks = await page.evaluate(() => structuredClone((window as any).__forge.selected.userData.animationTracks));
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([1, 49]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([1, 25]);
  expect(tracks['position.z'].map((key: any) => key.frame)).toEqual([1, 25]);
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

  tracks = await page.evaluate(() => structuredClone((window as any).__forge.selected.userData.animationTracks));
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([1, 49, 73]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([1, 25]);

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 49]);

  await page.evaluate(() => (window as any).__forge.redo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([1, 49, 73]);

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
  const accessor = json.accessors[sampler.input];
  const view = json.bufferViews[accessor.bufferView];
  const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  expect(Array.from({ length: accessor.count }, (_, index) => glb.readFloatLE(offset + index * 4)))
    .toEqual([0, 1, 2, 3]);

  await graph.screenshot({ path: 'test-results/keyframe-timing.png' });
});
