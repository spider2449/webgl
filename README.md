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
- Select in the viewport or outliner. Move, rotate and scale using gizmos or numeric properties. Choose **Global**, **Local** or **Gimbal** orientation and enable snapping for 0.5-unit translations, 15-degree rotations and 0.1 scale steps. Gimbal rotation uses dedicated Euler-order rings instead of reusing Local rotation. For XYZ, the X/Y/Z rings follow the actual gimbal axes (X in parent space, Y after X, Z after X+Y), so the middle Y channel can cross gimbal-lock angles without quaternion→Euler re-decomposition. Move and Scale use Local axes while Gimbal is selected.
- Orbit with middle mouse or Alt + left drag; pan with right mouse or Shift + middle mouse; zoom with the wheel. F frames the selection; 1/3/7 show front/right/top; 5 switches projection.
- Edit Mode offers Vertex, Edge and Triangle face selection. Click a component and drag its move gizmo to translate all its vertices together; selected vertices appear orange. Exactly coincident positions move together across normal and UV seams. Edges include triangulation diagonals; faces are individual triangles. Vertex and edge selection can reach through the mesh. Use **Extrude selected triangle** in the Object panel to add an offset cap and three walls along the face normal. Set a positive **Extrusion distance** in local mesh units; the cap stays selected for movement or repeated extrusion. Each operation accepts up to 100k input vertices. Existing UVs/colors and material groups are retained; wall UVs copy the boundary values and need later unwrapping. Unsupported attributes, morph targets and partial draw ranges are rejected. Use **Extrude planar region** for connected coplanar face selections. Inward extrusion and polygon merging are not implemented.
- Material properties edit the first standard material of a selected mesh. Imported groups expose child meshes in the outliner. Solid and wireframe views are temporary viewport overrides.
- The Material workspace includes bounded **Texture paint** and texture management tools for UV-mapped meshes. Enable an embedded 256×256 canvas, choose a brush color and size, paint directly on the UV layout, or import PNG/JPEG/WebP pixels and export the active canvas as PNG; clear, undo/redo and Forge project save/load retain the bitmap. Layers, alpha masks and packing are not included.
- Use the timeline to insert transform keys, move to another frame, change the object, and insert another key. Playback interpolates at a 24 fps timeline timebase across frames 1–250. Newly authored keys retain unwrapped Euler rotation alongside quaternion orientation, so values such as 270° or 540° survive scrubbing, playback and Forge project reloads instead of folding back into ±180°. Existing quaternion-only projects remain supported.
- Ctrl+Z / Ctrl+Shift+Z undo and redo. Shift+D creates an independent duplicate; Alt+D creates a linked duplicate for an ordinary mesh, sharing its geometry and material while keeping transform, name and collection membership independent. Linked duplication rejects skinned meshes and meshes with an active modifier stack. Delete removes objects. Individual bones cannot be deleted or duplicated; duplicate the armature to make an independent character.

### Triangle inset

In Edit Mode, select a triangle face and use **Inset selected triangle** in the Object panel. **Inset distance** is the perpendicular inward distance from each edge in local mesh units and must be smaller than the triangle inradius. The outer boundary stays fixed; the inner face remains selected for another inset, extrusion or movement. UVs and colors are interpolated, material groups are preserved, and undo/redo and Forge projects retain the result. The same 100k input-vertex and attribute restrictions as extrusion apply. Region inset and polygon face editing remain future work.

### Proportional editing

Enable **Proportional editing** in the Object panel, set a positive **Influence radius**, then move a selected vertex, edge or triangle in Edit Mode. Selected vertices move fully; nearby vertices follow with smooth falloff to zero at the radius. Distance is measured in local mesh units from the nearest selected vertex, including across disconnected geometry. Welded seams stay together. Each drag uses its starting positions and radius; Escape resets the current drag. Geometry changes support undo/redo and project saving. The toggle and radius are session preferences. Enable **Connected only** to measure shortest-path distance along mesh edges and keep disconnected islands fixed. Triangle diagonals participate; this is an edge-path approximation, not continuous surface distance. Exact coincident positions still share connectivity across seams. The setting is captured at drag start and remains a session preference. Radius overlays and proportional rotation/scale are not implemented.

### Component multi-selection

In Edit Mode, **Shift-click** to add or remove vertices, edges or triangle faces.
Plain component clicks replace the selection. Click empty viewport space to clear
it; Shift-clicking empty space preserves it. Drag the move gizmo to move the
selection from the centroid of its unique logical vertices. Shared vertices and
welded seams move once, and proportional editing uses all selected vertices.
Shift-click takes priority over the gizmo so you can deselect its center component.
Switching component modes or leaving Edit Mode clears the selection. Selection is
temporary; moved geometry supports undo/redo and project saving. The single-triangle extrusion and
inset buttons require exactly one selected triangle and select their resulting cap.
**Extrude planar region** accepts connected coplanar face selections.

