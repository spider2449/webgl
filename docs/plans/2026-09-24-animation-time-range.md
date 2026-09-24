# Animation Time Range

Date: 2026-09-24

## Goal

Add an explicit Scene Animation Range to Forge Studio without changing the existing authored-key domain.

Forge keeps authored animation keys valid on integer frames 1–250.

The configurable range:

- defaults to Start 1 / End 250,
- controls playback looping,
- controls the Timeline visible frame window,
- controls First / Last playback buttons,
- controls Graph Scene Range framing,
- persists in .forge project files.

Keys outside the active range remain valid, remain saved, and remain editable in the Graph Editor.

## Authority

Editor owns:

- frameStart
- frameEnd
- animationRange
- setAnimationRange(start, end)

The range must use integer frames in 1–250 with Start < End.

Changing the range:

- is blocked while playback or an animation drag is active,
- is one undoable project-state edit,
- does not delete or reject authored keys outside the new range,
- does not force the current frame into the range.

Current frame remains valid anywhere in 1–250.

## Playback

Playback starts from the current frame clamped into Start–End.

Playback loops only inside Start–End.

The end frame receives a full frame-duration hold while playback remains numerically within the configured range.

First Frame jumps to Start.
Last Frame jumps to End.

## Timeline

Timeline scrubber min/max follow Start / End.

Timeline ruler labels are regenerated from the active range.

Only summary keys inside Start–End are rendered in the Timeline.

Range-external keys remain authored and are not removed from scalar tracks.

Timeline box selection and Timeline previous/next key navigation operate only on keys visible inside the active range.

Current Frame input remains 1–250 so the user can inspect authored animation outside the playback window.

## Graph Editor

Graph default view and Graph Scene Range use Start–End.

Graph Frame All and Frame Selected remain authored-data operations and may reveal keys outside Start–End.

Graph key editing, retiming, copying, interpolation, tangent editing, and Graph Time Scale continue to use the global authored-frame domain 1–250.

Changing playback range does not make Graph keys outside the range invalid.

## Project format

Project version remains 1.

Optional field:

```json
"animationRange": {
  "start": 20,
  "end": 80
}
```

New snapshots include animationRange.

Older projects without animationRange load as 1–250.

Project validation still validates authored keys against the global 1–250 domain, independently from playback range.

## Validation

Focused Playwright coverage verifies:

1. Start / End update Timeline scrubber and ruler.
2. First / Last jump to Start / End.
3. Keys outside range remain authored but disappear from Timeline.
4. Graph Scene Range uses Start–End while Frame All can recover outside keys.
5. Current frame and Graph edits remain valid outside playback range.
6. Playback remains inside the configured range.
7. Range edits are undoable / redoable.
8. .forge save/load round-trips range and legacy projects default to 1–250.
9. Invalid ranges reject atomically without history mutation.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
