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

test('creates a generic armature hierarchy and supports FK and full-pose keys', async ({ page }) => {
  await page.locator('[data-workspace="rigging"]').click();
  await page.locator('#create-rig').click();
  await page.locator('#rig-add-bone').click();
  await page.locator('#rig-add-bone').click();
  await expect(page.locator('.bone-button')).toHaveCount(3);
  await expect(page.locator('#rig-bone-count')).toHaveText('3');

  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.activeRig;
    const bones: any[] = [];
    rig.traverse((o: any) => { if (o.isBone) bones.push(o); });
    const root = bones[0], middle = bones[1], end = bones[2];

    r.keyPose();
    e.frame = 25;
    middle.rotation.z = 0.7;
    rig.updateMatrixWorld(true);
    r.keyPose();
    e.scrub(13);

    return {
      count: bones.length,
      names: bones.map((bone: any) => bone.name),
      parent: end.parent.name,
      angle: middle.rotation.z,
      keys: middle.userData.animationTracks['rotation.z'].length,
      rootParentIsRig: root.parent === rig,
    };
  });

  expect(result.count).toBe(3);
  expect(result.names).toEqual(['Root', 'Bone', 'Bone.001']);
  expect(result.parent).toBe('Bone');
  expect(result.angle).toBeCloseTo(0.35, 4);
  expect(result.keys).toBe(2);
  expect(result.rootParentIsRig).toBe(true);
});

test('Forge rest pose captures arbitrary bone transforms and restores them', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const middle = r.addBone();
    const end = r.addBone();

    middle.position.set(0.2, 0.7, -0.1);
    middle.rotation.set(0.1, 0.2, 0.3);
    middle.scale.set(1.1, 0.9, 1.2);
    end.position.set(0, 0.55, 0.15);
    r.setRestPose();

    middle.position.set(2, 3, 4);
    middle.rotation.set(1, 1, 1);
    middle.scale.set(2, 2, 2);
    end.position.set(4, 5, 6);
    r.resetPose();

    return {
      rigType: rig.userData.forgeRig,
      middle: {
        position: middle.position.toArray(),
        rotation: [middle.rotation.x, middle.rotation.y, middle.rotation.z],
        scale: middle.scale.toArray(),
      },
      end: end.position.toArray(),
      stored: middle.userData.forgeRestPose,
      selected: e.selected?.name,
    };
  });

  expect(result.rigType).toEqual({ type: 'armature', version: 1 });
  expect(result.middle.position).toEqual([0.2, 0.7, -0.1]);
  expect(result.middle.rotation[0]).toBeCloseTo(0.1, 6);
  expect(result.middle.rotation[1]).toBeCloseTo(0.2, 6);
  expect(result.middle.rotation[2]).toBeCloseTo(0.3, 6);
  expect(result.middle.scale).toEqual([1.1, 0.9, 1.2]);
  expect(result.end).toEqual([0, 0.55, 0.15]);
  expect(result.stored.position).toEqual([0.2, 0.7, -0.1]);
  expect(result.selected).toBe('Armature');
});

test('generic IK moves the selected end bone to a reachable target', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const middle = r.addBone();
    middle.position.set(0, 1, 0);
    const end = r.addBone();
    end.position.set(0, 1, 0);
    r.setRestPose();
    e.select(end);
    r.enableIK();

    const target = e.transform.object;
    target.position.set(0.7, 1.6, 0.25);
    e.transform.dispatchEvent({ type: 'objectChange' });
    rig.updateMatrixWorld(true);
    return end.getWorldPosition(target.position.clone()).distanceTo(target.position);
  });

  expect(result).toBeLessThan(0.02);
});

