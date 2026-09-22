import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
});

test('rotation gizmo keeps positive turns instead of folding back to ±180 degrees', async ({ page }) => {
  const input = page.locator('[data-transform="rotation"][data-axis="x"]');
  await input.fill('270');
  await input.press('Tab');
  expect(Number(await input.inputValue())).toBeCloseTo(270, 6);

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    e.setTool('rotate');
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    object.rotation.x = -80 * Math.PI / 180;
    e.transform.dispatchEvent({ type: 'objectChange' });
    const during = object.rotation.x * 180 / Math.PI;
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
    return during;
  });

  expect(result).toBeCloseTo(280, 6);
  expect(Number(await input.inputValue())).toBeCloseTo(280, 6);
});

test('rotation gizmo keeps negative turns and unwraps across 180 degrees', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const dragToCanonical = (startDegrees: number, canonicalDegrees: number) => {
      object.rotation.y = startDegrees * Math.PI / 180;
      e.setTool('rotate');
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      object.rotation.y = canonicalDegrees * Math.PI / 180;
      e.transform.dispatchEvent({ type: 'objectChange' });
      const degrees = object.rotation.y * 180 / Math.PI;
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return degrees;
    };
    return {
      negative: dragToCanonical(-270, 80),
      crossing: dragToCanonical(170, -170),
    };
  });

  expect(result.negative).toBeCloseTo(-280, 6);
  expect(result.crossing).toBeCloseTo(190, 6);
});

test('unwrapped gizmo rotation keeps the same quaternion orientation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.rotation.z = 270 * Math.PI / 180;
    e.setTool('rotate');
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    object.rotation.z = -75 * Math.PI / 180;
    const canonical = object.quaternion.toArray();
    e.transform.dispatchEvent({ type: 'objectChange' });
    const unwrapped = object.quaternion.toArray();
    const degrees = object.rotation.z * 180 / Math.PI;
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
    return { canonical, unwrapped, degrees };
  });

  expect(result.degrees).toBeCloseTo(285, 6);
  const dot = result.canonical.reduce((sum: number, value: number, index: number) => sum + value * result.unwrapped[index], 0);
  expect(Math.abs(dot)).toBeCloseTo(1, 10);
});


test('keyframes preserve authored multi-turn rotation through scrub and project reload', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const degrees = (radians: number) => radians * 180 / Math.PI;

    object.rotation.z = 540 * Math.PI / 180;
    e.insertKey();

    e.frame = 25;
    object.rotation.z = 720 * Math.PI / 180;
    e.insertKey();

    const stored = object.userData.keyframes.map((key: any) => key.rotation?.[2] * 180 / Math.PI);

    e.scrub(1);
    const first = degrees(object.rotation.z);
    e.scrub(13);
    const midpoint = degrees(object.rotation.z);
    e.scrub(25);
    const second = degrees(object.rotation.z);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    const restored = e.selected;
    e.scrub(1);
    const reloadedFirst = degrees(restored.rotation.z);
    e.scrub(25);
    const reloadedSecond = degrees(restored.rotation.z);

    return { stored, first, midpoint, second, reloadedFirst, reloadedSecond };
  });

  expect(result.stored[0]).toBeCloseTo(540, 6);
  expect(result.stored[1]).toBeCloseTo(720, 6);
  expect(result.first).toBeCloseTo(540, 6);
  expect(result.midpoint).toBeCloseTo(630, 6);
  expect(result.second).toBeCloseTo(720, 6);
  expect(result.reloadedFirst).toBeCloseTo(540, 6);
  expect(result.reloadedSecond).toBeCloseTo(720, 6);
});

test('legacy quaternion-only keyframes remain readable', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    object.rotation.z = 270 * Math.PI / 180;
    e.insertKey();
    const key = object.userData.keyframes[0];
    delete key.rotation;
    delete key.rotationOrder;
    e.scrub(1);
    return {
      finite: [object.rotation.x, object.rotation.y, object.rotation.z].every(Number.isFinite),
      quaternion: object.quaternion.toArray(),
    };
  });

  expect(result.finite).toBe(true);
  expect(result.quaternion.every((value: number) => Number.isFinite(value))).toBe(true);
});


