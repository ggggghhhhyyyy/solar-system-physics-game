import type { Engine } from '../physics/engine';
import type { SimEvent } from '../physics/types';

export type MissionDifficulty = '简单' | '进阶' | '挑战';
export type MissionCategory = '发射' | '环绕' | '撞击' | '飞掠' | '守护' | '脑洞';

export interface MissionState {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  progress: number; // 0..1
  hint: string;
  difficulty?: MissionDifficulty;
  emoji?: string;
  stars?: number; // 1-3
  fact?: string;
  category?: MissionCategory;
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
export interface Detector {
  reset(): void;
  onRogueSpawned?(engine: Engine): void;
  processEvents?(events: SimEvent[]): void;
  update(engine: Engine): void;
  progress(engine: Engine): number;
  isDone(engine: Engine): boolean;
}

// 任务定义(供 MissionTracker 与 dailyMissions 复用)
export interface MissionDef {
  id: string;
  title: string;
  desc: string;
  hint: string;
  difficulty: MissionDifficulty;
  emoji: string;
  stars: number; // 1-3
  fact: string; // 给儿童的科普一句话
  category: MissionCategory;
  requiresKeys?: string[];
  make: () => Detector;
}

// 任务1:稳定绕恒星(原逻辑,年数参数化,默认 3 年保持向后兼容)
export function makeOrbitDetector(targetYears: number = ORBIT_YEARS): Detector {
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
    progress(_engine: Engine): number { return orbitBest / targetYears; },
    isDone(_engine: Engine): boolean { return orbitBest >= targetYears; },
  };
}

// 任务2:火星撞击(原逻辑,保留行为不变)
export function makeMarsDetector(): Detector {
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

// 通用撞击检测:任意 userLaunched 天体撞上指定 key 的行星
// (targetName 仅用于文案/排查,判定只用 targetKey;支持 mars/venus/mercury/saturn/jupiter 等)
export function makeImpactDetector(targetKey: string, _targetName: string): Detector {
  void _targetName;
  let hit = false;
  return {
    reset(): void { hit = false; },
    processEvents(events: SimEvent[]): void {
      for (const e of events) {
        if (e.type === 'collision' && e.survivor && e.absorbed) {
          const pair = [e.survivor, e.absorbed];
          if (pair.some((b) => b.userLaunched) && pair.some((b) => b.key === targetKey)) {
            hit = true;
          }
        }
      }
    },
    update(_engine: Engine): void {},
    progress(_engine: Engine): number { return hit ? 1 : 0; },
    isDone(_engine: Engine): boolean { return hit; },
  };
}

// 任务3:木星捕获(原逻辑,保留行为不变)
export function makeMoonDetector(): Detector {
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

// 通用飞掠/捕获检测:userLaunched 天体在目标行星 targetDist AU 内停留 targetYears 年
export function makeFlybyDetector(
  targetKey = 'jupiter',
  targetYears: number = MOON_YEARS,
  targetDist: number = MOON_DIST,
): Detector {
  let best = 0;
  const nearSince = new Map<number, number>();
  return {
    reset(): void { best = 0; nearSince.clear(); },
    update(engine: Engine): void {
      const now = engine.time;
      const target = engine.bodies.find((b) => b.key === targetKey);
      if (!target) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === target) continue;
        const d = Math.hypot(b.x - target.x, b.y - target.y);
        if (d < targetDist) {
          if (!nearSince.has(b.id)) nearSince.set(b.id, now);
          const dur = now - (nearSince.get(b.id) ?? now);
          best = Math.max(best, dur);
        } else {
          nearSince.delete(b.id);
        }
      }
    },
    progress(_engine: Engine): number { return best / targetYears; },
    isDone(_engine: Engine): boolean { return best >= targetYears; },
  };
}

