import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';

test('measure large-mesh topology worker and UI heartbeat', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => (window as any).__forge?.selected);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves browser modules.
    const THREE = await import('/node_modules/three/build/three.module.js');
    // @ts-expect-error Vite serves browser modules.
    const { modelingJob } = await import('/src/modeling-worker-client.ts');
    const samples = [];
    for (const divisions of [100, 200, 300]) for (let repetition = 0; repetition < 3; repetition++) {
      const primitive = new THREE.PlaneGeometry(10, 10, divisions, divisions), geometry = new THREE.BufferGeometry().copy(primitive);
      let last = performance.now(), maxGap = 0, beats = 0;
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; beats++; }, 16);
      const start = performance.now();
      const response = await modelingJob(geometry, { kind: 'topology' }).promise;
      const elapsed = performance.now() - start;
      maxGap = Math.max(maxGap, performance.now() - last); clearInterval(timer);
      samples.push({ divisions, vertices:geometry.getAttribute('position').count, triangles:geometry.index.count/3, repetition:repetition+1, workerMs:response.milliseconds, roundTripMs:elapsed, maxHeartbeatGapMs:maxGap, beats, edges:response.topology.edges.length });
      geometry.dispose(); primitive.dispose();
    }
    return { samples, userAgent:navigator.userAgent, concurrency:navigator.hardwareConcurrency };
  });
  for (const sample of result.samples) { expect(sample.beats).toBeGreaterThan(0); expect(sample.edges).toBe(3*sample.divisions**2+2*sample.divisions); }
  const rounded = result.samples.map(s => Object.fromEntries(Object.entries(s).map(([k,v]) => [k, typeof v === 'number' ? Math.round(v*100)/100 : v])));
  const report = { timestamp:new Date().toISOString(), cpu:cpus()[0]?.model, os:`${platform()} ${release()}`, ...result, samples:rounded };
  mkdirSync('docs/benchmarks',{recursive:true});
  writeFileSync('docs/benchmarks/2026-09-12-modeling.json', JSON.stringify(report,null,2)+'\n');
  const rows=result.samples.map(s=>`| ${s.vertices} | ${s.triangles} | ${s.repetition} | ${s.workerMs.toFixed(1)} | ${s.roundTripMs.toFixed(1)} | ${s.maxHeartbeatGapMs.toFixed(1)} | ${s.beats} |`).join('\n');
  writeFileSync('docs/benchmarks/2026-09-12-modeling.md', `# Modeling worker benchmark\n\nMeasured ${report.timestamp} on ${report.cpu}, ${report.os}.\nBrowser: ${report.userAgent}; Chromium uses SwiftShader.\n\nRun with \`npm run benchmark\`. Three cold-worker samples per indexed plane size.\nWorker time includes parsing, validation and logical topology construction.\nRound trip includes serialization, worker startup, computation and result cloning.\nA 16 ms main-thread timer measures responsiveness; serialization and receiving\nlarge topology results still cause pauses. This is not a viewport FPS claim or\na timing acceptance threshold. Source generation is outside the timed interval.\n\n| Vertices | Triangles | Sample | Worker ms | Round trip ms | Max heartbeat gap ms | Heartbeats |\n|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n`);
});
