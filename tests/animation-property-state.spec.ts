import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('Transform fields show Blender-like keyframe state colors per channel', async ({ page }) => {
  const positionX = page.locator('.axis-input:has(input[data-transform="position"][data-axis="x"])');
  const positionY = page.locator('.axis-input:has(input[data-transform="position"][data-axis="y"])');
  const rotationY = page.locator('.axis-input:has(input[data-transform="rotation"][data-axis="y"])');
  const scaleZ = page.locator('.axis-input:has(input[data-transform="scale"][data-axis="z"])');

  await expect(positionX).toHaveAttribute('data-key-state', 'none');
  await expect(positionY).toHaveAttribute('data-key-state', 'none');
  await expect(rotationY).toHaveAttribute('data-key-state', 'none');
  await expect(scaleZ).toHaveAttribute('data-key-state', 'none');

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.frame = 1;
    e.selected.position.set(0, 0, 0);
    e.selected.rotation.set(0, 0, 0);
    e.selected.scale.set(1, 1, 1);
    e.insertKey();
  });

  for (const field of [positionX, positionY, rotationY, scaleZ]) {
    await expect(field).toHaveAttribute('data-key-state', 'keyed-current');
    await expect(field).toHaveClass(/key-state-current/);
  }
  await expect(positionX).toHaveAttribute('title', 'Keyframed on the current frame');

  await page.evaluate(() => (window as any).__forge.scrub(13));
  for (const field of [positionX, positionY, rotationY, scaleZ]) {
    await expect(field).toHaveAttribute('data-key-state', 'animated');
    await expect(field).toHaveClass(/key-state-animated/);
  }
  await expect(positionX).toHaveAttribute('title', 'Animated; keyframe is on another frame');

  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.position.x += 2;
    e.commit();
  });

  await expect(positionX).toHaveAttribute('data-key-state', 'changed');
  await expect(positionX).toHaveClass(/key-state-changed/);
  await expect(positionX).toHaveAttribute('title', 'Changed from the animated value; insert a key to store it');
  await expect(positionY).toHaveAttribute('data-key-state', 'animated');
  await expect(rotationY).toHaveAttribute('data-key-state', 'animated');
  await expect(scaleZ).toHaveAttribute('data-key-state', 'animated');

  await page.evaluate(() => (window as any).__forge.insertKey());
  for (const field of [positionX, positionY, rotationY, scaleZ]) {
    await expect(field).toHaveAttribute('data-key-state', 'keyed-current');
  }

  await positionX.screenshot({ path: 'test-results/transform-key-state.png' });
});
