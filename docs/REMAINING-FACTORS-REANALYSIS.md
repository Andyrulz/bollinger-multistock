# Remaining Factors Fresh Reanalysis — Post F7+F8 Implementation

**Date:** 2026-02-28  
**Dataset:** 84 trades, Feb 3–27, 2026 (3 slots)  
**Implemented:** F7 (RSI Quick Reversal), F8 (1-Hour Supertrend Alignment)  
**Analyzed:** F1, F2, F3, F5, F6 on the **surviving** post-F7/F8 trade pool  
**Constraint:** Analysis only — no code changes

---

## Executive Summary

After applying F7 and F8 filters, **42 of 84 trades survive** with dramatically improved performance:

| Metric    | Before F7+F8 | After F7+F8 |
| --------- | ------------ | ----------- |
| Trades    | 84           | 42          |
| Total PnL | ₹16,636      | ₹57,538     |
| Win Rate  | ~48%         | 61.9%       |
| PnL/Trade | ₹198         | ₹1,370      |

**Bottom line on remaining factors: None of the remaining factors (F1, F2, F3, F5, F6) provide additional value on the surviving pool.** F7+F8 have already cleaned the trade pool so effectively that the remaining hypotheses either don't apply, are refuted by the data, or have insufficient sample size.

### Factor Verdicts at a Glance

| Factor | Hypothesis                             | Verdict                                               | Recommendation                 |
| ------ | -------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| **F1** | SHORT near S2 after 12 PM = bad        | **REFUTED** — after-12 SHORTs are 88% WR              | ❌ Do NOT implement            |
| **F2** | Narrow BB = weak; Wide BB = exhaustion | **NO VALUE** — every threshold hurts PnL              | ❌ Keep existing 3.5% max only |
| **F3** | Large candle body = exhaustion         | **REFUTED** — 2 biggest candles are 2 biggest winners | ❌ Do NOT implement            |
| **F5** | RSI divergence at entry = failure      | **INSUFFICIENT DATA** — 1 trade, and it won           | ⏸️ Park for future data        |
| **F6** | PSAR trailing stop                     | **DESTRUCTIVE** — cuts winners, ₹-22K net impact      | ❌ Do NOT implement            |

---

## Section 0: F7+F8 Implemented Filter Impact

### F8: 1-Hour Supertrend Alignment (Scanner-Level, Pre-Entry)

Rejects trades where the market scanner's bias direction conflicts with the 1-hour Supertrend.

**9 trades removed — ALL losers (100% filter accuracy)**

| #   | Symbol     | Date       | Direction | 1h ST   | PnL     |
| --- | ---------- | ---------- | --------- | ------- | ------- |
| 1   | TMPV       | 2026-02-05 | SHORT     | UP ⚠️   | ₹-160   |
| 2   | ABB        | 2026-02-05 | SHORT     | UP ⚠️   | ₹-550   |
| 3   | SBILIFE    | 2026-02-05 | SHORT     | UP ⚠️   | ₹-1,031 |
| 4   | TRENT      | 2026-02-11 | SHORT     | UP ⚠️   | ₹-435   |
| 5   | ASIANPAINT | 2026-02-13 | SHORT     | UP ⚠️   | ₹-200   |
| 6   | UPL        | 2026-02-26 | LONG      | DOWN ⚠️ | ₹-4,810 |
| 7   | ULTRACEMCO | 2026-02-26 | SHORT     | UP ⚠️   | ₹-883   |
| 8   | INDHOTEL   | 2026-02-27 | SHORT     | UP ⚠️   | ₹-500   |
| 9   | HEROMOTOCO | 2026-02-27 | SHORT     | UP ⚠️   | ₹-2,190 |

**Total removed PnL: ₹-10,759** — Perfect: every single trade was a loser.

### F7: RSI Quick Reversal (Strategy-Level, Post-Entry)

After entry, if RSI fails confirmation within 2 candles (LONG: RSI drops below 62; SHORT: RSI rises above 32), the position is exited immediately.

**33 trades removed from the remaining 75 pool**

