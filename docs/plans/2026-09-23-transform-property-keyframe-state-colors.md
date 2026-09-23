# Transform property keyframe state colors

Add Blender-style visual state feedback to the Object panel's transform fields.

## Scope

State is calculated independently for Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z:

- Neutral: the scalar channel has no animation track.
- Yellow: that channel has a key on the current frame and the displayed value matches it.
- Green: that channel has animation keys, but not on the current frame.
- Orange: the live value differs from the scalar track's evaluated value and has not been keyed.

Existing X/Y/Z axis letter colors remain unchanged. State refreshes during
scrub, playback, gizmo/numeric edits, channel or transform key insertion/removal,
undo/redo and project load.

## Data-model relationship

Forge stores nine independent scalar animation tracks. A transform-wide Insert
key is only a convenience operation that adds one key to every channel at the
same frame. Graph channel-key insertion can therefore produce states such as
Location X yellow while Location Y/Z remain neutral, or one channel yellow while
another animated channel is green.

## Validation

Playwright coverage verifies:

- all fields start neutral,
- transform-wide insert marks all nine channels keyed-current,
- scrubbing away marks animated channels green,
- an unkeyed scalar edit marks only that field orange,
- channel-only insert marks only the chosen channel yellow,
- channels without tracks remain neutral,
- channels with different key times show their own yellow/green state.

This branch remains unmerged until Windows-local validation is reported.
