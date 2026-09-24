# Manual Skin Weight Workflow

Date: 2026-09-25

Base: `960631ad00edbd6814d82e0740a6560f2d5ff449`

## Goal

Add the first generic manual skin-weight editing workflow without coupling weight authoring to mesh topology editing or to SOMA77.

## Weight Mode

A bound Forge `SkinnedMesh` can enter a dedicated Weight Mode.

- Reuses existing viewport vertex picking and Shift-click multi-selection.
- Forces vertex-only component selection.
- Keeps TransformControls detached so selecting vertices cannot move geometry.
- Returns the armature to its stored rest pose before editing weights.
- Keeps the selected skinned mesh as the editor selection while the target weight bone is tracked independently.

## Weight operations

For selected vertices:

- **Apply** sets the active bone influence to a value from 0 to 1.
- Remaining influences are rescaled to preserve a normalized total of 1.
- If a new influence needs a slot, an empty slot is used first, otherwise the weakest slot is replaced.
- **Clear bone** sets the active bone influence to zero and redistributes the remainder.
- **Normalize** clamps negative values and renormalizes all four slots; zero-sum vertices fall back to bone 0.
- One-bone skins cannot clear their only influence.

Skin index and weight attributes remain ordinary serializable `BufferAttribute` data, so `.forge`, undo history, GPU skinning and GLB export continue to use the existing substrate.

## Safety boundaries

- Weight Mode requires an existing bound Forge skin.
- It does not alter armature hierarchy, inverse bind matrices or mesh topology.
- Scene-object deletion is blocked while Weight Mode is active.
- Moving/rotating/scaling selected skin vertices is disabled.

## Non-goals

- brush painting / radius falloff
- weight mirroring
- automatic normalization locks
- bone envelopes / heat weighting
- post-bind hierarchy changes
- imported GLB rig adoption

## Windows validation

Validate the exact PR HEAD with:

- `npm run build`
- `npm test -- --workers=2`
- manual Bind mesh → Edit selected skin weights → select vertices → Apply/Clear/Normalize → Done smoke test
