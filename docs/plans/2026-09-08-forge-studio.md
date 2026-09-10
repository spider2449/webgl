# Forge Studio implementation plan

## Objective

Build a web-based 3D application inspired by Blender, prioritizing responsive interaction and GPU efficiency. This repository starts empty. The initial deliverable is a working editor foundation, not full Blender feature parity.

## Phase 1: Interactive editor

- TypeScript, Vite, Three.js; keep reactive UI work separate from viewport rendering.
- Blender-inspired desktop layout: toolbar, viewport, outliner, properties and timeline.
- Primitive creation, selection, transform gizmos, numeric transforms, duplication, deletion, visibility and naming.
- Orbit/pan/zoom, standard views, perspective/orthographic cameras, selection framing, grid and shading controls.
- Material color, roughness, metalness, smooth/flat shading and baked mirror operation.
- Vertex editing with welded-position selection and transform gizmos.
- Bounded undo/redo history, local recovery, versioned project JSON, GLB/OBJ interchange and PNG capture.
- Transform keyframes, scrubbing and playback.
- Demand rendering, capped device pixel ratio, geometry/material disposal, bounded history and renderer statistics.
- Production build and browser interaction tests with actual WebGL.

## Phase 1 extension: Kimodo rig system

User requested an integrated rig system based on NVIDIA Kimodo. Use the official public SOMA77 joint order, hierarchy and native neutral joint coordinates from upstream revision `1aece8c124d73d255ceff5086d983b844c9f4e94`. Keep Hips at zero local rest translation and ground the separate display container. Preserve source attribution and the Apache-2.0 license.

- Create and inspect all 77 joints, select joints in the viewport or searchable hierarchy, and edit FK transforms.
- Positional hand/foot IK with two-joint CCD chains; anatomical limits, pole vectors and IK/FK animation switching are future work.
- Full-pose keyframes and bone animation playback using the existing timeline.
- GPU-skinned preview and worker-based nearest-segment binding with four normalized influences per vertex. Limit each binding job to 100k vertices.
- Persist bones, bind matrices, weights and animation in Forge JSON; export to GLB.
- Verify official hierarchy, Hips root semantics, FK/IK motion, actual skinned vertex deformation, worker weight normalization, project recovery and rig duplication independence.
- Kimodo inference, motion retargeting and SOMA body-model inference are not included in this local rig editor.

## Phase 2: Modeling core

Add edge/face selection, extrusion, inset, bevel, loop cuts, proportional editing, multi-object editing, robust non-destructive modifiers, UV editing and snapping to mesh geometry. Define topology and selection data independent of GPU buffers first. Move expensive topology calculations to workers and benchmark large meshes.

Status: in progress. Component multi-selection, single-triangle extrusion, single-triangle inset and smooth proportional component translation are complete; the remaining modeling-core features listed above are still open. Connected planar region extrusion is complete; see [region extrusion](2026-09-09-region-extrusion.md) for boundary and planarity scope. Multi-edge subdivision is complete; see [multi-edge subdivision](2026-09-09-multi-edge-subdivision.md) for triangle splitting and [edge subdivision](2026-09-09-edge-subdivision.md) for manifold and attribute constraints. Discrete selection-center snapping to an active-mesh vertex is complete; see [vertex snapping](2026-09-09-vertex-snap.md) for scope. Connected proportional translation is also complete; see [connected proportional editing](2026-09-09-connected-proportional.md) for edge-path distance semantics. See [component multi-selection](2026-09-09-component-multiselect.md) for selection behavior, [proportional editing](2026-09-09-proportional-editing.md) for falloff scope, and [triangle inset](2026-09-09-triangle-inset.md) for inset details.

## Phase 3: Content workflows

Add texture painting, sculpting with multiresolution and spatial acceleration, node-based materials, texture management, collections, linked instances and animation curves. Use resource sharing, worker jobs and streaming where useful.

## Phase 4: Advanced production

