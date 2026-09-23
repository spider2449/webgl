import * as THREE from 'three';

export function createGrid() {
  const geometry = new THREE.PlaneGeometry(2000, 2000);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 worldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 worldPosition;
      void main() {
        vec2 coordinate = worldPosition.xz;
        vec2 derivative = max(fwidth(coordinate), vec2(0.0001));
        vec2 gridDistance = abs(fract(coordinate - 0.5) - 0.5) / derivative;
        float line = 1.0 - min(min(gridDistance.x, gridDistance.y), 1.0);
        float major = 1.0 - min(min(abs(fract(coordinate.x / 5.0 - 0.5) - 0.5) / (derivative.x / 5.0), abs(fract(coordinate.y / 5.0 - 0.5) - 0.5) / (derivative.y / 5.0)), 1.0);
        vec3 color = vec3(0.27, 0.30, 0.35);
        float opacity = max(line * 0.45, major * 0.65);
        float xAxis = 1.0 - min(abs(coordinate.y) / derivative.y, 1.0);
        float zAxis = 1.0 - min(abs(coordinate.x) / derivative.x, 1.0);
        color = mix(color, vec3(0.58, 0.29, 0.33), xAxis);
        color = mix(color, vec3(0.28, 0.40, 0.59), zAxis);
        opacity = max(opacity, max(xAxis, zAxis) * 0.8);
        float fade = 1.0 - smoothstep(12.0, 65.0, distance(cameraPosition.xz, coordinate));
        gl_FragColor = vec4(color, opacity * fade);
      }
    `,
  });
  const grid = new THREE.Mesh(geometry, material);
  grid.name = 'Viewport grid';
  grid.renderOrder = -1;
  return grid;
}
