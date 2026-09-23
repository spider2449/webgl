# Graph Editor box selection

Add direct rectangular key selection to the active Graph Editor scalar channel.

## Scope

- Drag empty Graph space to create a selection rectangle.
- Normal box selection replaces the current active-channel key selection.
- Shift-box selection adds enclosed keys to the existing selection.
- Empty click without Shift clears selection.
- Shift-empty click preserves the current selection.
- Escape or pointer cancellation restores the selection that existed before the box gesture.
- Box selection never changes key timing/value data and never creates history.

## Geometry

Selection operates in Graph view coordinates and is clamped to the visible plot
area. A key is selected when its marker center lies inside the rectangle.

The selection rectangle is rendered above the static curve/key layer and below
the playhead. It is non-interactive.

## Interaction with existing multi-key editing

Box-selected keys use the same selection state as Shift-click keys, so existing
batch behavior applies unchanged:

- drag selected keys to batch move,
- Alt-drag to ghost-copy and commit on release,
- Remove selected channel key removes the selected set,
- Segment/Tangent controls stay disabled for multi-selection.

## Non-goals

- lasso/freehand selection,
- cross-channel box selection,
- cross-object selection,
- selecting Bezier handles,
- selection by curve segment intersection.

## Validation

Playwright coverage verifies:

- box selection replaces an existing selection,
- Shift-box adds to an existing selection,
- the selection rectangle is visible only during the gesture,
- Escape restores the pre-drag selection,
- selection-only gestures do not alter undo/history.

This branch remains unmerged until Windows-local validation is reported.
