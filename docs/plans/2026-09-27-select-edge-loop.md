# Select Edge Loop

## Goal

Select one continuous logical edge loop, such as the horizontal cycle created by Loop Cut, without selecting opposite Quad edges above or below it.

This replaces the earlier PR #63 ring semantics after manual validation showed that an opposite-edge ring was not the intended workflow.

## Interaction

1. Enter Edit Mode -> Edge.
2. Select exactly one logical edge that belongs to a regular Quad loop.
3. RMB -> **Select Edge Loop**.
4. Forge replaces the current selection with the connected loop.
5. The seed edge remains active.

Selection is temporary editor state only. No geometry changes, worker jobs, or history commits occur.

## Logical-topology rule

At each endpoint of the current edge:

- the vertex must be a regular four-valence logical vertex;
- all four incident logical faces must be Quads;
- among the other three incident logical edges, continue through the unique edge that shares no logical face with the current edge.

This identifies the straight-through topological continuation of a loop without using geometry angles or renderer triangles.

Traversal runs from both ends of the seed edge until it closes or encounters a pole/boundary/non-Quad interruption.

## Expected behavior

After an off-center Loop Cut on the default Cube:

- the four new horizontal logical edges form one loop;
- selecting any one of those edges and running **Select Edge Loop** selects exactly those four edges;
- top and bottom Cube boundary edges stay unselected;
- renderer triangulation diagonals stay unselected.

On the uncut default Cube, a corner edge terminates immediately because Cube corners are three-valence poles.

## Scope

- pure `logicalEdgeLoop()` topology helper;
- Editor selection application;
- Edge RMB **Select Edge Loop** command;
- core regression using the actual polygon-native Loop Cut result;
- real RMB regression that cuts, reduces to one edge, then restores the same four-edge loop;
- README documentation.

## Non-goals

- opposite-edge **Edge Ring** selection;
- Alt-click shortcuts;
- geometry changes;
- worker/modeling jobs;
- traversing through poles or Triangle/N-gon vertices.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> make one Loop Cut around the middle.
2. Click one edge of that new middle loop.
3. RMB -> Select Edge Loop.
4. Confirm only the same-height middle loop is selected.
5. Confirm top/bottom Cube edges and renderer diagonals remain unselected.
6. G/S should operate on the selected middle loop.
