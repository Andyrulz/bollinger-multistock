# Bollinger Band Exit Framework

**Supertrend-based exit system for stock option strategies**

---

## Exit Hierarchy (Priority Order)

| Priority | Exit Type                  | Trigger                                        | Check Frequency              | Applies To |
| -------- | -------------------------- | ---------------------------------------------- | ---------------------------- | ---------- |
| 1        | **EOD Safety**             | 3:11 PM IST                                    | Once per day                 | ALL        |
| 2        | **Emergency Hard Stop**    | Stock moves ±5% from entry                     | 30-second polling            | ALL        |
| 3        | **Gamma Climax**           | Option RSI(14) ≥ 85 (15-min)                   | 15-minute boundaries         | ALL        |
| 4        | **RSI Trail Premium Stop** | Option RSI(14) ≥ 85 (5-min) → LTP ≤ candle LOW | 5-min checks + 5-sec polling | SHORT only |
| 5        | **Supertrend Break**       | 5-min candle closes past threshold             | Every 5-min candle           | ALL        |

---

## Layer 1: EOD Safety Exit

**Purpose**: Exit before the 3:15 PM underlying CAS transition and broker's 3:25 PM MIS auto-squareoff.

**Trigger**: 3:11 PM IST daily (4 minutes before the underlying continuous session ends)

**Exit Reason**: `EOD_SAFETY_EXIT_3:11PM`

---

## Layer 2: Emergency Hard Stop

**Purpose**: Flash crash protection when stock moves catastrophically against position.

**Mechanism**:

- Poll stock LTP every 30 seconds
- LONG: Exit if stock drops > 5% from entry stock price
- SHORT: Exit if stock rises > 5% from entry stock price

**Exit Reason**: `EMERGENCY_HARD_STOP`

---

## Layer 3: Gamma Climax Exit

**Purpose**: Capture "blow-off tops" in Eiffel Tower setups before inevitable reversal.

**Mechanism**: RSI(14) on 15-minute OPTION chart ≥ 85 = full exit

**Why Option RSI (not underlying)?**

- Options are leveraged instruments with gamma acceleration
- Underlying RSI at 65 might map to Option RSI at 90
- Captures crowd euphoria before the crash

**Scheduler**:

- Aligned to 15-minute market boundaries (9:15, 9:30, 9:45...)
- 60-second micro-grace prevents edge-case double-fire on boundary entries

**Exit Reason**: `GAMMA_CLIMAX_RSI{value}` (e.g., `GAMMA_CLIMAX_RSI87`)

**Position Agnostic**: Works for both LONG and SHORT positions

---

## Layer 4: RSI-Activated Live Premium Trailing Stop (SHORT Only)

**Purpose**: Capture parabolic premium spikes (flash breakouts) that crash back within a single 5-minute window — too fast for the 5-min candle close exit to catch.

**Mechanism** (two phases):

### Phase 1: Activation (5-minute boundary checks)

- RSI(14) calculated on **5-minute OPTION** candles
- When RSI ≥ 85 on a completed 5-min candle close:
  - Trail **activated**
  - Floor price set to that candle's **LOW**
  - Live premium polling starts (5-second interval)

### Phase 2: Live Polling (every 5 seconds)

- Fetches option LTP via `kiteConnect.getQuote(['NFO:{symbol}'])`
- If LTP ≤ floor price → **EXIT immediately**
- Floor is updated every 5-min candle close to the latest candle's LOW (rolling trail)

### Secondary Safety Exit

- If 5-min option RSI drops below **75** on a candle close after activation → EXIT
- Catches momentum collapse even if premium hasn't broken the floor yet

**Exit Reasons**:

- `RSI_TRAIL_CANDLE_LOW_BREAK` — LTP broke below rolling candle-LOW floor
- `RSI_TRAIL_SECONDARY_EXIT_RSI{N}` — RSI dropped below 75 after activation

**Scheduler**:

- 5-minute boundary alignment with slot stagger (+2s offset from 15-min RSI checks)
- 60-second micro-grace after entry (same as Gamma Climax)