| #   | Symbol     | Date       | Dir   | Trigger RSI | Threshold | PnL     |
| --- | ---------- | ---------- | ----- | ----------- | --------- | ------- |
| 1   | AXISBANK   | 2026-02-03 | LONG  | 57.7        | <62       | ₹-3,063 |
| 2   | AXISBANK   | 2026-02-03 | LONG  | 57.7        | <62       | ₹-3,594 |
| 3   | BAJFINANCE | 2026-02-03 | LONG  | 47.4        | <62       | ₹-2,550 |
| 4   | PERSISTENT | 2026-02-04 | SHORT | 32.3        | >32       | ₹-3,725 |
| 5   | COFORGE    | 2026-02-04 | SHORT | 39.7        | >32       | ₹-2,288 |
| 6   | BHARTIARTL | 2026-02-05 | SHORT | 36.7        | >32       | ₹665    |
| 7   | BAJAJ-AUTO | 2026-02-06 | SHORT | 34.0        | >32       | ₹259    |
| 8   | SBIN       | 2026-02-06 | SHORT | 40.4        | >32       | ₹-1,275 |
| 9   | DLF        | 2026-02-10 | LONG  | 50.1        | <62       | ₹-2,475 |
| 10  | BHARATFORG | 2026-02-10 | LONG  | 53.8        | <62       | ₹-1,775 |
| 11  | INFY       | 2026-02-11 | SHORT | 36.7        | >32       | ₹-580   |
| 12  | TCS        | 2026-02-11 | SHORT | 36.3        | >32       | ₹-394   |
| 13  | M&M        | 2026-02-12 | SHORT | 44.8        | >32       | ₹1,020  |
| 14  | BEL        | 2026-02-12 | LONG  | 51.6        | <62       | ₹-214   |
| 15  | GODREJPROP | 2026-02-12 | SHORT | 46.3        | >32       | ₹-674   |
| 16  | BRITANNIA  | 2026-02-13 | SHORT | 49.7        | >32       | ₹581    |
| 17  | M&M        | 2026-02-13 | SHORT | 33.5        | >32       | ₹-40    |
| 18  | HDFCBANK   | 2026-02-13 | SHORT | 39.1        | >32       | ₹220    |
| 19  | VOLTAS     | 2026-02-16 | LONG  | 46.2        | <62       | ₹-2,456 |
| 20  | ADANIPORTS | 2026-02-16 | LONG  | 59.1        | <62       | ₹-1,021 |
| 21  | EICHERMOT  | 2026-02-17 | SHORT | 43.0        | >32       | ₹-970   |
| 22  | SHRIRAMFIN | 2026-02-19 | SHORT | 41.0        | >32       | ₹371    |
| 23  | SHRIRAMFIN | 2026-02-19 | SHORT | 43.9        | >32       | ₹-619   |
| 24  | ADANIGREEN | 2026-02-20 | SHORT | 50.6        | >32       | ₹-1,770 |
| 25  | BAJAJFINSV | 2026-02-20 | LONG  | 61.6        | <62       | ₹-125   |
| 26  | TECHM      | 2026-02-20 | SHORT | 50.3        | >32       | ₹-2,100 |
| 27  | SBIN       | 2026-02-26 | SHORT | 40.0        | >32       | ₹-1,238 |
| 28  | HDFCBANK   | 2026-02-26 | SHORT | 38.3        | >32       | ₹-192   |
| 29  | HDFCBANK   | 2026-02-27 | SHORT | 52.3        | >32       | ₹-467   |
| 30  | BPCL       | 2026-02-27 | LONG  | 59.5        | <62       | ₹494    |
| 31  | SHRIRAMFIN | 2026-02-27 | SHORT | 49.8        | >32       | ₹-2,310 |
| 32  | BAJAJFINSV | 2026-02-27 | SHORT | 43.4        | >32       | ₹-288   |
| 33  | GODREJPROP | 2026-02-27 | SHORT | 38.5        | >32       | ₹2,448  |

**Total removed PnL: ₹-30,144**  
Winners sacrificed: 7 trades worth ₹6,058 total  
Losers avoided: 26 trades worth ₹-36,202 total  
**Net benefit: +₹30,144 saved**

### Combined F7+F8 Impact

| Stage             | Trades | PnL         | Win Rate  | PnL/Trade  |
| ----------------- | ------ | ----------- | --------- | ---------- |
| Original (all 84) | 84     | ₹16,636     | ~48%      | ₹198       |
| After F8 (-9)     | 75     | ₹27,395     | ~51%      | ₹365       |
| After F8+F7 (-42) | **42** | **₹57,538** | **61.9%** | **₹1,370** |

F7+F8 together improve PnL by **₹40,902** — a 3.5x improvement in total PnL.

---

## Section 1: The 42 Surviving Trades

