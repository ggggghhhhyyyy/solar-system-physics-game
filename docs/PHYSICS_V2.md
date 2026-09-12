# Physics Simulation V2 — Hardening (Phases 1–3)

NASA / JPL-ready scientific foundation. This document is the source of truth
for what is **physical**, what is **visual**, and what is **gameplay**.

**Render can lie. Physics cannot.**

---

## 1. Units

| Quantity | Unit | Notes |
|---|---|---|
| Position | AU | IAU 2012 exact: 1 AU = 149 597 870 700 m |
| Velocity | AU / year | Gaussian year: circular 1 AU / 1 M☉ has P = 1 |
| Mass | M☉ | 1.98847 × 10³⁰ kg |
| Time | year | engine `time` is years since reset. Scientific clock is `Epoch { jd, scale }` |
| G (GAME) | 4π² AU³ M☉⁻¹ yr⁻² | Gaussian pedagogical unit. 1 AU / 1 M☉ / 1 yr |
| μ☉ (SCIENCE/JPL) | DE440 GM_sun → AU³/yr² | `GM_SUN_AU3_YR2`. Used with Horizons / DE441 states |

Derived scientific properties (g, density, km/s) use SI G, not 4π².
The two constants differ by ~5 × 10⁻⁵; documented, not hidden.

---

## 2. Coordinate system

Right-handed inertial frame.

- +x, +y in the reference plane (ecliptic-like)
- +z angular-momentum north
- Origin is **not** nailed to the Sun. The Sun orbits the barycentre.

The Canvas renderer is a **2D xy projection** of the 3D state.
That is a **VISUAL APPROXIMATION**.

---

## 3. State vector

Every body carries:

```
x y z     AU
vx vy vz  AU/year
ax ay az  AU/year²
```

`fixed` remains a sandbox superpower. Real-solar-system presets do **not**
pin the Sun.

---

## 4. Reference frames

`src/physics/frames/referenceFrames.ts`

| Kind | Origin |
|---|---|
| Barycentric | mass-weighted COM of massive bodies |
| Heliocentric | heaviest star |
| Body-centric | any selected body |

`getRelativeState(body, reference)` returns `{x,y,z,vx,vy,vz}`.
UI and the engine must not assume the Sun sits at (0,0,0).

---

## 5. Integrator

Default: **Leapfrog / kick-drift-kick** (velocity Verlet).

- Symplectic, 2nd order, time-reversible
- Isolated in `src/physics/integrators/leapfrog.ts`
- Engine holds an `Integrator` interface for future Adaptive / high-order methods

Phase 1 ships only Leapfrog. Behaviour must not regress.

---

## 6. physicalRadius vs renderRadius vs collisionRadius

This is the Phase 1 architectural fix.

| Field | Unit | Enters physics? | Meaning |
|---|---|---|---|
| `physicalRadius` | AU | **yes** | real size. Collision, g, vesc, density, Hill, Roche |
| `collisionRadius` | AU | **yes** | defaults to `physicalRadius`. Arcade/debug only may inflate |
| `renderRadius` | AU | **never** | display hint. GAME mode uses it; SCIENCE prefers physical |

Renderer:

```
screenRadius = max(physicalProjected, minimumReadablePixelRadius)
```

SCIENCE: physical projected, still floored so moons stay clickable.
GAME: `renderRadius` (legacy exaggerated size) so the sandbox still looks like
a planetarium, not a set of invisible dots.

**Do not “fix” visibility by lying about physical size.**

Famous bodies (Sun, Earth, Moon, Jupiter, …) use catalog mean radii
(`src/physics/constants.ts` `PHYSICAL_RADIUS_AU`).
Procedural / unnamed bodies use a density heuristic marked
**GAMEPLAY APPROXIMATION**.

Black-hole `physicalRadius` is the Schwarzschild radius `2GM/c²`.
The accretion-disk graphic is **VISUAL APPROXIMATION**.

---

## 7. Test particle semantics

`gravityMode: "massive" | "test-particle"`

- **massive** — mutual N-body. Sources gravity and feels it.
- **test-particle** — feels massive bodies, **does not** source gravity.
  Excluded from Barnes-Hut trees, pairwise back-reaction, and conservation totals.

Default test particles: asteroid belt, Kuiper belt, Trojan swarms,
accretion-disk debris, meteor showers.

User-launched asteroids remain **massive** unless the launch type says otherwise.
A “real asteroid” can still be massive.

---

## 8. Orbital elements

Classical six elements plus periapsis / apoapsis / period:

`a, e, i, Ω, ω, ν`  (`src/physics/orbital/elements.ts`)

Degenerate cases return `0` / `null`, never NaN:

- circular (`e ≈ 0`) — ω undefined, set 0; ν = argument of latitude
- equatorial (`i ≈ 0`) — Ω undefined, set 0
- hyperbolic (`e > 1`) — `unbound`, `kind: 'hyperbolic'`, period = null, UI shows **Hyperbolic / Escape**
- rectilinear (`|h| ≈ 0`) — flagged, elements mostly null

Two-body elements are osculating relative to a chosen primary
(usually the heaviest body). N-body osculating elements wander; that is physics,
not a bug.

---

## 9. Diagnostics

`src/physics/diagnostics/conservation.ts`

Reported over **massive** bodies only:

- Kinetic, potential, total energy
- Linear momentum Px, Py, Pz, |P|
- COM x, y, z
- Angular momentum Lx, Ly, Lz, |L|
- Drift vs baseline taken at `reset`: ΔE/E0, |ΔP|, ΔL/L0, |ΔCOM|

Colour bands (UI must not hardcode):

| | green | amber | red |
|---|---|---|---|
| ΔE/E0 | ≤ 1e-6 | ≤ 1e-3 | else |
| \|ΔP\| | ≤ 1e-9 | ≤ 1e-6 | else |
| ΔL/L0 | ≤ 1e-6 | ≤ 1e-3 | else |
| COM AU | ≤ 1e-8 | ≤ 1e-5 | else |

Leapfrog energy *oscillates* at ~dt²; look at the envelope, not a single sample.

---

## 10. Known approximations

Marked in code where they live.

| Item | Class | What it is |
|---|---|---|
| Canvas xy projection | VISUAL | 3D state, 2D view |
| `renderRadius` / min pixel size | VISUAL | planets stay visible |
| Softening ε | PHYSICAL (numerical) | Plummer-like; not a physical radius |
| Barnes-Hut monopole, θ = 0.7 | PHYSICAL (numerical) | N > 150 |
| Hill / SOI using osculating *a* or current *r* | PHYSICAL (approx) | circular-restricted |
| Lagrange CRTBP snapshot | PHYSICAL (approx) | circular, planar, no station-keeping |
| G = 4π² vs SI G | PHYSICAL (unit choice) | ~5e-5 relative |
| Inflated moon *orbits* in some presets | GAMEPLAY | so moons sit outside the visual disk |
| TRAPPIST-1 orbital scale | GAMEPLAY | real 0.011–0.063 AU, shown larger |
| Jupiter-moons orbital scale | GAMEPLAY | Galilean distances enlarged to view |
| Procedural density → radius | GAMEPLAY | unnamed bodies only |
| Trails store x,y only | VISUAL | z omitted from the ribbon |
| Keplerian JPL tables | PHYSICAL (approx) | two-body, Earth = EMB, no Moon |

---

## 11. Known limitations (Phase 1)

- No GR, no atmospheres, no radiation pressure
- No high-order integrator (leapfrog remains default; adaptive only substeps it)
- Collision is merge (inelastic + mass/volume combine). No fragmentation
- Finite-dt tunneling is mitigated by a simple swept test, not a full CCD
- Roche / TDE is **detected and displayed**, not hydro-fragmented
- 2D canvas cannot show true 3D camera orbits
- Test-particle self-gravity is identically zero by design
- Save v1 `radius` is migrated as *both* physical and render — we do **not**
  silently reinterpret inflated display radii as real sizes
- Linear t_CA is a constant-velocity warning, not a Kepler ephemeris

---

## 12. Phase 2 — NASA / JPL real solar system  **DONE**

Engine stays NASA-blind:

```
NASA/JPL adapter  →  normalized EphemerisState  →  Physics Engine
```

### 12.1 Adapter contract

`src/physics/ephemeris/`

| File | Role |
|---|---|
| `types.ts` | `EphemerisState` {epoch, frame, r, v} in AU / AU year⁻¹ |
| `catalog.ts` | DE440 GM/GM☉ masses, Horizons IDs, physical radii. Engine never sees the IDs |
| `horizonsParse.ts` | `$$SOE`/`$$EOE` VECTOR parser. AU-D → AU/year via ×365.25. First sample only |
| `horizonsRequest.ts` | Browser ↔ `/api/horizons` contract. Catalog keys + epoch. **No URL field** |
| `horizonsClient.ts` | Browser POST `/api/horizons`. NASA URL is not present |
| `horizonsApi.server.ts` | Server-only whitelist, timeout, 429/503 retry, NASA fetch |
| `src/routes/api/horizons.ts` | TanStack Start POST handler. Rejects open URL proxy |
| `horizonsCache.ts` | Baked DE441 geometric states at **2026-09-11 00:00 TDB** |
| `keplerian.ts` | JPL “Approximate Positions” Table 1/2. **PHYSICAL APPROXIMATION** |
| `normalize.ts` | Identity + state → `BodySpec`. No HTTP |
| `loadSolarSystem.ts` | Epoch in → `LoadedSolarSystem` out. Cache / live / Keplerian |

