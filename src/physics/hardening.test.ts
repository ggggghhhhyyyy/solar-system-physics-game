import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { isMassiveBody, isTestParticle } from './body/semantics.ts';
import { AU_M, DE440_CONSTANTS, G0, GM_SUN_AU3_YR2, PHYSICAL_RADIUS_AU } from './constants.ts';
import { Engine } from './engine.ts';
import { barycenter, getHeaviestMassiveBody, getPrimaryStar } from './frames/referenceFrames.ts';
import { closestEncounter, isTideCandidate } from './orbital/encounters.ts';
import { sampleOsculatingOrbit } from './orbital/orbitPath.ts';
import { HORIZONS_CACHE_EPOCH, HORIZONS_CACHE_PROVENANCE, HORIZONS_CACHE_2026_09_11 } from './ephemeris/horizonsCache.ts';
import { parseHorizonsVector } from './ephemeris/horizonsParse.ts';
import { loadSolarSystem } from './ephemeris/loadSolarSystem.ts';
import { JPL_PROPAGATION_FIXTURES } from './ephemeris/propagationFixtures.ts';
import { assertSafeHorizonsRequest } from './ephemeris/horizonsApi.server.ts';
import { orbiting, SUN } from './presets.ts';
import { coerceEpoch, epochFromCalendar } from './time/epoch.ts';
import type { BodySpec } from './types.ts';

const EARTH_FIXTURE = `
*******************************************************************************
Target body name: Earth (399)                     {source: DE441}
Center body name: Solar System Barycenter (0)     {source: DE441}
Output units    : AU-D
Output type     : GEOMETRIC cartesian states
Reference frame : Ecliptic of J2000.0
*******************************************************************************
$$SOE
2461294.500000000 = A.D. 2026-Sep-11 00:00:00.0000 TDB
 X = 9.832120976335644E-01 Y =-2.158800827312486E-01 Z = 1.047935899095542E-04
 VX= 3.329266696098533E-03 VY= 1.676845226440829E-02 VZ=-5.058874382694192E-07
$$EOE
`;

function probeSpec(mass = 100): BodySpec {
  return {
    name: 'fake-probe',
    mass,
    physicalRadius: 1e-8,
    renderRadius: 0.02,
    x: 2, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    color: '#fff',
    gravityMode: 'test-particle',
  };
}

describe('Test A — barycenter ignores test particles', () => {
  it('COM is unchanged after adding a 100 M☉ test particle', () => {
    const e = new Engine();
    e.reset([{ ...SUN }, orbiting('地球', 1, 3e-6, 0.02, '#4f', 0, 1, { key: 'earth' })]);
    const com0 = barycenter(e.bodies);
    e.addBody(probeSpec(100));
    const com1 = barycenter(e.bodies);
    assert.ok(Math.hypot(com1.x - com0.x, com1.y - com0.y, com1.z - com0.z) < 1e-15);
    assert.ok(Math.hypot(com1.vx - com0.vx, com1.vy - com0.vy, com1.vz - com0.vz) < 1e-15);
    assert.equal(isTestParticle(e.bodies[2]), true);
    assert.equal(isMassiveBody(e.bodies[2]), false);
  });
});

describe('Test B — primary ignores test particles', () => {
  it('100 M☉ test particle is not the system primary', () => {
    const e = new Engine();
    e.reset([{ ...SUN }, probeSpec(100)]);
    const primary = e.getPrimaryStar();
    const heavy = e.getHeaviestMassiveBody();
    const dom = e.getDominantGravitySource();
    assert.equal(primary?.key, 'sun');
    assert.equal(heavy?.key, 'sun');
    assert.equal(dom?.key, 'sun');
    assert.notEqual(e.heaviest()?.name, 'fake-probe');
    assert.equal(getPrimaryStar(e.bodies)?.key, 'sun');
    assert.equal(getHeaviestMassiveBody(e.bodies)?.key, 'sun');
  });
});

