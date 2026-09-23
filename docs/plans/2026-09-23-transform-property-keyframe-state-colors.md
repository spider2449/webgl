# Transform property keyframe state colors

Add Blender-style visual state feedback to the Object panel's transform fields.

## Scope

- Apply state independently to Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Neutral styling when the selected object has no animation keys.
- Yellow when the current frame is an authored transform key and the displayed value still matches the keyed value.
- Green when the property is animated but the current frame is not a key.
- Orange when the current live value differs from the animation evaluator at the current frame, signaling an unkeyed edit.
- Preserve existing X/Y/Z axis letter colors so animation state does not erase axis identity.
- Update during scrub, playback, gizmo changes, numeric edits, key insertion/removal and project load.

## Data-model boundary

Forge currently authors transform-wide keys: one key contains Position, Rotation and Scale together. Therefore all nine transform channels are considered keyed on an authored key frame. State calculation is still performed independently per scalar channel so a manual edit can turn only the changed field orange.

If Forge later adopts independent per-channel key times, the same UI state mechanism can use channel-specific key existence without changing the visual contract.

## Validation

Playwright coverage verifies:

- unanimated fields report neutral state,
- inserting a transform key marks all transform fields keyed-current,
- scrubbing away marks them animated,
- changing only Location X marks only Location X changed,
- inserting a key at the modified frame returns the fields to keyed-current.

This branch remains unmerged until Windows-local validation is reported.
