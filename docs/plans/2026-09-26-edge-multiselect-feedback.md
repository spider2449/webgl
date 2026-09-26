# Edge multi-selection feedback

## Goal

Make every selected Edit Mode edge visibly selected, regardless of whether selection comes from Shift-click or marquee selection.

## Visual hierarchy

- Unselected Edge Mode lines: subdued base overlay.
- Selected edges: orange thick overlay.
- Active edge: brighter overlay drawn on top of the selected overlay.
- Active edge must be thicker than the general selected-edge overlay.

Current intended values:

- selected edge linewidth: 4 px
- active edge linewidth: 6 px
- unselected material/solid edge opacity: 0.42
- unselected wire edge opacity: 0.48

## Invariants

1. Selecting N edges must produce N selected overlay segments.
2. Exactly one selected edge is active when the selection is non-empty.
3. Shift-click and marquee selection rebuild the same overlays.
4. Selection feedback is an editor helper only; it must not affect scene geometry, snapshots or renderer topology.
5. Overlay lines ignore depth testing so selected edges remain legible through the current viewport shading.

## Validation

Windows-local exact-head gate:

```powershell
npm run build
npm test -- --workers=2
```

Manual checks:

1. Edge Mode -> click one edge.
2. Shift-click several more edges. Every selected edge must remain clearly orange/thick.
3. The most recently selected edge should be brighter and thicker.
4. Marquee-select several edges. Every selected segment must use the same selected style.
5. Repeat in Material, Solid and Wire shading.