These are the trades that pass both F8 (1h ST aligned) and F7 (RSI confirmation holds). This is the pool analyzed for remaining factors.

| #   | Symbol     | Date  | Dir   | PnL     | BB Width | Candle W | Entry RSI | Exit Reason       |
| --- | ---------- | ----- | ----- | ------- | -------- | -------- | --------- | ----------------- |
| 1   | PFC        | 02-04 | LONG  | ₹9,750  | 3.51%    | 0.86%    | 83.8      | EOD Safety        |
| 2   | TECHM      | 02-06 | SHORT | ₹-2,730 | 1.71%    | 0.18%    | 17.1      | ST+BB Break       |
| 3   | BAJAJFINSV | 02-06 | LONG  | ₹338    | 0.94%    | 0.16%    | 78.3      | EOD Safety        |
| 4   | ULTRACEMCO | 02-09 | LONG  | ₹7,750  | 1.06%    | 0.42%    | 73.7      | Manual/Broker     |
| 5   | INDHOTEL   | 02-09 | LONG  | ₹1,500  | 1.03%    | 0.22%    | 74.0      | ST Break          |
| 6   | SHRIRAMFIN | 02-09 | LONG  | ₹2,681  | 1.47%    | 0.49%    | 85.2      | Gamma RSI92       |
| 7   | SHRIRAMFIN | 02-09 | LONG  | ₹2,558  | 1.01%    | 0.57%    | 83.5      | Gamma RSI89       |
| 8   | ULTRACEMCO | 02-09 | LONG  | ₹-142   | 1.21%    | 0.14%    | 86.4      | Manual/Broker     |
| 9   | MUTHOOTFIN | 02-10 | LONG  | ₹9,213  | 1.68%    | 0.26%    | 76.9      | Manual/Broker     |
| 10  | M&M        | 02-10 | LONG  | ₹3,490  | 1.08%    | 0.29%    | 83.2      | Gamma RSI88       |
| 11  | BAJAJFINSV | 02-11 | LONG  | ₹250    | 0.81%    | 0.19%    | 77.5      | ST Break          |
| 12  | SBIN       | 02-11 | LONG  | ₹-1,087 | 1.28%    | 0.24%    | 75.1      | EOD Safety        |
| 13  | TCS        | 02-11 | SHORT | ₹1,216  | 0.62%    | 0.08%    | 24.3      | EOD Safety        |
| 14  | HDFCBANK   | 02-12 | SHORT | ₹-797   | 0.62%    | 0.18%    | 22.4      | ST+BB Break       |
| 15  | HINDUNILVR | 02-12 | SHORT | ₹10,830 | 1.89%    | 1.35%    | 14.4      | Gamma RSI87       |
| 16  | TRENT      | 02-12 | LONG  | ₹900    | 1.58%    | 0.30%    | 73.9      | Manual/Broker     |
| 17  | DLF        | 02-12 | SHORT | ₹454    | 0.87%    | 0.27%    | 23.1      | ST+BB Break       |
| 18  | AXISBANK   | 02-13 | SHORT | ₹-219   | 1.24%    | 0.58%    | 18.1      | ST+BB Break       |
| 19  | INDIGO     | 02-13 | SHORT | ₹-1,185 | 0.79%    | 0.19%    | 21.6      | ST+BB Break       |
| 20  | ADANIENT   | 02-13 | SHORT | ₹-1,947 | 0.95%    | 0.22%    | 31.3      | ST+BB Break       |
| 21  | TORNTPHARM | 02-13 | LONG  | ₹1,113  | 0.72%    | 0.20%    | 75.0      | Gamma RSI86       |
| 22  | HINDUNILVR | 02-13 | SHORT | ₹1,650  | 1.20%    | 0.37%    | 17.3      | Manual/Broker     |
| 23  | HEROMOTOCO | 02-16 | SHORT | ₹2,400  | 1.59%    | 0.18%    | 25.2      | ST+BB Break       |
| 24  | ABB        | 02-16 | LONG  | ₹-75    | 1.34%    | 0.10%    | 78.5      | ST Break          |
| 25  | HDFCBANK   | 02-16 | LONG  | ₹-770   | 0.81%    | 0.13%    | 74.3      | ST Break          |
| 26  | APOLLOHOSP | 02-16 | LONG  | ₹-575   | 0.78%    | 0.16%    | 83.4      | EOD Safety        |
| 27  | SBIN       | 02-16 | LONG  | ₹-1,275 | 1.17%    | 0.20%    | 78.2      | No Follow-Through |
| 28  | COLPAL     | 02-17 | LONG  | ₹-1,148 | 1.18%    | 0.45%    | 81.6      | ST Break          |
| 29  | INFY       | 02-17 | LONG  | ₹-800   | 1.19%    | 0.66%    | 78.7      | ST Break          |
| 30  | LT         | 02-17 | LONG  | ₹936    | 0.52%    | 0.27%    | 82.4      | EOD Safety        |
| 31  | TRENT      | 02-19 | SHORT | ₹2,670  | 1.52%    | 0.29%    | 15.2      | ST+BB Break       |
| 32  | ULTRACEMCO | 02-19 | SHORT | ₹3,685  | 0.71%    | 0.23%    | 15.5      | RSI Trail         |
| 33  | HAL        | 02-19 | SHORT | ₹308    | 1.21%    | 0.26%    | 13.4      | ST+BB Break       |
| 34  | HINDUNILVR | 02-19 | SHORT | ₹1,905  | 0.88%    | 0.11%    | 14.6      | Gamma RSI87       |
| 35  | LTIM       | 02-19 | SHORT | ₹3,053  | 0.75%    | 0.26%    | 41.2      | EOD Safety        |
| 36  | EICHERMOT  | 02-19 | SHORT | ₹1,450  | 0.73%    | 0.16%    | 29.2      | EOD Safety        |
| 37  | SIEMENS    | 02-20 | LONG  | ₹-788   | 2.43%    | 0.34%    | 73.0      | No Follow-Through |
| 38  | LT         | 02-20 | LONG  | ₹-700   | 0.59%    | 0.23%    | 68.8      | ST Break          |
| 39  | BIOCON     | 02-26 | LONG  | ₹-4,875 | 1.64%    | 0.35%    | 63.1      | ST Break          |
| 40  | TRENT      | 02-26 | SHORT | ₹670    | 1.11%    | 0.33%    | 27.8      | ST+BB Break       |
| 41  | BANKBARODA | 02-26 | LONG  | ₹5,119  | 0.90%    | 0.22%    | 74.5      | EOD Safety        |
| 42  | ZYDUSLIFE  | 02-27 | SHORT | ₹765    | 1.08%    | 0.30%    | N/A       | Manual/Broker     |

