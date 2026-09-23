import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.frame = 1;
    e.selected.position.set(0, 1, 2);
    e.selected.scale.set(1, 1, 1);
    e.insertKey();

    e.frame = 25;
    e.selected.position.set(8, 3, 4);
    e.selected.scale.set(2, 3, 4);
    e.insertKey();
  });
});

test('edits one scalar track and preserves unrelated channels through history and reload', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(25);
    const before = structuredClone(e.selected.userData.animationTracks);

    e.editKeyChannel('position.x', 12);
    const afterPosition = structuredClone(e.selected.userData.animationTracks);
    e.editKeyChannel('scale.z', 6);
    const afterScale = structuredClone(e.selected.userData.animationTracks);

    e.scrub(13);
    const midpoint = {
      x: e.selected.position.x,
      y: e.selected.position.y,
      scaleZ: e.selected.scale.z,
    };

    e.undo();
    const undo = structuredClone(e.selected.userData.animationTracks);
    e.redo();
    const redo = structuredClone(e.selected.userData.animationTracks);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restored = structuredClone(e.selected.userData.animationTracks);

    return { before, afterPosition, afterScale, midpoint, undo, redo, restored };
  });

  expect(result.afterPosition['position.x'][1].value).toBe(12);
  expect(result.afterPosition['position.y']).toEqual(result.before['position.y']);
  expect(result.afterPosition['scale.z']).toEqual(result.before['scale.z']);

  expect(result.afterScale['position.x'][1].value).toBe(12);
  expect(result.afterScale['scale.z'][1].value).toBe(6);
  expect(result.afterScale['position.y']).toEqual(result.before['position.y']);

  expect(result.midpoint.x).toBeCloseTo(6, 6);
  expect(result.midpoint.y).toBeCloseTo(2, 6);
  expect(result.midpoint.scaleZ).toBeCloseTo(3.5, 6);
  expect(result.undo).toEqual(result.afterPosition);
  expect(result.redo).toEqual(result.afterScale);
  expect(result.restored).toEqual(result.afterScale);
});

test('edits unwrapped rotation scalar tracks and keeps evaluated quaternion synchronized', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;
    const Quaternion = object.quaternion.constructor as any;
    const Euler = object.rotation.constructor as any;

    delete object.userData.animationTracks;

    e.frame = 1;
    object.rotation.set(rad(10), rad(270), rad(30), 'XYZ');
    e.insertKey();

    e.frame = 25;
    object.rotation.set(rad(20), rad(540), rad(40), 'XYZ');
    e.insertKey();
    e.scrub(25);

    e.editKeyChannel('rotation.y', 720);
    const edited = structuredClone(object.userData.animationTracks);
    const expected = new Quaternion()
      .setFromEuler(new Euler(rad(20), rad(720), rad(40), 'XYZ'))
      .toArray();
    const storedQuaternion = object.quaternion.toArray();

    e.scrub(13);
    const midpoint = [
      deg(object.rotation.x),
      deg(object.rotation.y),
      deg(object.rotation.z),
    ];

    e.undo();
    const undoY = deg(e.selected.userData.animationTracks['rotation.y'][1].value);
    e.redo();
    const redoY = deg(e.selected.userData.animationTracks['rotation.y'][1].value);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(25);
    const restored = [
      deg(e.selected.rotation.x),
      deg(e.selected.rotation.y),
      deg(e.selected.rotation.z),
    ];

    return { edited, expected, storedQuaternion, midpoint, undoY, redoY, restored };
  });

  expect(result.edited['rotation.x'][1].value * 180 / Math.PI).toBeCloseTo(20, 6);
  expect(result.edited['rotation.y'][1].value * 180 / Math.PI).toBeCloseTo(720, 6);
  expect(result.edited['rotation.z'][1].value * 180 / Math.PI).toBeCloseTo(40, 6);

  const dot = result.expected.reduce(
    (sum: number, value: number, index: number) => sum + value * result.storedQuaternion[index],
    0,
  );
  expect(Math.abs(dot)).toBeCloseTo(1, 10);

  expect(result.midpoint[0]).toBeCloseTo(15, 6);
  expect(result.midpoint[1]).toBeCloseTo(495, 6);
  expect(result.midpoint[2]).toBeCloseTo(35, 6);
  expect(result.undoY).toBeCloseTo(540, 6);
  expect(result.redoY).toBeCloseTo(720, 6);
  expect(result.restored[0]).toBeCloseTo(20, 6);
  expect(result.restored[1]).toBeCloseTo(720, 6);
  expect(result.restored[2]).toBeCloseTo(40, 6);
});

