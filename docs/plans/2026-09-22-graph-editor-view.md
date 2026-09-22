# Read-only Graph Editor view

Add a bounded Graph Editor visualization for scalar transform animation channels.

## Scope

- Display the currently selected Animation channel in the Animation workspace.
- Visualize authored key points and the effective interpolation curve.
- Support Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Show the effective Linear, Constant or Smooth mode after applying any per-channel override.
- Use the same sampling function as playback so the graph cannot drift from runtime evaluation.
- Display unwrapped Euler rotation channels in degrees.
- Show the current frame as a moving playhead.
- Auto-fit the visible frame range to the first and last authored key.
- Auto-fit the value range with small visual padding while reporting the exact curve min/max in the header.
- Cache the static curve and only move the playhead when the frame changes without data changes.
- Keep the graph hidden outside the Animation workspace and on narrow mobile layouts.

## Non-goals

This increment is visualization-only. It does not:

- drag or retime keys,
- edit scalar values from the graph,
- add Bezier handles or tangents,
- add per-segment interpolation,
- support arbitrary F-curves,
- replace the existing timeline.

## Validation

Playwright coverage verifies:

- the Graph Editor appears in the Animation workspace,
- selected channel and effective interpolation are reflected in graph metadata,
- Linear, Constant and Smooth produce different SVG paths,
- authored key points appear at the correct frames and values,
- the playhead follows scrubbed frames,
- Rotation Y preserves multi-turn values such as 270° and 720°,
- the graph is hidden outside the Animation workspace.

This branch is intentionally held for Windows-local build and Playwright validation before merge.
