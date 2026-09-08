import { LAUNCH_TYPES, PRESETS } from '../physics/presets';
import type { Settings } from '../game/settings';
import type { MissionState } from '../game/missions';
import { Btn, Panel, SectionTitle, Toggle } from './ui';
import { cn } from '../utils/cn';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  presetId: string;
  onLoadPreset: (id: string) => void;
  gMultiplier: number;
  onGChange: (v: number) => void;
  collisions: boolean;
  onCollisionsChange: (v: boolean) => void;
  onEvent: (kind: 'rogue' | 'rogueBH' | 'shower' | 'comet' | 'clearUser' | 'clearTrails') => void;
  missions: MissionState[];
  bodyCount: number;
  onClose?: () => void;
  onSave?: () => void;
  onLoad?: () => void;
  onClear?: () => void;
  achievements?: Array<{ title: string; desc: string; unlocked: boolean }>;
  dailyDate?: string;
  rerollsLeft?: number;
  onReroll?: () => void;
}

export default function ControlPanel({
  settings,
  update,
  presetId,
  onLoadPreset,
  gMultiplier,
  onGChange,
  collisions,
  onCollisionsChange,
  onEvent,
  missions,
  bodyCount,
  onClose,
  onSave,
  onLoad,
  onClear,
  achievements,
  dailyDate,
  rerollsLeft = 0,
  onReroll,
}: Props) {
  const doneCount = missions.filter((m) => m.done).length;
  const achList = achievements ?? [];
  const achDone = achList.filter((a) => a.unlocked).length;
  return (
    <Panel className="flex max-h-full w-72 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">控制台</div>
          <div className="text-[11px] text-slate-400">{bodyCount} 个天体</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 md:hidden"
          >
            关闭
          </button>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 [scrollbar-width:thin]">
        {/* Scene */}
        <section>
          <SectionTitle>场景</SectionTitle>
          <div className="grid grid-cols-1 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onLoadPreset(p.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  presetId === p.id
                    ? 'border-cyan-400/60 bg-cyan-500/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10',
                )}
              >
                <div className="text-xs font-medium text-slate-100">{p.name}</div>
                <div className="text-[10px] text-slate-400">{p.description}</div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => onLoadPreset('random')}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                presetId === 'random'
                  ? 'border-cyan-400/60 bg-cyan-500/15'
                  : 'border-white/10 bg-white/5 hover:bg-white/10',
              )}
            >
              <div className="text-xs font-medium text-slate-100">🎲 随机星系</div>
              <div className="text-[10px] text-slate-400">每次生成不同的恒星与行星组合</div>
            </button>
          </div>
        </section>

        {/* Tool */}
        <section>
          <SectionTitle>工具</SectionTitle>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <Btn active={settings.tool === 'launch'} onClick={() => update({ tool: 'launch' })}>
              🚀 发射天体
            </Btn>
            <Btn active={settings.tool === 'pan'} onClick={() => update({ tool: 'pan' })}>
              ✋ 拖动视角
            </Btn>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LAUNCH_TYPES.map((lt) => (
              <button
                key={lt.id}
                type="button"
                onClick={() => update({ launchTypeId: lt.id, tool: 'launch' })}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] transition-colors',
                  settings.launchTypeId === lt.id
                    ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-50'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
                )}
              >
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: lt.isStar || lt.isBlackHole ? 14 : lt.mass > 1e-4 ? 12 : lt.mass > 1e-8 ? 9 : 6,
                    height: lt.isStar || lt.isBlackHole ? 14 : lt.mass > 1e-4 ? 12 : lt.mass > 1e-8 ? 9 : 6,
                    background: lt.isBlackHole ? '#000000' : lt.color,
                    border: lt.isBlackHole ? `2px solid ${lt.color}` : undefined,
                    boxShadow: lt.isStar || lt.isBlackHole ? `0 0 10px ${lt.color}` : undefined,
                  }}
                />
                {lt.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            在画布上按住并拖动以设定速度方向与大小；跟随某天体时，发射速度会叠加该天体的速度。
          </p>
        </section>

        {/* Physics */}
        <section>
          <SectionTitle>物理参数</SectionTitle>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
            <span>引力常数 G</span>
            <span className="font-mono text-cyan-200">× {gMultiplier.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={Math.log10(gMultiplier)}
            onChange={(e) => onGChange(Math.pow(10, parseFloat(e.target.value)))}
            className="w-full accent-cyan-400"
          />
          <div className="mt-1 flex gap-1.5">
            {[0.5, 1, 2].map((v) => (
              <Btn key={v} active={Math.abs(gMultiplier - v) < 0.01} onClick={() => onGChange(v)} className="flex-1">
                ×{v}
              </Btn>
            ))}
          </div>
          <div className="mt-2 divide-y divide-white/5">
            <Toggle label="碰撞合并" checked={collisions} onChange={onCollisionsChange} />
            <Toggle label="显示轨迹" checked={settings.showTrails} onChange={(v) => update({ showTrails: v })} />
            <Toggle label="显示名称" checked={settings.showLabels} onChange={(v) => update({ showLabels: v })} />
            <Toggle label="发射轨迹预测" checked={settings.showPrediction} onChange={(v) => update({ showPrediction: v })} />
          </div>
        </section>

        {/* Events */}
        <section>
          <SectionTitle>事件</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            <Btn onClick={() => onEvent('rogue')} className="border-rose-400/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20">
              ☄️ 流浪恒星
            </Btn>
            <Btn onClick={() => onEvent('rogueBH')} className="border-violet-400/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20">
              🕳 流浪黑洞
            </Btn>
            <Btn onClick={() => onEvent('shower')}>🌠 陨石雨</Btn>
            <Btn onClick={() => onEvent('comet')}>💫 长周期彗星</Btn>
            <Btn onClick={() => onEvent('clearUser')}>🧹 清除发射物</Btn>
            <Btn onClick={() => onEvent('clearTrails')} className="col-span-2">
              清除轨迹
            </Btn>
          </div>
        </section>

        {/* Missions */}
        <section>
          <SectionTitle>
            {dailyDate ? `📅 今日太空任务 ${dailyDate}` : '任务'}{' '}
            <span className="ml-1 text-cyan-300">{doneCount}/{missions.length}</span>
          </SectionTitle>
          {dailyDate && onReroll && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">每日0点刷新 · 全班同一题</span>
              <Btn onClick={onReroll} disabled={rerollsLeft <= 0} className="text-[11px]">
                🔄 换一换(剩{rerollsLeft}次)
              </Btn>
            </div>
          )}
          <div className="space-y-1.5">
            {missions.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  m.done ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/5',
                )}
                title={m.hint}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-xs font-medium', m.done ? 'text-emerald-200' : 'text-slate-100')}>
                    {m.done ? '✅ ' : '○ '}
                    {m.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {m.difficulty && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                          m.difficulty === '简单'
                            ? 'bg-emerald-500/20 text-emerald-200'
                            : m.difficulty === '进阶'
                              ? 'bg-sky-500/20 text-sky-200'
                              : 'bg-violet-500/20 text-violet-200',
                        )}
                      >
                        {m.difficulty}
                      </span>
                    )}
                    {typeof m.stars === 'number' && (
                      <span className="text-[10px] text-amber-300">{'★'.repeat(m.stars)}</span>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{m.desc}</div>
                {m.fact && (
                  <div className="mt-1 rounded-md bg-amber-300/10 px-2 py-1 text-[10px] leading-relaxed text-amber-100/90">
                    💡 {m.fact}
                  </div>
                )}
                {!m.done && (
                  <div className="mt-1 text-[10px] text-slate-500">👉 {m.hint}</div>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn('h-full rounded-full transition-all', m.done ? 'bg-emerald-400' : 'bg-cyan-400')}
                      style={{ width: `${Math.round(m.progress * 100)}%` }}
                    />
                  </div>
                  {!m.done && m.progress > 0 && (
                    <span className="font-mono text-[10px] text-slate-400">{Math.round(m.progress * 100)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Save */}
        <section>
          <SectionTitle>存档</SectionTitle>
          <div className="grid grid-cols-3 gap-1.5">
            <Btn onClick={() => onSave?.()}>💾 保存</Btn>
            <Btn onClick={() => onLoad?.()}>📂 读取</Btn>
            <Btn onClick={() => onClear?.()}>🗑 清除</Btn>
          </div>
        </section>

        {/* Achievements */}
        <section>
          <SectionTitle>
            成就 <span className="ml-1 text-cyan-300">{achDone}/{achList.length}</span>
          </SectionTitle>
          <div className="space-y-1.5">
            {achList.map((a) => (
              <div
                key={a.title}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  a.unlocked ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/5',
                )}
              >
                <div
                  className={cn(
                    'text-xs font-medium',
                    a.unlocked ? 'text-emerald-200' : 'text-slate-500',
                  )}
                >
                  {a.unlocked ? '🏆 ' : '🔒 '}
                  {a.title}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{a.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Panel>
  );
}
