import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { bevelEdges, bevelLogicalEdges, cutLogicalFace, deleteLogicalComponents, extrudeLogicalFace, insetLogicalFace, knifeLogicalFace, loopCut, loopCutLogicalEdge, editUV } from '../src/modeling/modeling';
import { buildTopology } from '../src/modeling/topology';
import { evaluateModifiers } from '../src/modeling/modifiers';

function topology(g: THREE.BufferGeometry) { return buildTopology(g.getAttribute('position').array, g.index?.array); }
function closed(g: THREE.BufferGeometry) {
  const uses = new Map<string, number[]>();
  for (const face of topology(g).faces) for (let i = 0; i < 3; i++) {
    const a = face[i], b = face[(i + 1) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    const list = uses.get(key) ?? []; list.push(a < b ? 1 : -1); uses.set(key, list);
  }
  for (const use of uses.values()) expect(use.sort()).toEqual([-1, 1]);
}
function sharpEdge(g: THREE.BufferGeometry) {
  const t = topology(g), p = g.getAttribute('position');
  return t.edges.findIndex(([a, b]) => {
    const x = new THREE.Vector3().fromBufferAttribute(p, t.vertices[a][0]), y = new THREE.Vector3().fromBufferAttribute(p, t.vertices[b][0]);
    return x.distanceTo(y) === 2;
  });
}

test('logical quad topology keeps renderer triangles but removes selectable diagonals', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const pt = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  expect(pt.faces).toHaveLength(2);
  expect(pt.edges).toHaveLength(5);
  expect(pt.polygons).toHaveLength(1);
  expect(pt.polygons[0]).toHaveLength(4);
  expect(pt.polygonTriangles).toEqual([[0, 1]]);
  expect(pt.triangleToPolygon).toEqual([0, 0]);
  expect(pt.polygonEdges).toHaveLength(4);
  expect(pt.polygonEdgeToEdge).toHaveLength(4);
  expect(new Set(pt.polygonEdgeToEdge).size).toBe(4);

  const box = new THREE.BoxGeometry(2, 2, 2, 1, 1, 1);
  const bt = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  expect(bt.faces).toHaveLength(12);
  expect(bt.polygons).toHaveLength(6);
  expect(bt.polygons.every(face => face.length === 4)).toBe(true);
  expect(bt.polygonTriangles.every(group => group.length === 2)).toBe(true);
  expect(bt.triangleToPolygon).toEqual([0,0,1,1,2,2,3,3,4,4,5,5]);
  expect(bt.polygonEdges).toHaveLength(12);
  expect(bt.edges.length).toBeGreaterThan(bt.polygonEdges.length);

  const generic = buildTopology(plane.getAttribute('position').array, plane.index?.array);
  expect(generic.polygons).toEqual(generic.faces);
  expect(generic.polygonEdges).toEqual(generic.edges);
  expect(generic.triangleToPolygon).toEqual([0, 1]);

  const explicit = buildTopology(plane.getAttribute('position').array, plane.index?.array, pt.polygonTriangles);
  expect(explicit.polygons).toEqual(pt.polygons);
  expect(explicit.polygonEdges).toEqual(pt.polygonEdges);
  expect(explicit.triangleToPolygon).toEqual(pt.triangleToPolygon);
});

test('logical Cube bevel ignores renderer diagonals and returns persistent polygon groups', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const position = box.getAttribute('position');
  const topEdges = input.polygonEdges
    .map((edge, id) => ({ edge, id }))
    .filter(({ edge: [a, b] }) => position.getY(input.vertices[a][0]) === 1 && position.getY(input.vertices[b][0]) === 1)
    .map(({ id }) => id);
  expect(topEdges).toHaveLength(4);

  const single = bevelLogicalEdges(box, [topEdges[0]], 0.1, input.polygonTriangles);
  closed(single.geometry);
  const singleTopology = buildTopology(single.geometry.getAttribute('position').array, single.geometry.index?.array, single.polygonTriangles);
  expect(singleTopology.polygons.length).toBeGreaterThan(6);
  expect(singleTopology.vertices.length).toBeGreaterThan(8);

  const bevel = bevelLogicalEdges(box, topEdges, 0.1, input.polygonTriangles);
  closed(bevel.geometry);
  const output = buildTopology(bevel.geometry.getAttribute('position').array, bevel.geometry.index?.array, bevel.polygonTriangles);
  expect(output.polygons.length).toBe(bevel.polygonTriangles.length);
  expect(output.polygons.length).toBeGreaterThan(6);
  expect(output.polygons.some(polygon => polygon.length > 3)).toBe(true);
  expect(output.polygonEdges.length).toBeLessThan(output.edges.length);
  expect(output.polygonEdges.every(edge => output.edges.some(candidate => candidate[0] === edge[0] && candidate[1] === edge[1]))).toBe(true);
  // Renderer triangulation may add diagonal edges, but it must never add
  // centroid/interior geometry vertices. Every unique render vertex is a
  // logical polygon boundary vertex.
  expect(new Set(output.polygons.flat()).size).toBe(output.vertices.length);
});

