# NSE Swing Trading System — Product and Technical Specification

**Status:** Review draft 1.4  
**Scope:** Long-only NSE cash equities (`CNC`)  
**Style:** Rules-based momentum, trend-template, contraction, and breakout concepts inspired by publicly described Mark Minervini and Dan Zanger methods  
**Important:** This specification is an original rules-based implementation proposal, not a reproduction, endorsement, or guarantee of any trader's results.

## 1. Objective

Build an end-to-end swing-trading system that:

1. Maintains a liquid, tradeable NSE equity universe.
2. Ranks market, sector, and stock leadership.
3. Detects high-quality contraction and leadership-breakout setups.
4. Produces evidence-rich candidates and explicit rejection reasons.
5. Sizes every trade from account equity, stop distance, liquidity, and portfolio limits.
6. Places and reconciles entry orders safely.
7. Arms broker-side downside protection immediately after fills.
8. Takes a configurable first partial profit and trails the remaining position.
9. Persists all state across restarts and reconciles it against Zerodha.
10. Produces a complete decision and performance journal.
11. Supports exactly two operating modes: paper and live.

The first production version is long-only and delivery based. Short selling, derivatives, leverage, pyramiding, discretionary overrides, and fully autonomous gap exits are outside v1 unless separately approved.

## 2. Non-negotiable safety boundaries

- The existing Bollinger bot remains a separate application and keeps its three intraday slots, state, configuration, PM2 process, port, dashboard route, and deployment lifecycle.
- Swing trading has independent capital allocation, risk limits, position state, database, scanner schedule, dashboard, alerts, logs, and kill switches.
- No swing component may be registered as a Bollinger slot or be affected by Bollinger post-market cleanup.
- A single logical owner serializes all actions for each symbol; duplicate entry and exit commands must be idempotent.
- No filled position may be considered healthy until verified broker-side protection exists.
- If state and broker disagree, new entries stop and reconciliation takes priority.
- No live-order path is enabled merely by installing or starting the application.
- Configuration is schema validated and live mode requires explicit, auditable enablement.

## 3. Operating modes

| Mode    | Market data |     Simulated orders | Broker orders | Purpose                                  |
| ------- | ----------: | -------------------: | ------------: | ---------------------------------------- |
| `PAPER` |        Live | Yes, with fill model |            No | End-to-end validation without real money |
| `LIVE`  |        Live |                   No |           Yes | Real Zerodha CNC trading                 |

Historical replay and backtesting are test capabilities, not runtime operating modes. Switching to `LIVE` requires explicit, auditable configuration and successful startup reconciliation. There is no automatic switch from `PAPER` to `LIVE`.

## 4. Universe and data

### 4.1 Initial universe

- Constituents of the Nifty MidSmallcap 400 that are available as NSE cash equities through Zerodha.
- Exclude ETFs, indices, suspended securities, illiquid securities, surveillance/restricted lists where available, and instruments without sufficient history.
- Refresh index membership and instrument metadata daily and detect constituent, token, or symbol changes.

### 4.2 Liquidity filters

All values are configuration-driven. Initial proposals:

- Minimum price: ₹20.
- Minimum 20-day average traded value: ₹10 crore.
- Minimum 20-day median daily volume: configurable.
- Maximum proposed order participation: 2% of 20-day average daily volume.
- Reject abnormal spreads or stale quotes at entry time.

### 4.3 Required data

- Adjusted daily OHLCV history with corporate-action handling.
- Current and historical benchmark data.
- Sector/index membership and daily sector history.
- Intraday quote/candle data for entry confirmation and execution controls.
- Zerodha instruments, orders, trades, positions, holdings, and GTT state.
- Exchange calendar, holidays, and valid trading sessions.

Daily bars are complete only after the configured exchange close. Partial bars must never enter daily indicators as completed sessions.

## 5. Market and sector gates

### 5.1 Market regime

The mandatory entry benchmark is the Nifty MidSmallcap 400. New entries are permitted only when its latest completed daily close is above its 10-day simple moving average. A close at or below the 10-DMA blocks new entries while existing positions continue to be managed normally.

Broader context may also use the Nifty 50, with optional Nifty 500 confirmation.

A permissive regime initially requires:

- Benchmark close above 50-day, 150-day, and 200-day simple moving averages.
- 50-day MA above 150-day MA.
- 150-day MA above 200-day MA.
- 200-day MA rising versus 20 trading sessions earlier.

Regime values:

- `RISK_ON`: normal approved risk.
- `CAUTION`: reduced size and/or fewer entries.
- `RISK_OFF`: no new entries; existing positions remain managed.

The Nifty MidSmallcap 400 10-DMA condition is the mandatory binary gate and always takes precedence: no broader regime may permit an entry while that gate is closed. The broader regime may further block entries or reduce configured risk/frequency, but may never override the mandatory gate. Transitions, inputs, and reasons are journaled. Exact caution rules are an approval decision.

### 5.2 Sector leadership

Each stock is mapped to a sector or industry group. Sector scoring may combine:

- 1-, 3-, and 6-month relative return against the benchmark.
- Percentage of constituents above 50-day and 200-day MAs.
- Distance from sector 52-week high.
- Breadth trend and recent acceleration.

New entries require a configurable minimum sector percentile unless the setup qualifies for an explicitly approved exceptional-leadership rule.

## 6. Stock trend template

A candidate must initially satisfy:

