# Component selection to vertex snapping

Continue Phase 2 with an explicit Pick snap target action in Edit Mode. Select
vertices, edges or triangles, arm the action, then click an unselected vertex of
the active mesh. Translate the unique selection centroid to that vertex without
changing the target or unselected geometry. Preserve welded copies, relative
selected positions, existing transforms, undo/redo and project serialization.

Use the existing vertex picking tolerance and through-geometry behavior. Target
picking takes priority over the transform gizmo. Empty/selected-target clicks
retain the pending action; Escape, the action button, mode changes or leaving
Edit Mode cancel it. This discrete operation ignores grid and proportional
settings. It does not merge vertices or provide continuous drag, cross-object,
edge or surface snapping. Coincident vertices may weld on re-entering Edit Mode,
as with existing component translation.

Validate actual viewport target clicks, all component modes, welded seams,
nonuniform transforms, invalid requests with no effect, cancellation, repeat
actions, undo/redo and project restoration. Run build and full browser suite.

Status: complete. Production build and all 40 tests pass. Five new browser tests
cover real target clicks in all component modes, welded copies, nonuniform
transforms, preservation of unselected vertices with grid/proportional enabled,
cancellation, invalid targets, history and project restoration, repeated
multi-vertex snaps with rotation and singular scale, and Float32 overflow
rejection before mutation. `git diff --check` passes. The existing Vite bundle
size warning remains. Changes are local and uncommitted.
