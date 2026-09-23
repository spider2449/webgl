# Graph Editor batch interpolation and tangent assignment

Extend the active-channel Graph Editor selection model so existing Segment and
Tangent controls operate on the selected key set.

## Scope

- Segment applies Linear, Constant, or Bezier to every selected key that owns an
  outbound segment.
- If the final channel key is selected with other keys, it is ignored for
  Segment because it has no outbound segment.
- Tangent applies Free, Aligned, or Auto to every selected key that touches at
  least one Bezier segment.
- Selected keys that do not touch a Bezier segment are ignored for Tangent.
- A multi-selection with differing applicable values displays a disabled Mixed
  placeholder in the control.
- Single-key behavior remains unchanged.
- Each batch Segment or Tangent assignment writes the active scalar track once
  and creates exactly one undo history entry.
- Selection itself remains UI-only and is preserved by the assignment.

## Transaction rules

The editor validates that all requested selected frames are authored keys on the
active channel before changing data.

Only semantically applicable selected keys are edited:

- Segment requires an outbound segment.
- Tangent requires an incoming or outgoing Bezier segment.

If no selected key is applicable, the corresponding UI control is disabled and
no edit is attempted.

Bezier handle initialization and Free/Aligned/Auto behavior reuse the existing
single-key rules. Batch operations do not introduce a second interpolation or
tangent representation.

## Non-goals

- timing scale around a pivot,
- proportional key editing,
- cross-channel interpolation assignment,
- cross-object assignment,
- new tangent types,
- weighted tangents,
- selecting or batch-editing Bezier handles.

## Validation

Playwright coverage verifies:

- multi-selected outbound segments expose the Segment control,
- differing selected segment modes display Mixed,
- one Segment change edits the full applicable selection,
- one undo restores all affected segment modes,
- multi-selected Bezier keys expose the Tangent control,
- differing selected tangent modes display Mixed,
- one Tangent change edits the full applicable selection,
- one undo restores all affected tangent modes,
- existing multi-select removal and box-selection expectations reflect the
  newly enabled Segment control.

Windows-local validation remains required before merge.
