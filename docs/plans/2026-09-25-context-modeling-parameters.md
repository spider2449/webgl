# Context modeling parameters

## Goal

Keep Forge modeling actions and the parameters that immediately control those actions in the same viewport workflow.

The previous split was awkward: RMB executed Extrude / Inset / Bevel / Snap, but the values lived in Properties. This change makes the context menu self-contained.

## Interaction

Face Context:
- Extrude Distance: slider + numeric field
- Extrude Face
- Extrude Region
- Inset Distance: slider + numeric field
- Inset Face

Edge Context:
- Bevel Width: slider + numeric field
- Bevel Edges
- Subdivide Edges
- Loop Cut

Vertex Context:
- Snap Target: Vertex / Edge midpoint / Surface point
- Snap Selection

Move / Rotate / Scale remain normal context commands.

## Rules

1. Slider and numeric field stay synchronized.
2. The numeric field accepts the full operator range; the compact slider covers a useful interactive range.
3. Dragging a slider changes the pending parameter only. It does not repeatedly rebuild the mesh.
4. Enter in the numeric field executes the associated operator.
5. Enter in Snap Target starts Snap Selection using the chosen target.
6. Values persist for the current Forge session and reappear when RMB is opened again.
7. Properties no longer duplicates Extrude Distance, Inset Distance, Bevel Width or Snap Target.
8. Proportional Editing remains in Properties because it is persistent transform state, not a single topology operator parameter.
9. Modeling busy/cancel state remains in Properties under Modeling status.

## Architecture

The operator commands read from one `modelingToolSettings` state object rather than panel DOM elements.

The viewport menu edits the same state. Tests may access the development-only `__forgeModelingSettings` surface when they need to exercise an operator directly without reconstructing context-menu interaction.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Face RMB: drag Extrude Distance, type a value, then Extrude.
2. Reopen RMB: the last value remains.
3. Type a value and press Enter: the operator executes and the menu closes.
4. Edge RMB: Bevel Width works the same way.
5. Vertex RMB: Snap Target is selectable beside Snap Selection.
6. No Extrude / Inset / Bevel / Snap parameters remain in Properties.
7. Context menu remains usable near the bottom edge and in a small viewport.
