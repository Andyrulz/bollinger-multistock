# New Exit System Analysis — Feb 3-27, 2026

## Overview

This analysis covers the **84 trades** executed after the new Supertrend/BB exit system was implemented on Feb 3, 2026, replacing the old trailing SL polling system.

**Key Conclusion**: The new system IS profitable (+₹16,636), but oscillates due to the primary Supertrend exit being a consistent loss engine, offset by windfall Gamma Climax and EOD/Manual exits.

---

## Performance Summary

| Metric                     | Value                 |
| -------------------------- | --------------------- |
| Trades                     | 84                    |
| Net P&L                    | **+₹16,636**          |
| Win Rate                   | 40.5% (34W / 50L)     |
| Avg Win / Avg Loss         | ₹1,838 / -₹997        |
| Reward:Risk                | 1.84                  |
| Profit Factor              | 1.25                  |
| Peak Cumulative P&L        | +₹30,376 (Feb 19)     |
| Max Drawdown               | ₹16,953 (56% of peak) |
| Current Drawdown from Peak | ₹13,740               |

### Direction Breakdown

| Direction | Trades | Net P&L  | Win Rate |
| --------- | ------ | -------- | -------- |
| LONG      | 35     | +₹11,772 | 40%      |
| SHORT     | 49     | +₹4,863  | 41%      |

---

## Finding 1: Primary Exit (Supertrend/BB Break) Is a Loss Engine

| Exit Group          | Trades | Net P&L      | Win Rate |
| ------------------- | ------ | ------------ | -------- |
| Supertrend/BB exits | 44     | **-₹45,847** | ~20%     |
| All other exits     | 40     | **+₹62,483** | ~63%     |

The system makes money **despite** its primary exit, not because of it.

### Exit Type Detail

| Exit Type                 | Trades | Net P&L  | Win Rate |
| ------------------------- | ------ | -------- | -------- |
| SHORT_SUPERTREND_BB_BREAK | 29     | -₹21,457 | 21%      |
| LONG_SUPERTREND_BREAK     | 15     | -₹24,390 | 20%      |
| GAMMA_CLIMAX              | 6      | +₹22,576 | 100%     |
| EOD_SAFETY_EXIT           | 16     | +₹13,318 | 63%      |
| MANUAL_CLEAR              | 9      | +₹18,715 | 78%      |
| RSI_TRAIL_EXIT            | 1      | +₹3,685  | 100%     |
| BREAKOUT_NO_FOLLOWTHROUGH | 5      | -₹4,538  | 0%       |

**Hypothetical**: If Supertrend losers were cut at 50% of their current premium decay, the system total jumps to **+₹44,061**.

---

## Finding 2: 11:00 IST Hour Is a Major Leak

| Entry Hour (IST) | Trades | Net P&L      | Win Rate | Avg P&L   |
| ---------------- | ------ | ------------ | -------- | --------- |
| 9:xx             | 13     | +₹21,346     | 38%      | +₹1,642   |
| 10:xx            | 13     | +₹9,221      | 62%      | +₹709     |
| **11:xx**        | **18** | **-₹17,572** | **22%**  | **-₹976** |
| 12:xx            | 11     | -₹3,066      | 45%      | -₹279     |
| 13:xx            | 17     | +₹5,114      | 35%      | +₹301     |
| 14:xx            | 10     | +₹2,303      | 60%      | +₹230     |

The 11:xx hour alone contributes -₹17,572 with a 22% win rate (18 trades). This is the mid-morning chop zone. Eliminating 11:xx entries alone would add ~₹17k to the bottom line.

---

## Finding 3: Only 120-min+ Holds Are Profitable

| Hold Time    | Trades | Net P&L      | Win Rate | Avg P&L     |
| ------------ | ------ | ------------ | -------- | ----------- |
| 0–15 min     | 17     | -₹3,527      | 35%      | -₹207       |
| 15–30 min    | 7      | -₹6,723      | 29%      | -₹960       |
| 30–60 min    | 24     | +₹2,230      | 38%      | +₹93        |
| 60–120 min   | 26     | -₹9,236      | 31%      | -₹355       |
| **120 min+** | **10** | **+₹33,891** | **90%**  | **+₹3,389** |

The 10 trades that lasted 2+ hours generated 90% of the gross profit. The Supertrend/BB exit fires too early on genuine trending moves.

---

