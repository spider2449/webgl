# Multi-edge subdivision

Extend edge subdivision to the entire selected edge set in one atomic operation.
Deduplicate logical edges, insert one logical midpoint per edge with separate
buffer copies at attribute seams, and split triangles with one, two or three
selected edges into two, three or four oriented triangles respectively. Process
faces in source order so output is independent of selection order.

Preserve material groups and interpolate UV/color data. Select all new logical
midpoints in Vertex mode. Keep the existing 100k input-vertex / 200k input-triangle
limits and enforce the scene vertex budget before installing the result. Reject
the whole operation if any requested edge fails existing manifold/precision
checks, including collisions between newly created midpoints.

This remains triangle subdivision; loop traversal, quad reconstruction, workers
and large-mesh benchmarks are outside this increment.

Validate all seven nonempty triangle edge masks, closed indexed/non-indexed cube
subdivision, shared midpoint seams, deterministic selection order, duplicate
requests, partial-invalid zero effect, real Shift-click selection, midpoint group
movement, undo/redo and project restoration. Run build and full browser suite.

Status: complete. Production build and all 51 tests pass. Five new tests cover
all seven triangle masks, closed indexed/non-indexed cube subdivision, winding,
area, UV interpolation, material groups, deterministic reversed/duplicate
requests, midpoint collisions, partial-invalid zero effect, actual Shift-click
selection, scene-budget rejection, midpoint group translation, undo/redo and
project restoration. Existing single-edge coverage still passes; the previous
multi-selection rejection test now checks an empty edge selection.
`git diff --check` passes. The existing Vite bundle-size warning remains.
Changes are local and uncommitted.