1. Close above 50-day, 150-day, and 200-day SMA.
2. `SMA50 > SMA150 > SMA200`.
3. SMA200 greater than its value 20 sessions ago.
4. Close at least 25% above the 52-week low.
5. Close no more than 15% below the 52-week high.
6. Relative-strength percentile at least 80.
7. The benchmark-relative RS line is rising over the latest 15 completed trading sessions, representing three trading weeks.
8. Adequate history for every indicator.
9. Liquidity, price, and tradeability filters.

Every failed test is stored as a machine-readable rejection reason. Thresholds are configurable but versioned with each scan.

### 6.1 Mandatory seven-point buying framework

Every entry must pass all seven gates. Candidate scoring may rank survivors but may never override a failed gate.

1. **Market environment:** the latest completed daily close of the Nifty MidSmallcap 400 is above its 10-DMA.
2. **Stage 2:** the stock passes the complete trend template above, including the three-week rising RS line.
3. **Prior upward move:** an adjusted-price swing low to subsequent impulse high gains at least 30% within the prior 85 completed trading sessions before tightening begins.
4. **Clean price action:** the base is not choppy or erratic. The deterministic test uses candle overlap, directional efficiency, range consistency, and distribution evidence.
5. **Thrust:** the stock has demonstrated the ability to make forceful advances through prior rate of change, wide-range accumulation candles, volume expansion, and RS acceleration.
6. **Sector strength:** the stock's sector passes the approved sector-leadership threshold.
7. **Pivot at the 10-DMA:** the actionable pivot forms within the configured maximum distance of the stock's 10-DMA and still passes one-minute breakout confirmation at entry.

The scanner stores the inputs, pass/fail result, and rejection reason for each gate. Prior-move, accumulation-volume, tightening, and pivot thresholds are defined below. Remaining clean-action and sector thresholds must be configuration-driven and approved before implementation.

## 7. Setup detection

### 7.1 `VCP_BREAKOUT`

A volatility-contraction setup should demonstrate:

- A prior meaningful advance.
- Two or more contractions or pivots with generally decreasing price depth.
- Contracting volatility/range into the right side of the base.
- Drying volume near the pivot.
- Price holding above key trend levels.
- A deterministic pivot price and structural invalidation level.
- Adequate room to the first target and acceptable stop distance.

The algorithm must quantify each contraction, tolerate configurable noise, and retain the evidence used. It may not label a setup solely from a chart-image heuristic.

### 7.2 `LEADERSHIP_BREAKOUT`

A leadership breakout should demonstrate:

- Strong relative strength and sector leadership.
- A valid consolidation/base with a deterministic pivot.
- Tight closes or range contraction near the breakout level.
- Constructive volume behavior before the breakout.
- Breakout price/volume confirmation.
- Non-extension from pivot and moving averages.

### 7.3 Candidate scoring

A 0–100 score ranks valid setups, using versioned weighted components:

- Trend template and slope quality.
- Relative strength.
- Sector leadership.
- Contraction/base quality.
- Volume dry-up.
- Breakout volume potential/confirmation.
- Liquidity and execution quality.
- Reward/risk and distance from resistance.

Scoring ranks candidates; it never overrides a mandatory safety rejection.

### 7.4 Final tight area and actionable pivot

Location takes precedence over late confirmation. A candidate becomes actionable only when the setup itself supplies a nearby logical invalidation:

- The final tight area contains 3–10 completed daily candles.
- Its high-to-low depth is preferably 2%–4% and must not exceed 5%.
- At least three closes are in the upper half of the final tight area's total range.
- The average true range of its final three candles is no more than 60% of 20-day ATR.
- It contains no unabsorbed wide-range distribution candle.
- Volume contracts relative to the preceding 20-session baseline before breakout.
- Its depth is less than the preceding contraction's depth when a preceding contraction exists.
- The 10-DMA is rising and lies inside or immediately below the final tight area.

The actionable pivot is the highest resistance price of this final tight area immediately before expansion, not automatically the highest price of the entire base. Its structural invalidation is the low of the final tight area minus the approved execution buffer described in Section 9.1.

Pivot proximity is calculated as:

$$
\mathrm{PivotDistance} = \frac{|\text{Pivot}-\text{10DMA}|}{\text{Pivot}}
$$

- Preferred pivot distance: no more than 1.5%.
- Absolute maximum pivot distance: 2%.
- Reject a pivot materially below the 10-DMA or extended above it.
- Store the final-tight-area dates, pivot, structural low, 10-DMA, contraction statistics, and rejection evidence.

### 7.5 End-to-end screener specification

The daily screener identifies the chronological sequence:

$$
\mathrm{Prior\ Impulse} \rightarrow \mathrm{Accumulation} \rightarrow \mathrm{Orderly\ Tightening} \rightarrow \mathrm{Final\ Tight\ Area}
$$

Conditions from unrelated historical periods may not be combined to manufacture a passing setup.

#### 7.5.1 Prior impulse

Within the previous 85 completed trading sessions, identify an adjusted-price swing low followed by an impulse high that occurs before the tightening structure begins. Require:

$$
\mathrm{ImpulseGain} = \frac{\text{ImpulseHigh}-\text{SwingLow}}{\text{SwingLow}} \ge 30\%
$$

