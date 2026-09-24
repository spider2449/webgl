import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
});

async function selectGraphChannel(page: any, label: string) {
  await page.getByRole('button', { name: `Graph channel ${label}` }).click();
}

test('Graph editing controls are organized under the Key Inspector instead of the title row', async ({ page }) => {
  const inspector = page.getByLabel('Graph key inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Key Inspector');
  await expect(inspector.locator('#graph-key-interpolation')).toHaveCount(1);
  await expect(inspector.locator('#graph-key-tangent')).toHaveCount(1);
  await expect(inspector.locator('#graph-time-scale')).toHaveCount(1);
  await expect(page.locator('.animation-graph-header #graph-key-interpolation')).toHaveCount(0);
  await expect(page.locator('.animation-graph-header #graph-key-tangent')).toHaveCount(0);
  await expect(page.locator('.animation-graph-header #graph-time-scale')).toHaveCount(0);
});

test('Graph Key Inspector edits one selected key Frame and Value in one undo step', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.setKeyInterpolation(20, 'position.x', 'bezier');
    e.setKeyTangentMode(20, 'position.x', 'aligned');
    e.scrub(20);
  });

  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="20"]').click();

  const inspector = page.getByLabel('Graph key inspector');
  const frame = page.getByLabel('Selected Graph key frame');
  const value = page.getByLabel('Selected Graph key value');
  const apply = page.getByRole('button', { name: 'Apply Graph key Frame and Value' });

  await expect(inspector).toBeVisible();
  await expect(page.locator('#graph-selection-count')).toHaveText('1 selected');
  await expect(frame).toHaveValue('20');
  await expect(value).toHaveValue('2');
  await expect(apply).toBeEnabled();

  await frame.fill('25');
  await value.fill('3.5');
  await apply.click();

  const edited = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks['position.x'])
  );
  expect(edited.map((key: any) => key.frame)).toEqual([25, 40]);
  expect(edited.map((key: any) => key.value)).toEqual([3.5, 8]);
  expect(edited[0].interpolation).toBe('bezier');
  expect(edited[0].tangent).toBe('aligned');
  await expect(graph).toHaveAttribute('data-selected-frames', '25');
  expect(await page.evaluate(() => (window as any).__forge.frame)).toBe(25);

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    structuredClone((window as any).__forge.selected.userData.animationTracks['position.x'])
  );
  expect(restored.map((key: any) => key.frame)).toEqual([20, 40]);
  expect(restored.map((key: any) => key.value)).toEqual([2, 8]);
});

test('Graph Key Inspector rejects a same-channel frame collision atomically', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(30); e.selected.position.x = 5; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="20"]').click();

  const before = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
  }));

  await page.getByLabel('Selected Graph key frame').fill('30');
  await page.getByLabel('Selected Graph key value').fill('7');
  await page.getByRole('button', { name: 'Apply Graph key Frame and Value' }).click();

  const after = await page.evaluate(() => ({
    history: JSON.stringify((window as any).__forge.history),
    index: (window as any).__forge.historyIndex,
    keys: structuredClone((window as any).__forge.selected.userData.animationTracks['position.x']),
  }));

  expect(after.keys.map((key: any) => key.frame)).toEqual([20, 30]);
  expect(after.keys.map((key: any) => key.value)).toEqual([2, 5]);
  expect({ history: after.history, index: after.index }).toEqual(before);
  await expect(graph).toHaveAttribute('data-selected-frames', '20');
  await expect(page.locator('#toast')).toContainText('already has a key');
});

test('Graph Key Inspector displays and edits rotation values in degrees', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.rotation.y = Math.PI * 1.5; e.insertChannelKey('rotation.y');
    e.scrub(40); e.selected.rotation.y = Math.PI * 2; e.insertChannelKey('rotation.y');
    e.scrub(20);
  });

  await selectGraphChannel(page, 'Rotation Y');
  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="20"]').click();

  const value = page.getByLabel('Selected Graph key value');
  await expect(value).toHaveValue('270');
  await expect(page.locator('#graph-key-value-unit')).toHaveText('°');

  await value.fill('540');
  await page.getByRole('button', { name: 'Apply Graph key Frame and Value' }).click();

  const stored = await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['rotation.y'][0].value
  );
  expect(stored).toBeCloseTo(Math.PI * 3, 10);
  await expect(value).toHaveValue('540');

  await page.evaluate(() => (window as any).__forge.undo());
  const restored = await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['rotation.y'][0].value
  );
  expect(restored).toBeCloseTo(Math.PI * 1.5, 10);
});

test('Graph Key Inspector disables precise fields for multi-selection while batch controls stay available', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(60); e.selected.position.x = 12; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  const graph = page.getByLabel('Animation graph editor');
  await page.keyboard.down('Shift');
  await graph.locator('.graph-key-point[data-frame="20"]').click();
  await graph.locator('.graph-key-point[data-frame="40"]').click();
  await page.keyboard.up('Shift');

  await expect(page.locator('#graph-selection-count')).toHaveText('2 selected');
  await expect(page.getByLabel('Selected Graph key frame')).toBeDisabled();
  await expect(page.getByLabel('Selected Graph key value')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply Graph key Frame and Value' })).toBeDisabled();
  await expect(page.getByLabel('Selected key time scale')).toBeEnabled();
  await expect(page.getByLabel('Selected key interpolation')).toBeEnabled();
});

test('Graph Key Inspector Enter applies and Escape discards an uncommitted field edit', async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    delete e.selected.userData.animationTracks;
    e.scrub(20); e.selected.position.x = 2; e.insertChannelKey('position.x');
    e.scrub(40); e.selected.position.x = 8; e.insertChannelKey('position.x');
    e.scrub(20);
  });

  const graph = page.getByLabel('Animation graph editor');
  await graph.locator('.graph-key-point[data-frame="20"]').click();

  const frame = page.getByLabel('Selected Graph key frame');
  const value = page.getByLabel('Selected Graph key value');

  await frame.fill('25');
  await frame.press('Escape');
  await expect(frame).toHaveValue('20');
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'].map((key: any) => key.frame)
  )).toEqual([20, 40]);

  await value.fill('4.25');
  await value.press('Enter');
  expect(await page.evaluate(() =>
    (window as any).__forge.selected.userData.animationTracks['position.x'][0].value
  )).toBe(4.25);
  await expect(graph).toHaveAttribute('data-selected-frames', '20');
});
