# Armature Bone Delete and Hierarchy Completion

Date: 2026-09-24

Base: `a9d8f1d41be3776190db30f0784a384dff567b44`

## Goal

Complete the first Forge-native rest-skeleton hierarchy editing loop by adding safe bone deletion to the existing Add / Extrude / Reparent workflow.

## Delete semantics

Deleting a selected bone in Armature Edit mode:

- is allowed only for editable native armatures,
- is rejected after skin binding, after bone animation exists, or on preset armatures,
- never allows the final remaining bone to be removed,
- reparents every direct child to the deleted bone's parent,
- preserves child world transforms,
- refreshes each reparented child bone's rest metadata,
- selects the surviving parent or another root after deletion.

This is intentionally non-cascading so a single Delete action does not silently remove an entire articulated branch.

## UI / shortcuts

- Rig panel gets **Delete selected bone**.
- Edit menu Delete and the Delete / Backspace shortcuts route through the same armature deletion behavior when a bone is selected in Armature Edit mode.
- Outside Armature Edit mode the existing object deletion behavior is unchanged.

## Non-goals

- branch/subtree delete
- bone duplication
- post-bind bone remapping
- manual weight editing
- constraints or retargeting

## Windows validation

Validate the exact PR HEAD with:

- `npm run build`
- `npm test -- --workers=2`
- manual Create Armature → Extrude → Delete middle bone → Undo / Redo smoke test
