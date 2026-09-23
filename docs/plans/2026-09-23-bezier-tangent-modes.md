# Bezier tangent modes

Extend the Graph Editor's per-key Bezier controls with explicit tangent modes.

## Scope

- Store tangent mode per key and scalar channel.
- Support Free, Aligned and Auto.
- Free preserves the existing independent handle behavior.
- Aligned keeps left/right handles opposite and collinear; dragging one side preserves the opposite handle's length unless the segment time bound requires shortening it.
- Auto computes a monotone slope from adjacent key values and frame spacing.
- At peaks, valleys or zero-slope transitions, Auto flattens the tangent rather than overshooting.
- Endpoint Auto tangents use the adjacent segment slope.
- Auto handles are displayed but cannot be manually dragged.
- Switching Auto → Free/Aligned materializes the currently evaluated handles so the curve shape is preserved at the moment of switching.
- Switching to Auto drops manual offsets so future key edits recompute the handles.
- Tangent mode changes create one undoable history entry.
- Preserve tangent mode through Forge save/load, scalar-key replacement, channel retime/copy and ordinary curve editing.

## Data model

`ScalarKey` carries sparse `tangent: 'free' | 'aligned' | 'auto'` alongside its interpolation and handle offsets.

Missing tangent metadata means Free. Handle offsets remain stored directly on the scalar key. Auto ignores and removes manual offsets.

## Evaluation

Auto uses a monotone weighted harmonic slope for interior keys when neighboring segment slopes have the same sign. Sign changes and zero slopes produce a horizontal tangent. Handle time distance remains one third of the adjacent segment.

Aligned uses stored handles. When one handle is dragged, the other is placed on the opposite ray with its previous length, subject to its adjacent segment's time bound.

## Non-goals

- weighted tangents,
- broken/aligned per-side flags,
- custom easing presets,
- arbitrary F-curves.

## Validation

- Free remains independent.
- Aligned mouse dragging keeps handles collinear and opposite.
- Auto symmetric extrema produce horizontal handles.
- Auto monotone curves update when neighbor values change.
- Auto handles are not draggable.
- Auto stores no manual offsets.
- tangent modes round-trip in Forge projects.
- malformed tangent modes fail closed.

This branch remains unmerged until Windows-local validation is reported.
