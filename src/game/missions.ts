import type { Engine } from '../physics/engine';
import type { SimEvent } from '../physics/types';

export interface MissionState {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  progress: number; // 0..1
  hint: string;
}

const ORBIT_YEARS = 3;
const MOON_YEARS = 0.6;
const MOON_DIST = 0.25;
const ESCAPE_DIST = 45;
const SURVIVE_YEARS = 5;
const RETRO_YEARS = 3;
const BINARY_YEARS = 1;
const TROJAN_YEARS = 0.5;
const SLINGSHOT_GAIN = 0.15; // 需加速 15%
const SLINGSHOT_WINDOW = 0.5; // 离开 1.5*rH 后判定窗口(年)
const SLINGSHOT_EXIT = 1.5; // 离开判定倍数

// 各任务私有状态对象
interface Detector {
  reset(): void;
  onRogueSpawned?(engine: Engine): void;
  processEvents?(events: SimEvent[]): void;
  update(engine: Engine): void;
  progress(engine: Engine): number;
  isDone(engine: Engine): boolean;
}

// 检测器注册表项
interface MissionDef {
  id: string;
  title: string;
  desc: string;
  hint: string;
  requiresKeys?: string[];
  make: () => Detector;
}

// 任务1:稳定绕恒星(原逻辑)
function makeOrbitDetector(): Detector {
  let orbitBest = 0;
  return {
    reset(): void { orbitBest = 0; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      if (!sun) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        const age = now - b.createdAt;
        const dx = b.x - sun.x;
        const dy = b.y - sun.y;
        const r = Math.hypot(dx, dy);
        const energy = engine.specificEnergy(b, sun);
        if (energy < 0 && r < 60) {
          orbitBest = Math.max(orbitBest, age);
        }
      }
    },
    progress(_engine: Engine): number { return orbitBest / ORBIT_YEARS; },
    isDone(_engine: Engine): boolean { return orbitBest >= ORBIT_YEARS; },
  };
}

// 任务2:火星撞击(原逻辑)
function makeMarsDetector(): Detector {
  let marsHit = false;
  return {
    reset(): void { marsHit = false; },
    processEvents(events: SimEvent[]): void {
      for (const e of events) {
        if (e.type === 'collision' && e.survivor && e.absorbed) {
          const pair = [e.survivor, e.absorbed];
          if (pair.some((b) => b.userLaunched) && pair.some((b) => b.key === 'mars')) {
            marsHit = true;
          }
        }
      }
    },
    update(_engine: Engine): void {},
    progress(_engine: Engine): number { return marsHit ? 1 : 0; },
    isDone(_engine: Engine): boolean { return marsHit; },
  };
}

// 任务3:木星捕获(原逻辑)
function makeMoonDetector(): Detector {
  let moonBest = 0;
  const nearJupiterSince = new Map<number, number>();
  return {
    reset(): void { moonBest = 0; nearJupiterSince.clear(); },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      const jupiter = engine.bodies.find((b) => b.key === 'jupiter');
      if (!sun) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        if (jupiter) {
          const dj = Math.hypot(b.x - jupiter.x, b.y - jupiter.y);
          if (dj < MOON_DIST) {
            if (!nearJupiterSince.has(b.id)) nearJupiterSince.set(b.id, now);
            const dur = now - (nearJupiterSince.get(b.id) ?? now);
            moonBest = Math.max(moonBest, dur);
          } else {
            nearJupiterSince.delete(b.id);
          }
        }
      }
    },
    progress(_engine: Engine): number { return moonBest / MOON_YEARS; },
    isDone(_engine: Engine): boolean { return moonBest >= MOON_YEARS; },
  };
}

// 任务4:逃离太阳系(原逻辑)
function makeEscapeDetector(): Detector {
  let escapeBest = 0;
  return {
    reset(): void { escapeBest = 0; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      if (!sun) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        const dx = b.x - sun.x;
        const dy = b.y - sun.y;
        const r = Math.hypot(dx, dy);
        const energy = engine.specificEnergy(b, sun);
        if (energy > 0) {
          escapeBest = Math.max(escapeBest, r);
        }
      }
    },
    progress(_engine: Engine): number { return escapeBest / ESCAPE_DIST; },
    isDone(_engine: Engine): boolean { return escapeBest >= ESCAPE_DIST; },
  };
}

