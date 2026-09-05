import { AU_PER_YEAR_TO_KMS } from '../game/settings';
import { Btn, Panel, formatMass } from './ui';

export interface BodySnapshot {
  id: number;
  name: string;
  color: string;
  mass: number;
  radius: number;
  speed: number;
  distToSun: number;
  energy: number;
  isStar?: boolean;
  userLaunched?: boolean;
  age: number;
  period: number | null;
  // 轨道要素(相对最重天体,太阳自身留空)
  a?: number;
  e?: number;
  rp?: number;
  ra?: number;
  retrograde?: boolean;
  unbound?: boolean;
}

interface Props {
  body: BodySnapshot;
  following: boolean;
  onFollow: () => void;
  onDelete: () => void;
  onScaleMass: (factor: number) => void;
  onClose: () => void;
}

export default function BodyCard({ body, following, onFollow, onDelete, onScaleMass, onClose }: Props) {
  const bound = body.energy < 0;
  return (
    <Panel className="w-64 p-3">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ background: body.color, boxShadow: body.isStar ? `0 0 10px ${body.color}` : undefined }}
          />
          <div>
            <div className="text-sm font-semibold text-white">{body.name}</div>
            <div className="text-[10px] text-slate-400">
              {body.isStar ? '恒星' : body.mass > 1e-4 ? '巨行星' : body.mass > 1e-8 ? '行星' : '小天体'}
              {body.userLaunched ? ' · 玩家发射' : ''}
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-400">质量</dt>
        <dd className="text-right font-mono text-slate-100">{formatMass(body.mass)}</dd>
        <dt className="text-slate-400">速度</dt>
        <dd className="text-right font-mono text-slate-100">{(body.speed * AU_PER_YEAR_TO_KMS).toFixed(1)} km/s</dd>
        <dt className="text-slate-400">距恒星</dt>
        <dd className="text-right font-mono text-slate-100">{body.distToSun.toFixed(3)} AU</dd>
        <dt className="text-slate-400">轨道状态</dt>
        <dd className={`text-right font-mono ${bound ? 'text-emerald-300' : 'text-amber-300'}`}>
          {bound ? '束缚' : '逃逸'}
        </dd>
        {body.period != null && (
          <>
            <dt className="text-slate-400">轨道周期</dt>
            <dd className="text-right font-mono text-slate-100">
              {body.period < 1 ? `${(body.period * 365.25).toFixed(1)} 天` : `${body.period.toFixed(2)} 年`}
            </dd>
          </>
        )}
        <dt className="text-slate-400">存在时间</dt>
        <dd className="text-right font-mono text-slate-100">{body.age.toFixed(2)} 年</dd>
      </dl>

      {/* 轨道要素 */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="mb-1 text-[11px] font-semibold text-slate-200">轨道要素</div>
        {body.unbound ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-slate-400">状态</dt>
            <dd className="text-right font-mono text-amber-300">逃逸·双曲线</dd>
            {body.retrograde != null && (
              <>
                <dt className="text-slate-400">方向</dt>
                <dd className="text-right font-mono text-slate-100">{body.retrograde ? '逆行' : '顺行'}</dd>
              </>
            )}
          </dl>
        ) : body.a != null && body.e != null ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-slate-400">半长轴</dt>
            <dd className="text-right font-mono text-slate-100">{body.a.toFixed(3)} AU</dd>
            <dt className="text-slate-400">偏心率</dt>
            <dd className="text-right font-mono text-slate-100">{body.e.toFixed(3)}</dd>
            <dt className="text-slate-400">近日点</dt>
            <dd className="text-right font-mono text-slate-100">{body.rp != null ? `${body.rp.toFixed(3)} AU` : '—'}</dd>
            <dt className="text-slate-400">远日点</dt>
            <dd className="text-right font-mono text-slate-100">{body.ra != null ? `${body.ra.toFixed(3)} AU` : '—'}</dd>
            <dt className="text-slate-400">方向</dt>
            <dd className="text-right font-mono text-slate-100">
              {body.retrograde != null ? (body.retrograde ? '逆行' : '顺行') : '—'}
            </dd>
            <dt className="text-slate-400">状态</dt>
            <dd className="text-right font-mono text-emerald-300">束缚·椭圆</dd>
          </dl>
        ) : (
          <div className="text-[11px] text-slate-400">中心天体,无轨道要素</div>
        )}
      </div>

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
