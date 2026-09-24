import { test, expect } from '@playwright/test';
import { buildTopology } from '../src/modeling/topology';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.content.children.length === 1);
});

test('new scenes start with zero cube rotation', async ({ page }) => {
  const initial = await page.evaluate(() => {
    const e = (window as any).__forge;
    return [e.selected.rotation.x, e.selected.rotation.y, e.selected.rotation.z];
  });
  expect(initial).toEqual([0, 0, 0]);

  const reset = await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(0.3, 0.7, -0.2);
    e.commit();
    e.newProject();
    return {
      name: e.selected.name,
      rotation: [e.selected.rotation.x, e.selected.rotation.y, e.selected.rotation.z],
    };
  });

  expect(reset.name).toBe('Cube');
  expect(reset.rotation).toEqual([0, 0, 0]);
});

test('renders the viewport and stops rendering while idle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.waitForTimeout(1100);
  const before = await page.evaluate(() => (window as any).__forge.renderedFrames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__forge.renderedFrames)).toBe(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/layout.png' });
});

test('adds, transforms, duplicates, undoes and removes objects through the UI', async ({ page }) => {
  await page.locator('[data-menu="add-menu"]').click();
  await page.locator('[data-primitive="sphere"]').click();
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.getByLabel('position x', { exact: true }).fill('3.25');
  await page.getByLabel('position x', { exact: true }).press('Enter');
  expect(await page.evaluate(() => (window as any).__forge.selected.position.x)).toBe(3.25);
  await page.locator('#duplicate-rail').click();
  await expect(page.locator('.object-row')).toHaveCount(3);
  await page.locator('#tool-select').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.object-row')).toHaveCount(3);
  await page.locator('#delete-outliner').click();
  await expect(page.locator('.object-row')).toHaveCount(2);
});

test('round trips edited geometry, transforms and materials', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const mesh = e.selected;
    mesh.geometry.attributes.position.setXYZ(0, 2.7, 1.4, -0.8);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.material.color.set('#e08050');
    mesh.position.x = 4;
    e.commit();
    const saved = e.snapshot();
    e.newProject();
    e.load(JSON.parse(saved));
    return { x: e.selected.geometry.attributes.position.getX(0), location: e.selected.position.x, color: e.selected.material.color.getHexString() };
  });
  expect(result.x).toBeCloseTo(2.7, 5);
  expect(result.location).toBe(4);
  expect(result.color).toBe('e08050');
});

test('malformed projects do not erase the current scene', async ({ page }) => {
  expect(await page.evaluate(() => { const e=(window as any).__forge; const original=e.selected.uuid; try{e.load({format:'nope',version:1,scene:{}});}catch{} return e.selected.uuid===original; })).toBe(true);
});

test('legacy preset rig UI and runtime are absent', async ({ page }) => {
  await expect(page.locator('[data-workspace="rigging"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="rig"]')).toHaveCount(0);
  await expect(page.locator('#create-rig')).toHaveCount(0);
  expect(await page.evaluate(() => '__rig' in window)).toBe(false);
});

test('mobile layout fits and opens the object panel', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#toggle-sidebar').click();
  await page.locator('[data-panel="object"]').click();
  await expect(page.locator('#panel-object')).toBeVisible();
  await page.screenshot({path:'test-results/mobile.png'});
});

for (const mode of ['vertex', 'edge', 'face'] as const) {
  test(`selects and translates a ${mode} with welded seams and history`, async ({ page }) => {
    await page.evaluate(() => {
      const e = (window as any).__forge;
      e.selected.rotation.set(0, 0, 0);
      e.selected.scale.set(1.5, 0.8, 1.2);
      e.commit();
      e.view('front');
    });
    await page.locator('#mode').selectOption('edit');
    await page.getByLabel('Mesh component').selectOption(mode);
    const target = await page.evaluate((mode) => {
      const e = (window as any).__forge, mesh = e.selected;
      mesh.updateWorldMatrix(true, true);
      const position = mesh.geometry.attributes.position;
      const topology = e.topology;
      const read = (v: number) => mesh.position.clone().fromBufferAttribute(position, topology.vertices[v][0]);
      let vertices: number[];
      if (mode === 'vertex') vertices = [topology.vertices.findIndex((_: any, i: number) => { const v=read(i); return v.x===1 && v.y===1 && v.z===1; })];
      else if (mode === 'edge') vertices = topology.edges.find((edge: number[]) => edge.every(i => { const v=read(i); return v.y===1 && v.z===1; }));
      else vertices = topology.faces.find((face: number[]) => face.every(i => read(i).z===1));
      const point = mesh.position.clone().set(0,0,0);
      vertices.forEach(i => point.add(read(i)));
      point.divideScalar(vertices.length);
      mesh.localToWorld(point).project(e.camera);
      const rect = e.host.getBoundingClientRect();
      return { x: rect.left+(point.x+1)*rect.width/2, y: rect.top+(1-point.y)*rect.height/2, counts: [topology.vertices.length,topology.edges.length,topology.faces.length] };
    }, mode);
    expect(target.counts).toEqual([8,18,12]);
    await page.mouse.click(target.x, target.y);
    const result = await page.evaluate(() => {
      const e = (window as any).__forge;
      const mesh = e.selected, position = mesh.geometry.attributes.position;
      const before = Array.from(position.array) as number[];
      const selected = [...e.vertexIndices] as number[];
      const logicalCount = new Set(selected.map(i=>e.topology.bufferToVertex[i])).size;
      e.vertexProxy.position.x += 0.75;
      e.transform.dispatchEvent({type:'objectChange'});
      const after = Array.from(position.array) as number[];
      const correct = before.every((v,i)=>Math.abs(after[i]-v-(selected.includes(Math.floor(i/3)) && i%3===0 ? 0.5 : 0))<1e-5);
      e.commit();
      const saved = e.snapshot();
      const helpersSaved = /LineSegments|Points/.test(saved);
      e.undo();
      const undone = Array.from(e.selected.geometry.attributes.position.array);
      e.redo();
      const redone = Array.from(e.selected.geometry.attributes.position.array);
      e.load(JSON.parse(saved));
      return {logicalCount, correct, helpersSaved, before, after, undone, redone, restored:Array.from(e.selected.geometry.attributes.position.array)};
    });
    expect(result.logicalCount).toBe(mode === 'vertex' ? 1 : mode === 'edge' ? 2 : 3);
    expect(result.correct).toBe(true);
    expect(result.helpersSaved).toBe(false);
    expect(result.undone).toEqual(result.before);
    expect(result.redone).toEqual(result.after);
    expect(result.restored).toEqual(result.after);
  });
}

test('indexed and expanded triangles produce equivalent seam connectivity', () => {
  const indexed = buildTopology([0,0,0, 1,0,0, 1,1,0, 0,1,0], [0,1,2, 0,2,3]);
  const expanded = buildTopology([0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0]);
  expect(expanded.faces).toEqual(indexed.faces);
  expect(expanded.edges).toEqual(indexed.edges);
  expect(expanded.edges).toHaveLength(5);
  expect(expanded.vertices).toEqual([[0,3],[1],[2,4],[5]]);
  expect(buildTopology([])).toEqual({ vertices: [], bufferToVertex: [], edges: [], faces: [] });
});
