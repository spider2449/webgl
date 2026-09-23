# Graph Editor key curves and tangents

Forge's Graph Editor is the sole detailed transform-animation editor.

## Current scope

- Nine independent scalar tracks: Location X/Y/Z, Rotation X/Y/Z and Scale X/Y/Z.
- Each scalar track owns its own key frames and values.
- The timeline's Insert/Remove transform-key controls are convenience operations across all nine tracks.
- The Graph header can insert or remove a key only on the active scalar channel.
- Vertical key drag edits the active scalar value.
- Horizontal key drag retimes only the active channel key.
- Alt-drag copies only the active channel key.
- Occupied target frames on that channel are never overwritten.
- Timeline markers and previous/next navigation use the union of all channel key frames.
- Rotation tracks store unwrapped radians and display degrees.

## Curves

Every scalar key may store:

- `interpolation`: Linear, Constant or Bezier for the outbound segment.
- `tangent`: Free, Aligned or Auto.
- `right`: relative outgoing Bezier control `[frameOffset,valueOffset]`.
- `left`: relative incoming Bezier control `[frameOffset,valueOffset]`.

Missing interpolation means Linear. Missing tangent means Free.

Free handles are independent. Aligned couples both sides into one line while
preserving the opposite handle length when possible within adjacent segment
bounds. Auto uses a monotone neighboring-key slope, flattens at extrema/sign
changes, displays computed handles and disables direct dragging.

## Evaluation and export

Playback, scrubbing, Graph rendering and GLB export use the same scalar-track
evaluation semantics.

- Linear lerps scalar values.
- Constant holds the source value.
- Bezier solves cubic X for frame and evaluates cubic Y.
- Bezier export uses 32 samples per segment.
- Constant export adds a near-boundary hold sample.
- Position, Rotation and Scale export on the union of their three scalar track times.
- Multi-turn Euler rotation receives bounded angular samples before quaternion export.
- glTF cannot preserve Forge's scalar tangent representation directly, so mixed/non-linear export is an approximation.

## Removed models

Forge does not support the superseded:

- transform-wide `userData.keyframes`,
- object-wide interpolation mode,
- channel-wide interpolation override,
- Smooth or Inherit interpolation layers.

Project loading fails closed if those legacy fields are present.

## Non-goals

- weighted tangent types,
- arbitrary F-curves,
- curve modifiers,
- batch curve operations,
- replacing the existing timeline.

## Validation

Playwright coverage verifies:

- nine independent channel tracks,
- channel-only key insertion/removal,
- channel-only move and Alt-drag copy,
- other channel timings remain unchanged,
- union timeline markers/navigation,
- Linear/Constant/Bezier per segment,
- Free/Aligned/Auto tangents,
- multi-turn rotation,
- per-channel property state colors,
- save/load and undo/redo,
- malformed scalar-track metadata fails closed,
- GLB union timing and curve baking.

This branch remains unmerged until Windows-local validation is reported.
