# Edit Mode Select All / Deselect All

## Goal

Add Blender-style whole-component selection shortcuts for Forge's logical mesh Edit Mode.

## Interaction

In mesh Edit Mode:

- **A** -> Select All
- **Alt+A** -> Deselect All

The same commands are exposed in Vertex / Edge / Face RMB context menus:

- **Select All   A**
- **Deselect All   Alt A**

Object Mode remains unchanged; A is intentionally not assigned there in this batch.

## Logical selection universe

Selection uses only the active logical component layer:

- Vertex -> `topology.logicalVertices`
- Edge -> logical `topology.polygonEdges` ids
- Face -> logical `topology.polygons` ids

Renderer triangulation diagonals therefore never enter Edge Select All.

## Selection behavior

Select All replaces the current component selection with the complete active-mode logical universe.

Deselect All replaces it with an empty selection.

Both commands:

- increment modeling selection version;
- refresh selected component overlays;
- update the component transform proxy;
- emit `component-selection`;
- do not mutate geometry;
- do not invoke a modeling worker;
- do not add an Undo history entry.

Edge selection keeps the existing active-edge convention: after Select All, the final logical edge in topology order is active. After Deselect All, both orange selected-edge and white active-edge overlays clear.

## Shortcut guards

The global shortcut handler already ignores:

- input fields;
- textareas;
- selects;
- open dialogs.

A / Alt+A additionally require:

- Edit Mode;
- not Weight Mode;
- no pending Knife operation;
- no pending Snap Target operation;
- no modeling worker job;
- no active transform drag.

## Geometry statistics integration

The existing viewport Geometry Statistics overlay listens to `component-selection`, so A / Alt+A immediately update SELECTED counts without dedicated statistics coupling.

For the default Cube:

- Vertex A -> selected statistics become V 8 / E 12 / F 6 / T 12;
- Edge A -> V 8 / E 12 / F 6 / T 12;
- Face A -> V 8 / E 12 / F 6 / T 12;
- Alt+A -> Obj 1 / V 0 / E 0 / F 0 / T 0.

## Regression coverage

Playwright verifies all three Edit component modes:

- A selects 8 / 12 / 6 logical components;
- Edge A renders 12 orange fat-line instances and one active white edge;
- Undo depth is unchanged;
- Geometry Statistics SELECTED becomes the complete Cube;
- Alt+A clears the selection;
- Edge selected/active overlays both become zero;
- Geometry Statistics SELECTED becomes zero geometry.

Additional tests verify:

- RMB Select All is enabled even with empty selection;
- RMB Deselect All is disabled when empty and enabled once a component is selected;
- Object Mode A does not alter object selection.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Cube -> Edit Mode -> Vertex -> A: all 8 vertices select; Alt+A clears.
2. Edge -> A: all 12 logical Cube edges select; no renderer diagonals; Alt+A clears both orange/white edge overlays.
3. Face -> A: all 6 logical faces select; Alt+A clears.
4. Enable Geometry Statistics and confirm SELECTED follows A / Alt+A immediately.
5. Return to Object Mode, duplicate the Cube, select only one Cube, press A: object selection must remain unchanged.
