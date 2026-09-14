# Animation interpolation

Continue Phase 3 with per-object Linear, Constant and Smooth interpolation.
The setting applies to all transform segments on the selected object. Existing
projects default to Linear. Smooth uses smoothstep time with quaternion slerp.

- Add a selector to the existing Animation properties.
- Preserve the setting through undo/redo and Forge projects; reject unknown modes.
- Export Constant as STEP and Smooth as a sampled linear GLB track (32 samples
  per segment). Smooth export is an approximation between samples.
- Verify segment boundaries, rotation/scale, selection isolation, invalid input,
  persistence, UI, exported tracks, build and the complete browser suite.

Editable Bezier handles, per-channel curves and per-key interpolation are deferred.

Status: complete for this scope. Production build and all 88 one-worker browser
tests pass, including two new interpolation tests covering transform evaluation,
history/project restoration, invalid requests, selection changes and downloaded
GLB sampler modes and smooth sample values. The rendered Animation selector was
reviewed; `git diff --check` passes. Vite still reports its existing main-bundle
size warning. Changes remain local and uncommitted.
