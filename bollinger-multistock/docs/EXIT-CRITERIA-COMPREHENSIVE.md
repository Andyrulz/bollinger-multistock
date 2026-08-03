# Bollinger Band Strategy — Comprehensive Exit Criteria

**Complete reference for all exit mechanisms in `BollingerBandStrategy.ts`**
**Last updated**: July 29, 2026

---

## Exit Summary Table

| #   | Exit Name                    | Exit Reason Tag                      | Trigger Condition                                    | Check Frequency             | Applies To | Priority |
| --- | ---------------------------- | ------------------------------------ | ---------------------------------------------------- | --------------------------- | ---------- | -------- |
| 1   | EOD Safety Exit              | `EOD_SAFETY_EXIT_3:11PM`             | Clock hits 3:11 PM IST                               | Once/day (scheduled timer)  | ALL        | Highest  |
| 2   | Emergency Hard Stop          | `EMERGENCY_HARD_STOP`                | Stock ±5% from entry                                 | Every 30 seconds (polling)  | ALL        | Critical |
| 3   | Premium Hard Stop (8%)       | `PREMIUM_HARD_STOP_8PCT`             | Option premium drops ≥8% from entry                  | Every 5-min candle close    | ALL        | High     |
| 4   | RSI Quick Reversal (F7)      | `RSI_CONFIRMATION_FAILED`            | Stock RSI breaches threshold within 2 candles        | First 2 candles after entry | ALL        | High     |
| 5   | Breakout No Follow-Through   | `BREAKOUT_NO_FOLLOWTHROUGH`          | No new HIGH/LOW in 3 candles post-entry              | First 3 candles after entry | ALL        | High     |
| 6   | Gamma Climax                 | `GAMMA_CLIMAX_RSI{N}`                | Option RSI(14) ≥ 85 on 15-min chart                  | 15-min boundaries           | ALL        | Medium   |
| 7   | RSI Trail — Candle LOW Break | `RSI_TRAIL_CANDLE_LOW_BREAK`         | After 5-min RSI ≥ 85 activation, LTP ≤ candle LOW    | 5-sec live polling          | SHORT only | Medium   |
| 8   | RSI Trail — Secondary        | `RSI_TRAIL_SECONDARY_EXIT_RSI{N}`    | After activation, 5-min RSI drops < 75               | 5-min boundaries            | SHORT only | Medium   |
| 9   | LONG Supertrend Break        | `LONG_SUPERTREND_BREAK`              | 5-min candle closes below Supertrend                 | Every 5-min candle close    | LONG only  | Primary  |
| 10  | SHORT Supertrend/BB Break    | `SHORT_SUPERTREND_BB_BREAK`          | 5-min candle closes above MIN(Supertrend, BB Middle) | Every 5-min candle close    | SHORT only | Primary  |
| 11  | Position Reconciliation      | `MANUAL_CLEAR_BROKER_AUTO_SQUAREOFF` | Broker position gone but bot still tracking          | Every 2 minutes             | ALL        | Recovery |
| 12  | Monitoring Restart Failed    | `MONITORING_RESTART_FAILED`          | Position recovery fails after restart                | On strategy restart         | ALL        | Recovery |

---

## Detailed Exit Descriptions

---

### 1. EOD Safety Exit

**Purpose**: Close all positions before the underlying enters CAS at 3:15 PM and before the broker's MIS auto-squareoff window (~3:25 PM).

**How it works**:

- A timezone-safe `setTimeout` is scheduled at strategy start targeting **3:11 PM IST**.
- When the timer fires, if a position exists, `forceClosePosition('EOD_SAFETY_EXIT_3:11PM')` is called.
- If no position is open at 3:11 PM, it logs and does nothing.

**Configuration**:
| Parameter | Value |
|-----------|-------|
| Exit time | 3:11 PM IST |
| Buffer before underlying CAS | 4 minutes |
| Buffer before broker squareoff | 14 minutes |

**Code Reference**: `scheduleEODExit()` / `cancelEODExit()`

**Lifecycle**: Scheduled once on strategy initialization. Cancelled when strategy stops.

---

### 2. Emergency Hard Stop

**Purpose**: Flash crash protection. A circuit-breaker for catastrophic moves where the stock moves ±5% from entry — far beyond normal intraday volatility.

**How it works**:

- An `setInterval` polls the stock spot LTP via REST API every 30 seconds.
- Compares current stock price against entry stock price (`position.entryStockPrice`).
- **LONG**: Exits if stock dropped > 5% from entry → `currentStockLTP < entryStockPrice × 0.95`
- **SHORT**: Exits if stock rose > 5% from entry → `currentStockLTP > entryStockPrice × 1.05`
- Monitoring is stopped **before** executing the exit to prevent duplicate triggers.

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| Stop threshold | 5.0% | `EMERGENCY_STOP_PERCENT` |
| Poll interval | 30,000 ms (30s) | `EMERGENCY_POLL_INTERVAL_MS` |

