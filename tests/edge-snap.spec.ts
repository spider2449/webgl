import { test, expect } from '@playwright/test';

test('edge midpoint overflow is rejected before any geometry changes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.setEditMode(true);
    const t = e.topology, a = e.selected.geometry.attributes.position;
    const edge = 0, endpoints: number[] = t.edges[edge];
    const source = t.vertices.map((_: unknown, i: number) => i).filter((i: number) => !endpoints.includes(i)).slice(0, 2);
    for (const i of t.vertices[source[0]]) a.setXYZ(i, 3e38, 0, 0);
    for (const i of t.vertices[source[1]]) a.setXYZ(i, -3e38, 0, 0);
    for (const v of endpoints) for (const i of t.vertices[v]) a.setXYZ(i, 3e38, v, 0);
    e.selectComponent(source[0]); e.selectComponent(source[1], true);
    const before = Array.from(a.array);
    let error = '';
    try { e.snapSelectionToEdge(edge); } catch (caught) { error = String(caught); }
    return { before, after: Array.from(a.array), error };
  });
  expect(result.error).toContain('precision');
  expect(result.after).toEqual(result.before);
});

test('edge targets reject selected endpoints and cancel without mutation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#mode').selectOption('edit');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge; e.selectComponent(0); return e.snapshot();
  });
  await page.getByLabel('Snap target', { exact: true }).selectOption('edge');
  await page.locator('#vertex-snap').click();
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, errors = [];
    const shared = e.topology.polygonEdges.findIndex((vs: number[]) => vs.includes(0));
    for (const id of [-1, NaN, 1000000, shared]) {
      try { e.snapSelectionToEdge(id); } catch (error) { errors.push(String(error)); }
    }
    return { errors, snapshot: e.snapshot(), pending: e.snapTargetPending, guides: e.componentEdges.visible };
  });
  expect(result.errors).toHaveLength(4);
  expect(result.snapshot).toBe(before);
  expect(result.pending).toBe(true);
  expect(result.guides).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__forge.componentEdges.visible)).toBe(false);
  await page.locator('#vertex-snap').click();
  await page.getByLabel('Snap target', { exact: true }).selectOption('vertex');
  await expect(page.locator('#vertex-snap')).toHaveText('Pick snap target');
  expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before);
});

for (const mode of ['vertex', 'edge', 'face'] as const) test(`viewport edge midpoint snap translates ${mode} selection and preserves history`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0,0,0); e.selected.scale.set(1.5,0.8,1.2); e.selected.position.set(0.3,0.2,0);
    e.commit(); e.view('front');
  });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption(mode);
  await page.getByLabel('Proportional editing', { exact: true }).check();
  await page.getByLabel('Toggle grid snap (Shift Tab)', { exact: true }).click();
  const state = await page.evaluate(mode => {
    const e = (window as any).__forge, m = e.selected, t = e.topology, a = m.geometry.attributes.position;
    const components: number[][] = mode === 'vertex' ? t.vertices.map((_: unknown,i: number)=>[i]) : mode === 'edge' ? t.edges : t.faces;
    const source = components.findIndex(vs=>vs.every(v=>a.getZ(t.vertices[v][0])===-1));
    e.selectComponent(source);
    const target = t.edges.findIndex((vertices: number[])=>vertices.every(v=>a.getZ(t.vertices[v][0])===1) && vertices.every(v=>a.getY(t.vertices[v][0])===1));
    const targetPosition = m.position.clone().fromBufferAttribute(a,t.vertices[t.edges[target][0]][0]).lerp(m.position.clone().fromBufferAttribute(a,t.vertices[t.edges[target][1]][0]),0.5);
    const delta = targetPosition.clone().sub(e.componentCenter).toArray();
    m.updateWorldMatrix(true,true); e.camera.updateMatrixWorld(true);
    const projected = m.localToWorld(targetPosition).project(e.camera), rect = e.host.getBoundingClientRect();
    return { before:e.snapshot(), positions:Array.from(a.array), indices:[...e.vertexIndices], delta,
      x:rect.left+(projected.x+1)*rect.width/2, y:rect.top+(1-projected.y)*rect.height/2 };
  }, mode);
  await page.getByLabel('Snap target', {exact:true}).selectOption('edge');
  await page.locator('#vertex-snap').click();
  await expect(page.locator('#vertex-snap')).toHaveText('Cancel snap target');
  if (mode === 'vertex') await page.screenshot({path:'test-results/edge-midpoint-picking.png'});
  await page.mouse.click(state.x,state.y);
  await expect(page.locator('#toast')).toContainText('Selection center snapped to edge midpoint');
  await expect(page.locator('#vertex-snap')).toHaveText('Pick snap target');
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, positions = Array.from(e.selected.geometry.attributes.position.array), after = e.snapshot();
    e.undo(); const undone=e.snapshot(); e.redo(); const redone=e.snapshot();
    e.load(JSON.parse(after)); return { positions,after,undone,redone,restored:e.snapshot() };
  });
  result.positions.forEach((value: any,i: number)=>expect(value).toBeCloseTo((state.positions[i] as number)+(state.indices.includes(Math.floor(i/3))?state.delta[i%3]:0),5));
  expect(result.undone).toBe(state.before);
  expect(result.redone).toBe(result.after);
  expect(result.restored).toBe(result.after);
});
