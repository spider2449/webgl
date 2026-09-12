# Phase 2 modeling core completion

Preserve the existing uncommitted edge midpoint increment. Complete each remaining
modeling-core category with explicit supported inputs and zero-effect rejection.
This is a usable modeling core, not Blender feature parity.

- [x] Geometry snapping: click an active-mesh surface point with unselected target
  corners; preserve local geometry under rotated/non-uniform transforms.
- [x] Bevel: selected sharp edges of closed convex meshes, one flat segment,
  positive local width; reject concave/nonmanifold inputs and excessive widths.
- [x] Loop cut: trace opposite edges through reconstructed planar convex quads,
  split a complete closed ring or boundary-to-boundary strip at its midpoint;
  reject ambiguous/non-quad continuations rather than introduce T junctions.
- [x] Multi-object editing: persistent Shift object selection, shared world-space
  numeric translation/rotation/scale and atomic batch geometry operations.
- [x] Non-destructive modifiers: ordered Mirror/Subdivide/Smooth stack, enable,
  reorder, remove and apply; retain source geometry through save/load/history.
- [x] UV editing: selected triangle UV view, planar projection and numeric
  translation/rotation/scale; split UV seams without tearing logical positions.
- [x] Worker execution: topology-changing UI commands run off the main thread;
  bounded payloads, cancellation, stale-result rejection and atomic installation.
- [x] Large mesh benchmark: reproducible measured worker/round-trip timings and
  main-thread heartbeat at several mesh sizes; record hardware/runtime context.
- [x] Production build, complete one-worker Playwright suite, invalid-input and
  history/project regression coverage, screenshots and `git diff --check`.

All changes remain local and uncommitted. Curved multi-segment bevels, arbitrary
polygon loop inference, sculpting, full unwrap/packing, continuous drag snapping,
and Blender modifier parity are beyond this core implementation.

## Acceptance record (2026-09-12)

Production build and the complete 80-test one-worker browser suite passed.
After improving screenshot framing, the focused worker/UV/modifier UI test also
passed. Reviewed the bevel result, UV canvas and modifier controls in
`test-results/phase2-uv.png` and `test-results/phase2-modifiers.png`.

Coverage includes indexed/expanded closed meshes, adjacent/all-edge bevels,
closed quad rings and open planar strips, unchanged UV geometry, ordered stacks,
source restoration, actual surface clicks under rotated/non-uniform transforms,
Shift object selection, batch rollback-before-install, cancellation and stale
component-selection rejection. Existing extrusion/inset/subdivision UI tests
now await worker completion; viewport locators distinguish the UV canvas.

The reproducible benchmark passed on 10,201 / 40,401 / 90,601 vertices and
20,000 / 80,000 / 180,000 triangles, with three samples per size. See
[benchmark report](../benchmarks/2026-09-12-modeling.md) and its JSON data.
The largest input took 1.69?1.71 seconds round trip and produced 123?129 ms
main-thread heartbeat gaps; serialization/result transfer remain synchronous.

The Vite main-bundle size warning remains. The supported core categories are
complete within the limits above; no full Blender-parity claim is made.
All changes, including the prior edge midpoint increment, remain uncommitted.
