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

## Testing

Forge uses layered Playwright validation so iterative development does not need to run the entire 300+ test suite after every change:

```sh
npm run test:last
npm run test:changed
npm run test:smoke
npm run test:modeling
npm run test:animation
npm run test:full
```

Development-time focused and changed-test runs are only fast feedback. The exact branch HEAD intended for merge must still pass `npm run build` and `npm run test:full -- --workers=2` on the Windows-local validation machine. Any new commit invalidates that full validation. See `docs/TESTING.md` for the complete workflow and worker policy.

## Editor workflow

- Use **Add** to create a cube, sphere, cylinder, cone, torus, plane or icosphere.
- Select in the viewport or outliner. Move, rotate and scale using gizmos or numeric properties. Choose **Global**, **Local** or **Gimbal** orientation and enable snapping for 0.5-unit translations, 15-degree rotations and 0.1 scale steps. Gimbal rotation uses dedicated Euler-order rings instead of reusing Local rotation. For XYZ, the X/Y/Z rings follow the actual gimbal axes (X in parent space, Y after X, Z after X+Y), so the middle Y channel can cross gimbal-lock angles without quaternion→Euler re-decomposition. Move and Scale use Local axes while Gimbal is selected.
- Orbit with middle mouse or Alt + left drag; pan with right mouse or Shift + middle mouse; zoom with the wheel. F frames the selection; 1/3/7 show front/right/top; 5 switches projection.
- Edit Mode offers Vertex, Edge and Face selection through a logical modeling-topology layer above the triangle renderer. Forge Cube and Plane primitives expose each grid cell as one logical quad: the renderer still stores two triangles per quad, but the triangulation diagonal is not a selectable modeling edge and clicking either renderer triangle selects the same face. Other meshes currently expose their available triangle polygons until richer polygon metadata is introduced. Vertex and edge selection can reach through the mesh. **Extrude selected face** expands a logical face back to its renderer triangles; a Cube/Plane quad therefore uses the existing planar-region extrusion path. Topology-changing operations currently invalidate the temporary quad-pair metadata and rebuild generic triangle polygons; polygon-preserving rebuilds are the next modeling stage.
- Material properties edit the first standard material of a selected mesh. Imported groups expose child meshes in the outliner. Solid and wireframe views are temporary viewport overrides.
- The Material workspace includes bounded **Texture paint** and texture management tools for UV-mapped meshes. Enable an embedded 256×256 canvas, choose a brush color and size, paint directly on the UV layout, or import PNG/JPEG/WebP pixels and export the active canvas as PNG; clear, undo/redo and Forge project save/load retain the bitmap. Layers, alpha masks and packing are not included.
- Use the timeline to insert transform keys across all nine scalar channels, or the Graph Editor to author Location/Rotation/Scale channels independently. Playback interpolates at a 24 fps timeline timebase across frames 1–250. Rotation tracks store unwrapped Euler radians, so values such as 270°, 540° or 720° survive scrubbing, playback and Forge project reloads instead of folding back into ±180°; quaternion values are derived for viewport transforms and GLB export.
- Use the top-bar **Light / Dark** control to switch the editor chrome between themes. Dark remains the default; the choice is stored locally and survives reload. Both themes keep Graph/Timeline secondary text at readable contrast. Theme switching affects editor chrome only and does not replace the WebGL scene background or alter scene lighting/materials.
- Ctrl+Z / Ctrl+Shift+Z undo and redo. Shift+D creates an independent duplicate; Alt+D creates a linked duplicate for an ordinary mesh, sharing its geometry and material while keeping transform, name and collection membership independent. Linked duplication rejects skinned meshes and meshes with an active modifier stack. Delete removes objects. Individual bones cannot be deleted or duplicated; duplicate the armature to make an independent character.

### Fill boundary face

In Edge Edit Mode, select every logical edge around one open mesh hole and use RMB -> **Fill Boundary Face**. Forge requires one simple closed logical boundary loop with at least three edges; interior manifold edges, incomplete loops, branched selections and multiple loops are rejected atomically. The new logical Triangle/Quad/N-gon is wound opposite the existing boundary-face uses so the hole closes with consistent manifold orientation, while renderer triangulation remains hidden beneath the modeling polygon. The material beside the active selected boundary edge becomes the new face material. After success Forge switches to Face mode and selects the new face, ready for Extrude or Inset. The operation is undoable.

### Face inset

In Edit Mode Face selection, RMB -> **Inset Faces** uses the shared **Inset Distance** in local mesh units. One selected convex logical Triangle, Quad or N-gon keeps the established single-face behavior: the outer boundary stays fixed, one inner polygon remains selected, and Forge adds one logical ring Quad per source boundary edge.

