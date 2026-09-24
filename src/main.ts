import { allAnimationFrames, animationChannels, animationTracks, effectiveBezierHandle, effectiveSegmentInterpolation, sampleAnimationChannel, trackKeys } from './animation/animation';
import { AnimationGraphView, animationChannelLabel } from './animation/animation-graph';
import './style.css';
import * as THREE from 'three';
import { createIcons, Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Undo2, Redo2, Copy, Trash2, X, HelpCircle, Download, Upload, Camera, Check, Circle, Triangle, Hexagon, FolderOpen, FolderPlus, LogOut, Save, FilePlus2, Maximize, Globe, Settings2, Crosshair, Sun, Moon, Activity, PanelRightClose } from 'lucide';
import { mountModelingUI } from './modeling/modeling-ui';
import { Editor, type AnimationTrackMap, type Primitive, type Project, type KeyInterpolation, type KeyTangentMode, type ScalarAnimationChannel, type TransformOrientation } from './editor';
import { RigSystem, rigBones } from './rig/rig';
import { addSomaPreview, createSomaRig, RIG_SOURCE } from './rig/soma77';

const icons = { Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Undo2, Redo2, Copy, Trash2, X, HelpCircle, Download, Upload, Camera, Check, Circle, Triangle, Hexagon, FolderOpen, FolderPlus, LogOut, Save, FilePlus2, Maximize, Globe, Settings2, Crosshair, Sun, Moon, Activity, PanelRightClose };
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const button = (id: string, name: string, label: string, extra = '') => `<button id="${id}" class="icon-button ${extra}" title="${label}" aria-label="${label}">${icon(name)}</button>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.5 } });

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'forge-theme';
const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
let themeMode: ThemeMode = storedTheme === 'light' ? 'light' : 'dark';

function applyTheme(mode: ThemeMode, persist = true) {
  themeMode = mode;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, mode);

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = mode === 'light' ? '#f4f6f9' : '#17191d';

  const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (toggle) {
    const next = mode === 'dark' ? 'light' : 'dark';
    toggle.innerHTML = `${icon(next === 'light' ? 'sun' : 'moon')}<span>${next === 'light' ? 'Light' : 'Dark'}</span>`;
    toggle.title = `Switch to ${next} theme`;
    toggle.setAttribute('aria-label', `Switch to ${next} theme`);
    toggle.setAttribute('aria-pressed', String(mode === 'light'));
    refreshIcons();
  }
}

applyTheme(themeMode, false);

$('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Forge Studio"><span class="brand-mark">F</span> FORGE <span class="brand-divider"></span><span class="studio-label">3D STUDIO</span></a>
    <nav class="main-menu" aria-label="Application menu">
      <div class="dropdown"><button data-menu="file-menu">File</button><div class="menu hidden" id="file-menu"><button id="new-project">${icon('file-plus-2')}New scene<kbd>Ctrl N</kbd></button><button id="open-project">${icon('folder-open')}Open project<kbd>Ctrl O</kbd></button><button id="save-project">${icon('save')}Save project<kbd>Ctrl S</kbd></button><hr><button id="import-model">${icon('upload')}Import GLB / OBJ</button><button id="export-glb">${icon('download')}Export GLB</button><button id="export-obj">${icon('download')}Export OBJ</button><button id="capture">${icon('camera')}Save viewport image</button></div></div>
      <div class="dropdown"><button data-menu="edit-menu">Edit</button><div class="menu hidden" id="edit-menu"><button id="menu-undo">${icon('undo-2')}Undo<kbd>Ctrl Z</kbd></button><button id="menu-redo">${icon('redo-2')}Redo<kbd>Ctrl Shift Z</kbd></button><hr><button id="duplicate">${icon('copy')}Duplicate<kbd>Shift D</kbd></button><button id="duplicate-linked">${icon('copy')}Linked duplicate<kbd>Alt D</kbd></button><button id="delete">${icon('trash-2')}Delete<kbd>Del</kbd></button></div></div>
      <button id="help-menu">Help</button>
    </nav>
    <div class="project-name"><span class="project-dot"></span><input id="project-name" aria-label="Project name" value="Untitled scene" maxlength="100"><span class="file-type">.forge</span></div>
    <span id="save-status" class="save-status">Local workspace</span>
    <button id="theme-toggle" class="theme-toggle" type="button" title="Switch to light theme" aria-label="Switch to light theme" aria-pressed="false">${icon('sun')}<span>Light</span></button>
    <button class="export-button" id="export-top">${icon('download')} Export <span>GLB</span></button>
  </header>
  <div class="workspace-bar"><div class="workspace-tabs"><button class="workspace-tab active" data-workspace="layout">Layout</button><button class="workspace-tab" data-workspace="modeling">Modeling</button><button class="workspace-tab" data-workspace="material">Material</button><button class="workspace-tab" data-workspace="animation">Animation</button></div><span class="workspace-note"><span></span> All processing stays on your device</span>${button('toggle-sidebar', 'panel-right-close', 'Toggle properties panel')}</div>
  <main class="workspace">
    <section class="viewport-panel">
      <div class="viewport-toolbar"><div class="mode-select">${icon('box')}<select id="mode" aria-label="Interaction mode"><option value="object">Object Mode</option><option value="edit">Edit Mode</option><option value="weight">Weight Mode</option></select></div><select id="component-mode" aria-label="Mesh component" class="hidden"><option value="vertex">Vertex</option><option value="edge">Edge</option><option value="face">Triangle face</option></select><span class="divider"></span><div class="dropdown"><button class="add-button" data-menu="add-menu">${icon('plus')} Add ${icon('chevron-down')}</button><div class="menu hidden primitive-menu" id="add-menu"><span class="menu-label">MESH PRIMITIVES</span>${(['cube','sphere','cylinder','cone','torus','plane','icosphere'] as Primitive[]).map(kind => `<button data-primitive="${kind}">${icon(kind === 'sphere' ? 'globe' : kind === 'plane' ? 'grid-2x2' : 'box')}${kind[0].toUpperCase() + kind.slice(1)}</button>`).join('')}</div></div><button id="frame-all" class="text-button">View all</button><div class="toolbar-spacer"></div><select id="space" aria-label="Transform orientation"><option value="world">Global</option><option value="local">Local</option><option value="gimbal">Gimbal</option></select>${button('snap','magnet','Toggle grid snap (Shift Tab)')}${button('grid','grid-2x2','Toggle grid','active')}<span class="divider"></span><div class="shading-group">${button('shading-wire','hexagon','Wireframe shading')}${button('shading-solid','circle','Solid shading')}${button('shading-material','sun','Material shading','active')}</div></div>
      <div id="viewport" class="viewport">
        <div class="view-label"><span id="view-label">User Perspective</span><small id="selection-label">Scene Collection / Cube</small></div>
        <div class="tool-rail" role="toolbar" aria-label="Transform tools">${button('tool-select','mouse-pointer-2','Select (Q)')}${button('tool-translate','move','Move (G)','active')}${button('tool-rotate','rotate-3d','Rotate (R)')}${button('tool-scale','scaling','Scale (S)')}<span></span>${button('focus','scan','Frame selected (F)')}${button('duplicate-rail','copy','Duplicate (Shift D)')}</div>
        <div class="axis-widget"><button id="axis-y" title="Top view (7)" class="axis y">Y</button><button id="axis-z" title="Front view (1)" class="axis z">Z</button><button id="axis-x" title="Right view (3)" class="axis x">X</button><span class="axis-line line-y"></span><span class="axis-line line-z"></span><span class="axis-line line-x"></span><button id="axis-home" class="axis-center" title="Perspective view"></button></div>
        <div class="view-actions">${button('projection','box','Toggle perspective / orthographic (5)')}${button('home-view','crosshair','Reset view')}${button('capture-quick','camera','Capture viewport')}</div>
        <div class="viewport-caption"><span class="caption-mark"></span><span id="mode-hint">Build something extraordinary.</span></div>
        <div class="viewport-badge">${icon('activity')}<span id="draw-status">ON DEMAND</span></div>
      </div>
      <section class="timeline" aria-label="Animation timeline"><div class="timeline-header"><span class="panel-title">${icon('diamond')} Timeline</span><span class="timeline-selection" id="timeline-object">Cube</span><div class="playback">${button('first-frame','chevron-first','First frame')}${button('previous-key','skip-back','Previous keyframe')}${button('play','play','Play / pause (Space)')}${button('next-key','skip-forward','Next keyframe')}${button('last-frame','chevron-last','Last frame')}</div><div class="frame-settings"><label class="timeline-range-field">Start<input id="frame-start" aria-label="Animation start frame" type="number" min="1" max="100000" step="1" value="1"></label><label class="timeline-range-field">End<input id="frame-end" aria-label="Animation end frame" type="number" min="2" max="100000" step="1" value="250"></label><label class="timeline-current-field">Frame<input id="current-frame" aria-label="Current frame" type="number" min="1" max="250" value="1"></label><span class="fps">24 fps</span>${button('insert-key','diamond','Insert transform keyframe (I)')}${button('remove-key','x','Remove current keyframe')}</div></div><div class="animation-graph"><div class="animation-graph-header"><span id="animation-graph-title">Graph Editor</span><span id="animation-graph-detail">Insert channel keys to display a curve.</span>${button('insert-channel-key','diamond','Insert key on selected channel')}${button('remove-channel-key','x','Remove selected channel key')}<div class="graph-view-controls" role="toolbar" aria-label="Graph view controls">${button('graph-frame-all','maximize','Frame all Graph keys (Home)')}${button('graph-frame-selected','scan','Frame selected Graph keys (Numpad .)')}${button('graph-scene-range','grid-2x2','Frame Graph scene range 1–250')}${button('graph-center-current','crosshair','Center Graph on current frame (Numpad 0)')}</div><span class="graph-editor-badge" title="Box-select keys · Shift adds · Drag selected keys to move · Alt-drag to copy · Key Inspector edits one selected key precisely">KEY CURVES</span></div><div class="graph-key-toolbar" aria-label="Graph key inspector"><span class="graph-key-toolbar-label">Key Inspector</span><span id="graph-selection-count">0 selected</span><label>Frame<input id="graph-key-frame" aria-label="Selected Graph key frame" type="number" min="1" max="250" step="1"></label><label>Value<input id="graph-key-value" aria-label="Selected Graph key value" type="number" step="0.1"></label><span id="graph-key-value-unit" class="graph-key-unit"></span><button id="apply-graph-key-inspector" class="text-button graph-key-apply" type="button" aria-label="Apply Graph key Frame and Value">Apply</button><label class="graph-segment-control">Segment<select id="graph-key-interpolation" aria-label="Selected key interpolation"><option value="mixed" disabled>Mixed</option><option value="linear">Linear</option><option value="constant">Constant</option><option value="bezier">Bezier</option></select></label><label class="graph-tangent-control">Tangent<select id="graph-key-tangent" aria-label="Selected key tangent mode"><option value="mixed" disabled>Mixed</option><option value="free">Free</option><option value="aligned">Aligned</option><option value="auto">Auto</option></select></label><label class="graph-time-scale-control">Time<input id="graph-time-scale" aria-label="Selected key time scale" type="number" min="0.01" step="0.1" value="1"></label><button id="apply-graph-time-scale" class="text-button graph-time-scale-button" type="button">Scale</button></div><div class="graph-handle-toolbar" aria-label="Bezier handle inspector"><span class="graph-handle-toolbar-label">Bezier Handles</span><span id="graph-handle-mode">—</span><label>Side<select id="graph-handle-side" aria-label="Selected Bezier handle side"><option value="left">Left</option><option value="right">Right</option></select></label><label>Frame<input id="graph-handle-frame" aria-label="Selected Bezier handle frame" type="number" step="0.01"></label><label>Value<input id="graph-handle-value" aria-label="Selected Bezier handle value" type="number" step="0.1"></label><span id="graph-handle-value-unit" class="graph-key-unit"></span><button id="apply-graph-handle" class="text-button graph-handle-apply" type="button" aria-label="Apply Bezier handle Frame and Value">Apply</button><span id="graph-handle-hint" class="graph-handle-hint">Select one Bezier key</span></div><div class="animation-graph-body"><nav class="graph-channels" aria-label="Graph channels">${(['position','rotation','scale'] as const).map(property => `<div class="graph-channel-group"><span>${property === 'position' ? 'Location' : property[0].toUpperCase()+property.slice(1)}</span>${animationChannels.filter(channel => channel.startsWith(property + '.')).map(channel => `<button type="button" data-graph-channel="${channel}" aria-label="Graph channel ${animationChannelLabel(channel)}"><span>${channel.at(-1)!.toUpperCase()}</span><small>LIN</small></button>`).join('')}</div>`).join('')}</nav><svg id="animation-graph" aria-label="Animation graph editor" role="img" tabindex="0" viewBox="0 0 1000 180" preserveAspectRatio="none"></svg></div></div><div class="timeline-key-toolbar" aria-label="Timeline key editing controls"><span class="timeline-key-toolbar-label">Summary Keys</span><span id="timeline-selection-count">0 selected</span>${button('remove-timeline-selected','trash-2','Remove selected Timeline keys')}<label>Time Scale<input id="timeline-time-scale" aria-label="Selected Timeline key time scale" type="number" min="0.01" step="0.1" value="1"></label><button id="apply-timeline-time-scale" class="text-button" type="button" aria-label="Scale selected Timeline keys">Scale</button><div class="timeline-view-controls" role="toolbar" aria-label="Timeline view controls">${button('timeline-frame-scene','grid-2x2','Frame Timeline scene range (Home)')}${button('timeline-frame-selected','scan','Frame selected Timeline keys (Numpad .)')}${button('timeline-center-current','crosshair','Center Timeline on current frame (Numpad 0)')}</div><span class="timeline-preview-divider"></span><button id="preview-toggle" class="text-button timeline-preview-toggle" type="button" aria-label="Enable Preview Range" aria-pressed="false">Preview</button><label class="timeline-preview-field">P Start<input id="preview-start" aria-label="Preview start frame" type="number" step="1" value="1"></label><label class="timeline-preview-field">P End<input id="preview-end" aria-label="Preview end frame" type="number" step="1" value="250"></label><span id="timeline-preview-status" class="timeline-key-toolbar-hint">Scene playback</span></div><div class="timeline-track" id="timeline-track" tabindex="0" aria-label="Timeline view"><div id="timeline-preview-range" aria-hidden="true"></div><div class="timeline-ruler" id="timeline-ruler"></div><div id="timeline-selection-box" aria-hidden="true"></div><div id="keyframe-markers"></div><div class="playhead" id="playhead"><span>1</span></div><input type="range" id="scrubber" aria-label="Timeline frame" min="1" max="250" value="1"></div><div id="timeline-view-scrollbar" class="timeline-view-scrollbar" role="scrollbar" tabindex="0" aria-label="Timeline view scrollbar" aria-orientation="horizontal"><div id="timeline-view-thumb" class="timeline-view-thumb"><span class="timeline-view-handle start" data-timeline-view-handle="start" aria-hidden="true"></span><span class="timeline-view-grip" aria-hidden="true"></span><span class="timeline-view-handle end" data-timeline-view-handle="end" aria-hidden="true"></span></div></div></section>
    </section>
    <aside class="sidebar">
      <section class="outliner"><div class="panel-heading"><span class="panel-title">${icon('layers')} Scene Collection</span><span class="count" id="object-count">1</span>${button('add-outliner','plus','Add mesh')}</div><div class="search-field">${icon('search')}<input id="object-search" placeholder="Search objects…" aria-label="Search objects"><kbd>/</kbd></div><div class="collection-row">${icon('chevron-down')}${icon('folder-open')}<span>Scene Collection</span>${button('add-collection','plus','Create collection')}</div><div id="object-list" class="object-list"></div><div class="outliner-footer"><span id="selection-count">1 object selected</span>${button('delete-outliner','trash-2','Delete selected object')}<input id="collection-name" aria-label="New collection name" value="Collection" maxlength="100"><select id="collection-target" aria-label="Target collection"><option value="">Move selected to…</option></select>${button('move-to-collection','folder-open','Move selected to collection')}${button('unlink-collection','log-out','Unlink from collection')}${button('delete-collection','trash-2','Delete empty collection')}</div></section>
      <section class="properties"><div class="properties-tabs"><button class="active" data-panel="object">${icon('sliders-horizontal')} Object</button><button data-panel="material">${icon('circle')} Material</button><button data-panel="scene">${icon('settings-2')} Scene</button></div><div class="properties-content">
        <div id="panel-object" class="property-panel"><div class="object-title">${icon('box')}<input id="object-name" aria-label="Object name" maxlength="100" value="Cube"><span class="object-type" id="object-type">MESH</span></div><div id="no-selection" class="empty-state hidden">Select an object to edit its properties.</div><div id="object-fields"><div class="section-heading"><span>${icon('chevron-down')} Transform</span><button id="reset-transform" title="Reset transform" aria-label="Reset transform">${icon('undo-2')}</button></div>${['position','rotation','scale'].map((group) => `<div class="transform-group"><label>${group === 'position' ? 'Location' : group[0].toUpperCase()+group.slice(1)}</label><div class="vector-inputs">${['x','y','z'].map(axis => `<label class="axis-input ${axis}"><span>${axis.toUpperCase()}</span><input type="number" step="${group === 'rotation' ? 1 : 0.1}" data-transform="${group}" data-axis="${axis}" aria-label="${group} ${axis}" value="0"></label>`).join('')}</div></div>`).join('')}<div class="property-note">${icon('globe')} Local object transform · Rotation in degrees · Gimbal edits Euler channels directly</div><div class="section-heading border-top"><span>${icon('chevron-down')} Geometry</span></div><div class="geometry-stats"><div><span>Vertices</span><strong id="mesh-vertices">24</strong></div><div><span>Triangles</span><strong id="mesh-triangles">12</strong></div></div><div class="action-row"><button id="smooth">Shade smooth</button><button id="flat">Shade flat</button></div><label class="property-row">Extrusion distance<input id="extrude-distance" aria-label="Extrusion distance" type="number" min="0.0001" max="1000" step="0.1" value="0.5"></label><button class="wide-button" id="extrude-face">Extrude selected triangle</button><p class="field-help">Select a triangle face in Edit Mode. Extrusion follows its normal in local units.</p><button class="wide-button" id="mirror">${icon('copy')} Mirror geometry on X</button><p class="field-help">Mirror is applied to the mesh. Use Edit Mode to move vertices, edges or triangle faces.</p></div></div>
        <div id="panel-material" class="property-panel hidden"><div class="section-heading"><span>${icon('circle')} Surface material</span></div><div id="material-fields"><div class="material-swatch" id="material-preview"><span></span><small>STANDARD SURFACE</small></div><label class="property-row">Base color<input type="color" id="material-color" value="#b8b6b2"></label><label class="range-property">Roughness<output id="roughness-value">0.42</output><input type="range" id="roughness" min="0" max="1" step="0.01" value="0.42"></label><label class="range-property">Metallic<output id="metalness-value">0.12</output><input type="range" id="metalness" min="0" max="1" step="0.01" value="0.12"></label><p class="field-help">Edits the first standard material of the selected mesh. Lighting is provided by the studio environment.</p></div><div id="no-material" class="empty-state hidden">Select a mesh with a standard material.</div></div>
        <div id="panel-scene" class="property-panel hidden"><div class="section-heading"><span>${icon('settings-2')} Viewport settings</span></div><label class="property-row">Quality<select id="quality"><option value="low">Performance</option><option value="balanced" selected>Balanced</option><option value="high">High quality</option></select></label><label class="property-row">Background<input type="color" id="background" value="#25282e"></label><label class="range-property">Exposure<output id="exposure-value">1.30</output><input id="exposure" type="range" min="0.2" max="3" step="0.05" value="1.3"></label><div class="performance-card">${icon('activity')}<strong>Performance by design</strong><p>The viewport redraws only when something changes. Pixel density is capped to keep interaction responsive.</p></div><p class="field-help">Viewport settings are session-only. Projects store objects, materials and transform keyframes.</p><button class="wide-button" id="restore-local">${icon('folder-open')} Recover last local scene</button></div>
      </div></section><div class="sidebar-bottom">FORGE <span>EARLY ACCESS · 0.1</span></div>
    </aside>
  </main>
  <footer class="statusbar"><span class="status-ready"><span></span> Ready</span><span id="scene-stats">1 object · 24 vertices · 12 triangles</span><div class="status-spacer"></div><span class="navigation-help"><kbd>MMB</kbd> Orbit <kbd>Shift MMB</kbd> Pan <kbd>Scroll</kbd> Zoom</span><span class="webgl-label">WebGL 2</span>${button('help','help-circle','Keyboard shortcuts')}</footer>
  <div class="toast hidden" id="toast" role="status"></div>
  <dialog id="help-dialog"><div class="dialog-heading"><span>Make yourself at home.</span>${button('close-help','x','Close shortcuts')}</div><p>A familiar workflow, right in your browser.</p><div class="shortcut-grid">${[['Select','Q'],['Move / Rotate / Scale','G / R / S'],['Frame selection','F'],['Duplicate','Shift D'],['Linked duplicate','Alt D'],['Delete','Delete'],['Object / Edit mode','Tab'],['Insert keyframe','I'],['Play / Pause','Space'],['Front / Right / Top','1 / 3 / 7'],['Perspective / Orthographic','5'],['Undo / Redo','Ctrl Z / Ctrl Shift Z'],['Save / Open project','Ctrl S / Ctrl O'],['Orbit','Middle mouse / Alt drag'],['Pan','Right mouse / Shift MMB']].map(([label,key])=>`<span>${label}</span><kbd>${key}</kbd>`).join('')}</div><p class="dialog-note">This release supports object and vertex editing. Face modeling, sculpting, rigging, simulation and native .blend files are planned.</p></dialog>
  <dialog id="new-dialog"><div class="dialog-heading"><span>Create a new scene?</span></div><p>Download your project first if you want to keep a permanent copy. You can undo this action in the current session.</p><div class="dialog-actions"><button id="cancel-new">Cancel</button><button id="confirm-new" class="primary-button">New scene</button></div></dialog>
  <input type="file" id="project-input" accept=".forge,.json" hidden><input type="file" id="model-input" accept=".glb,.obj" hidden>
`;
$('.workspace-tabs').insertAdjacentHTML('beforeend', '<button class="workspace-tab" data-workspace="rigging">Rigging</button>');
$('.properties-tabs').insertAdjacentHTML('beforeend', `<button data-panel="rig">${icon('activity')} Rig</button>`);
$('.properties-content').insertAdjacentHTML('beforeend', `
  <div id="panel-rig" class="property-panel hidden">
    <div class="section-heading"><span>${icon('activity')} Armature</span><span class="count" id="rig-status">Native</span></div>
    <p class="field-help">Build a Forge-native bone hierarchy, then switch to Pose mode for FK, IK and animation.</p>
    <button class="wide-button" id="create-rig">${icon('plus')} Create armature</button>
    <button class="wide-button" id="create-soma-rig">${icon('activity')} Add SOMA77 preset</button>
    <div class="rig-active-fields hidden" id="rig-active-fields">
      <label class="property-row">Armature<select id="rig-select" aria-label="Active armature"></select></label>
      <label class="property-row">Mode<select id="rig-mode" aria-label="Armature mode"><option value="edit">Edit</option><option value="pose">Pose</option></select></label>
      <div id="rig-edit-controls">
        <div class="section-heading border-top"><span>${icon('chevron-down')} Edit skeleton</span></div>
        <div class="action-row"><button id="rig-add-root">Add bone</button><button id="rig-extrude">Extrude</button></div>
        <label class="property-row">Parent<select id="rig-parent" aria-label="Bone parent"></select></label>
        <button class="wide-button" id="rig-reparent">Reparent selected bone</button>
        <button class="wide-button" id="rig-delete-bone">Delete selected bone</button>
        <p class="field-help">Move or rotate bones to author the rest skeleton. Deleting a bone preserves its children by moving them to the deleted bone's parent. Hierarchy editing is locked after skin binding or bone keys are authored.</p>
      </div>
      <div id="rig-pose-controls">
        <div class="section-heading border-top"><span>${icon('chevron-down')} Pose controls</span></div>
        <div class="action-row"><button id="rig-reset">Rest pose</button><button id="rig-key">Key full pose</button></div>
        <label class="property-row">IK chain<input id="ik-chain" aria-label="IK chain length" type="number" min="1" max="64" step="1" value="2"></label>
        <button class="wide-button" id="enable-ik">${icon('move')} IK selected bone</button>
        <p class="field-help">Select an end bone, then move the IK target. IK is positional and bakes into ordinary FK transforms.</p>
      </div>
      <div class="section-heading border-top"><span>${icon('chevron-down')} Skin binding</span></div>
      <button class="wide-button hidden" id="rig-preview">${icon('box')} Add SOMA skinned preview</button>
      <button class="wide-button" id="rig-bind">${icon('layers')} Bind selected mesh</button>
      <p class="field-help">Finish the rest skeleton, switch to Pose mode, align a standalone mesh, then bind. Four distance-based influences per vertex; up to 100k vertices.</p>
      <button class="wide-button" id="rig-weight-edit">Edit selected skin weights</button>
      <div class="hidden" id="rig-weight-fields">
        <label class="property-row">Weight bone<select id="rig-weight-bone" aria-label="Weight bone"></select></label>
        <label class="property-row">Weight<input id="rig-weight-value" aria-label="Skin weight" type="number" min="0" max="1" step="0.05" value="1"></label>
        <div class="action-row"><button id="rig-weight-apply">Apply</button><button id="rig-weight-clear">Clear bone</button></div>
        <button class="wide-button" id="rig-weight-normalize">Normalize selected vertices</button>
        <p class="field-help" id="rig-weight-summary">Select vertices in the viewport.</p>
        <button class="wide-button" id="rig-weight-done">Done editing weights</button>
      </div>
      <div class="section-heading border-top"><span>${icon('chevron-down')} Bones <span class="count" id="rig-joint-count">0</span></span></div>
      <input id="bone-search" class="bone-search" placeholder="Filter bones…" aria-label="Filter bones">
      <div class="bone-list" id="bone-list"></div>
      <a class="rig-source hidden" id="rig-source" href="${RIG_SOURCE}" target="_blank" rel="noreferrer">NVIDIA Kimodo skeleton source ↗</a>
    </div>
  </div>`);
