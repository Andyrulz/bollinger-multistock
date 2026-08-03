# Swing Screener System — Complete Reference

**Status:** Implemented and validated  
**Last updated:** 2026-07-20  
**Application mode:** Scanner only  
**Trading enabled:** No

## 1. Purpose and scope

The Swing application is an independently isolated NSE cash-equity research system inspired by Mark Minervini and Dan Zanger style momentum, trend, contraction, and relative-strength analysis.

Its current responsibilities are:

- Maintain a canonical daily market-data database.
- Scan every current Nifty MidSmallcap 400 constituent.
- Apply deterministic data, liquidity, market, trend, relative-strength, structure, sector, and risk gates.
- Show strict candidates and ranked research near misses.
- Calculate RRG-style sector rotation.
- Support a manual three-stage research workflow:
  1. Screener
  2. Secondary Watchlist
  3. Primary Watchlist
- Persist scanner evidence, watchlists, notes, priorities, sector context, and corporate-action QC.

The Swing application does **not** place orders, create GTTs, mutate positions, allocate capital, or share trading state with the Bollinger strategy manager. `tradingEnabled` remains `false` in Swing API responses. A Primary Watchlist entry means “actionable for manual review,” not “authorized for execution.”

---

## 2. Repository and process architecture

### 2.1 Application boundaries

The workspace contains two applications:

| Application           | Responsibility                                                                                                                | Default endpoint                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bollinger application | Zerodha OAuth/session owner, existing strategy manager, public dashboard, authenticated Swing proxy, read-only broker gateway | Public UI `localhost:3000`; broker gateway `127.0.0.1:3003` |
| Swing application     | Market-data synchronization, screening, sector rotation, watchlists, corporate-action QC                                      | `127.0.0.1:3002`                                            |

The Swing process is deliberately isolated from Bollinger strategy slots, positions, capital, schedules, cleanup, and order operations.

### 2.2 Authentication boundary

The Bollinger application is the sole Zerodha session owner.

Swing obtains read-only broker data through the Bollinger-owned broker gateway:

- `GET /auth/status`
- `GET /instruments/NSE`
- `GET /historical/:instrumentToken/day?from=YYYY-MM-DD&to=YYYY-MM-DD`

The Swing application:

- Stores no Zerodha API key or access token.
- Performs no OAuth flow.
- Cannot decrypt the Bollinger session.
- Receives no browser credentials through the proxy.
- Binds to loopback by default.

Browser requests use the authenticated Bollinger routes under `/api/swing/*`, which proxy to the internal Swing API.

### 2.3 Runtime configuration

| Variable                  | Default                       | Purpose                                 |
| ------------------------- | ----------------------------- | --------------------------------------- |
| `SWING_HOST`              | `127.0.0.1`                   | Swing API bind address                  |
| `SWING_PORT`              | `3002`                        | Swing API port                          |
| `SWING_SCANNER_CONFIG`    | `./config/scanner.json`       | Scanner configuration                   |
| `SWING_MARKET_DB`         | `./data/swing-market-data.db` | Canonical SQLite database               |
| `SWING_MOMENTUM_DB`       | `./data/momentum.db`          | Read-only historical bootstrap database |
| `SWING_OUTPUT_DIR`        | `./data/scans`                | Persisted scan reports                  |
| `BROKER_DATA_GATEWAY_URL` | `http://127.0.0.1:3003`       | Read-only broker gateway                |

---

## 3. User-facing pages

### 3.1 Screener

**URL:** `/swing`

The Screener provides:

- Runtime scanner parameters and presets.
- Live scanner phase and progress.
- Data refresh counts and target date.
- Result-list change reporting.
- Safety and corporate-action QC status.
- Research candidates and near misses.
- Strict candidates.
- Gate diagnostics.
- Add-to-Secondary controls beside every displayed symbol.

### 3.2 Secondary Watchlist

**URL:** `/swing/watchlist/secondary`

The Secondary Watchlist is the broad research shortlist. Entries are grouped into sector cards and ordered by sector quadrant:

1. Leading
2. Improving
3. Weakening
4. Lagging
5. Unavailable

Each entry retains its scanner snapshot, sector context, priority, and notes. A Secondary entry can be promoted to Primary or archived.

### 3.3 Primary Watchlist

**URL:** `/swing/watchlist/primary`

The Primary Watchlist contains manually selected actionable-review names after noise removal. An entry can be demoted to Secondary or archived. Promotion does not authorize an order.

### 3.4 Sector Rotation

**URL:** `/swing/sectors`

The Sector Rotation page displays interactive sector trails, quadrant labels, constituent counts, ratio, momentum, and candidate/watchlist context.

