# F8: 1-Hour Supertrend Alignment — Implementation Plan

## Summary

Add a **pre-entry filter** in the MarketScanner that derives 1-hour candles from existing 5-minute historical data, calculates the 1-hour Supertrend(10, 2), and **rejects any stock whose scanner bias conflicts with the 1-hour Supertrend direction**. This prevents misaligned stocks from ever being deployed to a slot — saving capital from guaranteed losers.

| Condition                                                        | Action                                      |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Bias = LONG, 1hr ST = DOWN (line above price = bearish ceiling)  | ❌ REJECT — buying into a macro downtrend   |
| Bias = LONG, 1hr ST = UP (line below price = bullish floor)      | ✅ PASS — buying with the macro uptrend     |
| Bias = SHORT, 1hr ST = UP (line below price = bullish floor)     | ❌ REJECT — shorting into a macro uptrend   |
| Bias = SHORT, 1hr ST = DOWN (line above price = bearish ceiling) | ✅ PASS — shorting with the macro downtrend |

> **Supertrend direction labels** (matches code and `calculateSupertrend()` output):
>
> - **"UP"** = support line active = line drawn **below** price = stock is in an **uptrend** (bullish)
> - **"DOWN"** = resistance line active = line drawn **above** price = stock is in a **downtrend** (bearish)
>
> Therefore: **LONG needs 1hr ST = "UP"**, **SHORT needs 1hr ST = "DOWN"**. This matches the `isAligned` check in the code.

## Backtested Impact

| Metric        | Before   | After   | Delta                                                    |
| ------------- | -------- | ------- | -------------------------------------------------------- |
| Total trades  | 84       | 75      | -9 removed (all losers)                                  |
| Total P&L     | ₹16,636  | ₹27,395 | **+₹10,759**                                             |
| Misaligned WR | 0% (0/9) | —       | All losers eliminated                                    |
| Capital freed | —        | —       | 9 fewer slot deployments that would have blocked capital |

### All 9 Misaligned Trades That Would Be Filtered

| Trade             | 5m ST | 1h ST | Direction | PnL     |
| ----------------- | ----- | ----- | --------- | ------- |
| TMPV Feb 5        | DOWN  | UP    | SHORT     | -₹160   |
| ABB Feb 5         | DOWN  | UP    | SHORT     | -₹550   |
| SBILIFE Feb 5     | DOWN  | UP    | SHORT     | -₹1,031 |
| TRENT Feb 11      | DOWN  | UP    | SHORT     | -₹435   |
| ASIANPAINT Feb 13 | DOWN  | UP    | SHORT     | -₹200   |
| UPL Feb 26        | UP    | DOWN  | LONG      | -₹4,810 |
| ULTRACEMCO Feb 26 | DOWN  | UP    | SHORT     | -₹883   |
| INDHOTEL Feb 27   | DOWN  | UP    | SHORT     | -₹500   |
| HEROMOTOCO Feb 27 | DOWN  | UP    | SHORT     | -₹2,190 |

**Key pattern**: 8 of 9 are SHORTs with 1hr ST UP — shorting pullbacks in an hourly uptrend.

---

## Architectural Decision: Tradeability Guard in `scoreStocks()`

### Why `scoreStocks()` and not `applySafetyFilters()`?

The scanner pipeline flows:  
`scanUniverse()` → `analyzeSectors()` → `filterBySector()` → **`scoreStocks()`** → `applySafetyFilters()` → `selectTopStocks()`

Two candidate insertion points exist:

| Location                        | Pros                                                                                                                                          | Cons                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **`scoreStocks()` as Guard #3** | Rejects BEFORE scoring computation; saves CPU; follows existing Guard #1/#2 pattern; rejected stock gets `valid=false` with `rejectionReason` | Requires bias to be known (bias is determined at line ~680)                               |
| `applySafetyFilters()`          | Runs after scoring; clean separation                                                                                                          | Wastes scoring CPU on a stock that will be rejected; applied AFTER bias-dependent scoring |

**Decision**: Place the check as **Guard #3** in `scoreStocks()`, but **after** the bias determination block (line ~715, after `if (!bias)` skip). This is the earliest point where both historical candles AND bias are available. It follows the identical pattern of Guard #1 (Risk Distance) and Guard #2 (Bandwidth).

### Why this satisfies the capital-blocking constraint

The guard runs inside `scoreStocks()` → the stock gets `valid=false` → it is excluded from `selectTopStocks()` → it never reaches `rebalanceStrategies()` → no slot is occupied → no capital is blocked.

