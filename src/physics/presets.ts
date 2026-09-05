import { G0 } from './engine';
import type { BodySpec, Preset } from './types';

const TWO_PI = Math.PI * 2;

/** Circular orbital speed around mass M at distance r. */
export const circularSpeed = (M: number, r: number): number => Math.sqrt((G0 * M) / r);

interface PlanetOpts {
  key?: string;
  isStar?: boolean;
  ring?: boolean;
  ecc?: number; // speed multiplier for slight eccentricity
}

/** Create a body on a (near) circular orbit around a central mass M at origin. */
export function orbiting(
  name: string,
  a: number,
  mass: number,
  radius: number,
  color: string,
  angleDeg: number,
  M = 1,
  opts: PlanetOpts = {},
  center: { x: number; y: number; vx: number; vy: number } = { x: 0, y: 0, vx: 0, vy: 0 },
): BodySpec {
  const th = (angleDeg * Math.PI) / 180;
  const v = circularSpeed(M, a) * (opts.ecc ?? 1);
  return {
    name,
    key: opts.key,
    mass,
    radius,
    color,
    x: center.x + a * Math.cos(th),
    y: center.y + a * Math.sin(th),
    vx: center.vx - v * Math.sin(th),
    vy: center.vy + v * Math.cos(th),
    isStar: opts.isStar,
    ring: opts.ring,
  };
}

/** Give the central star a velocity so that total momentum is zero. */
function balance(bodies: BodySpec[], starIndex = 0): BodySpec[] {
  let px = 0;
  let py = 0;
  bodies.forEach((b, i) => {
    if (i === starIndex) return;
    px += b.mass * b.vx;
    py += b.mass * b.vy;
  });
  const s = bodies[starIndex];
  s.vx = -px / s.mass;
  s.vy = -py / s.mass;
  return bodies;
}

export const SUN: BodySpec = {
  name: '太阳',
  key: 'sun',
  mass: 1,
  radius: 0.09,
  x: 0, y: 0, vx: 0, vy: 0,
  color: '#ffd27a',
  isStar: true,
};

export const PLANETS = {
  mercury: (deg = 40) => orbiting('水星', 0.387, 1.66e-7, 0.012, '#b8b0a6', deg, 1, { key: 'mercury' }),
  venus: (deg = 130) => orbiting('金星', 0.723, 2.45e-6, 0.02, '#e8c27a', deg, 1, { key: 'venus' }),
  earth: (deg = 0) => orbiting('地球', 1.0, 3.0e-6, 0.021, '#4f9de8', deg, 1, { key: 'earth' }),
  mars: (deg = 250) => orbiting('火星', 1.524, 3.2e-7, 0.015, '#e0684a', deg, 1, { key: 'mars' }),
  jupiter: (deg = 300) => orbiting('木星', 5.203, 9.55e-4, 0.055, '#d9a066', deg, 1, { key: 'jupiter' }),
  saturn: (deg = 200) => orbiting('土星', 9.537, 2.86e-4, 0.048, '#e6d3a3', deg, 1, { key: 'saturn', ring: true }),
  uranus: (deg = 80) => orbiting('天王星', 19.19, 4.37e-5, 0.034, '#9fe0e8', deg, 1, { key: 'uranus' }),
  neptune: (deg = 160) => orbiting('海王星', 30.07, 5.15e-5, 0.033, '#4b6fe0', deg, 1, { key: 'neptune' }),
};

function asteroidBelt(count: number, rMin: number, rMax: number, seed = 7): BodySpec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: BodySpec[] = [];
  for (let i = 0; i < count; i++) {
    const a = rMin + (rMax - rMin) * rnd();
    const deg = rnd() * 360;
    const ecc = 0.96 + rnd() * 0.08;
    const g = 120 + Math.floor(rnd() * 60);
    out.push(
      orbiting(`小行星-${i + 1}`, a, 1e-12, 0.004, `rgb(${g},${g - 10},${g - 25})`, deg, 1, { ecc }),
    );
  }
  return out;
}

/** 柯伊伯带:30~50 AU 的灰蓝色小天体,质量可忽略。 */
function kuiperBelt(count: number, rMin: number, rMax: number, seed = 21): BodySpec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: BodySpec[] = [];
  for (let i = 0; i < count; i++) {
    const a = rMin + (rMax - rMin) * rnd();
    const deg = rnd() * 360;
    const ecc = 0.96 + rnd() * 0.08;
    const g = 130 + Math.floor(rnd() * 50);
    out.push(
      orbiting(`柯伊伯-${i + 1}`, a, 1e-12, 0.004, `rgb(${g - 25},${g},${g + 25})`, deg, 1, { ecc }),
    );
  }
  return out;
}