- The swing low must chronologically precede the impulse high.
- The move must not result from a bad tick, illiquid spike, stock split, or unadjusted corporate action.
- The impulse must be a sustained advance rather than a single isolated price spike.
- The impulse high anchors the subsequent tightening structure.

#### 7.5.2 Accumulation-volume confirmation

During the identified impulse leg, require at least two accumulation days. An accumulation day has all of the following:

- Close above the previous completed session's close.
- Close in the upper half of its own daily high-low range.
- Volume at least 1.5 times the median volume of the preceding 20 completed sessions.

Also require advancing-day volume to dominate declining-day volume over the impulse leg:

$$
\mathrm{VolumeDominance} =
\frac{\sum \text{Volume on Advancing Days}}
{\sum \text{Volume on Declining Days}}
\ge 1.5
$$

Zero-denominator and insufficient-history cases are rejected rather than treated as infinite strength.

#### 7.5.3 Orderly tightening

After the impulse high, require a tightening structure lasting 3–20 completed trading sessions:

- Total correction from impulse high is preferably no more than 10% and must not exceed 15%.
- Price ranges contract from left to right and later pullbacks are generally shallower than earlier pullbacks.
- Down-day volume diminishes as the structure matures.
- No more than one unabsorbed wide-range distribution day may occur in the tightening structure.
- The latest five-session median volume should be no more than 75% of the preceding 20-session median volume.
- Price remains consistent with the Stage 2 trend template and progresses toward the rising 10-DMA rather than breaking its broader structure.
- The tightening culminates in the 3–10-session final tight area defined in Section 7.4.

A wide-range distribution day closes below its open, has true range at least 1.5 times 20-day ATR, and volume at least 1.5 times the preceding 20-session median. A later recovery above that candle's high on constructive volume may mark it absorbed; the event and recovery must be retained as evidence.

#### 7.5.4 Mandatory screener pipeline

The post-close scan applies the following gates in order:

1. Confirm final daily bars, adjustments, exchange calendar, index membership, and minimum history.
2. Apply ₹20 minimum price, tradeability, liquidity, surveillance, and restriction filters.
3. Calculate the Nifty MidSmallcap 400 gate and broader regime; continue screening even when entry is blocked.
4. Apply the complete Stage 2 template, RS percentile of at least 80, and 15-session rising RS line.
5. Detect the chronological 30% prior impulse within 85 sessions.
6. Require two qualifying accumulation days and volume dominance of at least 1.5.
7. Require the 3–20-session orderly tightening structure.
8. Apply clean-price-action and thrust validation.
9. Apply mandatory sector-strength validation.
10. Classify the setup as `VCP_BREAKOUT` or `LEADERSHIP_BREAKOUT`.
11. Detect the final tight area, actionable pivot, structural low, and rising 10-DMA proximity.
12. Calculate intended entry and structural stop; reject total risk above 5%.
13. Require at least $5R$ to the configured target and $2R$ of unobstructed chart room.
14. Score only candidates that pass every mandatory stock-level gate.
15. Publish the top 10 ranked candidates to the watchlist.

When the Nifty MidSmallcap 400 gate is closed, qualified candidates are still published for preparation but marked `ENTRY_BLOCKED_MARKET_GATE`. A closed market gate never changes the stock's underlying setup score.

#### 7.5.5 Ranking

Passing candidates receive a versioned 0–100 ranking score:

- Stage 2 trend and relative-strength quality: 20 points.
- Prior-impulse speed, magnitude, and accumulation-volume quality: 20 points.
- Clean action and orderly tightening quality: 20 points.
- Sector leadership: 15 points.
- Final-tight-area quality and pivot proximity to the rising 10-DMA: 15 points.
- Liquidity, structural risk, chart room, and reward/risk quality: 10 points.

Scores rank candidates but do not compensate for failed mandatory gates. Ties are resolved by lower structural-risk percentage, then stronger RS percentile, then higher 20-day average traded value, then symbol ascending for deterministic output.

#### 7.5.6 Screener output and evidence

Each passing or rejected candidate stores enough evidence for deterministic replay. The top-10 output displays:

- Symbol, company, sector, rank, total score, and setup type.
- Market-gate and sector-gate states.
- Swing-low and impulse-high dates/prices, impulse gain, and impulse duration.
- Accumulation-day count and advancing/declining volume-dominance ratio.
- Tightening dates, duration, depth, contraction sequence, distribution events, and volume contraction.
- Stage 2 values, RS percentile, 15-session RS-line slope, and moving-average slopes.
- Final-tight-area dates/depth, actionable pivot, structural low, 10-DMA, and pivot distance.
- Intended entry, structural stop, risk percentage, estimated quantity, target, target $R$, and clear chart room in $R$.
- Liquidity statistics, data-quality flags, and all rejection or warning reasons.
- A chart view marking the impulse, tightening structure, final tight area, pivot, 10-DMA, and structural stop.

Fundamental fields such as earnings and sales growth may be displayed when reliable point-in-time data is available, but they are not mandatory rejection gates in v1.

#### 7.5.7 Scan schedule and publication

- Run the full scan after the exchange's official daily bars are complete.
- Perform a pre-open refresh of instruments, index constituents, corporate actions, restrictions, event flags, and data corrections.
- Recalculate affected candidates when refreshed inputs change; preserve both scan versions and reasons for additions, removals, or rank changes.
- Publish at most 10 active candidates to the daily watchlist.
- Never substitute an eleventh candidate intraday without creating and journaling a new watchlist version.