$('#add-menu').insertAdjacentHTML('beforeend', `<hr><button id="add-rig-menu">${icon('activity')}Armature</button><button id="add-soma-rig-menu">${icon('activity')}SOMA77 preset</button>`);
$('.dialog-note').textContent = 'This release supports vertex, edge and triangle face editing, modeling-core tools, scene collections, Forge-native armature editing, FK/IK posing and basic skinning. Polygon modeling, sculpting, physics and native .blend files are planned.';
$('#material-fields').insertAdjacentHTML('beforeend', `<details class="painting-section" open><summary>Texture paint</summary><canvas id="paint-view" width="256" height="256" aria-label="Texture paint canvas"></canvas><p class="field-help">Paints an embedded 256×256 texture in the mesh UV layout. Mesh geometry and UV coordinates stay unchanged.</p><button class="wide-button" id="paint-enable">Enable texture painting</button><button class="wide-button" id="texture-import">Import PNG / JPEG / WebP</button><button class="wide-button" id="texture-export">Export texture PNG</button><input id="texture-input" type="file" accept="image/png,image/jpeg,image/webp" hidden><label class="property-row">Brush color<input id="paint-color" aria-label="Brush color" type="color" value="#e08050"></label><label class="property-row">Brush size<input id="paint-size" aria-label="Brush size" type="number" min="1" max="128" step="1" value="16"></label><button class="wide-button" id="paint-clear">Clear texture</button></details>`);
refreshIcons();
applyTheme(themeMode, false);

$('#theme-toggle').addEventListener('click', () => {
  applyTheme(themeMode === 'dark' ? 'light' : 'dark');
});

