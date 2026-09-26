# Knife Multi-Bend Interior Path

## Goal

Extend the validated face-interior Knife bend from one interior point to an arbitrary non-self-intersecting polyline inside one logical face.

Supported pending path:

```
boundary
  -> bend 1
  -> bend 2
  -> ...
  -> bend N
  -> boundary
```

The mesh is not modified while bends are being added.

## Interaction

1. Start Knife from a logical vertex or logical-edge point.
2. Click one or more points inside the same logical face.
3. Every accepted bend becomes a persistent pending point.
4. Every accepted segment remains visible as part of the pending path.
5. The normal live preview continues from the last pending bend to the cursor.
6. Finish on a logical vertex or logical-edge point on the same face boundary.
7. The complete polyline is committed in one modeling operation.
8. The final boundary endpoint becomes the next continuous Knife anchor.

Escape cancels the entire pending interior path without changing mesh topology.

Enter finishes Knife when no interior path is pending. If interior bends are still pending, Enter does not create dangling topology; Knife remains active and asks the user to finish on the logical face boundary or cancel with Escape.

Any pending interior bend can be clicked to make it active and dragged directly in the viewport before commit. Pending points use distinct normal, hover, and active colors. Drag candidates are restricted to surface hits, validated against the same logical face and whole-path constraints, and only replace the chosen pending point on pointer release. Invalid drags leave the original bend unchanged and never modify mesh topology.

Pending-path edits share one local history:

- adding a bend, moving a bend, or deleting the active bend records one pending edit;
- Ctrl+Z and Backspace undo the latest pending edit;
- Ctrl+Shift+Z or Ctrl+Y redo it;
- Delete removes the active pending bend, including a middle bend when the resulting whole path remains valid;
- clicking a bend changes only the active bend and does not modify topology or create a history entry;
- if the pending path has been undone back to zero bends but local redo history still exists, further Ctrl+Z stays inside the Knife-local history boundary and does not fall through to global mesh Undo;
- any committed cut, restarted Knife session, Escape cancel, or Enter finish clears the pending edit history;
- when no pending Knife edit history exists, the normal global Undo/Redo behavior is unchanged.

The mesh remains unchanged throughout all pending-path editing. Knife stays active so the edited path can still be completed on the logical face boundary.

## Topology representation

A completed path divides one logical polygon into two polygons.

If the original oriented boundary endpoints are A and B and the interior path is:

```
A -> P1 -> P2 -> ... -> Pn -> B
```

the resulting logical polygons are:

```
boundary walk A -> B -> Pn -> ... -> P2 -> P1
boundary walk B -> A -> P1 -> P2 -> ... -> Pn
```

Every interior bend therefore becomes one true logical vertex shared by both new polygons.

The cut path contributes N+1 true modeling edges.

Renderer triangulation remains subordinate to the resulting logical polygons.

## Validation

The whole pending path is validated after every added bend and before final commit.

Required invariants:

- all interior bends are strictly inside the selected logical face;
- all bends stay on the same planar logical face;
- no segment crosses, touches, or overlaps a non-incident logical boundary;
- no non-adjacent path segments intersect or touch;
- adjacent segments may share their bend endpoint but may not reverse or overlap;
- duplicate consecutive points are rejected;
- final boundary endpoint must belong to the same logical face.

Concave logical N-gons remain supported when the complete polyline satisfies these rules.

## Boundary edge endpoints

Start/end points may lie inside logical edges.

The existing endpoint insertion/remap layer runs before the final face split:

- insert the first edge endpoint when needed;
- rebuild logical topology;
- remap and insert the second endpoint;
- resolve both boundary vertices;
- commit the full interior polyline.

This avoids T-junctions and stale edge ids.

## Preview

The pending overlay stores the whole path rather than one bend:

- all interior bend points remain visible;
- every accepted pending segment remains visible;
- live hover continues from the last pending bend;
- completing or cancelling the operation clears the pending overlay.

The old single-bend API remains as a compatibility wrapper over the path implementation.

## Validation commands

After this stacked branch is transplanted onto the post-PR-51 master:

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual validation:

1. On a Cube face, create vertex -> bend1 -> bend2 -> opposite vertex.
2. Before the final boundary click, confirm the mesh snapshot is unchanged.
3. Confirm both bends and all accepted pending legs remain visible.
4. Complete the path and confirm both bends are selectable logical vertices.
5. Confirm all three cut legs are selectable logical edges.
6. Continue Knife without pressing K again.
7. Try a self-crossing interior polyline; preview/click must reject it without destroying the existing pending path.
8. Repeat with edge -> bend1 -> bend2 -> edge.
9. Repeat on a safe concave N-gon.
10. With multiple bends pending, press Backspace twice; confirm bends disappear one at a time and the mesh remains unchanged.
11. After the last Backspace, confirm the preview anchor returns to the original boundary start and Knife remains active.
12. Re-add bends, then press Escape; confirm no topology change and no pending overlay remains.
