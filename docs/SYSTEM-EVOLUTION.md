# System Evolution — Complete History

> **Living Document** — Updated: March 6, 2026  
> **Purpose**: Dated changelog showing how the trading bot evolved from inception to current production state  
> **Source**: Git commits, code archaeology, and documentation analysis

---

## At a Glance

| Phase       | Period                | What Changed                                                                                                                                                         |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** | Sep 24 – Sep 28, 2025 | Genesis — Pivot strategy on NIFTY futures, basic login, manual trades                                                                                                |
| **Phase 2** | Oct 1 – Oct 17, 2025  | Foundation — Options trading, refactored architecture, VM deployment, websocket                                                                                      |
| **Phase 3** | Oct 29 – Dec 24, 2025 | Single-Stock Iteration — Bollinger trailing SL, BB exits, breakout pullback strategy, data migration                                                                 |
| **Phase 4** | Jan 6 – Jan 27, 2026  | Multi-Stock Rewrite — Scanner, 3 slots, ₹65K/slot, universe, sector scoring                                                                                          |
| **Phase 5** | Jan 29 – Feb 13, 2026 | Production Hardening — OI tracking, Supertrend exits, tactical scoring, Gamma Climax, RSI Trail                                                                      |
| **Phase 6** | Mar 1, 2026           | Factor Analysis & Optimization — F7 RSI Confirmation, F8 1h-ST Alignment, Nifty hypothesis tested & rejected                                                         |
| **Phase 7** | Mar 5 – Mar 6, 2026   | Data-Backed Hardening — 134-trade analysis, 8% premium hard stop, ₹40 min premium, lunch block, same-day re-entry block, race condition fix                          |
| **Phase 8** | Mar 6, 2026           | Scoring Paradox Fix — 210-trade scoring analysis, weight rebalancing (FB↓ V↓ PX↑ RA↑), score cap 13.0, Double Trap filter, outperformance swap, 2:00 PM entry cutoff |

---

## Phase 1: Genesis (Sep 24 – Sep 28, 2025)

**What the system was:** A proof-of-concept that could log into Zerodha, pull NIFTY futures data, detect pivot-point signals, and place basic trades.

### Commits

| Date   | Commit                                          | Description                                                                                                    |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Sep 24 | `first commit`                                  | Project scaffolding — Node.js + TypeScript skeleton                                                            |
| Sep 24 | `first commit 2`                                | Initial file structure                                                                                         |
| Sep 24 | `Working login + strategy - pivot + fut stream` | **First working prototype**: Zerodha OAuth login, Pivot Point strategy on NIFTY futures, real-time data stream |
| Sep 25 | `Strategy+executor`                             | Separated strategy logic from order execution — early architecture split                                       |
| Sep 27 | `Working version`                               | End-to-end flow: login → signal → order → confirmation                                                         |
| Sep 28 | `Fixed major bugs`                              | Stability fixes for first live-adjacent testing                                                                |
| Sep 28 | `Manual trade stop`                             | Added ability to manually close positions from the UI                                                          |

### System State at End of Phase 1

```
Strategy:       Pivot Point (Support/Resistance levels)
Instrument:     NIFTY Futures (FUT, not options)
Data:           Real-time futures stream
Entry Logic:    Price crossing pivot levels
Exit Logic:     Manual + basic stop loss
Architecture:   Monolithic — strategy + execution in one flow
Dashboard:      Basic Express server
Deployment:     Local only
```

**Key decision**: Started with futures because they're simpler (no strike selection, no expiry complexity). This would change soon.

---

## Phase 2: Foundation Building (Oct 1 – Oct 17, 2025)

**What changed:** Shifted from futures to options trading, refactored into a multi-strategy architecture, built a proper UI, and deployed to an Azure VM for the first time.

### Commits

| Date   | Commit                                         | Description                                                                                      |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Oct 1  | `Bug fix in progress`                          | Fixing edge cases from initial testing                                                           |
| Oct 3  | `Working validated`                            | Validated end-to-end options flow                                                                |
| Oct 4  | `New UI`                                       | Built a proper web dashboard for monitoring                                                      |
| Oct 4  | `Workspace cleanup + Security fix deployment`  | Hardened for deployment, removed secrets from code                                               |
| Oct 6  | `Option strike selection change`               | Refined ATM strike picking logic                                                                 |
| Oct 7  | `Refactored and tested`                        | Code cleanup pass                                                                                |
| Oct 7  | `Code refactored for multiple strategies`      | **Architecture milestone**: StrategyBase + StrategyManager + StrategyRegistry pattern introduced |
| Oct 8  | `VM deployment`                                | First deployment to Azure VM                                                                     |
| Oct 8  | `VM deployment - option lot capital issue fix` | Fixed lot sizing for options capital calculation                                                 |
| Oct 17 | `Enable autoStart`                             | Strategies start automatically on bot boot                                                       |
| Oct 17 | `Working system with websocket`                | Real-time websocket data feed integrated                                                         |
| Oct 17 | `Update VM management guide`                   | PM2 setup, restart procedures documented                                                         |
| Oct 17 | `Configure VM for daily auto-shutdown/restart` | IST timezone, PM2 auto-start, daily ops procedures                                               |

### System State at End of Phase 2

```
Strategy:       Pivot Point (still) — but now trading OPTIONS
Instrument:     NIFTY / BANKNIFTY options (CE/PE)
Architecture:   StrategyBase → StrategyManager → StrategyRegistry
                (Clean multi-strategy pattern — ready for new strategies)
Dashboard:      Web UI with real-time monitoring via websocket
Deployment:     Azure VM with PM2, IST timezone, daily auto-restart
Strike Logic:   ATM option selection (refined)
Lot Sizing:     Capital-based (1 lot per ₹40,000)
Session:        Zerodha OAuth with auto-start on login
```

**Key decisions:**

- Futures → Options (leverage + defined risk)
- Monolithic → Multi-strategy architecture (StrategyBase inheritance)
- Local → Azure VM deployment (24/7 availability)

---

## Phase 3: Single-Stock Iteration (Oct 29 – Dec 24, 2025)

**What changed:** Replaced the Pivot strategy with Bollinger Bands, added trailing stop losses, experimented with a Breakout Pullback strategy alongside Bollinger, and migrated to proper data management.

### Commits

| Date      | Commit                                                         | Description                                                       |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Oct 29    | `Working version on local`                                     | Checkpoint after local development cycle                          |
| Nov 17    | `Working strategies`                                           | Multiple strategy flavors being tested                            |
| Nov 25    | `Working version - both 5 min`                                 | Both strategies running on 5-minute timeframe                     |
| Dec 12    | `Trailing SL for both long and short in Bollinger`             | **Bollinger trailing stop loss** — first attempt at dynamic exits |
| Dec 18    | `Office laptop change`                                         | Environment migration                                             |
| Dec 18–19 | `Fixed BB exits` (×3)                                          | Multiple iterations fixing Bollinger Band exit logic              |
| Dec 19    | `Bug fixed`                                                    | Stability fixes                                                   |
| Dec 22    | `Bot start auth - strategy initialization fix`                 | Fixed strategy init timing after login                            |
| Dec 23    | `Breakout pullback strategy restart error fix`                 | Breakout Pullback strategy persistence bugs                       |
| Dec 24    | `Migrate Bollinger Band data to src/data`                      | Moved trading data under Git tracking                             |
| Dec 24    | `Complete Bollinger data migration with Dec 24 trade recovery` | Recovered active trade state during migration                     |
| Dec 24    | `feat: 60% trailing stop loss for Breakout Pullback`           | Added percentage-based TSL to the secondary strategy              |

