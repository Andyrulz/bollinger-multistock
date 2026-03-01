# F7: RSI Quick Reversal Confirmation — Implementation Plan

## Summary

After entry, monitor the **stock RSI(10)** on each 5-minute candle close for up to **2 candles (10 minutes)**. If RSI crosses the reversal threshold within that window, exit immediately with reason `RSI_CONFIRMATION_FAILED`. If the window expires without a breach, the trade is confirmed and proceeds under normal exit mechanisms.

| Parameter       | LONG                      | SHORT                     |
| --------------- | ------------------------- | ------------------------- |
| **Threshold**   | RSI < 62                  | RSI > 32                  |
| **Window**      | 2 candles (10 min)        | 2 candles (10 min)        |
| **Exit reason** | `RSI_CONFIRMATION_FAILED` | `RSI_CONFIRMATION_FAILED` |

## Backtested Impact

| Metric              | Before              | After            | Delta                   |
| ------------------- | ------------------- | ---------------- | ----------------------- |
| Total P&L           | ₹15,871             | ₹54,481          | **+₹38,610**            |
| Total trades        | 84                  | 46               | -38 killed (all losers) |
| Avg P&L/trade       | ₹189                | **₹1,184**       | +₹995                   |
| Winning trades kept | All winners survive | 0 winners killed | Clean                   |

---

## Architectural Decision: Model After `breakoutValidation`

The existing `breakoutValidation` system is a near-perfect template:

- It tracks candles since entry (`candlesSinceBreakout++`)
- It runs as a post-entry gate inside the master candle cycle
- It calls `executeExit()` on failure
- It persists state via `saveCapitalData()` (restart-safe)
- It short-circuits once validated

The RSI confirmation will follow the same pattern but with different check logic (RSI threshold instead of candle high/low).

---

## Implementation Steps

### Step 1: Add `rsiConfirmation` to the `Position` interface

**File:** `BollingerBandStrategy.ts` (lines 55–88)

Add a new optional property to the Position interface alongside the existing `breakoutValidation`:

```typescript
// RSI Quick Reversal Confirmation (F7 filter)
// After entry, checks stock RSI on each 5-min candle for 2 candles.
// If LONG RSI < 62 or SHORT RSI > 32 → exit immediately.
rsiConfirmation?: {
  candlesSinceEntry: number;     // Counter: 0 at entry, incremented each candle
  maxCandles: number;            // Window size (2)
  threshold: number;             // LONG: 62, SHORT: 32
  direction: 'LONG' | 'SHORT';  // Used to determine comparison direction
  confirmed: boolean;            // true once window expires without breach
  entryRsi: number;              // RSI at entry time (for logging context)
};
```

**Why here:** All position state goes through `saveCapitalData()` → disk → `recoverActivePosition()`. Adding it to the position object makes it automatically restart-safe. No changes needed to serialization/deserialization since `JSON.stringify`/`JSON.parse` handles the new property natively.

---

### Step 2: Initialize `rsiConfirmation` at entry time

**File:** `BollingerBandStrategy.ts`

**LONG entry** (after line ~3236 where `this.currentPosition = { ... }` is set):

After the `breakoutValidation` initialization block (around line ~3290), add:

```typescript
// ═══════════════════════════════════════════════════════════════
// RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry
// LONG: Exit if stock RSI(10) drops below 62 within 2 candles
// ═══════════════════════════════════════════════════════════════
this.currentPosition.rsiConfirmation = {
  candlesSinceEntry: 0,
  maxCandles: 2,
  threshold: 62,
  direction: "LONG",
  confirmed: false,
  entryRsi: rsi, // rsi is already in scope from checkEntrySignals()
};
this.logger.info("🔍 RSI CONFIRMATION ARMED (LONG)", {
  threshold: "<62",
  window: "2 candles (10 min)",
  entryRsi: rsi.toFixed(2),
});
```

**SHORT entry** (after line ~3393 where SHORT `this.currentPosition = { ... }` is set):

After the SHORT `breakoutValidation` initialization block (around line ~3450), add:

```typescript
// ═══════════════════════════════════════════════════════════════
// RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry
// SHORT: Exit if stock RSI(10) rises above 32 within 2 candles
// ═══════════════════════════════════════════════════════════════
this.currentPosition.rsiConfirmation = {
  candlesSinceEntry: 0,
  maxCandles: 2,
  threshold: 32,
  direction: "SHORT",
  confirmed: false,
  entryRsi: rsi, // rsi is already in scope from checkEntrySignals()
};
this.logger.info("🔍 RSI CONFIRMATION ARMED (SHORT)", {
  threshold: ">32",
  window: "2 candles (10 min)",
  entryRsi: rsi.toFixed(2),
});
```