---

## 4. Universe and market-data architecture

### 4.1 Universe

The official universe source is the Nifty MidSmallcap 400 constituent CSV:

`https://www.niftyindices.com/IndexConstituent/ind_niftymidsmallcap400list.csv`

Each member carries:

- Symbol
- Company
- Industry
- Series
- ISIN

The scanner evaluates the complete universe. A near-miss or top-candidate limit affects only the number of ranked rows returned to the page; it does not reduce screening coverage.

Latest validated behavior:

- Universe members: 400
- Evaluated stocks: 400
- Industry mapping: 400/400
- Unmapped members: 0
- Industry groups: 20

### 4.2 Historical bootstrap

`swing-trading/data/momentum.db` is an immutable, read-only historical source. At the time of validation it contained:

- 2,326,248 daily rows
- 1,037 priced symbols
- Data from 2011-01-03 through 2026-07-06
- SQLite integrity result `ok`

`MomentumDatabaseAdapter` opens the source in query-only mode. The Swing application never modifies it.

### 4.3 Canonical market database

`swing-trading/data/swing-market-data.db` is the writable source used by the scanner. SQLite is configured with:

- WAL journal mode
- Foreign keys enabled
- Five-second busy timeout

The canonical source combines:

1. Validated historical bootstrap candles from `momentum.db`.
2. Incremental daily candles from Kite through the read-only gateway.
3. Kite reconciliation candles where corporate-action QC finds source disagreement.

### 4.4 Incremental synchronization

`MarketDataSyncService` runs these phases:

1. `BOOTSTRAP`
2. `INSTRUMENTS`
3. `CANDLES`
4. `BENCHMARK`
5. `COMPLETE` or `FAILED`

For each universe member it:

- Resolves the current NSE instrument token.
- Reads the symbol high-water mark.
- Requests only dates after the last checked session.
- Validates OHLCV before writing.
- Persists the sync state and failures.

The target date is the latest completed NSE session. Before 15:45 IST, the current date is not treated as a completed daily session. Weekends are skipped.

### 4.5 Benchmark

The canonical benchmark is Kite `NIFTY MIDSML 400`, token `266505` at the time it was established. Benchmark history is stored separately from stock candles.

A scan requires at least 200 benchmark candles. Insufficient benchmark history produces `BLOCKED_DATA_MIDSMALLCAP_BENCHMARK`.

### 4.6 Candle validation

A valid daily candle must have:

- Positive open, high, low, and close.
- Non-negative volume.
- `low <= high`.
- Open and close inside the low/high range.
- A `YYYY-MM-DD` session date.

Invalid source or incremental candles are recorded in `data_quality_issues` and are not exposed to screening as valid data.

---

## 5. Canonical database schema

### 5.1 Market data

- `instruments`: symbol metadata, industry, ISIN, series, token, active state.
- `daily_candles`: canonical stock OHLCV, source, quality state.
- `benchmark_candles`: canonical benchmark OHLCV.
- `sync_state`: symbol high-water mark and last synchronization status.
- `benchmark_sync_state`: benchmark high-water mark and status.
- `data_quality_issues`: unresolved invalid-data evidence.

### 5.2 Watchlists

- `watchlist_entries`: one active/persisted row per symbol, scanner snapshot, state, priority, notes, timestamps.
- `watchlist_history`: immutable transition and details-update audit records.

### 5.3 Corporate-action QC

- `corporate_actions`: official event, ex-date, type, subject, expected factor or cash amount.
- `corporate_action_qc`: per-action comparison, continuity result, mismatches, observed ratio, evidence.
- `corporate_action_policy`: singleton aggregate policy status and summary.

### 5.4 Schema versions

Migrations are idempotent. The current implementation records versions through version 5. The corporate-action tables were introduced with version 5; watchlist persistence was introduced with version 4.

---

## 6. Scanner execution lifecycle

### 6.1 Phases

A scan moves through:

`IDLE -> UNIVERSE -> DATA_SYNC -> SCREENING -> SECTOR_ROTATION -> SAVING -> COMPLETE`

Any exception changes the phase to `FAILED` and records the error.

### 6.2 Live progress feedback

The Screener polls status every second and displays:

- Current scanner phase.
- Animated running indicator.
- Progress bar.
- Current data-sync phase and symbol.
- Completed/total symbols and percentage.
- Updated-symbol count.
- Imported-candle count.
- Failed-symbol count.
- Target market-data date.
- Elapsed duration.
- Last completion time.

The Run button is disabled while a scan is active. Duplicate scan requests share the existing in-flight scanner promise rather than starting a second run.