With two or more selected faces, Forge performs a logical **region inset** instead of insetting each face independently. The selection must be one edge-connected, consistently oriented region; it may cross folds between non-coplanar faces. Only region boundary loops are offset; internal shared logical edges are preserved inside the inset region rather than merged away. Outer loops move inward, hole loops move outward into the selected region, and Forge adds one logical ring Quad per region boundary edge. Unselected faces, including faces inside holes, remain unchanged. Excessive distances, invalid boundaries, zero-width folds, loop collisions/self-intersections on planar regions and precision collapse reject the whole operation before the mesh is changed. Renderer tessellation is regenerated underneath the logical polygons, and the original selected inner faces remain selected for the next modeling operation.

### Proportional editing

Enable **Proportional editing** in the Object panel, set a positive **Influence radius**, then move a selected vertex, edge or triangle in Edit Mode. Selected vertices move fully; nearby vertices follow with smooth falloff to zero at the radius. Distance is measured in local mesh units from the nearest selected vertex, including across disconnected geometry. Welded seams stay together. Each drag uses its starting positions and radius; Escape resets the current drag. Geometry changes support undo/redo and project saving. The toggle and radius are session preferences. Enable **Connected only** to measure shortest-path distance along mesh edges and keep disconnected islands fixed. Triangle diagonals participate; this is an edge-path approximation, not continuous surface distance. Exact coincident positions still share connectivity across seams. The setting is captured at drag start and remains a session preference. Radius overlays and proportional rotation/scale are not implemented.

### Viewport geometry statistics

Use the **Geometry statistics** activity button in the viewport toolbar to toggle a session-only overlay with separate **ALL** and **SELECTED** rows. Both rows show object, logical vertex, logical edge, logical face and renderer-triangle counts (`Obj / V / E / F / T`). Scene totals use Forge's logical modeling topology, so the default Cube reports 8 vertices, 12 edges and 6 faces rather than renderer buffer vertices or triangulation diagonals. In Object Mode, **SELECTED** totals the complete geometry of all selected objects. In Edit Mode, **SELECTED** reflects the current logical component selection: selected edges contribute their logical endpoints, selected faces contribute their logical boundary edges, and triangle counts come from the selected logical faces' tessellation. Empty component selections therefore report zero selected geometry while the active object remains selected.

### Component multi-selection

In Edit Mode, **Shift-click** to add or remove logical vertices, logical edges or logical faces.
Plain component clicks replace the selection. Click empty viewport space to clear
it; Shift-clicking empty space preserves it. Drag the move gizmo to move the
selection from the centroid of its unique logical vertices. Shared vertices and
welded seams move once, and proportional editing uses all selected vertices.
Shift-click takes priority over the gizmo so you can deselect its center component.
In Vertex Edit Mode, select exactly two adjacent logical vertices and use RMB -> **Merge at Center** or press **M** to collapse their shared logical edge to its midpoint. Affected Triangle/Quad/N-gon boundaries are retessellated, the merged midpoint vertex remains selected, and the operation is undoable.
Switching component modes or leaving Edit Mode clears the selection. Press **A** (or **Ctrl+A**) or use RMB -> **Select All**
to select every logical component in the active Vertex, Edge or Face mode; **Alt+A** / **Deselect All**
clears the component selection. Outside text-entry fields, Ctrl+A is intercepted by the editor so the browser does not highlight the whole UI; in Object Mode it remains a no-op. These shortcuts do not alter Object Mode selection.
RMB -> **Select Linked**
expands the current selection across each connected logical mesh island: vertices and edges follow
logical polygon boundary edges, while faces cross only shared logical boundary edges. RMB -> **Select More**
grows the current logical selection by exactly one adjacency ring: vertices add logical-edge neighbors,
edges add logical edges sharing an endpoint, and faces add faces sharing a logical boundary edge.
RMB -> **Select Less** removes one logical boundary ring by dropping selected components that touch unselected logical neighbors; a Select More followed by Select Less returns the default Cube's single seed selection.
Renderer triangulation diagonals never participate. In Face mode, RMB -> **Select Faces by Sides** selects logical Triangles, Quads or N-gons (5+ sides)
from polygon boundary size rather than renderer tessellation; the default Cube therefore has six Quads, not
twelve Triangles. **Select Coplanar Faces** expands the current face seed across shared logical polygon edges
only while adjacent faces remain on the same consistently oriented plane.
In Edge mode, RMB -> **Select Same Length** uses the active logical edge as a reference and selects logical polygon edges within the session-only **Length Tolerance (%)** (1% by default); renderer triangulation diagonals never participate. RMB -> **Select Sharp Edges** selects manifold logical edges shared by exactly two logical polygons
when their face-normal angle is at least the session-only **Sharp Angle** threshold (30° by default); renderer
triangulation diagonals, open boundaries and over-connected non-manifold edges are excluded. RMB -> **Select Non-Manifold Edges** selects logical edges whose polygon-face use count
is not two: open boundaries (one face) and over-connected edges (three or more faces). RMB -> **Select Mesh Boundary**
selects only open logical mesh edges used by exactly one logical polygon; closed surfaces such as the default Cube
have no mesh boundary. In Face mode,
RMB -> **Select Boundary Edges** converts the selected face region to its logical perimeter edges;
shared interior edges are omitted. RMB -> **Invert Selection** replaces the current selection with its
logical complement in the active Vertex, Edge or Face mode; an empty selection therefore becomes all
logical components in that mode. Renderer triangulation diagonals never participate. Selection is
temporary and these selection commands do not add an Undo step; moved geometry still supports undo/redo
and project saving. **Extrude Face** requires exactly one selected logical face. **Inset Faces**
accepts either one logical face or one edge-connected logical face region and keeps the resulting inner face selection.
**Extrude Region** accepts one edge-connected logical face region, including folded non-coplanar regions, and preserves its internal logical edges.

