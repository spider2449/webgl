# Polygon-native Face Extrude

## Goal

Make single-face Extrude operate on Forge's logical polygon topology. Renderer triangles remain tessellation only.

Reference behavior: Blender Modeling manual, especially Mesh editing / Extrude Faces:
https://docs.blender.org/manual/en/latest/modeling/index.html

## Scope

- Accept one selected logical Triangle / Quad / N-gon.
- Move that polygon along its logical face normal.
- Replace the source face with the moved cap polygon.
- Create one side polygon for every source boundary edge.
- Preserve the cap's logical face id so repeated Extrude continues from the new cap.
- Tessellate output polygons only for Three.js rendering.
- Persist explicit polygon-to-renderer-triangle groups through Edit Mode re-entry and project save/load.
- Keep legacy triangle extrusion helpers intact for their focused low-level tests.

## Non-goals

- Polygon-native Inset.
- Multi-face region extrusion rewrite.
- Polygon-native Loop Cut.
- Interactive mouse-distance extrusion.
- UV remapping beyond preserving available corner attributes.

## Invariants

1. Modeling vertices, edges, and faces are authoritative.
2. Renderer tessellation must not introduce modeling vertices or selectable diagonals.
3. One Quad extrusion produces one Quad cap plus four side Quads, not separate triangle extrusions.
4. Repeating Extrude acts on the retained cap polygon.
5. Any topology-changing output stores fresh `polygonTriangles` metadata.
6. Unknown meshes remain triangle-polygons unless explicit logical polygon groups exist.

## Validation

Windows-local gate for the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual gate:
- Cube -> Edit Mode -> Face -> select top Quad -> Extrude.
- Result should contain a Quad cap and four side Quads.
- No renderer diagonal or internal tessellation point should become editable topology.
- Repeat Extrude from the retained cap.
- Save/load and re-enter Edit Mode; logical polygons must remain intact.
