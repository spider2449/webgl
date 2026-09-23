import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

async function shiftSelectTimelineMarker(page: any, frame: number) {
  await page.getByRole('button', { name: `Animation key at frame ${frame}` }).click({ modifiers: ['Shift'] });
}

async function shiftBoxTimeline(page: any, startFrame: number, endFrame: number, release = true) {
  const track = page.locator('#timeline-track');
  const box = await track.boundingBox();
  expect(box).not.toBeNull();

  const x = (frame: number) => box!.x + (frame - 1) / 249 * box!.width;
  const y = box!.y + box!.height - 12;

  await page.keyboard.down('Shift');
  await page.mouse.move(x(startFrame), y);
  await page.mouse.down();
  await page.mouse.move(x(endFrame), y, { steps: 8 });
  if (release) {
    await page.mouse.up();
    await page.keyboard.up('Shift');
  }
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

test('Shift-drag Timeline box adds summary keys to the selection and batch retimes them', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(70); e.selected.position.z = 3; e.insertChannelKey('position.z');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 70);
  await shiftBoxTimeline(page, 15, 45);

  await expect(page.locator('.key-marker.selected')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 40' })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Animation key at frame 70' })).toHaveClass(/selected/);

  await dragTimelineMarker(page, 20, 30);

  const tracks = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks)
  );
  expect(tracks['position.x'].map((key: any) => key.frame)).toEqual([30]);
  expect(tracks['position.y'].map((key: any) => key.frame)).toEqual([50]);
  expect(tracks['position.z'].map((key: any) => key.frame)).toEqual([80]);
  await expect(page.locator('.key-marker.selected')).toHaveCount(3);
});

test('Escape cancels Timeline box preview and restores the previous selection without deselecting the object', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(70); e.selected.position.z = 3; e.insertChannelKey('position.z');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 70);
  const selectedUuid = await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null);
  expect(selectedUuid).not.toBeNull();

  await shiftBoxTimeline(page, 15, 45, false);
  await expect(page.locator('#timeline-selection-box')).toHaveClass(/active/);
  await expect(page.locator('.key-marker.selected')).toHaveCount(3);

  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(page.locator('#timeline-selection-box')).not.toHaveClass(/active/);
  await expect(page.locator('.key-marker.selected')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Animation key at frame 70' })).toHaveClass(/selected/);
  expect(await page.evaluate(() => (window as any).__forge.selected?.uuid ?? null)).toBe(selectedUuid);
});

test('Shift-click without box movement leaves the existing Timeline selection unchanged', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.y = 2; e.insertChannelKey('position.y');
    e.scrub(1);
  });

  await shiftSelectTimelineMarker(page, 20);
  await shiftBoxTimeline(page, 55, 55);

  await expect(page.locator('.key-marker.selected')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Animation key at frame 20' })).toHaveClass(/selected/);
});
