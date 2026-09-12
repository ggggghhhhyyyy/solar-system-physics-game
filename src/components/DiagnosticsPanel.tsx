import { useState } from 'react';
import { driftLevel, type DriftReport } from '../physics/diagnostics/conservation';
import type { EncounterReport } from '../physics/orbital/encounters';
import { AU_M } from '../physics/constants';
import { cn } from '../utils/cn';
import { Panel } from './ui';

function sci(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toExponential(digits);
}

function chip(level: ReturnType<typeof driftLevel>): string {
  if (level === 'green') return 'text-emerald-300';
  if (level === 'amber') return 'text-amber-300';
  return 'text-rose-300';
}

export default function DiagnosticsPanel({
  report,
  encounter,
}: {
  report: DriftReport | null;
  encounter?: EncounterReport | null;
}) {
  const [open, setOpen] = useState(false);
  if (!report) return null;
  const eLvl = driftLevel(report.energyDrift, 'energy');
  const pLvl = driftLevel(report.momentumDrift, 'momentum');
  const lLvl = driftLevel(report.angularDrift, 'angular');
  const cLvl = driftLevel(report.comDrift, 'com');
  const worst = [eLvl, pLvl, lLvl, cLvl].includes('red')
    ? 'red'
    : [eLvl, pLvl, lLvl, cLvl].includes('amber')
      ? 'amber'
      : 'green';

  return (
    <Panel className="pointer-events-auto w-64 overflow-hidden text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-semibold tracking-wide text-cyan-200">Scientific Diagnostics</span>
        <span className={cn('font-mono', chip(worst))}>{open ? '▾' : '▸'} {sci(report.energyDrift, 1)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/10 px-3 py-2 font-mono">
          <Row label="Energy drift ΔE/E0" value={sci(report.energyDrift)} level={eLvl} />
          <Row label="Momentum |ΔP|" value={sci(report.momentumDrift)} level={pLvl} />
          <Row label="Angular ΔL/L0" value={sci(report.angularDrift)} level={lLvl} />
          <Row label="COM drift" value={`${sci(report.comDrift)} AU`} level={cLvl} />
          <div className="grid grid-cols-2 gap-x-2 border-t border-white/5 pt-1 text-[10px] text-slate-400">
            <span>KE {sci(report.current.kinetic)}</span>
            <span>PE {sci(report.current.potential)}</span>
            <span>Px {sci(report.current.px)}</span>
            <span>Py {sci(report.current.py)}</span>
            <span>Pz {sci(report.current.pz)}</span>
            <span>|L| {sci(report.current.lMag)}</span>
          </div>
          {encounter && (
            <div className="border-t border-white/10 pt-2 font-sans">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">Close approach</div>
              <div className="text-[10px] text-slate-300">
                {encounter.aName} · {encounter.bName}
              </div>
              <div className="mt-1 flex justify-between gap-2 font-mono">
                <span className="text-slate-400">r</span>
                <span className="text-slate-100">{fmtEnc(encounter.separationAU)}</span>
              </div>
              <div className="flex justify-between gap-2 font-mono">
                <span className="text-slate-400">v_rel</span>
                <span className="text-slate-100">{encounter.vRelAUY.toFixed(3)} AU/yr</span>
              </div>
              <div className="flex justify-between gap-2 font-mono">
                <span className="text-slate-400">t_CA</span>
                <span className="text-slate-100">
                  {encounter.tCA == null
                    ? '—'
                    : `${encounter.tCA >= 0 ? '+' : ''}${(encounter.tCA * 365.25).toFixed(2)} d`}
                  {encounter.approaching ? ' ↓' : ''}
                </span>
              </div>
              <div className="mt-0.5 inline-block rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
                LINEAR APPROX
              </div>
              <div className="flex justify-between gap-2 font-mono">
                <span className="text-slate-400">Roche</span>
                <span className={encounter.insideRoche ? 'text-rose-300' : 'text-slate-100'}>
                  {encounter.rocheAU == null ? '—' : fmtEnc(encounter.rocheAU)}
                  {encounter.tidalDisruption ? ' TDE' : encounter.insideRoche ? ' IN' : ''}
                </span>
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                t_CA 是匀速直线近似（LINEAR APPROX），不是开普勒星历，也不是精确交会预报。
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({ label, value, level }: { label: string; value: string; level: ReturnType<typeof driftLevel> }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-sans text-slate-400">{label}</span>
      <span className={cn('font-mono', chip(level))}>{value}</span>
    </div>
  );
}

function fmtEnc(au: number): string {
  if (Math.abs(au) >= 0.01) return `${au.toFixed(4)} AU`;
  return `${((au * AU_M) / 1000).toExponential(2)} km`;
}
