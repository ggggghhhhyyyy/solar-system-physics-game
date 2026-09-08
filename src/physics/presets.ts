import { G0 } from './engine';
import type { BodySpec, Preset } from './types';

const TWO_PI = Math.PI * 2;

/** Circular orbital speed around mass M at distance r. */
export const circularSpeed = (M: number, r: number): number => Math.sqrt((G0 * M) / r);

interface PlanetOpts {
  key?: string;
  isStar?: boolean;
  isBlackHole?: boolean;
  /** 碎块/气流粒子:互相之间不合并,但仍可撞击行星或被黑洞吸积 */
  noCollide?: boolean;
  ring?: boolean;
  ecc?: number; // speed multiplier for slight eccentricity
  retro?: boolean; // 逆行轨道(如海卫一 Triton)
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
  const v = circularSpeed(M, a) * (opts.ecc ?? 1) * (opts.retro ? -1 : 1);
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
    isBlackHole: opts.isBlackHole,
    noCollide: opts.noCollide,
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
      orbiting(`小行星-${i + 1}`, a, 1e-12, 0.003, `rgb(${g},${g - 10},${g - 25})`, deg, 1, { ecc, noCollide: true }),
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
      orbiting(`柯伊伯-${i + 1}`, a, 1e-12, 0.003, `rgb(${g - 25},${g},${g + 25})`, deg, 1, { ecc, noCollide: true }),
    );
  }
  return out;
}

interface MoonDef {
  name: string;
  key?: string;
  a: number; // AU,相对行星
  mass: number; // 太阳质量
  radius: number; // AU(显示/碰撞,经放大以便观察)
  color: string;
  angle: number;
  retro?: boolean;
  ecc?: number;
}

/**
 * 给已定轨的行星挂卫星:位置=行星位置+相对偏移,速度=行星速度+绕行星圆轨道速度。
 * 注意:行星显示半径必须小于卫星轨道(否则出生即碰撞),且轨道应在希尔球 ~0.4 倍以内才长期稳定。
 */
function moonsOf(planet: BodySpec, defs: MoonDef[]): BodySpec[] {
  const center = { x: planet.x, y: planet.y, vx: planet.vx, vy: planet.vy };
  return defs.map((m) =>
    orbiting(m.name, m.a, m.mass, m.radius, m.color, m.angle, planet.mass, {
      key: m.key,
      ecc: m.ecc,
      retro: m.retro,
    }, center),
  );
}

/** 内圈小行星群(祝融区/近水星区概念,0.09~0.2 AU),展示内圈拓展。 */
function innerSwarm(count: number, rMin: number, rMax: number, seed = 41): BodySpec[] {
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
    const g = 150 + Math.floor(rnd() * 50);
    out.push(
      orbiting(`内圈小行星-${i + 1}`, a, 1e-12, 0.0015, `rgb(${g},${g - 20},${g - 60})`, deg, 1, { ecc, noCollide: true }),
    );
  }
  return out;
}

/** 近地小行星群(0.7~1.5 AU)。 */
function nearEarthSwarm(count: number, seed = 53): BodySpec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: BodySpec[] = [];
  for (let i = 0; i < count; i++) {
    const a = 0.7 + (1.5 - 0.7) * rnd();
    const deg = rnd() * 360;
    const ecc = 0.9 + rnd() * 0.2;
    out.push(
      orbiting(`近地小行星-${i + 1}`, a, 1e-12, 0.0015, '#d6c9a8', deg, 1, { ecc, noCollide: true }),
    );
  }
  return out;
}

