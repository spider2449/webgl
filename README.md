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
- Use the timeline to insert transform keys across all nine scalar channels, or the Graph Editor to author Location/Rotation/Scale channels independently. Playback interpolates at a 24 fps timeline timebase across frames 1–250. Rotation tracks store unwrapped Euler radians, so values such as 270°, 540° or 720° survive scrubbing, playback and Forge project reloads instead of folding back into ±180°; quaternion values are derived for viewport transforms and GLB export.
- Use the top-bar **Light / Dark** control to switch the editor chrome between themes. Dark remains the default; the choice is stored locally and survives reload. Both themes keep Graph/Timeline secondary text at readable contrast. Theme switching affects editor chrome only and does not replace the WebGL scene background or alter scene lighting/materials.
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

Open the **Animation** workspace to author and edit transform animation. Forge
stores nine independent scalar tracks: **Location X/Y/Z**, **Rotation X/Y/Z**
and **Scale X/Y/Z**. Each track owns its own key frames, values, interpolation
and Bezier tangents.

The Timeline header exposes the scene **Start / End Frame Range**, defaulting
to **1–250**. Frame 250 is only the default end frame, not a hard animation
limit: extend End for a longer playback / Timeline window (Forge currently
applies a defensive authored-frame domain of 1–100,000). The Timeline ruler,
scrubber, current frame and Scene playback use this dynamic range. Authored keys
may exist before Start or after End; changing the Scene Frame Range never warns
about, deletes, or invalidates those keys. Timeline markers show keys inside the
current Scene Range, while Graph **Frame All / Frame Selected** can recover keys
outside it. The range is stored in new `.forge` snapshots; older projects
without it load as 1–250.

Forge also supports a separate **Preview Range** for temporary playback of a
subsection without changing the scene's Start / End or authored keys. Use the
Timeline **Preview** control with **P Start / P End** to enable it. While active,
Play and First/Last use the preview subset, but the Timeline continues to show
the entire Scene Frame Range and all authored keys. The highlighted Preview
overlay is playback-only. Clear Preview to return playback to the full Scene
Frame Range. Preview Range is saved in `.forge` projects and participates in
undo/redo.

For long scenes, the Timeline has its own editor-only **View Range**. Mouse
wheel zooms around the pointer and middle-mouse drag pans horizontally. A
horizontal **View Scrollbar** at the bottom mirrors the Scene Range: drag its
thumb to pan, drag either edge handle to resize/zoom the visible range, or click
empty scrollbar track to page left/right. The Timeline view controls restore
the full **Scene Range**, frame selected summary keys, or center the current
frame while preserving zoom. Home, Numpad . and Numpad 0 provide the same
framing actions while the Timeline has focus. This view state is not saved in
`.forge` and never enters undo history. Ruler labels, markers, Preview overlay,
playhead, box selection, scrubbing and summary-key dragging all use the active
Timeline view transform; Scene / Preview ranges and authored-key validity remain
unchanged.

The timeline header keeps the fast transform workflow: **Insert transform key**
authors all nine scalar channels at the current frame, while **Remove current
key** removes any channel keys at that frame. Timeline markers and previous/next
navigation use the union of key frames across all channels inside the active
Start–End window. Drag a timeline
marker horizontally to retime every scalar-channel key authored at that summary
frame. **Shift-click** summary markers to build a Timeline selection, or
**Shift-drag empty Timeline space** to add every summary marker inside the
horizontal box. Plain Timeline dragging remains frame scrubbing. Drag any
selected marker to move the selected summary frames by one shared whole-frame
delta, or **Alt-drag** to duplicate the full selected summary-frame set while
leaving the sources in place. Use **Delete/Backspace** or the Timeline remove
button in the **Summary Keys** toolbar directly above the Timeline track to
remove selected summary frames across all participating scalar channels. For two
or more selected summary frames, that same Timeline **Time Scale** control scales
frame spacing around the midpoint of the selected range. Move,
copy, delete and time-scale batches each create one undo entry and validate the
whole participating scalar-channel set before changing tracks. Copy/move/scale
are rejected without partial changes when a same-channel collision would occur;
move/scale enforce the active Scene Frame Range and time scaling rejects rounded
frame collapse. Escape or pointer cancellation restores the pre-drag Timeline state
and never cancels the active object selection. Timeline selection remains a
summary-frame interaction and does not create a second animation key model.

