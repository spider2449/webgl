import { test, expect, type Page } from '@playwright/test';
import { buildTopology } from '../src/modeling/topology';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.content.children.length === 1);
});

async function createGenericThreeBoneArmature(page: Page) {
  await page.evaluate(() => {
    const e = (window as any).__forge;
    const r = (window as any).__rig;
    const rig = r.add();
    r.setMode('edit');
    const root = e.selected;
    root.name = 'Root';
    const mid = r.extrudeSelectedBone();
    mid.name = 'Mid';
    const tip = r.extrudeSelectedBone();
    tip.name = 'Tip';
    e.commit();
    r.setMode('pose');
    e.select(rig);
  });
}

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

test('creates and edits a Forge-native armature hierarchy through rig controls', async ({ page }) => {
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-rig').click();
  await expect(page.locator('#rig-mode')).toHaveValue('edit');
  await expect(page.locator('.bone-button')).toHaveCount(1);
  await page.locator('#rig-extrude').click();
  await page.locator('#rig-extrude').click();
  await page.locator('#rig-add-root').click();
  await expect(page.locator('.bone-button')).toHaveCount(4);

  await page.locator('[data-panel="object"]').click();
  await page.getByLabel('position x', { exact: true }).fill('1.5');
  await page.getByLabel('position x', { exact: true }).press('Enter');
  await page.locator('[data-panel="rig"]').click();

  const before = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const target = rig.getObjectByName('Bone.001');
    const selected = e.selected;
    return {
      target: target.uuid,
      world: selected.getWorldPosition(selected.position.clone()).toArray(),
      rest: selected.userData.restPosition,
      names: (() => { const names: string[] = []; rig.traverse((o: any) => { if (o.isBone) names.push(o.name); }); return names; })(),
    };
  });
  expect(before.names).toEqual(['Bone', 'Bone.001', 'Bone.002', 'Bone.003']);
  expect(before.rest[0]).toBeCloseTo(1.5, 6);
  await page.locator('#rig-parent').selectOption(before.target);
  await page.locator('#rig-reparent').click();
  const after = await page.evaluate(() => {
    const e = (window as any).__forge;
    const selected = e.selected;
    return { parent: selected.parent.name, world: selected.getWorldPosition(selected.position.clone()).toArray(), rest: selected.userData.restPosition };
  });
  expect(after.parent).toBe('Bone.001');
  before.world.forEach((value: number, index: number) => expect(after.world[index]).toBeCloseTo(value, 6));
  expect(after.rest).toHaveLength(3);

  const deleteSetup = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const middle = rig.getObjectByName('Bone.001');
    const child = rig.getObjectByName('Bone.002');
    e.select(middle);
    return {
      child: child.uuid,
      childWorld: child.getWorldPosition(child.position.clone()).toArray(),
    };
  });
  await page.locator('#rig-delete-bone').click();
  const deleted = await page.evaluate(({ child }) => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const survivor = rig.getObjectByProperty('uuid', child);
    const names: string[] = [];
    rig.traverse((object: any) => { if (object.isBone) names.push(object.name); });
    return {
      names,
      parent: survivor.parent.name,
      world: survivor.getWorldPosition(survivor.position.clone()).toArray(),
      rest: survivor.userData.restPosition,
      selected: e.selected.name,
    };
  }, deleteSetup);
  expect(deleted.names).toEqual(['Bone', 'Bone.002', 'Bone.003']);
  expect(deleted.parent).toBe('Bone');
  deleteSetup.childWorld.forEach((value: number, index: number) => expect(deleted.world[index]).toBeCloseTo(value, 6));
  expect(deleted.rest).toHaveLength(3);
  expect(deleted.selected).toBe('Bone');

  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => {
    const r = (window as any).__rig;
    const names: string[] = [];
    r.activeRig.traverse((object: any) => { if (object.isBone) names.push(object.name); });
    return names;
  })).toEqual(['Bone', 'Bone.001', 'Bone.002', 'Bone.003']);

  await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => {
    const r = (window as any).__rig;
    const names: string[] = [];
    r.activeRig.traverse((object: any) => { if (object.isBone) names.push(object.name); });
    return names;
  })).toEqual(['Bone', 'Bone.002', 'Bone.003']);
});

