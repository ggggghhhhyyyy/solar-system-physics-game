import { AU_PER_YEAR_TO_KMS } from '../game/settings';
import { AU_M } from '../physics/constants';
import type { ClassicalElements } from '../physics/orbital/elements';
import { deg } from '../physics/orbital/elements';
import type { ScientificProperties } from '../physics/orbital/spheres';
import type { UiMode } from '../physics/types';
import { Btn, Panel, formatMass } from './ui';

export interface BodySnapshot {
  id: number;
  name: string;
  color: string;
  mass: number;
  physicalRadius: number;
  renderRadius: number;
  speed: number;
  distToSun: number;
  energy: number;
  isStar?: boolean;
  isBlackHole?: boolean;
  userLaunched?: boolean;
  gravityMode?: string;
  age: number;
  period: number | null;
  a?: number | null;
  e?: number;
  i?: number;
  Omega?: number;
  omega?: number;
  nu?: number;
  rp?: number | null;
  ra?: number | null;
  retrograde?: boolean;
  unbound?: boolean;
  kind?: ClassicalElements['kind'];
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scientific?: ScientificProperties;
}

interface Props {
  body: BodySnapshot;
  following: boolean;
  mode: UiMode;
  onFollow: () => void;
  onDelete: () => void;
  onScaleMass: (factor: number) => void;
  onClose: () => void;
}

function fmtAngle(rad: number | undefined): string {
  if (rad == null || !Number.isFinite(rad)) return '—';
  return `${deg(rad).toFixed(2)}°`;
}

function fmtAU(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 0.01) return `${v.toFixed(digits)} AU`;
  return `${(v * AU_M / 1000).toExponential(2)} km`;
}

