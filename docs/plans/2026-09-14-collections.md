# Forge Studio collections

Continue Phase 3 with a bounded scene-organization increment. Add explicit
collections to the existing outliner without introducing linked instances or
shared-resource editing.

## Scope

- Create named collections under the scene root.
- Move selected top-level objects into an existing collection and unlink them
  back to the scene root.
- Show collection hierarchy and object membership in the outliner.
- Preserve collection names, nesting and object membership through Forge
  project save/load, undo/redo and duplicate/delete workflows.
- Keep collection changes atomic and reject invalid selections without changing
  the scene.

## Acceptance

- [x] Collection operations are available from the outliner and have stable
  accessible labels.
- [x] A collection is a non-rendering organizational node; its child meshes
  remain selectable and render normally.
- [x] Moving an object changes only its parent collection and does not alter
  its local transform, geometry or material.
- [x] Empty collections can be deleted explicitly; deleting a collection does
  not silently delete its child objects.
- [x] Collection hierarchy and membership survive project round trips and
  history restoration.
- [x] Production build and the complete one-worker browser suite pass.
- [x] The stale README current-limits text is corrected and `git diff --check`
  passes.

## Limits

Nested collections, linked instances, collection-level visibility and
collection transforms are deferred until their authority and interaction
semantics are specified.
