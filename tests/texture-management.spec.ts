import { test, expect } from '@playwright/test';

test('local texture import is embedded and preserves mesh and UV data', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, mesh = e.selected;
    const positions = Array.from(mesh.geometry.attributes.position.array), uv = Array.from(mesh.geometry.attributes.uv.array);
    const source = document.createElement('canvas'); source.width = 2; source.height = 1;
    const sourceContext = source.getContext('2d'); sourceContext.fillStyle = '#ff0000'; sourceContext.fillRect(0, 0, 1, 1); sourceContext.fillStyle = '#0000ff'; sourceContext.fillRect(1, 0, 1, 1);
    const blob = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!), 'image/png'));
    await e.importTexture(new File([blob], 'source.png', { type: 'image/png' }));
    const canvas = e.texturePaintCanvas, context = canvas.getContext('2d');
    const pixels = [...context.getImageData(0, 128, 1, 1).data.slice(0, 3), ...context.getImageData(255, 128, 1, 1).data.slice(0, 3)];
    const imported = e.snapshot();
    const imageURL = JSON.parse(imported).scene.images?.[0]?.url ?? '';
    const invalidBefore = e.snapshot(); let invalid = '';
    try { await e.importTexture(new File(['not an image'], 'bad.txt', { type: 'text/plain' })); } catch (error) { invalid = String(error); }
    const invalidUnchanged = e.snapshot() === invalidBefore;
    e.undo(); const undone = e.snapshot(); e.redo(); const redone = e.snapshot();
    e.load(JSON.parse(imported)); const roundTrip = e.snapshot();
    const signature = (snapshot: string) => { const url = JSON.parse(snapshot).scene.images?.[0]?.url; return typeof url === 'string' ? [url.length, url.slice(0, 22), url.slice(-16)] : null; };
    return { pixels, embedded: imageURL.startsWith('data:image/'), invalid, invalidUnchanged, undoDiffers: undone !== imported, redoImageSame: JSON.stringify(signature(redone)) === JSON.stringify(signature(imported)), roundTripImageSame: JSON.stringify(signature(roundTrip)) === JSON.stringify(signature(imported)), positionsSame: Array.from(e.selected.geometry.attributes.position.array).every((v: number, i: number) => v === positions[i]), uvSame: Array.from(e.selected.geometry.attributes.uv.array).every((v: number, i: number) => v === uv[i]) };
  });
  expect(result).toEqual({
    pixels: [255, 0, 0, 0, 0, 255],
    embedded: true,
    invalid: 'Error: Use a PNG, JPEG or WebP texture.',
    invalidUnchanged: true,
    undoDiffers: true,
    redoImageSame: true,
    roundTripImageSame: true,
    positionsSame: true,
    uvSame: true,
  });
});

test('material panel exports the active embedded texture as PNG', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('[data-workspace="material"]').click();
  await page.locator('#paint-enable').click();
  const download = page.waitForEvent('download');
  await page.locator('#texture-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Untitled scene-texture.png');
});
