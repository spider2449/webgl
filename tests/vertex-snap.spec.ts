import { test, expect } from '@playwright/test';

for (const mode of ['vertex', 'edge', 'face'] as const) test(`viewport vertex snap translates ${mode} selection and preserves history`, async ({ page }) => {
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
    const components: number[][] = mode === 'vertex' ? t.vertices.map((_: unknown,i: number)=>[i]) : mode === 'edge' ? t.polygonEdges : t.polygons;
    const source = components.findIndex(vs=>vs.every(v=>a.getZ(t.vertices[v][0])===-1));
    e.selectComponent(source);
    const target = t.vertices.findIndex((copies: number[])=>a.getZ(copies[0])===1);
    const targetPosition = m.position.clone().fromBufferAttribute(a,t.vertices[target][0]);
    const delta = targetPosition.clone().sub(e.componentCenter).toArray();
    m.updateWorldMatrix(true,true); e.camera.updateMatrixWorld(true);
    const projected = m.localToWorld(targetPosition).project(e.camera), rect = e.host.getBoundingClientRect();
    return { before:e.snapshot(), positions:Array.from(a.array), indices:[...e.vertexIndices], delta,
      x:rect.left+(projected.x+1)*rect.width/2, y:rect.top+(1-projected.y)*rect.height/2 };
  }, mode);
  await page.locator('#vertex-snap').click();
  await expect(page.locator('#vertex-snap')).toHaveText('Cancel snap target');
  await page.mouse.click(state.x,state.y);
  await expect(page.locator('#toast')).toContainText('Selection center snapped');
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

test('snap invalid targets and cancellation leave geometry and selection intact', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#vertex-snap').click();
  await expect(page.locator('#toast')).toContainText('Select mesh components');
  await page.locator('#mode').selectOption('edit');
  const before = await page.evaluate(() => {
    const e=(window as any).__forge; e.selectComponent(0); return e.snapshot();
  });
  await page.locator('#vertex-snap').click();
  const invalid = await page.evaluate(() => {
    const e=(window as any).__forge, errors=[];
    for (const id of [-1,NaN,1000000,0]) { try { e.snapSelectionToVertex(id); } catch (error) { errors.push(String(error)); } }
    return {errors,snapshot:e.snapshot(),pending:e.snapTargetPending};
  });
  expect(invalid.errors).toHaveLength(4); expect(invalid.snapshot).toBe(before); expect(invalid.pending).toBe(true);
  // Empty target clicks do not discard the source selection or pending action.
  const box=await page.getByLabel('Interactive 3D viewport').boundingBox();
  await page.mouse.click(box!.x+20,box!.y+100);
  await expect(page.locator('#vertex-snap')).toHaveText('Cancel snap target');
  await page.keyboard.press('Escape');
  await expect(page.locator('#vertex-snap')).toHaveText('Pick snap target');
  expect(await page.evaluate(()=>(window as any).__forge.snapshot())).toBe(before);
  expect(await page.evaluate(()=>(window as any).__forge.vertexIndices.length)).toBeGreaterThan(0);
  await page.locator('#vertex-snap').click();
  await page.locator('#vertex-snap').click();
  await expect(page.locator('#vertex-snap')).toHaveText('Pick snap target');
  await page.locator('#vertex-snap').click();
  await page.getByLabel('Mesh component').selectOption('edge');
  await expect(page.locator('#vertex-snap')).toHaveText('Pick snap target');
});

test('repeated multi-vertex snaps use local coordinates and reject overflow before mutation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(() => {
    const e=(window as any).__forge, mesh=e.selected;
    mesh.rotation.set(0.3,0.7,0.2); mesh.scale.set(-2,0,0.5);
    e.setEditMode(true); e.selectComponent(0); e.selectComponent(1,true);
    const indices=[...e.vertexIndices], a=mesh.geometry.attributes.position;
    const initial=Array.from(a.array) as number[];
    const start=e.componentCenter.clone();
    for (const id of [2,3]) e.snapSelectionToVertex(id);
    const target=mesh.position.clone().fromBufferAttribute(a,e.topology.vertices[3][0]);
    const delta=target.sub(start).toArray(), moved=Array.from(a.array);
    // A translated selected extreme must not overflow the Float32 buffer.
    for (const i of e.topology.vertices[0]) a.setXYZ(i,3e38,0,0);
    for (const i of e.topology.vertices[1]) a.setXYZ(i,-3e38,0,0);
    for (const i of e.topology.vertices[2]) a.setXYZ(i,3e38,1,0);
    e.selectComponentVertices([0,1]);
    const before=Array.from(a.array);
    let error=''; try { e.snapSelectionToVertex(2); } catch (caught) { error=String(caught); }
    return { initial,indices,delta,moved,error,before,after:Array.from(a.array) };
  });
  result.moved.forEach((v: any,i: number)=>expect(v).toBeCloseTo(result.initial[i]+(result.indices.includes(Math.floor(i/3))?result.delta[i%3]:0),5));
  expect(result.error).toContain('precision');
  expect(result.after).toEqual(result.before);
});