**RSI Calculation**: Uses Wilder's RMA (same as TradingView) with **full candle history** — no truncation — for accurate convergence with broker charts.

**Why SHORT Only?** Flash premium spikes are a SHORT-side phenomenon. PUT options surge when underlying drops fast, then IV-crush causes rapid reversal. LONG-side moves tend to cascade more gradually.

---

## Layer 5: Supertrend-Based Exit (Primary)

The core exit mechanism. Checked on every 5-minute candle close.

### LONG Exit

**Trigger**: 5-minute stock candle CLOSES below Supertrend value

```
Exit Condition: candleClose < Supertrend
```

**Logic**:

- Supertrend naturally trails price up in uptrends
- When price closes below it, bullish momentum is broken
- Dynamic protection that adapts to volatility

**Exit Reason**: `LONG_SUPERTREND_BREAK`

### SHORT Exit

**Trigger**: 5-minute stock candle CLOSES above MIN(Supertrend, BB Middle)

```
Exit Threshold = MIN(Supertrend, BB Middle)
Exit Condition: candleClose > Exit Threshold
```

**Logic**:

- Uses the TIGHTER (lower) of the two levels
- Supertrend trails price down in downtrends
- BB Middle provides mean-reversion protection
- Whichever is hit first triggers exit

**Exit Reason**: `SHORT_SUPERTREND_BB_BREAK`

---

## Implementation Details

### Position Monitoring Flow

```
Entry Order Executed
    ↓
Start Position Monitoring
    ↓
┌─────────────────────────────────────────┐
│ Every 5-Minute Candle Close:            │
│   1. Fetch latest candle data           │
│   2. Update indicators (Supertrend, BB) │
│   3. Check exit condition               │
│      - LONG: Close < Supertrend?        │
│      - SHORT: Close > MIN(ST, BB Mid)?  │
│   4. Execute exit if triggered          │
└─────────────────────────────────────────┘
    ↓
Parallel: 30-sec Emergency Stop polling
Parallel: 15-min RSI Climax checks (Gamma)
Parallel: 5-min RSI Trail checks (SHORT only, activates live polling on RSI ≥ 85)
Parallel: EOD timer at 3:11 PM IST
```

### Supertrend Calculation

```
Period: 10
Multiplier: 2.0

ATR = Average True Range(10)
BasicUpperBand = (High + Low) / 2 + (Multiplier × ATR)
BasicLowerBand = (High + Low) / 2 - (Multiplier × ATR)

FinalUpperBand = min(BasicUB, prev FinalUB) if close[prev] > prev FinalUB
FinalLowerBand = max(BasicLB, prev FinalLB) if close[prev] < prev FinalLB

Trend = UP if close > prev FinalUB, DOWN if close < prev FinalLB
Supertrend = FinalLowerBand if UP, FinalUpperBand if DOWN
```

---

## Exit Reason Tags

| Tag                               | Meaning                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `EOD_SAFETY_EXIT_3:19PM`          | End-of-day forced close                                  |
| `EMERGENCY_HARD_STOP`             | Stock moved ±5% (flash crash)                            |
| `GAMMA_CLIMAX_RSI{N}`             | Option RSI ≥ 85 on 15-min chart (blow-off top)           |
| `RSI_TRAIL_CANDLE_LOW_BREAK`      | SHORT: Premium broke below 5-min candle LOW floor        |
| `RSI_TRAIL_SECONDARY_EXIT_RSI{N}` | SHORT: 5-min option RSI dropped below 75 post-activation |
| `LONG_SUPERTREND_BREAK`           | LONG: Price closed below Supertrend                      |
| `SHORT_SUPERTREND_BB_BREAK`       | SHORT: Price closed above MIN(ST, BB Mid)                |
| `MONITORING_RESTART_FAILED`       | Position recovery failed                                 |
| `MANUAL_CLEAR_*`                  | Manual intervention                                      |

---

## Key Design Patterns

### 1. Candle Close Only

Exits are checked **only on completed 5-minute candles**, not on intraday price ticks.

**Why?**

- Reduces noise and false signals
- Prevents whipsaw exits on wicks
- Aligns with entry logic (also candle-close based)

