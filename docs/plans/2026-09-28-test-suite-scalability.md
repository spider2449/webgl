# Test Suite Scalability

## Problem

Forge Studio now has more than 300 Playwright tests and a Windows-local full run takes roughly three minutes with two workers.

Running the full suite after every iterative code edit creates unnecessary latency. At the same time, the strict GitHub-direct workflow depends on a trustworthy exact-HEAD full validation before merge.

The goal is therefore to improve feedback speed without weakening the final gate.

## Phase 1 — Layered test entry points

Add repository scripts for:

- `test:full`
- `test:last`
- `test:changed`
- `test:smoke`
- `test:modeling`
- `test:animation`

The existing `npm test` behavior remains unchanged.

The checked-in Playwright configuration also remains unchanged:

- `fullyParallel: false`
- `workers: 1`

Windows-local validation continues to pass `--workers=2` explicitly.

## Validation policy

During development, use the narrowest relevant gate:

- exact files;
- last failed;
- changed-test heuristic;
- domain suite.

When the feature branch is finished, run exactly once on the intended merge HEAD:

```powershell
npm run build
npm run test:full -- --workers=2
```

Any new commit invalidates that result.

## Why not increase parallelism now

The project has a history of timing-sensitive browser and WebGL tests. Raising the default worker count or enabling full intra-file parallel execution at the same time as introducing the layered workflow would mix two independent changes:

1. developer ergonomics;
2. test-scheduler behavior.

Phase 1 changes only ergonomics and selection of test scope.

## Phase 2 candidate — split oversized specs

If full-suite wall time remains a problem after layered validation is established, inspect the largest serial files, especially:

- `tests/cut-edge-endpoint.spec.ts`
- `tests/context-menu.spec.ts`
- `tests/modeling-core.spec.ts`
- `tests/editor.spec.ts`

Split only along coherent feature boundaries while preserving test logic.

Because Playwright parallelizes files across workers even with `fullyParallel: false`, smaller independent files can reduce long-tail worker imbalance without changing intra-file execution semantics.

Phase 2 should be benchmarked separately and should not be bundled into this maintenance PR.
