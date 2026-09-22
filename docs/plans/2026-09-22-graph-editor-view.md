# Graph Editor key curves and tangents

Add a bounded editable Graph Editor for scalar transform animation channels with per-key segment interpolation and cubic Bezier handles.

## Scope

- Display the Graph Editor in the Animation workspace.
- Add a left-side channel rail for Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Make the Graph Editor the sole animation editing UI; remove the duplicated Object-panel Animation controls.
- Keep object-wide and channel-wide Linear / Constant / Smooth metadata as backward-compatible project/API fallbacks only.
- Let every authored key override its outbound segment as Constant, Linear or Bezier.
- Show MIX on a channel when its segments use different effective interpolation modes.
- Visualize authored key points using the same sampling function as playback.
- Display unwrapped Euler rotation channels in degrees.
- Show the current frame as a moving playhead on the same 1–250 horizontal domain as the timeline.
- Report the authored key range and exact value range in the graph header.
- Selecting Bezier initializes a straight-line-equivalent right handle on the selected key and left handle on the next key.
- Drag left/right tangent handles directly in frame/value space.
- Constrain handle time coordinates to adjacent segments and prevent control-time crossing so frame→value remains single-valued.
- Drag a key vertically to edit the selected scalar value.
- Drag a key horizontally to retime the entire transform key to an integer frame.
- Alt-drag a key horizontally to copy the entire transform key to an empty frame.
- Never overwrite an occupied frame; the drag remains at its last valid frame.
- Apply key/tangent drag previews live without creating intermediate history entries.
- Commit one history entry when the pointer is released.
- Restore original key/tangent data on Escape or pointer cancellation.
- Preserve per-key curve metadata through key replacement, scalar edits, retime/copy, undo/redo and Forge project save/load.
- Keep the graph hidden outside the Animation workspace and on narrow mobile layouts.

## Data model

Each transform key may contain sparse per-channel curve metadata:

- `interpolation`: Constant, Linear or Bezier for the key → next-key segment.
- `right`: relative `[frameOffset, valueOffset]` for the key's outgoing Bezier control point.
- `left`: relative `[frameOffset, valueOffset]` for the incoming Bezier control point used by the previous key's Bezier segment.

Rotation handle value offsets are stored in radians with the key's unwrapped Euler values; the Graph Editor displays degrees.

Legacy projects with no key-curve metadata continue to use object/channel interpolation defaults without a project-version bump. Legacy quaternion-only rotation keys are upgraded to canonical Euler metadata when a rotation key curve is first authored; historical turn counts cannot be recovered from quaternion-only data.

## Data-model boundary

Forge transform keys still store Position, Rotation and Scale together at one frame. Therefore horizontal Graph Editor dragging retimes the entire transform key. Independent per-channel key times require a different animation data model and are not claimed here.

## Evaluation and export

- Constant holds the source key until the next key.
- Linear lerps scalar values.
- Legacy Smooth remains smoothstep fallback when no key-level override is authored.
- Bezier evaluates a real cubic curve in `(frame,value)` space: solve cubic X for the current frame, then evaluate cubic Y.
- Playback, scrubbing and Graph visualization use the same evaluator.
- GLB has no native per-axis/per-segment Bezier tangent representation; objects with key-curve interpolation are baked to LINEAR samples.
- Smooth/Bezier segments use 32 export samples per segment.
- Constant segments add a near-boundary hold sample.
- Mixed scalar/per-key GLB export remains an approximation.

## Non-goals

This increment does not add:

- independent per-channel key times,
- auto/aligned tangent modes,
- weighted tangent types,
- arbitrary F-curves,
- curve modifiers,
- batch curve operations,
- replacement of the existing timeline.

Handles are free but time-bounded; there is no automatic tangent coupling mode in this increment.

## Validation

Playwright coverage verifies:

- Graph Editor appears only in the Animation workspace.
- Nine graph-channel controls provide the only user-facing scalar-channel selection UI.
- The legacy Object-panel Animation controls are absent.
- Channel labels report LIN / CST / SMT / BEZ / MIX as appropriate.
- Different keys on one channel can author different outbound modes.
- Per-key Bezier and Constant segments evaluate independently.
- Bezier default handles reproduce the straight linear segment.
- Actual pointer dragging of a tangent changes playback evaluation.
- Tangent drag is one-step undoable/redoable.
- Curve metadata survives Forge project round trips.
- Malformed modes, handles and unknown curve fields fail closed.
- Per-key Bezier curves bake to LINEAR GLB samples matching the Forge evaluator.
- Rotation key curves upgrade legacy quaternion-only keys without orientation drift.
- Key value drag, whole-transform retiming, and Alt-drag key copy regressions remain covered.
- Occupied target frames are not overwritten.

This branch is intentionally held for Windows-local build, Playwright and manual interaction validation before merge.
