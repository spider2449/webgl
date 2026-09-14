import { test, expect } from '@playwright/test';

test('texture painting preserves mesh data and survives history and project round trips', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, mesh = e.selected;
    const positions = Array.from(mesh.geometry.attributes.position.array), uv = Array.from(mesh.geometry.attributes.uv.array);
    e.ensureTexturePaint();
    const blank = e.snapshot();
    e.paintTextureAt(0.5, 0.5, '#ff0000', 12);
    const canvas = e.texturePaintCanvas, context = canvas.getContext('2d');
    const paintedPixel = context.getImageData(128, 128, 1, 1).data.slice(0, 3);
    e.finishTexturePaint();
    const painted = e.snapshot();
    let invalid = '';
    try { e.paintTextureAt(Number.NaN, 0.5, '#00ff00', 12); } catch (error) { invalid = String(error); }
    const invalidUnchanged = e.snapshot() === painted;
    const originalUV = mesh.geometry.getAttribute('uv');
    mesh.geometry.deleteAttribute('uv');
    let missingUV = '';
    try { e.ensureTexturePaint(); } catch (error) { missingUV = String(error); }
    mesh.geometry.setAttribute('uv', originalUV);
    const invalidRadiusBefore = e.snapshot();
    let invalidRadius = '';
    try { e.paintTextureAt(0.5, 0.5, '#00ff00', 129); } catch (error) { invalidRadius = String(error); }
    const invalidRadiusUnchanged = e.snapshot() === invalidRadiusBefore;
    e.undo(); const undone = e.snapshot();
    e.redo(); const redone = e.snapshot();
    e.load(JSON.parse(painted)); const roundTrip = e.snapshot();
    const restored = e.selected.material.map !== null;
    const imageSignature = (snapshot: string) => { const url = JSON.parse(snapshot).scene.images?.[0]?.url; return typeof url === 'string' ? [url.length, url.slice(0, 22), url.slice(-16)] : null; };
    return { paintedPixel: Array.from(paintedPixel), invalid, invalidUnchanged, missingUV, invalidRadius, invalidRadiusUnchanged, blankDiffers: blank !== painted, undoDiffers: undone !== painted, redoImageSame: JSON.stringify(imageSignature(redone)) === JSON.stringify(imageSignature(painted)), roundTripImageSame: JSON.stringify(imageSignature(roundTrip)) === JSON.stringify(imageSignature(painted)), restored, positionsSame: Array.from(e.selected.geometry.attributes.position.array).every((v: number, i: number) => v === positions[i]), uvSame: Array.from(e.selected.geometry.attributes.uv.array).every((v: number, i: number) => v === uv[i]) };
  });
  expect(result).toEqual({
    paintedPixel: [255, 0, 0],
    invalid: 'Error: Enter a valid paint color and brush size.',
    invalidUnchanged: true,
    missingUV: 'Error: Select a mesh with UV coordinates first.',
    invalidRadius: 'Error: Enter a valid paint color and brush size.',
    invalidRadiusUnchanged: true,
    blankDiffers: true,
    undoDiffers: true,
    redoImageSame: true,
    roundTripImageSame: true,
    restored: true,
    positionsSame: true,
    uvSame: true,
  });
});

test('material panel enables and paints an embedded texture', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('[data-workspace="material"]').click();
  await page.locator('#paint-enable').click();
  await expect(page.locator('#toast')).toContainText('enabled');
  const canvas = await page.locator('#paint-view').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  expect(await page.evaluate(() => {
    const e = (window as any).__forge, c = e.texturePaintCanvas, pixel = c.getContext('2d').getImageData(128, 128, 1, 1).data;
    return { map: !!e.selected.material.map, pixel: [...pixel].slice(0, 3) };
  })).toEqual({ map: true, pixel: [224, 128, 80] });
});