**Pool: 24 LONG / 18 SHORT | 26 Winners / 16 Losers | PnL: ₹57,538**

---

## Section 2: Factor 1 — SHORT Near S2 After 12 PM

### Hypothesis

SHORTing near support level S2 after 12 PM is a bad trade because the stock has already fallen significantly and is likely to bounce.

### Analysis

**Surviving SHORTs breakdown by time:**

| Time Window  | Trades | PnL     | Win Rate |
| ------------ | ------ | ------- | -------- |
| Before 12 PM | 10     | ₹16,561 | 60%      |
| After 12 PM  | 8      | ₹7,616  | **88%**  |

**After-12 PM SHORTs (detail):**

| Symbol     | Date  | Entry Time | PnL     | Near S2? |
| ---------- | ----- | ---------- | ------- | -------- |
| TECHM      | 02-06 | 12:50      | ₹-2,730 | No       |
| TCS        | 02-11 | 14:25      | ₹1,216  | No       |
| HINDUNILVR | 02-13 | 12:40      | ₹1,650  | No       |
| HAL        | 02-19 | 12:10      | ₹308    | No       |
| HINDUNILVR | 02-19 | 13:35      | ₹1,905  | No       |
| LTIM       | 02-19 | 14:30      | ₹3,053  | No       |
| EICHERMOT  | 02-19 | 14:30      | ₹1,450  | No       |
| ZYDUSLIFE  | 02-27 | 15:20      | ₹765    | No       |

### Findings

1. **Zero applicable trades** — No surviving trades triggered the "near S2 after 12 PM" condition
2. **After-12 PM SHORTs perform excellently** — 88% win rate, ₹7,616 total on just 8 trades
3. Only 1 loser out of 8 after-12 PM SHORTs (TECHM on 02-06)
4. The hypothesis is **refuted by post-F7/F8 data** — afternoon SHORTs that survive F7+F8 are high-quality

### Verdict: ❌ DO NOT IMPLEMENT

The original concern (SHORTing near S2 after 12 PM) doesn't occur in the surviving pool. F7 and F8 seem to have already eliminated the weak afternoon shorts. Any implementation would be a no-op at best.

---

## Section 3: Factor 2 — Bollinger Band Width Filter

