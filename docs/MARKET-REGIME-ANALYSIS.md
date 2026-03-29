# Market Regime Analysis Report

**Date:** March 29, 2026  
**Period Analyzed:** January 28 – March 25, 2026  
**Total Trades:** 175 (across 3 slots)  
**Data Sources:** NIFTY 50 daily/5min, India VIX daily, BankNIFTY daily (KiteConnect Historical API)

---

## Executive Summary

The Bollinger Band strategy is fundamentally a mean-reversion system. Its profitability is highly sensitive to market regime — specifically whether the market is oscillating within ranges (favorable) or trending smoothly (unfavorable). This analysis correlates all 175 multi-stock trades with external market parameters to identify which conditions produce profits vs losses.

**Key Finding:** The strategy has a structural edge in low-volatility choppy conditions and after narrow-range days. The primary source of loss is trading during smooth trending conditions in the VIX 13–20 range where the market moves just enough to trigger entries but trends just enough to stop them out.

> **Note:** The analyzed period was predominantly a downtrend (NIFTY fell from ~25,400 to ~22,800). Findings should be interpreted with this context — some patterns may be downtrend-specific rather than universal.

---

## 1. VIX Level Analysis

| VIX Level           | Trades | Win Rate  | Avg P&L   | Total P&L    |
| ------------------- | ------ | --------- | --------- | ------------ |
| **< 13 (Low Vol)**  | 40     | **42.5%** | **+₹534** | **+₹21,353** |
| 13–16 (Moderate)    | 69     | 31.9%     | -₹342     | -₹23,618     |
| 16–20 (Elevated)    | 36     | 30.6%     | -₹346     | -₹12,458     |
| **> 20 (High Vol)** | 30     | **36.7%** | **+₹336** | **+₹10,085** |

**Interpretation:** U-shaped performance curve. The strategy profits at both extremes of VIX:

- **VIX < 13:** Tight ranges, price oscillates within bands — mean-reversion works cleanly. Avg win: ₹3,165.
- **VIX > 20:** Large swings create big winners (₹2,285 avg win) that offset the lower WR.
- **VIX 13–20 (Dead Zone):** 105 trades, net loss of -₹36,076. The market moves enough to trigger entries but trends enough to run stops.

---

## 2. VIX Change Direction

| VIX Direction    | Trades | Win Rate  | Avg P&L   | Total P&L    |
| ---------------- | ------ | --------- | --------- | ------------ |
| **Falling > 3%** | 63     | 31.7%     | **-₹424** | **-₹26,694** |
| **Stable (±3%)** | 41     | **41.5%** | **+₹439** | **+₹17,989** |
| Rising > 3%      | 71     | 33.8%     | +₹57      | +₹4,067      |
| Spiking > 8%     | 56     | 37.5%     | +₹240     | +₹13,413     |

**Interpretation:** VIX falling = institutional fear receding = trend continuation = mean-reversion fails. VIX stable = range-bound conditions = ideal. VIX rising/spiking = volatility expansion creates larger moves that benefit the strategy's win magnitude.

---

## 3. Gap Analysis

| Gap Type                         | Trades | Win Rate  | Avg P&L   | Total P&L    |
| -------------------------------- | ------ | --------- | --------- | ------------ |
| Big Gap Down (< -0.5%)           | 34     | 32.4%     | +₹18      | +₹600        |
| Small Gap Down (-0.5 to -0.2%)   | 8      | 25.0%     | +₹370     | +₹2,959      |
| **Flat Open (-0.2 to +0.2%)**    | 67     | 31.3%     | -₹222     | **-₹14,888** |
| **Small Gap Up (+0.2 to +0.5%)** | 40     | **45.0%** | **+₹168** | **+₹6,731**  |
| Big Gap Up (> +0.5%)             | 26     | 34.6%     | -₹2       | -₹40         |

**Interpretation:** Small gap-up days produce the best results — directional bias creates cleaner Bollinger touches. Flat opens produce whipsaw within bands — no directional conviction.

---

## 4. ADR & Intraday Range

### Day Type vs ADR

| Day Type                   | Trades | Win Rate  | Avg P&L   | Total P&L    |
| -------------------------- | ------ | --------- | --------- | ------------ |
| **Narrow Day (< 70% ADR)** | 48     | **45.8%** | **+₹627** | **+₹30,116** |
| Normal Day (70–130% ADR)   | 75     | 22.7%     | -₹548     | **-₹41,096** |
| Wide Day (> 130% ADR)      | 52     | 42.3%     | +₹122     | +₹6,342      |

### Absolute ADR Level