---

## Data Feasibility

| Parameter                 | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| Cached data               | 10 days × ~75 candles/day = ~750 five-minute candles |
| Candles per day           | 75 (375 min ÷ 5 min)                                 |
| Hourly candles per day    | 6 full (60 min) + 1 partial (15 min) = **7 per day** |
| 60-min candles derived    | 10 days × 7 = ~70 one-hour candles                   |
| Supertrend(10, 2) minimum | 10 + ~10 warmup = ~20 candles                        |
| **Available vs Required** | **70 >> 20** ✅ Sufficient                           |

### Why 75 ÷ 12 ≠ clean chunking (critical math)

NSE is open 9:15 AM–3:30 PM = 375 minutes = **75 five-minute candles per day**.

75 ÷ 12 = **6.25** — there is a **3-candle remainder** every day (3:15–3:30 PM).

If you blind-slice a flat array by 12:

- Chunks 1–6 cover 09:15 to 15:15 (72 candles) ✅
- Chunk 7 takes the 3 remaining candles of Day 1 (15:15–15:30) **+ the first 9 candles of Day 2 (09:15–10:00)** ❌

This creates a **"Frankenstein candle"** spanning an overnight gap. If there's a gap-up/gap-down, this synthetic candle has a monstrously inflated High–Low range, which destroys the ATR calculation and corrupts the Supertrend.

**Note**: `derive15MinCandles()` does NOT have this problem because 75 ÷ 3 = **25.0 exactly** — no remainder, no cross-day stitching.

---

## Implementation Steps

### Step 1: Add `derive60MinCandles()` method to MarketScanner

**File:** `MarketScanner.ts` — insert after `derive15MinCandles()` (line ~1572)

```typescript
/**
 * Derive 60-min (1-hour) candles from 5-min candles.
 * MUST respect day boundaries to avoid "Frankenstein candles" that stitch
 * end-of-day remnants with next-day opening candles across overnight gaps.
 *
 * NSE math: 75 five-min candles/day ÷ 12 = 6.25 → 3-candle remainder each day.
 * Blind slicing would merge Day1 15:15–15:30 with Day2 09:15–10:00, corrupting ATR.
 *
 * Output per day: 6 full 60-min candles + 1 partial 15-min candle (matching TradingView).
 * Used for F8: 1-hour Supertrend alignment pre-entry filter.
 */
private derive60MinCandles(candles5m: Candle[]): Candle[] {
  const candles60m: Candle[] = [];
  let chunk: Candle[] = [];
  let currentDay = -1;

  for (let i = 0; i < candles5m.length; i++) {
    const candle = candles5m[i];
    if (!candle) continue;
    const candleDay = new Date(candle.date).getDate();

    // If day changes OR we hit 12 candles, close the current 1H candle
    if (chunk.length > 0 && (chunk.length === 12 || candleDay !== currentDay)) {
      candles60m.push({
        date: chunk[0]!.date,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map((c) => c.high)),
        low: Math.min(...chunk.map((c) => c.low)),
        close: chunk[chunk.length - 1]!.close,
        volume: chunk.reduce((sum, c) => sum + c.volume, 0),
      });
      chunk = []; // Reset for next candle
    }

    chunk.push(candle);
    currentDay = candleDay;
  }

  // Push the very last chunk of the array
  if (chunk.length > 0) {
    candles60m.push({
      date: chunk[0]!.date,
      open: chunk[0]!.open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1]!.close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return candles60m;
}
```

**Why day-boundary-aware chunking?** Unlike `derive15MinCandles()` (where 75 ÷ 3 = 25.0 exactly), 75 ÷ 12 = 6.25 — leaving a 3-candle remainder each day. Blind slicing would create a cross-day candle spanning the overnight gap, inflating ATR and corrupting Supertrend. The day-boundary flush prevents this.

**Output per day**: 6 full hourly candles (09:15–15:15) + 1 partial candle (15:15–15:30, 15 minutes). This matches TradingView's NSE 1-hour chart behavior.

**Day detection**: `getDate()` returns day-of-month (1–31). With a 10-day trading cache (~14 calendar days max), day numbers never collide across months.

---

### Step 2: Add Guard #3 (1-Hour ST Alignment) in `scoreStocks()`

**File:** `MarketScanner.ts` — insert in `scoreStocks()`, **after** the bias determination block (after the `if (!bias) { continue; }` check at line ~715)

