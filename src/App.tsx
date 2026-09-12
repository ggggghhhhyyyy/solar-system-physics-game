import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SimulationCanvas, { type CanvasHandle } from './components/SimulationCanvas';
import ControlPanel, { describeEphemerisSource, type EphemerisMeta } from './components/ControlPanel';
import BodyCard, { type BodySnapshot } from './components/BodyCard';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import { Btn, Panel, formatSimClock, formatTime } from './components/ui';
import { Engine } from './physics/engine';
import { PRESETS, asteroidShower, generateRandomSystem, longPeriodComet, rogueBlackHole, rogueStar } from './physics/presets';
import { MissionTracker, type MissionDef, type MissionState } from './game/missions';
import {
  getDailyMissions,
  loadDailyState,
  rerollMission,
  saveDailyState,
  todayKey,
} from './game/dailyMissions';
import { MissionCelebration } from './components/MissionCelebration';
import { DEFAULT_SETTINGS, SPEED_STEPS, type Settings } from './game/settings';
import type { Body } from './physics/types';
import { exportSnapshot, parseSnapshot, restoreSnapshot, serializeSnapshot } from './physics/snapshot';
import { scientificProperties } from './physics/orbital/spheres';
import { closestEncounter, type EncounterReport } from './physics/orbital/encounters';
import { getRelativeState, type ReferenceFrame } from './physics/frames/referenceFrames';
import type { DriftReport } from './physics/diagnostics/conservation';
import {
  ACHIEVEMENTS,
  loadStats,
  recordDailyAllDone,
  recordEvents,
  recordLaunch,
  recordMissionDone,
  recordTick,
  type Stats,
} from './game/stats';
import { loadSolarSystem } from './physics/ephemeris/loadSolarSystem';
import { queryHorizonsStates } from './physics/ephemeris/horizons.functions';
import { HORIZONS_CACHE_EPOCH } from './physics/ephemeris/horizonsCache';

interface LogEntry {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'success';
}

let logId = 0;

