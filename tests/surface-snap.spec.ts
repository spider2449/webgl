import { test, expect } from '@playwright/test';

for (const mode of ['vertex','edge','face']) test(`surface click snaps ${mode} selection at the clicked point under transformed mesh`, async ({page})=>{
  await page.goto('/'); await page.waitForFunction(()=>(window as any).__forge?.selected);
  const state=await page.evaluate(mode=>{
    const e=(window as any).__forge,m=e.selected; m.rotation.set(0.1,0.2,0.15); m.scale.set(1.4,0.8,1.2); e.commit(); e.view('front'); e.setEditMode(true); e.setComponentMode(mode);
    const t=e.meshTopology,p=m.geometry.attributes.position;
    const components=mode==='vertex'?t.vertices.map((_:unknown,i:number)=>[i]):mode==='edge'?t.edges:t.faces;
    const source=components.findIndex((vs:number[])=>vs.every(v=>p.getZ(t.vertices[v][0])===-1)); e.selectComponent(source);
    const face=t.faces.findIndex((vs:number[])=>vs.every(v=>p.getZ(t.vertices[v][0])===1));
    const weights=[0.2,0.3,0.5],point=m.position.clone().set(0,0,0);
    t.faces[face].forEach((v:number,j:number)=>point.addScaledVector(m.position.clone().fromBufferAttribute(p,t.vertices[v][0]),weights[j]));
    const delta=point.clone().sub(e.componentCenter).toArray(),before=e.snapshot(),positions=Array.from(p.array),indices=[...e.vertexIndices];
    m.updateWorldMatrix(true,true); e.camera.updateMatrixWorld(true); const screen=m.localToWorld(point).project(e.camera),rect=e.host.getBoundingClientRect();
    return {before,positions,indices,delta,x:rect.left+(screen.x+1)*rect.width/2,y:rect.top+(1-screen.y)*rect.height/2};
  },mode);
  await page.getByLabel('Snap target',{exact:true}).selectOption('surface'); await page.locator('#vertex-snap').click(); await page.mouse.click(state.x,state.y);
  await expect(page.locator('#toast')).toContainText('snapped to surface point');
  const result=await page.evaluate(()=>{const e=(window as any).__forge,positions=Array.from(e.selected.geometry.attributes.position.array),after=e.snapshot();e.undo();const undo=e.snapshot();e.redo();return {positions,after,undo,redo:e.snapshot()};});
  result.positions.forEach((v:any,i:number)=>expect(v).toBeCloseTo((state.positions[i] as number)+(state.indices.includes(Math.floor(i/3))?state.delta[i%3]:0),4));
  // ObjectLoader decomposes/recomposes rotated matrices with double rounding.
  const stable = (text: string) => JSON.parse(text, (name,value) => name === 'matrix' ? value.map((n:number)=>Number(n.toFixed(12))) : value);
  expect(stable(result.undo)).toEqual(stable(state.before));expect(stable(result.redo)).toEqual(stable(result.after));
});

test('surface target validation rejects selected corners and non-finite weights without mutation',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  const result=await page.evaluate(()=>{const e=(window as any).__forge;e.setEditMode(true);e.selectComponent(0);const before=e.snapshot(),errors=[];
    const face=e.meshTopology.faces.findIndex((vs:number[])=>vs.includes(0));
    for(const [f,w] of [[face,[0.2,0.3,0.5]],[0,[NaN,0,1]],[-1,[0,0,1]],[0,[2,-1,0]],[0,[0,0,0]]])try{e.snapSelectionToSurface(f,w);}catch(error){errors.push(String(error));}
    return {before,after:e.snapshot(),errors};});
  expect(result.errors).toHaveLength(5);expect(result.after).toBe(result.before);
});
