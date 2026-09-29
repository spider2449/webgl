# Logical Polygon-Native Extrude Region

## Goal

Replace Forge Studio's legacy renderer-triangle planar region extrusion with one logical polygon-native **Extrude Region** operation.

The old path expanded selected logical faces into renderer triangle IDs and then extruded those triangles. That contradicted Forge's current topology architecture:

- modeling topology = logical vertices, logical polygon edges, Triangle/Quad/N-gon polygons;
- renderer topology = tessellation triangles only.

The new operation keeps logical polygons authoritative before, during and after region extrusion.

## User interaction

Face Edit Mode keeps the existing **Extrude Region** command and shared **Extrude Distance**.

The user selects one or more logical faces and runs Extrude Region. Forge partitions the selection into edge-connected logical regions and extrudes each region independently in the same operation.

On success:

- every selected logical cap face remains one logical face;
- selected-selected internal logical edges remain present;
- only region perimeter edges receive side-wall Quads;
- selected cap face IDs remain selected;
- the command can be repeated immediately;
- one Undo step is created.

## Region connectivity

The operation receives logical face IDs, not renderer triangle IDs.

For every logical polygon edge:

- 2 selected uses -> selected-selected internal edge;
- 1 selected use -> region boundary edge;
- 0 selected uses -> unrelated.

Selected faces are partitioned into edge-connected components.

Each connected component is one extrusion region. A region may contain one face or many faces, and one command may therefore extrude multiple disconnected regions at once.

Each region boundary must consist of one or more simple closed directed loops. Holes are therefore valid.

A selected region with no boundary, such as every face of one closed mesh island, is rejected because there is no perimeter on which to build extrusion walls. The whole multi-region operation remains atomic.

## Common 3D extrusion vector

Extrude Region translates each connected selected cap as one rigid region.

For each connected region, Forge computes the area-weighted Newell normal vector of every selected logical polygon in that region and sums those vectors.

The normalized sum is that region's extrusion direction.

```
offset = normalize(sum(areaWeightedFaceNormals)) * ExtrudeDistance
```

Every selected cap vertex within the same connected region receives that region's exact same offset.

Consequences:

- planar regions move along their common normal;
- folded regions may cross creases;
- every cap Triangle/Quad/N-gon keeps its original shape;
- selected-selected internal edges keep their original length and relationship;
- disconnected regions may move in different directions;
- this is region extrusion, not independent per-face normal extrusion inside one connected region.

Within each connected region, selected face normals must fit one outward extrusion hemisphere. If any face points perpendicular/opposite to that region's derived direction, the whole operation rejects instead of silently pushing part of the cap inward.

A region whose weighted normals cancel cannot define one extrusion direction and causes atomic rejection.

## Side walls

For each directed logical region boundary edge:

```
A -> B
```

Forge adds one logical Quad:

```
A, B, moved(B), moved(A)
```

That orientation:

- opposes the adjacent unselected face along the original boundary edge;
- opposes the moved cap along the new boundary edge;
- closes the perimeter consistently.

Hole boundaries use the same directed-edge rule and therefore receive correctly oriented inner walls without a separate special case.

A boundary wall that collapses because the extrusion vector is parallel to its edge is rejected atomically.

## Attributes and materials

Selected cap corners preserve their non-position attributes while their positions receive the common translation.

Unselected polygons reuse their existing renderer triangles.

Each wall Quad takes its material and polygon-side corner attributes from the adjacent selected face.

UV/color seam copies remain independent across logical polygon sides.

Normals are recomputed by the shared finish pipeline.

## Tessellation

Selected logical caps are retessellated from their own logical boundaries.

Renderer diagonals:

- do not participate in region connectivity;
- do not become walls;
- do not become selectable modeling edges;
- may change as needed underneath the same logical polygon boundary.

## Worker / editor integration

New worker operation:

```
{
  kind: 'extrude-region',
  faces,
  distance,
  polygonTriangles
}
```

It is polygon-native:

- returned logical polygon groups are stored in `forgePolygonTriangles`;
- primitive metadata is cleared;
- Edit Mode rebuilds from those exact polygon groups;
- original selected face IDs remain selected.

The old triangle-based `src/modeling/extrude-region.ts` implementation and the synchronous `Editor.extrudePlanarRegion()` path are removed.

## Regression targets

### Two adjacent planar Quads

Plane with Segments X=2, both Quads selected.

Before:

- V6 / E7 / F2 / T4.

After one extrusion:

- V12 / E19 / F8 / T16;
- all 8 logical polygons are Quads;
- the two original cap Quads remain separate;
- their shared internal logical edge remains present;
- 6 wall Quads are added.

After a second extrusion of the same selected cap faces:

- V18 / E31 / F14 / T28;
- cap face IDs remain 0 and 1.

### Folded Cube region

Select two adjacent perpendicular Cube Quads.

Expected:

- one common 3D translation direction has positive dot product with both source face normals;
- V14 / E24 / F12 / T24;
- all logical polygons remain Quads;
- the selected caps still share their internal logical edge;
- 6 perimeter wall Quads are added.

### Region with a hole

3x3 logical Quad Plane, center face unselected, other 8 faces selected.

Expected:

- 2 boundary loops;
- 16 boundary edges;
- selected cap face IDs unchanged;
- center unselected face remains at its original coordinates;
- F25 / T50.

### Disconnected planar regions

3-Quad Plane strip, select the left and right Quads while leaving the center Quad unselected.

Expected:

- 2 independent extrusion regions;
- 2 boundary loops;
- 8 total boundary edges;
- both selected cap face IDs remain selected;
- center Quad remains at its original coordinates;
- V16 / E26 / F11 / T22.

### Disconnected regions with different normals

On a Cube, select two opposite Quads.

Expected:

- 2 independent extrusion regions;
- each region derives its own outward direction;
- the two directions align with their respective opposite face normals;
- V16 / E28 / F14 / T28.

## Rejection

Reject atomically:

- invalid face IDs;
- non-positive or excessive distance;
- non-manifold logical boundaries;
- ambiguous/non-simple boundary loops;
- selections with no region boundary;
- weighted normals that cancel;
- selected normals outside one outward hemisphere;
- collapsed boundary edges;
- boundary walls parallel to the extrusion direction;
- final precision/tessellation/manifold failure.

## Non-goals

- independent per-face extrusion;
- Extrude Along Normals;
- negative/inward distance;
- arbitrary interactive translation vector after extrusion;
- collision/self-intersection resolution;
- automatic UV unwrap for new walls;
- Bridge Edge Loops.

Those are separate modeling capabilities.

## Windows-local validation

During development:

```powershell
npm run build
npm test -- tests/region-extrude.spec.ts tests/modeling-core.spec.ts tests/context-menu.spec.ts --workers=2
```

Then:

```powershell
npm run test:modeling -- --workers=2
```

Manual priority:

1. Plane Segments X=2 -> select both Quads -> Extrude Region.
2. Confirm both cap Quads remain separate and selected.
3. Repeat extrusion and confirm selection remains on the latest cap.
4. Cube -> select two adjacent perpendicular faces -> Extrude Region.
5. Confirm the folded cap moves as one rigid region and its shared edge remains.
6. 3x3 Plane with center face unselected -> extrude outer eight faces; confirm the center face stays unchanged and both outer/hole walls are created.
7. Undo returns to the exact pre-extrusion topology.
8. Select disconnected Plane faces and confirm they extrude as independent regions in one Undo step.
9. Select two opposite Cube faces and confirm each island extrudes along its own outward direction.

Final exact-HEAD gate, once only:

```powershell
npm run test:full -- --workers=2
```
