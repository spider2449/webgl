import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { subdivideEdges } from '../src/modeling/subdivide';
import { buildTopology } from '../src/modeling/topology';

test('all triangle edge masks preserve area, winding, boundary and interpolated UVs', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,4,0,0,0,4,0],3));
  source.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1],2));
  source.addGroup(0,3,7);
  const pairs: [number,number][] = [[0,1],[1,2],[2,0]];
  for (let mask=1;mask<8;mask++) {
    const edges=pairs.filter((_,i)=>mask&(1<<i));
    const result=subdivideEdges(source,edges), p=result.attributes.position, index=result.index!;
    expect(index.count).toBe((edges.length+1)*3);
    expect(p.count).toBe(3+edges.length);
    let area=0;
    const uses=new Map<string,number>();
    for (let i=0;i<index.count;i+=3) {
      const ids=[0,1,2].map(j=>index.getX(i+j));
      const [a,b,c]=ids.map(id=>new THREE.Vector3().fromBufferAttribute(p,id));
      const cross=b.sub(a).cross(c.sub(a)); expect(cross.z).toBeGreaterThan(0); area+=cross.z/2;
      for (let j=0;j<3;j++) { const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`; uses.set(key,(uses.get(key)??0)+1); }
    }
    expect(area).toBe(8);
    expect([...uses.values()].filter(n=>n===1)).toHaveLength(3+edges.length);
    expect([...uses.values()].every(n=>n===1||n===2)).toBe(true);
    for (let i=0;i<p.count;i++) { expect(result.attributes.uv.getX(i)).toBe(p.getX(i)/4); expect(result.attributes.uv.getY(i)).toBe(p.getY(i)/4); }
    expect(result.groups).toEqual([{start:0,count:index.count,materialIndex:7}]);
  }
});

for (const expanded of [false,true]) test(`all cube edges subdivide consistently across seams (${expanded})`,()=>{
  const box=new THREE.BoxGeometry(2,2,2), source=expanded?box.toNonIndexed():box;
  const topology=buildTopology(source.attributes.position.array,source.index?.array);
  const pairs=topology.edges.map(edge=>edge.map(v=>topology.vertices[v][0]) as [number,number]);
  const before=JSON.stringify(source.toJSON()), result=subdivideEdges(source,pairs);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  const out=buildTopology(result.attributes.position.array,result.index!.array);
  expect(out.vertices).toHaveLength(26); expect(out.faces).toHaveLength(48);
  const uses=new Map<string,number[]>();
  for (const face of out.faces) for (let j=0;j<3;j++) {
    const a=face[j],b=face[(j+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`;
    uses.set(key,[...(uses.get(key)??[]),a<b?1:-1]);
  }
  for (const signs of uses.values()) { expect(signs).toHaveLength(2); expect(signs[0]+signs[1]).toBe(0); }
  expect(result.groups.map(g=>g.count)).toEqual(Array(6).fill(24));
  const reordered=subdivideEdges(source,[...pairs].reverse().concat([pairs[0],[pairs[0][1],pairs[0][0]]]));
  expect(Array.from(reordered.index!.array)).toEqual(Array.from(result.index!.array));
  for (const name of Object.keys(result.attributes)) expect(Array.from(reordered.attributes[name].array)).toEqual(Array.from(result.attributes[name].array));
  expect(reordered.groups).toEqual(result.groups);
});

test('partial-invalid edge sets and midpoint collisions leave the source unchanged',()=>{
  const mesh=(p:number[])=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  const source=mesh([0,0,0,2,0,0,0,2,0,10,0,0,12,0,0,10,2,0]);
  const before=JSON.stringify(source.toJSON());
  expect(()=>subdivideEdges(source,[])).toThrow(/at least one/);
  expect(()=>subdivideEdges(source,[[0,1],[0,5]])).toThrow(/form an edge/);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  const crossed=mesh([-1,0,0,1,0,0,0,2,0,0,-1,0,0,1,0,2,0,0]);
  const crossBefore=JSON.stringify(crossed.toJSON());
  expect(()=>subdivideEdges(crossed,[[0,1],[3,4]])).toThrow(/another midpoint/);
  expect(JSON.stringify(crossed.toJSON())).toBe(crossBefore);
});

