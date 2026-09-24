# Native Rig Reset

Date: 2026-09-24

## Decision

Forge Studio removes the legacy preset-specific rigging subsystem before starting the next rigging architecture.

This is an intentional reset, not a migration.

The new native rig system will not inherit compatibility requirements from the removed implementation.

## Removed in this cleanup

- dedicated legacy rig source directory,
- fixed skeleton data,
- preset-specific rig runtime,
- preset-specific FK / IK workflow,
- procedural rig preview,
- worker-based automatic skin binding,
- rig workspace and Rig properties panel,
- rig-specific Add menu entry,
- rig-specific development globals,
- rig-specific browser tests and screenshots,
- obsolete third-party attribution and bundled license that were only required by the removed skeleton data,
- documentation that described the removed rig workflow as a current capability.

## Retained generic engine capabilities

This cleanup does not prohibit generic Three.js scene content from containing:

- Bone objects,
- SkinnedMesh objects,
- Skeleton data loaded from interchange files,
- transform animation on arbitrary Object3D nodes.

Those are engine-level scene types, not a Forge rigging architecture.

Forge does not expose a native rig authoring workflow after this cleanup.

## Current product boundary

After this cleanup:

- no Rig workspace exists,
- no built-in armature preset exists,
- no native bone creation/editing workflow exists,
- no IK solver workflow exists,
- no automatic skin binding workflow exists,
- no weight-painting workflow exists,
- no rig-specific project schema is authoritative.

Animation remains object/scalar-track based.

Imported scene content may still contain generic bones or skins, but Forge does not claim them as an authored native rig system.

## Next rigging package

The next rigging work should begin with a Forge-owned data model and acceptance criteria before UI or IK.

Recommended first package:

1. define a generic armature/root identity independent of any fixed skeleton,
2. create/delete/reparent bones,
3. define edit-rest vs pose transforms explicitly,
4. define stable bone IDs and serialization,
5. visualize and select bones without preset-specific naming,
6. integrate bone transform channels with the existing scalar Timeline / Graph Editor,
7. add deterministic hierarchy/project round-trip tests.

Skin binding, weights, constraints and IK should follow only after the hierarchy/rest-pose model is stable.

## Non-goals of this cleanup

- no replacement armature implementation,
- no compatibility bridge for removed preset metadata,
- no automatic migration of old preset-specific projects,
- no new skinning algorithm,
- no new IK solver,
- no changes to Timeline / Graph Editor authority.

## Validation

Merge requires Windows-local:

- `npm run build`
- full Playwright suite with `--workers=2`

Static audit should confirm no current production/test/documentation references to the removed preset implementation or its external attribution.
