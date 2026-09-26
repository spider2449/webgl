# Knife Face-Interior Bend

## Goal

Allow the continuous Knife tool to pass through one arbitrary point inside a logical face without creating dangling modeling topology.

## Interaction

Supported path:

```
boundary vertex/edge point
        ->
one face-interior bend point
        ->
boundary vertex/edge point on the same logical face
```

The first interior click is pending only. It does not mutate the mesh.

While that bend is pending, the viewport keeps both pieces of feedback visible:

- a persistent point marker at the clicked interior bend;
- the already chosen boundary-to-interior first leg.

Mouse movement then shows the normal live preview from the interior bend to the next hover target, so the user can see the complete intended polyline before commit.

The cut is committed only after the next boundary endpoint is chosen. At that point the operation creates both modeling edges through the interior point and splits the logical face into two valid polygons.

After the commit, the final boundary endpoint becomes the next Knife anchor, preserving the existing continuous Knife workflow.

## Picking priority

Knife picking remains:

1. logical vertex when `Vertex + Edge` snapping acquires one;
2. logical edge point;
3. logical face interior only when neither vertex nor logical edge was picked.

This keeps the validated snap behavior unchanged:

- `Vertex + Edge` still uses sticky logical-vertex snapping;
- `Edge only` still does not proximity-snap to vertices;
- a deliberate vertex-marker click in `Edge only` is still accepted.

## Modeling topology

A single edge that terminates inside a face would be a dangling internal modeling edge and cannot be represented by the current polygon-boundary topology.

Therefore an interior point is never committed by itself.

When both boundary endpoints are known, the original polygon boundary is split into two walks. The interior point is appended to both resulting polygon boundaries:

```
boundary walk A -> B -> interior -> A
boundary walk B -> A -> interior -> B
```

The interior point therefore becomes one true logical vertex shared by both new polygons, with exactly two new modeling cut edges.

Renderer triangulation remains subordinate to these logical polygons and does not become editable topology.

## Edge endpoints

If either Knife boundary endpoint lies inside a logical edge:

- insert a true logical vertex on that edge;
- propagate the inserted point to every incident polygon;
- remap the second endpoint against the updated boundary;
- then perform the interior face split.

This prevents T-junctions and handles edge-id changes caused by the first insertion.

## Concave planar faces

Concave logical N-gons are supported when both Knife legs remain completely inside the polygon.

Before either leg is accepted, Forge projects the planar logical face onto the most stable 2D axis pair and checks the boundary-to-interior segment against every logical boundary edge.

The leg is rejected when it:

- crosses a non-endpoint boundary edge;
- touches a non-incident boundary vertex;
- overlaps a logical boundary segment;
- starts from a point that is no longer on the selected logical face boundary.

This same validator is used by the live preview/click planner and by the final modeling operation, so a concave path that would leave the polygon is marked invalid before commit instead of failing only in the worker.

The resulting polygons are retessellated by the existing ear-clipping N-gon triangulator, so safe concave child polygons remain logical polygons and renderer diagonals stay non-editable.

## Deliberate limits

- exactly one pending interior bend point;
- both boundary endpoints must belong to the same logical face;
- the logical face must currently be planar;
- starting Knife directly from a face interior is not supported;
- clicking a second face-interior point while one is pending is rejected;
- multi-face traversal still happens through committed boundary endpoints, using the existing continuous Knife behavior.

## Windows-local validation

Validate the exact PR head:

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual checks:

1. Cube -> Edit Mode -> Vertex.
2. Press `K`.
3. Click a logical vertex or an interior point on a logical edge.
4. Move to the middle of the same logical face; preview should show a valid face target.
5. Click it; the mesh must remain unchanged, the interior marker must stay visible, and the first boundary-to-interior line must stay visible.
6. Move the mouse; the persistent first leg remains while the live second-leg preview follows the cursor.
7. Hover a vertex or edge point on the same face boundary; preview should become valid.
8. Click it; the face should split through the interior bend.
9. Verify the interior bend is a selectable logical vertex and both cut segments are selectable logical edges.
10. Continue Knife without pressing `K` again.
11. On a concave planar N-gon, verify an inside-only bend is accepted while a leg that crosses the notch is previewed invalid.
12. Repeat with `Knife Snap = Edge only`; nearby vertices must not proximity-snap.
