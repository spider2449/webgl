# Forge Studio texture management

Continue Phase 3 after bounded texture painting with local import and export
for the active UV texture. Keep the workflow embedded in the selected
standard material and avoid external URL or shared-library authority.

## Scope

- Import one local PNG, JPEG or WebP image into the selected mesh's UV texture.
- Normalize imported pixels to the existing 256x256 embedded texture canvas.
- Export the active embedded texture as a PNG download.
- Preserve imported pixels through Forge snapshots, history and project load.
- Reject unsupported file types, oversized files, missing UVs and unsupported
  material selections before mutation.

## Acceptance

- [x] Material panel exposes stable import and export controls.
- [x] Import replaces only the selected material texture and leaves geometry,
  topology and UV coordinates unchanged.
- [x] Imported data is embedded and contains no external image URL.
- [x] Export produces a PNG from the active embedded canvas.
- [x] Invalid files have zero effect and valid imports survive history/project
  round trips.
- [x] Production build, complete one-worker browser suite and focused texture
  management tests pass.
- [x] `git diff --check` passes.

## Limits

Images are limited to 8 MiB before decoding and are stretched to a single
256x256 canvas. Multi-texture materials, layered assets, compression controls,
atlas packing and external linked textures are deferred.
