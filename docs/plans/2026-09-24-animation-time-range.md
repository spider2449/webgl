# Configurable Scene Frame Range

Date: 2026-09-24

## Goal

Remove Forge Studio's hard-coded 1–250 animation domain and replace it with a configurable Scene Frame Range.

The Scene Frame Range determines the length of the scene animation.

Defaults:

- Start: 1
- End: 250

The default 250 is not an animation-system maximum.

Forge supports Scene End values up to 100,000 as a defensive implementation limit.

## Blender terminology reference

Forge follows the same conceptual split used by Blender's Timeline:

- Scene Frame Range defines the scene animation length.
- Preview Range is a separate temporary playback range for repeatedly previewing a subsection.

References:

- https://docs.blender.org/manual/en/4.5/editors/timeline.html
- https://docs.blender.org/manual/en/4.5/editors/graph_editor/introduction.html

This package implements Scene Frame Range only.

Preview Range is an explicit non-goal and should be implemented separately.

## Authority

Editor owns:

- frameStart
- frameEnd
- animationRange
- setAnimationRange(start, end)

The Scene Frame Range must:

- use integer frames,
- start at frame 1 or later,
- have End greater than Start,
- remain at or below the defensive 100,000-frame ceiling.

All authored animation operations use the current Scene Frame Range.

## Authored keys

Keyframes are valid only inside the active Scene Frame Range.

Therefore an extended range such as 1–1000 allows authored keys at frames 500, 900, and 1000.

Graph and Timeline operations use the dynamic range instead of assuming 1–250.

Shrinking the Scene Frame Range is rejected atomically when any existing authored key would be excluded.

Forge never silently deletes, clamps, or hides an authored key to make a range change succeed.

The user must move or remove conflicting keys first.

## Current frame

The current frame is constrained to the Scene Frame Range.

Changing the range clamps the current frame when necessary.

Timeline scrubbing and the Current Frame field both use Start / End.

## Playback

Until a separate Preview Range feature exists, playback uses the entire Scene Frame Range.

Playback:

- starts inside Start–End,
- loops inside Start–End,
- never numerically exceeds End,
- uses First / Last as Start / End.

A future Preview Range may override the playback subset without changing this Scene Frame Range.

## Timeline

Timeline ruler, scrubber, playhead, selection, key markers, Timeline drag/copy, and Timeline Time Scale use the dynamic Scene Frame Range.

Example:

- Start 1 / End 1000 produces a Timeline from 1 through 1000.
- A key at frame 900 is a normal authored key.
- Last Frame jumps to 1000.

## Graph Editor

Graph Editor receives Start / End from Editor.

Graph default view and Scene Range use the current Scene Frame Range.

Graph Frame All / Frame Selected also respect the authored Scene Frame Range.

Graph key drag, copy, precise Frame edit, Time Scale, tangent editing, and Bezier-handle editing continue to operate under the current dynamic range.

Graph navigation must support ranges wider than the previous 1000-frame view-span cap; its maximum horizontal span scales with the current scene range.

## Project persistence

Project format remains version 1.

New snapshots contain:

```json
"animationRange": {
  "start": 1,
  "end": 1000
}
```

Project load validates authored animation tracks against the stored Scene Frame Range.

Older projects without animationRange default to 1–250.

## Undo / redo

Changing Scene Frame Range is a project-state edit and participates in undo / redo.

Invalid range changes and rejected shrinking operations are atomic and must not alter history or scene state.

## Validation

Focused Playwright coverage verifies:

1. Default is 1–250 but End can extend to 1000.
2. Timeline ruler, scrubber and Current Frame update to the extended range.
3. Authored keys and Timeline markers work beyond frame 250.
4. Graph Scene Range and Frame All support a 5000-frame scene.
5. Current frame and Graph key editing work beyond frame 250.
6. Shrinking the range rejects authored keys that would be excluded.
7. Playback stays inside the configured Scene Frame Range.
8. Range changes undo / redo correctly.
9. .forge snapshots round-trip extended ranges and legacy projects default to 1–250.
10. Invalid ranges reject atomically.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
