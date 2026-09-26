# Edit Mode logical component delete

## Goal

Make Forge component deletion rebuild the affected user face topology instead of merely hiding modeling components while old renderer triangles keep using them.

Triangle, Quad and N-gon are all first-class user faces. There is no rule that user topology must remain Quad-only.

## Two topology layers

### Modeling topology

User-editable:

- logical vertices
- logical boundary edges
- logical polygon faces
- a face may contain 3, 4, 5 or more boundary vertices

### Renderer topology

Implementation-only:

- welded renderer vertices
- triangles
- triangulation diagonals

Three.js / WebGL ultimately consumes triangles, so Forge generates a triangle representation before rendering. That representation must be regenerated when a point or edge deletion changes a logical face boundary.

## Surface-aware retessellation

Affected logical faces are rebuilt from their remaining 3D boundary vertices.

The renderer triangulation algorithm:

1. Computes a Newell normal from the new polygon boundary.
2. Builds an orthonormal projection plane perpendicular to that normal.
3. Ear-clips the projected polygon using only existing boundary vertices.
4. Uses the original renderer-triangle normals around each boundary vertex as local reference normals.
5. Prefers candidate triangles whose 3D normals continue the previous surface orientation.
6. Uses triangle quality as a secondary tie-breaker.
7. Never creates a centroid or other hidden modeling point.
8. When an Edge is deleted, the old edge is marked as a forbidden diagonal so triangulation cannot silently recreate it.

Unaffected logical faces retain their existing renderer triangle connectivity.

## Delete Vertex

For every logical face that uses the selected vertex:

1. Remove that point from the face boundary.
2. If at least three boundary points remain, retessellate that face.
3. If fewer than three remain, that face disappears.
4. The deleted coordinate must no longer exist in the rebuilt affected renderer faces.

Example: a five-point face with an extra point along one side becomes a four-point face and is freshly triangulated from those four remaining boundary points.

A Cube corner currently turns the three incident Quads into three Triangles. The opposite three Quads are untouched.

## Delete Edge

For a manifold logical edge:

1. Merge the two adjacent logical face boundaries.
2. Remove the selected edge from the merged boundary.
3. Retessellate that merged 3D polygon.
4. Forbid the deleted edge from being selected again as a renderer diagonal.

Multiple selected manifold edges merge their connected logical face regions before retessellation.

## Delete Face

Delete only the selected logical face and its renderer triangles.

Unrelated logical faces retain their existing renderer triangles.

## Editor requirements

- Vertex Mode exposes only true logical boundary vertices.
- Renderer-only triangulation vertices are not selectable.
- Box selection ignores renderer-only points.
- Vertex snap targets are logical vertices.
- Delete / Backspace uses these logical semantics in Edit Mode.
- Object Mode Delete continues to remove objects.

## Viewport face display

Backface visibility is a viewport concern, not project material authoring.

Forge exposes:

- **Double-Sided** — default modeling display; front and back faces are visible.
- **Front Only** — backface culling is enabled so winding / normal problems are easier to diagnose.

The mode applies consistently to Material, Solid and Wire shading.

Changing this mode must not change:

- project snapshots
- authored material `side`
- mesh topology
- normals
- exported geometry

The editor temporarily overrides material side for viewport rendering and restores authored values during serialization.

## Future topology increase: Cut Face / Knife

Delete reduces topology. Cut Face / Knife will increase it.

Users must be able to intentionally split a logical face into:

- Triangles
- Quads
- N-gons

Forge must not automatically force user topology into Quads. Renderer triangulation remains a separate implementation layer.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. On a face with an intermediate boundary point, Delete Vertex removes the point and visibly redistributes renderer diagonals across the remaining face.
2. Cube Edge Mode -> Delete one edge. The two logical faces merge and the old line must not survive as a renderer diagonal.
3. Cube Face Mode -> Delete one face. Only that face opens.
4. Unaffected faces must not have their renderer diagonals rearranged.
5. Re-enter Edit Mode and verify Triangle / Quad / N-gon faces remain user-editable as polygons.
