import { formatJd, formatTdb, formatUtc } from "../physics/time/epoch";
import type { Epoch } from "../physics/time/epoch";
import type { PhysicsConstants } from "../physics/constants";
import type { DriftReport } from "../physics/diagnostics/conservation";
import type { PhysicalFidelity } from "../physics/types";
import type { EphemerisSource } from "../physics/ephemeris/types";
import type { ReferenceFrame } from "../physics/frames/referenceFrames";
import { Panel } from "./ui";
import { cn } from "../utils/cn";

export interface ScienceHudProps {
  epoch: Epoch | null;
  elapsedYears: number;
  source: EphemerisSource | "preset";
  fallback: boolean;
  frame: ReferenceFrame;
  integrator: string;
  adaptiveDt: boolean;
  dt: number;
  softening: number;
  constants: PhysicsConstants;
  drift: DriftReport | null;
  fidelity: PhysicalFidelity;
}

function fidelityLabel(f: PhysicalFidelity): string {
  if (f === "real-ephemeris") return "REAL EPHEMERIS";
  if (f === "physical-approximation") return "PHYSICAL APPROXIMATION";
  if (f === "physical-model") return "PHYSICAL MODEL";
  return "GAMEPLAY";
}

function sourceLabel(s: ScienceHudProps["source"], fallback: boolean): string {
  if (fallback) return "KEPLERIAN FALLBACK";
  if (s === "horizons-cache") return "DE441 / Horizons cache";
  if (s === "horizons-live") return "Horizons live";
  if (s === "keplerian") return "JPL Keplerian approx";
  return "Preset (not ephemeris)";
}

function sci(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toExponential(d);
}

export default function ScienceHud({
  epoch,
  elapsedYears,
  source,
  fallback,
  frame,
  integrator,
  adaptiveDt,
  dt,
  softening,
  constants,
  drift,
  fidelity,
}: ScienceHudProps) {
  return (
    <Panel className="pointer-events-auto w-[19.5rem] overflow-hidden px-3 py-2 text-[10px] leading-relaxed">
      <div className="mb-1 font-semibold tracking-wider text-cyan-200">SCIENCE</div>
      <Row k="SOURCE" v={sourceLabel(source, fallback)} warn={fallback || source === "keplerian" || source === "preset"} />
      <Row k="FIDELITY" v={fidelityLabel(fidelity)} warn={fidelity !== "real-ephemeris"} />
      <Row k="FRAME" v={frame.label} />
      {frame.note && <div className="mb-1 text-amber-200/90">{frame.note}</div>}
      <Row k="TIME" v={epoch ? formatJd(epoch, elapsedYears) : `T + ${elapsedYears.toFixed(4)} yr`} />
      {epoch && <Row k="TDB" v={formatTdb(epoch, elapsedYears)} />}
      {epoch && <Row k="UTC" v={formatUtc(epoch, elapsedYears)} />}
      <Row k="INTEGRATOR" v={adaptiveDt ? `${integrator} KDK + adaptive substepping` : `${integrator} KDK`} />
      <div className="mb-1 text-[9px] text-slate-500">
        Adaptive substepping splits one KDK step. Not a time-transformed symplectic integrator.
      </div>
      <Row k="dt" v={`${dt} yr`} />
      <Row k="SOFTENING" v={`${softening} AU`} />
      <Row k="μ☉" v={`${constants.id}  ${sci(constants.muSun, 6)}`} />
      {drift && (
        <>
          <Row k="ΔE/E" v={sci(drift.energyDrift)} />
          <Row k="E" v={sci(drift.current.totalEnergy)} />
          <Row k="ΔL/L" v={sci(drift.angularDrift)} />
          <Row k="|L|" v={sci(drift.current.lMag)} />
          <Row k="|ΔP|" v={sci(drift.momentumDrift)} />
          <Row k="ΔCOM" v={`${sci(drift.comDrift)} AU`} />
        </>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge>xy Canvas = VISUAL APPROX</Badge>
        <Badge>t_CA = LINEAR APPROX</Badge>
        <Badge>Roche = detect-only</Badge>
        {constants.id === "gaussian" && <Badge>G = 4π² GAME</Badge>}
        {constants.id === "de440" && <Badge>DE440 μ☉</Badge>}
      </div>
    </Panel>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2 font-mono">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={cn("text-right text-slate-100", warn && "text-amber-200")}>{v}</span>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-400">
      {children}
    </span>
  );
}
