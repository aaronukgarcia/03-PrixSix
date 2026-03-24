# Request for Uncle Gem: Fresh-Eyes RCA — Replay Mode Cars Not Rendering

## Who I Am and Why I Need Help

I'm Claude (Bill), the primary AI assistant on the Prix Six project. I've been debugging a "no car dots in replay mode" bug for the last 2 days and have pushed **18 consecutive commits** trying to fix it — none of which have resolved the issue. I've exhausted my ability to find the root cause and I need fresh eyes with zero assumptions.

**Please do not assume anything I've concluded is correct.** Several of my hypotheses have been proven wrong. Approach this from scratch.

---

## The Bug — What the User Sees

**Reproduction steps:**
1. Open https://prix6.win/pit-wall (requires login — aaron@garcia.ltd / PIN: 366663)
2. Click the REPLAY button (orange, top-left of transport controls)
3. Wait for the 62MB Chinese Grand Prix replay data to download
4. Replay auto-plays (or click play ▶)
5. **Expected:** 22 coloured car dots moving around the Shanghai circuit outline
6. **Actual:** Track outline renders perfectly. Race table below shows full driver data (positions, lap times, sector times). Progress bar advances. But **zero car dots** on the track map.

**Screenshots showing the bug (all in `docs/`):**
- `Screenshot 2026-03-20 165300.png` — First report. Track outline visible, zero dots.
- `Screenshot 2026-03-24 102203.png` — After several fix attempts. Same symptom.
- `Screenshot 2026-03-24 120915.png` — After more fix attempts. Still no dots.
- `puppeteer-replay-test.png` — Automated Puppeteer screenshot confirming the same.

---

## The Codebase — Key Files

### Architecture
This is a Next.js App Router application with a PixiJS v8 WebGL track map. The Pit Wall module renders live F1 telemetry and historical replays.

### code.json
The project maintains a GUID registry in `code.json` (root). Every function, component, and code block has a `// GUID: XXX-NNN-vNN` comment. `code.json` maps these GUIDs to files, line numbers, and descriptions. Use it to quickly locate any piece of code by searching for its GUID.

### Data Flow (Replay Mode)
```
Firebase Storage (62MB JSON)
  → useReplayPlayer hook (downloads, parses, RAF playback loop)
    → replayPlayer.replayDrivers (React state, updates per frame ~2Hz)
      → PitWallClient.tsx activeDrivers useMemo (castReplayToLive)
        → PitWallTrackMap.tsx (React component, passes props)
          → PixiTrackApp.ts setData() (pushes data to PixiJS)
            → InterpolationSystem.ts onDriversUpdate() + interpolate()
              → CarLayer.ts update() (positions PixiJS sprites on canvas)
```

### Key Files
| File | Purpose |
|------|---------|
| `app/src/app/(app)/pit-wall/PitWallClient.tsx` | Master orchestrator — wires all hooks, computes activeDrivers, passes to track map |
| `app/src/app/(app)/pit-wall/_hooks/useReplayPlayer.ts` | Downloads replay JSON, runs RAF playback loop, emits replayDrivers[] per frame |
| `app/src/app/(app)/pit-wall/_components/PitWallTrackMap.tsx` | React shell — dynamic imports PixiTrackApp, bridges React props to PixiJS via setData() |
| `app/src/app/(app)/pit-wall/_pixi/PixiTrackApp.ts` | PixiJS Application — 60fps ticker, calls InterpolationSystem + CarLayer |
| `app/src/app/(app)/pit-wall/_pixi/systems/InterpolationSystem.ts` | Smooths car positions between polls. Has a **speed-based spike filter** that rejects "impossible travel" GPS jumps |
| `app/src/app/(app)/pit-wall/_pixi/layers/CarLayer.ts` | Renders car dot sprites at projected canvas coordinates |
| `app/src/app/(app)/pit-wall/_pixi/utils/pixi-helpers.ts` | `projectToCanvas()` — converts GPS metres to canvas pixels |
| `app/src/app/(app)/pit-wall/_types/pit-wall.types.ts` | DriverRaceState, TrackBounds, InterpolatedPosition types |
| `app/src/app/(app)/pit-wall/_types/showreel.types.ts` | HistoricalReplayData, ReplayFrame types |
| `app/src/data/circuits.json` | Static circuit outlines (extracted from same replay data) |

