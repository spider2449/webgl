import * as THREE from 'three';

// Replace one triangle with an offset cap and three quad walls.
// Wall corners are split to preserve hard normals and existing attribute seams.
export function extrudeTriangle(source: THREE.BufferGeometry, face: number, distance: number): THREE.BufferGeometry {
  return replaceTriangle(source, face, distance, false);
}

export function insetTriangle(source: THREE.BufferGeometry, face: number, distance: number): THREE.BufferGeometry {
  return replaceTriangle(source, face, distance, true);
}

function replaceTriangle(source: THREE.BufferGeometry, face: number, distance: number, inset: boolean): THREE.BufferGeometry {
  if (!Number.isFinite(distance) || distance < 0.0001 || distance > 1000) throw new Error('Distance must be between 0.0001 and 1000 local units.');
  const position = source.getAttribute('position');
  const count = source.index?.count ?? position?.count ?? 0;
  if (!position || position.itemSize !== 3 || position.count > 100_000 || count % 3 !== 0 || !Number.isInteger(face) || face < 0 || face >= count / 3) throw new Error('Select a triangle on a mesh with at most 100,000 vertices.');
  if (Object.keys(source.morphAttributes).length || source.drawRange.start !== 0 || source.drawRange.count !== Infinity) throw new Error('Triangle editing requires a mesh without morph targets or a partial draw range.');
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color'].includes(name) || !(attribute instanceof THREE.BufferAttribute) || attribute.count !== position.count || attribute.itemSize < 1 || attribute.itemSize > 4) throw new Error(`Triangle editing does not support the ${name} attribute layout.`);
  }
  const indices = Array.from({ length: count }, (_, i) => source.index ? source.index.getX(i) : i);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= position.count)) throw new Error('Mesh contains invalid triangle indices.');
  const corners = indices.slice(face * 3, face * 3 + 3);
  const [a, b, c] = corners.map(i => new THREE.Vector3().fromBufferAttribute(position, i));
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-16) throw new Error('Cannot edit a degenerate triangle.');
  const area2 = normal.length();
  const lengths = [b.distanceTo(c), c.distanceTo(a), a.distanceTo(b)];
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  const weights = lengths.map(length => length / perimeter);
  const ratio = inset ? distance / (area2 / perimeter) : 0;
  if (inset && ratio >= 1) throw new Error('Inset distance must be smaller than the triangle inradius.');
  const center = new THREE.Vector3().addScaledVector(a, weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2]);
  const offset = normal.clone().normalize().multiplyScalar(distance);
  const move = (corner: THREE.Vector3) => inset ? corner.clone().lerp(center, ratio) : corner.clone().add(offset);
  const inner = [a, b, c].map(corner => move(corner)).map(p => p.set(Math.fround(p.x), Math.fround(p.y), Math.fround(p.z)));
  if (inset) {
    const outer = [a, b, c];
    const validTriangle = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) => y.clone().sub(x).cross(z.clone().sub(x)).dot(normal) > 0;
    if (!validTriangle(...inner as [THREE.Vector3, THREE.Vector3, THREE.Vector3]) || outer.some((p, i) => {
      const next = (i + 1) % 3;
      return !validTriangle(p, outer[next], inner[next]) || !validTriangle(p, inner[next], inner[i]);
    })) throw new Error('Inset distance collapses geometry at the mesh coordinate precision.');
  }
  for (const corner of [a, b, c]) {
    const moved = move(corner);
    moved.set(Math.fround(moved.x), Math.fround(moved.y), Math.fround(moved.z));
    if (![moved.x, moved.y, moved.z].every(Number.isFinite) || moved.distanceToSquared(corner) === 0) throw new Error('Distance is too small for the mesh coordinate precision.');
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
      if (copy.moved && inset) {
        const cornerValues = corners.map(read);
        for (let component = 0; component < attribute.itemSize; component++) {
          const centerValue = cornerValues.reduce((sum, value, corner) => sum + value[component] * weights[corner], 0);
          values[component] += (centerValue - values[component]) * ratio;
        }
      } else if (name === 'position' && copy.moved) { values[0] += offset.x; values[1] += offset.y; values[2] += offset.z; }
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
