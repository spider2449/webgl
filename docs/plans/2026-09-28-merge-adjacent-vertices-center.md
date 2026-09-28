# Merge Adjacent Vertices at Center

## Goal

Add a core Vertex Edit Mode operation that collapses one logical modeling edge by merging its two endpoint vertices at their midpoint.

This is intentionally narrower than arbitrary vertex welding. The first implementation requires exactly two selected logical vertices that already share one logical `polygonEdge`.

## Interaction

Vertex Edit Mode:

1. select exactly two adjacent logical vertices;
2. RMB -> **Merge at Center**, or press **M**;
3. Forge collapses their shared logical edge to its midpoint;
4. the resulting merged logical vertex remains selected.

## Modeling-topology authority

The operation is defined from:

- `logicalVertices`;
- `polygonEdges`;
- logical Triangle / Quad / N-gon `polygons`;
- stored logical `polygonTriangles` only as renderer tessellation groups.

Renderer-only triangulation diagonals and renderer-only vertices never qualify as merge edges.

## Validation

The operation rejects before changing the mesh when:

- selection is not exactly two distinct logical vertices;
- the two vertices do not share a logical polygon edge;
- the result collapses at Float32 mesh precision;
- retessellation cannot preserve a valid polygon boundary;
- the result becomes inconsistent or non-manifold under existing geometry validation;
- the operation would remove the entire mesh.

## Geometry transformation

Let the two selected logical vertices be `A` and `B`.

The merged position is:

```
M = f32((A + B) / 2)
```

Every logical polygon is rebuilt as follows:

### Polygon contains neither endpoint

Reuse the existing renderer triangles unchanged.

### Polygon contains one endpoint

Move that polygon corner to `M`.

Per-corner UV/color seam attributes remain on that polygon side.

### Polygon contains both endpoints

The two endpoints must be consecutive on that polygon boundary.

They are replaced by one midpoint corner.

Non-position corner attributes are interpolated 50/50 on that polygon side, preserving independent seam copies between neighboring polygons.

A Quad incident to the collapsed edge therefore becomes a Triangle.

If a Triangle contains the collapsed edge, that Triangle disappears because its boundary would contain fewer than three vertices.

## Retessellation and safety

Modified polygons flow through the existing `finishEditedSurface()` path.

That path:

- triangulates from logical polygon boundaries;
- preserves material groups;
- recomputes normals and bounds;
- rebuilds logical polygon triangle groups;
- runs `inspectGeometry()` on the finished result.

This means malformed, degenerate, or non-manifold results are rejected atomically rather than installed into the scene.

## Editor state

The operation is a normal modeling worker job.

After success:

- Forge remains in Vertex Edit Mode;
- logical topology is rebuilt from stored polygon groups;
- the merged midpoint logical vertex is found in the new topology and selected;
- primitive-generation metadata is cleared because the primitive has been manually edited;
- one Undo step is created.

## Default Cube example

Collapsing one Cube logical edge:

Before:

- V = 8
- E = 12
- F = 6
- T = 12
- polygon sizes = 4,4,4,4,4,4

After:

- V = 7
- E = 11
- F = 6
- T = 10
- polygon sizes = 3,3,4,4,4,4

The two Quads incident to the collapsed edge become Triangles.

## Regression coverage

Pure modeling test:

1. build default logical Cube;
2. select endpoints of one logical polygon edge;
3. merge at center;
4. verify V7 / E11 / F6 / T10;
5. verify polygon sizes 3,3,4,4,4,4;
6. verify the midpoint exists as one logical vertex;
7. verify a non-adjacent vertex pair is rejected.

RMB / editor workflow:

1. Vertex Edit Mode on default Cube;
2. select both endpoints of one logical edge;
3. RMB Merge at Center is enabled;
4. operation completes through the real worker pipeline;
5. merged midpoint is the sole selected logical vertex;
6. Geometry Statistics SELECTED becomes `Obj 1 · V 1 · E 0 · F 0 · T 0`;
7. Cube topology becomes V7 / E11 / F6 / T10;
8. primitive metadata is cleared;
9. Undo restores V8 / E12 / F6 / T12;
10. pressing **M** performs the same merge operation.

## Non-goals

- merging non-adjacent vertices;
- merging more than two vertices;
- Merge at First / Last / Cursor;
- Merge by Distance;
- cross-object welding;
- automatic bridge/fill after arbitrary disconnected merges;
- renderer topology as modeling authority.

Those can be considered only after the adjacent-edge collapse behavior is proven stable.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Default Cube -> Vertex Edit Mode.
2. Select two endpoints of one visible logical edge.
3. RMB -> Merge at Center.
4. Confirm those two points become one point at the edge midpoint.
5. Confirm the two incident Cube faces are now logical Triangles, not exposed renderer diagonals.
6. Confirm the merged point stays selected.
7. Ctrl+Z restores the original Cube.
8. Repeat using **M**.
9. Select two non-adjacent Cube vertices and confirm Forge rejects the operation without changing geometry.