// 任务4:逃离太阳系(原逻辑)
export function makeEscapeDetector(): Detector {
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
export function makeSurviveDetector(): Detector {
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

// 新任务:引力弹弓(原逻辑,目标行星参数化,默认木星保持向后兼容)
export function makeSlingshotDetector(targetKey = 'jupiter'): Detector {
  interface SlingState { inside: boolean; hasEntered: boolean; vIn: number; exitTime: number; best: number; }
  const states = new Map<number, SlingState>();
  let bestGlobal = 0;
  let finished = false;
  return {
    reset(): void { states.clear(); bestGlobal = 0; finished = false; },
    update(engine: Engine): void {
      const sun = engine.heaviest();
      const now = engine.time;
      const jupiter = engine.bodies.find((b) => b.key === targetKey);
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

// 新任务:逆行轨道(原逻辑,年数参数化,默认 3 年保持向后兼容)
export function makeRetrogradeDetector(targetYears: number = RETRO_YEARS): Detector {
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
    progress(_engine: Engine): number { return retroBest / targetYears; },
    isDone(_engine: Engine): boolean { return retroBest >= targetYears; },
  };
}

// 新任务:双星挑战(原逻辑,年数参数化,默认 1 年保持向后兼容)
export function makeBinaryDetector(targetYears: number = BINARY_YEARS): Detector {
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
      if (best >= targetYears) finished = true;
    },
    progress(_engine: Engine): number { return best / targetYears; },
    isDone(_engine: Engine): boolean { return finished; },
  };
}

// 新任务:特洛伊驻留(原逻辑,年数参数化,默认 0.5 年保持向后兼容)
export function makeTrojanDetector(targetYears: number = TROJAN_YEARS): Detector {
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
    progress(_engine: Engine): number { return trojanBest / targetYears; },
    isDone(_engine: Engine): boolean { return trojanBest >= targetYears; },
  };
}

// 新任务:黑洞绕行(原逻辑,年数参数化,默认 1 年保持向后兼容;仅黑洞场景出现)
export function makeBlackHoleDetector(targetYears = 1): Detector {
  let best = 0;
  return {
    reset(): void { best = 0; },
    update(engine: Engine): void {
      const bh = engine.bodies.find((b) => b.isBlackHole);
      const now = engine.time;
      if (!bh) return;
      for (const b of engine.bodies) {
        if (!b.userLaunched || b === bh) continue;
        const age = now - b.createdAt;
        const dx = b.x - bh.x;
        const dy = b.y - bh.y;
        const r = Math.hypot(dx, dy);
        const energy = engine.specificEnergy(b, bh);
        if (energy < 0 && r < 30) {
          best = Math.max(best, age);
        }
      }
    },
    progress(_engine: Engine): number { return best / targetYears; },
    isDone(_engine: Engine): boolean { return best >= targetYears; },
  };
}

// 新任务:黑洞吞噬(原逻辑,仅黑洞场景出现)
export function makeDevouredDetector(): Detector {
  let devoured = false;
  return {
    reset(): void { devoured = false; },
    processEvents(events: SimEvent[]): void {
      for (const e of events) {
        if (e.type === 'collision' && e.survivor?.isBlackHole && e.absorbed?.userLaunched) {
          devoured = true;
        }
      }
    },
    update(_engine: Engine): void {},
    progress(_engine: Engine): number { return devoured ? 1 : 0; },
    isDone(_engine: Engine): boolean { return devoured; },
  };
}

// 教学任务:第一次发射——任意一颗 userLaunched 天体出现即完成
export function makeFirstLaunchDetector(): Detector {
  let launched = false;
  return {
    reset(): void { launched = false; },
    update(engine: Engine): void {
      if (launched) return;
      for (const b of engine.bodies) {
        if (b.userLaunched) {
          launched = true;
          break;
        }
      }
    },
    progress(_engine: Engine): number { return launched ? 1 : 0; },
    isDone(_engine: Engine): boolean { return launched; },
  };
}

// 教学任务:太空碰碰车——任意两个天体相撞即完成
export function makeAnyCollisionDetector(): Detector {
  let bumped = false;
  return {
    reset(): void { bumped = false; },
    processEvents(events: SimEvent[]): void {
      for (const e of events) {
        if (e.type === 'collision' && e.survivor && e.absorbed) {
          bumped = true;
        }
      }
    },
    update(_engine: Engine): void {},
    progress(_engine: Engine): number { return bumped ? 1 : 0; },
    isDone(_engine: Engine): boolean { return bumped; },
  };
}

// 任务模板池:儿童友好文案,难度分布 简单 5 / 进阶 6 / 挑战 4,供 MissionTracker 默认全量与 dailyMissions 复用
export const MISSION_TEMPLATES: MissionDef[] = [
  {
    id: 'first-launch',
    title: '🚀 第一次发射',
    desc: '发射一颗属于你自己的小星星，让它飞向太空！',
    hint: '步骤：1. 点「发射天体」 2. 在太阳旁边按住拖出一个箭头 3. 松手，看它飞出去',
    difficulty: '简单',
    emoji: '🚀',
    stars: 1,
    fact: '火箭要跑得比声音快好多倍，才能挣脱地球的怀抱飞向太空哦！',
    category: '发射',
    make: makeFirstLaunchDetector,
  },
  {
    id: 'orbit-sprout',
    title: '🛰️ 小卫星转圈圈',
    desc: '让你的小星星围着太阳转上 0.5 年，不掉进去也不飞走！',
    hint: '步骤：1. 在太阳旁边发射 2. 箭头朝旁边拉，不要指向太阳 3. 长度适中，看着它转起来',
    difficulty: '简单',
    emoji: '🛰️',
    stars: 1,
    fact: '小星星一边往前飞、一边被引力往下拉，就这样一直转圈圈，这就叫轨道！',
    category: '环绕',
    make: () => makeOrbitDetector(0.5),
  },
  {
    id: 'bump-any',
    title: '💥 太空碰碰车',
    desc: '让任意两个天体撞在一起，碰出大火花！',
    hint: '步骤：1. 朝着一颗行星发射 2. 打开轨迹预测瞄准它 3. 等着看它们撞上吧',
    difficulty: '简单',
    emoji: '💥',
    stars: 1,
    fact: '很久很久以前，月亮可能就是被这样的大碰撞撞出来的哦！',
    category: '撞击',
    make: makeAnyCollisionDetector,
  },
  {
    id: 'mars',
    title: '🔴 亲亲火星',
    desc: '发射一颗小星星，让它和红红的火星撞个满怀！',
    hint: '步骤：1. 打开轨迹预测 2. 瞄准火星前面的位置发射 3. 耐心等它撞上去',
    difficulty: '简单',
    emoji: '🔴',
    stars: 1,
    fact: '火星红红的，是因为表面铺满了生锈的铁粉，它其实是个大锈球！',
    category: '撞击',
    make: () => makeImpactDetector('mars', '火星'),
  },
  {
    id: 'devoured',
    title: '🕳️ 黑洞吃豆豆',
    desc: '喂黑洞吃一颗小星星，看它啊呜一口吞掉！',
    hint: '步骤：1. 去黑洞场景 2. 朝着黑洞轻轻发射 3. 看它被吸进去吧',
    difficulty: '简单',
    emoji: '🕳️',
    stars: 1,
    fact: '黑洞的引力超级大，连跑得最快的光都逃不出来！',
    category: '脑洞',
    requiresKeys: ['blackhole'],
    make: makeDevouredDetector,
  },
  {
    id: 'orbit',
    title: '🌍 稳稳转三年',
    desc: '让你的小星星围着太阳稳稳转上 3 年！',
    hint: '步骤：1. 在 1 AU 附近切向发射 2. 速度约 6.3 AU/年最圆 3. 别让它被行星撞跑',
    difficulty: '进阶',
    emoji: '🌍',
    stars: 2,
    fact: '地球绕太阳转一圈就是一年，你的小星星要一口气过三个生日！',
    category: '环绕',
    make: () => makeOrbitDetector(ORBIT_YEARS),
  },
  {
    id: 'moon',
    title: '🐯 大老虎抱抱',
    desc: '让你的小星星钻进条纹大老虎木星的怀里，陪它玩 0.6 年！',
    hint: '步骤：1. 跟着木星一起飞 2. 在木星附近用和它差不多的速度发射 3. 别跑出 0.25 AU 的小圈圈',
    difficulty: '进阶',
    emoji: '🐯',
    stars: 2,
    fact: '木星是太阳系最大的行星，它的肚子里能装下一千多个地球！',
    category: '飞掠',
    make: () => makeFlybyDetector('jupiter', MOON_YEARS, MOON_DIST),
  },
  {
    id: 'escape',
    title: '💨 逃离太阳系',
    desc: '给小星星足够的力气，让它飞到 45 AU 以外去大冒险！',
    hint: '步骤：1. 拉一个长长的箭头 2. 或者先去木星借力弹弓 3. 看它变成逃逸能量飞走',
    difficulty: '进阶',
    emoji: '💨',
    stars: 2,
    fact: '旅行者 1 号正在飞离太阳系，它还带着一张地球的明信片——金唱片！',
    category: '飞掠',
    make: makeEscapeDetector,
  },
  {
    id: 'slingshot',
    title: '🏹 木星弹弓手',
    desc: '从木星身边嗖地掠过，让速度一下变快 15%！',
    hint: '步骤：1. 从木星运动方向的后方接近 2. 穿过它的希尔球 3. 飞出来时看看速度涨了没',
    difficulty: '进阶',
    emoji: '🏹',
    stars: 2,
    fact: '科学家经常拿行星当弹弓，免费给探测器加速，这叫引力助推！',
    category: '飞掠',
    requiresKeys: ['jupiter'],
    make: () => makeSlingshotDetector('jupiter'),
  },
  {
    id: 'retrograde',
    title: '🔄 倒着转转转',
    desc: '让小星星和大家反着来，倒着围太阳转 3 年！',
    hint: '步骤：1. 先看清行星们转的方向 2. 朝反方向发射 3. 稳住别被拽回去',
    difficulty: '进阶',
    emoji: '🔄',
    stars: 2,
    fact: '大部分行星都朝同一个方向转，但有些小天体偏偏爱逆行，超有个性！',
    category: '环绕',
    make: () => makeRetrogradeDetector(RETRO_YEARS),
  },
  {
    id: 'venus',
    title: '💛 亲亲金星',
    desc: '瞄准亮闪闪的金星，让小星星和它撞个满怀！',
    hint: '步骤：1. 打开轨迹预测 2. 瞄准金星前面的位置发射 3. 耐心等它撞上去',
    difficulty: '进阶',
    emoji: '💛',
    stars: 2,
    fact: '金星上热得可以烤披萨，还是太阳系里转得最慢的一颗星！',
    category: '撞击',
    make: () => makeImpactDetector('venus', '金星'),
  },
  {
    id: 'survive',
    title: '🛡️ 地球小卫士',
    desc: '流浪恒星来捣乱了，保护地球平平安安活过 5 年！',
    hint: '步骤：1. 在太阳系场景点「流浪恒星」 2. 别乱动地球 3. 坚持 5 年不被撞飞',
    difficulty: '挑战',
    emoji: '🛡️',
    stars: 3,
    fact: '地球的磁场和大气层像一床大被子，天天保护着我们！',
    category: '守护',
    make: makeSurviveDetector,
  },
  {
    id: 'binary',
    title: '👯 双胞胎跳舞',
    desc: '发射两颗小星星，让它们手拉手互相转上 1 年！',
    hint: '步骤：1. 发射两颗小星星 2. 让它们靠得近近的慢慢靠近 3. 远离大恒星，别被抢走',
    difficulty: '挑战',
    emoji: '👯',
    stars: 3,
    fact: '天上很多星星都是双胞胎，围着彼此跳一辈子的舞！',
    category: '脑洞',
    make: () => makeBinaryDetector(BINARY_YEARS),
  },
  {
    id: 'trojan',
    title: '🐴 木星跟屁虫',
    desc: '藏到木星轨道前面或后面 60° 的小角落，躲上 0.5 年！',
    hint: '步骤：1. 瞄准木星轨道前后 60° 的位置 2. 用和木星差不多的速度放进去 3. 稳住别溜走',
    difficulty: '挑战',
    emoji: '🐴',
    stars: 3,
    fact: '木星前后藏着一大群特洛伊小行星，是太阳系里的捉迷藏冠军！',
    category: '环绕',
    requiresKeys: ['jupiter'],
    make: () => makeTrojanDetector(TROJAN_YEARS),
  },
  {
    id: 'blackhole-orbit',
    title: '🌀 黑洞边缘跳舞',
    desc: '让小星星围着黑洞转上 1 年，小心别掉进去！',
    hint: '步骤：1. 去黑洞场景 2. 在黑洞旁边切向发射 3. 速度不大不小，刚刚好转圈',
    difficulty: '挑战',
    emoji: '🌀',
    stars: 3,
    fact: '黑洞边上有一圈光在转圈圈，科学家叫它光子球！',
    category: '脑洞',
    requiresKeys: ['blackhole'],
    make: () => makeBlackHoleDetector(1),
  },
];

export class MissionTracker {
  private done = new Set<string>();
  private defs: MissionDef[];
  private detectors = new Map<string, Detector>();

  constructor(defs: MissionDef[] = MISSION_TEMPLATES) {
    this.defs = defs;
    for (const d of this.defs) this.detectors.set(d.id, d.make());
  }

  /** 替换任务组合（每日刷新/换一换用）。preserveDone=true 时保留已完成。 */
  setDefs(defs: MissionDef[], opts?: { preserveDone?: boolean }): void {
    this.defs = defs;
    const keep = opts?.preserveDone ? new Set(this.done) : new Set<string>();
    this.detectors.clear();
    for (const d of this.defs) this.detectors.set(d.id, d.make());
    this.done = keep;
  }

  /** 只清进度不清完成（切换场景用，避免每日完成被清空）。 */
  softReset(): void {
    for (const det of this.detectors.values()) det.reset();
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
        difficulty: def.difficulty, emoji: def.emoji, stars: def.stars,
        fact: def.fact, category: def.category,
      });
    }
    return out;
  }
}