test('Global gizmo preserves the nearest local Euler branch for multi-axis rotation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;
    object.rotation.set(rad(170), rad(120), rad(30), 'XYZ');
    e.setTool('rotate');
    e.transform.setSpace('world');
    const before = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
    const orientation = object.quaternion.clone();

    e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    object.quaternion.copy(orientation);
    const canonical = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
    e.transform.dispatchEvent({ type: 'objectChange' });
    const after = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
    const finalOrientation = object.quaternion.clone();
    e.transform.dispatchEvent({ type: 'dragging-changed', value: false });

    return {
      before,
      canonical,
      after,
      orientationDot: Math.abs(orientation.dot(finalOrientation)),
    };
  });

  expect(Math.max(...result.canonical.map((value: number, index: number) => Math.abs(value - result.before[index])))).toBeGreaterThan(90);
  result.after.forEach((value: number, index: number) => expect(value).toBeCloseTo(result.before[index], 6));
  expect(result.orientationDot).toBeCloseTo(1, 10);
});

test('Global and Local gizmo drags avoid Euler branch jumps after small quaternion rotations', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;

    const Quaternion = object.quaternion.constructor as any;
    const Vector3 = object.position.constructor as any;
    const run = (space: 'world' | 'local') => {
      object.rotation.set(rad(170), rad(120), rad(30), 'XYZ');
      e.setTool('rotate');
      e.transform.setSpace(space);
      const before = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      const start = object.quaternion.clone();
      const delta = new Quaternion().setFromAxisAngle(
        new Vector3(space === 'world' ? 0 : 1, space === 'world' ? 1 : 0, 0),
        rad(5),
      );
      const target = space === 'world' ? delta.clone().multiply(start) : start.clone().multiply(delta);

      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      object.quaternion.copy(target);
      e.transform.dispatchEvent({ type: 'objectChange' });
      const after = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      const finalOrientation = object.quaternion.clone();
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });

      return {
        before,
        after,
        orientationDot: Math.abs(target.dot(finalOrientation)),
        maxEulerDelta: Math.max(...after.map((value: number, index: number) => Math.abs(value - before[index]))),
      };
    };

    return { global: run('world'), local: run('local') };
  });

  expect(result.global.orientationDot).toBeCloseTo(1, 10);
  expect(result.local.orientationDot).toBeCloseTo(1, 10);
  expect(result.global.maxEulerDelta).toBeLessThan(45);
  expect(result.local.maxEulerDelta).toBeLessThan(45);
});


test('Y-axis gizmo preserves XYZ Euler continuity at 90 and 270 degree singularities in both spaces', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const Quaternion = object.quaternion.constructor as any;
    const Euler = object.rotation.constructor as any;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;

    const run = (space: 'world' | 'local', startY: number, targetY: number) => {
      object.rotation.set(rad(30), rad(startY), rad(20), 'XYZ');
      e.setTool('rotate');
      e.transform.setSpace(space);
      e.transform.axis = 'Y';
      const target = new Quaternion().setFromEuler(new Euler(rad(30), rad(targetY), rad(20), 'XYZ'));
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      object.quaternion.copy(target);
      const canonical = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      e.transform.dispatchEvent({ type: 'objectChange' });
      const after = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      const orientationDot = Math.abs(target.dot(object.quaternion));
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return { canonical, after, orientationDot };
    };

    return {
      global90: run('world', 89, 90),
      local90: run('local', 89, 90),
      global270: run('world', 269, 270),
      local270: run('local', 269, 270),
    };
  });

  for (const sample of Object.values(result)) {
    expect(sample.after[0]).toBeCloseTo(30, 5);
    expect(sample.after[2]).toBeCloseTo(20, 5);
    expect(sample.orientationDot).toBeCloseTo(1, 10);
  }
  expect(result.global90.after[1]).toBeCloseTo(90, 5);
  expect(result.local90.after[1]).toBeCloseTo(90, 5);
  expect(result.global270.after[1]).toBeCloseTo(270, 5);
  expect(result.local270.after[1]).toBeCloseTo(270, 5);
});

