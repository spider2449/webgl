# Component Rotate / Scale

## Goal

Bring Forge Edit Mode closer to Blender's basic mesh transform workflow: selected vertices, edges and faces must support Move, Rotate and Scale rather than Move only.

## Scope

- Vertex / Edge / Face component selections support TransformControls translate, rotate and scale.
- G / R / S shortcuts select the corresponding component transform tool.
- RMB Vertex / Edge / Face context menus expose Move / Rotate / Scale.
- Rotate and Scale operate around the current component selection center.
- Object transforms remain unchanged; only selected geometry vertices move.
- World / Local transform orientation uses the existing orientation control.
- Proportional Editing weights apply to Move, Rotate and Scale.
- Transform snapping continues to use existing translation / rotation / scale snap values.
- Undo / Redo / project save-load preserve transformed geometry.

## Transform model

The component proxy lives in world space at the selection pivot.

At drag start Forge captures:

- source geometry positions
- proportional weights
- mesh world matrix and inverse
- component-proxy world matrix

During the drag Forge computes:

`currentProxyWorld * inverse(startProxyWorld)`

and applies that delta to each source vertex through world space, then converts it back into mesh-local coordinates. Proportional weights interpolate from the original local position toward the fully transformed local position.

This keeps component transforms independent from the object's own transform and handles translated / rotated / scaled objects without modifying the object transform itself.

## Pivot

This PR deliberately uses the existing component selection center (median of unique selected logical vertices).

Future Blender-style pivot modes are separate work:

- Median Point
- Bounding Box Center
- Individual Origins
- Active Element
- 3D Cursor

## Non-goals

- no new topology operators
- no modal numeric-entry transform system
- no pivot-mode selector
- no Normal transform orientation
- no component gimbal implementation separate from existing Local behavior

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. In Edit Mode select vertices, edges and faces and use G / R / S.
2. Rotate / Scale should affect geometry around the selection center, not the whole object.
3. RMB context menus should expose Move / Rotate / Scale in all three component modes.
4. World / Local orientation should change gizmo orientation as expected.
5. Proportional Editing should affect nearby unselected vertices for rotation and scale.
