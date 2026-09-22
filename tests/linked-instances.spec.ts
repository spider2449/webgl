import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('linked duplicate shares mesh resources and survives history and project reload', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const source = e.selected;
    const sourceX = source.position.x;
    const created = e.duplicateLinked();
    const copy = e.selected;
    const linkedInitially = created && copy !== source && copy.geometry === source.geometry && copy.material === source.material;
    copy.position.y = 3;
    const independentTransform = source.position.x === sourceX && source.position.y !== copy.position.y;
    copy.material.color.set('#3366aa');
    const materialShared = source.material.color.getHexString() === '3366aa';
    const position = copy.geometry.getAttribute('position');
    const x = position.getX(0) + 0.125;
    position.setX(0, x);
    position.needsUpdate = true;
    const geometryShared = source.geometry.getAttribute('position').getX(0) === x;
    e.commit();

    e.undo();
    const undoSource = e.content.getObjectByName('Cube');
    const undoCopy = e.content.getObjectByName('Cube.001');
    const undoLinked = undoSource.geometry === undoCopy.geometry && undoSource.material === undoCopy.material;
    e.redo();
    const redoSource = e.content.getObjectByName('Cube');
    const redoCopy = e.content.getObjectByName('Cube.001');
    const redoLinked = redoSource.geometry === redoCopy.geometry && redoSource.material === redoCopy.material;

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restoredSource = e.content.getObjectByName('Cube');
    const restoredCopy = e.content.getObjectByName('Cube.001');
    const restoredLinked = restoredSource.geometry === restoredCopy.geometry && restoredSource.material === restoredCopy.material;
    e.select(restoredCopy);
    e.remove();
    const remaining = e.content.getObjectByName('Cube');
    const remainingHealthy = remaining.geometry.getAttribute('position').count > 0 && remaining.material.color.getHexString() === '3366aa';

    return { linkedInitially, independentTransform, materialShared, geometryShared, undoLinked, redoLinked, restoredLinked, remainingHealthy };
  });

  expect(result).toEqual({
    linkedInitially: true,
    independentTransform: true,
    materialShared: true,
    geometryShared: true,
    undoLinked: true,
    redoLinked: true,
    restoredLinked: true,
    remainingHealthy: true,
  });
});

test('Alt+D creates a linked duplicate while Shift+D remains independent', async ({ page }) => {
  const originalUuid = await page.evaluate(() => (window as any).__forge.selected.uuid);

  await page.keyboard.press('Alt+d');
  await expect(page.locator('.object-row')).toHaveCount(2);
  const linked = await page.evaluate((sourceUuid) => {
    const e = (window as any).__forge;
    const source = e.content.getObjectByProperty('uuid', sourceUuid);
    const copy = e.selected;
    return {
      uuid: copy.uuid,
      distinctObject: copy !== source,
      geometryShared: copy.geometry === source.geometry,
      materialShared: copy.material === source.material,
    };
  }, originalUuid);
  expect(linked).toMatchObject({ distinctObject: true, geometryShared: true, materialShared: true });

  await page.keyboard.press('Shift+d');
  await expect(page.locator('.object-row')).toHaveCount(3);
  expect(await page.evaluate((linkedUuid) => {
    const e = (window as any).__forge;
    const source = e.content.getObjectByProperty('uuid', linkedUuid);
    const copy = e.selected;
    return {
      distinctObject: copy !== source,
      geometryIndependent: copy.geometry !== source.geometry,
      materialIndependent: copy.material !== source.material,
    };
  }, linked.uuid)).toEqual({ distinctObject: true, geometryIndependent: true, materialIndependent: true });
});

test('linked duplicate rejects unsupported mesh states without mutation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const source = e.selected;
    source.userData.modifierStack = [{ type: 'smooth', enabled: true, strength: 0.5 }];
    const before = e.snapshot();
    const created = e.duplicateLinked();
    return { created, unchanged: before === e.snapshot(), count: e.content.children.length };
  });
  expect(result).toEqual({ created: false, unchanged: true, count: 1 });
});
