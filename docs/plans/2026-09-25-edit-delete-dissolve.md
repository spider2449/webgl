# Edit Mode Delete and Dissolve

## Goal

Add Blender-style destructive mesh editing to Forge's logical polygon workflow.

## Scope

### Vertex Mode

- Delete selected logical vertices.
- Any logical polygon using a deleted vertex is removed.
- The object remains in the scene.
- Result topology is rebuilt from the remaining logical polygons.

### Edge Mode

- Delete selected logical edges and the polygons that use those edges.
- Dissolve one selected manifold logical edge.
- Dissolve merges the two adjacent polygons into one logical n-gon.
- Dissolve requires both polygons to use the same material.

### Face Mode

- Delete selected logical faces.

## UX

- Delete / Backspace in Edit Mode operates on selected components.
- Delete / Backspace in Object Mode continues to delete objects.
- RMB Vertex Context exposes Delete Vertices.
- RMB Edge Context exposes Dissolve Edge and Delete Edges.
- RMB Face Context exposes Delete Faces.

## Topology invariants

1. Logical polygons remain authoritative.
2. Renderer triangles are regenerated only for display.
3. Delete / Dissolve persist fresh polygon-to-renderer-triangle groups.
4. Re-entering Edit Mode must not fall back to generic renderer triangles.
5. Dissolve removes the selected modeling edge while preserving its renderer crease/triangles as internal implementation geometry when required by the surface.
6. Component selection is cleared after a destructive topology edit.
7. Deleting every face from an object is rejected; deleting the whole object remains an Object Mode action.

## Current Dissolve limits

- One selected edge at a time.
- Edge must be manifold and shared by exactly two polygons.
- Adjacent polygons must have consistent opposite winding.
- Dissolve changes logical polygon ownership only; renderer triangles, positions, indices and material groups remain unchanged.
- Folded / non-planar regions are therefore preserved exactly, with the dissolved logical edge remaining only as an internal renderer edge.
- The merged logical polygon may span renderer material groups; later operators that require one flat/material-uniform polygon may still reject that n-gon.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Face Mode -> select one Cube face -> Delete. The Cube object must remain with one open side.
2. Undo restores the original Cube.
3. Edge Mode -> select one edge -> RMB -> Dissolve Edge. Two Quads become one n-gon.
4. Vertex Mode -> select one vertex -> Delete. Faces using the vertex are removed.
5. Exit/re-enter Edit Mode after each operation and confirm logical polygons remain intact.
