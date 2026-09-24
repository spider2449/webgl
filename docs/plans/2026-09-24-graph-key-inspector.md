# Graph Key Inspector

Date: 2026-09-24

## Goal

Make precise scalar-key editing a first-class Graph Editor workflow instead of requiring pointer dragging for every timing or value adjustment.

This package also reorganizes the Graph Editor controls so selection-specific editing lives in a dedicated Key Inspector row rather than crowding the Graph title row.

## Graph Editor layout

The Graph Editor becomes two control rows plus the curve area:

1. Graph header
   - active channel title and graph detail
   - Insert channel key
   - Remove selected channel key
   - KEY CURVES badge

2. Key Inspector toolbar
   - Graph selection count
   - precise Frame
   - precise Value
   - Apply
   - Segment
   - Tangent
   - Time Scale

3. Graph curve / channel rail

The Timeline Summary Keys toolbar remains separate and continues to operate on Timeline summary-frame selection.

## Precise single-key editing

When exactly one Graph key is selected:

- Frame displays the authored scalar-key frame.
- Value displays the authored scalar-key value.
- Rotation channels display and accept degrees.
- Position and scale channels use native scalar values.
- Apply updates Frame and Value atomically in one history entry.
- Enter in either precise field applies the edit.
- Escape in either precise field discards the uncommitted field edit and restores the authored value.

A precise frame edit:

- must target an integer frame from 1 through 250,
- preserves interpolation and tangent metadata,
- rejects a same-channel collision before mutating the track,
- moves the Graph selection and playhead to the new frame on success.

A precise value edit:

- requires a finite number,
- preserves key timing and metadata,
- creates one undo entry.

## Multi-selection

When zero or multiple Graph keys are selected:

- precise Frame / Value fields are disabled,
- Apply is disabled,
- Graph selection count remains visible,
- existing batch Segment, Tangent, Time Scale, remove, move and copy workflows remain available according to their existing eligibility.

## Model and compatibility

The existing scalar animation tracks remain authoritative. No second key model or inspector-only state is introduced.

Existing low-level timing helpers remain intact for compatibility with current tests and development APIs; the new inspector uses a dedicated atomic single-key edit operation whose source frame is explicit rather than inferred from the current playhead.

## Validation

Focused Playwright coverage must verify:

1. precise Frame + Value edit in one undo step,
2. interpolation / tangent metadata preservation,
3. same-channel collision rejection without history mutation,
4. rotation display and editing in degrees,
5. multi-selection disables precise fields while retaining batch controls,
6. Enter applies,
7. Escape discards an uncommitted field edit,
8. existing Graph selection / drag / time-scale regressions still pass.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
