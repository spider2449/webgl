# Viewport Geometry Statistics Overlay

## Goal

Add a session-only viewport toggle that displays both complete scene geometry statistics and current selection statistics.

## Interaction

A new **Geometry statistics** activity button appears in the viewport toolbar beside Grid.

- default: off;
- click once: show the overlay;
- click again: hide it;
- the button uses the existing active-button styling and `aria-pressed` state.

The overlay is positioned in the upper-right viewport area, left of the axis widget.

## Display

The overlay contains two rows:

```
ALL       Obj N · V N · E N · F N · T N
SELECTED  Obj N · V N · E N · F N · T N
```

Header mode text shows:

- `OBJECT`
- `EDIT · VERTEX`
- `EDIT · EDGE`
- `EDIT · FACE`
- `WEIGHT`

Abbreviations:

- Obj = scene objects
- V = logical vertices
- E = logical polygon edges
- F = logical polygon faces
- T = renderer triangles used to tessellate those logical faces

## ALL semantics

Scene roots include ordinary top-level objects plus objects stored inside Forge collections.

For every descendant mesh:

1. reuse stored logical polygon groups when available;
2. preserve Cube/Plane logical Quad reconstruction when applicable;
3. otherwise derive logical topology from the mesh geometry.

The default Cube therefore reports:

```
Obj 1 · V 8 · E 12 · F 6 · T 12
```

not 24 renderer position entries or 18 triangle edges.

## SELECTED semantics

### Object Mode

Selected statistics sum complete geometry for every selected object root, including descendant meshes.

### Edit Mode

The active editable mesh remains one selected object, while V/E/F/T reflect logical component selection.

Vertex mode:

- V = selected logical vertices;
- E = logical edges whose two endpoints are selected;
- F = logical faces whose complete boundary vertices are selected;
- T = renderer triangles belonging to those selected logical faces.

Edge mode:

- E = selected logical polygon edges;
- V = unique logical endpoints of those selected edges;
- F = logical faces whose complete logical boundary edge set is selected;
- T = renderer triangles belonging to those selected logical faces.

Face mode:

- F = selected logical faces;
- V = unique logical vertices in those faces;
- E = unique logical polygon boundary edges in those faces;
- T = renderer triangles stored for those logical faces.

Renderer-only triangulation diagonals never enter E.

An empty Edit Mode component selection reports Obj 1 and zero selected V/E/F/T.

## Performance

The overlay is off by default, and `geometryStatistics()` is called only while it is visible.

Per-mesh logical count results are cached by:

- mesh geometry identity;
- stored logical polygon metadata identity;
- logical Quad reconstruction mode.

Selection changes can therefore reuse complete scene topology counts while recomputing only the cheap selected-component aggregation.

## Update triggers

While visible, statistics refresh on:

- object / scene change;
- component selection change;
- Edit/Object/Weight mode change;
- scene commit.

Camera orbit and ordinary redraws do not rebuild the logical statistics overlay.

## Regression coverage

The Playwright regression verifies:

1. overlay is hidden by default and button `aria-pressed=false`;
2. default Cube ALL and SELECTED both report `Obj 1 · V 8 · E 12 · F 6 · T 12`;
3. duplicating the Cube changes ALL to `Obj 2 · V 16 · E 24 · F 12 · T 24` while SELECTED remains one Cube;
4. selecting both objects makes SELECTED equal ALL;
5. entering Edit Edge mode and selecting one logical edge reports `Obj 1 · V 2 · E 1 · F 0 · T 0`;
6. selecting one logical Cube face reports `Obj 1 · V 4 · E 4 · F 1 · T 2`;
7. toggling off hides the overlay and resets `aria-pressed=false`.

## Non-goals

- persistent project preference;
- GPU memory or draw-call profiling in the overlay;
- modifier evaluated-mesh statistics;
- per-material statistics;
- hidden-only / visible-only variants.

The existing footer render statistics remain unchanged.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Click the new activity/statistics button near Grid.
2. Default Cube should show ALL and SELECTED as `Obj 1 · V 8 · E 12 · F 6 · T 12`.
3. Duplicate Cube: ALL becomes 2 / 16 / 24 / 12 / 24 while SELECTED remains one Cube.
4. Edit -> Edge -> select one edge: SELECTED becomes Obj 1 / V 2 / E 1 / F 0 / T 0.
5. Edit -> Face -> select one face: SELECTED becomes Obj 1 / V 4 / E 4 / F 1 / T 2.
6. Toggle off: overlay disappears.
