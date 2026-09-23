# Graph Editor multi-key selection

Add bounded multi-key editing to one active scalar animation track.

## Scope

- Click a key for single selection.
- Shift-click toggles keys into or out of the current selection.
- Selection is local to the active Graph channel and clears when object/channel changes.
- Segment and tangent controls remain single-key operations and are disabled for multi-selection.
- Drag any selected key to move the entire selected set with one shared frame/value delta.
- Alt-drag the selected set to show ghost copies; source keys remain in place until pointer release.
- Copy data is not written to `animationTracks` until pointer release.
- Remove selected channel key deletes the entire selected set.
- Escape/pointer cancellation restores source selection/data.
- Pure click selection does not create an undo entry.

## Transaction rules

Batch move/copy is atomic.

Before previewing a delta, validate every target frame:

- all targets must remain in frame 1–250,
- target frames must remain unique,
- move may overlap frames belonging to the selected source set,
- move may not collide with unselected keys,
- copy may not collide with any existing key.

If any target is invalid, no key in the selection moves or copies.

A completed batch move, copy, or delete creates exactly one history entry.

## UI

Selected keys share the existing selected marker styling.

Alt-copy draws temporary ghost markers while the pointer is held. Ghosts are
non-interactive and disappear on release/cancel.

The Graph header reports the selected count when more than one key is selected.

## Non-goals

- box/lasso selection,
- cross-channel selection,
- cross-object selection,
- scaling key timing around a pivot,
- proportional key editing,
- batch interpolation/tangent assignment.

## Validation

Playwright coverage verifies:

- Shift-click selection toggling,
- multi-selection disables single-key interpolation/tangent controls,
- batch remove and one-step undo,
- batch move preserves relative timing/value offsets,
- batch collision is all-or-nothing,
- Alt-copy shows ghosts while source data is unchanged,
- Alt-copy commits the full set only on pointer release,
- copied keys become the selected set,
- pure click selection stays out of undo history.

This branch remains unmerged until Windows-local validation is reported.