## 8. Entry qualification and execution

### 8.1 Entry checks

Before market hours, the scanner creates and ranks the valid watchlist from completed daily data. During market hours, the execution monitor evaluates every watchlisted symbol once at each completed one-minute boundary. It must not use a partially formed one-minute candle as a completed signal candle.

At every one-minute boundary, and again immediately before order placement, revalidate:

- Correct operating mode and trading day.
- Market regime and sector gate.
- Candidate freshness and setup version.
- Price at/through the pivot according to the approved trigger rule.
- Breakout volume or approved intraday confirmation.
- Maximum extension above pivot.
- Maximum opening gap and gap-chase policy.
- Current spread, depth, quote age, circuit limits, and liquidity.
- No existing holding, position, open order, GTT conflict, or symbol lock.
- Available cash, portfolio limits, open-risk limits, and broker health.
- Entry before the proposed 14:30 IST cutoff.

The one-minute job uses a singleton scheduler plus a per-symbol lock. A delayed or overlapping run must not process the same symbol-boundary pair twice. Each decision stores the boundary timestamp, signal inputs, rejection reason or entry decision, and data freshness.

### 8.2 Tight-entry trigger

A stock enters the active trigger zone when live price is within 0.5% below its actionable pivot. Entry requires one completed one-minute trigger candle that:

1. Trades through the pivot and closes above it.
2. Closes in the upper half of its own high-low range.
3. Has a bullish close above its open.
4. Passes spread, quote-freshness, and liquidity controls.
5. Shows demand confirmation using time-of-day-adjusted relative volume. Cumulative volume at the trigger boundary must initially be at least 1.5 times the median cumulative volume at the same elapsed market time over the previous 20 valid sessions.

The system submits a marketable-limit entry at the next execution opportunity only when the proposed maximum fill price is both:

- No more than 0.5% above the pivot; and
- No more than 20% of planned pivot-to-stop risk above the pivot.

The stricter limit applies. If price exceeds either limit, reject the entry as `BREAKOUT_EXTENDED`; never chase it. Recalculate stop width, reward/risk, quantity, spread, and portfolio limits using the proposed maximum fill price immediately before submission.

### 8.3 Order behavior

- Product: `CNC`.
- Exchange: `NSE` unless instrument metadata requires otherwise.
- Use a marketable-limit policy with explicit price protection; unbounded market orders are not the default.
- Orders have deterministic client correlation IDs and idempotency keys.
- Handle partial fills, rejects, cancellations, stale pending orders, and exchange closure.
- Recalculate actual risk from weighted-average fill price before arming protection.
- Do not increase quantity after a partial fill without a new approved action.
- A setup that becomes ready between boundaries is evaluated at the next completed one-minute boundary; the system does not chase it with unscheduled tick-level entry logic.
- Never average down: no order may increase a position below its weighted-average entry, while it is losing, or after setup invalidation.
- If the initial stop is hit, exit the entire remaining position. Do not retain a token tranche and do not loosen or cancel the stop merely because price may recover.

### 8.4 Fresh setup after a stopped trade

A previously stopped symbol may be purchased again because a later setup is a new trade, not an addition to the losing trade. Re-entry requires:

- The previous position is fully closed and all related orders, trades, holdings, and GTTs are reconciled.
- At least three new completed daily candles exist after the prior stop exit.
- A new base or contraction, pivot, invalidation level, and setup identifier have formed after the prior exit.
- All seven mandatory buying gates pass again using current data.
- Position size, stop, available cash, and portfolio risk are recalculated from scratch.
- The journal records a new trade and increments the symbol's `REENTRY_SEQUENCE`, enabling first-setup versus second-or-later-setup analysis.

There is no automatic rebound purchase and no reserved cash for the symbol. Eligibility is created only by the newly qualified setup.

### 8.5 Failed-breakout and no-progress exits

The structural GTT remains the absolute capital-protection stop. Additional behavior rules identify trades that fail to act correctly without reacting to ordinary one-minute noise:

- If the completed entry-day daily candle closes below the actionable pivot, record `BREAKOUT_FAILURE_WARNING` and store that candle's low.
- On the next valid trading day only, a trade below that warning-candle low exits the complete position using an idempotent marketable-limit order. If the low is not broken that day, the warning expires.
- During the first five completed trading sessions after entry, the trade should either reach at least $+1R$ intraday or produce constructive closes above the pivot.
- If it does neither and subsequently closes below the pivot or 10-DMA, store that candle's low and use the same next-valid-day low-break process to exit the complete position.
- Mere passage of five sessions does not force an exit while price remains tight and constructive above the pivot.

Whichever occurs first—the structural GTT stop or a confirmed behavior exit—owns the exit. After a fill, cancel and reconcile all obsolete orders and GTT quantities.

## 9. Stop placement and position sizing

### 9.1 Initial stop

The stop is derived from setup invalidation, not an arbitrary fixed loss. Candidate methods include:

- Below the final contraction low.
- Below the breakout-day or pivot structure low with an approved buffer.
- ATR-aware structural buffer to avoid normal noise.

Initial proposal:

- Preferred initial stop width is 2%–4% from the actual intended entry.
- The normal absolute maximum is 5%; reject wider setups rather than reducing quality through a distant stop.
- A stop narrower than 2% is allowed when supported by a genuine final tight area, valid liquidity, spread, and a non-zero structural buffer.
- Stop may only tighten after entry; it may never be loosened.