### System State at End of Phase 3

```
Strategy 1:     Bollinger Bands (20, 2.0) — 5-minute timeframe
                Entry: Price crosses BB + RSI confirmation + Supertrend alignment
                Exit:  Trailing stop loss (percentage-based)
Strategy 2:     Breakout Pullback (experimental alongside Bollinger)
                Exit:  60% trailing stop loss
Instrument:     NIFTY / BANKNIFTY options
Data:           Trading data tracked in Git (src/data/)
Indicators:     BB(20,2), RSI, Supertrend — all on 5-min candles
Architecture:   Two strategies running in parallel on same instrument
```

**Key decisions:**

- Pivot → Bollinger Bands (better signal quality for options)
- Added trailing SL (December 12 — first step toward dynamic exits)
- Experimented with running two strategies in parallel
- Started tracking trading data in Git for auditability

**What was wrong:** Still trading only NIFTY/BANKNIFTY. The trailing SL was percentage-based, not indicator-based — it would get whipsawed on volatile days.

---

## Phase 4: Multi-Stock Rewrite (Jan 6 – Jan 27, 2026)

**What changed:** Complete rewrite from single-instrument to multi-stock system. Built the MarketScanner, switched to slot-based capital management, added 100+ stock universe with sector scoring. This was the biggest architectural change in the project's history.

### Commits

| Date   | Commit                                                   | Description                                                            |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Jan 6  | `Working version to VM`                                  | Checkpoint: last version of single-stock system deployed               |
| Jan 6  | `Update deployment script`                               | Deployment path fix                                                    |
| Jan 26 | `Initial commit: Bollinger Band multi-stock trading bot` | **THE BIG REWRITE** — entire codebase restructured for multi-stock     |
| Jan 26 | `Production ready: Remove all testing mode code`         | Stripped test/debug code for production                                |
| Jan 26 | `Fix: Recover BollingerBandStrategy from corruption`     | Constructor signature updated for new architecture                     |
| Jan 26 | `feat: Slot-based capital tracking`                      | Each slot gets its own data file (bollinger-slot1/2/3.json)            |
| Jan 26 | `fix: Correct slot-based capital`                        | INITIAL_CAPITAL set to ₹65,000 per slot                                |
| Jan 26 | `fix: Symbol Mismatch Guard (Zombie Position)`           | Prevents recovering a position from a different stock in the same slot |
| Jan 27 | `fix: Improve Zombie Position Guard`                     | Uses tradingsymbol for robust extraction, purges ghost positions       |
| Jan 27 | `perf: InstrumentCache for NFO instruments`              | Avoids 15MB API call per option selection — caches instruments locally |
| Jan 27 | `docs: Deployment guide for Jan 27`                      | Production deployment procedures                                       |
| Jan 27 | `fix: Calculate sector change percent manually`          | Zerodha returns net_change not percent — had to compute manually       |
| Jan 27 | `chore: cleanup + UI updates for Smart Retention`        | Removed redundant pre-market code, UI shows retention decisions        |
| Jan 27 | `fix: critical order execution & scanner improvements`   | Order execution reliability + scanner refinements                      |

### What Was Built

| Component            | File                                  | Lines          | Purpose                                            |
| -------------------- | ------------------------------------- | -------------- | -------------------------------------------------- |
| **MarketScanner**    | `src/services/MarketScanner.ts`       | ~700 (initial) | TMV scoring engine — scans 100+ stocks             |
| **QuoteManager**     | `src/services/QuoteManager.ts`        | ~200           | Batched quote fetching with caching                |
| **Universe**         | `src/config/universe.ts`              | ~250           | 100+ F&O stocks mapped to sectors                  |
| **Sector Tokens**    | `src/config/sectorTokens.ts`          | ~50            | NIFTY sector index token mappings                  |
| **Instrument Cache** | `src/utils/InstrumentCache.ts`        | ~150           | Local NFO instrument cache (avoids 15MB API calls) |
| **Slot Data Files**  | `src/data/bollinger-slot{1,2,3}.json` | —              | Per-slot capital + position + trade history        |
| **Strategy State**   | `data/strategy/strategy-state.json`   | —              | Slot assignments persisted across restarts         |

### System State at End of Phase 4

```
Architecture:   Scanner → StrategyManager (3 slots) → BollingerBandStrategy instances
Scanner:        TMV scoring (Trend 3.0 + Momentum 3.5 + Volume 2.0 + Sector 2.0 = Base 10.0 max)
                Runs at 09:30 AM — single daily scan, "lock & load"
Universe:       100+ F&O stocks across NIFTY sector indices
Capital:        ₹65,000 per slot × 3 slots = ₹195,000 total
Lot Sizing:     1 lot per ₹40,000
Strategy:       Bollinger Bands (20, 2.0) + RSI + Supertrend
                Entry: BB breakout + RSI + ST alignment
                Exit:  Trailing SL (still percentage-based at this point)
Guards:         Zombie Position Guard, Symbol Mismatch Guard
Instruments:    Individual stock options (CE/PE) — NOT NIFTY/BANKNIFTY anymore
Persistence:    Per-slot JSON files, strategy state file
Deployment:     Azure VM with PM2
```

**Key decisions:**

- NIFTY/BANKNIFTY → Individual stock options (100+ universe)
- Single instrument → 3 concurrent slots with independent capital
- One scan per day (09:30 AM) → would soon evolve to every-5-min scanning
- Breakout Pullback strategy **removed** — all-in on Bollinger Bands
- InstrumentCache created to avoid crushing API with 15MB instrument downloads

---

## Phase 5: Production Hardening (Jan 29 – Feb 13, 2026)

**What changed:** Rapid iteration as the bot went into live production trading. Every few days brought new features, guards, and exit mechanisms based on real trade observations. This is where the system became serious.

### Commits