### 6.3 Completion feedback

After completion, the page reports:

- Scan ID.
- Research and qualified counts.
- Symbols added to the research list.
- Symbols removed from the research list.
- “New list loaded” or “No changes from the previous research list.”

Refreshing or opening the page during a scan continues to show server-side progress. Results reload when completion time changes, even when deterministic inputs produce the same scan ID.

### 6.4 Scan report persistence

Each completed report is saved under:

`data/scans/{asOfDate}-{scanId}.json`

The report contains:

- Configuration version and runtime parameters.
- As-of and generated timestamps.
- Universe and data source.
- Global safety blocks.
- All 400 candidate evaluations and gate evidence.
- Strict top candidates.
- Ranked research near misses.
- Data-sync result.
- Benchmark source and warning, if any.

---

## 7. Global safety checks

Before interpreting a result as passed, the scanner evaluates:

| Condition                                 | Result code                                 |
| ----------------------------------------- | ------------------------------------------- |
| SQLite integrity is not `ok`              | `BLOCKED_DATA_DATABASE_INTEGRITY`           |
| Unresolved invalid OHLC rows exist        | `DATA_WARNING_SOURCE_HAS_INVALID_OHLC`      |
| Data exceeds allowed calendar age         | `BLOCKED_DATA_STALE`                        |
| Benchmark has fewer than 200 candles      | `BLOCKED_DATA_MIDSMALLCAP_BENCHMARK`        |
| Corporate-action policy is not `VERIFIED` | `BLOCKED_DATA_ADJUSTMENT_POLICY_UNVERIFIED` |
| Incremental sync has symbol failures      | `BLOCKED_DATA_SYNC_INCOMPLETE`              |
| Data sync globally fails                  | `BLOCKED_DATA_SYNC_FAILED`                  |

Research candidates remain visible when a global blocker exists so safety does not hide useful research evidence.

---

## 8. Screening methodology

The scanner is deterministic for a fixed universe, data date, configuration, and canonical database.

### 8.1 Data quality

`DATA_QUALITY` requires at least `minimumHistorySessions` valid ordered candles. Duplicate dates, invalid rows, and insufficient history fail the gate.

Default minimum: 260 sessions.

### 8.2 Liquidity

`LIQUIDITY` requires:

- Latest close at or above `minimumPrice`.
- 20-session mean traded value (`close * volume`) at or above `minimumAverageTradedValue`.

Defaults:

- Minimum price: ₹20
- Minimum average traded value: ₹10,000,000

### 8.3 Market environment

`MARKET_ENVIRONMENT` compares the latest Nifty MidSmallcap 400 close with its 10-session simple moving average.

The gate passes when:

`benchmark close > benchmark SMA(10)`

Modes:

- `REQUIRED`: a closed market gate rejects the stock.
- `WATCHLIST`: a fully passing stock can receive `WAIT_MARKET`.
- `IGNORE`: the market gate does not prevent research qualification.

### 8.4 Stage Two trend template

`STAGE_TWO` requires at least 252 sessions and all of the following:

- Close above SMA(50), SMA(150), and SMA(200).
- SMA(50) above SMA(150), and SMA(150) above SMA(200).
- SMA(200) above its value 20 sessions earlier.
- Close at least 25% above the 52-week low.
- Close within 15% of the 52-week high.

### 8.5 Relative strength

The stock’s weighted return is ranked against the complete available universe population. The relative-strength line against the benchmark must also have a positive slope over the configured number of sessions.

`RELATIVE_STRENGTH` passes when:

- RS percentile is at or above the configured threshold.
- Stock/benchmark relative-strength slope is positive.

Defaults:

- RS percentile: 80
- RS slope window: 15 sessions
- Return lookback: 252 sessions

### 8.6 Final tight area

`FINAL_TIGHT_AREA` searches windows between the configured minimum and maximum lengths and records the closest attempt even when none passes.

Checks include:

- Maximum depth.
- Minimum upper-half closes.
- ATR contraction.
- Distribution absorption.
- Volume contraction when required.
- Rising SMA(10) when required.
- Pivot proximity to SMA(10).
- SMA(10) location.

Defaults:

- Window: 3–10 sessions
- Maximum depth: 5%
- Maximum pivot distance from SMA(10): 2%
- Minimum upper-half closes: 3
- Maximum ATR contraction ratio: 0.6
- Require volume contraction: yes
- Require rising SMA(10): yes

### 8.7 Prior impulse

`PRIOR_IMPULSE` searches backward from the final tight area for a valid low-to-high move within the configured lookback.

Defaults:

