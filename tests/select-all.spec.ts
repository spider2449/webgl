import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('A and Alt+A select and clear all logical Edit Mode components', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle geometry statistics' }).click();
  await page.locator('#mode').selectOption('edit');
  const initialUndoDepth = await page.evaluate(() => (window as any).__forge.undoDepth);

  for (const [mode, total, selectedStats] of [
    ['vertex', 8, 'Obj 1 · V 8 · E 12 · F 6 · T 12'],
    ['edge', 12, 'Obj 1 · V 8 · E 12 · F 6 · T 12'],
    ['face', 6, 'Obj 1 · V 8 · E 12 · F 6 · T 12'],
  ] as const) {
    await page.getByLabel('Mesh component').selectOption(mode);
    await page.keyboard.press('a');

    expect(await page.evaluate(currentMode => {
      const e = (window as any).__forge;
      const selection = [...e.componentSelection];
      return {
        count: selection.length,
        active: currentMode === 'edge' ? selection.at(-1) : null,
        selectedOverlay: currentMode === 'edge' ? e.selectedEdgeOverlay.geometry.instanceCount : null,
        activeOverlay: currentMode === 'edge' ? e.activeEdgeOverlay.geometry.instanceCount : null,
        undoDepth: e.undoDepth,
      };
    }, mode)).toEqual({
      count: total,
      active: mode === 'edge' ? 11 : null,
      selectedOverlay: mode === 'edge' ? 12 : null,
      activeOverlay: mode === 'edge' ? 1 : null,
      undoDepth: initialUndoDepth,
    });
    await expect(page.locator('#geometry-statistics-selected')).toHaveText(selectedStats);

    await page.keyboard.press('Alt+a');

    expect(await page.evaluate(currentMode => {
      const e = (window as any).__forge;
      return {
        count: e.componentSelection.length,
        selectedOverlay: currentMode === 'edge' ? e.selectedEdgeOverlay.geometry.instanceCount : null,
        activeOverlay: currentMode === 'edge' ? e.activeEdgeOverlay.geometry.instanceCount : null,
        undoDepth: e.undoDepth,
      };
    }, mode)).toEqual({
      count: 0,
      selectedOverlay: mode === 'edge' ? 0 : null,
      activeOverlay: mode === 'edge' ? 0 : null,
      undoDepth: initialUndoDepth,
    });
    await expect(page.locator('#geometry-statistics-selected')).toHaveText('Obj 1 · V 0 · E 0 · F 0 · T 0');
  }
});

test('Edit Mode context exposes Select All and Deselect All with correct enablement', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');

  for (const mode of ['vertex', 'edge', 'face'] as const) {
    await page.getByLabel('Mesh component').selectOption(mode);
    const viewport = page.locator('#viewport canvas');
    await viewport.click({ button: 'right', position: { x: 320, y: 220 } });
    const menu = page.locator('#viewport-context-menu');
    await expect(menu.getByRole('menuitem', { name: 'Select All A' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: 'Deselect All Alt A' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.evaluate(() => (window as any).__forge.selectComponent(0));
    await viewport.click({ button: 'right', position: { x: 320, y: 220 } });
    await expect(menu.getByRole('menuitem', { name: 'Deselect All Alt A' })).toBeEnabled();
    await page.keyboard.press('Escape');
  }
});

test('A remains unassigned to object selection outside Edit Mode', async ({ page }) => {
  await page.locator('#duplicate-rail').click();
  expect(await page.evaluate(() => (window as any).__forge.selectedObjects.size)).toBe(1);
  await page.keyboard.press('a');
  expect(await page.evaluate(() => (window as any).__forge.selectedObjects.size)).toBe(1);
});
