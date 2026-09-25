# Viewport Box Selection

Date: 2026-09-25

Base: `f3053638584578e848c207ff55b29a58b7b3f549`

## Goal

Replace Shift-click-only accumulation with a simple viewport marquee that supports modeling and weight workflows.

## Behavior

- Left-drag more than 4 px starts a box marquee.
- Object Mode selects scene-object centers inside the rectangle.
- Edit Mode:
  - Vertex: projected logical vertex position inside
  - Edge: projected edge midpoint inside
  - Face: projected triangle centroid inside
- Weight Mode uses the same vertex rule.
- Shift-drag adds to the current selection.
- Escape and pointer cancellation cancel the marquee without mutating selection.
- Alt-left orbit is not treated as box selection.
- Click selection semantics remain unchanged.

## Non-goals

- left-to-right vs right-to-left window/crossing semantics
- occlusion filtering / select-through preference
- lasso or circle selection
- logical quad/polygon selection

## Validation

Run on exact PR HEAD:

- `npm run build`
- `npm test -- --workers=2`
- manual Object Mode box selection and Shift-add
- manual Vertex / Edge / Face box selection
- manual Weight Mode vertex box selection
- Escape cancellation and Alt-orbit smoke test
