# Graph Editor channels and key editing

Add a bounded editable Graph Editor for scalar transform animation channels.

## Scope

- Display the Graph Editor in the Animation workspace.
- Add a left-side channel rail for Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Keep graph channel selection synchronized with the Object → Animation channel selector.
- Show each channel's effective Linear / Constant / Smooth mode.
- Visualize authored key points using the same sampling function as playback.
- Display unwrapped Euler rotation channels in degrees.
- Show the current frame as a moving playhead on the same 1–250 horizontal domain as the timeline.
- Report the authored key range and exact value range in the graph header.
- Drag a key vertically to edit the selected scalar value.
- Drag a key horizontally to retime the entire transform key to an integer frame.
- Never overwrite an occupied frame; the drag remains at its last valid frame.
- Apply drag previews live to the selected object without creating intermediate history entries.
- Commit one history entry when the pointer is released.
- Restore the original key data on Escape or pointer cancellation.
- Keep the graph hidden outside the Animation workspace and on narrow mobile layouts.

## Data-model boundary

Forge transform keys currently store Position, Rotation and Scale together at one frame. Therefore horizontal Graph Editor dragging retimes the entire transform key. Independent per-channel key times would require a different animation data model and are not claimed here.

Vertical edits are scalar-channel edits. Rotation values remain unwrapped Euler degrees and regenerate synchronized quaternion data.

## Non-goals

This increment does not:

- add Bezier handles or tangents,
- add independent per-channel key times,
- add per-segment interpolation,
- support arbitrary F-curves,
- replace the existing timeline.

## Validation

Playwright coverage verifies:

- the Graph Editor appears only in the Animation workspace,
- nine graph-channel controls are present and synchronize with the Object panel,
- effective interpolation labels update,
- Linear, Constant and Smooth produce distinct SVG paths,
- authored key points have correct frame/value metadata,
- playhead follows scrubbing,
- Rotation Y preserves 270° → 720° multi-turn values,
- vertical pointer dragging edits one scalar value and is undoable,
- horizontal pointer dragging retimes the full transform key,
- occupied target frames are not overwritten.

This branch is intentionally held for Windows-local build, Playwright and manual interaction validation before merge.