export const PRESETS: Preset[] = [
  {
    id: 'solar',
    name: '太阳系',
    description: '太阳与八大行星，真实质量与轨道半径',
    viewRadius: 6.5,
    bodies: balance([
      { ...SUN },
      PLANETS.mercury(), PLANETS.venus(), PLANETS.earth(), PLANETS.mars(),
      PLANETS.jupiter(), PLANETS.saturn(), PLANETS.uranus(), PLANETS.neptune(),
    ]),
  },
  {
    id: 'belt',
    name: '内太阳系 + 小行星带',
    description: '类地行星、木星与 160 颗小行星',
    viewRadius: 4,
    bodies: balance([
      { ...SUN },
      PLANETS.mercury(), PLANETS.venus(), PLANETS.earth(), PLANETS.mars(), PLANETS.jupiter(),
      ...asteroidBelt(160, 2.1, 3.3),
    ]),
  },
  {
    id: 'binary',
    name: '双星系统',
    description: '两颗恒星互相绕转，外围环双星行星',
    viewRadius: 6,
    bodies: (() => {
      const m = 0.6;
      const d = 1.0;
      const vRel = circularSpeed(2 * m, d);
      const v = vRel / 2;
      const stars: BodySpec[] = [
        { name: '主星 A', key: 'starA', mass: m, radius: 0.07, x: -d / 2, y: 0, vx: 0, vy: -v, color: '#ffb36b', isStar: true },
        { name: '伴星 B', key: 'starB', mass: m, radius: 0.06, x: d / 2, y: 0, vx: 0, vy: v, color: '#8fd3ff', isStar: true },
      ];
      const M = 2 * m;
      return [
        ...stars,
        orbiting('塔图因', 3.0, 3e-6, 0.022, '#d9b36b', 20, M, { key: 'tatooine' }),
        orbiting('开普勒-16b', 4.6, 3e-4, 0.045, '#8fb7d9', 200, M, { key: 'kepler16b' }),
        orbiting('远星', 7.5, 2e-5, 0.03, '#b9a8e8', 110, M),
      ];
    })(),
  },
  {
    id: 'three',
    name: '三体（8 字轨道）',
    description: '经典周期解——但任何扰动都会使其崩溃',
    viewRadius: 2.2,
    bodies: (() => {
      const k = Math.sqrt(G0);
      const p = [0.97000436, -0.24308753];
      const v = [0.4662036850, 0.4323657300];
      return [
        { name: '恒星 α', key: 'alpha', mass: 1, radius: 0.045, x: p[0], y: p[1], vx: v[0] * k, vy: v[1] * k, color: '#ff8a65', isStar: true },
        { name: '恒星 β', key: 'beta', mass: 1, radius: 0.045, x: -p[0], y: -p[1], vx: v[0] * k, vy: v[1] * k, color: '#7fd1ff', isStar: true },
        { name: '恒星 γ', key: 'gamma', mass: 1, radius: 0.045, x: 0, y: 0, vx: -2 * v[0] * k, vy: -2 * v[1] * k, color: '#fff59d', isStar: true },
      ] as BodySpec[];
    })(),
  },
  {
    id: 'empty',
    name: '沙盒（仅太阳）',
    description: '从零开始构建你自己的星系',
    viewRadius: 4,
    bodies: [{ ...SUN }],
  },
  {
    id: 'kuiper',
    name: '外太阳系 + 柯伊伯带',
    description: '四颗巨行星、冥王星与阋神星,及 150 颗柯伊伯带天体',
    viewRadius: 55,
    bodies: balance([
      { ...SUN },
      PLANETS.jupiter(300), PLANETS.saturn(200), PLANETS.uranus(80), PLANETS.neptune(160),
      orbiting('冥王星', 39.5, 6.5e-9, 0.008, '#c9b8a8', 10, 1, { key: 'pluto', ecc: 0.85 }),
      orbiting('阋神星', 45, 8e-9, 0.007, '#e8e4da', 250, 1, { ecc: 1.1 }),
      ...kuiperBelt(150, 30, 50),
    ]),
  },
  {
    id: 'jupiterMoons',
    name: '木星系',
    description: '木星与四颗伽利略卫星(轨道距离经放大以便观察)',
    viewRadius: 0.2,
    dt: 0.0002,
    bodies: balance([
      { name: '木星', key: 'jupiter', mass: 9.55e-4, radius: 0.008, x: 0, y: 0, vx: 0, vy: 0, color: '#d9a066' },
      orbiting('木卫一·伊奥', 0.03, 3e-8, 0.003, '#e8d27a', 20, 9.55e-4, { key: 'io' }),
      orbiting('木卫二·欧罗巴', 0.048, 1.6e-8, 0.0025, '#d7e8f5', 140, 9.55e-4, { key: 'europa' }),
      orbiting('木卫三·盖尼米得', 0.075, 5e-8, 0.004, '#a89f91', 260, 9.55e-4, { key: 'ganymede' }),
      orbiting('木卫四·卡利斯托', 0.13, 3.6e-8, 0.0035, '#7d7468', 60, 9.55e-4, { key: 'callisto' }),
    ]),
  },
  {
    id: 'trappist',
    name: 'TRAPPIST-1',
    description: '0.09 倍太阳质量红矮星与 7 颗岩质行星(轨道按比例放大,真实仅 0.011~0.063 AU)',
    viewRadius: 0.4,
    dt: 2e-5,
    bodies: balance([
      { name: 'TRAPPIST-1', key: 'trappist1', mass: 0.09, radius: 0.035, x: 0, y: 0, vx: 0, vy: 0, color: '#ff7a5c', isStar: true },
      orbiting('TRAPPIST-1 b', 0.05, 2.8e-6, 0.007, '#e0684a', 10, 0.09),
      orbiting('TRAPPIST-1 c', 0.069, 2.5e-6, 0.0065, '#e8c27a', 80, 0.09),
      orbiting('TRAPPIST-1 d', 0.097, 1.2e-6, 0.0045, '#7dd3a0', 150, 0.09),
      orbiting('TRAPPIST-1 e', 0.127, 1.8e-6, 0.0055, '#4f9de8', 210, 0.09),
      orbiting('TRAPPIST-1 f', 0.167, 2e-6, 0.006, '#b9a8e8', 280, 0.09),
      orbiting('TRAPPIST-1 g', 0.204, 2.6e-6, 0.0065, '#d9a066', 330, 0.09),
      orbiting('TRAPPIST-1 h', 0.269, 1e-6, 0.004, '#9fe0e8', 190, 0.09),
    ]),
  },
];