**Code Reference**: `startEmergencyStopMonitoring()` → `checkEmergencyStop()` → `stopEmergencyStopMonitoring()`

**Why stock price, not option premium?**
Options can have erratic premium movements due to IV changes. Using the underlying stock price provides a stable, objective measure of catastrophic market movement.

---

### 3. Premium Hard Stop (8% Drop)

**Purpose**: Quick-cut losers early. If the option premium drops ≥8% from entry price, exit immediately — the trade premise has failed.

**How it works**:

- Checked on every 5-minute candle close, after the dashboard price update fetches the live option premium.
- Calculates: `premiumDropPct = (entryPrice - currentPremium) / entryPrice`
- If `premiumDropPct >= 0.08` (8%), triggers exit.

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| Drop threshold | 8% | `PREMIUM_HARD_STOP_PCT = 0.08` |
| Check frequency | Every 5-min candle close | — |

**Code Reference**: Inline check inside `fetchLatest5MinuteCandle()` after dashboard price update (line ~2649)

**Data backing**: Backtested across historical trades — 0 winners killed at 8% threshold, 13 losers stopped early, net improvement of +₹6,662.

**Applies to**: Both LONG and SHORT positions.

---

### 4. RSI Quick Reversal Confirmation (F7 Filter)

**Purpose**: Post-entry gate that validates the trade direction wasn't a false breakout by monitoring stock RSI(10) for the first 2 candles (10 minutes) after entry.

**How it works**:

- On entry, an `rsiConfirmation` object is attached to the position:
  ```
  { candlesSinceEntry: 0, maxCandles: 2, threshold: 62|32, direction: LONG|SHORT, confirmed: false }
  ```
- On each 5-minute candle close (for the first 2 candles), `checkRsiConfirmation()` runs **before** primary exit checks.
- **LONG**: If RSI drops below 62 → exit (`RSI_CONFIRMATION_FAILED`)
- **SHORT**: If RSI rises above 32 → exit (`RSI_CONFIRMATION_FAILED`)
- If 2 candles pass without breach → `confirmed = true`, trade runs under normal exit mechanisms.

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| Window | 2 candles (10 min) | `RSI_CONFIRMATION_WINDOW` |
| LONG threshold | RSI < 62 = fail | `RSI_CONFIRMATION_LONG_THRESHOLD` |
| SHORT threshold | RSI > 32 = fail | `RSI_CONFIRMATION_SHORT_THRESHOLD` |

**Code Reference**: `checkRsiConfirmation()`

**Data backing**: +₹38,610 backtested improvement. Kills 38 losing trades, 0 winners lost.

**Execution order**: Runs **before** the primary Supertrend/BB exit check on each candle. If confirmation fails, the position exits immediately without checking Supertrend.

---

### 5. Breakout Candle HIGH/LOW Validation

**Purpose**: Post-entry gate that ensures the breakout candle's extreme (HIGH for LONG, LOW for SHORT) is exceeded within 3 candles (15 minutes). If not, the breakout lacked conviction.

**How it works**:

- On entry (first-breakout entries only), a `breakoutValidation` object is attached:
  ```
  { breakoutCandleHigh, breakoutCandleLow, candlesSinceBreakout: 0, bestHighSinceBreakout: 0, bestLowSinceBreakout: Infinity, validated: false }
  ```
- On each subsequent candle close:
  - **LONG**: Tracks `bestHighSinceBreakout`. If any new candle's HIGH exceeds the breakout candle's HIGH → validated, trade runs normally.
  - **SHORT**: Tracks `bestLowSinceBreakout`. If any new candle's LOW goes below the breakout candle's LOW → validated, trade runs normally.
- After 3 candles without validation → exit with `BREAKOUT_NO_FOLLOWTHROUGH`.

**Configuration**:
| Parameter | Value |
|-----------|-------|
| Validation window | 3 candles (15 minutes) |
| Applies to | First-breakout entries only (not second-candle re-entries) |

**Code Reference**: `checkBreakoutValidation()`

**Execution order**: Runs **after** primary Supertrend/BB exit check. If primary exit already triggered, breakout validation is skipped.

---

### 6. Gamma Climax Exit (Option RSI ≥ 85 on 15-min Chart)

