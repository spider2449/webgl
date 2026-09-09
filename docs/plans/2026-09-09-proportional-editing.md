# Proportional component translation

Continue Phase 2 with optional smooth proportional translation in Edit Mode.
Measure local Euclidean distance to the nearest selected logical vertex; selected
vertices receive full movement and vertices at or beyond the radius remain fixed.
Keep welded seams together. Capture positions and weights once per drag so motion
does not depend on pointer event count and resetting the gizmo restores geometry.
Expose an enable checkbox and positive local radius in the Object panel.

Scope: vertex, edge and triangle selections, existing history/project workflow.
Settings are session preferences. Connected-only falloff, radius overlays,
rotation/scale and topology workers remain future work.

Validation: falloff boundaries, seam equality, invalid radius, multi-event and
repeated drags, nonuniform scale, reset, undo/redo, project round trip, build and
complete browser suite.

Status: complete. Production build and all 28 tests pass, including smooth falloff,
seams, invalid radius recovery, all three component modes, multi-event/repeated
drags, reset, nonuniform scale and history/project restoration. `git diff --check`
passes. The existing Vite main-bundle size warning remains. Changes are local and
uncommitted.