test('logical Cube face extrudes as a cap plus side quads without renderer topology leaking into modeling', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const position = box.getAttribute('position');
  const top = input.polygons.findIndex(polygon => polygon.every(vertex => position.getY(input.vertices[vertex][0]) === 1));
  expect(top).toBeGreaterThanOrEqual(0);

  const extrusion = extrudeLogicalFace(box, top, 0.5, input.polygonTriangles);
  expect(JSON.stringify(box.toJSON())).toBe(before);
  closed(extrusion.geometry);

  const output = buildTopology(
    extrusion.geometry.getAttribute('position').array,
    extrusion.geometry.index?.array,
    extrusion.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(10);
  expect(output.polygons.every(polygon => polygon.length === 4)).toBe(true);
  expect(output.vertices).toHaveLength(12);
  expect(output.faces).toHaveLength(20);
  expect(output.polygonEdges).toHaveLength(20);
  expect(new Set(output.polygons.flat()).size).toBe(output.vertices.length);

  const outPosition = extrusion.geometry.getAttribute('position');
  expect(output.polygons[top].every(vertex => outPosition.getY(output.vertices[vertex][0]) === 1.5)).toBe(true);

  const repeated = extrudeLogicalFace(extrusion.geometry, top, 0.25, extrusion.polygonTriangles);
  const repeatedTopology = buildTopology(
    repeated.geometry.getAttribute('position').array,
    repeated.geometry.index?.array,
    repeated.polygonTriangles,
  );
  const repeatedPosition = repeated.geometry.getAttribute('position');
  expect(repeatedTopology.polygons).toHaveLength(14);
  expect(repeatedTopology.vertices).toHaveLength(16);
  expect(repeatedTopology.faces).toHaveLength(28);
  expect(repeatedTopology.polygons[top].every(vertex => repeatedPosition.getY(repeatedTopology.vertices[vertex][0]) === 1.75)).toBe(true);
});

test('Cut Face splits one logical Cube quad across two non-adjacent boundary vertices', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const boundary = input.polygons[0];
  const cutVertices: [number, number] = [boundary[0], boundary[2]];

  const cut = cutLogicalFace(box, 0, cutVertices, input.polygonTriangles);
  expect(JSON.stringify(box.toJSON())).toBe(before);
  closed(cut.geometry);

  const output = buildTopology(
    cut.geometry.getAttribute('position').array,
    cut.geometry.index?.array,
    cut.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(7);
  expect(output.polygons.map(polygon => polygon.length).sort((a, b) => a - b)).toEqual([3, 3, 4, 4, 4, 4, 4]);
  expect(output.faces).toHaveLength(12);
  expect(output.logicalVertices).toHaveLength(8);
  expect(output.polygonEdges).toHaveLength(13);

  const position = cut.geometry.getAttribute('position');
  const point = (vertex: number) => {
    const index = output.vertices[vertex][0];
    return [position.getX(index), position.getY(index), position.getZ(index)].join(',');
  };
  const sourcePosition = box.getAttribute('position');
  const sourcePoint = (vertex: number) => {
    const index = input.vertices[vertex][0];
    return [sourcePosition.getX(index), sourcePosition.getY(index), sourcePosition.getZ(index)].join(',');
  };
  const endpoints = new Set(cutVertices.map(sourcePoint));
  expect(output.polygonEdges.some(([a, b]) => endpoints.has(point(a)) && endpoints.has(point(b)))).toBe(true);
});