**Purpose**: Capture "blow-off tops" in Eiffel Tower setups. When option RSI(14) on the 15-minute chart hits ≥ 85, the option premium is likely at a climax point and will reverse. Full exit.

**How it works**:

- A scheduler fires at every 15-minute boundary (9:15, 9:30, 9:45, ...).
- Fetches 15-minute OPTION candles from KiteConnect historical API.
- Calculates RSI(14) using Wilder's RMA (matches TradingView).
- Verifies the latest candle is **closed** (not in-progress).
- If RSI ≥ 85 → exit with `GAMMA_CLIMAX_RSI{value}`.
- 60-second **micro-grace** after entry prevents double-fire on boundary entries (e.g., entry at 10:14:59).

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| RSI threshold | 85 | `OPTION_RSI_CLIMAX_THRESHOLD` |
| Check interval | 15 minutes | `OPTION_RSI_CHECK_INTERVAL` |
| Micro-grace | 60 seconds | `OPTION_RSI_MICRO_GRACE_SECONDS` |
| RSI period | 14 | Hardcoded in `calculateOptionRSI()` |

**Code Reference**: `startOptionRsiMonitoring()` → `checkOptionRsiExit()` → `stopOptionRsiMonitoring()`

**Why option RSI, not stock RSI?**
Options are leveraged instruments with gamma acceleration. A stock RSI of 65 might correspond to an option RSI of 90. The option RSI directly captures crowd euphoria in the derivative before the premium crashes.

**Applies to**: Both LONG and SHORT positions.

---

### 7. RSI-Activated Live Premium Trailing Stop — Candle LOW Break (SHORT Only)

**Purpose**: Captures parabolic premium spikes (flash breakouts) that spike and crash within a single 5-minute window — too fast for the standard 5-min candle close exit to catch.

**How it works (Two-phase mechanism)**:

#### Phase 1: Activation (5-minute checks)

- At every 5-minute boundary, calculates RSI(14) on 5-minute OPTION candles.
- If RSI ≥ 85 on a completed candle:
  - `rsiTrailActivated = true`
  - Floor price = that candle's **LOW** (`latestCandle.low`)
  - Live polling starts (Phase 2).

#### Phase 2: Live Polling (every 5 seconds)

- Fetches option LTP via `kiteConnect.getQuote(['NFO:{symbol}'])` every 5 seconds.
- **Exit trigger**: If `optionLTP <= rsiTrailFloorPrice` → exit with `RSI_TRAIL_CANDLE_LOW_BREAK`.
- **Floor update**: On each 5-minute candle close, the floor is updated to the latest candle's LOW (rolling trail). The floor can go up or down — it tracks the most recent candle's low, not the highest candle low.

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| Activation threshold | 5-min RSI ≥ 85 | `RSI_TRAIL_ACTIVATION_THRESHOLD` |
| Poll interval | 5,000 ms (5s) | `RSI_TRAIL_POLL_INTERVAL_MS` |

**Code Reference**: `startRsiTrail5MinMonitoring()` → `check5MinOptionRsiForTrail()` → `startRsiTrailLivePolling()`

**State persistence**: RSI Trail activation state (`activated`, `floorPrice`, `activationRsi`) is persisted to disk via `saveCapitalData()` and restored on restart.

---

### 8. RSI Trail — Secondary Exit (SHORT Only)

**Purpose**: Safety net after RSI Trail activation. If 5-min option RSI drops below 75, momentum is collapsing even if premium hasn't broken the floor. Exit proactively.

**How it works**:

- Only checked **after** RSI Trail has been activated (Phase 1 triggered).
- On each 5-minute candle close, the system recalculates 5-min option RSI.
- If `optionRsi < 75` → exit with `RSI_TRAIL_SECONDARY_EXIT_RSI{N}`.
- Stops live polling **before** executing exit to prevent race conditions.

**Configuration**:
| Parameter | Value | Constant |
|-----------|-------|----------|
| Secondary threshold | RSI < 75 | `RSI_TRAIL_SECONDARY_EXIT_THRESHOLD` |

**Code Reference**: Inside `check5MinOptionRsiForTrail()` (post-activation branch)

---

### 9. LONG Supertrend Break (Primary Exit)

**Purpose**: The core exit mechanism for LONG positions. When the 5-minute stock candle closes below the dynamic Supertrend value, bullish momentum is broken.

**How it works**:

- Checked on every 5-minute candle close via `checkPositionExit()`.
- Uses **current** (just-recalculated) Supertrend value, not the value at entry time.
- Exit condition: `candleClosePrice < supertrend`
- Supertrend naturally trails price upward in uptrends, providing dynamic protection that adapts to volatility.

