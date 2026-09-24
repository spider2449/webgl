# Editable GLB Animation Import

Date: 2026-09-24

## Goal

Import one GLB transform animation clip into Forge's existing scalar animation model so the result is immediately editable in Timeline and Graph Editor.

This package deliberately does not introduce an Action / NLA / multi-clip system.

## Scope

Supported imported transform properties:

- position
- quaternion rotation
- scale

Imported tracks are converted to Forge scalar channels:

- position.x / y / z
- rotation.x / y / z
- scale.x / y / z

## Clip policy

Forge currently has one scene animation timeline rather than an Action stack.

Therefore:

- GLB with zero animation clips imports as a static model.
- GLB with exactly one animation clip imports that clip as editable scalar tracks.
- GLB with more than one animation clip is rejected before the model is added.

Forge does not silently choose the first clip or discard extra clips.

A later Action / clip-management package can remove this restriction.

## Sampling and frame mapping

Forge's animation timeline runs at 24 fps with integer authored frames.

Imported GLB tracks are sampled at 24 fps:

- source time 0 seconds maps to frame 1,
- frame N samples source time (N - 1) / 24,
- the imported Scene End expands to include the final sampled frame.

This creates an editable baked representation of the GLB clip.

LINEAR and cubic-spline-style source interpolation are represented by per-frame linear scalar keys.

STEP source interpolation is represented by per-frame Constant scalar keys.

## Quaternion rotation

glTF rotation animation is quaternion-based while Forge's editable model uses independent unwrapped Euler scalar channels.

Quaternion samples are:

1. normalized,
2. converted using each target object's Euler order,
3. resolved onto the nearest continuous Euler branch from the previous sample.

This preserves a continuous orientation path across ±180° boundaries.

Absolute Euler winding that was already lost in the glTF quaternion representation cannot be reconstructed uniquely.

## Transactionality

Conversion is fail-closed.

Before any target receives Forge animation metadata, the complete clip is validated and converted in temporary maps.

Import rejects:

- unresolved animated node names,
- ambiguous animated node names,
- duplicate tracks for one target/property,
- unsupported animated properties,
- non-finite samples,
- invalid quaternions,
- animation beyond frame 100,000,
- excessive baked scalar-key count.

Morph-target animation is explicitly unsupported rather than silently ignored.

## Key budget

Editable baking is capped at 250,000 generated scalar keys per imported clip.

This prevents long dense rig animation from unexpectedly overwhelming project snapshots and undo history.

The limit can be revisited when Forge gains compressed clip/action storage.

## Scene integration

Model insertion and Scene Frame Range expansion are one editor transaction and one undo entry.

If imported animation extends beyond the current Scene End, Scene End expands to contain it.

Animated import starts at frame 1, so Scene Start becomes 1 when necessary.

Existing Preview Range remains unchanged.

After import, Forge selects the first animated target rather than only the GLB scene root so Timeline / Graph immediately expose imported keys.

## Resource safety

Failed import does not leave a partial scene object.

A GLB root created before validation failure is disposed if it was never added to the scene.

The existing 32 MB file limit and 2 million scene-vertex limit remain in force.

## Validation

Focused tests cover:

1. 24 fps vector-to-scalar baking.
2. STEP to Constant scalar interpolation.
3. continuous quaternion-to-Euler conversion across ±180°.
4. transactional rejection of morph animation.
5. ambiguous node-name rejection.
6. scalar-key budget rejection before mutation.
7. atomic model + Scene Range undo.
8. actual browser GLTFExporter → file input → GLTFLoader single-clip import.
9. automatic animated-target selection.
10. Scene End expansion from imported duration.
11. multi-clip GLB rejection without partial scene mutation.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
