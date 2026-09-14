# Forge Studio texture painting

Continue Phase 3 with a bounded, local texture-painting workflow built on the
existing UV editor and standard materials. Keep the authored bitmap embedded
in Forge projects and avoid external asset or texture-library authority.

## Scope

- Enable a 256x256 paint texture for the selected mesh when it has UVs.
- Paint a solid-color circular brush stroke in UV canvas space with a bounded
  brush radius.
- Clear the paint texture back to the selected material's base color.
- Show the active paint texture in the Material panel and update the viewport
  on demand while painting.
- Preserve the embedded texture through Forge project save/load and undo/redo.
- Reject missing UVs, invalid colors/radii and unsupported material selections
  before mutation.

## Acceptance

- [x] Material panel exposes stable controls for enabling, painting and
  clearing a texture.
- [x] Painting changes only the selected material texture and leaves mesh
  positions, topology and UV coordinates unchanged.
- [x] Brush coordinates are clamped to the 256x256 canvas and invalid input
  has zero effect.
- [x] Paint data is embedded in project snapshots and restores through
  history and Forge project round trips.
- [x] Production build, complete one-worker browser suite and focused painting
  tests pass.
- [x] `git diff --check` passes.

## Limits

One embedded 256x256 texture per selected standard material is supported.
Multi-layer painting, projection painting, alpha masks,
brush falloff controls, packing and linked/shared texture editing are deferred.