test('Cut Face splits an n-gon into arbitrary Triangle / Quad results without forcing quads', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -2,  0, 0,
    -1,  2, 0,
     1,  2, 0,
     2,  0, 0,
     0, -2, 0,
  ], 3));
  geometry.setIndex([0,1,2, 0,2,3, 0,3,4]);
  const input = buildTopology(geometry.getAttribute('position').array, geometry.index!.array, [[0,1,2]]);
  expect(input.polygons).toEqual([[0,1,2,3,4]]);

  const cut = cutLogicalFace(geometry, 0, [0,2], input.polygonTriangles);
  const output = buildTopology(
    cut.geometry.getAttribute('position').array,
    cut.geometry.index?.array,
    cut.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(2);
  expect(output.polygons.map(polygon => polygon.length).sort((a, b) => a - b)).toEqual([3,4]);
  expect(output.faces).toHaveLength(3);
  expect(output.polygonEdges).toHaveLength(6);

  expect(() => cutLogicalFace(geometry, 0, [0,1], input.polygonTriangles)).toThrow(/already share/);
});

test('Knife inserts shared edge vertices and keeps Cube topology watertight', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const face = 0;
  const boundary = input.polygons[face];
  const edgeId = (a: number, b: number) => input.polygonEdges.findIndex(([x, y]) =>
    (x === a && y === b) || (x === b && y === a)
  );
  const firstEdge = edgeId(boundary[0], boundary[1]);
  const secondEdge = edgeId(boundary[2], boundary[3]);
  expect(firstEdge).toBeGreaterThanOrEqual(0);
  expect(secondEdge).toBeGreaterThanOrEqual(0);

  const cut = knifeLogicalFace(
    box,
    face,
    [{ edge: firstEdge, t: 0.5 }, { edge: secondEdge, t: 0.5 }],
    input.polygonTriangles,
  );
  expect(JSON.stringify(box.toJSON())).toBe(before);
  closed(cut.geometry);

  const output = buildTopology(
    cut.geometry.getAttribute('position').array,
    cut.geometry.index?.array,
    cut.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(7);
  expect(output.polygons.map(polygon => polygon.length).sort((a, b) => a - b)).toEqual([4,4,4,4,4,5,5]);
  expect(output.logicalVertices).toHaveLength(10);
  expect(output.polygonEdges).toHaveLength(15);
  expect(output.faces).toHaveLength(16);
  expect(cut.geometry.getAttribute('uv').count).toBe(cut.geometry.getAttribute('position').count);

  const sourcePosition = box.getAttribute('position');
  const midpoint = ([a, b]: [number, number]) => {
    const first = new THREE.Vector3().fromBufferAttribute(sourcePosition, input.vertices[a][0]);
    const second = new THREE.Vector3().fromBufferAttribute(sourcePosition, input.vertices[b][0]);
    return first.lerp(second, 0.5);
  };
  const expectedPoints = [
    midpoint(input.polygonEdges[firstEdge]),
    midpoint(input.polygonEdges[secondEdge]),
  ];
  const resultPosition = cut.geometry.getAttribute('position');
  for (const expected of expectedPoints) {
    const vertex = output.vertices.findIndex(copies =>
      new THREE.Vector3().fromBufferAttribute(resultPosition, copies[0]).distanceToSquared(expected) < 1e-12
    );
    expect(vertex).toBeGreaterThanOrEqual(0);
    expect(output.polygons.filter(polygon => polygon.includes(vertex)).length).toBe(3);
  }
});

test('Knife rejects two points that would create a two-point face', () => {
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  const input = buildTopology(plane.getAttribute('position').array, plane.index?.array, true);
  const edge = input.polygonEdges[0];
  const edgeId = input.polygonEdges.findIndex(candidate => candidate[0] === edge[0] && candidate[1] === edge[1]);
  expect(() => knifeLogicalFace(
    plane,
    0,
    [{ edge: edgeId, t: 0.25 }, { edge: edgeId, t: 0.75 }],
    input.polygonTriangles,
  )).toThrow(/fewer than three/);
});

