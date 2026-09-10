# Connected proportional translation

Continue Phase 2 with an optional Connected only setting for proportional editing.
Use shortest paths along logical topology edges, weighted by local edge length at
drag start, from all selected vertices. Disconnected vertices receive zero weight;
exact coincident seams remain welded. Default distance remains Euclidean.

Compute bounded multi-source Dijkstra distances using a binary min heap, stopping
at the influence radius. Reuse the existing per-drag weight capture, smooth
falloff, translation, undo/redo and project serialization. Settings are session
preferences. Triangle diagonals participate in distance; this is edge-path
distance, not a continuous surface geodesic. Workers and benchmarks remain open.

Validate disconnected islands, folded paths, multiple seeds, seam copies, radius
boundaries, UI setting behavior, drag capture, undo/redo and project round trips.
Run production build and complete Playwright suite.

Status: complete. Production build and all 35 tests pass, including two new
tests covering shortest edge paths, disconnected islands, multiple seeds, seam
copies, radius boundaries, UI toggling, repeated drag updates, reset, nonuniform
scale, undo/redo and project round trips. The existing Vite main-bundle size
warning remains. Changes are local and uncommitted.
