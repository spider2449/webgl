# Select Same Length — Logical Edge Length Matching

## Goal

Add an Edge Edit Mode selection command that selects logical polygon edges with lengths similar to the active logical edge.

The feature must operate only on Forge modeling topology and must not expose renderer tessellation diagonals as selectable edges.

## Interaction

Edit Mode -> Edge -> select one or more logical edges -> RMB -> **Select Same Length**.

The last selected logical edge is the active reference edge.

The context menu exposes a session-only **Length Tolerance (%)** parameter.

Default:

```
1%
```

Valid range:

```
0% .. 100%
```

## Matching semantics

For every logical `polygonEdge`, Forge computes Euclidean edge length from the current logical vertex positions.

For reference length `L` and candidate length `C`:

```
abs(C - L) <= max(numeric_epsilon, L * tolerance)
```

where tolerance is the percentage converted to a 0..1 ratio.

At 0%, only numerically equal-length logical edges match, with a tiny floating-point epsilon to avoid rejecting geometrically equal edges due to representation noise.

The reference edge always matches itself.

## Logical topology authority

Only `topology.polygonEdges` participate.

Excluded:

- renderer tessellation diagonals;
- renderer-only vertices;
- renderer edges that are not logical polygon boundaries.

## Selection behavior

On success:

- remain in Edge mode;
- replace the current edge selection with all matching logical edges;
- keep the original active/reference edge active;
- refresh the selected-edge overlay;
- preserve selected orange LineSegments2 width 4;
- preserve active white LineSegments2 width 6;
- refresh Geometry Statistics;
- do not create an Undo step.

The command requires an existing logical edge selection because it needs an active reference edge.

## Examples

Default Cube, any edge:

- all 12 logical edges have equal length;
- tolerance 0% -> 12 selected logical edges.

Plane 6 x 2 with Segments X=2:

- logical topology has 7 polygon edges;
- 4 horizontal edges have length 3;
- 3 vertical edges have length 2;
- using a length-3 edge as reference:
  - tolerance 0% -> 4 edges;
  - tolerance 30% -> 4 edges;
  - tolerance 34% -> all 7 edges.

Renderer triangulation adds internal diagonals to rendering topology but they remain excluded.

## Regression coverage

Pure topology:

1. Cube at 0% selects all 12 logical edges.
2. Segmented 6 x 2 Plane has 7 logical polygon edges.
3. The Plane renderer edge count is greater than the logical polygon-edge count.
4. A length-3 Plane reference at 0% selects 4 edges.
5. 30% still selects 4.
6. 34% selects all 7.

RMB workflow:

1. Enter Cube Edge Edit Mode and select logical edge 0.
2. RMB shows Select Same Length.
3. Length Tolerance defaults to 1%.
4. Set tolerance to 0% and run.
5. All 12 logical Cube edges are selected.
6. Active edge remains 0.
7. Selected overlay has 12 segments at width 4.
8. Active overlay has 1 segment at width 6.
9. Geometry Statistics follows the existing Edge selection contract:
   `Obj 1 · V 8 · E 12 · F 6 · T 12`.
10. Undo depth is unchanged.
11. Reopening the menu preserves the session tolerance value.

## Non-goals

- edge loop or edge ring selection;
- face area matching;
- vertex valence matching;
- renderer-edge length matching;
- world-space scale comparison across different objects;
- persistent project storage of tolerance;
- geometry mutation.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Default Cube -> Edge Edit Mode -> select one edge.
2. RMB -> Length Tolerance 0 -> Select Same Length -> all 12 logical edges.
3. Confirm the originally active edge remains active.
4. Confirm renderer triangulation diagonals never appear.
5. Change tolerance, reopen the menu, and confirm the session value persists.