- Lookback: 85 sessions
- Minimum gain: 30%

The detected structure is persisted as impulse evidence with low/high dates, prices, indices, and gain.

### 8.8 Accumulation

`ACCUMULATION` evaluates the impulse leg for constructive price/volume behavior, including accumulation-day count and advancing-versus-declining volume dominance.

Defaults:

- Minimum accumulation days: 2
- Minimum volume dominance: 1.5

### 8.9 Orderly tightening

`ORDERLY_TIGHTENING` evaluates the structure between the impulse and final tight area.

Defaults:

- Tightening window: 3–20 sessions
- Maximum tightening depth: 15%

The implementation also evaluates volume and range contraction.

### 8.10 Clean action

`CLEAN_ACTION` measures path efficiency and average overlap following the impulse high. It seeks orderly, overlapping action rather than erratic directional travel.

### 8.11 Thrust

`THRUST` evaluates impulse speed and counts wide-range advance sessions relative to ATR. It requires sufficient gain per session and at least one wide-range advance day.

### 8.12 Sector strength

For each industry, the scanner computes the median 63-session constituent return and ranks it against the sector population.

`SECTOR_STRENGTH` passes when the industry percentile is at or above the threshold.

Default threshold: 60.

### 8.13 Risk and chart room

Entry is the final-tight-area pivot. Stop is just below the final-tight-area low.

`RISK_REWARD` requires:

- Positive structural risk.
- Structural risk no greater than the configured maximum.
- A 25% target representing at least 5R.
- At least 2R of room to the 52-week high.

Default maximum structural risk: 5%.

---

## 9. Candidate statuses and output lists

### 9.1 Statuses

- `PASSED`: all applicable gates pass and no blocking data condition applies.
- `WAIT_MARKET`: stock structure passes in Watchlist mode, but the market gate is closed.
- `REJECTED`: one or more stock-level requirements fail.
- `BLOCKED_DATA`: stock structure passes but a blocking global data condition remains.

Each candidate records:

- Passed gate count.
- Evaluated gate count.
- Failed gate codes.
- Full per-gate evidence.
- RS percentile and liquidity.
- Structural risk, impulse, and tight-area evidence when available.
- Sector quadrant snapshot.

### 9.2 Strict candidates

`topCandidates` contains ranked non-rejected candidates and is truncated to the `topCandidates` parameter.

Default display limit: 10.  
Allowed range: 1–100.

### 9.3 Research candidates and near misses

`nearMisses` contains rejected names that passed both data quality and liquidity. They are ranked by:

1. Passed gate count.
2. Evaluated gate count.
3. RS percentile.
4. Average traded value.
5. Symbol.

Default display limit: 20.  
Allowed range: 0–100.  
Research preset limit: 50.

This is not a 20- or 50-stock scan limit. All 400 universe members are still evaluated and retained in `candidates` inside the complete scan report.

---

## 10. Configuration and presets

### 10.1 Operational default — Low-Risk Momentum Entry

| Parameter                       |     Default |
| ------------------------------- | ----------: |
| `minimumPrice`                  |          20 |
| `minimumHistorySessions`        |         260 |
| `minimumAverageTradedValue`     |  10,000,000 |
| `stageTwoMode`                  |  `LOW_RISK` |
| `relativeStrengthPercentile`    |          70 |
| `relativeStrengthLookback`      |         252 |
| `relativeStrengthSlopeSessions` |          15 |
| `impulseLookbackSessions`       |          85 |
| `minimumImpulseGain`            |        0.20 |
| `minimumAccumulationDays`       |           2 |
| `minimumVolumeDominance`        |         1.5 |
| `minimumTighteningSessions`     |           3 |
| `maximumTighteningSessions`     |          20 |
| `maximumTighteningDepth`        |        0.15 |
| `minimumFinalTightAreaSessions` |           3 |
| `maximumFinalTightAreaSessions` |          10 |
| `maximumFinalTightAreaDepth`    |        0.08 |
| `maximumPivotDistanceFromSma10` |        0.04 |
| `minimumUpperHalfCloses`        |           3 |
| `maximumAtrContraction`         |         0.8 |
| `requireVolumeContraction`      |        true |
| `requireRisingSma10`            |        true |
| `maximumStructuralRisk`         |        0.06 |
| `sectorPercentileThreshold`     |          60 |
| `maximumDataAgeCalendarDays`    |           4 |
| `topCandidates`                 |          20 |
| Runtime `nearMissLimit`         |          30 |
| Runtime `marketGateMode`        | `WATCHLIST` |

### 10.2 Runtime validation ranges

