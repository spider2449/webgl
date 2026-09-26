# Cut endpoint on logical edge

## Goal

Take one deliberately bounded step from Cut Face toward Knife: allow one cut endpoint to be created inside an existing logical edge.

This task adds the topology primitive only. It does not add a viewport Knife gesture, mixed vertex/edge selection, multi-face walking, or arbitrary surface points.

## Operation

`cutLogicalFaceToEdge(source, { face, vertex, edge, t }, polygonTriangles)`:

- `face` is one existing logical polygon.
- `vertex` is an existing logical boundary vertex on that face.
- `edge` is a logical boundary edge on that same face.
- `t` is strictly between 0 and 1 along the edge.

The operation first inserts a real logical vertex on the selected edge, including on the neighboring polygon when that edge is shared. It then splits only the requested face from the existing vertex to the inserted endpoint.

## Attribute semantics

Every renderer corner created at the edge endpoint interpolates the source corner attributes at `t`.

- position is interpolated
- UV sets are interpolated
- vertex color is interpolated
- other already-supported numeric corner attributes follow the same rule
- normals are recomputed after retessellation

The inserted point is not a renderer-only helper. It becomes part of the logical polygon boundary and therefore appears in `logicalVertices` and `polygonEdges`.

## Topology semantics

For a Quad `A-B-C-D`, cutting from `A` to a point `M` inside edge `B-C` produces:

- `A-B-M`
- `A-M-C-D`

If `B-C` is shared with another polygon, that neighbor keeps one logical face but its boundary is also split at `M`. This preserves manifold logical topology across the shared edge.

Renderer triangles are regenerated as needed. Renderer-only diagonals remain implementation details.

## Deliberate limits

This task does not expose the primitive through `modelingJob` yet. The current editor selection model cannot represent a mixed existing-vertex + edge-point Knife gesture without inventing temporary UI semantics. Worker/editor integration should happen together with the first explicit Knife interaction so stored `polygonTriangles`, undo, selection restoration, and exact endpoint placement remain one coherent transaction.

Not included:

- edge-to-edge cuts
- arbitrary point-on-face endpoints
- multi-face Knife paths
- click-drag or polyline Knife UI
- snapping policy for Knife points

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Focused test while iterating:

```powershell
npx playwright test tests/cut-edge-endpoint.spec.ts --workers=1
```

The focused tests verify midpoint topology on a shared Cube edge, arbitrary `t`, interpolated UV/color presence, source immutability, and invalid endpoint rejection.