### Logical face region extrusion

In Face Edit Mode, select one edge-connected logical face region and choose **Extrude Region**. Forge keeps every selected Triangle, Quad or N-gon as its own logical cap polygon and preserves selected-selected internal logical edges. Only the region perimeter receives new logical wall Quads, including inner hole boundaries. Renderer triangulation remains an implementation detail underneath those polygons.

The shared **Extrude Distance** supplies a positive local-space distance. Forge derives one area-weighted outward direction from the selected logical face normals and translates the whole cap region by one common 3D vector. A planar region therefore moves along its common normal, while a folded region can cross creases without flattening or independently offsetting its faces. Because every cap vertex receives the same translation, the authored cap polygons and their internal edges keep their original shape.

The selected cap face IDs remain selected after the operation, so Extrude Region can be repeated immediately. UV/color seams remain independent per polygon side, existing face materials are retained, and each perimeter wall inherits its adjacent selected face material. Disconnected selections, selections whose normals cannot define one outward extrusion hemisphere, closed selections without a perimeter, ambiguous/non-manifold boundaries, collapsed walls and precision failures reject atomically before the mesh is replaced. Undo/redo and Forge project save/load retain the polygon-native result.

### Logical edge subdivision

In Edit Mode, choose **Edge**, select one or more logical polygon boundary edges (Shift-click to add or remove), then use **Subdivide Edges**. The Edge context exposes retained **Cuts** from 1 to 32. Forge inserts that many evenly spaced logical vertices on every selected edge and replaces each original boundary edge with **Cuts + 1** logical edge segments in every incident polygon. Triangle, Quad and N-gon identities are preserved: with three cuts, a selected edge of a Quad turns the affected Quad into a seven-sided logical polygon rather than exposing its renderer triangulation. Renderer triangles are regenerated underneath the updated logical boundaries.

Cut positions are shared across adjacent polygons while UV/color seam attributes interpolate independently on each polygon side. Material groups and stored logical polygon groups are retained, normals are recomputed, and all replacement logical edge segments remain selected for immediate editing. Multiple logical edges may be subdivided atomically in one operation. Cut-point collisions, unsupported attributes, morph targets, invalid groups, precision collapse and scene-budget overflow reject the whole operation without changing the mesh. Undo/redo and Forge projects retain the result. Use **Loop Cut** when the desired operation is a complete Quad-ring cut rather than evenly spaced subdivision of specific edges.

### Mesh target snapping

In Edit Mode, select vertices, edges or triangles and click **Pick snap target** in the Object panel. Choose **Vertex**, **Edge midpoint**, or **Surface point** under **Snap target**. Click an unselected vertex, or an edge with both endpoints unselected, in the active mesh to move the unique selection centroid to that target. Surface targets use the actual clicked point on the nearest triangle; all three target vertices must be unselected. Rotation and non-uniform object scale are supported. Edge targets use the local midpoint and include triangle diagonals; edge guides appear while picking even in Vertex mode. Selected vertices retain their relative spacing and welded seam copies move together; unselected geometry stays fixed. Picking can reach through geometry, as with vertex selection. Empty or invalid-target clicks keep the action active. Escape or **Cancel snap target** cancels without changing geometry. Switching modes or target kinds also cancels.

