# Loop Cut Position

## Goal

Extend the polygon-native Loop Cut so one selected logical quad-ring edge can cut at a retained numeric position instead of always using the 50% midpoint.

This is a bounded pre-operation parameter, not a Blender-style post-cut modal slide.

## Interaction

- Edge mode -> select exactly one logical quad boundary edge.
- RMB -> Loop Cut.
- Set **Loop Position** from `0.01` to `0.99`.
- `0.5` preserves the existing midpoint behavior.
- Press Enter in the numeric field or click **Loop Cut** to run the worker operation.
- The value is a session tool setting and remains available for the next Loop Cut.

## Topology semantics

Logical polygon boundaries are consistently oriented, so adjacent manifold polygons traverse the same shared edge in opposite directions.

A midpoint hides that fact because `0.5 === 1 - 0.5`. Off-center cuts must therefore carry their factor through the ring with edge-orientation awareness:

1. store each traversed physical edge in canonical min->max logical-vertex order;
2. convert the canonical factor into the current face's directed boundary orientation;
3. invert it on the opposite quad edge because that boundary edge runs in the reverse direction around the face;
4. convert that opposite point back into canonical edge orientation before crossing into the neighboring face.

This guarantees both sides of a shared logical edge generate the same split vertex and prevents cracks.

## Scope

- polygon-native `loopCutLogicalEdge`
- modeling worker operation payload
- RMB Loop Position numeric + range control
- core topology regression at an off-center factor, including one common cut plane for all four new Cube loop vertices
- viewport/worker regression proving the configured factor reaches the final logical topology and does not zig-zag across faces

## Deliberate limits

- one cut per invocation
- exactly one selected logical edge
- quad rings only
- no interactive post-operation mouse slide
- no multiple parallel loop cuts
- no triangle/n-gon continuation

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Edge.
2. Select one logical edge.
3. RMB -> Loop Cut.
4. Change Loop Position to `0.25`.
5. Run Loop Cut.
6. Confirm the ring is visibly off-center, horizontal/planar across the Cube, and remains closed across all affected faces.
7. Undo.
8. Repeat with `0.75`; confirm the cut moves to the complementary side.
9. Re-enter Edit Mode and confirm all resulting faces are logical quads and renderer diagonals remain non-selectable.
