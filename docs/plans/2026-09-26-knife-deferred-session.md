# Deferred Knife Session

## Goal

Make continuous Knife edits previewable as one pending path and commit the complete path atomically with Enter.

## Interaction

1. Enter Edit Mode -> Vertex.
2. Press `K`.
3. Pick the start vertex or logical-edge point.
4. Continue clicking supported vertex/edge targets.
5. Each click appends a pending segment; project geometry and history remain unchanged.
6. The full pending path remains visible in the viewport.
7. Press `Enter` to commit the entire path as one modeling operation and one undo step.
8. Press `Escape` before Enter to discard the pending path without changing geometry.

## Stable topology representation

Pending segments are stored as local-space endpoint positions, not logical vertex/edge/face ids.

At commit time the worker applies segments sequentially. Before every segment it rebuilds the current logical topology and resolves both endpoint positions again:

- an exact logical vertex position resolves to a vertex;
- otherwise an interior point on one logical edge resolves to that edge and a fresh `t`;
- the current topology then determines the unique logical face to cut.

This is required because each completed segment may retessellate polygons and reorder logical ids. Later segments therefore must not reuse ids captured before earlier segments were applied.

## Atomicity

The worker performs the whole session on temporary geometries. The editor receives a result only if every segment succeeds.

If any later segment fails:

- no partial geometry is installed in the scene;
- temporary intermediate geometries are disposed;
- the pending session remains available for error handling rather than creating a partial history state.

A successful session is committed to editor history once, so one Undo restores the complete pre-session mesh.

## Deliberate limits

- endpoints are existing logical vertices or interior positions on existing logical edges;
- face-interior endpoints are not included;
- newly created cut edges are not pickable until the current deferred session is committed;
- every segment must resolve to exactly one supported logical-face cut;
- confirmation is Enter only; double-click confirmation is deliberately avoided because it also emits ordinary click events.

## Why face-interior targets are excluded

The current modeling topology represents editable logical polygon boundaries. A cut terminating only inside a face would create a dangling internal modeling edge that cannot be represented faithfully without extending the topology model. Renderer triangulation must not be promoted into editable modeling topology as a shortcut.

## Windows-local validation

Validate the exact PR head:

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual checks:

1. Build a two-segment Knife path across adjacent logical faces.
2. Before Enter, confirm the mesh snapshot/topology has not changed and the whole pending path is visible.
3. Press Enter and confirm both segments appear together.
4. Undo once and confirm both segments disappear together.
5. Start another path and press Escape before Enter; confirm the mesh remains unchanged.
6. Re-check both Knife Snap modes:
   - Vertex + Edge keeps sticky vertex snapping.
   - Edge only does not proximity-snap to vertices, while a deliberate vertex-marker click is still accepted.