| Parameter                         | Range                   |
| --------------------------------- | ----------------------- |
| Minimum price                     | 1–100,000               |
| Minimum average traded value      | 100,000–100,000,000,000 |
| RS percentile                     | 0–100                   |
| RS slope sessions                 | 2–60                    |
| Minimum impulse gain              | 0–2                     |
| Minimum accumulation days         | 1–20                    |
| Volume dominance                  | 0.1–10                  |
| Maximum tightening depth          | 0.01–0.5                |
| Minimum final-tight-area sessions | 2–20                    |
| Maximum final-tight-area sessions | 2–30                    |
| Maximum final-tight-area depth    | 0.01–0.3                |
| Pivot distance from SMA(10)       | 0–0.25                  |
| Minimum upper-half closes         | 1–10                    |
| Maximum ATR contraction           | 0.1–2                   |
| Maximum structural risk           | 0.005–0.25              |
| Sector percentile                 | 0–100                   |
| Qualified output limit            | 1–100                   |
| Near-miss output limit            | 0–100                   |

The minimum final-tight-area window cannot exceed the maximum.

### 10.3 Presets

The server exposes exactly three consolidated profiles. Pattern names shown on candidates are setup labels inside a unified result set, not additional templates.

#### Low-Risk Momentum Entry

This is the operational default. It targets the common characteristics found across the Enviro, Sansera, J&K Bank, and Wabag case studies:

- Price above the 200-day average with improving trend structure.
- RS percentile of at least 70.
- Prior impulse of at least 20%.
- Final tight area no deeper than 8%.
- Pivot within 4% of SMA(10).
- Rising SMA(10) and contracting tight-area volume.
- Structural risk no greater than 6%.
- Market mode `WATCHLIST` so otherwise constructive candidates remain visible when the market gate is closed.

#### Strict Minervini

Uses the canonical strict configuration: mature Stage Two trend, RS percentile 80, minimum 30% impulse, 5% final-tight-area depth, 2% pivot distance, 5% maximum structural risk, and `marketGateMode = REQUIRED`.

#### Broad Research

- Stage Two mode: `RESEARCH`
- RS percentile: 65
- Minimum impulse gain: 15%
- Maximum final-tight-area depth: 12%
- Maximum pivot distance: 8%
- Maximum ATR contraction: 1.2
- Minimum upper-half closes: 2
- Volume contraction not required
- Rising SMA(10) not required
- Maximum structural risk: 8%
- Market mode: `IGNORE`
- Qualified limit: 30
- Near-miss limit: 50

Custom presets are stored in browser local storage. They do not alter the server configuration file.

### 10.4 Unified setup evidence and labels

Every stock with sufficient history receives daily-OHLCV-only setup evidence:

- Distance from the current and previous 52-week highs.
- SMA(10), SMA(20), SMA(50), and SMA(200) order and slopes.
- Unusual bullish-volume event count and maximum volume ratio.
- Defended bullish three-candle fair-value-gap count.
- Recent 60-session-resistance breakout evidence.
- Breakout level, date, and retest state.
- Tight-area volume contraction and pivot proximity.

Candidates can receive one or more explanatory labels:

- `EARLY_TREND_TRANSITION`
- `BASE_BREAKOUT_RETEST`
- `POST_BREAKOUT_TIGHTNESS`
- `POST_52W_HIGH_CONTINUATION`

These labels do not create separate scans. A unified low-risk score ranks candidates by trend improvement, entry tightness, demand evidence, prior impulse, leadership, and structural execution risk. Fundamentals are not inferred from OHLCV and are not silently treated as passed.

---

## 11. Sector rotation

### 11.1 Method

The sector page uses a transparent RRG-style model; it is not the proprietary JdK algorithm.

- Frequency: weekly.
- Sector return: median constituent weekly return.
- Relative-strength normalization: 26 weeks.
- Momentum lookback: 10 weeks.
- Configurable trail: 4–20 weeks; normal page values include 4, 8, 12, and 16.
- Benchmark: Nifty MidSmallcap 400.

### 11.2 Quadrants

| Condition                        | Quadrant    |
| -------------------------------- | ----------- |
| Ratio >= 100 and momentum >= 100 | `LEADING`   |
| Ratio >= 100 and momentum < 100  | `WEAKENING` |
| Ratio < 100 and momentum < 100   | `LAGGING`   |
| Ratio < 100 and momentum >= 100  | `IMPROVING` |

### 11.3 Candidate enrichment

Every candidate receives the exact scan-date sector snapshot where available:

- `sectorQuadrant`
- `sectorRsRatio`
- `sectorMomentum`
- `sectorRotationDate`

