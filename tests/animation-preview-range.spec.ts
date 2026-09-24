import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Preview Range keeps the full Scene Timeline visible', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.setPreviewRange(300, 420);
  });

  expect(await page.evaluate(() => ({
    scene: (window as any).__forge.animationRange,
    preview: (window as any).__forge.previewRange,
    playback: (window as any).__forge.playbackRange,
  }))).toEqual({
    scene: { start: 1, end: 1000 },
    preview: { start: 300, end: 420 },
    playback: { start: 300, end: 420 },
  });

  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('min', '1');
  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('max', '1000');
  await expect(page.getByRole('spinbutton', { name: 'Current frame', exact: true })).toHaveAttribute('max', '1000');

  const overlay = page.locator('#timeline-preview-range');
  await expect(overlay).toHaveClass(/active/);
  expect(parseFloat(await overlay.evaluate((el: HTMLElement) => el.style.left))).toBeCloseTo(29.93, 1);
  expect(parseFloat(await overlay.evaluate((el: HTMLElement) => el.style.width))).toBeCloseTo(12.01, 1);
});

test('Timeline Preview controls enable and clear Preview Range without changing Scene Range', async ({ page }) => {
  await page.evaluate(() => (window as any).__forge.setAnimationRange(1, 1000));

  const previewStart = page.getByLabel('Preview start frame');
  const previewEnd = page.getByLabel('Preview end frame');
  await previewStart.fill('300');
  await previewEnd.fill('420');
  await previewEnd.press('Enter');

  await expect(page.getByRole('button', { name: 'Clear Preview Range' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toEqual({ start: 300, end: 420 });
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 1000 });

  await page.getByRole('button', { name: 'Clear Preview Range' }).click();
  await expect(page.getByRole('button', { name: 'Enable Preview Range' })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toBeNull();
  expect(await page.evaluate(() => (window as any).__forge.playbackRange)).toEqual({ start: 1, end: 1000 });
});

test('First Last and playback use Preview Range while it is active', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.setPreviewRange(300, 302);
    e.scrub(900);
  });

  await page.getByRole('button', { name: 'First frame' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Current frame', exact: true })).toHaveValue('300');

  await page.getByRole('button', { name: 'Last frame' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Current frame', exact: true })).toHaveValue('302');

  await page.evaluate(() => (window as any).__forge.togglePlayback());
  await page.waitForTimeout(180);

  const during = await page.evaluate(() => ({
    frame: (window as any).__forge.frame,
    playing: (window as any).__forge.playing,
  }));
  expect(during.playing).toBe(true);
  expect(during.frame).toBeGreaterThanOrEqual(300);
  expect(during.frame).toBeLessThanOrEqual(302);

  await page.evaluate(() => (window as any).__forge.togglePlayback());
});

test('keys outside Preview Range remain authored visible and editable', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    delete e.selected.userData.animationTracks;
    e.scrub(100); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(500); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(900); e.selected.position.x = 3; e.insertChannelKey('position.x');
    e.setPreviewRange(300, 420);
  });

  const markers = page.locator('#keyframe-markers .key-marker');
  await expect(markers).toHaveCount(3);
  await expect(markers.nth(0)).toHaveAttribute('data-frame', '100');
  await expect(markers.nth(1)).toHaveAttribute('data-frame', '500');
  await expect(markers.nth(2)).toHaveAttribute('data-frame', '900');

  const edited = await page.evaluate(() =>
    (window as any).__forge.editChannelKey('position.x', 900, 950, 8)
  );
  expect(edited).toMatchObject({ frame: 950, value: 8 });
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([100, 500, 950]);

  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toEqual({ start: 300, end: 420 });
});

test('Preview Range persists in project snapshots and old projects load with it disabled', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.setPreviewRange(300, 420);

    const snapshot = e.snapshot();
    const parsed = JSON.parse(snapshot);

    e.newProject();
    e.load(JSON.parse(snapshot));
    const restored = {
      scene: e.animationRange,
      preview: e.previewRange,
      playback: e.playbackRange,
    };

    const legacy = JSON.parse(snapshot);
    delete legacy.previewRange;
    e.load(legacy);

    return {
      savedPreview: parsed.previewRange,
      restored,
      legacyPreview: e.previewRange,
      legacyPlayback: e.playbackRange,
    };
  });

  expect(result.savedPreview).toEqual({ start: 300, end: 420 });
  expect(result.restored).toEqual({
    scene: { start: 1, end: 1000 },
    preview: { start: 300, end: 420 },
    playback: { start: 300, end: 420 },
  });
  expect(result.legacyPreview).toBeNull();
  expect(result.legacyPlayback).toEqual({ start: 1, end: 1000 });
});

test('Preview Range changes participate in undo redo', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.setPreviewRange(300, 420);
  });

  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toEqual({ start: 300, end: 420 });

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toBeNull();

  await page.evaluate(() => (window as any).__forge.redo());
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toEqual({ start: 300, end: 420 });

  await page.evaluate(() => (window as any).__forge.clearPreviewRange());
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toBeNull();

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toEqual({ start: 300, end: 420 });
});

test('Preview Range must stay inside Scene Frame Range and rejects invalid edits atomically', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(100, 1000);
    const before = {
      snapshot: e.snapshot(),
      preview: e.previewRange,
      historyIndex: e.historyIndex,
    };

    const attempts = [[99, 400], [300, 1001], [500, 500], [600, 400], [300.5, 420]].map(([start, end]) => {
      let rejected = false;
      try { e.setPreviewRange(start, end); } catch { rejected = true; }
      return rejected;
    });

    return {
      attempts,
      unchanged:
        e.snapshot() === before.snapshot &&
        e.previewRange === before.preview &&
        e.historyIndex === before.historyIndex,
    };
  });

  expect(result.attempts.every(Boolean)).toBe(true);
  expect(result.unchanged).toBe(true);
});

test('shrinking Scene Frame Range clears a Preview Range that no longer fits', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.setPreviewRange(700, 900);
    e.setAnimationRange(1, 800);
  });

  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 800 });
  expect(await page.evaluate(() => (window as any).__forge.previewRange)).toBeNull();
  expect(await page.evaluate(() => (window as any).__forge.playbackRange)).toEqual({ start: 1, end: 800 });
});
