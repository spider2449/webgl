import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

async function setRange(page: any, start: number, end: number) {
  const startInput = page.getByLabel('Animation start frame');
  const endInput = page.getByLabel('Animation end frame');
  await startInput.fill(String(start));
  await endInput.fill(String(end));
  await endInput.press('Enter');
}

test('Timeline Start and End define playback controls and visible ruler range', async ({ page }) => {
  await setRange(page, 20, 80);

  await expect(page.getByLabel('Animation start frame')).toHaveValue('20');
  await expect(page.getByLabel('Animation end frame')).toHaveValue('80');
  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('min', '20');
  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('max', '80');

  const ruler = page.locator('#timeline-ruler');
  await expect(ruler.locator('span').first()).toHaveText('20');
  await expect(ruler.locator('span').last()).toHaveText('80');

  await page.getByRole('button', { name: 'Last frame' }).click();
  await expect(page.getByLabel('Current frame')).toHaveValue('80');

  await page.getByRole('button', { name: 'First frame' }).click();
  await expect(page.getByLabel('Current frame')).toHaveValue('20');
});

test('range outside keys stay authored while Timeline shows only keys inside the range', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(10); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(50); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(100); e.selected.position.x = 3; e.insertChannelKey('position.x');
    e.scrub(50);
  });

  await setRange(page, 20, 80);

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([10, 50, 100]);

  const markers = page.locator('#keyframe-markers .key-marker');
  await expect(markers).toHaveCount(1);
  await expect(markers.first()).toHaveAttribute('data-frame', '50');

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.getByRole('button', { name: /Frame Graph scene range 20–80/ }).click();
  await expect(graph).toHaveAttribute('data-view-frame-min', '20');
  await expect(graph).toHaveAttribute('data-view-frame-max', '80');

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  expect(Number(await graph.getAttribute('data-view-frame-min'))).toBeLessThan(10);
  expect(Number(await graph.getAttribute('data-view-frame-max'))).toBeGreaterThan(100);
});

test('current frame and Graph key editing remain valid outside playback range', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(10);
    e.selected.position.x = 4;
    e.insertChannelKey('position.x');
  });

  await setRange(page, 20, 80);

  await page.getByLabel('Current frame').fill('10');
  await page.getByLabel('Current frame').press('Enter');
  await expect(page.getByLabel('Current frame')).toHaveValue('10');
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(10);

  const edited = await page.evaluate(() =>
    (window as any).__forge.editChannelKey('position.x', 10, 15, 6)
  );
  expect(edited).toMatchObject({ frame: 15, value: 6 });
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([15]);
});

test('playback loops inside the configured animation range', async ({ page }) => {
  await setRange(page, 20, 22);

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.scrub(22);
    e.togglePlayback();
  });
  await page.waitForTimeout(180);

  const during = await page.evaluate(() => ({
    frame: (window as any).__forge.frame,
    playing: (window as any).__forge.playing,
  }));
  expect(during.playing).toBe(true);
  expect(during.frame).toBeGreaterThanOrEqual(20);
  expect(during.frame).toBeLessThanOrEqual(22);

  await page.evaluate(() => (window as any).__forge.togglePlayback());
});

test('changing animation range is one undoable project-state edit', async ({ page }) => {
  await setRange(page, 20, 80);
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 20, end: 80 });

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 250 });

  await page.evaluate(() => (window as any).__forge.redo());
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 20, end: 80 });
});

test('project snapshot round-trips range and supports old projects without animationRange', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(10); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(100); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.setAnimationRange(20, 80);

    const snapshot = e.snapshot();
    const parsed = JSON.parse(snapshot);
    const savedRange = parsed.animationRange;

    e.setAnimationRange(30, 60);
    e.load(JSON.parse(snapshot));
    const restored = {
      range: e.animationRange,
      keys: e.selected.userData.animationTracks['position.x'].map((key: any) => key.frame),
    };

    const legacy = JSON.parse(snapshot);
    delete legacy.animationRange;
    e.load(legacy);

    return {
      savedRange,
      restored,
      legacyRange: e.animationRange,
    };
  });

  expect(result.savedRange).toEqual({ start: 20, end: 80 });
  expect(result.restored).toEqual({ range: { start: 20, end: 80 }, keys: [10, 100] });
  expect(result.legacyRange).toEqual({ start: 1, end: 250 });
});

test('invalid animation ranges are rejected atomically', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const before = {
      snapshot: e.snapshot(),
      range: e.animationRange,
      frame: e.frame,
      history: JSON.stringify(e.history),
      historyIndex: e.historyIndex,
    };

    const attempts = [[0, 80], [20, 251], [40, 40], [80, 20], [20.5, 80]].map(([start, end]) => {
      let rejected = false;
      try { e.setAnimationRange(start, end); } catch { rejected = true; }
      return rejected;
    });

    return {
      attempts,
      unchanged:
        e.snapshot() === before.snapshot &&
        JSON.stringify(e.animationRange) === JSON.stringify(before.range) &&
        e.frame === before.frame &&
        JSON.stringify(e.history) === before.history &&
        e.historyIndex === before.historyIndex,
    };
  });

  expect(result.attempts.every(Boolean)).toBe(true);
  expect(result.unchanged).toBe(true);
});