| Date   | Commit                                                                     | Description                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jan 29 | `feat: Position recovery fix, liquidity filters, dashboard metrics`        | Recovery on restart, option liquidity checks, dashboard P&L tracking                                                                                                                                                                                                                                      |
| Jan 29 | `feat: Add Smart Money OI tracking with Coiled Spring detection`           | Open Interest analysis — detects OI accumulation diverging from price                                                                                                                                                                                                                                     |
| Feb 2  | `feat: Major safety improvements + Supertrend-based exits`                 | **EXIT SYSTEM REWRITE**: Replaced trailing SL with candle-close Supertrend/BB exits + EOD safety + Emergency Hard Stop                                                                                                                                                                                    |
| Feb 3  | `Fix critical bugs: zombie strategy, duplicate stocks, reconciliation`     | First day of live trading under new exit system — bug fixes                                                                                                                                                                                                                                               |
| Feb 7  | `feat: 5-min scanner + staleness guard for breakout entries`               | **SCANNER UPGRADE**: From once-daily to every 5 minutes (09:23–14:58, 68 scans/day). Added staleness guard (3+ candles outside BB = stale breakout)                                                                                                                                                       |
| Feb 7  | `docs: update SYSTEM-OVERVIEW`                                             | Documented new 5-min scanning architecture                                                                                                                                                                                                                                                                |
| Feb 7  | `feat: tactical bonus scoring system`                                      | **SCORING OVERHAUL**: Added tactical bonus layer on top of base TMV score. Fresh Breakout +3.0, RVOL Surge +2.0, Proximity +1.5, RSI Acceleration +1.0. Base floor requirement (≥5.0) prevents garbage stocks from ranking on volume spikes alone                                                         |
| Feb 7  | `feat: Squeeze Gradient + 3-Strike OI-Leader selection + Gamma Wall bonus` | Squeeze Gradient: tighter BB = higher bonus (0 to +1.0). OI-Leader: selects option strike with max OI concentration. Gamma Wall: +0.5 to +1.5 based on OI structure                                                                                                                                       |
| Feb 7  | `feat: Tiered Eiffel Tower (v3.1) - Holy Trinity scoring`                  | Eiffel Tower bonus became 2-stage: Concentration Gate (mandatory OI dominance check) → Runway Tiers (VACUUM/CLEAN/PASSABLE/CONGESTED based on OI ahead of strike)                                                                                                                                         |
| Feb 8  | `feat(P0): Gamma Climax RSI Exit`                                          | **NEW EXIT LAYER**: Option RSI(14) ≥ 85 on 15-min chart → full exit. Captures blow-off tops before inevitable crash. Backtested: 6 trades, 100% WR, +₹22,576                                                                                                                                              |
| Feb 8  | `docs: Rewrite exit framework`                                             | Documented 5-layer exit hierarchy                                                                                                                                                                                                                                                                         |
| Feb 8  | `chore: Remove deprecated backup files`                                    | Cleanup of old single-stock artifacts                                                                                                                                                                                                                                                                     |
| Feb 10 | `feat: Pace-Setter (batchSize 3→2) + Fix E (retry failed batches)`         | Historical data fetch optimization — smaller batches with retry logic for API reliability                                                                                                                                                                                                                 |
| Feb 11 | `fix: stale lock, scan skip, SHORT recovery on restart`                    | Fixed: state lock getting stuck, scans being skipped, SHORT positions not recovering correctly after restart                                                                                                                                                                                              |
| Feb 11 | `fix: replace binary sector gate with threshold-based breakout override`   | Sector filtering was too aggressive (binary on/off). Replaced with threshold: strong breakouts can override weak sector signal                                                                                                                                                                            |
| Feb 13 | `feat: RSI Trail stop, breakout validation, cooldown slot fix, QC`         | **RSI Trail Premium Stop** (SHORT only): 5-min RSI ≥ 85 activates live 5-sec premium polling, exits when LTP ≤ candle LOW. **Breakout Validation**: first 3 candles must confirm breakout direction (candle high/low). **30-min Symbol Cooldown**: prevents re-entering same stock immediately after exit |

### Exit System Evolution (Key Milestone)

The trailing stop loss from Phase 3 was replaced on **Feb 2** with a candle-close exit system:

```
BEFORE (Phase 3):                    AFTER (Phase 5):
─────────────────────                ───────────────────────────────────
Polling-based trailing SL            Layer 1: EOD Safety (3:19 PM)
- Checks LTP continuously            Layer 2: Emergency Hard Stop (±5%)
- Gets whipsawed by wicks             Layer 3: Gamma Climax (15m RSI ≥ 85)
- Single exit mechanism               Layer 4: RSI Trail Premium (SHORT only)
                                      Layer 5: Supertrend/BB Break (5m close)
```

### Scoring System Evolution

```
BEFORE (Phase 4):                    AFTER (Phase 5):
─────────────────────                ───────────────────────────────────
Base TMV only (max 10.0)             Base TMV (max 12.5) + Tactical (max 10.0)
- Trend (3.0)                        - Fresh Breakout +3.0
- Momentum (3.5)                     - RVOL Surge +2.0
- Volume (2.0)                       - Proximity +1.5
                                     - Eiffel Tower +0.5 to +1.5
No sector scoring                    - RSI Acceleration +1.0
No tactical bonuses                  - Squeeze Gradient +0 to +1.0
                                     Base Floor: Tactical only applies if base ≥ 5.0
```

### System State at End of Phase 5

```
Architecture:    Scanner (5-min) → StrategyManager (3 slots) → BollingerBandStrategy
Scanner:         TMV + Tactical scoring (max 22.5 = Base 12.5 + Tactical 10.0)
                 68 scans/day (every 5 min from 09:23 to 14:58)
                 Smart Retention: LOCK/KEEP/SWAP/DEPLOY decisions per slot
Universe:        109 stocks across 8+ NIFTY sector indices
Capital:         ₹65,000 per slot × 3 slots
Guards:          Risk Distance (>1.5% = reject)
                 Bandwidth (>3.5% = reject)
                 RSI Exhaustion (>85/<15 = reject)
                 Gap Trap (>2% = reject)
                 Circuit Proximity (<1.5% = reject)
                 Sector Diversity (max 2/sector)
                 Staleness Guard (3+ candles outside BB = stale)
                 Breakout Validation (first 3 candles must confirm)
                 Symbol Cooldown (30 min after exit)
Entry:           BB breakout + RSI + Supertrend alignment
Exit Layers:     1. EOD Safety (3:19 PM)
                 2. Emergency Hard Stop (stock ±5% from entry)
                 3. Gamma Climax (15m option RSI ≥ 85)
                 4. RSI Trail Premium Stop (5m RSI ≥ 85 → live LTP polling, SHORT only)
                 5. Supertrend/BB Break (5m candle close)
Indicators:      BB(20,2), RSI(14 for options, 10 for stock), Supertrend(10,2)
OI Analysis:     Coiled Spring detection, Eiffel Tower (Concentration Gate + Runway Tiers)
Data:            Per-slot JSON files, strategy state file, OI history
Deployment:      Azure VM with PM2, HTTPS proxy
```

**Performance (Feb 3–27, 2026):** 84 trades, ₹16,636 net PnL, 40.5% WR, 1.25 profit factor. The system was profitable but oscillating — big winners from Gamma Climax and EOD holds were being eroded by Supertrend exit losses.

---

## Phase 6: Factor Analysis & Optimization (Mar 1, 2026)

**What changed:** Systematic analysis of all 84 trades identified 8 potential improvement factors. Two were implemented (F7, F8), five were rejected based on data, and one was parked. The Nifty trend hypothesis was tested and rejected.

### Commits

| Date  | Commit                                                     | Description                                                   |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Mar 1 | `latest`                                                   | Pre-optimization checkpoint                                   |
| Mar 1 | `F7+F8 implementation with full QC - prod ready for Mar 2` | F7 RSI Confirmation + F8 1h-ST Alignment implemented and QC'd |

### Factor Analysis Results

The 84-trade dataset from Feb 3–27 was analyzed for 8 improvement factors:

| Factor | Hypothesis                         | Verdict                                                | Impact            |
| ------ | ---------------------------------- | ------------------------------------------------------ | ----------------- |
| **F1** | SHORT near S2 after 12 PM = bad    | ❌ **REFUTED** — after-12 SHORTs are 88% WR            | Not implemented   |
| **F2** | BB width filter (min or max)       | ❌ **REJECT** — every threshold hurts PnL              | Not implemented   |
| **F3** | Large breakout candle = exhaustion | ❌ **ANTI-SIGNAL** — biggest candles = biggest winners | Not implemented   |
| **F4** | (not documented separately)        | —                                                      | —                 |
| **F5** | RSI divergence at entry            | ⏸️ **PARK** — n=1, and it's a winner                   | Insufficient data |
| **F6** | PSAR trailing stop                 | ❌ **DESTRUCTIVE** — kills biggest winners, –₹22K net  | Not implemented   |
| **F7** | RSI quick reversal post-entry      | ✅ **IMPLEMENTED** — removes 33 trades, saves ₹30,144  | +₹30,144          |
| **F8** | 1-hour Supertrend alignment        | ✅ **IMPLEMENTED** — removes 9 trades, ALL losers      | +₹10,759          |

### F7: RSI Quick Reversal Confirmation (Implemented)

**Location:** BollingerBandStrategy.ts — post-entry gate

After entry, monitors stock RSI(10) on each 5-min candle close for 2 candles (10 min):

- **LONG**: Exit immediately if RSI drops below 62
- **SHORT**: Exit immediately if RSI rises above 32
- If 2 candles pass without breach → trade confirmed, runs normally

**Impact:** Removed 33 trades (26 losers, 7 small winners). Net PnL saved: ₹30,144.

### F8: 1-Hour Supertrend Alignment (Implemented)

**Location:** MarketScanner.ts — pre-entry scanner guard

Before deploying a stock to a slot, derives 1-hour candles from 5-min data and calculates 1h Supertrend(10,2):

- **LONG + 1h ST DOWN** → REJECT (buying into macro downtrend)
- **SHORT + 1h ST UP** → REJECT (shorting into macro uptrend)

Required building `derive60MinCandles()` with day-boundary awareness (NSE 75 candles/day ÷ 12 = 6.25, remainder would create cross-day "Frankenstein candles" without boundary detection).

**Impact:** Removed 9 trades — ALL losers (0% WR). PnL saved: ₹10,759.

### Nifty 50 Trend Hypothesis (Tested & Rejected)

**Hypothesis:** "Don't fight the broader Nifty 50 trend" — filter out trades where individual stock direction opposes the Nifty intraday direction.

**Method:** Fetched 1,500 Nifty 50 5-min candles for Feb 2026. Ran Monte Carlo simulation with multiple trend definitions (day-open direction, 30-min momentum, 15-min momentum, 5-min candle direction, from-open % threshold sweep 0 to 1.0%).

**Result:** Every Nifty filter variant **HURTS** performance. Counter-trend trades have **75% WR** (₹1,559/trade) vs aligned trades at **56.7% WR** (₹1,295/trade). The "misaligned" trades include the biggest winners (ULTRACEMCO +₹7,750, BANKBARODA +₹5,119, SHRIRAMFIN +₹5,239).

**Verdict:** Do NOT implement. The system trades stock-specific momentum, not index-tracking.

### Before vs After F7+F8

| Metric      | Before (84 trades) | After (42 trades) | Change      |
| ----------- | ------------------ | ----------------- | ----------- |
| Total PnL   | ₹16,636            | **₹57,538**       | +₹40,902    |
| Win Rate    | 40.5%              | **61.9%**         | +21.4 pts   |
| PnL/Trade   | ₹198               | **₹1,370**        | +₹1,172     |
| Avg Win     | ₹2,148             | **₹2,948**        | +₹800       |
| Avg Loss    | –₹1,621            | **–₹1,195**       | +₹426       |
| Risk:Reward | 0.75:1             | **2.47:1**        | 3.3× better |

### Production QC (Mar 1)

Full end-to-end quality check before production deployment:

| Check                            | Result                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| TypeScript compilation           | ✅ PASS (zero errors)                                              |
| Test suite (43 tests)            | ✅ PASS                                                            |
| F7 implementation (7 sub-checks) | ✅ PASS                                                            |
| F8 implementation (5 sub-checks) | ✅ PASS                                                            |
| Strategy parameters              | ✅ BB(20,2), RSI(10), ST(10,2), RSI confirm(2 candles, L<62, S>32) |
| Session validity                 | ✅ Valid until Mar 2 06:00 IST                                     |
| Data files (7 files)             | ✅ All parseable                                                   |
| Slot states (3 slots)            | ✅ Clean (no active positions)                                     |
| Module imports                   | ✅ All core modules load                                           |
| Git commit                       | ✅ `4879e90` pushed to origin/main                                 |

---

## Phase 7: Data-Backed Hardening (Mar 5 – Mar 6, 2026)

**What changed:** A losing SUNPHARMA LONG trade triggered a deep investigation. Expanded the analysis dataset from 84 to 134 trades (all 3 slots, Feb 3 – Mar 5). Used real KiteConnect 5-min option candle data to determine optimal premium SL. Implemented 4 data-backed improvements and fixed a critical race condition during production QC.

### Trigger: SUNPHARMA Losing Trade Investigation

A SUNPHARMA LONG entry was taken on a stale breakout. Root cause: `checkBreakoutStaleness()` had RSI caps (LONG: ≤85, SHORT: ≥15) that reset the staleness counter during sharp RSI rallies, allowing stale breakouts through. **Fix:** Removed RSI caps entirely — staleness is now purely price-based (candles outside BB).

### 134-Trade Deep Analysis

Expanded from 84 trades (Phase 6) to the full 134-trade dataset across all 3 slots (Feb 3 – Mar 5, 2026). Key findings that drove implementation decisions:

- **Same-day re-entries**: 13 cases, 15.4% WR, –₹14,065 PnL. Re-entering the same symbol after an exit overwhelmingly loses.
- **Lunch zone trades (11:00–12:30 IST)**: Low-volume period produces worse entries.
- **Low-premium options (< ₹40)**: Wide bid-ask spreads erode edge.
- **Optimal premium SL**: Fetched real 5-min candle data via KiteConnect Historical API for 40 post-Feb-3 trades. **Critical finding:** Winners DO dip below entry (HCLTECH –6.1%, BPCL –5.7%). At 6.5% SL = 0 winners killed. User chose conservative 8% threshold.

### Commits

| Date  | Commit                                        | Description                                                 |
| ----- | --------------------------------------------- | ----------------------------------------------------------- |
| Mar 6 | `feat: 4 data-backed improvements + QC fixes` | All 4 improvements + race condition fix + stale log cleanup |

### What Was Implemented

#### 1. ₹40 Minimum Premium Filter (was ₹10)

**Location:** StrategyManager.ts (scanner config) + BollingerBandStrategy.ts (execution guards)

Prevents entering illiquid options with wide bid-ask spreads that erode the strategy's edge. Applied at three levels:

- Scanner config: `minPremium: 40` passed to MarketScanner
- Option selection: `MIN_PREMIUM = 40` in `selectOptionInstrument()`
- Order execution: `MIN_OPTION_PREMIUM = 40` in `executeOrder()`

#### 2. 11:00–12:30 IST Lunch Zone Block

**Location:** BollingerBandStrategy.ts — `checkEntrySignals()`

No new entries during the low-volume lunch period. `checkEntrySignals()` returns early if current time is between 11:00 AM and 12:30 PM IST. Existing positions continue to be managed normally — only new entries are blocked.

#### 3. 8% Premium Hard Stop Loss

**Location:** BollingerBandStrategy.ts — `processNewCandle()`

