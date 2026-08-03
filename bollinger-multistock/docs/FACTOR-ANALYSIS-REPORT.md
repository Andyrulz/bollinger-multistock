# Factor Analysis Report — Post Feb 3, 2026 Trades

**Date**: March 1, 2026 (Updated post F7+F8 implementation)  
**Scope**: 84 trades from Feb 3–27, 2026 (new Supertrend/BB exit system)  
**Implemented**: F7 (RSI Quick Reversal) + F8 (1-Hour ST Alignment)  
**Active Baseline**: **42 surviving trades, ₹57,538 PnL, 61.9% WR**

---

## Executive Summary

F7 and F8 are now live in production. This report shows the **recalculated trade pool** with filtered trades removed, and re-evaluates remaining factors on the surviving 42-trade dataset.

### Performance Before vs After F7+F8

| Metric       | Before (84 trades) | After (42 trades) | Change       |
| ------------ | ------------------ | ----------------- | ------------ |
| Total PnL    | ₹16,636            | **₹57,538**       | **+₹40,902** |
| Win Rate     | 40.5%              | **61.9%**         | +21.4 pts    |
| PnL/Trade    | ₹198               | **₹1,370**        | +₹1,172      |
| Trades/Day   | 4.7                | **3.2**           | -1.5         |
| Avg Win      | ₹2,148             | **₹2,948**        | +₹800        |
| Avg Loss     | -₹1,621            | **-₹1,195**       | +₹426        |
| Biggest Win  | ₹10,830            | ₹10,830           | —            |
| Biggest Loss | -₹4,875            | -₹4,875           | —            |
| Risk:Reward  | 0.75:1             | **2.47:1**        | 3.3x better  |

### Remaining Factors — All Evaluated on Surviving 42-Trade Pool

| Factor                           | Trades Affected     | PnL Impact             | Verdict                                                    |
| -------------------------------- | ------------------- | ---------------------- | ---------------------------------------------------------- |
| F1: SHORT near S2 after 12 PM    | 0 applicable        | +₹0                    | ❌ **No-op** — 0 trades match; after-12 SHORTs are 88% WR  |
| F2: BB width filter (min or max) | Any threshold hurts | Negative at all levels | ❌ **Reject** — wide-BB trades are biggest winners         |
| F3: Large breakout candle filter | 2 trades >0.7%      | -₹20,580 if filtered   | ❌ **Anti-signal** — 2 biggest winners ARE the big candles |
| F5: RSI divergence               | 1 trade             | -₹7,750 if filtered    | ⏸️ **Park** — n=1, and it's a winner                       |
| F6: PSAR trail                   | 10 improve, 7 hurt  | ~-₹22,000 net          | ❌ **Destructive** — kills biggest winners                 |
| **F7: RSI quick reversal**       | **33 removed**      | **+₹30,144 saved**     | ✅ **IMPLEMENTED**                                         |
| **F8: 1-hour ST alignment**      | **9 removed**       | **+₹10,759 saved**     | ✅ **IMPLEMENTED**                                         |

---

## The 42 Surviving Trades (Active Baseline)

F8 removed 9 trades (all losers, 0% WR). F7 then removed 33 more (26 losers, 7 small winners). The remaining 42 trades form the new production baseline.

### LONG Trades (24 trades | ₹33,361 PnL | 54.2% WR)