// 任务5:流浪恒星(原逻辑)
function makeSurviveDetector(): Detector {
  let rogueSpawnTime: number | null = null;
  let earthIdAtSpawn: number | null = null;
  let earthAlive = false;
  let surviveProgress = 0;
  let finished = false;
  return {
    reset(): void {
      rogueSpawnTime = null;
      earthIdAtSpawn = null;
      earthAlive = false;
      surviveProgress = 0;
      finished = false;
    },
    onRogueSpawned(engine: Engine): void {
      if (rogueSpawnTime != null && !finished) return;
      if (finished) return;
      const earth = engine.bodies.find((b) => b.key === 'earth');
      if (!earth) return;
      rogueSpawnTime = engine.time;
      earthIdAtSpawn = earth.id;
    },
    update(engine: Engine): void {
      const now = engine.time;
      surviveProgress = 0;
      if (rogueSpawnTime != null && earthIdAtSpawn != null) {
        const earth = engine.getBody(earthIdAtSpawn);
        earthAlive = !!earth && earth.key === 'earth' && earth.mass < 1e-4;
        const elapsed = now - rogueSpawnTime;
        if (earthAlive) {
          surviveProgress = Math.min(1, elapsed / SURVIVE_YEARS);
          if (elapsed >= SURVIVE_YEARS) finished = true;
        } else {
          surviveProgress = 0;
          rogueSpawnTime = null;
        }
      }
    },
    progress(_engine: Engine): number { return surviveProgress; },
    isDone(_engine: Engine): boolean { return finished; },
  };
}

// 新任务:引力弹弓
function makeSlingshotDetector(): Detector {
  interface SlingState { inside: boolean; hasEntered: boolean; vIn: number; exitTime: number; best: number; }
  const states = new Map<number, SlingState>();
  let bestGlobal = 0;
  let finished = false;
  return {
    reset(): void { states.clear(); bestGlobal = 0; finished = false; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      const jupiter = engine.bodies.find((b) => b.key === 'jupiter');
      if (!sun || !jupiter) return;
      const a = Math.hypot(jupiter.x - sun.x, jupiter.y - sun.y);
      const M = sun.mass;
      const m = jupiter.mass;
      if (!(a > 0) || !(M > 0) || !(m > 0)) return;
      const rH = a * Math.cbrt(m / (3 * M));
      if (!(rH > 0)) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        const dJ = Math.hypot(b.x - jupiter.x, b.y - jupiter.y);
        const vSun = Math.hypot(b.vx - sun.vx, b.vy - sun.vy);
        let st = states.get(b.id);
        if (!st) {
          st = { inside: false, hasEntered: false, vIn: 0, exitTime: -Infinity, best: 0 };
          states.set(b.id, st);
        }
        // 进入希尔球:记录相对太阳速度
        if (!st.inside && dJ < rH) {
          st.inside = true;
          st.hasEntered = true;
          st.vIn = vSun;
          st.exitTime = -Infinity;
        } else if (st.inside && dJ > SLINGSHOT_EXIT * rH) {
          // 离开到 1.5*rH
          st.inside = false;
          st.exitTime = now;
        }
        // 历史最佳加速比
        if (st.hasEntered && st.vIn > 1e-9) {
          const ratio = (vSun / st.vIn - 1) / SLINGSHOT_GAIN;
          if (ratio > st.best) st.best = ratio > 1 ? 1 : ratio < 0 ? 0 : ratio;
          if (st.best > bestGlobal) bestGlobal = st.best;
        }
        // 离开后窗口内加速达标则完成
        if (!finished && st.hasEntered && !st.inside && st.vIn > 1e-9
          && now - st.exitTime <= SLINGSHOT_WINDOW && vSun > 1.15 * st.vIn) {
          finished = true;
        }
      }
      // 清理已销毁天体(不影响历史最佳)
      if (states.size > 64) {
        for (const id of [...states.keys()]) {
          if (!engine.getBody(id)) states.delete(id);
        }
      }
    },
    progress(_engine: Engine): number { return finished ? 1 : Math.min(1, Math.max(0, bestGlobal)); },
    isDone(_engine: Engine): boolean { return finished; },
  };
}

