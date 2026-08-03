# Swing Ranking Historical Reconstruction and Optimization

**Research date:** 2026-07-21  
**Status:** Provisional research result; no live scanner configuration changed

## Data audit

The read-only momentum database contains:

- 2,326,248 daily OHLCV rows across 1,037 priced symbols.
- 3,867 sessions from 2011-01-03 through 2026-07-06.
- 50,047 monthly market-cap rows across 103 months from 2017-07 through 2026-01.
- 434–501 members per monthly snapshot.
- 46 symbol changes and 100 symbol mappings.
- 3,841 NIFTY500 benchmark sessions.

The monthly market-cap table supports a changing point-in-time universe and is substantially less biased than replaying today's constituents. It is not exact historical Nifty MidSmallcap 400 membership because `index_membership` is empty. Research approximated the target universe using market-cap ranks 101–500 from the prior completed month.

Resolved price coverage improved from 93.75% in August 2018 to 99.75% in February 2026. Unresolved names were excluded and reported; no prices were interpolated.

## Method

- Weekly as-of scans from 2021-01-01 through 2026-02-28: 270 dates.
- Universe: prior completed month market-cap ranks 101–500.
- Benchmark: NIFTY500, sliced strictly as of each signal date.
- Signal calculated at the weekly scan close.
- Entry from the next session using a pivot stop order.
- Order expiry, maximum gap, structural stop, target and holding period were parameterized.
- If stop and target occurred in one daily bar, the stop was assumed first.
- Costs: 10 bps slippage each execution model plus 25 bps round-trip charges.
- Maximum five ranked opportunities per scan and 28-day per-symbol cooldown.
- Validation folds: calendar years 2021, 2022, 2023 and 2024.
- Untouched holdout: 2025-01-01 through 2026-02-28.
- Search: 24 seeded, constrained Monte Carlo combinations.
- Robustness: 10,000 month-block bootstrap paths on the holdout finalist.

## Current strict baseline

The proposed 30/20/20/15/10/5 ranking combined with current strict scanner thresholds produced only one simulated trade across 270 weekly scans. It is too selective to estimate expectancy or optimize reliably.

This is an important negative result: the present strict gates and score should not be adopted as the final opportunity ranking merely because the lone trade won.

## Best adequately sampled result

Only one parameter set passed the minimum cross-fold safeguard of at least four trades in every validation year and at least 24 validation trades in total.

### Scanner thresholds

| Parameter                         | Result |
| --------------------------------- | -----: |
| RS percentile                     |     67 |
| RS slope sessions                 |     20 |
| Minimum impulse gain              |  26.9% |
| Minimum accumulation days         |      3 |
| Minimum volume dominance          |   1.60 |
| Maximum tightening depth          |  21.8% |
| Final tight-area sessions         |    3–9 |
| Maximum final tight-area depth    |   9.3% |
| Maximum pivot distance from SMA10 |   4.5% |
| Minimum upper-half closes         |      2 |
| Maximum ATR contraction ratio     |   0.84 |
| Maximum structural risk           |   6.2% |
| Sector percentile                 |     63 |

### Opportunity-score weights

| Component                   | Weight |
| --------------------------- | -----: |
| Entry structure             |  26.96 |
| Reward availability         |  19.23 |
| Momentum and trend          |  21.40 |
| Contraction and cleanliness |  13.58 |
| Recent demand               |  11.76 |
| Sector leadership           |   7.07 |

The weights are close to the proposed economic design. The data supported slightly less entry weight and slightly more momentum, demand and sector contribution. Entry structure plus reward availability still comprise 46.19% of the score.

### Execution parameters

| Parameter                 |      Result |
| ------------------------- | ----------: |
| Minimum opportunity score |          58 |
| Minimum chart room        |       1.02R |
| Entry validity            |  3 sessions |
| Maximum gap above pivot   |        2.5% |
| Profit target             |       2.37R |
| Maximum holding period    | 57 sessions |

## Performance

### Validation years 2021–2024

| Year | Trades | Expectancy | Target hit rate | Profit factor |
| ---- | -----: | ---------: | --------------: | ------------: |
| 2021 |      6 |     +0.03R |           33.3% |          1.04 |
| 2022 |      4 |     +0.61R |           50.0% |          2.13 |
| 2023 |     12 |     +0.87R |           58.3% |          2.90 |
| 2024 |      6 |     +0.02R |           33.3% |          1.03 |

All validation years had positive expectancy, but 2021 and 2024 were near breakeven. The edge was strongest in 2022–2023 and should not be assumed regime-independent.

### Full replay

- Trades: 38
- Expectancy: +0.413R
- Target hit rate: 44.7%
- Stop rate: 55.3%
- Profit factor: 1.68
- Worst 5% trade-tail mean: -1.135R
- Simplified sequential drawdown estimate: 4.33%

### Untouched 2025–February 2026 holdout

- Trades: 10
- Expectancy: +0.253R
- Target hit rate: 40.0%
- Stop rate: 60.0%
- Profit factor: 1.39
- Worst 5% trade-tail mean: -1.136R
- Simplified sequential drawdown estimate: 4.29%

### Holdout block bootstrap

Ten thousand month-block bootstrap paths produced:

- Positive-expectancy probability: 71.99%.
- Expectancy 5th percentile: -0.587R.
- Median expectancy: +0.253R.
- Expectancy 95th percentile: +1.046R.
- Maximum-drawdown 5th/median/95th percentiles: 2.14% / 5.30% / 9.35%.

The holdout remains small. Its confidence interval includes negative expectancy, so the result is promising rather than conclusive.

## Interpretation

1. The current strict configuration is too sparse for optimization.
2. The best stable sample supports a score centered on entry quality and reward, but momentum and context remain material.
3. A 3-session entry window performed better than waiting five sessions in the stable finalist.
4. A roughly 2.4R target and longer 57-session holding window fit the observed asymmetric winners.
5. Requiring 1.5–2.0R of old-high chart room was often too restrictive. However, the sampled 1.02R result may reflect the simplistic old-high resistance model and should not become a hard live threshold without better price-discovery handling.
6. Small high-return samples existed in other configurations but failed yearly sample safeguards and were rejected as overfit candidates.

## Decision

Do not change production settings yet. Treat the parameter set above as the center of a second-stage local search, not a mathematically proven optimum.

Before production consideration:

- Run a denser local search around this parameter region.
- Add exact historical index membership if obtainable.
- Verify corporate-action adjustment across known split, bonus, merger and demerger cases.
- Add daily confirmation around weekly signals.
- Paper-track the finalist prospectively for at least 30 independent triggered trades.
- Require positive expectancy, profit factor above 1.2 and acceptable drawdown in both historical holdout and prospective paper results.

## Reproducibility

Generated machine-readable artifacts are stored under `data/research/`. The optimization is deterministic for the configured seed. The live scanner, dashboard and trading controls were not modified.
