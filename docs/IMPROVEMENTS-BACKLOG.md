# Improvements Backlog

Tracked list of proposed, non-urgent improvements. Each entry is **analysis only** — nothing here is implemented until explicitly approved and QC'd. Add new items at the top of the relevant priority section.

Status legend: `PROPOSED` · `PLANNED` · `IN-PROGRESS` · `DONE` · `REJECTED`

---

## Performance / Cost

### IMP-001 — Stateful scanner candles: seed once, append from quotes every 5 min

- **Status:** PROPOSED (2026-06-17, **reframed 2026-06-19**)
- **Area:** `src/services/MarketScanner.ts` (`cacheHistoricalData`, `scoreStocks` batched-quote block), `src/core/StrategyManager.ts` (`runHourlyScan` "fresh data is mandatory" re-fetch)

**Problem.** Every 5-minute scan (60×/day, 09:23–14:58) the scanner re-downloads the **full 10-day, 5-minute history for all ~108 universe stocks** (`cacheHistoricalData` full `Map.set` replace). Old 5-min bars are immutable; the only thing that changes between scans is **one newly-completed candle per stock**.

**The real cost is the number of rate-limited CALLS, not the payload (corrected 2026-06-19).** Kite's historical endpoint is **one instrument per request** (no batch). The scanner paces batch-of-2 + 1 s = ~54 batches ≈ **54 s/scan**, and each call (~40 ms) is trivial — the wall-clock is dominated by rate-limit pacing, not data size. So:

| Approach                                  | Historical calls/cycle        | Pacing    | Call-count saving                         |
| ----------------------------------------- | ----------------------------- | --------- | ----------------------------------------- |
| Today (10-day re-pull)                    | 108                           | ~54 s     | —                                         |
| **Simple 10→5-day cut**                   | **108**                       | **~54 s** | **0%** (only bandwidth shrinks)           |
| **"Fetch just the new candle" per stock** | **108**                       | **~54 s** | **0%** (historical has no batch endpoint) |
| **Quote-driven append (this plan)**       | **~108 once at seed, then 0** | ~0 s      | **~98%**                                  |

≈ **6,480 historical calls/day** today. Neither the day-window cut nor a naive incremental-historical loop reduces that — both still make one historical call per stock per cycle. **Only building the new candle from the batched quote the scanner already fetches removes the calls.**