let editor: Editor;
let graphChannel: ScalarAnimationChannel = 'position.x';
try { editor = new Editor($('#viewport')); }
catch (error) {
  $('#viewport').innerHTML = '<div class="webgl-error"><h2>WebGL 2 is unavailable</h2><p>Enable hardware acceleration in your browser, then reload Forge.</p></div>';
  throw error;
}
const animationGraph = new AnimationGraphView(
  document.querySelector<SVGSVGElement>('#animation-graph')!,
  $('#animation-graph-title'),
  $('#animation-graph-detail'),
  {
    select: (frame, channel) => {
      graphChannel = channel;
      editor.scrub(frame);
      updateTimeline();
    },
    begin: (frames, anchorFrame, channel, copy) => {
      if (editor.playing) { toast('Pause playback before editing graph keys.'); return false; }
      return editor.beginAnimationKeyDrag(frames, anchorFrame, channel, copy);
    },
    preview: (frame, channel, value) => editor.previewAnimationKeyDrag(frame, channel, value),
    end: cancel => {
      const changed = editor.endAnimationKeyDrag(cancel);
      if (cancel) toast('Graph key edit cancelled.');
      else if (changed) toast('Graph key selection updated.');
      updateTimeline();
    },
    beginHandle: (frame, channel, side) => {
      if (editor.playing) { toast('Pause playback before editing tangents.'); return false; }
      return editor.beginAnimationHandleDrag(frame, channel, side);
    },
    previewHandle: (frame, value) => editor.previewAnimationHandleDrag(frame, value),
    endHandle: cancel => {
      editor.endAnimationHandleDrag(cancel);
      toast(cancel ? 'Tangent edit cancelled.' : 'Bezier tangent updated.');
      updateTimeline();
    },
    selectionChanged: () => updateTimeline(),
  },
);
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4200); }
function on(id: string, handler: () => void) { $(`#${id}`).addEventListener('click', handler); }
const paintView = $<HTMLCanvasElement>('#paint-view');
let painting = false;
function drawTexturePaint() {
  const context = paintView.getContext('2d')!;
  context.clearRect(0, 0, paintView.width, paintView.height);
  const source = editor.texturePaintCanvas ?? editor.texturePaintImage;
  if (source) { try { context.drawImage(source, 0, 0, paintView.width, paintView.height); } catch { /* Keep the placeholder while an image is loading. */ } }
  else { context.fillStyle = '#202329'; context.fillRect(0, 0, paintView.width, paintView.height); context.fillStyle = '#6d7480'; context.font = '12px sans-serif'; context.textAlign = 'center'; context.fillText('Enable texture painting', paintView.width / 2, paintView.height / 2); }
}
function paintPoint(event: PointerEvent) {
  const rect = paintView.getBoundingClientRect();
  editor.paintTextureAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, $<HTMLInputElement>('#paint-color').value, Number($<HTMLInputElement>('#paint-size').value));
  drawTexturePaint();
}
paintView.addEventListener('pointerdown', event => { if (event.button !== 0 || !editor.texturePaintCanvas) return; painting = true; paintView.setPointerCapture(event.pointerId); paintPoint(event); });
paintView.addEventListener('pointermove', event => { if (painting) paintPoint(event); });
const finishPaint = (event: PointerEvent) => { if (!painting) return; painting = false; if (paintView.hasPointerCapture(event.pointerId)) paintView.releasePointerCapture(event.pointerId); editor.finishTexturePaint(); };
paintView.addEventListener('pointerup', finishPaint); paintView.addEventListener('pointercancel', finishPaint);
on('paint-enable', () => { try { editor.ensureTexturePaint(); drawTexturePaint(); toast('Embedded texture painting enabled.'); } catch (error) { toast((error as Error).message); } });
on('paint-clear', () => { try { editor.clearTexturePaint(); drawTexturePaint(); toast('Texture cleared to its base color.'); } catch (error) { toast((error as Error).message); } });
on('texture-import', () => $<HTMLInputElement>('#texture-input').click());
$<HTMLInputElement>('#texture-input').onchange = async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try { await editor.importTexture(file); drawTexturePaint(); toast('Texture imported into the embedded canvas.'); }
  catch (error) { toast((error as Error).message); }
  finally { input.value = ''; }
};
on('texture-export', () => {
  try {
    const canvas = editor.ensureTexturePaint();
    canvas.toBlob(blob => { if (blob) { download(blob, `${editor.name}-texture.png`, 'image/png'); toast('Texture PNG downloaded.'); } else toast('Texture export failed.'); }, 'image/png');
  } catch (error) { toast((error as Error).message); }
});
const rigSystem = new RigSystem(editor);
function rigAction(action: () => void) { try { action(); } catch (error) { toast((error as Error).message); refreshRig(); } }
function refreshRig() {
  const active = rigSystem.activeRig;
  $('#rig-active-fields').classList.toggle('hidden', !active);
  const select = $<HTMLSelectElement>('#rig-select');
  select.replaceChildren(...rigSystem.rigs.map(rig => { const option = new Option(rig.name, rig.uuid); option.selected = rig === active; return option; }));
  const list = $('#bone-list'); list.replaceChildren();
  if (!active) return;
  const bones = rigBones(active);
  const editing = rigSystem.mode === 'edit';
  const weighting = rigSystem.weightEditing;
  const preset = active.userData.forgeRig?.preset === 'soma77';
  $('#rig-status').textContent = preset ? 'SOMA77 preset' : 'Native';
  $('#rig-joint-count').textContent = String(bones.length);
  $<HTMLSelectElement>('#rig-mode').value = rigSystem.mode;
  $('#rig-edit-controls').classList.toggle('hidden', !editing || weighting);
  $('#rig-pose-controls').classList.toggle('hidden', editing || weighting);
  $('#rig-preview').classList.toggle('hidden', !preset || weighting);
  $('#rig-source').classList.toggle('hidden', !preset);
  $('#rig-weight-fields').classList.toggle('hidden', !weighting);
  $<HTMLButtonElement>('#rig-weight-edit').classList.toggle('hidden', weighting);
  $<HTMLButtonElement>('#rig-weight-edit').disabled = !(editor.selected instanceof THREE.SkinnedMesh);
  $<HTMLSelectElement>('#rig-mode').disabled = weighting;

  const weightBoneSelect = $<HTMLSelectElement>('#rig-weight-bone');
  if (weighting) {
    const weightBones = rigSystem.weightBones;
    weightBoneSelect.replaceChildren(...weightBones.map((bone, index) => new Option(bone.name, String(index))));
    const activeWeight = rigSystem.activeWeightBone;
    const activeIndex = activeWeight ? weightBones.indexOf(activeWeight) : 0;
    weightBoneSelect.value = String(Math.max(0, activeIndex));
    const summary = rigSystem.weightSelectionSummary();
    $('#rig-weight-summary').textContent = summary.vertices
      ? `${summary.vertices} selected vertex${summary.vertices === 1 ? '' : 'es'} · ${activeWeight?.name ?? 'Bone'} average ${summary.average.toFixed(3)} · ${summary.min.toFixed(3)}–${summary.max.toFixed(3)}`
      : 'Select vertices in the viewport; Shift-click toggles more.';
  } else {
    weightBoneSelect.replaceChildren();
    $('#rig-weight-summary').textContent = 'Select vertices in the viewport.';
  }

  const selectedBone = editor.selected instanceof THREE.Bone && bones.includes(editor.selected) ? editor.selected : null;
  $<HTMLButtonElement>('#rig-extrude').disabled = !editing || !selectedBone;
  $<HTMLButtonElement>('#rig-reparent').disabled = !editing || !selectedBone;
  $<HTMLButtonElement>('#rig-delete-bone').disabled = !editing || !selectedBone || bones.length <= 1;
  const parentSelect = $<HTMLSelectElement>('#rig-parent');
  const invalidParents = new Set<THREE.Object3D>();
  selectedBone?.traverse(object => { if (object instanceof THREE.Bone) invalidParents.add(object); });
  const parentOptions = [new Option('Armature root', '')];
  for (const bone of bones) if (!invalidParents.has(bone)) parentOptions.push(new Option(bone.name, bone.uuid));
  parentSelect.replaceChildren(...parentOptions);
  if (selectedBone?.parent instanceof THREE.Bone) parentSelect.value = selectedBone.parent.uuid;

  const query = $<HTMLInputElement>('#bone-search').value.toLowerCase();
  for (const bone of bones) {
    if (!bone.name.toLowerCase().includes(query)) continue;
    const button = document.createElement('button');
    button.className = `bone-button ${weighting ? rigSystem.activeWeightBone === bone ? 'active' : '' : editor.selected === bone ? 'active' : ''}`;
    button.textContent = bone.name;
    button.title = weighting ? `Edit ${bone.name} skin influence` : editing ? `Select ${bone.name} for rest-skeleton editing` : `Select ${bone.name} for FK posing`;
    button.style.paddingLeft = `${Math.min(5, boneDepth(bone)) * 9 + 8}px`;
    button.onclick = () => {
      if (weighting) rigSystem.setWeightBone(bone);
      else { editor.select(bone); tool(editing ? 'translate' : 'rotate'); }
    };
    list.append(button);
  }
}
function boneDepth(bone: THREE.Object3D): number { return bone.parent instanceof THREE.Bone ? 1 + boneDepth(bone.parent) : 0; }
const createNativeRig = () => rigAction(() => {
  rigSystem.add();
  rigSystem.setMode('edit');
  panel('rig');
  tool('translate');
  toast('Forge armature created in Edit mode.');
});
for (const id of ['create-rig', 'add-rig-menu']) on(id, createNativeRig);
const createSomaPreset = () => rigAction(() => {
  rigSystem.add(createSomaRig());
  panel('rig');
  toast('SOMA77 preset armature created.');
});
for (const id of ['create-soma-rig', 'add-soma-rig-menu']) on(id, createSomaPreset);
$<HTMLSelectElement>('#rig-mode').onchange = event => rigAction(() => {
  rigSystem.setMode((event.target as HTMLSelectElement).value as 'edit' | 'pose');
  tool(rigSystem.mode === 'edit' ? 'translate' : 'rotate');
});
on('rig-add-root', () => rigAction(() => { rigSystem.addRootBone(); tool('translate'); toast('Root bone added.'); }));
on('rig-extrude', () => rigAction(() => { rigSystem.extrudeSelectedBone(); tool('translate'); toast('Bone extruded.'); }));
on('rig-reparent', () => rigAction(() => {
  const active = rigSystem.activeRig;
  if (!active) throw new Error('Create or select an armature first.');
  const value = $<HTMLSelectElement>('#rig-parent').value;
  const parent = value ? rigBones(active).find(bone => bone.uuid === value) ?? null : null;
  if (value && !parent) throw new Error('Choose a valid parent bone.');
  rigSystem.reparentSelectedBone(parent);
  toast(parent ? `Bone parented to ${parent.name}.` : 'Bone moved to the armature root.');
}));
on('rig-delete-bone', () => rigAction(() => {
  rigSystem.deleteSelectedBone();
  toast('Bone deleted; child bones kept in place.');
}));
on('rig-reset', () => rigAction(() => rigSystem.resetPose()));
on('rig-key', () => rigAction(() => {
  const count = rigSystem.activeRig ? rigBones(rigSystem.activeRig).length : 0;
  rigSystem.keyPose();
  toast(`${count} bone${count === 1 ? '' : 's'} keyed at frame ${Math.round(editor.frame)}.`);
}));
on('rig-preview', () => rigAction(() => {
  const rig = rigSystem.activeRig;
  if (!rig || rig.userData.forgeRig?.preset !== 'soma77') throw new Error('The procedural preview is only available for the SOMA77 preset.');
  addSomaPreview(rig);
  editor.commit();
  toast('SOMA skinned preview added.');
}));
on('enable-ik', () => rigAction(() => {
  const rig = rigSystem.activeRig;
  const end = editor.selected instanceof THREE.Bone && rig && rigBones(rig).includes(editor.selected) ? editor.selected : null;
  if (!end) throw new Error('Select an end bone first.');
  rigSystem.enableIK(end, Number($<HTMLInputElement>('#ik-chain').value));
  toast('Drag the move gizmo to pose the IK chain, then key the pose.');
}));
on('rig-bind', () => {
  const button = $<HTMLButtonElement>('#rig-bind'); button.disabled = true; toast('Computing skin weights in a worker…');
  void rigSystem.bindSelected().then(() => toast('Mesh bound. Select a bone to test the deformation.')).catch(error => toast(error.message)).finally(() => button.disabled = false);
});
on('rig-weight-edit', () => rigAction(() => {
  rigSystem.beginWeightEdit();
  tool('select');
  toast('Weight Mode: click skin vertices, Shift-click to select more.');
}));
on('rig-weight-done', () => rigAction(() => {
  rigSystem.endWeightEdit();
  tool('select');
  toast('Weight editing finished.');
}));
$<HTMLSelectElement>('#rig-weight-bone').onchange = event => rigAction(() => rigSystem.setWeightBone(Number((event.target as HTMLSelectElement).value)));
on('rig-weight-apply', () => rigAction(() => {
  const summary = rigSystem.assignSelectedWeight(Number($<HTMLInputElement>('#rig-weight-value').value));
  toast(`Weights updated on ${summary.vertices} selected vertex${summary.vertices === 1 ? '' : 'es'}.`);
}));
on('rig-weight-clear', () => rigAction(() => {
  const summary = rigSystem.assignSelectedWeight(0);
  toast(`Bone influence cleared on ${summary.vertices} selected vertex${summary.vertices === 1 ? '' : 'es'}.`);
}));
on('rig-weight-normalize', () => rigAction(() => {
  const summary = rigSystem.normalizeSelectedWeights();
  toast(`${summary.vertices} selected vertex${summary.vertices === 1 ? '' : 'es'} normalized.`);
}));
$<HTMLSelectElement>('#rig-select').onchange = event => {
  if (rigSystem.mode === 'edit') rigSystem.setMode('pose');
  editor.select(editor.content.getObjectByProperty('uuid', (event.target as HTMLSelectElement).value) ?? null);
  refreshRig();
};
$<HTMLInputElement>('#bone-search').oninput = refreshRig;
editor.addEventListener('change', refreshRig);
editor.addEventListener('mode', refreshRig);
editor.addEventListener('component-selection', refreshRig);
editor.addEventListener('weight', refreshRig);
function closeMenus() { document.querySelectorAll('.menu').forEach(menu => menu.classList.add('hidden')); }
document.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); const menu = $(`#${b.dataset.menu}`); const open = menu.classList.contains('hidden'); closeMenus(); menu.classList.toggle('hidden', !open); });
document.addEventListener('click', closeMenus);
document.querySelectorAll<HTMLButtonElement>('[data-primitive]').forEach(b => b.onclick = () => { editor.add(b.dataset.primitive as Primitive); toast(`${b.textContent?.trim()} added to scene`); });
let activeTool = 'translate';
function tool(mode: 'select' | 'translate' | 'rotate' | 'scale') {
  if (editor.weightMode && mode !== 'select') { toast('Weight Mode uses vertex selection only.'); return; }
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
  if (name === 'modeling') {
    if (editor.weightMode) rigSystem.endWeightEdit();
    void editor.enterEditMode(true).then(ok => { if (!ok) toast('Select a mesh and apply its modifiers to enter Edit Mode.'); tool('translate'); }).catch(error => toast(error.message));
  } else if (editor.weightMode && name !== 'rigging') rigSystem.endWeightEdit();
  else if (!editor.weightMode) editor.setEditMode(false);
});
type TransformKeyState = 'none' | 'keyed-current' | 'animated' | 'changed';
function updateTransforms() {
  const object = editor.selected;
  if (!object) return;
  const tracks = object.userData.animationTracks as AnimationTrackMap | undefined;
  const currentFrame = Math.round(editor.frame);

  document.querySelectorAll<HTMLInputElement>('[data-transform]').forEach(input => {
    const property = input.dataset.transform as 'position' | 'rotation' | 'scale';
    const axis = input.dataset.axis as 'x' | 'y' | 'z';
    const channel = `${property}.${axis}` as ScalarAnimationChannel;
    const value = object[property][axis];
    const keys = trackKeys(tracks, channel);

    let state: TransformKeyState = 'none';
    if (keys.length) {
      const expected = sampleAnimationChannel(tracks, editor.frame, channel, value);
      const changed = Math.abs(value - expected) > 1e-6;
      const hasCurrentKey = keys.some(key => key.frame === currentFrame);
      state = changed ? 'changed' : hasCurrentKey ? 'keyed-current' : 'animated';
    }

    const field = input.closest<HTMLElement>('.axis-input');
    if (field) {
      field.dataset.keyState = state;
      field.classList.toggle('key-state-current', state === 'keyed-current');
      field.classList.toggle('key-state-animated', state === 'animated');
      field.classList.toggle('key-state-changed', state === 'changed');
      field.title = state === 'keyed-current'
        ? 'Keyframed on the current frame'
        : state === 'animated'
          ? 'Animated; keyframe is on another frame'
          : state === 'changed'
            ? 'Changed from the animated value; insert a key to store it'
            : '';
    }

    input.dataset.keyState = state;
    if (document.activeElement !== input) {
      input.value = (value * (property === 'rotation' ? 180 / Math.PI : 1)).toFixed(3);
    }
  });
}
function updateUI() {
  const object = editor.selected;
  $('#project-name').setAttribute('title', editor.name);
  if (document.activeElement !== $('#project-name')) $<HTMLInputElement>('#project-name').value = editor.name;
  $('#selection-label').textContent = object ? `Scene Collection / ${object.name}` : 'Scene Collection';
  $('#timeline-object').textContent = object?.name ?? 'No selection';
  $('#selection-count').textContent = editor.selectedObjects.size ? `${editor.selectedObjects.size} object${editor.selectedObjects.size === 1 ? '' : 's'} selected` : 'No selection';
  $('#object-count').textContent = String(editor.stats().objects);
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
  drawTexturePaint();
}
let activeCollection: THREE.Group | null = null;
function renderOutliner() {
  const list = $('#object-list');
  list.replaceChildren();
  const filter = $<HTMLInputElement>('#object-search').value.toLowerCase();
  const entries: { object: THREE.Object3D; depth: number }[] = [];
  const collect = (object: THREE.Object3D, depth: number) => { if (object instanceof THREE.Bone || object instanceof THREE.Points) return; entries.push({object,depth}); object.children.forEach(child => collect(child,depth+1)); };
  editor.content.children.forEach(object => {
    if (object instanceof THREE.Group && object.userData.forgeCollection === true) {
      entries.push({ object, depth: 0 });
      object.children.forEach(child => collect(child, 1));
    } else collect(object, 0);
  });
  if (!activeCollection || !editor.collections.includes(activeCollection)) activeCollection = editor.collections[0] ?? null;
  const target = $<HTMLSelectElement>('#collection-target');
  target.replaceChildren(new Option('Move selected to…', ''), ...editor.collections.map(collection => new Option(collection.name, collection.uuid)));
  if (activeCollection) target.value = activeCollection.uuid;
  for (const {object,depth} of entries) {
    if (!object.name.toLowerCase().includes(filter)) continue;
    if (object instanceof THREE.Group && object.userData.forgeCollection === true) {
      const row = document.createElement('div');
      row.className = `collection-entry ${activeCollection === object ? 'active' : ''}`;
      row.dataset.uuid = object.uuid;
      row.style.paddingLeft = `${25 + Math.min(depth,4)*12}px`;
      const select = document.createElement('button');
      select.className = 'object-select';
      select.innerHTML = icon('folder-open');
      const label = document.createElement('span'); label.textContent = object.name; select.append(label);
      select.title = 'Choose collection as move target';
      select.onclick = () => { activeCollection = object; renderOutliner(); };
      row.append(select);
      list.append(row);
      continue;
    }
    const row = document.createElement('div');
    row.className = `object-row ${editor.selectedObjects.has(object) ? 'selected' : ''} ${object.visible ? '' : 'dimmed'}`;
    row.dataset.uuid = object.uuid;
    row.style.paddingLeft = `${37 + Math.min(depth,4)*12}px`;
    const select = document.createElement('button');
    select.className = 'object-select';
    select.innerHTML = icon(object instanceof THREE.Mesh ? 'box' : 'layers');
    const label = document.createElement('span');
    label.textContent = object.name;
    select.append(label);
    select.onclick = event => { editor.select(object, event.shiftKey); editor.setTool(activeTool as 'translate'); };
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
let timelineRangeState = '';
let timelineSelectedFrames = new Set<number>();
let timelineSelectionObject = '';
let timelineViewStart = 1;
let timelineViewEnd = 250;
let timelineViewManual = false;
let timelineViewSceneState = '';
let wasPlaying = false;

function normalizeTimelineView(start: number, end: number) {
  const sceneStart = editor.frameStart;
  const sceneEnd = editor.frameEnd;
  const sceneSpan = sceneEnd - sceneStart;
  const minimumSpan = Math.min(2, sceneSpan);
  let span = THREE.MathUtils.clamp(Math.abs(end - start), minimumSpan, sceneSpan);
  let center = (start + end) / 2;
  let viewStart = center - span / 2;
  let viewEnd = center + span / 2;
  if (viewStart < sceneStart) {
    viewEnd += sceneStart - viewStart;
    viewStart = sceneStart;
  }
  if (viewEnd > sceneEnd) {
    viewStart -= viewEnd - sceneEnd;
    viewEnd = sceneEnd;
  }
  viewStart = Math.max(sceneStart, viewStart);
  viewEnd = Math.min(sceneEnd, viewEnd);
  span = viewEnd - viewStart;
  if (span < minimumSpan) {
    center = THREE.MathUtils.clamp(center, sceneStart + minimumSpan / 2, sceneEnd - minimumSpan / 2);
    viewStart = center - minimumSpan / 2;
    viewEnd = center + minimumSpan / 2;
  }
  return { start: viewStart, end: viewEnd };
}

function syncTimelineViewToScene() {
  const sceneState = `${editor.frameStart}:${editor.frameEnd}`;
  if (sceneState === timelineViewSceneState) return false;
  timelineViewSceneState = sceneState;
  const next = timelineViewManual
    ? normalizeTimelineView(timelineViewStart, timelineViewEnd)
    : { start: editor.frameStart, end: editor.frameEnd };
  timelineViewStart = next.start;
  timelineViewEnd = next.end;
  return true;
}

function setTimelineView(start: number, end: number, manual = true) {
  const next = normalizeTimelineView(start, end);
  const changed =
    Math.abs(next.start - timelineViewStart) > 1e-9 ||
    Math.abs(next.end - timelineViewEnd) > 1e-9 ||
    timelineViewManual !== manual;
  timelineViewStart = next.start;
  timelineViewEnd = next.end;
  timelineViewManual = manual;
  if (!changed) return false;
  timelineState = '';
  markerState = '';
  timelineRangeState = '';
  updateTimeline();
  return true;
}

function frameTimelineSceneRange() {
  return setTimelineView(editor.frameStart, editor.frameEnd, false);
}

function frameSelectedTimelineKeys() {
  const frames = [...timelineSelectedFrames].sort((a, b) => a - b);
  if (!frames.length) return false;
  let start = frames[0];
  let end = frames[frames.length - 1];
  if (frames.length === 1) {
    start -= 10;
    end += 10;
  } else {
    const pad = Math.max(2, (end - start) * 0.12);
    start -= pad;
    end += pad;
  }
  return setTimelineView(start, end, true);
}

function centerTimelineOnCurrentFrame() {
  const span = timelineViewEnd - timelineViewStart;
  return setTimelineView(editor.frame - span / 2, editor.frame + span / 2, true);
}

function updateTimeline() {
  syncTimelineViewToScene();
  const frame = Math.round(editor.frame);
  const selectionObject = editor.selected?.uuid ?? '';
  if (timelineSelectionObject !== selectionObject) {
    timelineSelectedFrames.clear();
    timelineSelectionObject = selectionObject;
  }
  const tracks = editor.selected?.userData.animationTracks as AnimationTrackMap | undefined;
  const sceneMarkerFrames = allAnimationFrames(tracks)
    .filter(keyFrame => keyFrame >= editor.frameStart && keyFrame <= editor.frameEnd);
  const sceneMarkerFrameSet = new Set(sceneMarkerFrames);
  timelineSelectedFrames = new Set([...timelineSelectedFrames].filter(selectedFrame => sceneMarkerFrameSet.has(selectedFrame)));
  const markerFrames = sceneMarkerFrames
    .filter(keyFrame => keyFrame >= timelineViewStart && keyFrame <= timelineViewEnd);
  const markers = markerFrames.join(',');
  const selectedMarkers = [...timelineSelectedFrames].sort((a, b) => a - b).join(',');
  const activeKeys = trackKeys(tracks, graphChannel);
  animationGraph.update(editor.selected, graphChannel, editor.frame, editor.frameStart, editor.frameEnd);

  const shortMode = (mode: string) => mode === 'constant' ? 'CST' : mode === 'bezier' ? 'BEZ' : mode === 'mixed' ? 'MIX' : 'LIN';
  document.querySelectorAll<HTMLButtonElement>('[data-graph-channel]').forEach(button => {
    const channel = button.dataset.graphChannel as ScalarAnimationChannel;
    const keys = trackKeys(tracks, channel);
    const modes = keys.slice(0, -1).map(key => effectiveSegmentInterpolation(key));
    const unique = [...new Set(modes)];
    const effective = unique.length > 1 ? 'mixed' : unique[0] ?? 'linear';
    button.classList.toggle('active', channel === graphChannel);
    button.classList.toggle('keyed', keys.length > 0);
    button.disabled = !editor.selected;
    button.querySelector('small')!.textContent = keys.length ? shortMode(effective) : '—';
    button.title = keys.length
      ? `${animationChannelLabel(channel)} · ${keys.length} key${keys.length === 1 ? '' : 's'} · ${effective}`
      : `${animationChannelLabel(channel)} · no keys`;
  });

  const graphSceneRange = $<HTMLButtonElement>('#graph-scene-range');
  graphSceneRange.title = `Frame Graph scene range ${editor.frameStart}–${editor.frameEnd}`;
  graphSceneRange.setAttribute('aria-label', graphSceneRange.title);
  const selectedGraphFrames = animationGraph.selectedKeyFrames;
  $<HTMLButtonElement>('#graph-frame-all').disabled = !activeKeys.length;
  $<HTMLButtonElement>('#graph-frame-selected').disabled = !selectedGraphFrames.length;
  $<HTMLButtonElement>('#graph-scene-range').disabled = !activeKeys.length;
  $<HTMLButtonElement>('#graph-center-current').disabled = !activeKeys.length;
  const singleGraphKey = selectedGraphFrames.length === 1
    ? activeKeys.find(key => key.frame === selectedGraphFrames[0]) ?? null
    : null;
  $('#graph-selection-count').textContent = selectedGraphFrames.length ? `${selectedGraphFrames.length} selected` : '0 selected';
  const graphKeyFrame = $<HTMLInputElement>('#graph-key-frame');
  const graphKeyValue = $<HTMLInputElement>('#graph-key-value');
  const graphKeyApply = $<HTMLButtonElement>('#apply-graph-key-inspector');
  const canInspectGraphKey = singleGraphKey !== null && !editor.editMode && !editor.playing;
  graphKeyFrame.min = '1';
  graphKeyFrame.max = '100000';
  graphKeyFrame.disabled = !canInspectGraphKey;
  graphKeyValue.disabled = !canInspectGraphKey;
  graphKeyApply.disabled = !canInspectGraphKey;
  graphKeyValue.step = graphChannel.startsWith('rotation.') ? '1' : '0.1';
  $('#graph-key-value-unit').textContent = graphChannel.startsWith('rotation.') ? '°' : '';
  if (document.activeElement !== graphKeyFrame) graphKeyFrame.value = singleGraphKey ? String(singleGraphKey.frame) : '';
  if (document.activeElement !== graphKeyValue) {
    graphKeyValue.value = singleGraphKey
      ? String(Number((singleGraphKey.value * (graphChannel.startsWith('rotation.') ? 180 / Math.PI : 1)).toFixed(6)))
      : '';
  }
  graphKeyApply.title = singleGraphKey
    ? `Apply precise Frame / Value edit to ${animationChannelLabel(graphChannel)} at frame ${singleGraphKey.frame}`
    : 'Select exactly one Graph key to edit Frame / Value';

  const keyInterpolation = $<HTMLSelectElement>('#graph-key-interpolation');
  const selectedGraphIndices = selectedGraphFrames
    .map(selectedFrame => activeKeys.findIndex(key => key.frame === selectedFrame))
    .filter(index => index >= 0);
  const selectedSegmentIndices = selectedGraphIndices.filter(index => index < activeKeys.length - 1);
  const selectedSegmentModes = [...new Set(selectedSegmentIndices.map(index => effectiveSegmentInterpolation(activeKeys[index])))];
  keyInterpolation.value = selectedSegmentModes.length > 1 ? 'mixed' : selectedSegmentModes[0] ?? 'linear';
  keyInterpolation.disabled = !selectedSegmentIndices.length || editor.editMode || editor.playing;
  keyInterpolation.title = selectedGraphFrames.length > 1
    ? `Apply interpolation to ${selectedSegmentIndices.length} selected outbound segment${selectedSegmentIndices.length === 1 ? '' : 's'}`
    : 'Selected key interpolation';

  const keyTangent = $<HTMLSelectElement>('#graph-key-tangent');
  const selectedTangentIndices = selectedGraphIndices.filter(index => {
    const incomingBezier = index > 0 && effectiveSegmentInterpolation(activeKeys[index - 1]) === 'bezier';
    const outgoingBezier = index < activeKeys.length - 1 && effectiveSegmentInterpolation(activeKeys[index]) === 'bezier';
    return incomingBezier || outgoingBezier;
  });
  const selectedTangentModes = [...new Set(selectedTangentIndices.map(index => activeKeys[index].tangent ?? 'free'))];
  keyTangent.value = selectedTangentModes.length > 1 ? 'mixed' : selectedTangentModes[0] ?? 'free';
  keyTangent.disabled = !selectedTangentIndices.length || editor.editMode || editor.playing;
  keyTangent.title = selectedGraphFrames.length > 1
    ? `Apply tangent mode to ${selectedTangentIndices.length} selected Bezier key${selectedTangentIndices.length === 1 ? '' : 's'}`
    : 'Selected key tangent mode';

  const graphHandleSide = $<HTMLSelectElement>('#graph-handle-side');
  const graphHandleFrame = $<HTMLInputElement>('#graph-handle-frame');
  const graphHandleValue = $<HTMLInputElement>('#graph-handle-value');
  const graphHandleApply = $<HTMLButtonElement>('#apply-graph-handle');
  const singleGraphIndex = singleGraphKey ? activeKeys.findIndex(key => key.frame === singleGraphKey.frame) : -1;
  const hasLeftHandle = singleGraphIndex > 0 && effectiveSegmentInterpolation(activeKeys[singleGraphIndex - 1]) === 'bezier';
  const hasRightHandle = singleGraphIndex >= 0 && singleGraphIndex < activeKeys.length - 1 && effectiveSegmentInterpolation(activeKeys[singleGraphIndex]) === 'bezier';
  graphHandleSide.options[0].disabled = !hasLeftHandle;
  graphHandleSide.options[1].disabled = !hasRightHandle;
  if ((graphHandleSide.value === 'left' && !hasLeftHandle) || (graphHandleSide.value === 'right' && !hasRightHandle)) {
    graphHandleSide.value = hasLeftHandle ? 'left' : 'right';
  }
  const handleSide = graphHandleSide.value as 'left' | 'right';
  const canInspectHandle = singleGraphKey !== null && (hasLeftHandle || hasRightHandle) && !editor.editMode && !editor.playing;
  graphHandleSide.disabled = !canInspectHandle;
  graphHandleFrame.disabled = !canInspectHandle;
  graphHandleValue.disabled = !canInspectHandle;
  graphHandleApply.disabled = !canInspectHandle;
  const tangentMode = singleGraphKey?.tangent ?? 'free';
  $('#graph-handle-mode').textContent = !canInspectHandle
    ? '—'
    : tangentMode === 'auto'
      ? 'AUTO · edit → ALIGNED'
      : tangentMode === 'aligned'
        ? 'ALIGNED · linked'
        : 'FREE · independent';
  $('#graph-handle-mode').dataset.mode = canInspectHandle ? tangentMode : '';
  const effectiveHandle = canInspectHandle ? effectiveBezierHandle(activeKeys, singleGraphIndex, handleSide) : null;
  const handleAbsoluteFrame = effectiveHandle && singleGraphKey ? singleGraphKey.frame + effectiveHandle[0] : null;
  const handleAbsoluteValueNative = effectiveHandle && singleGraphKey ? singleGraphKey.value + effectiveHandle[1] : null;
  const handleValueFactor = graphChannel.startsWith('rotation.') ? 180 / Math.PI : 1;
  graphHandleValue.step = graphChannel.startsWith('rotation.') ? '1' : '0.1';
  $('#graph-handle-value-unit').textContent = graphChannel.startsWith('rotation.') ? '°' : '';
  if (document.activeElement !== graphHandleFrame) {
    graphHandleFrame.value = handleAbsoluteFrame === null ? '' : String(Number(handleAbsoluteFrame.toFixed(6)));
  }
  if (document.activeElement !== graphHandleValue) {
    graphHandleValue.value = handleAbsoluteValueNative === null ? '' : String(Number((handleAbsoluteValueNative * handleValueFactor).toFixed(6)));
  }
  $('#graph-handle-hint').textContent = !canInspectHandle
    ? 'Select one Bezier key'
    : tangentMode === 'auto'
      ? 'Dragging or applying a manual handle converts Auto to Aligned'
      : tangentMode === 'aligned'
        ? 'Opposite handle stays collinear and keeps its own length'
        : 'Each handle moves independently';

  const timeScale = $<HTMLInputElement>('#graph-time-scale');
  const applyTimeScale = $<HTMLButtonElement>('#apply-graph-time-scale');
  const canScaleTime = selectedGraphFrames.length >= 2 && !editor.editMode && !editor.playing;
  timeScale.disabled = !canScaleTime;
  applyTimeScale.disabled = !canScaleTime;
  applyTimeScale.title = canScaleTime
    ? `Scale ${selectedGraphFrames.length} selected key times around their range midpoint`
    : 'Select at least two channel keys to scale timing';

  $<HTMLButtonElement>('#insert-channel-key').disabled = !editor.selected || editor.editMode || editor.playing;
  const removeChannelKey = $<HTMLButtonElement>('#remove-channel-key');
  removeChannelKey.disabled = !selectedGraphFrames.length || editor.editMode || editor.playing;
  removeChannelKey.title = selectedGraphFrames.length > 1
    ? `Remove ${selectedGraphFrames.length} selected channel keys`
    : 'Remove selected channel key';

  const timelineSelectionCount = timelineSelectedFrames.size;
  $('#timeline-selection-count').textContent = timelineSelectionCount ? `${timelineSelectionCount} selected` : '0 selected';
  const removeTimelineSelected = $<HTMLButtonElement>('#remove-timeline-selected');
  removeTimelineSelected.disabled = !timelineSelectionCount || editor.editMode || editor.playing;
  removeTimelineSelected.title = timelineSelectionCount
    ? `Remove ${timelineSelectionCount} selected Timeline key${timelineSelectionCount === 1 ? '' : 's'}`
    : 'Select Timeline keys to remove';
  const timelineTimeScale = $<HTMLInputElement>('#timeline-time-scale');
  const applyTimelineTimeScale = $<HTMLButtonElement>('#apply-timeline-time-scale');
  const canScaleTimeline = timelineSelectionCount >= 2 && !editor.editMode && !editor.playing;
  timelineTimeScale.disabled = !canScaleTimeline;
  applyTimelineTimeScale.disabled = !canScaleTimeline;
  applyTimelineTimeScale.title = canScaleTimeline
    ? `Scale ${timelineSelectionCount} selected Timeline key times around their range midpoint`
    : 'Select at least two Timeline keys to scale timing';

  const timelineTrackElement = $('#timeline-track');
  timelineTrackElement.dataset.viewStart = String(timelineViewStart);
  timelineTrackElement.dataset.viewEnd = String(timelineViewEnd);
  timelineTrackElement.dataset.viewManual = String(timelineViewManual);

  const sceneSpan = editor.frameEnd - editor.frameStart;
  const scrollbarLeft = sceneSpan > 0 ? (timelineViewStart - editor.frameStart) / sceneSpan * 100 : 0;
  const scrollbarWidth = sceneSpan > 0 ? (timelineViewEnd - timelineViewStart) / sceneSpan * 100 : 100;
  timelineViewThumb.style.left = `${THREE.MathUtils.clamp(scrollbarLeft, 0, 100)}%`;
  timelineViewThumb.style.width = `${THREE.MathUtils.clamp(scrollbarWidth, 0, 100)}%`;
  timelineViewScrollbar.setAttribute('aria-valuemin', String(editor.frameStart));
  timelineViewScrollbar.setAttribute('aria-valuemax', String(editor.frameEnd));
  timelineViewScrollbar.setAttribute('aria-valuenow', String(Math.round(timelineViewStart)));
  timelineViewScrollbar.setAttribute('aria-valuetext', `Timeline view ${Math.round(timelineViewStart)}–${Math.round(timelineViewEnd)}`);
  timelineViewScrollbar.title = `Timeline view ${Math.round(timelineViewStart)}–${Math.round(timelineViewEnd)} · drag to pan · resize handles to zoom`;

  $<HTMLButtonElement>('#timeline-frame-selected').disabled = !timelineSelectionCount;
  $<HTMLButtonElement>('#timeline-frame-scene').disabled = false;
  $<HTMLButtonElement>('#timeline-center-current').disabled = false;

  const preview = editor.previewRange;
  const playback = editor.playbackRange;
  const rangeState = `${editor.frameStart}:${editor.frameEnd}:${preview?.start ?? ''}:${preview?.end ?? ''}:${timelineViewStart}:${timelineViewEnd}`;
  const startInput = $<HTMLInputElement>('#frame-start');
  const endInput = $<HTMLInputElement>('#frame-end');
  const previewStartInput = $<HTMLInputElement>('#preview-start');
  const previewEndInput = $<HTMLInputElement>('#preview-end');
  const previewToggle = $<HTMLButtonElement>('#preview-toggle');
  const currentFrameInput = $<HTMLInputElement>('#current-frame');
  const scrubber = $<HTMLInputElement>('#scrubber');
  if (document.activeElement !== startInput) startInput.value = String(editor.frameStart);
  if (document.activeElement !== endInput) endInput.value = String(editor.frameEnd);
  if (document.activeElement !== previewStartInput) previewStartInput.value = String(preview?.start ?? editor.frameStart);
  if (document.activeElement !== previewEndInput) previewEndInput.value = String(preview?.end ?? editor.frameEnd);
  previewStartInput.min = previewEndInput.min = String(editor.frameStart);
  previewStartInput.max = previewEndInput.max = String(editor.frameEnd);
  previewStartInput.disabled = previewEndInput.disabled = editor.playing;
  previewToggle.disabled = editor.playing;
  previewToggle.classList.toggle('active', preview !== null);
  previewToggle.setAttribute('aria-pressed', String(preview !== null));
  previewToggle.setAttribute('aria-label', preview ? 'Clear Preview Range' : 'Enable Preview Range');
  previewToggle.title = preview ? `Clear Preview Range ${preview.start}–${preview.end}` : 'Enable Preview Range';
  $('#timeline-preview-status').textContent = preview ? `Preview ${preview.start}–${preview.end}` : 'Scene playback';
  currentFrameInput.min = String(editor.frameStart);
  currentFrameInput.max = String(editor.frameEnd);
  scrubber.min = String(Math.ceil(timelineViewStart));
  scrubber.max = String(Math.floor(timelineViewEnd));
  const previewOverlay = $('#timeline-preview-range');
  const previewVisibleStart = Math.max(playback.start, timelineViewStart);
  const previewVisibleEnd = Math.min(playback.end, timelineViewEnd);
  const previewVisible = preview !== null && previewVisibleEnd >= previewVisibleStart;
  previewOverlay.classList.toggle('active', previewVisible);
  previewOverlay.style.left = previewVisible ? `${timelinePercent(previewVisibleStart)}%` : '0%';
  previewOverlay.style.width = previewVisible
    ? `${timelinePercent(previewVisibleEnd) - timelinePercent(previewVisibleStart)}%`
    : '0%';
  $<HTMLButtonElement>('#first-frame').title = preview
    ? `First preview frame ${playback.start}`
    : `First scene frame ${playback.start}`;
  $<HTMLButtonElement>('#last-frame').title = preview
    ? `Last preview frame ${playback.end}`
    : `Last scene frame ${playback.end}`;

  if (timelineRangeState !== rangeState) {
    const span = timelineViewEnd - timelineViewStart;
    const rulerFrames = [...new Set(Array.from({ length: 11 }, (_, index) =>
      Math.round(timelineViewStart + span * index / 10)
    ))];
    $('#timeline-ruler').innerHTML = rulerFrames
      .map(rulerFrame => `<span style="left:${timelinePercent(rulerFrame)}%">${rulerFrame}</span>`)
      .join('');
    timelineRangeState = rangeState;
  }

  const state = `${rangeState}|${frame}|${editor.playing}|${markers}|${selectedMarkers}`;
  if (timelineState === state) return;
  timelineState = state;
  currentFrameInput.value = String(frame);
  scrubber.value = String(THREE.MathUtils.clamp(frame, Math.ceil(timelineViewStart), Math.floor(timelineViewEnd)));
  const timelinePlayhead = $('#playhead');
  timelinePlayhead.style.left = `${timelinePercent(editor.frame)}%`;
  timelinePlayhead.classList.toggle('outside', editor.frame < timelineViewStart || editor.frame > timelineViewEnd);
  timelinePlayhead.querySelector('span')!.textContent = String(frame);
  if (wasPlaying !== editor.playing) { $('#play').innerHTML = icon(editor.playing ? 'pause' : 'play'); refreshIcons(); wasPlaying = editor.playing; }
  $('#draw-status').textContent = editor.playing ? 'PLAYING · 24 FPS' : 'ON DEMAND';
  const markerRenderState = `${rangeState}|${markers}`;
  if (markerState !== markerRenderState) {
    $('#keyframe-markers').innerHTML = markerFrames
      .map(keyFrame => `<button type="button" class="key-marker" data-frame="${keyFrame}" aria-label="Animation key at frame ${keyFrame}" title="Animation key at frame ${keyFrame}" style="left:${timelinePercent(keyFrame)}%"></button>`)
      .join('');
    markerState = markerRenderState;
  }
  setTimelineMarkerSelection();
}
editor.addEventListener('change', updateUI);
editor.addEventListener('transform', updateTransforms);
editor.addEventListener('history-limit', () => toast('Scene exceeds the 24 MiB undo budget. History disabled; save a project file.'));
editor.addEventListener('frame', updateTimeline);
editor.addEventListener('animation', updateTimeline);
editor.addEventListener('mode', updateTimeline);
editor.addEventListener('mode', () => {
  $('#component-mode').classList.toggle('hidden', !editor.editMode || editor.weightMode);
  $<HTMLSelectElement>('#mode').value = editor.weightMode ? 'weight' : editor.editMode ? 'edit' : 'object';
  $('#mode-hint').textContent = editor.weightMode
    ? 'Weight Mode · click a vertex, Shift-click to toggle more; choose a bone and assign influence.'
    : editor.editMode
      ? `Select a ${editor.componentMode === 'face' ? 'triangle face' : editor.componentMode}, Shift-click to toggle more; drag the move gizmo.`
      : 'Build something extraordinary.';
});
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
  rigSystem.captureEditedRest();
  editor.commit();
});
on('reset-transform', () => { if (editor.selected) { editor.selected.position.set(0,0,0); editor.selected.rotation.set(0,0,0); editor.selected.scale.set(1,1,1); rigSystem.captureEditedRest(); editor.commit(); } });
on('extrude-face', async () => { try { if (!editor.editMode || editor.componentMode !== 'face' || editor.componentSelection.length !== 1) throw new Error('Select exactly one triangle face in Edit Mode first.'); await editor.runModeling({kind:'extrude',face:editor.componentSelection[0],distance:Number($<HTMLInputElement>('#extrude-distance').value)}); toast('Triangle extruded. Move the selected cap or extrude again.'); } catch (error) { toast((error as Error).message); } });
$('#extrude-face').insertAdjacentHTML('afterend', '<button class="wide-button" id="extrude-region">Extrude planar region</button><p class="field-help">Shift-select connected coplanar triangle faces. Uses Extrusion distance and adds walls only along the region boundary.</p>');
on('extrude-region', async () => { try { if (!editor.editMode || editor.componentMode !== 'face' || !editor.componentSelection.length) throw new Error('Select connected coplanar triangle faces in Edit Mode first.'); await editor.runModeling({kind:'region',faces:editor.componentSelection,distance:Number($<HTMLInputElement>('#extrude-distance').value)}); toast('Planar region extruded. The cap faces remain selected.'); } catch (error) { toast((error as Error).message); } });
$('#mirror').insertAdjacentHTML('beforebegin', '<label class="property-row">Inset distance<input id="inset-distance" aria-label="Inset distance" type="number" min="0.0001" max="1000" step="0.05" value="0.1"></label><button class="wide-button" id="inset-face">Inset selected triangle</button><p class="field-help">Moves each edge inward by the local distance. Must be smaller than the triangle inradius.</p>');
on('inset-face', async () => { try { if (!editor.editMode || editor.componentMode !== 'face' || editor.componentSelection.length !== 1) throw new Error('Select exactly one triangle face in Edit Mode first.'); await editor.runModeling({kind:'inset',face:editor.componentSelection[0],distance:Number($<HTMLInputElement>('#inset-distance').value)}); toast('Triangle inset. The inner face remains selected.'); } catch (error) { toast((error as Error).message); } });
$('#mirror').insertAdjacentHTML('beforebegin', '<label class="property-row">Proportional editing<input id="proportional-enabled" aria-label="Proportional editing" type="checkbox"></label><label class="property-row">Influence radius<input id="proportional-radius" aria-label="Proportional radius" type="number" min="0.0001" step="0.1" value="2"></label><p class="field-help">Edit Mode: nearby vertices follow with smooth falloff. Radius uses local units and can reach disconnected geometry.</p>');
$('#proportional-radius').closest('label')!.insertAdjacentHTML('afterend', '<label class="property-row">Connected only<input id="proportional-connected" aria-label="Connected only" type="checkbox"></label><p class="field-help">Connected only measures distance along mesh edges, including triangle diagonals. Disconnected islands stay fixed.</p>');
$('#mirror').insertAdjacentHTML('beforebegin', '<label class="property-row">Snap target<select id="snap-target-kind" aria-label="Snap target"><option value="vertex">Vertex</option><option value="edge">Edge midpoint</option><option value="surface">Surface point</option></select></label><button class="wide-button" id="vertex-snap">Pick snap target</button><p class="field-help">Edit Mode: move the selection center to a vertex, edge midpoint or clicked surface point in this mesh. Target vertices must be unselected. Click a target; Escape cancels. Grid and proportional settings do not affect this action.</p>');
$('#mirror').insertAdjacentHTML('beforebegin', '<button class="wide-button" id="subdivide-edge">Subdivide selected edges</button><p class="field-help">Select edges in Edit Mode; Shift-click to select more. Splits adjacent triangles and selects all new midpoint vertices.</p>');
on('subdivide-edge', async () => { try { if (!editor.editMode || editor.componentMode !== 'edge' || !editor.componentSelection.length) throw new Error('Select one or more edges in Edit Mode first.'); await editor.runModeling({kind:'subdivide',edges:editor.componentSelection.map(id=>editor.meshTopology!.edges[id].map(v=>editor.meshTopology!.vertices[v][0]) as [number,number])}); toast('Edges subdivided. Move the selected midpoint vertices.'); } catch (error) { toast((error as Error).message); } });
editor.addEventListener('mode', () => { $<HTMLSelectElement>('#component-mode').value = editor.componentMode; });
$('#snap-target-kind').onchange = () => editor.cancelVertexSnap();
on('vertex-snap', () => {
  try {
    if (editor.snapTargetPending) editor.cancelVertexSnap();
    else {
      const kind = $<HTMLSelectElement>('#snap-target-kind').value as 'vertex' | 'edge' | 'surface';
      editor.beginVertexSnap(kind);
      toast(kind === 'surface' ? 'Click a triangle with all vertices unselected. Escape cancels.' : kind === 'edge' ? 'Click an edge with both endpoints unselected. Escape cancels.' : 'Click an unselected vertex in the active mesh. Escape cancels.');
    }
  } catch (error) { toast((error as Error).message); }
});
editor.addEventListener('snap-target', () => {
  $('#vertex-snap').textContent = editor.snapTargetPending ? 'Cancel snap target' : 'Pick snap target';
  $('#vertex-snap').setAttribute('aria-pressed', String(editor.snapTargetPending));
});
editor.addEventListener('snap-complete', () => toast(editor.snapTargetKind === 'surface' ? 'Selection center snapped to surface point.' : editor.snapTargetKind === 'edge' ? 'Selection center snapped to edge midpoint.' : 'Selection center snapped to vertex.'));
editor.addEventListener('snap-error', event => toast((event as CustomEvent<string>).detail));
let proportionalEnabled = false, proportionalRadius = 2, proportionalConnected = false;
for (const id of ['proportional-enabled', 'proportional-radius', 'proportional-connected']) $<HTMLInputElement>(`#${id}`).onchange = () => {
  try {
    const enabled = $<HTMLInputElement>('#proportional-enabled').checked, radius = Number($<HTMLInputElement>('#proportional-radius').value);
    const connected = $<HTMLInputElement>('#proportional-connected').checked;
    editor.setProportionalEditing(enabled, radius, connected);
    proportionalEnabled = enabled; proportionalRadius = radius; proportionalConnected = connected;
  } catch (error) {
    $<HTMLInputElement>('#proportional-enabled').checked = proportionalEnabled;
    $<HTMLInputElement>('#proportional-radius').value = String(proportionalRadius);
    $<HTMLInputElement>('#proportional-connected').checked = proportionalConnected;
    toast((error as Error).message);
  }
};
$<HTMLSelectElement>('#component-mode').onchange = e => editor.setComponentMode((e.target as HTMLSelectElement).value as 'vertex' | 'edge' | 'face');
$<HTMLSelectElement>('#mode').onchange = async e => {
  const value = (e.target as HTMLSelectElement).value;
  try {
    if (value === 'weight') {
      rigSystem.beginWeightEdit();
      tool('select');
    } else {
      if (editor.weightMode) rigSystem.endWeightEdit();
      if (!await editor.enterEditMode(value === 'edit')) {
        $<HTMLSelectElement>('#mode').value = 'object';
        toast('Select a mesh, apply its modifiers and pause playback first.');
      }
      tool(value === 'edit' ? 'translate' : 'select');
    }
  } catch (error) {
    toast((error as Error).message);
    $<HTMLSelectElement>('#mode').value = editor.weightMode ? 'weight' : editor.editMode ? 'edit' : 'object';
  }
};
$<HTMLSelectElement>('#space').onchange = e => editor.setTransformOrientation((e.target as HTMLSelectElement).value as TransformOrientation);
function snap() { const enabled = !$('#snap').classList.contains('active'); $('#snap').classList.toggle('active', enabled); editor.setTransformSnapping(enabled); toast(enabled ? 'Snap: 0.5 units · 15° · 0.1 scale' : 'Snapping disabled'); }
on('snap', snap);
on('grid', () => { editor.grid.visible = !editor.grid.visible; $('#grid').classList.toggle('active', editor.grid.visible); editor.invalidate(); });
for (const value of ['wire','solid','material']) on(`shading-${value}`, () => { editor.setShading(value); document.querySelectorAll('.shading-group button').forEach(b => b.classList.toggle('active', b.id === `shading-${value}`)); });
on('focus', () => editor.focus()); on('frame-all', () => editor.focus(true));
for (const [id, axis] of [['axis-x','right'],['axis-y','top'],['axis-z','front'],['axis-home','perspective'],['home-view','perspective']] as const) on(id, () => {
  editor.view(axis);
  $('#view-label').textContent = axis === 'perspective'
    ? 'User Perspective'
    : `${axis[0].toUpperCase()+axis.slice(1)} Orthographic`;
});
on('projection', () => editor.toggleProjection());
for (const id of ['duplicate','duplicate-rail']) on(id, () => editor.duplicate());
on('duplicate-linked', () => toast(editor.duplicateLinked() ? 'Created linked duplicate.' : 'Linked duplicate requires an ordinary mesh without modifiers.'));
function deleteSelection() {
  if (editor.weightMode) { toast('Finish Weight Mode before deleting scene objects.'); return; }
  if (editor.selected instanceof THREE.Bone && rigSystem.mode === 'edit') {
    rigAction(() => { rigSystem.deleteSelectedBone(); toast('Bone deleted; child bones kept in place.'); });
  } else editor.remove();
}
for (const id of ['delete','delete-outliner']) on(id, deleteSelection);
on('menu-undo', () => editor.undo()); on('menu-redo', () => editor.redo());
on('smooth', () => editor.smooth(false)); on('flat', () => editor.smooth(true));
mountModelingUI(editor, toast);
on('mirror', () => toast(editor.mirror() ? 'Mirrored mesh geometry on the local X axis.' : 'Select a mesh to mirror.'));
on('add-outliner', () => { $('#add-menu').classList.toggle('hidden'); });
$('#add-outliner').addEventListener('click', e => e.stopPropagation());
on('add-collection', () => {
  try {
    activeCollection = editor.createCollection($<HTMLInputElement>('#collection-name').value);
    toast(`Collection “${activeCollection.name}” created.`);
  } catch (error) { toast((error as Error).message); }
});
$<HTMLSelectElement>('#collection-target').onchange = event => {
  const uuid = (event.target as HTMLSelectElement).value;
  activeCollection = editor.collections.find(collection => collection.uuid === uuid) ?? null;
  renderOutliner();
};
on('move-to-collection', () => {
  try {
    const uuid = $<HTMLSelectElement>('#collection-target').value;
    const collection = editor.collections.find(candidate => candidate.uuid === uuid);
    if (!collection) throw new Error('Choose a collection first.');
    editor.moveSelectedToCollection(collection);
    toast(`Selected objects moved to ${collection.name}.`);
  } catch (error) { toast((error as Error).message); }
});
on('unlink-collection', () => {
  try { editor.unlinkSelectedFromCollection(); toast('Selected objects unlinked from their collection.'); }
  catch (error) { toast((error as Error).message); }
});
on('delete-collection', () => {
  try {
    if (!activeCollection) throw new Error('Choose a collection first.');
    const name = activeCollection.name;
    editor.deleteCollection(activeCollection);
    activeCollection = editor.collections[0] ?? null;
    toast(`Empty collection ${name} deleted.`);
  } catch (error) { toast((error as Error).message); }
});
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
on('play', () => { if (editor.weightMode) toast('Finish Weight Mode before playback.'); else editor.togglePlayback(); });
on('first-frame', () => editor.scrub(editor.playbackRange.start));
on('last-frame', () => editor.scrub(editor.playbackRange.end));
for (const [id, direction] of [['previous-key',-1],['next-key',1]] as const) on(id, () => {
  const frames = allAnimationFrames(editor.selected?.userData.animationTracks as AnimationTrackMap | undefined)
    .filter(keyFrame => keyFrame >= editor.frameStart && keyFrame <= editor.frameEnd);
  const next = direction === 1
    ? frames.find(keyFrame => keyFrame > editor.frame)
    : [...frames].reverse().find(keyFrame => keyFrame < editor.frame);
  if (next !== undefined) editor.scrub(next);
});
function insertKey() { toast(editor.insertKey() ? `Transform keys inserted at frame ${Math.round(editor.frame)}.` : 'Select an object in Object Mode first.'); }

