import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { bevelEdges, loopCut, editUV } from '../src/modeling/modeling';
import { buildTopology } from '../src/modeling/topology';
import { evaluateModifiers } from '../src/modeling/modifiers';
import { createPrimitiveGeometry, defaultPrimitiveSettings } from '../src/modeling/primitives';

function topology(g: THREE.BufferGeometry) { return buildTopology(g.getAttribute('position').array, g.index?.array); }
function closed(g: THREE.BufferGeometry) {
  const uses = new Map<string, number[]>();
  for (const face of topology(g).faces) for (let i = 0; i < 3; i++) {
    const a = face[i], b = face[(i + 1) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    const list = uses.get(key) ?? []; list.push(a < b ? 1 : -1); uses.set(key, list);
  }
  for (const use of uses.values()) expect(use.sort()).toEqual([-1, 1]);
}
function sharpEdge(g: THREE.BufferGeometry) {
  const t = topology(g), p = g.getAttribute('position');
  return t.edges.findIndex(([a, b]) => {
    const x = new THREE.Vector3().fromBufferAttribute(p, t.vertices[a][0]), y = new THREE.Vector3().fromBufferAttribute(p, t.vertices[b][0]);
    return x.distanceTo(y) === 2;
  });
}

test('cube and plane keep logical quads above triangulated render topology', () => {
  const cube = createPrimitiveGeometry(defaultPrimitiveSettings('cube'));
  const cubeTopology = buildTopology(
    cube.getAttribute('position').array,
    cube.index?.array,
    cube.userData.forgePolygonTriangles,
  );
  expect(cubeTopology.faces).toHaveLength(12);
  expect(cubeTopology.edges).toHaveLength(18);
  expect(cubeTopology.polygons).toHaveLength(6);
  expect(cubeTopology.polygons.every(face => face.length === 4)).toBe(true);
  expect(cubeTopology.polygonTriangles).toEqual([
    [0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11],
  ]);
  expect(cubeTopology.triangleToPolygon).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  expect(cubeTopology.polygonEdges).toHaveLength(12);
  expect(cubeTopology.polygonEdgeToEdge).toHaveLength(12);
  expect(new Set(cubeTopology.polygonEdgeToEdge).size).toBe(12);

  const plane = createPrimitiveGeometry({
    version: 1,
    kind: 'plane',
    width: 4,
    height: 4,
    widthSegments: 2,
    heightSegments: 2,
  });
  const planeTopology = buildTopology(
    plane.getAttribute('position').array,
    plane.index?.array,
    plane.userData.forgePolygonTriangles,
  );
  expect(planeTopology.faces).toHaveLength(8);
  expect(planeTopology.polygons).toHaveLength(4);
  expect(planeTopology.polygons.every(face => face.length === 4)).toBe(true);
  expect(planeTopology.edges).toHaveLength(16);
  expect(planeTopology.polygonEdges).toHaveLength(12);

  const parsed = new THREE.BufferGeometryLoader().parse(cube.toJSON());
  expect(parsed.userData.forgePolygonTriangles).toEqual(cube.userData.forgePolygonTriangles);
  const roundTrip = buildTopology(
    parsed.getAttribute('position').array,
    parsed.index?.array,
    parsed.userData.forgePolygonTriangles,
  );
  expect(roundTrip.polygons).toHaveLength(6);
  expect(roundTrip.polygonEdges).toHaveLength(12);

  cube.dispose();
  plane.dispose();
  parsed.dispose();
});

test('invalid polygon metadata safely falls back to triangle modeling faces', () => {
  const plane = new THREE.PlaneGeometry(2, 2);
  const t = buildTopology(plane.getAttribute('position').array, plane.index?.array, [[0, 0], [1]]);
  expect(t.polygons).toHaveLength(2);
  expect(t.polygons.every(face => face.length === 3)).toBe(true);
  expect(t.triangleToPolygon).toEqual([0, 1]);
  expect(t.polygonEdges).toEqual(t.edges);
  plane.dispose();

  const fanPositions = [
    -1,-1,0, 1,-1,0, 1,1,0, -1,1,0, 0,0,0,
  ];
  const fanIndices = [0,1,4, 1,2,4, 2,3,4, 3,0,4];
  const interior = buildTopology(fanPositions, fanIndices, [[0,1,2,3]]);
  expect(interior.polygons).toHaveLength(4);
  expect(interior.polygons.every(face => face.length === 3)).toBe(true);
  expect(interior.triangleToPolygon).toEqual([0,1,2,3]);
});
test('adjacent and all-edge bevels remain closed; planar grid cuts reach both boundaries', () => {
  const box = new THREE.BoxGeometry(2, 2, 2), t = topology(box), p = box.getAttribute('position');
  const edges = t.edges.map((edge, i) => ({ edge, i })).filter(({edge:[a,b]}) => new THREE.Vector3().fromBufferAttribute(p,t.vertices[a][0]).distanceTo(new THREE.Vector3().fromBufferAttribute(p,t.vertices[b][0])) === 2).map(({i})=>i);
  closed(bevelEdges(box, edges.slice(0,3), 0.1)); closed(bevelEdges(box, edges, 0.1));
  const grid = new THREE.PlaneGeometry(4,4,4,4), gt=topology(grid), gp=grid.getAttribute('position');
  const edge=gt.edges.findIndex(([a,b])=>gp.getY(gt.vertices[a][0])===2 && gp.getY(gt.vertices[b][0])===2);
  const cut=loopCut(grid,edge);
  const out=topology(cut), positions=cut.getAttribute('position');
  expect(out.vertices.filter(copies=>positions.getX(copies[0])===-1.5).length).toBeGreaterThanOrEqual(5);
  expect(cut.boundingBox!.min.toArray()).toEqual([-2,-2,0]);
});
for (const expanded of [false, true]) test(`convex bevel and loop cut keep closed oriented surfaces (${expanded})`, () => {
  const box = new THREE.BoxGeometry(2, 2, 2), source = expanded ? box.toNonIndexed() : box;
  const before = JSON.stringify(source.toJSON()), edge = sharpEdge(source);
  const bevel = bevelEdges(source, [edge], 0.2), loop = loopCut(source, edge);
  closed(bevel); closed(loop);
  expect(topology(bevel).faces.length).toBeGreaterThan(12);
  expect(topology(loop).faces.length).toBeGreaterThan(12);
  expect(bevel.getAttribute('uv').count).toBe(bevel.getAttribute('position').count);
  expect(new Set(bevel.groups.map(g => g.materialIndex)).size).toBe(6);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  // A loop cut retains the original cube bounds and volume.
  expect(loop.boundingBox!.min.toArray()).toEqual([-1, -1, -1]);
  expect(loop.boundingBox!.max.toArray()).toEqual([1, 1, 1]);
  let volume = 0; const p = loop.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) volume += new THREE.Vector3().fromBufferAttribute(p, i).dot(new THREE.Vector3().fromBufferAttribute(p, i + 1).cross(new THREE.Vector3().fromBufferAttribute(p, i + 2))) / 6;
  expect(volume).toBeCloseTo(8, 5);
});

