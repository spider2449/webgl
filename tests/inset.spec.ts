import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { insetTriangle } from '../src/extrude';
import { buildTopology } from '../src/topology';

for (const expanded of [false, true]) {
  test(`inset preserves boundary, winding and interpolated UVs (${expanded})`, () => {
    const box = new THREE.BoxGeometry(2, 2, 2);
    const source = expanded ? box.toNonIndexed() : box;
    const before = JSON.stringify(source.toJSON());
    const result = insetTriangle(source, 0, 0.1);
    expect(JSON.stringify(source.toJSON())).toBe(before);
    expect(result.index!.count).toBe(54);
    const topology = buildTopology(result.attributes.position.array, result.index!.array);
    const uses = new Map<string, number[]>();
    for (const face of topology.faces) for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      uses.set(key, [...(uses.get(key) ?? []), a < b ? 1 : -1]);
    }
    for (const signs of uses.values()) { expect(signs).toHaveLength(2); expect(signs[0] + signs[1]).toBe(0); }
    const cap = source.attributes.position.count;
    const read = (i: number) => new THREE.Vector3().fromBufferAttribute(result.attributes.position, i);
    const corners = [0, 1, 2].map(i => source.index?.getX(i) ?? i);
    for (let i = 0; i < 3; i++) {
      const a = read(corners[i]), b = read(corners[(i + 1) % 3]);
      const inner = read(cap + i);
      expect(inner.x).toBeCloseTo(1);
      expect(inner.clone().sub(a).cross(b.clone().sub(a)).length() / a.distanceTo(b)).toBeCloseTo(0.1);
      expect(result.attributes.uv.getX(cap + i)).toBeCloseTo((1 - inner.z) / 2);
      expect(result.attributes.uv.getY(cap + i)).toBeCloseTo((inner.y + 1) / 2);
    }
    for (let i = 0; i < result.index!.count; i += 3) {
      const a = read(result.index!.getX(i)), b = read(result.index!.getX(i + 1)), c = read(result.index!.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).dot(a)).toBeGreaterThan(0);
    }
    expect(result.groups.slice(0, source.groups.length)).toEqual(source.groups);
    expect(result.groups.at(-1)).toEqual({ start: 36, count: 18, materialIndex: 0 });
  });
}

test('invalid inset and precision collapse leave geometry untouched', () => {
  const source = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(source.toJSON());
  for (const distance of [0, -1, NaN, Infinity, 1, 1001]) expect(() => insetTriangle(source, 0, distance)).toThrow();
  expect(JSON.stringify(source.toJSON())).toBe(before);
  source.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(24 * 4), 4));
  expect(() => insetTriangle(source, 0, 0.1)).toThrow(/skinWeight/);
  const distant = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([1e8, 1e8, 0, 1e8 + 32, 1e8, 0, 1e8, 1e8 + 32, 0], 3));
  expect(() => insetTriangle(distant, 0, 0.1)).toThrow(/precision/);
});

test('inset UI retains inner selection and restores history and projects', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectedFace = 0;
    e.selectComponentVertices(e.topology.faces[0]);
    return e.snapshot();
  });
  await page.locator('#inset-face').click();
  await expect(page.locator('#toast')).toContainText('Triangle inset');
  await page.locator('#inset-face').click();
  const valid = await page.evaluate(() => (window as any).__forge.snapshot());
  await page.getByLabel('Inset distance').fill('100');
  await page.locator('#inset-face').click();
  await expect(page.locator('#toast')).toContainText('inradius');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(valid);
  await page.screenshot({ path: 'test-results/inset.png' });
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, after = e.snapshot();
    const triangles = e.stats().triangles, face = e.selectedFace;
    e.undo(); e.undo(); const original = e.snapshot();
    e.redo(); e.redo(); const redone = e.snapshot();
    e.load(JSON.parse(after));
    return { after, triangles, face, original, redone, restored: e.snapshot() };
  });
  expect(result.triangles).toBe(24);
  expect(result.face).toBe(0);
  expect(result.original).toBe(before);
  expect(result.redone).toBe(result.after);
  expect(result.restored).toBe(result.after);
});