export default function App() {
  const engine = useMemo(() => {
    const e = new Engine();
    const p = PRESETS[0];
    e.reset(p.bodies.map((b) => ({ ...b })), { epoch: p.epoch ?? null });
    return e;
  }, []);
  const [dailyDate, setDailyDate] = useState(() => todayKey());
  const [dailyDefs, setDailyDefs] = useState<MissionDef[]>(() => {
    const keys = new Set<string>();
    for (const b of PRESETS[0].bodies) if (b.key) keys.add(b.key);
    return getDailyMissions(todayKey(), [...keys]);
  });
  const [rerollsLeft, setRerollsLeft] = useState(() => loadDailyState(todayKey()).rerollsLeft);
  const [celebration, setCelebration] = useState<MissionState | null>(null);
  const [onboardStep, setOnboardStep] = useState<number | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem('ssp1-onboarded') !== '1') setOnboardStep(0);
    } catch {
      setOnboardStep(0);
    }
  }, []);
  const tracker = useMemo(() => new MissionTracker(dailyDefs), []);
  const canvasRef = useRef<CanvasHandle>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [gMultiplier, setGMultiplier] = useState(1);
  const [collisions, setCollisions] = useState(true);
  const [simTime, setSimTime] = useState(0);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [bodyCount, setBodyCount] = useState(engine.bodies.length);
  const [selected, setSelected] = useState<BodySnapshot | null>(null);
  const [missions, setMissions] = useState<MissionState[]>(() => tracker.update(engine));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [epochDate, setEpochDate] = useState(() => HORIZONS_CACHE_EPOCH.slice(0, 10));
  const [includeSpacecraft, setIncludeSpacecraft] = useState(true);
  const [includeMoons, setIncludeMoons] = useState(true);
  const [ephLoading, setEphLoading] = useState(false);
  const [ephMeta, setEphMeta] = useState<EphemerisMeta | null>(null);
  const [encounter, setEncounter] = useState<EncounterReport | null>(null);
  const prevDoneRef = useRef<Set<string>>(new Set(loadDailyState(todayKey()).doneIds));
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const prevTimeRef = useRef<number>(engine.time);
  const dailyDateRef = useRef(dailyDate);
  dailyDateRef.current = dailyDate;
  const dailyDefsRef = useRef(dailyDefs);
  dailyDefsRef.current = dailyDefs;

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    engine.adaptiveDt = settings.adaptiveDt;
  }, [engine, settings.adaptiveDt]);

  const pushLog = useCallback((text: string, kind: LogEntry['kind'] = 'info') => {
    const id = ++logId;
    setLogs((l) => [...l.slice(-5), { id, text, kind }]);
    setTimeout(() => setLogs((l) => l.filter((x) => x.id !== id)), 9000);
  }, []);

  // initial view
  useEffect(() => {
    const t = setTimeout(() => canvasRef.current?.setView({ x: 0, y: 0 }, PRESETS[0].viewRadius), 0);
    return () => clearTimeout(t);
  }, []);

  // periodic UI sync from engine
  useEffect(() => {
    const id = setInterval(() => {
      const events = engine.drainEvents();
      if (events.length) recordEvents(events);
      if (events.length) {
        tracker.processEvents(events);
        for (const e of events) {
          if (e.type === 'collision' && e.survivor && e.absorbed) {
            const important = e.survivor.mass > 1e-8 && e.absorbed.mass > 1e-8;
            const involvesUser = e.survivor.userLaunched || e.absorbed.userLaunched;
            if (important || involvesUser || e.absorbed.key) {
              pushLog(
                e.survivor.isBlackHole ? `🕳 黑洞吞噬了 ${e.absorbed.name}` : `${e.survivor.name} 吞噬了 ${e.absorbed.name}`,
                important ? 'warn' : 'info',
              );
            }
          } else if (e.type === 'roche' && e.primary && e.secondary) {
            pushLog(`Roche：${e.secondary.name} 进入 ${e.primary.name} 的流体洛希极限`, 'warn');
          } else if (e.type === 'tde' && e.primary && e.secondary) {
            pushLog(`TDE：${e.secondary.name} 正在被 ${e.primary.name} 潮汐撕裂（检测，未做流体碎裂）`, 'warn');
          } else if (e.type === 'escaped' && e.body) {
            if (e.body.mass > 1e-8 || e.body.userLaunched) {
              pushLog(`${e.body.name} 已飞离星系`, 'info');
            }
          }
        }
      }
      const ms = tracker.update(engine);
      // 跨天检查：日期变化则抽新一日任务
      const today = todayKey();
      if (today !== dailyDateRef.current) {
        const keys = new Set<string>();
        for (const b of engine.bodies) if (b.key) keys.add(b.key);
        const next = getDailyMissions(today, [...keys]);
        tracker.setDefs(next);
        dailyDefsRef.current = next;
        setDailyDefs(next);
        setDailyDate(today);
        prevDoneRef.current.clear();
        const st = loadDailyState(today);
        for (const id of st.doneIds) prevDoneRef.current.add(id);
        setRerollsLeft(st.rerollsLeft);
        setMissions(tracker.update(engine));
        pushLog(`📅 新的一天，今日太空任务已刷新！`, 'success');
        return;
      }
      for (const m of ms) {
        if (m.done && !prevDoneRef.current.has(m.id)) {
          prevDoneRef.current.add(m.id);
          const date = dailyDateRef.current;
          recordMissionDone(m.id, date);
          // 同步每日存档
          try {
            const st = loadDailyState(date);
            if (!st.doneIds.includes(m.id)) {
              const stars = (m.stars ?? 1);
              const nextSt = { doneIds: [...st.doneIds, m.id], rerollsLeft: st.rerollsLeft, stars: st.stars + stars };
              saveDailyState(date, nextSt);
            }
          } catch { /* 忽略 */ }
          pushLog(`任务完成：${m.title} +${m.stars ?? 1}★`, 'success');
          setCelebration(m);
          // 当日全部完成
          const allDone = dailyDefsRef.current.length > 0 &&
            dailyDefsRef.current.every((d) => prevDoneRef.current.has(d.id));
          if (allDone) {
            recordDailyAllDone(date);
            pushLog(`🎉 今日太空任务全部完成！你是小小宇航员！`, 'success');
          }
        }
      }
      setMissions(ms);
      setSimTime(engine.time);
      setBodyCount(engine.bodies.length);
      setDrift(engine.diagnostics());
      setEncounter(closestEncounter(engine.bodies, settingsRef.current.selectedId));
      // 统计:用 engine.time 差值累加模拟年
      {
        const dt = engine.time - prevTimeRef.current;
        prevTimeRef.current = engine.time;
        if (dt > 0) recordTick(dt, engine);
        setStats(loadStats());
      }

      {
        const s = settingsRef.current;
        const sel = engine.getBody(s.selectedId);
        if (s.selectedId != null && !sel) {
          setSelected(null);
          setSettings((p) => ({ ...p, selectedId: null, followId: p.followId === p.selectedId ? null : p.followId }));
        } else if (sel) {
          const sun = engine.heaviest();
          const follow = engine.getBody(s.followId);
          let relRef: Body | ReferenceFrame;
          if (s.referenceFrame === 'body-centric') {
            if (follow && follow !== sel) relRef = follow;
            else if (sun && sun !== sel) relRef = sun;
            else relRef = { kind: 'barycentric', label: 'barycentric' };
          } else {
            relRef = { kind: s.referenceFrame, label: s.referenceFrame };
          }
          const rel = getRelativeState(sel, relRef, engine.bodies);
          let distToSun = 0;
          let energy = 0;
          let period: number | null = null;
          let a: number | null | undefined;
          let e: number | undefined;
          let i: number | undefined;
          let Omega: number | undefined;
          let omega: number | undefined;
          let nu: number | undefined;
          let rp: number | null | undefined;
          let ra: number | null | undefined;
          let retrograde: boolean | undefined;
          let unbound: boolean | undefined;
          let kind: BodySnapshot['kind'];
          if (sun && sun !== sel) {
            distToSun = Math.hypot(sel.x - sun.x, sel.y - sun.y, sel.z - sun.z);
            energy = engine.specificEnergy(sel, sun);
            const el = engine.orbitalElements(sel, sun);
            a = el.a;
            e = el.e;
            i = el.i;
            Omega = el.Omega;
            omega = el.omega;
            nu = el.nu;
            rp = el.rp;
            ra = el.ra;
            period = el.period;
            retrograde = el.retrograde;
            unbound = el.unbound;
            kind = el.kind;
          }
          setSelected({
            id: sel.id,
            name: sel.name,
            color: sel.color,
            mass: sel.mass,
            physicalRadius: sel.physicalRadius,
            renderRadius: sel.renderRadius,
            speed: Math.hypot(sel.vx, sel.vy, sel.vz),
            distToSun,
            energy,
            isStar: sel.isStar,
            isBlackHole: sel.isBlackHole,
            userLaunched: sel.userLaunched,
            gravityMode: sel.gravityMode,
            age: engine.time - sel.createdAt,
            period,
            a,
            e,
            i,
            Omega,
            omega,
            nu,
            rp,
            ra,
            retrograde,
            unbound,
            kind,
            x: rel.x,
            y: rel.y,
            z: rel.z,
            vx: rel.vx,
            vy: rel.vy,
            vz: rel.vz,
            scientific: scientificProperties(sel, sun && sun !== sel ? sun : undefined, engine.G),
          });
        }
      }
    }, 150);
    return () => clearInterval(id);
  }, [engine, tracker, pushLog]);

  const loadPreset = useCallback(
    (id: string) => {
      const p = id === 'random'
        ? generateRandomSystem(Date.now() % 100000)
        : PRESETS.find((x) => x.id === id);
      if (!p) return;
      engine.dt = p.dt ?? 0.0002;
      engine.softening = p.softening ?? 0.003;
      engine.reset(p.bodies.map((b) => ({ ...b })), { epoch: p.epoch ?? null });
      engine.adaptiveDt = false;
      update({ adaptiveDt: false });
      // 每日任务：只清进度不清完成，切场景不丢星星
      tracker.softReset();
      setPresetId(id);
      setEphMeta(null);
      setSelected(null);
      update({ selectedId: null, followId: null });
      canvasRef.current?.setView({ x: 0, y: 0 }, p.viewRadius);
      pushLog(`已加载场景：${p.name}`);
      setMissions(tracker.update(engine));
    },
    [engine, tracker, update, pushLog],
  );

  const handleLoadEphemeris = useCallback(
    async (source: 'horizons' | 'keplerian') => {
      if (ephLoading) return;
      setEphLoading(true);
      update({ running: false });
      try {
        const loaded = await loadSolarSystem({
          epoch: epochDate,
          includeSpacecraft,
          includeMoons,
          source: source === 'keplerian' ? 'keplerian' : 'auto',
          fetchStates:
            source === 'keplerian'
              ? undefined
              : async (req) => queryHorizonsStates({ data: req }),
        });
        engine.dt = loaded.dt;
        engine.softening = loaded.softening;
        engine.gMultiplier = 1;
        engine.adaptiveDt = true;
        setGMultiplier(1);
        update({ adaptiveDt: true, showRoche: true });
        engine.reset(loaded.bodies.map((b) => ({ ...b })), { epoch: loaded.epoch });
        tracker.softReset();
        prevTimeRef.current = engine.time;
        setPresetId('nasa-jpl');
        setEphMeta({
          source: loaded.source,
          timeScale: loaded.timeScale,
          label: `${loaded.center} · ${loaded.referenceFrame}`,
        });
        setSelected(null);
        update({ selectedId: null, followId: null, running: false });
        canvasRef.current?.setView({ x: 0, y: 0 }, loaded.viewRadius);
        setMissions(tracker.update(engine));
        setSimTime(engine.time);
        setBodyCount(engine.bodies.length);
        const src = describeEphemerisSource(loaded.source);
        pushLog(`已加载真实太阳系 · ${src} · ${loaded.epoch.slice(0, 10)} ${loaded.timeScale}`, 'success');
        for (const w of loaded.warnings.slice(0, 3)) pushLog(w, 'info');
      } catch (err) {
        pushLog(`星历加载失败：${err instanceof Error ? err.message : 'error'}`, 'warn');
      } finally {
        setEphLoading(false);
      }
    },
    [ephLoading, epochDate, includeSpacecraft, includeMoons, engine, tracker, update, pushLog],
  );

  const handleReroll = useCallback(() => {
    const date = dailyDateRef.current;
    const st = loadDailyState(date);
    if (st.rerollsLeft <= 0) {
      pushLog('换一换次数用完啦，明天再来！', 'warn');
      return;
    }
    const keys = new Set<string>();
    for (const b of engine.bodies) if (b.key) keys.add(b.key);
    const scenarioKeys = [...keys];
    // 找第一个未完成的槽位换掉，已全完成则换第0个
    const defs = dailyDefsRef.current;
    let idx = defs.findIndex((d) => !prevDoneRef.current.has(d.id));
    if (idx < 0) idx = 0;
    const exclude = [...prevDoneRef.current, ...defs.map((d) => d.id)];
    try {
      const next = rerollMission(date, idx, scenarioKeys, exclude);
      const newDefs = [...defs];
      newDefs[idx] = next;
      tracker.setDefs(newDefs, { preserveDone: true });
      dailyDefsRef.current = newDefs;
      setDailyDefs(newDefs);
      const left = st.rerollsLeft - 1;
      setRerollsLeft(left);
      saveDailyState(date, { ...st, rerollsLeft: left });
      setMissions(tracker.update(engine));
      pushLog(`已换一个新任务：${next.title}`, 'success');
    } catch {
      pushLog('换任务失败', 'warn');
    }
  }, [engine, tracker, pushLog]);

  const handleEvent = useCallback(
    (kind: 'rogue' | 'rogueBH' | 'shower' | 'comet' | 'clearUser' | 'clearTrails') => {
      const sun = engine.heaviest();
      const c = sun ? { x: sun.x, y: sun.y } : { x: 0, y: 0 };
      switch (kind) {
        case 'rogue': {
          engine.addBody(rogueStar(c));
          tracker.onRogueSpawned(engine);
          pushLog('⚠️ 一颗流浪恒星正在逼近！', 'warn');
          break;
        }
        case 'rogueBH': {
          engine.addBody(rogueBlackHole(c));
          pushLog('🕳 一个流浪黑洞正在逼近！引力场即将被撕扯！', 'warn');
          break;
        }
        case 'shower': {
          asteroidShower(c).forEach((b) => engine.addBody(b));
          pushLog('陨石雨来袭');
          break;
        }
        case 'comet': {
          if (sun) engine.addBody(longPeriodComet(sun));
          pushLog('一颗长周期彗星正掠过近日点');
          break;
        }
        case 'clearUser': {
          engine.bodies.filter((b) => b.userLaunched).forEach((b) => engine.removeBody(b.id));
          pushLog('已清除所有玩家发射的天体');
          break;
        }
        case 'clearTrails':
          engine.clearTrails();
          break;
      }
    },
    [engine, tracker, pushLog],
  );

  const onLaunch = useCallback(
    (b: Body) => {
      update({ selectedId: b.id });
      setStats(recordLaunch(b.mass));
      pushLog(`发射 ${b.name}`);
    },
    [update, pushLog],
  );

  // 存档:保存/读取/清除
  const onSave = useCallback(() => {
    try {
      const raw = serializeSnapshot(exportSnapshot(engine));
      localStorage.setItem('ssp1-save', raw);
      pushLog('已保存存档', 'success');
    } catch {
      pushLog('保存存档失败', 'warn');
    }
  }, [engine, pushLog]);

  const onLoad = useCallback(() => {
    try {
      const raw = localStorage.getItem('ssp1-save');
      if (!raw) {
        pushLog('没有找到存档', 'warn');
        return;
      }
      const data = parseSnapshot(raw);
      if (!data) {
        pushLog('存档损坏，读取失败', 'warn');
        return;
      }
      restoreSnapshot(engine, data);
      tracker.softReset();
      prevTimeRef.current = engine.time;
      setMissions(tracker.update(engine));
      setSimTime(engine.time);
      setBodyCount(engine.bodies.length);
      setSelected(null);
      pushLog('已读取存档', 'success');
    } catch {
      pushLog('存档损坏，读取失败', 'warn');
    }
  }, [engine, tracker, pushLog]);

  const onClear = useCallback(() => {
    try {
      localStorage.removeItem('ssp1-save');
      pushLog('已清除存档');
    } catch {
      pushLog('清除存档失败', 'warn');
    }
  }, [pushLog]);

  const achievements = useMemo(
    () => ACHIEVEMENTS.map((a) => ({ title: a.title, desc: a.desc, unlocked: a.check(stats) })),
    [stats],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSettings((s) => ({ ...s, running: !s.running }));
      } else if (e.key === 'Escape') {
        setSettings((s) => ({ ...s, selectedId: null }));
        setSelected(null);
      } else if (e.key === 'f' || e.key === 'F') {
        setSettings((s) => ({ ...s, followId: s.selectedId != null && s.followId !== s.selectedId ? s.selectedId : null }));
      } else if (e.key === 'l' || e.key === 'L') {
        setSettings((s) => ({ ...s, tool: 'launch' }));
      } else if (e.key === 'p' || e.key === 'P') {
        setSettings((s) => ({ ...s, tool: 'pan' }));
      } else if (e.key === '+' || e.key === '=') {
        canvasRef.current?.zoomBy(1.3);
      } else if (e.key === '-' || e.key === '_') {
        canvasRef.current?.zoomBy(1 / 1.3);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        setSettings((s) => {
          if (s.selectedId != null) {
            const b = engine.getBody(s.selectedId);
            if (b && b !== engine.heaviest()) engine.removeBody(s.selectedId);
          }
          return s;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const speedIndex = Math.max(0, SPEED_STEPS.findIndex((v) => v >= settings.speed));
  const changeSpeed = (dir: 1 | -1) => {
    const i = Math.min(SPEED_STEPS.length - 1, Math.max(0, speedIndex + dir));
    update({ speed: SPEED_STEPS[i] });
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#02030a] font-sans text-slate-200">
      <SimulationCanvas
        ref={canvasRef}
        engine={engine}
        settings={settings}
        onSelect={(id) => {
          update({ selectedId: id });
          if (id == null) setSelected(null);
        }}
        onFollow={(id) => update({ followId: id })}
        onLaunch={onLaunch}
      />

      {/* Top HUD */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between gap-3 p-3">
        <Panel className="pointer-events-auto flex items-center gap-3 px-4 py-2.5">
          <div>
            <div className="text-sm font-bold tracking-wide text-white">
              <span className="text-amber-300">☀</span> 太阳系物理引擎
            </div>
            <div className="font-mono text-[11px] text-cyan-200/90">
              {formatSimClock(engine.epoch, simTime, engine.simulationDate, ephMeta?.timeScale ?? 'UTC')}
            </div>
            <div className="font-mono text-[10px] text-slate-500">
              {formatTime(simTime)}
              {ephMeta && (
                <span className="ml-2 text-amber-200/80">
                  {ephMeta.source === 'horizons-cache'
                    ? 'DE441'
                    : ephMeta.source === 'horizons-live'
                      ? 'Horizons'
                      : 'Keplerian'}
                  {' · '}
                  {ephMeta.timeScale}
                </span>
              )}
            </div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            <Btn
              active={settings.uiMode === 'science'}
              onClick={() => update({ uiMode: settings.uiMode === 'science' ? 'game' : 'science' })}
              className="w-[5.5rem]"
              title="GAME / SCIENCE"
            >
              {settings.uiMode === 'science' ? 'SCIENCE' : 'GAME'}
            </Btn>
            <Btn onClick={() => update({ running: !settings.running })} className="w-16" title="空格">
              {settings.running ? '⏸ 暂停' : '▶ 继续'}
            </Btn>
            <Btn onClick={() => changeSpeed(-1)} disabled={speedIndex === 0} title="减速">
              −
            </Btn>
            <div className="w-24 text-center font-mono text-xs text-cyan-200">{settings.speed} 天/秒</div>
            <Btn onClick={() => changeSpeed(1)} disabled={speedIndex === SPEED_STEPS.length - 1} title="加速">
              +
            </Btn>
          </div>
        </Panel>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <Btn onClick={() => setPanelOpen((v) => !v)} className="md:hidden">
            {panelOpen ? '隐藏面板' : '控制台'}
          </Btn>
        </div>
      </div>

      {/* Right control panel */}
      <div
        className={`absolute bottom-3 right-3 top-16 flex justify-end transition-transform md:top-3 md:translate-x-0 ${
          panelOpen ? 'translate-x-0' : 'translate-x-[120%]'
        }`}
      >
        <ControlPanel
          settings={settings}
          update={update}
          presetId={presetId}
          onLoadPreset={loadPreset}
          gMultiplier={gMultiplier}
          onGChange={(v) => {
            setGMultiplier(v);
            engine.gMultiplier = v;
          }}
          collisions={collisions}
          onCollisionsChange={(v) => {
            setCollisions(v);
            engine.collisionsEnabled = v;
          }}
          onEvent={handleEvent}
          missions={missions}
          bodyCount={bodyCount}
          onClose={() => setPanelOpen(false)}
          onSave={onSave}
          onLoad={onLoad}
          onClear={onClear}
          achievements={achievements}
          dailyDate={dailyDate}
          rerollsLeft={rerollsLeft}
          onReroll={handleReroll}
          epochDate={epochDate}
          onEpochDate={setEpochDate}
          includeSpacecraft={includeSpacecraft}
          onIncludeSpacecraft={setIncludeSpacecraft}
          includeMoons={includeMoons}
          onIncludeMoons={setIncludeMoons}
          ephemerisLoading={ephLoading}
          ephemerisMeta={ephMeta}
          onLoadEphemeris={handleLoadEphemeris}
        />
      </div>

      {/* 任务完成庆祝 */}
      {celebration && (
        <MissionCelebration
          mission={{
            title: celebration.title,
            emoji: celebration.emoji,
            fact: celebration.fact ?? '你又离成为小小宇航员近了一步！',
            stars: celebration.stars ?? 1,
          }}
          onClose={() => setCelebration(null)}
        />
      )}

      {/* 新手引导 */}
      {onboardStep !== null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <Panel className="w-full max-w-sm px-4 py-3">
            <div className="text-sm font-bold text-white">新手引导 {onboardStep + 1}/3</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-300">
              {onboardStep === 0 && '🚀 第1步：发射天体 — 在画布上按住拖动，松开发射！箭头越长飞得越快。'}
              {onboardStep === 1 && '📅 第2步：做今日任务 — 右侧查看今日3个太空任务，不喜欢可点换一换。'}
              {onboardStep === 2 && '⏯ 第3步：操控时间 — 顶部暂停/加速（空格），滚轮缩放，双击天体可跟随哦！'}
            </div>
            <div className="mt-3 flex justify-between">
              <Btn
                onClick={() => {
                  try { localStorage.setItem('ssp1-onboarded', '1'); } catch { /* 忽略 */ }
                  setOnboardStep(null);
                }}
              >
                跳过
              </Btn>
              <Btn
                onClick={() => {
                  if (onboardStep >= 2) {
                    try { localStorage.setItem('ssp1-onboarded', '1'); } catch { /* 忽略 */ }
                    setOnboardStep(null);
                  } else {
                    setOnboardStep(onboardStep + 1);
                  }
                }}
              >
                {onboardStep === 2 ? '出发！' : '下一步'}
              </Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Bottom-left: body card + logs + help + diagnostics */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col items-start gap-2">
          <DiagnosticsPanel
            report={settings.uiMode === 'science' ? drift : null}
            encounter={settings.uiMode === 'science' ? encounter : null}
          />
        {showHelp && !selected && (
          <Panel className="pointer-events-auto max-w-xs px-3 py-2 text-[11px] leading-relaxed text-slate-300">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-white">操作指南</span>
              <button type="button" className="text-slate-400 hover:text-white" onClick={() => setShowHelp(false)}>
                ✕
              </button>
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>发射模式：按住拖动 → 松开发射（箭头 = 速度）</li>
              <li>滚轮 / 双指缩放；Shift+拖动 或 右键拖动 平移</li>
              <li>单击选中天体，双击跟随；F 切换跟随</li>
              <li>空格 暂停；+/- 缩放；Delete 删除选中天体</li>
              <li>◆ L1–L5 拉格朗日点；Hill / SOI / Roche 可在控制台开关</li>
              <li>GAME / SCIENCE 切换同一引擎的玩法与科学面板</li>
              <li>NASA / JPL：右侧选历元加载真实太阳系；勾选卫星后跟随木星并放大</li>
              <li>🕳 可发射黑洞，或用事件召唤流浪黑洞；双击黑洞可跟随观察吸积</li>
              <li>完成右侧任务，或制造你自己的星系灾难</li>
            </ul>
          </Panel>
        )}
        {selected && (
          <div className="pointer-events-auto">
            <BodyCard
              body={selected}
              mode={settings.uiMode}
              following={settings.followId === selected.id}
              onFollow={() => update({ followId: settings.followId === selected.id ? null : selected.id })}
              onDelete={() => {
                engine.removeBody(selected.id);
                setSelected(null);
                update({ selectedId: null, followId: settings.followId === selected.id ? null : settings.followId });
              }}
              onScaleMass={(f) => {
                const b = engine.getBody(selected.id);
                if (b) {
                  b.mass *= f;
                  const c = Math.cbrt(f);
                  b.physicalRadius *= c;
                  b.renderRadius *= c;
                  if (!engine.arcadeCollisions) b.collisionRadius = b.physicalRadius;
                  else b.collisionRadius *= c;
                }
              }}
              onClose={() => {
                update({ selectedId: null });
                setSelected(null);
              }}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          {logs.map((l) => (
            <div
              key={l.id}
              className={`rounded-md border px-2.5 py-1 text-[11px] backdrop-blur ${
                l.kind === 'warn'
                  ? 'border-rose-400/30 bg-rose-950/60 text-rose-100'
                  : l.kind === 'success'
                    ? 'border-emerald-400/30 bg-emerald-950/60 text-emerald-100'
                    : 'border-white/10 bg-slate-950/60 text-slate-300'
              }`}
            >
              {l.text}
            </div>
          ))}
        </div>
      </div>

      {!settings.running && (
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/70 px-4 py-1 text-xs tracking-widest text-slate-300">
          已暂停
        </div>
      )}
    </div>
  );
}
