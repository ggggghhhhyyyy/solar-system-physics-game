import { useEffect, useMemo } from 'react';
import { Btn, Panel } from './ui';

export interface CelebrationMission {
  title: string;
  emoji?: string;
  fact: string;
  stars: number;
}

export interface MissionCelebrationProps {
  mission: CelebrationMission | null;
  onClose: () => void;
}

const CONFETTI_COLORS = [
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#a78bfa',
  '#facc15',
  '#fb7185',
  '#34d399',
];

interface ConfettiPiece {
  left: string;
  delay: string;
  duration: string;
  color: string;
  size: number;
  round: boolean;
}

export function MissionCelebration({ mission, onClose }: MissionCelebrationProps) {
  const confetti = useMemo<ConfettiPiece[]>(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        left: `${(i * 97 + 13) % 100}%`,
        delay: `${((i * 137) % 1500) / 1000}s`,
        duration: `${2 + ((i * 53) % 1500) / 1000}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + ((i * 29) % 7),
        round: i % 3 === 0,
      })),
    [],
  );

  // 三音上行音效：523 / 659 / 784Hz 各 0.15s，失败静默
  useEffect(() => {
    if (!mission) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.15;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.16);
      });
      const timer = window.setTimeout(() => {
        try {
          void ctx.close();
        } catch {
          /* 静默失败 */
        }
      }, 1200);
      return () => {
        window.clearTimeout(timer);
        try {
          void ctx.close();
        } catch {
          /* 静默失败 */
        }
      };
    } catch {
      /* 自动播放限制 / 无音频设备时静默 */
    }
    return undefined;
  }, [mission]);

  // ESC 关闭（不自动关闭，让小孩看完知识卡）
  useEffect(() => {
    if (!mission) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mission, onClose]);

  if (!mission) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="任务完成庆祝"
    >
      <style>{`@keyframes mission-confetti-fall {
  0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
  100% { transform: translateY(110vh) rotate(720deg); opacity: 0.6; }
}`}</style>

      {/* CSS confetti：30 个绝对定位 div */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {confetti.map((c, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '-4vh',
              left: c.left,
              width: c.size,
              height: c.size * (c.round ? 1 : 1.6),
              backgroundColor: c.color,
              borderRadius: c.round ? '50%' : '2px',
              animation: `mission-confetti-fall ${c.duration} linear ${c.delay} infinite`,
            }}
          />
        ))}
      </div>

      <Panel
        className="relative z-10 w-full max-w-sm border-white/10 bg-slate-900 p-6 text-center"
      >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="text-6xl leading-none" aria-hidden="true">
            🎉
          </div>
          {mission.emoji && (
            <div className="mt-1 text-4xl leading-none" aria-hidden="true">
              {mission.emoji}
            </div>
          )}
          <h2 className="mt-3 text-2xl font-bold text-slate-100">任务完成！</h2>
          <p className="mt-1 text-sm font-medium text-cyan-200">{mission.title}</p>
          <p className="mt-2 text-xl tracking-widest text-amber-300" aria-label={`获得 ${mission.stars} 颗星星`}>
            {'★'.repeat(Math.max(1, mission.stars))}
            <span className="ml-2 align-middle text-sm font-semibold tracking-normal text-amber-200/90">
              ★x{mission.stars}
            </span>
          </p>

          <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-left">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              你知道吗？
            </div>
            <p className="text-xs leading-relaxed text-slate-200">{mission.fact}</p>
          </div>

          <Btn onClick={onClose} className="mt-5 w-full py-2 text-sm font-bold">
            太棒了！
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
