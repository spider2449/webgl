# Single-edge subdivision

Continue Phase 2 topology editing with Subdivide selected edge. Require exactly
one logical edge in Edit Mode, insert its midpoint and split every incident
triangle into two with preserved winding. Support boundary and two-face manifold
edges; reject non-manifold edges and degenerate/precision-collapsed results.
The result switches to Vertex selection and selects the new welded midpoint.

Preserve existing vertex attributes and interpolate midpoint UV/color values
separately across buffer seams. Recompute normals and remap material groups.
Accept indexed and non-indexed geometry, at most 100k input vertices and 200k
input triangles, standard
position/normal/UV/color layouts, no morph targets or partial draw range. Validate
before swapping the scene geometry and keep existing history/project behavior.

This is one-edge triangle subdivision, not an edge-loop cut or quad reconstruction.
Multi-edge subdivision is implemented in the subsequent
[multi-edge increment](2026-09-09-multi-edge-subdivision.md). Worker execution and
large-mesh benchmarks remain open.

Validate closed oriented cube connectivity, boundary edges, indexed/non-indexed
inputs, seam interpolation, material groups, source immutability, invalid-input
zero effect, real UI edge selection, midpoint movement, undo/redo and project
round trips. Run production build and the complete test suite.

Status: complete. Production build and all 46 tests pass. Six new tests cover
closed oriented indexed/non-indexed cubes, group remapping, boundary edges,
separate UV/color seam interpolation, normalized colors, source immutability,
invalid requests, real viewport edge selection, movable midpoint selection,
nonuniform scale, undo/redo and project restoration. `git diff --check` passes.
The existing Vite bundle-size warning remains. Changes are local and uncommitted.