test('logical Cube inset keeps polygon topology and selects an inner quad representation', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const inset = insetLogicalFace(box, 0, 0.1, input.polygonTriangles);
  expect(JSON.stringify(box.toJSON())).toBe(before);
  closed(inset.geometry);

  const output = buildTopology(
    inset.geometry.getAttribute('position').array,
    inset.geometry.index?.array,
    inset.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(10);
  expect(output.polygons.every(polygon => polygon.length === 4)).toBe(true);
  expect(output.vertices).toHaveLength(12);
  expect(output.faces).toHaveLength(20);
  expect(output.polygonEdges).toHaveLength(20);
  expect(new Set(output.polygons.flat()).size).toBe(output.vertices.length);

  const position = inset.geometry.getAttribute('position');
  const outer = input.polygons[0].map(vertex => {
    const index = input.vertices[vertex][0];
    return new THREE.Vector3(
      box.getAttribute('position').getX(index),
      box.getAttribute('position').getY(index),
      box.getAttribute('position').getZ(index),
    );
  });
  const inner = output.polygons[0].map(vertex => {
    const index = output.vertices[vertex][0];
    return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
  });
  expect(inner.every(point => outer.some(candidate => candidate.distanceTo(point) > 0.05))).toBe(true);
});

test('logical Cube loop cut follows opposite quad edges without renderer-triangle pairing', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const before = JSON.stringify(box.toJSON());
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);
  const cut = loopCutLogicalEdge(box, 0, input.polygonTriangles);
  expect(JSON.stringify(box.toJSON())).toBe(before);
  closed(cut.geometry);

  const output = buildTopology(
    cut.geometry.getAttribute('position').array,
    cut.geometry.index?.array,
    cut.polygonTriangles,
  );
  expect(output.polygons).toHaveLength(10);
  expect(output.polygons.every(polygon => polygon.length === 4)).toBe(true);
  expect(output.vertices).toHaveLength(12);
  expect(output.faces).toHaveLength(20);
  expect(output.polygonEdges).toHaveLength(20);
  expect(new Set(output.polygons.flat()).size).toBe(output.vertices.length);
  expect(cut.geometry.boundingBox!.min.toArray()).toEqual([-1, -1, -1]);
  expect(cut.geometry.boundingBox!.max.toArray()).toEqual([1, 1, 1]);
});

test('Delete Vertex removes the point from affected face boundaries and retessellates those faces', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1,  1, 0, // A
     1,  1, 0, // B
     1,  0, 0, // C - selected boundary point
     1, -1, 0, // D
    -1, -1, 0, // E
  ], 3));
  geometry.setIndex([0,1,2, 0,2,4, 2,3,4]);
  const input = buildTopology(geometry.getAttribute('position').array, geometry.index!.array, [[0,1,2]]);
  expect(input.polygons).toEqual([[0,1,2,3,4]]);

  const result = deleteLogicalComponents(geometry, 'vertex', [2], input.polygonTriangles);
  const output = buildTopology(result.geometry.getAttribute('position').array, result.geometry.index?.array, result.polygonTriangles);
  expect(output.polygons).toHaveLength(1);
  expect(output.polygons[0]).toHaveLength(4);
  expect(output.logicalVertices).toHaveLength(4);
  expect(output.faces).toHaveLength(2);

  const positions = result.geometry.getAttribute('position');
  const hasDeletedPoint = output.vertices.some(copies => {
    const index = copies[0];
    return positions.getX(index) === 1 && positions.getY(index) === 0 && positions.getZ(index) === 0;
  });
  expect(hasDeletedPoint).toBe(false);
});

