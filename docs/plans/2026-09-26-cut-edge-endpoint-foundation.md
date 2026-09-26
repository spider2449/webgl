# Interactive Knife: logical edge endpoint

## Goal

Take one deliberately bounded step from Cut Face toward Knife: allow a cut to start at one existing logical vertex and end at a clicked point inside an existing logical edge on the same logical face.

This remains a single-face Knife foundation. It does not walk across multiple faces and it does not create arbitrary points inside a face.

## Interaction

1. Enter Edit Mode -> Vertex.
2. Select exactly one logical vertex.
3. Press `K` or use RMB -> Knife.
4. Forge exposes logical `polygonEdges` as the Knife target guides.
5. Click strictly inside a logical edge on the same face as the selected start vertex.
6. Forge creates a true logical vertex at the clicked position and splits the face from the selected vertex to that endpoint.
7. Press `Esc` while waiting for the edge click to cancel.

The clicked endpoint uses the actual picked position along the edge, expressed as `0 < t < 1`; it is not forced to the midpoint.

## Core operation

`cutLogicalFaceToEdge(source, { face, vertex, edge, t }, polygonTriangles)` accepts:

- `face`: one existing logical polygon
- `vertex`: one existing logical boundary vertex on that face
- `edge`: one existing logical boundary edge on that face
- `t`: a strict interior parameter along that edge

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

If `B-C` is shared with another polygon, that neighbor remains one logical face but its boundary is also split at `M`. This preserves manifold logical topology across the shared edge.

Renderer triangles are regenerated as needed. Renderer-only diagonals remain implementation details and stay hidden from Edit Mode wireframe.

## Deliberate limits

- exactly one existing logical start vertex
- endpoint must lie inside an existing logical edge
- start vertex and target edge must define one unambiguous logical face
- no edge-to-edge cut with two new endpoints
- no arbitrary face-interior endpoint
- no multi-face Knife path
- no click-drag/polyline Knife stroke

This is the first interactive Knife step, not unrestricted Knife.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual check:

1. Cube -> Edit Mode -> Vertex.
2. Select one corner vertex.
3. RMB -> Knife or press `K`.
4. Click inside a non-incident logical edge on the same face.
5. Verify the clicked point becomes a real logical vertex and the cut edge is visible in Edit Mode wireframe.
6. Undo must restore the original logical Quad.
