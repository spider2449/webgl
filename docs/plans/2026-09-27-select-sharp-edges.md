# Select Sharp Logical Edges

## Goal

Add an Edge-mode **Select Sharp Edges** command that selects logical manifold edges by the angle between their two adjacent logical polygon faces.

This extends Forge's logical-topology selection tools without reintroducing the rolled-back edge-loop semantics.

## Interaction

Edit Mode -> Edge -> RMB -> **Select Sharp Edges**.

The context menu exposes a session-only **Sharp Angle** parameter.

Default:

```
30°
```

Valid range:

```
0° .. 180°
```

## Logical topology authority

Only `topology.polygonEdges` participate.

For each logical polygon boundary edge, Forge counts logical polygon uses.

An edge is angle-classified only when it is used by exactly two logical polygons.

Therefore the operator excludes:

- renderer tessellation diagonals;
- renderer-only vertices;
- open mesh boundaries used by one polygon;
- non-manifold over-connected edges used by three or more polygons.

Those other edge classes remain covered by the existing **Select Mesh Boundary** and **Select Non-Manifold Edges** commands.

## Angle semantics

Each adjacent logical polygon gets a normalized Newell face normal derived from logical vertex positions.

For a two-face logical edge:

```
angle = acos(clamp(dot(n0, n1), -1, 1))
```

The edge matches when:

```
angle >= Sharp Angle
```

At the default 30° threshold:

- the default Cube selects all 12 logical edges;
- a coplanar segmented Plane selects none.

At 91°:

- the default Cube selects none.

## Selection behavior

On a match:

- remains in Edge mode;
- replaces the current edge selection with all matching logical edges;
- refreshes the ordinary selected-edge overlay;
- preserves the established LineSegments2 overlay contract:
  - selected orange width 4;
  - active white width 6;
- refreshes Geometry Statistics SELECTED;
- does not add an Undo step.

If no logical edge matches:

- reports an error;
- preserves the current edge selection;
- leaves Undo history unchanged.

## Regression coverage

Pure topology:

- default Cube has 12 sharp logical edges at 30°;
- default Cube has 0 at 91°;
- Plane with Segments X=2 has 7 logical polygon edges but 0 sharp edges at 30°.

Real RMB workflow:

1. Enter default Cube Edge Edit Mode.
2. Select one edge.
3. Set Sharp Angle to 91° and run -> no match; original selection preserved.
4. Set Sharp Angle to 30° and run -> all 12 logical Cube edges selected.
5. Geometry Statistics SELECTED -> `Obj 1 · V 8 · E 12 · F 6 · T 12`: Edge mode counts selected V/E, and because all six Cube face boundary-edge sets are complete, the existing statistics contract also counts F6/T12.
6. Selected-edge overlay -> 12 orange LineSegments2 segments, width 4.
7. Active edge overlay -> 1 white segment, width 6.
8. Add Plane with Segments X=2.
9. Select one logical edge and run at 30° -> no sharp edges; original selection preserved.
10. Undo depth remains unchanged throughout.

## Non-goals

- edge loop or edge ring selection;
- renderer-triangle angle selection;
- selecting open boundary edges as sharp;
- selecting 3+ face non-manifold edges as sharp;
- persistent project storage of the Sharp Angle value;
- geometry mutation or sharp-edge tagging.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Default Cube -> Edge Edit Mode.
2. RMB -> Sharp Angle 30 -> Select Sharp Edges -> 12 logical edges.
3. Set Sharp Angle 91 -> command should report no match and preserve the current selection.
4. Add Plane, Segments X=2 -> at 30° no logical sharp edge should be selected.
5. Confirm renderer triangulation diagonals never appear as selectable sharp edges.
