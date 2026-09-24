# Source tree domain reorganization

Reorganize Forge Studio source files by feature domain without changing runtime behavior, public APIs, data models, or tests.

## Goals

- Keep application composition roots at `src/main.ts` and `src/editor.ts`.
- Keep global styling at `src/style.css`.
- Group animation implementation under `src/animation/`.
- Group modeling implementation and workers under `src/modeling/`.
- Group viewport-only helpers under `src/viewport/`.
- Preserve existing filenames inside their domains to keep history recognizable.
- Update only relative imports required by the moves.

## Resulting structure

```text
src/
├─ main.ts
├─ editor.ts
├─ style.css
├─ vite-env.d.ts
├─ animation/
│  ├─ animation.ts
│  └─ animation-graph.ts
├─ modeling/
│  ├─ modeling.ts
│  ├─ modeling-ui.ts
│  ├─ topology.ts
│  ├─ extrude.ts
│  ├─ extrude-region.ts
│  ├─ subdivide.ts
│  ├─ proportional.ts
│  ├─ modifiers.ts
│  ├─ modeling-worker-client.ts
│  └─ modeling.worker.ts
└─ viewport/
   ├─ grid.ts
   └─ gimbal-controls.ts
```

## Non-goals

- No Editor decomposition.
- No API redesign.
- No file-content refactoring beyond import paths.
- No animation/modeling behavior changes.
- No data-model migrations.
- No test-directory reorganization in this increment.
- Test logic remains unchanged; direct imports into moved source modules are updated to their new paths.
- No generic `utils/`, `services/`, or `managers/` buckets.

## Validation

- TypeScript/Vite build passes.
- Full Playwright suite passes with unchanged assertions/behavior; only direct source import paths may change.
- Modeling worker entrypoints continue to resolve from their moved domain directory.
- Git diff contains only renames/moves, import path updates, and this plan document.

This branch remains unmerged until Windows-local validation is reported.

## Later cleanup

The legacy preset-specific rig subsystem was removed on 2026-09-24 before native Forge rigging work resumed. The current source tree intentionally has no dedicated rig domain; a new rigging architecture will be introduced only when its own data model and acceptance criteria are defined.
