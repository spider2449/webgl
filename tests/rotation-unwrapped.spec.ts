import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('rotation gizmo keeps positive turns instead of folding back to ±180 degrees', async ({ page }) => {
  const input = page.locator('[data-transform="rotation"][data-axis="x"]');
  await input.fill('270');
  await input.press('Tab');
  expect(Number(await input.inputValue())).toBeCloseTo(270, 6);

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    e.setTool('rotate');
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    object.rotation.x = -80 * Math.PI / 180;
    e.transform.dispatchEvent({ type: 'objectChange' });
    const during = object.rotation.x * 180 / Math.PI;
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
    return during;
  });

  expect(result).toBeCloseTo(280, 6);
  expect(Number(await input.inputValue())).toBeCloseTo(280, 6);
});

test('rotation gizmo keeps negative turns and unwraps across 180 degrees', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const dragToCanonical = (startDegrees: number, canonicalDegrees: number) => {
      object.rotation.y = startDegrees * Math.PI / 180;
      e.setTool('rotate');
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      object.rotation.y = canonicalDegrees * Math.PI / 180;
      e.transform.dispatchEvent({ type: 'objectChange' });
      const degrees = object.rotation.y * 180 / Math.PI;
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return degrees;
    };
    return {
      negative: dragToCanonical(-270, 80),
      crossing: dragToCanonical(170, -170),
    };
  });

  expect(result.negative).toBeCloseTo(-280, 6);
  expect(result.crossing).toBeCloseTo(190, 6);
});

test('unwrapped gizmo rotation keeps the same quaternion orientation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.rotation.z = 270 * Math.PI / 180;
    e.setTool('rotate');
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    object.rotation.z = -75 * Math.PI / 180;
    const canonical = object.quaternion.toArray();
    e.transform.dispatchEvent({ type: 'objectChange' });
    const unwrapped = object.quaternion.toArray();
    const degrees = object.rotation.z * 180 / Math.PI;
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
    return { canonical, unwrapped, degrees };
  });

  expect(result.degrees).toBeCloseTo(285, 6);
  result.canonical.forEach((value: number, index: number) => expect(result.unwrapped[index]).toBeCloseTo(value, 10));
});