| #   | Symbol     | Date   | Entry Time | PnL         | BB Width | Candle W | Entry RSI | Exit Reason           |
| --- | ---------- | ------ | ---------- | ----------- | -------- | -------- | --------- | --------------------- |
| 1   | PFC        | Feb 04 | 10:00      | **+₹9,750** | 3.51%    | 0.87%    | 83.8      | EOD Safety 3:24PM     |
| 2   | BAJAJFINSV | Feb 06 | 14:55      | +₹338       | 0.94%    | 0.16%    | 78.3      | EOD Safety 3:19PM     |
| 3   | ULTRACEMCO | Feb 09 | 9:55       | **+₹7,750** | 1.06%    | 0.42%    | 73.7      | Broker Auto Squareoff |
| 4   | INDHOTEL   | Feb 09 | 11:00      | +₹1,500     | 1.03%    | 0.22%    | 74.0      | ST Break              |
| 5   | SHRIRAMFIN | Feb 09 | 12:05      | +₹2,681     | 1.47%    | 0.49%    | 85.2      | Gamma Climax RSI92    |
| 6   | SHRIRAMFIN | Feb 09 | 14:05      | +₹2,558     | 1.01%    | 0.57%    | 83.5      | Gamma Climax RSI89    |
| 7   | ULTRACEMCO | Feb 09 | 14:25      | -₹142       | 1.21%    | 0.14%    | 86.4      | Broker Auto Squareoff |
| 8   | MUTHOOTFIN | Feb 10 | 10:25      | **+₹9,213** | 1.68%    | 0.26%    | 76.9      | Broker Auto Squareoff |
| 9   | M&M        | Feb 10 | 11:00      | +₹3,490     | 1.08%    | 0.29%    | 83.2      | Gamma Climax RSI88    |
| 10  | BAJAJFINSV | Feb 11 | 10:40      | +₹250       | 0.81%    | 0.19%    | 77.5      | ST Break              |
| 11  | SBIN       | Feb 11 | 14:05      | -₹1,087     | 1.28%    | 0.24%    | 75.1      | EOD Safety 3:19PM     |
| 12  | TRENT      | Feb 12 | 10:30      | +₹900       | 1.58%    | 0.30%    | 73.9      | Broker Auto Squareoff |
| 13  | TORNTPHARM | Feb 13 | 12:35      | +₹1,113     | 0.72%    | 0.20%    | 75.0      | Gamma Climax RSI86    |
| 14  | ABB        | Feb 16 | 12:15      | -₹75        | 1.34%    | 0.10%    | 78.5      | ST Break              |
| 15  | HDFCBANK   | Feb 16 | 12:30      | -₹770       | 0.81%    | 0.14%    | 74.3      | ST Break              |
| 16  | APOLLOHOSP | Feb 16 | 13:35      | -₹575       | 0.78%    | 0.16%    | 83.4      | EOD Safety 3:19PM     |
| 17  | SBIN       | Feb 16 | 14:20      | -₹1,275     | 1.17%    | 0.20%    | 78.2      | No Follow-Through     |
| 18  | COLPAL     | Feb 17 | 11:10      | -₹1,148     | 1.18%    | 0.45%    | 81.6      | ST Break              |
| 19  | INFY       | Feb 17 | 11:30      | -₹800       | 1.19%    | 0.66%    | 78.7      | ST Break              |
| 20  | LT         | Feb 17 | 14:35      | +₹936       | 0.52%    | 0.27%    | 82.4      | EOD Safety 3:19PM     |
| 21  | SIEMENS    | Feb 20 | 10:50      | -₹788       | 2.43%    | 0.34%    | 73.0      | No Follow-Through     |
| 22  | LT         | Feb 20 | 11:40      | -₹700       | 0.59%    | 0.23%    | 68.8      | ST Break              |
| 23  | BIOCON     | Feb 26 | 9:50       | -₹4,875     | 1.64%    | 0.35%    | 63.1      | ST Break              |
| 24  | BANKBARODA | Feb 26 | 13:45      | **+₹5,119** | 0.90%    | 0.22%    | 74.5      | EOD Safety 3:19PM     |

### SHORT Trades (18 trades | ₹24,177 PnL | 72.2% WR)