test('keeps at least one bone and routes Delete through armature Edit mode', async ({ page }) => {
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-rig').click();
  await expect(page.locator('.bone-button')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.bone-button')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('at least one bone');

  await page.locator('#rig-extrude').click();
  await expect(page.locator('.bone-button')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.bone-button')).toHaveCount(1);
});

test('locks rest-skeleton editing after bone animation is authored', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  const message = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    e.select(r.activeRig.getObjectByName('Mid'));
    r.keyPose();
    try { r.setMode('edit'); return ''; } catch (error) { return (error as Error).message; }
  });
  expect(message).toContain('after bone animation is authored');
});

test('creates exact SOMA77 hierarchy and supports FK and full-pose keys', async ({ page }) => {
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-soma-rig').click();
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
    let editError = '';
    try { r.setMode('edit'); } catch (error) { editError = (error as Error).message; }
    return { count: bones.length, hips: hips.position.toArray(), parent: hand.parent.name, before, after, angle: arm.rotation.z, keys: arm.userData.animationTracks['rotation.z'].length, editError };
  });
  expect(result.count).toBe(77); expect(result.hips).toEqual([0,0,0]); expect(result.parent).toBe('LeftForeArm');
  expect(result.before).not.toEqual(result.after); expect(result.angle).toBeCloseTo(0.35, 4); expect(result.keys).toBe(2);
  expect(result.editError).toContain('pose-only');
});

test('skinned vertices deform and survive project reload', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const mesh = e.add('sphere');
    mesh.scale.set(0.45, 0.9, 0.45);
    mesh.position.set(0, 1, 0);
    e.commit();
    const skin = await r.bindSelected();
    const vertex = skin.position.clone();
    rig.updateMatrixWorld(true); skin.skeleton.update();
    skin.getVertexPosition(0, vertex); const before = vertex.toArray();
    rig.getObjectByName('Root').rotation.z = 0.5;
    rig.updateMatrixWorld(true); skin.skeleton.update();
    skin.getVertexPosition(0, vertex); const posed = vertex.toArray();
    e.commit(); const saved = e.snapshot(); e.load(JSON.parse(saved));
    const restored = e.content.children.find((o: any) => o.userData.forgeRig?.type === 'armature');
    const restoredSkin = restored.children.find((o: any) => o.isSkinnedMesh);
    restored.updateMatrixWorld(true); restoredSkin.skeleton.update(); restoredSkin.getVertexPosition(0, vertex);
    return { before, posed, restored: vertex.toArray(), bones: restoredSkin.skeleton.bones.length, names: restoredSkin.skeleton.bones.map((bone: any) => bone.name) };
  });
  expect(result.posed).not.toEqual(result.before);
  result.posed.forEach((value: number, index: number) => expect(result.restored[index]).toBeCloseTo(value, 5));
  expect(result.bones).toBe(3);
  expect(result.names).toEqual(['Root', 'Mid', 'Tip']);
});

test('duplicating a generic armature keeps skeleton references independent', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const mesh = e.add('sphere');
    mesh.scale.set(0.45, 0.9, 0.45);
    mesh.position.set(0, 1, 0);
    e.commit();
    await r.bindSelected();
    e.select(rig); e.duplicate();
    const copy = e.selected;
    const sourceMid = rig.getObjectByName('Mid'), copyMid = copy.getObjectByName('Mid');
    copyMid.rotation.z = 0.6;
    const copySkin = copy.children.find((o: any) => o.isSkinnedMesh);
    return {
      sourceAngle: sourceMid.rotation.z,
      distinct: sourceMid !== copyMid,
      referencesCopy: copySkin.skeleton.bones.includes(copyMid),
      referencesOriginal: copySkin.skeleton.bones.includes(sourceMid),
      names: copySkin.skeleton.bones.map((bone: any) => bone.name),
    };
  });
  expect(result.sourceAngle).toBeCloseTo(0, 12);
  expect(result.distinct).toBe(true);
  expect(result.referencesCopy).toBe(true);
  expect(result.referencesOriginal).toBe(false);
  expect(result.names).toEqual(['Root', 'Mid', 'Tip']);
});