The initial stop is the final-tight-area low minus the greater of two valid price ticks, 0.10% of price, or a configured small fraction of 20-day ATR. The ATR component is capped so it cannot make total entry-to-stop risk exceed 5%. ATR protects against placing the stop exactly on an obvious level; it must never make a loose setup acceptable.

### 9.2 Risk sizing

For intended entry $E$, stop $S$, and per-share risk $R_s$:

$$R_s = E - S$$

For account equity $A$ and risk fraction $r$:

$$R_b = A \times r$$

Risk-limited quantity:

$$Q_r = \left\lfloor\frac{R_b}{R_s}\right\rfloor$$

Final quantity:

$$Q = \min(Q_r, Q_c, Q_p, Q_l)$$

where:

- $Q_c$ is available-cash quantity after fees and buffer.
- $Q_p$ is stock/sector/portfolio concentration quantity.
- $Q_l$ is liquidity/participation quantity.

Initial proposed limits:

- Risk per trade: 0.5% of account equity.
- Maximum concurrent positions: 5.
- Maximum combined initial open risk: 2.5%.
- Maximum one-stock allocation: 20%.
- Maximum sector allocation: 25%.
- No leverage in v1.
- No progressive exposure or external increase to the strategy's approved capital allocation. Realized sale proceeds return to available cash and may be reinvested only in a newly qualified setup that passes every current cash, concentration, and risk limit.

If calculated quantity is below one share or economic minimums, reject the trade rather than override risk.

### 9.3 Mandatory reward/risk gates

For intended entry $E$, structural stop $S$, configured first target $T$, and initial risk $R = E-S$:

$$
	ext{TargetRR} = \frac{T-E}{E-S}
$$

Before order submission:

- Require at least $5R$ from intended entry to the configured 25%–30% first target; prefer $6R$ or better.
- Require at least $2R$ of unobstructed chart room before meaningful overhead resistance.
- Recalculate both gates using the maximum permitted fill price, not the stale pivot price.
- Reject the candidate as `INSUFFICIENT_REWARD_RISK` if either mandatory gate fails. Candidate scoring cannot override this rejection.

## 10. Broker-side protection

Kite GTT provides single and two-leg OCO triggers using LIMIT orders; it is not a native trailing-stop system. Therefore:

1. After fill, arm broker-side protection immediately.
2. Verify the created trigger by fetching broker state.
3. Mark the position `PROTECTED` only after successful verification.
4. Retry transient failures with bounded backoff.
5. On unresolved protection failure, stop new entries, alert at critical severity, and follow an approved flatten/manual-intervention policy.

Protection uses three complementary controls:

1. **Broker protection:** the verified GTT is the primary stop and remains active even if the application is unavailable.
2. **Immediate broker events:** consume order, trade, and GTT postbacks as soon as Zerodha delivers them, with polling reconciliation as the source-of-truth fallback.
3. **Application watchdog:**
   - Use the existing one-minute market quote/candle cycle to compare every open position with its effective stop.
   - Every five minutes, fetch and verify each active GTT's status, symbol, trigger, limit price, and protected quantity.
   - If market price has crossed the effective stop but no triggered, pending, or completed protective exit exists, acquire the position lock and immediately reconcile orders, trades, positions, holdings, and GTT state.
   - If the breach remains unprotected after reconciliation, cancel obsolete protection where required, submit one idempotent emergency marketable-limit exit for the unprotected quantity, block new entries, and raise a critical alert.
   - Reconciliation and symbol-level idempotency must prevent the GTT and watchdog from producing duplicate exits.

The GTT is the absolute structural capital-protection backstop. The failed-breakout, no-progress, outside-day, target, and 10-/20-DMA rules are behavior or profit-management exits that may act earlier. Both remain active until one exit fills; the winning exit event then cancels or resizes every obsolete protective order. A behavior or trend rule may tighten effective protection but can never lower the structural GTT stop.

Proposed tranche model:

- Profit-target tranche: two-leg OCO GTT containing stop and configurable 25%–30% target limit legs for half the position.
- Standard runner tranche: single stop GTT protecting the quantity trailed through the 10-DMA process.
- Optional minor conviction tranche: separately protected single stop GTT for the quantity trailed through the 20-DMA process.

Any GTT modification must verify trigger values, order quantity, status, and instrument. On target fill, cancel/replace obsolete protection before updating state. Delivery sell authorization, DDPI, CDSL TPIN, circuit behavior, and overnight gaps must be tested operationally before live rollout.

## 11. Position lifecycle

Normal states:

`SCANNED → SETUP_READY → ENTRY_PENDING → PARTIALLY_FILLED | ENTRY_FILLED → PROTECTION_ARMING → PROTECTED → TARGET_1_FILLED → RUNNING → EXIT_PENDING → CLOSED`

Exceptional states:

- `ENTRY_REJECTED`
- `PROTECTION_FAILED`
- `BROKER_MISMATCH`
- `RECONCILIATION_REQUIRED`
- `MANUAL_INTERVENTION_REQUIRED`

Every state transition records timestamp, prior state, next state, source event, actor, setup/config version, broker references, and reason. Invalid transitions are rejected and alerted.

## 12. Profit taking and trailing exits

### 12.1 First target

Profit-taking parameters are editable in the portal, versioned, audited, and validated before activation:

- Configure the first target between 25% and 30% above weighted-average entry.
- Sell one-half of the then-open position when the configured target is filled.
- Return confirmed sale proceeds to available strategy cash. They may fund any newly qualified setup, including a fresh setup in the same symbol, but do not increase the strategy's approved capital allocation.
- Use deterministic integer rounding so every share is assigned and, where at least two shares are held, the partial sells at least one share.
- After a confirmed partial fill, resize and verify protection for every remaining tranche. Protection may never be loosened.

### 12.2 Runner classification

Classify post-breakout behavior from objective measures such as rate of change, ATR-normalized slope, extension from moving averages, consecutive range expansion, and volume. There are exactly two move types:

- `LINEAR`: price advances smoothly while moving alongside its moving averages and continues to display normal price action.
- `PARABOLIC`: the angle of ascent becomes progressively steeper and price extends materially away from its moving averages.

Classification changes are journaled and must be deterministic.
Classification is currently analytical and contextual: it does not change the approved 10-/20-DMA exit process unless deterministic parabolic sell-into-strength rules are separately approved.

### 12.3 Linear move rules

For the quantity remaining after any partial:

- **Standard runner:** use the 10-DMA close-then-next-day-low-break process defined below.
- **Minor conviction tranche:** when explicitly enabled, use the corresponding 20-DMA close-then-next-day-low-break process.
- The goal is to hold the trend while the stock continues normal linear action.

### 12.4 Parabolic move rules

For the quantity remaining after any partial:

- **Standard runner:** use the same 10-DMA close-then-next-day-low-break process.
- **Minor conviction tranche:** when explicitly enabled, use the corresponding 20-DMA close-then-next-day-low-break process.
- Parabolic classification provides context and may support separately approved sell-into-strength rules, but it does not silently replace the approved 10-/20-DMA exit process.
- The goal is to maximize gains while actively selling into strength as the move becomes extended.

The remaining quantity is split deterministically between standard and optional conviction tranches. The exact split and sell-into-strength criteria remain configuration decisions. If quantity is too small to create both tranches, the standard 10-DMA rule owns the remaining shares.

### 12.5 Exact moving-average trail exit

For a 10-DMA standard runner:

1. At the close of trading day $D$, detect that the completed daily candle closed below the completed 10-DMA.
2. Store day $D$ as the signal candle and its low as the immutable signal low. Do not exit merely because of the close below the average.
3. Only during the next valid trading day $D+1$, monitor live price at the normal one-minute boundaries.
4. If price trades below day $D$'s signal low on $D+1$, trigger one idempotent exit for the tranche at the next executable price using the approved marketable-limit policy.
5. If day $D+1$ never trades below the signal low, that signal expires at the end of $D+1$; it is not carried into later sessions. A later completed close below the 10-DMA may create a new signal for its own next trading day.

The optional conviction tranche applies the identical process using the 20-DMA. Exchange holidays are skipped when determining $D+1$. GTT protection remains active throughout and is never moved lower to accommodate this trailing process.

### 12.6 Market context and big outside day

- In an early bull market, favor riding normal linear winners for as long as their rules permit.
- In a late bull market, expect parabolic behavior more frequently and apply the tighter parabolic rules without anticipation or discretion.
- A **big bearish outside day** is a definitive profit-booking signal when a completed daily candle has a high above the previous session's high, a low below the previous session's low, and a close in the lower half of its own range.
- Detect the signal only after the official daily candle is complete. Queue the partial for the next valid trading session and submit it at the first valid one-minute execution boundary using the approved marketable-limit and slippage policy.
- Once confirmed, sell one-half of the quantity held when the signal occurs and journal `BIG_OUTSIDE_DAY_PARTIAL`. Keep structural GTT protection active until the partial fill is confirmed, then resize and verify protection for the remainder, which continues under its 10-DMA or optional 20-DMA rule.
- If an outside-day partial and profit-target partial become actionable concurrently, serialize them under the position lock and calculate each from confirmed remaining quantity. An event already represented by a pending or filled order must not be applied twice.
- Daily classification and exit decisions use completed bars only. Stops and protection may only tighten, never loosen.

Gap-through-stop fills are recorded at actual execution; the journal distinguishes planned risk from realized gap/slippage risk.

## 13. Reconciliation and recovery

Reconcile on startup, after authentication restoration, periodically while running, after each order/GTT event, and before shutdown:

- Local positions versus `getPositions()` for same-day CNC activity.
- Local positions versus `getHoldings()` for settled/overnight equity.
- Local open orders versus broker orders and trades.
- Expected protection versus broker GTTs.
- Quantities across entry fills, partial exits, holdings, and pending exits.

Rules:

- Broker truth is never blindly overwritten by local state.
- Unknown broker exposure blocks new entries and raises a critical alert.
- Missing local state is reconstructed into a reconciliation record, not silently adopted.
- Manual broker actions are detected and journaled.
- All recovery operations are idempotent.
- A daily encrypted backup and tested restore procedure are required.

## 14. Persistence and journal

Use a dedicated transactional SQLite database initially, with migrations and backups. Proposed entities:

- scan runs and configuration versions
- market and sector regime snapshots
- candidates, features, scores, and rejection reasons
- seven-point framework evidence and per-gate results
- setup pivots, contraction evidence, stops, and targets
- symbol setup sequence and prior stopped-trade references
- risk snapshots and sizing calculations
- position state transitions
- orders, broker trades, fills, and slippage
- GTT triggers and verification history
- holdings/positions reconciliation snapshots
- daily marks, stop changes, and classification changes
- realized/unrealized P&L and charges
- alerts, incidents, operator acknowledgements, and manual actions

