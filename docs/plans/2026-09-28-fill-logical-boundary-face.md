# Fill Logical Boundary Face

## Goal

Add a core hole-closing operation to Forge Studio.

Forge can already delete logical faces and leave an open mesh boundary, but it has no modeling operation that turns a selected hole boundary back into a logical Triangle, Quad or N-gon.

This task adds Edge Edit Mode **Fill Boundary Face**.

## Interaction

1. Enter Edge Edit Mode.
2. Select every logical edge around one open mesh hole.
3. RMB -> **Fill Boundary Face**.
4. Forge creates one new logical polygon across that loop.
5. Forge switches to Face mode and selects the newly created face.

The existing **F** key remains Frame Selected. This task does not change that established viewport shortcut.

## Modeling authority

The operation uses only logical modeling topology:

- `logicalVertices`
- `polygonEdges`
- logical Triangle / Quad / N-gon `polygons`
- stored `polygonTriangles` as renderer tessellation groups

Renderer-only diagonals and renderer-only vertices are never valid Fill Boundary selections.

## Valid selection

A fill requires:

- at least 3 selected logical edges;
- at most 4096 selected logical edges;
- every selected edge is an open logical mesh boundary edge used by exactly one logical polygon;
- every selected boundary vertex has exactly one selected incoming edge and one selected outgoing edge;
- all selected edges form exactly one simple closed loop.

Rejected atomically:

- incomplete/open chains;
- branches;
- multiple loops;
- interior manifold edges;
- invalid logical edge IDs;
- a loop that already bounds an existing logical face;
- a loop whose resulting polygon cannot be tessellated safely.

## Winding

For every selected logical boundary edge, the existing adjacent polygon supplies an oriented boundary use:

```
existing face: A -> B
```

The new filled polygon must use that same edge in the opposite direction:

```
new face: B -> A
```

These reversed uses must chain into one closed cycle.

This guarantees that every previously open boundary edge becomes a consistently oriented two-face manifold edge after Fill.

## Corner attributes and material

Each new polygon corner copies the non-normal corner attributes from the adjacent boundary polygon at that logical vertex.

This preserves deterministic UV/color seam data without forcing unrelated existing polygon sides to share a renderer vertex.

The new polygon takes the material of the polygon adjacent to the active selected boundary edge. Edge selection order already defines the active edge as the last selected logical edge.

## Tessellation

The completed boundary is one logical polygon regardless of renderer triangle count.

The existing `finishEditedSurface()` / `triangulateBoundary()` path tessellates the polygon using only its logical boundary vertices.

No centroid or renderer-only modeling vertex is introduced.

Collinear boundary vertices remain logical boundary vertices.

## Editor integration

New worker operation:

```
{ kind: 'fill-boundary', edges, polygonTriangles }
```

It is polygon-native:

- primitive metadata clears;
- returned `polygonTriangles` are stored;
- Edit Mode rebuilds from those exact logical groups;
- the new face ID is the previous logical polygon count;
- Forge switches to Face mode;
- the new face is selected;
- one Undo step is created.

## Default Cube regression

1. Start with default Cube:
   - V8 / E12 / F6 / T12.
2. Delete one logical Quad face:
   - V8 / E12 / F5 / T10;
   - 4 open logical boundary edges.
3. Select those four boundary edges.
4. Fill Boundary Face.
5. Expected:
   - V8 / E12 / F6 / T12;
   - no open logical boundary edges;
   - new logical face has 4 sides;
   - renderer tessellation has 2 triangles underneath it.

## Real editor regression

The end-to-end test:

1. deletes one Cube face through the real modeling worker;
2. switches to Edge mode;
3. uses **Select Mesh Boundary**;
4. confirms four logical boundary edges are selected;
5. runs RMB **Fill Boundary Face**;
6. confirms Face mode;
7. confirms the new Quad is the sole selected face;
8. confirms V8 / E12 / F6 / T12;
9. confirms no open logical edges remain;
10. confirms Geometry Statistics SELECTED is `Obj 1 · V 4 · E 4 · F 1 · T 2`;
11. confirms primitive metadata is cleared;
12. confirms one additional Undo step;
13. Ctrl+Z returns to the five-face Cube hole.

## Non-goals

- automatically discovering a loop from a partial edge selection;
- filling multiple holes in one invocation;
- Grid Fill;
- Bridge Edge Loops;
- triangle fan controls;
- user-selectable fill material;
- changing the existing F shortcut;
- renderer topology as modeling authority.

Those can be separate modeling features after basic logical hole fill is stable.

## Windows-local validation

During implementation:

```powershell
npm run build
npm test -- tests/modeling-core.spec.ts tests/context-menu.spec.ts --workers=2
```

When the exact PR HEAD is finished:

```powershell
npm run test:modeling -- --workers=2
```

After manual validation and only when the branch is ready to merge, run the final full gate once:

```powershell
npm run test:full -- --workers=2
```

Manual spot-check:

1. Default Cube -> Face mode -> delete one face.
2. Edge mode -> Select Mesh Boundary.
3. Fill Boundary Face.
4. Confirm the hole becomes one logical Quad.
5. Confirm renderer diagonal is not selectable.
6. Confirm the new face stays selected.
7. Inset or Extrude the filled face.
8. Ctrl+Z returns to the open hole.
9. Try an incomplete three-edge chain and confirm no geometry changes.
