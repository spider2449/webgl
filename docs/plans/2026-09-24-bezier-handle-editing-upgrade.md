# Bezier Handle Editing Upgrade

Date: 2026-09-24

## Goal

Make Forge Studio's existing Free / Aligned / Auto Bezier tangent modes visibly distinct and directly editable, using Blender's Graph Editor behavior as the UX reference without expanding Forge's tangent data model in this package.

Blender references used for interaction semantics:

- https://docs.blender.org/manual/en/latest/
- https://docs.blender.org/manual/en/latest/animation/keyframes/introduction.html#visualization
- https://docs.blender.org/manual/en/4.5/editors/graph_editor/fcurves/properties.html

The relevant Blender behaviors are:

- Free handles move independently.
- Aligned handles remain opposite and collinear so the curve stays smooth at the key.
- Automatic handles are system-computed; manually moving one converts the handle to a manual aligned behavior.
- Active key handles expose precise Frame / Value coordinates.

Forge keeps its existing tangent enum in this package:

- free
- aligned
- auto

Vector and Auto Clamped are intentionally out of scope.

## Graph handle visualization

For the single selected Bezier key:

- Free handles use the Free visual treatment and independent-handle help text.
- Aligned handles use an explicit linked visual treatment with solid collinear connectors.
- Auto handles use an automatic visual treatment and tell the user that manual editing converts them to Aligned.
- The Graph SVG exposes the active tangent mode on handle and handle-line classes for deterministic UI testing.

## Auto manual-edit conversion

Auto remains computed from neighboring scalar keys until the user manually changes a handle.

When the user actually drags an Auto handle:

1. Materialize the current effective left/right automatic handles.
2. Change the selected key tangent mode to Aligned.
3. Apply the dragged side.
4. Couple the opposite side using the Aligned rule while preserving its own length when bounds allow.
5. Commit the entire operation as one undo entry.

Pointer down without a real movement does not convert Auto.
Dragging away and back to the original effective position restores the original track and creates no history.
Escape / pointer cancellation restores Auto and removes any materialized handles.

## Bezier Handle Inspector

A dedicated Bezier Handles row appears below the Graph Key Inspector.

When exactly one key touching a Bezier segment is selected, it shows:

- current tangent mode state
  - FREE · independent
  - ALIGNED · linked
  - AUTO · edit → ALIGNED
- editable handle side: Left or Right
- absolute handle Frame
- absolute handle Value
- Apply

Only sides backed by a Bezier segment are enabled.

Frame is allowed to be fractional because Bezier control points are not keyframes.
The edited handle must remain within Forge's monotonic editable segment bounds.

Value uses:

- native units for position and scale
- degrees for rotation channels

Apply or Enter performs one precise handle edit.
Escape discards an uncommitted field edit.

## Tangent semantics

### Free

Editing one side changes only that side.

### Aligned

Editing one side keeps the opposite handle collinear in the opposite direction while retaining the opposite handle's own length when segment bounds allow.

### Auto

The handle remains computed from neighboring keys until manual drag or precise Handle Inspector editing.
A real manual edit converts Auto to Aligned.

## History and cancellation

- A successful pointer handle drag is one undo entry.
- A successful Handle Inspector edit is one undo entry.
- No-op edits create no history entry.
- Escape / pointer cancellation restores the exact original track.
- Undo of an Auto-to-Aligned manual edit restores Auto and removes materialized manual handles.

## Existing architecture preserved

- Scalar animation tracks remain authoritative.
- No transform-wide animation model is reintroduced.
- No Vector or Auto Clamped tangent type is added.
- Existing Graph key selection, box selection, key dragging, time scaling, Timeline summary editing, and glTF export semantics are unchanged.

## Validation

Focused Playwright coverage must verify:

1. Free / Aligned / Auto have distinct Graph and inspector states.
2. Free precise handle editing changes only one side and is undoable.
3. Aligned precise editing keeps the opposite handle collinear and preserves its length.
4. Auto precise editing converts to Aligned and undo restores Auto.
5. Auto pointer dragging converts to Aligned after a real movement.
6. Auto still recomputes from neighboring key values before manual conversion.
7. Rotation Handle Inspector values display and edit in degrees.
8. Existing Graph tangent / handle regressions remain valid.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