Store enough immutable evidence to replay why a candidate was accepted, rejected, sized, entered, protected, modified, and exited.

## 15. Metrics

### 15.1 Trade metrics

- Gross and net P&L.
- Return and holding period.
- Initial risk in currency and percentage.
- $R$ multiple, where realized return is normalized by initial planned risk.
- MAE and MFE in price, percentage, and $R$.
- Entry, exit, and stop slippage.
- Gap loss beyond planned stop.
- Time to first target and final exit.
- Captured percentage of MFE.
- Charges and taxes.

### 15.2 Portfolio and strategy metrics

- Win rate and average win/loss.
- Expectancy in currency and $R$.
- Profit factor.
- Equity curve and high-water mark.
- Maximum and rolling drawdown.
- Exposure, cash utilization, and open risk.
- Consecutive wins/losses.
- Setup, sector, regime, score-decile, and holding-period attribution.
- First-setup versus second-or-later-setup attribution by symbol.
- Candidate-to-entry conversion and rejection distribution.
- Protection failures, reconciliation mismatches, and operational uptime.

Metrics are available lifetime, yearly, monthly, and on rolling 20-/50-/100-trade windows.

## 16. Dashboard and alerts

Dashboard sections:

- authentication and broker connectivity
- operating mode and live-order interlock
- market/sector regime
- scan status, ranked candidates, evidence, and rejection reasons
- pending entries and approvals, if enabled
- holdings, stops, targets, GTT verification, risk, and P&L
- portfolio exposure and risk-budget consumption
- reconciliation health and incidents
- journal, equity curve, drawdown, and attribution

Critical alerts include:

- filled but unprotected exposure
- rejected or unexpectedly cancelled protection
- broker/local quantity mismatch
- unknown broker position/holding
- repeated data staleness or scanner failure
- order reject or partial-fill timeout
- risk-limit breach
- authentication/session failure
- database write or backup failure

Alerts must be deduplicated, severity classified, acknowledged, and persisted.

## 17. Architecture

A single `SwingPortfolioStrategy` owns a portfolio of swing positions. It does not create one strategy instance per stock.

Planned components:

- `SwingUniverseService` — instruments, tradeability, sectors, and liquidity.
- `DailyCandleStore` — adjusted history, completeness, caching, and corporate actions.
- `MarketRegimeService` — benchmark regime.
- `SectorStrengthService` — sector ranking and breadth.
- `SwingScanner` — trend template, setup detection, scoring, evidence.
- `SwingRiskManager` — account/portfolio risk gates.
- `SwingPositionSizer` — deterministic sizing breakdown.
- `EquityExecutionService` — idempotent CNC order lifecycle.
- `GttProtectionService` — create, update, cancel, and verify protection.
- `SwingPositionManager` — lifecycle, partial exits, trailing, and recovery.
- `SwingReconciliationService` — orders/trades/positions/holdings/GTT truth.
- `SwingJournalService` — transactional journal and metrics.
- `SwingNotifier` — persistent severity-based alerts.

Shared Zerodha authentication may be extracted into a versioned common package or consumed through a safe broker-session boundary. The swing application must not copy credentials/session logic into an independently drifting implementation.

## 18. Scheduling

Initial proposed schedule in `Asia/Kolkata`:

- Post-close screener: finalize adjusted daily bars, run the complete Section 7.5 pipeline, rank passing candidates, and publish the provisional top 10.
- Pre-market: refresh instruments, Nifty MidSmallcap 400 constituents, corporate actions, restrictions, account, holdings, orders, GTTs, and prior daily bars.
- Pre-open: recalculate affected candidates, the Nifty MidSmallcap 400 10-DMA gate, broader market/sector state, and publish the versioned final top-10 watchlist.
- Market hours: evaluate the complete watchlist once per completed one-minute boundary, run the one-minute stop-breach watchdog for open positions, consume broker postbacks, and verify all active GTTs every five minutes.
- New-entry cutoff: 14:30 IST.
- Post-close: finalize daily bars; classify moves; evaluate entry-day failure warnings, no-progress conditions, outside-day partials, and 10-/20-DMA close signals; store signal-candle lows for monitoring on the next valid trading day; update protection, metrics, backups, and reports.
- On restart: authenticate, reconcile, restore protection health, then permit scanning/entries.

All jobs use exchange calendars and distributed/singleton locks to prevent duplicate execution.

## 19. Testing and acceptance

### 19.1 Required tests

