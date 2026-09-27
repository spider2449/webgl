import { test, expect } from '@playwright/test';

test('geometry statistics toggle shows logical scene and selected counts', async ({ page }) => {
  await page.goto('/');

  const overlay = page.getByLabel('Geometry statistics');
  const toggle = page.getByRole('button', { name: 'Toggle geometry statistics' });
  await expect(overlay).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(overlay).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#geometry-statistics-mode')).toHaveText('OBJECT');
  await expect(page.locator('#geometry-statistics-all')).toHaveText('Obj 1 · V 8 · E 12 · F 6 · T 12');
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 8 · E 12 · F 6 · T 12');

  await page.locator('#duplicate-rail').click();
  await expect(page.locator('#geometry-statistics-all')).toHaveText('Obj 2 · V 16 · E 24 · F 12 · T 24');
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 8 · E 12 · F 6 · T 12');

  await page.evaluate(() => {
    const e = (window as any).__forge;
    const roots = e.content.children.filter((object: any) => object.userData.forgeCollection !== true);
    e.select(roots[0]);
    e.select(roots[1], true);
  });
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 2 · V 16 · E 24 · F 12 · T 24');

  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await expect(page.locator('#geometry-statistics-mode')).toHaveText('EDIT · EDGE');
  await expect(page.locator('#geometry-statistics-all')).toHaveText('Obj 2 · V 16 · E 24 · F 12 · T 24');
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 2 · E 1 · F 0 · T 0');

  await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  await expect(page.locator('#geometry-statistics-mode')).toHaveText('EDIT · FACE');
  await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 4 · E 4 · F 1 · T 2');

  await toggle.click();
  await expect(overlay).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
