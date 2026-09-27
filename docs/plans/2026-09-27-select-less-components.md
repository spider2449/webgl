# Select Less — One-Ring Logical Selection Shrink

## Goal

Add **Select Less** to Vertex, Edge and Face Edit modes as the one-ring contraction counterpart to Select More.

## Interaction

Edit Mode -> Vertex / Edge / Face -> select one or more logical components -> RMB -> **Select Less**.

At least one component must already be selected.

## Logical topology semantics

Select Less keeps only selected components whose logical neighbors are also selected.

### Vertex mode

A selected logical vertex remains selected only when every logical vertex connected to it by a `polygonEdge` is selected.

### Edge mode

A selected logical `polygonEdge` remains selected only when every logical edge sharing either endpoint is selected.

### Face mode

A selected logical polygon remains selected only when every edge-adjacent logical polygon is selected.

Open boundaries are not treated as imaginary unselected geometry. Therefore a completely selected closed Cube remains completely selected.

Renderer triangulation diagonals and renderer-only vertices never participate.

## One-ring behavior

The shrink decision is computed from the selection at command start.

Components removed during an invocation do not cause additional removals during that same invocation.

Default Cube round-trip:

- Vertex: 1 -> Select More -> 4 -> Select Less -> 1
- Edge: 1 -> Select More -> 5 -> Select Less -> 1
- Face: 1 -> Select More -> 5 -> Select Less -> 1

A single isolated selected Cube component shrinks to zero because it touches unselected logical neighbors.

A fully selected Cube remains 8 / 12 / 6 because it has no unselected logical neighbor boundary.

## Selection behavior

On success:

- stays in the current component mode;
- removes exactly one selected boundary ring;
- Edge mode preserves the active edge when it survives;
- refreshes transform proxy and overlays;
- refreshes Geometry Statistics;
- does not create an Undo step.

No geometry mutation or modeling-worker job occurs.

## Regression coverage

Pure topology verifies:

- Select More then Select Less returns one Cube seed in Vertex / Edge / Face mode;
- one isolated Cube component shrinks to zero;
- fully selected Cube remains fully selected.

RMB workflow verifies:

- Select Less appears in all three component context menus;
- Select More then Select Less returns selection `[0]`;
- Edge overlay returns to one logical selected segment;
- original active edge remains active;
- Undo depth is unchanged.

## Non-goals

- edge loop or edge ring selection;
- renderer-triangle adjacency;
- geometry mutation;
- automatic outside-of-mesh boundary erosion;
- recursive multi-ring shrink in one invocation.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Cube Vertex mode -> one vertex -> Select More -> Select Less -> original vertex only.
2. Edge mode -> one edge -> Select More -> Select Less -> original edge only.
3. Face mode -> one face -> Select More -> Select Less -> original face only.
4. Start from one selected component and run Select Less directly -> selection clears.
5. Select All on the closed Cube and run Select Less -> full selection remains.
