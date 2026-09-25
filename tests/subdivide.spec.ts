import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { subdivideEdge } from '../src/modeling/subdivide';
import { buildTopology } from '../src/modeling/topology';

for (const expanded of [false, true]) test(`edge subdivision preserves closed cube winding and groups (${expanded})`, () => {
  const box = new THREE.BoxGeometry(2,2,2), source = expanded ? box.toNonIndexed() : box;
  const p = source.attributes.position;
  const endpoint = (z: number) => Array.from({length:p.count},(_,i)=>i).find(i=>p.getX(i)===1 && p.getY(i)===1 && p.getZ(i)===z)!;
  const before = JSON.stringify(source.toJSON());
  const result = subdivideEdge(source,[endpoint(1),endpoint(-1)]);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  expect(result.index!.count).toBe(42);
  expect(result.attributes.position.count).toBe(p.count+2);
  expect(Array.from(result.attributes.position.array).slice(0,p.count*3)).toEqual(Array.from(p.array));
  const topology = buildTopology(result.attributes.position.array,result.index!.array);
  expect(topology.vertices).toHaveLength(9);
  const uses = new Map<string,number[]>();
  for (const face of topology.faces) for (let i=0;i<3;i++) {
    const a=face[i],b=face[(i+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`;
    uses.set(key,[...(uses.get(key)??[]),a<b?1:-1]);
  }
  for (const signs of uses.values()) { expect(signs).toHaveLength(2); expect(signs[0]+signs[1]).toBe(0); }
  const read=(i:number)=>new THREE.Vector3().fromBufferAttribute(result.attributes.position,result.index!.getX(i));
  for (let i=0;i<42;i+=3) { const a=read(i),b=read(i+1),c=read(i+2); expect(b.sub(a).cross(c.sub(a)).dot(a)).toBeGreaterThan(0); }
  expect(result.groups.map(g=>g.count)).toEqual([9,6,9,6,6,6]);
  expect(result.groups.map(g=>g.materialIndex)).toEqual(source.groups.map(g=>g.materialIndex));
  expect(result.groups.map(g=>g.start)).toEqual([0,9,15,24,30,36]);
});

test('subdivision interpolates UV and normalized color separately across seams and handles boundaries', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,2,0, 2,0,0,0,0,0,2,-2,0],3));
  source.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1, 4,2,6,2,4,4],2));
  source.setAttribute('color',new THREE.Uint8BufferAttribute([0,0,0,255,255,255,0,0,0, 0,0,0,255,255,255,0,0,0],3,true));
  source.addGroup(0,3,2); source.addGroup(3,3,4);
  const result=subdivideEdge(source,[0,1]);
  expect(Array.from(result.attributes.uv.array).slice(12)).toEqual([0.5,0,5,2]);
  expect(Array.from(result.attributes.color.array).slice(18)).toEqual(Array(6).fill(0.5));
  expect(result.groups).toEqual([{start:0,count:6,materialIndex:2},{start:6,count:6,materialIndex:4}]);
  const boundary=subdivideEdge(source,[0,2]);
  expect(boundary.index!.count).toBe(9);
  expect(boundary.attributes.position.count).toBe(7);
});

test('invalid subdivision rejects without changing source geometry', () => {
  const box=new THREE.BoxGeometry(2,2,2);
  const check=(source:THREE.BufferGeometry, pair:[number,number], message:RegExp)=>{
    const before=JSON.stringify(source.toJSON());
    expect(()=>subdivideEdge(source,pair)).toThrow(message);
    expect(JSON.stringify(source.toJSON())).toBe(before);
  };
  check(box,[-1,0],/endpoints/); check(box,[0,0],/degenerate/);
  const unsupported=box.clone().setAttribute('tangent',new THREE.Float32BufferAttribute(new Float32Array(24*4),4));
  check(unsupported,[0,1],/tangent/);
  const partial=box.clone(); partial.setDrawRange(0,3); check(partial,[0,1],/draw ranges/);
  const groups=box.clone(); groups.groups[0].start=1; check(groups,[0,1],/material groups/);
  const invalidIndex=box.clone(); invalidIndex.index!.setX(0,1000); check(invalidIndex,[0,1],/indices/);
  const mesh=(positions:number[])=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  check(mesh([1e8,0,0,1e8+8,0,0,1e8,8,0]),[0,1],/precision/);
  check(mesh([0,0,0,2,0,0,1,0,0]),[0,1],/midpoint/);
  check(mesh([0,0,0,2,0,0,3,0,0]),[0,1],/degenerate/);
  check(mesh([0,0,0,2,0,0,0,1,0, 2,0,0,0,0,0,0,-1,0, 0,0,0,2,0,0,0,0,1]),[0,1],/manifold/);
});

test('viewport selected edge subdivides, keeps split edges selected and restores history/project', async ({page}) => {
  await page.goto('/'); await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(()=>{ const e=(window as any).__forge; e.selected.rotation.set(0,0,0); e.selected.scale.set(1.5,0.8,1.2); e.commit(); e.view('front'); });
  await page.locator('#mode').selectOption('edit');
  await page.getByLabel('Mesh component').selectOption('edge');
  const target=await page.evaluate(()=>{
    const e=(window as any).__forge,m=e.selected,t=e.topology,a=m.geometry.attributes.position;
    const edge=t.polygonEdges.find((vs:number[])=>vs.every(v=>a.getZ(t.vertices[v][0])===1 && a.getY(t.vertices[v][0])===1));
    const point=m.position.clone().set(0,0,0);
    for (const v of edge) point.add(m.position.clone().fromBufferAttribute(a,t.vertices[v][0])); point.multiplyScalar(0.5);
    const midpoint=point.toArray(); m.updateWorldMatrix(true,true); e.camera.updateMatrixWorld(true); m.localToWorld(point).project(e.camera);
    const rect=e.host.getBoundingClientRect();
    return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2,midpoint,bufferCount:a.count,before:e.snapshot()};
  });
  await page.mouse.click(target.x,target.y);
  await page.locator('#subdivide-edge').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.locator('#toast')).toContainText('Edges subdivided');
  await expect(page.getByLabel('Mesh component')).toHaveValue('edge');
  const result=await page.evaluate((target)=>{
    const e=(window as any).__forge, a=e.selected.geometry.attributes.position, t=e.topology;
    const midpointVertices=[...new Set(t.bufferToVertex.slice(target.bufferCount))];
    const midpointPositions=midpointVertices.map((v:number)=>[a.getX(t.vertices[v][0]),a.getY(t.vertices[v][0]),a.getZ(t.vertices[v][0])]);
    const selectedEdges=[...e.selectedComponents];
    const selected=[...e.vertexIndices], beforeMove=Array.from(a.array) as number[], center=e.componentCenter.toArray();
    e.transform.dispatchEvent({type:'dragging-changed',value:true});
    e.vertexProxy.position.x+=0.3; e.transform.dispatchEvent({type:'objectChange'});
    e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const afterMove=Array.from(a.array), after=e.snapshot(), triangles=e.stats().triangles;
    e.undo(); e.undo(); const undone=e.snapshot(); e.redo(); e.redo(); const redone=e.snapshot();
    e.load(JSON.parse(after));
    return {center,midpointPositions,selectedEdges,selected,beforeMove,afterMove,after,triangles,undone,redone,restored:e.snapshot()};
  }, target);
  expect(result.center).toEqual(target.midpoint);
  expect(result.midpointPositions).toContainEqual(target.midpoint);
  expect(result.selectedEdges).toHaveLength(2);
  expect(result.selected.length).toBeGreaterThanOrEqual(3);
  expect(result.triangles).toBe(14);
  result.afterMove.forEach((v:any,i:number)=>expect(v).toBeCloseTo(result.beforeMove[i]+(i%3===0&&result.selected.includes(i/3)?0.2:0),5));
  expect(result.undone).toBe(target.before); expect(result.redone).toBe(result.after); expect(result.restored).toBe(result.after);
});

test('subdivision UI rejects object mode and empty edge selection without mutation', async ({page})=>{
  await page.goto('/'); await page.waitForFunction(()=>(window as any).__forge?.selected);
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  await page.locator('#subdivide-edge').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy); await expect(page.locator('#toast')).toContainText('one or more edges');
  await page.locator('#mode').selectOption('edit'); await page.getByLabel('Mesh component').selectOption('edge');
  await page.locator('#subdivide-edge').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy); await expect(page.locator('#toast')).toContainText('one or more edges');
  expect(await page.evaluate(()=>(window as any).__forge.snapshot())).toBe(before);
});