If option premium drops ≥8% from entry price, immediate exit via `executeExit('PREMIUM_HARD_STOP_8PCT')`. Checked on every 5-min candle after fetching live option premium.

**Data basis:** Real 5-min candle analysis of 40 trades showed:

- At 8% SL: 0 winners killed, 13 losers stopped earlier → net +₹6,662
- At 6.5% SL: 0 winners killed (tightest safe threshold)
- At 4% SL: 3 winners killed (too tight — HCLTECH, BPCL dip deeper)

This becomes new **Exit Layer 3** in the hierarchy, pushing existing layers 3–5 to 4–6.

#### 4. Same-Day Symbol Re-Entry Block

**Location:** StrategyManager.ts — `isSymbolInCooldown()` + `recordSymbolExit()`

Once a symbol is traded on a given day (win or lose), it cannot be re-entered that same day. Implemented at the scanner level to avoid blocking slots:

- `symbolsTradedToday: Map<string, Date>` tracks all symbols traded today
- Daily reset check using UTC date comparison (safe — all IST trading hours fall within same UTC date)
- `populateSymbolsTradedTodayFromDisk()` reads all 3 slot JSON files on startup to restore blocks after restart
- Smart Retention CASE 5.5 swaps blocked slots to different stocks (no idle slot waste)

**Data basis:** 13 same-day re-entries had 15.4% WR and –₹14,065 PnL.

### CRITICAL QC Fix: Double Exit Race Condition

**Location:** BollingerBandStrategy.ts — `executeExit()`

`executeExit()` had no re-entrancy guard. With 6 independent exit triggers (EOD, Emergency, Gamma Climax, RSI Trail, Supertrend/BB Break, and now 8% Hard Stop), multiple could fire simultaneously on the same candle, placing duplicate sell orders.

**Fix:** Added `isExecutingExit: boolean` property with a guard at the top of `executeExit()` and a `finally` block to reset it. If a second exit trigger fires while the first is executing, it logs a warning and returns without placing a duplicate order.

### Exit System: 5-Layer → 6-Layer

```
BEFORE (Phase 6):                    AFTER (Phase 7):
─────────────────────                ───────────────────────────────────
Layer 1: EOD Safety (3:19 PM)        Layer 1: EOD Safety (3:19 PM)
Layer 2: Emergency Hard Stop (±5%)   Layer 2: Emergency Hard Stop (±5%)
Layer 3: Gamma Climax (15m RSI≥85)   Layer 3: 8% Premium Hard Stop ← NEW
Layer 4: RSI Trail (SHORT only)      Layer 4: Gamma Climax (15m RSI≥85)
Layer 5: Supertrend/BB Break         Layer 5: RSI Trail (SHORT only)
                                     Layer 6: Supertrend/BB Break
```

All layers are independent OR conditions evaluated every 5-min candle. Whichever triggers first exits the position. `isExecutingExit` ensures only one sell order is placed.

### System State at End of Phase 7

```
Architecture:    Scanner (5-min) → StrategyManager (3 slots) → BollingerBandStrategy
Scanner:         TMV + Tactical scoring (max 22.5 = Base 12.5 + Tactical 10.0)
                 68 scans/day (every 5 min from 09:23 to 14:58)
                 Smart Retention: LOCK/KEEP/SWAP/DEPLOY decisions per slot
                 Minimum premium: ₹40 (enforced at scanner + selection + execution)
Universe:        109 stocks across 8+ NIFTY sector indices
Capital:         ~₹69.7K / ~₹47.8K / ~₹65.6K per slot (₹183K total)
Guards:          Risk Distance (>1.5% = reject)
                 Bandwidth (>3.5% = reject)
                 1h Supertrend Alignment (F8) — misaligned = reject
                 RSI Exhaustion (>85/<15 = reject)
                 Gap Trap (>2% = reject)
                 Circuit Proximity (<1.5% = reject)
                 Sector Diversity (max 2/sector)
                 Staleness Guard (3+ candles outside BB = stale)
                 Breakout Validation (first 3 candles must confirm)
                 Symbol Cooldown (30 min after exit)
                 Same-Day Re-Entry Block (no re-entry same day)
                 Lunch Zone Block (11:00–12:30 IST, no new entries)
Entry:           BB breakout + RSI + Supertrend confirmation
Post-Entry:      F7 RSI confirmation (2 candles, LONG<62 / SHORT>32)
                 Breakout validation (3 candle H/L check)
Exit Layers:     1. EOD Safety (3:19 PM)
                 2. Emergency Hard Stop (stock ±5% from entry)
                 3. 8% Premium Hard Stop (option premium ≥8% drop)
                 4. Gamma Climax (15m option RSI ≥ 85)
                 5. RSI Trail Premium Stop (5m RSI ≥ 85 → live LTP, SHORT only)
                 6. Supertrend/BB Break (5m candle close)
Safety:          isExecutingExit re-entrancy guard on all exit triggers
Indicators:      BB(20,2), RSI(14 for options, 10 for stock), Supertrend(10,2)
OI Analysis:     Coiled Spring detection, Eiffel Tower (Concentration Gate + Runway Tiers)
Data:            Per-slot JSON files, strategy state file, OI history
Deployment:      Azure VM with PM2, HTTPS proxy
```

**Performance basis (134 trades, Feb 3 – Mar 5):** Full 3-slot dataset used for all improvement decisions. Real option candle data (not simulated) confirmed SL thresholds.

---

## Phase 8: Scoring Paradox Fix & Time Cutoff (Mar 6, 2026)

**What changed:** A dashboard screenshot revealed Smart Retention inefficiency — 3 deployed stocks all KEEP'd while higher-scoring candidates were rejected. This triggered a deep-dive into scanner scoring patterns. A 210-trade analysis discovered the "loudness paradox" (higher scores correlate with worse performance) and a sharp afternoon P&L cliff. Three categories of fixes were implemented: scoring weight rebalancing, outperformance swap logic, and a 2:00 PM entry cutoff.

### Trigger: Smart Retention Inefficiency

Dashboard showed 3 deployed SHORT stocks all retained via KEEP while 3 higher-scoring LONG candidates (TITAN 15.0, MARUTI 12.6, ASIANPAINT 11.1) were rejected. Root cause: Smart Retention had no mechanism to swap an idle slot for a significantly better candidate — it could only KEEP (score ≥ threshold) or eject (score dropped).

### 210-Trade Scoring Analysis

Parsed 3,996 scanner score log entries across 7 log files. Matched 47 trades to their pre-entry scores (88 unmatched due to log rotation — on dates without score logs).

**The Loudness Paradox:** Higher scanner scores correlated with **worse** performance.

| Score Quartile | Range       | Win Rate  | P&L      |
| -------------- | ----------- | --------- | -------- |
| Q1 (lowest)    | 7.0 – 9.0   | 42.9%     | +₹4,095  |
| Q2             | 9.0 – 10.6  | 36.4%     | –₹10,050 |
| Q3             | 10.6 – 13.2 | 45.5%     | +₹3,230  |
| Q4 (highest)   | 13.2 – 16.6 | **14.3%** | –₹5,668  |

Q4 finding was statistically significant (p < 0.05). Root cause: FB (Fresh Breakout +3.0) and V (Volume +2.0) inflated scores for exhausted moves. FB=3 trades had 30% WR vs FB=0 at 53%. V>0 trades had 27% WR vs V=0 at 44%.