test('invalid modeling requests preserve input', () => {
  const box = new THREE.BoxGeometry(2, 2, 2), before = JSON.stringify(box.toJSON()), edge = sharpEdge(box);
  for (const width of [NaN, 0, 100, -1]) expect(() => bevelEdges(box, [edge], width)).toThrow();
  expect(() => bevelEdges(new THREE.PlaneGeometry(2, 2), [0], 0.1)).toThrow(/closed/);
  expect(() => loopCut(box, -1)).toThrow();
  const t = topology(box), diagonal = t.edges.findIndex(([a, b]) => {
    const p = box.getAttribute('position'); return new THREE.Vector3().fromBufferAttribute(p, t.vertices[a][0]).distanceTo(new THREE.Vector3().fromBufferAttribute(p, t.vertices[b][0])) > 2;
  });
  expect(() => loopCut(box, diagonal)).toThrow(/boundary/);
  expect(() => bevelEdges(box, [diagonal], 0.1)).toThrow(/diagonal/);
  expect(() => editUV(box, [0], 'transform', [NaN, 0, 0, 1, 1])).toThrow();
  expect(JSON.stringify(box.toJSON())).toBe(before);
});

test('UV edits split selected seams without moving or changing unselected corners', () => {
  const source = new THREE.PlaneGeometry(2, 2), initial = source.toNonIndexed();
  const result = editUV(source, [0], 'transform', [0.25, -0.5, 0, 1, 1]);
  expect(Array.from(result.getAttribute('position').array)).toEqual(Array.from(initial.getAttribute('position').array));
  for (let i = 0; i < 6; i++) {
    expect(result.getAttribute('uv').getX(i)).toBeCloseTo(initial.getAttribute('uv').getX(i) + (i < 3 ? 0.25 : 0));
    expect(result.getAttribute('uv').getY(i)).toBeCloseTo(initial.getAttribute('uv').getY(i) - (i < 3 ? 0.5 : 0));
  }
  expect(topology(result).vertices).toHaveLength(4);
});

