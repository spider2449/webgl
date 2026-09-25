# Modeling panel action cleanup

## Goal

Keep Forge's Properties sidebar focused on persistent values, tool settings and state. Actions that are already available from the Blender-style viewport context menu should not remain as duplicate panel buttons.

## UX rule

- Viewport context / shortcuts: execute modeling operators.
- Properties / Tool Settings: edit operator parameters and persistent settings.
- Do not keep two equally prominent action buttons for the same operator after a viewport workflow replaces the panel workflow.

This follows the interaction direction established from Blender's modeling UX without copying Blender branding.

## Removed panel actions

The following action buttons are removed from the sidebar because the RMB context menu now provides them:

- Shade Smooth
- Shade Flat
- Extrude Face
- Extrude Region
- Inset Face
- Bevel Edges
- Loop Cut
- Subdivide Edges
- Snap Selection

## Retained settings

The panel still owns values that the context operators consume:

- Extrusion distance
- Inset distance
- Bevel width
- Snap target
- Proportional editing settings

The following remain because the context menu does not replace them:

- Primitive parameters / Apply Primitive
- Mirror Geometry
- UV tools
- Modifier stack
- Multi-object numeric operations
- Modeling busy state / Cancel Operation

## Architecture cleanup

Context menu entries call shared command functions directly. They no longer locate and click hidden or visible panel buttons.

Browser tests may call the same shared commands through the development-only `__forgeCommands` test surface. This tests the operator path without restoring duplicate UI controls.

## Validation

Windows-local validation for the exact PR head:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Object / Vertex / Edge / Face RMB menus still execute the same operators.
2. Replaced action buttons no longer appear in the Properties sidebar.
3. Extrusion distance, Inset distance, Bevel width and Snap target remain editable.
4. Mirror, UV, Modifiers and other non-replaced panel functions remain available.
