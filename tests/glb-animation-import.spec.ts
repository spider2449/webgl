import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { importAnimationClip } from '../src/animation/animation';

const rad = (degrees: number) => degrees * Math.PI / 180;
const deg = (radians: number) => radians * 180 / Math.PI;

test('GLB vector animation bakes to editable 24 fps scalar tracks', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Cube';
  root.add(target);

  const clip = new THREE.AnimationClip('Move', 1, [
    new THREE.VectorKeyframeTrack(
      'Cube.position',
      [0, 1],
      [0, 0, 0, 12, 6, -3],
      THREE.InterpolateLinear,
    ),
  ]);

  const summary = importAnimationClip(root, clip);
  const tracks = target.userData.animationTracks;

  expect(summary.frameEnd).toBe(25);
  expect(summary.targets).toBe(1);
  expect(summary.sourceTracks).toBe(1);
  expect(summary.scalarKeys).toBe(75);
  expect(summary.firstTarget).toBe(target);

  expect(tracks['position.x']).toHaveLength(25);
  expect(tracks['position.y']).toHaveLength(25);
  expect(tracks['position.z']).toHaveLength(25);
  expect(tracks['position.x'][0]).toEqual({ frame: 1, value: 0 });
  expect(tracks['position.x'][12].frame).toBe(13);
  expect(tracks['position.x'][12].value).toBeCloseTo(6, 6);
  expect(tracks['position.y'][12].value).toBeCloseTo(3, 6);
  expect(tracks['position.z'][24].value).toBeCloseTo(-3, 6);
});

test('GLB STEP interpolation becomes editable constant scalar segments', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Cube';
  root.add(target);

  const clip = new THREE.AnimationClip('ScaleStep', 1, [
    new THREE.VectorKeyframeTrack(
      'Cube.scale',
      [0, 1],
      [1, 1, 1, 2, 3, 4],
      THREE.InterpolateDiscrete,
    ),
  ]);

  importAnimationClip(root, clip);
  const tracks = target.userData.animationTracks;

  expect(tracks['scale.x'][12]).toEqual({ frame: 13, value: 1, interpolation: 'constant' });
  expect(tracks['scale.x'][24]).toEqual({ frame: 25, value: 2, interpolation: 'constant' });
  expect(tracks['scale.y'][24].value).toBe(3);
  expect(tracks['scale.z'][24].value).toBe(4);
});

test('GLB quaternion import keeps a continuous Euler branch across ±180 degrees', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Bone';
  target.rotation.z = rad(170);
  root.add(target);

  const first = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rad(170), 'XYZ'));
  const second = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rad(-170), 'XYZ'));
  const clip = new THREE.AnimationClip('Turn', 1, [
    new THREE.QuaternionKeyframeTrack(
      'Bone.quaternion',
      [0, 1],
      [...first.toArray(), ...second.toArray()],
      THREE.InterpolateLinear,
    ),
  ]);

  importAnimationClip(root, clip);
  const z = target.userData.animationTracks['rotation.z'];

  expect(deg(z[0].value)).toBeCloseTo(170, 5);
  expect(deg(z[12].value)).toBeCloseTo(180, 4);
  expect(deg(z[24].value)).toBeCloseTo(190, 4);
  for (let index = 1; index < z.length; index++) {
    expect(Math.abs(deg(z[index].value - z[index - 1].value))).toBeLessThan(2);
  }
});

test('custom GLB cubic-spline interpolant factories are sampled without calling getInterpolation', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Cube';
  root.add(target);

  const track = new THREE.VectorKeyframeTrack(
    'Cube.position',
    [0, 1],
    [0, 0, 0, 2, 0, 0],
    THREE.InterpolateLinear,
  );
  const baseFactory = track.createInterpolant;
  const customFactory = function (this: THREE.KeyframeTrack, result: any) {
    return baseFactory.call(this, result);
  } as typeof track.createInterpolant & { isInterpolantFactoryMethodGLTFCubicSpline?: boolean };
  customFactory.isInterpolantFactoryMethodGLTFCubicSpline = true;
  track.createInterpolant = customFactory;
  track.getInterpolation = (() => {
    throw new Error('custom interpolant must not call getInterpolation');
  }) as typeof track.getInterpolation;

  const summary = importAnimationClip(root, new THREE.AnimationClip('CubicLike', 1, [track]));

  expect(summary.frameEnd).toBe(25);
  expect(target.userData.animationTracks['position.x'][12].value).toBeCloseTo(1, 6);
});

test('unsupported GLB animation properties reject transactionally', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Face';
  target.userData.animationTracks = {
    'position.x': [{ frame: 1, value: 7 }],
  };
  root.add(target);

  const before = JSON.stringify(target.userData.animationTracks);
  const clip = new THREE.AnimationClip('Morph', 1, [
    new THREE.NumberKeyframeTrack('Face.morphTargetInfluences', [0, 1], [0, 1]),
  ]);

  expect(() => importAnimationClip(root, clip)).toThrow(/morph-target animation/i);
  expect(JSON.stringify(target.userData.animationTracks)).toBe(before);
});

