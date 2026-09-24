# Generic Armature Core Extraction

Date: 2026-09-24

Base: `8cd8c13021da10363acc9003964eb06a8b9a19e5`

## Goal

Make Forge's rig runtime independent of the NVIDIA Kimodo SOMA77 preset without deleting the preset before generic armature behavior is proven.

The generic core must operate on ordinary `THREE.Bone` hierarchies and `THREE.Skeleton` skins. Bone animation continues to use the existing `userData.animationTracks` scalar-channel architecture.

## Scope

- Identify Forge armatures through generic `forgeRig.type = "armature"` metadata while accepting the existing SOMA legacy marker.
- Enumerate bones from the actual hierarchy rather than the SOMA77 definition array.
- Keep rest transforms per bone, including scale.
- Make viewport bone visualization independent of anatomical names and safe for multiple roots.
- Make IK accept an explicit end bone and configurable chain length rather than a SOMA limb name.
- Make automatic weight segment construction include leaf bones and root-only armatures.
- Move SOMA creation, source attribution and procedural preview generation into `src/rig/soma77.ts`.
- Keep the current SOMA77 UI as a temporary preset adapter.
- Replace generic rig-infrastructure tests with an arbitrary three-bone `Root → Mid → Tip` armature using only generic Forge metadata.

## Non-goals

- Do not remove SOMA77 yet.
- Do not add user-facing bone creation/extrusion/reparent UI yet.
- Do not redesign Timeline or Graph Editor.
- Do not add manual weight painting, persistent constraints, pole vectors or joint limits.
- Do not depend on the unvalidated editable-GLB-animation PR.

## Persistence

No project-format migration is required. Forge projects already serialize the Three.js scene graph, bones, skeleton references, skin attributes and `userData.animationTracks` through `Object3D.toJSON()` / `ObjectLoader.parse()`.

The generic armature marker is additive. Existing SOMA projects remain recognizable through their legacy `forgeRig.skeleton` metadata.

## Validation contract

Windows-local validation remains authoritative for the exact PR HEAD:

- `npm run build`
- `npm test -- --workers=2`
- manual SOMA preset smoke check

A later package will build the Forge-native Create Armature / Add Bone / Extrude / Parent workflow on this generic core.
