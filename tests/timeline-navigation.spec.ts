import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forge.setAnimationRange(1, 1000));
});

async function seedTimelineKeys(page: any) {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(100); e.selected.position.x = 1; e.insertChannelKey('position.x');
    e.scrub(500); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(900); e.selected.position.x = 3; e.insertChannelKey('position.x');
    e.scrub(500);
  });
}

async function viewState(page: any) {
  const track = page.getByLabel('Timeline view', { exact: true });
  return track.evaluate((element: HTMLElement) => ({
    start: Number(element.dataset.viewStart),
    end: Number(element.dataset.viewEnd),
    manual: element.dataset.viewManual === 'true',
  }));
}

test('Timeline view defaults to Scene Range and Scene framing restores it', async ({ page }) => {
  await seedTimelineKeys(page);
  expect(await viewState(page)).toEqual({ start: 1, end: 1000, manual: false });

  const track = page.getByLabel('Timeline view', { exact: true });
  const box = await track.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -500);

  const zoomed = await viewState(page);
  expect(zoomed.manual).toBe(true);
  expect(zoomed.end - zoomed.start).toBeLessThan(999);

  await page.getByRole('button', { name: 'Frame Timeline scene range (Home)' }).click();
  expect(await viewState(page)).toEqual({ start: 1, end: 1000, manual: false });
});

test('Timeline wheel zoom changes only editor view and not project history', async ({ page }) => {
  await seedTimelineKeys(page);
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      snapshot: e.snapshot(),
      history: JSON.stringify(e.history),
      historyIndex: e.historyIndex,
    };
  });

  const track = page.getByLabel('Timeline view', { exact: true });
  const box = await track.boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -420);

  const zoomed = await viewState(page);
  expect(zoomed.manual).toBe(true);
  expect(zoomed.end - zoomed.start).toBeLessThan(999);

  const after = await page.evaluate(() => {
    const e = (window as any).__forge;
    return {
      snapshot: e.snapshot(),
      history: JSON.stringify(e.history),
      historyIndex: e.historyIndex,
    };
  });
  expect(after).toEqual(before);
});

test('MMB pan changes Timeline view and Escape restores the starting view', async ({ page }) => {
  await seedTimelineKeys(page);
  const track = page.getByLabel('Timeline view', { exact: true });
  const box = await track.boundingBox();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -520);
  const start = await viewState(page);

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height / 2, { steps: 4 });

  const panned = await viewState(page);
  expect(Math.abs(panned.start - start.start)).toBeGreaterThan(1);

  await page.keyboard.press('Escape');
  expect(await viewState(page)).toEqual(start);
});

test('Frame Selected fits selected Timeline summary keys', async ({ page }) => {
  await seedTimelineKeys(page);
  const marker100 = page.locator('.key-marker[data-frame="100"]');
  const marker900 = page.locator('.key-marker[data-frame="900"]');

  await page.keyboard.down('Shift');
  await marker100.click();
  await marker900.click();
  await page.keyboard.up('Shift');

  await page.getByRole('button', { name: 'Frame selected Timeline keys (Numpad .)' }).click();

  const view = await viewState(page);
  expect(view.manual).toBe(true);
  expect(view.start).toBeLessThan(100);
  expect(view.end).toBeGreaterThan(900);
  expect(view.end - view.start).toBeLessThan(999);
});

test('Center Timeline on current frame preserves zoom span', async ({ page }) => {
  await seedTimelineKeys(page);
  const track = page.getByLabel('Timeline view', { exact: true });
  const box = await track.boundingBox();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -500);
  const before = await viewState(page);
  const span = before.end - before.start;

  const current = page.getByRole('spinbutton', { name: 'Current frame', exact: true });
  await current.fill('700');
  await current.press('Enter');

  await page.getByRole('button', { name: 'Center Timeline on current frame (Numpad 0)' }).click();
  const centered = await viewState(page);

  expect(centered.manual).toBe(true);
  expect(centered.end - centered.start).toBeCloseTo(span, 6);
  expect((centered.start + centered.end) / 2).toBeCloseTo(700, 6);
});

test('Timeline key drag uses the active navigated view transform', async ({ page }) => {
  await seedTimelineKeys(page);

  await page.keyboard.down('Shift');
  await page.locator('.key-marker[data-frame="500"]').click();
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Frame selected Timeline keys (Numpad .)' }).click();

  const track = page.getByLabel('Timeline view', { exact: true });
  const view = await viewState(page);
  const box = await track.boundingBox();
  const source = page.locator('.key-marker[data-frame="500"]');
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();

  const targetFrame = 505;
  const targetX = box!.x + (targetFrame - view.start) / (view.end - view.start) * box!.width;
  const targetY = sourceBox!.y + sourceBox!.height / 2;

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, targetY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 5 });
  await page.mouse.up();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([100, 505, 900]);
});

test('Timeline framing shortcuts act when the Timeline view has focus', async ({ page }) => {
  await seedTimelineKeys(page);
  const track = page.getByLabel('Timeline view', { exact: true });
  const box = await track.boundingBox();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -450);
  expect((await viewState(page)).manual).toBe(true);

  await track.focus();
  await page.keyboard.press('Home');
  expect(await viewState(page)).toEqual({ start: 1, end: 1000, manual: false });
});