Candidate-to-sector-chart consistency was validated across the 400-member universe with zero snapshot mismatches during implementation QC.

---

## 12. Corporate-action adjustment QC

### 12.1 Why this exists

Unadjusted splits or bonuses can create false momentum, moving-average, impulse, breakout, ATR, and risk signals. Kite’s public historical-candle contract returns OHLCV but does not itself document a cash-equity adjustment guarantee. The system therefore validates observed history rather than assuming it.

### 12.2 Event authority and candle source

- Official event authority: NSE corporate-actions API.
- Candle comparison source: authenticated Zerodha Kite daily candles through the read-only gateway.
- Canonical comparison target: `swing-market-data.db`.
- Policy name: `KITE_CANONICAL_CONTINUITY`.

### 12.3 QC workflow

1. Fetch NSE corporate actions from 2024-01-01 through the current date.
2. Filter to active Nifty MidSmallcap 400 members and EQ series.
3. Parse bonuses, face-value splits, and dividends.
4. Select 20 unique symbols:
   - 10 structural actions (splits/bonuses).
   - 10 dividends.
5. Fetch a ±35-calendar-day Kite window around each ex-date.
6. Compare canonical open and close values against Kite within tolerance.
7. For splits and bonuses, verify the observed ex-session ratio behaves continuously rather than showing the announced mechanical discontinuity.
8. For dividends, verify source agreement and sensible continuity. Cash dividends are not total-return back-adjusted by this policy.
9. If canonical data disagrees with Kite, fetch a longer Kite history, overwrite that symbol’s canonical rows with source `COMMON_KITE_GATEWAY_CA_RECONCILIATION`, and rerun the comparison.
10. Persist each event, its QC evidence, and the aggregate policy.

### 12.4 Policy statuses

- `VERIFIED`: minimum sample met, structural actions included, and all selected comparisons pass.
- `FAILED`: adequate sample but one or more selected comparisons fail.
- `INSUFFICIENT`: fewer than the required unique symbols or no structural action evidence.

The scanner adds `BLOCKED_DATA_ADJUSTMENT_POLICY_UNVERIFIED` unless the persisted policy is `VERIFIED`.

### 12.5 Validated outcome

The completed end-to-end run produced:

- Status: `VERIFIED`
- Actions checked: 20
- Symbols checked: 20
- Splits/bonuses checked: 10
- Dividends checked: 10
- Canonical/Kite matches: 20/20
- Continuity passes: 20/20
- Failures: 0
- Histories reconciled: 16
- Kite rows written during reconciliation: 5,920
- Checked at: 2026-07-19T17:03:42.193Z

The Safety panel now displays the persisted evidence. A subsequent full scan evaluated 400 stocks with no global blocker and `tradingEnabled: false`.

### 12.6 Important interpretation

This policy verifies the selected sample and reconciles detected bootstrap disagreement. It is not a promise that every future corporate action will always be correct. QC should be rerun after material source changes, corporate-action parsing changes, or periodic operational review. A failed or insufficient rerun automatically restores the scanner blocker.

---

## 13. Watchlist workflow and persistence

### 13.1 States

- `SECONDARY`: broad research candidate.
- `PRIMARY`: manually curated actionable-review candidate.
- `ARCHIVED`: removed from active watchlists.

### 13.2 Adding from the Screener

A symbol can only be added using the complete candidate map from the latest scan. Requested symbols are deduplicated.

Behavior:

- New symbol -> Secondary.
- Existing Secondary -> remains Secondary without duplicate row.
- Existing Primary -> remains Primary; scanner re-addition cannot downgrade it.
- Archived symbol -> restored to Secondary using the latest scanner snapshot.

### 13.3 Transitions

- Secondary -> Primary: promote.
- Primary -> Secondary: demote.
- Secondary or Primary -> Archived: remove.
- Archived -> Primary is invalid.

Every transition is persisted in `watchlist_history`.

### 13.4 Notes and priority

Each entry supports:

- Notes up to 2,000 characters.
- Integer priority from 0 to 5.

List ordering is:

1. Priority descending.
2. Sector RS ratio descending.
3. Stock RS percentile descending.
4. Symbol ascending.

### 13.5 Snapshot semantics

The persisted candidate JSON preserves the scanner and sector evidence from when the symbol was added or restored. It includes source scan ID/date and configuration version so later reviews retain historical context.

---

## 14. API reference

All internal Swing list responses remain scanner-only and include `tradingEnabled: false` where applicable. Browser clients use the corresponding authenticated Bollinger prefix `/api/swing`.

### 14.1 Service and scanning

