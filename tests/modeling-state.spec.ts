import {test,expect} from '@playwright/test';

test('Shift object selection drives atomic batch subdivision through UI',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  await page.evaluate(()=>{(window as any).__forge.duplicate();});
  const rows=page.locator('.object-select');await rows.first().click();await rows.nth(1).click({modifiers:['Shift']});
  expect(await page.evaluate(()=>(window as any).__forge.selectedObjects.size)).toBe(2);
  await page.getByText('Multiple objects',{exact:true}).click();
  const before=await page.evaluate(()=>(window as any).__forge.snapshot());
  await page.locator('#batch-subdivide').click();await expect(page.locator('#toast')).toContainText('complete');
  const result=await page.evaluate(()=>{const e=(window as any).__forge,faces=e.content.children.map((m:any)=>(m.geometry.index?.count??m.geometry.attributes.position.count)/3),after=e.snapshot();e.undo();return {faces,after,undo:e.snapshot()};});
  expect(result.faces).toEqual([48,48]);expect(result.undo).toBe(before);
});

test('late batch failure and changed component selection discard all prepared geometry',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  const result=await page.evaluate(async()=>{
    const e=(window as any).__forge,a=e.selected;e.duplicate();const b=e.selected;e.select(a,true);
    b.geometry.setAttribute('unsupported',b.geometry.attributes.position.clone());
    const before=e.snapshot();let batchError='';try{await e.runModeling({kind:'subdivide',edges:[]},true);}catch(error){batchError=String(error);}
    const after=e.snapshot();b.geometry.deleteAttribute('unsupported');e.select(a);e.setEditMode(true);e.setComponentMode('face');e.selectComponent(0);
    const prior=e.snapshot(),pending=e.runModeling({kind:'uv',faces:[0],operation:'project',values:[0,0,0,1,1]});
    e.selectComponent(1);let staleError='';try{await pending;}catch(error){staleError=String(error);}
    return {before,after,batchError,prior,current:e.snapshot(),staleError,selection:e.componentSelection};
  });
  expect(result.after).toBe(result.before);expect(result.batchError).toContain('Unsupported');
  expect(result.current).toBe(result.prior);expect(result.staleError).toContain('discarded');expect(result.selection).toEqual([1]);
});

test('modifier ordering, source restoration and malformed load preserve scene authority',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  const result=await page.evaluate(async()=>{
    const e=(window as any).__forge,base=Array.from(e.selected.geometry.attributes.position.array);
    const smooth={kind:'smooth',enabled:true,amount:0.25},subdivide={kind:'subdivide',enabled:true,amount:0.5};
    await e.setModifiers([smooth,subdivide]);const first=Array.from(e.selected.geometry.attributes.position.array);
    await e.setModifiers([subdivide,smooth]);const second=Array.from(e.selected.geometry.attributes.position.array);
    const good=e.snapshot(),bad=JSON.parse(good);bad.scene.object.children[0].userData.modifierStack.items[0].kind='unknown';let error='';try{e.load(bad);}catch(caught){error=String(caught);}
    const unchanged=e.snapshot(),edit=e.setEditMode(true);
    await e.setModifiers([]);const restored=Array.from(e.selected.geometry.attributes.position.array);e.setEditMode(true);
    return {base,first,second,good,unchanged,error,edit,restored,editing:e.editMode};
  });
  expect(result.first).not.toEqual(result.second);expect(result.unchanged).toBe(result.good);expect(result.error).toContain('Invalid modifier');
  expect(result.edit).toBe(false);expect(result.restored).toEqual(result.base);expect(result.editing).toBe(true);
});

test('group world rotation and uniform scale keep the shared center, reject shear requests',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  const result=await page.evaluate(()=>{
    const e=(window as any).__forge,a=e.selected;a.position.set(-1,0,0);e.duplicate();const b=e.selected;b.position.set(1,0,0);e.select(a,true);
    e.transformObjects('rotate',[0,0,90]);const rotated=[a.position.toArray(),b.position.toArray()];e.transformObjects('scale',[2,2,2]);const scaled=[a.position.toArray(),b.position.toArray()],before=e.snapshot();
    let error='';try{e.transformObjects('scale',[2,1,1]);}catch(caught){error=String(caught);}return {rotated,scaled,before,after:e.snapshot(),error};
  });
  expect(result.rotated[0][0]).toBeCloseTo(0);expect(result.rotated[0][1]).toBeCloseTo(-1);expect(result.rotated[1][1]).toBeCloseTo(1);
  expect(result.scaled[0][1]).toBeCloseTo(-2);expect(result.scaled[1][1]).toBeCloseTo(2);expect(result.after).toBe(result.before);expect(result.error).toContain('uniform');
});

test('large Edit Mode topology completes off-thread and cancellation keeps Object Mode',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>(window as any).__forge?.selected);
  const result=await page.evaluate(async()=>{
    // @ts-expect-error Vite browser module.
    const THREE=await import('/node_modules/three/build/three.module.js');
    const e=(window as any).__forge,g=new THREE.PlaneGeometry(10,10,100,100);e.selected.geometry=new THREE.BufferGeometry().copy(g);e.commit();
    const before=e.snapshot(),pending=e.enterEditMode(true);e.cancelModeling();let error='';try{await pending;}catch(caught){error=String(caught);}
    const cancelled=e.editMode,after=e.snapshot();await e.enterEditMode(true);return {before,after,error,cancelled,editing:e.editMode,faces:e.meshTopology.faces.length};
  });
  expect(result.cancelled).toBe(false);expect(result.error).toContain('cancelled');expect(result.after).toBe(result.before);expect(result.editing).toBe(true);expect(result.faces).toBe(20000);
});