describe('Test C — strict Horizons mode', () => {
  it('source=horizons rejects when the fetcher fails and does not fall back', async () => {
    await assert.rejects(
      () =>
        loadSolarSystem({
          epoch: '2000-01-01',
          source: 'horizons',
          fetchStates: async () => {
            throw new Error('NASA down');
          },
        }),
      /NASA down|No Horizons/,
    );
  });

  it('open URL proxy is rejected', () => {
    assert.throws(
      () => assertSafeHorizonsRequest({ url: 'https://evil.example/', epoch: '2026-09-11' }),
      /forbidden|url/i,
    );
  });
});

describe('Test D — auto fallback', () => {
  it('source=auto live fail → keplerian with SOURCE: KEPLERIAN FALLBACK', async () => {
    const sys = await loadSolarSystem({
      epoch: '2000-01-01',
      source: 'auto',
      fetchStates: async () => {
        throw new Error('live failed');
      },
    });
    assert.equal(sys.source, 'keplerian');
    assert.equal(sys.fallback, true);
    assert.ok(sys.warnings.some((w) => /SOURCE: KEPLERIAN FALLBACK/i.test(w)));
    assert.ok(sys.warnings.some((w) => /PHYSICAL APPROXIMATION/i.test(w)));
  });
});

describe('Test E — TDB metadata', () => {
  it('cache epoch is TDB, not a Z-suffixed UTC instant', () => {
    assert.equal(HORIZONS_CACHE_EPOCH.scale, 'TDB');
    assert.equal(HORIZONS_CACHE_EPOCH.jdTdb, 2461294.5);
    assert.equal(HORIZONS_CACHE_PROVENANCE.timeScale, 'TDB');
    assert.equal(HORIZONS_CACHE_PROVENANCE.ephemeris, 'DE441');
    assert.ok(!HORIZONS_CACHE_EPOCH.calendar.endsWith('Z'));
    assert.ok(!HORIZONS_CACHE_EPOCH.calendar.includes('T00:00:00Z'));
    assert.equal(HORIZONS_CACHE_PROVENANCE.source, 'JPL Horizons');
    assert.equal(HORIZONS_CACHE_PROVENANCE.center, '500@0');
    const e = epochFromCalendar(HORIZONS_CACHE_EPOCH.calendar, 'TDB');
    assert.equal(e.scale, 'TDB');
    assert.ok(Math.abs(e.jd - 2461294.5) < 1e-8);
    const utc = coerceEpoch('2026-09-11T00:00:00Z', 'UTC');
    assert.equal(utc.scale, 'UTC');
    assert.notEqual(utc.scale, HORIZONS_CACHE_EPOCH.scale);
  });
});

describe('Test F — 3D orbit overlay data path', () => {
  it('inclined osculating samples leave the xy plane', () => {
    const e = new Engine();
    e.reset([
      { ...SUN },
      orbiting('inclined', 1, 3e-6, 0.02, '#4f', 0, 1, {
        key: 'inc',
        iDeg: 30,
        eccentricity: 0.1,
      }),
    ]);
    const sun = e.getPrimaryStar()!;
    const b = e.bodies.find((x) => x.key === 'inc')!;
    const el = e.orbitalElements(b, sun);
    assert.ok(el.i > 0.4, `i=${el.i}`);
    const mu = e.G * (sun.mass + b.mass);
    const path = sampleOsculatingOrbit(el, mu, { x: sun.x, y: sun.y, z: sun.z }, 64);
    assert.ok(path.points.length > 16);
    const maxZ = Math.max(...path.points.map((p) => Math.abs(p.z - sun.z)));
    assert.ok(maxZ > 0.2, `maxZ=${maxZ} — 3D samples must leave xy`);
  });
});