### Planar region extrusion

In Edit Mode with Triangle face selection, Shift-click connected coplanar triangles and choose **Extrude planar region**. The existing **Extrusion distance** sets the positive offset in local units. The selected faces move together along their common normal; only region boundaries get side walls, including hole boundaries. Cap faces remain selected for another extrusion or group movement. UV/color seams and material groups are retained; wall UVs inherit boundary coordinates. Undo/redo and Forge projects retain the result.

The operation accepts up to 100k input vertices and 200k triangles and rejects disconnected/nonplanar selections, invalid topology, ambiguous boundaries, unsupported attributes and precision collapse before changing the mesh. Planarity uses a relative tolerance of one millionth of the region diagonal (minimum 0.0000001 local units). Curved-surface extrusion, inward extrusion, collision checks and automatic wall UV unwrapping remain future work.

### Edge subdivision

In Edit Mode, choose **Edge**, select one or more edges (Shift-click to add or remove), then click **Subdivide selected edges**. The operation inserts a midpoint on every selected edge and splits adjacent triangles, including across UV/normal seams. Triangles with one, two or three selected edges become two, three or four triangles. It switches to Vertex mode with all new midpoints selected for movement. Existing attributes are retained, midpoint UVs/colors interpolate separately across seams, material groups are remapped and normals are recomputed. Undo/redo and Forge projects retain the result.

Boundary edges and consistently oriented two-face manifold edges are supported, with limits of 100k input vertices and 200k triangles. Unsupported attributes, morph targets, partial draw ranges, invalid groups, degenerate results and midpoint collisions with existing vertices or other new midpoints are rejected. If any selected edge is invalid or the result exceeds the scene vertex limit, the entire operation leaves geometry and selection unchanged. Output is independent of selection order. Full loop cuts and quad reconstruction remain future work.

### Mesh target snapping

In Edit Mode, select vertices, edges or triangles and click **Pick snap target** in the Object panel. Choose **Vertex**, **Edge midpoint**, or **Surface point** under **Snap target**. Click an unselected vertex, or an edge with both endpoints unselected, in the active mesh to move the unique selection centroid to that target. Surface targets use the actual clicked point on the nearest triangle; all three target vertices must be unselected. Rotation and non-uniform object scale are supported. Edge targets use the local midpoint and include triangle diagonals; edge guides appear while picking even in Vertex mode. Selected vertices retain their relative spacing and welded seam copies move together; unselected geometry stays fixed. Picking can reach through geometry, as with vertex selection. Empty or invalid-target clicks keep the action active. Escape or **Cancel snap target** cancels without changing geometry. Switching modes or target kinds also cancels.

This discrete operation ignores grid snap and proportional editing settings. Undo/redo and Forge projects retain the geometry. It does not merge topology; as with ordinary component movement, coincident positions weld when re-entering Edit Mode. Continuous drag snapping, other-object targets, and arbitrary edge-point targets remain future work.

## Phase 2 modeling core

The Object panel includes collapsible **Mesh operations**, **UV editor**,
**Modifiers**, and **Multiple objects** sections.

| Feature | Supported workflow |
| --- | --- |
| Bevel | In Edit Mode, select sharp edges and use **Bevel selected edges**. Creates one flat bevel segment on a closed, consistently oriented convex mesh. Width is a local distance along adjacent faces. |
| Loop cut | Select exactly one quad boundary edge, then **Cut quad loop**. Reconstructs planar convex quads from their longer triangulation diagonals and cuts the opposite-edge ring or boundary-to-boundary strip at its midpoint. |
| UV editing | Select triangle faces, open **UV editor**, project UVs or translate/rotate/scale existing UVs around their selected-corner center. UV seams split without moving geometry or changing normals; the canvas fits up to 2,000 selected triangles. |
| Multiple objects | Shift-click in the viewport or outliner. Use **Multiple objects** for world translation, rotation about the shared center, uniform scaling, or atomic subdivision of all selected meshes. Ordinary gizmos and numeric object properties still target the active object. |
| Modifier stack | Add **Mirror X**, **Subdivision**, or **Smooth**, change smooth strength, enable/disable, move up/down, remove, or apply. The stack evaluates from a retained source, not from its previous result. |
| Surface snapping | **Snap target → Surface point** moves the selection center to a clicked point in the active mesh. Target triangle vertices must all be unselected. |