test('logical component deletion rebuilds only the affected Cube surface topology', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const input = buildTopology(box.getAttribute('position').array, box.index?.array, true);

  const faceDelete = deleteLogicalComponents(box, 'face', [0], input.polygonTriangles);
  const faceTopology = buildTopology(faceDelete.geometry.getAttribute('position').array, faceDelete.geometry.index?.array, faceDelete.polygonTriangles);
  expect(faceTopology.polygons).toHaveLength(5);
  expect(faceTopology.polygons.every(polygon => polygon.length === 4)).toBe(true);
  expect(faceTopology.faces).toHaveLength(10);
  expect(faceTopology.logicalVertices).toHaveLength(8);

  const dissolvedEdge = input.polygonEdges[0];
  const boxPosition = box.getAttribute('position');
  const dissolvedPoints = dissolvedEdge.map(vertex =>
    new THREE.Vector3().fromBufferAttribute(boxPosition, input.vertices[vertex][0])
  );
  const edgeDelete = deleteLogicalComponents(box, 'edge', [0], input.polygonTriangles);
  closed(edgeDelete.geometry);
  const edgeTopology = buildTopology(edgeDelete.geometry.getAttribute('position').array, edgeDelete.geometry.index?.array, edgeDelete.polygonTriangles);
  expect(edgeTopology.polygons).toHaveLength(5);
  expect(edgeTopology.polygons.map(polygon => polygon.length).sort((a,b) => a-b)).toEqual([4,4,4,4,6]);
  expect(edgeTopology.faces).toHaveLength(12);
  expect(edgeTopology.logicalVertices).toHaveLength(8);
  expect(edgeTopology.polygonEdges).toHaveLength(11);
  const edgePositions = edgeDelete.geometry.getAttribute('position');
  const matchesPoint = (vertex: number, point: THREE.Vector3) => {
    const index = edgeTopology.vertices[vertex][0];
    return new THREE.Vector3().fromBufferAttribute(edgePositions, index).distanceToSquared(point) < 1e-12;
  };
  expect(edgeTopology.edges.some(([a,b]) =>
    (matchesPoint(a, dissolvedPoints[0]) && matchesPoint(b, dissolvedPoints[1])) ||
    (matchesPoint(a, dissolvedPoints[1]) && matchesPoint(b, dissolvedPoints[0]))
  )).toBe(false);

  const removedVertex = input.logicalVertices[0];
  const position = box.getAttribute('position');
  const removedPoint = new THREE.Vector3().fromBufferAttribute(position, input.vertices[removedVertex][0]);
  const vertexDelete = deleteLogicalComponents(box, 'vertex', [removedVertex], input.polygonTriangles);
  const vertexTopology = buildTopology(vertexDelete.geometry.getAttribute('position').array, vertexDelete.geometry.index?.array, vertexDelete.polygonTriangles);
  expect(vertexTopology.polygons).toHaveLength(6);
  expect(vertexTopology.polygons.map(polygon => polygon.length).sort((a,b) => a-b)).toEqual([3,3,3,4,4,4]);
  expect(vertexTopology.faces).toHaveLength(9);
  expect(vertexTopology.logicalVertices).toHaveLength(7);
  expect(vertexTopology.polygonEdges).toHaveLength(12);
  const resultPositions = vertexDelete.geometry.getAttribute('position');
  expect(vertexTopology.vertices.some(copies => {
    const index = copies[0];
    return new THREE.Vector3().fromBufferAttribute(resultPositions, index).distanceToSquared(removedPoint) < 1e-12;
  })).toBe(false);

  expect(() => deleteLogicalComponents(box, 'face', [0,1,2,3,4,5], input.polygonTriangles)).toThrow(/entire mesh/);
});