**Important:** The `rsi` variable is already destructured from `this.currentIndicators` at the top of `checkEntrySignals()` (line 2938: `const { rsi, supertrend, bollingerBands } = this.currentIndicators;`). However, the actual entry execution is in a nested function that may be called later. We need to capture the RSI value at entry time. The entry function bodies (executeLongEntry / executeShortEntry or the inline code) run synchronously within the same candle cycle, so `this.currentIndicators.rsi` will still be the correct value.

---

### Step 3: Create `checkRsiConfirmation()` method

**File:** `BollingerBandStrategy.ts`

Place this new method right after `checkBreakoutValidation()` (after line ~3500, before the `// ENTRY SIGNAL LOGIC` section), in a new clearly commented block:

```typescript
// ============================================================================
// RSI QUICK REVERSAL CONFIRMATION (F7)
// Post-entry gate: checks if stock RSI(10) reverses within 2 candles (10 min).
// LONG: exits if RSI drops below 62. SHORT: exits if RSI rises above 32.
// Modeled after breakoutValidation — same lifecycle, same persistence.
// ============================================================================

/**
 * RSI Quick Reversal Confirmation (F7 Filter)
 *
 * After entry, monitors the stock RSI(10) on each 5-minute candle close:
 * - LONG: If RSI < 62 within 2 candles → exit (RSI_CONFIRMATION_FAILED)
 * - SHORT: If RSI > 32 within 2 candles → exit (RSI_CONFIRMATION_FAILED)
 * - If 2 candles pass without breach → mark confirmed, trade runs normally
 *
 * Backtested: +₹38,610 improvement, kills 38 losing trades, 0 winners lost.
 */
private async checkRsiConfirmation(): Promise<void> {
  if (!this.currentPosition?.rsiConfirmation) return;
  if (this.currentPosition.rsiConfirmation.confirmed) return;
  if (!this.currentIndicators) return;

  const conf = this.currentPosition.rsiConfirmation;
  conf.candlesSinceEntry++;

  const currentRsi = this.currentIndicators.rsi;
  const isLong = conf.direction === 'LONG';

  // Check threshold breach
  const breached = isLong
    ? currentRsi < conf.threshold   // LONG: RSI dropped below 62
    : currentRsi > conf.threshold;  // SHORT: RSI rose above 32

  if (breached) {
    this.logger.warn(`⚠️ RSI CONFIRMATION FAILED: ${isLong ? 'LONG' : 'SHORT'} RSI ${isLong ? 'dropped below' : 'rose above'} ${conf.threshold}`, {
      symbol: this.signalSymbol,
      direction: conf.direction,
      currentRsi: currentRsi.toFixed(2),
      threshold: conf.threshold,
      entryRsi: conf.entryRsi.toFixed(2),
      candleNumber: conf.candlesSinceEntry,
      maxCandles: conf.maxCandles
    });

    await this.executeExit('RSI_CONFIRMATION_FAILED');
    return;
  }

  // Window expired without breach → confirmed
  if (conf.candlesSinceEntry >= conf.maxCandles) {
    conf.confirmed = true;
    this.logger.info(`✅ RSI CONFIRMATION PASSED: ${conf.direction} RSI held ${isLong ? 'above' : 'below'} ${conf.threshold} for ${conf.maxCandles} candles`, {
      symbol: this.signalSymbol,
      direction: conf.direction,
      currentRsi: currentRsi.toFixed(2),
      threshold: conf.threshold,
      entryRsi: conf.entryRsi.toFixed(2)
    });
    this.saveCapitalData(); // Persist confirmed state
    return;
  }

  // Window still open
  this.logger.info(`🔍 RSI CONFIRMATION: Candle ${conf.candlesSinceEntry}/${conf.maxCandles} — RSI ${currentRsi.toFixed(2)} ${isLong ? '≥' : '≤'} ${conf.threshold} ✓`, {
    symbol: this.signalSymbol,
    direction: conf.direction,
    candlesRemaining: conf.maxCandles - conf.candlesSinceEntry
  });
  this.saveCapitalData(); // Persist counter for restart safety
}
```

---

### Step 4: Wire `checkRsiConfirmation()` into the master candle cycle

**File:** `BollingerBandStrategy.ts` (lines 2499–2510)

Current flow:

```
updateTechnicalIndicators()
  → checkPositionExit(newCandle.close)      // Supertrend/BB exit
    → checkBreakoutValidation(newCandle)     // Candle H/L validation
      → checkEntrySignals()                  // New entries
```

**Insert the RSI confirmation check BEFORE the primary exit checks.** This is critical because:

1. RSI confirmation is a **pre-exit gate** — if the trade fails RSI confirmation, it should exit immediately, before wasting time checking Supertrend/BB levels.
2. It runs only during the 2-candle window (short-circuits once confirmed).
3. By placing it first, we avoid confusing log sequences where Supertrend says "position held" but then RSI confirmation kills it.

**Modified flow (lines ~2499–2510):**

```typescript
// CRITICAL ORDER: Check exits BEFORE entries
const hadPositionBeforeExitCheck = this.currentPosition !== null;
if (this.currentPosition) {
  // F7: RSI Quick Reversal Confirmation (first 2 candles only)
  // Must run BEFORE primary exit checks — if RSI confirmation fails, exit immediately
  if (
    this.currentPosition?.rsiConfirmation &&
    !this.currentPosition.rsiConfirmation.confirmed
  ) {
    await this.checkRsiConfirmation();
  }

  // Primary exit check (Supertrend/BB) — only if position still exists after RSI confirmation
  if (this.currentPosition) {
    await this.checkPositionExit(newCandle.close);
  }

  // Breakout validation check (first 3 candles, first-breakout entries only)
  if (
    this.currentPosition?.breakoutValidation &&
    !this.currentPosition.breakoutValidation.validated
  ) {
    await this.checkBreakoutValidation(newCandle);
  }
}
```

**Why before `checkPositionExit`?**

- If RSI confirmation fails on candle 1 or 2, the position exits instantly. There's no point running Supertrend/BB checks on a trade that's already dead.
- After candle 2 (once `confirmed = true`), this block short-circuits and adds zero overhead to the remaining trade lifecycle.
- If RSI confirmation passes on the same candle that Supertrend would trigger an exit, both would fire — but since `checkRsiConfirmation` runs first and the RSI is fine (confirmed), Supertrend exit proceeds normally. No conflict.

**Note:** Both `checkRsiConfirmation()` and `checkBreakoutValidation()` can independently call `executeExit()`. On candles 1–2, a trade could be killed by EITHER mechanism. This is intentional — they are independent post-entry validation gates. A trade must survive both.

---

### Step 5: Handle recovery from restart

**File:** `BollingerBandStrategy.ts` — `recoverActivePosition()` (line ~340)

The `rsiConfirmation` field is already part of `this.currentPosition`, which is serialized/deserialized by `saveCapitalData()` / `loadCapitalData()`. Since all fields are primitive types (numbers, strings, booleans), no special date conversion is needed (unlike `breakoutValidation.breakoutCandleTimestamp`).

**No changes required for restart recovery.** The state will be automatically persisted and restored. After restart, the master cycle will call `checkRsiConfirmation()` on the next candle, and the counter will continue from where it left off.

**Verify:** The existing code at line ~280 does:

```typescript
this.currentPosition = data.activePosition;
```

This will include the `rsiConfirmation` object. The subsequent `checkRsiConfirmation()` calls will work correctly because `candlesSinceEntry`, `maxCandles`, `threshold`, `direction`, `confirmed`, and `entryRsi` are all primitives.

---

## Execution Order & Interaction with Other Systems

### Master Cycle Flow (per 5-min candle):

```
fetchLatest5MinuteCandle()
  ↓
updateTechnicalIndicators()          ← RSI is fresh here
  ↓
[position exists?]
  ↓ YES
  ├─ checkRsiConfirmation()          ← NEW: F7 — runs only candles 1-2 after entry
  │   └─ if breached → executeExit('RSI_CONFIRMATION_FAILED') → done
  │
  ├─ checkPositionExit(candleClose)  ← Supertrend/BB exit (only if position survives)
  │   └─ if triggered → executeExit('LONG_SUPERTREND_BREAK' / 'SHORT_SUPERTREND_BB_BREAK')
  │
  └─ checkBreakoutValidation(candle) ← Candle H/L gate (first 3 candles, first-breakout only)
      └─ if failed → executeExit('BREAKOUT_NO_FOLLOWTHROUGH')
  ↓
[no position / just exited?]
  ↓
checkEntrySignals()
```

### Timeline for a new trade:

```
CANDLE 0 (Entry):  checkEntrySignals() → position created, rsiConfirmation armed
CANDLE 1 (+5 min): RSI check #1 — if breached, EXIT. Otherwise continue.
CANDLE 2 (+10 min): RSI check #2 — if breached, EXIT. Otherwise CONFIRMED.
CANDLE 3+ :        rsiConfirmation.confirmed=true → short-circuit, zero overhead.
                   Trade runs under normal exit mechanisms (Supertrend, Gamma, EOD, etc.)
```

### Interaction with other exit layers:

| Exit Layer                    | Conflict?   | Resolution                                                                                      |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| **Emergency Hard Stop (±5%)** | No conflict | Runs on separate 30-sec interval, acts independently                                            |
| **Supertrend/BB Break**       | No conflict | Runs after RSI confirmation — if RSI kills the trade first, Supertrend never fires              |
| **Breakout Validation**       | No conflict | Runs after both. A trade can be killed by RSI confirmation OR breakout validation independently |
| **Gamma Climax (15-min RSI)** | No conflict | Uses OPTION RSI, different metric. Runs on 15-min interval                                      |
| **RSI Trail**                 | No conflict | Only activates after option RSI > 85, which takes time. Never fires in first 2 candles          |
| **EOD Safety (3:19 PM)**      | No conflict | Time-based, independent                                                                         |

---

## Configuration Constants

Add these as class-level constants (near line ~192, alongside other exit constants):

```typescript
// F7: RSI Quick Reversal Confirmation
private readonly RSI_CONFIRMATION_WINDOW = 2;            // Number of candles to monitor (10 min)
private readonly RSI_CONFIRMATION_LONG_THRESHOLD = 62;   // LONG: exit if RSI drops below this
private readonly RSI_CONFIRMATION_SHORT_THRESHOLD = 32;  // SHORT: exit if RSI rises above this
```

This keeps thresholds centralized and easy to tune in future. Use these constants in Steps 2 and 3 instead of hardcoded numbers.

---

## Dashboard Impact

The `RSI_CONFIRMATION_FAILED` exit reason will automatically appear in:

- Trade history logs (via `executeExit()` → `tradeRecord.exitReason`)
- The dashboard's trade table (fetched from `tradeHistory[]`)
- Winston logs (via the logger calls in `checkRsiConfirmation()`)

No dashboard code changes needed.

---

## Files Changed

| File                       | Changes             | Lines affected (approx)                       |
| -------------------------- | ------------------- | --------------------------------------------- |
| `BollingerBandStrategy.ts` | Position interface  | ~88 (add `rsiConfirmation` type)              |
| `BollingerBandStrategy.ts` | Constants           | ~192 (add 3 constants)                        |
| `BollingerBandStrategy.ts` | LONG entry init     | ~3290 (add rsiConfirmation init)              |
| `BollingerBandStrategy.ts` | SHORT entry init    | ~3450 (add rsiConfirmation init)              |
| `BollingerBandStrategy.ts` | Master cycle wiring | ~2499–2510 (add rsiConfirmation check)        |
| `BollingerBandStrategy.ts` | New method          | ~3500 (add checkRsiConfirmation(), ~50 lines) |

**Total: ~80 lines of new code, 1 file.** No changes to persistence, recovery, dashboard, or other strategies.

---

## Risk Assessment

| Risk                                      | Mitigation                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kills too many trades                     | Backtested: 38 trades killed, ALL were losers. 0 winners lost.                                                                                                                                                                      |
| RSI data stale after restart              | RSI recalculates from candleHistory on first candle fetch. If candleHistory is blank after restart, indicators won't be set, and the `if (!this.currentIndicators) return;` guard in `checkRsiConfirmation()` prevents false exits. |
| Race with Emergency Hard Stop             | Emergency runs on independent 30-sec timer. If both fire simultaneously, `executeExit()` has `if (!this.currentPosition) return;` guard — second call is a no-op.                                                                   |
| Window counter off-by-one after restart   | Counter is persisted. If bot restarts mid-window, the counter continues correctly on next candle. Worst case: 1 extra candle of monitoring (harmless).                                                                              |
| Entry RSI exactly at threshold (62 or 32) | The check uses strict inequality (`<` / `>`), so RSI exactly at 62 (LONG) or 32 (SHORT) does NOT trigger exit. This is intentional — borderline values are allowed to run.                                                          |

---

## Verification Plan

After implementation, verify with these checks:

1. **Log verification:** Enter a trade (paper or live), watch for `RSI CONFIRMATION ARMED` log at entry, then `RSI CONFIRMATION: Candle 1/2` and `Candle 2/2` on subsequent candles.
2. **Kill verification:** Simulate entry where RSI drops quickly (or use historical data). Confirm `RSI_CONFIRMATION_FAILED` exit fires and position is cleared.
3. **Persistence:** Enter a trade, let 1 candle pass, restart bot. Confirm `candlesSinceEntry` is restored (check logs or `strategy-state.json`).
4. **No-conflict:** Let a confirmed trade (past candle 2) run to a Supertrend exit. Verify `checkRsiConfirmation()` short-circuits with no logs after confirmation.
5. **Dashboard:** Verify `RSI_CONFIRMATION_FAILED` appears in trade history table for killed trades.