document.querySelectorAll<HTMLButtonElement>('[data-graph-channel]').forEach(button => button.addEventListener('click', () => {
  graphChannel = button.dataset.graphChannel as ScalarAnimationChannel;
  updateTimeline();
}));

on('graph-frame-all', () => animationGraph.frameAll());
on('graph-frame-selected', () => animationGraph.frameSelected());
on('graph-scene-range', () => animationGraph.frameSceneRange());
on('graph-center-current', () => animationGraph.centerCurrentFrame());

function applyGraphKeyInspector() {
  const sourceFrame = animationGraph.selectedKeyFrame;
  if (sourceFrame === null) return false;
  const targetFrame = Number($<HTMLInputElement>('#graph-key-frame').value);
  const value = Number($<HTMLInputElement>('#graph-key-value').value);
  try {
    const edited = editor.editChannelKey(graphChannel, sourceFrame, targetFrame, value);
    if (!edited) {
      toast('Graph key Frame / Value is unchanged.');
      updateTimeline();
      return false;
    }
    animationGraph.selectKeyFrame(edited.frame);
    toast(`${animationChannelLabel(graphChannel)} key updated at frame ${edited.frame}.`);
    updateTimeline();
    return true;
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
    return false;
  }
}
on('apply-graph-key-inspector', applyGraphKeyInspector);
for (const id of ['graph-key-frame','graph-key-value']) {
  $<HTMLInputElement>(`#${id}`).addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyGraphKeyInspector();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur();
      updateTimeline();
    }
  });
}

