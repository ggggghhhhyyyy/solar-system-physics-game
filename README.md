# 太阳系物理引擎 · Physics Simulation V2

3D 牛顿 N 体模拟。引擎不认识 NASA：JPL Horizons → 归一化状态矢量 → 物理引擎。

**不要**把物理半径放大来好看。太阳**不**钉在原点。默认积分器是 leapfrog (KDK)。

## 运行

```bash
npm install
npm test
npm run dev
```

打开控制面板 **NASA / JPL** → `Horizons`。默认历元 `2026-09-11` 走 DE441 烘焙缓存（太阳 + 8 行星 + 月球 + 7 颗主要卫星 + 6 艘探测器），不打 NASA。其它历元走实时 Horizons，失败则回落 JPL 开普勒近似。

| 模式 | 做什么 |
|---|---|
| GAME | 可视半径、任务、发射 |
| SCIENCE | 真半径、Hill / SOI / Roche 环、CLOSE APPROACH、守恒诊断 |

## Phase 1–3

| 阶段 | 内容 |
|---|---|
| 1 | 3D 状态；physical / render / collision 半径分离；test particles；leapfrog；六根数；Hill / SOI；CRTBP L1–L5；质心/日心/体心 |
| 2 | JPL Horizons 适配器；真历元；DE441 缓存；开普勒回落；航天器 = test particle |
| 3 | Roche / TDE（只报告，不假流体碎裂）；近距离交会 HUD；自适应 leapfrog 子步；伊奥/欧罗巴/木卫三/木卫四/泰坦/海卫一/卡戎 |

公式、单位、限制见 [docs/PHYSICS_V2.md](docs/PHYSICS_V2.md)。

## 单位

位置 AU，速度 AU/year，质量 M☉，`G = 4π²`。Horizons `AU-D` 速度 × 365.25 = 引擎 `AU/year`。

## 测试

`npm test` 跑 `src/physics/physics.test.ts` 与 `src/physics/ephemeris/ephemeris.test.ts`（node:test）。地球 g / vesc / 密度、Hill、SOI、月球在 Roche 外、TDE、线性 t_CA、伽利略卫星距离都在里面。