Conversely, PX (Proximity) and RA (RSI Acceleration) were the only winner-signal components: PX>0 had 56% WR, RA>0 had 42% WR.

### QC of Findings

- **SmartMoney hidden component**: Base score includes SM (+2.0 max) not shown in T/M/V/S log breakdown. Fixed by always logging SM.
- **SQ exceeds stated max**: Formula produced values up to 1.4 despite interface stating max 1.0. Fixed with `Math.min(1.0, ...)` wrapper.
- **PX and FB are mutually exclusive**: Code confirmed — proximity only fires if `!isFreshBreakout`.
- **Statistical significance**: Only Q4 finding is p < 0.05. Individual component splits are directional but p > 0.10. Combined patterns (Double Trap, FB-only) reach p < 0.10. Led to conservative half-step weight changes.

### What Was Implemented

#### 1. Score Cap at 13.0

**Location:** MarketScanner.ts — `scoreStocks()`

```
const rawScore = baseScore + tacticalBonus.total;
const score = Math.min(rawScore, 13.0);
```

Raw score logged for traceability, capped score used for ranking. Data: Score ≥13 had 14% WR (p < 0.05).

#### 2. Fresh Breakout Weight: 3.0 → 1.5

**Location:** MarketScanner.ts — `calculateTacticalBonus()`

FB=3 had 30% WR vs FB=0 at 53%. Halved rather than eliminated — fresh breakouts still get a bonus, but they no longer dominate the ranking.

#### 3. Volume Weight Halved: 2.0/1.0/1.0 → 1.0/0.5/0.5

**Location:** MarketScanner.ts — `scoreStocks()` volume section

V>0 had 27% WR vs V=0 at 44%. Volume is now a mild signal rather than a major scoring component. Max volume contribution reduced from 2.0 to 1.0.

#### 4. PX Boosted: 1.5 → 2.0, RA Boosted: 1.0 → 1.5

**Location:** MarketScanner.ts — `calculateTacticalBonus()`

The only two positive-signal tactical components. PX>0 had 56% WR (vs 34%), RA>0 had 42% WR with +₹24K P&L. Modest boost to reward confirmation signals over "loudness" signals.

#### 5. Double Trap Filter

**Location:** MarketScanner.ts — Step 4.5, after score cap, before threshold gates

Rejects stocks where FB fired AND Volume is present BUT neither PX nor RA confirmed. Data: 18% WR (p < 0.10) — exhausted breakouts with high volume but no confirming momentum. These stocks are excluded from `allScored` entirely.

#### 6. SQ (Squeeze Gradient) Cap at 1.0

**Location:** MarketScanner.ts — `calculateTacticalBonus()`

Wrapped formula in `Math.min(1.0, ...)` to enforce stated interface maximum. Previous formula could produce values up to 1.4.

#### 7. SM (Smart Money) Always Logged

**Location:** MarketScanner.ts — top-10 log output

Removed conditional display of SmartMoney component. SM is now always shown in logs as `SM:X.X` for scoring traceability.

#### 8. CASE 5.7: Outperformance Swap

**Location:** StrategyManager.ts — `rebalanceStrategies()` post-loop

After all per-slot retention checks, finds the single weakest idle slot (no active position, survived to KEEP) and swaps it if the best available candidate outscores it by ≥4.0 points.

- Only swaps idle slots (active positions are always protected)
- Only the weakest idle slot is eligible (conservative — max 1 swap per cycle)
- Candidate must not be deployed and not in cooldown
- New SwapReason `'outperformed'` added to retention logging

This directly fixes the original dashboard issue: the system can now promote significantly higher-scoring candidates into idle slots.

#### 9. Entry Cutoff: 2:55 PM → 2:00 PM, Friday Exemption Removed

**Location:** BollingerBandStrategy.ts — `checkEntrySignals()` pre-check area

Unified cutoff block (was duplicated in LONG and SHORT branches). No day-of-week exemptions.

**Data basis (210 trades, post Feb 3):**

| Time Bucket     | Trades | WR%       | P&L         |
| --------------- | ------ | --------- | ----------- |
| 09:30–10:00     | 22     | 50.0%     | +17,997     |
| 10:00–10:30     | 6      | 66.7%     | +24,561     |
| 10:30–11:00     | 13     | 61.5%     | +32,421     |
| 11:00–11:30     | 15     | 40.0%     | –10,350     |
| 11:30–12:00     | 16     | 12.5%     | –27,500     |
| 12:30–13:00     | 16     | 25.0%     | –22,413     |
| 13:30–14:00     | 16     | 37.5%     | –6,443      |
| **14:00–14:30** | **27** | **11.1%** | **–30,924** |
| 14:30–15:00     | 25     | 40.0%     | –14,902     |

The 14:00–14:30 bucket is catastrophic: 3 wins out of 27 trades. A 2:00 PM cutoff flips the system from –33,141 to +12,121 total P&L. Friday after-2PM trades were also net negative (–4,320), so the Friday exemption was removed.

The cutoff is placed in the shared pre-check area before either LONG or SHORT signal branches, alongside the lunch zone block. Scanner continues running until 14:58 for retention decisions — only new entries are blocked.

### Scoring System: Before vs After

```
BEFORE (Phase 7):                    AFTER (Phase 8):
─────────────────────                ───────────────────────────────────
Base (max 12.5):                     Base (max 11.5):
  T: 3.0  M: 3.5  V: 2.0             T: 3.0  M: 3.5  V: 1.0 (halved)
  S: 2.0  SM: 2.0                      S: 2.0  SM: 2.0

Tactical (max 11.0):                 Tactical (max 9.5):
  FB: 3.0  RV: 2.0  PX: 1.5           FB: 1.5  RV: 2.0  PX: 2.0
  RA: 1.0  SQ: ~1.4  GW: 1.5          RA: 1.5  SQ: 1.0  GW: 1.5

Max score: ~23.5 (uncapped)          Max score: 13.0 (hard cap)
No rejection filter                  Double Trap filter (FB+V, no PX/RA)
No outperformance swap               CASE 5.7 outperformance swap (Δ≥4.0)
Entry cutoff: 2:55 PM (Fri exempt)   Entry cutoff: 2:00 PM (no exemptions)
```

### System State at End of Phase 8

```
Architecture:    Scanner (5-min) → StrategyManager (3 slots) → BollingerBandStrategy
Scanner:         TMV + Tactical scoring (max 13.0 = capped)
                 68 scans/day (every 5 min from 09:23 to 14:58)
                 Smart Retention: LOCK/KEEP/SWAP/DEPLOY + CASE 5.7 outperformance swap
                 Double Trap filter: FB+V without PX/RA → rejected
                 Minimum premium: ₹40
Universe:        109 stocks across 8+ NIFTY sector indices
Capital:         ~₹69.7K / ~₹47.8K / ~₹65.6K per slot (₹183K total)
Entry Windows:   09:20–11:00 IST, 12:30–14:00 IST (lunch + afternoon blocked)
Exit Layers:     1. EOD Safety (3:19 PM)
                 2. Emergency Hard Stop (stock ±5% from entry)
                 3. 8% Premium Hard Stop (option premium ≥8% drop)
                 4. Gamma Climax (15m option RSI ≥ 85)
                 5. RSI Trail Premium Stop (5m RSI ≥ 85 → live LTP, SHORT only)
                 6. Supertrend/BB Break (5m candle close)
Deployment:      Azure VM with PM2, HTTPS proxy
```

