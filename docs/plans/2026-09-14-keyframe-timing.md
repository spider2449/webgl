# Keyframe timing

Continue the Phase 3 animation workflow with explicit keyframe selection and
numeric move/copy actions in the Animation properties.

- List transform keys for the selected object and scrub to the chosen key.
- Move or copy the current key to an integer frame from 1 through 250.
- Preserve the authored pose and object interpolation; keep keys sorted.
- Reject occupied destinations, missing source keys, invalid frames, playback
  and Edit Mode before mutation. Moving to the same frame is a no-op.
- Follow the resulting key and record a single undo step.
- Verify timing evaluation, isolation, history/project persistence, exported GLB
  timing, UI controls, build, full browser regression and screenshot.

Scope is one object's complete transform key at a time. Dragging keys, batch
retiming and per-channel curve editing remain future work.

Status: complete. All 91 one-worker browser tests passed. A final mode-event UI
refresh correction was then verified with all five animation tests, including
Edit Mode disabling and re-enabling the controls. The final production build
and `git diff --check` pass; the existing Vite bundle-size warning remains.
Screenshot reviewed. Tests cover independent copied pose arrays, interpolation,
history/project restoration, rejection without scene/frame/history changes,
selection changes and actual downloaded GLB timestamps. Changes are local and
uncommitted.
