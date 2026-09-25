# Logical Polygon Topology Foundation

Date: 2026-09-25

## Goal

Separate Forge's modeling interaction topology from the renderer's triangle substrate.

Users should select and manipulate logical faces and boundary edges, while Three.js/WebGL continues to render indexed triangles.

## Foundation implemented

- `MeshTopology` retains renderer/modeling-substrate `faces` and `edges`.
- It now also exposes:
  - `polygons`
  - `polygonTriangles`
  - `triangleToPolygon`
  - `polygonEdges`
  - `polygonEdgeToEdge`
- Forge Cube and Plane primitives pair each consecutive renderer triangle pair into one logical quad.
- Quad triangulation diagonals remain renderer edges but are excluded from viewport-selectable `polygonEdges`.
- Face raycasts map renderer `faceIndex` through `triangleToPolygon`.
- Component overlays and marquee selection use logical polygons / polygon edges.
- Face extrusion maps a logical polygon back to its renderer triangles. A quad uses the existing planar-region extrusion path.
- Triangle-only inset rejects a quad/n-gon rather than silently editing one renderer triangle.
- Non-topology edits preserve the logical-quad identity through `forgeLogicalQuads`.
- Topology-changing operations currently invalidate that transitional pairing metadata and rebuild generic triangle polygons.

## Deliberate limits

This is not yet a full persistent polygon mesh kernel.

After operations that change connectivity, such as extrusion, inset, subdivision, bevel, loop cut, or topology-changing modifiers, Forge currently rebuilds generic triangle polygons. The next stage should preserve or explicitly rebuild logical polygon metadata across those operations.

The renderer remains triangle-based throughout.

## Next stage

Implement polygon-preserving topology mutation, starting with:

1. Quad inset.
2. Quad extrusion that returns quad side/cap metadata.
3. Edge subdivision / loop cut that rebuilds logical polygon loops.
4. Persistent polygon metadata for imported meshes when reliable source polygon data exists.
