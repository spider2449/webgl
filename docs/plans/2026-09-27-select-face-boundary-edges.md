# Select Face Boundary Edges

## Goal

Convert the current logical Face selection into the perimeter logical edges of that selected face region.

This is a pure selection workflow. It does not modify geometry.

## Interaction

1. Enter Edit Mode -> Face.
2. Select one or more logical faces.
3. RMB -> **Select Boundary Edges**.
4. Forge switches to Edge mode and selects only the selected region's logical perimeter edges.

The command is available only from Face context.

## Boundary semantics

For every logical polygon boundary edge:

- count how many currently selected logical faces use that edge;
- if exactly one selected face uses it, the edge is part of the selected region boundary;
- if two selected faces share it, it is an interior region edge and is omitted.

Examples on the default Cube:

- one selected face -> 4 boundary edges;
- two adjacent selected faces -> 6 boundary edges;
- all six faces selected -> no boundary because the selected region is the complete closed surface.

Disconnected selected face regions are allowed; the result is the union of each region perimeter.

## Logical-topology authority

The operation only reads:

- `topology.polygons`
- `topology.polygonEdges`

Renderer triangle edges and triangulation diagonals are never candidates.

## Selection/history behavior

- result mode is Edge;
- result selection contains only logical perimeter edge ids;
- selected-edge overlays use the existing validated fat-line selection rendering;
- no geometry mutation;
- no worker job;
- no history commit;
- Undo depth is unchanged;
- changing component mode increments the normal modeling selection version so stale modeling results cannot apply against the new selection.

If the selected faces have no boundary, Forge reports an error and leaves the Face selection unchanged.

## Regression coverage

Pure topology coverage on the default logical Cube verifies:

- one face -> 4 edges;
- two adjacent faces -> 6 edges;
- the shared interior edge is excluded;
- all faces -> empty boundary;
- invalid logical face ids reject.

Real RMB coverage:

- selects two adjacent Cube faces;
- invokes **Select Boundary Edges**;
- verifies mode changes to Edge;
- verifies the exact 6 expected logical edge ids;
- verifies six selected-edge overlay instances;
- verifies Undo depth does not change.

## Non-goals

- mesh-open-boundary selection independent of face selection;
- edge-loop / edge-ring selection;
- shortest path;
- geometry dissolve/extrude/inset;
- automatic region fill.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Cube -> Edit Mode -> Face.
2. Select one face -> Select Boundary Edges: 4 edges.
3. Select two adjacent faces -> Select Boundary Edges: 6 perimeter edges; their shared edge must not be selected.
4. Select all 6 Cube faces -> Select Boundary Edges: command should report no boundary and preserve Face mode/selection.
5. No renderer triangulation diagonal should ever appear selected.
6. Undo should still target the previous geometry edit.