test('Y-axis multi-turn keyframes retain authored values and interpolation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const deg = (radians: number) => radians * 180 / Math.PI;

    object.rotation.set(0, 540 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();
    e.frame = 25;
    object.rotation.set(0, 720 * Math.PI / 180, 0, 'XYZ');
    e.insertKey();

    e.scrub(1);
    const first = deg(object.rotation.y);
    e.scrub(13);
    const midpoint = deg(object.rotation.y);
    e.scrub(25);
    const second = deg(object.rotation.y);

    const saved = e.snapshot();
    e.load(JSON.parse(saved));
    e.scrub(13);
    const restoredMidpoint = deg(e.selected.rotation.y);
    return { first, midpoint, second, restoredMidpoint };
  });

  expect(result.first).toBeCloseTo(540, 6);
  expect(result.midpoint).toBeCloseTo(630, 6);
  expect(result.second).toBeCloseTo(720, 6);
  expect(result.restoredMidpoint).toBeCloseTo(630, 6);
});


test('Gimbal orientation edits the selected Euler channel directly across Y lock angles', async ({ page }) => {
  await page.getByLabel('Transform orientation').selectOption('gimbal');
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const Euler = object.rotation.constructor as any;
    const Quaternion = object.quaternion.constructor as any;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;

    const run = (startY: number, delta: number) => {
      object.rotation.set(rad(30), rad(startY), rad(20), 'XYZ');
      e.setTool('rotate');
      e.transform.axis = 'Y';
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });

      // Emulate the canonical quaternion/Euler state TransformControls may produce
      // before Forge handles objectChange. Gimbal mode must ignore that branch.
      const expectedEuler = new Euler(rad(30), rad(startY + delta), rad(20), 'XYZ');
      const expectedQuaternion = new Quaternion().setFromEuler(expectedEuler);
      object.quaternion.copy(expectedQuaternion);
      e.transform.rotationAngle = rad(delta);
      e.transform.dispatchEvent({ type: 'objectChange' });

      const after = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      const orientationDot = Math.abs(expectedQuaternion.dot(object.quaternion));
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return { after, orientationDot };
    };

    return {
      ninety: run(89, 5),
      twoSeventy: run(269, 5),
      multiTurn: run(540, 15),
      orientation: e.transformOrientation,
      space: e.transform.space,
    };
  });

  expect(result.orientation).toBe('gimbal');
  expect(result.space).toBe('local');
  for (const sample of [result.ninety, result.twoSeventy, result.multiTurn]) {
    expect(sample.after[0]).toBeCloseTo(30, 6);
    expect(sample.after[2]).toBeCloseTo(20, 6);
    expect(sample.orientationDot).toBeCloseTo(1, 10);
  }
  expect(result.ninety.after[1]).toBeCloseTo(94, 6);
  expect(result.twoSeventy.after[1]).toBeCloseTo(274, 6);
  expect(result.multiTurn.after[1]).toBeCloseTo(555, 6);
});

test('Gimbal orientation changes only the chosen Euler axis', async ({ page }) => {
  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const rad = (degrees: number) => degrees * Math.PI / 180;
    const deg = (radians: number) => radians * 180 / Math.PI;
    e.setTransformOrientation('gimbal');
    e.setTool('rotate');

    const run = (axis: 'X' | 'Y' | 'Z') => {
      object.rotation.set(rad(15), rad(25), rad(35), 'XYZ');
      e.transform.axis = axis;
      e.transform.dispatchEvent({ type: 'dragging-changed', value: true });
      e.transform.rotationAngle = rad(10);
      e.transform.dispatchEvent({ type: 'objectChange' });
      const values = [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
      e.transform.dispatchEvent({ type: 'dragging-changed', value: false });
      return values;
    };

    return { x: run('X'), y: run('Y'), z: run('Z') };
  });

  expect(result.x).toEqual(expect.arrayContaining([expect.closeTo(25, 5), expect.closeTo(25, 5), expect.closeTo(35, 5)]));
  expect(result.y).toEqual(expect.arrayContaining([expect.closeTo(15, 5), expect.closeTo(35, 5), expect.closeTo(35, 5)]));
  expect(result.z).toEqual(expect.arrayContaining([expect.closeTo(15, 5), expect.closeTo(25, 5), expect.closeTo(45, 5)]));
});
