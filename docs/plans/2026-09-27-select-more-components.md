# Select More — One-Ring Logical Selection Growth

## Goal

Add a Blender-style **Select More** command to Vertex, Edge and Face Edit modes.

Unlike **Select Linked**, which floods through the complete connected logical island, **Select More** grows the current selection by exactly one logical adjacency ring per invocation.

## Interaction

Edit Mode -> Vertex / Edge / Face -> select one or more logical components -> RMB -> **Select More**.

At least one component must already be selected.

## Logical topology semantics

The operation is defined entirely on Forge modeling topology.

### Vertex mode

For every selected logical vertex, add vertices joined to it by one logical `polygonEdge`.

Renderer-only tessellation vertices and renderer diagonals do not participate.

### Edge mode

For every selected logical edge, add logical `polygonEdges` sharing either endpoint.

The original selected edge remains selected.

### Face mode

For every selected logical polygon, add polygons sharing at least one complete logical boundary edge.

Faces that only touch at a vertex are not adjacent for Select More.

## One-ring behavior

Growth is computed from the selection at command start.

Newly added components do not recursively add their own neighbors during the same invocation.

Therefore on the default Cube from one seed:

- Vertex: 1 -> 4 selected logical vertices;
- Edge: 1 -> 5 selected logical edges;
- Face: 1 -> 5 selected logical faces.

This deliberately differs from **Select Linked**, which reaches 8 / 12 / 6 on the same Cube.

Repeated Select More invocations may continue growing outward one ring at a time.

## Selection behavior

On success:

- stays in the current component mode;
- preserves every current selected component;
- adds exactly one adjacency ring;
- Edge mode preserves the prior active edge when it remains selected;
- refreshes transform proxy and selection overlays;
- refreshes Geometry Statistics;
- does not create an Undo step.

No geometry mutation or modeling-worker job occurs.

## Regression coverage

Pure topology:

- default Cube one seed grows to Vertex 4 / Edge 5 / Face 5;
- none of those first-step results flood to the full Cube island;
- a Plane with Segments X=2 grows one selected face to both logical faces.

RMB workflow:

- Select More appears in Vertex, Edge and Face context menus;
- one selected Cube component grows to 4 / 5 / 5 respectively;
- Edge overlay contains 5 selected LineSegments2 segments;
- the original active edge remains active;
- Undo depth is unchanged.

## Non-goals

- Select Less / shrink selection;
- edge-loop or edge-ring selection;
- recursive flood in one invocation;
- geometric distance or angle based selection;
- crossing face adjacency through a vertex-only touch;
- renderer-triangle adjacency;
- geometry mutation.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual spot-check:

1. Default Cube -> Vertex Edit Mode -> select one vertex -> Select More -> 4 vertices.
2. Edge mode -> select one edge -> Select More -> 5 logical edges.
3. Face mode -> select one face -> Select More -> 5 logical faces.
4. Invoke Select More repeatedly and confirm it grows outward rather than immediately flooding on the first click.
5. Confirm renderer triangulation diagonals never appear as selected logical edges.
