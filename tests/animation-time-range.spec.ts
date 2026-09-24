import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Scene Frame Range defaults to 1–250 but End can extend the Timeline beyond 250', async ({ page }) => {
  await expect(page.getByLabel('Animation start frame')).toHaveValue('1');
  await expect(page.getByLabel('Animation end frame')).toHaveValue('250');

  const endInput = page.getByLabel('Animation end frame');
  await endInput.fill('1000');
  await endInput.press('Enter');

  await expect(endInput).toHaveValue('1000');
  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('min', '1');
  await expect(page.getByLabel('Timeline frame')).toHaveAttribute('max', '1000');

  const current = page.getByRole('spinbutton', { name: 'Current frame', exact: true });
  await expect(current).toHaveAttribute('min', '1');
  await expect(current).toHaveAttribute('max', '1000');

  const ruler = page.locator('#timeline-ruler');
  await expect(ruler.locator('span').first()).toHaveText('1');
  await expect(ruler.locator('span').last()).toHaveText('1000');

  await page.getByRole('button', { name: 'Last frame' }).click();
  await expect(current).toHaveValue('1000');

  await page.getByRole('button', { name: 'First frame' }).click();
  await expect(current).toHaveValue('1');
});

test('extended Scene Frame Range supports authored keys and Timeline markers beyond frame 250', async ({ page }) => {
  await page.evaluate(() => (window as any).__forge.setAnimationRange(1, 1000));

  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(100); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(500); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(900); e.selected.position.x = 3; e.insertChannelKey('position.x');
  });

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([100, 500, 900]);

  const markers = page.locator('#keyframe-markers .key-marker');
  await expect(markers).toHaveCount(3);
  await expect(markers.nth(0)).toHaveAttribute('data-frame', '100');
  await expect(markers.nth(1)).toHaveAttribute('data-frame', '500');
  await expect(markers.nth(2)).toHaveAttribute('data-frame', '900');

  await page.getByRole('button', { name: 'Last frame' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Current frame', exact: true })).toHaveValue('1000');
});

test('Graph Scene Range and Frame All work on scene ranges wider than 1000 frames', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 5000);
    delete e.selected.userData.animationTracks;
    e.scrub(100); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(4900); e.selected.position.x = 10; e.insertChannelKey('position.x');
    e.scrub(100);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const graph = page.getByLabel('Animation graph editor');

  await page.getByRole('button', { name: /Frame Graph scene range 1–5000/ }).click();
  await expect(graph).toHaveAttribute('data-view-frame-min', '1');
  await expect(graph).toHaveAttribute('data-view-frame-max', '5000');

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  const view = await graph.evaluate((element: SVGSVGElement) => ({
    min: Number(element.dataset.viewFrameMin),
    max: Number(element.dataset.viewFrameMax),
  }));
  expect(view.min).toBeLessThan(100);
  expect(view.max).toBeGreaterThan(4900);
  expect(view.max - view.min).toBeGreaterThan(1000);
});

test('current frame and Graph key editing work beyond frame 250 after extending the Scene Range', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    delete e.selected.userData.animationTracks;
    e.scrub(900);
    e.selected.position.x = 4;
    e.insertChannelKey('position.x');
  });

  const current = page.getByRole('spinbutton', { name: 'Current frame', exact: true });
  await current.fill('950');
  await current.press('Enter');
  await expect(current).toHaveValue('950');
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(950);

  const edited = await page.evaluate(() =>
    (window as any).__forge.editChannelKey('position.x', 900, 950, 6)
  );
  expect(edited).toMatchObject({ frame: 950, value: 6 });
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([950]);
});

test('shrinking Scene Frame Range rejects authored keys that would fall outside it', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    e.scrub(900);
    e.selected.position.x = 5;
    e.insertChannelKey('position.x');

    const before = {
      snapshot: e.snapshot(),
      range: e.animationRange,
      frame: e.frame,
      historyIndex: e.historyIndex,
    };

    let message = '';
    try { e.setAnimationRange(1, 500); }
    catch (error) { message = (error as Error).message; }

    return {
      message,
      before,
      after: {
        snapshot: e.snapshot(),
        range: e.animationRange,
        frame: e.frame,
        historyIndex: e.historyIndex,
      },
    };
  });

  expect(result.message).toContain('authored key frame 900');
  expect(result.after).toEqual(result.before);
});

test('playback loops inside the configured Scene Frame Range', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(300, 302);
    e.scrub(302);
    e.togglePlayback();
  });
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

test('setAnimationRange is one undoable project-state edit', async ({ page }) => {
  await page.evaluate(() => (window as any).__forge.setAnimationRange(1, 1000));
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 1000 });

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 250 });

  await page.evaluate(() => (window as any).__forge.redo());
  expect(await page.evaluate(() => (window as any).__forge.animationRange)).toEqual({ start: 1, end: 1000 });
});

test('project snapshot round-trips extended Scene Frame Range and legacy projects default to 1–250', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setAnimationRange(1, 1000);
    delete e.selected.userData.animationTracks;
    e.scrub(900);
    e.selected.position.x = 7;
    e.insertChannelKey('position.x');

    const snapshot = e.snapshot();
    const parsed = JSON.parse(snapshot);
    const savedRange = parsed.animationRange;

    e.newProject();
    e.load(JSON.parse(snapshot));
    const restored = {
      range: e.animationRange,
      keys: e.selected.userData.animationTracks['position.x'].map((key: any) => key.frame),
    };

    e.newProject();
    const legacy = JSON.parse(e.snapshot());
    delete legacy.animationRange;
    e.load(legacy);

    return {
      savedRange,
      restored,
      legacyRange: e.animationRange,
    };
  });

  expect(result.savedRange).toEqual({ start: 1, end: 1000 });
  expect(result.restored).toEqual({ range: { start: 1, end: 1000 }, keys: [900] });
  expect(result.legacyRange).toEqual({ start: 1, end: 250 });
});

test('invalid Scene Frame Ranges are rejected atomically', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const before = {
      snapshot: e.snapshot(),
      range: e.animationRange,
      frame: e.frame,
      history: JSON.stringify(e.history),
      historyIndex: e.historyIndex,
    };

    const attempts = [[0, 80], [1, 100001], [40, 40], [80, 20], [20.5, 80]].map(([start, end]) => {
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
