# Select Connected Coplanar Logical Faces

## Goal

Add a Face-mode **Select Coplanar Faces** command that expands the current logical face seed across one edge-connected, consistently oriented plane.

This is designed to prepare a planar logical region for workflows such as **Extrude Region** without manually Shift-selecting every face.

## Interaction

Edit Mode -> Face -> select one or more logical seed faces -> RMB -> **Select Coplanar Faces**.

At least one Face seed is required.

## Coplanar semantics

The operation works in logical polygon space.

A candidate face is included only when:

1. it is reachable from the seed through shared logical polygon boundary edges;
2. its polygon winding produces a normal aligned with the reference seed normal;
3. all of its logical polygon vertices lie on the seed plane within tolerance.

Normal agreement:

```
dot(candidateNormal, seedNormal) >= 1 - 1e-6
```

Plane tolerance:

```
max(1e-7, selected-seed-bounds-diagonal * 1e-6)
```

This uses the same order of tolerance and orientation strictness as the existing Extrude Region validation.

## Multiple seeds

Multiple selected seed faces are allowed only when they belong to the same edge-connected, coplanar, consistently oriented region.

If seeds are on different planes or separate coplanar islands:

- the command reports an error;
- the existing Face selection is preserved;
- no history is changed.

Unselected coplanar faces between seeds may still be traversed, so seeds do not need to be directly adjacent if the same coplanar region connects them.

## Logical topology authority

Adjacency is built from `topology.polygons` boundary edges.

Renderer tessellation diagonals do not participate.

Logical vertex positions are read through the topology's welded logical vertex mapping, so renderer-duplicate buffer vertices do not create false region breaks.

## Selection behavior

On success:

- remains in Face mode;
- current selection is replaced with the complete connected coplanar region;
- exactly one result keeps the normal selected-face convention;
- transform proxy updates from selected logical polygon vertices;
- Geometry Statistics SELECTED refreshes via `component-selection`;
- Undo depth is unchanged.

The command does not:

- modify geometry;
- invoke the modeling worker;
- create an Undo snapshot.

## Regression coverage

### Pure topology

A 2x1 segmented Plane:

- 2 logical Quads;
- seed face 0 expands to faces `[0, 1]`.

Default Cube:

- seed face 0 remains `[0]`;
- selection does not cross a 90-degree Cube edge;
- incompatible multi-seed faces reject rather than changing the region.

### Real RMB workflow

Using normal UI:

1. Add Plane.
2. Set **Primitive Segments X** to 2.
3. Enter Face Edit Mode and select face 0.
4. **Select Coplanar Faces** selects both logical Plane faces.
5. Geometry Statistics SELECTED becomes:
   `Obj 1 · V 6 · E 7 · F 2 · T 4`.
6. Undo depth is unchanged.
7. Switch to the default Cube.
8. Select one logical Cube face.
9. Select Coplanar Faces keeps that single face selected.
10. Undo depth remains unchanged.

## Non-goals

- angle-threshold / nearly coplanar face selection;
- crossing disconnected coplanar islands;
- ignoring face winding;
- selecting by material or normal similarity without shared-edge connectivity;
- geometry repair or merge;
- automatic Extrude Region execution.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Add Plane and set Segments X=2.
2. Enter Face Edit Mode and select one of its two logical faces.
3. Select Coplanar Faces -> both faces should select.
4. Geometry Statistics SELECTED should show Obj 1 / V 6 / E 7 / F 2 / T 4.
5. Default Cube -> select one face -> Select Coplanar Faces should keep only that face.
6. On multiple seed faces from different planes, the command should reject and preserve the original selection.
