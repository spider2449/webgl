import * as THREE from 'three';
import { inspectGeometry } from './modeling';
import { subdivideEdges } from './subdivide';

export type Modifier = { kind: 'mirror' | 'subdivide' | 'smooth'; enabled: boolean; amount: number };
export type ModifierStack = { source: ReturnType<THREE.BufferGeometry['toJSON']>; items: Modifier[] };

export function validateModifiers(items: Modifier[]) {
  if (!Array.isArray(items) || items.length > 8 || items.some(m => !m || !['mirror', 'subdivide', 'smooth'].includes(m.kind) || typeof m.enabled !== 'boolean' || !Number.isFinite(m.amount) || m.amount < 0 || m.amount > 1)) throw new Error('Invalid modifier stack (maximum 8 modifiers).');
}
export function validateModifierStack(stack: ModifierStack) {
  if (!stack || !stack.source || stack.source.type !== 'BufferGeometry' || !stack.source.data?.attributes?.position) throw new Error('Invalid modifier source.');
  validateModifiers(stack.items);
  const source = new THREE.BufferGeometryLoader().parse(stack.source);
  try { inspectGeometry(source); } finally { source.dispose(); }
}
export function evaluateModifiers(source: THREE.BufferGeometry, items: Modifier[]) {
  validateModifiers(items);
  inspectGeometry(source);
  let geometry = source.clone();
  try {
    for (const modifier of items) {
      if (!modifier.enabled) continue;
      const { topology, read } = inspectGeometry(geometry);
      if (modifier.kind === 'subdivide') {
        const next = subdivideEdges(geometry, topology.edges.map(edge => edge.map(v => topology.vertices[v][0]) as [number, number]));
        geometry.dispose(); geometry = next;
      } else if (modifier.kind === 'smooth') {
        const neighbors = topology.vertices.map(() => new Set<number>());
        topology.edges.forEach(([a, b]) => { neighbors[a].add(b); neighbors[b].add(a); });
        const position = geometry.getAttribute('position');
        const points = topology.vertices.map((_, v) => {
          if (!neighbors[v].size) return read(v);
          const center = [...neighbors[v]].reduce((sum, n) => sum.add(read(n)), new THREE.Vector3()).divideScalar(neighbors[v].size);
          return read(v).lerp(center, modifier.amount);
        });
        points.forEach((p, v) => topology.vertices[v].forEach(i => position.setXYZ(i, p.x, p.y, p.z)));
      } else {
        const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        const next = new THREE.BufferGeometry(), count = expanded.getAttribute('position').count;
        if (count * 2 > 600_000) { expanded.dispose(); next.dispose(); throw new Error('Mirror exceeds the result vertex budget.'); }
        for (const [name, attribute] of Object.entries(expanded.attributes)) {
          if (name === 'normal') continue;
          const output = new THREE.Float32BufferAttribute(new Float32Array(count * 2 * attribute.itemSize), attribute.itemSize);
          for (let i = 0; i < count; i++) for (let j = 0; j < attribute.itemSize; j++) {
            output.setComponent(i, j, attribute.getComponent(i, j));
            const reversed = Math.floor(i / 3) * 3 + 2 - i % 3;
            output.setComponent(count + i, j, attribute.getComponent(reversed, j) * (name === 'position' && j === 0 ? -1 : 1));
          }
          next.setAttribute(name, output);
        }
        for (const group of expanded.groups) { next.addGroup(group.start, group.count, group.materialIndex); next.addGroup(count + group.start, group.count, group.materialIndex); }
        expanded.dispose(); geometry.dispose(); geometry = next;
      }
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) throw new Error('Modifier exceeds coordinate precision.');
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
    return geometry;
  } catch (error) { geometry.dispose(); throw error; }
}