test('IK solves an arbitrary three-bone armature without named limb assumptions', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const tip = rig.getObjectByName('Tip');
    r.enableIK(tip, 2);
    const target = e.transform.object;
    target.position.x += 0.6;
    target.position.y -= 0.25;
    target.position.z += 0.2;
    e.transform.dispatchEvent({ type: 'objectChange' });
    rig.updateMatrixWorld(true);
    return {
      distance: tip.getWorldPosition(target.position.clone()).distanceTo(target.position),
      names: r.activeRig ? (() => { const names: string[] = []; r.activeRig.traverse((o: any) => { if (o.isBone) names.push(o.name); }); return names; })() : [],
    };
  });
  expect(result.distance).toBeLessThan(0.02);
  expect(result.names).toEqual(['Root', 'Mid', 'Tip']);
});

test('worker skin binding supports arbitrary roots and leaf bones with normalized GPU weights', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const mesh = e.add('sphere');
    mesh.scale.set(0.45, 0.9, 0.45);
    mesh.position.set(0, 1, 0);
    e.commit();
    const bound = await r.bindSelected();
    const weights = bound.geometry.attributes.skinWeight;
    const indices = bound.geometry.attributes.skinIndex;
    let maxError = 0;
    const used = new Set<number>();
    for (let i = 0; i < weights.count; i++) {
      maxError = Math.max(maxError, Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1));
      const slotWeights = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      const slotIndices = [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)];
      slotIndices.forEach((value, slot) => { if (slotWeights[slot] > 1e-8) used.add(value); });
    }
    const vertex = mesh.position.clone();
    rig.updateMatrixWorld(true); bound.skeleton.update(); bound.getVertexPosition(100, vertex); const before = vertex.toArray();
    rig.getObjectByName('Root').rotation.z = 0.2;
    rig.updateMatrixWorld(true); bound.skeleton.update(); bound.getVertexPosition(100, vertex);
    let editLock = '';
    try { r.setMode('edit'); } catch (error) { editLock = (error as Error).message; }
    return { maxError, before, after: vertex.toArray(), bones: bound.skeleton.bones.length, used: [...used].sort(), editLock };
  });
  expect(result.maxError).toBeLessThan(1e-6);
  expect(result.bones).toBe(3);
  expect(result.used).toContain(2);
  expect(result.before).not.toEqual(result.after);
  expect(result.editLock).toContain('after skin binding');
});

test('GLB export includes generic skin and bone animation and reimports', async ({ page }) => {
  await createGenericThreeBoneArmature(page);
  await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const mesh = e.add('sphere');
    mesh.scale.set(0.45, 0.9, 0.45);
    mesh.position.set(0, 1, 0);
    e.commit();
    await r.bindSelected();
    e.select(rig);
    e.frame = 1; r.keyPose();
    e.frame = 25; rig.getObjectByName('Mid').rotation.z = 0.5; r.keyPose();
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  const path = await download.path();
  await page.locator('#model-input').setInputFiles(path!);
  await expect(page.locator('#toast')).toContainText('Model imported');
  expect(await page.evaluate(() => {
    let skins = 0, bones = 0;
    (window as any).__forge.content.traverse((object: any) => {
      if (object.isSkinnedMesh) skins++;
      if (object.isBone && ['Root', 'Mid', 'Tip'].includes(object.name)) bones++;
    });
    return { skins, bones };
  })).toEqual({ skins: 2, bones: 6 });
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
  await page.locator('#rig-extrude').click();
  await page.locator('#rig-extrude').click();
  await page.evaluate(() => { const e=(window as any).__forge; e.focus(true); });
  await page.waitForTimeout(250);
  await page.screenshot({path:'test-results/rig.png'});
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