test('ambiguous animated node names reject without mutating either target', () => {
  const root = new THREE.Group();
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  a.name = b.name = 'Duplicate';
  root.add(a, b);

  const clip = new THREE.AnimationClip('Move', 1, [
    new THREE.VectorKeyframeTrack('Duplicate.position', [0, 1], [0, 0, 0, 1, 0, 0]),
  ]);

  expect(() => importAnimationClip(root, clip)).toThrow(/ambiguous/);
  expect(a.userData.animationTracks).toBeUndefined();
  expect(b.userData.animationTracks).toBeUndefined();
});

test('GLB scalar-key budget rejects before animation metadata is written', () => {
  const root = new THREE.Group();
  const target = new THREE.Object3D();
  target.name = 'Cube';
  root.add(target);

  const clip = new THREE.AnimationClip('Long', 10, [
    new THREE.VectorKeyframeTrack('Cube.position', [0, 10], [0, 0, 0, 10, 0, 0]),
  ]);

  expect(() => importAnimationClip(root, clip, { maxScalarKeys: 100 })).toThrow(/scalar keys/);
  expect(target.userData.animationTracks).toBeUndefined();
});

test('Editor model import expands Scene Range and undoes model plus range in one step', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const before = {
      children: e.content.children.length,
      range: e.animationRange,
      historyIndex: e.historyIndex,
    };

    const Group = e.content.constructor;
    const imported = new Group();
    imported.name = 'ImportedAnimatedRoot';
    e.importObject(imported, 600);

    const after = {
      children: e.content.children.length,
      range: e.animationRange,
      historyIndex: e.historyIndex,
      selected: e.selected?.name,
    };

    e.undo();
    const undone = {
      children: e.content.children.length,
      range: e.animationRange,
      historyIndex: e.historyIndex,
      importedStillPresent: Boolean(e.content.getObjectByName('ImportedAnimatedRoot')),
    };

    return { before, after, undone };
  });

  expect(result.after.children).toBe(result.before.children + 1);
  expect(result.after.range).toEqual({ start: 1, end: 600 });
  expect(result.after.historyIndex).toBe(result.before.historyIndex + 1);
  expect(result.after.selected).toBe('ImportedAnimatedRoot');

  expect(result.undone.children).toBe(result.before.children);
  expect(result.undone.range).toEqual(result.before.range);
  expect(result.undone.historyIndex).toBe(result.before.historyIndex);
  expect(result.undone.importedStillPresent).toBe(false);
});

test('single-clip GLB file import produces editable Timeline tracks and selects the animated target', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);

  await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

    const source = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    mesh.name = 'AnimatedCube';
    source.add(mesh);

    const clip = new THREE.AnimationClip('Move', 12, [
      new THREE.VectorKeyframeTrack(
        'AnimatedCube.position',
        [0, 12],
        [0, 0, 0, 12, 0, 0],
      ),
    ]);

    const binary = await new GLTFExporter().parseAsync(source, {
      binary: true,
      animations: [clip],
    }) as ArrayBuffer;

    const file = new File([binary], 'animated.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('#model-input')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#toast')).toContainText('editable animation');

  const result = await page.evaluate(() => {
    const e = (window as any).__forge;
    const selected = e.selected;
    return {
      selected: selected?.name,
      range: e.animationRange,
      frames: selected?.userData.animationTracks?.['position.x']?.map((key: any) => key.frame),
      values: selected?.userData.animationTracks?.['position.x']?.map((key: any) => key.value),
      contentChildren: e.content.children.length,
    };
  });

  expect(result.selected).toBe('AnimatedCube');
  expect(result.range).toEqual({ start: 1, end: 289 });
  expect(result.frames).toHaveLength(289);
  expect(result.frames[0]).toBe(1);
  expect(result.frames.at(-1)).toBe(289);
  expect(result.values[0]).toBeCloseTo(0, 6);
  expect(result.values.at(-1)).toBeCloseTo(12, 5);
  expect(result.contentChildren).toBe(2);

  await expect(page.getByRole('button', { name: 'Animation key at frame 289' })).toBeVisible();
});

test('multi-clip GLB file import rejects without adding a partial model', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__forge?.selected);
  const before = await page.evaluate(() => ({
    children: (window as any).__forge.content.children.length,
    snapshot: (window as any).__forge.snapshot(),
  }));

  await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

    const source = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.name = 'AnimatedCube';
    source.add(mesh);

    const makeClip = (name: string, end: number) => new THREE.AnimationClip(name, 1, [
      new THREE.VectorKeyframeTrack(
        'AnimatedCube.position',
        [0, 1],
        [0, 0, 0, end, 0, 0],
      ),
    ]);

    const binary = await new GLTFExporter().parseAsync(source, {
      binary: true,
      animations: [makeClip('A', 1), makeClip('B', 2)],
    }) as ArrayBuffer;

    const file = new File([binary], 'two-clips.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('#model-input')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#toast')).toContainText('one editable clip at a time');

  const after = await page.evaluate(() => ({
    children: (window as any).__forge.content.children.length,
    snapshot: (window as any).__forge.snapshot(),
  }));
  expect(after).toEqual(before);
});
