import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.content.children.length === 1);
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

test('creates exact SOMA77 hierarchy and supports FK and full-pose keys', async ({ page }) => {
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-rig').click();
  await expect(page.locator('.bone-button')).toHaveCount(77);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const bones: any[] = []; rig.traverse((o: any) => { if(o.isBone) bones.push(o); });
    const hips = rig.getObjectByName('Hips'), arm = rig.getObjectByName('LeftArm'), hand = rig.getObjectByName('LeftHand');
    const before = hand.getWorldPosition(hips.position.clone()).toArray();
    r.keyPose();
    e.frame = 25; arm.rotation.z = 0.7; rig.updateMatrixWorld(true);
    const after = hand.getWorldPosition(hips.position.clone()).toArray();
    r.keyPose(); e.scrub(13);
    return { count: bones.length, hips: hips.position.toArray(), parent: hand.parent.name, before, after, angle: arm.rotation.z, keys: arm.userData.keyframes.length };
  });
  expect(result.count).toBe(77); expect(result.hips).toEqual([0,0,0]); expect(result.parent).toBe('LeftForeArm');
  expect(result.before).not.toEqual(result.after); expect(result.angle).toBeCloseTo(0.35, 4); expect(result.keys).toBe(2);
});

test('skinned vertices deform and survive project reload', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add(); r.addPreview();
    const mesh = rig.children.find((o: any) => o.isSkinnedMesh);
    const arm = rig.getObjectByName('LeftArm');
    const index = mesh.geometry.attributes.skinIndex.array.findIndex((v: number, i: number) => i % 4 === 0 && v === mesh.skeleton.bones.indexOf(arm)) / 4;
    const vertex = arm.position.clone();
    rig.updateMatrixWorld(true); mesh.skeleton.update();
    mesh.getVertexPosition(index,vertex); const before = vertex.toArray();
    arm.rotation.z = 0.8; rig.updateMatrixWorld(true); mesh.skeleton.update();
    mesh.getVertexPosition(index,vertex); const posed = vertex.toArray();
    e.commit(); const saved = e.snapshot(); e.load(JSON.parse(saved));
    const restored = e.content.children.find((o: any)=>o.userData.forgeRig);
    const skin = restored.children.find((o: any)=>o.isSkinnedMesh);
    restored.updateMatrixWorld(true); skin.skeleton.update(); skin.getVertexPosition(index,vertex);
    return { before, posed, restored: vertex.toArray(), bones: skin.skeleton.bones.length };
  });
  expect(result.posed).not.toEqual(result.before);
  result.posed.forEach((v: number,i: number) => expect(result.restored[i]).toBeCloseTo(v,5));
  expect(result.bones).toBe(77);
});

test('duplicating a rig keeps skeleton references independent', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add(); r.addPreview(); e.select(rig); e.duplicate();
    const copy = e.selected;
    const sourceArm = rig.getObjectByName('LeftArm'), copyArm = copy.getObjectByName('LeftArm');
    copyArm.rotation.z = 0.6;
    const copySkin = copy.children.find((o:any)=>o.isSkinnedMesh);
    return { sourceAngle: sourceArm.rotation.z, distinct: sourceArm !== copyArm, referencesCopy: copySkin.skeleton.bones.includes(copyArm), referencesOriginal: copySkin.skeleton.bones.includes(sourceArm) };
  });
  expect(result).toEqual({ sourceAngle:0, distinct:true, referencesCopy:true, referencesOriginal:false });
});

test('IK moves the wrist to a reachable target', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add(); r.enableIK('LeftHand');
    const target = e.transform.object;
    target.position.x -= 0.1; target.position.y += 0.13; target.position.z += 0.12;
    e.transform.dispatchEvent({type:'objectChange'});
    rig.updateMatrixWorld(true);
    return rig.getObjectByName('LeftHand').getWorldPosition(target.position.clone()).distanceTo(target.position);
  });
  expect(result).toBeLessThan(0.015);
});

test('worker skin binding creates normalized GPU weights and real deformation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const mesh = e.add('sphere'); mesh.scale.set(0.2,0.2,0.2); mesh.position.set(0.3,1.45,0); e.commit();
    const bound = await r.bindSelected();
    const weights = bound.geometry.attributes.skinWeight;
    let maxError = 0;
    for(let i=0;i<weights.count;i++) maxError = Math.max(maxError,Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1));
    const vertex = mesh.position.clone(); rig.updateMatrixWorld(true); bound.skeleton.update(); bound.getVertexPosition(100,vertex); const before=vertex.toArray();
    rig.getObjectByName('Hips').rotation.z=0.2; rig.updateMatrixWorld(true); bound.skeleton.update(); bound.getVertexPosition(100,vertex);
    return { maxError, before, after:vertex.toArray(), bones:bound.skeleton.bones.length };
  });
  expect(result.maxError).toBeLessThan(1e-6); expect(result.bones).toBe(77); expect(result.before).not.toEqual(result.after);
});

test('GLB export includes skin and bone animation and reimports', async ({ page }) => {
  await page.evaluate(() => { const e=(window as any).__forge,r=(window as any).__rig; r.add(); r.addPreview(); r.keyPose(); e.frame=25; r.activeRig.getObjectByName('LeftArm').rotation.z=0.5; r.keyPose(); });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  const path = await download.path();
  await page.locator('#model-input').setInputFiles(path!);
  await expect(page.locator('#toast')).toContainText('Model imported');
  expect(await page.evaluate(() => { let count=0; (window as any).__forge.content.traverse((o:any)=>{if(o.isSkinnedMesh)count++;});return count; })).toBe(2);
});

test('malformed projects do not erase the current scene', async ({ page }) => {
  expect(await page.evaluate(() => { const e=(window as any).__forge; const original=e.selected.uuid; try{e.load({format:'nope',version:1,scene:{}});}catch{} return e.selected.uuid===original; })).toBe(true);
});

test('mobile layout fits and opens the rig panel', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#toggle-sidebar').click();
  await page.locator('[data-panel="rig"]').click();
  await expect(page.locator('#create-rig')).toBeVisible();
  await page.screenshot({path:'test-results/mobile.png'});
});

test('rig workspace screenshot', async ({ page }) => {
  await page.evaluate(() => { const e=(window as any).__forge;e.select(e.content.children[0]);e.remove(); });
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-rig').click();
  await page.locator('#rig-preview').click();
  await page.evaluate(() => { const e=(window as any).__forge,r=(window as any).__rig; r.activeRig.getObjectByName('LeftArm').rotation.z=0.5;e.commit();e.focus(true); });
  await page.waitForTimeout(250);
  await page.screenshot({path:'test-results/rig.png'});
});
