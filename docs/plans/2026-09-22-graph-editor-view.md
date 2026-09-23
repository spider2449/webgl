# Graph Editor key curves and tangents

Add a bounded editable Graph Editor for scalar transform animation channels with
per-key segment interpolation and cubic Bezier handles.

## Scope

- Make the Graph Editor the sole animation editing UI.
- Keep playback, current frame, Insert key and Remove key in the timeline header.
- Add a left-side channel rail for Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Use Linear as the only implicit/default segment mode.
- Let every authored key choose its outbound segment as Linear, Constant or Bezier.
- Show MIX on a channel when its segments use different modes.
- Visualize authored key points using the same sampling function as playback.
- Display unwrapped Euler rotation channels in degrees.
- Show the current frame as a moving playhead on the same 1–250 horizontal domain as the timeline.
- Selecting Bezier initializes a straight-line-equivalent right handle on the selected key and left handle on the next key.
- Drag left/right tangent handles directly in frame/value space.
- Add per-key/channel Free, Aligned and Auto tangent modes.
- Free keeps handles independent.
- Aligned couples both sides into one line while preserving the opposite handle length when possible within time bounds.
- Auto derives a monotone neighboring-key slope, shows computed handles and disables direct handle dragging.
- Constrain handle time coordinates to adjacent segments and prevent control-time crossing so frame→value remains single-valued.
- Drag a key vertically to edit the selected scalar value.
- Drag a key horizontally to retime the entire transform key to an integer frame.
- Alt-drag a key horizontally to copy the entire transform key to an empty frame.
- Never overwrite an occupied frame; the drag remains at its last valid frame.
- Apply key/tangent drag previews live without creating intermediate history entries.
- Commit one history entry when the pointer is released.
- Restore original key/tangent data on Escape or pointer cancellation.
- Preserve per-key curve metadata through key replacement, scalar edits, retime/copy, undo/redo and Forge project save/load.
- Reject the removed object/channel interpolation metadata on load.

## Animation model

Each transform key may contain sparse per-channel curve metadata:

- `interpolation`: Linear, Constant or Bezier for the key → next-key segment.
- `right`: relative `[frameOffset, valueOffset]` for the key's outgoing Bezier control point.
- `left`: relative `[frameOffset, valueOffset]` for the incoming Bezier control point used by the previous key's Bezier segment.

If a segment has no interpolation metadata, it is Linear.

There is no object-wide interpolation mode, no channel-wide interpolation
override, no Smooth mode and no Inherit mode.

Rotation handle value offsets are stored in radians with the key's unwrapped
Euler values; the Graph Editor displays degrees.

## Data-model boundary

Forge transform keys still store Position, Rotation and Scale together at one
frame. Horizontal Graph Editor move/copy therefore operates on the entire
transform key. Independent per-channel key times require a different animation
data model and are not claimed here.

## Evaluation and export

- Linear lerps scalar values.
- Constant holds the source key until the next key.
- Bezier evaluates a real cubic curve in `(frame,value)` space: solve cubic X for the current frame, then evaluate cubic Y.
- Playback, scrubbing and Graph visualization use the same evaluator.
- Pure Linear animation exports as LINEAR transform tracks.
- glTF has no native per-axis/per-segment Bezier tangent representation.
- Segments requiring baking export as LINEAR samples.
- Bezier segments use 32 samples per segment.
- Constant segments add a near-boundary hold sample.
- Mixed scalar/per-key GLB export remains an approximation.

## Non-goals

This increment does not add:

- independent per-channel key times,
- weighted tangent types,
- arbitrary F-curves,
- curve modifiers,
- batch curve operations,
- replacement of the existing timeline.

Handles are time-bounded. Free, Aligned and Auto coupling are implemented; weighted and custom tangent weighting are not.

## Validation

Playwright coverage verifies:

- the legacy Object-panel Animation controls are absent,
- nine graph-channel controls provide the only scalar-channel selection UI,
- Linear is the implicit default,
- different keys/channels can author Linear, Constant and Bezier independently,
- channel labels report LIN / CST / BEZ / MIX,
- per-key Bezier and Constant segments evaluate independently,
- Bezier default handles reproduce the straight linear segment,
- actual pointer dragging of a tangent changes playback evaluation,
- tangent drag is one-step undoable/redoable,
- Aligned dragging updates the opposite handle while preserving collinearity,
- Auto tangents recompute from neighboring keys and cannot be manually dragged,
- tangent modes survive Forge project round trips,
- removed object/channel interpolation fields are rejected,
- malformed curve modes, handles and unknown curve fields fail closed,
- per-key Bezier curves bake to LINEAR GLB samples matching the Forge evaluator,
- Rotation key curves upgrade quaternion-only keys without orientation drift,
- key value drag, whole-transform retiming and Alt-drag key copy remain covered,
- occupied target frames are not overwritten.

This branch is intentionally held for Windows-local build, Playwright and manual
interaction validation before merge.