**Supertrend parameters**:
| Parameter | Value |
|-----------|-------|
| Period | 10 |
| Multiplier | 2.0 |
| Based on | ATR (Average True Range) |

**Code Reference**: `checkLongExitOnCandleClose()`

**Why candle close, not intraday ticks?**

- Eliminates "wick noise" — intraday wicks can briefly pierce Supertrend but close above it.
- Prevents whipsaw exits on volatile candles.
- Aligns with entry logic (also candle-close based).

---

### 10. SHORT Supertrend/BB Middle Break (Primary Exit)

**Purpose**: The core exit mechanism for SHORT positions. Uses the **tighter** of Supertrend and BB Middle for quicker protection.

**How it works**:

- Checked on every 5-minute candle close.
- Calculates: `exitThreshold = MIN(Supertrend, BB Middle)`
- Exit condition: `candleClosePrice > exitThreshold`
- Using MIN ensures the exit triggers at whichever level is closer (lower), providing tighter risk management.

**Why MIN(Supertrend, BB Middle)?**

- Supertrend trails down in downtrends — good for momentum.
- BB Middle represents mean reversion — good for catching reversals.
- Whichever is hit first triggers exit, covering both scenarios.

**Code Reference**: `checkShortExitOnCandleClose()`

---

### 11. Position Reconciliation (Broker Mismatch Detection)

**Purpose**: Detects when a position exists in the bot's memory but no longer exists at the broker (manual exit, broker auto-squareoff, connection issues).

**How it works**:

- A reconciliation loop runs every **2 minutes** via `setInterval`.
- Calls `kiteConnect.getPositions()` to fetch broker's net positions.
- Looks for the bot's tracked trading symbol with non-zero quantity.
- If the position is **missing** at the broker:
  - Calls `clearActivePosition()` which fetches the exit order from broker order history.
  - Records actual exit price and P&L from the broker's filled order data.
  - Clears the position from bot state and persists to disk.

**Configuration**:
| Parameter | Value |
|-----------|-------|
| Check interval | 2 minutes |
| Slot stagger | slotIndex × 1,000 ms |

**Code Reference**: `startPositionReconciliation()` → `reconcilePositions()` → `clearActivePosition()` → `fetchExitOrderFromBroker()`

**Exit Reason**: `MANUAL_CLEAR_BROKER_AUTO_SQUAREOFF`

---

### 12. Monitoring Restart Failed (Recovery Safeguard)

**Purpose**: Safety net for when the bot restarts and tries to recover an active position but fails to re-establish monitoring.

**How it works**:

- On strategy startup, `recoverActivePosition()` attempts to reload a persisted position from disk.
- If the position is valid and passes the zombie guard (same stock as current config), monitoring is restarted.
- If `startPositionMonitoring()` throws an error, the position is force-closed as a safety measure: `forceClosePosition('MONITORING_RESTART_FAILED')`.
- If even the force-close fails, a critical error is logged requesting manual intervention.

**Code Reference**: `recoverActivePosition()` (error handling block)

---

## Exit Execution Flow

### Processing Order Per 5-Minute Candle

```
5-minute candle completes
    │
    ├─ 1. Update dashboard price (fetch option premium)
    │      └─ Check: Premium Hard Stop (8% drop) → PREMIUM_HARD_STOP_8PCT
    │
    ├─ 2. RSI Quick Reversal Confirmation (F7)  [first 2 candles only]
    │      └─ Check: RSI breach → RSI_CONFIRMATION_FAILED
    │
    ├─ 3. Primary Exit Check
    │      ├─ LONG: Close < Supertrend → LONG_SUPERTREND_BREAK
    │      └─ SHORT: Close > MIN(ST, BB Mid) → SHORT_SUPERTREND_BB_BREAK
    │
    └─ 4. Breakout Validation  [first 3 candles, first-breakout entries only]
           └─ Check: No follow-through → BREAKOUT_NO_FOLLOWTHROUGH
```

### Parallel Monitoring Systems (Independent of Candle Cycle)

```
┌─────────────────────────────────┐
│ Emergency Hard Stop             │ → polls stock LTP every 30s
│ EOD Safety Timer                │ → fires once at 3:11 PM IST
│ Gamma Climax (15-min RSI)       │ → checks at 15-min boundaries
│ RSI Trail 5-min Monitoring      │ → checks at 5-min boundaries (SHORT only)
│ RSI Trail Live Polling          │ → polls option LTP every 5s (after activation)
│ Position Reconciliation         │ → checks broker every 2 min
└─────────────────────────────────┘
```

---

## Race Condition Protection

Multiple exit mechanisms run concurrently. A single global gate prevents double sell orders:

```typescript
// Global exit gate (in executeExit)
if (this.isExecutingExit) {
  return; // Skip — another exit already in progress
}
this.isExecutingExit = true;
try {
  /* place sell order, record P&L, cleanup */
} finally {
  this.isExecutingExit = false;
}
```

Additionally, position-specific gates prevent concurrent processing:

- `isProcessingLongExit` — guards `checkLongExitOnCandleClose()`
- `isProcessingShortExit` — guards `checkShortExitOnCandleClose()`
- `isClearingPosition` — guards `clearActivePosition()`

**Pattern**: All monitoring systems stop themselves **before** calling `executeExit()` to prevent re-triggering during exit processing.

---

## Exit Cleanup (Post-Exit)

When `executeExit()` completes successfully:

1. **P&L recorded**: `(exitPrice - entryPrice) × quantity × lotSize`
2. **Capital updated**: `currentCapital += pnl`
3. **Trade history**: Trade record pushed with full metadata
4. **Symbol cooldown**: `StrategyManager.recordSymbolExitStatic()` blocks re-entry for 30 minutes
5. **State persisted**: `saveCapitalData()` writes to disk immediately (minimizes race window with scanner's `swapStrategy()`)
6. **Dashboard reset**: Cached price, P&L, and position info cleared
7. **All monitoring stopped**:
   - Position polling stopped
   - Emergency Hard Stop polling stopped
   - Gamma RSI 15-min monitoring stopped
   - RSI Trail 5-min monitoring + live polling stopped

---

## Configuration Constants Reference

| Constant                             | Value   | Description                        |
| ------------------------------------ | ------- | ---------------------------------- |
| `EMERGENCY_STOP_PERCENT`             | 5.0     | Stock % move for emergency exit    |
| `EMERGENCY_POLL_INTERVAL_MS`         | 30,000  | Emergency stop check interval (ms) |
| `PREMIUM_HARD_STOP_PCT`              | 0.08    | Option premium drop threshold (8%) |
| `OPTION_RSI_CHECK_INTERVAL`          | 900,000 | 15-min RSI check interval (ms)     |
| `OPTION_RSI_CLIMAX_THRESHOLD`        | 85      | Gamma climax RSI trigger           |
| `OPTION_RSI_MICRO_GRACE_SECONDS`     | 60      | Grace period after entry (seconds) |
| `RSI_TRAIL_ACTIVATION_THRESHOLD`     | 85      | 5-min option RSI to activate trail |
| `RSI_TRAIL_SECONDARY_EXIT_THRESHOLD` | 75      | 5-min RSI drop = secondary exit    |
| `RSI_TRAIL_POLL_INTERVAL_MS`         | 5,000   | Live premium poll interval (ms)    |
| `RSI_CONFIRMATION_WINDOW`            | 2       | Candles for RSI confirmation (F7)  |
| `RSI_CONFIRMATION_LONG_THRESHOLD`    | 62      | LONG: RSI must stay above this     |
| `RSI_CONFIRMATION_SHORT_THRESHOLD`   | 32      | SHORT: RSI must stay below this    |

---

## Exit Reason Tag Quick Reference

| Tag                                  | Exit # | Description                                  |
| ------------------------------------ | ------ | -------------------------------------------- |
| `EOD_SAFETY_EXIT_3:19PM`             | 1      | End-of-day forced close                      |
| `EMERGENCY_HARD_STOP`                | 2      | Stock ±5% flash crash protection             |
| `PREMIUM_HARD_STOP_8PCT`             | 3      | Option premium dropped ≥8%                   |
| `RSI_CONFIRMATION_FAILED`            | 4      | RSI reversed within 2 candles post-entry     |
| `BREAKOUT_NO_FOLLOWTHROUGH`          | 5      | No HIGH/LOW follow-through in 15 min         |
| `GAMMA_CLIMAX_RSI{N}`                | 6      | 15-min option RSI ≥ 85                       |
| `RSI_TRAIL_CANDLE_LOW_BREAK`         | 7      | Premium broke below 5-min candle LOW floor   |
| `RSI_TRAIL_SECONDARY_EXIT_RSI{N}`    | 8      | 5-min option RSI < 75 after trail activation |
| `LONG_SUPERTREND_BREAK`              | 9      | 5-min close below Supertrend                 |
| `SHORT_SUPERTREND_BB_BREAK`          | 10     | 5-min close above MIN(Supertrend, BB Middle) |
| `MANUAL_CLEAR_BROKER_AUTO_SQUAREOFF` | 11     | Broker position vanished (reconciliation)    |
| `MONITORING_RESTART_FAILED`          | 12     | Recovery failed after restart                |
