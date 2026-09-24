# Animation Preview Range

Date: 2026-09-24

## Goal

Add a Preview / Playback Range that is separate from the Scene Frame Range.

Forge already has a configurable Scene Frame Range that defines the authored animation domain.

Preview Range is a temporary playback subset inside that scene range.

Example:

- Scene Range: 1–1000
- Preview Range: 300–420

Authored keys at frames 100, 500 and 900 remain valid and visible.
Playback loops only from 300 through 420 while Preview Range is enabled.

## Blender terminology reference

Forge follows the same conceptual separation used by Blender:

- Scene Frame Range defines animation length.
- Preview Range temporarily limits playback to a subsection.

References:

- https://docs.blender.org/manual/en/4.5/editors/timeline.html
- https://docs.blender.org/manual/en/4.5/editors/graph_editor/introduction.html

## Authority

Editor owns optional:

- previewStart
- previewEnd
- previewRange
- playbackRange

`playbackRange` resolves to:

1. Preview Range when enabled.
2. Scene Frame Range when Preview Range is disabled.

Preview Range must:

- use integer frames,
- have Start before End,
- stay completely inside the Scene Frame Range.

Preview Range never changes authored-key validity.

## Playback behavior

When Preview Range is enabled:

- Play clamps the current frame into Preview Start–End before playback begins.
- playback loops inside Preview Start–End.
- First Frame jumps to Preview Start.
- Last Frame jumps to Preview End.

When Preview Range is disabled, these operations use the Scene Frame Range.

Current frame may sit outside Preview Range while playback is stopped.

## Timeline behavior

Timeline continues to display the entire Scene Frame Range.

Preview Range does not:

- rescale the Timeline,
- hide keys,
- change Timeline key selection,
- change Timeline drag/copy/scale bounds,
- change Graph key legality.

The Timeline track displays a non-interactive highlighted overlay for Preview Start–End.

Timeline controls expose:

- Preview toggle,
- P Start,
- P End,
- status text.

Editing P Start / P End enables Preview Range.

Clearing Preview Range returns playback to the full Scene Frame Range.

## Scene Range interaction

Scene Frame Range remains authoritative.

When a Scene Range change makes the active Preview Range invalid, Preview Range is cleared automatically.

Scene-range key-preservation rules remain unchanged.

## Project persistence

Project format remains version 1.

Preview Range is optional:

```json
"previewRange": {
  "start": 300,
  "end": 420
}
```

When disabled, the field is omitted.

Older projects without previewRange load with Preview Range disabled.

Project load rejects a Preview Range that falls outside the stored Scene Frame Range.

## Undo / redo

Preview Range edits are project-state edits.

Setting and clearing Preview Range participate in undo / redo.

Invalid Preview Range edits are atomic and do not mutate history.

## Validation

Focused Playwright coverage verifies:

1. Preview Range leaves the full Scene Timeline visible.
2. Timeline controls enable and clear Preview Range.
3. First / Last and playback use Preview Range.
4. Keys outside Preview Range remain visible and editable.
5. .forge snapshots round-trip Preview Range and legacy projects load disabled.
6. Preview Range edits undo / redo.
7. Invalid Preview Range edits reject atomically.
8. Shrinking Scene Range clears Preview Range when it no longer fits.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
