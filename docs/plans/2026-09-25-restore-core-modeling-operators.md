# Restore core modeling operators

## Problem

Manual validation showed that Bevel, Loop Cut and Inset Face were not usable enough from the current Blender-style RMB workflow.

The causes were not identical:

- Bevel already had a polygon-native core, but needed real RMB-to-worker coverage on a default logical Cube.
- Loop Cut still mapped the logical edge back to a renderer-triangle edge and reconstructed quads from triangle pairs.
- Inset Face still rejected logical quads and only called the legacy triangle helper.

## Goal

Make all three operators work on Forge's authoritative logical polygon topology and keep renderer triangulation display-only.

## Scope

### Bevel

- Keep the existing polygon-native bevel implementation.
- Verify one selected logical Cube edge and multi-edge cases.
- Verify the real RMB command mutates geometry through the worker.
- Preserve explicit polygon groups after the operation.

### Inset Face

- Accept one convex logical Triangle / Quad / N-gon.
- Offset the polygon boundary inward in its face plane.
- Keep the inner polygon at the original logical face id.
- Add one ring Quad for every original boundary edge.
- Interpolate corner attributes from the original renderer triangles.
- Reject collapse / excessive distance rather than changing the boundary silently.

### Loop Cut

- Accept one logical boundary edge.
- Traverse opposite edges directly through logical Quads.
- Stop/reject at triangles or N-gons.
- Split each traversed Quad into two logical Quads.
- Preserve attributes at midpoint corners.
- Persist the output polygon groups; do not fall back to generic renderer triangles.

## Expected default Cube results

Inset one Quad:
- 6 → 10 logical Quads
- 8 → 12 logical vertices
- 12 → 20 renderer triangles

Loop Cut one edge ring:
- 6 → 10 logical Quads
- 8 → 12 logical vertices
- 12 → 20 renderer triangles

Bevel one sharp logical edge:
- polygon and logical vertex counts must increase
- no renderer diagonal becomes a modeling edge

## Non-goals

- multi-face inset
- variable-width bevel segments
- sliding Loop Cut position
- triangles/N-gons inside a Loop Cut ring
- Blender's full operator modal system

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks should use a default Cube without deleting logical metadata:

1. Edge mode → select one edge → RMB → Bevel Edges.
2. Undo, select one edge → RMB → Loop Cut.
3. Undo, Face mode → select one Quad → RMB → Inset Face.
4. Re-enter Edit Mode after each operation and confirm the result remains logical polygons rather than renderer triangles.
