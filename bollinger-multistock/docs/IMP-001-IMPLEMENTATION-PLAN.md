# IMP-001 — Detailed Implementation Plan: Stateful Scanner Candles

> Companion to the IMP-001 summary in [IMPROVEMENTS-BACKLOG.md](IMPROVEMENTS-BACKLOG.md). This is the engineering-level plan.
> **Status: PLANNING — no code written. Nothing ships until validated in shadow mode and approved.**

---

## 1. Objective & success criteria

**Goal:** stop re-downloading 10 days of 5-min history for all ~108 stocks every scan. Seed candle history **once** (cold start), then **append one fresh 5-min candle per stock each cycle from the batched quote the scanner already fetches**.

**Success criteria:**

- Historical API calls drop from **~6,480/day → ~108/day** (seed only; ~0 if persisted across restarts).
- Scanner scoring is **unchanged within tolerance** — specifically the **top-3 selection matches the current path on ≥95% of scans** in shadow mode, with **no flips** of the Supertrend risk-distance guard or the 1h-ST filter beyond a defined tolerance.
- No duplicate candles, no day-boundary corruption, clean restart behavior.
- Fully reversible via a config flag.

**Non-goals:** WebSocket/KiteTicker (deliberately removed earlier — stays out). Changing the scoring formula. Touching the per-slot strategy's own candle path.

---

## 2. Current architecture (precise)