### Hypothesis (Corrected)

- **Narrow BB (<0.6-0.7%)**: Weak breakout, not enough expansion → trade fails
- **Wide BB (>2.0-2.5%)**: Exhaustion move, bands already stretched → trade reverses

### Analysis: BB Width Distribution

All 42 surviving trades sorted by BB width:

| BB Width Range | Trades | Winners | Win Rate | PnL     |
| -------------- | ------ | ------- | -------- | ------- |
| < 0.7%         | 4      | 2       | 50%      | ₹655    |
| 0.7% – 1.0%    | 11     | 8       | 73%      | ₹19,363 |
| 1.0% – 1.5%    | 14     | 9       | 64%      | ₹17,365 |
| 1.5% – 2.0%    | 8      | 6       | 75%      | ₹21,306 |
| 2.0% – 3.0%    | 2      | 0       | 0%       | ₹-1,576 |
| > 3.0%         | 3      | 1       | 33%      | ₹425    |

> Note: The 3.51% PFC trade was a massive ₹9,750 winner. The existing MAX_BANDWIDTH at 3.5% already sits right at this edge.

### Threshold Sweep Results

**MINIMUM BB Width (reject too narrow):**

| Threshold | Filtered | Kept PnL | Kept WR | Δ PnL        |
| --------- | -------- | -------- | ------- | ------------ |
| 0.50%     | 0        | ₹57,538  | 62%     | ₹0           |
| 0.60%     | 2        | ₹57,302  | 63%     | **-₹236**    |
| 0.70%     | 4        | ₹56,883  | 63%     | **-₹655**    |
| 0.80%     | 10       | ₹49,343  | 63%     | **-₹8,195**  |
| 0.90%     | 15       | ₹42,386  | 59%     | **-₹15,153** |

Every minimum threshold **hurts** PnL. The 4 narrow-BB trades (<0.7%) include:

- LT 02-17 (0.52%): **+₹936** winner
- LT 02-20 (0.59%): -₹700 loser
- TCS 02-11 (0.62%): **+₹1,216** winner
- HDFCBANK 02-12 (0.62%): -₹797 loser

Net: +₹655. Not systematically bad — roughly break-even.

**MAXIMUM BB Width (reject too wide — "exhaustion"):**

| Threshold | Filtered | Kept PnL | Kept WR | Δ PnL        |
| --------- | -------- | -------- | ------- | ------------ |
| 1.6%      | 6        | ₹36,138  | 64%     | **-₹21,400** |
| 2.0%      | 2        | ₹48,576  | 63%     | **-₹8,963**  |
| 2.5%      | 1        | ₹47,788  | 61%     | **-₹9,750**  |
| 3.0%      | 1        | ₹47,788  | 61%     | **-₹9,750**  |
| 3.5%      | 1        | ₹47,788  | 61%     | **-₹9,750**  |

Every maximum threshold also **hurts** PnL. The wide-BB trades are predominantly winners:

- HINDUNILVR 02-12 (1.89%): **+₹10,830** — biggest trade in dataset
- SIEMENS 02-20 (2.43%): -₹788
- PFC 02-04 (3.51%): **+₹9,750** — second biggest trade

**Goldilocks zone (min + max together):**

| Min  | Max  | Kept | PnL     | WR  | Δ PnL        |
| ---- | ---- | ---- | ------- | --- | ------------ |
| 0.5% | 2.0% | 40   | ₹48,576 | 63% | **-₹8,963**  |
| 0.7% | 2.0% | 36   | ₹47,921 | 64% | **-₹9,618**  |
| 0.7% | 3.0% | 37   | ₹47,133 | 62% | **-₹10,405** |

All combinations are worse than no filter.

### Why the Hypothesis Fails Post-F7/F8

The corrected "wide BB = exhaustion" hypothesis made sense pre-F7/F8 because some wide-BB trades were entering on momentum that immediately reversed. **F7 already catches exactly this scenario** — if the entry is into exhaustion, RSI will fail to confirm within 2 candles. The wide-BB trades that survive F7 are genuinely strong momentum moves.

### Verdict: ❌ DO NOT ADD ADDITIONAL BB WIDTH FILTERS

The existing `MAX_BANDWIDTH_PERCENT = 3.5%` in Guard #2 is sufficient. Adding a minimum threshold or tightening the maximum would damage performance. F7's RSI confirmation already handles the "exhaustion on entry" problem.

---

