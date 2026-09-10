# Component multi-selection

Continue Phase 2 with Shift-click toggling of vertices, edges and triangle faces
within the active mesh. Plain click replaces selection; clicking empty space
clears it, while Shift-clicking empty space preserves it. Track component IDs
independently so removing one adjacent edge or face retains shared vertices.
Translate the unique logical vertex union from its centroid, including welded
buffer seams and existing proportional falloff. Clear selection on mode changes.

Extrusion and inset require exactly one selected triangle; their resulting cap
becomes the single selection. Selection is transient; geometry retains existing
undo/redo and project behavior. Multi-object and region topology edits are outside
this increment.

Validation: real pointer selection in all three modes, adjacent component toggles,
empty clicks, centroid and seam movement under nonuniform scale, proportional
movement, single-face guards, mode reset, history/project restoration, production
build and full browser suite.

Status: complete. Production build and all 33 tests pass. Added five tests covering
real Shift-click toggling in all component modes, shared vertices, gizmo priority,
replacement and empty clicks, mode resets, multi-face operation rejection,
centroid translation under nonuniform scale, proportional falloff, welded seams,
undo/redo and project restoration. Updated the existing extrusion test for the
single-triangle requirement message. `git diff --check` passes. The existing Vite
main-bundle size warning remains. Changes are local and uncommitted.