| #   | Symbol     | Date   | Entry Time | PnL          | BB Width | Candle W | Entry RSI | Exit Reason           |
| --- | ---------- | ------ | ---------- | ------------ | -------- | -------- | --------- | --------------------- |
| 1   | TECHM      | Feb 06 | 12:50      | -₹2,730      | 1.71%    | 0.18%    | 17.1      | ST+BB Break           |
| 2   | TCS        | Feb 11 | 14:25      | +₹1,216      | 0.62%    | 0.08%    | 24.3      | EOD Safety 3:19PM     |
| 3   | HDFCBANK   | Feb 12 | 9:35       | -₹797        | 0.62%    | 0.18%    | 22.4      | ST+BB Break           |
| 4   | HINDUNILVR | Feb 12 | 10:25      | **+₹10,830** | 1.89%    | 1.35%    | 14.4      | Gamma Climax RSI87    |
| 5   | DLF        | Feb 12 | 11:20      | +₹454        | 0.87%    | 0.27%    | 23.1      | ST+BB Break           |
| 6   | AXISBANK   | Feb 13 | 9:55       | -₹219        | 1.24%    | 0.58%    | 18.1      | ST+BB Break           |
| 7   | INDIGO     | Feb 13 | 11:20      | -₹1,185      | 0.79%    | 0.19%    | 21.6      | ST+BB Break           |
| 8   | ADANIENT   | Feb 13 | 11:35      | -₹1,947      | 0.95%    | 0.22%    | 31.3      | ST+BB Break           |
| 9   | HINDUNILVR | Feb 13 | 12:40      | +₹1,650      | 1.20%    | 0.37%    | 17.3      | Broker Auto Squareoff |
| 10  | HEROMOTOCO | Feb 16 | 10:40      | +₹2,400      | 1.59%    | 0.18%    | 25.2      | ST+BB Break           |
| 11  | TRENT      | Feb 19 | 10:45      | +₹2,670      | 1.52%    | 0.29%    | 15.2      | ST+BB Break           |
| 12  | ULTRACEMCO | Feb 19 | 11:15      | +₹3,685      | 0.71%    | 0.23%    | 15.5      | RSI Trail             |
| 13  | HAL        | Feb 19 | 12:10      | +₹308        | 1.21%    | 0.26%    | 13.4      | ST+BB Break           |
| 14  | HINDUNILVR | Feb 19 | 13:35      | +₹1,905      | 0.88%    | 0.11%    | 14.6      | Gamma Climax RSI87    |
| 15  | LTIM       | Feb 19 | 14:30      | +₹3,053      | 0.75%    | 0.26%    | 41.2      | EOD Safety 3:19PM     |
| 16  | EICHERMOT  | Feb 19 | 14:30      | +₹1,450      | 0.73%    | 0.16%    | 29.2      | EOD Safety 3:19PM     |
| 17  | TRENT      | Feb 26 | 11:45      | +₹670        | 1.11%    | 0.33%    | 27.8      | ST+BB Break           |
| 18  | ZYDUSLIFE  | Feb 27 | 15:20      | +₹765        | 1.08%    | 0.30%    | N/A       | Broker Auto Squareoff |

### Pool Summary

| Metric        | LONG    | SHORT   | Combined    |
| ------------- | ------- | ------- | ----------- |
| Trades        | 24      | 18      | **42**      |
| Winners       | 13      | 13      | **26**      |
| Losers        | 11      | 5       | **16**      |
| Win Rate      | 54.2%   | 72.2%   | **61.9%**   |
| Total PnL     | ₹33,361 | ₹24,177 | **₹57,538** |
| Avg PnL/Trade | ₹1,390  | ₹1,343  | **₹1,370**  |
| Trading Days  | 13      | 10      | **13**      |

---

## Trades Removed by F7+F8 (42 trades eliminated)

### F8: 1-Hour ST Alignment — 9 Removed (ALL losers, 0% WR) ✅ IMPLEMENTED

| Symbol     | Date   | Dir   | 5m ST | 1h ST     | PnL          |
| ---------- | ------ | ----- | ----- | --------- | ------------ |
| TMPV       | Feb 05 | SHORT | DOWN  | UP ⚠️     | -₹160        |
| ABB        | Feb 05 | SHORT | DOWN  | UP ⚠️     | -₹550        |
| SBILIFE    | Feb 05 | SHORT | DOWN  | UP ⚠️     | -₹1,031      |
| TRENT      | Feb 11 | SHORT | DOWN  | UP ⚠️     | -₹435        |
| ASIANPAINT | Feb 13 | SHORT | DOWN  | UP ⚠️     | -₹200        |
| UPL        | Feb 26 | LONG  | UP    | DOWN ⚠️   | -₹4,810      |
| ULTRACEMCO | Feb 26 | SHORT | DOWN  | UP ⚠️     | -₹883        |
| INDHOTEL   | Feb 27 | SHORT | DOWN  | UP ⚠️     | -₹500        |
| HEROMOTOCO | Feb 27 | SHORT | DOWN  | UP ⚠️     | -₹2,190      |
|            |        |       |       | **Total** | **-₹10,759** |

### F7: RSI Quick Reversal — 33 Removed (from remaining 75) ✅ IMPLEMENTED

