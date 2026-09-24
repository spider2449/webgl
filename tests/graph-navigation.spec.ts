import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
});

async function seedPositionKeys(page: any) {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(50); e.selected.position.x = 10; e.insertChannelKey('position.x');
    e.scrub(80); e.selected.position.x = -5; e.insertChannelKey('position.x');
    e.scrub(50);
  });
}

async function graphView(page: any) {
  return page.getByLabel('Animation graph editor').evaluate((element: SVGSVGElement) => ({
    frameMin: Number(element.dataset.viewFrameMin),
    frameMax: Number(element.dataset.viewFrameMax),
    valueMin: Number(element.dataset.viewValueMin),
    valueMax: Number(element.dataset.viewValueMax),
  }));
}

test('Graph framing controls switch between scene, all, selected and current-frame views', async ({ page }) => {
  await seedPositionKeys(page);
  const graph = page.getByLabel('Animation graph editor');

  expect(await graphView(page)).toMatchObject({ frameMin: 1, frameMax: 250 });

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  const all = await graphView(page);
  expect(all.frameMin).toBeGreaterThan(1);
  expect(all.frameMin).toBeLessThan(20);
  expect(all.frameMax).toBeGreaterThan(80);
  expect(all.frameMax).toBeLessThan(250);
  expect(all.valueMin).toBeLessThanOrEqual(-5);
  expect(all.valueMax).toBeGreaterThanOrEqual(10);

  await graph.locator('.graph-key-point[data-frame="50"]').click();
  await page.getByRole('button', { name: 'Frame selected Graph keys (Numpad .)' }).click();
  const selected = await graphView(page);
  expect(selected.frameMin).toBeCloseTo(40, 6);
  expect(selected.frameMax).toBeCloseTo(60, 6);
  expect(selected.valueMin).toBeLessThan(10);
  expect(selected.valueMax).toBeGreaterThan(10);

  await page.getByRole('button', { name: 'Frame Graph scene range 1–250' }).click();
  expect(await graphView(page)).toMatchObject({ frameMin: 1, frameMax: 250 });

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  const span = (await graphView(page)).frameMax - (await graphView(page)).frameMin;
  await page.evaluate(() => (window as any).__forge.scrub(120));
  await page.getByRole('button', { name: 'Center Graph on current frame (Numpad 0)' }).click();
  const centered = await graphView(page);
  expect((centered.frameMin + centered.frameMax) / 2).toBeCloseTo(120, 6);
  expect(centered.frameMax - centered.frameMin).toBeCloseTo(span, 6);
});

test('Graph wheel zoom and MMB pan change only view state, not editor history', async ({ page }) => {
  await seedPositionKeys(page);
  const graph = page.getByLabel('Animation graph editor');
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();

  const beforeHistory = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  const before = await graphView(page);
  await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.5);
  await page.mouse.wheel(0, -300);
  const zoomed = await graphView(page);
  expect(zoomed.frameMax - zoomed.frameMin).toBeLessThan(before.frameMax - before.frameMin);
  expect(zoomed.valueMax - zoomed.valueMin).toBeLessThan(before.valueMax - before.valueMin);

  const centerBeforePan = (zoomed.frameMin + zoomed.frameMax) / 2;
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.58, { steps: 6 });
  await page.mouse.up({ button: 'middle' });

  const panned = await graphView(page);
  expect((panned.frameMin + panned.frameMax) / 2).toBeLessThan(centerBeforePan);

  const afterHistory = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));
  expect(afterHistory).toEqual(beforeHistory);
});

test('Graph view state is preserved independently per scalar channel', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 0; e.insertChannelKey('position.x');
    e.scrub(80); e.selected.position.x = 10; e.insertChannelKey('position.x');
    e.scrub(30); e.selected.rotation.y = Math.PI; e.insertChannelKey('rotation.y');
    e.scrub(60); e.selected.rotation.y = Math.PI * 2; e.insertChannelKey('rotation.y');
    e.scrub(20);
  });

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  const positionView = await graphView(page);
  expect(positionView.frameMax - positionView.frameMin).toBeLessThan(249);

  await page.getByRole('button', { name: 'Graph channel Rotation Y' }).click();
  expect(await graphView(page)).toMatchObject({ frameMin: 1, frameMax: 250 });

  const graph = page.getByLabel('Animation graph editor');
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -260);
  const rotationView = await graphView(page);
  expect(rotationView.frameMax - rotationView.frameMin).toBeLessThan(249);

  await page.getByRole('button', { name: 'Graph channel Location X' }).click();
  const restoredPosition = await graphView(page);
  expect(restoredPosition.frameMin).toBeCloseTo(positionView.frameMin, 6);
  expect(restoredPosition.frameMax).toBeCloseTo(positionView.frameMax, 6);

  await page.getByRole('button', { name: 'Graph channel Rotation Y' }).click();
  const restoredRotation = await graphView(page);
  expect(restoredRotation.frameMin).toBeCloseTo(rotationView.frameMin, 6);
  expect(restoredRotation.frameMax).toBeCloseTo(rotationView.frameMax, 6);
});

test('Graph key drag uses the navigated view transform', async ({ page }) => {
  await seedPositionKeys(page);
  const graph = page.getByLabel('Animation graph editor');

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  const view = await graphView(page);
  const graphBox = await graph.boundingBox();
  expect(graphBox).not.toBeNull();

  const frameClientX = (frame: number) =>
    graphBox!.x + (48 + (frame - view.frameMin) / (view.frameMax - view.frameMin) * 924) / 1000 * graphBox!.width;

  const key = graph.locator('.graph-key-point[data-frame="50"]');
  const keyBox = await key.boundingBox();
  expect(keyBox).not.toBeNull();
  const y = keyBox!.y + keyBox!.height / 2;

  await page.mouse.move(keyBox!.x + keyBox!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(frameClientX(60), y, { steps: 8 });
  await page.mouse.up();

  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((item: any) => item.frame)
  )).toEqual([20, 60, 80]);
  await expect(graph).toHaveAttribute('data-selected-frames', '60');

  await page.evaluate(() => (window as any).__forge.undo());
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((item: any) => item.frame)
  )).toEqual([20, 50, 80]);
});

test('Graph keyboard framing shortcuts act only while the Graph has focus', async ({ page }) => {
  await seedPositionKeys(page);
  const graph = page.getByLabel('Animation graph editor');

  await page.getByRole('button', { name: 'Frame all Graph keys (Home)' }).click();
  await graph.locator('.graph-key-point[data-frame="50"]').click();
  await page.getByRole('button', { name: 'Frame Graph scene range 1–250' }).click();

  await graph.focus();
  await graph.dispatchEvent('keydown', { key: 'Home', code: 'Home' });
  const homeView = await graphView(page);
  expect(homeView.frameMax - homeView.frameMin).toBeLessThan(249);

  await graph.dispatchEvent('keydown', { key: 'Decimal', code: 'NumpadDecimal' });
  const selectedView = await graphView(page);
  expect(selectedView.frameMin).toBeCloseTo(40, 6);
  expect(selectedView.frameMax).toBeCloseTo(60, 6);

  await page.evaluate(() => (window as any).__forge.scrub(130));
  await graph.dispatchEvent('keydown', { key: '0', code: 'Numpad0' });
  const currentView = await graphView(page);
  expect((currentView.frameMin + currentView.frameMax) / 2).toBeCloseTo(130, 6);
});