| ADR Level    | Trades | Win Rate | Avg P&L | Total P&L |
| ------------ | ------ | -------- | ------- | --------- |
| ADR 0.8–1.2% | 106    | 33.0%    | -₹85    | -₹9,050   |
| ADR > 1.2%   | 69     | 37.7%    | +₹64    | +₹4,412   |

**Interpretation:** Normal-range days are the biggest source of loss (-₹41,096). The market does "just enough" to touch bands but has no clean reversion. Narrow days = oscillation within tight bands = ideal. Wide days can work because extremes create reversal opportunities.

---

## 5. Intraday Range at Entry Time

| Range at Entry       | Trades | Win Rate  | Avg P&L     | Total P&L    |
| -------------------- | ------ | --------- | ----------- | ------------ |
| Low (< 0.5%)         | 38     | 39.5%     | +₹128       | +₹4,867      |
| Medium (0.5–1.0%)    | 88     | 33.0%     | -₹156       | -₹13,712     |
| **High (1.0–1.5%)**  | 34     | **44.1%** | **+₹672**   | **+₹22,854** |
| **Extreme (> 1.5%)** | 15     | **13.3%** | **-₹1,243** | **-₹18,647** |

**Interpretation:** The 1.0–1.5% range is the sweet spot — enough movement for a meaningful Bollinger touch, but not momentum-entrenched. Above 1.5%, momentum dominates and mean-reversion fails catastrophically (13.3% WR).

---

## 6. Previous Day Pattern

| Previous Day                    | Trades | Win Rate  | Avg P&L   | Total P&L    |
| ------------------------------- | ------ | --------- | --------- | ------------ |
| **After Narrow-Range (NR) Day** | 67     | **43.3%** | **+₹429** | **+₹28,773** |
| After Normal-Range Day          | 68     | 35.3%     | -₹272     | -₹18,505     |
| **After Wide-Range Day**        | 40     | **20.0%** | -₹373     | **-₹14,906** |

**Interpretation:** NR day → next day expansion → Bollinger touches form at meaningful levels. This is a well-known pattern in volatility trading (NR4/NR7 setups). After wide-range days, trend continuation is likely → 20% WR.

---

## 7. NIFTY Trend (SMA Position)

| Condition               | Trades | Win Rate | Avg P&L | Total P&L   |
| ----------------------- | ------ | -------- | ------- | ----------- |
| NIFTY below SMA20       | 81     | 33.3%    | -₹131   | -₹10,630    |
| LONG + below SMA20      | 31     | 32.3%    | -₹447   | -₹13,846    |
| **SHORT + below SMA20** | 50     | 34.0%    | +₹64    | **+₹3,216** |

**Interpretation:** In a downtrend, SHORTs have an inherent edge. LONGs in a downtrend are fighting the trend. _However, this finding is heavily biased by the recent 2-month downtrend — in an uptrend, the relationship may invert._

---

## 8. NIFTY RSI(14) by Direction

| RSI Zone     | LONG Avg P&L     | SHORT Avg P&L        | Note               |
| ------------ | ---------------- | -------------------- | ------------------ |
| RSI < 45     | -₹331 (32.1% WR) | +₹106 (34.8% WR)     | SHORTs slight edge |
| RSI 45–55    | -₹1,522          | -₹411                | Dead zone for both |
| **RSI > 55** | -₹591 (15.4% WR) | **+₹462 (55.0% WR)** | SHORTs dominate    |

**Interpretation:** SHORTs when RSI > 55 = highest WR in the dataset (55%). LONGs when RSI > 55 = worst WR (15.4%). _Caveat: in a sustained uptrend, LONGs at high RSI may perform differently. The RSI > 55 SHORT edge is likely amplified by the downtrend context._

---

## 9. Bollinger Band Width (Volatility Compression)

| BB Width                  | Trades | Win Rate  | Avg P&L   | Total P&L   |
| ------------------------- | ------ | --------- | --------- | ----------- |
| Tight Squeeze (< P25)     | 21     | 38.1%     | +₹30      | +₹625       |
| Normal (P25–P75)          | 56     | 26.8%     | -₹442     | -₹24,743    |
| **Wide/Expanded (> P75)** | 9      | **44.4%** | **+₹890** | **+₹8,006** |

**Interpretation:** Normal BB width is the worst — bands are not tight enough to create reliable touches and not wide enough for mean-reversion magnitude. Limited sample on wide expansion (n=9).

---

## 10. Composite Regime Classification

