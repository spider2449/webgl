import { test, expect } from '@playwright/test';

test('collections organize scene members without changing mesh data', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const cube = e.selected, positions = Array.from(cube.geometry.attributes.position.array), local = cube.position.toArray();
    const collection = e.createCollection('Props');
    e.moveSelectedToCollection(collection);
    const moved = cube.parent === collection && cube.position.toArray().every((v: number, i: number) => v === local[i]) && Array.from(cube.geometry.attributes.position.array).every((v: number, i: number) => v === positions[i]);
    e.duplicate();
    const copy = e.selected;
    const duplicatedInCollection = copy.parent === collection;
    e.select(cube);
    e.unlinkSelectedFromCollection();
    const afterUnlink = cube.parent === e.content;
    e.undo();
    const undoCollection = e.content.getObjectByProperty('name', 'Props');
    const afterUndo = e.content.getObjectByProperty('name', 'Cube')?.parent === undoCollection && e.content.getObjectByProperty('name', 'Cube.001')?.parent === undoCollection;
    e.redo();
    const afterRedo = e.content.getObjectByProperty('name', 'Cube')?.parent === e.content;
    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restoredCube = e.content.getObjectByProperty('name', 'Cube');
    const restoredCollection = e.content.getObjectByProperty('name', 'Props');
    let nonEmptyDelete = '';
    try { e.deleteCollection(restoredCollection); } catch (error) { nonEmptyDelete = String(error); }
    return { moved, duplicatedInCollection, afterUnlink, afterUndo, afterRedo, restored: restoredCube?.parent === e.content, collectionChildren: restoredCollection?.children.length, nonEmptyDelete };
  });
  expect(result).toEqual({
    moved: true,
    duplicatedInCollection: true,
    afterUnlink: true,
    afterUndo: true,
    afterRedo: true,
    restored: true,
    collectionChildren: 1,
    nonEmptyDelete: 'Error: Only empty collections can be deleted.',
  });
});

test('collection outliner creates, moves, unlinks and deletes an empty collection', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#collection-name').fill('Environment');
  await page.getByLabel('Create collection').click();
  await expect(page.locator('.collection-entry')).toContainText('Environment');
  await page.locator('#collection-target').selectOption({ label: 'Environment' });
  await page.getByLabel('Move selected to collection').click();
  await expect(page.locator('#toast')).toContainText('moved to Environment');
  expect(await page.evaluate(() => (window as any).__forge.selected.parent.name)).toBe('Environment');
  await page.getByLabel('Unlink from collection').click();
  await expect(page.locator('#toast')).toContainText('unlinked');
  expect(await page.evaluate(() => (window as any).__forge.selected.parent.name)).toBe('Scene Collection');
  await page.getByLabel('Delete empty collection').click();
  await expect(page.locator('#toast')).toContainText('deleted');
  await expect(page.locator('.collection-entry')).toHaveCount(0);
});