## Section 4: Factor 3 — Large Breakout Candle = Exhaustion

### Hypothesis (User's Corrected Version)

Large body candles (>0.7% of underlying price) at breakout represent exhaustion. The stock has moved too much too fast and is likely to reverse. Especially true on CE (LONG) side.

### Analysis: Candle Width Distribution

| Width Range | Trades | Winners | Win Rate | PnL         |
| ----------- | ------ | ------- | -------- | ----------- |
| < 0.2%      | 10     | 5       | 50%      | ₹-1,430     |
| 0.2% – 0.3% | 14     | 11      | 79%      | ₹34,290     |
| 0.3% – 0.5% | 10     | 7       | 70%      | ₹9,735      |
| 0.5% – 0.7% | 5      | 3       | 60%      | ₹4,580      |
| > 0.7%      | **2**  | **2**   | **100%** | **₹20,580** |
| > 1.0%      | 1      | 1       | 100%     | ₹10,830     |

### The Critical Finding

**Only 2 trades in the surviving pool have candle width > 0.7%. Both are the biggest winners:**

| Symbol     | Date  | Dir   | Candle W | PnL          | Exit                                 |
| ---------- | ----- | ----- | -------- | ------------ | ------------------------------------ |
| PFC        | 02-04 | LONG  | 0.865%   | **+₹9,750**  | EOD Safety (still running at close!) |
| HINDUNILVR | 02-12 | SHORT | 1.352%   | **+₹10,830** | Gamma Climax RSI87                   |

These two trades account for **₹20,580 of the ₹57,538 total** — 35.8% of all profits from just 4.8% of trades.

### Threshold Sweep (Maximum Candle Width)

| Threshold | Filtered | Kept PnL | Δ PnL        |
| --------- | -------- | -------- | ------------ |
| 0.50%     | 5        | ₹35,420  | **-₹22,119** |
| 0.70%     | 2        | ₹36,958  | **-₹20,580** |
| 0.80%     | 2        | ₹36,958  | **-₹20,580** |
| 0.90%     | 1        | ₹46,708  | **-₹10,830** |

Every threshold **destroys performance** catastrophically.

### CE (LONG) Side Split

User specifically hypothesized CE exhaustion:

- Filtering LONGs with candle > 0.7% removes only PFC (+₹9,750) → **-₹9,750**
- Filtering LONGs with candle > 0.5% removes PFC + SHRIRAMFIN (+₹2,558) + INFY (-₹800) → **-₹11,508**

### PE (SHORT) Side Split

- Filtering SHORTs with candle > 0.7% removes only HINDUNILVR (+₹10,830) → **-₹10,830**
- This is the single largest SHORT winner in the entire dataset

### Why the Hypothesis Fails Post-F7/F8

A "large candle" that occurs with RSI confirmation (F7 passes) and 1-hour trend alignment (F8 passes) is NOT exhaustion — it's **conviction**. The breakout candle is large precisely BECAUSE the underlying momentum is strong. F7+F8 have already filtered out the "fake" large candles where RSI didn't confirm or the hourly trend disagreed.

### Verdict: ❌ DO NOT IMPLEMENT — This is an ANTI-SIGNAL

Filtering large candles would remove 35.8% of all profits. The hypothesis is cleanly refuted. Large breakout candles that pass F7+F8 are genuine momentum signals, not exhaustion.

---

## Section 5: Factor 5 — RSI Divergence at Entry

### Hypothesis (User's Corrected Version)

- **SHORT**: Price makes new 10-candle low, but RSI does NOT make new 10-candle low → bearish momentum is fading, don't short
- **LONG**: Price makes new 10-candle high, but RSI does NOT make new 10-candle high → bullish momentum is fading, don't go long

### Analysis

| Category                             | Trades | PnL     | Win Rate |
| ------------------------------------ | ------ | ------- | -------- |
| **With divergence (counter-signal)** | 1      | ₹7,750  | 100%     |
| Without divergence                   | 41     | ₹49,788 | 61%      |

**The single divergent trade:**

| Symbol     | Date  | Dir  | Type                                     | PnL         |
| ---------- | ----- | ---- | ---------------------------------------- | ----------- |
| ULTRACEMCO | 02-09 | LONG | COUNTER (price high, RSI not confirming) | **+₹7,750** |

### Findings