The **Graph Editor is the sole detailed animation editing UI**. Select a channel
from the rail, then use **Insert channel key** to author that scalar
independently. Click a key for single selection or **Shift-click** to toggle
multiple keys on the active channel. A dedicated **Key Inspector** row shows the
Graph selection count. With exactly one key selected it exposes precise
**Frame** and **Value** fields; Apply or Enter commits both atomically in one
undo step, while Escape discards uncommitted field edits. Rotation values are
shown and entered in degrees, and precise retiming rejects same-channel
collisions before changing the track. Multi-selection disables precise
Frame/Value editing but keeps eligible batch controls available.

The Graph view can be navigated independently of animation data. **MMB-drag**
pans frame/value space and the mouse wheel zooms around the pointer. The Graph
header provides **Frame All**, **Frame Selected**, **Scene Range**, and **Current
Frame** controls; with the Graph focused, **Home**, **Numpad .**, and **Numpad
0** provide the corresponding framing shortcuts. Manual Graph views are kept
separately for each object + scalar channel, and view changes never create undo
history. The default horizontal view remains frames 1–250. Escape or pointer
cancellation during an MMB pan restores the pre-pan view.

Drag empty Graph space to box-select keys; **Shift-drag** adds the boxed keys to
the existing selection. Dragging any selected key moves the whole selection by
one shared frame/value delta; **Alt-drag** shows copy ghosts and commits all
copied keys only on pointer release. **Remove selected channel key** deletes the
full selected set in one undoable action. The Key Inspector row also contains
the **Segment**, **Tangent**, and **Time Scale** batch controls: Segment assigns
Linear/Constant/Bezier to selected outbound segments, Tangent assigns
Free/Aligned/Auto to selected keys touching a Bezier segment, and Time Scale
scales two or more selected key times around the midpoint of their frame range.
Mixed selections show a **Mixed** placeholder. Time scaling rounds to integer
frames and rejects collapse, frames outside 1–250, or collision with an
unselected key. Successful batch operations remain one undoable action and keep
the resulting keys selected. Other channels keep their own timing.

Every segment is **Linear by default**. A key controls its outbound segment and
can use:

- **Linear** — interpolate scalar values linearly.
- **Constant** — hold the source value until the next key.
- **Bezier** — evaluate a cubic curve in frame/value space.

There is no object-wide interpolation mode, no channel-wide interpolation
override, no Smooth fallback, and no Inherit mode. Different segments on the
same channel may use different modes; the channel rail shows **MIX** when they
differ.

Bezier keys support **Free**, **Aligned**, and **Auto** tangent modes. Free
handles are independent. Aligned keeps both sides opposite and collinear while
preserving the opposite handle length when bounds allow. Auto derives a
monotone slope from neighboring scalar keys and updates automatically as key
times or values change. Following the Blender Graph Editor interaction model,
manually dragging or precisely editing an Auto handle materializes its current
automatic handles and converts that key to **Aligned**; undo restores Auto and
its computed handles. A dedicated **Bezier Handles** inspector below the Key
Inspector shows the active mode as **FREE · independent**, **ALIGNED · linked**,
or **AUTO · edit → ALIGNED**, and exposes the selected Left/Right handle's
absolute **Frame** and **Value**. Handle frames may be fractional; rotation
handle values are displayed and entered in degrees. Free edits affect one side,
while Aligned edits keep the opposite side collinear. Rotation tracks store
unwrapped radians, so values such as 270°, 540°, or 720° remain continuous.

Transform fields in the Object panel use Blender-style animation state colors
per scalar channel: **yellow** when that channel has a key on the current frame,
**green** when that channel is animated but keyed elsewhere, **orange** when the
live value differs from the evaluated track and still needs a key, and neutral
when the channel has no animation.

