# Select Edge Ring

## Goal

Add a topology-only Edge selection workflow that follows opposite edges through logical Quads without touching renderer triangulation.

## Interaction

1. Enter Edit Mode -> Edge.
2. Select exactly one logical edge.
3. RMB -> **Select Edge Ring**.
4. Forge replaces the current edge selection with the connected opposite-edge ring/strip.
5. The original seed edge remains the active edge.

This command changes only temporary component selection. It does not modify geometry and does not create an undo-history entry.

## Logical-topology semantics

The traversal lives in `src/modeling/topology.ts`:

- build edge usage from `topology.polygons`;
- start from one `polygonEdges` id;
- for each incident logical Quad, continue through its opposite boundary edge;
- continue breadth-first in both directions across a manifold strip/ring;
- stop at a boundary or a Triangle/N-gon;
- never inspect renderer-only triangle diagonals.

Expected examples:

- default Cube: one edge expands to the four parallel logical edges in its closed ring;
- one logical Plane Quad: one boundary edge expands to itself plus its opposite boundary edge.

## Scope

- pure `logicalEdgeRing()` topology helper;
- Editor selection application;
- Edge RMB **Select Edge Ring** command;
- core Cube/Plane topology regression;
- real RMB selection regression;
- README workflow documentation.

## Non-goals

- Alt-click input (Alt+left remains viewport orbit);
- edge-loop-through-vertices selection;
- selecting through Triangle/N-gon poles;
- geometry changes;
- worker/modeling jobs.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Edge.
2. Select one vertical edge.
3. RMB -> Select Edge Ring.
4. Confirm all four parallel vertical Cube edges are selected and no face diagonal appears.
5. Confirm G/S acts on that selected ring.
6. Undo should still target the previous geometry edit, because ring selection itself is not history.
