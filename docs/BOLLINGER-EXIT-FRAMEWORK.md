# Bollinger Band Exit Framework

**Supertrend-based exit system for stock option strategies**

---

## Exit Hierarchy (Priority Order)

| Priority | Exit Type               | Trigger                            | Check Frequency      |
| -------- | ----------------------- | ---------------------------------- | -------------------- |
| 1        | **EOD Safety**          | 3:19 PM                            | Once per day         |
| 2        | **Emergency Hard Stop** | Stock moves ±5% from entry         | 30-second polling    |
| 3        | **Gamma Climax**        | Option RSI(14) ≥ 85                | 15-minute boundaries |
| 4        | **Supertrend Break**    | 5-min candle closes past threshold | Every 5-min candle   |

---

## Layer 1: EOD Safety Exit

**Purpose**: Exit before broker's MIS auto-squareoff (3:25 PM) to avoid squareoff charges.

**Trigger**: 3:19 PM daily (6 minutes buffer)

**Exit Reason**: `EOD_SAFETY_EXIT_3:19PM`

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

## Layer 4: Supertrend-Based Exit (Primary)

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
Parallel: 15-min RSI Climax checks
Parallel: EOD timer at 3:19 PM
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

| Tag                         | Meaning                                   |
| --------------------------- | ----------------------------------------- |
| `EOD_SAFETY_EXIT_3:19PM`    | End-of-day forced close                   |
| `EMERGENCY_HARD_STOP`       | Stock moved ±5% (flash crash)             |
| `GAMMA_CLIMAX_RSI{N}`       | Option RSI ≥ 85 (blow-off top)            |
| `LONG_SUPERTREND_BREAK`     | LONG: Price closed below Supertrend       |
| `SHORT_SUPERTREND_BB_BREAK` | SHORT: Price closed above MIN(ST, BB Mid) |
| `MONITORING_RESTART_FAILED` | Position recovery failed                  |
| `MANUAL_CLEAR_*`            | Manual intervention                       |

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

- Candle-based (5-min)
- Emergency polling (30-sec)
- RSI climax (15-min boundaries)
- EOD timer (once per day)

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
**Last Updated**: February 2026  
**Applies To**: Bollinger Band stock option strategies
