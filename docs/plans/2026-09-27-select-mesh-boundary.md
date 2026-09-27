# Select Open Logical Mesh Boundary

## Goal

Add an Edge-mode **Select Mesh Boundary** command that selects the true open boundary of the logical modeling surface.

This is different from Face-mode **Select Boundary Edges**:

- Select Mesh Boundary considers the complete logical mesh;
- Select Boundary Edges considers only the currently selected face region.

## Interaction

Edit Mode -> Edge -> RMB -> **Select Mesh Boundary**.

No current edge selection is required.

## Boundary semantics

A logical polygon edge is an open mesh boundary when it is used by exactly one logical polygon.

Implementation reuses the established face-region boundary helper over the complete logical face set:

```
logicalFaceBoundaryEdges(topology, all logical faces)
```

This gives:

- one logical Quad plane -> 4 boundary edges;
- two adjacent logical Quads -> 6 perimeter edges;
- closed Cube -> 0 boundary edges.

Edges used by two logical polygons are interior and omitted.

Renderer triangulation diagonals are never in the `polygonEdges` universe and therefore can never become mesh-boundary selections.

## Selection behavior

On success:

- component mode remains Edge;
- current edge selection is replaced by all open logical boundary edges;
- existing fat-line selected-edge overlay renders the result;
- final boundary edge in topology order becomes the active edge under the existing convention;
- transform proxy updates from the boundary vertices;
- `component-selection` emits, so Geometry Statistics refresh immediately.

On a closed logical mesh:

- the command reports `Mesh has no open logical boundary edges.`;
- current Edge selection is preserved;
- mode is preserved;
- Undo history is unchanged.

## History and authority

This is selection-only state:

- no geometry mutation;
- no modeling worker;
- no history snapshot;
- no Undo depth change;
- modeling selection version increments only when a successful new boundary selection is installed.

## Regression coverage

### Pure topology

- one logical Plane Quad -> 4 boundary edges;
- two adjacent Plane Quads -> 6 boundary edges;
- shared interior edge is excluded;
- closed logical Cube -> empty boundary.

### Real RMB workflow

Plane:

- add Plane through the normal Add menu;
- enter Edge Edit Mode;
- Select Mesh Boundary -> 4 selected logical edges;
- orange fat-line overlay -> 4 instances;
- active edge -> final topology edge;
- Geometry Statistics SELECTED -> `Obj 1 · V 4 · E 4 · F 1 · T 2`;
- Undo depth unchanged.

Cube:

- start with one selected logical Cube edge;
- Select Mesh Boundary reports no open boundary;
- Edge mode remains active;
- original edge selection remains unchanged;
- Undo depth unchanged.

## Non-goals

- region boundary from selected faces (already provided separately);
- non-manifold diagnostics beyond the usage==1 boundary rule;
- geometric sharp-edge selection;
- edge loop/ring selection;
- selection shortcut.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Add Plane -> Edit Mode -> Edge -> Select Mesh Boundary: all 4 logical outer edges select.
2. Geometry Statistics SELECTED should read Obj 1 / V 4 / E 4 / F 1 / T 2.
3. Create or use two adjacent open Quads: only the 6 perimeter edges should select, not their shared edge.
4. Default closed Cube -> select one edge -> Select Mesh Boundary: report no open boundary and preserve that original edge selection.
5. No renderer triangulation diagonal should ever appear selected.
