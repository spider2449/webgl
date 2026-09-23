# Independent channel key times

Replace transform-wide animation keys with independent scalar tracks.

## Data model

Each animated object stores sparse `userData.animationTracks` keyed by the nine
supported scalar transform channels.

Each scalar key contains:

- integer frame 1–250,
- native scalar value,
- optional Linear/Constant/Bezier outbound interpolation,
- optional Free/Aligned/Auto tangent mode,
- optional left/right relative Bezier controls.

Rotation scalar values are unwrapped radians.

The removed transform-wide `userData.keyframes` format is not migrated and is
rejected during project load.

## Authoring

- Timeline Insert key authors all nine scalar channels at the current frame.
- Timeline Remove key removes any scalar keys at the current frame.
- Graph Insert channel key authors only the active channel.
- Graph Remove channel key removes only the selected active-channel key.
- Graph vertical drag edits one scalar key.
- Graph horizontal drag retimes one scalar key.
- Alt-drag copies one scalar key.
- A target frame occupied on another channel is valid; only occupancy on the active channel blocks move/copy.

## Evaluation

Each scalar track evaluates independently. Channels with no track retain the
object's static transform component. Timeline markers and previous/next key
navigation operate on the union of scalar key frames.

Rotation channels evaluate as continuous Euler values and are converted to the
object's quaternion by Three.js.

## GLB

glTF transform channels target full vectors/quaternions, so export builds a
union sample schedule separately for Position, Rotation and Scale from their
three scalar tracks. Bezier and Constant segments are baked. Rotation adds
bounded angular subdivisions for multi-turn motion before quaternion export.

## Validation

- transform Insert key produces nine tracks,
- channel-only insert/remove does not create other tracks,
- channel move/copy leaves other channel timing unchanged,
- undo/redo and project round-trip preserve independent tracks,
- Graph shows only active-channel keys,
- timeline shows the union of key frames,
- property-state colors follow channel-specific key existence,
- multi-turn rotation survives evaluation and reload,
- rig full-pose keys use the same scalar-track model,
- GLB export respects union timing,
- old transform-wide animation data fails closed.

This branch remains unmerged until Windows-local validation is reported.