describe('Test G — test-particle performance semantics', () => {
  it('tracers stay out of conservation, COM, gravity tree, Roche, and global encounters', () => {
    const massiveOnly: BodySpec[] = [
      { ...SUN },
      orbiting('地球', 1, 3e-6, 0.02, '#4f', 0, 1, { key: 'earth' }),
    ];
    const tracers: BodySpec[] = [];
    for (let i = 0; i < 40; i++) {
      tracers.push({
        name: `tr${i}`,
        mass: 1e-12,
        physicalRadius: 1e-8,
        renderRadius: 0.002,
        x: 2 + i * 0.01,
        y: 0.1 * i,
        z: 0,
        vx: 0,
        vy: 4,
        vz: 0,
        color: '#888',
        gravityMode: 'test-particle',
        noCollide: true,
      });
    }
    const e0 = new Engine();
    e0.reset(massiveOnly);
    e0.refreshAccel();
    const d0 = e0.diagnostics();
    const sun0 = e0.getPrimaryStar()!;

    const e = new Engine();
    e.reset([...massiveOnly, ...tracers]);
    e.refreshAccel();
    const d1 = e.diagnostics();
    const com = barycenter(e.bodies);
    const sun = e.getPrimaryStar()!;
    assert.equal(e.bodies.filter(isTestParticle).length, 40);
    assert.ok(Math.abs(d1.current.totalEnergy - d0.current.totalEnergy) < 1e-18);
    assert.ok(Math.hypot(com.x - barycenter(e0.bodies).x, com.y - barycenter(e0.bodies).y) < 1e-15);
    assert.ok(Math.hypot(sun.ax - sun0.ax, sun.ay - sun0.ay, sun.az - sun0.az) < 1e-18);
    for (const t of e.bodies.filter(isTestParticle)) {
      assert.equal(isTideCandidate(sun, t), false);
    }
    const enc = closestEncounter(e.bodies, null);
    if (enc) {
      const a = e.bodies.find((b) => b.id === enc.aId)!;
      const b = e.bodies.find((x) => x.id === enc.bId)!;
      assert.ok(!(isTestParticle(a) && isTestParticle(b)), 'global encounter must not pick tracer↔tracer');
    }
  });
});

describe('Test H — real radius', () => {
  it('Earth physical radius is ~6371 km, not 0.021 AU', () => {
    const km = (PHYSICAL_RADIUS_AU.earth * AU_M) / 1000;
    assert.ok(km > 6300 && km < 6400, `Earth R=${km} km`);
    assert.ok(PHYSICAL_RADIUS_AU.earth < 5e-5);
    assert.ok(PHYSICAL_RADIUS_AU.earth < 0.001);
  });
});

describe('Test I — JPL 1-day / 7-day / 30-day propagation', () => {
  it('quantifies Earth/Moon/Jupiter drift vs DE441 after +1d +7d +30d', { timeout: 120_000 }, async () => {
    const sys = await loadSolarSystem({
      epoch: { jd: 2461294.5, scale: 'TDB' },
      includeMoons: true,
      includeSpacecraft: false,
      source: 'horizons',
    });
    assert.equal(sys.source, 'horizons-cache');
    assert.equal(sys.constants, 'de440');

    const report: Record<number, Record<string, { posKm: number; velAUy: number }>> = {};
    for (const days of JPL_PROPAGATION_FIXTURES.offsetsDays) {
      const e = new Engine();
      e.setConstants('de440');
      e.dt = 1e-5;
      e.softening = 1e-8;
      e.collisionsEnabled = false;
      e.adaptiveDt = true;
      e.reset(sys.bodies.map((b) => ({ ...b })), { epoch: sys.epoch, constants: 'de440' });
      const years = days / 365.25;
      const steps = Math.round(years / e.dt);
      for (let i = 0; i < steps; i++) e.step();
      report[days] = {};
      for (const key of ['earth', 'moon', 'jupiter'] as const) {
        const b = e.bodies.find((x) => x.key === key)!;
        const f = JPL_PROPAGATION_FIXTURES.states[key][days];
        const dPos = Math.hypot(b.x - f.x, b.y - f.y, b.z - f.z);
        const dVel = Math.hypot(b.vx - f.vx, b.vy - f.vy, b.vz - f.vz);
        const posKm = (dPos * AU_M) / 1000;
        report[days][key] = { posKm, velAUy: dVel };
        assert.ok(Number.isFinite(posKm) && posKm >= 0, `${key}+${days}d pos`);
      }
    }
    // 1-day Earth must stay well inside 0.01 AU (~1.5e6 km) — integrator sanity, not navigation-grade.
    assert.ok(report[1].earth.posKm < 1.5e6, `Earth +1d ${report[1].earth.posKm} km`);
    assert.ok(report[1].jupiter.posKm < 5e6, `Jupiter +1d ${report[1].jupiter.posKm} km`);
    // eslint-disable-next-line no-console
    console.log('JPL propagation error (km):', JSON.stringify(report, null, 2));
  });
});

