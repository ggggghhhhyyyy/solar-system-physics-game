import type { Engine } from '../physics/engine';
import type { SimEvent } from '../physics/types';

const KEY = 'ssp1-stats';

export interface Stats {
  launches: number;
  collisionsSeen: number;
  escapesSeen: number;
  missionsDone: string[];
  bestEscapeSpeed: number;
  biggestUserMass: number;
  longestEarthYears: number;
  totalSimYears: number;
  stars: number; // 每完成1个每日任务+1，可累计
  dailyDone: Record<string, string[]>; // date -> [missionId...]
  dailyAllDoneDates: string[]; // 完成当日全部任务的日期
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  check: (s: Stats) => boolean;
}

const DEFAULTS: Stats = {
  launches: 0,
  collisionsSeen: 0,
  escapesSeen: 0,
  missionsDone: [],
  bestEscapeSpeed: 0,
  biggestUserMass: 0,
  longestEarthYears: 0,
  totalSimYears: 0,
  stars: 0,
  dailyDone: {},
  dailyAllDoneDates: [],
};

function normalize(v: unknown): Stats {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, f = 0): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : f;
  const arr = Array.isArray(o['missionsDone'])
    ? (o['missionsDone'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const dailyDone: Record<string, string[]> = {};
  if (typeof o['dailyDone'] === 'object' && o['dailyDone'] !== null) {
    for (const [k, v] of Object.entries(o['dailyDone'] as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        dailyDone[k] = [...new Set(v.filter((x): x is string => typeof x === 'string'))];
      }
    }
  }
  const dailyAllDoneDates = Array.isArray(o['dailyAllDoneDates'])
    ? [...new Set((o['dailyAllDoneDates'] as unknown[]).filter((x): x is string => typeof x === 'string'))]
    : [];
  return {
    launches: num(o['launches']),
    collisionsSeen: num(o['collisionsSeen']),
    escapesSeen: num(o['escapesSeen']),
    missionsDone: [...new Set(arr)],
    bestEscapeSpeed: num(o['bestEscapeSpeed']),
    biggestUserMass: num(o['biggestUserMass']),
    longestEarthYears: num(o['longestEarthYears']),
    totalSimYears: num(o['totalSimYears']),
    stars: num(o['stars']),
    dailyDone,
    dailyAllDoneDates,
  };
}

// 读取统计,失败返回默认值
export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, missionsDone: [] };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS, missionsDone: [] };
  }
}

// 保存统计,隐私模式下静默失败
export function saveStats(s: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 忽略隐私模式等报错
  }
}

// 记录一次发射,mass 用于刷新最大质量
export function recordLaunch(mass?: number): Stats {
  const s = loadStats();
  try {
    s.launches += 1;
    if (typeof mass === 'number' && Number.isFinite(mass) && mass > s.biggestUserMass) {
      s.biggestUserMass = mass;
    }
    saveStats(s);
  } catch {
    // 忽略
  }
  return s;
}

// 记录碰撞/逃逸事件,刷新最快逃逸速度
export function recordEvents(events: SimEvent[]): Stats {
  const s = loadStats();
  try {
    for (const e of events) {
      if (e.type === 'collision') s.collisionsSeen += 1;
      else if (e.type === 'escaped') {
        s.escapesSeen += 1;
        if (e.body) {
          const v = Math.hypot(e.body.vx, e.body.vy);
          if (Number.isFinite(v) && v > s.bestEscapeSpeed) s.bestEscapeSpeed = v;
        }
      }
    }
    saveStats(s);
  } catch {
    // 忽略
  }
  return s;
}

// 记录任务完成(去重)。date 传入 YYYY-MM-DD 时同步记每日进度+星星。
export function recordMissionDone(id: string, date?: string): Stats {
  const s = loadStats();
  try {
    if (!s.missionsDone.includes(id)) {
      s.missionsDone.push(id);
    }
    if (date) {
      const list = s.dailyDone[date] ?? [];
      if (!list.includes(id)) {
        list.push(id);
        s.dailyDone[date] = list;
        s.stars += 1;
      }
    }
    saveStats(s);
  } catch {
    // 忽略
  }
  return s;
}

// 记录某日全部每日任务完成(去重)
export function recordDailyAllDone(date: string): Stats {
  const s = loadStats();
  try {
    if (!s.dailyAllDoneDates.includes(date)) {
      s.dailyAllDoneDates.push(date);
      saveStats(s);
    }
  } catch {
    // 忽略
  }
  return s;
}

// 每轮调用:累加模拟年;地球(key=earth 且 mass<1e-4)存活则累加守护时长
export function recordTick(dtYears: number, engine: Engine): Stats {
  const s = loadStats();
  try {
    if (typeof dtYears === 'number' && Number.isFinite(dtYears) && dtYears > 0) {
      s.totalSimYears += dtYears;
      const earth = engine.bodies.find((b) => b.key === 'earth' && b.mass < 1e-4);
      if (earth) s.longestEarthYears += dtYears;
      saveStats(s);
    }
  } catch {
    // 忽略
  }
  return s;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-launch', title: '初次发射', desc: '完成第一次发射', check: (s) => s.launches >= 1 },
  { id: 'hundred-launch', title: '百次发射', desc: '累计发射 100 次', check: (s) => s.launches >= 100 },
  { id: 'devourer', title: '吞噬者', desc: '目睹 10 次碰撞合并', check: (s) => s.collisionsSeen >= 10 },
  { id: 'escape-master', title: '逃逸大师', desc: '最快逃逸速度超过 10 AU/年', check: (s) => s.bestEscapeSpeed > 10 },
  { id: 'creator', title: '造物主', desc: '发射过质量超过 1e-4 M☉ 的天体', check: (s) => s.biggestUserMass > 1e-4 },
  { id: 'guardian', title: '守护者', desc: '地球存活累计超过 5 年', check: (s) => s.longestEarthYears > 5 },
  { id: 'first-daily', title: '每日首秀', desc: '完成任意 1 个今日太空任务', check: (s) => s.stars >= 1 },
  { id: 'week-star', title: '一周之星', desc: '累计获得 7 颗星星（每日任务每完成1个得1星）', check: (s) => s.stars >= 7 },
  { id: 'completionist', title: '今日全满', desc: '完成今日全部 3 个太空任务', check: (s) => (s.dailyAllDoneDates?.length ?? 0) >= 1 },
];