---

## Current Production System (As of Mar 6, 2026)

### System Identity

A **multi-stock momentum trading bot** that scans 109 F&O stocks every 5 minutes, selects the top 3, and trades their ATM options (≥₹40 premium) using a Bollinger Band + Supertrend strategy with a 6-layer exit system, two post-entry confirmation filters (F7/F8), data-backed entry guards (lunch block, 2:00 PM cutoff, same-day re-entry block), and a rebalanced scoring engine with score cap (13.0), Double Trap filter, and outperformance swap.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          TRADING BOT                                 │
│                                                                      │
│  AuthService (Zerodha OAuth + encrypted session persistence)         │
│       ↓                                                              │
│  StrategyManager (3 slots, Smart Retention, 30-min cooldown)         │
│    → Same-day re-entry block (no re-entry same day)                  │
│    → CASE 5.7: Outperformance swap (Δ≥4.0 idle slot swap)           │
│       ↓                                                              │
│  MarketScanner (TMV + Tactical scoring, 68 scans/day)                │
│    → Guard #1: Risk Distance > 1.5% → REJECT                        │
│    → Guard #2: Bandwidth > 3.5% → REJECT                            │
│    → Guard #3: 1h Supertrend Alignment (F8) → REJECT if misaligned  │
│    → Guard #4: Min premium ₹40 → REJECT if too low                  │
│    → Guard #5: Double Trap filter (FB+V, no PX/RA → REJECT)         │
│    → Score cap: 13.0 (raw score logged for traceability)             │
│    → Sector diversity (max 2/sector)                                 │
│    → Safety filters (RSI exhaustion, gap trap, circuit proximity)    │
│       ↓                                                              │
│  BollingerBandStrategy (per-slot instance)                           │
│    → Entry: BB breakout + RSI + Supertrend confirmation              │
│    → Entry Block: Lunch zone (11:00–12:30 IST)                      │
│    → Entry Block: Afternoon cutoff (2:00 PM, no exceptions)         │
│    → Post-entry: F7 RSI confirmation (2 candles, LONG<62 / SHORT>32)│
│    → Post-entry: Breakout validation (3 candle H/L check)           │
│    → Exit Layer 1: EOD Safety (3:19 PM)                              │
│    → Exit Layer 2: Emergency Hard Stop (stock ±5%)                   │
│    → Exit Layer 3: 8% Premium Hard Stop (option premium drop)       │
│    → Exit Layer 4: Gamma Climax (15m option RSI ≥ 85)               │
│    → Exit Layer 5: RSI Trail Premium Stop (SHORT, 5m RSI ≥ 85)     │
│    → Exit Layer 6: Supertrend/BB Break (5m candle close)            │
│    → Safety: isExecutingExit re-entrancy guard                       │
│       ↓                                                              │
│  Zerodha KiteConnect API (v5.1.0)                                    │
│  (Historical data, quotes, orders, instruments)                      │
│                                                                      │
│  Express Dashboard (port 3000) — real-time slot status, P&L          │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Parameters

| Parameter               | Value                              | Since                  |
| ----------------------- | ---------------------------------- | ---------------------- |
| Bollinger Bands         | Period: 20, StdDev: 2.0            | Phase 3 (Dec 2025)     |
| Supertrend              | Period: 10, Multiplier: 2.0        | Phase 4 (Jan 2026)     |
| RSI (stock)             | Period: 10                         | Phase 5 (Feb 2026)     |
| RSI (options)           | Period: 14                         | Phase 5 (Feb 2026)     |
| Slots                   | 3 concurrent                       | Phase 4 (Jan 26, 2026) |
| Capital/slot            | ₹65,000 initial                    | Phase 4 (Jan 26, 2026) |
| Lot sizing              | 1 lot per ₹40,000                  | Phase 2 (Oct 2025)     |
| Scanner frequency       | Every 5 min (09:23–14:58)          | Phase 5 (Feb 7, 2026)  |
| Stock universe          | 109 F&O stocks                     | Phase 4 (Jan 26, 2026) |
| Max score               | 13.0 (hard cap, was ~23.5)         | Phase 8 (Mar 6, 2026)  |
| F7 RSI confirmation     | 2 candles, LONG <62, SHORT >32     | Phase 6 (Mar 1, 2026)  |
| F8 1h-ST alignment      | Supertrend(10,2) on 60-min candles | Phase 6 (Mar 1, 2026)  |
| Min option premium      | ₹40                                | Phase 7 (Mar 6, 2026)  |
| Premium hard stop       | 8% drop from entry                 | Phase 7 (Mar 6, 2026)  |
| Lunch zone block        | 11:00–12:30 IST                    | Phase 7 (Mar 6, 2026)  |
| Same-day re-entry block | No re-entry same day               | Phase 7 (Mar 6, 2026)  |
| Score cap               | 13.0 (raw logged for traceability) | Phase 8 (Mar 6, 2026)  |
| FB weight               | 1.5 (was 3.0)                      | Phase 8 (Mar 6, 2026)  |
| Volume weight max       | 1.0 (was 2.0)                      | Phase 8 (Mar 6, 2026)  |
| PX weight               | 2.0 (was 1.5)                      | Phase 8 (Mar 6, 2026)  |
| RA weight               | 1.5 (was 1.0)                      | Phase 8 (Mar 6, 2026)  |
| Double Trap filter      | FB+V without PX/RA → reject        | Phase 8 (Mar 6, 2026)  |
| Outperformance swap     | Δ≥4.0 idle slot swap               | Phase 8 (Mar 6, 2026)  |
| Entry cutoff            | 2:00 PM IST (no exceptions)        | Phase 8 (Mar 6, 2026)  |

### Capital Status (Post Mar 5)

| Slot      | Capital      | Trades  | Gross PnL    |
| --------- | ------------ | ------- | ------------ |
| Slot 1    | ₹69,680      | 49      | +₹4,680      |
| Slot 2    | ₹47,758      | 38      | –₹17,242     |
| Slot 3    | ₹65,613      | 47      | +₹613        |
| **Total** | **₹183,051** | **134** | **–₹11,949** |

Note: 134 trades across Feb 3 – Mar 5 (includes F7/F8 live period Mar 2–5). Phase 7 improvements (8% hard stop, lunch block, same-day block, ₹40 premium) go live Mar 7.

### File Inventory

| File                     | Lines  | Purpose                                                                   |
| ------------------------ | ------ | ------------------------------------------------------------------------- |
| BollingerBandStrategy.ts | ~5,188 | Main strategy (entry, 6-layer exit, F7 confirmation, breakout validation) |
| MarketScanner.ts         | ~1,890 | Scanner, scoring, F8 guard, derive60MinCandles                            |
| StrategyManager.ts       | ~1,711 | Slot management, Smart Retention, cooldown, same-day re-entry block       |
| AuthService.ts           | ~300   | Zerodha OAuth, session persistence                                        |
| QuoteManager.ts          | ~200   | Batched quote fetching                                                    |
| InstrumentCache.ts       | ~150   | Local NFO instrument cache                                                |
| index.ts                 | ~2,969 | Express server, multi-strategy dashboard, routes                          |
| universe.ts              | ~250   | 109-stock universe with sector mappings                                   |

---

## Evolution Summary: What Changed When

### Entry Logic Evolution

