# Logical polygon topology — first production increment

Date: 2026-09-25

## Goal

Make Forge editing polygon-aware without changing the Three.js/WebGL render substrate.

The user-facing modeling layer should operate on logical vertices, polygon boundary edges, and logical faces. Rendering remains triangulated.

## Authority split

`MeshTopology.faces` and `MeshTopology.edges` remain render-triangle connectivity. Existing geometry workers use these arrays and must not reinterpret their IDs as modeling component IDs.

The modeling layer adds:

- `polygons` — ordered logical face boundaries
- `polygonTriangles` — render triangle IDs owned by each logical face
- `triangleToPolygon` — raycast/render triangle to logical face mapping
- `polygonEdges` — unique logical boundary edges
- `polygonEdgeToEdge` — logical edge to render-edge mapping for legacy triangle workers

Unknown geometry defaults to one render triangle per logical face. Forge does not heuristically merge arbitrary imported triangles.

## Primitive metadata

Native Cube and Plane generators store `geometry.userData.forgePolygonTriangles`.

Each generated grid cell owns its two render triangles, so:

- default Cube: 12 render triangles -> 6 logical quads
- default Cube: 18 render triangle edges -> 12 logical boundary edges
- subdivided Plane: two render triangles per grid quad
- primitive parameter regeneration rebuilds the same logical metadata

The metadata is serialized by Three.js geometry JSON and therefore survives Forge project save/load.

## Viewport behavior

Edit Mode uses logical topology for:

- Edge helper rendering and click selection
- Edge box selection
- Face click selection through `triangleToPolygon`
- Face box selection by logical face centroid
- component movement
- connected proportional editing
- vertex/edge snapping targets
- selected-face overlay (rendered from all triangles owned by the selected polygon)

Render triangulation diagonals of stored quads are not selectable modeling edges.

## Modeling operations

### Polygon-preserving

- vertex/component movement
- UV editing
- planar face/region extrusion

Planar extrusion expands selected logical polygons to their render triangles for geometry processing. Complete source polygon groups retain their IDs, and each new side wall is recorded as a logical quad. Repeated extrusion therefore keeps a quad cap as one modeling face.

### Mapped to legacy triangle workers

Bevel and Loop Cut accept logical boundary-edge selection and map that edge to the corresponding render edge.

Edge subdivision passes logical edge endpoints into the existing triangle subdivision worker.

Topology-changing legacy workers that do not emit polygon metadata may currently fall back to triangle modeling faces afterward. Emitting complete polygon topology from every modeling worker is follow-up work.

### Explicitly not implemented

Quad / n-gon inset is not implemented in this increment. The existing triangle inset remains available for triangle-faced geometry and rejects a stored quad rather than modifying one hidden render triangle.

## Validation targets

Automated coverage should prove:

- Cube and Plane logical quad counts above unchanged render triangle counts
- polygon metadata survives BufferGeometry and Forge project round trips
- malformed polygon metadata safely falls back to triangles
- Cube edit helpers expose 12 boundary edges, not 18 render edges
- clicking either render half selects one quad
- primitive regeneration retains quads
- quad extrusion remains one cap polygon and creates logical quad walls
- triangle inset still works on triangle-faced geometry
- quad inset rejection leaves geometry and selection unchanged
- existing box selection, snap, subdivision, UV, history and project tests use logical component IDs where they model viewport interaction

## Follow-up

Next polygon-native increment: convex quad / n-gon inset, then polygon-preserving subdivision / loop output and broader primitive polygon metadata.