/** 木星特洛伊群:与木星同轨道、前后各 60°(L4/L5)附近。 */
function trojans(jupiterAngleDeg: number, jupiterA: number, countPerCamp: number, seed = 77): BodySpec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: BodySpec[] = [];
  for (let c = 0; c < 2; c++) {
    const camp = c === 0 ? '希腊营' : '特洛伊营';
    const base = jupiterAngleDeg + (c === 0 ? 60 : -60);
    for (let i = 0; i < countPerCamp; i++) {
      const a = jupiterA * (0.985 + rnd() * 0.03);
      const deg = base + (rnd() - 0.5) * 28;
      const ecc = 0.96 + rnd() * 0.08;
      const g = 140 + Math.floor(rnd() * 50);
      out.push(
        orbiting(`特洛伊-${camp}-${i + 1}`, a, 1e-12, 0.0025, `rgb(${g},${g - 15},${g - 40})`, deg, 1, { ecc, noCollide: true }),
      );
    }
  }
  return out;
}

/* ---------- 黑洞 ---------- */

export const BLACK_HOLE_LAUNCH_MASS = 4;

function blackHole(
  name: string,
  mass: number,
  radius: number,
  x: number, y: number, vx: number, vy: number,
  key?: string,
): BodySpec {
  return {
    name, key, mass, radius, x, y, vx, vy,
    color: '#a78bfa',
    isBlackHole: true,
  };
}

