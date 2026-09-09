import './style.css';
import * as THREE from 'three';
import { createIcons, Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Undo2, Redo2, Copy, Trash2, X, HelpCircle, Download, Upload, Camera, Check, Circle, Triangle, Hexagon, FolderOpen, Save, FilePlus2, Maximize, Globe, Settings2, Crosshair, Sun, Activity, PanelRightClose } from 'lucide';
import { Editor, type Primitive, type Project, type Keyframe } from './editor';
import { RigSystem, rigBones, RIG_SOURCE } from './rig';

const icons = { Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Undo2, Redo2, Copy, Trash2, X, HelpCircle, Download, Upload, Camera, Check, Circle, Triangle, Hexagon, FolderOpen, Save, FilePlus2, Maximize, Globe, Settings2, Crosshair, Sun, Activity, PanelRightClose };
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const button = (id: string, name: string, label: string, extra = '') => `<button id="${id}" class="icon-button ${extra}" title="${label}" aria-label="${label}">${icon(name)}</button>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.5 } });

$('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Forge Studio"><span class="brand-mark">F</span> FORGE <span class="brand-divider"></span><span class="studio-label">3D STUDIO</span></a>
    <nav class="main-menu" aria-label="Application menu">
      <div class="dropdown"><button data-menu="file-menu">File</button><div class="menu hidden" id="file-menu"><button id="new-project">${icon('file-plus-2')}New scene<kbd>Ctrl N</kbd></button><button id="open-project">${icon('folder-open')}Open project<kbd>Ctrl O</kbd></button><button id="save-project">${icon('save')}Save project<kbd>Ctrl S</kbd></button><hr><button id="import-model">${icon('upload')}Import GLB / OBJ</button><button id="export-glb">${icon('download')}Export GLB</button><button id="export-obj">${icon('download')}Export OBJ</button><button id="capture">${icon('camera')}Save viewport image</button></div></div>
      <div class="dropdown"><button data-menu="edit-menu">Edit</button><div class="menu hidden" id="edit-menu"><button id="menu-undo">${icon('undo-2')}Undo<kbd>Ctrl Z</kbd></button><button id="menu-redo">${icon('redo-2')}Redo<kbd>Ctrl Shift Z</kbd></button><hr><button id="duplicate">${icon('copy')}Duplicate<kbd>Shift D</kbd></button><button id="delete">${icon('trash-2')}Delete<kbd>Del</kbd></button></div></div>
      <button id="help-menu">Help</button>
    </nav>
    <div class="project-name"><span class="project-dot"></span><input id="project-name" aria-label="Project name" value="Untitled scene" maxlength="100"><span class="file-type">.forge</span></div>
    <span id="save-status" class="save-status">Local workspace</span>
    <button class="export-button" id="export-top">${icon('download')} Export <span>GLB</span></button>
  </header>
  <div class="workspace-bar"><div class="workspace-tabs"><button class="workspace-tab active" data-workspace="layout">Layout</button><button class="workspace-tab" data-workspace="modeling">Modeling</button><button class="workspace-tab" data-workspace="material">Material</button><button class="workspace-tab" data-workspace="animation">Animation</button></div><span class="workspace-note"><span></span> All processing stays on your device</span>${button('toggle-sidebar', 'panel-right-close', 'Toggle properties panel')}</div>
  <main class="workspace">
    <section class="viewport-panel">
      <div class="viewport-toolbar"><div class="mode-select">${icon('box')}<select id="mode" aria-label="Interaction mode"><option value="object">Object Mode</option><option value="edit">Edit Mode</option></select></div><select id="component-mode" aria-label="Mesh component" class="hidden"><option value="vertex">Vertex</option><option value="edge">Edge</option><option value="face">Triangle face</option></select><span class="divider"></span><div class="dropdown"><button class="add-button" data-menu="add-menu">${icon('plus')} Add ${icon('chevron-down')}</button><div class="menu hidden primitive-menu" id="add-menu"><span class="menu-label">MESH PRIMITIVES</span>${(['cube','sphere','cylinder','cone','torus','plane','icosphere'] as Primitive[]).map(kind => `<button data-primitive="${kind}">${icon(kind === 'sphere' ? 'globe' : kind === 'plane' ? 'grid-2x2' : 'box')}${kind[0].toUpperCase() + kind.slice(1)}</button>`).join('')}</div></div><button id="frame-all" class="text-button">View all</button><div class="toolbar-spacer"></div><select id="space" aria-label="Transform orientation"><option value="world">Global</option><option value="local">Local</option></select>${button('snap','magnet','Toggle grid snap (Shift Tab)')}${button('grid','grid-2x2','Toggle grid','active')}<span class="divider"></span><div class="shading-group">${button('shading-wire','hexagon','Wireframe shading')}${button('shading-solid','circle','Solid shading')}${button('shading-material','sun','Material shading','active')}</div></div>
      <div id="viewport" class="viewport">
        <div class="view-label"><span id="view-label">User Perspective</span><small id="selection-label">Scene Collection / Cube</small></div>
        <div class="tool-rail" role="toolbar" aria-label="Transform tools">${button('tool-select','mouse-pointer-2','Select (Q)')}${button('tool-translate','move','Move (G)','active')}${button('tool-rotate','rotate-3d','Rotate (R)')}${button('tool-scale','scaling','Scale (S)')}<span></span>${button('focus','scan','Frame selected (F)')}${button('duplicate-rail','copy','Duplicate (Shift D)')}</div>
        <div class="axis-widget"><button id="axis-y" title="Top view (7)" class="axis y">Y</button><button id="axis-z" title="Front view (1)" class="axis z">Z</button><button id="axis-x" title="Right view (3)" class="axis x">X</button><span class="axis-line line-y"></span><span class="axis-line line-z"></span><span class="axis-line line-x"></span><button id="axis-home" class="axis-center" title="Perspective view"></button></div>
        <div class="view-actions">${button('projection','box','Toggle perspective / orthographic (5)')}${button('home-view','crosshair','Reset view')}${button('capture-quick','camera','Capture viewport')}</div>
        <div class="viewport-caption"><span class="caption-mark"></span><span id="mode-hint">Build something extraordinary.</span></div>
        <div class="viewport-badge">${icon('activity')}<span id="draw-status">ON DEMAND</span></div>
      </div>
      <section class="timeline" aria-label="Animation timeline"><div class="timeline-header"><span class="panel-title">${icon('diamond')} Timeline</span><span class="timeline-selection" id="timeline-object">Cube</span><div class="playback">${button('first-frame','chevron-first','First frame')}${button('previous-key','skip-back','Previous keyframe')}${button('play','play','Play / pause (Space)')}${button('next-key','skip-forward','Next keyframe')}${button('last-frame','chevron-last','Last frame')}</div><div class="frame-settings"><input id="current-frame" aria-label="Current frame" type="number" min="1" max="250" value="1"><span>/ 250</span><span class="fps">24 fps</span>${button('insert-key','diamond','Insert transform keyframe (I)')}${button('remove-key','x','Remove current keyframe')}</div></div><div class="timeline-track" id="timeline-track"><div class="timeline-ruler">${[1,25,50,75,100,125,150,175,200,225,250].map(n => `<span style="left:${(n-1)/249*100}%">${n}</span>`).join('')}</div><div id="keyframe-markers"></div><div class="playhead" id="playhead"><span>1</span></div><input type="range" id="scrubber" aria-label="Timeline frame" min="1" max="250" value="1"></div></section>
    </section>
    <aside class="sidebar">
      <section class="outliner"><div class="panel-heading"><span class="panel-title">${icon('layers')} Scene Collection</span><span class="count" id="object-count">1</span>${button('add-outliner','plus','Add mesh')}</div><div class="search-field">${icon('search')}<input id="object-search" placeholder="Search objects…" aria-label="Search objects"><kbd>/</kbd></div><div class="collection-row">${icon('chevron-down')}${icon('folder-open')}<span>Collection</span></div><div id="object-list" class="object-list"></div><div class="outliner-footer"><span id="selection-count">1 object selected</span>${button('delete-outliner','trash-2','Delete selected object')}</div></section>
      <section class="properties"><div class="properties-tabs"><button class="active" data-panel="object">${icon('sliders-horizontal')} Object</button><button data-panel="material">${icon('circle')} Material</button><button data-panel="scene">${icon('settings-2')} Scene</button></div><div class="properties-content">
        <div id="panel-object" class="property-panel"><div class="object-title">${icon('box')}<input id="object-name" aria-label="Object name" maxlength="100" value="Cube"><span class="object-type" id="object-type">MESH</span></div><div id="no-selection" class="empty-state hidden">Select an object to edit its properties.</div><div id="object-fields"><div class="section-heading"><span>${icon('chevron-down')} Transform</span><button id="reset-transform" title="Reset transform" aria-label="Reset transform">${icon('undo-2')}</button></div>${['position','rotation','scale'].map((group) => `<div class="transform-group"><label>${group === 'position' ? 'Location' : group[0].toUpperCase()+group.slice(1)}</label><div class="vector-inputs">${['x','y','z'].map(axis => `<label class="axis-input ${axis}"><span>${axis.toUpperCase()}</span><input type="number" step="${group === 'rotation' ? 1 : 0.1}" data-transform="${group}" data-axis="${axis}" aria-label="${group} ${axis}" value="0"></label>`).join('')}</div></div>`).join('')}<div class="property-note">${icon('globe')} World units · Rotation in degrees</div><div class="section-heading border-top"><span>${icon('chevron-down')} Geometry</span></div><div class="geometry-stats"><div><span>Vertices</span><strong id="mesh-vertices">24</strong></div><div><span>Triangles</span><strong id="mesh-triangles">12</strong></div></div><div class="action-row"><button id="smooth">Shade smooth</button><button id="flat">Shade flat</button></div><label class="property-row">Extrusion distance<input id="extrude-distance" aria-label="Extrusion distance" type="number" min="0.0001" max="1000" step="0.1" value="0.5"></label><button class="wide-button" id="extrude-face">Extrude selected triangle</button><p class="field-help">Select a triangle face in Edit Mode. Extrusion follows its normal in local units.</p><button class="wide-button" id="mirror">${icon('copy')} Mirror geometry on X</button><p class="field-help">Mirror is applied to the mesh. Use Edit Mode to move vertices, edges or triangle faces.</p><div class="section-heading border-top"><span>${icon('chevron-down')} Animation</span></div><button class="wide-button" id="key-property">${icon('diamond')} Insert transform keyframe <kbd>I</kbd></button><p class="field-help">Move to another frame, change the transform, then insert a second keyframe.</p></div></div>
        <div id="panel-material" class="property-panel hidden"><div class="section-heading"><span>${icon('circle')} Surface material</span></div><div id="material-fields"><div class="material-swatch" id="material-preview"><span></span><small>STANDARD SURFACE</small></div><label class="property-row">Base color<input type="color" id="material-color" value="#b8b6b2"></label><label class="range-property">Roughness<output id="roughness-value">0.42</output><input type="range" id="roughness" min="0" max="1" step="0.01" value="0.42"></label><label class="range-property">Metallic<output id="metalness-value">0.12</output><input type="range" id="metalness" min="0" max="1" step="0.01" value="0.12"></label><p class="field-help">Edits the first standard material of the selected mesh. Lighting is provided by the studio environment.</p></div><div id="no-material" class="empty-state hidden">Select a mesh with a standard material.</div></div>
        <div id="panel-scene" class="property-panel hidden"><div class="section-heading"><span>${icon('settings-2')} Viewport settings</span></div><label class="property-row">Quality<select id="quality"><option value="low">Performance</option><option value="balanced" selected>Balanced</option><option value="high">High quality</option></select></label><label class="property-row">Background<input type="color" id="background" value="#25282e"></label><label class="range-property">Exposure<output id="exposure-value">1.30</output><input id="exposure" type="range" min="0.2" max="3" step="0.05" value="1.3"></label><div class="performance-card">${icon('activity')}<strong>Performance by design</strong><p>The viewport redraws only when something changes. Pixel density is capped to keep interaction responsive.</p></div><p class="field-help">Viewport settings are session-only. Projects store objects, materials and transform keyframes.</p><button class="wide-button" id="restore-local">${icon('folder-open')} Recover last local scene</button></div>
      </div></section><div class="sidebar-bottom">FORGE <span>EARLY ACCESS · 0.1</span></div>
    </aside>
  </main>
  <footer class="statusbar"><span class="status-ready"><span></span> Ready</span><span id="scene-stats">1 object · 24 vertices · 12 triangles</span><div class="status-spacer"></div><span class="navigation-help"><kbd>MMB</kbd> Orbit <kbd>Shift MMB</kbd> Pan <kbd>Scroll</kbd> Zoom</span><span class="webgl-label">WebGL 2</span>${button('help','help-circle','Keyboard shortcuts')}</footer>
  <div class="toast hidden" id="toast" role="status"></div>
  <dialog id="help-dialog"><div class="dialog-heading"><span>Make yourself at home.</span>${button('close-help','x','Close shortcuts')}</div><p>A familiar workflow, right in your browser.</p><div class="shortcut-grid">${[['Select','Q'],['Move / Rotate / Scale','G / R / S'],['Frame selection','F'],['Duplicate','Shift D'],['Delete','Delete'],['Object / Edit mode','Tab'],['Insert keyframe','I'],['Play / Pause','Space'],['Front / Right / Top','1 / 3 / 7'],['Perspective / Orthographic','5'],['Undo / Redo','Ctrl Z / Ctrl Shift Z'],['Save / Open project','Ctrl S / Ctrl O'],['Orbit','Middle mouse / Alt drag'],['Pan','Right mouse / Shift MMB']].map(([label,key])=>`<span>${label}</span><kbd>${key}</kbd>`).join('')}</div><p class="dialog-note">This release supports object and vertex editing. Face modeling, sculpting, rigging, simulation and native .blend files are planned.</p></dialog>
  <dialog id="new-dialog"><div class="dialog-heading"><span>Create a new scene?</span></div><p>Download your project first if you want to keep a permanent copy. You can undo this action in the current session.</p><div class="dialog-actions"><button id="cancel-new">Cancel</button><button id="confirm-new" class="primary-button">New scene</button></div></dialog>
  <input type="file" id="project-input" accept=".forge,.json" hidden><input type="file" id="model-input" accept=".glb,.obj" hidden>
`;
$('.workspace-tabs').insertAdjacentHTML('beforeend', '<button class="workspace-tab" data-workspace="rigging">Rigging</button>');
$('.properties-tabs').insertAdjacentHTML('beforeend', `<button data-panel="rig">${icon('activity')} Rig</button>`);
$('.properties-content').insertAdjacentHTML('beforeend', `
  <div id="panel-rig" class="property-panel hidden">
    <div class="section-heading"><span>${icon('activity')} Kimodo Rig</span><span class="count">SOMA77</span></div>
    <p class="field-help">Official 77-joint hierarchy and native rest positions. Meters · Y up · +Z forward.</p>
    <button class="wide-button" id="create-rig">${icon('plus')} Create SOMA77 armature</button>
    <div class="rig-active-fields hidden" id="rig-active-fields">
      <label class="property-row">Armature<select id="rig-select" aria-label="Active armature"></select></label>
      <div class="section-heading border-top"><span>${icon('chevron-down')} Pose controls</span></div>
      <div class="action-row"><button id="rig-reset">Rest pose</button><button id="rig-key">Key full pose</button></div>
      <label class="property-row">Limb IK<select id="ik-limb" aria-label="IK limb"><option value="LeftHand">Left hand</option><option value="RightHand">Right hand</option><option value="LeftFoot">Left foot</option><option value="RightFoot">Right foot</option></select></label>
      <button class="wide-button" id="enable-ik">${icon('move')} Move IK target</button>
      <p class="field-help">Drag the target to solve the limb. Select a joint for FK rotation. IK is positional; pole controls and anatomical limits are planned.</p>
      <div class="section-heading border-top"><span>${icon('chevron-down')} Skin binding</span></div>
      <button class="wide-button" id="rig-preview">${icon('box')} Add skinned preview</button>
      <button class="wide-button" id="rig-bind">${icon('layers')} Bind selected mesh</button>
      <p class="field-help">Align a standalone mesh with the rest skeleton, select it, then bind. Four distance-based influences per vertex; up to 100k vertices. Weight painting is planned.</p>
      <div class="section-heading border-top"><span>${icon('chevron-down')} Joints <span class="count">77</span></span></div>
      <input id="bone-search" class="bone-search" placeholder="Filter joints…" aria-label="Filter joints">
      <div class="bone-list" id="bone-list"></div>
      <a class="rig-source" href="${RIG_SOURCE}" target="_blank" rel="noreferrer">NVIDIA Kimodo skeleton source ↗</a>
    </div>
  </div>`);