| Internal route        | Method | Purpose                                                          |
| --------------------- | ------ | ---------------------------------------------------------------- |
| `/health`             | GET    | Health, mode, running state, data-sync state                     |
| `/api/status`         | GET    | Scanner lifecycle, latest scan, blocks, database QC, sync status |
| `/api/sync/status`    | GET    | Detailed data-sync status                                        |
| `/api/config`         | GET    | Runtime defaults and presets                                     |
| `/api/results/latest` | GET    | Latest summarized scanner result                                 |
| `/api/gates`          | GET    | Aggregate pass/fail counts per gate                              |
| `/api/scan`           | POST   | Run a scan with validated parameters                             |

### 14.2 Sectors

| Internal route                  | Method | Purpose                               |
| ------------------------------- | ------ | ------------------------------------- |
| `/api/sectors`                  | GET    | Sector mapping and constituent counts |
| `/api/sectors/rotation?weeks=N` | GET    | Sector trails; `N` is clamped to 4–20 |

### 14.3 Watchlists

| Internal route                    | Method | Purpose                                     |
| --------------------------------- | ------ | ------------------------------------------- |
| `/api/watchlists/status`          | GET    | Active symbol-to-state map                  |
| `/api/watchlists/:state`          | GET    | Entries for Secondary, Primary, or Archived |
| `/api/watchlists/secondary/add`   | POST   | Add 1–100 latest-scan symbols               |
| `/api/watchlists/:symbol/state`   | POST   | Promote, demote, or archive                 |
| `/api/watchlists/:symbol/details` | POST   | Save notes and priority                     |

### 14.4 Corporate actions

| Internal route              | Method | Purpose                       |
| --------------------------- | ------ | ----------------------------- |
| `/api/corporate-actions/qc` | GET    | Read persisted policy         |
| `/api/corporate-actions/qc` | POST   | Run and persist end-to-end QC |

### 14.5 Public proxy examples

The public equivalents are:

- `/api/swing/status`
- `/api/swing/results/latest`
- `/api/swing/scan`
- `/api/swing/sectors/rotation`
- `/api/swing/watchlists/SECONDARY`
- `/api/swing/watchlists/secondary/add`
- `/api/swing/corporate-actions/qc`

All proxy requests pass through the common Bollinger authentication check.

---

## 15. Operating guide

### 15.1 Install and validate

From `swing-trading`:

- `npm run build`
- `npm test`
- `npm run qc:data`

From `bollinger-multistock`:

- `npm run build`
- `npm test`

### 15.2 Start services locally

Start the Bollinger application so the common session, public dashboard, and read-only gateway are available:

- In `bollinger-multistock`: `npm run dev`

Start Swing:

- In `swing-trading`: `npm run dev`

Expected endpoints:

- Dashboard: `http://localhost:3000/swing`
- Swing internal API: `http://127.0.0.1:3002`
- Broker gateway: `http://127.0.0.1:3003`

### 15.3 Run a scan

1. Open the Screener.
2. Choose a preset or edit parameters.
3. Select the market-gate mode.
4. Press **Run scanner**.
5. Observe universe, data refresh, screening, sector rotation, and saving phases.
6. Review whether market data changed and whether the research list changed.
7. Add useful names to Secondary.

### 15.4 Curate watchlists

1. In Secondary, group review by strong sector and quadrant.
2. Save notes and assign priority.
3. Promote only clean names to Primary.
4. Demote a name if it needs more development.
5. Archive invalidated or irrelevant names.

### 15.5 Run corporate-action QC

The authenticated endpoint is:

- `POST /api/swing/corporate-actions/qc`

The run uses official NSE events and authenticated Kite candles, can reconcile canonical history, and persists the result. It is intentionally not executed automatically on every normal scan because it makes multiple external requests and can rewrite historical rows for mismatched symbols.

---

## 16. Validation completed

### 16.1 Automated validation

At the end of the implementation and browser QC cycle:

- Swing build: passed.
- Swing tests: 9 suites, 23 tests passed.
- Bollinger build: passed.
- Bollinger tests: 2 suites, 43 tests passed.
- Relevant TypeScript/editor diagnostics: none.

### 16.2 Browser end-to-end validation

Validated scenarios include:

- Scanner lifecycle and progress feedback.
- 400/400 symbol processing.
- No-update data synchronization.
- Changed and unchanged research lists.
- Visible Add-to-Secondary controls.
- Duplicate-safe scanner additions.
- Secondary sector grouping and quadrant order.
- Notes and priority save/reload.
- Secondary -> Primary promotion.
- Primary -> Secondary demotion.
- Archive/removal.
- Watchlist persistence across Swing restart.
- Primary protection from scanner re-addition.
- Invalid payload and state responses.
- Unknown-symbol rejection.
- `tradingEnabled: false` safety responses.
- Corporate-action QC persistence and Safety panel reporting.
- Full scan after QC with no corporate-action blocker.

