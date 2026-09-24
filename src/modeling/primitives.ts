import * as THREE from 'three';

export type Primitive = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'icosphere';

type PrimitiveBase<K extends Primitive> = { version: 1; kind: K };

export type PrimitiveSettings =
  | (PrimitiveBase<'cube'> & {
      width: number;
      height: number;
      depth: number;
      widthSegments: number;
      heightSegments: number;
      depthSegments: number;
    })
  | (PrimitiveBase<'sphere'> & {
      radius: number;
      widthSegments: number;
      heightSegments: number;
    })
  | (PrimitiveBase<'cylinder'> & {
      radius: number;
      height: number;
      radialSegments: number;
      heightSegments: number;
    })
  | (PrimitiveBase<'cone'> & {
      radius: number;
      height: number;
      radialSegments: number;
      heightSegments: number;
    })
  | (PrimitiveBase<'torus'> & {
      radius: number;
      tube: number;
      radialSegments: number;
      tubularSegments: number;
    })
  | (PrimitiveBase<'plane'> & {
      width: number;
      height: number;
      widthSegments: number;
      heightSegments: number;
    })
  | (PrimitiveBase<'icosphere'> & {
      radius: number;
      detail: number;
    });

const numberInRange = (value: unknown, min: number, max: number, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
};

const integerInRange = (value: unknown, min: number, max: number, label: string) => {
  const result = numberInRange(value, min, max, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be a whole number.`);
  return result;
};

export function defaultPrimitiveSettings(kind: Primitive): PrimitiveSettings {
  switch (kind) {
    case 'cube':
      return { version: 1, kind, width: 2, height: 2, depth: 2, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
    case 'sphere':
      return { version: 1, kind, radius: 1, widthSegments: 32, heightSegments: 20 };
    case 'cylinder':
      return { version: 1, kind, radius: 1, height: 2, radialSegments: 32, heightSegments: 1 };
    case 'cone':
      return { version: 1, kind, radius: 1, height: 2, radialSegments: 32, heightSegments: 1 };
    case 'torus':
      return { version: 1, kind, radius: 1, tube: 0.32, radialSegments: 16, tubularSegments: 48 };
    case 'plane':
      return { version: 1, kind, width: 4, height: 4, widthSegments: 1, heightSegments: 1 };
    case 'icosphere':
      return { version: 1, kind, radius: 1.2, detail: 2 };
  }
}

export function parsePrimitiveSettings(value: unknown): PrimitiveSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid primitive settings.');
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || typeof source.kind !== 'string') throw new Error('Invalid primitive settings.');

  switch (source.kind) {
    case 'cube':
      return {
        version: 1,
        kind: 'cube',
        width: numberInRange(source.width, 0.001, 1000, 'Width'),
        height: numberInRange(source.height, 0.001, 1000, 'Height'),
        depth: numberInRange(source.depth, 0.001, 1000, 'Depth'),
        widthSegments: integerInRange(source.widthSegments, 1, 256, 'X segments'),
        heightSegments: integerInRange(source.heightSegments, 1, 256, 'Y segments'),
        depthSegments: integerInRange(source.depthSegments, 1, 256, 'Z segments'),
      };
    case 'sphere':
      return {
        version: 1,
        kind: 'sphere',
        radius: numberInRange(source.radius, 0.001, 1000, 'Radius'),
        widthSegments: integerInRange(source.widthSegments, 3, 256, 'Width segments'),
        heightSegments: integerInRange(source.heightSegments, 2, 256, 'Height segments'),
      };
    case 'cylinder':
      return {
        version: 1,
        kind: 'cylinder',
        radius: numberInRange(source.radius, 0.001, 1000, 'Radius'),
        height: numberInRange(source.height, 0.001, 1000, 'Height'),
        radialSegments: integerInRange(source.radialSegments, 3, 256, 'Radial segments'),
        heightSegments: integerInRange(source.heightSegments, 1, 256, 'Height segments'),
      };
    case 'cone':
      return {
        version: 1,
        kind: 'cone',
        radius: numberInRange(source.radius, 0.001, 1000, 'Radius'),
        height: numberInRange(source.height, 0.001, 1000, 'Height'),
        radialSegments: integerInRange(source.radialSegments, 3, 256, 'Radial segments'),
        heightSegments: integerInRange(source.heightSegments, 1, 256, 'Height segments'),
      };
    case 'torus':
      return {
        version: 1,
        kind: 'torus',
        radius: numberInRange(source.radius, 0.001, 1000, 'Major radius'),
        tube: numberInRange(source.tube, 0.001, 1000, 'Tube radius'),
        radialSegments: integerInRange(source.radialSegments, 3, 256, 'Radial segments'),
        tubularSegments: integerInRange(source.tubularSegments, 3, 256, 'Tubular segments'),
      };
    case 'plane':
      return {
        version: 1,
        kind: 'plane',
        width: numberInRange(source.width, 0.001, 1000, 'Width'),
        height: numberInRange(source.height, 0.001, 1000, 'Height'),
        widthSegments: integerInRange(source.widthSegments, 1, 256, 'X segments'),
        heightSegments: integerInRange(source.heightSegments, 1, 256, 'Y segments'),
      };
    case 'icosphere':
      return {
        version: 1,
        kind: 'icosphere',
        radius: numberInRange(source.radius, 0.001, 1000, 'Radius'),
        detail: integerInRange(source.detail, 0, 6, 'Detail'),
      };
    default:
      throw new Error('Unsupported primitive type.');
  }
}

export function updatePrimitiveSetting(settings: PrimitiveSettings, key: string, value: number): PrimitiveSettings {
  if (!(key in settings) || key === 'version' || key === 'kind') throw new Error('Unsupported primitive parameter.');
  return parsePrimitiveSettings({ ...settings, [key]: value });
}

export function createPrimitiveGeometry(settings: PrimitiveSettings): THREE.BufferGeometry {
  const value = parsePrimitiveSettings(settings);
  let source: THREE.BufferGeometry;

  switch (value.kind) {
    case 'cube':
      source = new THREE.BoxGeometry(value.width, value.height, value.depth, value.widthSegments, value.heightSegments, value.depthSegments);
      break;
    case 'sphere':
      source = new THREE.SphereGeometry(value.radius, value.widthSegments, value.heightSegments);
      break;
    case 'cylinder':
      source = new THREE.CylinderGeometry(value.radius, value.radius, value.height, value.radialSegments, value.heightSegments);
      break;
    case 'cone':
      source = new THREE.ConeGeometry(value.radius, value.height, value.radialSegments, value.heightSegments);
      break;
    case 'torus':
      source = new THREE.TorusGeometry(value.radius, value.tube, value.radialSegments, value.tubularSegments);
      break;
    case 'plane':
      source = new THREE.PlaneGeometry(value.width, value.height, value.widthSegments, value.heightSegments);
      break;
    case 'icosphere':
      source = new THREE.IcosahedronGeometry(value.radius, value.detail);
      break;
  }

  const geometry = new THREE.BufferGeometry().copy(source);
  source.dispose();
  return geometry;
}
