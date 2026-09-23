type WeightJob = { positions: Float32Array; segments: Float32Array };
self.onmessage = (event: MessageEvent<WeightJob>) => {
  const { positions, segments } = event.data;
  const count = positions.length / 3;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nearest = [Infinity, Infinity, Infinity, Infinity];
    const bones = [0, 0, 0, 0];
    for (let s = 0; s < segments.length; s += 7) {
      const ax = segments[s], ay = segments[s + 1], az = segments[s + 2];
      const dx = segments[s + 3] - ax, dy = segments[s + 4] - ay, dz = segments[s + 5] - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / Math.max(1e-12, dx * dx + dy * dy + dz * dz)));
      const distance = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 + (pz - az - t * dz) ** 2;
      const bone = segments[s + 6];
      const existing = bones.findIndex((b, i) => b === bone && Number.isFinite(nearest[i]));
      if (existing !== -1) { if (distance < nearest[existing]) nearest[existing] = distance; continue; }
      let farthest = 0;
      for (let i = 1; i < 4; i++) if (nearest[i] > nearest[farthest]) farthest = i;
      if (distance < nearest[farthest]) { nearest[farthest] = distance; bones[farthest] = bone; }
    }
    const raw = nearest.map(d => Number.isFinite(d) ? 1 / Math.max(d * d, 1e-10) : 0);
    const sum = raw.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) { indices[v * 4 + i] = bones[i]; weights[v * 4 + i] = raw[i] / sum; }
  }
  self.postMessage({ indices, weights }, { transfer: [indices.buffer, weights.buffer] });
};