function applyGraphHandleInspector() {
  const keyFrame = animationGraph.selectedKeyFrame;
  if (keyFrame === null) return false;
  const side = $<HTMLSelectElement>('#graph-handle-side').value as 'left' | 'right';
  const targetFrame = Number($<HTMLInputElement>('#graph-handle-frame').value);
  const value = Number($<HTMLInputElement>('#graph-handle-value').value);
  try {
    const edited = editor.editAnimationHandle(keyFrame, graphChannel, side, targetFrame, value);
    if (!edited) {
      toast('Bezier handle Frame / Value is unchanged.');
      updateTimeline();
      return false;
    }
    toast(`${animationChannelLabel(graphChannel)} ${side} handle updated.`);
    updateTimeline();
    return true;
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
    return false;
  }
}
on('apply-graph-handle', applyGraphHandleInspector);
$<HTMLSelectElement>('#graph-handle-side').addEventListener('change', updateTimeline);
for (const id of ['graph-handle-frame','graph-handle-value']) {
  $<HTMLInputElement>(`#${id}`).addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyGraphHandleInspector();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur();
      updateTimeline();
    }
  });
}

$('#graph-key-interpolation').addEventListener('change', event => {
  const frames = animationGraph.selectedKeyFrames;
  if (!frames.length) return;
  const value = (event.target as HTMLSelectElement).value as KeyInterpolation;
  try {
    editor.setKeyInterpolations(frames, graphChannel, value);
    updateTimeline();
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
  }
});