Bevel rejects open, concave, nonmanifold or inconsistently oriented input,
coplanar diagonals, excessive widths, degenerate results and work-budget overflow.
At most 128 sharp edges can be beveled in one operation. Loop cuts reject
ambiguous quad pairing, triangle continuations and self-intersecting rings.
Bevel and loop cuts clear obsolete component selection. New bevel faces inherit
an adjacent material and boundary attributes; automatic bevel UV unwrap is not
provided. Quads are inferred from triangles, so arbitrary polygon reconstruction
and repeated cuts of every possible triangulation are not guaranteed.

Modifiers are saved with their source in Forge projects and history. Apply the
stack before component editing or skin binding. Removing the last modifier
restores source geometry; applying keeps the evaluated result. Mirror duplicates
across local X with reversed winding: use a half mesh away from the plane to
avoid overlapping faces. It does not merge the center seam. Subdivision splits
all triangle edges once per stack entry; Smooth averages welded logical neighbors.
Up to eight modifiers are allowed. General Blender modifier parity, Catmull–Clark
surfaces, arbitrary boolean stacks and automatic UV packing are outside this core.

Extrusion, inset, subdivision, bevel, loop cuts, UV editing and modifier evaluation run in a cancellable worker. Scene or selection
changes discard stale results; multi-object subdivision prepares every result
before installing any. Escape or **Cancel operation** cancels a pending job.
Entering Edit Mode on meshes with at least 10,000 vertices also builds connectivity
in a worker. Supported modeling inputs are bounded to 100,000 vertices and
200,000 triangles, with 32 MB geometry payload/result and two-million scene-vertex
limits. Expanded outputs can reach 600,000 rendering vertices; another operation
may require a smaller mesh. Morph targets and custom/skinning attributes are
rejected for these operations.

Run `npm run benchmark` for the reproducible large-mesh worker benchmark.
[Measured results](docs/benchmarks/2026-09-12-modeling.md) include worker time,
round-trip time and main-thread timer gaps. Serialization, result cloning,
helper-buffer setup and history snapshots still run on the main thread;
off-thread calculation does not imply stall-free interaction or a universal FPS.

## Linked instances

Use **Alt+D** or **Edit → Linked duplicate** on an ordinary mesh to create a second object that shares the same geometry and material resources. Object transforms, names, animation data and collection membership remain independent. Editing shared mesh data or material properties through either instance is visible on the other, and Forge project save/load plus undo/redo preserve the shared resource identity.

Linked duplication is intentionally bounded: skinned meshes and meshes with an active modifier stack are rejected. Shift+D remains the independent deep-copy workflow. A later topology or modifier operation that replaces a mesh resource can intentionally make that object independent; there is no separate instance-group editor yet.

## Animation interpolation

In the Object panel, choose **Linear**, **Constant**, or **Smooth** under
**Animation > Interpolation**. The mode applies to all transform keyframe
segments on the selected object, including position, quaternion rotation and
scale. Constant holds the earlier pose until the next key; Smooth eases time
with smoothstep. Existing projects use Linear. Undo/redo and Forge projects
retain the mode.

Use **Keyframe** to jump to an authored transform key. Set **Target frame**
(1-250), then **Move keyframe** or **Copy keyframe** to change its timing or
repeat its pose. The destination must be empty. Actions follow the resulting
key, preserve interpolation and support undo/redo and project saving.

For an existing key, choose **Channel** and edit one scalar **Location X/Y/Z**
or **Scale X/Y/Z** value without replacing the other transform values in that
key. Changes evaluate immediately, participate in undo/redo, survive Forge
project round trips and flow into GLB export. Playback must be paused and Object
Mode active. Rotation remains stored and interpolated as a quaternion, so
component-level rotation editing is intentionally not exposed.

GLB export preserves Constant as STEP. Smooth exports 32 evenly spaced samples
per segment and uses linear interpolation between them, so exported motion is
an approximation. Editable Bezier handles, per-channel interpolation, rotation
curve editing and batch curve operations remain future work.

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

The editor does not yet include polygon face editing, curved-surface region extrusion or region inset, sculpting, weight painting, IK pole vectors/joint limits, retargeting, geometry nodes, physics, compositing or offline rendering. The modeling core includes bevel, loop cuts, UV editing, modifiers and mesh snapping within the supported limits documented above. Kimodo text-to-motion inference is not connected. The UI exposes only implemented local workflows and labels the basic rigging limitations.

The development plan is [docs/plans/2026-09-08-forge-studio.md](docs/plans/2026-09-08-forge-studio.md).