test('modifier stack preserves source and supports ordered disable/removal', () => {
  const source = new THREE.BoxGeometry(2, 2, 2); source.translate(3, 0, 0);
  const before = JSON.stringify(source.toJSON());
  const mirrored = evaluateModifiers(source, [{ kind: 'mirror', amount: 0.5, enabled: true }]);
  expect(topology(mirrored).faces).toHaveLength(24); closed(mirrored);
  const disabled = evaluateModifiers(source, [{ kind: 'mirror', amount: 0.5, enabled: false }]);
  expect(topology(disabled).faces).toHaveLength(12);
  const subdivided = evaluateModifiers(source, [{ kind: 'subdivide', amount: 0.5, enabled: true }]);
  expect(topology(subdivided).faces).toHaveLength(48); closed(subdivided);
  expect(() => evaluateModifiers(source, [{ kind: 'smooth', amount: NaN, enabled: true }])).toThrow();
  expect(JSON.stringify(source.toJSON())).toBe(before);
});

test('worker mesh editing, UV and modifiers round trip history and projects', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#mode').selectOption('edit');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology, p = e.selected.geometry.attributes.position;
    e.setComponentMode('edge');
    const edge = t.polygonEdges.findIndex(([a, b]: number[]) => {
      const i = t.vertices[a][0], j = t.vertices[b][0]; return Math.hypot(p.getX(i)-p.getX(j),p.getY(i)-p.getY(j),p.getZ(i)-p.getZ(j)) === 2;
    }); e.selectComponent(edge); return e.snapshot();
  });
  await page.locator('#bevel-edges').click(); await expect(page.locator('#toast')).toContainText('complete');
  const restored = await page.evaluate(() => {
    const e = (window as any).__forge, after = e.snapshot(); e.undo(); const undo = e.snapshot(); e.redo(); const redo = e.snapshot(); e.load(JSON.parse(after)); return { after, undo, redo, loaded:e.snapshot() };
  });
  expect(restored.undo).toBe(before); expect(restored.redo).toBe(restored.after); expect(restored.loaded).toBe(restored.after);
  await page.locator('#mode').selectOption('edit');
  await page.evaluate(() => { const e = (window as any).__forge; e.setComponentMode('face'); e.selectComponent(0); });
  await page.getByText('UV editor', { exact:true }).click();
  await page.locator('#uv-project').click(); await expect(page.locator('#toast')).toContainText('complete');
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await page.evaluate(() => (window as any).__forge.focus());
  await page.locator('#uv-view').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/phase2-uv.png'});
  await page.locator('#mode').selectOption('object');
  await page.getByText('Modifiers', {exact:true}).click();
  await page.locator('#modifier-kind').selectOption('smooth');
  await page.locator('#modifier-add').click();
  await expect(page.getByLabel('Disable modifier 1')).toBeVisible();
  await page.locator('#modifier-list').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/phase2-modifiers.png'});
  const modifierSnapshot = await page.evaluate(() => { const e=(window as any).__forge, s=e.snapshot(); e.load(JSON.parse(s)); return {before:s,after:e.snapshot(),stack:e.selected.userData.modifierStack.items}; });
  expect(modifierSnapshot.after).toBe(modifierSnapshot.before); expect(modifierSnapshot.stack).toHaveLength(1);
  await page.getByLabel('Disable modifier 1').click(); await expect(page.getByLabel('Enable modifier 1')).toBeVisible();
  await page.locator('#modifier-apply').click(); await expect(page.getByLabel('Enable modifier 1')).toHaveCount(0);
});

test('multi-object transforms and worker cancellation are atomic', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(async () => {
    const e=(window as any).__forge, a=e.selected; e.duplicate(); const b=e.selected;
    e.select(a,true); const before=e.snapshot(), positions=[a.position.toArray(),b.position.toArray()];
    e.transformObjects('translate',[1,2,3]); const moved=[a.position.toArray(),b.position.toArray()];
    const after=e.snapshot(); e.undo(); const undo=e.snapshot(); e.redo(); const redo=e.snapshot();
    const pending=e.runModeling({kind:'subdivide',edges:[]},true); e.cancelModeling();
    let error=''; try { await pending; } catch(caught) {error=String(caught);}
    return {before,after,undo,redo,positions,moved,error,cancelled:e.snapshot()};
  });
  expect(result.undo).toBe(result.before); expect(result.redo).toBe(result.after); expect(result.cancelled).toBe(result.after); expect(result.error).toContain('cancelled');
  result.positions.forEach((p:number[],i:number)=>p.forEach((v,j)=>expect(result.moved[i][j]).toBe(v+j+1)));
});
