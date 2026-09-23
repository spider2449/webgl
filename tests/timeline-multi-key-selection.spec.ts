import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

async function shiftSelectTimelineMarker(page: any, frame: number) {
  await page.getByRole('button', { name: `Animation key at frame ${frame}` }).click({ modifiers: ['Shift'] });
}

async function dragTimelineMarker(page: any, sourceFrame: number, targetFrame: number) {
  const track = page.locator('#timeline-track');
  const marker = page.getByRole('button', { name: `Animation key at frame ${sourceFrame}` });
  const trackBox = await track.boundingBox();
  const markerBox = await marker.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(markerBox).not.toBeNull();

  const targetX = trackBox!.x + (targetFrame - 1) / 249 * trackBox!.width;
  const y = markerBox!.y + markerBox!.height / 2;
  await page.mouse.move(markerBox!.x + markerBox!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 8 });
  await page.mouse.up();
}

test('Shift-selecting Timeline summary keys retimes the selected frames together in one undo step', async ({ page }) => {
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
  await expect(page.locator('.key-marker.selected')).toHaveCount(2);

  await dragTimelineMarker(page, 20, 30);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([30]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([50]);
  expect(tracks['position.z'].map((key: any) => key.frame)).toEqual([70]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 30' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 50' })).toHaveClass(/selected/);
  await expect(page.locator('.key-marker.selected')).toHaveCount(2);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(restored['position.x'].map((key: any) => key.frame)).toEqual([20]);
  expect(restored['position.y'].map((key: any) => key.frame)).toEqual([40]);
  expect(restored['position.z'].map((key: any) => key.frame)).toEqual([70]);
});

test('Timeline multi-key drag rejects a collision on any participating channel atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(50); e.selected.position.y = 3; e.insertChannelKey('position.y');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftSelectTimelineMarker(page, 40);
  await dragTimelineMarker(page, 20, 30);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([20]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([40, 50]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('collide');
  await expect(page.locator('.key-marker.selected')).toHaveCount(2);
});

test('Shift-click toggles Timeline selection and Escape cancels a multi-key drag', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftSelectTimelineMarker(page, 40);
  await shiftSelectTimelineMarker(page, 40);
  await expect(page.locator('.key-marker.selected')).toHaveCount(1);
  await shiftSelectTimelineMarker(page, 40);

  const marker = page.getByRole('button', { name: 'Animation key at frame 20' });
  const trackBox = await page.locator('#timeline-track').boundingBox();
  const markerBox = await marker.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(markerBox).not.toBeNull();

  const targetX = trackBox!.x + (30 - 1) / 249 * trackBox!.width;
  const y = markerBox!.y + markerBox!.height / 2;
  await page.mouse.move(markerBox!.x + markerBox!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  const state = await page.evaluate(() => ({
    selectedUuid: (window as any).__forge.selected?.uuid ?? null,
    tracks: structuredClone((window as any).__forge.selected?.userData.animationTracks),
  }));
  expect(state.selectedUuid).not.toBeNull();
  expect(state.tracks['position.x'].map((key: any) => key.frame)).toEqual([20]);
  expect(state.tracks['position.y'].map((key: any) => key.frame)).toEqual([40]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toHaveClass(/selected/);
});
