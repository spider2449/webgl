# Cut Face foundation

## Goal

Add the first topology-increase operator for Forge's logical polygon model.

Delete reduces logical topology. Cut Face increases it.

Triangle, Quad and N-gon remain equally valid user faces. Cut Face must never force a result into Quads.

## Interaction

Foundation workflow:

1. Enter Edit Mode -> Vertex.
2. Select exactly two non-adjacent logical vertices.
3. Both vertices must lie on exactly one common logical face.
4. RMB -> Cut Face.
5. Forge splits that logical polygon between the two selected boundary vertices.

Adjacent vertices are rejected because they already share a modeling edge.

This is deliberately simpler than a full Knife tool. It establishes the polygon split primitive first.

## Topology semantics

For one logical polygon with ordered boundary vertices:

```
A - B - C
|       |
F - E - D
```

Cutting A -> D produces two new logical polygons following the existing boundary paths:

```
A-B-C-D
A-D-E-F
```

The cut edge becomes one new logical boundary edge shared by both result polygons.

The original polygon is replaced by the two results. Unaffected logical faces keep their existing renderer triangles.

## Renderer behavior

Only the split face region is retessellated.

- no centroid or hidden modeling point is added
- existing boundary attributes are preserved
- result polygons are triangulated independently
- renderer triangles remain implementation-only
- polygonTriangles is regenerated and stored explicitly

A Quad cut across opposite vertices becomes two logical Triangles.

An N-gon can become any valid pair, such as Triangle + Quad. Forge does not attempt Quad-only reconstruction.

## Edit Mode wireframe display

Cut Face is easier to inspect when viewport wireframe shows modeling topology rather than renderer triangulation.

In Edit Mode:

- the mesh surface uses a faint non-wire material
- visible wire comes from logical `polygonEdges`
- Quad renderer diagonals are hidden
- N-gon internal triangulation is hidden
- a Cut Face diagonal appears because it is a real logical edge
- logical edges remain visible in Vertex / Edge / Face component modes

Object Mode wireframe remains unchanged in this PR.

This display change is viewport-only. It does not alter geometry, polygon ownership, normals, snapshots or exports.

## Current limits

- endpoints must already be logical boundary vertices
- exactly two endpoints
- one unambiguous common face
- no edge-intersection point creation yet
- no click-drag knife path
- no cut across multiple faces yet
- no arbitrary surface point insertion yet

## Next expansion

The same polygon split primitive can later support a real Knife workflow:

1. click an edge or face to create a cut point
2. interpolate position / UV / color attributes
3. walk across one or more logical faces
4. split crossed boundaries
5. create Triangle / Quad / N-gon results according to the user's cut path

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Cube -> Vertex Mode -> select two opposite vertices on one face -> RMB -> Cut Face.
2. The Quad becomes two logical Triangles.
3. The new diagonal is selectable as one logical Edge.
4. Undo restores the original Quad.
5. On an N-gon, choose two non-adjacent boundary vertices and verify the result is not forced to Quads.
6. Selecting adjacent vertices must not create duplicate topology.