- Unit tests for every indicator, filter, setup, score, size, state transition, and trailing rule.
- Golden-fixture scanner tests with fixed expected candidates and reasons.
- Chronology tests proving that impulse, accumulation, tightening, and final-tight-area evidence cannot be combined from unrelated periods.
- Golden tests for 30% low-to-high impulse detection, 85-session lookback, adjusted corporate actions, accumulation days, volume dominance, and 3–20-session tightening.
- Deterministic ranking and tie-break tests proving that only the top 10 are published.
- Property tests for quantity/risk invariants and monotonic stops.
- Broker-adapter contract tests with recorded/synthetic responses.
- Integration tests for partial fills, rejects, GTT failures, manual exits, restart, and reconciliation.
- Historical event replay with point-in-time data and no look-ahead.
- Failure injection for network loss, stale data, database failure, duplicate events, and process termination.
- One-minute boundary tests for missed, delayed, and overlapping scheduler runs.
- Stop-watchdog tests for GTT trigger races, skipped triggers, stale quotes, and duplicate-exit prevention.
- Golden tests for linear/parabolic classification, mandatory partials, moving-average exits, and big outside days.
- Tests for the three-week rising RS line and all seven mandatory entry gates.
- Golden tests for final-tight-area depth/duration, pivot calculation, 10-DMA proximity, trigger candles, time-adjusted relative volume, anti-chase limits, and $5R$/$2R$ gates.
- Safety tests proving that losing positions cannot be increased and initial-stop exits close the entire remainder.
- Behavior-exit tests for entry-day pivot failure, five-session no-progress assessment, next-day signal expiry, and races against the structural GTT.
- Re-entry tests proving that a fully reconciled new setup receives a new identifier, risk calculation, and sequence number.
- Capital tests proving that sale proceeds can be reused without increasing approved strategy capital.
- Trail tests proving that a close below 10-/20-DMA does not exit immediately, only a signal-low break on the next valid trading day exits, and an unbroken signal expires after that day.
- Paper-mode soak testing over multiple market conditions.

### 19.2 Safety invariants

- No quantity exceeds any sizing cap.
- Aggregate planned risk never exceeds the configured limit.
- Stop never loosens.
- No losing position is averaged down; an initial-stop hit exits the complete remaining quantity.
- No entry is submitted above either anti-chase ceiling or below either mandatory reward/risk threshold.
- Every live filled quantity has a verified structural GTT until it is confirmed exited.
- Filled quantity always equals remaining plus confirmed exits.
- No healthy live position lacks verified protection.
- Replaying an event cannot duplicate an order or state transition.
- New entries remain blocked whenever reconciliation is unhealthy.

### 19.3 Promotion gates

Enabling live mode requires, at minimum:

- Clean build and tests.
- Completed broker sandbox/paper scenarios.
- Successful restart/recovery drills.
- Verified CNC and GTT authorization behavior.
- Zero unresolved protection and reconciliation defects.
- Approved capital and per-trade caps.
- Human-observed initial live trades under minimal configured capital and position limits before increasing exposure.

## 20. Delivery phases

1. **Specification lock:** approve rules, thresholds, capital model, trailing behavior, alerts, and operations.
2. **Foundation:** independent app, configuration schema, database, broker boundary, calendar, logging, health checks.
3. **Data and scanner:** universe, candles, regime, sectors, trend template, setups, scoring, evidence, replay.
4. **Risk and simulation:** account model, sizing, portfolio gates, paper fills, journal, dashboard.
5. **Broker safety:** CNC execution, GTT protection, postbacks/polling, reconciliation, recovery, failure injection.
6. **Paper proving:** paper-mode soak, incident runbooks, backups, and performance review.
7. **Live enablement:** explicit review followed by minimal capital/positions and heightened monitoring; limits increase gradually and remain reversible.

## 21. Decisions required before implementation

1. Minimum 20-day median volume and final average-traded-value/liquidity thresholds; the initial universe is the Nifty MidSmallcap 400.
2. Broader benchmark regime transition rules and risk reduction in `CAUTION`; the Nifty MidSmallcap 400 above its 10-DMA is mandatory for new entries.
3. Sector classification source and minimum sector score.
4. Exact swing-point and contraction-segmentation algorithm; the approved tightening duration is 3–20 sessions, maximum depth 15%, and final-tight-area rules are in Section 7.4.
5. Exact leadership-breakout criteria and volume confirmation.
6. Relative-strength formula, comparison benchmark, and percentile window; the RS line must rise over 15 completed trading sessions.
7. Maximum opening-gap and gap-chase policy; pivot trigger and anti-extension rules are approved in Section 8.2.
8. Exact capped ATR fraction used in the approved final-tight-area structural-stop buffer.
9. Risk per trade, portfolio capital allocated, and all concentration limits.
10. Exact portal default within the approved 25%–30% first-target range.
11. Standard 10-DMA/minor 20-DMA tranche split and deterministic integer-share allocation after half-position partials.
12. Whether and when protection should move to breakeven after a partial, without loosening a tighter stop.
13. Objective linear/parabolic classification thresholds.
14. Exact parabolic sell-into-strength criteria; absent approval, the common 10-/20-DMA trail applies.
15. Marketable-limit parameters for profit partials, outside-day partials, and next-day signal-low exits.
16. Automated response to earnings, corporate actions, and circuit events; big bearish outside-day behavior is approved above.
17. Entry order type, maximum slippage, timeout, and partial-fill policy.
18. Protection-failure flattening policy and authorization prerequisites.
19. Earnings/event-calendar data source and blackout windows.
20. Notification channels and human acknowledgement/escalation timings.
21. Approval workflow: fully automatic, candidate approval, or entry approval.
22. Initial live capital, duration, and trade count; no progressive exposure or automatic increase to approved capital is allowed.
23. Remaining clean-price-action thresholds; the 30% prior impulse, accumulation-volume, tightening, final-tight-area, pivot-distance, and core thrust rules are approved in Sections 7.4–7.5.

Until these decisions are approved and encoded in versioned configuration, this folder remains non-executable by design.