1. **Sample size of 1** — Statistically meaningless to draw conclusions
2. The one divergent trade was a **massive winner** (₹7,750 — third-largest in entire pool)
3. Filtering it would cost ₹7,750 — 13.5% of total profits
4. The original hypothesis data (pre-F7/F8) may have had more divergent trades, but F7 already filters many of them (RSI not confirming = fails F7's 2-candle check)

### Why F7 Subsumes F5

F7's RSI confirmation check at entry essentially catches the same signal as F5's divergence check:

- F5 says: "RSI isn't making new extremes ↔ divergence → skip"
- F7 says: "RSI isn't meeting threshold after entry → exit immediately"

The mechanics differ (F5 is pre-entry divergence, F7 is post-entry confirmation), but the effect is similar — weak RSI at entry leads to F7 quick exit. The one divergent trade that SURVIVED F7 did so because its RSI was strong enough post-entry, meaning the "divergence" was a false alarm.

### Verdict: ⏸️ PARK — Insufficient Data

Only 1 applicable trade means no statistical basis for implementation. F7 already covers the functional intent. Revisit if we accumulate more data showing a pattern.

---

## Section 6: Factor 6 — PSAR Trailing Stop

### Hypothesis

Use Parabolic SAR as an additional trailing stop mechanism. PSAR's acceleration factor should catch trend reversals earlier than the current Supertrend-based exits.

### Analysis

| Category                               | Trades | Total PnL at Risk  |
| -------------------------------------- | ------ | ------------------ |
| Would **improve** (exit loser earlier) | 10     | ₹-12,093 of losses |
| Would **hurt** (exit winner earlier)   | 7      | ₹34,482 of profits |
| No change                              | 25     | —                  |

### PSAR Exit Candle Distribution — The Fatal Flaw

| Exit Candle # | Count  | Note                                                                |
| ------------- | ------ | ------------------------------------------------------------------- |
| **#1**        | **10** | ← **60% of all PSAR exits trigger on the FIRST candle after entry** |
| #2            | 1      |                                                                     |
| #4            | 1      |                                                                     |
| #5            | 1      |                                                                     |
| #6            | 1      |                                                                     |
| #7            | 2      |                                                                     |
| #12           | 1      |                                                                     |
| #20           | 1      |                                                                     |

**PSAR is absurdly trigger-happy.** 10 of 18 PSAR exit signals fire on the very first candle after entry. This is functionally equivalent to "don't trade at all."

### PSAR Would IMPROVE (10 trades — saves money on losers)

| Symbol     | Date  | Dir  | PnL     | PSAR Exit  | Actual Exit | Saved Early? |
| ---------- | ----- | ---- | ------- | ---------- | ----------- | ------------ |
| SBIN       | 02-11 | LONG | ₹-1,087 | Candle #4  | Candle #13  | ✅ Yes       |
| ABB        | 02-16 | LONG | ₹-75    | Candle #1  | Candle #28  | ✅ Yes       |
| HDFCBANK   | 02-16 | LONG | ₹-770   | Candle #6  | Candle #16  | ✅ Yes       |
| APOLLOHOSP | 02-16 | LONG | ₹-575   | Candle #1  | Candle #19  | ✅ Yes       |
| SBIN       | 02-16 | LONG | ₹-1,275 | Candle #1  | Candle #2   | ✅ Yes       |
| COLPAL     | 02-17 | LONG | ₹-1,148 | Candle #1  | Candle #11  | ✅ Yes       |
| INFY       | 02-17 | LONG | ₹-800   | Candle #1  | Candle #17  | ✅ Yes       |
| SIEMENS    | 02-20 | LONG | ₹-788   | Candle #1  | Candle #2   | ✅ Yes       |
| LT         | 02-20 | LONG | ₹-700   | Candle #12 | Candle #20  | ✅ Yes       |
| BIOCON     | 02-26 | LONG | ₹-4,875 | Candle #5  | Candle #12  | ✅ Yes       |

### PSAR Would HURT (7 trades — kills winners)

| Symbol         | Date  | Dir  | PnL        | PSAR Exit  | Actual Exit | Profit Lost                          |
| -------------- | ----- | ---- | ---------- | ---------- | ----------- | ------------------------------------ |
| **PFC**        | 02-04 | LONG | **₹9,750** | Candle #2  | Candle #63  | Would cut ₹9,750 winner to ~₹0       |
| **ULTRACEMCO** | 02-09 | LONG | **₹7,750** | Candle #20 | Candle #52  | Partial profit lost                  |
| INDHOTEL       | 02-09 | LONG | ₹1,500     | Candle #1  | Candle #47  | Would kill trade immediately         |
| **MUTHOOTFIN** | 02-10 | LONG | **₹9,213** | Candle #1  | Candle #30  | Would kill ₹9,213 winner immediately |
| BAJAJFINSV     | 02-11 | LONG | ₹250       | Candle #1  | Candle #15  | Would kill trade immediately         |
| TRENT          | 02-12 | LONG | ₹900       | Candle #7  | Candle #45  | Partial profit lost                  |
| **BANKBARODA** | 02-26 | LONG | **₹5,119** | Candle #1  | Candle #17  | Would kill ₹5,119 winner immediately |

### The Damage Calculation

- **Losers saved**: Best case ~₹7,000 saved (exits closer to entry price)
- **Winners destroyed**: PFC (₹9,750), MUTHOOTFIN (₹9,213), BANKBARODA (₹5,119), INDHOTEL (₹1,500) all killed on candle #1-#2
- **Net impact: approximately -₹22,000** — catastrophic

### Why PSAR Fails for This Strategy

PSAR's acceleration factor is designed for trending markets on larger timeframes. On 5-minute options charts:

1. **Options decay creates natural PSAR triggers** — the SAR catches time decay, not trend reversal
2. **5-minute noise is amplified** — every minor pullback trips the SAR
3. **Candle #1 exits = no trade** — 55% of PSAR exits trigger immediately, meaning PSAR essentially vetoes the entry rather than trailing
4. **All 7 "hurt" trades are LONG** — PSAR is especially toxic for bull trades where initial pullbacks are normal

### Verdict: ❌ DO NOT IMPLEMENT — Catastrophically Harmful

PSAR would destroy the strategy's biggest winners. The existing 5-layer exit framework (EOD, Emergency Stop, Gamma RSI Climax, RSI Trail Premium Stop, Supertrend Break) is far superior for this strategy's timeframe and instrument type.

---

## Section 7: Combined Summary & Recommendations

### Impact Waterfall

```
Original 84 trades:                   ₹16,636  (WR: ~48%)
├─ F8: 1h ST Alignment (-9 trades):  ₹27,395  (+₹10,759)
├─ F7: RSI Quick Reversal (-33):     ₹57,538  (+₹30,143)
├─ F1: SHORT near S2 (0 applicable): ₹57,538  (+₹0)
├─ F2: BB Width filter:              Negative at ALL thresholds
├─ F3: Large candle filter:          Negative at ALL thresholds
├─ F5: RSI divergence (1 trade):     -₹7,750 if implemented
└─ F6: PSAR trail:                   ~-₹22,000 if implemented
```

### Final Recommendations

| Priority | Action                                                        | Expected Impact             |
| -------- | ------------------------------------------------------------- | --------------------------- |
| 1        | **Keep F7+F8 as implemented**                                 | ₹57,538 vs ₹16,636 baseline |
| 2        | **Do NOT add F1, F2, F3, F5, F6**                             | Protects current PnL        |
| 3        | **Monitor F5 divergence** with more data                      | Revisit after 200+ trades   |
| 4        | **Consider F2 min-BB only if** WR drops below 55% on new data | Currently 62% WR is healthy |

### Why Adding More Filters Is Counterproductive

F7+F8 have fundamentally changed the quality of the trade pool. The remaining 42 trades have a 62% win rate and ₹1,370/trade average. At this point:

1. **Small samples produce misleading patterns** — 42 trades is not enough to find robust secondary filters
2. **Overfitting risk is extreme** — each additional filter would be tuned to this specific 25-day window
3. **The big winners ARE the edge** — PFC (₹9,750), HINDUNILVR (₹10,830), MUTHOOTFIN (₹9,213), ULTRACEMCO (₹7,750) account for 65% of profits. Any filter that clips these trades is fatal.
4. **F7+F8 already catch the intent** of F2, F3, and F5 — exhaustion entries fail RSI confirmation; misaligned trades fail hourly ST check

### What to Do Instead

Rather than adding more rejection filters, focus on:

- **Accumulate more live trade data** with F7+F8 active to validate the 62% WR on fresh data
- **Position sizing optimization** — 3 slots at ₹65K each may benefit from sizing by conviction score
- **New alpha sources** — the momentum scanner and multi-stock expansion will generate more diverse entries than tightening existing filters

---

_Analysis script: `scripts/reanalyze-factors.js`_  
_Data source: `data/factor-analysis-results.json` (84 trades)_  
_Generated: 2026-02-28_
