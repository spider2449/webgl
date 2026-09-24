# Graph Navigation Upgrade

Date: 2026-09-24

## Goal

Upgrade Forge Studio's Graph Editor from a fixed full-scene view into a navigable editing surface while preserving the existing single-active-scalar-channel architecture.

Blender Graph Editor navigation is the UX reference:

- MMB pans the view.
- Mouse wheel zooms.
- Home frames all keys.
- Numpad Period frames selected keys.
- Numpad 0 centers the view on the current frame.
- Scene/preview range framing restores the horizontal timeline range.

Forge adopts those interaction ideas without introducing multi-curve display or Blender's broader F-Curve data model.

## View state

The Graph Editor now owns a view transform with:

- frameMin
- frameMax
- valueMin
- valueMax

Default view remains compatible with the existing Forge behavior:

- horizontal frame range starts at 1–250,
- vertical range fits the active scalar channel.

After the user manually navigates, that view is preserved independently for each selected object + scalar channel pair.

Changing from Location X to Rotation Y and back restores the previous Location X view.

Graph view operations do not create editor history entries.

## Mouse navigation

### MMB pan

Dragging with the middle mouse button pans both axes.

The content follows the pointer:

- horizontal pointer movement pans frame space,
- vertical pointer movement pans value space.

Escape or pointer cancellation restores the exact view that existed before the pan began.

### Wheel zoom

Mouse wheel zooms both frame and value axes around the pointer position.

The frame span is bounded so the Graph cannot collapse to a zero-width view or expand without practical limits.

Value zoom similarly enforces a nonzero finite span.

## Framing controls

The Graph title row exposes four view actions:

- Frame All — fits all authored keys and the active channel value range.
- Frame Selected — fits only the selected Graph keys.
- Scene Range — restores horizontal frame range 1–250 while preserving vertical view.
- Current Frame — keeps the current zoom span and centers it on the playhead.

These operations are view-only and create no undo history.

## Keyboard shortcuts

When the Graph SVG has focus:

- Home → Frame All
- Numpad Period → Frame Selected
- Numpad 0 → Center Current Frame

Graph pointer interaction focuses the Graph so these shortcuts remain local to the editor instead of hijacking the rest of Forge.

## Editing under navigation

All existing Graph editing must remain correct after pan / zoom:

- box selection,
- single and multi-key selection,
- key drag,
- Alt-drag copy,
- Bezier handle drag,
- precise Key Inspector editing,
- precise Bezier Handle Inspector editing.

Pointer-to-frame and pointer-to-value conversion now uses the active Graph view instead of hardcoded 1–250 coordinates.

Graph content outside the current plot rectangle is SVG-clipped so zoomed or panned curves, keys and handles do not draw over axis labels.

## Playhead

The playhead uses the current Graph view transform.

When the current frame lies outside the visible frame range, the playhead is clamped to the nearest Graph edge and shown with the existing outside-view treatment.

## Explicit non-goals

- no multiple F-Curves rendered simultaneously,
- no synchronized Graph/Timeline visible range in this package,
- no persistent project-file Graph viewport state,
- no Ctrl-MMB axis-only scaling yet,
- no scrollbars,
- no local-view channel isolation.

## Validation

Focused Playwright coverage must verify:

1. Frame All / Frame Selected / Scene Range / Current Frame.
2. Wheel zoom changes view state without editor history.
3. MMB pan changes view state without editor history.
4. Escape cancels Graph pan and restores the starting view.
5. Each scalar channel preserves its own manual view.
6. Key dragging after navigation maps to the correct authored frame.
7. Home / Numpad Period / Numpad 0 work while the Graph has focus.
8. Existing Graph selection, drag, handle and Timeline regressions still pass.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
