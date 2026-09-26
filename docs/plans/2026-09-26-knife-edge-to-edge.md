# Continuous snapped Knife paths

## Goal

Extend the single-face Knife interaction into a practical continuous cutting tool without introducing arbitrary face-interior points.

Knife is now activated once and remains active until `Esc`. Each completed endpoint becomes the start of the next segment automatically.

## Knife target snapping

Knife has its own target control; it does not reuse Transform/Grid Snap.

### Vertex + Edge

This is the default.

- clicking close to a logical vertex snaps exactly to that vertex
- otherwise the clicked point is projected onto the logical edge
- this allows a cut to start directly on an existing modeling vertex without preselecting it

### Edge only

- logical vertices are not preferred
- Knife uses the exact interior edge position
- clicking at an edge endpoint is rejected because it is not an interior edge point

The control is exposed as `Knife Snap` in the Vertex context menu next to the Knife operator.

## Live hover preview

Knife now previews the exact candidate before a click commits anything.

- before the first click, moving the mouse over a valid logical edge or vertex shows a highlighted candidate point
- after a start point exists, moving the mouse also shows a temporary line from the current Knife anchor to the candidate endpoint
- the preview uses the exact same picker as the click path, so the point shown on screen is the point that will be committed
- with `Vertex + Edge`, entering a logical vertex's snap range moves the preview exactly onto that vertex
- moving away from valid topology hides the candidate instead of inventing an arbitrary face point
- leaving Knife with `Esc` clears both the preview point and preview line

This gives visual confirmation of both the start and destination before each segment is committed.

## Continuous interaction

1. Enter Edit Mode -> Vertex.
2. Press `K` or choose RMB -> Knife.
3. Click a start point:
   - an existing logical vertex when Vertex + Edge snapping is enabled, or
   - an interior point on a logical edge.
4. Click the next vertex or edge point.
5. Forge commits that Knife segment.
6. The endpoint automatically becomes the start of the next segment.
7. Continue clicking without pressing `K` again.
8. Press `Esc` to leave Knife.

A preselected single logical vertex is still accepted as the initial start point for compatibility with the previous Knife increment.

## Segment topology

Each segment is resolved from the current logical topology.

Supported combinations:

- vertex -> vertex
- vertex -> edge point
- edge point -> vertex
- edge point -> edge point

An edge point becomes a true logical vertex when its segment is committed. Shared neighboring polygons receive the same inserted boundary vertex, preserving logical manifold topology.

Each individual segment must resolve to one unambiguous logical face. After a segment is committed, the new endpoint may continue into another incident face, so a continuous Knife path can progress across the mesh one face at a time.

## Identity safety

Renderer retessellation can reorder logical IDs. Continuous Knife never treats those IDs as durable across a committed segment.

- completed anchors are preserved by local-space position
- the next segment resolves the current anchor back to a logical vertex
- a second edge endpoint is remapped by endpoint geometry positions
- if remapping reverses the edge direction, `t` is converted to `1 - t`
- edge remapping is scoped to the intended logical face

## Deliberate limits

- target points are existing logical vertices or points on existing logical edges
- no arbitrary face-interior points yet
- each committed segment crosses one logical face
- no drag-stroke Knife
- no preview polyline yet
- segments commit as they are completed; `Esc` ends the tool rather than confirming a deferred batch

## Windows-local validation

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual checks:

### Hover preview

1. Cube -> Edit Mode -> Vertex.
2. Press `K`.
3. Move the mouse along a visible logical edge without clicking.
4. Confirm the highlighted preview point follows the edge.
5. Move onto a logical vertex and confirm the preview snaps exactly to it.
6. Click a start point, then move toward another edge/vertex.
7. Confirm a temporary line follows from the start anchor to the hovered candidate.
8. Press `Esc` and confirm both preview helpers disappear.

### Snap directly to a vertex

1. Cube -> Edit Mode -> Vertex.
2. Deselect all vertices.
3. RMB -> Knife and leave `Knife Snap = Vertex + Edge`.
4. Click an existing visible logical vertex.
5. Click an edge point on the same face.
6. Confirm the cut starts exactly at the existing vertex.

### Continuous path

1. Keep Knife active after the first segment.
2. Without pressing `K` again, click another edge or logical vertex incident to the previous endpoint.
3. Confirm a second segment is created.
4. Continue for additional segments as desired.
5. Press `Esc` to end Knife.

### Edge-only targeting

1. Set `Knife Snap = Edge only`.
2. Start Knife.
3. Click an interior edge position.
4. Confirm the endpoint stays at the clicked edge position rather than snapping to a nearby vertex.
