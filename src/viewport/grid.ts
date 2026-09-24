import * as THREE from 'three';

export type GridPlane = 'perspective' | 'top' | 'front' | 'right';

export function createGrid() {
  const geometry = new THREE.PlaneGeometry(2000, 2000);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      gridPlane: { value: 0 },
    },
    vertexShader: `
      varying vec3 worldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform int gridPlane;
      varying vec3 worldPosition;
      void main() {
        vec2 coordinate;
        vec2 cameraCoordinate;
        vec3 firstAxisColor;
        vec3 secondAxisColor;

        if (gridPlane == 1) {
          coordinate = worldPosition.xy;
          cameraCoordinate = cameraPosition.xy;
          firstAxisColor = vec3(0.58, 0.29, 0.33);
          secondAxisColor = vec3(0.33, 0.52, 0.31);
        } else if (gridPlane == 2) {
          coordinate = worldPosition.yz;
          cameraCoordinate = cameraPosition.yz;
          firstAxisColor = vec3(0.33, 0.52, 0.31);
          secondAxisColor = vec3(0.28, 0.40, 0.59);
        } else {
          coordinate = worldPosition.xz;
          cameraCoordinate = cameraPosition.xz;
          firstAxisColor = vec3(0.58, 0.29, 0.33);
          secondAxisColor = vec3(0.28, 0.40, 0.59);
        }

        vec2 derivative = max(fwidth(coordinate), vec2(0.0001));
        vec2 gridDistance = abs(fract(coordinate - 0.5) - 0.5) / derivative;
        float line = 1.0 - min(min(gridDistance.x, gridDistance.y), 1.0);
        float major = 1.0 - min(min(abs(fract(coordinate.x / 5.0 - 0.5) - 0.5) / (derivative.x / 5.0), abs(fract(coordinate.y / 5.0 - 0.5) - 0.5) / (derivative.y / 5.0)), 1.0);
        vec3 color = vec3(0.27, 0.30, 0.35);
        float opacity = max(line * 0.45, major * 0.65);
        float firstAxis = 1.0 - min(abs(coordinate.y) / derivative.y, 1.0);
        float secondAxis = 1.0 - min(abs(coordinate.x) / derivative.x, 1.0);
        color = mix(color, firstAxisColor, firstAxis);
        color = mix(color, secondAxisColor, secondAxis);
        opacity = max(opacity, max(firstAxis, secondAxis) * 0.8);
        float fade = 1.0 - smoothstep(12.0, 65.0, distance(cameraCoordinate, coordinate));
        gl_FragColor = vec4(color, opacity * fade);
      }
    `,
  });
  const grid = new THREE.Mesh(geometry, material);
  grid.name = 'Viewport grid';
  grid.renderOrder = -1;
  return grid;
}

export function setGridPlane(grid: THREE.Mesh, plane: GridPlane) {
  grid.rotation.set(0, 0, 0);
  const material = grid.material as THREE.ShaderMaterial;
  if (plane === 'front') {
    grid.rotation.x = Math.PI / 2;
    material.uniforms.gridPlane.value = 1;
  } else if (plane === 'right') {
    grid.rotation.z = -Math.PI / 2;
    material.uniforms.gridPlane.value = 2;
  } else {
    material.uniforms.gridPlane.value = 0;
  }
  grid.updateMatrixWorld(true);
}
