import * as THREE from 'three';
import { bevelLogicalEdges, cutLogicalFace, deleteLogicalComponents, extrudeLogicalFace, insetLogicalFace, loopCutLogicalEdge, editUV, inspectGeometry } from './modeling';
import { cutLogicalFaceBetweenEdges, cutLogicalFaceToEdge, cutLogicalFaceViaPath, cutLogicalFaceViaPoint } from './cut-edge-endpoint';
import { evaluateModifiers } from './modifiers';
import { extrudeRegion } from './extrude-region';
import { subdivideEdges } from './subdivide';
import type { ModelingOperation } from './modeling-worker-client';
import { buildTopology } from './topology';

self.onmessage = (event: MessageEvent<{ source: ReturnType<THREE.BufferGeometry['toJSON']>; operation: ModelingOperation }>) => {
  let source: THREE.BufferGeometry | undefined, result: THREE.BufferGeometry | undefined, logicalGroups: number[][] | undefined;
  const start = performance.now();
  try {
    source = new THREE.BufferGeometryLoader().parse(event.data.source);
    const op = event.data.operation;
    switch (op.kind) {
      case 'topology': self.postMessage({ topology: inspectGeometry(source, op.polygonTriangles ?? op.pairTriangles ?? false).topology, milliseconds: performance.now() - start }); return;
      case 'bevel': {
        const bevel = bevelLogicalEdges(source, op.edges, op.width, op.polygonTriangles);
        result = bevel.geometry;
        logicalGroups = bevel.polygonTriangles;
        break;
      }
      case 'loop': {
        const cut = loopCutLogicalEdge(source, op.edge, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'uv': result = editUV(source, op.faces, op.operation, op.values); break;
      case 'modifiers': result = evaluateModifiers(source, op.items); break;
      case 'extrude': {
        const extrusion = extrudeLogicalFace(source, op.face, op.distance, op.polygonTriangles);
        result = extrusion.geometry;
        logicalGroups = extrusion.polygonTriangles;
        break;
      }
      case 'inset': {
        const inset = insetLogicalFace(source, op.face, op.distance, op.polygonTriangles);
        result = inset.geometry;
        logicalGroups = inset.polygonTriangles;
        break;
      }
      case 'delete-components': {
        const deletion = deleteLogicalComponents(source, op.mode, op.components, op.polygonTriangles);
        result = deletion.geometry;
        logicalGroups = deletion.polygonTriangles;
        break;
      }
      case 'cut-face': {
        const cut = cutLogicalFace(source, op.face, op.vertices, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'cut-face-edge': {
        const cut = cutLogicalFaceToEdge(source, { face: op.face, vertex: op.vertex, edge: op.edge, t: op.t }, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'cut-face-edges': {
        const cut = cutLogicalFaceBetweenEdges(source, {
          face: op.face,
          firstEdge: op.firstEdge,
          firstT: op.firstT,
          secondEdge: op.secondEdge,
          secondT: op.secondT,
        }, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'cut-face-via-point': {
        const cut = cutLogicalFaceViaPoint(source, {
          face: op.face,
          start: op.start,
          interior: op.interior,
          end: op.end,
        }, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'cut-face-via-path': {
        const cut = cutLogicalFaceViaPath(source, {
          face: op.face,
          start: op.start,
          interiors: op.interiors,
          end: op.end,
        }, op.polygonTriangles);
        result = cut.geometry;
        logicalGroups = cut.polygonTriangles;
        break;
      }
      case 'region': result = extrudeRegion(source, op.faces, op.distance); break;
      case 'subdivide': result = subdivideEdges(source, op.edges); break;
      case 'subdivide-all': {
        const t = inspectGeometry(source).topology;
        result = subdivideEdges(source, t.edges.map(edge => edge.map(v => t.vertices[v][0]) as [number, number])); break;
      }
    }
    const topology = op.kind === 'modifiers' ? undefined : buildTopology(result.getAttribute('position').array, result.index?.array, logicalGroups ?? false);
    const geometry = result.toJSON();
    if (JSON.stringify(geometry).length > 32 * 1024 * 1024) throw new Error('Worker result exceeds 32 MB.');
    self.postMessage({ geometry, topology, milliseconds: performance.now() - start });
  } catch (error) { self.postMessage({ error: (error as Error).message }); }
  finally { source?.dispose(); result?.dispose(); }
};