describe('Cache integrity', () => {
  it('baked DE441 snapshot has real distances and a free Sun', () => {
    const c = HORIZONS_CACHE_2026_09_11;
    const r = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const es = r(c.earth, c.sun);
    assert.ok(es > 0.98 && es < 1.02, `Earth-Sun ${es}`);
    const me = r(c.moon, c.earth);
    assert.ok(me > 0.002 && me < 0.003, `Moon-Earth ${me}`);
    const ioJ = r(c.io, c.jupiter);
    assert.ok(ioJ > 0.0025 && ioJ < 0.0032, `Io-Jupiter ${ioJ}`);
    const tiS = r(c.titan, c.saturn);
    assert.ok(tiS > 0.007 && tiS < 0.009, `Titan-Saturn ${tiS}`);
    const sunOff = Math.hypot(c.sun.x, c.sun.y, c.sun.z);
    assert.ok(sunOff > 0.001 && sunOff < 0.02, `Sun barycentric offset ${sunOff}`);
    const v1 = Math.hypot(c.voyager1.x, c.voyager1.y, c.voyager1.z);
    assert.ok(v1 > 100, `Voyager 1 ${v1}`);
  });
});

describe('Horizons parser is strict', () => {
  const epoch = { jd: 2461294.5, scale: 'TDB' as const };
  it('parses AU-D and converts velocity', () => {
    const p = parseHorizonsVector(EARTH_FIXTURE, epoch);
    assert.equal(p.timeScale, 'TDB');
    assert.equal(p.units, 'AU-D');
    assert.equal(p.sampleCount, 1);
    assert.ok(Math.abs(p.state.velocity.x - 3.329266696098533e-3 * 365.25) < 1e-12);
  });
  it('rejects missing $$SOE', () => {
    assert.throws(() => parseHorizonsVector('no table here\nOutput units    : AU-D\n', epoch), /\$\$SOE/);
  });
  it('rejects missing $$EOE', () => {
    assert.throws(
      () => parseHorizonsVector('Output units    : AU-D\n$$SOE\n X = 1 Y = 0 Z = 0\n VX= 0 VY= 0 VZ= 0\n', epoch),
      /\$\$EOE/,
    );
  });
  it('rejects missing velocity', () => {
    const t = `Output units    : AU-D\n$$SOE\n X = 1 Y = 0 Z = 0\n$$EOE`;
    assert.throws(() => parseHorizonsVector(t, epoch), /VX/);
  });
  it('rejects KM-S units', () => {
    const t = `Output units    : KM-S\n$$SOE\n X = 1 Y = 0 Z = 0\n VX= 0 VY= 0 VZ= 0\n$$EOE`;
    assert.throws(() => parseHorizonsVector(t, epoch), /AU-D/);
  });
  it('rejects non-finite numbers', () => {
    const t = `Output units    : AU-D\n$$SOE\n X = foo Y = 0 Z = 0\n VX= 0 VY= 0 VZ= 0\n$$EOE`;
    assert.throws(() => parseHorizonsVector(t, epoch));
  });
  it('uses the first sample when several are present', () => {
    const t = `Output units    : AU-D
$$SOE
2461294.500000000 = A.D. 2026-Sep-11 00:00:00.0000 TDB
 X = 1.0 Y = 0.0 Z = 0.0
 VX= 0.0 VY= 0.0 VZ= 0.0
2461294.500694444 = A.D. 2026-Sep-11 00:01:00.0000 TDB
 X = 9.0 Y = 9.0 Z = 9.0
 VX= 1.0 VY= 1.0 VZ= 1.0
$$EOE`;
    const p = parseHorizonsVector(t, epoch);
    assert.equal(p.sampleCount, 2);
    assert.equal(p.state.position.x, 1);
  });
});

