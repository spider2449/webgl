# Knife edge-to-edge increment

## Goal

Extend the existing single-face Knife without jumping to unrestricted multi-face cutting.

The existing behavior remains:

- Vertex mode
- one selected logical vertex
- `K` or RMB -> Knife
- click one logical edge on the same face
- cut vertex -> edge point

This increment adds:

- Vertex mode
- no selected logical vertex
- `K` or RMB -> Knife
- click one logical edge
- click a different logical edge sharing exactly one logical face with the first
- create true logical vertices at both clicked edge positions
- split that one logical face between the two new vertices

## Topology contract

Both clicked endpoints are real modeling topology, not renderer-only helpers.

For each endpoint:

- the containing logical edge is split at the clicked `t`
- all logical polygons sharing that edge receive the inserted boundary vertex
- per-corner numeric attributes are interpolated
- normals are recomputed after retessellation

After both insertions, the selected logical face is split between the two new boundary vertices.

Logical IDs are never assumed stable across retessellation. The second edge and both inserted endpoints are re-resolved by preserved geometry positions. If an edge direction reverses after topology rebuild, its parameter is converted from `t` to `1 - t`.

## Interaction

1. Enter Edit Mode -> Vertex.
2. Leave the vertex selection empty.
3. Press `K` or use RMB -> Knife.
4. Click inside the first logical edge.
5. Click inside a different logical edge on the same logical face.
6. Forge commits one modeling transaction containing both inserted vertices and the face split.
7. `Esc` cancels while waiting for either click.

Selecting exactly one vertex before `K` keeps the existing vertex -> edge Knife behavior.

## Deliberate limits

- one logical face per cut
- both endpoints must lie on existing logical edges
- no arbitrary face-interior point
- no path crossing into another face
- no multi-segment Knife polyline
- no click-drag stroke
- no snapping modes beyond the clicked point on the edge

## Windows-local validation

```powershell
npm run build
npx playwright test tests/cut-edge-endpoint.spec.ts tests/context-menu.spec.ts --workers=1
npm test -- --workers=2
```

Manual check:

1. Cube -> Edit Mode -> Vertex.
2. Deselect all vertices.
3. Press `K`.
4. Click inside one edge of a visible Quad.
5. Click inside a different edge of that same Quad.
6. Verify both clicked points become logical vertices and one new logical cut edge connects them.
7. Undo must restore the original Quad in one step.
