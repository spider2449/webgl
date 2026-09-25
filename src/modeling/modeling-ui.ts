import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Modifier, ModifierStack } from './modifiers';

export function mountModelingUI(editor: Editor, toast: (message: string) => void) {
  const anchor = document.querySelector('#mirror')!;
  anchor.insertAdjacentHTML('beforebegin', `
    <details class="modeling-section" open><summary>Mesh operations</summary>
      <label class="property-row">Bevel width<input id="bevel-width" aria-label="Bevel width" type="number" min="0.0001" step="0.05" value="0.1"></label>
      <button class="wide-button" id="bevel-edges">Bevel selected edges</button>
      <p class="field-help">Closed convex mesh, sharp edges, one flat segment. Width is measured along the adjacent faces.</p>
      <button class="wide-button" id="loop-cut">Cut quad loop</button>
      <p class="field-help">Select one boundary edge of a planar quad. Cuts the complete ring or open strip at its midpoint.</p>
      <button class="wide-button" id="cancel-modeling" disabled>Cancel operation</button>
      <p class="field-help" id="modeling-state" role="status">Ready</p>
    </details>
    <details class="modeling-section"><summary>UV editor</summary>
      <canvas id="uv-view" width="256" height="192" aria-label="Selected face UV layout"></canvas>
      <p class="field-help">Select logical faces in the viewport. The view expands them to renderer triangles and previews up to 2,000 triangles. Projection uses local units.</p>
      <label class="property-row">U offset<input id="uv-u" aria-label="UV U offset" type="number" step="0.1" value="0"></label>
      <label class="property-row">V offset<input id="uv-v" aria-label="UV V offset" type="number" step="0.1" value="0"></label>
      <label class="property-row">Rotation °<input id="uv-angle" aria-label="UV rotation" type="number" value="0"></label>
      <label class="property-row">U scale<input id="uv-su" aria-label="UV U scale" type="number" step="0.1" value="1"></label>
      <label class="property-row">V scale<input id="uv-sv" aria-label="UV V scale" type="number" step="0.1" value="1"></label>
      <button class="wide-button" id="uv-project">Project selected UVs</button>
      <button class="wide-button" id="uv-transform">Transform selected UVs</button>
    </details>
    <details class="modeling-section"><summary>Modifiers</summary>
      <p class="field-help">Ordered, non-destructive stack. Apply before component editing. Mirror duplicates across local X; use a half mesh away from the plane to avoid overlapping faces.</p>
      <label class="property-row">Type<select id="modifier-kind" aria-label="Modifier type"><option value="mirror">Mirror X</option><option value="subdivide">Subdivision</option><option value="smooth">Smooth</option></select></label>
      <label class="property-row">Smooth amount<input id="modifier-amount" aria-label="Smooth amount" type="number" min="0" max="1" step="0.1" value="0.5"></label>
      <button class="wide-button" id="modifier-add">Add modifier</button>
      <div id="modifier-list"></div><button class="wide-button" id="modifier-apply">Apply modifier stack</button>
    </details>
    <details class="modeling-section"><summary>Multiple objects</summary>
      <p class="field-help">Shift-click objects in the viewport or outliner. Rotate and uniformly scale around their shared center in world space.</p>
      <p class="field-help" id="object-selection-count"></p>
      <label class="property-row">Operation<select id="batch-kind" aria-label="Group transform"><option value="translate">Translate</option><option value="rotate">Rotate °</option><option value="scale">Uniform scale</option></select></label>
      <label class="property-row">X<input id="batch-x" aria-label="Group X" type="number" step="0.1" value="0"></label>
      <label class="property-row">Y<input id="batch-y" aria-label="Group Y" type="number" step="0.1" value="0"></label>
      <label class="property-row">Z<input id="batch-z" aria-label="Group Z" type="number" step="0.1" value="0"></label>
      <button class="wide-button" id="batch-transform">Transform selected objects</button>
      <button class="wide-button" id="batch-subdivide">Subdivide selected meshes</button>
    </details>`);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const value = (id: string) => Number(el<HTMLInputElement>(id).value);
  const action = (id: string, fn: () => unknown | Promise<unknown>) => el(id).onclick = async () => { try { await fn(); toast('Modeling operation complete.'); } catch (error) { toast((error as Error).message); } };
  const requireSelection = (mode: 'edge' | 'face') => {
    if (!editor.editMode || editor.componentMode !== mode || !editor.componentSelection.length) throw new Error(`Select ${mode === 'face' ? 'faces' : 'edges'} in Edit Mode first.`);
    if (!editor.meshTopology) throw new Error('Mesh topology is unavailable.');
    return editor.componentSelection;
  };
  const rendererEdges = () => {
    const selected = requireSelection('edge'), topology = editor.meshTopology!;
    return selected.map(id => {
      const edge = topology.polygonEdgeToEdge[id];
      if (edge === undefined) throw new Error('Selected logical edge has no renderer edge.');
      return edge;
    });
  };
  const rendererTriangles = () => {
    const selected = requireSelection('face'), topology = editor.meshTopology!;
    return selected.flatMap(id => {
      const triangles = topology.polygonTriangles[id];
      if (!triangles?.length) throw new Error('Selected logical face has no renderer triangles.');
      return triangles;
    });
  };
  action('bevel-edges', () => editor.runModeling({ kind: 'bevel', edges: rendererEdges(), width: value('bevel-width') }));
  action('loop-cut', () => { const logicalEdges = requireSelection('edge'); if (logicalEdges.length !== 1) throw new Error('Select exactly one quad boundary edge.'); return editor.runModeling({ kind: 'loop', edge: rendererEdges()[0] }); });
  for (const operation of ['project', 'transform'] as const) action(`uv-${operation}`, () => editor.runModeling({ kind: 'uv', faces: rendererTriangles(), operation, values: ['uv-u', 'uv-v', 'uv-angle', 'uv-su', 'uv-sv'].map(value) }));
  const stack = () => structuredClone((editor.selected?.userData.modifierStack as ModifierStack | undefined)?.items ?? []);
  action('modifier-add', () => editor.setModifiers([...stack(), { kind: el<HTMLSelectElement>('modifier-kind').value as Modifier['kind'], amount: value('modifier-amount'), enabled: true }]));
  action('modifier-apply', () => editor.applyModifiers());
  action('batch-transform', () => editor.transformObjects(el<HTMLSelectElement>('batch-kind').value as 'translate' | 'rotate' | 'scale', ['batch-x', 'batch-y', 'batch-z'].map(value)));
  el('batch-kind').onchange = () => ['batch-x', 'batch-y', 'batch-z'].forEach(id => { el<HTMLInputElement>(id).value = el<HTMLSelectElement>('batch-kind').value === 'scale' ? '1' : '0'; });
  action('batch-subdivide', () => editor.runModeling({ kind: 'subdivide', edges: [] }, true));
  el('cancel-modeling').onclick = () => editor.cancelModeling();
  const render = () => {
    el('modeling-state').textContent = editor.modelingBusy ? 'Calculating mesh changes…' : 'Ready';
    el<HTMLButtonElement>('cancel-modeling').disabled = !editor.modelingBusy;
    for (const id of ['bevel-edges','loop-cut','uv-project','uv-transform','modifier-add','modifier-apply','batch-transform','batch-subdivide','extrude-face','inset-face','extrude-region','subdivide-edge']) el<HTMLButtonElement>(id).disabled = editor.modelingBusy;
    el('object-selection-count').textContent = `${editor.selectedObjects.size} objects selected`;
    const list = el('modifier-list'); list.replaceChildren();
    stack().forEach((modifier, i) => {
      const row = document.createElement('div'); row.className = 'modifier-row';
      const label = document.createElement('span'); label.textContent = `${i + 1}. ${modifier.kind}`; row.append(label);
      if (modifier.kind === 'smooth') {
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '1'; input.step = '0.1'; input.value = String(modifier.amount); input.disabled = editor.modelingBusy;
        input.setAttribute('aria-label', `Smooth amount modifier ${i + 1}`);
        input.onchange = async () => { try { const items = stack(); items[i].amount = Number(input.value); await editor.setModifiers(items); } catch (error) { toast((error as Error).message); render(); } };
        row.append(input);
      }
      for (const [name, edit] of [
        [modifier.enabled ? 'Disable' : 'Enable', (items: Modifier[]) => { items[i].enabled = !items[i].enabled; }],
        ['Up', (items: Modifier[]) => { if (i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]]; }],
        ['Down', (items: Modifier[]) => { if (i + 1 < items.length) [items[i + 1], items[i]] = [items[i], items[i + 1]]; }],
        ['Remove', (items: Modifier[]) => { items.splice(i, 1); }],
      ] as const) {
        const button = document.createElement('button'); button.textContent = name; button.disabled = editor.modelingBusy;
        button.setAttribute('aria-label', `${name} modifier ${i + 1}`);
        button.onclick = async () => { try { const items = stack(); edit(items); await editor.setModifiers(items); } catch (error) { toast((error as Error).message); } };
        row.append(button);
      }
      list.append(row);
    });
    drawUV();
  };
  function drawUV() {
    const canvas = el<HTMLCanvasElement>('uv-view'), ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#202329'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!(editor.selected instanceof THREE.Mesh) || !editor.editMode || editor.componentMode !== 'face') return;
    const geometry = editor.selected.geometry, uv = geometry.getAttribute('uv'), topology = editor.meshTopology; if (!uv || !topology) return;
    const triangleIds = editor.componentSelection.flatMap(id => topology.polygonTriangles[id] ?? []).slice(0, 2000);
    const triangles = triangleIds.map(f => [0, 1, 2].map(j => { const i = geometry.index?.getX(f * 3 + j) ?? f * 3 + j; return [uv.getX(i), uv.getY(i)]; }));
    if (!triangles.length) return;
    const points = triangles.flat(), min = [0, 1].map(j => Math.min(...points.map(p => p[j]))), max = [0, 1].map(j => Math.max(...points.map(p => p[j])));
    const scale = Math.min(224 / Math.max(1e-6, max[0] - min[0]), 160 / Math.max(1e-6, max[1] - min[1]));
    ctx.strokeStyle = '#efbc7c'; ctx.fillStyle = '#d6ac7833';
    for (const triangle of triangles) { ctx.beginPath(); triangle.forEach((p, j) => { const x = 16 + (p[0] - min[0]) * scale, y = 176 - (p[1] - min[1]) * scale; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  editor.addEventListener('change', render); editor.addEventListener('mode', render); editor.addEventListener('modeling', render); editor.addEventListener('component-selection', drawUV); render();
}