| Phase              | Entry Logic                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 (Sep 2025) | Pivot Point levels on NIFTY futures                                                                                                                     |
| Phase 2 (Oct 2025) | Same pivot logic but on NIFTY/BANKNIFTY options                                                                                                         |
| Phase 3 (Dec 2025) | Bollinger Band breakout + RSI + Supertrend on NIFTY options                                                                                             |
| Phase 4 (Jan 2026) | Same BB logic but on **individual stock options** (100+ universe)                                                                                       |
| Phase 5 (Feb 2026) | BB + RSI + ST + staleness guard + breakout validation                                                                                                   |
| Phase 6 (Mar 2026) | BB + RSI + ST + staleness + breakout validation + **F7 RSI confirmation** (post-entry) + **F8 1h-ST alignment** (pre-entry scanner guard)               |
| Phase 7 (Mar 2026) | Same as Phase 6 + **lunch zone block** (11:00–12:30) + **₹40 min premium** (scanner) + **same-day re-entry block** (scanner)                            |
| Phase 8 (Mar 2026) | Same as Phase 7 + **2:00 PM cutoff** (was 2:55, Friday exempt removed). Scoring rebalanced (FB↓ V↓ PX↑ RA↑), **Double Trap filter**, **score cap 13.0** |

### Exit Logic Evolution

| Phase                 | Exit Logic                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Phase 1 (Sep 2025)    | Manual exit + basic stop loss                                                                                        |
| Phase 2 (Oct 2025)    | Same manual + SL on options                                                                                          |
| Phase 3 (Dec 2025)    | Percentage-based trailing stop loss (polling LTP)                                                                    |
| Phase 4 (Jan 2026)    | Same trailing SL, now per-slot                                                                                       |
| Phase 5 (Feb 2, 2026) | **5-layer candle-close system**: EOD → Emergency → Gamma Climax → RSI Trail → Supertrend/BB Break                    |
| Phase 6 (Mar 2026)    | Same 5-layer + F7 quick-exit within 2 candles if RSI reverses                                                        |
| Phase 7 (Mar 2026)    | **6-layer**: EOD → Emergency → **8% Premium Hard Stop** → Gamma Climax → RSI Trail → ST/BB Break + re-entrancy guard |

### Instrument Evolution

| Phase     | What Was Traded                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Phase 1   | NIFTY futures                                                                                               |
| Phase 2   | NIFTY / BANKNIFTY options                                                                                   |
| Phase 3   | NIFTY / BANKNIFTY options (Bollinger strategy)                                                              |
| Phase 4   | 100+ individual stock options (scanner-selected)                                                            |
| Phase 5–8 | 109 F&O stocks, top 3 per 5-min scan cycle (≥₹40 premium since Phase 7, score-capped at 13.0 since Phase 8) |

### Scanner Evolution

| Phase            | Scanning                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1–3        | No scanner — fixed instrument                                                                                                          |
| Phase 4 (Jan 26) | TMV scoring, single daily scan at 09:30, top 3 stocks                                                                                  |
| Phase 5 (Feb 7)  | TMV + Tactical scoring (max 22.5), 68 scans/day every 5 min, Smart Retention (LOCK/KEEP/SWAP/DEPLOY), staleness detection, OI analysis |
| Phase 6 (Mar 1)  | Added Guard #3: 1h-Supertrend alignment filter in scanner                                                                              |
| Phase 7 (Mar 6)  | Added Guard #4: ₹40 min premium. Same-day re-entry block at StrategyManager level. Lunch zone block at strategy level                  |
| Phase 8 (Mar 6)  | Scoring rebalanced (FB 3→1.5, V 2→1, PX 1.5→2, RA 1→1.5). Score cap 13.0. Guard #5: Double Trap filter. CASE 5.7 outperformance swap   |

### Capital Evolution

| Phase     | Capital                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| Phase 1–3 | ₹200,000 single allocation (config)                                           |
| Phase 4   | ₹65,000 × 3 slots = ₹195,000                                                  |
| Phase 5–6 | Same ₹65K/slot, dynamic lot sizing (1 lot / ₹40K)                             |
| Phase 7   | Slot 1: ₹69.7K, Slot 2: ₹47.8K, Slot 3: ₹65.6K (₹183K total after 134 trades) |

---

## Lessons Learned

1. **Trailing SL polling was the wrong paradigm.** Replaced by candle-close exit + parallel safety systems. The 5-layer exit hierarchy is the backbone of risk management.

2. **Scanner frequency matters.** Once-daily scan at 09:30 missed intraday opportunities. Moving to every-5-min scanning with Smart Retention was a huge upgrade.

3. **Most improvement ideas hurt performance.** Of 8 factors analyzed, only 2 (F7, F8) were beneficial. The other 6 either had no effect, insufficient data, or were actively destructive. Data > intuition.

4. **Don't fight stock-level momentum with index-level filters.** The Nifty 50 trend hypothesis was quantitatively disproven — counter-trend stock trades have _higher_ win rates because the strategy captures stock-specific momentum.

5. **Multi-timeframe alignment works.** F8 (1-hour Supertrend) had a perfect 9/9 loser kill rate. Checking the macro trend direction before entering micro signals is a reliable filter.

6. **Quick reversals are the biggest leak.** F7 (RSI quick reversal within 2 candles) removed 33 out of 84 trades. Most entries that fail do so within the first 10 minutes.

7. **Same-day re-entries are a trap.** 13 cases across 134 trades, 15.4% WR, –₹14,065 PnL. The impulse to "make it back" on the same stock after a loss destroys capital. Blocking same-day re-entry at the scanner level (not strategy level) ensures idle slots get swapped to different stocks.

8. **Real data beats simulation.** The initial premium SL simulation used exit prices, missing intra-trade drawdowns. Fetching actual 5-min option candles from KiteConnect revealed winners dip significantly (HCLTECH –6.1%, BPCL –5.7%). This changed the SL threshold from a naive 5% to a safe 8%.

9. **Concurrent exit triggers need a mutex.** With 6 independent exit conditions evaluated every candle, race conditions are inevitable. The `isExecutingExit` guard prevented a production bug where duplicate sell orders would be placed.

10. **Lunch hours are dead volume.** Blocking entries during 11:00–12:30 IST avoids the low-liquidity period where breakout signals are unreliable.

11. **High scanner scores can be anti-signals.** The "loudness paradox" — FB (+3.0) and Volume (+2.0) inflate scores for exhausted breakouts. Q4 scores (13.2–16.6) had 14.3% WR. The fix isn't removing these components, but rebalancing weights so confirmation signals (PX, RA) matter more than noise signals (FB, V).

12. **The afternoon is a structural trap.** 210-trade analysis showed a sharp P&L cliff at 2:00 PM. The 14:00–14:30 bucket had 11.1% WR (27 trades, –30,924). This isn't fixable with better stock selection — insufficient runway before EOD exit (88 min) and afternoon mean-reversion dynamics make late entries structurally disadvantaged. Even Fridays, previously exempted, were net losers.

13. **Idle slot management matters.** Smart Retention could KEEP or eject, but had no mechanism to promote a significantly better candidate into an idle slot. CASE 5.7 outperformance swap (Δ≥4.0) fixes this without affecting active positions.

---

_Document generated from 62 git commits (Sep 24, 2025 – Mar 6, 2026), code analysis, and trading data review._