$('#graph-key-tangent').addEventListener('change', event => {
  const frames = animationGraph.selectedKeyFrames;
  if (!frames.length) return;
  const value = (event.target as HTMLSelectElement).value as KeyTangentMode;
  try {
    editor.setKeyTangentModes(frames, graphChannel, value);
    updateTimeline();
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
  }
});

on('insert-channel-key', () => {
  if (editor.insertChannelKey(graphChannel)) {
    animationGraph.selectKeyFrame(Math.round(editor.frame));
    toast(`${animationChannelLabel(graphChannel)} key inserted at frame ${Math.round(editor.frame)}.`);
    updateTimeline();
  }
});
on('remove-channel-key', () => {
  const frames = animationGraph.selectedKeyFrames;
  if (frames.length && editor.removeChannelKeys(graphChannel, frames)) {
    animationGraph.selectKeyFrame(null);
    toast(`${frames.length} ${animationChannelLabel(graphChannel)} key${frames.length === 1 ? '' : 's'} removed.`);
    updateTimeline();
  }
});

on('apply-graph-time-scale', () => {
  const frames = animationGraph.selectedKeyFrames;
  const factor = Number($<HTMLInputElement>('#graph-time-scale').value);
  try {
    const scaled = editor.scaleChannelKeyTimes(graphChannel, frames, factor);
    if (!scaled) {
      toast('Time scale did not move any selected keys.');
      return;
    }
    animationGraph.selectKeyFrames(scaled);
    $<HTMLInputElement>('#graph-time-scale').value = '1';
    toast(`${frames.length} selected key times scaled ×${factor} around F${((frames[0] + frames[frames.length - 1]) / 2).toFixed(1).replace('.0', '')}.`);
    updateTimeline();
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
  }
});

on('insert-key', insertKey);
on('remove-key', () => editor.removeKey());

function removeSelectedTimelineKeys() {
  const frames = [...timelineSelectedFrames].sort((a, b) => a - b);
  if (!frames.length) return false;
  try {
    const removed = editor.removeTimelineKeys(frames);
    if (!removed) return false;
    const removedSet = new Set(frames);
    const graphSelection = animationGraph.selectedKeyFrames.filter(frame => !removedSet.has(frame));
    animationGraph.selectKeyFrames(graphSelection);
    timelineSelectedFrames.clear();
    toast(`${frames.length} Timeline key${frames.length === 1 ? '' : 's'} removed.`);
    timelineState = '';
    updateTimeline();
    return true;
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
    return false;
  }
}