| Regime                 | Trades | Win Rate  | Avg P&L   | Total P&L    |
| ---------------------- | ------ | --------- | --------- | ------------ |
| **Choppy + Low Vol**   | 27     | **44.4%** | **+₹602** | **+₹16,258** |
| Choppy + High Vol      | 18     | 33.3%     | -₹91      | -₹1,639      |
| Trending + High Vol    | 63     | 27.0%     | -₹260     | -₹16,386     |
| **Trending + Low Vol** | 25     | **24.0%** | **-₹610** | **-₹15,250** |

### Morning Session Regimes

| Condition                    | Trades | Win Rate  | Avg P&L | Total P&L |
| ---------------------------- | ------ | --------- | ------- | --------- |
| Calm Morning + LONG          | 14     | 42.9%     | +₹195   | +₹2,724   |
| Calm Morning + SHORT         | 28     | 25.0%     | -₹156   | -₹4,376   |
| **Volatile Morning + SHORT** | 20     | **45.0%** | +₹146   | +₹2,914   |
| Volatile Morning + LONG      | 9      | 33.3%     | +₹253   | +₹2,278   |

---

## 11. Daily P&L with Market Conditions

### Best Days

| Date   | VIX  | Gap%   | Day Return | Range Ratio   | P&L          |
| ------ | ---- | ------ | ---------- | ------------- | ------------ |
| Feb 9  | 12.2 | +0.76% | -0.08%     | 0.41 (Narrow) | **+₹14,347** |
| Feb 19 | 13.5 | +0.21% | -1.62%     | 1.88 (Wide)   | **+₹12,823** |
| Feb 12 | 11.7 | -0.18% | -0.38%     | 0.52 (Narrow) | **+₹11,519** |
| Mar 2  | 17.1 | -2.06% | +0.84%     | 1.59 (Wide)   | **+₹8,882**  |

### Worst Days

| Date  | VIX  | Gap%   | Day Return | Range Ratio    | P&L          |
| ----- | ---- | ------ | ---------- | -------------- | ------------ |
| Mar 5 | 17.9 | +0.55% | +0.61%     | 1.20 (Normal)  | **-₹15,020** |
| Feb 1 | 15.1 | +0.05% | -2.01%     | 2.38 (Extreme) | **-₹10,170** |
| Feb 3 | 12.9 | +4.86% | -2.21%     | 1.61 (Wide)    | **-₹9,207**  |
| Feb 2 | 13.9 | -0.12% | +1.18%     | 1.16 (Normal)  | **-₹8,660**  |

**Pattern:** Best days = low-VIX narrow days OR big-gap reversal days. Worst days = moderate-VIX normal-range days.

---

## 12. Composite Summary — Ranked Conditions

| Condition                     | Trades | WR%   | Avg P&L | Total P&L |
| ----------------------------- | ------ | ----- | ------- | --------- |
| VIX < 13                      | 40     | 42.5% | +₹534   | +₹21,353  |
| After NR day                  | 67     | 43.3% | +₹429   | +₹28,773  |
| VIX > 20                      | 30     | 36.7% | +₹336   | +₹10,085  |
| Morning LONG + calm open      | 14     | 42.9% | +₹195   | +₹2,724   |
| Morning SHORT + volatile open | 20     | 45.0% | +₹146   | +₹2,914   |
| Gap Up day                    | 66     | 40.9% | +₹101   | +₹6,691   |
| VIX rising > 3%               | 71     | 33.8% | +₹57    | +₹4,067   |
| Flat open day                 | 67     | 31.3% | -₹222   | -₹14,888  |
| VIX 13–16                     | 69     | 31.9% | -₹342   | -₹23,618  |
| VIX 16–20                     | 36     | 30.6% | -₹346   | -₹12,458  |
| After Wide day                | 40     | 20.0% | -₹373   | -₹14,906  |
| VIX falling > 3%              | 63     | 31.7% | -₹424   | -₹26,694  |

---

## Market Context Caveat

The entire analysis period (Jan 28 – Mar 25, 2026) was characterized by a sustained NIFTY downtrend from ~25,400 to ~22,800 (~10% decline). This means:

1. **SHORT bias findings** (SHORT + RSI > 55, SHORT + below SMA20) are likely amplified by the trending environment and may not hold in an uptrend or range-bound market.
2. **VIX findings** are more robust — VIX regime effects on mean-reversion should persist across market directions.
3. **NR day / range ratio findings** are regime-agnostic — volatility compression/expansion patterns work in any trend direction.
4. **Intraday range at entry** (the > 1.5% kill zone) is likely universal — momentum exhaustion thresholds are structural, not directional.

Recommendations should focus on filters that have a logical basis across all market environments, not just the recent downtrend.