Insert BEFORE the quote lookup and scoring logic (before `let upperCircuitLimit = 0;` at line ~726):

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// GUARD #3: 1-Hour Supertrend Alignment (F8 pre-entry filter)
// Reject stocks where scanner bias conflicts with 1-hour trend direction.
// Backtested: 9 misaligned trades, ALL losers, 0% WR, -₹10,759 total.
// ═══════════════════════════════════════════════════════════════════════════
const candles60m = this.derive60MinCandles(candles);
if (candles60m.length >= 20) {
  const supertrend1h = this.calculateSupertrend(candles60m, 10, 2);
  // Supertrend direction "UP" = support active (bullish), "DOWN" = resistance active (bearish)
  // LONG needs 1h UP (bullish), SHORT needs 1h DOWN (bearish)
  const isAligned =
    (bias === "LONG" && supertrend1h.direction === "UP") ||
    (bias === "SHORT" && supertrend1h.direction === "DOWN");

  if (!isAligned) {
    const rejectionMsg = `1h ST misaligned (Bias: ${bias}, 1h ST: ${supertrend1h.direction}, value: ${supertrend1h.value.toFixed(2)})`;
    this.logger.warn(`⚠️ ${stock.symbol}: Rejected - ${rejectionMsg}`);
    results.push({
      symbol: stock.symbol,
      score: 0,
      baseScore: 0,
      bias: bias,
      sector: stock.sector,
      sectorToken: stock.sectorToken,
      breakdown: { trend: 0, momentum: 0, volume: 0, sector: 0, smartMoney: 0 },
      tacticalBonus: {
        freshBreakout: 0,
        rvolSurge: 0,
        proximity: 0,
        rsiAccel: 0,
        squeeze: 0,
        gammaWall: 0,
        total: 0,
      },
      spotPrice,
      upperCircuitLimit: 0,
      lowerCircuitLimit: 0,
      todayChangePercent: 0,
      atmOption: null,
      historicalData: candles,
      valid: false,
      rejectionReason: rejectionMsg,
    });
    continue; // Skip to next stock
  }

  this.logger.debug(
    `✅ ${stock.symbol}: 1h ST aligned (Bias: ${bias}, 1h ST: ${supertrend1h.direction})`,
  );
} else {
  this.logger.warn(
    `⚠️ ${stock.symbol}: Insufficient 60m candles (${candles60m.length}) for 1h ST - allowing through`,
  );
}
```

**Why this location?** This is immediately after bias is determined and before any scoring computation. It follows the exact same pattern as Guard #1 (Risk Distance) and Guard #2 (Bandwidth) — push a `valid: false` result and `continue`.

**Failsafe**: If insufficient 60-min candles are available (< 20), the guard logs a warning and **allows the stock through** rather than blocking it. This ensures no false rejections during the first day of cache warmup or for stocks with limited history.

---

### Step 3: Verify `calculateSupertrend()` return structure

**File:** `MarketScanner.ts` (line ~1867)

The existing `calculateSupertrend()` method already returns `{ value, direction }` where:

- `direction: "UP"` = support band active (price above ST → bullish)
- `direction: "DOWN"` = resistance band active (price below ST → bearish)

**No changes needed.** The same method used for 5-min ST (Guard #1 risk check) works for 60-min candles.

---

### Step 4: Add dashboard visibility for rejections

**File:** `MarketScanner.ts` — in the scan summary log (around line ~170, after `scanUniverse()` returns)

The existing scan summary already logs `qualifiedCount` vs `scannedCount` and `failedStocks`. Stocks rejected by Guard #3 will naturally appear in the `allScored` array with `valid: false` and `rejectionReason: "1h ST misaligned ..."`.

**Verify**: StrategyManager already reads `allScored` and displays rejected stocks in the dashboard. The `rejectionReason` field is already rendered. No dashboard changes needed — the new rejection reason will appear automatically.

---

## Files Changed

| File                            | Change                            | Lines Affected               |
| ------------------------------- | --------------------------------- | ---------------------------- |
| `src/services/MarketScanner.ts` | Add `derive60MinCandles()` method | +40 lines (after line ~1572) |
| `src/services/MarketScanner.ts` | Add Guard #3 in `scoreStocks()`   | +35 lines (after line ~715)  |

**Total**: ~75 lines added to 1 file. No changes to `StrategyManager.ts` or `BollingerBandStrategy.ts`.

---

## What This Does NOT Change

- **BollingerBandStrategy.ts** — No changes. The filter is entirely at the scanner level.
- **StrategyManager.ts** — No changes. Rejected stocks never reach slot deployment.
- **5-min Supertrend** — Still calculated independently for Guard #1 (risk distance) and used in the strategy's trade management.
- **Bias determination** — Unchanged. Sector + breakout logic still sets bias first.
- **Scoring formula** — Unchanged. Stocks that pass Guard #3 are scored identically to today.

---

## Execution Flow (Before vs After)

### Before (current)

```
scanUniverse()
  └─ scoreStocks()
       ├─ Guard #1: Risk Distance (5m ST > 1.5%) → reject
       ├─ Guard #2: Bandwidth (BB > 3.5%) → reject
       ├─ Bias determination (sector / breakout)
       ├─ [no 1h check] ← misaligned stock proceeds
       ├─ Score calculation
       └─ Push to results
  └─ applySafetyFilters() → selectTopStocks() → deploy to slot
       └─ ❌ Misaligned stock occupies slot, blocks capital, loses money