**Why this is the right lever (and WebSocket is out).** The scanner **already batch-fetches quotes for all ~108 stocks every cycle** in groups of 40 (`getQuote(batch)`, [MarketScanner.ts L527](src/services/MarketScanner.ts#L527)) — but currently only reads `upper/lower_circuit_limit` and `ohlc.close` from the response. The same response carries `last_price` and day-cumulative `volume`, which is enough to build the latest 5-min candle. **WebSocket (KiteTicker) is explicitly out of scope** — it was deliberately removed earlier ("Predictive WebSocket removed — using pure REST API", [BollingerBandStrategy.ts L2519](src/strategies/bollinger-band/BollingerBandStrategy.ts#L2519)); the quote-aggregator stays within the chosen pure-REST architecture.

**Genuine lookback need — traced precisely (2026-06-17): the 10-day window is ~2.5× more than required.** Every consumer of the cached array in `scoreStocks()`:

| Consumer                                                                                        | Needs                                                                                                      | Days                               |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `candles.length < 50` guard ([L555](src/services/MarketScanner.ts#L555)); RVOL-20, Bollinger-20 | fixed/short window                                                                                         | <1 day                             |
| 15-min RSI-14 (derived)                                                                         | ~14–20 derived bars                                                                                        | ~1 day                             |
| EMA-8/21/50, RSI-14, ADX-14, 5m Supertrend                                                      | iterate full array but **convergent** — value set by recent ~150–200 bars; older bars' weight decays to ≈0 | ~2–3 days                          |
| **1-hour Supertrend** ([L721](src/services/MarketScanner.ts#L721))                              | `candles60m.length >= 20` → 20 hourly bars ≈ **3.2 trading days**                                          | **~3–4 days ← binding constraint** |
| **VWAP** ([L1975](src/services/MarketScanner.ts#L1975))                                         | sums the **entire** array → genuinely consumes all 10 days                                                 | see sub-finding                    |

So only **two** things touch all 10 days: (a) the convergent indicators (EMA/RSI/ADX/ST) iterate them but the _numbers don't change_ vs ~4 days; (b) VWAP actually accumulates over the whole window. **Conclusion: ~4–5 trading days (~300–375 five-min candles) gives byte-identical momentum scores.** The seed in step 1 below should therefore be **~5 days, not 10**.

Two corroborating facts:

- **The 10-day data passed to each deployed strategy is redundant.** `StrategyManager` attaches `scannerData.historicalData` ([L2008](src/core/StrategyManager.ts#L2008)), but the strategy **ignores it and re-fetches its own 7 days** on `start()` (`loadHistoricalDataWithFallback`, [L664](src/strategies/bollinger-band/BollingerBandStrategy.ts#L664)). Fetched, attached, never read.
- **ADR / wide-range filter does not use the 5-min cache** — it uses a separate **daily**-candle fetch (last 6 daily bars) in pivot calc ([L2209](src/strategies/bollinger-band/BollingerBandStrategy.ts#L2209)), and that filter is OFF anyway.

**Sub-finding — VWAP is mis-anchored (latent inaccuracy, fix alongside this work).** `calculateVWAP(candles)` does a cumulative volume-weighted average over the **whole array** (currently 10 days). A 10-day cumulative "VWAP" is not the intraday VWAP traders use — it barely moves, so the Trend-score component "Close > VWAP" (+1.5) is almost always true for any uptrending name (near-free points). It is the **only** consumer whose _output_ materially changes with window length. Shortening the window does not break it — it makes it _more_ correct. **Action: re-anchor VWAP to intraday (daily reset / session-anchored), independent of the candle-window size.** This means VWAP is _not_ a reason to keep 10 days.

**Implementation plan — quote-driven stateful aggregator (gate behind `enableIncrementalScannerCandles`, default false).**

_Phase 0 — Persisted candle store (enables "seed once, ever")._ Persist `cachedHistoricalData` to disk (e.g. `data/cache/scanner-candles.json`, trimmed window only). On boot, load it; if the newest candle is **fresh** (gap ≤ ~2 bars and same trading day region), resume appending; if **stale/missing** (restart after hours, weekend, long gap), reseed. Given the VM's daily restart this is effectively a once-per-day seed today; if the process stays up it becomes **once, ever** (the user's goal).

_Phase 1 — Seed (historical, the ONLY place historical is used)._ When cache is missing/stale, do the **~5-day** historical pull (per the lookback finding above — enough for 1h-ST ≥20 hourly bars + holiday margin), reusing the existing batched fetch. Mark `isDataCached`.

_Phase 2 — Per-cycle append from the batched quote (removes the 108 historical calls)._ In `runHourlyScan`, **drop the mandatory `cacheHistoricalData()` re-fetch**. Extend the existing `scoreStocks` quote block ([L527](src/services/MarketScanner.ts#L527)) to also capture `last_price` and `volume`, build the latest 5-min candle per stock, and **append+dedup** into the store using the proven `floorTo5Min` + dedup/update-in-place logic from `BollingerBandStrategy`. Trim to ~375 candles (~5 days).

_Phase 3 — High/low accuracy decision (the one real trade-off)._ A single quote snapshot at the 5-min boundary gives an exact **close** and (via day-volume delta) **volume**, but **not the true intra-bar high/low** (`quote.ohlc` is the _day's_ O/H/L/C). Two tiers:

- **Tier A (minimal):** boundary snapshot only → exact close/volume, approximate high/low. Fine for close-based indicators (EMA/RSI/RVOL/Bollinger/VWAP); **degrades** ATR-based ones (5m Supertrend in the risk-distance guard, the 1h-ST filter, ADX).
- **Tier B (recommended):** add a lightweight **~30–60 s batched-quote poll** that maintains a running "forming candle" per stock (open at boundary; high/low = running max/min of `last_price`; close = latest; volume = day-vol delta), flushed to the store at each 5-min boundary. Accurate enough for Supertrend; cost ≈ **1 batched call / 30–60 s ≈ 450–750 calls/day** (quotes, a separate/looser limit) vs **6,480 historical** today. Recommend Tier B because the Supertrend/1h-ST filters depend on high/low.

_Phase 4 — Reseed/repair fallback._ If a stock's newest candle is older than a threshold (missed polls, API gap, restart), do a **targeted historical reseed for that stock only**. Validate cache freshness at the first scan after boot.

**Also fold in (cheap, related):**

- **Re-anchor VWAP to intraday** (see sub-finding) — independent of window size; makes "Close > VWAP" a real signal.
- **Drop the redundant `scannerData.historicalData` pass-through** ([L2008](src/core/StrategyManager.ts#L2008)) — the strategy ignores it and re-fetches its own 7 days.

**Validation (before enabling in prod).**

1. **Shadow mode:** run quote-built candles alongside the current historical re-fetch for a full day; compare per-stock scores and — critically — the **top-3 selection** each scan. Acceptance: top-3 identical on ≥ ~95% of scans; no Supertrend risk-distance/1h-ST flips beyond a defined tolerance.
2. **New QC harness** mirroring append/dedup/trim/reseed (like `scripts/qc-candle-dedup.ts`), incl. the day-boundary 60-min derivation and a restart-gap reseed case.
3. `tsc --noEmit` clean; existing harnesses green.

**Expected benefit.** Historical calls drop from **~6,480/day → ~108/day** (seed only; ~0 if persisted across restarts). The ~54 s/scan pacing disappears. Quote load stays modest (Tier B ≈ 450–750 batched quote calls/day). Bonus: VWAP becomes a correct intraday signal.

**Risks / must-haves.** (1) **High/low approximation drift** on ATR indicators — mitigated by Tier B + shadow validation; do **not** ship Tier A if the Supertrend guards move. (2) **Volume attribution** from day-cumulative deltas — snapshot day-volume at each boundary; handle the first bar of the day and missed polls. (3) **Append/dedup correctness** — reuse `floorTo5Min` + dedup (this is the exact bug class fixed 2026-06-16); cover with the QC harness. (4) **Reseed robustness** on restart/stale cache. (5) Gate behind `enableIncrementalScannerCandles` so rollback is a config flip back to the current full re-fetch (which stays in the codebase as the fallback path).

---

## Strategy / Edge

> **Data basis for IMP-002…007.** All numbers below come from the live trade history on the VM (`dist/data/bollinger-slot{1,2,3}.json`, 290 trades). To judge the _current_ strategy fairly we use a **"current-config proxy" = LONG trades only, excluding exits from now-disabled features** (`PREMIUM_HARD_STOP`, `RSI_CONFIRMATION_FAILED`, `BREAKOUT_NO_FOLLOWTHROUGH`, all `SHORT_*`). That proxy = **111 trades, +₹60,586, 44% WR, PF 1.62, +₹546/trade** — a real but thin momentum edge. Each item below is a slice of that 111-trade set. Sample sizes are small per bucket — treat as **directional, A/B before committing**, not proven.

### IMP-002 — Days-to-expiry gate (skip the last ~3 days of the monthly cycle)

- **Status:** PROPOSED (2026-06-17)
- **Area:** `src/strategies/bollinger-band/BollingerBandStrategy.ts` (`getNextStockOptionExpiry`, option selection), optionally scanner pre-filter.

**Finding (corrects an earlier assumption).** The bot does **not** skip near-expiry. `getNextStockOptionExpiry()` ([L5765](src/strategies/bollinger-band/BollingerBandStrategy.ts#L5765)) just returns the **first future expiry** (nearest). The only expiry-aware code is `OIHistoryService.isExpiryWeek()` ([L294](src/services/OIHistoryService.ts#L294)) which merely **disables the Smart-Money OI score component** during Tue–Thu of expiry week (the dashboard "Expiry Week – Skipped" 📅 badge = _Smart Money skipped_, not the trade). Indian **stock** options are monthly, so theta bleed is acute only in the **final ~3 trading days** of the monthly cycle.

**Data (DTE = trading days from entry to that contract's expiry):**

| DTE bucket  | n       | net         | WR      | PF       | exp/trade |
| ----------- | ------- | ----------- | ------- | -------- | --------- |
| 2           | 5       | −3,674      | 20%     | 0.28     | −735      |
| 3           | 3       | −1,073      | 33%     | 0.77     | −358      |
| 5–7         | 16      | +8,585      | 44%     | 1.92     | +537      |
| **8–12**    | **34**  | **+32,538** | **50%** | **2.81** | **+957**  |
| 13–20       | 45      | +30,841     | 44%     | 1.76     | +685      |
| 21+         | 7       | −14,901     | 29%     | 0.27     | −2,129    |
| **DTE ≤ 3** | **8**   | **−4,747**  | **25%** | **0.51** | **−593**  |
| **DTE ≥ 4** | **103** | **+65,333** | **46%** | **1.74** | **+634**  |

**Exact action.** When the nearest monthly expiry is **≤ 3 trading days out**, either (a) **roll to the next month's contract**, or (b) **skip new entries** for that name. Sweet spot is **DTE 5–20** (esp. 8–12). Also flag DTE ≥ 21 as a soft caution (n=7, −2,129/trade — early-cycle entries; small sample, monitor rather than gate).

**Risks / must-haves.** Need a reliable trading-day-to-expiry count (NSE holiday calendar, not naive calendar days). Rolling to next month lowers delta/gamma engagement — validate that the next-month contract still meets the liquidity/premium gates. A/B: gate ON vs OFF on the DTE ≤3 slice.

### IMP-003 — Time-of-day refinement (kill the 10:30–12:00 dead zone, not "front-load")

- **Status:** PROPOSED (2026-06-17)
- **Area:** entry-time gates (`lunchBlockEndMinutesIst`, afternoon cutoff) in `BollingerBandStrategy.ts`.

**Finding (corrects the earlier "concentrate entries in the morning" hypothesis — the data does NOT support a simple morning bias).** Current-config proxy, by IST entry time:

| IST window      | n   | net     | WR  | PF       | exp/trade         |
| --------------- | --- | ------- | --- | -------- | ----------------- |
| 09:15–10:00     | 20  | +10,408 | 40% | 1.37     | +520              |
| **10:00–10:30** | 8   | +11,647 | 63% | **2.02** | **+1,456**        |
| 10:30–11:00     | 10  | −3,909  | 40% | 0.67     | −391              |
| **11:00–12:00** | 9   | −7,327  | 22% | **0.40** | **−814** (worst)  |
| 12:00–13:00     | 24  | +6,421  | 38% | 1.38     | +268              |
| **13:00–14:00** | 23  | +45,758 | 70% | **7.56** | **+1,989** (best) |
| 14:00+          | 17  | −2,414  | 29% | 0.77     | −142              |

**Exact action.** The losing window is **10:30–12:00** (PF 0.40–0.67), _not_ "the afternoon." The **post-lunch 13:00–14:00 resumption is the single best window** (PF 7.56). Concrete levers: (1) extend the immediate-entry block to **start ~10:30** (today lunch block starts 11:00) so fresh Slot-1 entries skip the 10:30–12:00 momentum-exhaustion zone; (2) keep allowing pullback/FVG arms through lunch (they're what produce the strong 12:00–14:00 fills); (3) consider tightening 14:00+ entries further. **Do not** blanket-favor mornings — 13:00–14:00 outperforms every morning bucket.

**Risks / must-haves.** Small per-bucket n (8–24). The 13:00–14:00 strength is partly a few big winners (70% WR). A/B the 10:30 block-start change before committing; re-measure monthly.

### IMP-004 — Per-symbol rolling expectancy modifier (soft, decaying, capped)

- **Status:** PROPOSED (2026-06-17)
- **Area:** scanner score adjustment (`MarketScanner.scoreStocks` / `selectTopStocks`), with state persisted across days.

**Data (current-config proxy, n ≥ 3 per symbol):**

- **Consistent winners:** HAL +4,658/trade (75% WR), COFORGE +3,723 (75%), TITAN +2,690 (67%), ULTRACEMCO +2,595 (67%), LT +1,413 (40%), SHRIRAMFIN +1,089 (67%).
- **Consistent bleeders:** CUMMINSIND −1,910/trade (0% WR, n=3), APOLLOHOSP −778 (33%, n=6), TORNTPHARM −700 (33%), SIEMENS −578 (25%, n=4).
- (Whole-history extra context: Adani complex bled hard — ADANIENT −2,166/trade, ADANIGREEN −1,880 — high-beta event names whipsaw option premium.)

**Exact action.** Maintain a **decaying per-symbol net-expectancy** for this style (half-life ≈ 20–30 trades) and apply it as a **bounded score nudge**, e.g. `scoreAdj = clamp(k × normalizedExpectancy, −1.0, +0.5)` added to the scanner score — **asymmetric** (penalize sustained losers harder than you reward winners, cap the reward so you don't over-chase a hot name into mean reversion). Never a hard ban: a chronic bleeder simply loses ties to a comparable setup elsewhere but can still deploy if clearly best. Add a **category prior** (small standing penalty for high-beta event complexes like the Adani names) to cover small-sample symbols. Keep a floor of exploration so the universe never collapses.

**Risks / must-haves.** Small samples (most names n=3–9) → use shrinkage toward the category/global mean; require a minimum trade count before the modifier reaches full weight. Persist across restarts and reset/decay sensibly across regime shifts. **This protects future big winners** (HAL had early losers) precisely because it's soft, capped, and forgiving on the upside.

### IMP-005 — Recalibrate the Supertrend stop (the −₹61K loss center)

- **Status:** PROPOSED (2026-06-17)
- **Area:** `checkLongExitOnCandleClose` / `calculateSupertrend(10,2)` exit, `BollingerBandStrategy.ts`.

**Data.** `LONG_SUPERTREND_BREAK` is the dominant loss line: **59 trades, −₹61,191, 25% WR, PF 0.25, −₹1,037/trade** (whole history). The **holding-time** cut shows where it bites:

| Hold       | n   | net         | PF        | exp/trade          |
| ---------- | --- | ----------- | --------- | ------------------ |
| <15m       | 9   | +2,989      | 1.77      | +332               |
| 15–30m     | 11  | +2,507      | 1.15      | +228               |
| **30–60m** | 16  | **−17,174** | **0.25**  | **−1,073** (worst) |
| 1–2h       | 45  | +5,355      | 1.11      | +119               |
| **2–4h**   | 23  | **+40,689** | **13.48** | +1,769             |
| **4h+**    | 7   | **+26,219** | **28.09** | **+3,746**         |

**Reading.** The edge is **holding to 2h+** (PF 13–28); trades killed at **30–60 min** (largely Supertrend stop-outs) are the worst bucket. The stop may be ejecting trades that would have reached gamma climax / EOD.

**Exact action.** A/B a **2-stage stop**: (1) a tighter initial stop in the first ~20–30 min to cut the no-follow-through losers fast; (2) **loosen** the stop (wider ATR multiple, or switch to structural/EOD only) once a trade has shown follow-through, so winners survive into the 2h+ zone. Backtest an ATR-multiple sweep (current is Supertrend period 10, mult 2) against the existing 290-trade set, scoring by net + PF, **not** WR.

**Risks / must-haves.** Loosening stops raises per-trade tail risk — the 5% emergency stop and structural stop must remain as hard floors. Must be backtested on out-of-sample months (the current edge is regime-dependent, see IMP-007). Don't optimize to the small 30–60m bucket alone.

### IMP-006 — RSI optimization (entry band + gamma-climax threshold)

- **Status:** PROPOSED (2026-06-17) — **requires a log-mining analysis first** (entry RSI is not stored in trade records; it's in `output.log` `SIGNAL_LIFECYCLE`/entry lines).
- **Area:** entry RSI gate (stock RSI(10) band [68,85]); option RSI(14) climax ≥85 + trail.

**Why RSI is the highest-value tuning target.** The gamma-climax exits (option RSI(14) ≥ 85) are the **best trades in the book — effectively 100% WR** (`GAMMA_CLIMAX_RSI85…92`, avg ₹2,500–8,900). That 100% WR is suspicious in a _good_ way: the threshold may be exiting **too early**, so we never see what the tail would have done. Meanwhile the **entry** band is unvalidated against outcome.

**Exact actions (each an A/B / offline study):**

1. **Bucket historical LONG entries by entry-RSI** (mine `output.log`): 68–72 / 72–76 / 76–80 / 80–85. Decide whether the edge concentrates high (genuine strength) or low (false breakouts), then **narrow the band** accordingly. Hypothesis to test: 68–72 catches fakeouts.
2. **Require rising RSI as a hard entry condition** (today "RSI rising" / "RSI acceleration" are only scanner _bonuses_). A breakout with decelerating RSI is the classic Indian large-cap fakeout.
3. **Raise the gamma-climax threshold** from 85 → test **87 / 90** to capture more of the tail, paired with the RSI-trail so gains aren't given back.
4. **A/B entry RSI period 10 vs 14** — RSI(10) is twitchier (more false positives at the entry gate).
5. **RSI divergence exit** (price new high, RSI lower high) as an early-warning exit that could beat waiting for the −₹61K Supertrend break.

**Risks / must-haves.** Entry-RSI buckets need a careful log-join (timestamp + symbol) — build a one-off analysis script, don't guess. Raising the climax threshold could turn some 100%-WR winners into round-trips if the trail isn't tight enough — test together.

### IMP-007 — Volatility / regime gate (cushion chop months like May)

- **Status:** PROPOSED (2026-06-17)
- **Area:** scanner gating + position sizing; revisit the currently-OFF `enableWideRangeDayFilter`, `enableExtremeNiftyRangeFilter`, `enableVixLotReduction`.

**Data.** Current-config proxy is **positive every month** but **May 2026 = +₹4,980 at PF 1.20 vs Apr +₹23,003 PF 2.90 / Jun +₹15,002 PF 2.72** — i.e. May nearly flat-lined. The _full_ book (incl. shorts) was **−₹30,082 in May** — a chop/mean-reversion regime where the momentum edge compresses. There is currently **no regime brake** (the relevant filters are disabled).

**Exact action.** A/B a lightweight regime gate that **reduces exposure in low-VIX / range-bound conditions**: (1) re-test `enableWideRangeDayFilter` (block entries the day after a >130%-of-ADR range day) and `enableExtremeNiftyRangeFilter` (NIFTY intraday range >1.5%) — both were disabled to "stop the bleeding" but that was pre-shorts-removal, so the calculus changed; (2) broaden `enableVixLotReduction` from "VIX falling" to "**VIX low-and-flat**" (the chop signature), cutting position count rather than just lot size; (3) consider a NIFTY higher-timeframe trend filter that throttles new deploys when the index itself isn't trending.

**Risks / must-haves.** Regime filters cost you the occasional good trade in a "wide" tape — must be A/B'd net-positive, not assumed. Re-test specifically on May (the known chop month) and a trending month (Apr) to confirm it helps chop without gutting trends.

### IMP-008 — Premium banding sanity (validate the ₹40 floor, watch the ₹100–150 dead zone)

- **Status:** PROPOSED (2026-06-17) — low priority, mostly confirmation.
- **Area:** option selection premium floor (`minPremium`), liquidity gate.

**Data.** Premium at entry vs outcome (current-config proxy):

| Premium ₹ | n   | net     | WR   | PF       |
| --------- | --- | ------- | ---- | -------- |
| <40       | 30  | −13,384 | 33%  | 0.66     |
| **40–60** | 21  | +23,644 | 57%  | **3.25** |
| 60–100    | 21  | +16,500 | 52%  | 2.00     |
| 100–150   | 21  | −330    | 29%  | 0.98     |
| 150–250   | 14  | +25,523 | 43%  | 2.84     |
| 250+      | 4   | +8,633  | 100% | 99       |

**Reading / action.** The **₹40 floor is validated** (sub-₹40 = PF 0.66, the toxic-liquidity zone). No action needed there. Note the odd **₹100–150 breakeven pocket** (PF 0.98) — likely a coincidence of which names land there; **monitor, don't gate** on it (small n, no obvious mechanism).

---

## Template for new entries

```
### IMP-NNN — Short title
- Status: PROPOSED (YYYY-MM-DD)
- Area: files / components

Problem. ...
Cost / impact today. ...
Proposed approach. ...
Expected benefit. ...
Risks / must-haves. ...
```
