# Polygon-Native Logical Edge Subdivision

## Goal

Move Edit Mode **Subdivide selected edges** off the renderer-triangle substrate and onto authoritative logical polygon topology.

## Semantics

For every selected logical `polygonEdges` id:

1. validate the logical edge and compute one canonical Float32 midpoint position;
2. reject if that midpoint collapses to an endpoint or already contains any mesh vertex/new midpoint;
3. insert a midpoint corner into every incident logical polygon boundary;
4. interpolate UV/color and other supported corner attributes independently on each polygon side so seams remain seams;
5. preserve the polygon identity and material;
6. retessellate renderer triangles with `finishDetailed()`.

The operation does **not** split a Quad into renderer triangles as modeling faces. A Quad with one subdivided boundary edge becomes one logical five-sided polygon.

## Multiple edges

Multiple selected logical edges are processed atomically. If two selected edges meet at one polygon corner, both midpoint corners are inserted into that same polygon boundary. No result is installed unless the entire worker operation succeeds.

## Result selection

The pre-operation logical edge endpoint positions are retained on the main thread. After topology rebuild, Forge finds the canonical midpoint for each original edge and selects the two replacement logical edge segments.

Selection restoration is position/topology based and does not depend on renderer buffer append order.

## Architecture

- new `subdivideLogicalEdges()` lives beside the other polygon-native modeling operators;
- Edit Mode worker operation `kind: 'subdivide'` now carries logical edge ids plus `polygonTriangles`;
- worker returns persistent logical polygon groups;
- legacy `subdivide.ts` remains for `subdivide-all` and its lower-level API;
- renderer triangulation diagonals are never accepted as Edit Mode subdivision targets.

## Regression coverage

- direct Cube logical-topology test:
  - 6 logical polygons remain 6;
  - one selected edge adds exactly one logical vertex and one logical edge;
  - the two incident Quads become five-sided polygons;
  - renderer triangles rise from 12 to 14 only as tessellation;
  - original edge disappears and two replacement boundary edges exist;
- multiple adjacent logical edges can be subdivided atomically;
- real viewport/worker test verifies:
  - two replacement edges remain selected;
  - stored polygon groups remain 6;
  - polygon sizes are `[4,4,4,4,5,5]`;
  - undo/redo/project round-trip remain intact.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Edge.
2. Select one ordinary Cube boundary edge.
3. Run **Subdivide Edges**.
4. Confirm only that logical boundary edge gains a midpoint and becomes two selected edge segments.
5. Switch to Face mode: the two incident faces should each select as one five-sided logical face, not as exposed renderer triangles.
6. Wireframe should still hide renderer tessellation diagonals.
7. Undo and Redo should restore both topology states cleanly.
