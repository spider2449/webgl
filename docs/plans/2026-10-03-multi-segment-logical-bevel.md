# Multi-Segment Logical Bevel

## Goal

Upgrade Forge Studio's existing polygon-native edge bevel from one flat chamfer segment to a bounded **1–16 segment** bevel profile while preserving the logical modeling topology.

This is a core modeling capability, not renderer tessellation.

## Existing behavior

Before this task, every selected sharp logical edge contributed one clipping plane.

For adjacent outward face normals `n1` and `n2`, Forge used the normalized bisector:

```
m = normalize(n1 + n2)
```

and clipped at:

```
constant = edgePoint · m - width · sin(phi / 2)
```

where:

```
phi = acos(n1 · n2)
```

That produces one flat logical bevel face.

This exact one-segment behavior remains the compatibility contract for `Segments = 1`.

## User interaction

In Edge Edit Mode:

1. select one or more sharp logical edges;
2. RMB -> **Bevel Edges**;
3. set:
   - **Bevel Width**
   - **Segments**
4. execute the same Bevel command.

Settings are retained for the session.

Segments must be an integer from 1 through 16.

## Width semantics

Width keeps its existing meaning: distance along either adjacent source face from the original selected edge to the bevel boundary.

Changing Segments must not change that endpoint width.

## Multi-segment profile

For one selected logical edge, let the adjacent outward unit normals be:

```
n1
n2
```

with:

```
phi = acos(clamp(n1 · n2, -1, 1))
```

The bevel cross-section is modeled as chords of a circle tangent to the two adjacent faces at the existing width endpoints.

Let:

```
half = phi / 2
r = width · cot(half)
m = normalize(n1 + n2)
center = edgePoint - m · width / sin(half)
```

The circle radius `r` follows directly from the requirement that the tangent point on each source face sits exactly `width` units from the original edge.

For `N` segments, sample the normal arc at:

```
t = 0 / N, 1 / N, ..., N / N
```

using spherical interpolation between `n1` and `n2`.

For each interval `[j/N, (j+1)/N]`:

```
u0 = sampleNormal(j / N)
u1 = sampleNormal((j + 1) / N)

p0 = center + r · u0
p1 = center + r · u1

chordNormal = normalize(u0 + u1)
chordConstant = p0 · chordNormal
```

`p1` must lie on the same plane within coordinate tolerance.

Each chord plane becomes one actual convex clipping plane.

Therefore each profile segment produces a real logical polygon face.

## Why clipping planes

The existing bevel is already a convex half-space clipping operation.

Extending each selected edge from one plane to several planes preserves the established architecture:

- no renderer triangle becomes modeling authority;
- no centroid modeling vertex is introduced;
- adjacent selected edges naturally resolve through intersection of their clipping half-spaces;
- cap polygons are generated from exact intersection corners;
- UV/color attributes continue through the existing corner interpolation path;
- surviving source corners retain persistent logical vertex identities.

This avoids implementing a separate mesh-stitching bevel algorithm.

## Segment 1 compatibility

For `Segments = 1`, Forge does not route through the generalized circle calculation.

It uses the previous exact bisector plane:

```
normal = normalize(n1 + n2)
constant = edgePoint · normal - width · sin(phi / 2)
```

This keeps the historical single-segment result stable.

## Logical topology

For an isolated Cube edge:

```
source:
V8 / E12 / F6 / T12
```

With `Segments = 1`:

```
V10 / E15 / F7 / T16
```

With `Segments = 3`:

```
V14 / E21 / F9 / T24
```

The three added profile polygons are real logical bevel faces.

The two Cube faces at the endpoints of the selected edge become 7-gons in the three-segment result. This is intentional polygon-native topology; Forge does not force those corner regions into artificial Quad/Triangle modeling patches merely to match renderer tessellation.

## Adjacent selected edges

Selected edge chains and loops are handled by the same half-space intersection.

For each selected edge Forge creates `Segments` profile planes, then clips the convex logical surface against all planes.

At corner junctions:

- profile planes from neighboring selected edges intersect directly;
- resulting corner polygons may be N-gons;
- every final logical boundary must remain consistently oriented and manifold;
- no renderer-only diagonal is exposed as a selectable edge.

A four-edge top loop on the default Cube is a required regression for this junction behavior.

## Adjacent-junction cap canonicalization

Repeated Float32 clipping at a corner where multiple selected beveled edges meet can create redundant corners on a newly generated bevel cap:

- two consecutive cap corners may differ by only a few Float32 ULPs;
- a middle cap corner may lie exactly on the segment between its neighbors.

Those points are numerical construction artifacts, not authored modeling boundaries. Leaving them in a generated convex cap can force renderer triangulation to emit a zero-area triangle even though the intended bevel surface is valid.