This discrete operation ignores grid snap and proportional editing settings. Undo/redo and Forge projects retain the geometry. It does not merge topology; as with ordinary component movement, coincident positions weld when re-entering Edit Mode. Continuous drag snapping, other-object targets, and arbitrary edge-point targets remain future work.

## Phase 2 modeling core

The Object panel includes collapsible **Mesh operations**, **UV editor**,
**Modifiers**, and **Multiple objects** sections.

| Feature | Supported workflow |
| --- | --- |
| Bevel | In Edit Mode, select sharp edges and use **Bevel selected edges**. Creates one flat bevel segment on a closed, consistently oriented convex mesh. Width is a local distance along adjacent faces. |
| Loop cut | Select exactly one logical Quad boundary edge, then RMB -> **Loop Cut**. The operator traverses opposite edges directly through logical Quads, supports a retained **Loop Position** from 0.01-0.99, preserves polygon groups, and leaves the newly created logical loop edges selected. |
| UV editing | Select triangle faces, open **UV editor**, project UVs or translate/rotate/scale existing UVs around their selected-corner center. UV seams split without moving geometry or changing normals; the canvas fits up to 2,000 selected triangles. |
| Multiple objects | Shift-click in the viewport or outliner. Use **Multiple objects** for world translation, rotation about the shared center, uniform scaling, or atomic subdivision of all selected meshes. Ordinary gizmos and numeric object properties still target the active object. |
| Modifier stack | Add **Mirror X**, **Subdivision**, or **Smooth**, change smooth strength, enable/disable, move up/down, remove, or apply. The stack evaluates from a retained source, not from its previous result. |
| Surface snapping | **Snap target → Surface point** moves the selection center to a clicked point in the active mesh. Target triangle vertices must all be unselected. |

Bevel rejects open, concave, nonmanifold or inconsistently oriented input,
coplanar diagonals, excessive widths, degenerate results and work-budget overflow.
At most 128 sharp edges can be beveled in one operation. Loop cuts reject
ambiguous quad pairing, triangle continuations and self-intersecting rings.
Bevel clears obsolete component selection; Loop Cut instead selects the newly
created logical loop for immediate editing. New bevel faces inherit an adjacent
material and boundary attributes; automatic bevel UV unwrap is not provided.
Loop Cut traverses authoritative logical Quad boundaries and rejects triangle/N-gon
continuations rather than treating renderer triangulation as modeling topology.

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

Small scenes recover through browser local storage. Local storage has browser-specific limits; larger scenes must be downloaded. **Save project** or Ctrl+S opens a filename dialog before download; Forge adds the `.forge` extension automatically, strips a duplicated `.forge`, normalizes Windows-unsafe filename characters, and keeps the saved project name aligned with the chosen filename. Canceling the dialog changes nothing. Opening a project replaces the current scene and can be undone while the history budget permits. Project files are capped at 32 MB and two million vertices. Back up important work with **Save project**.

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

The editor now has a logical polygon-selection foundation and polygon-native Cut Face, Knife, single-face extrusion/inset, bevel and Loop Cut paths, but does not yet preserve polygon topology through every modeling operation. Curved-surface region extrusion, multi-face inset, sculpting, weight painting, IK pole vectors/joint limits, retargeting, geometry nodes, physics, compositing and offline rendering are not yet included. The modeling core includes bevel, loop cuts, UV editing, modifiers and mesh snapping within the supported limits documented above. Kimodo text-to-motion inference is not connected. The UI exposes only implemented local workflows and labels the basic rigging limitations.

The development plan is [docs/plans/2026-09-08-forge-studio.md](docs/plans/2026-09-08-forge-studio.md).



### Viewport box selection

Left-drag in the 3D viewport draws a selection marquee. Object Mode selects objects whose projected bounds overlap the box; Edit Mode selects logical vertex positions, screen-space edge segments, or triangle centroids according to the active component type. Weight Mode uses the same vertex box selection. Hold Shift while dragging to add to the current selection. Hold Ctrl while dragging to toggle every boxed item: selected items are removed and unselected items are added. Ctrl takes precedence over Shift for a marquee started with both modifiers. Press Escape to cancel an active marquee. Alt-left orbit remains separate from box selection.

## Parametric primitives

Cube, Plane, Sphere, Cylinder, Cone, Torus and Icosphere expose dimensions and subdivision controls in Object properties. Increase segments before skin binding when you need denser weight vertices. Applying the primitive or changing topology converts it to an ordinary mesh.

Forge still renders triangles internally. Quad and N-gon editing lives in the separate logical modeling-topology layer: renderer triangulation and its internal diagonals remain subordinate implementation details and are not exposed as modeling components.
