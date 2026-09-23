# Timeline summary-key dragging

Add direct horizontal mouse retiming for the key markers in Forge Studio's
timeline.

## Marker semantics

Timeline markers remain the union of all authored scalar-channel key frames for
the selected object. A marker is a summary of every channel that has a key at
that frame; it is not a new animation data model and does not introduce timeline
multi-selection.

Dragging a marker from source frame S to target frame T retimes every scalar key
on the selected object whose authored frame is S.

## Interaction

- Left-pointer down on a timeline diamond starts a drag.
- Pointer movement previews the marker position and scrubs the playhead to the
  candidate integer frame.
- Pointer release commits the retime.
- A click without horizontal frame movement only scrubs to that key.
- Escape or pointer cancellation restores the source marker/frame and creates no
  history entry.
- Window blur cancels an active timeline-key drag.
- Timeline scrubbing remains available everywhere outside the marker hit areas.

## Atomic collision rule

Before changing data, every channel represented by the source summary marker is
checked at the target frame.

If any moved channel already has an authored key at the target, the whole move is
rejected. No channel is partially retimed and no history entry is created.

A target marker may already exist because of other, disjoint channels. In that
case the move is allowed and the two summary markers merge visually at the
target frame.

## History and Graph selection

A successful timeline marker drag is one undoable operation across all affected
channels.

If the active Graph channel has a selected key at the source frame and that
channel participates in the timeline move, its Graph selection follows the key
to the target frame. Timeline markers themselves do not gain a separate
selection model.

## Non-goals

- timeline multi-selection,
- Shift/box selection in the timeline,
- Alt-drag timeline duplication,
- value editing from the timeline,
- cross-object retiming,
- subframe keys,
- time scaling from the timeline.

Those remain separate from the active-channel Graph Editor selection and batch
editing model.

## Validation

Playwright coverage verifies:

- dragging a transform summary marker retimes all nine authored channels,
- the successful multi-channel retime is one undo step,
- a collision on one participating channel rejects the entire summary move,
- Escape restores the source frame and adds no history entry.

Windows-local validation is required before merge.
