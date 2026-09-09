# Single-triangle inset

Continue Phase 2 with a positive local-distance inset of one selected triangle.
Move the inner edges inward by the requested distance using the triangle incenter;
preserve the outer boundary and replace the face with an inner cap and six border
triangles. Interpolate UVs and colors, preserve material groups, and retain the cap
selection. Reuse the existing topology replacement and history workflow.

Reject distances at or beyond the inradius, unsupported geometry, and float32
precision collapse before scene mutation. Region inset and polygon faces remain
future work.

Validation: indexed/non-indexed closed topology, winding, constant edge distance,
attribute interpolation, invalid-input preservation, UI repetition, undo/redo,
project round trip, production build and the complete browser test suite.

Status: complete. Production build and all 24 tests pass. Reviewed the rendered
inset UI screenshot; invalid distance leaves the scene unchanged. Existing Vite
main-bundle size warning remains. Changes are local and uncommitted.
