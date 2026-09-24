# Timeline View Navigation

Date: 2026-09-24

## Goal

Make the Timeline practical for long Scene Frame Ranges by separating the visible Timeline view from Scene / Preview / authored-key authority.

Example:

- authored frame domain: 1–100,000
- Scene Frame Range: 1–5000
- Preview Range: 300–420
- Timeline View Range: 450–650

The Timeline only maps and edits visible coordinates through 450–650, while Scene playback and project data remain unchanged.

## Authority

Timeline View Range is editor-only UI state.

It is not:

- saved in .forge,
- part of Scene Frame Range,
- part of Preview Range,
- part of authored-key validity,
- part of undo / redo.

Defaults:

- View Start = Scene Start
- View End = Scene End
- Manual = false

Changing Scene Frame Range:

- updates the Timeline view automatically while view is not manual,
- clamps a manual Timeline view into the new Scene Range,
- does not commit project history.

## Navigation

Timeline supports:

- mouse wheel: horizontal zoom around pointer anchor,
- middle-mouse drag: horizontal pan,
- Escape during MMB pan: restore exact starting view,
- horizontal View Scrollbar thumb drag: pan,
- View Scrollbar left/right handles: resize / zoom the visible range,
- empty View Scrollbar track click: page left/right,
- Escape during active scrollbar drag: restore the exact starting view,
- Scene Range button / Home: restore full Scene Start–End,
- Selected Keys button / Numpad .: frame selected Timeline summary keys,
- Current Frame button / Numpad 0: preserve zoom span and center current frame.

The Timeline track is focusable so its keyboard framing shortcuts are local to that view.

## Coordinate mapping

The Timeline view transform controls:

- ruler labels,
- key marker placement,
- preview-range overlay,
- playhead placement,
- scrubber min/max,
- box selection,
- summary-key drag / copy preview.

Current Frame input remains constrained by Scene Frame Range, not Timeline View Range.

Timeline move/copy/scale validation remains Scene Range authority.

## Selection

Timeline selection is preserved when selected keys are temporarily outside the current Timeline view.

Frame Selected can therefore recover selected summary keys after pan / zoom.

Only visible markers are rendered.

## Playback / Preview interaction

Timeline navigation never changes Scene or Preview ranges.

Preview overlay renders the intersection of Preview Range and the visible Timeline view.

If current frame is outside the visible Timeline view, the playhead clamps to the nearest edge and is visually dimmed.

## Mobile

The existing mobile Timeline toolbar keeps horizontal overflow contained inside itself.

Timeline view controls participate in that same toolbar without widening the document.

## Validation

Focused Playwright coverage verifies:

1. default view follows Scene Range,
2. Scene framing restores the full Scene view,
3. wheel zoom changes view without project/history mutation,
4. MMB pan changes view and Escape restores it,
5. selected-key framing,
6. current-frame centering,
7. key drag uses the active navigated transform,
8. Home framing shortcut while Timeline has focus.
9. View Scrollbar thumb pan without project/history mutation.
10. View Scrollbar handle resize.
11. Empty scrollbar track paging.
12. Escape cancellation of scrollbar drag.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
