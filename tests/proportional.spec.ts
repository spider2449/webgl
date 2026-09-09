import { test, expect } from '@playwright/test';
import { buildTopology } from '../src/topology';
import { proportionalWeights } from '../src/proportional';

test('smooth local falloff preserves seams and radius boundaries', () => {
  const positions = [0,0,0, 1,0,0, 2,0,0, 3,0,0, 1,0,0, 0,0,0];
  const topology = buildTopology(positions);
  expect(Array.from(proportionalWeights(positions, topology, [0,5], 2))).toEqual([1,0.5,0,0,0.5,1]);
  expect(Array.from(proportionalWeights(positions, topology, [0,3], 2))).toEqual([1,0.5,0.5,1,0.5,1]);
  expect(Array.from(proportionalWeights(positions, topology, [], 2))).toEqual([0,0,0,0,0,0]);
  for (const radius of [0,-1,NaN,Infinity]) expect(() => proportionalWeights(positions, topology, [0], radius)).toThrow(/radius/);
});

for (const mode of ['vertex', 'edge', 'face'] as const) test(`proportional ${mode} drag is stable and survives history and projects`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption(mode);
  await page.getByLabel('Proportional editing', { exact: true }).check();
  await page.getByLabel('Proportional radius').fill('3');
  await page.getByLabel('Proportional radius').press('Tab');
  await page.getByLabel('Proportional radius').fill('0');
  await page.getByLabel('Proportional radius').press('Tab');
  await expect(page.locator('#toast')).toContainText('finite positive');
  await expect(page.getByLabel('Proportional radius')).toHaveValue('3');
  const result = await page.evaluate(mode => {
    const e = (window as any).__forge, mesh = e.selected;
    mesh.rotation.set(0,0,0); mesh.scale.set(1.5,0.8,1.2); e.commit();
    const vertices = mode === 'vertex' ? [0] : mode === 'edge' ? e.topology.edges[0] : e.topology.faces[0];
    e.selectComponentVertices(vertices);
    const position = mesh.geometry.attributes.position;
    const before = Array.from(position.array) as number[], selected = [...e.vertexIndices] as number[];
    const start = e.vertexProxy.position.clone();
    const move = (x: number) => { e.vertexProxy.position.copy(start); e.vertexProxy.position.x += x; e.transform.dispatchEvent({type:'objectChange'}); };
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    move(0.3); move(0.75);
    const after = Array.from(position.array) as number[];
    const expected = before.map((v, i) => {
      if (i % 3 !== 0) return v;
      let d = Infinity;
      for (const seed of selected) d = Math.min(d, Math.hypot(v-before[seed*3],before[i+1]-before[seed*3+1],before[i+2]-before[seed*3+2]));
      const t = Math.max(0,1-d/3);
      return v+0.5*t*t*(3-2*t);
    });
    move(0);
    const reset = Array.from(position.array);
    move(0.75);
    e.transform.dispatchEvent({type:'dragging-changed',value:false});
    // A new drag must capture fresh positions, then return exactly to them.
    const next = e.vertexProxy.position.clone();
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    e.vertexProxy.position.x += 0.2; e.transform.dispatchEvent({type:'objectChange'});
    e.vertexProxy.position.copy(next); e.transform.dispatchEvent({type:'objectChange'});
    e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const repeated = Array.from(position.array), saved = e.snapshot();
    e.undo(); const undone = Array.from(e.selected.geometry.attributes.position.array);
    e.redo(); const redone = Array.from(e.selected.geometry.attributes.position.array);
    e.load(JSON.parse(saved));
    return { before, after, expected, reset, repeated, undone, redone, restored: Array.from(e.selected.geometry.attributes.position.array), influenced: after.some((v,i) => i%3===0 && !selected.includes(i/3) && v!==before[i]) };
  }, mode);
  result.after.forEach((v,i) => expect(v).toBeCloseTo(result.expected[i], 5));
  expect(result.influenced).toBe(true);
  expect(result.reset).toEqual(result.before);
  expect(result.repeated).toEqual(result.after);
  expect(result.undone).toEqual(result.before);
  expect(result.redone).toEqual(result.after);
  expect(result.restored).toEqual(result.after);
});
