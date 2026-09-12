# 太阳系物理引擎 · Physics Simulation V2 (Hardening)

3D 牛顿 N 体模拟。引擎不认识 NASA：

```
Browser  →  POST /api/horizons (catalog keys + epoch only)
         →  Vite middleware / Vercel function 组装 JPL URL
         →  NASA Horizons
         →  EphemerisState
         →  Engine
```

浏览器禁止直连 NASA。禁止把 URL 交给代理。`source=horizons` 失败时**不会**偷偷回落到开普勒。

**不要**把物理半径放大来好看。太阳**不**钉在原点。默认积分器是 leapfrog KDK。自适应是子步加密，不是自适应辛积分器。

## 运行

```bash
npm install
npm test
npm run typecheck
npm run dev
```

`npm run dev` / `npm run preview` 通过 Vite 中间件提供真正的服务端 `/api/horizons`。部署到 Vercel 时走 `api/horizons.ts`。单文件 HTML 构建没有服务器：DE441 缓存和开普勒回落仍可离线工作，实时 Horizons 需要后端。

打开控制面板 **NASA / JPL**：

| 按钮 | 语义 |
|---|---|
| Horizons | 缓存或实时。失败报错，不偷偷回落 |
| Auto | 缓存 → 实时 → 开普勒。UI 显示 `SOURCE: KEPLERIAN FALLBACK` |
| 开普勒 | JPL 两体近似。UI 显示 `PHYSICAL APPROXIMATION` |

默认历元 `2026-09-11 00:00:00 TDB`（不是 `…Z` UTC）走烘焙 DE441。

## 模式

| 模式 | 做什么 |
|---|---|
| GAME | 可视半径、任务、发射、改 G、黑洞、陨石雨 |
| SCIENCE | 真半径、六根数、Hill / SOI / Roche、守恒诊断、TDB 历元、近似徽章 |

GAME 预设用 Gaussian `G = 4π²`。JPL/SCIENCE 载荷用 DE440 μ☉。

## 测试 / CI / bench

```
npm test
npm run typecheck
npm run build
npm run bench
```

GitHub Actions 跑 typecheck + test + build。`npm run bench` 打印 100 / 1k / 10k tracer 的 force / encounter / step ms，不是 CI 门槛。

公式、单位、限制、剩余近似见 [docs/PHYSICS_V2.md](docs/PHYSICS_V2.md)。

## Phase 1–3（已硬化）

| 阶段 | 内容 |
|---|---|
| 1 | 3D 状态；physical / render / collision 半径分离；test particles；leapfrog；六根数；Hill / SOI；CRTBP L1–L5；质心/日心/体心 |
| 2 | JPL Horizons 适配器；Epoch {jd, scale}；DE441 缓存（TDB）；开普勒回落；航天器 = test particle |
| 3 | Roche / TDE（只报告）；近距离交会 HUD（LINEAR APPROX）；自适应子步；主要卫星 |

Phase 4（航天器推进 / Lambert / GR / Three.js）不在本轮。