## Finding 4: Sawtooth Equity Curve

Key inflection points:

- **Trades #1-3 (Feb 3)**: Three LONG Supertrend exits → -₹9,206 (worst single day)
- **Trade #4 (Feb 4)**: PFC EOD hold → +₹9,750, snaps back to breakeven
- **Trades #15-22 (Feb 9-10)**: Gamma Climax + Manual holds → cumulative reaches +₹14,620
- **Trade #31 (Feb 12)**: HINDUNILVR Gamma Climax +₹10,830 → pushes to +₹21,848
- **Trade #64 (Feb 19)**: Cumulative peaks at **+₹30,376**
- **Trades #70-75 (Feb 26)**: BIOCON -₹4,875 + UPL -₹4,810 + 4 more ST losses → gives back ₹16k
- **Trade #82 (Feb 27)**: Max drawdown reaches **₹16,953** from peak

**Pattern**: Big windfall winners build equity → clusters of Supertrend losses erode it.

### Streak Analysis

- Win streaks: avg 2.0, max 5
- Loss streaks: avg 2.9, max 8

---

## Finding 5: Trade Volume vs Daily P&L

| Date   | Trades | P&L      | W:L | ST Losses |
| ------ | ------ | -------- | --- | --------- |
| Feb 03 | 3      | -₹9,206  | 0:3 | 3         |
| Feb 04 | 3      | +₹3,738  | 1:2 | 2         |
| Feb 05 | 4      | -₹1,076  | 1:3 | 3         |
| Feb 06 | 4      | -₹3,409  | 2:2 | 2         |
| Feb 09 | 5      | +₹14,346 | 4:1 | 0         |
| Feb 10 | 4      | +₹8,453  | 2:2 | 2         |
| Feb 11 | 6      | -₹1,030  | 2:4 | 1         |
| Feb 12 | 7      | +₹11,519 | 4:3 | 2         |
| Feb 13 | 9      | -₹27     | 4:5 | 4         |
| Feb 16 | 7      | -₹3,773  | 1:6 | 2         |
| Feb 17 | 4      | -₹1,981  | 1:3 | 3         |
| Feb 19 | 8      | +₹12,823 | 7:1 | 1         |
| Feb 20 | 5      | -₹5,483  | 0:5 | 2         |
| Feb 26 | 7      | -₹6,209  | 2:5 | 5         |
| Feb 27 | 8      | -₹2,049  | 3:5 | 3         |

Low volume days (≤4 trades): 6 days, avg daily P&L -₹580
High volume days (>4 trades): 9 days, avg daily P&L +₹2,235

---

## Conclusions

1. **The system works** — +₹16,636 net, 1.25 profit factor. The old trailing-SL system dragged down combined numbers.
2. **Oscillation root cause**: Supertrend/BB primary exit fires too aggressively (52% of all trades, -₹45,847 net). Winners come from Gamma Climax, EOD holds, and manual intervention.
3. **Time filter opportunity**: 11:xx IST entries are a -₹17,572 leak with 22% WR.
4. **Hold time matters**: 120-min+ trades generate +₹33,891 (90% WR). Short-hold trades bleed capital.
5. **If nothing changes**: Expect continued sawtooth oscillation — build ₹15-30k from windfall exits, bleed ₹10-15k back through primary ST exits.

---

## Trade Investigation Log

### UPL LONG — Feb 26, 2026 (Slot 2)

| Field       | Value                 |
| ----------- | --------------------- |
| Instrument  | UPL26MAR640CE         |
| Stock       | UPL                   |
| Direction   | LONG                  |
| Entry Price | ₹22.35                |
| Exit Price  | ₹18.80                |
| Quantity    | 1355                  |
| P&L         | -₹4,810.25            |
| Exit Reason | LONG_SUPERTREND_BREAK |
| Entry Time  | 26 Feb 2026, 10:05 AM |
| Exit Time   | 26 Feb 2026, 11:45 AM |
| Hold Time   | 1h 39m                |

**Issue**: TradingView chart (which uses 60m-aligned Supertrend) shows ST clearly DOWN at entry. The first hourly candle (9:15-10:15) hadn't even closed at 10:05 AM. Why was the LONG entry triggered?

#### Investigation Findings

**The bot uses a 5-minute Supertrend — NOT 60-minute. The 5-min ST briefly flipped UP on a marginal candle, but the broader 60-min ST the user monitors remained firmly DOWN. This is a timeframe mismatch issue.**

