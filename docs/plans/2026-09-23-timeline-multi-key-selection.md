# Timeline Summary-Key Multi-Selection

Date: 2026-09-23

## Goal

Extend the existing Timeline summary-marker interaction so multiple union frames can be selected and retimed together without introducing a second animation model.

## Scope

- Shift-click Timeline summary markers to toggle selection.
- Plain click/drag on an unselected marker replaces the Timeline selection with that marker.
- Dragging any selected marker applies one shared integer frame delta to every selected summary frame.
- A selected summary frame still represents the union of scalar-channel keys authored at that frame.
- Every scalar key on every selected summary frame moves with the batch.
- Successful batch retiming creates one undo entry.
- Escape and pointer cancellation restore every selected source frame with no history entry.
- Timeline selection persists on the retimed target summary frames after a successful move.

## Atomic collision semantics

Before editing tracks, each participating scalar channel is checked independently.

The whole batch is rejected when:

- any target frame would leave the 1–250 range, or
- a moved key would collide with an unselected key on the same scalar channel.

A target summary frame occupied only by a disjoint scalar channel remains valid; summary markers may naturally merge.

## Graph Editor integration

If an active Graph-channel key is selected and its frame is part of the Timeline batch, its Graph selection follows the same frame delta after a successful retime.

Timeline and Graph selections remain separate UI concepts.

## Non-goals

This change does not add:

- Timeline box selection
- Alt-drag Timeline duplication
- Timeline interpolation or value editing
- cross-object retiming
- subframe keys
- Timeline time scaling
- a second transform-wide animation-key store

## Validation

Focused Playwright coverage must include:

1. Shift-selection of multiple Timeline summary frames.
2. Shared-delta retiming across different scalar channels.
3. One-step undo for the whole batch.
4. Atomic rejection when one participating scalar channel collides.
5. Shift-click toggle semantics.
6. Escape cancellation restoring all selected source frames.

Full Windows-local validation remains the merge gate for the exact PR HEAD.