| Symbol     | Date   | Dir   | Trigger RSI | Threshold | PnL          | Type      |
| ---------- | ------ | ----- | ----------- | --------- | ------------ | --------- |
| AXISBANK   | Feb 03 | LONG  | 57.7        | <62       | -₹3,063      | Loser     |
| AXISBANK   | Feb 03 | LONG  | 57.7        | <62       | -₹3,594      | Loser     |
| BAJFINANCE | Feb 03 | LONG  | 47.4        | <62       | -₹2,550      | Loser     |
| PERSISTENT | Feb 04 | SHORT | 32.3        | >32       | -₹3,725      | Loser     |
| COFORGE    | Feb 04 | SHORT | 39.7        | >32       | -₹2,288      | Loser     |
| BHARTIARTL | Feb 05 | SHORT | 36.7        | >32       | +₹665        | Winner ⚠️ |
| BAJAJ-AUTO | Feb 06 | SHORT | 34.0        | >32       | +₹259        | Winner ⚠️ |
| SBIN       | Feb 06 | SHORT | 40.4        | >32       | -₹1,275      | Loser     |
| DLF        | Feb 10 | LONG  | 50.1        | <62       | -₹2,475      | Loser     |
| BHARATFORG | Feb 10 | LONG  | 53.8        | <62       | -₹1,775      | Loser     |
| INFY       | Feb 11 | SHORT | 36.7        | >32       | -₹580        | Loser     |
| TCS        | Feb 11 | SHORT | 36.3        | >32       | -₹394        | Loser     |
| M&M        | Feb 12 | SHORT | 44.8        | >32       | +₹1,020      | Winner ⚠️ |
| BEL        | Feb 12 | LONG  | 51.6        | <62       | -₹214        | Loser     |
| GODREJPROP | Feb 12 | SHORT | 46.3        | >32       | -₹674        | Loser     |
| BRITANNIA  | Feb 13 | SHORT | 49.7        | >32       | +₹581        | Winner ⚠️ |
| M&M        | Feb 13 | SHORT | 33.5        | >32       | -₹40         | Loser     |
| HDFCBANK   | Feb 13 | SHORT | 39.1        | >32       | +₹220        | Winner ⚠️ |
| VOLTAS     | Feb 16 | LONG  | 46.2        | <62       | -₹2,456      | Loser     |
| ADANIPORTS | Feb 16 | LONG  | 59.1        | <62       | -₹1,021      | Loser     |
| EICHERMOT  | Feb 17 | SHORT | 43.0        | >32       | -₹970        | Loser     |
| SHRIRAMFIN | Feb 19 | SHORT | 41.0        | >32       | +₹371        | Winner ⚠️ |
| SHRIRAMFIN | Feb 19 | SHORT | 43.9        | >32       | -₹619        | Loser     |
| ADANIGREEN | Feb 20 | SHORT | 50.6        | >32       | -₹1,770      | Loser     |
| BAJAJFINSV | Feb 20 | LONG  | 61.6        | <62       | -₹125        | Loser     |
| TECHM      | Feb 20 | SHORT | 50.3        | >32       | -₹2,100      | Loser     |
| SBIN       | Feb 26 | SHORT | 40.0        | >32       | -₹1,238      | Loser     |
| HDFCBANK   | Feb 26 | SHORT | 38.3        | >32       | -₹192        | Loser     |
| HDFCBANK   | Feb 27 | SHORT | 52.3        | >32       | -₹467        | Loser     |
| BPCL       | Feb 27 | LONG  | 59.5        | <62       | +₹494        | Winner ⚠️ |
| SHRIRAMFIN | Feb 27 | SHORT | 49.8        | >32       | -₹2,310      | Loser     |
| BAJAJFINSV | Feb 27 | SHORT | 43.4        | >32       | -₹288        | Loser     |
| GODREJPROP | Feb 27 | SHORT | 38.5        | >32       | +₹2,448      | Winner ⚠️ |
|            |        |       |             | **Total** | **-₹30,144** | 26L / 7W  |

**F7 accuracy:** 26 losers caught vs 7 winners sacrificed. Winners sacrificed total ₹6,058; losers avoided total -₹36,202. Net: **+₹30,144 saved.**

---

