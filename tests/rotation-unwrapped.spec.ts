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

    const stored = object.userData.animationTracks['rotation.z'].map((key: any) => key.value * 180 / Math.PI);

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



test('Gimbal renders true XYZ Euler axes and replaces stock rotation controls', async ({ page }) => {
  await page.getByLabel('Transform orientation').selectOption('gimbal');
  await page.evaluate(() => {
    const e = (window as any).__forge;
    e.selected.rotation.set(30 * Math.PI / 180, 60 * Math.PI / 180, 20 * Math.PI / 180, 'XYZ');
    e.setTool('rotate');
    e.gimbal.update();
  });

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const object = e.selected;
    const Vector3 = object.position.constructor as any;
    const Quaternion = object.quaternion.constructor as any;
    const rings = (e.gimbal as any).rings as Map<'X' | 'Y' | 'Z', any>;
    const worldNormal = (axis: 'X' | 'Y' | 'Z') => {
      const ring = rings.get(axis)!;
      return new Vector3(0, 0, 1).applyQuaternion(ring.getWorldQuaternion(new Quaternion())).normalize();
    };

    const x = worldNormal('X'), y = worldNormal('Y'), z = worldNormal('Z');
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), object.rotation.x);
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), object.rotation.y);
    const expectedY = new Vector3(0, 1, 0).applyQuaternion(qx).normalize();
    const expectedZ = new Vector3(0, 0, 1).applyQuaternion(qx.clone().multiply(qy)).normalize();

    return {
      visible: e.gimbal.group.visible,
      stockAttached: !!e.transform.object,
      xDotY: x.dot(y),
      xDotZ: x.dot(z),
      yMatch: y.dot(expectedY),
      zMatch: z.dot(expectedZ),
    };
  });

  expect(result.visible).toBe(true);
  expect(result.stockAttached).toBe(false);
  expect(Math.abs(result.xDotY)).toBeLessThan(1e-6);
  expect(Math.abs(result.xDotZ)).toBeGreaterThan(0.5);
  expect(result.yMatch).toBeCloseTo(1, 6);
  expect(result.zMatch).toBeCloseTo(1, 6);
});

test('dragging the real Gimbal Y ring changes only Euler Y across lock angles', async ({ page }) => {
  await page.getByLabel('Transform orientation').selectOption('gimbal');

  const dragY = async (startY: number) => {
    const points = await page.evaluate((degrees) => {
      const e = (window as any).__forge;
      const object = e.selected;
      object.rotation.set(30 * Math.PI / 180, degrees * Math.PI / 180, 20 * Math.PI / 180, 'XYZ');
      e.setTool('rotate');
      e.gimbal.update();

      const ring = ((e.gimbal as any).rings as Map<string, any>).get('Y');
      const position = ring.geometry.getAttribute('position');
      const Vector3 = object.position.constructor as any;
      const project = (index: number) => {
        const point = new Vector3().fromBufferAttribute(position, index);
        ring.localToWorld(point);
        point.project(e.camera);
        const rect = e.renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + (point.x + 1) * rect.width / 2,
          y: rect.top + (1 - point.y) * rect.height / 2,
        };
      };
      return { start: project(0), end: project(4) };
    }, startY);

    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
    await page.mouse.up();

    return page.evaluate(() => {
      const object = (window as any).__forge.selected;
      const deg = (radians: number) => radians * 180 / Math.PI;
      return [deg(object.rotation.x), deg(object.rotation.y), deg(object.rotation.z)];
    });
  };

  const ninety = await dragY(89);
  expect(ninety[0]).toBeCloseTo(30, 3);
  expect(ninety[1]).toBeGreaterThan(90);
  expect(ninety[2]).toBeCloseTo(20, 3);

  const twoSeventy = await dragY(269);
  expect(twoSeventy[0]).toBeCloseTo(30, 3);
  expect(twoSeventy[1]).toBeGreaterThan(270);
  expect(twoSeventy[2]).toBeCloseTo(20, 3);

  const multiTurn = await dragY(540);
  expect(multiTurn[0]).toBeCloseTo(30, 3);
  expect(multiTurn[1]).toBeGreaterThan(540);
  expect(multiTurn[2]).toBeCloseTo(20, 3);
});