/* ---------- Random system generator (not in PRESETS, call on demand) ---------- */

/** 确定性随机数,相同 seed 产生相同星系。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按质量分档给显示半径(量级参考 LAUNCH_TYPES)。 */
function radiusForMass(m: number): number {
  if (m < 1e-9) return 0.006;
  if (m < 1e-6) return 0.012;
  if (m < 1e-5) return 0.02;
  if (m < 1e-4) return 0.03;
  return 0.05;
}

const RANDOM_COLORS = ['#4f9de8', '#e0684a', '#d9a066', '#9fe0e8', '#b9a8e8', '#7dd3a0', '#e8c27a'];

export function generateRandomSystem(seed: number): Preset {
  const rnd = mulberry32(seed);
  const starMass = 0.5 + rnd() * 1.0; // 0.5~1.5 太阳质量
  const binary = rnd() < 0.15;
  const bodies: BodySpec[] = [];
  if (binary) {
    const d = 0.6 + rnd() * 0.6; // 双星间距 0.6~1.2 AU
    const m = starMass / 2;
    const v = circularSpeed(starMass, d) / 2;
    bodies.push(
      { name: '主星 A', mass: m, radius: 0.07, x: -d / 2, y: 0, vx: 0, vy: -v, color: '#ffb36b', isStar: true },
      { name: '伴星 B', mass: m, radius: 0.06, x: d / 2, y: 0, vx: 0, vy: v, color: '#8fd3ff', isStar: true },
    );
  } else {
    bodies.push(
      { name: '恒星', mass: starMass, radius: 0.09, x: 0, y: 0, vx: 0, vy: 0, color: '#ffd27a', isStar: true },
    );
  }
  const nPlanets = 2 + Math.floor(rnd() * 6); // 2~7 颗行星
  let a = 0.3 + rnd() * 0.3; // 起始 0.3~0.6 AU
  for (let i = 0; i < nPlanets; i++) {
    if (i > 0) a *= 1.4 + rnd() * 0.6; // 间距比 1.4~2.0
    const mass = Math.pow(10, -7 + rnd() * 4); // 1e-7~1e-3 对数均匀
    bodies.push(
      orbiting(`行星-${i + 1}`, a, mass, radiusForMass(mass), RANDOM_COLORS[i % RANDOM_COLORS.length], rnd() * 360, starMass),
    );
  }
  let outer = a;
  if (rnd() < 0.3) {
    const count = 40 + Math.floor(rnd() * 41); // 40~80 颗
    const rMin = a * 1.4;
    const rMax = a * 2.0;
    for (let i = 0; i < count; i++) {
      const ba = rMin + (rMax - rMin) * rnd();
      const deg = rnd() * 360;
      const ecc = 0.96 + rnd() * 0.08;
      const g = 120 + Math.floor(rnd() * 60);
      bodies.push(
        orbiting(`小行星-${i + 1}`, ba, 1e-12, 0.004, `rgb(${g},${g - 10},${g - 25})`, deg, starMass, { ecc }),
      );
    }
    outer = rMax;
  }
  if (binary) {
    // 双星自身动量已平衡,只把行星/小行星动量均摊到两星(相对速度不变)
    let px = 0;
    let py = 0;
    for (let i = 2; i < bodies.length; i++) {
      px += bodies[i].mass * bodies[i].vx;
      py += bodies[i].mass * bodies[i].vy;
    }
    const mTot = bodies[0].mass + bodies[1].mass;
    for (let i = 0; i < 2; i++) {
      bodies[i].vx -= px / mTot;
      bodies[i].vy -= py / mTot;
    }
  } else {
    balance(bodies, 0);
  }
  return {
    id: 'random',
    name: `随机星系 #${seed}`,
    description: `随机生成的${binary ? '双星' : '单星'}系统(种子 ${seed},${nPlanets} 颗行星)`,
    viewRadius: outer * 1.3,
    bodies,
  };
}

