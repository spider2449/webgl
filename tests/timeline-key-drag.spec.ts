import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

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

test('timeline summary key drag retimes every channel authored at that frame in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20);
    e.selected.position.set(1, 2, 3);
    e.selected.rotation.set(0.1, 0.2, 0.3);
    e.selected.scale.set(1, 2, 3);
    e.insertKey();
    e.scrub(40);
    e.selected.position.set(4, 5, 6);
    e.selected.rotation.set(0.4, 0.5, 0.6);
    e.selected.scale.set(2, 3, 4);
    e.insertKey();
    e.scrub(1);
  });

  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toBeVisible();
  await dragTimelineMarker(page, 20, 30);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  for (const keys of Object.values(tracks) as any[][]) {
    expect(keys.map(key => key.frame)).toEqual([30, 40]);
  }
  await expect(page.getByRole('button', { name: 'Animation key at frame 30' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(30);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  for (const keys of Object.values(restored) as any[][]) {
    expect(keys.map(key => key.frame)).toEqual([20, 40]);
  }
});

test('timeline summary key drag rejects a per-channel collision atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(40); e.selected.position.x = 4; e.insertChannelKey('position.x');
    e.scrub(1);
  });

  await dragTimelineMarker(page, 20, 40);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([20, 40]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([20]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('collide');
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(20);
});

test('Escape cancels timeline key drag without history or retiming', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 4; e.insertChannelKey('position.x');
    e.scrub(1);
  });

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
  await expect(page.getByRole('button', { name: 'Animation key preview at frame 30' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([20, 40]);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(20);
});