function applyTimelineTimeScale() {
  const frames = [...timelineSelectedFrames].sort((a, b) => a - b);
  const factor = Number($<HTMLInputElement>('#timeline-time-scale').value);
  try {
    const graphSelectionBefore = animationGraph.selectedKeyFrames;
    const scaled = editor.scaleTimelineKeyTimes(frames, factor);
    if (!scaled) {
      toast('Timeline time scale did not move any selected keys.');
      return false;
    }
    const targetBySource = new Map(frames.map((frame, index) => [frame, scaled.frames[index]]));
    const graphSelection = graphSelectionBefore.map(frame => targetBySource.get(frame) ?? frame);
    if (graphSelection.some((frame, index) => frame !== graphSelectionBefore[index])) {
      animationGraph.selectKeyFrames(graphSelection);
    }
    timelineSelectedFrames = new Set(scaled.frames);
    $<HTMLInputElement>('#timeline-time-scale').value = '1';
    toast(`${frames.length} Timeline key times scaled ×${factor} around F${((frames[0] + frames[frames.length - 1]) / 2).toFixed(1).replace('.0', '')}.`);
    timelineState = '';
    updateTimeline();
    return true;
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
    return false;
  }
}
on('remove-timeline-selected', removeSelectedTimelineKeys);
on('apply-timeline-time-scale', applyTimelineTimeScale);
on('timeline-frame-scene', frameTimelineSceneRange);
on('timeline-frame-selected', frameSelectedTimelineKeys);
on('timeline-center-current', centerTimelineOnCurrentFrame);

type TimelineKeyDrag = {
  anchorMarker: HTMLButtonElement;
  pointerId: number;
  anchorFrame: number;
  targetFrame: number;
  sourceFrames: number[];
  markers: Array<{ marker: HTMLButtonElement; frame: number }>;
  copy: boolean;
  ghostMarkers: Array<{ marker: HTMLButtonElement; frame: number }>;
};
let timelineKeyDrag: TimelineKeyDrag | null = null;

type TimelineBoxDrag = {
  pointerId: number;
  startX: number;
  currentX: number;
  baseSelection: Set<number>;
  moved: boolean;
};
let timelineBoxDrag: TimelineBoxDrag | null = null;

type TimelinePanDrag = {
  pointerId: number;
  startClientX: number;
  startViewStart: number;
  startViewEnd: number;
  startManual: boolean;
};
let timelinePanDrag: TimelinePanDrag | null = null;

type TimelineScrollbarDrag = {
  pointerId: number;
  kind: 'pan' | 'start' | 'end';
  startClientX: number;
  startViewStart: number;
  startViewEnd: number;
  startManual: boolean;
};
let timelineScrollbarDrag: TimelineScrollbarDrag | null = null;

const timelineTrack = $('#timeline-track');
const timelineSelectionBox = $('#timeline-selection-box');
const timelineMarkers = $('#keyframe-markers');
const timelineViewScrollbar = $('#timeline-view-scrollbar');
const timelineViewThumb = $('#timeline-view-thumb');

function timelinePercent(frame: number) {
  return THREE.MathUtils.clamp(
    (frame - timelineViewStart) / (timelineViewEnd - timelineViewStart) * 100,
    0,
    100,
  );
}

function timelineFrameAt(clientX: number) {
  const rect = timelineTrack.getBoundingClientRect();
  if (rect.width <= 0) return Math.round(timelineViewStart);
  const frame = timelineViewStart + (clientX - rect.left) / rect.width * (timelineViewEnd - timelineViewStart);
  return THREE.MathUtils.clamp(Math.round(frame), Math.ceil(timelineViewStart), Math.floor(timelineViewEnd));
}

function timelineTrackX(clientX: number) {
  const rect = timelineTrack.getBoundingClientRect();
  return THREE.MathUtils.clamp(clientX - rect.left, 0, rect.width);
}

function setTimelineSelectionBox(startX: number, currentX: number) {
  const left = Math.min(startX, currentX);
  const right = Math.max(startX, currentX);
  timelineSelectionBox.style.left = `${left}px`;
  timelineSelectionBox.style.width = `${right - left}px`;
  timelineSelectionBox.classList.toggle('active', right - left >= 3);
}

function timelineFramesInBox(startX: number, currentX: number) {
  const rect = timelineTrack.getBoundingClientRect();
  if (rect.width <= 0) return [] as number[];
  const left = Math.min(startX, currentX);
  const right = Math.max(startX, currentX);
  const tracks = editor.selected?.userData.animationTracks as AnimationTrackMap | undefined;
  return allAnimationFrames(tracks).filter(frame => {
    if (frame < timelineViewStart || frame > timelineViewEnd) return false;
    const x = timelinePercent(frame) / 100 * rect.width;
    return x >= left && x <= right;
  });
}

function previewTimelineBoxSelection() {
  const drag = timelineBoxDrag;
  if (!drag) return;
  const next = new Set(drag.baseSelection);
  if (drag.moved) for (const frame of timelineFramesInBox(drag.startX, drag.currentX)) next.add(frame);
  timelineSelectedFrames = next;
  setTimelineMarkerSelection();
}

function cancelTimelineBoxDrag() {
  const drag = timelineBoxDrag;
  if (!drag) return false;
  timelineBoxDrag = null;
  timelineSelectedFrames = new Set(drag.baseSelection);
  timelineSelectionBox.classList.remove('active');
  timelineSelectionBox.style.width = '0px';
  if (timelineTrack.hasPointerCapture(drag.pointerId)) timelineTrack.releasePointerCapture(drag.pointerId);
  timelineState = '';
  updateTimeline();
  return true;
}

function restoreTimelineMarker(marker: HTMLButtonElement, frame: number) {
  marker.style.left = `${timelinePercent(frame)}%`;
  marker.dataset.frame = String(frame);
  marker.setAttribute('aria-label', `Animation key at frame ${frame}`);
  marker.title = `Animation key at frame ${frame}`;
}

function setTimelineMarkerSelection() {
  timelineMarkers.querySelectorAll<HTMLButtonElement>('.key-marker:not(.copy-ghost)').forEach(marker => {
    marker.classList.toggle('selected', timelineSelectedFrames.has(Number(marker.dataset.frame)));
  });
}

function clearTimelineCopyGhosts(drag: TimelineKeyDrag) {
  for (const item of drag.ghostMarkers) item.marker.remove();
}

function cancelTimelineKeyDrag() {
  const drag = timelineKeyDrag;
  if (!drag) return false;
  timelineKeyDrag = null;
  if (drag.copy) {
    clearTimelineCopyGhosts(drag);
  } else {
    for (const item of drag.markers) {
      item.marker.classList.remove('dragging');
      restoreTimelineMarker(item.marker, item.frame);
    }
  }
  if (drag.anchorMarker.hasPointerCapture(drag.pointerId)) drag.anchorMarker.releasePointerCapture(drag.pointerId);
  editor.scrub(drag.anchorFrame);
  setTimelineMarkerSelection();
  return true;
}

timelineTrack.addEventListener('pointerdown', event => {
  if (event.button === 1 && !editor.playing && !timelineKeyDrag && !timelineBoxDrag) {
    event.preventDefault();
    event.stopPropagation();
    timelineTrack.focus({ preventScroll: true });
    timelinePanDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startViewStart: timelineViewStart,
      startViewEnd: timelineViewEnd,
      startManual: timelineViewManual,
    };
    timelineTrack.classList.add('panning');
    timelineTrack.setPointerCapture(event.pointerId);
    return;
  }

  if (!event.shiftKey || event.button !== 0 || editor.editMode || editor.playing) return;
  if ((event.target as Element).closest('.key-marker')) return;

  event.preventDefault();
  event.stopPropagation();

  const startX = timelineTrackX(event.clientX);
  timelineBoxDrag = {
    pointerId: event.pointerId,
    startX,
    currentX: startX,
    baseSelection: new Set(timelineSelectedFrames),
    moved: false,
  };
  timelineTrack.setPointerCapture(event.pointerId);
  setTimelineSelectionBox(startX, startX);
}, { capture: true });

timelineTrack.addEventListener('pointermove', event => {
  const pan = timelinePanDrag;
  if (pan && event.pointerId === pan.pointerId) {
    const rect = timelineTrack.getBoundingClientRect();
    if (rect.width > 0) {
      const span = pan.startViewEnd - pan.startViewStart;
      const frameDelta = -(event.clientX - pan.startClientX) / rect.width * span;
      setTimelineView(pan.startViewStart + frameDelta, pan.startViewEnd + frameDelta, true);
    }
    event.preventDefault();
    return;
  }

  const drag = timelineBoxDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();

  drag.currentX = timelineTrackX(event.clientX);
  drag.moved = drag.moved || Math.abs(drag.currentX - drag.startX) >= 3;
  setTimelineSelectionBox(drag.startX, drag.currentX);
  previewTimelineBoxSelection();
});

function cancelTimelinePanDrag() {
  const pan = timelinePanDrag;
  if (!pan) return false;
  timelinePanDrag = null;
  timelineTrack.classList.remove('panning');
  if (timelineTrack.hasPointerCapture(pan.pointerId)) timelineTrack.releasePointerCapture(pan.pointerId);
  setTimelineView(pan.startViewStart, pan.startViewEnd, pan.startManual);
  return true;
}

function finishTimelinePanDrag(event: PointerEvent) {
  const pan = timelinePanDrag;
  if (!pan || event.pointerId !== pan.pointerId) return;
  timelinePanDrag = null;
  timelineTrack.classList.remove('panning');
  if (timelineTrack.hasPointerCapture(event.pointerId)) timelineTrack.releasePointerCapture(event.pointerId);
  if (event.type === 'pointercancel') {
    setTimelineView(pan.startViewStart, pan.startViewEnd, pan.startManual);
  }
}

function finishTimelineBoxDrag(event: PointerEvent) {
  const drag = timelineBoxDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  timelineBoxDrag = null;

  if (timelineTrack.hasPointerCapture(event.pointerId)) timelineTrack.releasePointerCapture(event.pointerId);
  timelineSelectionBox.classList.remove('active');
  timelineSelectionBox.style.width = '0px';

  if (event.type === 'pointercancel' || !drag.moved) {
    timelineSelectedFrames = new Set(drag.baseSelection);
  } else {
    const next = new Set(drag.baseSelection);
    for (const frame of timelineFramesInBox(drag.startX, drag.currentX)) next.add(frame);
    timelineSelectedFrames = next;
  }

  timelineState = '';
  updateTimeline();
}
timelineTrack.addEventListener('pointerup', finishTimelinePanDrag);
timelineTrack.addEventListener('pointercancel', finishTimelinePanDrag);
timelineTrack.addEventListener('pointerup', finishTimelineBoxDrag);
timelineTrack.addEventListener('pointercancel', finishTimelineBoxDrag);

timelineTrack.addEventListener('wheel', event => {
  if (editor.playing || timelineKeyDrag || timelineBoxDrag || timelinePanDrag) return;
  const rect = timelineTrack.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const span = timelineViewEnd - timelineViewStart;
  const sceneSpan = editor.frameEnd - editor.frameStart;
  const minimumSpan = Math.min(2, sceneSpan);
  const factor = Math.exp(THREE.MathUtils.clamp(event.deltaY, -240, 240) * 0.0025);
  const nextSpan = THREE.MathUtils.clamp(span * factor, minimumSpan, sceneSpan);
  const anchorFrame = timelineViewStart + ratio * span;
  setTimelineView(
    anchorFrame - ratio * nextSpan,
    anchorFrame + (1 - ratio) * nextSpan,
    true,
  );
  event.preventDefault();
}, { passive: false });

timelineTrack.addEventListener('keydown', event => {
  if (event.target !== timelineTrack || timelineKeyDrag || timelineBoxDrag || timelinePanDrag || timelineScrollbarDrag) return;
  if (event.key === 'Home') {
    if (frameTimelineSceneRange()) event.preventDefault();
  } else if (event.code === 'NumpadDecimal') {
    if (frameSelectedTimelineKeys()) event.preventDefault();
  } else if (event.code === 'Numpad0') {
    if (centerTimelineOnCurrentFrame()) event.preventDefault();
  }
});

function cancelTimelineScrollbarDrag() {
  const drag = timelineScrollbarDrag;
  if (!drag) return false;
  timelineScrollbarDrag = null;
  timelineViewScrollbar.classList.remove('dragging', 'resizing');
  if (timelineViewScrollbar.hasPointerCapture(drag.pointerId)) {
    timelineViewScrollbar.releasePointerCapture(drag.pointerId);
  }
  setTimelineView(drag.startViewStart, drag.startViewEnd, drag.startManual);
  return true;
}

timelineViewScrollbar.addEventListener('pointerdown', event => {
  if (event.button !== 0 || editor.playing || timelineKeyDrag || timelineBoxDrag || timelinePanDrag) return;
  const rect = timelineViewScrollbar.getBoundingClientRect();
  if (rect.width <= 0) return;

  const target = event.target as Element;
  const thumb = target.closest('#timeline-view-thumb');
  if (!thumb) {
    const ratio = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const clickedFrame = editor.frameStart + ratio * (editor.frameEnd - editor.frameStart);
    const span = timelineViewEnd - timelineViewStart;
    const pageDelta = span * 0.8;
    if (clickedFrame < timelineViewStart) {
      setTimelineView(timelineViewStart - pageDelta, timelineViewEnd - pageDelta, true);
    } else if (clickedFrame > timelineViewEnd) {
      setTimelineView(timelineViewStart + pageDelta, timelineViewEnd + pageDelta, true);
    }
    event.preventDefault();
    return;
  }

  const handle = target.closest<HTMLElement>('[data-timeline-view-handle]');
  const kind: TimelineScrollbarDrag['kind'] =
    handle?.dataset.timelineViewHandle === 'start'
      ? 'start'
      : handle?.dataset.timelineViewHandle === 'end'
        ? 'end'
        : 'pan';

  timelineScrollbarDrag = {
    pointerId: event.pointerId,
    kind,
    startClientX: event.clientX,
    startViewStart: timelineViewStart,
    startViewEnd: timelineViewEnd,
    startManual: timelineViewManual,
  };
  timelineViewScrollbar.classList.add(kind === 'pan' ? 'dragging' : 'resizing');
  timelineViewScrollbar.setPointerCapture(event.pointerId);
  timelineViewScrollbar.focus({ preventScroll: true });
  event.preventDefault();
});

timelineViewScrollbar.addEventListener('pointermove', event => {
  const drag = timelineScrollbarDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const rect = timelineViewScrollbar.getBoundingClientRect();
  if (rect.width <= 0) return;

  const sceneSpan = editor.frameEnd - editor.frameStart;
  const frameDelta = (event.clientX - drag.startClientX) / rect.width * sceneSpan;
  const minimumSpan = Math.min(2, sceneSpan);

  if (drag.kind === 'pan') {
    setTimelineView(
      drag.startViewStart + frameDelta,
      drag.startViewEnd + frameDelta,
      true,
    );
  } else if (drag.kind === 'start') {
    const nextStart = THREE.MathUtils.clamp(
      drag.startViewStart + frameDelta,
      editor.frameStart,
      drag.startViewEnd - minimumSpan,
    );
    setTimelineView(nextStart, drag.startViewEnd, true);
  } else {
    const nextEnd = THREE.MathUtils.clamp(
      drag.startViewEnd + frameDelta,
      drag.startViewStart + minimumSpan,
      editor.frameEnd,
    );
    setTimelineView(drag.startViewStart, nextEnd, true);
  }
  event.preventDefault();
});