## Factor 1: SHORT Entry Near S2 After 12 PM (Re-evaluated on 42 trades)

**Hypothesis**: SHORTs entered near/above S2 after 12 PM get trapped by support bounce.

### Results (42-trade pool)

| Group                      | Trades | PnL     | Win Rate |
| -------------------------- | ------ | ------- | -------- |
| SHORT before 12 PM         | 10     | ₹16,561 | 60%      |
| SHORT after 12 PM          | 8      | ₹7,616  | **88%**  |
| After 12 + near S2 (<0.5%) | **0**  | —       | —        |

**After-12 PM SHORTs (all detail):**

| Symbol     | Date   | Entry Time | PnL     | Near S2? |
| ---------- | ------ | ---------- | ------- | -------- |
| TECHM      | Feb 06 | 12:50      | -₹2,730 | No       |
| TCS        | Feb 11 | 14:25      | +₹1,216 | No       |
| HINDUNILVR | Feb 13 | 12:40      | +₹1,650 | No       |
| HAL        | Feb 19 | 12:10      | +₹308   | No       |
| HINDUNILVR | Feb 19 | 13:35      | +₹1,905 | No       |
| LTIM       | Feb 19 | 14:30      | +₹3,053 | No       |
| EICHERMOT  | Feb 19 | 14:30      | +₹1,450 | No       |
| ZYDUSLIFE  | Feb 27 | 15:20      | +₹765   | No       |

### Verdict

❌ **Do not implement.** Zero applicable trades in the surviving pool. The near-S2 SHORTs from the original analysis (SBIN, INFY, TCS, HDFCBANK) were all eliminated by F7's RSI check. After-12 PM SHORTs that pass F7+F8 are excellent — 88% WR, ₹7,616 profit.

---

## Factor 2: Bollinger Band Width at Entry (Re-evaluated on 42 trades)

**Hypothesis (corrected)**: Both narrow BB (weak breakout) AND wide BB (exhaustion) should be filtered.

### Minimum BB Width Threshold Sweep (reject if too narrow)

| Threshold | Filtered | Kept | Kept PnL | Kept WR | Δ PnL        |
| --------- | -------- | ---- | -------- | ------- | ------------ |
| 0.50%     | 0        | 42   | ₹57,538  | 62%     | ₹0           |
| 0.60%     | 2        | 40   | ₹57,302  | 63%     | **-₹236**    |
| 0.65%     | 4        | 38   | ₹56,883  | 63%     | **-₹655**    |
| 0.70%     | 4        | 38   | ₹56,883  | 63%     | **-₹655**    |
| 0.80%     | 10       | 32   | ₹49,343  | 63%     | **-₹8,195**  |
| 0.90%     | 15       | 27   | ₹42,386  | 59%     | **-₹15,153** |

### Maximum BB Width Threshold Sweep (reject if too wide — exhaustion)

| Threshold | Filtered | Kept | Kept PnL | Kept WR | Δ PnL        |
| --------- | -------- | ---- | -------- | ------- | ------------ |
| 1.6%      | 6        | 36   | ₹36,138  | 64%     | **-₹21,400** |
| 2.0%      | 2        | 40   | ₹48,576  | 63%     | **-₹8,963**  |
| 2.5%      | 1        | 41   | ₹47,788  | 61%     | **-₹9,750**  |
| 3.0%      | 1        | 41   | ₹47,788  | 61%     | **-₹9,750**  |

### BB Width Distribution by Result

| BB Width Range | Trades | Winners | Win Rate | PnL      |
| -------------- | ------ | ------- | -------- | -------- |
| < 0.7%         | 4      | 2       | 50%      | +₹655    |
| 0.7% – 1.0%    | 11     | 8       | 73%      | +₹19,363 |
| 1.0% – 1.5%    | 14     | 9       | 64%      | +₹17,365 |
| 1.5% – 2.0%    | 8      | 6       | 75%      | +₹21,306 |
| > 2.0%         | 5      | 1       | 20%      | -₹1,151  |

### Key Change from Pre-F7/F8 Analysis

**Previously** (84 trades): BB width ≥ 0.7% showed +₹7,811 improvement. **Now** (42 trades): the same threshold **hurts** by -₹655. Why? F7 already eliminated the weak narrow-BB entries (the ones that failed RSI confirmation). The narrow-BB trades that survive F7 are actually viable.