### 2. Dynamic Indicator Values

Uses **current** Supertrend and BB Middle values recalculated on each candle, not static entry-time values.

**Why?**

- Adapts to changing volatility
- Tightens protection as trend matures
- Provides natural trailing behavior

### 3. Race Condition Protection

```typescript
if (this.isProcessingLongExit) return;
this.isProcessingLongExit = true;
try {
  await this.executeExit(...);
} finally {
  this.isProcessingLongExit = false;
}
```

### 4. Parallel Safety Systems

Multiple independent exit mechanisms run simultaneously:

- Candle-based Supertrend/BB exit (5-min)
- Emergency Hard Stop polling (30-sec)
- Gamma RSI Climax (15-min boundaries)
- RSI Trail live premium polling (5-sec, SHORT only, activates on 5-min RSI ≥ 85)
- EOD timer (once per day)

### 5. Dashboard Visibility

The **Exit Protection Layers** panel on each strategy dashboard shows real-time status of all exit mechanisms. For SHORT positions it displays RSI Trail state: watching (pre-activation), activated (with floor price and polling status), or N/A for LONG positions.

---

## Example Trade Flow

**LONG Trade on INFY**:

```
09:35:00 - Entry: Buy INFY CE @ ₹180
           Stock: 1850, Supertrend: 1842

09:40:00 - Candle close 1855 > ST 1843 → HOLD
09:45:00 - Candle close 1862 > ST 1848 → HOLD
09:50:00 - Candle close 1868 > ST 1855 → HOLD
10:00:00 - Candle close 1858 > ST 1860 → HOLD
10:05:00 - Candle close 1855 < ST 1862 → EXIT

Exit: Sell INFY CE @ ₹210
Exit Reason: LONG_SUPERTREND_BREAK
P&L: +₹30 per share (16.7% gain)
```

**SHORT Trade on RELIANCE**:

```
10:15:00 - Entry: Buy RELIANCE PE @ ₹120
           Stock: 2420, Supertrend: 2435, BB Mid: 2430

10:20:00 - Candle close 2415 < MIN(2432, 2428)=2428 → HOLD
10:25:00 - Candle close 2405 < MIN(2428, 2425)=2425 → HOLD
10:30:00 - Candle close 2395 < MIN(2420, 2418)=2418 → HOLD
10:35:00 - Candle close 2410 < MIN(2415, 2410)=2410 → HOLD
10:40:00 - Candle close 2418 > MIN(2412, 2408)=2408 → EXIT

Exit: Sell RELIANCE PE @ ₹155
Exit Reason: SHORT_SUPERTREND_BB_BREAK
P&L: +₹35 per share (29.2% gain)
```

---

## Comparison: Old vs New Framework

| Aspect          | Old (Deprecated)                          | New (Current)            |
| --------------- | ----------------------------------------- | ------------------------ |
| LONG Exit       | 12% trailing SL + entry candle low        | Supertrend break         |
| SHORT Exit      | Time-decay trailing (12%→5%) + entry high | MIN(ST, BB Mid) break    |
| Check Frequency | 1-second real-time polling                | 5-minute candle close    |
| Stagnation Rule | 10-min no-high → 9% cap                   | Not used                 |
| Checkpoints     | T+15 (₹5), T+20 (₹10)                     | Not used                 |
| Complexity      | High (multiple rules)                     | Simple (indicator-based) |

---

## Performance Metrics

| Metric         | Target    | Notes                         |
| -------------- | --------- | ----------------------------- |
| Win Rate       | 55-65%    | Trend-following, not scalping |
| Avg Hold Time  | 15-45 min | 3-9 candles typical           |
| Profit Capture | 60-80%    | Supertrend trails well        |
| Max Drawdown   | -5%       | Emergency stop protection     |

---

**Framework Status**: Production-Ready  
**Last Updated**: February 13, 2026  
**Applies To**: Bollinger Band stock option strategies  
**Version Note**: Added Layer 4 (RSI-Activated Live Premium Trailing Stop) and RSI calculation convergence fix (full-history Wilder's RMA)