```

### After (with F8)

```
scanUniverse()
  └─ scoreStocks()
       ├─ Guard #1: Risk Distance (5m ST > 1.5%) → reject
       ├─ Guard #2: Bandwidth (BB > 3.5%) → reject
       ├─ Bias determination (sector / breakout)
       ├─ Guard #3: 1h ST Alignment → reject if misaligned ← NEW
       ├─ Score calculation (only for aligned stocks)
       └─ Push to results
  └─ applySafetyFilters() → selectTopStocks() → deploy to slot
       └─ ✅ Only aligned stocks reach slots
```

---

## QC Checklist (for post-implementation verification)

| #   | Check                                                        | Expected                               |
| --- | ------------------------------------------------------------ | -------------------------------------- |
| 1   | `derive60MinCandles()` method exists                         | Yes                                    |
| 2   | Groups up to 12 five-min candles per 60-min candle           | 12:1 ratio (max)                       |
| 3   | Day boundaries flush partial chunks (no cross-day stitching) | 3-candle EOD partial → separate candle |
| 4   | EOD partial candle (15:15–15:30) preserved, not dropped      | Matches TradingView behavior           |
| 5   | Guard #3 appears AFTER bias determination                    | After `if (!bias)` check               |
| 6   | Guard #3 appears BEFORE scoring logic                        | Before `breakdown = { ... }`           |
| 7   | LONG + 1h ST DOWN → rejected                                 | `valid: false`, `rejectionReason` set  |
| 8   | LONG + 1h ST UP → passes                                     | Continues to scoring                   |
| 9   | SHORT + 1h ST UP → rejected                                  | `valid: false`, `rejectionReason` set  |
| 10  | SHORT + 1h ST DOWN → passes                                  | Continues to scoring                   |
| 11  | Insufficient candles (< 20) → graceful fallback              | Logs warning, allows through           |
| 12  | `rejectionReason` includes bias and 1h ST direction          | Human-readable                         |
| 13  | No changes to `BollingerBandStrategy.ts`                     | Zero edits                             |
| 14  | No changes to `StrategyManager.ts`                           | Zero edits                             |
| 15  | Supertrend params are (10, 2)                                | Matches 5m ST and strategy             |
| 16  | `calculateSupertrend()` reused (no new ST implementation)    | Same method                            |
| 17  | TypeScript compiles with zero errors                         | `npx tsc --noEmit` clean               |
| 18  | Rejected stocks appear in dashboard via existing `allScored` | `valid: false` with reason             |

---

## Risk Assessment

| Risk                                   | Likelihood | Mitigation                                                                                    |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Over-filtering (too many rejections)   | Low        | Only 9/84 (11%) were misaligned historically; 0% WR confirms these are genuine losers         |
| Insufficient historical data for 1h ST | Very Low   | 10 days × 75 = 750 candles → ~70 hourly candles >> 20 needed. Failsafe allows through if < 20 |
| Cross-day candle corruption            | None       | Day-boundary-aware chunking prevents overnight gap stitching                                  |
| EOD partial candle distortion          | Negligible | 15-min partial has smaller ATR range — same behavior as TradingView; absorbed by averaging    |
| Supertrend calculation mismatch        | None       | Reuses exact same `calculateSupertrend()` method and params (10, 2)                           |
| Bias determination timing              | None       | Guard #3 is placed after bias is finalized                                                    |
| Dashboard breakage                     | None       | Leverages existing `valid: false` + `rejectionReason` rendering                               |