/** 吸积盘粒子:绕黑洞质量 M 的暖色小颗粒,内密外疏。 */
function accretionDisk(
  M: number,
  center: { x: number; y: number; vx: number; vy: number },
  count: number, rMin: number, rMax: number, seed = 99,
): BodySpec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const palette = ['#fef3c7', '#fde68a', '#fbbf24', '#fb923c', '#f97316'];
  const out: BodySpec[] = [];
  for (let i = 0; i < count; i++) {
    // 内密外疏:平方根分布偏向内圈
    const f = Math.sqrt(rnd());
    const a = rMin + (rMax - rMin) * f;
    const deg = rnd() * 360;
    const ecc = 0.99 + rnd() * 0.02;
    out.push(
      orbiting(`吸积流-${i + 1}`, a, 1e-13, 0.0012, palette[Math.floor(rnd() * palette.length)], deg, M, { ecc, noCollide: true }, center),
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
    id: 'grand',
    name: '完整太阳系 · 内圈+外圈',
    description: '八大行星+20 颗卫星+内圈/近地/小行星带/特洛伊/柯伊伯带,行星半径经压缩以容纳卫星',
    viewRadius: 60,
    dt: 0.0002,
    softening: 0.00015,
    bodies: (() => {
      // 行星半径经压缩(相对 PLANETS 缩小),保证卫星轨道不与行星碰撞且位于希尔球内
      const mercury = orbiting('水星', 0.387, 1.66e-7, 0.0004, '#b8b0a6', 40, 1, { key: 'mercury' });
      const venus = orbiting('金星', 0.723, 2.45e-6, 0.0008, '#e8c27a', 130, 1, { key: 'venus' });
      const earth = orbiting('地球', 1.0, 3.0e-6, 0.0008, '#4f9de8', 0, 1, { key: 'earth' });
      const mars = orbiting('火星', 1.524, 3.2e-7, 0.0004, '#e0684a', 250, 1, { key: 'mars' });
      const jupiter = orbiting('木星', 5.203, 9.55e-4, 0.004, '#d9a066', 300, 1, { key: 'jupiter' });
      const saturn = orbiting('土星', 9.537, 2.86e-4, 0.0034, '#e6d3a3', 200, 1, { key: 'saturn', ring: true });
      const uranus = orbiting('天王星', 19.19, 4.37e-5, 0.0018, '#9fe0e8', 80, 1, { key: 'uranus' });
      const neptune = orbiting('海王星', 30.07, 5.15e-5, 0.0017, '#4b6fe0', 160, 1, { key: 'neptune' });
      const pluto = orbiting('冥王星', 39.5, 6.5e-9, 0.00009, '#c9b8a8', 10, 1, { key: 'pluto', ecc: 0.85 });
      const moons: BodySpec[] = [
        ...moonsOf(earth, [
          { name: '月球', key: 'moon', a: 0.0028, mass: 3.69e-8, radius: 0.00014, color: '#d9d9d9', angle: 60 },
        ]),
        ...moonsOf(mars, [
          { name: '火卫一·福波斯', key: 'phobos', a: 0.0008, mass: 1e-12, radius: 0.00006, color: '#a89f91', angle: 10 },
          { name: '火卫二·戴莫斯', key: 'deimos', a: 0.0013, mass: 1e-12, radius: 0.00005, color: '#8d8578', angle: 190 },
        ]),
        ...moonsOf(jupiter, [
          { name: '木卫一·伊奥', key: 'io', a: 0.0058, mass: 4.5e-8, radius: 0.00015, color: '#e8d27a', angle: 20 },
          { name: '木卫二·欧罗巴', key: 'europa', a: 0.0092, mass: 2.4e-8, radius: 0.00013, color: '#d7e8f5', angle: 140 },
          { name: '木卫三·盖尼米得', key: 'ganymede', a: 0.0145, mass: 7.4e-8, radius: 0.0002, color: '#a89f91', angle: 260 },
          { name: '木卫四·卡利斯托', key: 'callisto', a: 0.025, mass: 5.4e-8, radius: 0.00019, color: '#7d7468', angle: 60 },
        ]),
        ...moonsOf(saturn, [
          { name: '土卫一·弥玛斯', key: 'mimas', a: 0.0042, mass: 1e-12, radius: 0.00006, color: '#cfc8bb', angle: 30 },
          { name: '土卫二·恩克拉多斯', key: 'enceladus', a: 0.0054, mass: 5.4e-11, radius: 0.00005, color: '#eef6ff', angle: 120 },
          { name: '土卫三·特堤斯', key: 'tethys', a: 0.0067, mass: 3.1e-10, radius: 0.00006, color: '#d8d4c8', angle: 210 },
          { name: '土卫四·狄俄涅', key: 'dione', a: 0.0086, mass: 5.5e-10, radius: 0.00007, color: '#c4beb0', angle: 300 },
          { name: '土卫五·瑞亚', key: 'rhea', a: 0.012, mass: 1.16e-9, radius: 0.00008, color: '#b5aea0', angle: 80 },
          { name: '土卫六·泰坦', key: 'titan', a: 0.0165, mass: 6.75e-8, radius: 0.0002, color: '#e0a458', angle: 180 },
        ]),
        ...moonsOf(uranus, [
          { name: '天卫一·艾瑞尔', key: 'ariel', a: 0.0043, mass: 6.8e-10, radius: 0.00007, color: '#cfd6d4', angle: 45 },
          { name: '天卫三·乌姆布里尔', key: 'umbriel', a: 0.006, mass: 6e-10, radius: 0.00007, color: '#9aa0a0', angle: 165 },
          { name: '天卫四·泰坦尼亚', key: 'titania', a: 0.0098, mass: 1.77e-9, radius: 0.00009, color: '#c9c2b4', angle: 285 },
          { name: '天卫五·奥伯龙', key: 'oberon', a: 0.013, mass: 1.52e-9, radius: 0.00009, color: '#b0a89a', angle: 105 },
        ]),
        ...moonsOf(neptune, [
          // 海卫一为逆行大卫星
          { name: '海卫一·特里同', key: 'triton', a: 0.0026, mass: 1.07e-8, radius: 0.00014, color: '#e8f0f2', angle: 200, retro: true },
          { name: '海卫八·普罗透斯', key: 'proteus', a: 0.002, mass: 2.5e-11, radius: 0.00005, color: '#8f8b82', angle: 20 },
        ]),
        ...moonsOf(pluto, [
          { name: '冥卫一·卡戎', key: 'charon', a: 0.0006, mass: 7.9e-10, radius: 0.00007, color: '#b9b0a4', angle: 90 },
        ]),
      ];
      return balance([
        { ...SUN },
        mercury, venus, earth, mars, jupiter, saturn, uranus, neptune,
        pluto,
        orbiting('阋神星', 45, 8e-9, 0.00008, '#e8e4da', 250, 1, { key: 'eris', ecc: 1.1 }),
        orbiting('妊神星', 43.1, 2e-9, 0.00008, '#dfe9ec', 320, 1, { key: 'haumea', ecc: 0.95 }),
        orbiting('鸟神星', 45.5, 1.5e-9, 0.00007, '#d9c8b8', 140, 1, { key: 'makemake' }),
        ...moons,
        ...innerSwarm(14, 0.09, 0.2),
        ...nearEarthSwarm(24),
        ...asteroidBelt(170, 2.06, 3.27),
        ...trojans(300, 5.203, 18),
        ...kuiperBelt(130, 30, 50),
      ]);
    })(),
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
  {
    id: 'blackhole',
    name: '黑洞 · 潮汐吸积',
    description: '12 倍太阳质量黑洞+吸积盘+3 颗伴星,看恒星如何被撕裂吞噬',
    viewRadius: 8,
    dt: 0.0002,
    softening: 0.001,
    bodies: (() => {
      const M = 12;
      const center = { x: 0, y: 0, vx: 0, vy: 0 };
      const bodies: BodySpec[] = [
        blackHole('黑洞 · 恒星级', M, 0.05, 0, 0, 0, 0, 'blackhole'),
        // 伴星取小质量、宽间距(大质量密排会在几个轨道内互相散射)
        orbiting('伴星 S1', 3.0, 0.5, 0.055, '#ffd27a', 20, M, { key: 's1', isStar: true }, center),
        orbiting('伴星 S2', 5.5, 0.3, 0.045, '#8fd3ff', 200, M, { key: 's2', isStar: true }, center),
        orbiting('伴星 S3', 9.0, 0.2, 0.04, '#ff9d7a', 110, M, { key: 's3', isStar: true }, center),
        // 一颗俯冲恒星:远心点出发、近日点直插黑洞视界,演示潮汐吞噬(开场即上演)
        orbiting('遇难恒星', 1.2, 0.4, 0.05, '#fff59d', 300, M, { key: 'doomed', isStar: true, ecc: 0.25 }, center),
        ...accretionDisk(M, center, 150, 0.16, 0.95),
      ];
      return balance(bodies, 0);
    })(),
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
  isBlackHole?: boolean;
}

export const LAUNCH_TYPES: LaunchType[] = [
  { id: 'asteroid', name: '小行星', mass: 1e-11, radius: 0.006, color: '#a8a29e' },
  { id: 'comet', name: '彗星', mass: 5e-11, radius: 0.007, color: '#c7f5ff' },
  { id: 'rocky', name: '岩质行星', mass: 3e-6, radius: 0.02, color: '#7dd3a0' },
  { id: 'giant', name: '气态巨行星', mass: 1e-3, radius: 0.05, color: '#f0a06a' },
  { id: 'dwarf', name: '红矮星', mass: 0.15, radius: 0.06, color: '#ff7a5c', isStar: true },
  { id: 'star', name: '恒星', mass: 1, radius: 0.09, color: '#ffe082', isStar: true },
  { id: 'blackhole', name: '黑洞', mass: BLACK_HOLE_LAUNCH_MASS, radius: 0.035, color: '#a78bfa', isBlackHole: true },
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

export function rogueBlackHole(center: { x: number; y: number }): BodySpec {
  eventCounter++;
  const ang = Math.random() * TWO_PI;
  const dist = 30;
  const x = center.x + Math.cos(ang) * dist;
  const y = center.y + Math.sin(ang) * dist;
  const offset = (Math.random() - 0.5) * 4;
  const tx = center.x + Math.cos(ang + Math.PI / 2) * offset;
  const ty = center.y + Math.sin(ang + Math.PI / 2) * offset;
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy);
  const speed = 6;
  return blackHole(`流浪黑洞-${eventCounter}`, BLACK_HOLE_LAUNCH_MASS, 0.035, x, y, (dx / len) * speed, (dy / len) * speed);
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
