# Improvements Backlog

Tracked list of proposed, non-urgent improvements. Each entry is **analysis only** — nothing here is implemented until explicitly approved and QC'd. Add new items at the top of the relevant priority section.

Status legend: `PROPOSED` · `PLANNED` · `IN-PROGRESS` · `DONE` · `REJECTED`

---

## Performance / Cost

### IMP-001 — Incremental scanner candle fetch (stop re-pulling 10 days every 5 min)
- **Status:** PROPOSED (2026-06-17)
- **Area:** `src/services/MarketScanner.ts` (`cacheHistoricalData`), `src/core/StrategyManager.ts` (`runHourlyScan`, "fresh data is mandatory" re-fetch)

**Problem.** Every 5-minute scan (60×/day, 09:23–14:58) the scanner re-downloads the **full 10-day, 5-minute history for all ~108 universe stocks** and does a full `cachedHistoricalData.set(symbol, candles)` replace. Old 5-min bars are immutable; the only thing that changes between scans is **one newly-completed candle per stock**. So ~9 days 23 hours of identical data is re-fetched each cycle.

**Cost today.**
- ~108 historical calls/scan × 60 scans ≈ **~6,480 redundant historical API calls/day** (plus retries + quote calls).
- ~**50–60 s per cycle** spent in rate-limited batched fetching (batch size 2, 1 s between batches, to respect Zerodha's 3 req/s cap) + a 3 s cooldown — roughly a full minute of every 5-minute window burned on data the bot already has.

**Why it's built this way.** The scanner is intentionally **stateless** (recompute-from-scratch) to sidestep incremental-append bugs: gaps after restarts, duplicate candles, and 60-min day-boundary stitching. Note: the per-slot strategy *does* append incrementally, and that is exactly where the **duplicate-candle bug** lived (the `:00` vs `:07` Kite timestamp mismatch fixed 2026-06-16 via `floorTo5Min`). The scanner avoids that whole class of bug by never appending — at the cost of heavy redundant I/O.

**Genuine lookback need (so we can't just fetch 1 candle blindly).** `scoreStocks()` rebuilds EMA-8/21/50, RSI-14 (5-min + derived 15-min), ADX-14, VWAP, RVOL-20, Bollinger, and the **1-hour Supertrend(10,2)** (derived 60-min candles with day-boundary handling, ~10 hourly bars ≈ 2 trading days). Hard guard: `candles.length < 50 → skip`. So a long history is required **once**; thereafter a single appended bar keeps it current.

**Proposed approach (to be planned/QC'd before any code change).**
1. **Seed once** at first scan (full 10-day pull), then each cycle fetch only the **latest 5-min bar per stock** and append+dedup into `cachedHistoricalData`, reusing the proven `floorTo5Min` + dedup/normalization logic from `BollingerBandStrategy`.
2. Trim each cached array to a rolling window (e.g. last ~250 candles ≈ 3 days — enough for EMA-50 + 1h ST).
3. Reseed fallback: if a stock's cache is **empty or stale** (gap > N candles, e.g. after a restart or skipped scan), do a full reseed for that stock only.
4. Optional further win: spot/last-close/change%/circuit already come from batched `getQuote()`; only indicator history needs candles, and that needs just the one new bar — so the per-cycle fetch could collapse toward a handful of calls.

**Expected benefit.** Same scoring accuracy; per-cycle data step drops from ~60 s + thousands of redundant candles to a near-instant incremental update; frees most of the 5-minute window and slashes API usage.

**Risks / must-haves.** Reintroduces incremental-append edge cases (restart gaps, timestamp offset, day-boundary 60-min derivation). Requires: the same dedup + `floorTo5Min` guards, a robust "empty/stale → full reseed" fallback, and QC harness coverage mirroring the new append path. Without these, indicator drift or duplicate bars could silently corrupt scores.

---

## Template for new entries

```
### IMP-NNN — Short title
- Status: PROPOSED (YYYY-MM-DD)
- Area: files / components

Problem. ...
Cost / impact today. ...
Proposed approach. ...
Expected benefit. ...
Risks / must-haves. ...
```
