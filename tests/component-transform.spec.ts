import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

for (const mode of ['vertex', 'edge', 'face'] as const) {
  test(`${mode} selection rotates around its component pivot without changing the object transform`, async ({ page }) => {
    const result = await page.evaluate(mode => {
      const e = (window as any).__forge, mesh = e.selected;
      mesh.rotation.set(0.25, -0.4, 0.15);
      mesh.scale.set(1, 1, 1);
      e.commit();
      e.setEditMode(true);
      e.setComponentMode(mode);
      if (mode === 'vertex') {
        e.selectComponent(0);
        e.selectComponent(1, true);
      } else e.selectComponent(0);

      const position = mesh.geometry.getAttribute('position');
      const before = Array.from(position.array) as number[];
      const selected = [...new Set(e.vertexIndices)] as number[];
      const center = e.componentCenter.toArray() as number[];
      const objectBefore = {
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
      };

      e.setTransformOrientation('local');
      e.setTool('rotate');
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      e.vertexProxy.rotateZ(Math.PI / 2);
      e.transform.dispatchEvent({ type: 'objectChange' });
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });

      const after = Array.from(position.array) as number[];
      const proxyScale = e.vertexProxy.scale.toArray();
      const transformMode = e.transform.mode;
      const objectAfter = {
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
      };
      const saved = e.snapshot();
      e.undo();
      const undone = Array.from(e.selected.geometry.getAttribute('position').array);
      e.redo();
      const redone = Array.from(e.selected.geometry.getAttribute('position').array);
      e.load(JSON.parse(saved));
      return {
        before, after, selected, center, objectBefore, objectAfter,
        proxyScale, transformMode, undone, redone,
        restored: Array.from(e.selected.geometry.getAttribute('position').array),
      };
    }, mode);

    const selected = new Set(result.selected);
    for (let i = 0; i < result.before.length / 3; i++) {
      const x = result.before[i * 3], y = result.before[i * 3 + 1], z = result.before[i * 3 + 2];
      if (selected.has(i)) {
        const dx = x - result.center[0], dy = y - result.center[1];
        expect(result.after[i * 3]).toBeCloseTo(result.center[0] - dy, 5);
        expect(result.after[i * 3 + 1]).toBeCloseTo(result.center[1] + dx, 5);
        expect(result.after[i * 3 + 2]).toBeCloseTo(z, 5);
      } else {
        expect(result.after[i * 3]).toBeCloseTo(x, 6);
        expect(result.after[i * 3 + 1]).toBeCloseTo(y, 6);
        expect(result.after[i * 3 + 2]).toBeCloseTo(z, 6);
      }
    }
    expect(result.objectAfter).toEqual(result.objectBefore);
    expect(result.transformMode).toBe('rotate');
    expect(result.proxyScale).toEqual([1, 1, 1]);
    result.undone.forEach((value: number, i: number) => expect(value).toBeCloseTo(result.before[i], 6));
    result.redone.forEach((value: number, i: number) => expect(value).toBeCloseTo(result.after[i], 6));
    result.restored.forEach((value: number, i: number) => expect(value).toBeCloseTo(result.after[i], 6));
  });

  test(`${mode} selection scales around its component pivot without changing the object transform`, async ({ page }) => {
    const result = await page.evaluate(mode => {
      const e = (window as any).__forge, mesh = e.selected;
      mesh.rotation.set(-0.2, 0.35, 0.1);
      mesh.scale.set(1, 1, 1);
      e.commit();
      e.setEditMode(true);
      e.setComponentMode(mode);
      if (mode === 'vertex') {
        e.selectComponent(0);
        e.selectComponent(1, true);
      } else e.selectComponent(0);

      const position = mesh.geometry.getAttribute('position');
      const before = Array.from(position.array) as number[];
      const selected = [...new Set(e.vertexIndices)] as number[];
      const center = e.componentCenter.toArray() as number[];
      const objectBefore = {
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
      };

      e.setTransformOrientation('local');
      e.setTool('scale');
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      e.vertexProxy.scale.set(1.5, 0.5, 2);
      e.transform.dispatchEvent({ type: 'objectChange' });
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });

      return {
        before,
        after: Array.from(position.array) as number[],
        selected,
        center,
        objectBefore,
        objectAfter: {
          position: mesh.position.toArray(),
          quaternion: mesh.quaternion.toArray(),
          scale: mesh.scale.toArray(),
        },
        proxyScale: e.vertexProxy.scale.toArray(),
        transformMode: e.transform.mode,
      };
    }, mode);

    const selected = new Set(result.selected);
    const factors = [1.5, 0.5, 2];
    for (let i = 0; i < result.before.length / 3; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = result.before[i * 3 + axis];
        const expectedValue = selected.has(i)
          ? result.center[axis] + (value - result.center[axis]) * factors[axis]
          : value;
        expect(result.after[i * 3 + axis]).toBeCloseTo(expectedValue, 5);
      }
    }
    expect(result.objectAfter).toEqual(result.objectBefore);
    expect(result.transformMode).toBe('scale');
    expect(result.proxyScale).toEqual([1, 1, 1]);
  });
}

test('G R S shortcuts switch the selected component gizmo between translate rotate and scale', async ({ page }) => {
  await page.locator('#mode').selectOption('edit');
  const componentMode = page.getByLabel('Mesh component');
  await componentMode.selectOption('face');
  await page.evaluate(() => (window as any).__forge.selectComponent(0));
  // Viewport shortcuts intentionally do not fire while a form control owns
  // keyboard focus. Blur the mode select to model normal viewport interaction.
  await componentMode.evaluate((element: HTMLSelectElement) => element.blur());

  await page.keyboard.press('r');
  expect(await page.evaluate(() => ({
    mode: (window as any).__forge.transform.mode,
    toast: document.querySelector('#toast')?.textContent ?? '',
  }))).toMatchObject({ mode: 'rotate' });
  await page.keyboard.press('s');
  expect(await page.evaluate(() => (window as any).__forge.transform.mode)).toBe('scale');
  await page.keyboard.press('g');
  expect(await page.evaluate(() => (window as any).__forge.transform.mode)).toBe('translate');
});

for (const tool of ['rotate', 'scale'] as const) {
  test(`proportional ${tool} affects nearby unselected vertices and preserves the selected pivot`, async ({ page }) => {
    const result = await page.evaluate(tool => {
      const e = (window as any).__forge, mesh = e.selected;
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      e.commit();
      e.setEditMode(true);
      e.setComponentMode('vertex');
      e.selectComponent(0);
      e.setProportionalEditing(true, 3, false);
      const position = mesh.geometry.getAttribute('position');
      const before = Array.from(position.array) as number[];
      const selected = [...new Set(e.vertexIndices)] as number[];
      e.setTool(tool);
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      if (tool === 'rotate') e.vertexProxy.rotateZ(Math.PI / 4);
      else e.vertexProxy.scale.setScalar(1.5);
      e.transform.dispatchEvent({ type: 'objectChange' });
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return { before, after: Array.from(position.array) as number[], selected };
    }, tool);

    const selected = new Set(result.selected);
    for (const index of selected) {
      for (let axis = 0; axis < 3; axis++) {
        expect(result.after[index * 3 + axis]).toBeCloseTo(result.before[index * 3 + axis], 6);
      }
    }
    expect(result.after.some((value: number, i: number) =>
      !selected.has(Math.floor(i / 3)) && Math.abs(value - result.before[i]) > 1e-6
    )).toBe(true);
  });
}
