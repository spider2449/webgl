# Forge Studio

A browser-based 3D editor inspired by Blender, built with TypeScript, Three.js and Vite. Includes a working NVIDIA Kimodo SOMA77 rigging foundation. This is an initial editor release, not Blender feature parity.

## Run locally

Requires Node.js 22.12+ or 24+ and a browser with WebGL 2.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The default is `http://127.0.0.1:5173`; Vite selects another port if occupied. This implementation session uses `http://127.0.0.1:5174`.

```sh
npm run build
npm run preview
npx playwright install chromium
npm test
```

The browser tests use port 5174. Production output is in `dist/`. No backend, account, model download or NVIDIA GPU is required for the editor and local rigging features. Google Fonts is the only external presentation dependency; system fonts are the fallback. Models and project data are processed locally.

## Editor workflow

- Use **Add** to create a cube, sphere, cylinder, cone, torus, plane or icosphere.
- Select in the viewport or outliner. Move, rotate and scale using gizmos or numeric properties. Choose Global/Local orientation and enable snapping for 0.5-unit translations, 15-degree rotations and 0.1 scale steps.
- Orbit with middle mouse or Alt + left drag; pan with right mouse or Shift + middle mouse; zoom with the wheel. F frames the selection; 1/3/7 show front/right/top; 5 switches projection.
- Edit Mode offers Vertex, Edge and Triangle face selection. Click a component and drag its move gizmo to translate all its vertices together; selected vertices appear orange. Exactly coincident positions move together across normal and UV seams. Edges include triangulation diagonals; faces are individual triangles. Vertex and edge selection can reach through the mesh. Use **Extrude selected triangle** in the Object panel to add an offset cap and three walls along the face normal. Set a positive **Extrusion distance** in local mesh units; the cap stays selected for movement or repeated extrusion. Each operation accepts up to 100k input vertices. Existing UVs/colors and material groups are retained; wall UVs copy the boundary values and need later unwrapping. Unsupported attributes, morph targets and partial draw ranges are rejected. Multi-face regions, inward extrusion and polygon merging are not implemented.
- Material properties edit the first standard material of a selected mesh. Imported groups expose child meshes in the outliner. Solid and wireframe views are temporary viewport overrides.
- Use the timeline to insert transform keys, move to another frame, change the object, and insert another key. Playback interpolates at a 24 fps timeline timebase across frames 1–250.
- Ctrl+Z / Ctrl+Shift+Z undo and redo. Shift+D duplicates objects; Delete removes them. Individual bones cannot be deleted or duplicated; duplicate the armature to make an independent character.

### Triangle inset

In Edit Mode, select a triangle face and use **Inset selected triangle** in the Object panel. **Inset distance** is the perpendicular inward distance from each edge in local mesh units and must be smaller than the triangle inradius. The outer boundary stays fixed; the inner face remains selected for another inset, extrusion or movement. UVs and colors are interpolated, material groups are preserved, and undo/redo and Forge projects retain the result. The same 100k input-vertex and attribute restrictions as extrusion apply. Region inset and polygon face editing remain future work.

## Kimodo rigging

1. Open **Rigging** and choose **Create SOMA77 armature**.
2. Choose **Add skinned preview** for an immediately poseable, procedural body proxy. It is not the SOMA body mesh.
3. Select a bone in the viewport or searchable joint list, then rotate it with the gizmo. The Object panel exposes precise bone transforms.
4. For positional IK, choose a hand or foot and click **Move IK target**. Drag the target, then choose **Key full pose** to record all 77 bones. IK is solved to FK transforms; it is not a persistent animated constraint.
5. Use **Rest pose** before binding. To bind a custom mesh, align a standalone mesh to the armature, select the mesh, then click **Bind selected mesh**. The first armature is used when selection is outside a rig. Distance-based weights are a starting point, not production-quality anatomical weights.
6. Save a `.forge` project or export GLB to retain bones, skin weights and transform animation.

The 77 joint names, parents, order and root-relative neutral positions come from official NVIDIA Kimodo revision `1aece8c124d73d255ceff5086d983b844c9f4e94`. `Hips` remains `(0,0,0)` in the rest pose. A separate armature container grounds the visible character. Coordinates are in meters, Y up, with +Z forward. This uses the native neutral skeleton, not an invented approximation or a T-pose with unaccounted rotation offsets.

Sources: [official skeleton documentation](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/skeleton.html), [joint definitions](https://github.com/nv-tlabs/kimodo/blob/1aece8c124d73d255ceff5086d983b844c9f4e94/kimodo/skeleton/definitions.py), [neutral skeleton data](https://github.com/nv-tlabs/kimodo/blob/1aece8c124d73d255ceff5086d983b844c9f4e94/kimodo/assets/skeletons/somaskel77/joints.p). Attribution and license are in `THIRD_PARTY_NOTICES.md` and `licenses/`.

## Files and recovery

| Format | Import | Export |
| --- | --- | --- |
| Forge JSON (`.forge`) | Full editable project | Objects, geometry, materials, rigs, skin weights, transform keys |
| GLB | Embedded meshes, materials and skins | Meshes, materials, skins and authored transform animation |
| OBJ | Geometry; external MTL/textures are not loaded | Geometry only |
| PNG | — | Current viewport, including helpers |

Imported GLB animation clips are not loaded into the editable timeline. Draco/KTX2 assets and external model resources are not supported. Native `.blend` files are not supported. Scene settings and camera view are session-only.

Small scenes recover through browser local storage. Local storage has browser-specific limits; larger scenes must be downloaded. Opening a project replaces the current scene and can be undone while the history budget permits. Project files are capped at 32 MB and two million vertices. Back up important work with **Save project**.

## Performance architecture

- Demand-driven rendering: no persistent idle animation loop; continuous frames only during playback.
- GPU-skinned meshes and instanced rig joint markers; a two-triangle derivative-based grid.
- Pixel-ratio caps: Performance 1.0, Balanced 1.5, High 2.0, bounded by device pixel ratio.
- Auto skinning runs in a Web Worker, with four normalized influences per vertex and a 100k-vertex per-job cap. A changed scene invalidates an in-flight binding result.
- Lazy GLB/OBJ import and export modules.
- Undo history capped at 40 snapshots and 24 MiB of estimated UTF-16 storage. A single scene larger than that budget disables history. Snapshot serialization is synchronous; large-scene command-based history is future work.
- Shared resource-aware GPU disposal and tab-hidden playback suspension.
- Scene statistics show objects, vertices and triangles; hover for draw calls and cumulative rendered frames.

The automated WebGL tests use Chromium's software renderer for repeatability. They verify behavior and idle rendering, not target GPU frame rates. Performance on large production scenes has not been benchmarked. Vite reports a main-bundle size warning because the rendering engine is included in the initial bundle.

## Current limits and next stages

The editor does not yet include polygon face editing, region extrusion or inset, bevel, topology modifiers, sculpting, UV editing, texture painting, weight painting, IK pole vectors/joint limits, retargeting, geometry nodes, physics, compositing or offline rendering. Kimodo text-to-motion inference is not connected. The UI exposes only implemented local workflows and labels the basic rigging limitations.

The development plan is [docs/plans/2026-09-08-forge-studio.md](docs/plans/2026-09-08-forge-studio.md).
