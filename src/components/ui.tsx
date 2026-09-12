import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-slate-950/70 text-slate-200 shadow-xl shadow-black/40 backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>
  );
}

export function Btn({
  children,
  onClick,
  active,
  className,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs text-slate-300">
      <span>{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-cyan-500' : 'bg-slate-600',
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </label>
  );
}

export function formatMass(m: number): string {
  if (m >= 0.05) return `${m.toFixed(2)} M☉`;
  const earth = m / 3.0e-6;
  if (earth >= 0.01) return `${earth.toFixed(2)} M⊕`;
  const kg = m * 1.989e30;
  return `${kg.toExponential(2)} kg`;
}

export function formatTime(years: number): string {
  const y = Math.floor(years);
  const d = Math.floor((years - y) * 365.25);
  return `第 ${y} 年 第 ${d} 天`;
}

import type { Epoch } from '../physics/time/epoch';
import { formatEpoch } from '../physics/time/epoch';

export function formatSimClock(epoch: Epoch | null, years: number): string {
  if (!epoch) return `T + ${years.toFixed(3)} years`;
  const fmt = formatEpoch(epoch, years);
  return `SIM ${fmt.calendar} ${fmt.scale}  JD ${fmt.jd.toFixed(5)}`;
}
