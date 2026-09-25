# Blender-style Viewport Context Menu Foundation

## Reference

Forge uses the Blender Modeling manual as the primary UX reference for mesh editing:

- https://docs.blender.org/manual/en/latest/modeling/index.html
- https://docs.blender.org/manual/en/4.5/modeling/meshes/editing/introduction.html

Blender exposes mesh operators through the 3D Viewport menus, context menus, and shortcuts. Forge should follow the same context-sensitive principle without pretending to support Blender operators that are not implemented yet.

## Goal

Move common modeling actions closer to the viewport instead of requiring repeated travel to the Properties panel.

## Scope

- Reserve RMB for a viewport context menu.
- Keep MMB orbit and Shift+MMB pan.
- Add mode-sensitive Object / Vertex / Edge / Face context menus.
- Reuse existing Forge operator buttons and validation paths.
- Disable commands when the required selection is missing or modeling is busy.
- Keep the menu within viewport bounds.
- Add keyboard navigation with Up/Down and Escape.
- Update viewport/status help to advertise RMB Context.

## Initial menus

Object Context:
- Move
- Rotate
- Scale
- Frame Selected
- Duplicate
- Linked Duplicate
- Shade Smooth / Flat
- Delete

Vertex Context:
- Move
- Snap Selection

Edge Context:
- Move
- Bevel Edges
- Subdivide Edges
- Loop Cut

Face Context:
- Move
- Extrude Face
- Extrude Region
- Inset Face

## Non-goals

- Do not implement missing Blender operators just to populate the menu.
- Do not change polygon algorithms in this PR.
- Do not yet implement Blender's Ctrl-V / Ctrl-E / Ctrl-F operator popovers.
- Do not reproduce Blender visual styling exactly; copy interaction principles, not branding.

## Follow-up UX roadmap

1. Ctrl-V / Ctrl-E / Ctrl-F component operator popovers.
2. Vertex / Edge / Face selection hotkeys and clearer mode buttons.
3. Interactive operators driven by mouse movement rather than numeric fields only.
4. Adjust Last Operation style panel for operator parameters.
5. Better Delete/Dissolve choices in Edit Mode.
6. Polygon-native Inset and Loop Cut.
7. Additional selection tools such as loops, rings, shortest path and grow/shrink.
