# Select Linked Logical Islands

## Goal

Add a deterministic Edit Mode **Select Linked** command that expands the current component selection across connected logical mesh islands without guessing edge-loop semantics.

## Interaction

Available from the RMB context menu in:

- Vertex mode
- Edge mode
- Face mode

The command requires at least one selected logical component.

If the current selection contains seeds from multiple disconnected islands, every seeded island expands independently in one command.

## Connectivity rules

### Vertex mode

Connectivity is the graph formed only by logical `polygonEdges`.

Starting selected logical vertices expand to every logical vertex reachable through those boundary edges.

### Edge mode

Two logical edges are connected when they share a logical endpoint vertex.

Traversal uses only `polygonEdges`. Renderer triangulation diagonals are never candidates.

The previously active seed edge is restored as the last selected edge so the active-edge overlay remains stable.

### Face mode

Logical faces connect only through a shared logical polygon boundary edge.

Touching at a vertex alone does not connect two face islands.

This is intentionally stricter than simply sharing any vertex.

## Selection/history behavior

Select Linked is temporary selection state only:

- no geometry mutation;
- no modeling worker;
- no history snapshot;
- no Undo depth increase;
- modeling selection version increments so an in-flight stale worker result cannot silently apply against a changed selection.

## Regression coverage

### Pure topology

A synthetic mesh containing two disconnected logical Quads verifies:

- one vertex seed expands to only the four vertices of its own island;
- one edge seed expands to only the four logical boundary edges of its own island;
- one face seed remains only that logical face;
- seeds in both islands expand to both;
- invalid component ids reject.

A default logical Cube verifies:

- one vertex seed -> 8 logical vertices;
- one edge seed -> 12 logical polygon edges;
- one face seed -> 6 logical faces.

### Real RMB workflow

On the default Cube, the test runs **Select Linked** in Vertex, Edge and Face modes and verifies:

- counts 8 / 12 / 6;
- Edge mode preserves the original seed as the active edge;
- Undo depth is unchanged.

## Non-goals

- edge loop / edge ring selection;
- geometric angle-based selection;
- select-similar;
- shortest path;
- hidden/occlusion filtering;
- keyboard shortcut.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Default Cube -> Edit Mode -> Vertex -> select one vertex -> RMB -> Select Linked: all 8 logical Cube vertices select.
2. Edge mode -> select one edge -> Select Linked: all 12 logical Cube boundary edges select; no renderer diagonals appear.
3. Face mode -> select one face -> Select Linked: all 6 logical Cube faces select.
4. On any mesh containing disconnected islands, selecting a component on one island must not select the other island.
5. Undo should still target the preceding geometry edit because Select Linked itself creates no history entry.