/* ---------- Launch presets for user-created bodies ---------- */

export interface LaunchType {
  id: string;
  name: string;
  mass: number;
  radius: number;
  color: string;
  isStar?: boolean;
}

export const LAUNCH_TYPES: LaunchType[] = [
  { id: 'asteroid', name: '小行星', mass: 1e-11, radius: 0.006, color: '#a8a29e' },
  { id: 'comet', name: '彗星', mass: 5e-11, radius: 0.007, color: '#c7f5ff' },
  { id: 'rocky', name: '岩质行星', mass: 3e-6, radius: 0.02, color: '#7dd3a0' },
  { id: 'giant', name: '气态巨行星', mass: 1e-3, radius: 0.05, color: '#f0a06a' },
  { id: 'dwarf', name: '红矮星', mass: 0.15, radius: 0.06, color: '#ff7a5c', isStar: true },
  { id: 'star', name: '恒星', mass: 1, radius: 0.09, color: '#ffe082', isStar: true },
];

/* ---------- Spawnable events ---------- */

let eventCounter = 0;

export function rogueStar(center: { x: number; y: number }): BodySpec {
  eventCounter++;
  const ang = Math.random() * TWO_PI;
  const dist = 28;
  const x = center.x + Math.cos(ang) * dist;
  const y = center.y + Math.sin(ang) * dist;
  // aim slightly off-center for a close fly-by
  const offset = (Math.random() - 0.5) * 3;
  const tx = center.x + Math.cos(ang + Math.PI / 2) * offset;
  const ty = center.y + Math.sin(ang + Math.PI / 2) * offset;
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy);
  const speed = 7;
  return {
    name: `流浪恒星-${eventCounter}`,
    mass: 0.4,
    radius: 0.065,
    x, y,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    color: '#ff6b6b',
    isStar: true,
  };
}

export function asteroidShower(center: { x: number; y: number }, count = 25): BodySpec[] {
  const out: BodySpec[] = [];
  const baseAng = Math.random() * TWO_PI;
  for (let i = 0; i < count; i++) {
    eventCounter++;
    const ang = baseAng + (Math.random() - 0.5) * 0.6;
    const dist = 14 + Math.random() * 4;
    const x = center.x + Math.cos(ang) * dist;
    const y = center.y + Math.sin(ang) * dist;
    const offset = (Math.random() - 0.5) * 5;
    const tx = center.x + Math.cos(ang + Math.PI / 2) * offset;
    const ty = center.y + Math.sin(ang + Math.PI / 2) * offset;
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy);
    const speed = 2.5 + Math.random() * 2;
    out.push({
      name: `陨石-${eventCounter}`,
      mass: 1e-11,
      radius: 0.005,
      x, y,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      color: '#cbd5e1',
    });
  }
  return out;
}

export function longPeriodComet(sun: { x: number; y: number; vx: number; vy: number; mass: number }): BodySpec {
  eventCounter++;
  const rp = 0.45; // perihelion
  const a = 18; // semi-major axis
  const v = Math.sqrt(G0 * sun.mass * (2 / rp - 1 / a));
  const th = Math.random() * TWO_PI;
  return {
    name: `彗星-${eventCounter}`,
    mass: 5e-11,
    radius: 0.008,
    x: sun.x + rp * Math.cos(th),
    y: sun.y + rp * Math.sin(th),
    vx: sun.vx - v * Math.sin(th),
    vy: sun.vy + v * Math.cos(th),
    color: '#bff7ff',
  };
}
