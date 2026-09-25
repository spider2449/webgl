import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { extrudeTriangle } from '../src/modeling/extrude';
import { buildTopology } from '../src/modeling/topology';

for (const expanded of [false, true]) {
  test(`extrusion preserves a closed oriented cube and attributes (${expanded ? 'expanded' : 'indexed'})`, () => {
    const box = new THREE.BoxGeometry(2,2,2);
    const source = expanded ? box.toNonIndexed() : box;
    const before = JSON.stringify(source.toJSON());
    const result = extrudeTriangle(source, 0, 0.5);
    expect(JSON.stringify(source.toJSON())).toBe(before);
    expect(result.index!.count).toBe(54);
    const topology = buildTopology(result.attributes.position.array, result.index!.array);
    const uses = new Map<string, number[]>();
    for (const face of topology.faces) for (let i=0;i<3;i++) {
      const a=face[i],b=face[(i+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`;
      uses.set(key,[...(uses.get(key)??[]),a<b ? 1 : -1]);
    }
    for (const signs of uses.values()) { expect(signs).toHaveLength(2); expect(signs[0]+signs[1]).toBe(0); }
    expect(result.groups.slice(0,source.groups.length)).toEqual(source.groups);
    expect(result.groups.at(-1)).toEqual({start:36,count:18,materialIndex:0});
    const cap=source.attributes.position.count;
    expect(result.attributes.position.getX(cap)).toBeCloseTo(1.5);
    const originalCorner=source.index?.getX(0)??0;
    expect(result.attributes.uv.getX(cap)).toBe(source.attributes.uv.getX(originalCorner));
    expect(result.attributes.uv.getY(cap)).toBe(source.attributes.uv.getY(originalCorner));
    for (const value of result.attributes.normal.array) expect(Number.isFinite(value)).toBe(true);
    const repeated=extrudeTriangle(result,0,0.25);
    expect(repeated.index!.count).toBe(72);
    expect(repeated.attributes.position.getX(result.attributes.position.count)).toBeCloseTo(1.75);
  });
}

test('invalid extrusion requests leave source geometry untouched', () => {
  const source=new THREE.BoxGeometry();
  const before=JSON.stringify(source.toJSON());
  for (const distance of [0,-1,NaN,Infinity,1001]) expect(()=>extrudeTriangle(source,0,distance)).toThrow();
  for (const face of [-1,0.5,12]) expect(()=>extrudeTriangle(source,face,0.5)).toThrow();
  expect(JSON.stringify(source.toJSON())).toBe(before);
  source.setAttribute('tangent',new THREE.Float32BufferAttribute(new Float32Array(24*4),4));
  expect(()=>extrudeTriangle(source,0,0.5)).toThrow(/tangent/);
  const collapsed=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));
  expect(()=>extrudeTriangle(collapsed,0,0.5)).toThrow(/degenerate/);
  const distant = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([100000000,0,0, 100000000,1,0, 100000000,0,1], 3));
  const distantBefore = JSON.stringify(distant.toJSON());
  expect(() => extrudeTriangle(distant, 0, 0.5)).toThrow(/precision/);
  expect(JSON.stringify(distant.toJSON())).toBe(distantBefore);
});

test('viewport-selected face extrudes repeatedly through UI with history and project recovery', async ({page}) => {
  await page.goto('/');
  await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(()=>{const e=(window as any).__forge;delete e.selected.userData.forgePrimitive;delete e.selected.userData.forgeLogicalQuads;e.selected.rotation.set(0,0,0);e.commit();e.view('front');});
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('face');
  const point=await page.evaluate(()=>{
    const e=(window as any).__forge,mesh=e.selected,position=mesh.geometry.attributes.position;
    mesh.updateWorldMatrix(true,true);
    const read=(v:number)=>mesh.position.clone().fromBufferAttribute(position,e.topology.vertices[v][0]);
    const face=e.topology.faces.find((f:number[])=>f.every(v=>read(v).z===1));
    const p=mesh.position.clone().set(0,0,0);face.forEach((v:number)=>p.add(read(v)));p.divideScalar(3);
    mesh.localToWorld(p).project(e.camera);const rect=e.host.getBoundingClientRect();
    return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};
  });
  await page.mouse.click(point.x,point.y);
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  await page.getByLabel('Extrusion distance').fill('0.5');
  await page.locator('#extrude-face').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Triangle extruded');
  expect(await page.evaluate(()=>(window as any).__forge.stats().triangles)).toBe(18);
  await page.locator('#extrude-face').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  expect(await page.evaluate(()=>(window as any).__forge.stats().triangles)).toBe(24);
  await page.screenshot({ path: 'test-results/extrusion.png' });
  const result=await page.evaluate(()=>{
    const e=(window as any).__forge,after=e.snapshot();
    const selected=e.vertexIndices.length;
    e.undo();const once=e.stats().triangles;e.undo();const original=e.snapshot();
    e.redo();e.redo();const redone=e.snapshot();e.load(JSON.parse(after));
    return {selected,once,original,after,redone,restored:e.snapshot()};
  });
  expect(result.selected).toBeGreaterThan(3);
  expect(result.once).toBe(18);
  expect(result.original).toBe(before);
  expect(result.redone).toBe(result.after);
  expect(result.restored).toBe(result.after);
  await page.locator('#extrude-face').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Select exactly one triangle');
});