Forge therefore tracks bevel-generated polygons by provenance and canonicalizes them whenever later clipping changes them:

- source polygons are never simplified by this rule;
- a newly created bevel cap is marked bevel-generated;
- if a later selected-edge plane clips that bevel face, its clipped boundary is canonicalized again;
- remove consecutive points within a bounded Float32-scale tolerance;
- remove a strictly intermediate collinear generated-cap corner;
- repeat until stable;
- an older bevel face reduced below three corners disappears because the later half-space constraint has consumed that face;
- the newly created cap for the current plane must still contain at least three corners.

This rule is deliberately not applied to source polygons or the shared tessellator. Knife, Subdivide and other modeling operations may intentionally preserve collinear logical boundary vertices, and their topology contract remains unchanged.

The tolerance scales to roughly four Float32 ULPs at the current coordinate magnitude and is computed with a bounded vertex scan rather than a large spread call.

## Materials and attributes

Every profile plane inherits the material from the same adjacent logical face used by the previous one-segment implementation.

When clipping source polygon corners:

- position and numeric corner attributes interpolate;
- canonical interpolation keeps independently stored seam copies coincident;
- surviving source corners retain their logical vertex identity;
- newly created bevel vertices receive logical identity through the polygon-native output position token;
- normals are recomputed after tessellation.

Automatic bevel UV unwrap remains out of scope.

## Validation and limits

Reject:

- non-finite or out-of-range width;
- Segments outside integer 1–16;
- more than 128 selected logical edges;
- selectedEdges × Segments greater than 512;
- open meshes;
- concave or inconsistently oriented meshes;
- non-manifold logical boundaries;
- coplanar selected edges;
- opposing face normals;
- widths at least half the selected edge length;
- widths whose historical one-segment plane would remove unrelated source vertices;
- generated chord planes that would remove unrelated source vertices;
- collapsed caps or coordinate precision failure.

The 512-plane budget bounds the otherwise quadratic repeated polygon clipping cost.

## Worker contract

The modeling operation becomes:

```ts
{
  kind: 'bevel',
  edges: number[],
  width: number,
  segments?: number,
  polygonTriangles?: number[][]
}
```

Missing `segments` means 1 for backward compatibility.

Bevel remains cancellable in the modeling worker.

## RMB parameter plumbing

The viewport context menu previously supported only one inline parameter per command.

This task preserves the existing parameter component but allows a command to expose multiple parameter rows.

Only Bevel currently uses that extension:

- Bevel Width
- Segments

Other command UI is unchanged.

## Regression contract

### Isolated Cube edge

For `width = 0.2`, `segments = 3`:

- V14
- E21
- F9
- T24
- polygon sizes: seven Quads + two 7-gons
- closed logical manifold
- renderer vertices correspond to logical boundary vertices
- persistent `forgeLogicalVertexIds` covers the full position buffer.

### Adjacent four-edge Cube loop

Select all four top Cube edges and use three segments.

Required:

- all 12 profile planes contribute logical faces;
- output is closed and consistently oriented;
- corner junctions remain manifold;
- logical polygon count is source count + selected edge count × segments;
- no renderer-only vertex becomes a modeling vertex.

### Real editor

Default Cube:

1. Edge mode.
2. Select one logical edge.
3. Set Width = 0.2.
4. Set Segments = 3.
5. RMB -> Bevel Edges.
6. Expect V14 / E21 / F9 / T24.
7. Expect stored polygon groups and logical vertex identity metadata.
8. Expect primitive metadata cleared.
9. One Undo restores the exact original Cube snapshot.

## Non-goals

- profile shape control;
- superellipse/custom profiles;
- clamp overlap;
- percent/depth/absolute width modes;
- bevel weights;
- vertex-only bevel;
- non-convex mesh bevel;
- open-boundary bevel;
- automatic UV unwrap;
- smoothing/harden normals;
- miter style controls.

Those should be separate capabilities after this bounded multi-segment topology contract is stable.

## Windows-local validation

Focused gate:

```powershell
npm run build
npm test -- tests/bevel-multi-segment.spec.ts tests/modeling-core.spec.ts tests/context-menu.spec.ts --workers=2
```

Then:

```powershell
npm run test:modeling -- --workers=2
```

Manual priority:

1. Cube, one edge, Segments 1: confirm historical flat chamfer.
2. Same edge, Segments 3: confirm three visible logical profile bands.
3. Increase to Segments 6–8: confirm progressively rounded polygonal profile.
4. Select the four top Cube edges, Segments 3: inspect all corner junctions.
5. Wireframe: profile renderer triangulation diagonals must remain hidden/unselectable.
6. Undo restores exact source topology.
7. Invalid fractional/zero/>16 segment values reject in the inline control.
8. Excessive width remains atomic.

Final exact-HEAD gate, once only:

```powershell
npm run test:full -- --workers=2
```
