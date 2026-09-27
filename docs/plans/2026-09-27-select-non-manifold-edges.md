# Select Logical Non-Manifold Edges

## Goal

Add an Edge-mode **Select Non-Manifold Edges** command that identifies logical polygon edges whose face-use count is not the manifold value of two.

This is a topology diagnostic and selection-only workflow.

## Interaction

Edit Mode -> Edge -> RMB -> **Select Non-Manifold Edges**.

No current edge selection is required.

## Semantics

For every logical `polygonEdges` entry, count how many logical polygons use it.

- 1 face -> open boundary -> selected
- 2 faces -> ordinary manifold edge -> not selected
- 3+ faces -> over-connected non-manifold edge -> selected

Forge's logical polygon topology currently does not represent loose renderer-only edges as modeling `polygonEdges`, so this command deliberately does not pull renderer substrate edges back into Edit Mode selection.

## Examples

- logical Plane -> all 4 outer edges selected
- closed Cube -> 0 selected
- three logical faces sharing one edge -> shared over-connected edge selected, along with their open outer boundaries

## Selection behavior

On success:

- mode remains Edge;
- current edge selection is replaced by all logical non-manifold edges;
- final result edge becomes active under the existing convention;
- selected/active edge overlays update normally;
- Geometry Statistics SELECTED refreshes through `component-selection`;
- Undo depth is unchanged.

If no logical non-manifold edges exist:

- report `Mesh has no logical non-manifold edges.`;
- preserve current selection;
- preserve Edge mode;
- do not alter history.

## Logical authority

The helper only reads:

- `topology.polygons`
- `topology.polygonEdges`

Renderer triangulation diagonals never participate.

## Regression coverage

Pure topology:

- Plane -> 4 non-manifold boundary edges;
- closed Cube -> 0;
- synthetic three-face shared-edge mesh -> common 3-use edge is included;
- synthetic result contains all seven edges whose usage is not two.

Real RMB workflow:

- Add Plane through normal UI;
- Select Non-Manifold Edges -> 4 selected logical edges;
- selected overlay -> 4 instances;
- Geometry Statistics SELECTED -> `Obj 1 · V 4 · E 4 · F 1 · T 2`;
- Undo depth unchanged;
- switch to Cube with one selected edge;
- command reports no logical non-manifold edges;
- original Cube selection is preserved.

## Non-goals

- wire/loose renderer edge diagnostics outside logical polygons;
- non-contiguous normal-orientation diagnostics;
- geometric sharp-edge detection;
- self-intersection detection;
- automatic topology repair.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Add Plane -> Edit Mode -> Edge -> Select Non-Manifold Edges: all 4 logical boundary edges select.
2. Geometry Statistics SELECTED should be Obj 1 / V 4 / E 4 / F 1 / T 2.
3. Closed Cube -> select one edge -> Select Non-Manifold Edges: report none and preserve the original edge selection.
4. On a mesh where 3 logical faces share one edge, that common edge must be selected.
5. No renderer triangulation diagonal should ever appear selected.