test('adjacent and all-edge bevels remain closed; planar grid cuts reach both boundaries', () => {
  const box = new THREE.BoxGeometry(2, 2, 2), t = topology(box), p = box.getAttribute('position');
  const edges = t.edges.map((edge, i) => ({ edge, i })).filter(({edge:[a,b]}) => new THREE.Vector3().fromBufferAttribute(p,t.vertices[a][0]).distanceTo(new THREE.Vector3().fromBufferAttribute(p,t.vertices[b][0])) === 2).map(({i})=>i);
  closed(bevelEdges(box, edges.slice(0,3), 0.1)); closed(bevelEdges(box, edges, 0.1));
  const grid = new THREE.PlaneGeometry(4,4,4,4), gt=topology(grid), gp=grid.getAttribute('position');
  const edge=gt.edges.findIndex(([a,b])=>gp.getY(gt.vertices[a][0])===2 && gp.getY(gt.vertices[b][0])===2);
  const cut=loopCut(grid,edge);
  const out=topology(cut), positions=cut.getAttribute('position');
  expect(out.vertices.filter(copies=>positions.getX(copies[0])===-1.5).length).toBeGreaterThanOrEqual(5);
  expect(cut.boundingBox!.min.toArray()).toEqual([-2,-2,0]);
});
for (const expanded of [false, true]) test(`convex bevel and loop cut keep closed oriented surfaces (${expanded})`, () => {
  const box = new THREE.BoxGeometry(2, 2, 2), source = expanded ? box.toNonIndexed() : box;
  const before = JSON.stringify(source.toJSON()), edge = sharpEdge(source);
  const bevel = bevelEdges(source, [edge], 0.2), loop = loopCut(source, edge);
  closed(bevel); closed(loop);
  expect(topology(bevel).faces.length).toBeGreaterThan(12);
  expect(topology(loop).faces.length).toBeGreaterThan(12);
  expect(bevel.getAttribute('uv').count).toBe(bevel.getAttribute('position').count);
  expect(new Set(bevel.groups.map(g => g.materialIndex)).size).toBe(6);
  expect(JSON.stringify(source.toJSON())).toBe(before);
  // A loop cut retains the original cube bounds and volume.
  expect(loop.boundingBox!.min.toArray()).toEqual([-1, -1, -1]);
  expect(loop.boundingBox!.max.toArray()).toEqual([1, 1, 1]);
  let volume = 0; const p = loop.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) volume += new THREE.Vector3().fromBufferAttribute(p, i).dot(new THREE.Vector3().fromBufferAttribute(p, i + 1).cross(new THREE.Vector3().fromBufferAttribute(p, i + 2))) / 6;
  expect(volume).toBeCloseTo(8, 5);
});

test('invalid modeling requests preserve input', () => {
  const box = new THREE.BoxGeometry(2, 2, 2), before = JSON.stringify(box.toJSON()), edge = sharpEdge(box);
  for (const width of [NaN, 0, 100, -1]) expect(() => bevelEdges(box, [edge], width)).toThrow();
  expect(() => bevelEdges(new THREE.PlaneGeometry(2, 2), [0], 0.1)).toThrow(/closed/);
  expect(() => loopCut(box, -1)).toThrow();
  const t = topology(box), diagonal = t.edges.findIndex(([a, b]) => {
    const p = box.getAttribute('position'); return new THREE.Vector3().fromBufferAttribute(p, t.vertices[a][0]).distanceTo(new THREE.Vector3().fromBufferAttribute(p, t.vertices[b][0])) > 2;
  });
  expect(() => loopCut(box, diagonal)).toThrow(/boundary/);
  expect(() => bevelEdges(box, [diagonal], 0.1)).toThrow(/diagonal/);
  expect(() => editUV(box, [0], 'transform', [NaN, 0, 0, 1, 1])).toThrow();
  expect(JSON.stringify(box.toJSON())).toBe(before);
});

test('UV edits split selected seams without moving or changing unselected corners', () => {
  const source = new THREE.PlaneGeometry(2, 2), initial = source.toNonIndexed();
  const result = editUV(source, [0], 'transform', [0.25, -0.5, 0, 1, 1]);
  expect(Array.from(result.getAttribute('position').array)).toEqual(Array.from(initial.getAttribute('position').array));
  for (let i = 0; i < 6; i++) {
    expect(result.getAttribute('uv').getX(i)).toBeCloseTo(initial.getAttribute('uv').getX(i) + (i < 3 ? 0.25 : 0));
    expect(result.getAttribute('uv').getY(i)).toBeCloseTo(initial.getAttribute('uv').getY(i) - (i < 3 ? 0.5 : 0));
  }
  expect(topology(result).vertices).toHaveLength(4);
});

test('modifier stack preserves source and supports ordered disable/removal', () => {
  const source = new THREE.BoxGeometry(2, 2, 2); source.translate(3, 0, 0);
  const before = JSON.stringify(source.toJSON());
  const mirrored = evaluateModifiers(source, [{ kind: 'mirror', amount: 0.5, enabled: true }]);
  expect(topology(mirrored).faces).toHaveLength(24); closed(mirrored);
  const disabled = evaluateModifiers(source, [{ kind: 'mirror', amount: 0.5, enabled: false }]);
  expect(topology(disabled).faces).toHaveLength(12);
  const subdivided = evaluateModifiers(source, [{ kind: 'subdivide', amount: 0.5, enabled: true }]);
  expect(topology(subdivided).faces).toHaveLength(48); closed(subdivided);
  expect(() => evaluateModifiers(source, [{ kind: 'smooth', amount: NaN, enabled: true }])).toThrow();
  expect(JSON.stringify(source.toJSON())).toBe(before);
});

