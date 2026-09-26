# Single-face Knife foundation

## Goal

Extend Forge Cut Face from existing boundary vertices to arbitrary points on the boundary of one logical face.

This is the next topology-increase step before a multi-face Knife path.

## Interaction

1. Enter Edit Mode -> Face.
2. Select exactly one logical face.
3. RMB -> **Knife** or press **K**.
4. Click the first point on one boundary edge.
5. Click the second point on another boundary edge.
6. Forge inserts boundary vertices where needed and splits the face.
7. Escape cancels without changing project geometry.

The first point is shown as a cyan viewport marker.

## Point picking

Knife raycasts the logical `polygonEdges` overlay, not renderer triangle diagonals.

For each click:

- the hit is projected onto the selected logical edge
- the exact edge parameter `t` in `[0,1]` is retained
- clicks within 3% of an endpoint snap to the existing logical vertex
- arbitrary positions such as `t=0.25` or `t=0.70` remain arbitrary positions

## Shared-edge propagation

A boundary edge may be shared by two logical faces.

If Knife inserts a point in the middle of such an edge, the point must not exist only on the selected face. That would create a modeling T-junction.

Forge therefore:

1. computes the canonical point once from the shared logical edge
2. inserts that same 3D point into every logical polygon using the edge
3. interpolates per-face attributes independently so UV seams and other face-varying data remain valid
4. retessellates every affected neighboring polygon
5. splits the selected face into the two requested result polygons

The new shared point remains one welded logical vertex by position.

## Tessellation

Inserted boundary points are often collinear with the original edge.

The ear-clipping tessellator explicitly prioritizes ears next to those collinear boundary points so they remain represented in renderer triangles instead of surviving until a degenerate final triangle.

No centroid or hidden modeling vertex is introduced.

## Topology example

A Cube face cut between points on two opposite edges:

- selected Quad -> two logical Quads
- the two neighboring faces sharing those edges each become a five-point N-gon
- logical vertices: 8 -> 10
- logical edges: 12 -> 15
- logical faces: 6 -> 7
- renderer triangles: 12 -> 16

This is intentional. A point inserted on a shared modeling edge belongs to both sides of that edge.

## Attribute behavior

New corners interpolate all supported non-normal vertex attributes already carried by the source geometry:

- position
- UV sets
- color

Normals are recomputed for renderer output. Local reference normals are interpolated only to guide surface-aware triangulation.

## Current limits

- one selected logical face
- exactly two Knife endpoints
- endpoints must lie on that face boundary
- no multi-face traversal
- no interior face point as an endpoint
- no continuous multi-segment Knife path yet
- no edge intersection with existing internal cuts yet

## Next expansion

The next Knife stage can reuse this primitive to:

1. continue from the second point into an adjacent face
2. walk across multiple logical faces
3. insert each crossed boundary point consistently on both sides
4. commit an entire polyline cut atomically

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Cube -> Face Mode -> select one face -> K.
2. Click two different boundary edges away from their midpoints.
3. The cut must appear exactly where clicked.
4. Switch to Vertex Mode and verify two new logical vertices.
5. Switch to Edge Mode and verify the new cut edge is selectable.
6. Inspect neighboring faces: the shared-edge points must also belong to those polygons.
7. Wireframe must show only logical edges, not renderer triangulation.
8. Press K, click one point, then Escape; topology and snapshot must remain unchanged.
