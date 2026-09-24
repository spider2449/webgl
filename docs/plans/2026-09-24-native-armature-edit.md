# Forge-native Armature Edit Workflow

Date: 2026-09-24

Base: `27ebbe8b81b59fe98a9950befc81b78abae41f24`

## Goal

Make the Rigging workspace start from a generic Forge armature rather than SOMA77 and provide the first safe rest-skeleton authoring workflow.

## Authoring model

- **Edit mode** owns the rest skeleton.
- **Pose mode** owns FK/IK posing and animation.
- Bones remain ordinary `THREE.Bone` objects.
- Animation remains the existing scalar `userData.animationTracks` system.
- Project persistence remains ordinary Three.js scene serialization.

A new Forge armature starts with one root bone. Edit mode can add another root, extrude a selected bone, move/rotate rest bones, and reparent a selected bone while preserving its world transform.

## Safety boundary

Rest-skeleton editing is blocked when:
- the armature contains a bound `THREE.SkinnedMesh`, or
- any bone already has authored animation keys, or
- the armature is a preset.

This intentionally avoids implicit skin-index remapping, inverse-bind recalculation and animation retargeting in this package.

## SOMA transition

SOMA77 remains available as an explicit pose-only preset. It is no longer the default armature and generic tests no longer construct native fixtures by trimming a SOMA skeleton.

## Not included

- bone deletion
- weight painting/manual weights
- post-bind topology editing
- persistent IK constraints, pole vectors or joint limits
- editable imported GLB animation
- Timeline/Graph architecture changes

## Windows validation

Validate the exact PR HEAD with:

- `npm run build`
- `npm test -- --workers=2`
- manual Create Armature → Extrude → Reparent → Pose → Key smoke test
- optional SOMA77 preset smoke test