export default function BodyCard({ body, following, mode, onFollow, onDelete, onScaleMass, onClose }: Props) {
  const science = mode === 'science';
  const bound = !body.unbound && body.energy < 0;
  return (
    <Panel className={science ? 'w-72 p-3' : 'w-64 p-3'}>
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{
              background: body.isBlackHole ? '#000000' : body.color,
              border: body.isBlackHole ? `2px solid ${body.color}` : undefined,
              boxShadow: body.isStar || body.isBlackHole ? `0 0 10px ${body.color}` : undefined,
            }}
          />
          <div>
            <div className="text-sm font-semibold text-white">{body.name}</div>
            <div className="text-[10px] text-slate-400">
              {body.isBlackHole ? '黑洞' : body.isStar ? '恒星' : body.mass > 1e-4 ? '巨行星' : body.mass > 1e-8 ? '行星' : '小天体'}
              {body.userLaunched ? ' · 玩家发射' : ''}
              {body.gravityMode === 'test-particle' ? ' · test particle' : ''}
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
        <dt className="font-sans text-slate-400">质量</dt>
        <dd className="text-right text-slate-100">{formatMass(body.mass)}</dd>
        <dt className="font-sans text-slate-400">速度</dt>
        <dd className="text-right text-slate-100">{(body.speed * AU_PER_YEAR_TO_KMS).toFixed(2)} km/s</dd>
        <dt className="font-sans text-slate-400">距中心</dt>
        <dd className="text-right text-slate-100">{body.distToSun.toFixed(4)} AU</dd>
        <dt className="font-sans text-slate-400">轨道状态</dt>
        <dd className={`text-right ${bound ? 'text-emerald-300' : 'text-amber-300'}`}>
          {body.kind === 'hyperbolic' ? 'Hyperbolic / Escape' : body.kind === 'parabolic' ? 'Parabolic / Escape' : bound ? '束缚' : '逃逸'}
        </dd>
        {body.period != null && (
          <>
            <dt className="font-sans text-slate-400">轨道周期</dt>
            <dd className="text-right text-slate-100">
              {body.period < 1 ? `${(body.period * 365.25).toFixed(1)} 天` : `${body.period.toFixed(3)} 年`}
            </dd>
          </>
        )}
        <dt className="font-sans text-slate-400">存在时间</dt>
        <dd className="text-right text-slate-100">{body.age.toFixed(2)} 年</dd>
      </dl>

      {science && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">State vector</div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-200">
            <dt className="text-slate-500">X</dt><dd className="text-right">{body.x.toExponential(4)}</dd>
            <dt className="text-slate-500">Y</dt><dd className="text-right">{body.y.toExponential(4)}</dd>
            <dt className="text-slate-500">Z</dt><dd className="text-right">{body.z.toExponential(4)}</dd>
            <dt className="text-slate-500">VX</dt><dd className="text-right">{body.vx.toExponential(4)}</dd>
            <dt className="text-slate-500">VY</dt><dd className="text-right">{body.vy.toExponential(4)}</dd>
            <dt className="text-slate-500">VZ</dt><dd className="text-right">{body.vz.toExponential(4)}</dd>
          </dl>
        </div>
      )}

      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="mb-1 text-[11px] font-semibold text-slate-200">轨道要素</div>
        {body.unbound ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            <dt className="font-sans text-slate-400">状态</dt>
            <dd className="text-right text-amber-300">
              {body.kind === 'parabolic' ? 'Parabolic / Escape' : 'Hyperbolic / Escape'}
            </dd>
            <dt className="font-sans text-slate-400">偏心率</dt>
            <dd className="text-right text-slate-100">{body.e != null ? body.e.toFixed(4) : '—'}</dd>
            <dt className="font-sans text-slate-400">轨道倾角</dt>
            <dd className="text-right text-slate-100">{fmtAngle(body.i)}</dd>
            <dt className="font-sans text-slate-400">近日点</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.rp)}</dd>
          </dl>
        ) : body.a != null && body.e != null ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            <dt className="font-sans text-slate-400">半长轴</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.a, 4)}</dd>
            <dt className="font-sans text-slate-400">偏心率</dt>
            <dd className="text-right text-slate-100">{body.e.toFixed(5)}</dd>
            <dt className="font-sans text-slate-400">轨道倾角</dt>
            <dd className="text-right text-slate-100">{fmtAngle(body.i)}</dd>
            <dt className="font-sans text-slate-400">升交点经度</dt>
            <dd className="text-right text-slate-100">{fmtAngle(body.Omega)}</dd>
            <dt className="font-sans text-slate-400">近心点幅角</dt>
            <dd className="text-right text-slate-100">{fmtAngle(body.omega)}</dd>
            <dt className="font-sans text-slate-400">真近点角</dt>
            <dd className="text-right text-slate-100">{fmtAngle(body.nu)}</dd>
            <dt className="font-sans text-slate-400">近日点</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.rp)}</dd>
            <dt className="font-sans text-slate-400">远日点</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.ra)}</dd>
          </dl>
        ) : (
          <div className="text-[11px] text-slate-400">中心天体,无轨道要素</div>
        )}
      </div>

      {science && body.scientific && (
        <div className="mt-2 border-t border-cyan-400/20 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Scientific Data</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            <dt className="font-sans text-slate-400">表面重力</dt>
            <dd className="text-right text-slate-100">
              {body.scientific.surfaceGravity != null ? `${body.scientific.surfaceGravity.toFixed(2)} m/s²` : '—'}
            </dd>
            <dt className="font-sans text-slate-400">逃逸速度</dt>
            <dd className="text-right text-slate-100">
              {body.scientific.escapeVelocity != null ? `${body.scientific.escapeVelocity.toFixed(2)} km/s` : '—'}
            </dd>
            <dt className="font-sans text-slate-400">平均密度</dt>
            <dd className="text-right text-slate-100">
              {body.scientific.meanDensity != null ? `${body.scientific.meanDensity.toExponential(2)} kg/m³` : '—'}
            </dd>
            <dt className="font-sans text-slate-400">Hill Sphere</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.scientific.hillSphere)}</dd>
            <dt className="font-sans text-slate-400">SOI</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.scientific.sphereOfInfluence)}</dd>
            <dt className="font-sans text-slate-400">Roche 流体</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.scientific.rocheFluid)}</dd>
            <dt className="font-sans text-slate-400">Roche 刚体</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.scientific.rocheRigid)}</dd>
            <dt className="font-sans text-slate-400">潮汐状态</dt>
            <dd className={`text-right ${body.scientific.insideRoche ? 'text-rose-300' : 'text-emerald-300'}`}>
              {body.scientific.insideRoche ? 'Roche 内' : 'Roche 外'}
            </dd>
            <dt className="font-sans text-slate-400">物理半径</dt>
            <dd className="text-right text-slate-100">{fmtAU(body.physicalRadius, 6)}</dd>
          </dl>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Btn active={following} onClick={onFollow}>
          {following ? '🎯 跟随中' : '🎯 跟随'}
        </Btn>
        <Btn onClick={onDelete} className="border-rose-400/30 text-rose-200 hover:bg-rose-500/20">
          🗑 删除
        </Btn>
        <Btn onClick={() => onScaleMass(0.5)}>质量 ÷2</Btn>
        <Btn onClick={() => onScaleMass(2)}>质量 ×2</Btn>
      </div>
    </Panel>
  );
}
