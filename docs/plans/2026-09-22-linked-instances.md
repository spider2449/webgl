# Linked instances

Continue Phase 3 with a bounded linked-duplicate workflow for ordinary meshes.

## Scope

- Add **Alt+D** and **Edit → Linked duplicate** alongside the existing independent Shift+D duplicate.
- Share the selected mesh's current geometry and material resources.
- Keep object transforms, names, keyframes and collection membership independent.
- Preserve shared resource identity through Forge project serialization, undo/redo and deletion of either instance.
- Reuse the existing resource-retention disposal logic so deleting one instance does not dispose resources still referenced by another.
- Reject skinned meshes and meshes with an active modifier stack rather than pretending those more complex ownership models are linked safely.

## Acceptance coverage

- Linked geometry and material edits are visible through both instances.
- Transform edits remain object-local.
- Project round trips and history restoration reconstruct shared geometry/material references.
- Deleting one linked instance leaves the remaining object's shared resources usable.
- Alt+D creates a linked duplicate while Shift+D remains an independent deep copy.
- Unsupported linked-duplicate requests have zero scene/history effect.

## Limits

This increment links the current mesh geometry and material resources; it does not add a separate instance-group data model. A later operation that replaces a mesh resource can make that object independent. Skinned meshes, modifier-stack meshes, linked collection instances and a dedicated make-single-user command remain future work.

Implementation and regression tests are committed in this branch. The GitHub connector cannot execute the local Vite/Playwright suite, so build and browser-test acceptance must be confirmed by CI or a local checkout before merge.