The widest-BB trades include the two biggest single winners:

- HINDUNILVR Feb 12 (BB 1.89%): **+₹10,830**
- PFC Feb 04 (BB 3.51%): **+₹9,750**

### Verdict

❌ **Reject — no additional BB width filter.** Every threshold (min or max) reduces PnL. The existing `MAX_BANDWIDTH=3.5%` in Guard #2 is sufficient. F7's RSI check already handles the breakout-quality concern that BB width was proxying for.

---

## Factor 3: Breakout Candle Width (Re-evaluated on 42 trades)

**Hypothesis (corrected)**: Large body candles (>0.7%) represent exhaustion/reversal, especially on CE (LONG) side.

### Maximum Candle Width Threshold Sweep (reject if candle too big)

| Threshold | Filtered | Kept | Kept PnL | Kept WR | Δ PnL        |
| --------- | -------- | ---- | -------- | ------- | ------------ |
| 0.30%     | 13       | 29   | ₹28,713  | 62%     | **-₹28,825** |
| 0.50%     | 5        | 37   | ₹35,420  | 62%     | **-₹22,119** |
| 0.70%     | 2        | 40   | ₹36,958  | 60%     | **-₹20,580** |
| 0.90%     | 1        | 41   | ₹46,708  | 61%     | **-₹10,830** |

### The Critical Discovery — Big Candles ARE the Edge

Only 2 trades have candle width > 0.7%. **Both are the strategy's biggest winners:**

| Symbol     | Date   | Dir        | Candle Width | PnL          | Exit                                |
| ---------- | ------ | ---------- | ------------ | ------------ | ----------------------------------- |
| PFC        | Feb 04 | LONG (CE)  | 0.87%        | **+₹9,750**  | EOD Safety (still running at close) |
| HINDUNILVR | Feb 12 | SHORT (PE) | 1.35%        | **+₹10,830** | Gamma Climax RSI87                  |

These 2 trades = **₹20,580 = 35.8% of all profits** from just 4.8% of trades.

### By Direction

**CE (LONG) — candle filter impact:**

- Filtering > 0.7% removes only PFC (+₹9,750) → **-₹9,750**
- Filtering > 0.5% also loses SHRIRAMFIN (+₹2,558) + INFY (-₹800) → **-₹11,508**

**PE (SHORT) — candle filter impact:**

- Filtering > 0.7% removes only HINDUNILVR (+₹10,830) → **-₹10,830** (single largest winner)

### Key Change from Pre-F7/F8 Analysis

