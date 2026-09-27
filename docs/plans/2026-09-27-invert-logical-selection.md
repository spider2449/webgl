# Invert Logical Component Selection

## Goal

Add a deterministic Edit Mode **Invert Selection** command that replaces the current logical component selection with its complement in the active component mode.

## Interaction

Available from RMB context in:

- Vertex mode
- Edge mode
- Face mode

No keyboard shortcut is introduced in this batch.

## Semantics

The selection universe is mode-specific:

- Vertex mode: `topology.logicalVertices`
- Edge mode: logical `topology.polygonEdges` ids
- Face mode: logical `topology.polygons` ids

The result is:

```
all logical components in the active mode
minus
currently selected components
```

Therefore:

- one selected Cube vertex -> 7 selected vertices
- one selected Cube edge -> 11 selected logical edges
- one selected Cube face -> 5 selected logical faces
- empty selection -> all logical components
- full selection -> empty selection

Renderer triangulation diagonals are not part of the Edge universe.

## Active component / overlays

The inverted result is stored in deterministic topology order.

In Edge mode, the last resulting logical edge becomes the active edge through the existing active-edge convention.

When inversion produces an empty Edge selection, both selected-edge and active-edge overlays clear.

## Selection/history behavior

Invert Selection is temporary editor state only:

- no geometry mutation;
- no modeling worker;
- no history snapshot;
- no Undo depth change;
- modeling selection version increments to invalidate stale in-flight modeling results.

The command remains available even when the current component selection is empty so empty -> all works from the RMB menu.

## Regression coverage

Real RMB coverage runs all three component modes and verifies:

- one selected seed inverts to 7 / 11 / 5 components;
- original seed is excluded;
- Edge mode renders 11 selected fat-line instances;
- a second inversion returns exactly the original seed;
- clearing selection then inverting selects all 8 / 12 / 6 components;
- inverting the full set produces zero components;
- empty Edge selection clears both selected and active overlays;
- Undo depth never changes.

The Edit Mode context-menu coverage also verifies **Invert Selection** is visible in Vertex, Edge and Face modes.

## Non-goals

- Select All keyboard shortcut;
- Ctrl+I or other inversion shortcut;
- object-mode inversion;
- hidden/visible-only selection filtering;
- selection history.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Cube -> Edit Mode -> Vertex -> select one vertex -> Invert Selection: 7 vertices.
2. Edge -> select one logical edge -> Invert Selection: 11 logical edges, no renderer diagonal.
3. Face -> select one face -> Invert Selection: 5 faces.
4. Clear component selection -> Invert Selection: all logical components in the active mode.
5. Invert the full selection again: selection becomes empty.
6. Undo should still target the previous geometry edit.
