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

test('edits unwrapped rotation channels and keeps quaternion, interpolation, history and reload synchronized', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;
    const Quaternion = object.quaternion.constructor as any;
    const Euler = object.rotation.constructor as any;

    object.userData.keyframes = [];
    e.frame = 1;
    object.rotation.set(rad(10), rad(270), rad(30), 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.rotation.set(rad(20), rad(540), rad(40), 'XYZ');
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(25);

    e.editKeyChannel('rotation.y', 720);
    const edited = structuredClone(object.userData.keyframes);
    const expected = new Quaternion().setFromEuler(new Euler(rad(20), rad(720), rad(40), 'XYZ')).toArray();
    const storedQuaternion = edited[1].quaternion;

    e.scrub(13);
    const midpoint = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];

    e.undo();
    const undoY = deg(e.selected.userData.keyframes[1].rotation[1]);
    e.redo();
    const redoY = deg(e.selected.userData.keyframes[1].rotation[1]);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(25);
    const restored = [deg(e.selected.rotation.x), deg(e.selected.rotation.y), deg(e.selected.rotation.z)];

    return { edited, expected, storedQuaternion, midpoint, undoY, redoY, restored };
  });

  const editedRotation = result.edited[1].rotation.map((value: number) => value * 180 / Math.PI);
  expect(editedRotation[0]).toBeCloseTo(20, 6);
  expect(editedRotation[1]).toBeCloseTo(720, 6);
  expect(editedRotation[2]).toBeCloseTo(40, 6);
  const dot = result.expected.reduce((sum: number, value: number, index: number) => sum + value * result.storedQuaternion[index], 0);
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

test('editing a legacy quaternion-only rotation key upgrades it compatibly', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(1);
    const key = e.selected.userData.keyframes[0];
    delete key.rotation;
    delete key.rotationOrder;
    const oldQuaternion = [...key.quaternion];

    e.editKeyChannel('rotation.x', 45);
    const upgraded = e.selected.userData.keyframes[0];
    return {
      oldQuaternion,
      rotation: upgraded.rotation.map((value: number) => value * 180 / Math.PI),
      rotationOrder: upgraded.rotationOrder,
      quaternion: [...upgraded.quaternion],
      objectRotation: [e.selected.rotation.x, e.selected.rotation.y, e.selected.rotation.z].map((value: number) => value * 180 / Math.PI),
    };
  });

  expect(result.rotationOrder).toBe('XYZ');
  expect(result.rotation[0]).toBeCloseTo(45, 6);
  expect(result.rotation[1]).toBeCloseTo(20, 6);
  expect(result.rotation[2]).toBeCloseTo(0, 6);
  expect(result.objectRotation[0]).toBeCloseTo(45, 6);
  expect(result.objectRotation[1]).toBeCloseTo(20, 6);
  expect(result.objectRotation[2]).toBeCloseTo(0, 6);
  expect(result.quaternion).not.toEqual(result.oldQuaternion);
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
    const invalidChannel = check(() => e.editKeyChannel('rotation.w', 1));
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

  await page.getByLabel('Animation channel', { exact: true }).selectOption('rotation.y');
  expect(Number(await page.getByLabel('Animation channel value', { exact: true }).inputValue())).toBeCloseTo(20, 6);
  await page.getByLabel('Animation channel value', { exact: true }).fill('540');
  await page.getByRole('button', { name: 'Apply channel value', exact: true }).click();
  const rotation = await page.evaluate(() => {
    const key = (window as any).__forge.selected.userData.keyframes[1];
    return {
      degrees: key.rotation[1] * 180 / Math.PI,
      objectDegrees: (window as any).__forge.selected.rotation.y * 180 / Math.PI,
      quaternion: key.quaternion,
    };
  });
  expect(rotation.degrees).toBeCloseTo(540, 6);
  expect(rotation.objectDegrees).toBeCloseTo(540, 6);
  expect(rotation.quaternion.every((value: number) => Number.isFinite(value))).toBe(true);

  await page.screenshot({ path: 'test-results/animation-channel-editing.png' });
});
