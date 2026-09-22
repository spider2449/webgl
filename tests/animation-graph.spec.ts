import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Graph Editor visualizes Linear, Constant and Smooth for the selected scalar channel', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.position.set(0, 0, 0);
    e.insertKey();
    e.frame = 25;
    object.position.set(8, 0, 0);
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(7);
  });

  const graph = page.getByLabel('Animation graph editor');
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(graph).toBeVisible();
  await expect(graph).toHaveAttribute('data-channel', 'position.x');
  await expect(graph).toHaveAttribute('data-mode', 'linear');
  await expect(graph.locator('.graph-key-point')).toHaveCount(2);
  await expect(page.locator('#animation-graph-title')).toHaveText('Location X');
  await expect(page.locator('#animation-graph-detail')).toContainText('Linear');

  const linearPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(linearPath).toBeTruthy();
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('33');

  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('constant');
  await expect(graph).toHaveAttribute('data-mode', 'constant');
  await expect(page.locator('#animation-graph-detail')).toContainText('Constant');
  const constantPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(constantPath).not.toBe(linearPath);
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('4');

  await page.getByLabel('Animation channel interpolation', { exact: true }).selectOption('smooth');
  await expect(graph).toHaveAttribute('data-mode', 'smooth');
  await expect(page.locator('#animation-graph-detail')).toContainText('Smooth');
  const smoothPath = await graph.locator('.graph-curve').getAttribute('d');
  expect(smoothPath).not.toBe(linearPath);
  expect(smoothPath).not.toBe(constantPath);
  expect(await graph.locator('.graph-curve').getAttribute('data-sample-count')).toBe('33');

  await page.evaluate(() => (window as any).__forge.scrub(13));
  await expect(graph.locator('.graph-playhead')).toHaveAttribute('data-frame', '13');

  const keyValues = await graph.locator('.graph-key-point').evaluateAll(nodes =>
    nodes.map(node => ({
      frame: Number((node as SVGElement).dataset.frame),
      value: Number((node as SVGElement).dataset.value),
    }))
  );
  expect(keyValues).toEqual([{ frame: 1, value: 0 }, { frame: 25, value: 8 }]);

  await graph.screenshot({ path: 'test-results/animation-graph-editor.png' });
});

test('Graph Editor preserves unwrapped multi-turn rotation values', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.userData.keyframes = [];
    e.frame = 1;
    object.rotation.set(0, 270 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.rotation.set(0, 720 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();
    e.setAnimationInterpolation('linear');
    e.scrub(13);
  });

  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByLabel('Animation channel', { exact: true }).selectOption('rotation.y');

  const graph = page.getByLabel('Animation graph editor');
  await expect(graph).toHaveAttribute('data-channel', 'rotation.y');
  await expect(graph).toHaveAttribute('data-mode', 'linear');
  await expect(page.locator('#animation-graph-title')).toHaveText('Rotation Y');

  const values = await graph.locator('.graph-key-point').evaluateAll(nodes =>
    nodes.map(node => Number((node as SVGElement).dataset.value))
  );
  expect(values[0]).toBeCloseTo(270, 6);
  expect(values[1]).toBeCloseTo(720, 6);

  const detail = await page.locator('#animation-graph-detail').textContent();
  expect(detail).toContain('Linear');
  expect(detail).toContain('to');
});