test('invalid scalar channel edits preserve scene and history', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const check = (action: () => void) => {
      const before = e.snapshot();
      const history = JSON.stringify(e.history);
      const index = e.historyIndex;
      const frame = e.frame;
      let rejected = false;
      try { action(); } catch { rejected = true; }
      return {
        rejected,
        unchanged:
          before === e.snapshot() &&
          history === JSON.stringify(e.history) &&
          index === e.historyIndex &&
          frame === e.frame,
      };
    };

    e.scrub(25);
    const invalidValue = check(() => e.editKeyChannel('position.x', Number.NaN));
    const invalidChannel = check(() => e.editKeyChannel('rotation.w', 1));

    e.scrub(12);
    const missingKey = check(() => e.editKeyChannel('position.y', 9));

    e.scrub(25);
    e.setEditMode(true);
    const editMode = check(() => e.editKeyChannel('scale.x', 2));
    e.setEditMode(false);

    e.playing = true;
    const playing = check(() => e.editKeyChannel('scale.x', 2));
    e.playing = false;

    e.select(null);
    const noSelection = check(() => e.editKeyChannel('position.z', 2));

    return { invalidValue, invalidChannel, missingKey, editMode, playing, noSelection };
  });

  expect(Object.values(result).every((item: any) => item.rejected && item.unchanged)).toBe(true);
});

test('playback refreshes selected object transform values while the timeline advances', async ({ page }) => {
  await page.evaluate(() => (window as any).__forge.scrub(1));

  const positionX = page.locator('[data-transform="position"][data-axis="x"]');
  await expect(positionX).toHaveValue('0.000');
  await page.locator('#play').click();

  await page.waitForFunction(() => {
    const e = (window as any).__forge;
    const input = document.querySelector<HTMLInputElement>('[data-transform="position"][data-axis="x"]');
    if (!e.playing || !input || e.frame < 3) return false;
    return Math.abs(Number(input.value) - e.selected.position.x) < 0.02 && Number(input.value) > 0;
  });

  expect(await page.evaluate(() => (window as any).__forge.playing)).toBe(true);
  await page.locator('#play').click();
});

test('Graph Editor vertical drag edits only the active scalar key and GLB exports it', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.locator('[data-graph-channel="position.x"]').click();
  const marker = graph.locator('.graph-key-point[data-frame="25"]');
  const box = await marker.boundingBox();
  expect(box).not.toBeNull();

  const before = Number(await marker.getAttribute('data-value'));
  expect(before).toBeCloseTo(8, 6);

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 36, { steps: 8 });
  await page.mouse.up();

  const edited = await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'][1].value
  );
  expect(edited).toBeGreaterThan(8);

  const untouchedY = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks['position.y'])
  );
  expect(untouchedY.map((key: any) => key.value)).toEqual([1, 3]);

  const pending = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));

  const glb = Buffer.concat(chunks);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const positionChannel = json.animations[0].channels.find((channel: any) => channel.target.path === 'translation');
  const sampler = json.animations[0].samplers[positionChannel.sampler];
  const accessor = json.accessors[sampler.output];
  const view = json.bufferViews[accessor.bufferView];
  const binaryStart = 28 + jsonLength;
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  expect(glb.readFloatLE(offset + 3 * 4)).toBeCloseTo(edited, 4);

  await page.locator('[data-graph-channel="scale.z"]').click();
  await expect(graph).toHaveAttribute('data-channel', 'scale.z');
  expect(Number(await graph.locator('.graph-key-point[data-frame="25"]').getAttribute('data-value')))
    .toBeCloseTo(4, 6);
});
