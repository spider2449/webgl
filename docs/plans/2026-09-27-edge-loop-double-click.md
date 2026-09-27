# Edge Loop Double-Click Selection

## Goal

Make logical edge-loop selection a direct viewport gesture while preserving the validated RMB command.

## Interaction

- **Double-click** one logical edge in Edit Mode / Edge mode to replace the current selection with its logical edge loop.
- **Shift + double-click** adds the entire loop to the current selection.
- If every edge in that loop is already selected, **Shift + double-click** removes the whole loop.
- The directly targeted edge remains the active edge when it is selected.
- **Alt** remains reserved for viewport orbit and never triggers loop expansion.
- **Ctrl** is not assigned to the double-click gesture.

## Topology and picking

- Each ordinary pointerup resolves the logical edge through the existing Edit Mode `componentEdges` pick path.
- The `dblclick` handler does **not** raycast again. It requires the two preceding pointerup picks to agree on the same logical edge and uses that edge as the loop seed.
- Loop traversal reuses the validated `logicalEdgeLoop()` helper.
- Renderer triangulation diagonals are therefore excluded at both the picking and traversal layers.
- A pole/boundary/non-Quad edge with no continuation keeps normal double-click behavior without fabricating a loop.

## Selection/history behavior

The gesture changes only temporary component selection:

- no geometry mutation;
- no modeling worker;
- no history commit;
- existing pending modeling results are invalidated through the normal modeling-selection version counter.

The two ordinary clicks that precede the browser's `dblclick` event are treated as one atomic gesture:
- the first pointerup records the selection snapshot from before the gesture;
- the second pointerup must resolve the same logical edge;
- plain double-click replaces the selection with only that edge's loop;
- Shift-double-click restores the pre-gesture snapshot first, then applies whole-loop add/remove.
This prevents an unrelated previously active edge from leaking into the final loop selection.

## Regression coverage

The viewport test:

1. creates a real off-center polygon-native Loop Cut;
2. targets one visible edge from the resulting four-edge loop;
3. double-clicks it and verifies the selection set equals the exact Loop Cut result loop with no extra edge;
4. verifies the targeted seed is active;
5. Shift-double-clicks to add the loop beside one unrelated edge;
6. Shift-double-clicks again to remove the whole loop while preserving the unrelated edge;
7. verifies undo depth never changes.

## Windows-local validation

Validate only the exact PR HEAD:

```powershell
npm run build
npm test -- --workers=2
```

Manual check:

1. Make a Loop Cut on the default Cube.
2. Single-click another edge to clear the loop selection.
3. Double-click one middle-loop edge: the whole middle loop should select.
4. Select an unrelated edge, then Shift-double-click the middle loop: both should remain selected.
5. Shift-double-click that loop again: only the unrelated edge should remain.
6. Alt-drag orbit should behave exactly as before.