describe('Collision radius vs render / 3D / swept', () => {
  const mk = (x: number, y: number, z: number, physical: number, render: number, vx = 0, name = 'A'): BodySpec => ({
    name, mass: 1e-6, physicalRadius: physical, renderRadius: render, collisionRadius: physical,
    x, y, z, vx, vy: 0, vz: 0, color: '#fff',
  });

  it('visual overlap does not collide', () => {
    const e = new Engine();
    e.dt = 1e-6;
    e.collisionsEnabled = true;
    e.reset([mk(0, 0, 0, 0.001, 1, 0, 'A'), mk(0.5, 0, 0, 0.001, 1, 0, 'B')]);
    e.step();
    assert.equal(e.bodies.length, 2);
  });

  it('physical overlap does collide', () => {
    const e = new Engine();
    e.dt = 1e-6;
    e.collisionsEnabled = true;
    e.reset([mk(0, 0, 0, 0.2, 0.001, 0, 'A'), mk(0.1, 0, 0, 0.2, 0.001, 0, 'B')]);
    e.step();
    assert.equal(e.bodies.length, 1);
  });

  it('z-axis collisions are detected', () => {
    const e = new Engine();
    e.dt = 1e-6;
    e.collisionsEnabled = true;
    e.reset([mk(0, 0, 0, 0.2, 0.001, 0, 'A'), mk(0, 0, 0.1, 0.2, 0.001, 0, 'B')]);
    e.step();
    assert.equal(e.bodies.length, 1, 'must collide along z, not only xy');
  });

  it('high-speed swept collision does not tunnel', () => {
    const e = new Engine();
    e.dt = 0.02;
    e.collisionsEnabled = true;
    e.reset([
      mk(0, 0, 0, 0.05, 0.001, 0, 'A'),
      mk(0.5, 0, 0, 0.05, 0.001, -80, 'B'),
    ]);
    e.step();
    assert.equal(e.bodies.length, 1, 'swept test must catch the crossing');
  });
});

describe('Constants systems', () => {
  it('DE440 μ☉ differs from 4π² by ~4e-5, GAME stays Gaussian', () => {
    const rel = Math.abs(GM_SUN_AU3_YR2 - G0) / G0;
    assert.ok(rel > 1e-5 && rel < 1e-4, `rel=${rel}`);
    const game = new Engine();
    assert.equal(game.constants.id, 'gaussian');
    game.setConstants('de440');
    assert.equal(game.constants.id, 'de440');
    assert.ok(Math.abs(game.G - DE440_CONSTANTS.muSun) < 1e-12);
  });
});

describe('Browser does not talk to NASA', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('horizonsClient has no NASA URL and only posts to /api/horizons', () => {
    const src = readFileSync(join(here, 'ephemeris/horizonsClient.ts'), 'utf8');
    assert.ok(!/ssd\.jpl\.nasa\.gov/.test(src));
    assert.ok(src.includes('/api/horizons'));
  });
  it('engine has no NASA URL and does not fetch', () => {
    const src = readFileSync(join(here, 'engine.ts'), 'utf8');
    assert.ok(!/ssd\.jpl\.nasa\.gov/.test(src));
    assert.ok(!/\bfetch\s*\(/.test(src));
  });
});
