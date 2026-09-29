# Logical Bridge Edge Loops

## Goal

Add a core polygon-native operation that connects two open logical mesh boundary loops with one Quad strip.

Forge already supports:

- deleting faces to create holes;
- filling one boundary loop with one Triangle / Quad / N-gon;
- polygon-native Extrude Region;
- polygon-native Inset Faces.

The missing complementary operation is **Bridge Edge Loops**.

## Interaction

1. Enter Edge Edit Mode.
2. Select every logical edge on exactly two open mesh boundary loops.
3. RMB -> **Bridge Edge Loops**.
4. Forge creates one logical Quad per boundary edge.
5. Forge switches to Face mode and selects the newly created Quad strip.

The operation creates one Undo step.

## Modeling authority

Bridge uses only logical modeling topology:

- `logicalVertices`;
- `polygonEdges`;
- logical Triangle / Quad / N-gon polygons;
- persistent `forgeLogicalVertexIds`;
- stored `polygonTriangles` only as renderer tessellation groups.

Renderer-only diagonals and renderer-only vertices never participate in loop extraction or alignment.

## First-version scope

Both selected loops must:

- be open logical mesh boundary loops;
- be simple and closed;
- be vertex-disjoint;
- contain at least three edges;
- contain the same number of edges.

The total selected edge count is limited to 4096.

Equal edge count is an intentional first-version constraint. Unequal-count bridging requires topology insertion or controlled edge splitting and should be a separate extension.

## Boundary orientation

Every open logical boundary edge is used by exactly one existing logical face.

Suppose one existing boundary use is:

```
A -> B
```

A new manifold face sharing that boundary must traverse it in the opposite direction:

```
B -> A
```

Forge follows the existing winding of the active boundary loop and reverses the traversal order of the second boundary loop.

For paired boundary records:

```
first:   A -> B
second:  C -> D   // existing winding
```

the bridge Quad is constructed as:

```
B, A, D, C
```

so both original boundary edges receive opposite winding in the new face.

## Automatic alignment

Two equal-count loops may start at arbitrary logical vertices.

Forge tests every cyclic offset of the reversed second loop.

For every candidate offset it minimizes:

```
sum(
  distanceSquared(first.A, second.D) +
  distanceSquared(first.B, second.C)
)
```

The lowest-cost offset is selected.

This produces a deterministic shortest correspondence without requiring a user-defined start vertex in the first version.

The algorithm is bounded because the selected edge budget is 4096, so two equal loops contain at most 2048 edges each.

## New Quad strip

For a loop with N edges:

- N new logical Quads are appended;
- no new logical vertices are created;
- the existing boundary vertices are reused;
- each original open boundary edge becomes a two-face manifold edge;
- N new cross-loop logical edges connect the loops.

Each Quad inherits the material of its adjacent boundary face on the active selected loop. Corner attributes are copied independently from the two source loop sides, preserving UV/color seam copies.

The shared polygon-native finish pipeline retessellates each Quad into renderer triangles and validates the final orientation/manifold contract.

## Selection restoration

Before the worker operation, Editor records:

- the existing logical polygon count;
- the number of bridge faces, equal to selectedEdgeCount / 2.

After the polygon-native result is installed:

- Forge switches to Face mode;
- the new consecutive logical face IDs are selected;
- their vertices are highlighted;
- Geometry Statistics reflects the selected Quad strip.

## Default Cube acceptance

Start from a default logical Cube:

```
V8 / E12 / F6 / T12
```

Keep two opposite Quad faces and delete the other four.

The open result is:

```
V8 / E8 / F2 / T4
```

with exactly two 4-edge open boundary loops.

Select all 8 open boundary edges and Bridge Edge Loops.

Expected result:

```
V8 / E12 / F6 / T12
```

with:

- 4 new logical bridge Quads;
- no open logical mesh boundary edges;
- all six logical faces Quads;
- no renderer diagonal exposed as a modeling edge;
- the 4 new side Quads selected;
- `forgePolygonTriangles` and `forgeLogicalVertexIds` persisted;
- one Undo returning to the two-face open mesh.

This reconstructs a closed Cube surface from two caps.

## Rejection

Reject atomically:

- fewer than two complete loops;
- more than two loops;
- loops with fewer than three edges;
- unequal loop edge counts;
- any selected interior/manifold edge;
- open or incomplete chains;
- branched/intersecting selected boundaries;
- boundary loops sharing a logical vertex;
- paired cross-loop vertices that coincide and collapse a bridge side;
- final tessellation, orientation, precision or manifold failure.

## Non-goals

- unequal-count loop bridging;
- automatic edge subdivision to equalize counts;
- user-selected correspondence/start vertices;
- twist/offset controls;
- interpolation count;
- smoothing controls;
- connecting loops across separate objects;
- collision/self-intersection resolution;
- Grid Fill.

These can be added after the equal-count topology contract is stable.

## Windows-local validation

Focused gate:

```powershell
npm run build
npm test -- tests/bridge-edge-loops.spec.ts tests/modeling-core.spec.ts tests/context-menu.spec.ts --workers=2
```

Then:

```powershell
npm run test:modeling -- --workers=2
```

Manual priority:

1. Default Cube -> keep two opposite faces and delete the four side faces.
2. Edge mode -> Select Mesh Boundary; confirm 8 open logical edges.
3. Bridge Edge Loops.
4. Confirm four side Quads are rebuilt and selected.
5. Confirm the Cube is closed and renderer diagonals remain unselectable.
6. Inset or Extrude the selected bridge strip.
7. Ctrl+Z returns to the two-cap open mesh.
8. Try one loop only and confirm rejection.
9. Try two boundaries with different edge counts and confirm rejection.
10. Include one interior edge and confirm rejection with no geometry change.

Final exact-HEAD gate, once only:

```powershell
npm run test:full -- --workers=2
```
