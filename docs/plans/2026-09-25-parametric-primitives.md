# Parametric Primitive Modeling

Date: 2026-09-25

Base: `cb507cfeae0c19dca159dd4802cef35d46d5a763`

## Goal

Add a small parametric modeling layer before expanding weight painting. Primitive subdivision density must be adjustable so skinning is not constrained by coarse default geometry.

## Supported primitives

- Cube: Size X/Y/Z, Segments X/Y/Z
- Plane: Size X/Y, Segments X/Y
- Sphere: Radius, Width/Height segments
- Cylinder: Radius, Depth, Radial/Height segments
- Cone: Radius, Depth, Radial/Height segments
- Torus: Major/Tube radius, Radial/Tubular segments
- Icosphere: Radius, Detail

Existing defaults are preserved. Users explicitly increase subdivisions where needed.

## Persistence

Parametric metadata is stored as serializable `userData.forgePrimitive` version 1. Geometry is still stored as explicit `BufferGeometry`, so existing project loading remains deterministic. Project loading validates primitive metadata before exposing regeneration controls.

## Apply semantics

Primitive metadata is automatically removed when geometry becomes manually authored:

- vertex dragging
- face/region extrusion
- modeling worker operations such as subdivision
- mirror geometry

An explicit **Apply primitive** button freezes the current generated geometry without changing it.

## Safety

- segment counts are bounded (generally 256 per dimension; Icosphere detail 6)
- dimensions are finite and bounded
- regeneration respects the existing 2,000,000-vertex scene cap
- SkinnedMesh and unapplied modifier meshes cannot regenerate primitive parameters

## Quad note

WebGL / Three.js rendering remains triangle-based. This task does not pretend otherwise. Quad/polygon editing should be implemented as a logical modeling topology layer on top of render triangles in a follow-up package.

## Windows validation

Validate exact PR HEAD with:

- `npm run build`
- `npm test -- --workers=2`
- manual Cube → Segments 4/4/4 → Edit Mode density check → Bind/Weight Mode smoke test
