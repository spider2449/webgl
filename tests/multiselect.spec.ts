import { test, expect } from '@playwright/test';

for (const mode of ['vertex', 'edge', 'face'] as const) test(`Shift-click ${mode} selection toggles shared vertices and clears predictably`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0,0,0); e.selected.scale.set(1.5,0.8,1.2); e.commit(); e.view('front');
  });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption(mode);
  const targets = await page.evaluate(mode => {
    const e = (window as any).__forge, m = e.selected, t = e.topology;
    m.updateWorldMatrix(true, true);
    e.camera.updateMatrixWorld(true);
    const read = (v: number) => m.position.clone().fromBufferAttribute(m.geometry.attributes.position, t.vertices[v][0]);
    const components: number[][] = mode === 'vertex' ? t.vertices.map((_: unknown, i: number) => [i]) : mode === 'edge' ? t.edges : t.faces;
    const front = components.map((vs, id) => ({vs, id})).filter(c => c.vs.every(v => read(v).z === 1));
    const first = front[0], second = front.find(c => c.id !== first.id && (mode === 'vertex' || c.vs.some(v => first.vs.includes(v))))!;
    const rect = e.host.getBoundingClientRect();
    return [first, second].map(c => {
      const p = m.position.clone().set(0,0,0);
      c.vs.forEach(v => p.add(read(v))); p.divideScalar(c.vs.length); m.localToWorld(p).project(e.camera);
      return {...c, x: rect.left+(p.x+1)*rect.width/2, y: rect.top+(1-p.y)*rect.height/2};
    });
  }, mode);
  const state = () => page.evaluate(() => {
    const e = (window as any).__forge;
    return { ids: [...e.selectedComponents].sort((a: number,b: number)=>a-b), vertices: [...new Set(e.vertexIndices.map((i: number)=>e.topology.bufferToVertex[i]))].sort((a: any,b: any)=>a-b), attached: !!e.transform.object };
  });
  const click = async (i: number, shift = false) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(targets[i].x, targets[i].y);
    if (shift) await page.keyboard.up('Shift');
  };
  await click(0);
  expect((await state()).ids, JSON.stringify(targets)).toEqual([targets[0].id]);
  await click(1, true);
  expect((await state()).ids).toEqual(targets.map(t=>t.id).sort((a,b)=>a-b));
  expect((await state()).vertices).toEqual([...new Set(targets.flatMap(t=>t.vs))].sort((a,b)=>a-b));
  if (mode === 'face') {
    const before = await page.evaluate(() => (window as any).__forge.snapshot());
    for (const button of ['#extrude-face', '#inset-face']) {
      await page.locator(button).click();
      await expect(page.locator('#toast')).toContainText('exactly one');
      expect(await page.evaluate(() => (window as any).__forge.snapshot())).toBe(before);
    }
  }
  await click(0, true);
  expect((await state()).vertices).toEqual([...targets[1].vs].sort((a,b)=>a-b));
  // The last component is at the gizmo origin: Shift must take precedence.
  await click(1, true);
  expect(await state()).toEqual({ids: [], vertices: [], attached: false});
  await click(0); await click(1, true);
  // Hide the gizmo with the Select tool before testing plain replacement clicks.
  await page.evaluate(() => (window as any).__forge.setTool('select'));
  await click(0);
  expect((await state()).ids).toEqual([targets[0].id]);
  const viewport = await page.locator('canvas').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(viewport!.x+150, viewport!.y+200);
  await page.keyboard.up('Shift');
  expect((await state()).ids).toEqual([targets[0].id]);
  await page.mouse.click(viewport!.x+150, viewport!.y+200);
  expect((await state()).attached).toBe(false);
  await click(0);
  await page.getByLabel('Mesh component').selectOption(mode === 'vertex' ? 'edge' : 'vertex');
  expect((await state()).ids).toEqual([]);
  await page.evaluate(() => { const e = (window as any).__forge; e.selectComponent(0); e.setEditMode(false); e.setEditMode(true); });
  expect(await state()).toEqual({ids: [], vertices: [], attached: false});
});

for (const proportional of [false, true]) test(`multi-selection translation preserves seams and history (proportional=${proportional})`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(proportional => {
    const e = (window as any).__forge, m = e.selected;
    m.rotation.set(0,0,0); m.scale.set(1.5,0.8,1.2); e.commit();
    e.setEditMode(true); e.setComponentMode('face');
    e.selectComponent(0); e.selectComponent(1, true);
    e.setProportionalEditing(proportional, 3);
    const before = Array.from(m.geometry.attributes.position.array) as number[], seeds = [...e.vertexIndices] as number[];
    const unique = [...new Set(seeds.map((i: number)=>e.topology.bufferToVertex[i]))] as number[];
    const centroid = [0,1,2].map(axis => unique.reduce((sum,v)=>sum+before[e.topology.vertices[v][0]*3+axis],0)/unique.length);
    const center = e.componentCenter.toArray();
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    e.vertexProxy.position.x += 0.75; e.transform.dispatchEvent({type:'objectChange'});
    e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const after = Array.from(m.geometry.attributes.position.array) as number[];
    const expected = before.map((v,i) => {
      if (i%3 !== 0) return v;
      const d = Math.min(...seeds.map(seed=>Math.hypot(v-before[seed*3],before[i+1]-before[seed*3+1],before[i+2]-before[seed*3+2])));
      const t = Math.max(0,1-d/3), weight = proportional ? t*t*(3-2*t) : seeds.includes(i/3) ? 1 : 0;
      return v+0.5*weight;
    });
    const saved = e.snapshot(); e.undo(); const undone = Array.from(e.selected.geometry.attributes.position.array);
    e.redo(); const redone = Array.from(e.selected.geometry.attributes.position.array);
    e.load(JSON.parse(saved));
    return {before, after, expected, center, centroid, undone, redone, restored: Array.from(e.selected.geometry.attributes.position.array)};
  }, proportional);
  expect(result.center).toEqual(result.centroid);
  result.after.forEach((v,i)=>expect(v).toBeCloseTo(result.expected[i],5));
  expect(result.undone).toEqual(result.before);
  expect(result.redone).toEqual(result.after);
  expect(result.restored).toEqual(result.after);
});