// 新任务:逆行轨道
function makeRetrogradeDetector(): Detector {
  let retroBest = 0;
  return {
    reset(): void { retroBest = 0; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      if (!sun) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        const age = now - b.createdAt;
        const dx = b.x - sun.x;
        const dy = b.y - sun.y;
        const r = Math.hypot(dx, dy);
        const energy = engine.specificEnergy(b, sun);
        const Lz = (b.x - sun.x) * (b.vy - sun.vy) - (b.y - sun.y) * (b.vx - sun.vx);
        if (energy < 0 && r < 60 && Lz < 0) {
          retroBest = Math.max(retroBest, age);
        }
      }
    },
    progress(_engine: Engine): number { return retroBest / RETRO_YEARS; },
    isDone(_engine: Engine): boolean { return retroBest >= RETRO_YEARS; },
  };
}

// 新任务:双星挑战
function makeBinaryDetector(): Detector {
  const pairStart = new Map<string, number>();
  let best = 0;
  let finished = false;
  return {
    reset(): void { pairStart.clear(); best = 0; finished = false; },
    update(engine: Engine): void {
      const now = engine.time;
      const launched = engine.bodies.filter((b) => b.userLaunched);
      const seen = new Set<string>();
      for (let i = 0; i < launched.length; i++) {
        for (let j = i + 1; j < launched.length; j++) {
          const b1 = launched[i];
          const b2 = launched[j];
          const minId = Math.min(b1.id, b2.id);
          const maxId = Math.max(b1.id, b2.id);
          const pairKey = `${minId}-${maxId}`;
          seen.add(pairKey);
          if (engine.specificEnergy(b2, b1) < 0) {
            if (!pairStart.has(pairKey)) pairStart.set(pairKey, now);
            const dur = now - (pairStart.get(pairKey) ?? now);
            if (dur > best) best = dur;
          } else {
            pairStart.delete(pairKey);
          }
        }
      }
      // 清理已销毁对
      for (const k of [...pairStart.keys()]) {
        if (!seen.has(k)) pairStart.delete(k);
      }
      if (best >= BINARY_YEARS) finished = true;
    },
    progress(_engine: Engine): number { return best / BINARY_YEARS; },
    isDone(_engine: Engine): boolean { return finished; },
  };
}

// 新任务:特洛伊驻留
function makeTrojanDetector(): Detector {
  let trojanBest = 0;
  return {
    reset(): void { trojanBest = 0; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      const jupiter = engine.bodies.find((b) => b.key === 'jupiter');
      if (!sun || !jupiter) return;
      const rJup = Math.hypot(jupiter.x - sun.x, jupiter.y - sun.y);
      if (!(rJup > 1e-9)) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === sun) continue;
        const age = now - b.createdAt;
        const energy = engine.specificEnergy(b, sun);
        if (!(energy < 0)) continue;
        const rSun = Math.hypot(b.x - sun.x, b.y - sun.y);
        const rToJup = Math.hypot(b.x - jupiter.x, b.y - jupiter.y);
        if (Math.abs(rSun - rJup) / rJup < 0.05 && Math.abs(rToJup - rJup) / rJup < 0.05) {
          trojanBest = Math.max(trojanBest, age);
        }
      }
    },
    progress(_engine: Engine): number { return trojanBest / TROJAN_YEARS; },
    isDone(_engine: Engine): boolean { return trojanBest >= TROJAN_YEARS; },
  };
}

export class MissionTracker {
  private done = new Set<string>();
  private defs: MissionDef[];
  private detectors = new Map<string, Detector>();