Query parameters (live Horizons):

- `EPHEM_TYPE=VECTORS`, `CENTER=500@0` (SSB)
- `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`, `VEC_CORR=NONE`
- `OUT_UNITS=AU-D`, `VEC_TABLE=2`
- Calendar dates treated as **TDB**
- `STOP = START + 60 s` (equal START/STOP is unsafe)

### 12.2 Sources

| Source | What it is | Sun at origin? | Moon | Spacecraft |
|---|---|---|---|---|
| `horizons-cache` | Real DE441 geometric state at 2026-09-11 | **No** (Sun ~0.005 AU from SSB) | Yes | Yes, if requested |
| `horizons-live` | Same adapter, any epoch NASA will serve | **No** | Yes | Yes, if requested |
| `keplerian` | Two-body heliocentric, then shifted to SSB | **No** (barycentric shift) | **No** (Earth row is EMB) | **No** |

Keplerian Table 1: 1800–2050. Table 2 + extra terms: 3000 BC–3000 AD.
Warnings are labeled **PHYSICAL APPROXIMATION**.

### 12.3 Spacecraft

Voyager 1/2, Juno, Parker, New Horizons, JWST:

- mass 0, `gravityMode: test-particle`, `noCollide: true`
- physical radius ~10 m in AU — **not** inflated
- Default view 35 AU (planets) / 45 AU (with probes). Voyagers sit ~170 AU; zoom out

### 12.4 Units conversion

Horizons `AU-D` velocity × `DAYS_PER_YEAR` (365.25) = engine `AU/year`.
Do not use 365.256363 or a sidereal year here — Horizons AU-D is Julian.

### 12.5 UI

Control panel **NASA / JPL**: epoch date, chips (DE441 cache, J2000, Apollo 11,
Voyager 2 Neptune, New Horizons Pluto, Parker perihelion), spacecraft toggle,
Horizons vs Keplerian. HUD clock shows `SIM DATE … TDB` and the source tag.

Loading a game preset clears ephemeris meta. Loading NASA resets G to ×1.

### 12.6 What Phase 2 is **not**

- Not SPICE kernel ingestion
- Not light-time / stellar aberration (`VEC_CORR=NONE`, geometric)
- Not a 3D camera. Canvas is still an xy projection of 3D state

---

## 13. Phase 3 — Roche, encounters, major satellites  **DONE**

Still NASA-blind at the engine boundary.

### 13.1 Roche / TDE — `src/physics/orbital/roche.ts`

Mass form, valid for black holes (never use BH density):

```
d = k R_sat (M_primary / M_sat)^{1/3}
k_rigid = 2^{1/3} ≈ 1.26
k_fluid = 2.44     classical incompressible Roche
```

Earth–Moon fluid Roche ≈ 18 400 km; the Moon orbits outside it.
TDE: BH primary, satellite inside fluid Roche and outside R_s.
**Detect and report. Do not fragment** — that would be a fake hydro model.

### 13.2 Close approach — `src/physics/orbital/encounters.ts`

SCIENCE diagnostics: nearest pair (or selected vs nearest), r, v_rel,
linear t_CA, Roche flag.

`t_CA = −(r·v)/(v·v)` is a **PHYSICAL APPROXIMATION** (constant velocity).
It is a short-horizon warning, not an ephemeris.

### 13.3 Adaptive substepping

`Engine.adaptiveDt` (off for game presets, on after a NASA load).
When encounter / free-fall / orbital timescales are shorter than `dt`,
split one UI step into up to 16 **fixed** KDK substeps.

This is **adaptive substepping**, not a time-transformed symplectic
integrator. Tracer ↔ tracer pairs are not scanned.

---

## 14. V2 Hardening

### 14.1 Massive-body semantics

`src/physics/body/semantics.ts`

`isMassiveBody` / `isTestParticle` / `isGravitySource` are the only
allowed classifiers. Used by:

