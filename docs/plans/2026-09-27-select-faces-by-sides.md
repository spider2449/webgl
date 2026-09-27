# Select Logical Faces by Side Count

## Goal

Add a Face-mode **Select Faces by Sides** command that selects logical Triangles, Quads or N-gons according to polygon boundary size.

This is a logical modeling-topology query. Renderer tessellation does not determine face type.

## Interaction

Edit Mode -> Face -> RMB -> **Select Faces by Sides**.

The context menu exposes a retained session-only **Face Type** selector:

- Triangles
- Quads
- N-gons

Default: **Quads**.

Changing the selector updates the next Select Faces by Sides command. The setting is not stored in project data.

## Face classification

Classification uses `topology.polygons[face].length`:

- Triangle -> exactly 3 logical boundary vertices
- Quad -> exactly 4
- N-gon -> 5 or more

Examples:

- default Cube -> 6 Quads, 0 Triangles, 0 N-gons
- default Cube renderer -> still 12 tessellation triangles underneath, but those do not count as Triangle faces
- a 5-gon or 7-gon produced by logical subdivision -> N-gon

## Selection behavior

On success:

- remains in Face mode;
- replaces the current selection with every logical face of the requested type;
- if exactly one face matches it becomes the selected face under the existing convention;
- component transform proxy updates from all selected logical polygon vertices;
- Geometry Statistics SELECTED refreshes through `component-selection`;
- Undo depth is unchanged.

If the mesh contains no requested face type:

- report `Mesh has no logical triangles/quads/N-gons.`;
- preserve the current Face selection;
- preserve mode;
- do not alter history.

## Logical authority

The helper reads only `topology.polygons`.

It does not inspect:

- renderer triangle count;
- `topology.faces`;
- triangle-to-polygon mapping;
- renderer-only diagonals.

## Regression coverage

### Pure topology

Default logical Cube:

- Quads -> 6
- Triangles -> empty
- N-gons -> empty

Synthetic mixed logical polygon list:

- one 3-sided polygon -> Triangle result
- one 4-sided polygon -> Quad result
- 5-sided and 7-sided polygons -> N-gon results

### Real RMB workflow

Default Cube:

1. enter Face Edit Mode;
2. Face Type defaults to Quads;
3. Select Faces by Sides -> selects faces 0–5;
4. Geometry Statistics SELECTED -> `Obj 1 · V 8 · E 12 · F 6 · T 12`;
5. Undo depth unchanged;
6. switch Face Type to Triangles;
7. run again -> reports no logical triangles;
8. prior six-Quad selection remains intact;
9. Undo depth remains unchanged.

The existing Face context-menu test also verifies the command and Face Type selector are visible.

## Non-goals

- selecting exact arbitrary side counts such as 6 or 8 separately;
- selecting faces by area, normal, material or coplanarity;
- modifying polygon topology;
- triangulating or quadrangulating geometry;
- project persistence for the Face Type selector.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Face -> RMB.
2. Face Type defaults to Quads.
3. Select Faces by Sides -> all 6 logical Cube faces select.
4. Geometry Statistics SELECTED should show Obj 1 / V 8 / E 12 / F 6 / T 12.
5. Change Face Type to Triangles and run again -> report no logical triangles; the six selected Cube faces remain selected.
6. On a mesh containing a 5+ sided logical polygon, choose N-gons and confirm that polygon selects.
