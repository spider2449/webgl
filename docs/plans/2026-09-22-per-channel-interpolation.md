# Per-channel animation interpolation

Continue Phase 3 with bounded interpolation overrides for the nine editable scalar transform channels.

## Scope

- Keep the existing object-wide Linear / Constant / Smooth interpolation as the default.
- Add an optional override for each Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z channel.
- Let each channel return to Object default without deleting or rewriting keys.
- Evaluate overrides independently during scrubbing and playback.
- Preserve overrides through undo/redo and Forge project save/load.
- Rotation overrides operate on the unwrapped Euler key metadata and regenerate the evaluated quaternion.
- Setting a Rotation override on legacy quaternion-only keys upgrades those keys to canonical Euler metadata without changing orientation.

## Data model

Overrides are stored in `object.userData.animationChannelInterpolation` as a sparse map from scalar channel name to `linear`, `constant` or `smooth`.

Choosing Linear, Constant or Smooth creates an explicit override even when it currently matches the object default; choosing Object default removes it. This preserves the user's intent if the object default changes later. Projects without this map retain the exact previous behavior. Forge project version remains 1.

Load validation rejects unknown channel names, unknown interpolation modes, Rotation overrides whose keys do not contain Euler rotation metadata, and Rotation overrides across mixed Euler orders.

## GLB export

glTF animation channels target complete translation, rotation and scale values; they cannot assign different interpolation modes to individual X/Y/Z components.

Therefore:

- objects without scalar overrides retain the existing export path,
- object-wide Constant remains native STEP,
- object-wide Smooth remains the established 32-sample LINEAR approximation,
- objects with scalar overrides that differ from the current object default are baked to LINEAR transform samples,
- Smooth overrides use 32 samples per segment,
- Constant overrides add a sample immediately before the next key so the held value changes only across a very narrow boundary interval,
- multi-turn rotation sampling remains bounded by the existing angular-step rule.

Mixed scalar interpolation in GLB is explicitly an approximation, not native per-axis interpolation.

## Validation

Automated coverage checks:

- simultaneous Constant, Smooth and default interpolation on different scalar axes,
- object-default changes while overrides remain stable,
- rotation-channel legacy-key upgrade without orientation drift,
- malformed override maps failing closed,
- undo/redo and project round trips,
- UI channel selection and reset to Object default,
- baked GLB sample count and representative Constant/Smooth values,
- regression preservation of native object-wide STEP and existing Smooth export.

## Limits

This increment does not add Bezier handles, tangent editing, graph visualization, arbitrary F-curves, or per-segment interpolation modes.

This branch is intentionally held for Windows-local build and Playwright validation before merge.