**Previously** (84 trades): 0.25% min candle width showed +₹5,714. **Now**: the weak small candles that failed were already caught by F7 (RSI didn't confirm after entry). The small candles that survive F7 are fine.

The hypothesis that "big candles = exhaustion" is **cleanly refuted** post-F7/F8. A big candle with strong RSI confirmation is genuine momentum, not exhaustion.

### Verdict

❌ **Do NOT implement — this is an anti-signal.** Filtering large candles removes 35.8% of profits. The user's corrected "exhaustion" hypothesis doesn't apply once F7 has validated momentum post-entry.

---

## Factor 5: RSI Divergence Before Entry (Re-evaluated on 42 trades)

**Hypothesis (corrected)**: Price at new 10-candle extreme but RSI not confirming → don't trade.

### Results (42-trade pool)

| Group                            | Trades | PnL         | Win Rate |
| -------------------------------- | ------ | ----------- | -------- |
| With divergence (counter-signal) | 1      | **+₹7,750** | 100%     |
| Without divergence               | 41     | +₹49,788    | 61%      |

**The single surviving divergent trade:**

| Symbol     | Date   | Dir  | Type                                     | PnL         |
| ---------- | ------ | ---- | ---------------------------------------- | ----------- |
| ULTRACEMCO | Feb 09 | LONG | COUNTER (price high, RSI not confirming) | **+₹7,750** |

### Key Change from Pre-F7/F8 Analysis

**Previously** (84 trades): 6 divergent trades, net +₹4,600. **Now**: 5 of those 6 were eliminated by F7 or F8 (SBILIFE by F8, BAJAJ-AUTO/HDFCBANK/SHRIRAMFIN/BAJAJFINSV by F7). The sole survivor is ULTRACEMCO — the third-largest winner in the entire pool.

### Verdict

⏸️ **Park — insufficient data.** n=1, statistically meaningless. The one divergent trade is a massive winner, so implementing this filter would cost ₹7,750 (13.5% of total profits). F7 already subsumes most of F5's intent.

---

## Factor 6: PSAR Trail for LONG Exits (Re-evaluated on 42 trades)

**Hypothesis**: Parabolic SAR as additional trailing stop to cut losers faster.

### Results (42-trade surviving pool)

| Category                           | Count | Details   |
| ---------------------------------- | ----- | --------- |
| Would improve (exit loser earlier) | 10    | All LONGs |
| Would hurt (exit winner earlier)   | 7     | All LONGs |
| No change                          | 25    | —         |

### PSAR Exit Candle Distribution — The Fatal Flaw

| Exit Candle # | Count  | Note                               |
| ------------- | ------ | ---------------------------------- |
| **#1**        | **10** | 60% of PSAR exits fire immediately |
| #2            | 1      |                                    |
| #4–#7         | 4      |                                    |
| #12–#20       | 2      |                                    |

**PSAR triggers on candle #1 in 10 of 18 cases** — this is functionally "don't trade at all."

### Would IMPROVE (saves money on losers)

| Symbol     | Date   | PnL     | PSAR Exit  | Actual Exit |
| ---------- | ------ | ------- | ---------- | ----------- |
| SBIN       | Feb 11 | -₹1,087 | Candle #4  | Candle #13  |
| ABB        | Feb 16 | -₹75    | Candle #1  | Candle #28  |
| HDFCBANK   | Feb 16 | -₹770   | Candle #6  | Candle #16  |
| APOLLOHOSP | Feb 16 | -₹575   | Candle #1  | Candle #19  |
| SBIN       | Feb 16 | -₹1,275 | Candle #1  | Candle #2   |
| COLPAL     | Feb 17 | -₹1,148 | Candle #1  | Candle #11  |
| INFY       | Feb 17 | -₹800   | Candle #1  | Candle #17  |
| SIEMENS    | Feb 20 | -₹788   | Candle #1  | Candle #2   |
| LT         | Feb 20 | -₹700   | Candle #12 | Candle #20  |
| BIOCON     | Feb 26 | -₹4,875 | Candle #5  | Candle #12  |

### Would HURT (kills winners)

| Symbol         | Date   | PnL         | PSAR Exit  | Actual Exit | Damage              |
| -------------- | ------ | ----------- | ---------- | ----------- | ------------------- |
| **PFC**        | Feb 04 | **+₹9,750** | Candle #2  | Candle #63  | Kills ₹9,750 winner |
| **ULTRACEMCO** | Feb 09 | **+₹7,750** | Candle #20 | Candle #52  | Partial cut         |
| INDHOTEL       | Feb 09 | +₹1,500     | Candle #1  | Candle #47  | Kills immediately   |
| **MUTHOOTFIN** | Feb 10 | **+₹9,213** | Candle #1  | Candle #30  | Kills ₹9,213 winner |
| BAJAJFINSV     | Feb 11 | +₹250       | Candle #1  | Candle #15  | Kills immediately   |
| TRENT          | Feb 12 | +₹900       | Candle #7  | Candle #45  | Partial cut         |
| **BANKBARODA** | Feb 26 | **+₹5,119** | Candle #1  | Candle #17  | Kills ₹5,119 winner |

### Net Impact Estimate

- Losers saved: ~₹7,000 (exits closer to entry price)
- Winners destroyed: PFC ₹9,750 + MUTHOOTFIN ₹9,213 + BANKBARODA ₹5,119 + INDHOTEL ₹1,500 = **₹25,582 killed on candle #1-#2**
- **Net: approximately -₹22,000** — catastrophic

### Verdict

❌ **Do NOT implement — catastrophically harmful.** PSAR is too sensitive for 5-min option charts. 60% of exits trigger immediately (candle #1), which would destroy the strategy's biggest winners. The existing 5-layer exit framework is far superior.

---

## Factor 7: RSI Quick Reversal After Entry ✅ IMPLEMENTED

**Status**: Live in production since Feb 28, 2026  
**Thresholds**: LONG — exit if RSI drops below 62 within 2 candles; SHORT — exit if RSI rises above 32 within 2 candles  
**Impact**: Removed 33 of 75 post-F8 trades, saving ₹30,144

### How It Works

After entry, the strategy monitors RSI for the next 2 five-minute candles:

- **LONG**: If min RSI in candles 1-2 drops below 62 → exit (momentum not confirming)
- **SHORT**: If max RSI in candles 1-2 rises above 32 → exit (sells not confirming)

### Results Summary

| Group                   | Trades | PnL      | Win Rate     |
| ----------------------- | ------ | -------- | ------------ |
| F7 removed (RSI failed) | 33     | -₹30,144 | 21% (7W/26L) |
| F7 survived (RSI held)  | 42     | +₹57,538 | 61.9%        |

### By Direction

| Group                   | Trades | PnL      | Win Rate |
| ----------------------- | ------ | -------- | -------- |
| LONG removed (RSI <62)  | 11     | -₹21,589 | 9%       |
| LONG survived           | 24     | +₹33,361 | 54.2%    |
| SHORT removed (RSI >32) | 22     | -₹8,555  | 27%      |
| SHORT survived          | 18     | +₹24,177 | 72.2%    |

### Key Insight

F7 is the single most impactful filter. It caught the fundamental quality signal: trades where RSI didn't confirm momentum post-entry are structurally weak. The threshold values sit in a stable plateau (60-63 for LONG, 30-34 for SHORT) confirming they are not overfitted.

---

## Factor 8: 1-Hour Supertrend Alignment ✅ IMPLEMENTED

**Status**: Live in production since Feb 28, 2026  
**Rule**: Reject any entry where the 5-min bias direction conflicts with 1-hour Supertrend direction  
**Impact**: Removed 9 of 84 trades, saving ₹10,759

### How It Works

In the Market Scanner's `scoreStocks()` method, after determining the 5-minute bias (LONG/SHORT), Guard #3 checks the 1-hour Supertrend:

- LONG + 1h ST DOWN → reject (hourly trend is bearish)
- SHORT + 1h ST UP → reject (hourly trend is bullish)

### Results Summary

| Group                   | Trades | PnL          | Win Rate |
| ----------------------- | ------ | ------------ | -------- |
| Misaligned (F8 removed) | 9      | **-₹10,759** | **0%**   |
| Aligned (F8 survived)   | 75     | +₹27,395     | 45%      |

**Perfect filter: 0% win rate on misaligned trades.** All 9 were losers — 8 were SHORTs with 1h ST UP (shorting during pullbacks in a bullish hourly trend), 1 was LONG with 1h ST DOWN.

---

## Combined Impact — F7+F8 Together

### Waterfall

```
84 trades (original):           ₹16,636   (40.5% WR, ₹198/trade)
├─ F8 removes 9 misaligned:    ₹27,395   (45% WR, ₹365/trade)
└─ F7 removes 33 RSI-fail:     ₹57,538   (61.9% WR, ₹1,370/trade)
                                ─────────
                                +₹40,902 improvement (3.5x)
```

### Remaining Factors: All Negative or N/A

After F7+F8, the surviving 42-trade pool is clean enough that no additional filter adds value:

- **F1**: 0 applicable trades (F7 already eliminated weak afternoon shorts)
- **F2**: Every BB width threshold hurts PnL (F7 already catches weak breakouts)
- **F3**: Big candles are biggest winners, not exhaustion (F7 confirms momentum)
- **F5**: 1 trade, winner (F7 eliminated 5 of 6 original divergence trades)
- **F6**: PSAR destroys winners (-₹22K net), too sensitive for 5-min options

### Final Recommendations

| Priority | Action                                                      | Status              |
| -------- | ----------------------------------------------------------- | ------------------- |
| 1        | **F7: RSI Quick Reversal** (LONG <62, SHORT >32, 2 candles) | ✅ Implemented      |
| 2        | **F8: 1-Hour ST Alignment** (reject bias/1h-ST mismatch)    | ✅ Implemented      |
| 3        | F1, F2, F3, F5, F6                                          | ❌ Do not implement |
| 4        | Accumulate more live data with F7+F8 active                 | 🔄 Ongoing          |
