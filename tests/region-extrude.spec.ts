import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { extrudeRegion } from '../src/modeling/extrude-region';
import { buildTopology } from '../src/modeling/topology';

function edgeUses(geometry: THREE.BufferGeometry) {
  const topology=buildTopology(geometry.attributes.position.array,geometry.index!.array), uses=new Map<string,number[]>();
  for(const face of topology.faces) for(let j=0;j<3;j++) {
    const a=face[j],b=face[(j+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`;
    uses.set(key,[...(uses.get(key)??[]),a<b?1:-1]);
  }
  return uses;
}

for(const expanded of [false,true]) test(`planar cube side extrudes without internal walls (${expanded})`,()=>{
  const box=new THREE.BoxGeometry(2,2,2), source=expanded?box.toNonIndexed():box;
  const before=JSON.stringify(source.toJSON()), result=extrudeRegion(source,[1,0,1],0.5);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  expect(result.index!.count).toBe(60);
  expect(result.groups.slice(0,6)).toEqual(source.groups);
  expect(result.groups.slice(6)).toEqual([36,42,48,54].map(start=>({start,count:6,materialIndex:0})));
  for(const signs of edgeUses(result).values()){expect(signs).toHaveLength(2);expect(signs[0]+signs[1]).toBe(0);}
  for(let i=0;i<6;i++) {
    const old=source.index?.getX(i)??i, cap=result.index!.getX(i);
    expect(result.attributes.position.getX(cap)).toBe(1.5);
    expect(result.attributes.position.getY(cap)).toBe(source.attributes.position.getY(old));
    expect(result.attributes.position.getZ(cap)).toBe(source.attributes.position.getZ(old));
    for(let c=0;c<2;c++)expect(result.attributes.uv.getComponent(cap,c)).toBe(source.attributes.uv.getComponent(old,c));
  }
  const repeated=extrudeRegion(result,[0,1],0.5);
  expect(repeated.index!.count).toBe(84);
  for(const signs of edgeUses(repeated).values()){expect(signs).toHaveLength(2);expect(signs[0]+signs[1]).toBe(0);}
  const reordered=extrudeRegion(source,[0,1],0.5);
  expect(Array.from(reordered.index!.array)).toEqual(Array.from(result.index!.array));
  expect(Array.from(reordered.attributes.position.array)).toEqual(Array.from(result.attributes.position.array));
});

test('annular planar region retains its hole and correctly oriented inner and outer walls',()=>{
  const source=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-2,-2,0,2,-2,0,2,2,0,-2,2,0,-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
  const indices:number[]=[];
  for(let i=0;i<4;i++){const next=(i+1)%4;indices.push(i,next,4+next,i,4+next,4+i);}
  source.setIndex(indices);
  const result=extrudeRegion(source,[0,1,2,3,4,5,6,7],1),p=result.attributes.position;
  expect(result.index!.count).toBe(72);
  const read=(i:number)=>new THREE.Vector3().fromBufferAttribute(p,result.index!.getX(i));
  let capArea=0;
  for(let i=0;i<24;i+=3){const a=read(i),b=read(i+1),c=read(i+2);expect(a.z).toBe(1);capArea+=b.sub(a).cross(c.sub(a)).z/2;}
  expect(capArea).toBe(12);
  for(let i=24;i<72;i+=3){
    const a=read(i),b=read(i+1),c=read(i+2),center=a.clone().add(b).add(c).divideScalar(3);center.z=0;
    const normal=b.sub(a).cross(c.sub(a));
    if(Math.max(Math.abs(center.x),Math.abs(center.y))===2)expect(normal.dot(center)).toBeGreaterThan(0);
    else expect(normal.dot(center)).toBeLessThan(0);
  }
  const uses=[...edgeUses(result).values()];
  expect(uses.filter(signs=>signs.length===1)).toHaveLength(8);
  for(const signs of uses.filter(signs=>signs.length===2))expect(signs[0]+signs[1]).toBe(0);
});

test('region caps retain separate UV/color seams and walls inherit adjacent face materials',()=>{
  const source=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0],3));
  source.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,5,5,6,6,5,6],2));
  source.setAttribute('color',new THREE.Uint8BufferAttribute([255,0,0,255,0,0,255,0,0,0,255,0,0,255,0,0,255,0],3,true));
  source.addGroup(0,3,2);source.addGroup(3,3,3);
  const result=extrudeRegion(source,[0,1],0.5);
  expect(result.index!.count).toBe(30);
  expect(result.groups.slice(0,2)).toEqual(source.groups);
  expect(result.groups.slice(2).map(g=>g.materialIndex).sort()).toEqual([2,2,3,3]);
  for(let i=0;i<6;i++){
    const cap=result.index!.getX(i);
    for(const name of ['uv','color'])for(let c=0;c<source.attributes[name].itemSize;c++)expect(result.attributes[name].getComponent(cap,c)).toBe(source.attributes[name].getComponent(i,c));
  }
});

test('invalid region requests leave source untouched',()=>{
  const box=new THREE.BoxGeometry(2,2,2);
  const check=(source:THREE.BufferGeometry,faces:number[],distance:number,message:RegExp)=>{
    const before=JSON.stringify(source.toJSON());expect(()=>extrudeRegion(source,faces,distance)).toThrow(message);expect(JSON.stringify(source.toJSON())).toBe(before);
  };
  check(box,[],0.5,/valid triangle/);check(box,[100],0.5,/valid triangle/);
  check(box,[0,1],-1,/Distance/);check(box,[0,2],0.5,/coplanar/);
  const unsupported=box.clone().setAttribute('skinWeight',new THREE.Float32BufferAttribute(new Float32Array(24*4),4));check(unsupported,[0,1],0.5,/skinWeight/);
  const morph=box.clone();morph.morphAttributes.position=[morph.attributes.position.clone()];check(morph,[0,1],0.5,/morph/);
  const partial=box.clone();partial.setDrawRange(0,3);check(partial,[0,1],0.5,/draw ranges/);
  const mesh=(p:number[])=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  check(mesh([0,0,0,1,0,0,0,1,0,3,0,0,4,0,0,3,1,0]),[0,1],0.5,/edge-connected/);
  check(mesh([0,0,1e8,1,0,1e8,0,1,1e8]),[0],0.5,/precision/);
  check(mesh([0,0,0,1,0,0,2,0,0]),[0],0.5,/degenerate/);
});

test('real Shift-selected planar faces repeat extrusion, move and round trip history/projects',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(()=>{const e=(window as any).__forge;delete e.selected.userData.forgePrimitive;delete e.selected.userData.forgeLogicalQuads;e.selected.rotation.set(0,0,0);e.selected.scale.set(1.5,0.8,1.2);e.commit();e.view('front');});
  await page.locator('#mode').selectOption('edit');await page.getByLabel('Mesh component').selectOption('face');
  const targets=await page.evaluate(()=>{
    const e=(window as any).__forge,m=e.selected,t=e.topology,p=m.geometry.attributes.position;
    m.updateWorldMatrix(true,true);e.camera.updateMatrixWorld(true);const rect=e.host.getBoundingClientRect();
    return t.faces.map((vs:number[],id:number)=>({vs,id})).filter((f:any)=>f.vs.every((v:number)=>p.getZ(t.vertices[v][0])===1)).map((f:any)=>{
      const point=m.position.clone().set(0,0,0);f.vs.forEach((v:number)=>point.add(m.position.clone().fromBufferAttribute(p,t.vertices[v][0])));point.divideScalar(3);m.localToWorld(point).project(e.camera);
      return {id:f.id,x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
    });
  });
  await page.mouse.click(targets[0].x,targets[0].y);await page.keyboard.down('Shift');await page.mouse.click(targets[1].x,targets[1].y);await page.keyboard.up('Shift');
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);await expect(page.locator('#toast')).toContainText('Planar region extruded');
  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  const result=await page.evaluate(()=>{
    const e=(window as any).__forge,p=e.selected.geometry.attributes.position;
    const faces=[...e.selectedComponents],positions=Array.from(p.array) as number[],selected=[...e.vertexIndices],capZ=selected.map((i:number)=>p.getZ(i));
    e.transform.dispatchEvent({type:'dragging-changed',value:true});e.vertexProxy.position.x+=0.3;e.transform.dispatchEvent({type:'objectChange'});e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const moved=Array.from(p.array),after=e.snapshot(),triangles=e.stats().triangles;
    e.undo();e.undo();e.undo();const undone=e.snapshot();e.redo();e.redo();e.redo();const redone=e.snapshot();e.load(JSON.parse(after));
    return {faces,positions,selected,capZ,moved,after,triangles,undone,redone,restored:e.snapshot()};
  });
  expect(result.faces.sort()).toEqual(targets.map((t:any)=>t.id).sort());expect(result.triangles).toBe(28);expect(result.capZ.every((z:number)=>z===2)).toBe(true);
  result.moved.forEach((v:any,i:number)=>expect(v).toBeCloseTo(result.positions[i]+(i%3===0&&result.selected.includes(i/3)?0.2:0),5));
  expect(result.undone).toBe(before);expect(result.redone).toBe(result.after);expect(result.restored).toBe(result.after);
});

test('UI region rejection preserves scene and face selection',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);await expect(page.locator('#toast')).toContainText('Select connected coplanar');
  await page.locator('#mode').selectOption('edit');await page.getByLabel('Mesh component').selectOption('face');
  await page.evaluate(()=>{const e=(window as any).__forge;e.selectComponent(0);e.selectComponent(2,true);});
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  await page.evaluate(() => (window as any).__forgeCommands.extrudeRegion());
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);await expect(page.locator('#toast')).toContainText('coplanar');
  expect(await page.evaluate(()=>(window as any).__forge.snapshot())).toBe(before);
  expect(await page.evaluate(()=>[...(window as any).__forge.selectedComponents])).toEqual([0,2]);
});