Graph key and tangent drags, timeline summary-key drags, batch interpolation
assignment, batch tangent-mode assignment, and selected-key time scaling each
create one undoable history entry. Escape or pointer cancellation restores the
original track data. Forge project loading rejects
the removed transform-wide `keyframes`, `animationInterpolation`, and
`animationChannelInterpolation` fields rather than maintaining a second
animation model.

glTF transform channels still operate on whole position/rotation/scale targets.
Forge therefore exports each transform group on the union of its three scalar
track times. Pure Linear data stays LINEAR. Constant and Bezier segments are
baked to LINEAR samples; Bezier uses 32 samples per segment and Constant adds a
near-boundary hold sample. Multi-turn rotation adds bounded angular samples
before quaternion export. This is an interchange approximation; arbitrary
F-curves, weighted tangent types, curve modifiers, lasso selection, and
cross-channel key selection remain future work.

## Armature rigging

1. Open **Rigging** and choose **Create armature**. Forge creates a native editable armature with one root bone and enters **Edit** mode.
2. In Edit mode, use **Extrude** to create child bones, **Add bone** for another root chain, **Reparent selected bone** to change hierarchy while preserving the bone's world transform, and **Delete selected bone** to remove a joint while reparenting its children in place. Move or rotate bones to author the rest skeleton. Forge always keeps at least one bone in an armature.
3. Switch to **Pose** mode before binding or animating. Select a bone in the viewport or searchable bone list for FK posing. The existing scalar Timeline and Graph channels animate bone position, rotation and scale like any other transform target.
4. For positional IK, select an end bone, choose the chain length, and click **IK selected bone**. Drag the target, then choose **Key full pose**. IK is solved into ordinary FK transforms rather than stored as a persistent constraint.
5. To bind a custom mesh, leave the armature at its rest pose, select a standalone mesh, then click **Bind selected mesh**. Four distance-based influences per vertex are generated in a worker as a starting point.
6. With a bound skin selected, choose **Edit selected skin weights**. Weight Mode reuses viewport vertex selection without enabling geometry movement. Pick a bone, set a 0–1 influence, then **Apply**, **Clear bone**, or **Normalize selected vertices**. Every edited vertex remains normalized to four influence slots.
7. Save a `.forge` project or export GLB to retain the generic bone hierarchy, skin weights and transform animation.

Rest-skeleton editing is intentionally locked after a skin is bound or bone animation keys exist. This keeps the current skin indices, inverse bind matrices and authored scalar animation from silently becoming inconsistent. More advanced post-bind rig editing will require an explicit rebind/remap workflow.

**SOMA77 preset:** **Add SOMA77 preset** remains available temporarily as a pose-only compatibility preset with its procedural preview. The 77 joint names, hierarchy and native neutral positions come from NVIDIA Kimodo revision `1aece8c124d73d255ceff5086d983b844c9f4e94`. Attribution and license remain in `THIRD_PARTY_NOTICES.md` and `licenses/`.

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



### Viewport box selection

Left-drag in the 3D viewport draws a selection marquee. Object Mode selects objects whose projected bounds overlap the box; Edit Mode selects logical vertex positions, screen-space edge segments, or triangle centroids according to the active component type. Weight Mode uses the same vertex box selection. Hold Shift while dragging to add to the current selection. Hold Ctrl while dragging to toggle every boxed item: selected items are removed and unselected items are added. Ctrl takes precedence over Shift for a marquee started with both modifiers. Press Escape to cancel an active marquee. Alt-left orbit remains separate from box selection.

## Parametric primitives

Cube, Plane, Sphere, Cylinder, Cone, Torus and Icosphere expose dimensions and subdivision controls in Object properties. Increase segments before skin binding when you need denser weight vertices. Applying the primitive or changing topology converts it to an ordinary mesh.

Forge still renders triangles internally. Quad and polygon editing belong to the modeling topology layer and are planned as a separate follow-up so editing can be quad-friendly without changing the WebGL render substrate.