test('Shift-selected adjacent edges subdivide atomically and keep split edges selected',async({page})=>{
  await page.goto('/'); await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(()=>{const e=(window as any).__forge;e.selected.rotation.set(0,0,0);e.selected.scale.set(1.5,0.8,1.2);e.commit();e.view('front');});
  await page.locator('#mode').selectOption('edit'); await page.getByLabel('Mesh component').selectOption('edge');
  const setup=await page.evaluate(()=>{
    const e=(window as any).__forge,m=e.selected,t=e.topology,p=m.geometry.attributes.position;
    const face=t.polygons.find((vs:number[])=>vs.every(v=>p.getZ(t.vertices[v][0])===1));
    const faceEdges=t.polygonEdges.filter((edge:number[])=>edge.every(v=>face.includes(v)));
    const first=faceEdges[0],second=faceEdges.find((edge:number[])=>edge!==first&&edge.some(v=>first.includes(v)));
    if(!first||!second)throw new Error('Expected adjacent logical boundary edges.');
    const pairs=[first,second];
    m.updateWorldMatrix(true,true); e.camera.updateMatrixWorld(true);
    const rect=e.host.getBoundingClientRect();
    const targets=pairs.map(vs=>{
      const point=m.position.clone().set(0,0,0);
      vs.forEach(v=>point.add(m.position.clone().fromBufferAttribute(p,t.vertices[v][0]))); point.multiplyScalar(0.5);
      const midpoint=point.toArray();m.localToWorld(point).project(e.camera);
      return {midpoint,x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
    });
    return {targets,bufferCount:p.count};
  });
  const targets=setup.targets;
  await page.mouse.click(targets[0].x,targets[0].y);
  await page.keyboard.down('Shift'); await page.mouse.click(targets[1].x,targets[1].y); await page.keyboard.up('Shift');
  expect(await page.evaluate(()=>(window as any).__forge.selectedComponents.size)).toBe(2);
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  // Result-size rejection retains geometry and the selected edge set.
  const guarded=await page.evaluate(()=>{
    const e=(window as any).__forge,stats=e.stats;let error='';
    e.stats=()=>({...stats.call(e),vertices:2_000_000});
    try{e.subdivideSelectedEdge();}catch(caught){error=String(caught);}finally{e.stats=stats;}
    return {error,snapshot:e.snapshot(),selected:e.selectedComponents.size};
  });
  expect(guarded.error).toContain('scene vertex limit');expect(guarded.snapshot).toBe(before);expect(guarded.selected).toBe(2);
  await page.locator('#subdivide-edge').click();
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await expect(page.getByLabel('Mesh component')).toHaveValue('edge');
  const result=await page.evaluate((setup)=>{
    const e=(window as any).__forge,p=e.selected.geometry.attributes.position,t=e.topology;
    const midpointVertices=[...new Set(t.bufferToVertex.slice(setup.bufferCount))];
    const mids=midpointVertices.map((v:number)=>[p.getX(t.vertices[v][0]),p.getY(t.vertices[v][0]),p.getZ(t.vertices[v][0])]);
    const selectedEdges=[...e.selectedComponents];
    const selected=[...e.vertexIndices],positions=Array.from(p.array) as number[];
    e.transform.dispatchEvent({type:'dragging-changed',value:true});e.vertexProxy.position.x+=0.3;e.transform.dispatchEvent({type:'objectChange'});e.transform.dispatchEvent({type:'dragging-changed',value:false});
    const moved=Array.from(p.array),after=e.snapshot(),triangles=e.stats().triangles;
    e.undo();e.undo();const undone=e.snapshot();e.redo();e.redo();const redone=e.snapshot();e.load(JSON.parse(after));
    return {mids,selectedEdges,selected,positions,moved,after,triangles,undone,redone,restored:e.snapshot()};
  },setup);
  expect(result.mids).toHaveLength(2);for(const target of targets)expect(result.mids).toContainEqual(target.midpoint);
  expect(result.selectedEdges).toHaveLength(4);
  expect(result.triangles).toBe(16);
  result.moved.forEach((v:any,i:number)=>expect(v).toBeCloseTo(result.positions[i]+(i%3===0&&result.selected.includes(i/3)?0.2:0),5));
  expect(result.undone).toBe(before);expect(result.redone).toBe(result.after);expect(result.restored).toBe(result.after);
});