- N-body gravity sources
- barycentre
- conservation totals
- primary / dominant gravity source
- Roche / encounter scans

A 100 M☉ test particle cannot become the Sun, the barycentre, or the
heliocentric origin.

Primary APIs (`src/physics/frames/referenceFrames.ts`):

- `getHeaviestMassiveBody()`
- `getPrimaryStar()`
- `getDominantGravitySource()`
- `getReferencePrimary()`

`Engine.heaviest()` is a deprecated alias of `getHeaviestMassiveBody()`.

Reference frames are **analysis / display transforms**. Switching the UI
frame never mutates engine inertial state.

### 14.2 Time / Epoch

`src/physics/time/epoch.ts`

```
interface Epoch { jd: number; scale: 'UTC' | 'TDB' | 'TT' }
```

The DE441 cache epoch is `{ jdTdb: 2461294.5, calendar: '2026-09-11 00:00:00', scale: 'TDB' }`.
It is **not** `2026-09-11T00:00:00Z`.

TDB−UTC ≈ leap seconds + 32.184 s. The ~1.6 ms TDB−TT periodic term is
neglected (**NUMERICAL APPROXIMATION**).

### 14.3 Ephemeris modes

| Mode | Path | Failure |
|---|---|---|
| `horizons` | cache or live via `/api/horizons` | **error**, no Keplerian fallback |
| `auto` | cache → live → Keplerian | allowed; UI shows `SOURCE: KEPLERIAN FALLBACK` |
| `keplerian` | JPL approx elements | UI shows `PHYSICAL APPROXIMATION` |

Browser never talks to NASA. Client may only send catalog keys + epoch.

### 14.4 Constants

| Set | When | μ☉ |
|---|---|---|
| `gaussian` | GAME presets | 4π² |
| `de440` | Horizons / DE441 loads | `GM_SUN_AU3_YR2` from DE440 GM_sun |

Relative difference ~3.8×10⁻⁵. Old presets stay Gaussian so they do not
explode.

### 14.5 3D orbit overlay

`sampleOsculatingOrbit(elements) → stateFromElements(ν) → xyProjection`

SCIENCE orbit rings are the 2D projection of a 3D osculating Keplerian
path. They are **not** a refit of the xy velocity.

### 14.6 Performance

Adaptive substeps, Roche/TDE, and global closest-encounter skip
tracer↔tracer. Global encounters use a 3D spatial hash for large N.
Selected encounters are O(N).

`npm run bench` reports force / encounter / step ms at N = 100 / 1k / 10k.

### 14.7 Tests A–I

`src/physics/hardening.test.ts`

- A barycentre ignores 100 M☉ test particle
- B primary ignores 100 M☉ test particle
- C `source=horizons` rejects on fetch failure; URL proxy forbidden
- D `source=auto` Keplerian fallback with warning
- E cache epoch is TDB, not Z-UTC
- F inclined osculating samples leave the xy plane
- G tracers out of conservation / COM / gravity tree
- H Earth radius ~6371 km
- I DE441 +1/7/30 d Earth/Moon/Jupiter drift vs baked Horizons fixtures

### 14.8 Phase 4 is **not** this round

No spacecraft engines, fuel, thrust, Lambert, Hohmann, GR, hydro Roche,
SPICE kernels, or Three.js camera.


### 13.4 Major satellites

Horizons IDs 501–504, 606, 801, 901. DE440 masses. Real distances
(Io–Jupiter ≈ 0.0028 AU). Not the GAMEPLAY-inflated Galilean preset.
Toggle **主要卫星**. Cache baked at 2026-09-11 00:00 TDB.

Follow Jupiter and zoom — at 45 AU they sit inside the GAME visual disk.

---

## Existing architecture audit (pre-V2)

- Single `radius` drove display **and** collision **and** was treated as size
- State was 2D (`x,y,vx,vy,ax,ay`); `z = 0` was not enough
- Barnes-Hut was a quadtree
- Sun was free in presets (good) but UI assumed origin = Sun
- Belt particles were low-mass N-body, not test particles
- Orbital elements were planar `{a,e,rp,ra,retrograde}`
- Leapfrog lived inside a 700-line Engine class
- Diagnostics were “it looks like an orbit”
- Lagrange L1/L2 used Hill-radius approximations

Phase 1 exists to make position, velocity, collision, scale and conserved
quantities **worth believing**.
Phase 2 exists to feed those quantities from NASA, not from a hand-tuned preset.
Phase 3 exists to say when two of those bodies are about to eat each other.
