import * as THREE from 'three';

// Replace one triangle with an offset cap and three quad walls.
// Wall corners are split to preserve hard normals and existing attribute seams.
export function extrudeTriangle(source: THREE.BufferGeometry, face: number, distance: number): THREE.BufferGeometry {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) throw new Error('Extrusion distance must be between 0.0001 and 1000 local units.');
  const position = source.getAttribute('position');
  const count = source.index?.count ?? position?.count ?? 0;
  if (!position || position.itemSize !== 3 || position.count > 100_000 || count % 3 !== 0 || !Number.isInteger(face) || face < 0 || face >= count / 3) throw new Error('Select a triangle on a mesh with at most 100,000 vertices.');
  if (Object.keys(source.morphAttributes).length || source.drawRange.start !== 0 || source.drawRange.count !== Infinity) throw new Error('Extrusion requires a mesh without morph targets or a partial draw range.');
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color'].includes(name) || !(attribute instanceof THREE.BufferAttribute) || attribute.count !== position.count || attribute.itemSize > 4) throw new Error(`Extrusion does not support the ${name} attribute layout.`);
  }
  const indices = Array.from({ length: count }, (_, i) => source.index ? source.index.getX(i) : i);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= position.count)) throw new Error('Mesh contains invalid triangle indices.');
  const corners = indices.slice(face * 3, face * 3 + 3);
  const [a, b, c] = corners.map(i => new THREE.Vector3().fromBufferAttribute(position, i));
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-16) throw new Error('Cannot extrude a degenerate triangle.');
  const offset = normal.normalize().multiplyScalar(distance);
  for (const corner of [a, b, c]) {
    const moved = corner.clone().add(offset);
    moved.set(Math.fround(moved.x), Math.fround(moved.y), Math.fround(moved.z));
    if (![moved.x, moved.y, moved.z].every(Number.isFinite) || moved.distanceToSquared(corner) === 0) throw new Error('Extrusion distance is too small for the mesh coordinate precision.');
  }
  const copies = corners.map(index => ({ index, moved: true }));
  const cap = position.count;
  indices.splice(face * 3, 3, cap, cap + 1, cap + 2);
  for (let edge = 0; edge < 3; edge++) {
    const start = position.count + copies.length;
    const first = corners[edge], second = corners[(edge + 1) % 3];
    copies.push({ index: first, moved: false }, { index: second, moved: false }, { index: second, moved: true }, { index: first, moved: true });
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === 'normal') continue;
    const output = new THREE.Float32BufferAttribute(new Float32Array((position.count + copies.length) * attribute.itemSize), attribute.itemSize);
    const read = (i: number) => [attribute.getX(i), attribute.itemSize > 1 ? attribute.getY(i) : 0, attribute.itemSize > 2 ? attribute.getZ(i) : 0, attribute.itemSize > 3 ? attribute.getW(i) : 0];
    for (let i = 0; i < output.count; i++) {
      const copy = i < position.count ? { index: i, moved: false } : copies[i - position.count];
      const values = read(copy.index);
      if (name === 'position' && copy.moved) { values[0] += offset.x; values[1] += offset.y; values[2] += offset.z; }
      for (let component = 0; component < attribute.itemSize; component++) output.array[i * attribute.itemSize + component] = values[component];
    }
    result.setAttribute(name, output);
  }
  result.setIndex(indices);
  for (const group of source.groups) result.addGroup(group.start, group.count, group.materialIndex);
  if (source.groups.length) {
    const material = source.groups.find(group => face * 3 >= group.start && face * 3 + 3 <= group.start + group.count)?.materialIndex ?? 0;
    result.addGroup(count, 18, material);
  }
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