$('#add-menu').insertAdjacentHTML('beforeend', `<hr><button id="add-rig-menu">${icon('activity')}Kimodo SOMA77 rig</button>`);
$('.dialog-note').textContent = 'This release supports vertex, edge and triangle face editing, Kimodo SOMA77 FK/IK posing and basic skinning. Polygon modeling, sculpting, physics and native .blend files are planned.';
refreshIcons();

let editor: Editor;
try { editor = new Editor($('#viewport')); }
catch (error) {
  $('#viewport').innerHTML = '<div class="webgl-error"><h2>WebGL 2 is unavailable</h2><p>Enable hardware acceleration in your browser, then reload Forge.</p></div>';
  throw error;
}
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4200); }
function on(id: string, handler: () => void) { $(`#${id}`).addEventListener('click', handler); }
const rigSystem = new RigSystem(editor);
function rigAction(action: () => void) { try { action(); } catch (error) { toast((error as Error).message); } }
function refreshRig() {
  const active = rigSystem.activeRig;
  $('#rig-active-fields').classList.toggle('hidden', !active);
  const select = $<HTMLSelectElement>('#rig-select');
  select.replaceChildren(...rigSystem.rigs.map(rig => { const option = new Option(rig.name,rig.uuid); option.selected = rig === active; return option; }));
  const list = $('#bone-list'); list.replaceChildren();
  if (!active) return;
  const query = $<HTMLInputElement>('#bone-search').value.toLowerCase();
  for (const bone of rigBones(active)) {
    if (!bone.name.toLowerCase().includes(query)) continue;
    const button = document.createElement('button');
    button.className = `bone-button ${editor.selected === bone ? 'active' : ''}`;
    button.textContent = bone.name;
    button.title = `Select ${bone.name} for FK posing`;
    button.style.paddingLeft = `${Math.min(5, boneDepth(bone)) * 9 + 8}px`;
    button.onclick = () => { editor.select(bone); tool('rotate'); };
    list.append(button);
  }
}
function boneDepth(bone: THREE.Object3D): number { return bone.parent instanceof THREE.Bone ? 1 + boneDepth(bone.parent) : 0; }
for (const id of ['create-rig','add-rig-menu']) on(id, () => rigAction(() => { rigSystem.add(); panel('rig'); toast('Official Kimodo SOMA77 armature created.'); }));
on('rig-reset', () => rigAction(() => rigSystem.resetPose()));
on('rig-key', () => rigAction(() => { rigSystem.keyPose(); toast(`All 77 joints keyed at frame ${Math.round(editor.frame)}.`); }));
on('rig-preview', () => rigAction(() => { rigSystem.addPreview(); toast('Skinned preview added. Rotate a joint to deform it.'); }));
on('enable-ik', () => rigAction(() => { rigSystem.enableIK($<HTMLSelectElement>('#ik-limb').value); toast('Drag the move gizmo to pose the limb, then Key full pose.'); }));
on('rig-bind', () => {
  const button = $<HTMLButtonElement>('#rig-bind'); button.disabled = true; toast('Computing skin weights in a worker…');
  void rigSystem.bindSelected().then(() => toast('Mesh bound. Select a bone to test the deformation.')).catch(error => toast(error.message)).finally(() => button.disabled = false);
});
$<HTMLSelectElement>('#rig-select').onchange = e => { editor.select(editor.content.getObjectByProperty('uuid',(e.target as HTMLSelectElement).value) ?? null); refreshRig(); };
$<HTMLInputElement>('#bone-search').oninput = refreshRig;
editor.addEventListener('change', refreshRig);
function closeMenus() { document.querySelectorAll('.menu').forEach(menu => menu.classList.add('hidden')); }
document.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); const menu = $(`#${b.dataset.menu}`); const open = menu.classList.contains('hidden'); closeMenus(); menu.classList.toggle('hidden', !open); });
document.addEventListener('click', closeMenus);
document.querySelectorAll<HTMLButtonElement>('[data-primitive]').forEach(b => b.onclick = () => { editor.add(b.dataset.primitive as Primitive); toast(`${b.textContent?.trim()} added to scene`); });
let activeTool = 'translate';
function tool(mode: 'select' | 'translate' | 'rotate' | 'scale') {
  if (editor.editMode && mode !== 'select' && mode !== 'translate') { toast('Edit Mode currently supports Move.'); return; }
  activeTool = mode;
  editor.setTool(mode);
  document.querySelectorAll('.tool-rail button').forEach(b => b.classList.toggle('active', b.id === `tool-${mode}`));
}
for (const mode of ['select','translate','rotate','scale'] as const) on(`tool-${mode}`, () => tool(mode));
function panel(name: string) {
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.property-panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${name}`));
}
document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b => b.onclick = () => panel(b.dataset.panel!));
document.querySelectorAll<HTMLButtonElement>('[data-workspace]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-workspace]').forEach(t => t.classList.remove('active'));
  b.classList.add('active');
  const name = b.dataset.workspace;
  panel(name === 'material' ? 'material' : name === 'rigging' ? 'rig' : 'object');
  document.body.classList.toggle('animation-workspace', name === 'animation');
  if (name === 'modeling') { if (!editor.setEditMode(true)) toast('Select a mesh to enter Edit Mode.'); tool('translate'); }
  else editor.setEditMode(false);
});
function updateTransforms() {
  const object = editor.selected;
  if (!object) return;
  document.querySelectorAll<HTMLInputElement>('[data-transform]').forEach(input => {
    if (document.activeElement === input) return;
    const property = input.dataset.transform as 'position' | 'rotation' | 'scale';
    const axis = input.dataset.axis as 'x' | 'y' | 'z';
    input.value = (object[property][axis] * (property === 'rotation' ? 180 / Math.PI : 1)).toFixed(3);
  });
}
function updateUI() {
  const object = editor.selected;
  $('#project-name').setAttribute('title', editor.name);
  if (document.activeElement !== $('#project-name')) $<HTMLInputElement>('#project-name').value = editor.name;
  $('#selection-label').textContent = object ? `Scene Collection / ${object.name}` : 'Scene Collection';
  $('#timeline-object').textContent = object?.name ?? 'No selection';
  $('#selection-count').textContent = object ? '1 object selected' : 'No selection';
  $('#object-count').textContent = String(editor.content.children.length);
  $('#no-selection').classList.toggle('hidden', !!object);
  $('#object-fields').classList.toggle('hidden', !object);
  $<HTMLInputElement>('#object-name').value = object?.name ?? 'No selection';
  $<HTMLInputElement>('#object-name').disabled = !object;
  $('#object-type').textContent = object instanceof THREE.Bone ? 'BONE' : object instanceof THREE.SkinnedMesh ? 'SKIN' : object instanceof THREE.Mesh ? 'MESH' : object?.userData.forgeRig ? 'RIG' : object ? 'GROUP' : '';
  updateTransforms();
  let vertices = 0, triangles = 0;
  object?.traverse(o => { if (o instanceof THREE.Mesh) { vertices += o.geometry.getAttribute('position')?.count ?? 0; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3; } });
  $('#mesh-vertices').textContent = vertices.toLocaleString();
  $('#mesh-triangles').textContent = Math.round(triangles).toLocaleString();
  const material = editor.material;
  $('#material-fields').classList.toggle('hidden', !material);
  $('#no-material').classList.toggle('hidden', !!material);
  if (material) {
    $<HTMLInputElement>('#material-color').value = `#${material.color.getHexString()}`;
    $('#material-preview').style.setProperty('--material-color', `#${material.color.getHexString()}`);
    for (const key of ['roughness','metalness'] as const) { $<HTMLInputElement>(`#${key}`).value = String(material[key]); $(`#${key}-value`).textContent = material[key].toFixed(2); }
  }
  $<HTMLButtonElement>('#menu-undo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('#menu-redo').disabled = !editor.canRedo;
  renderOutliner();
  updateTimeline();
}
function renderOutliner() {
  const list = $('#object-list');
  list.replaceChildren();
  const filter = $<HTMLInputElement>('#object-search').value.toLowerCase();
  const entries: { object: THREE.Object3D; depth: number }[] = [];
  const collect = (object: THREE.Object3D, depth: number) => { if (object instanceof THREE.Bone) return; entries.push({object,depth}); object.children.forEach(child => { if (!(child instanceof THREE.Points)) collect(child,depth+1); }); };
  editor.content.children.forEach(object => collect(object,0));
  for (const {object,depth} of entries) {
    if (!object.name.toLowerCase().includes(filter)) continue;
    const row = document.createElement('div');
    row.className = `object-row ${object === editor.selected ? 'selected' : ''} ${object.visible ? '' : 'dimmed'}`;
    row.dataset.uuid = object.uuid;
    row.style.paddingLeft = `${37 + Math.min(depth,4)*12}px`;
    const select = document.createElement('button');
    select.className = 'object-select';
    select.innerHTML = icon(object instanceof THREE.Mesh ? 'box' : 'layers');
    const label = document.createElement('span');
    label.textContent = object.name;
    select.append(label);
    select.onclick = () => { editor.select(object); editor.setTool(activeTool as 'translate'); };
    const visibility = document.createElement('button');
    visibility.className = 'object-visibility';
    visibility.title = `${object.visible ? 'Hide' : 'Show'} ${object.name}`;
    visibility.setAttribute('aria-label', visibility.title);
    visibility.innerHTML = icon(object.visible ? 'eye' : 'eye-off');
    visibility.onclick = () => { object.visible = !object.visible; editor.select(editor.selected); editor.commit(); };
    row.append(select, visibility);
    list.append(row);
  }
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'empty-outliner'; empty.textContent = filter ? 'No matching objects' : 'An empty canvas. Add a mesh to begin.'; list.append(empty); }
  refreshIcons();
}
let timelineState = '';
let markerState = '';
let wasPlaying = false;
function updateTimeline() {
  const frame = Math.round(editor.frame);
  const keys: Keyframe[] = editor.selected?.userData.keyframes ?? [];
  const markers = keys.map(k => k.frame).join(',');
  const state = `${frame}|${editor.playing}|${markers}`;
  if (timelineState === state) return;
  timelineState = state;
  $<HTMLInputElement>('#current-frame').value = String(frame);
  $<HTMLInputElement>('#scrubber').value = String(frame);
  $('#playhead').style.left = `${(editor.frame-1)/249*100}%`;
  $('#playhead span').textContent = String(frame);
  if (wasPlaying !== editor.playing) { $('#play').innerHTML = icon(editor.playing ? 'pause' : 'play'); refreshIcons(); wasPlaying = editor.playing; }
  $('#draw-status').textContent = editor.playing ? 'PLAYING · 24 FPS' : 'ON DEMAND';
  if (markerState !== markers) { $('#keyframe-markers').innerHTML = keys.map(k => `<span class="key-marker" title="Keyframe ${k.frame}" style="left:${(k.frame-1)/249*100}%"></span>`).join(''); markerState = markers; }
}
editor.addEventListener('change', updateUI);
editor.addEventListener('transform', updateTransforms);
editor.addEventListener('history-limit', () => toast('Scene exceeds the 24 MiB undo budget. History disabled; save a project file.'));
editor.addEventListener('frame', updateTimeline);
editor.addEventListener('mode', () => { $('#component-mode').classList.toggle('hidden', !editor.editMode); $<HTMLSelectElement>('#mode').value = editor.editMode ? 'edit' : 'object'; $('#mode-hint').textContent = editor.editMode ? `Select a ${editor.componentMode === 'face' ? 'triangle face' : editor.componentMode}, then drag its move gizmo.` : 'Build something extraordinary.'; });
editor.addEventListener('view', () => { $('#view-label').textContent = editor.camera instanceof THREE.OrthographicCamera ? 'User Orthographic' : 'User Perspective'; });
let cachedStats = '';
editor.addEventListener('stats', () => {
  const stats = editor.stats();
  const text = `${stats.objects} object${stats.objects === 1 ? '' : 's'} · ${stats.vertices.toLocaleString()} vertices · ${stats.triangles.toLocaleString()} triangles`;
  if (text !== cachedStats) { $('#scene-stats').textContent = text; cachedStats = text; }
  $('#scene-stats').title = `${stats.calls} draw calls · ${stats.frames} total rendered frames`;
});
let recovery: string | null = null;
try { recovery = localStorage.getItem('forge-recovery'); } catch { /* File saving remains available if browser storage is disabled. */ }
let saveTimer: ReturnType<typeof setTimeout>;
editor.addEventListener('commit', () => {
  $('#save-status').textContent = 'Saving locally…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = editor.snapshot();
      if (data.length > 3 * 1024 * 1024) { $('#save-status').textContent = 'Large scene · save to file'; return; }
      localStorage.setItem('forge-recovery', data);
      $('#save-status').textContent = 'Saved locally';
    } catch { $('#save-status').textContent = 'Local save unavailable'; }
  }, 700);
});
editor.seed();
if (recovery) {
  try { editor.load(JSON.parse(recovery)); toast('Your local scene has been restored.'); }
  catch { toast('Local recovery could not be loaded. Starting a new scene.'); }
}
on('restore-local', () => {
  try { if (!recovery) throw new Error('No earlier recovery is available.'); editor.load(JSON.parse(recovery)); toast('Previous local scene recovered.'); }
  catch (error) { toast((error as Error).message); }
});
$<HTMLInputElement>('#object-search').oninput = renderOutliner;
$<HTMLInputElement>('#object-name').onchange = e => { if (editor.selected) { editor.selected.name = (e.target as HTMLInputElement).value.trim() || 'Object'; editor.commit(); } };
$<HTMLInputElement>('#project-name').onchange = e => { editor.name = (e.target as HTMLInputElement).value.trim() || 'Untitled scene'; editor.commit(); };
document.querySelectorAll<HTMLInputElement>('[data-transform]').forEach(input => input.onchange = () => {
  if (!editor.selected) return;
  const property = input.dataset.transform as 'position' | 'rotation' | 'scale';
  const axis = input.dataset.axis as 'x' | 'y' | 'z';
  let value = Number(input.value);
  if (!Number.isFinite(value) || Math.abs(value) > 10000 || (property === 'scale' && Math.abs(value) < 0.001)) { toast('Enter a finite value within ±10,000; scale cannot be zero.'); input.blur(); updateTransforms(); return; }
  if (property === 'rotation') value *= Math.PI / 180;
  editor.selected[property][axis] = value;
  editor.commit();
});
on('reset-transform', () => { if (editor.selected) { editor.selected.position.set(0,0,0); editor.selected.rotation.set(0,0,0); editor.selected.scale.set(1,1,1); editor.commit(); } });
on('extrude-face', () => { try { editor.extrudeFace(Number($<HTMLInputElement>('#extrude-distance').value)); toast('Triangle extruded. Move the selected cap or extrude again.'); } catch (error) { toast((error as Error).message); } });
$('#mirror').insertAdjacentHTML('beforebegin', '<label class="property-row">Inset distance<input id="inset-distance" aria-label="Inset distance" type="number" min="0.0001" max="1000" step="0.05" value="0.1"></label><button class="wide-button" id="inset-face">Inset selected triangle</button><p class="field-help">Moves each edge inward by the local distance. Must be smaller than the triangle inradius.</p>');
on('inset-face', () => { try { editor.extrudeFace(Number($<HTMLInputElement>('#inset-distance').value), true); toast('Triangle inset. The inner face remains selected.'); } catch (error) { toast((error as Error).message); } });
$<HTMLSelectElement>('#component-mode').onchange = e => editor.setComponentMode((e.target as HTMLSelectElement).value as 'vertex' | 'edge' | 'face');
$<HTMLSelectElement>('#mode').onchange = e => { if (!editor.setEditMode((e.target as HTMLSelectElement).value === 'edit')) { $<HTMLSelectElement>('#mode').value = 'object'; toast('Select a mesh and pause playback first.'); } tool('translate'); };
$<HTMLSelectElement>('#space').onchange = e => { editor.transform.setSpace((e.target as HTMLSelectElement).value as 'world' | 'local'); editor.invalidate(); };
function snap() { const enabled = !$('#snap').classList.contains('active'); $('#snap').classList.toggle('active', enabled); editor.transform.setTranslationSnap(enabled ? 0.5 : null); editor.transform.setRotationSnap(enabled ? Math.PI / 12 : null); editor.transform.setScaleSnap(enabled ? 0.1 : null); toast(enabled ? 'Snap: 0.5 units · 15° · 0.1 scale' : 'Snapping disabled'); }
on('snap', snap);
on('grid', () => { editor.grid.visible = !editor.grid.visible; $('#grid').classList.toggle('active', editor.grid.visible); editor.invalidate(); });
for (const value of ['wire','solid','material']) on(`shading-${value}`, () => { editor.setShading(value); document.querySelectorAll('.shading-group button').forEach(b => b.classList.toggle('active', b.id === `shading-${value}`)); });
on('focus', () => editor.focus()); on('frame-all', () => editor.focus(true));
for (const [id, axis] of [['axis-x','right'],['axis-y','top'],['axis-z','front'],['axis-home','perspective'],['home-view','perspective']] as const) on(id, () => { editor.view(axis); $('#view-label').textContent = `${axis[0].toUpperCase()+axis.slice(1)} ${editor.camera instanceof THREE.OrthographicCamera ? 'Orthographic' : 'Perspective'}`; });
on('projection', () => editor.toggleProjection());
for (const id of ['duplicate','duplicate-rail']) on(id, () => editor.duplicate());
for (const id of ['delete','delete-outliner']) on(id, () => editor.remove());
on('menu-undo', () => editor.undo()); on('menu-redo', () => editor.redo());
on('smooth', () => editor.smooth(false)); on('flat', () => editor.smooth(true));
on('mirror', () => toast(editor.mirror() ? 'Mirrored mesh geometry on the local X axis.' : 'Select a mesh to mirror.'));
on('add-outliner', () => { $('#add-menu').classList.toggle('hidden'); });
$('#add-outliner').addEventListener('click', e => e.stopPropagation());
on('toggle-sidebar', () => document.body.classList.toggle('sidebar-collapsed'));
$<HTMLInputElement>('#material-color').oninput = e => { if (editor.material) { editor.material.color.set((e.target as HTMLInputElement).value); $('#material-preview').style.setProperty('--material-color', (e.target as HTMLInputElement).value); editor.invalidate(); } };
$<HTMLInputElement>('#material-color').onchange = () => editor.commit();
for (const key of ['roughness','metalness'] as const) {
  $<HTMLInputElement>(`#${key}`).oninput = e => { if (editor.material) { editor.material[key] = Number((e.target as HTMLInputElement).value); $(`#${key}-value`).textContent = editor.material[key].toFixed(2); editor.invalidate(); } };
  $<HTMLInputElement>(`#${key}`).onchange = () => editor.commit();
}
$<HTMLSelectElement>('#quality').onchange = e => editor.setQuality((e.target as HTMLSelectElement).value);
$<HTMLInputElement>('#background').oninput = e => { (editor.scene.background as THREE.Color).set((e.target as HTMLInputElement).value); editor.invalidate(); };
$<HTMLInputElement>('#exposure').oninput = e => { editor.renderer.toneMappingExposure = Number((e.target as HTMLInputElement).value); $('#exposure-value').textContent = editor.renderer.toneMappingExposure.toFixed(2); editor.invalidate(); };
on('play', () => editor.togglePlayback());
on('first-frame', () => editor.scrub(1)); on('last-frame', () => editor.scrub(250));
for (const [id, direction] of [['previous-key',-1],['next-key',1]] as const) on(id, () => { const keys: Keyframe[] = editor.selected?.userData.keyframes ?? []; const next = direction === 1 ? keys.find(k => k.frame > editor.frame) : [...keys].reverse().find(k => k.frame < editor.frame); if (next) editor.scrub(next.frame); });
function insertKey() { toast(editor.insertKey() ? `Transform keyframe inserted at frame ${Math.round(editor.frame)}.` : 'Select an object in Object Mode first.'); }
on('insert-key', insertKey); on('key-property', insertKey); on('remove-key', () => editor.removeKey());
$<HTMLInputElement>('#scrubber').oninput = e => { if (editor.playing) editor.togglePlayback(); editor.scrub(Number((e.target as HTMLInputElement).value)); };
$<HTMLInputElement>('#current-frame').onchange = e => { const frame = Number((e.target as HTMLInputElement).value); if (Number.isFinite(frame)) editor.scrub(frame); };
for (const id of ['help','help-menu']) on(id, () => $<HTMLDialogElement>('#help-dialog').showModal());
on('close-help', () => $<HTMLDialogElement>('#help-dialog').close());
on('new-project', () => $<HTMLDialogElement>('#new-dialog').showModal());
on('cancel-new', () => $<HTMLDialogElement>('#new-dialog').close());
on('confirm-new', () => { editor.newProject(); $<HTMLDialogElement>('#new-dialog').close(); toast('New scene created.'); });