test('worker mesh editing, UV and modifiers round trip history and projects', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => (window as any).__forge?.selected);
  await page.locator('#mode').selectOption('edit');
  const before = await page.evaluate(() => {
    const e = (window as any).__forge, t = e.meshTopology, p = e.selected.geometry.attributes.position;
    e.setComponentMode('edge');
    const edge = t.polygonEdges.findIndex(([a, b]: number[]) => {
      const i = t.vertices[a][0], j = t.vertices[b][0]; return Math.hypot(p.getX(i)-p.getX(j),p.getY(i)-p.getY(j),p.getZ(i)-p.getZ(j)) === 2;
    }); e.selectComponent(edge); return e.snapshot();
  });
  await page.evaluate(() => (window as any).__forgeCommands.bevelEdges()); await expect(page.locator('#toast')).toContainText('complete');
  const restored = await page.evaluate(() => {
    const e = (window as any).__forge, after = e.snapshot(); e.undo(); const undo = e.snapshot(); e.redo(); const redo = e.snapshot(); e.load(JSON.parse(after)); return { after, undo, redo, loaded:e.snapshot() };
  });
  expect(restored.undo).toBe(before); expect(restored.redo).toBe(restored.after); expect(restored.loaded).toBe(restored.after);
  await page.locator('#mode').selectOption('edit');
  await page.evaluate(() => { const e = (window as any).__forge; e.setComponentMode('face'); e.selectComponent(0); });
  await page.getByText('UV editor', { exact:true }).click();
  await page.locator('#uv-project').click(); await expect(page.locator('#toast')).toContainText('complete');
  await page.waitForFunction(() => !(window as any).__forge.modelingBusy);
  await page.evaluate(() => (window as any).__forge.focus());
  await page.locator('#uv-view').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/phase2-uv.png'});
  await page.locator('#mode').selectOption('object');
  await page.getByText('Modifiers', {exact:true}).click();
  await page.locator('#modifier-kind').selectOption('smooth');
  await page.locator('#modifier-add').click();
  await expect(page.getByLabel('Disable modifier 1')).toBeVisible();
  await page.locator('#modifier-list').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/phase2-modifiers.png'});
  const modifierSnapshot = await page.evaluate(() => { const e=(window as any).__forge, s=e.snapshot(); e.load(JSON.parse(s)); return {before:s,after:e.snapshot(),stack:e.selected.userData.modifierStack.items}; });
  expect(modifierSnapshot.after).toBe(modifierSnapshot.before); expect(modifierSnapshot.stack).toHaveLength(1);
  await page.getByLabel('Disable modifier 1').click(); await expect(page.getByLabel('Enable modifier 1')).toBeVisible();
  await page.locator('#modifier-apply').click(); await expect(page.getByLabel('Enable modifier 1')).toHaveCount(0);
});

test('multi-object transforms and worker cancellation are atomic', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(async () => {
    const e=(window as any).__forge, a=e.selected; e.duplicate(); const b=e.selected;
    e.select(a,true); const before=e.snapshot(), positions=[a.position.toArray(),b.position.toArray()];
    e.transformObjects('translate',[1,2,3]); const moved=[a.position.toArray(),b.position.toArray()];
    const after=e.snapshot(); e.undo(); const undo=e.snapshot(); e.redo(); const redo=e.snapshot();
    const pending=e.runModeling({kind:'subdivide',edges:[]},true); e.cancelModeling();
    let error=''; try { await pending; } catch(caught) {error=String(caught);}
    return {before,after,undo,redo,positions,moved,error,cancelled:e.snapshot()};
  });
  expect(result.undo).toBe(result.before); expect(result.redo).toBe(result.after); expect(result.cancelled).toBe(result.after); expect(result.error).toContain('cancelled');
  result.positions.forEach((p:number[],i:number)=>p.forEach((v,j)=>expect(result.moved[i][j]).toBe(v+j+1)));
});