  constructor() {
    this.defs = [
      {
        id: 'orbit', title: '入轨',
        desc: `发射一颗天体并使其稳定绕恒星运行 ${ORBIT_YEARS} 年`,
        hint: '提示：在 1 AU 处切向速度约 6.3 AU/年即为圆轨道',
        make: makeOrbitDetector,
      },
      {
        id: 'mars', title: '火星撞击',
        desc: '让你发射的天体与火星相撞',
        hint: '提示：开启轨迹预测，瞄准火星的未来位置',
        make: makeMarsDetector,
      },
      {
        id: 'moon', title: '木星捕获',
        desc: `让你发射的天体在木星 ${MOON_DIST} AU 范围内停留 ${MOON_YEARS} 年`,
        hint: '提示：跟随木星，在木星附近以接近木星的速度发射',
        make: makeMoonDetector,
      },
      {
        id: 'escape', title: '逃离太阳系',
        desc: `发射天体，使其以逃逸能量到达 ${ESCAPE_DIST} AU 之外`,
        hint: '提示：借助木星引力弹弓，或直接拉出一个长箭头',
        make: makeEscapeDetector,
      },
      {
        id: 'survive', title: '流浪恒星',
        desc: `触发"流浪恒星"事件后让地球存活 ${SURVIVE_YEARS} 年（需要有地球）`,
        hint: '提示：太阳系场景中点击「流浪恒星」，然后祈祷…',
        make: makeSurviveDetector,
      },
      {
        id: 'slingshot', title: '引力弹弓',
        desc: '掠过木星希尔球，让相对太阳速度提升 15%',
        hint: '提示：从木星后方（运动方向后侧）掠过',
        requiresKeys: ['jupiter'],
        make: makeSlingshotDetector,
      },
      {
        id: 'retrograde', title: '逆行轨道',
        desc: `让发射物逆行绕恒星运行 ${RETRO_YEARS} 年`,
        hint: '提示：发射方向与行星公转方向相反',
        make: makeRetrogradeDetector,
      },
      {
        id: 'binary', title: '双星挑战',
        desc: `让两颗发射物互相绕转并维持 ${BINARY_YEARS} 年`,
        hint: '提示：让两颗发射物互相绕转并远离恒星',
        make: makeBinaryDetector,
      },
      {
        id: 'trojan', title: '特洛伊驻留',
        desc: `让发射物在木星轨道前后 60° 附近驻留 ${TROJAN_YEARS} 年`,
        hint: '提示：投放到木星轨道前后 60° 附近',
        requiresKeys: ['jupiter'],
        make: makeTrojanDetector,
      },
    ];
    for (const d of this.defs) this.detectors.set(d.id, d.make());
  }

  reset(): void {
    this.done.clear();
    for (const det of this.detectors.values()) det.reset();
  }

  /** Call when a rogue star is spawned so the survival mission can start. */
  onRogueSpawned(engine: Engine): void {
    for (const det of this.detectors.values()) det.onRogueSpawned?.(engine);
  }

  processEvents(events: SimEvent[]): void {
    for (const det of this.detectors.values()) det.processEvents?.(events);
  }

  update(engine: Engine): MissionState[] {
    for (const det of this.detectors.values()) det.update(engine);
    for (const [id, det] of this.detectors) {
      if (det.isDone(engine)) this.done.add(id);
    }
    const keys = new Set<string>();
    for (const b of engine.bodies) {
      if (b.key) keys.add(b.key);
    }
    const out: MissionState[] = [];
    for (const def of this.defs) {
      if (def.requiresKeys && !def.requiresKeys.every((k) => keys.has(k))) continue;
      const det = this.detectors.get(def.id);
      if (!det) continue;
      const raw = det.progress(engine);
      out.push({
        id: def.id, title: def.title, desc: def.desc,
        progress: this.done.has(def.id) ? 1 : Math.min(1, raw),
        done: this.done.has(def.id), hint: def.hint,
      });
    }
    return out;
  }
}
