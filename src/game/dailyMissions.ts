// 每日太空任务调度：基于 missions.MISSION_TEMPLATES，按日期种子抽 简单x1+进阶x1+挑战x1。
// 确定性纯函数 + localStorage 进度封装，隐私模式下静默回退。
import {
  MISSION_TEMPLATES,
  type MissionDef,
  type MissionDifficulty,
} from './missions';

export type { MissionDef };
export { MISSION_TEMPLATES };

export const DAILY_DIFFICULTIES: MissionDifficulty[] = ['简单', '进阶', '挑战'];

/** localStorage 前缀。 */
export const DAILY_STORE_KEY = 'ssp1-daily';

/** 每日可重随次数默认值。 */
export const DAILY_REROLLS_DEFAULT = 3;

export const DAILY_COUNT = 3;
export const DAILY_REROLL_LIMIT = DAILY_REROLLS_DEFAULT;

export interface DailyState {
  doneIds: string[];
  rerollsLeft: number;
  stars: number;
}

const DEFAULT_STATE: DailyState = { doneIds: [], rerollsLeft: DAILY_REROLLS_DEFAULT, stars: 0 };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** YYYY-MM-DD -> y*10000+m*100+d，非法回退哈希。 */
export function dateToSeed(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (Number.isFinite(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return (y * 10000 + mo * 100 + d) >>> 0;
    }
  }
  return hashStr(dateStr);
}

/** 当天 YYYY-MM-DD（本地时区）。 */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function filterByScenario(pool: readonly MissionDef[], scenarioKeys: readonly string[]): MissionDef[] {
  const keys = new Set(scenarioKeys);
  return pool.filter((t) => !t.requiresKeys || t.requiresKeys.every((k) => keys.has(k)));
}

/**
 * 取某日每日任务：简单x1 + 进阶x1 + 挑战x1。
 * 同 category 尽量不重复；某难度过滤后为空则回退不过滤池，保证每天 3 个。
 */
export function getDailyMissions(dateStr: string, scenarioKeys: string[] = []): MissionDef[] {
  const rand = mulberry32(dateToSeed(dateStr));
  const out: MissionDef[] = [];
  const usedCategories = new Set<string>();
  // 无 scenarioKeys（初始化早于引擎）时不过滤，保证 3 个全难度
  const noFilter = scenarioKeys.length === 0;
  for (const diff of DAILY_DIFFICULTIES) {
    const pool = MISSION_TEMPLATES.filter((t) => t.difficulty === diff);
    let candidates = noFilter ? [...pool] : filterByScenario(pool, scenarioKeys);
    if (candidates.length === 0) candidates = [...pool];
    const order = shuffled(candidates, rand);
    const pick = order.find((t) => !usedCategories.has(t.category)) ?? order[0];
    out.push(pick);
    usedCategories.add(pick.category);
  }
  return out;
}

/**
 * 重随某一个每日任务：同难度换一个，排除 excludeIds 与当前槽位 id。
 * 无可换时返回原任务。纯函数。
 */
export function rerollMission(
  dateStr: string,
  index: number,
  scenarioKeys: string[],
  excludeIds: string[],
): MissionDef {
  const current = getDailyMissions(dateStr, scenarioKeys);
  if (!Number.isInteger(index) || index < 0 || index >= current.length) {
    throw new RangeError(`rerollMission: index ${String(index)} 越界`);
  }
  const slot = current[index];
  const pool = MISSION_TEMPLATES.filter((t) => t.difficulty === slot.difficulty);
  const noFilter = scenarioKeys.length === 0;
  let candidates = noFilter ? [...pool] : filterByScenario(pool, scenarioKeys);
  if (candidates.length === 0) candidates = [...pool];
  const exclude = new Set([...excludeIds, slot.id]);
  const rest = candidates.filter((t) => !exclude.has(t.id));
  if (rest.length === 0) return slot;
  const otherCategories = new Set(current.filter((_, i) => i !== index).map((t) => t.category));
  const seed =
    (dateToSeed(dateStr) ^
      Math.imul(index + 1, 0x9e3779b9) ^
      hashStr([...exclude].sort().join(','))) >>>
    0;
  const order = shuffled(rest, mulberry32(seed));
  return order.find((t) => !otherCategories.has(t.category)) ?? order[0];
}

export function getDailyKey(dateStr: string): string {
  return `${DAILY_STORE_KEY}-${dateStr}`;
}

function normalizeState(v: unknown): DailyState {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const doneIds = Array.isArray(o['doneIds'])
    ? [...new Set((o['doneIds'] as unknown[]).filter((x): x is string => typeof x === 'string'))]
    : [];
  const rerollsLeft =
    typeof o['rerollsLeft'] === 'number' && Number.isFinite(o['rerollsLeft'])
      ? Math.max(0, Math.floor(o['rerollsLeft']))
      : DAILY_REROLLS_DEFAULT;
  const stars =
    typeof o['stars'] === 'number' && Number.isFinite(o['stars'])
      ? Math.max(0, Math.floor(o['stars']))
      : 0;
  return { doneIds, rerollsLeft, stars };
}

export function loadDailyState(dateStr: string): DailyState {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_STATE, doneIds: [] };
    const raw = localStorage.getItem(getDailyKey(dateStr));
    if (!raw) return { ...DEFAULT_STATE, doneIds: [] };
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATE, doneIds: [] };
  }
}

export function saveDailyState(dateStr: string, state: DailyState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(getDailyKey(dateStr), JSON.stringify(state));
  } catch {
    // 忽略隐私模式等报错
  }
}
