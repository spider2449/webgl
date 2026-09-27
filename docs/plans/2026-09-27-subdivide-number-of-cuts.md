# Subdivide Number of Cuts

## Goal

Extend the polygon-native **Subdivide Edges** operation from one midpoint to a retained integer **Cuts** setting.

## Interaction

- Edit Mode -> Edge.
- Select one or more logical polygon boundary edges.
- RMB exposes **Cuts** beside **Subdivide Edges**.
- Valid range: 1–32 whole-number cuts.
- The value is retained for the current Forge session.
- Enter on the numeric field runs Subdivide Edges with that value.

## Topology semantics

For each selected logical edge and `cuts = N`:

1. choose a canonical endpoint order so independently stored seam copies generate identical Float32 positions;
2. generate N equally spaced cut positions at `i / (N + 1)`;
3. reject endpoint collapse, duplicate cut points, or collision with an existing logical vertex;
4. insert the N points into every incident logical polygon in that polygon's local boundary order;
5. interpolate UV/color and other supported corner data independently on each polygon side;
6. preserve material and logical polygon identity;
7. retessellate renderer triangles underneath the updated boundary.

A logical edge is replaced by exactly `N + 1` logical edge segments.

Examples on a default Cube:

- Cuts 1: 8 -> 9 logical vertices, 12 -> 13 logical edges; two incident Quads become 5-gons.
- Cuts 3: 8 -> 11 logical vertices, 12 -> 15 logical edges; two incident Quads become 7-gons.

Renderer diagonals remain subordinate tessellation details and never become subdivision targets.

## Result selection

Selection restoration reconstructs the complete replacement chain from the original edge endpoint positions plus the same canonical Float32 cut positions.

For Cuts 3, all four replacement logical edge segments remain selected.

The selected vertex set therefore contains the two original endpoints and all three inserted cut vertices. Its center remains the original edge midpoint, allowing immediate Move / Rotate / Scale.

## Validation

Two layers validate the parameter:

- context UI rejects non-integer or out-of-range values before running;
- `subdivideLogicalEdges()` independently rejects any cuts value outside integer 1–32.

## Batch compatibility

Multi-object `subdivide-all` remains on the existing legacy all-triangle path and does not consume this Edit Mode Cuts setting.

## Regression coverage

- direct core:
  - existing Cuts 1 behavior remains unchanged;
  - Cuts 3 creates exactly 3 new logical vertices and 4 replacement edges;
  - two affected Cube faces become 7-gons;
  - renderer triangles rise to 18 only as tessellation;
  - cuts 0, 1.5 and 33 reject;
- viewport/worker:
  - retained Cuts 3 is sent through the real modeling command;
  - exactly three new logical vertices appear;
  - four replacement logical edges remain selected;
  - polygon groups remain persistent;
  - Undo / Redo / project round-trip remain valid;
- context menu:
  - slider and number input stay synchronized;
  - retained value survives reopening;
  - fractional input is rejected without executing the operation.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Edge.
2. Select one ordinary Cube boundary edge.
3. RMB -> set **Cuts = 3**.
4. Run **Subdivide Edges**.
5. Confirm three evenly spaced new logical vertices and four selected replacement edges.
6. Switch to Face mode: the two incident faces should each remain one logical 7-gon.
7. Wireframe should still hide renderer tessellation diagonals.
8. Undo / Redo should restore both topology states.