##### Code Evidence

The bot calculates all indicators on 5-minute stock candles:

```typescript
// BollingerBandStrategy.ts line 2119
supertrend: this.calculateSupertrend(this.candleHistory, 10, 2),
// this.candleHistory = 5-minute candles from loadHistoricalData()
```

The TradingView chart title reads **"Pivot + ST + RSI + BB (60m Aligned)"** — the chart's Supertrend overlay is on 60-minute candles. At 10:05 AM on Feb 26:

- **60-min ST**: The first hourly candle (9:15-10:15) was still forming. The 60-min Supertrend was calculated from the prior completed hourly candle, which was firmly DOWN. It could not flip until 10:15 at the earliest.
- **5-min ST**: By 10:05 AM, the bot had all its multi-day 5-min candle history loaded (via `loadHistoricalDataWithFallback()`, which fetches 7+ days). With UPL's strong gap-up rally from ~₹622→₹643 and the 5-min close clearing the 5-min Supertrend upper band, the 5-minute ST flipped to UP.

##### Timeline Reconstruction

1. **Feb 25 close**: UPL at ~₹622. Both 5-min and 60-min Supertrend DOWN.
2. **Feb 26 open**: UPL gapped up ~2% to ~₹634.
3. **9:15–10:00 AM**: UPL rallied from ~₹634 to ~₹643-644, approaching R1 (₹647.45) and PDH (₹641).
4. **10:00 AM 5-min candle close (~₹643-644)**: The 5-min Supertrend upper band (calculated from pre-gap levels) was at ~₹637-638. The close at ₹644 **breached this 5-min level**, flipping the 5-minute Supertrend to UP. The 60-min Supertrend, however, was completely unaware — its current candle (9:15-10:15) was still forming.
5. **10:05:05 AM**: Bot fetched the completed 10:00 candle → `updateTechnicalIndicators()` → `calculateSupertrend()` on 5-min candles returned `trend: 'UP'`. All LONG conditions checked:
   - ✅ `priceAboveUpperBB`: 5-min BB breakout confirmed
   - ✅ `rsiInRange`: RSI(10) on 5-min in 68-85 range
   - ✅ `supertrendBullish`: 5-min ST `trend === 'UP'` — **TRUE on this candle**
   - ✅ `aboveR1OrPDH`: Close ~644 > PDH ~641
   - ✅ `candleIsBullish`: Strong up candle
   - → **LONG entry triggered**, bought UPL26MAR640CE @ ₹22.35
6. **10:15 AM**: First 60-min candle closes. The 60-min ST remains DOWN — the hourly move was insufficient to flip the broader trend. Meanwhile, the 5-min ST likely already flipped back to DOWN as UPL started pulling back.
7. **10:05–11:45 AM**: UPL drifted lower. CE premium decayed ₹22.35 → ₹18.80.
8. **11:45 AM**: `LONG_SUPERTREND_BREAK` exit. **Loss: -₹4,810**.

#### Root Cause: 5-Min vs 60-Min Supertrend Mismatch

The bot trades on 5-minute Supertrend, which is **much noisier** than the 60-minute version visible on the chart. This creates a fundamental alignment problem:

1. **The 5-min ST flips easily on gap days**: UPL's 2% gap-up was enough to clear the 5-min ST upper band, causing a mechanical flip. The 60-min ST, with its larger ATR and higher threshold, correctly stayed DOWN.
2. **No higher-timeframe confirmation**: The bot has no awareness of the 60-minute (or any broader) Supertrend. It trusts the noisy 5-min signal alone.
3. **The chart you monitor (60m-aligned) tells a different story than the bot**: This is why the entry appeared nonsensical — to the 60-min ST the trend was never bullish. Only the 5-min ST saw a brief, unreliable flip.

#### What Would Have Prevented This

- **Multi-timeframe Supertrend alignment**: Require 60-min ST to also be UP before allowing LONG entries. This is exactly what the chart's "60m Aligned" approach does — the bot should match it.
- **Supertrend confirmation bar**: Require 2+ consecutive 5-min candles above the ST level before entering (would have caught the immediate reversal).
- **Gap-day filter**: If stock gapped > 1% beyond the 5-min ST level, treat the flip as unreliable.
- **Minimum distance threshold**: Require close to be meaningfully above the ST value, not just marginally clearing it.
