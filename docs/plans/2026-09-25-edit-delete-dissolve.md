# Edit Mode logical component delete

## Goal

Make Forge component deletion operate on the user-visible modeling topology rather than treating renderer triangles as the mesh structure.

Triangle, Quad and N-gon are all valid logical faces. There is no rule that user topology must remain Quad-only.

## Two topology layers

### Modeling topology

User-editable:

- logical vertices
- logical boundary edges
- logical polygon faces
- a face may contain 3, 4, 5 or more boundary vertices

### Renderer topology

Implementation-only:

- renderer welded vertices
- triangles
- internal triangulation edges
- internal vertices that may be required to preserve a folded surface

Renderer-only points and edges must not become selectable modeling components.

Three.js / WebGL ultimately renders triangles, so Forge must provide a triangle representation before rendering. This renderer representation does not define the user's face structure.

## Delete semantics

### Delete Vertex

Delete means reduce modeling topology, not delete every incident face.

For an interior manifold logical vertex:

1. Find all logical polygons incident to the vertex.
2. Merge those polygon triangle-ownership groups into one logical region.
3. Preserve the renderer geometry exactly.
4. The deleted vertex may remain internally in renderer triangles when required to preserve the surface.
5. It must disappear from `logicalVertices` and from Vertex Mode picking/display.

If the vertex lies on a boundary and cannot disappear from the logical boundary without changing the surface, the operation is rejected for now.

### Delete Edge

For a manifold edge shared by two logical faces:

1. Merge the two logical polygon ownership groups.
2. Preserve renderer positions, indices, triangles and material groups.
3. Remove the edge from `polygonEdges`.
4. The two faces become one larger logical polygon, including folded/non-planar N-gons.

This is the normal Forge Delete Edge behavior; there is no separate RMB Dissolve Edge command.

### Delete Face

Delete only the selected logical face and its owned renderer triangles.

Unrelated logical faces are not retessellated.

## Examples on a default Cube

Delete one Edge:

- renderer triangles: 12 -> 12
- renderer welded vertices: 8 -> 8
- logical faces: 6 -> 5
- logical edges: 12 -> 11
- result includes one six-boundary-vertex logical N-gon

Delete one corner Vertex:

- renderer triangles: 12 -> 12
- renderer welded vertices: 8 -> 8
- logical vertices: 8 -> 7
- logical faces: 6 -> 4
- logical edges: 12 -> 9
- the old corner may remain renderer-internal but is no longer user-editable

Delete one Face:

- renderer triangles: 12 -> 10
- logical faces: 6 -> 5
- object remains in Edit Mode with an open side

## Editor requirements

- Vertex Mode must display and pick only `logicalVertices`.
- Box selection must ignore renderer-only vertices.
- Vertex snap targets must be logical vertices.
- Transform selection continues to update all renderer buffer copies belonging to one logical vertex.
- Delete / Backspace uses these logical semantics in Edit Mode.
- Object Mode Delete continues to remove objects.

## Future topology increase: Cut Face / Knife

Delete reduces logical topology. A later Cut Face / Knife operator will increase it.

That tool should allow users to intentionally split a logical face into:

- Triangles
- Quads
- N-gons

Forge should not automatically force user topology back to Quads. Renderer triangulation remains a separate implementation layer.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Edge Mode -> select one Cube edge -> Delete. The surface must look unchanged; one modeling edge disappears.
2. Vertex Mode -> select one Cube corner -> Delete. The surface must look unchanged; that point disappears from Vertex Mode.
3. Face Mode -> select one face -> Delete. Only that face opens.
4. Re-enter Edit Mode after all operations and verify Triangle / Quad / N-gon logical faces remain intact.
5. Renderer-only internal vertices or diagonals must not be selectable.
