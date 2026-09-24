import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

async function shiftSelectTimelineMarker(page: any, frame: number) {
  await page.getByRole('button', { name: `Animation key at frame ${frame}` }).click({ modifiers: ['Shift'] });
}

async function dragTimelineMarker(page: any, sourceFrame: number, targetFrame: number, copy = false) {
  const track = page.locator('#timeline-track');
  const marker = page.getByRole('button', { name: `Animation key at frame ${sourceFrame}` });
  const trackBox = await track.boundingBox();
  const markerBox = await marker.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(markerBox).not.toBeNull();

  const targetX = trackBox!.x + (targetFrame - 1) / 249 * trackBox!.width;
  const y = markerBox!.y + markerBox!.height / 2;
  if (copy) await page.keyboard.down('Alt');
  await page.mouse.move(markerBox!.x + markerBox!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 8 });
  await page.mouse.up();
  if (copy) await page.keyboard.up('Alt');
}

test('Alt-drag copies selected Timeline summary keys across channels in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(80); e.selected.position.z = 3; e.insertChannelKey('position.z');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftSelectTimelineMarker(page, 40);
  await dragTimelineMarker(page, 20, 30, true);

  const copied = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(copied['position.x'].map((key: any) => key.frame)).toEqual([20, 30]);
  expect(copied['position.y'].map((key: any) => key.frame)).toEqual([40, 50]);
  expect(copied['position.z'].map((key: any) => key.frame)).toEqual([80]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animation key at frame 30' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 50' })).toHaveClass(/selected/);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(restored['position.x'].map((key: any) => key.frame)).toEqual([20]);
  expect(restored['position.y'].map((key: any) => key.frame)).toEqual([40]);
  expect(restored['position.z'].map((key: any) => key.frame)).toEqual([80]);
});

test('Timeline Alt-copy rejects a channel collision atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(30); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 3; e.insertChannelKey('position.y');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftSelectTimelineMarker(page, 40);
  await dragTimelineMarker(page, 20, 30, true);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([20, 30]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([40]);
  await expect(page.locator('#toast')).toContainText('collide');
  await expect(page.locator('.key-marker.copy-ghost')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toHaveClass(/selected/);
});

test('Delete removes selected Timeline summary keys without deleting the active object and undo restores them', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(70); e.selected.position.z = 3; e.insertChannelKey('position.z');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftSelectTimelineMarker(page, 40);
  const selectedUuid = await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null);
  expect(selectedUuid).not.toBeNull();

  await page.locator('#scrubber').focus();
  await expect(page.locator('#scrubber')).toBeFocused();
  await page.keyboard.press('Delete');

  expect(await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null)).toBe(selectedUuid);
  const removed = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(removed['position.x']).toBeUndefined();
  expect(removed['position.y']).toBeUndefined();
  expect(removed['position.z'].map((key: any) => key.frame)).toEqual([70]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toHaveCount(0);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(restored['position.x'].map((key: any) => key.frame)).toEqual([20]);
  expect(restored['position.y'].map((key: any) => key.frame)).toEqual([40]);
  expect(restored['position.z'].map((key: any) => key.frame)).toEqual([70]);
});

test('Timeline batch controls sit beside the summary-key track and remain distinct from Graph controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Animation', exact: true }).click();

  const toolbar = page.getByLabel('Timeline key editing controls');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText('Summary Keys');
  await expect(toolbar.locator('#timeline-time-scale')).toHaveCount(1);
  await expect(toolbar.locator('#apply-timeline-time-scale')).toHaveCount(1);
  await expect(page.locator('.timeline-key-toolbar + #timeline-track')).toHaveCount(1);
  await expect(page.locator('.animation-graph-header #graph-time-scale')).toHaveCount(1);
  await expect(page.locator('.animation-graph-header #apply-graph-time-scale')).toHaveCount(1);
});

test('Timeline Time Scale retimes selected summary frames across channels in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(40); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(50); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(60); e.selected.position.z = 3; e.insertChannelKey('position.z');
    e.scrub(90); e.selected.scale.x = 2; e.insertChannelKey('scale.x');
    e.scrub(1);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="40"]').click();
  await expect(graph).toHaveAttribute('data-selected-frames', '40');

  await shiftSelectTimelineMarker(page, 40);
  await shiftSelectTimelineMarker(page, 50);
  await shiftSelectTimelineMarker(page, 60);

  await expect(page.getByRole('button', { name: 'Scale', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Scale selected Timeline keys', exact: true })).toHaveCount(1);

  const scale = page.getByLabel('Selected Timeline key time scale');
  await expect(scale).toBeEnabled();
  await scale.fill('2');
  await page.locator('#apply-timeline-time-scale').click();

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([30]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([50]);
  expect(tracks['position.z'].map((key: any) => key.frame)).toEqual([70]);
  expect(tracks['scale.x'].map((key: any) => key.frame)).toEqual([90]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 30' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 50' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 70' })).toHaveClass(/selected/);
  await expect(graph).toHaveAttribute('data-selected-frames', '30');

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(restored['position.x'].map((key: any) => key.frame)).toEqual([40]);
  expect(restored['position.y'].map((key: any) => key.frame)).toEqual([50]);
  expect(restored['position.z'].map((key: any) => key.frame)).toEqual([60]);
  expect(restored['scale.x'].map((key: any) => key.frame)).toEqual([90]);
});

test('Timeline Time Scale rejects a collision on one channel without partially retiming other channels', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(30); e.selected.position.x = 3; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(60); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 40);
  await shiftSelectTimelineMarker(page, 60);
  const scale = page.getByLabel('Selected Timeline key time scale');
  await scale.fill('2');
  await page.locator('#apply-timeline-time-scale').click();

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([30, 40]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([60]);
  await expect(page.locator('#toast')).toContainText('collide');
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 60' })).toHaveClass(/selected/);
});
