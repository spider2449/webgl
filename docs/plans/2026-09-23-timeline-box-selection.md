# Timeline Box Selection

Date: 2026-09-23

## Goal

Extend the existing Timeline summary-key selection workflow with bounded horizontal box selection while preserving normal Timeline scrubbing and the scalar-track animation model.

## Interaction

- **Shift-drag empty Timeline space** previews a horizontal selection box.
- Summary markers whose frame positions fall inside the box are added to the existing Timeline selection.
- Shift-click marker toggling remains unchanged.
- Plain Timeline interaction without Shift remains normal scrubbing.
- Dragging a selected marker after box selection reuses the existing atomic multi-key retime behavior.
- A Shift-click on empty Timeline space without meaningful drag leaves the selection unchanged.

## Cancellation

- Escape during box selection restores the selection that existed before the drag.
- Pointer cancellation and window blur do the same.
- Cancelling Timeline box selection must not deselect the active object.
- Timeline selection changes create no history entry.

## Model

Timeline markers remain the union of authored scalar-channel key frames.

Box selection only selects summary frame positions. It does not create transform-wide keys, cross-channel key objects, or a second animation store.

## Non-goals

- plain-drag box selection, because plain drag remains Timeline scrubbing
- subtractive box selection
- Timeline Alt-drag duplication
- Timeline time scaling
- cross-object selection or retiming
- subframe keys

## Validation

Focused Playwright coverage must verify:

1. Shift-drag adds all summary markers inside the horizontal interval.
2. Existing Timeline selection is preserved and the boxed markers are added.
3. The resulting selection can be batch-retimed through the existing drag workflow.
4. Escape restores the pre-box selection and keeps the active object selected.
5. Shift-click without meaningful box movement leaves selection unchanged.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
