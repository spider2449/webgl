# Rotation animation channel editing

Extend the bounded Phase 3 scalar-key workflow to rotation now that transform keys can retain unwrapped Euler rotation alongside quaternion orientation.

## Scope

- Add Rotation X/Y/Z to Object → Animation → Channel.
- Display and edit rotation values in degrees.
- Modify only the chosen Euler component on the selected existing key.
- Preserve the other rotation components, position, scale, frame and interpolation mode.
- Regenerate the key quaternion from the edited Euler triple and stored rotation order.
- Re-evaluate the selected key immediately.
- Preserve edits through undo/redo and Forge project save/load.
- Keep multi-turn values such as 270°, 540° and 720° instead of normalizing them to ±180°.

## Compatibility

Newer keys already contain optional `rotation` and `rotationOrder` metadata from the continuous-rotation work. No Forge project version change is required.

For a legacy quaternion-only key, the first rotation-channel edit derives a canonical Euler triple using XYZ order, applies the requested component, then stores both the Euler metadata and synchronized quaternion. Historical turn counts cannot be recovered from quaternion-only data.

## Export

Rotation-channel edits always regenerate the stored quaternion. The existing animation sampling/export path therefore receives consistent Euler and quaternion representations. Multi-turn segments continue to use the established intermediate quaternion sampling when needed.

## Validation

Focused coverage checks:

- independent X/Y/Z rotation editing,
- 270° → 720° multi-turn values,
- synchronized quaternion orientation,
- midpoint Euler interpolation,
- undo/redo,
- Forge save/load,
- legacy quaternion-only key upgrade,
- UI degree display and application,
- existing invalid-channel and Location/Scale behavior.

## Limits

This increment edits scalar values on existing transform keys. It is not a graph editor. Bezier handles, tangent manipulation, per-channel interpolation modes, batch curve operations and arbitrary F-curves remain future work.

This branch is intentionally held for Windows-local build and Playwright validation before merge.