function download(data: BlobPart, name: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function save() { download(editor.snapshot(), `${editor.name}.forge`, 'application/json'); toast('Project downloaded.'); }
on('save-project', save);
on('open-project', () => $('#project-input').click());
on('import-model', () => $('#model-input').click());
$<HTMLInputElement>('#project-input').onchange = async e => {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try { if (file.size > 32 * 1024 * 1024) throw new Error('Project exceeds the 32 MB limit.'); editor.load(JSON.parse(await file.text()) as Project); editor.focus(true); toast('Project opened.'); }
  catch (error) { toast(`Open failed: ${(error as Error).message}`); } finally { input.value = ''; }
};
$<HTMLInputElement>('#model-input').onchange = async e => {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Model exceeds the 32 MB limit.');
    toast('Importing model…');
    let root: THREE.Group;
    if (file.name.toLowerCase().endsWith('.obj')) {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      root = new OBJLoader().parse(await file.text());
      root.traverse(o => { if (o instanceof THREE.Mesh) { const old = o.material; o.material = new THREE.MeshStandardMaterial({ color: 0xb8b6b2, roughness: 0.55, side: THREE.DoubleSide }); (Array.isArray(old) ? old : [old]).forEach(m => m.dispose()); } });
    } else {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('Use a self-contained GLB with embedded assets.'); return url; });
      root = (await new GLTFLoader(manager).parseAsync(await file.arrayBuffer(), '')).scene;
    }
    let count = editor.stats().vertices;
    root.traverse(o => { if (o instanceof THREE.Mesh) count += o.geometry.getAttribute('position')?.count ?? 0; });
    if (count > 2_000_000) { editor.disposeObject(root); throw new Error('Import would exceed the 2 million vertex scene limit.'); }
    root.name = editor.uniqueName(file.name.replace(/\.[^.]+$/, ''));
    editor.content.add(root); editor.select(root); editor.commit(); editor.focus();
    toast('Model imported. Imported animations and rigs are not editable in this release.');
  } catch (error) { toast(`Import failed: ${(error as Error).message}`); } finally { input.value = ''; }
};
async function exportGLB() {
  try {
    editor.setEditMode(false);
    toast('Preparing GLB…');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const clips: THREE.AnimationClip[] = [];
    editor.content.traverse(o => {
      const keys: Keyframe[] = o.userData.keyframes ?? [];
      if (!keys.length) return;
      const times = keys.map(k => (k.frame - 1) / 24);
      clips.push(new THREE.AnimationClip(`${o.name}Action`, -1, [new THREE.VectorKeyframeTrack(`${o.uuid}.position`, times, keys.flatMap(k => k.position)), new THREE.QuaternionKeyframeTrack(`${o.uuid}.quaternion`, times, keys.flatMap(k => k.quaternion)), new THREE.VectorKeyframeTrack(`${o.uuid}.scale`, times, keys.flatMap(k => k.scale))]));
    });
    const result = await new GLTFExporter().parseAsync(editor.content, { binary: true, animations: clips });
    download(result as ArrayBuffer, `${editor.name}.glb`, 'model/gltf-binary'); toast('GLB exported with transform animations.');
  } catch (error) { toast(`Export failed: ${(error as Error).message}`); }
}
on('export-glb', () => void exportGLB()); on('export-top', () => void exportGLB());
on('export-obj', () => { void (async () => { try { editor.setEditMode(false); const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js'); download(new OBJExporter().parse(editor.content), `${editor.name}.obj`, 'text/plain'); toast('OBJ geometry exported. Materials and animation use GLB.'); } catch (error) { toast(`Export failed: ${(error as Error).message}`); } })(); });
function capture() {
  editor.render();
  editor.renderer.domElement.toBlob(blob => { if (blob) { download(blob, `${editor.name}.png`, 'image/png'); toast('Viewport image downloaded.'); } else toast('Image capture failed.'); }, 'image/png');
}
on('capture', capture); on('capture-quick', capture);
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector('dialog[open]')) return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (['s','o','z','y','n'].includes(key)) e.preventDefault();
    if (key === 's') save(); else if (key === 'o') $('#project-input').click(); else if (key === 'z') e.shiftKey ? editor.redo() : editor.undo(); else if (key === 'y') editor.redo(); else if (key === 'n') $<HTMLDialogElement>('#new-dialog').showModal();
    return;
  }
  if (key === 'alt') editor.orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  if (key === 'q') tool('select'); if (key === 'g') tool('translate'); if (key === 'r') tool('rotate'); if (key === 's') tool('scale');
  if (key === 'f') editor.focus();
  if (key === 'd' && e.shiftKey) { e.preventDefault(); editor.duplicate(); }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); editor.remove(); }
  if (key === 'tab') { e.preventDefault(); if (e.shiftKey) snap(); else { editor.setEditMode(!editor.editMode); tool('translate'); } }
  if (key === 'i') insertKey();
  if (key === ' ') { e.preventDefault(); editor.togglePlayback(); }
  if (key === '1') $('#axis-z').click(); if (key === '3') $('#axis-x').click(); if (key === '7') $('#axis-y').click(); if (key === '5') editor.toggleProjection();
  if (key === '/') { e.preventDefault(); $('#object-search').focus(); }
  if (key === 'escape') { closeMenus(); if (editor.transform.dragging) editor.transform.reset(); else editor.select(null); }
});
document.addEventListener('keyup', e => { if (e.key === 'Alt') editor.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE; });
window.addEventListener('blur', () => { editor.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE; if (editor.playing) editor.togglePlayback(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && editor.playing) editor.togglePlayback(); });
if (import.meta.env.DEV) Object.assign(window, { __forge: editor, __rig: rigSystem });
