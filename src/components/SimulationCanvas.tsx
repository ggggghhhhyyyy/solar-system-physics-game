import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { Engine } from '../physics/engine';
import { TRAIL_MAX } from '../physics/engine';
import type { Body } from '../physics/types';
import { LAUNCH_TYPES } from '../physics/presets';
import { AU_PER_YEAR_TO_KMS, LAUNCH_SCALE, type Settings } from '../game/settings';

export interface CanvasHandle {
  setView: (center: { x: number; y: number }, radius: number) => void;
  zoomBy: (factor: number) => void;
}

interface Props {
  engine: Engine;
  settings: Settings;
  onSelect: (id: number | null) => void;
  onFollow: (id: number | null) => void;
  onLaunch: (body: Body) => void;
}

interface Camera {
  cx: number;
  cy: number;
  zoom: number; // px per AU
}

interface Drag {
  mode: 'pan' | 'launch';
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  curX: number;
  curY: number;
  startWorld: { x: number; y: number };
  moved: boolean;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  p: number;
}

const SCALE_CANDIDATES = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

function hexToRgb(hex: string): [number, number, number] {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g);
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  }
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SimulationCanvas = forwardRef<CanvasHandle, Props>(function SimulationCanvas(
  { engine, settings, onSelect, onFollow, onLaunch },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Camera>({ cx: 0, cy: 0, zoom: 60 });
  const dragRef = useRef<Drag | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const settingsRef = useRef(settings);
  const callbacksRef = useRef({ onSelect, onFollow, onLaunch });
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const starsRef = useRef<Star[]>([]);
  const lastTimeRef = useRef<number>(performance.now());
  const rgbCache = useRef<Map<string, [number, number, number]>>(new Map());

  settingsRef.current = settings;
  callbacksRef.current = { onSelect, onFollow, onLaunch };

  if (starsRef.current.length === 0) {
    const arr: Star[] = [];
    for (let i = 0; i < 420; i++) {
      arr.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() < 0.85 ? 0.6 + Math.random() * 0.7 : 1.3 + Math.random() * 0.9,
        a: 0.25 + Math.random() * 0.6,
        p: Math.random() * Math.PI * 2,
      });
    }
    starsRef.current = arr;
  }

  const rgb = (c: string): [number, number, number] => {
    let v = rgbCache.current.get(c);
    if (!v) {
      v = hexToRgb(c);
      rgbCache.current.set(c, v);
    }
    return v;
  };

  useImperativeHandle(ref, () => ({
    setView(center, radius) {
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      cam.cx = center.x;
      cam.cy = center.y;
      cam.zoom = Math.min(w, h) / 2 / radius;
    },
    zoomBy(factor) {
      const cam = camRef.current;
      cam.zoom = Math.min(30000, Math.max(0.3, cam.zoom * factor));
    },
  }));

  const toScreen = useCallback((wx: number, wy: number) => {
    const { w, h } = sizeRef.current;
    const cam = camRef.current;
    return [(wx - cam.cx) * cam.zoom + w / 2, h / 2 - (wy - cam.cy) * cam.zoom] as const;
  }, []);

  const toWorld = useCallback((sx: number, sy: number) => {
    const { w, h } = sizeRef.current;
    const cam = camRef.current;
    return { x: (sx - w / 2) / cam.zoom + cam.cx, y: cam.cy - (sy - h / 2) / cam.zoom };
  }, []);

  /** Compute launch velocity from the current drag (includes followed body's velocity). */
  const launchVelocity = useCallback((d: Drag) => {
    const dx = d.curX - d.startX;
    const dy = d.curY - d.startY;
    let vx = dx * LAUNCH_SCALE;
    let vy = -dy * LAUNCH_SCALE;
    const follow = engine.getBody(settingsRef.current.followId);
    if (follow) {
      vx += follow.vx;
      vy += follow.vy;
    }
    return { vx, vy, relSpeed: Math.hypot(vx - (follow?.vx ?? 0), vy - (follow?.vy ?? 0)) };
  }, [engine]);

  /* ---------------- Resize ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- Main loop ---------------- */
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const real = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;
      const s = settingsRef.current;

      if (s.running) {
        const years = (s.speed * real) / 365.25;
        const steps = Math.round(years / engine.dt);
        const budgetEnd = performance.now() + 12;
        for (let i = 0; i < steps; i++) {
          engine.step();
          if ((i & 15) === 15 && performance.now() > budgetEnd) break;
        }
      }

      if (s.followId != null) {
        const b = engine.getBody(s.followId);
        if (b) {
          camRef.current.cx = b.x;
          camRef.current.cy = b.y;
        } else {
          callbacksRef.current.onFollow(null);
        }
      }

      render(ctx, now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  /* ---------------- Render ---------------- */
  const render = (ctx: CanvasRenderingContext2D, now: number) => {
    const { w, h, dpr } = sizeRef.current;
    const cam = camRef.current;
    const s = settingsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.8);
    bg.addColorStop(0, '#0b1026');
    bg.addColorStop(1, '#02030a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // stars
    const t = now / 1000;
    for (const st of starsRef.current) {
      const a = st.a * (0.75 + 0.25 * Math.sin(t * 1.5 + st.p));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const bodies = engine.bodies;
    const sun = engine.heaviest();

    // trails
    if (s.showTrails) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const b of bodies) {
        if (b.trailCount < 2) continue;
        const tiny = b.mass < 1e-9 && !b.userLaunched;
        const count = tiny ? Math.min(b.trailCount, 80) : b.trailCount;
        const [r, g, bl] = rgb(b.color);
        const chunks = tiny ? 1 : 4;
        const per = Math.ceil(count / chunks);
        for (let c = 0; c < chunks; c++) {
          const from = c * per;
          const to = Math.min(count, (c + 1) * per + 1);
          if (from >= to - 1) continue;
          const alpha = tiny ? 0.18 : 0.12 + (0.55 * (c + 1)) / chunks;
          ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`;
          ctx.lineWidth = tiny ? 0.8 : 1.2;
          ctx.beginPath();
          for (let k = from; k < to; k++) {
            const idx = (b.trailHead - count + k + TRAIL_MAX * 2) % TRAIL_MAX;
            const [sx, sy] = toScreen(b.trail[idx * 2], b.trail[idx * 2 + 1]);
            if (k === from) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          if (to === count) {
            const [sx, sy] = toScreen(b.x, b.y);
            ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
      }
    }

    // 选中天体束缚椭圆轨道叠加(世界坐标直接画,线宽固定1)
    {
      const sel = s.selectedId != null ? engine.getBody(s.selectedId) : undefined;
      const ref = engine.heaviest();
      if (sel && ref && sel !== ref) {
        const E = engine.specificEnergy(sel, ref);
        // 双曲线(E>=0)不画椭圆
        if (E < 0) {
          const rx = sel.x - ref.x;
          const ry = sel.y - ref.y;
          const rvx = sel.vx - ref.vx;
          const rvy = sel.vy - ref.vy;
          const r = Math.hypot(rx, ry);
          const mu = engine.G * (ref.mass + sel.mass);
          if (r > 1e-9 && mu > 0 && Number.isFinite(E)) {
            const h = rx * rvy - ry * rvx;
            const a = -mu / (2 * E);
            let e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (mu * mu)));
            if (!Number.isFinite(e)) e = 0;
            e = Math.max(0, Math.min(e, 0.999));
            if (Number.isFinite(a) && a > 0 && a < 1e6) {
              // 偏心率矢量求近心点方向: e_vec=((v²-mu/r)*r_vec-(r·v)*v_vec)/mu,用相对量
              const v2 = rvx * rvx + rvy * rvy;
              const rSafe = Math.max(r, 1e-9);
              const rdotv = rx * rvx + ry * rvy;
              const ex = ((v2 - mu / rSafe) * rx - rdotv * rvx) / mu;
              const ey = ((v2 - mu / rSafe) * ry - rdotv * rvy) / mu;
              let omega = Math.atan2(ey, ex);
              if (!Number.isFinite(omega) || Math.hypot(ex, ey) < 1e-8) omega = 0; // 圆轨道方向任意
              const cosO = Math.cos(omega);
              const sinO = Math.sin(omega);
              const p = a * (1 - e * e);
              ctx.strokeStyle = 'rgba(103, 232, 249, 0.4)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              const SEG = 128;
              for (let k = 0; k <= SEG; k++) {
                const nu = (k / SEG) * Math.PI * 2;
                const rr = p / Math.max(1e-9, 1 + e * Math.cos(nu));
                const ox = rr * Math.cos(nu);
                const oy = rr * Math.sin(nu);
                const wx = ref.x + ox * cosO - oy * sinO;
                const wy = ref.y + ox * sinO + oy * cosO;
                const [sx, sy] = toScreen(wx, wy);
                if (k === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              }
              ctx.stroke();
            }
          }
        }
      }
    }

    // launch preview
    const d = dragRef.current;
    let previewSpec: { x: number; y: number; vx: number; vy: number; mass: number } | null = null;
    let previewBound = true;
    let previewRatio: number | null = null;
    if (d && d.mode === 'launch' && d.moved) {
      const lt = LAUNCH_TYPES.find((l) => l.id === s.launchTypeId) ?? LAUNCH_TYPES[0];
      const { vx, vy } = launchVelocity(d);
      previewSpec = { x: d.startWorld.x, y: d.startWorld.y, vx, vy, mass: lt.mass };
      // 用 specificEnergy 判断束缚/逃逸,决定预判着色;并算 v/v_esc
      if (sun) {
        const eSpec = engine.specificEnergy(previewSpec as unknown as Body, sun);
        previewBound = eSpec < 0;
        const r = Math.hypot(previewSpec.x - sun.x, previewSpec.y - sun.y);
        const vrel = Math.hypot(previewSpec.vx - sun.vx, previewSpec.vy - sun.vy);
        const mu = engine.G * sun.mass;
        const vesc = Math.sqrt((2 * mu) / Math.max(r, 1e-9));
        previewRatio = vrel / vesc;
      }
      if (s.showPrediction) {
        const pts = engine.predict(previewSpec, 800, 3, 4);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = previewBound ? 'rgba(103, 232, 249, 0.75)' : 'rgba(251, 113, 133, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const [sx, sy] = toScreen(pts[i], pts[i + 1]);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // bodies
    for (const b of bodies) {
      const [sx, sy] = toScreen(b.x, b.y);
      const minPx = b.isStar ? 7 : b.mass > 1e-5 ? 4.5 : 3;
      const pr = Math.max(minPx, b.radius * cam.zoom);
      const margin = b.isStar ? pr * 6 : pr + 40;
      if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;
      const [r, g, bl] = rgb(b.color);

      if (b.isStar) {
        const glowR = pr * 5.5;
        const glow = ctx.createRadialGradient(sx, sy, pr * 0.5, sx, sy, glowR);
        glow.addColorStop(0, `rgba(${r},${g},${bl},0.55)`);
        glow.addColorStop(0.35, `rgba(${r},${g},${bl},0.16)`);
        glow.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fill();

        const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, pr);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.45, `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, bl + 40)})`);
        core.addColorStop(1, b.color);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(sx, sy, pr, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // base
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(sx, sy, pr, 0, Math.PI * 2);
        ctx.fill();
        // shading toward light source
        if (pr >= 3 && sun && sun !== b) {
          const [lx0, ly0] = toScreen(sun.x, sun.y);
          let lx = lx0 - sx;
          let ly = ly0 - sy;
          const len = Math.hypot(lx, ly) || 1;
          lx /= len;
          ly /= len;
          const shade = ctx.createRadialGradient(
            sx + lx * pr * 0.55, sy + ly * pr * 0.55, pr * 0.15,
            sx, sy, pr * 1.05,
          );
          shade.addColorStop(0, 'rgba(255,255,255,0.28)');
          shade.addColorStop(0.45, 'rgba(0,0,0,0)');
          shade.addColorStop(1, 'rgba(0,0,0,0.78)');
          ctx.fillStyle = shade;
          ctx.beginPath();
          ctx.arc(sx, sy, pr, 0, Math.PI * 2);
          ctx.fill();
        }
        if (b.ring && pr >= 3) {
          ctx.strokeStyle = `rgba(${r},${g},${bl},0.65)`;
          ctx.lineWidth = Math.max(1.2, pr * 0.35);
          ctx.beginPath();
          ctx.ellipse(sx, sy, pr * 2.1, pr * 0.65, -0.35, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const selected = b.id === s.selectedId;
      if (selected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, pr + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.id === s.followId) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.lineWidth = 1.5;
        const rr = pr + 12;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a0 = (k * Math.PI) / 2 - 0.35 + t * 0.8;
          ctx.moveTo(sx + Math.cos(a0) * rr, sy + Math.sin(a0) * rr);
          ctx.arc(sx, sy, rr, a0, a0 + 0.7);
        }
        ctx.stroke();
      }

      if (s.showLabels && (b.mass > 1e-8 || selected || b.userLaunched)) {
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(226,232,240,0.7)';
        ctx.textAlign = 'left';
        ctx.fillText(b.name, sx + pr + 5, sy - pr - 3);
      }
    }

    // 拉格朗日点 L1~L5(质量前二 M1>M2,仅 showLabels 时)
    if (s.showLabels && bodies.length >= 2) {
      let m1: Body | undefined;
      let m2: Body | undefined;
      for (const b of bodies) {
        if (!m1 || b.mass > m1.mass) {
          m2 = m1;
          m1 = b;
        } else if (!m2 || b.mass > m2.mass) {
          m2 = b;
        }
      }
      if (m1 && m2 && m2.mass > 0 && m1.mass / m2.mass > 20) {
        const dx = m2.x - m1.x;
        const dy = m2.y - m1.y;
        const dd = Math.hypot(dx, dy);
        if (dd > 1e-6) {
          const ux = dx / dd;
          const uy = dy / dd;
          const rH = dd * Math.cbrt(m2.mass / (3 * m1.mass)); // Hill 半径
          // L1/L2: 连线上距 M2 ±rH(近似); L3: M1 外侧反方向近似,非精确解
          const q = 1 + (7 * m2.mass) / (12 * m1.mass); // L3 近似系数
          const pts: Array<[number, number, string]> = [
            [m2.x - ux * rH, m2.y - uy * rH, 'L1'],
            [m2.x + ux * rH, m2.y + uy * rH, 'L2'],
            [m1.x - ux * dd * q, m1.y - uy * dd * q, 'L3'],
          ];
          // L4/L5: 等边三角形精确解
          const mx = (m1.x + m2.x) / 2;
          const my = (m1.y + m2.y) / 2;
          const hx = -uy * dd * (Math.sqrt(3) / 2);
          const hy = ux * dd * (Math.sqrt(3) / 2);
          pts.push([mx + hx, my + hy, 'L4'], [mx - hx, my - hy, 'L5']);
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'left';
          for (const [wx, wy, label] of pts) {
            const [sx, sy] = toScreen(wx, wy);
            if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
            ctx.fillStyle = 'rgba(251, 191, 36, 0.5)';
            ctx.lineWidth = 1;
            const R = 5;
            ctx.beginPath();
            ctx.moveTo(sx, sy - R);
            ctx.lineTo(sx + R, sy);
            ctx.lineTo(sx, sy + R);
            ctx.lineTo(sx - R, sy);
            ctx.closePath();
            ctx.stroke();
            ctx.fillText(label, sx + 7, sy + 3);
          }
        }
      }
    }

    // launch ghost + arrow
    if (d && d.mode === 'launch') {
      const lt = LAUNCH_TYPES.find((l) => l.id === s.launchTypeId) ?? LAUNCH_TYPES[0];
      const [gx, gy] = toScreen(d.startWorld.x, d.startWorld.y);
      const pr = Math.max(lt.isStar ? 7 : 4, lt.radius * cam.zoom);
      ctx.fillStyle = lt.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(gx, gy, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (d.moved) {
        const ex = d.curX;
        const ey = d.curY;
        // 发射预判着色:束缚青色系,逃逸 amber/rose 系(与预测线一致)
        const arrowCol = previewBound ? 'rgba(255,255,255,0.85)' : 'rgba(251, 113, 133, 0.9)';
        ctx.strokeStyle = arrowCol;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const ang = Math.atan2(ey - gy, ex - gx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 10 * Math.cos(ang - 0.4), ey - 10 * Math.sin(ang - 0.4));
        ctx.lineTo(ex - 10 * Math.cos(ang + 0.4), ey - 10 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = arrowCol;
        ctx.fill();

        const { relSpeed, vx, vy } = launchVelocity(d);
        let info = `v = ${relSpeed.toFixed(2)} AU/年 ≈ ${(relSpeed * AU_PER_YEAR_TO_KMS).toFixed(1)} km/s`;
        if (sun) {
          const dx = d.startWorld.x - sun.x;
          const dy = d.startWorld.y - sun.y;
          const rr = Math.hypot(dx, dy);
          const vcirc = Math.sqrt((engine.G * sun.mass) / Math.max(rr, 1e-6));
          const dvx = vx - sun.vx;
          const dvy = vy - sun.vy;
          const e = 0.5 * (dvx * dvx + dvy * dvy) - (engine.G * sun.mass) / Math.max(rr, 1e-6);
          info += `  |  圆轨道 ${vcirc.toFixed(2)}  |  ${e < 0 ? '束缚轨道' : '逃逸轨道'}`;
          // v_esc=sqrt(2*mu/r),mu=G*M,箭头旁小字
          if (previewRatio != null && Number.isFinite(previewRatio)) {
            info += `  |  v/v_esc=${previewRatio.toFixed(2)}`;
          }
        }
        ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        const tw = ctx.measureText(info).width;
        const bx = Math.min(ex + 14, w - tw - 16);
        const by = ey - 10;
        ctx.fillStyle = 'rgba(2,6,23,0.75)';
        ctx.fillRect(bx - 6, by - 14, tw + 12, 20);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(info, bx, by);
      }
    }

    // scale bar
    let unit = SCALE_CANDIDATES[0];
    for (const c of SCALE_CANDIDATES) {
      if (c * cam.zoom >= 70) {
        unit = c;
        break;
      }
      unit = c;
    }
    const px = unit * cam.zoom;
    const bx = w - 24 - px;
    const by = h - 22;
    ctx.strokeStyle = 'rgba(226,232,240,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px, by);
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + px, by - 4);
    ctx.lineTo(bx + px, by + 4);
    ctx.stroke();
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(226,232,240,0.75)';
    ctx.fillText(unit >= 1 ? `${unit} AU` : `${unit} AU (${(unit * 1.496e8).toExponential(1)} km)`, bx + px / 2, by - 8);
  };

  /* ---------------- Pointer handling ---------------- */
  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const p = getPos(e);
    pointersRef.current.set(e.pointerId, p);

    if (pointersRef.current.size === 2) {
      // start pinch, cancel drag
      dragRef.current = null;
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: camRef.current.zoom };
      return;
    }
    if (pointersRef.current.size > 2) return;

    const s = settingsRef.current;
    const isPan = s.tool === 'pan' || e.button === 1 || e.button === 2 || e.shiftKey;
    dragRef.current = {
      mode: isPan ? 'pan' : 'launch',
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      curX: p.x,
      curY: p.y,
      startWorld: toWorld(p.x, p.y),
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = getPos(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p);

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cam = camRef.current;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const before = toWorld(mid.x, mid.y);
      cam.zoom = Math.min(30000, Math.max(0.3, (pinchRef.current.zoom * dist) / Math.max(1, pinchRef.current.dist)));
      const { w, h } = sizeRef.current;
      if (settingsRef.current.followId == null) {
        cam.cx = before.x - (mid.x - w / 2) / cam.zoom;
        cam.cy = before.y + (mid.y - h / 2) / cam.zoom;
      }
      return;
    }

    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.curX = p.x;
    d.curY = p.y;
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > 4) d.moved = true;
    if (d.mode === 'pan' && d.moved) {
      const cam = camRef.current;
      if (settingsRef.current.followId != null) callbacksRef.current.onFollow(null);
      cam.cx -= (p.x - d.lastX) / cam.zoom;
      cam.cy += (p.y - d.lastY) / cam.zoom;
    }
    d.lastX = p.x;
    d.lastY = p.y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;

    const s = settingsRef.current;
    if (!d.moved) {
      // click -> select
      const wpt = toWorld(d.startX, d.startY);
      const hit = engine.bodyAt(wpt.x, wpt.y, 10 / camRef.current.zoom);
      callbacksRef.current.onSelect(hit ? hit.id : null);
      return;
    }
    if (d.mode === 'launch') {
      const lt = LAUNCH_TYPES.find((l) => l.id === s.launchTypeId) ?? LAUNCH_TYPES[0];
      const { vx, vy } = launchVelocity(d);
      const count = engine.bodies.filter((b) => b.userLaunched).length + 1;
      const body = engine.addBody({
        name: `${lt.name}-${count}`,
        mass: lt.mass,
        radius: lt.radius,
        color: lt.color,
        isStar: lt.isStar,
        x: d.startWorld.x,
        y: d.startWorld.y,
        vx,
        vy,
        userLaunched: true,
      });
      callbacksRef.current.onLaunch(body);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const cam = camRef.current;
    const before = toWorld(sx, sy);
    const factor = Math.exp(-e.deltaY * 0.0012);
    cam.zoom = Math.min(30000, Math.max(0.3, cam.zoom * factor));
    if (settingsRef.current.followId == null) {
      const { w, h } = sizeRef.current;
      cam.cx = before.x - (sx - w / 2) / cam.zoom;
      cam.cy = before.y + (sy - h / 2) / cam.zoom;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const wpt = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = engine.bodyAt(wpt.x, wpt.y, 10 / camRef.current.zoom);
    if (hit) {
      callbacksRef.current.onSelect(hit.id);
      callbacksRef.current.onFollow(hit.id);
    }
  };

  // prevent page scroll on wheel over canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', prevent, { passive: false });
    return () => c.removeEventListener('wheel', prevent);
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full touch-none select-none ${settings.tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
});

export default SimulationCanvas;
