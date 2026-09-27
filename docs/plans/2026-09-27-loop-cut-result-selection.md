# Loop Cut Result Selection

## Goal

Keep the newly created logical loop selected after a successful polygon-native Loop Cut so the next modeling action can immediately move, scale, or otherwise edit that loop.

## Behavior

- Loop Cut still runs through the worker and rebuilds authoritative logical topology from stored polygon groups.
- Before the operation, Forge records the positions of the current logical vertices.
- After topology rebuild, logical vertices whose positions did not exist before the cut are treated as this operation's inserted vertices.
- Only logical `polygonEdges` whose two endpoints are inserted vertices become selected.
- Renderer triangulation diagonals are never considered because selection is derived only from `polygonEdges`.
- Edge mode remains active.
- The resulting selection is temporary editor state; geometry/history semantics are unchanged.

For a default Cube ring cut, the expected result is four new logical vertices and four selected logical loop edges.

## Scope

- Edit Mode result-selection restoration in `Editor.runModeling`
- viewport/worker regression on the existing positioned Loop Cut path
- no change to Loop Cut geometry generation
- no change to undo/redo snapshots

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Edge.
2. Select one edge and run Loop Cut at an off-center position such as 0.3.
3. Confirm the four newly created loop edges are visibly selected.
4. Press G or S and confirm the selected loop is immediately editable without reselecting it.
5. Undo and confirm the pre-cut geometry returns.
