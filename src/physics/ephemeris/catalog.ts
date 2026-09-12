/**
 * Body identities for the real solar system.
 * Masses: DE440 GM / GM☉. Radii: NASA / IAU mean volumetric.
 * Horizons IDs are adapter metadata — the engine never sees them.
 */
import { PHYSICAL_RADIUS_AU } from '../constants.ts';
import type { EphemerisIdentity } from './types.ts';

export type CatalogKind = 'star' | 'planet' | 'moon' | 'dwarf' | 'spacecraft';

export interface CatalogBody extends EphemerisIdentity {
  key: string;
  horizonsId: string;
  kind: CatalogKind;
}

/**
 * DE440 GM / GM_sun. PHYSICAL MODEL.
 * Satellite GM (km³/s²) / GM_sun (132712440041.279419).
 */
export const MASS_MSUN = {
  sun: 1,
  mercury: 1.660_539_04e-7,
  venus: 2.447_838_3e-6,
  earth: 3.003_489_6e-6,
  moon: 3.694_3e-8,
  mars: 3.227_151_4e-7,
  jupiter: 9.547_919e-4,
  saturn: 2.858_859e-4,
  uranus: 4.366_244e-5,
  neptune: 5.151_389e-5,
  pluto: 6.553e-9,
  io: 4.490_85e-8,
  europa: 2.413_29e-8,
  ganymede: 7.450_57e-8,
  callisto: 5.409_66e-8,
  titan: 6.765_10e-8,
  triton: 1.075_71e-8,
  charon: 7.978e-10,
} as const;

const R = PHYSICAL_RADIUS_AU;

export const SOLAR_SYSTEM_CATALOG: CatalogBody[] = [
  { key: 'sun', horizonsId: '10', kind: 'star', name: '太阳', mass: MASS_MSUN.sun, physicalRadius: R.sun, renderRadius: 0.09, color: '#ffd27a', isStar: true },
  { key: 'mercury', horizonsId: '199', kind: 'planet', name: '水星', mass: MASS_MSUN.mercury, physicalRadius: R.mercury, renderRadius: 0.012, color: '#b8b0a6' },
  { key: 'venus', horizonsId: '299', kind: 'planet', name: '金星', mass: MASS_MSUN.venus, physicalRadius: R.venus, renderRadius: 0.02, color: '#e8c27a' },
  { key: 'earth', horizonsId: '399', kind: 'planet', name: '地球', mass: MASS_MSUN.earth, physicalRadius: R.earth, renderRadius: 0.021, color: '#4f9de8' },
  { key: 'moon', horizonsId: '301', kind: 'moon', name: '月球', mass: MASS_MSUN.moon, physicalRadius: R.moon, renderRadius: 0.008, color: '#d9d9d9' },
  { key: 'mars', horizonsId: '499', kind: 'planet', name: '火星', mass: MASS_MSUN.mars, physicalRadius: R.mars, renderRadius: 0.015, color: '#e0684a' },
  { key: 'jupiter', horizonsId: '599', kind: 'planet', name: '木星', mass: MASS_MSUN.jupiter, physicalRadius: R.jupiter, renderRadius: 0.055, color: '#d9a066' },
  { key: 'saturn', horizonsId: '699', kind: 'planet', name: '土星', mass: MASS_MSUN.saturn, physicalRadius: R.saturn, renderRadius: 0.048, color: '#e6d3a3', ring: true },
  { key: 'uranus', horizonsId: '799', kind: 'planet', name: '天王星', mass: MASS_MSUN.uranus, physicalRadius: R.uranus, renderRadius: 0.034, color: '#9fe0e8' },
  { key: 'neptune', horizonsId: '899', kind: 'planet', name: '海王星', mass: MASS_MSUN.neptune, physicalRadius: R.neptune, renderRadius: 0.033, color: '#4b6fe0' },
  { key: 'pluto', horizonsId: '999', kind: 'dwarf', name: '冥王星', mass: MASS_MSUN.pluto, physicalRadius: R.pluto, renderRadius: 0.008, color: '#c9b8a8' },
  { key: 'io', horizonsId: '501', kind: 'moon', name: '木卫一 伊奥', mass: MASS_MSUN.io, physicalRadius: R.io, renderRadius: 0.007, color: '#e8c36a' },
  { key: 'europa', horizonsId: '502', kind: 'moon', name: '木卫二 欧罗巴', mass: MASS_MSUN.europa, physicalRadius: R.europa, renderRadius: 0.007, color: '#c9b896' },
  { key: 'ganymede', horizonsId: '503', kind: 'moon', name: '木卫三 伽倪墨得', mass: MASS_MSUN.ganymede, physicalRadius: R.ganymede, renderRadius: 0.008, color: '#b8a090' },
  { key: 'callisto', horizonsId: '504', kind: 'moon', name: '木卫四 卡里斯托', mass: MASS_MSUN.callisto, physicalRadius: R.callisto, renderRadius: 0.008, color: '#8a7a6a' },
  { key: 'titan', horizonsId: '606', kind: 'moon', name: '土卫六 泰坦', mass: MASS_MSUN.titan, physicalRadius: R.titan, renderRadius: 0.008, color: '#d4a05a' },
  { key: 'triton', horizonsId: '801', kind: 'moon', name: '海卫一 特里同', mass: MASS_MSUN.triton, physicalRadius: R.triton, renderRadius: 0.007, color: '#c0c8d0' },
  { key: 'charon', horizonsId: '901', kind: 'moon', name: '冥卫一 卡戎', mass: MASS_MSUN.charon, physicalRadius: R.charon, renderRadius: 0.006, color: '#b0a498' },
  spacecraft('voyager1', '-31', '旅行者 1 号', '#fbbf24'),
  spacecraft('voyager2', '-32', '旅行者 2 号', '#f59e0b'),
  spacecraft('juno', '-61', '朱诺号', '#fb7185'),
  spacecraft('parker', '-96', '帕克太阳探测器', '#fb923c'),
  spacecraft('newhorizons', '-98', '新视野号', '#67e8f9'),
  spacecraft('jwst', '-170', '韦伯望远镜', '#e2e8f0'),
];

function spacecraft(key: string, horizonsId: string, name: string, color: string): CatalogBody {
  return {
    key,
    horizonsId,
    kind: 'spacecraft',
    name,
    mass: 0,
    physicalRadius: 6.7e-11,
    renderRadius: 0.01,
    color,
    gravityMode: 'test-particle',
    noCollide: true,
  };
}

export function catalogByKey(key: string): CatalogBody | undefined {
  return SOLAR_SYSTEM_CATALOG.find((b) => b.key === key);
}

export function catalogByHorizonsId(id: string): CatalogBody | undefined {
  return SOLAR_SYSTEM_CATALOG.find((b) => b.horizonsId === id);
}

export const PLANET_KEYS = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
/** Major satellites beyond Earth's Moon. Real distances — not the GAMEPLAY-inflated preset moons. */
export const MAJOR_MOON_KEYS = ['io', 'europa', 'ganymede', 'callisto', 'titan', 'triton', 'charon'] as const;
export const SPACECRAFT_KEYS = ['voyager1', 'voyager2', 'juno', 'parker', 'newhorizons', 'jwst'] as const;
export const KEPLERIAN_KEYS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
