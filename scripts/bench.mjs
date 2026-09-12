#!/usr/bin/env node
/**
 * Performance probe for massive + tracer scenes.
 * Not a CI gate — numbers drift with hardware. Use to catch O(N²) regressions.
 *
 *   npm run bench
 */
import { performance } from "node:perf_hooks";
import { Engine } from "../src/physics/engine.ts";
import { closestEncounter } from "../src/physics/orbital/encounters.ts";
import { SUN } from "../src/physics/presets.ts";

function makeScene(nTracers) {
  const e = new Engine();
  e.dt = 0.0002;
  e.softening = 0.003;
  e.collisionsEnabled = false;
  e.adaptiveDt = true;
  const specs = [{ ...SUN }];
  for (let i = 0; i < nTracers; i++) {
    const a = 2 + (i % 800) * 0.01;
    const th = (i * 0.137) % (Math.PI * 2);
    specs.push({
      name: `tr${i}`,
      mass: 1e-12,
      physicalRadius: 1e-8,
      renderRadius: 0.002,
      x: a * Math.cos(th),
      y: a * Math.sin(th),
      z: 0,
      vx: -Math.sin(th) * 4,
      vy: Math.cos(th) * 4,
      vz: 0,
      color: "#888",
      gravityMode: "test-particle",
      noCollide: true,
    });
  }
  e.reset(specs);
  return e;
}

function timeMs(fn, repeats) {
  const t0 = performance.now();
  for (let i = 0; i < repeats; i++) fn();
  return (performance.now() - t0) / repeats;
}

const sizes = [100, 1000, 10000];
console.log("N tracers | force ms | encounter ms | step ms");
for (const n of sizes) {
  const e = makeScene(n);
  const force = timeMs(() => e.refreshAccel(), n >= 10000 ? 4 : 12);
  const enc = timeMs(() => closestEncounter(e.bodies, null), n >= 10000 ? 8 : 20);
  const step = timeMs(() => e.step(), n >= 10000 ? 3 : 8);
  console.log(
    `${String(n).padStart(9)} | ${force.toFixed(2).padStart(8)} | ${enc.toFixed(2).padStart(12)} | ${step.toFixed(2).padStart(7)}`,
  );
}
