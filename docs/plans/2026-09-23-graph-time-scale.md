# Graph Editor selected-key time scaling

Add a bounded numeric timing-scale operation for the active Graph Editor scalar
channel.

## Scope

- The operation requires at least two selected authored keys on the active
  channel.
- The user enters a positive finite scale factor and applies it explicitly.
- The pivot is the midpoint between the earliest and latest selected frames.
- Each selected frame is transformed by:
  `pivot + (frame - pivot) * factor`.
- Resulting frames are rounded to integer timeline frames.
- Successful scaling preserves the selected set at the new frames.
- The scale field resets to 1 after a successful apply.
- Values, interpolation modes, tangent modes, and stored Bezier handle offsets
  are otherwise unchanged.
- The entire operation creates exactly one undo history entry.

## Atomic validation

Before mutating the track, every target frame is computed and validated.

The operation is rejected without changing track data when:

- the factor is not positive and finite,
- fewer than two authored keys are selected,
- any target leaves frames 1–250,
- integer rounding causes two selected keys to collapse onto one frame,
- any target collides with an unselected key on the active channel.

The operation is also a no-op when the chosen factor produces the same integer
frames after rounding.

## Pivot semantics

This task intentionally uses the center of the selected frame range as the only
pivot. It does not add cursor-pivot, current-frame pivot, active-key pivot, or
custom pivot modes.

For two selected keys, the pivot may be a half-frame. Only resulting key frames
are rounded; the pivot itself remains exact during the calculation.

## Non-goals

- Blender-style interactive S-key scaling,
- value-axis scaling,
- negative factors / time reversal,
- proportional key editing,
- cross-channel or cross-object scaling,
- custom pivot modes,
- changing Bezier handle offsets as part of the scale,
- subframe-authored keys.

## Validation

Playwright coverage verifies:

- Time Scale is disabled until at least two Graph keys are selected,
- a factor of 2 scales selected timing around the selection midpoint,
- successful scaling preserves the retimed selection,
- one undo restores the original key frames,
- collision with an unselected key is rejected atomically,
- rounding collapse is rejected atomically,
- out-of-range targets are rejected atomically.

Windows-local validation remains required before merge.
