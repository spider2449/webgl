# Connected planar region extrusion

Add Extrude planar region for a connected, consistently oriented coplanar set of
triangle faces. Use the existing positive local Extrusion distance. Offset all
selected caps along one normal and add walls only at selected-region boundaries;
internal selected edges receive no walls. Preserve cap selection for repeated
region extrusion and translation. Keep existing single-triangle extrusion/inset.

Validate triangle layouts, indices, groups, 100k input vertices / 200k triangles,
selected-edge manifold incidence, region edge connectivity and simple boundary
loops before mutation. Reject nonplanar, disconnected, degenerate, ambiguous
boundaries and Float32-collapsed results. Boundary holes are supported by their
oriented boundary loops. Preserve UV/color seams and material groups; wall UVs
inherit endpoint values. Enforce the scene vertex budget before installation.

General curved-surface region normals, inward extrusion, intersections/collisions,
automatic wall UV unwrapping and topology workers remain outside this increment.

Validate a two-triangle cube side, indexed/non-indexed inputs, no internal walls,
boundary holes, material/attribute preservation, invalid-input zero effect,
real Shift-click face selection, repeat extrusion, movement, undo/redo and
project restoration. Run production build and full browser suite.

Status: complete (2026-09-10). Production build and the full 57-test suite
passed. After adding a material/attribute seam regression, all seven region
tests passed; the suite now contains 58 tests. Coverage includes indexed and
non-indexed closed cube sides, repeated extrusion without internal walls,
annular cap area and inner-wall orientation, UV/normalized-color seams,
adjacent-face wall materials, invalid-input zero effect, actual Shift-click face
selection, cap group movement, undo/redo and exact project restoration.
`git diff --check` passes. The existing Vite bundle-size warning remains.
Changes are local and uncommitted.
