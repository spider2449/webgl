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

## Phase 3: Content workflows

Add texture painting, sculpting with multiresolution and spatial acceleration, node-based materials, texture management, collections, linked instances and animation curves. Use resource sharing, worker jobs and streaming where useful.

## Phase 4: Advanced production

Add rigging/skinning, constraints, geometry nodes, physics, compositing and offline rendering through separately designed backends. Native .blend compatibility is not part of Phase 1; GLB/OBJ are interchange formats. Blender feature parity requires ongoing development and explicit acceptance criteria per subsystem.

## Validation and performance

Verify project round trips, undo/redo, material and geometry editing, animation, import/export, keyboard handling and idle rendering. Cap history at 40 snapshots and 24 MiB of serialized state. Limit project/import file sizes, constrain numeric input, render only on invalidation or playback, and cap display pixel ratio by quality setting. Actual frame rates depend on hardware, resolution and scene complexity; do not claim a universal FPS target without measurements.
