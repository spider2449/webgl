# Timeline Editing Upgrade

Date: 2026-09-23

## Goal

Turn the Timeline summary-key workflow into a practical batch editing surface rather than a selection-and-move-only view.

This package adds three related operations on the existing Timeline summary-frame selection:

1. Alt-drag duplication.
2. Batch deletion.
3. Batch time scaling.

The scalar animation-track model remains authoritative. Timeline selection continues to represent the union of authored scalar-channel key frames.

## Alt-drag duplication

- Alt-drag any selected Timeline marker to copy the entire selected summary-frame set by one shared whole-frame delta.
- Every scalar key authored at each selected summary frame is copied.
- Source keys remain in place.
- Copy ghosts preview the target frames during the drag.
- The operation is atomic across participating scalar channels.
- If any copied scalar key would collide with an existing key on the same channel, the whole copy is rejected.
- Targets must remain within frames 1–250.
- A successful multi-frame copy creates one undo entry.
- Escape, pointer cancellation, or a zero-delta drag creates no history entry and removes the preview.

## Batch deletion

- The Timeline header exposes a remove-selected control.
- Delete/Backspace removes the selected Timeline summary frames when Timeline selection is active.
- This also works when the transparent Timeline scrubber retains keyboard focus.
- Every scalar key authored at the selected summary frames is removed.
- The active object remains selected.
- One batch deletion creates one undo entry.

## Timeline Time Scale

- The Timeline header exposes a positive Time Scale factor and Scale action.
- Two or more selected Timeline summary frames are required.
- Frames scale around the midpoint of the selected summary-frame range.
- Results are rounded to integer frames.
- The entire operation is rejected when:
  - a result leaves frames 1–250,
  - rounding collapses two selected summary frames,
  - or any participating scalar channel would collide with an unselected key.
- A successful scale creates one undo entry and keeps the resulting summary frames selected.

## Graph selection integration

When a selected Graph key participates in a successful Timeline move, copy, or time scale, the Graph selection follows the resulting target frame.

Graph and Timeline selections remain separate UI concepts. Timeline operations do not create cross-channel Graph keys or a second animation store.

## Existing interactions preserved

- Shift-click Timeline summary markers toggles selection.
- Shift-drag empty Timeline space adds boxed summary markers.
- Plain Timeline drag remains frame scrubbing.
- Plain marker drag moves the selected summary-frame set.
- Escape clears or cancels Timeline state before object selection is affected.

## Non-goals

This package does not add:

- Timeline interpolation or value editing
- subtractive box selection
- cross-object key editing
- subframe keys
- arbitrary pivot selection for time scaling
- a transform-wide keyframe data model

## Validation

Focused Playwright coverage must include:

1. Multi-summary Alt-copy across different scalar channels.
2. One-step undo for Alt-copy.
3. Atomic copy collision rejection.
4. Delete/Backspace removing selected summary frames without deleting the active object.
5. One-step undo for Timeline deletion.
6. Timeline Time Scale across different scalar channels.
7. One-step undo for Timeline Time Scale.
8. Atomic Timeline Time Scale collision rejection.
9. Existing Timeline drag, multi-selection, and box-selection regressions.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
