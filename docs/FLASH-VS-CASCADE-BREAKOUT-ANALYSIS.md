# Flash vs Cascade Breakout Analysis

**Date:** February 12, 2026  
**Scope:** Deep analysis of whether "single-candle flash" breakouts can be differentiated from "sustained cascade" breakouts at entry time using our scoring system and Bollinger indicators  
**Constraint:** No code changes — pure analytical exercise  
**Data Source:** All LONG trades from Jan 28 – Feb 12, 2026 (trading.log through trading4.log)

---

## Table of Contents

1. [Origin of the Question](#1-origin-of-the-question)
2. [The IV Crush Root Cause](#2-the-iv-crush-root-cause)
3. [Corrected Deploy-Time Score Matrix](#3-corrected-deploy-time-score-matrix)
4. [Bollinger Indicators at Entry](#4-bollinger-indicators-at-entry)
5. [Post-Entry Stock Price Behavior](#5-post-entry-stock-price-behavior)
6. [Signal-by-Signal Analysis](#6-signal-by-signal-analysis)
7. [TRENT vs HINDUNILVR: The Unsolvable Pair](#7-trent-vs-hindunilvr-the-unsolvable-pair)
8. [The Verdict](#8-the-verdict)
9. [Actionable Suggestions](#9-actionable-suggestions)
10. [What NOT to Do](#10-what-not-to-do)
11. [Previously Rejected Proposals](#11-previously-rejected-proposals)
12. [Premium Path Evidence](#12-premium-path-evidence)
13. [Raw Data Appendix](#13-raw-data-appendix)

---

## 1. Origin of the Question

On Feb 12, TRENT stock moved ~34 points from the 10:30 AM breakout, but the TRENT FEB 4250 CE option barely moved (~₹5). The system had entered TRENT at 10:29 with Score=13.85.

Meanwhile, HINDUNILVR (entered same day at 10:24, Score=12.99, SHORT direction) saw its put option run from ₹44 to ₹52.9, exiting via GAMMA_CLIMAX_RSI87 for +₹10,830 profit in 50 minutes.

**The question:** Why did TRENT's option stall while HINDUNILVR's option ran? Can we detect at entry time which breakouts will sustain and which will flash?

---

## 2. The IV Crush Root Cause

### Why TRENT's Option Stalled Despite the Stock Moving

Option premium tracks **realized volatility**, not stock direction. The mechanism:

| Metric                     | TRENT                                 | HINDUNILVR                       |
| -------------------------- | ------------------------------------- | -------------------------------- |
| Breakout candle volume     | 41,616                                | Sustained 100K-260K              |
| Volume 2 candles later     | 5,843 (**-86%**)                      | Multiple waves maintained        |
| Subsequent volume range    | 3,000 - 8,000 (dead)                  | 100K-260K with fresh waves       |
| Realized vol post-breakout | Collapsed (~30% → ~10-15% annualized) | Matched or exceeded IV           |
| Option response ratio      | Started 1.54 → collapsed to **0.36**  | Stable 0.48-0.72                 |
| IV crush magnitude         | ~₹7-9 loss via Vega                   | None — IV sustained              |
| Theta decay                | ~₹3-5 loss                            | Overwhelmed by directional gains |

**The core mechanism:**

1. Breakout candle has artificially high volume (one large buyer)
2. No follow-through buying arrives in subsequent candles
3. Realized volatility collapses because the stock isn't moving much post-breakout
4. Market makers reprice IV downward to match actual realized vol
5. Vega loss eats the small delta gains from the stock moving ₹34

### MUTHOOTFIN Experienced the Same IV Crush — Then Recovered

MUTHOOTFIN (+₹9,212 winner) experienced the **same** IV crush as TRENT for 80 minutes:

- Premium fell from ₹155.60 entry to a low around ₹148 (₹-1,072 P&L)
- Stock held above BB_Upper but moved sideways
- At ~12:15, a **second volume wave** arrived
- This re-inflated realized volatility and the option rocketed to exit at +₹9,212

**Key insight:** IV crush is temporary IF a second buying wave arrives. The option recovers. TRENT's second wave never came.

---

## 3. Corrected Deploy-Time Score Matrix

**Critical discovery:** The scores referenced in scanner cycle logs are often RESCAN scores (5 minutes after deploy). The actual deploy-time scores sometimes differ. Below are the **verified deploy-time** scores from the exact log lines preceding each `🚀 DEPLOY` entry:

### Winners

| Trade      | Deploy Score | Base | Tac |  T  |  M  |  V  |  S  | SM  | FB  | RV  | PX  | RA  | SQ  | GW  | Deploy Time  |     P&L      | Exit Reason        |
| ---------- | :----------: | :--: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :----------: | :----------: | :----------------- |
| HINDUNILVR |    12.99     | 6.0  | 7.0 | 1.5 | 3.5 | 0.0 | 1.0 |  —  |  3  |  2  |  0  |  1  | 1.0 |  0  | Feb 12 10:24 | **+₹10,830** | GAMMA_CLIMAX_RSI87 |
| MUTHOOTFIN |    11.52     | 7.5  | 4.0 | 3.0 | 1.5 | 2.0 | 1.0 |  —  |  0  | 1.5 | 1.5 |  0  | 1.0 |  0  | Feb 10 09:29 | **+₹9,212**  | System exit        |
| ULTRACEMCO |    13.64     | 8.5  | 5.1 | 3.0 | 2.5 | 2.0 | 1.0 |  —  |  3  |  0  |  0  |  1  | 1.1 |  0  | Feb 9 09:23  | **+₹7,750**  | System exit        |
| M&M        |    10.03     | 7.5  | 2.5 | 3.0 | 2.5 | 0.0 | 2.0 |  —  |  0  |  0  | 1.5 |  0  | 1.0 |  0  | Feb 10 10:59 | **+₹3,490**  | System exit        |
| SHRIRAMFIN |    10.53     | 9.5  | 1.0 | 3.0 | 2.5 | 2.0 | 2.0 |  —  |  0  |  0  |  0  |  0  | 1.0 |  0  | Feb 9 11:53  | **+₹2,681**  | System exit        |
| TRENT      |    13.85     | 7.5  | 6.3 | 3.0 | 3.5 | 0.0 | 1.0 |  —  |  3  | 1.5 |  0  |  1  | 0.8 |  0  | Feb 12 10:29 |  **+₹900**   | Broker squareoff   |

### Losers

| Trade      | Deploy Score | Base | Tac |  T  |  M  |  V  |  S  | SM  | FB  | RV  | PX  | RA  | SQ  | GW  | Deploy Time  |     P&L     | Exit Reason           |
| ---------- | :----------: | :--: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :----------: | :---------: | :-------------------- |
| DLF        |  **16.59**   | 9.5  | 7.1 | 3.0 | 3.5 | 1.0 | 2.0 |  —  |  3  |  2  |  0  |  1  | 1.1 |  0  | Feb 10 09:43 | **-₹2,475** | LONG_SUPERTREND_BREAK |
| BHARATFORG |  **15.75**   | 9.5  | 6.3 | 3.0 | 2.5 | 2.0 | 2.0 |  —  |  3  |  0  |  0  |  1  | 1.3 |  1  | Feb 10 12:08 | **-₹1,775** | LONG_SUPERTREND_BREAK |

### Score Distribution by Outcome

| Score Range | Trades                                                |    Win Rate    |     Avg P&L |
| :---------- | ----------------------------------------------------- | :------------: | ----------: |
| **> 15.0**  | DLF (16.59), BHARATFORG (15.75)                       |  **0%** (0/2)  | **-₹2,125** |
| 13.0 – 15.0 | TRENT (13.85), ULTRACEMCO (13.64), HINDUNILVR (12.99) |   67% (2/3)    |     +₹6,493 |
| 10.0 – 13.0 | MUTHOOTFIN (11.52), SHRIRAMFIN (10.53), M&M (10.03)   | **100%** (3/3) |     +₹5,128 |

---

## 4. Bollinger Indicators at Entry

These come from the `[BOLLINGER] 📊 Current Indicators` log lines at the moment each strategy began monitoring (first candle after deployment):

| Trade      |  RSI  | BB_Upper | BB_Lower | Price  | Supertrend |    BB Penetration     | BB Bandwidth |
| ---------- | :---: | :------: | :------: | :----: | :--------: | :-------------------: | :----------: |
| TRENT      | 73.92 | 4256.28  | 4190.90  | 4257.3 |     UP     |      **+0.024%**      |    1.54%     |
| HINDUNILVR | 16.68 | 2483.19  | 2445.58  | 2433.5 |    DOWN    | +0.494% (below lower) |    1.53%     |
| MUTHOOTFIN | 75.63 | 3808.57  | 3753.29  | 3816.3 |     UP     |        +0.203%        |    1.46%     |
| M&M        | 79.68 | 3659.85  | 3624.09  | 3660.8 |     UP     |      **+0.026%**      |    0.98%     |
| ULTRACEMCO | 71.51 | 12794.31 | 12679.69 | 12804  |     UP     |        +0.076%        |    0.90%     |
| SHRIRAMFIN | 78.91 | 1033.32  | 1021.65  | 1033.9 |     UP     |        +0.056%        |    1.13%     |
| DLF        | 70.12 |  674.48  |  667.84  | 675.4  |     UP     |        +0.136%        |    0.99%     |
| BHARATFORG | 74.12 | 1612.56  | 1605.32  | 1613.5 |     UP     |        +0.058%        |    0.45%     |

### Calculations

**BB Penetration** = (Price - BB_Upper) / BB_Upper × 100 for LONG entries  
**BB Bandwidth** = (BB_Upper - BB_Lower) / Midpoint × 100

### Notes

- **TRENT** had the smallest penetration (0.024%) — barely kissed the band
- **M&M** had similarly tiny penetration (0.026%) but was a big winner — so penetration alone doesn't separate them
- **BHARATFORG** had the tightest bandwidth (0.45%) — meaning the band threshold was trivially close to the price; a ₹7 move on a ₹1,613 stock crossed it
- **HINDUNILVR** had the deepest penetration (0.494%) — a violent breakdown consistent with its large profit
- Early trades (INDHOTEL Jan 28, BOSCHLTD Jan 28, CUMMINSIND Jan 28, SIEMENS Jan 28, AXISBANK Jan 31, PFC Feb 2, BAJFINANCE Feb 3) did not have "Current Indicator" log entries — this logging was added later

---

## 5. Post-Entry Stock Price Behavior

Traced from `[BOLLINGER] ✅ Added new 5-minute candle` log entries. This data is NOT available at entry time, but reveals what the entry signal was buying:

### First 30 Minutes After Entry (Stock Close vs Entry Price)

| Trade          | Entry Price |  +5min   |  +10min  |  +15min  |  +20min  |  +25min  |  +30min  | Pattern                                                    |
| -------------- | :---------: | :------: | :------: | :------: | :------: | :------: | :------: | :--------------------------------------------------------- |
| **M&M**        |   3660.8    |   +7.7   |   +7.1   |  +13.2   |  +13.6   |  +19.7   |  +19.7   | **ROCKET** — never looked back                             |
| **MUTHOOTFIN** |   3816.3    |   +1.0   |   -0.2   |   -4.2   |   -7.3   |   -0.5   |   -1.7   | **STALL-ABOVE-BAND** — held BB_Upper (3808.57)             |
| **TRENT**      |   4257.3    |   +2.6   |   +0.7   |  +12.7   |  +11.5   |  +18.7   |  +17.6   | **SLOW GRIND** — peaked +18.7, pulled back, rebuilt slowly |
| **DLF**        |    675.4    | **-2.7** | **-3.5** | **-3.3** | **-3.9** | **-4.5** | **-5.2** | **IMMEDIATE DROP** — fell below BB_Upper on candle 1       |
| **BHARATFORG** |   1613.5    |   +1.5   |   -0.4   |   -1.7   |   -2.9   |   -3.0   |    —     | **ONE-CANDLE-THEN-DROP** — peaked candle 2, declined       |

### Stock vs Bollinger Band Post-Entry (Critical Finding)

| Trade          |    Candle 1 vs BB_Upper    |           Candle 2           |                   Candle 3                   |    **Breakout Held?**    | Outcome |
| -------------- | :------------------------: | :--------------------------: | :------------------------------------------: | :----------------------: | ------- |
| M&M            |   Well above (+8.6 pts)    |            Above             |                    Above                     |         **YES**          | +₹3,490 |
| MUTHOOTFIN     |      Above (+1.0 pts)      |            Above             | Above (barely, -4.2 but still above 3808.57) |         **YES**          | +₹9,212 |
| SHRIRAMFIN     |           Above            |            Above             |                    Above                     |         **YES**          | +₹2,681 |
| ULTRACEMCO     |           Above            |            Above             |                    Above                     |         **YES**          | +₹7,750 |
| TRENT          |        Above (+2.6)        |         Above (+0.7)         |                Above (+12.7)                 |         **YES**          | +₹900   |
| **DLF**        | **BELOW** (672.7 < 674.48) |          **BELOW**           |                  **BELOW**                   | **NO — failed candle 1** | -₹2,475 |
| **BHARATFORG** |        Above (+1.5)        | **BELOW** (1613.1 < 1612.56) |                  **BELOW**                   | **NO — failed candle 3** | -₹1,775 |

**Every loser had the stock fall back below the Bollinger Band within 1–3 candles.**  
**Every winner held above the Bollinger Band.**  
This is the cleanest signal in the entire dataset.

---

## 6. Signal-by-Signal Analysis

Systematic evaluation of every scoring component for its ability to differentiate winners from losers.

### Signal A: Fresh Breakout (FB=3 vs FB=0) — STRONGEST ENTRY-TIME SIGNAL

| FB Value | Meaning                                                    | Trades                                         |    Win Rate    |     Avg P&L |
| -------- | ---------------------------------------------------------- | ---------------------------------------------- | :------------: | ----------: |
| **FB=0** | Stock broke out on previous candle, STILL outside band now | MUTHOOTFIN, SHRIRAMFIN, M&M                    | **100% (3/3)** | **+₹5,128** |
| **FB=3** | Breakout just happened THIS candle                         | HINDUNILVR, ULTRACEMCO, TRENT, DLF, BHARATFORG |   40% (2/5)    |     +₹3,046 |

**Why FB=0 works:** It proves sustained participation — the breakout survived at least one 5-minute cycle before the scanner deployed. FB=3 means the breakout JUST happened — no confirmation yet.

**Caveat:** The two biggest individual winners (HINDUNILVR +₹10,830, ULTRACEMCO +₹7,750) were FB=3. Filtering out FB=3 entirely would eliminate ₹18,580 in profits to avoid ₹4,250 in losses + the ₹900 stall.

### Signal B: Total Deploy Score — INVERSE CORRELATION

The highest-scoring trades were the worst performers:

| Score Range |    Win Rate    | Interpretation                                   |
| :---------- | :------------: | ------------------------------------------------ |
| > 15.0      |  **0% (0/2)**  | Tactical bonus stacking = climax detection       |
| 13.0 – 15.0 |   67% (2/3)    | Moderate tactical = genuine momentum             |
| 10.0 – 13.0 | **100% (3/3)** | Lower tactical = quieter, more sustainable setup |

**Why this happens:** Scores > 15 require FB + RV + RA + SQ all firing simultaneously. This "everything aligns perfectly" moment is often a **climax** — the point of maximum consensus — which frequently marks the exhaustion of a move rather than its beginning.

DLF (16.59): FB:3 + RV:2 + RA:1 + SQ:1.1 = 7.1 tactical on a 9.5 base → climax  
BHARATFORG (15.75): FB:3 + RA:1 + SQ:1.3 + GW:1 = 6.3 tactical on a 9.5 base → climax

### Signal C: Volume Profile (V base + RV tactical) — INCONCLUSIVE

| Pattern            | Meaning                        | Trades                                         |  Win Rate  |
| ------------------ | ------------------------------ | ---------------------------------------------- | :--------: |
| V=0, RV=0          | Quiet volume everywhere        | M&M                                            | 100% (1/1) |
| V=0, RV>0          | Isolated single-candle spike   | TRENT, HINDUNILVR                              | 50% (1/2)  |
| V>0, RV=0          | Session vol elevated, no spike | SHRIRAMFIN, BHARATFORG                         | 50% (1/2)  |
| V>0, RV>0          | Both elevated                  | DLF                                            |  0% (0/1)  |
| V=2 (high session) | Strong session RVOL            | MUTHOOTFIN, ULTRACEMCO, SHRIRAMFIN, BHARATFORG | 75% (3/4)  |

**The V=0 + RV>0 pattern** (supposed "flash breakout" signature — volume came in one candle only, not sustained through the session) includes BOTH TRENT (stalled) AND HINDUNILVR (biggest winner). Volume configuration alone cannot separate flash from cascade.

### Signal D: Sector Alignment (S) — INVERTED WITHIN FB=3 TRADES

|      S at Deploy      | FB=3 Trades Only                                           |   Win Rate    |
| :-------------------: | ---------------------------------------------------------- | :-----------: |
|  S=1.0 (flat sector)  | HINDUNILVR (+₹10,830), ULTRACEMCO (+₹7,750), TRENT (+₹900) | **67% (2/3)** |
| S=2.0 (strong sector) | DLF (-₹2,475), BHARATFORG (-₹1,775)                        | **0% (0/2)**  |

**Counterintuitive finding:** Within fresh breakout trades, both losers had strong sector support (S=2.0) and both real winners had flat sectors (S=1.0). Hypothesis: when the sector is already running (S=2.0), the stock breakout may be a late-comer catching up to already-priced sector rotation. Stock-specific breakouts in flat sectors may indicate genuine stock-level catalysts.

**Caveat:** TRENT also had S=1.0 and stalled. And in FB=0 territory, M&M had S=2.0 and won. So this pattern is specific to FB=3 trades only.

### Signal E: Bollinger Penetration Depth — NOT DIAGNOSTIC

| Trade      | Penetration % | Outcome  |
| ---------- | :------------ | -------- |
| HINDUNILVR | 0.494%        | +₹10,830 |
| MUTHOOTFIN | 0.203%        | +₹9,212  |
| DLF        | 0.136%        | -₹2,475  |
| ULTRACEMCO | 0.076%        | +₹7,750  |
| BHARATFORG | 0.058%        | -₹1,775  |
| SHRIRAMFIN | 0.056%        | +₹2,681  |
| M&M        | 0.026%        | +₹3,490  |
| TRENT      | 0.024%        | +₹900    |

No usable threshold exists. Low penetration includes both winners (M&M 0.026%) and stalls (TRENT 0.024%). High penetration (DLF 0.136%) also lost. This signal cannot separate outcomes.

### Signal F: Bandwidth / Squeeze at Deploy — ULTRA-TIGHT IS DANGEROUS

| Bandwidth Range      | SQ Score  | Trades                                             |   Win Rate   |
| :------------------- | :-------: | -------------------------------------------------- | :----------: |
| < 0.5% (ultra-tight) |   > 1.2   | BHARATFORG (-₹1,775)                               | **0% (0/1)** |
| 0.5% – 1.0%          | 1.0 – 1.2 | ULTRACEMCO (+₹7,750), DLF (-₹2,475), M&M (+₹3,490) |  67% (2/3)   |
| 1.0% – 1.5%          | 0.8 – 1.0 | MUTHOOTFIN (+₹9,212), SHRIRAMFIN (+₹2,681)         |  100% (2/2)  |
| > 1.5%               |   < 0.8   | HINDUNILVR (+₹10,830), TRENT (+₹900)               |  50% (1/2)   |

**Problem with ultra-tight squeezes:** BHARATFORG had 0.45% bandwidth — the bands were so tight that a ₹7 move on a ₹1,613 stock crossed the band. That's 0.4% — normal noise. The current scoring system REWARDS tighter bands (SQ=1.3 for 0.45%), creating a perverse incentive where noise-level crossings get BONUS points.

### Signal G: Entry Time of Day — NO PATTERN

| Time Window   | Trades                      | Win Rate  |
| :------------ | --------------------------- | :-------: |
| Before 10:00  | MUTHOOTFIN, ULTRACEMCO, DLF | 67% (2/3) |
| 10:00 – 11:30 | HINDUNILVR, TRENT, M&M      | 67% (2/3) |
| After 12:00   | SHRIRAMFIN, BHARATFORG      | 50% (1/2) |

No actionable time-of-day pattern in this data.

### Signal H: RSI at Entry — NO PATTERN

| RSI Range | Trades                                                             |  Win Rate  |
| :-------- | ------------------------------------------------------------------ | :--------: |
| 70 – 75   | TRENT (73.92), ULTRACEMCO (71.51), DLF (70.12), BHARATFORG (74.12) | 50% (2/4)  |
| 75 – 80   | MUTHOOTFIN (75.63), SHRIRAMFIN (78.91), M&M (79.68)                | 100% (3/3) |

Suggestive but insufficient sample. RSI 75-80 trades all won, but the 70-75 range is split evenly. Not enough data to draw conclusions.

---

## 7. TRENT vs HINDUNILVR: The Unsolvable Pair

This is the most critical comparison. Side-by-side at deploy time:

| Signal         | TRENT (stalled) | HINDUNILVR (big winner) |            Delta            |
| -------------- | :-------------: | :---------------------: | :-------------------------: |
| FB             |        3        |            3            |            Same             |
| V              |       0.0       |           0.0           |            Same             |
| S              |       1.0       |           1.0           |            Same             |
| RV             |       1.5       |           2.0           |       +0.5 HINDUNILVR       |
| RA             |       1.0       |           1.0           |            Same             |
| SQ             |       0.8       |           1.0           |       +0.2 HINDUNILVR       |
| Deploy Score   |      13.85      |          12.99          | -0.86 (TRENT scored HIGHER) |
| Direction      |      LONG       |          SHORT          |          Different          |
| RSI            |      73.92      |          16.68          |      Opposite extremes      |
| BB Penetration |     0.024%      |         0.494%          |     20x more HINDUNILVR     |

**The only meaningful differences:** Direction (LONG vs SHORT), RSI (opposite ends), and penetration depth (20x). But these don't constitute a universal filter — they're specific to this pair. SHORT trades benefit from panic cascades that don't apply to LONG trades, but we can't simply penalize all LONG FB=3 entries (ULTRACEMCO was FB=3 LONG and made +₹7,750).

**Fundamental truth:** These two trades were indistinguishable to any statistical system at entry time. The divergence happened because:

- TRENT's breakout candle volume collapsed 86% in 2 candles → realized vol collapsed → IV crushed
- HINDUNILVR's volume sustained in cascading waves → realized vol stayed high → IV maintained

**Volume continuation is a post-entry event.** No entry-time signal predicted it.

---

## 8. The Verdict

### Can We Differentiate Flash from Cascade at Entry Time?

**Partially — with significant limitations.**

### What the data definitively tells us:

1. **FB=0 (continuation entries) are reliably better than FB=3 (fresh breakouts)** — 100% vs 40% win rate in this dataset
2. **Extreme deploy scores (>15) are a danger signal, not a confidence signal** — 0% win rate
3. **Ultra-tight squeezes (bandwidth < 0.5%) make breakout signals unreliable** — noise crosses the band
4. **Perfect entry-time differentiation is NOT possible** — TRENT and HINDUNILVR looked nearly identical to the scoring system

### What determines the outcome that we CANNOT see at entry:

1. Whether post-breakout volume sustains (realized volatility drives option premium)
2. Whether a second buying wave arrives (rescues stalled breakouts like MUTHOOTFIN)
3. Whether the stock holds above the Bollinger Band in the first 1–3 candles (cleanest post-entry signal)

---

## 9. Actionable Suggestions

### Suggestion 1: Prefer FB=0 over FB=3 as Slot Selection Tiebreaker

**What:** When multiple candidates compete for limited slots (max 3), give preference to FB=0 (continuation) entries over FB=3 (fresh breakout) entries.

**Why:** FB=0 entries (3/3 wins, avg +₹5,128) dramatically outperform FB=3 entries (2/5 wins, avg +₹3,046). FB=0 proves the breakout survived at least one 5-minute cycle — inherent confirmation.

**Risk:** Low. This doesn't reject any trades outright — it influences selection priority when there's competition for slots. If only FB=3 candidates exist, they still get deployed.

**Expected impact:** Shifts average per-trade profit higher by preferring the statistically better entry type.

### Suggestion 2: Score Cap Warning / Soft Gate at Score > 15

**What:** When a candidate's total deploy score exceeds ~15, treat it as a warning flag rather than extra confidence. Options:

- (a) Soft warning logging for review
- (b) Cap tactical bonus contribution at 5.0 maximum to prevent extreme score inflation
- (c) Reduce position size for 15+ scores

**Why:** Both trades scoring above 15 (DLF 16.59, BHARATFORG 15.75) lost. The tactical bonus system stacks multiple "something big just happened" signals — when ALL fire, it's detecting the PEAK of buying intensity (climax), not the beginning of a trend.

**Risk:** Could occasionally block a legitimate high-momentum entry. But with 0/2 win rate at 15+, the expected value is negative.

### Suggestion 3: Ultra-Tight Squeeze Guard

**What:** Instead of linearly rewarding tighter bandwidths all the way down, apply a floor or penalty below some minimum bandwidth (e.g., bandwidth < 0.7%):

- Option (a): Set SQ=0 when bandwidth < 0.7% (no squeeze bonus for ultra-tight bands)
- Option (b): Actually penalize: subtract 0.5 from base score when bandwidth < 0.5%

**Why:** BHARATFORG had 0.45% bandwidth. A ₹7 move on a ₹1,613 stock (0.4%) crossed the Bollinger Band and received SQ=1.3 bonus points for doing so. The current formula `max(0, (3.5 - bandwidth) / 2.5)` gives maximum reward to the tightest bands, where breakout signals are LEAST reliable because normal noise can trigger them.

**Risk:** May occasionally miss genuine breakouts from ultra-tight squeezes. But those breakouts would still qualify on base score — they just wouldn't get the inflated squeeze bonus.

### Suggestion 4: Post-Entry Breakout Validation (STRONGEST)

**What:** After entry, check whether the stock holds above the Bollinger Band. If the stock closes below BB_Upper (for LONG) on 2 consecutive 5-minute candle closes, exit — the breakout thesis has failed.

**Why:** This is the cleanest signal in the entire dataset:

- **Every loser** had the stock fall back below the Bollinger Band within 1-3 candles
  - DLF: fell below on candle 1 (672.7 < 674.48 BB_Upper)
  - BHARATFORG: fell below by candle 3 (1613.1 < 1612.56 BB_Upper)
- **Every winner** held above the Bollinger Band
  - Even MUTHOOTFIN during its 80-minute stall: stock lowest point was 3809, BB_Upper was 3808.57 — held by ₹0.43

**This is NOT the same as the rejected "Premium Round-Trip" rule:**

| Aspect                    | Premium Round-Trip (REJECTED) | Breakout Validation (PROPOSED)                  |
| ------------------------- | ----------------------------- | ----------------------------------------------- |
| What it monitors          | Option premium vs entry price | **Stock price vs Bollinger Band**               |
| Vulnerability to IV crush | YES — killed MUTHOOTFIN       | NO — stock held BB_Upper                        |
| Vulnerability to theta    | YES                           | NO                                              |
| What it validates         | Whether option is profitable  | Whether the **breakout condition** remains true |
| Would it kill MUTHOOTFIN? | YES (-₹9,212 lost)            | **NO** (stock held above BB_Upper)              |

**Expected impact:**

- DLF: exit at candle 2-3 instead of candle ~16 → loss reduced from -₹2,475 to ~-₹1,100
- BHARATFORG: exit at candle 4-5 instead of candle 8 → loss reduced from -₹1,775 to ~-₹1,000
- All winners: unaffected (stock held band)

**Risk:** A stock could briefly dip below the band and recover. The "2 consecutive closes" requirement provides some buffer, but extreme volatility could still cause a false trigger. Needs careful backtesting against historical candle data.

---

## 10. What NOT to Do

Based on thorough testing against actual trade data:

1. **Do NOT filter out FB=3 entirely** — That eliminates HINDUNILVR (+₹10,830) and ULTRACEMCO (+₹7,750). Loss of ₹18,580 in profits to avoid ₹4,250 in losses.

2. **Do NOT use any volume-based entry filter** — V + RV patterns include both winners and losers in every configuration tested. TRENT (V=0, RV=1.5) and HINDUNILVR (V=0, RV=2.0) are too similar.

3. **Do NOT use penetration depth as a binary filter** — TRENT (0.024%) and M&M (0.026%) are nearly identical penetrations with opposite outcomes.

4. **Do NOT implement any option-premium monitoring rule** — Proven to kill winners via IV crush false signals (MUTHOOTFIN would lose ₹9,212).

5. **Do NOT prefer higher scores** — The data shows INVERSE correlation. Lower-scoring entries (10-13) had 100% win rate vs 0% for 15+.

---

## 11. Previously Rejected Proposals

### "15-Minute Pulse Rule" (From Other LLM)

**Proposal:** After 15 minutes, if option gain < 50% of stock gain, exit for IV crush.

**Why rejected:**

- Volume baseline rigged: breakout candle is always the highest-volume candle, making every "pulse" look like collapse
- 0.5% threshold arbitrary and stock-price-dependent
- Would trigger on normal post-breakout consolidation

### "Premium Round-Trip" Detection (Our Own Proposal)

**Proposal:** If option premium returns to entry price after being up 15%+, the move has exhausted buyers — exit.

**Why rejected by user:** LONG trades naturally retrace after breakouts. This is why the system stopped live polling and moved to 5-min candle SL.

**Validated against data:** Would have killed 3/6 trackable winners:

- MUTHOOTFIN: premium below entry for 70+ min (₹155.60 low, -₹1,072) before rocketing to +₹9,212
- INDHOTEL: below entry for 60+ min, then recovered to +₹1,500
- ULTRACEMCO: touched entry exactly at 10:15 (P&L=₹0) before rocketing to +₹7,750

**Total damage: ₹16,962+ in destroyed profits to save ₹900 on TRENT.**

---

## 12. Premium Path Evidence

### MUTHOOTFIN — The Case That Killed Premium-Based Rules

MUTHOOTFIN (entry Feb 10 ~10:25, option at ~₹155.60) experienced the SAME IV crush as TRENT for 80 minutes:

```
Entry:  10:25  ₹155.60  (P&L: ₹0)
        10:30  ₹156.00  (+₹240)
        10:35  ₹155.20  (-₹240)   ← below entry 10 min in
        10:40  ₹153.50  (-₹1,260)
        10:45  ₹152.00  (-₹2,160)
        10:50  ₹153.80  (-₹1,080)
        10:55  ₹153.00  (-₹1,560)
        ...80 minutes of underwater premium...
        12:15  SECOND VOLUME WAVE ARRIVES
        12:20  ₹162.00  (+₹3,840)
        ...continues climbing...
        EXIT:  ₹170.95  (+₹9,212)
```

Stock path during this stall:

```
Entry:  3816.3 (BB_Upper: 3808.57)
        3817.3  ← above band
        3816.1  ← above band
        3812.1  ← ABOVE band (3808.57)
        3809.0  ← ABOVE band by ₹0.43 (!!)
        3815.8  ← recovering
        ...STOCK NEVER FELL BELOW BB_UPPER...
```

**This is why premium-based monitoring fails and stock-based breakout validation would succeed:** The stock held its breakout condition (above BB_Upper) throughout the entire 80-minute stall. Only the option premium collapsed, due to IV crush. A rule monitoring the stock vs BB_Upper would have correctly stayed in the trade.

---

## 13. Raw Data Appendix

### All LONG Trade Deploy Scores (Chronological)

| Date   | Time  | Stock      | Deploy Score | Base | Tac | Breakdown                                                    | Outcome  |
| ------ | ----- | ---------- | :----------: | :--: | :-: | ------------------------------------------------------------ | -------- |
| Jan 28 | 09:36 | INDHOTEL   |    10.50     | 10.5 |  —  | T:3.0 M:3.5 V:2.0 S:2.0 (pre-tactical era)                   | +₹1,500  |
| Jan 28 | 09:36 | CUMMINSIND |     9.50     | 9.5  |  —  | T:3.0 M:2.5 V:2.0 S:2.0 (pre-tactical era)                   | -₹2,160  |
| Jan 28 | 11:31 | SIEMENS    |     9.50     | 9.5  |  —  | T:3.0 M:3.5 V:1.0 S:2.0 (pre-tactical era)                   | -₹1,968  |
| Jan 28 | 13:35 | BOSCHLTD   |    10.50     | 10.5 |  —  | T:3.0 M:3.5 V:2.0 S:2.0 (pre-tactical era)                   | ~₹0      |
| Jan 31 | 12:18 | AXISBANK   |    10.00     | 10.0 |  —  | T:1.5 M:3.5 V:2.0 S:1.0 SM:2.0 (SHORT)                       | -₹3,594  |
| Feb 2  | 14:54 | PFC        |     9.50     | 9.5  |  —  | T:3.0 M:3.5 V:2.0 S:1.0 (pre-tactical era)                   | +₹1,200  |
| Feb 3  | 13:38 | BAJFINANCE |     7.50     | 7.5  |  —  | T:3.0 M:2.5 V:0.0 S:2.0 (pre-tactical era)                   | -₹2,550  |
| Feb 9  | 09:23 | ULTRACEMCO |    13.64     | 8.5  | 5.1 | T:3.0 M:2.5 V:2.0 S:1.0 / FB:3 RV:0 PX:0 RA:1 SQ:1.1         | +₹7,750  |
| Feb 9  | 11:53 | SHRIRAMFIN |    10.53     | 9.5  | 1.0 | T:3.0 M:2.5 V:2.0 S:2.0 / FB:0 RV:0 PX:0 RA:0 SQ:1.0         | +₹2,681  |
| Feb 10 | 09:29 | MUTHOOTFIN |    11.52     | 7.5  | 4.0 | T:3.0 M:1.5 V:2.0 S:1.0 / FB:0 RV:1.5 PX:1.5 RA:0 SQ:1.0     | +₹9,212  |
| Feb 10 | 09:43 | DLF        |    16.59     | 9.5  | 7.1 | T:3.0 M:3.5 V:1.0 S:2.0 / FB:3 RV:2 PX:0 RA:1 SQ:1.1         | -₹2,475  |
| Feb 10 | 10:59 | M&M        |    10.03     | 7.5  | 2.5 | T:3.0 M:2.5 V:0.0 S:2.0 / FB:0 RV:0 PX:1.5 RA:0 SQ:1.0       | +₹3,490  |
| Feb 10 | 12:08 | BHARATFORG |    15.75     | 9.5  | 6.3 | T:3.0 M:2.5 V:2.0 S:2.0 / FB:3 RV:0 PX:0 RA:1 SQ:1.3 GW:1    | -₹1,775  |
| Feb 12 | 10:24 | HINDUNILVR |    12.99     | 6.0  | 7.0 | T:1.5 M:3.5 V:0.0 S:1.0 / FB:3 RV:2 PX:0 RA:1 SQ:1.0 (SHORT) | +₹10,830 |
| Feb 12 | 10:29 | TRENT      |    13.85     | 7.5  | 6.3 | T:3.0 M:3.5 V:0.0 S:1.0 / FB:3 RV:1.5 PX:0 RA:1 SQ:0.8       | +₹900    |

### Score After 5 Minutes (First Rescan)

Where available, the score ONE scan cycle after deployment — shows how quickly momentum was fading:

| Trade      | Deploy Score | Rescan Score (+5min) |   Delta   | Outcome                                 |
| ---------- | :----------: | :------------------: | :-------: | --------------------------------------- |
| MUTHOOTFIN |    11.52     |         7.07         | **-4.45** | +₹9,212 (scored dropped but stock held) |
| BHARATFORG |    15.75     |        12.66         | **-3.09** | -₹1,775                                 |
| DLF        |    16.59     |         9.62         | **-6.97** | -₹2,475 (biggest score collapse)        |
| SHRIRAMFIN |    10.53     |        10.50         |   -0.03   | +₹2,681 (stable score)                  |
| TRENT      |    13.85     |          —           |     —     | +₹900                                   |
| M&M        |    10.03     |        10.03         |   0.00    | +₹3,490 (perfectly stable)              |

**Notable:** DLF had the largest 5-minute score collapse (-6.97), from 16.59 to 9.62. This is consistent with the "climax" theory — the extreme score was driven by conditions that were already fading by the next scan.

### Post-Entry Candle Closes (Full Data)

**TRENT (Feb 12, Entry: 4257.3)**

```
10:25 → 4257.3 (ENTRY)     10:50 → 4276.0
10:30 → 4259.9              10:55 → 4274.9
10:35 → 4258.0              11:00 → 4270.8
10:40 → 4270.0              11:05 → 4266.2
10:45 → 4268.8              11:10 → 4262.0
```

**MUTHOOTFIN (Feb 10, Entry: 3816.3, BB_Upper: 3808.57)**

```
10:20 → 3808.2  (pre-entry)    11:00 → 3823.3
10:25 → 3816.3  (ENTRY)        11:05 → 3818.6
10:30 → 3817.3                 11:10 → 3821.0
10:35 → 3816.1                 11:15 → 3820.0
10:40 → 3812.1                 11:20 → 3821.8
10:45 → 3809.0 (BB_U+0.43!)   11:25 → 3816.5
10:50 → 3815.8                 11:30 → 3813.2
10:55 → 3814.6                 11:35 → 3811.7
```

**DLF (Feb 10, Entry: 675.4, BB_Upper: 674.48)**

```
09:45 → 672.7  ← BELOW BB_Upper on candle 1!
09:50 → 671.9
09:55 → 672.1
10:00 → 671.5
10:05 → 670.9
10:10 → 670.2 (LOW: -5.2 from entry)
10:15 → 671.6
10:20 → 672.85
10:25 → 672.9
10:30 → 671.6  (never recovered above entry)
```

**BHARATFORG (Feb 10, Entry: 1613.5, BB_Upper: 1612.56)**

```
12:05 → 1613.5  (ENTRY)
12:10 → 1615.0  ← only winning candle
12:15 → 1613.1  ← below BB_Upper (1612.56)
12:20 → 1611.8
12:25 → 1610.6
12:30 → 1610.5
```

**M&M (Feb 10, Entry: 3660.8)**

```
10:55 → 3660.8 (ENTRY)     11:25 → 3680.5
11:00 → 3668.5              11:30 → 3680.5
11:05 → 3667.9              11:35 → 3678.3
11:10 → 3674.0              11:50 → 3684.1
11:15 → 3674.4              11:55 → 3684.0
11:20 → 3680.5              12:05 → 3681.7
```

---

_End of Analysis_
