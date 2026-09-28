# Forge Studio Testing Workflow

Forge Studio has grown beyond 300 Playwright tests. Running the entire suite after every small edit slows development and makes iterative debugging unnecessarily expensive.

The repository therefore uses layered validation. Faster layers improve feedback time; they do **not** weaken the final merge gate.

## Test scripts

### Full suite

```powershell
npm run test:full -- --workers=2
```

Equivalent to the existing full Playwright suite.

Use this on the exact branch HEAD that is intended for merge.

### Last failed tests

```powershell
npm run test:last -- --workers=2
```

Re-runs the tests that failed in the previous Playwright run.

Use this while fixing an observed failure. Once the failure is fixed, continue with the relevant domain or changed-test gate.

### Changed-test heuristic

```powershell
npm run test:changed -- --workers=2
```

Runs Playwright's tests affected by changes relative to `origin/master`.

This is a development-time heuristic only. Indirect browser behavior, shared editor state, global shortcuts, serialization, and viewport interactions can affect tests that Playwright cannot infer from the import graph.

Never use `test:changed` as the final merge gate.

### Smoke suite

```powershell
npm run test:smoke -- --workers=2
```

Runs a small cross-domain set covering:

- editor fundamentals;
- core modeling;
- animation property state;
- project save behavior;
- theme/app UI boot behavior.

Use it after infrastructure or broadly shared editor changes when a quick cross-domain confidence check is useful.

### Modeling domain

```powershell
npm run test:modeling -- --workers=2
```

Runs the modeling/edit-mode domain, including:

- logical topology;
- context-menu modeling commands;
- cut/knife endpoint workflows;
- inset/extrude/subdivide;
- multi-selection and selection overlays;
- proportional/component transforms;
- geometry statistics;
- snapping.

Use this before the full gate for substantial modeling changes.

### Animation domain

```powershell
npm run test:animation -- --workers=2
```

Runs animation, Graph Editor, timeline, interpolation, key timing, and rotation-channel tests.

Use this before the full gate for substantial animation changes.

## Recommended GitHub-direct validation flow

### 1. During implementation

Run the smallest test set that can falsify the current change.

Examples:

```powershell
npm test -- tests/modeling-core.spec.ts --workers=2
npm run test:last -- --workers=2
npm run test:changed -- --workers=2
```

A failure should be fixed and re-run at this layer before spending time on broader validation.

### 2. When the feature behavior is stable

Run the relevant domain gate:

```powershell
npm run test:modeling -- --workers=2
```

or:

```powershell
npm run test:animation -- --workers=2
```

Also perform any required manual viewport validation.

### 3. Exact-head final gate

Once the branch is finished and no more code changes are planned:

```powershell
git rev-parse HEAD
npm run build
npm run test:full -- --workers=2
```

Only this exact validated HEAD may be merged.

Any new commit invalidates the full validation and requires a new exact-head gate.

## Worker policy

The checked-in Playwright default remains conservative:

```
fullyParallel: false
workers: 1
```

Windows-local validation may explicitly use `--workers=2`, which is the currently established project workflow.

Do not increase the repository default or make tests within one file fully parallel merely to reduce wall-clock time. Forge has browser/WebGL/editor-state tests where aggressive parallelism can introduce timing noise. Any future increase to worker count should be benchmarked separately and must preserve reliability.

## Future scalability work

The largest suites such as `context-menu.spec.ts` and `cut-edge-endpoint.spec.ts` create long per-file serial tails because `fullyParallel` is intentionally disabled.

If test time continues growing, the next safe optimization is to split oversized spec files by coherent domain while preserving test bodies and fixtures. This can expose more file-level parallelism to the existing two-worker Windows-local gate without changing product behavior or enabling intra-file parallel execution.