### Replay Data Source
The Chinese GP replay is stored in Firebase Storage:
```
https://storage.googleapis.com/studio-6033436327-281b1.firebasestorage.app/replay-data/11245.json
```
- Session key: 11245
- Circuit key: 17 (Shanghai)
- 9,252 frames, 22 drivers, 62MB raw JSON
- Frame format: `{ virtualTimeMs, wallTimeMs, positions: [{ driverNumber, x, y, position, speed, ... }] }`
- **Important:** 5 of 22 drivers (NOR #1, BOR #5, STR #18, ALB #23, PIA #81) have frozen GPS — stuck at grid position `(-8325, -7058)` with `speed:0` in every frame. The other 17 drivers have valid, changing GPS coordinates.

### Firestore Replay Session Doc
```json
{
  "sessionKey": 11245,
  "meetingName": "Chinese Grand Prix",
  "circuitKey": 17,
  "durationMs": 5993702,
  "totalFrames": 9252,
  "downloadUrl": "https://storage.googleapis.com/...",
  "firestoreStatus": undefined,  // NOT ingested to Firestore chunks
  "status": "available"
}
```
Note: `firestoreStatus` is undefined — this session uses the legacy Firebase Storage download path, NOT the Firestore chunk system.

---

## What I've Proven Via Automated Testing (Puppeteer + Node.js)

### Data Pipeline — VERIFIED CORRECT
I ran a Node.js simulation loading the actual replay data and running it through the exact InterpolationSystem logic:

```
Loaded: 9252 frames, 22 drivers
Frame at 75%: 22 positions, all with valid x/y
InterpolationSystem: 22 accepted, 0 rejected on first call
interpolate(): 22 results with correct coordinates
projectToCanvas(): all 22 within canvas bounds (600×280)
```

**The data, interpolation, and projection math are all correct when tested in isolation.**

### Browser State — VERIFIED VIA PUPPETEER
Puppeteer tests against the deployed production site confirm:

```
[PixiTrackApp] first drivers received: 22 gps: 22 bounds: yes vtdMs: 1
[PW-TICK] drv=22 gps=22 interp=22 bnd=-8325..5446 730x279 worldVis=true dotVis=true sample=dn1 x=-8325 y=-7058
```

Key findings:
1. PixiTrackApp **DOES receive** 22 drivers with GPS coordinates
2. InterpolationSystem **DOES produce** 22 interpolated positions
3. Bounds are valid (`-8325..5446`)
4. `worldContainer.visible = true`, `carLayer.dotContainer.visible = true`
5. Canvas is correct size (730×279)
6. **BUT: the sample position NEVER changes.** `dn1 x=-8325 y=-7058` is identical across every tick for 60+ seconds of playback.
7. **Zero `[REPLAY-TICK]` messages appear.** The replay player's RAF `tick()` function never fires.

### The Critical Finding
**The replay player's `requestAnimationFrame(tick)` callback never executes.** The data downloads successfully, `onDataReady` is called, `startRafFrom(0)` is called, `requestAnimationFrame(tick)` is scheduled — but `tick` never runs. This means either:
- The RAF handle is immediately cancelled by a useEffect cleanup
- The browser never fires the RAF callback (tab hidden / headless issue)
- Something else cancels the animation frame between scheduling and execution

I have NOT yet been able to determine WHY tick never fires. My next diagnostic commit (ready but not pushed) adds logging inside `startRafFrom`, `onDataReady`, and the effect cleanup to trace the exact sequence.

---

## All Commits Since v2.5.5 (18 commits, most wrong)

| # | Hash | Description | Was it correct? |
|---|------|-------------|-----------------|
| 1 | `cf6c815` | Admin Pit Wall dashboard + deep code review fixes (worker timeout, atomic ingest, null guards, session reset, retired trail cleanup, AbortController, visibility race, Cache-Control) | ✅ Valid improvements, unrelated to the bug |
| 2 | `c3ff923` | Zoom 1 camera → 1.8x centred zoom | ✅ Correct UX fix |
| 3 | `12b61c4` | Zoom 2 chase camera rework (5x zoom, faster lerp, all labels) | ✅ Correct UX fix |
| 4 | `6c5affb` | Zoom 2 focus driver fallback to first driver | ✅ Defensive, correct |
| 5 | `81a3535` | **Move car dots out of bloom container** | ❌ Wrong diagnosis — bloom wasn't the issue |
| 6 | `68bc95c` | **Merge bounds from circuit + drivers** | ❌ Wrong diagnosis — coordinates are identical |
| 7 | `4ccd8fc` | Diagnostic logging + circuit path reset on replay | ❌ Diagnostic only, partially reverted |
| 8 | `bfeb693` | **Fix useRef mutated inside useMemo** | ❓ Possibly correct for dev mode, but React 18 Strict Mode double-render doesn't happen in production builds. The production site has `reactStrictMode` NOT enabled. |
| 9 | `1f37ddf` | Bloom glow toggle in toolbar | ✅ Feature, unrelated |
| 10 | `01f596f` | Version guard hook | ✅ Process improvement, unrelated |
| 11 | `0221ce9` | Diagnostic console logging in PixiTrackApp | Diagnostic only |
| 12 | `0874dd2` | One-shot console.warn on first drivers received | Diagnostic only |
| 13 | `2770667` | **Fix async import race — pixiReady state** | ❓ Correct fix for a real race condition, but didn't solve the no-cars bug |
| 14 | `57704a9` | Tick-level logging (object format — didn't serialize in Puppeteer) | Diagnostic only |
| 15 | `34cf40a` | Fix tick log to use string format | Diagnostic only |
| 16 | `ecbe019` | **Reset InterpolationSystem on first driver arrival** | ❓ Addresses spike filter poisoning, but the real issue is upstream — tick never fires |
| 17 | `ea8d97b` | Add replay player tick logging | Diagnostic only |
| 18 | `72b5646` | Move replay tick log before early return | Diagnostic only |

---

## Hypotheses I've Investigated and Their Status

### ❌ Bloom filter eating car dots (commit 5)
**Theory:** AdvancedBloomFilter produces blank output on some GPUs, hiding everything inside bloomContainer.
**Disproven by:** Puppeteer confirms `worldVis=true dotVis=true` and 22 interpolated positions. Dots ARE being positioned, just at frozen coordinates.

### ❌ Coordinate mismatch between static circuit and replay GPS (commits 6-7)
**Theory:** Static circuits.json uses different projected-metre coordinates than the replay data.
**Disproven by:** Both sources verified to use identical coordinates. First point of static circuit: `{x: -8325, y: -7058}`. First replay position: `{x: -8325, y: -7058}`. Same extraction script, same Firestore source.

### ❌ useRef mutated inside useMemo — React double-render (commit 8)
**Theory:** React 18 Strict Mode double-invokes useMemo, mutating prevReplayElapsedMsRef twice, producing virtualTimeDeltaMs=undefined.
**Status:** This IS a real anti-pattern and was fixed. BUT React Strict Mode double-render only happens in development. The production build (Firebase App Hosting) does NOT enable reactStrictMode. `next.config.ts` has no `reactStrictMode: true`. So this fix is correct but doesn't explain the production failure.

### ❌ Async import race condition (commit 13)
**Theory:** Dynamic import of PixiTrackApp is async. setData() calls during the import window are lost because pixiAppRef.current is null.
**Status:** Fix is correct (added pixiReady counter). But Puppeteer proves PixiTrackApp DOES receive the drivers — `first drivers received: 22 gps: 22`. The data arrives. The issue is downstream.

### ❌ Spike filter rejecting positions due to tiny virtualTimeDeltaMs (commit 16)
**Theory:** First virtualTimeDeltaMs is ~1ms, causing maxDist=20m, rejecting all car movements.
**Status:** Node.js simulation confirms this IS a problem for the second onDriversUpdate call. But the bigger issue is that `onDriversUpdate` is only called ONCE — because `this.drivers` never changes after the first setData call. The replay player's RAF tick never fires, so replayDrivers never updates, so activeDrivers never changes, so setData never receives new drivers.

### 🔍 CURRENT: Replay player RAF tick never fires (commits 17-18)
**Finding:** Zero `[REPLAY-TICK]` messages in Puppeteer output across 60+ seconds. The RAF callback scheduled by `startRafFrom(0)` via `requestAnimationFrame(tick)` never executes. `startRafFrom` IS called (data loads, table shows race data), but the RAF loop dies immediately.
**Possible causes:**
- The useEffect cleanup at line 730-733 (`cancelRaf()`) fires immediately after `startRafFrom` due to a dependency change re-running the effect
- Headless Puppeteer doesn't fire RAF callbacks (unlikely — the PixiJS ticker at 60fps works fine via `[PW-TICK]` logs)
- Something else cancels `rafHandleRef.current` between `requestAnimationFrame` and the browser's next paint

**I have diagnostic logging ready (not yet pushed) that will confirm whether `onDataReady` fires, whether `startRafFrom` executes, and whether the cleanup immediately cancels it.**

---

## What I Need From You

1. **Fresh-eyes RCA.** Do not assume any of my conclusions are correct. Read the actual code. Trace the actual data flow from `useReplayPlayer` through to `CarLayer.update()`.

2. **Focus on why the RAF tick never fires.** The data loads. `startRafFrom(0)` is called. `requestAnimationFrame(tick)` is scheduled. But `tick()` never executes. Why?

3. **Check for useEffect dependency cascade.** The load effect depends on `[session, getAuthToken, cancelRaf, startRafFrom, updatePlaybackState]`. If any of these change reference after `startRafFrom(0)` runs, the effect re-runs, the cleanup cancels the RAF, and the new effect restarts the load. Could `startRafFrom` or `tick` be unstable references?

4. **Check for React state update batching issues.** `onDataReady` calls `setDurationMs`, `setFramesLoaded`, `updatePlaybackState('ready')`, then `startRafFrom(0)` which calls `updatePlaybackState('playing')`. These are batched. Could the batched re-render trigger an effect that cancels the RAF?

5. **Check if the existing `cancelled` flag is being set.** The `onDataReady` function checks `if (cancelled) return;`. If the effect cleanup runs between `loadData()` starting and `onDataReady` firing, `cancelled` would be true and `startRafFrom` would never be called.

6. **Consider whether this bug existed before v2.5.5.** The user reports it worked at v2.5.3. What changed between v2.5.3 and v2.5.5 that could affect the replay player's RAF lifecycle?

7. **Write a definitive fix** — not a speculative one. If you find the root cause, explain the full causal chain and why it was invisible to my investigation.

---

## Environment
- Next.js 16.1.6 with Turbopack
- React 19 (via Next.js 16)
- PixiJS 8.17.1
- Firebase App Hosting (production builds, NOT dev mode)
- `reactStrictMode` NOT enabled in next.config.ts
- Puppeteer 24.36.1 for automated testing
- Windows 11, Node.js 25.3.0

---

## Files to Start With
1. `app/src/app/(app)/pit-wall/_hooks/useReplayPlayer.ts` — The replay player hook. Focus on the RAF lifecycle: `tick`, `startRafFrom`, and the session-change useEffect (line 636).
2. `app/src/app/(app)/pit-wall/PitWallClient.tsx` — The orchestrator. Focus on `activeDrivers` useMemo and `virtualTimeDeltaMs` computation.
3. `app/src/app/(app)/pit-wall/_components/PitWallTrackMap.tsx` — The React→PixiJS bridge. Focus on the two useEffects (dynamic import + data push).
4. `app/src/app/(app)/pit-wall/_pixi/PixiTrackApp.ts` — The PixiJS app. Focus on `setData()` and `onTick()`.
5. `code.json` — GUID registry. Search for any GUID to find its file and purpose.
