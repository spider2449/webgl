import { test, expect } from '@playwright/test';
import { buildTopology } from '../src/modeling/topology';
import { proportionalWeights } from '../src/modeling/proportional';

test('connected falloff follows edge paths, welds seams and isolates islands', () => {
  const positions = [0,0,0, 2,0,0, 2,1,0, 0,1,0, 0,0,0, 0,0,0.1, 1,0,0.1, 0,1,0.1];
  const topology = buildTopology(positions, [4,1,2, 1,3,2, 5,6,7]);
  const weights = proportionalWeights(positions, topology, [0], 5, true);
  const smooth = (distance: number) => { const t = Math.max(0, 1 - distance / 5); return t*t*(3-2*t); };
  [0,2,Math.sqrt(5),2+Math.sqrt(5),0].forEach((d,i) => expect(weights[i]).toBeCloseTo(smooth(d), 6));
  expect(Array.from(weights.slice(5))).toEqual([0,0,0]);
  expect(weights[4]).toBe(1);
  expect(proportionalWeights(positions, topology, [0], 5)[5]).toBeGreaterThan(0.9);
  expect(proportionalWeights(positions, topology, [0], 2, true)[1]).toBe(0);
  const multiple = proportionalWeights(positions, topology, [0,3,5,4], 5, true);
  expect(multiple[3]).toBe(1); expect(multiple[5]).toBe(1);
  expect(multiple[6]).toBeCloseTo(smooth(1), 6);
  expect(Array.from(proportionalWeights(positions, topology, [], 5, true))).toEqual(Array(8).fill(0));
});

test('connected UI drag preserves disconnected geometry, history and projects', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge, mesh = e.selected;
    const geometry = mesh.geometry.clone();
    geometry.setIndex(null); geometry.clearGroups();
    for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
    geometry.setAttribute('position', new mesh.geometry.attributes.position.constructor(new Float32Array([
      0,0,0, 1,0,0, 0,1,0, 0,0,0.1, 1,0,0.1, 0,1,0.1,
    ]), 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    mesh.geometry = geometry; mesh.rotation.set(0,0,0); mesh.scale.set(2,1,1); e.commit();
  });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Proportional editing', { exact: true }).check();
  await page.getByLabel('Connected only', { exact: true }).check();
  await page.getByLabel('Proportional radius').fill('2');
  await page.getByLabel('Proportional radius').press('Tab');
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selectComponentVertices([0]);
    const before = e.snapshot();
    const move = (dx: number) => { e.vertexProxy.position.x = start.x + dx; e.transform.dispatchEvent({type:'objectChange'}); };
    const start = e.vertexProxy.position.clone();
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    move(0.2); move(1);
    const moved = Array.from(e.selected.geometry.attributes.position.array);
    move(0); const reset = Array.from(e.selected.geometry.attributes.position.array);
    move(1); e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const after = e.snapshot();
    e.undo(); const undone = e.snapshot(); e.redo(); const redone = e.snapshot();
    e.load(JSON.parse(after));
    return { before, moved, reset, after, undone, redone, restored: e.snapshot() };
  });
  expect(result.moved).toEqual([0.5,0,0, 1.25,0,0, 0.25,1,0, ...result.reset.slice(9)]);
  expect(result.reset.slice(0,9)).toEqual([0,0,0, 1,0,0, 0,1,0]);
  expect(result.undone).toBe(result.before);
  expect(result.redone).toBe(result.after);
  expect(result.restored).toBe(result.after);
  await expect(page.getByLabel('Connected only', { exact: true })).toBeChecked();
  // Switching back to Euclidean influence reaches the nearby island again.
  await page.getByLabel('Connected only', { exact: true }).uncheck();
  const islandMoved = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setEditMode(true); e.selectComponentVertices([0]);
    const p = e.selected.geometry.attributes.position, before = p.getX(3);
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    e.vertexProxy.position.x += 1; e.transform.dispatchEvent({type:'objectChange'});
    e.transform.dispatchEvent({type:'dragging-changed',value:false});
    return p.getX(3) > before;
  });
  expect(islandMoved).toBe(true);
});