test('worker skin binding uses generic bone segments and produces real deformation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const middle = r.addBone();
    middle.position.set(0, 1, 0);
    const end = r.addBone();
    end.position.set(0, 1, 0);
    r.setRestPose();
    e.select(rig);

    const mesh = e.add('sphere');
    mesh.scale.set(0.35, 0.9, 0.35);
    mesh.position.set(0, 1, 0);
    e.commit();

    const bound = await r.bindSelected();
    const weights = bound.geometry.attributes.skinWeight;
    let maxError = 0;
    for (let i = 0; i < weights.count; i++) {
      maxError = Math.max(maxError, Math.abs(
        weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1
      ));
    }

    const middleIndex = bound.skeleton.bones.indexOf(middle);
    const skinIndex = bound.geometry.attributes.skinIndex;
    const skinWeight = bound.geometry.attributes.skinWeight;
    let vertexIndex = -1;
    for (let i = 0; i < skinIndex.count && vertexIndex < 0; i++) {
      for (let slot = 0; slot < 4; slot++) {
        if (skinIndex.getComponent(i, slot) === middleIndex && skinWeight.getComponent(i, slot) > 0.05) {
          vertexIndex = i;
          break;
        }
      }
    }

    const point = new (e.selected.position.constructor)();
    rig.updateMatrixWorld(true);
    bound.skeleton.update();
    bound.getVertexPosition(vertexIndex, point);
    const before = point.toArray();

    middle.rotation.z = 0.45;
    rig.updateMatrixWorld(true);
    bound.skeleton.update();
    bound.getVertexPosition(vertexIndex, point);

    return {
      maxError,
      before,
      after: point.toArray(),
      bones: bound.skeleton.bones.length,
      vertexIndex,
    };
  });

  expect(result.maxError).toBeLessThan(1e-6);
  expect(result.bones).toBe(3);
  expect(result.vertexIndex).toBeGreaterThanOrEqual(0);
  expect(result.before).not.toEqual(result.after);
});

test('duplicating a generic skinned armature keeps skeleton references independent', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const middle = r.addBone();
    middle.position.set(0, 1, 0);
    const end = r.addBone();
    end.position.set(0, 1, 0);
    r.setRestPose();

    e.select(rig);
    const mesh = e.add('sphere');
    mesh.scale.set(0.3, 0.8, 0.3);
    mesh.position.set(0, 1, 0);
    e.commit();
    await r.bindSelected();

    e.select(rig);
    e.duplicate();
    const copy = e.selected;
    const sourceBone = rig.getObjectByName('Bone');
    const copyBone = copy.getObjectByName('Bone');
    copyBone.rotation.z = 0.6;
    const copySkin = copy.children.find((o: any) => o.isSkinnedMesh);

    return {
      sourceAngle: sourceBone.rotation.z,
      distinct: sourceBone !== copyBone,
      referencesCopy: copySkin.skeleton.bones.includes(copyBone),
      referencesOriginal: copySkin.skeleton.bones.includes(sourceBone),
    };
  });

  expect(result).toEqual({
    sourceAngle: 0,
    distinct: true,
    referencesCopy: true,
    referencesOriginal: false,
  });
});

test('GLB export includes generic skin and bone animation and reimports', async ({ page }) => {
  await page.evaluate(async () => {
    const e = (window as any).__forge, r = (window as any).__rig;
    const rig = r.add();
    const middle = r.addBone();
    middle.position.set(0, 1, 0);
    const end = r.addBone();
    end.position.set(0, 1, 0);
    r.setRestPose();

    e.select(rig);
    const mesh = e.add('sphere');
    mesh.scale.set(0.3, 0.8, 0.3);
    mesh.position.set(0, 1, 0);
    e.commit();
    await r.bindSelected();

    e.select(middle);
    r.keyPose();
    e.frame = 25;
    middle.rotation.z = 0.5;
    r.keyPose();
  });

  const before = await page.evaluate(() => {
    let count = 0;
    (window as any).__forge.content.traverse((o: any) => { if (o.isSkinnedMesh) count++; });
    return count;
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-top').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  const path = await download.path();
  await page.locator('#model-input').setInputFiles(path!);
  await expect(page.locator('#toast')).toContainText('Model imported');

  const after = await page.evaluate(() => {
    let skinned = 0, bones = 0;
    (window as any).__forge.content.traverse((o: any) => {
      if (o.isSkinnedMesh) skinned++;
      if (o.isBone) bones++;
    });
    return { skinned, bones };
  });

  expect(after.skinned).toBe(before + 1);
  expect(after.bones).toBeGreaterThanOrEqual(6);
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
  await page.locator('#rig-add-bone').click();
  await page.locator('#rig-add-bone').click();
  await page.evaluate(() => {
    const e=(window as any).__forge,r=(window as any).__rig;
    const rig=r.activeRig;
    const middle=rig.getObjectByName('Bone');
    middle.rotation.z=0.5;
    rig.updateMatrixWorld(true);
    e.commit();
    e.select(rig);
    e.focus(true);
  });
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
