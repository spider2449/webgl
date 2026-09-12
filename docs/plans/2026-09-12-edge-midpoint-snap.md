# Edge midpoint snapping

Extend discrete active-mesh snapping with an Edge midpoint target selector.
Click an edge to translate the unique selected-component centroid to its local
midpoint. Both endpoints must be unselected. Include triangulation diagonals,
preserve welded copies and relative spacing, and ignore grid/proportional settings.
Show edge guides while picking, including in vertex selection mode. Cancel on
Escape, target-kind changes, or mode changes. Invalid targets leave state intact.

Reuse vertex snapping's finite-coordinate validation, history and project path.
Continuous edge projection, surface/other-object targets, topology merging and
collision prevention remain outside this increment.

Validate viewport picking for vertex/edge/face sources, transformed objects,
unchanged targets, cancellation, invalid targets, undo/redo and project round trips.
Run production build, full one-worker browser suite, diff check and screenshot review.
Keep changes uncommitted.

Status: complete (2026-09-12). Production build, all 63 browser tests with one
worker, and `git diff --check` pass. Five new tests cover edge midpoint viewport
picking for all three source modes, non-uniform scale, welded copies, fixed
unselected geometry, history/project restoration, invalid endpoints, cancellation
and Float32 overflow rejection. Reviewed the rendered target selector and edge
guides in `test-results/edge-midpoint-picking.png`. The existing Vite main-bundle
size warning remains. Changes are local and uncommitted.