function finishTimelineScrollbarDrag(event: PointerEvent) {
  const drag = timelineScrollbarDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  timelineScrollbarDrag = null;
  timelineViewScrollbar.classList.remove('dragging', 'resizing');
  if (timelineViewScrollbar.hasPointerCapture(event.pointerId)) {
    timelineViewScrollbar.releasePointerCapture(event.pointerId);
  }
  if (event.type === 'pointercancel') {
    setTimelineView(drag.startViewStart, drag.startViewEnd, drag.startManual);
  }
}
timelineViewScrollbar.addEventListener('pointerup', finishTimelineScrollbarDrag);
timelineViewScrollbar.addEventListener('pointercancel', finishTimelineScrollbarDrag);

timelineViewScrollbar.addEventListener('keydown', event => {
  if (timelineScrollbarDrag || editor.playing) return;
  const span = timelineViewEnd - timelineViewStart;
  const step = Math.max(1, span * 0.1);
  const page = span * 0.8;
  if (event.key === 'ArrowLeft') {
    setTimelineView(timelineViewStart - step, timelineViewEnd - step, true);
    event.preventDefault();
  } else if (event.key === 'ArrowRight') {
    setTimelineView(timelineViewStart + step, timelineViewEnd + step, true);
    event.preventDefault();
  } else if (event.key === 'PageUp') {
    setTimelineView(timelineViewStart - page, timelineViewEnd - page, true);
    event.preventDefault();
  } else if (event.key === 'PageDown') {
    setTimelineView(timelineViewStart + page, timelineViewEnd + page, true);
    event.preventDefault();
  } else if (event.key === 'Home') {
    if (frameTimelineSceneRange()) event.preventDefault();
  }
});

timelineMarkers.addEventListener('pointerdown', event => {
  const marker = (event.target as Element).closest<HTMLButtonElement>('.key-marker');
  if (!marker || event.button !== 0 || editor.editMode || editor.playing) return;
  const sourceFrame = Number(marker.dataset.frame);
  if (!Number.isInteger(sourceFrame)) return;

  event.preventDefault();
  event.stopPropagation();

  if (event.shiftKey) {
    if (timelineSelectedFrames.has(sourceFrame)) timelineSelectedFrames.delete(sourceFrame);
    else timelineSelectedFrames.add(sourceFrame);
    editor.scrub(sourceFrame);
    timelineState = '';
    updateTimeline();
    return;
  }

  if (!timelineSelectedFrames.has(sourceFrame)) timelineSelectedFrames = new Set([sourceFrame]);
  const sourceFrames = [...timelineSelectedFrames].sort((a, b) => a - b);
  const selectedMarkers = sourceFrames
    .map(frame => ({
      frame,
      marker: timelineMarkers.querySelector<HTMLButtonElement>(`.key-marker[data-frame="${frame}"]`),
    }))
    .filter((item): item is { marker: HTMLButtonElement; frame: number } => item.marker !== null);

  const copy = event.altKey;
  const ghostMarkers = copy
    ? selectedMarkers.map(item => {
        const ghost = item.marker.cloneNode(true) as HTMLButtonElement;
        ghost.classList.remove('selected');
        ghost.classList.add('copy-ghost', 'dragging');
        ghost.setAttribute('aria-label', `Animation key copy preview at frame ${item.frame}`);
        ghost.title = `Copy animation key from frame ${item.frame}`;
        timelineMarkers.append(ghost);
        return { marker: ghost, frame: item.frame };
      })
    : [];

  timelineKeyDrag = {
    anchorMarker: marker,
    pointerId: event.pointerId,
    anchorFrame: sourceFrame,
    targetFrame: sourceFrame,
    sourceFrames,
    markers: selectedMarkers,
    copy,
    ghostMarkers,
  };
  if (!copy) for (const item of selectedMarkers) item.marker.classList.add('dragging', 'selected');
  marker.setPointerCapture(event.pointerId);
  editor.scrub(sourceFrame);
});

timelineMarkers.addEventListener('pointermove', event => {
  const drag = timelineKeyDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();

  const rawTarget = timelineFrameAt(event.clientX);
  const minDelta = editor.frameStart - drag.sourceFrames[0];
  const maxDelta = editor.frameEnd - drag.sourceFrames[drag.sourceFrames.length - 1];
  const frameDelta = THREE.MathUtils.clamp(rawTarget - drag.anchorFrame, minDelta, maxDelta);
  const targetFrame = drag.anchorFrame + frameDelta;
  drag.targetFrame = targetFrame;

  const previewMarkers = drag.copy ? drag.ghostMarkers : drag.markers;
  for (const item of previewMarkers) {
    const previewFrame = item.frame + frameDelta;
    item.marker.style.left = `${timelinePercent(previewFrame)}%`;
    item.marker.dataset.frame = String(previewFrame);
    item.marker.setAttribute('aria-label', drag.copy
      ? `Animation key copy preview at frame ${previewFrame}`
      : `Animation key preview at frame ${previewFrame}`);
    item.marker.title = drag.copy
      ? `Copy animation key to frame ${previewFrame}`
      : `Move animation key to frame ${previewFrame}`;
  }
  editor.scrub(targetFrame);
});

function finishTimelineKeyDrag(event: PointerEvent) {
  const drag = timelineKeyDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  timelineKeyDrag = null;
  if (!drag.copy) for (const item of drag.markers) item.marker.classList.remove('dragging');
  if (drag.anchorMarker.hasPointerCapture(event.pointerId)) drag.anchorMarker.releasePointerCapture(event.pointerId);

  if (event.type === 'pointercancel') {
    if (drag.copy) clearTimelineCopyGhosts(drag);
    else for (const item of drag.markers) restoreTimelineMarker(item.marker, item.frame);
    editor.scrub(drag.anchorFrame);
    setTimelineMarkerSelection();
    return;
  }

  const frameDelta = drag.targetFrame - drag.anchorFrame;
  if (frameDelta === 0) {
    if (drag.copy) clearTimelineCopyGhosts(drag);
    else for (const item of drag.markers) restoreTimelineMarker(item.marker, item.frame);
    editor.scrub(drag.anchorFrame);
    setTimelineMarkerSelection();
    return;
  }

  try {
    const graphSelectionBefore = animationGraph.selectedKeyFrames;
    const edited = drag.copy
      ? editor.duplicateTimelineKeys(drag.sourceFrames, frameDelta)
      : editor.moveTimelineKeys(drag.sourceFrames, frameDelta);
    if (!edited) {
      if (drag.copy) clearTimelineCopyGhosts(drag);
      else for (const item of drag.markers) restoreTimelineMarker(item.marker, item.frame);
      editor.scrub(drag.anchorFrame);
      setTimelineMarkerSelection();
      return;
    }

    const sourceSet = new Set(drag.sourceFrames);
    if (graphSelectionBefore.some(frame => sourceSet.has(frame))) {
      animationGraph.selectKeyFrames(graphSelectionBefore.map(frame => sourceSet.has(frame) ? frame + frameDelta : frame));
    }

    if (drag.copy) clearTimelineCopyGhosts(drag);
    timelineSelectedFrames = new Set(edited.frames);
    editor.scrub(drag.targetFrame);
    toast(`${drag.sourceFrames.length} Timeline key${drag.sourceFrames.length === 1 ? '' : 's'} ${drag.copy ? 'copied' : 'moved'} by ${frameDelta > 0 ? '+' : ''}${frameDelta} frame${Math.abs(frameDelta) === 1 ? '' : 's'}.`);
    timelineState = '';
    updateTimeline();
  } catch (error) {
    if (drag.copy) clearTimelineCopyGhosts(drag);
    else for (const item of drag.markers) restoreTimelineMarker(item.marker, item.frame);
    editor.scrub(drag.anchorFrame);
    toast((error as Error).message);
    timelineState = '';
    updateTimeline();
  }
}
timelineMarkers.addEventListener('pointerup', finishTimelineKeyDrag);
timelineMarkers.addEventListener('pointercancel', finishTimelineKeyDrag);

$<HTMLInputElement>('#scrubber').oninput = e => { if (editor.playing) editor.togglePlayback(); editor.scrub(Number((e.target as HTMLInputElement).value)); };
$<HTMLInputElement>('#current-frame').onchange = e => { const frame = Number((e.target as HTMLInputElement).value); if (Number.isFinite(frame)) editor.scrub(frame); };

function applyAnimationRange() {
  const start = Number($<HTMLInputElement>('#frame-start').value);
  const end = Number($<HTMLInputElement>('#frame-end').value);
  try {
    const changed = editor.setAnimationRange(start, end);
    if (changed) toast(`Animation range set to ${start}–${end}.`);
    timelineState = '';
    markerState = '';
    timelineRangeState = '';
    updateTimeline();
    return changed;
  } catch (error) {
    toast((error as Error).message);
    $<HTMLInputElement>('#frame-start').value = String(editor.frameStart);
    $<HTMLInputElement>('#frame-end').value = String(editor.frameEnd);
    timelineState = '';
    updateTimeline();
    return false;
  }
}
for (const id of ['frame-start','frame-end']) {
  const input = $<HTMLInputElement>(`#${id}`);
  input.addEventListener('change', applyAnimationRange);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyAnimationRange();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.blur();
      updateTimeline();
    }
  });
}

function applyPreviewRange() {
  const start = Number($<HTMLInputElement>('#preview-start').value);
  const end = Number($<HTMLInputElement>('#preview-end').value);
  try {
    const changed = editor.setPreviewRange(start, end);
    if (changed) toast(`Preview Range set to ${start}–${end}.`);
    timelineState = '';
    updateTimeline();
    return changed;
  } catch (error) {
    toast((error as Error).message);
    const preview = editor.previewRange ?? editor.animationRange;
    $<HTMLInputElement>('#preview-start').value = String(preview.start);
    $<HTMLInputElement>('#preview-end').value = String(preview.end);
    timelineState = '';
    updateTimeline();
    return false;
  }
}
for (const id of ['preview-start','preview-end']) {
  const input = $<HTMLInputElement>(`#${id}`);
  input.addEventListener('change', applyPreviewRange);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPreviewRange();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.blur();
      updateTimeline();
    }
  });
}
on('preview-toggle', () => {
  try {
    if (editor.previewRange) {
      editor.clearPreviewRange();
      toast('Preview Range cleared.');
    } else {
      applyPreviewRange();
    }
    timelineState = '';
    updateTimeline();
  } catch (error) {
    toast((error as Error).message);
    updateTimeline();
  }
});
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
      const tracks = animationTracks(o);
      if (!tracks.length) return;
      clips.push(new THREE.AnimationClip(`${o.name}Action`, -1, tracks));
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
  const key = e.key.toLowerCase();
  const dialogOpen = Boolean(document.querySelector('dialog[open]'));
  if ((key === 'delete' || key === 'backspace') && timelineSelectedFrames.size && !dialogOpen) {
    const target = e.target;
    const editingField = (target instanceof HTMLInputElement && target !== $<HTMLInputElement>('#scrubber'))
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement;
    if (!editingField) {
      e.preventDefault();
      removeSelectedTimelineKeys();
      return;
    }
  }
  if (key === 'escape' && !dialogOpen) {
    if (timelineKeyDrag || timelineBoxDrag || timelinePanDrag || timelineScrollbarDrag) {
      e.preventDefault();
      closeMenus();
      if (timelineKeyDrag) cancelTimelineKeyDrag();
      else if (timelineBoxDrag) cancelTimelineBoxDrag();
      else if (timelinePanDrag) cancelTimelinePanDrag();
      else cancelTimelineScrollbarDrag();
      return;
    }
    if (timelineSelectedFrames.size && e.target === $<HTMLInputElement>('#scrubber')) {
      e.preventDefault();
      timelineSelectedFrames.clear();
      timelineState = '';
      updateTimeline();
      return;
    }
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || dialogOpen) return;
  if (e.ctrlKey || e.metaKey) {
    if (['s','o','z','y','n'].includes(key)) e.preventDefault();
    if (key === 's') save(); else if (key === 'o') $('#project-input').click(); else if (key === 'z') e.shiftKey ? editor.redo() : editor.undo(); else if (key === 'y') editor.redo(); else if (key === 'n') $<HTMLDialogElement>('#new-dialog').showModal();
    return;
  }
  if (key === 'alt') editor.orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  if (key === 'q') tool('select'); if (key === 'g') tool('translate'); if (key === 'r') tool('rotate'); if (key === 's') tool('scale');
  if (key === 'f') editor.focus();
  if (key === 'd' && e.shiftKey) { e.preventDefault(); editor.duplicate(); }
  else if (key === 'd' && e.altKey) { e.preventDefault(); if (!editor.duplicateLinked()) toast('Linked duplicate requires an ordinary mesh without modifiers.'); }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); }
  if (key === 'tab') {
    e.preventDefault();
    if (e.shiftKey) snap();
    else if (editor.weightMode) { rigSystem.endWeightEdit(); tool('select'); }
    else if (editor.modelingBusy) editor.cancelModeling();
    else void editor.enterEditMode(!editor.editMode).then(ok => { if (!ok) toast('Select a mesh and apply its modifiers first.'); tool('translate'); }).catch(error => toast(error.message));
  }
  if (key === 'i') insertKey();
  if (key === ' ') { e.preventDefault(); if (editor.weightMode) toast('Finish Weight Mode before playback.'); else editor.togglePlayback(); }
  if (key === '1') $('#axis-z').click(); if (key === '3') $('#axis-x').click(); if (key === '7') $('#axis-y').click(); if (key === '5') editor.toggleProjection();
  if (key === '/') { e.preventDefault(); $('#object-search').focus(); }
  if (key === 'escape') {
    closeMenus();
    if (timelineSelectedFrames.size) {
      e.preventDefault();
      timelineSelectedFrames.clear();
      timelineState = '';
      updateTimeline();
    } else if (animationGraph.selectedKeyFrames.length) {
      e.preventDefault();
      animationGraph.selectKeyFrame(null);
      updateTimeline();
    } else if (editor.modelingBusy) editor.cancelModeling();
    else if (editor.snapTargetPending) editor.cancelVertexSnap();
    else if (editor.transform.dragging) editor.transform.reset();
    else editor.select(null);
  }
});
document.addEventListener('keyup', e => { if (e.key === 'Alt') editor.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE; });
window.addEventListener('blur', () => { editor.orbit.mouseButtons.LEFT = null as unknown as THREE.MOUSE; cancelTimelineKeyDrag(); cancelTimelineBoxDrag(); cancelTimelinePanDrag(); cancelTimelineScrollbarDrag(); if (editor.playing) editor.togglePlayback(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && editor.playing) editor.togglePlayback(); });
if (import.meta.env.DEV) Object.assign(window, { __forge: editor, __rig: rigSystem });