| Element                            | Location                                                                                                                                       | Notes                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candle type (scanner)              | [MarketScanner.ts L96](src/services/MarketScanner.ts#L96)                                                                                      | `{ date: Date, open, high, low, close, volume }` — note field is **`date`**, not `timestamp`                                                                                                     |
| Candle store                       | [L106](src/services/MarketScanner.ts#L106)                                                                                                     | `private cachedHistoricalData: Map<string, Candle[]>` — fully replaced each scan                                                                                                                 |
| `isDataCached`                     | [L107](src/services/MarketScanner.ts#L107)                                                                                                     | boolean guard                                                                                                                                                                                    |
| `cacheHistoricalData()`            | [L194](src/services/MarketScanner.ts#L194)                                                                                                     | 10-day, 5-min pull for whole universe; batch 2 + 1s pacing ≈ 54s; called at **startup** (StrategyManager ~L1270) **and every scan** ([StrategyManager L1572](src/core/StrategyManager.ts#L1572)) |
| `scanUniverse()` → `scoreStocks()` | [L140](src/services/MarketScanner.ts#L140) / L~508                                                                                             | reads `cachedHistoricalData.get(symbol)`; guard `candles.length < 50 → skip` ([L555](src/services/MarketScanner.ts#L555))                                                                        |
| **Batched quote block**            | [L516–548](src/services/MarketScanner.ts#L516)                                                                                                 | already fetches `getQuote(batch)` in groups of **40** for all stocks each scan; today extracts only `upper_circuit_limit`, `lower_circuit_limit`, `ohlc.close`                                   |
| 1h Supertrend                      | `derive60MinCandles` [L1656](src/services/MarketScanner.ts#L1656) + guard `candles60m.length >= 20` [L721](src/services/MarketScanner.ts#L721) | needs ≈3.2 trading days; **depends on accurate 5-min high/low**                                                                                                                                  |
| VWAP                               | [L1975](src/services/MarketScanner.ts#L1975)                                                                                                   | cumulative over the whole array (mis-anchored — fix here)                                                                                                                                        |
| `runHourlyScan` Step 1             | [StrategyManager L1570–1578](src/core/StrategyManager.ts#L1570)                                                                                | the mandatory re-fetch + 3s cooldown to replace                                                                                                                                                  |
| Redundant pass-through             | [StrategyManager L2008](src/core/StrategyManager.ts#L2008)                                                                                     | `scannerData.historicalData` — strategy ignores it (re-fetches its own 7 days)                                                                                                                   |

**Reference logic to reuse (from `BollingerBandStrategy`):**

- `floorTo5Min(date)` — floor epoch ms to the 5-min boundary (the fix that killed the duplicate-candle bug).
- dedup/append branch — _same ts + identical OHLC_ → ignore; _same ts, new OHLC_ → update in place; _newer ts_ → push; trim to window.

**Kite `getQuote(keys)` response per instrument** (what we'll use): `last_price`, `volume` (day-cumulative), `ohlc: {open, high, low, close}` (the **day's** OHLC, not the 5-min bar's), `last_trade_time`, `timestamp`. `getLTP(keys)` returns only `last_price` (cheaper, up to ~500 keys/call).

---

## 3. Target architecture

```
                         ┌─────────────────────────────────────────────┐
  COLD START / STALE ──▶ │ Phase 1: seed cachedHistoricalData          │
                         │ (5-day historical pull, the ONLY historical)│
                         └──────────────────┬──────────────────────────┘
                                            │ persisted to disk (Phase 0)
                                            ▼
  every ~30–60s ──▶ Phase 3: quote-poll loop maintains a "forming candle"
                    per stock (running high/low from last_price, vol delta)
                                            │  flush at each 5-min boundary
                                            ▼
  every 5 min ──▶ Phase 2: scan reads cachedHistoricalData (now self-maintained)
                  → scoreStocks() unchanged; NO historical re-fetch
                                            │
                    Phase 4: if a stock's newest candle is stale → targeted reseed
```

The store becomes **self-maintaining**: seeded once, kept current by the quote loop, persisted across restarts.

---

## 4. Data-model & config changes

**4a. Persisted candle store (Phase 0).**

- File: `data/cache/scanner-candles.json` (under the gitignored `/data/`).
- Shape: `{ savedAt: ISO, windowDays: 5, candles: { [symbol]: Candle[] } }` (trimmed window only).
- Write: debounced (e.g. once per 5-min boundary after append, not per tick).
- Load on boot; treat as **fresh** if `savedAt` is same trading session region and newest candle gap ≤ ~2 bars; else ignore and reseed.

**4b. New scanner state.**

```ts
private formingCandle: Map<string, { date: Date; open: number; high: number; low: number; close: number; startVol: number }> = new Map();
private lastDayVolume: Map<string, number> = new Map();   // for 5-min volume = dayVol_now − dayVol_at_bar_open
private quotePollTimer: NodeJS.Timeout | null = null;
```

**4c. Config flag** (in `global.experimental`, loaded by StrategyManager):

```
"enableIncrementalScannerCandles": false   // default OFF; gates Phase 2 swap + Phase 3 loop
```

Gate lives in **StrategyManager** (respects the pure-service boundary): when ON, `runHourlyScan` skips `cacheHistoricalData()` and the scanner's quote loop keeps the store current; when OFF, current behavior is untouched.

---

## 5. Phased implementation

### Phase 0 — Persistence layer (no behavior change yet)

1. Add `saveCandleStore()` / `loadCandleStore()` to `MarketScanner` (fs read/write `data/cache/scanner-candles.json`, mirroring the strategy's `saveCapitalData` pattern; wrap in try/catch, never throw).
2. On construction/first seed, attempt `loadCandleStore()`; log freshness decision.
3. Unit-safe: pure I/O, no scoring impact. Ship dark (not wired into scan yet).

### Phase 1 — Seed once with 5-day window

1. Add `private readonly SEED_LOOKBACK_DAYS = 5;` and use it in `cacheHistoricalData` (replaces the two `getDate() - 10`).
2. Make `cacheHistoricalData` **idempotent / seed-aware**: if a fresh persisted store loaded, skip the network seed.
3. Update the log/comment strings ("10 days" → "5 days").
4. **This phase alone is shippable** and safe (per the lookback analysis, scores are byte-identical except VWAP). Optional intermediate release.

### Phase 2 — Replace the per-scan re-fetch with the self-maintained store

1. In `runHourlyScan` ([StrategyManager L1570](src/core/StrategyManager.ts#L1570)), gate Step 1:
   - flag OFF → current `cacheHistoricalData()` (+3s cooldown).
   - flag ON → **skip it**; assert the store is warm (else trigger Phase 4 reseed). Remove the now-pointless 3s cooldown on the ON path.
2. Extend the `scoreStocks` quote block ([L527](src/services/MarketScanner.ts#L527)) to also read `last_price` and `volume` from each quote (it already loops them).
3. Add `appendBoundaryCandleFromQuote(symbol, quote, boundaryDate)`: build the just-closed 5-min candle and append via the reused `floorTo5Min` + dedup, then trim to ~375 candles. (In Tier A this is the only candle source; in Tier B the quote loop already maintained high/low and this just flushes.)

### Phase 3 — Accurate high/low (Tier B, recommended)

1. `startQuotePolling(intervalMs = 45000)` on the scanner; StrategyManager starts/stops it with market hours.
2. Each poll: `getLTP(allKeys)` (1 call, ≤500 keys — cheapest) for running high/low; update `formingCandle[symbol]` (`high = max`, `low = min`, `close = last_price`).
3. At each 5-min boundary: take one `getQuote(batch)` (for `volume`), compute `vol_5min = dayVol_now − startVol`, finalize the forming candle, append to the store (dedup/trim), reset `formingCandle` with the new bar's open = current `last_price`, `startVol = dayVol_now`.
4. Day handling: at session open, reset `formingCandle`/`lastDayVolume`; never stitch across the overnight gap (mirror `derive60MinCandles` day-boundary rule).

- **Cost:** ~`getLTP` 1 call/45s ≈ ~500/day + `getQuote` ~3 calls/5-min ≈ ~225/day ≈ **~725 quote-family calls/day** vs **6,480 historical** today.
- **Tier A fallback** (if we defer Tier B): skip the poll loop; build the candle from the boundary quote snapshot only → exact close/volume, approximate high/low. **Only acceptable if shadow mode shows the Supertrend guards don't move.**

### Phase 4 — Reseed / repair

1. `ensureFresh(symbol)`: if newest candle older than ~`2 × 5min` during market hours → targeted historical reseed for that one symbol.
2. Call at the top of each scan for any stale symbol, and on restart for the whole universe if the persisted store is stale.
3. Bound reseed concurrency (reuse the existing batch-2 pacing) so a mass-reseed can't burst past rate limits.

### Phase 5 — Fold-in cleanups (cheap, related)

1. **Re-anchor VWAP** to intraday (daily reset / session-anchored) — independent of window size; makes "Close > VWAP" a real signal.
2. **Drop** the redundant `scannerData.historicalData` pass-through ([StrategyManager L2008](src/core/StrategyManager.ts#L2008)).

---

## 6. Correctness & edge cases (must all be covered)

| Case                                        | Handling                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Duplicate candle (the 2026-06-16 bug class) | Reuse `floorTo5Min` + identical-OHLC dedup; QC harness asserts no dup timestamps                                     |
| Day boundary (60-min derivation)            | Reset forming candle at session open; never merge across overnight gap                                               |
| 5-min volume                                | `dayVol_now − dayVol_at_bar_open`; snapshot day-volume at each boundary; handle first bar of day (open vol baseline) |
| Missed poll / API hiccup                    | Forming candle keeps last good high/low; boundary still flushes; `ensureFresh` reseeds if a whole bar is missing     |
| Restart mid-session                         | Load persisted store; if newest candle ≤ ~2 bars old → resume; else full reseed                                      |
| Restart after hours / weekend / holiday     | Persisted store stale → full reseed at first scan (the "once per day" path)                                          |
| Cold start (no store)                       | Phase 1 seed runs; scoring waits for ≥50 candles (existing guard)                                                    |
| Stock illiquid / no trades in a bar         | close = prev close, high=low=close, volume=0 (valid flat candle)                                                     |
| 1h-ST needs accurate high/low               | Tier B mandatory if Tier A shadow shows guard flips                                                                  |

---

## 7. Validation (gate to enabling in prod)

1. **Shadow mode (primary gate).** With the flag OFF in effect for behavior, additionally compute the quote-built store in parallel for one full session and **log a diff**: per-stock score delta, and the **top-3 `selected` set** vs the historical path each scan. Acceptance: top-3 identical ≥95% of scans; zero Supertrend risk-distance/1h-ST guard flips beyond tolerance (define e.g. ≤2% of stock-scans).
2. **New QC harness** `scripts/qc-scanner-candles.ts` mirroring: append/dedup/trim, day-boundary forming-candle reset, volume-delta math, and a restart-gap reseed case. (Pattern: `scripts/qc-candle-dedup.ts`.)
3. **Parity script** comparing 5-day-seed vs 10-day-seed scores for a sample of stocks (expect identical except VWAP).
4. `tsc --noEmit` clean; existing harnesses (`qc-fvg-replay`, `qc-candle-dedup`, `qc-bias-filter`) green.

---

## 8. Rollout sequence

1. **Phase 0 + Phase 1** behind no behavior change (persistence dark; 5-day seed). Ship, observe scores unchanged.
2. **Phase 3 in shadow** (quote loop builds a parallel store, logs the diff vs historical) — flag still OFF for behavior. Collect ≥1 week of sessions.
3. If acceptance met → flip `enableIncrementalScannerCandles` ON (Phase 2 swap) for one slot-day, monitor `Insufficient … candles` warnings and selection diffs.
4. Phase 5 cleanups after the core is stable.

---

## 9. Rollback

- Single config flip `enableIncrementalScannerCandles: false` → reverts to the current full re-fetch (which **stays in the codebase** as the fallback path). No rebuild needed.
- Persisted store is additive; deleting `data/cache/scanner-candles.json` forces a clean reseed.

---

## 10. Risks (ranked)

1. **High/low approximation drift** on ATR indicators (Supertrend risk-distance guard, 1h-ST filter, ADX). → Tier B + shadow validation; do **not** ship Tier A if guards move.
2. **Append/dedup bug reintroduction** (the exact class fixed 2026-06-16). → reuse `floorTo5Min`, QC harness, shadow diff.
3. **Volume mis-attribution** from day-cumulative deltas. → boundary snapshots, first-bar baseline, tests.
4. **Reseed storms** on restart. → batch-paced reseed, persisted store to avoid most reseeds.
5. **Quote rate limits** for the poll loop. → `getLTP` (1 call/poll) for high/low, `getQuote` only at boundaries; both well under limits.

---

## 11. Effort & sequencing estimate

- Phase 0 (persistence): small.
- Phase 1 (5-day seed): trivial.
- Phase 2 (gate + boundary append): small–medium.
- Phase 3 (Tier B quote loop + forming candles): **the bulk** — medium; the high/low + volume + day-boundary logic is where the care goes.
- Phase 4 (reseed): small–medium.
- Phase 5 (VWAP anchor, drop pass-through): small.
- Validation (shadow + QC): medium, mostly observation time.

Recommended first PR: **Phase 0 + Phase 1** (safe, shippable, halves the seed) with the parity script — then build Phase 3 in shadow before any behavior flip.