### 16.3 Latest recorded scan outcome after corporate-action QC

The post-QC full scan reported:

- Scan ID: `92c15e7c9b7bf6a5`
- As-of date: 2026-07-17
- Universe: 400
- Evaluated: 400
- Research rows returned: 20
- Strict qualified rows returned: 0
- Global blocks: none
- Trading enabled: false

The zero strict-qualified count means no stock passed the complete configured setup at that date and parameter set. It does not indicate that only 20 or 50 stocks were scanned.

---

## 17. Known limitations and future stages

### 17.1 Current limitations

- Scanner and manual curation only; no execution engine.
- Corporate-action parsing currently handles recognized NSE bonus, split/subdivision, and dividend subject formats.
- Cash dividends are checked for source agreement but are not converted into total-return-adjusted history.
- Corporate-action QC uses a representative 20-symbol sample per run, not every historical action in the database.
- Near-miss and top-candidate values are output limits, capped at 100 through the safe runtime schema.
- Current universe membership is refreshed per scan; this is not a point-in-time historical constituent service.
- Sector rotation is transparent RRG-style analytics, not proprietary JdK RRG.
- Market-gate and strict scanner results can legitimately be empty.

### 17.2 Planned system stages

Future work described by the Swing system specification includes:

- Entry planning and approval workflow.
- Position sizing.
- Stop-loss and risk-budget controls.
- First-target partial exit.
- Trailing-stop management.
- Broker reconciliation.
- Journal and performance analytics.
- Paper mode before any live mode.

None of those capabilities should be coupled to the Bollinger three-slot manager, and none should be enabled without a separate approved implementation plan, safety review, and end-to-end validation.

---

## 18. Key implementation files

| Area                                | File                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| Swing bootstrap and CLI             | `src/index.ts`                                              |
| API                                 | `src/app/ApiServer.ts`                                      |
| Scanner orchestration and lifecycle | `src/app/ScannerService.ts`                                 |
| Canonical database                  | `src/data/SwingMarketDatabase.ts`                           |
| Historical bootstrap adapter        | `src/data/MomentumDatabaseAdapter.ts`                       |
| Kite read-only provider             | `src/data/KiteReadOnlyDataProvider.ts`                      |
| Incremental synchronization         | `src/data/MarketDataSyncService.ts`                         |
| Corporate-action QC                 | `src/data/CorporateActionQcService.ts`                      |
| Universe provider                   | `src/data/OfficialUniverseProvider.ts`                      |
| Domain contracts                    | `src/domain/types.ts`                                       |
| Scanner                             | `src/screener/SwingScreener.ts`                             |
| Stage Two                           | `src/screener/StageTwoEvaluator.ts`                         |
| Structure detection                 | `src/screener/StructureDetectors.ts`                        |
| Relative strength                   | `src/screener/RelativeStrengthService.ts`                   |
| Candidate scoring                   | `src/screener/CandidateScorer.ts`                           |
| Sector rotation                     | `src/sectors/SectorRotationService.ts`                      |
| Scanner configuration               | `config/scanner.json`                                       |
| Public Screener UI                  | `../bollinger-multistock/src/ui/SwingDashboard.ts`          |
| Watchlist UI                        | `../bollinger-multistock/src/ui/WatchlistDashboard.ts`      |
| Sector UI                           | `../bollinger-multistock/src/ui/SectorRotationDashboard.ts` |
| Public routes and proxy             | `../bollinger-multistock/src/index.ts`                      |
| Read-only broker gateway            | `../bollinger-multistock/src/services/BrokerDataGateway.ts` |
| Swing HTTP proxy client             | `../bollinger-multistock/src/services/SwingServiceProxy.ts` |

---

## 19. Safety summary

The implemented Swing Screener provides broad research visibility without silently weakening safety:

- It scans all 400 current universe members.
- It distinguishes research output from strict qualification.
- It exposes data and scanner progress.
- It verifies and persists corporate-action evidence.
- It prevents a repeated scanner add from downgrading Primary.
- It retains immutable watchlist transitions.
- It keeps authentication and broker access inside the Bollinger boundary.
- It exposes no order or position mutation capability.
- It keeps `tradingEnabled` false.

This document describes the implemented system as validated through 2026-07-20. When scanner rules, data sources, schemas, safety policies, or watchlist behavior change, this document should be updated in the same change set.