Add rigging/skinning, constraints, geometry nodes, physics, compositing and offline rendering through separately designed backends. Native .blend compatibility is not part of Phase 1; GLB/OBJ are interchange formats. Blender feature parity requires ongoing development and explicit acceptance criteria per subsystem.

## Validation and performance

Verify project round trips, undo/redo, material and geometry editing, animation, import/export, keyboard handling and idle rendering. Cap history at 40 snapshots and 24 MiB of serialized state. Limit project/import file sizes, constrain numeric input, render only on invalidation or playback, and cap display pixel ratio by quality setting. Actual frame rates depend on hardware, resolution and scene complexity; do not claim a universal FPS target without measurements.

## Continuation: Phase 2 topology and component selection (2026-09-08)

The initial editor and local SOMA77 rigging foundation are implemented. The next bounded increment establishes triangle connectivity and component translation before topology-changing operations.

- Implemented an independent topology model with logical vertices, unique edges, triangle faces and rendering-buffer mappings for indexed and non-indexed meshes.
- Exact coincident positions share a logical vertex, including normal and UV seams. Connectivity remains stable during an edit session and is rebuilt when re-entering Edit Mode.
- Added Vertex, Edge and Triangle face selection in Edit Mode, visible edge guides, selected-vertex colors and centroid-based translation with welded seam updates.
- Editing helpers are removed from project snapshots and disposed when leaving Edit Mode.
- Validation covers actual viewport clicks for all three modes, cube connectivity, non-uniform object scale, unchanged unselected vertices, undo/redo and project round trips.
- Faces remain triangles and edges include triangulation diagonals. Vertex/edge picking reaches through geometry. Extrusion, inset, bevel, polygon reconstruction and multi-selection remain subsequent work.

## Continuation: Single-triangle extrusion (2026-09-08)

Implement a positive-distance extrusion along the selected triangle's local normal. Replace the source triangle with an offset cap, add three triangulated walls, preserve existing UV/color data and material groups, and keep the cap selected for subsequent movement or extrusion. Rebuild edit connectivity and retain project/history compatibility. Limit input to 100,000 vertices; reject unsupported attributes, morph targets and partial draw ranges before changing the scene. Existing dirty changes from the component-selection increment are preserved.

Validate winding and closed cube connectivity, indexed/non-indexed input, material/UV preservation, invalid-input zero effect, viewport selection, repeat extrusion, undo/redo and project round trips. Multi-face regions, inward extrusion, collision checks and production UV unwrapping remain future work.

Status: implemented. Production build and all 20 tests pass, including closed oriented indexed/non-indexed cube extrusion, repeated UI extrusion and exact project/history restoration. Reviewed the rendered extrusion UI screenshot. Snapshot capture now synchronizes object matrices before serialization, fixing stale transforms when committing before a render. Existing Vite main-bundle size warning remains. Wall UVs inherit boundary coordinates; automatic wall unwrapping is not implemented.

## Increment acceptance (2026-09-08)

- [x] Independent logical connectivity and indexed/non-indexed buffer mapping.
- [x] Vertex, edge and triangle-face viewport selection with welded component translation.
- [x] Positive-distance triangle extrusion, oriented walls and repeated cap extrusion.
- [x] Existing UV/material preservation, snapshot restoration and undo/redo.
- [x] Invalid requests leave source geometry unchanged, including extrusion distances lost to floating-point coordinate precision.
- [x] Edge overlay buffers are reused while dragging, with bounds updated for picking.
- [x] Production build, all 20 automated tests and `git diff --check` pass after the final code changes.

This completes the component-selection and single-triangle-extrusion increment. Region extrusion, inset, bevel, loop cuts, proportional editing, multi-object editing, non-destructive modifiers, UV editing, mesh snapping, topology workers and large-mesh benchmarks remain open in Phase 2. The existing main-bundle size warning remains unchanged. Changes are local and uncommitted.
