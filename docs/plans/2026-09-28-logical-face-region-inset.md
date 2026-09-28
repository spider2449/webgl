# Logical Face Region Inset

## Goal

Extend Forge Studio from single-face inset to a true logical **face-region inset** while preserving internal modeling topology.

The operation must not flatten a multi-face selection into one large N-gon and must not expose renderer triangulation as modeling structure.

## Interaction

Face Edit Mode:

- select one face -> RMB -> **Inset Faces** uses the established single-face inset path;
- select two or more faces -> the same **Inset Faces** command runs region inset.

Both paths use the shared session-only **Inset Distance**.

## Region requirements

A multi-face inset requires:

- at least two valid logical polygons;
- one edge-connected selected region;
- all selected logical polygons coplanar;
- consistent polygon orientation;
- manifold logical boundaries;
- simple closed boundary loops.

Disconnected regions and folded selections are rejected.

## Modeling topology authority

The operation uses:

- `logicalVertices`;
- logical `polygonEdges`;
- Triangle / Quad / N-gon `polygons`;
- stored `polygonTriangles` only for renderer tessellation mapping.

Renderer-only diagonals and renderer-only vertices never participate in boundary detection.

## Boundary classification

Every logical polygon edge is classified by selected-face use:

- two selected incident polygons -> internal selected edge;
- one selected incident polygon -> region boundary edge;
- zero selected incident polygons -> unrelated edge.

Internal selected edges are preserved.

Boundary edges are chained by their selected polygon winding into one or more directed simple closed loops.

Because consistently oriented selected polygons keep region interior on the left side of every directed boundary edge:

- an outer boundary loop offsets inward;
- a hole boundary loop offsets outward from the hole and into the selected region.

No separate outer/hole special case is required.

## Planar offset

The selected region is projected to a stable 2D basis on its common plane.

For each directed boundary edge:

1. compute its unit left normal;
2. shift its support line by `Inset Distance`;
3. intersect consecutive shifted lines to locate the new inner boundary vertex.

Collinear same-direction boundary segments are allowed. Their shared boundary vertex translates by the common left normal instead of treating parallel offset lines as an error.

Zero-width reversals are rejected.

## Multiple boundary loops and holes

All inset loops must:

- preserve their original winding sign;
- retain non-zero area;
- remain simple;
- not intersect any non-adjacent inset segment;
- not intersect another inset loop.

This rejects excessive inset values before mesh replacement.

A 3×3 logical Quad grid with the center face unselected therefore has:

- one outer boundary loop;
- one inner hole loop.

The outer loop contracts while the hole expands into the selected region.

## Internal logical topology

Selected polygons remain one-to-one with their source logical faces.

For each selected face:

- boundary logical vertices move to their inset loop positions;
- selected vertices not on the region boundary remain at their existing positions;
- internal selected-selected edges remain logical edges;
- polygon material identity is preserved.

This is deliberately different from merging the selected region into one cap.

## Corner attributes

When a moved boundary point remains interpolable on its source face, Forge interpolates the source corner attributes using the established face interpolation path.

For more complex region junctions such as hole corners where the moved logical vertex may no longer lie inside every incident source polygon, Forge preserves that polygon side's existing non-position corner attributes while replacing only the position.

This preserves UV/color seams without forcing unrelated polygon sides to share attribute values.

## Border ring

For each directed region boundary edge `A -> B`, Forge adds one logical Quad:

```
outer A -> outer B -> inner B -> inner A
```

The Quad uses the selected source polygon's material.

Internal selected edges do not receive border Quads.

## Untouched faces

Unselected logical polygons are carried through the existing edited-surface path using their original renderer triangles.

This includes:

- faces outside the selected region;
- faces inside holes.

Their geometry and logical polygon identity remain unchanged.

## Retessellation and validation

Changed logical polygons and border Quads use the existing polygon tessellation machinery.

The final mesh then passes the existing `inspectGeometry()` validation, which checks:

- finite coordinates and attributes;
- non-degenerate triangles;
- material-group validity;
- consistent manifold edge orientation;
- stored logical polygon grouping.

Invalid results reject atomically.

## Editor integration

The new worker operation is:

```
{ kind: 'inset-region', faces, distance, polygonTriangles }
```

It is a polygon-native operation:

- primitive metadata is cleared;
- returned logical `polygonTriangles` are stored;
- Edit Mode topology is rebuilt from those exact polygon groups;
- original selected inner face IDs remain selected;
- one Undo step is created.

The existing single-face `inset` worker operation remains unchanged.

## Expected two-Quad result

Start with a Plane split into two logical Quads:

Before:

- V = 6
- E = 7
- F = 2
- T = 4

Inset both faces as one region.

The region boundary has six logical edges.

After:

- V = 12
- E = 19
- F = 8
- T = 16
- all eight logical polygons are Quads

The two selected inner Quads remain separate and still share one internal logical edge.

## Expected hole result

Start with a 3×3 logical Quad grid and select all faces except the center face.

The selected region has:

- 8 selected logical faces;
- 2 boundary loops;
- 16 boundary logical edges.

After region inset:

- the eight selected inner faces remain;
- the center unselected face remains unchanged;
- sixteen border Quads are added;
- total logical faces = 25;
- total renderer triangles = 50.

## Regression coverage

Pure modeling tests cover:

1. two adjacent Quads preserve their shared internal logical edge;
2. two-Quad region produces V12 / E19 / F8 / T16;
3. selected face IDs remain 0 and 1;
4. a region with one hole reports two loops and sixteen boundary edges;
5. the unselected center hole face is unchanged;
6. adjacent non-coplanar Cube faces are rejected;
7. disconnected coplanar Plane faces are rejected.

Real editor workflow covers:

1. **Inset Faces** is the single Face-context entry for both single and multi-face selections;
2. single-face Cube inset keeps the existing behavior;
3. two selected Plane Quads run through the real worker pipeline;
4. selected inner faces remain selected;
5. internal shared logical edge remains present;
6. Geometry Statistics reflects the new logical topology;
7. primitive metadata is cleared;
8. stored logical polygon groups contain the new faces;
9. Undo restores the original segmented Plane.

## Non-goals

- non-coplanar region inset;
- individual-face inset mode for a multi-face selection;
- bevel-style depth or outset;
- automatic straight-skeleton topology changes for large concave offsets;
- merging the selected region into one N-gon;
- renderer topology as modeling authority.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Add Plane, set Segments X=2.
2. Face Edit Mode, select both logical Quads.
3. RMB -> Inset Faces.
4. Confirm the outer border stays fixed and the whole selected region receives one border ring.
5. Confirm the middle shared edge still exists inside the inset region.
6. Ctrl+Z restores the original two Quads.
7. On a segmented Plane with a hole-like unselected center face, confirm both outer and inner boundaries inset in the correct directions.
8. On a Cube, select two adjacent non-coplanar faces and confirm Inset Faces rejects the selection without changing geometry.
