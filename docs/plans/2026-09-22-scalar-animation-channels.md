# Scalar animation channel editing

Continue Phase 3 with a bounded first step toward editable animation curves.

## Scope

- Edit one scalar value on an existing transform key.
- Supported channels: Location X/Y/Z and Scale X/Y/Z.
- Keep all unrelated position, quaternion and scale values unchanged.
- Re-evaluate the object immediately at the edited key.
- Preserve the edit through undo/redo, Forge project save/load and GLB export.
- Expose stable Object → Animation controls for channel selection, numeric value editing and explicit apply.
- Reject invalid values, unsupported channels, non-key frames, Edit Mode, playback and missing selection before mutation.

## Data model

No Forge schema change is required. Existing transform keys already store complete position, quaternion and scale arrays. The editor replaces only the selected scalar within the selected key and continues using the established interpolation/export pipeline.

## Validation

Automated coverage checks scalar isolation, midpoint evaluation, undo/redo, project round trips, zero-effect rejection, real UI interaction and downloaded GLB translation data.

## Limits

Rotation remains quaternion-authored and is not exposed as independent scalar channels. Bezier handles, per-channel interpolation modes, tangent editing, graph visualization, batch key operations and arbitrary F-curves remain future work.

This branch is intentionally held for Windows-local build and Playwright validation before merge.
