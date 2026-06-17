# Trading Bot — Complete Strategy Reference (as of 2026-06-17)

> Chronological walkthrough of the live system: **Scan → Score → Select → Deploy → Slot → Entry → Exit/SL**.
> Numbers below reflect the **currently deployed `config/strategies.json`** (the running source of truth), not code defaults.
> Engine: Node.js + TypeScript, Zerodha KiteConnect, 5-minute Bollinger-Band breakout on the underlying, trading **ATM weekly/monthly options** (CE for LONG). PM2 process `trading-bot-bollinger` on Azure VM.

---

## 0. System at a glance

| Layer        | What it does                                                        | Key file                                                 |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
| **Scanner**  | Scores the whole universe every 5 min, picks top 3 tradeable stocks | `src/services/MarketScanner.ts`                          |
| **Manager**  | Owns 3 slots, deploys/retains/swaps stocks, loads flags             | `src/core/StrategyManager.ts`                            |
| **Strategy** | Per-stock state machine: entry → manage → exit                      | `src/strategies/bollinger-band/BollingerBandStrategy.ts` |
| **Config**   | All tunable behavior via `global.experimental` flags                | `config/strategies.json`                                 |

**3 slots, 3 entry styles (A/B in production):**

- **Slot 1 — Immediate** (control): enters on the breakout candle itself.
- **Slot 2 — Pullback** (`pullbackSlots:[1]`): ARM → wait for RSI pullback → confirm → enter.
- **Slot 3 — FVG retrace** (`fvgSlots:[2]`, LONG-only): ARM → find Fair-Value-Gap → wait for retrace into the gap → enter.

**Direction:** `enableShortEntries:false` → the bot is **LONG-only** today. SHORT logic exists in code but is gated off.

---

## 1. Pre-market — data priming

- On successful Zerodha auth, the scanner caches **10 days of 5-minute candles** for the entire universe (~108 stocks).
- Rate-limited to 3 req/s, batched (2 stocks/batch, 1s between batches), ~50–60s for the full universe.
- The universe is auto-generated (`scripts/generate-universe.ts`) from Zerodha's instrument dump into `src/config/universe.ts`, grouped into 13 sector buckets (BANK, PSU BANK, FIN SERVICE, IT, AUTO, METAL, ENERGY, PHARMA, FMCG, INFRA, REALTY, CONSUMER DURABLES, plus a few NIFTY-50 names). Each entry carries `symbol`, NFO `instrumentToken`, `sector`, `sectorToken`, `lotSize`.

---

## 2. Scanning — cadence

- **Smart Retention scanner runs every 5 minutes**, `09:23 → 14:58 IST` (60 scans/day), firing at `:XX:05` (5s after the minute, just before candle close).
- **Hard cutoff `14:58`** — no new scans after that.
- A scan is **skipped** if all 3 slots already hold active positions (nothing to rebalance).
- Each scan: (1) re-fetch fresh historical data for all stocks, (2) 3s cooldown for connection-pool recovery, (3) `scanUniverse()` scores everything, (4) `rebalanceStrategies()` applies retention logic.
- **Post-market cleanup ~15:35**: clears cache, slot states, cooldowns.

---

## 3. Scoring — how a stock earns its number

Final score = **Base (strategic quality)** + **Tactical bonus (urgency)**, **capped at 13.0** (≥13 historically = 14% WR, exhausted moves).

### 3a. Base score (max ~10.5) — computed for every stock

| Component       | Max | LONG logic (current direction)                                                                |
| --------------- | --- | --------------------------------------------------------------------------------------------- |
| **Trend**       | 3.0 | Close>8EMA & 8EMA>21EMA (+1.0); Close>50EMA (+0.5); Close>VWAP (+1.5)                         |
| **Momentum**    | 3.5 | RSI 60–75 sweet spot (+1.5), 75–85 extended (+0.5); RSI rising (+1.0); ADX>25 (+1.0)          |
| **Volume**      | 1.0 | RVOL 2–5 (+0.5), >5 (+0.0, exhaustion), 1.5–2 (+0.25)                                         |
| **Sector**      | 2.0 | Stock's sector is GREEN & matches bias (+1.0); stock outperforms its sector (+1.0)            |
| **Smart Money** | 2.0 | OI-history "coiled spring": accumulation↔LONG (+2.0); opposite signal **disqualifies** (−999) |

Sector classification thresholds: GREEN > +0.25%, RED < −0.25%, else FLAT.

### 3b. Tactical bonus (only if Base ≥ 5.0)

| Code   | Component        | Max  | LONG logic                                                                               |
| ------ | ---------------- | ---- | ---------------------------------------------------------------------------------------- |
| **FB** | Fresh Breakout   | 0.75 | Prev candle ≤ BB upper, current > BB upper (loud move = reduced weight for LONG)         |
| **RV** | RVOL Surge       | 1.0  | >3× (+1.0), >2× (+0.75), >1.5× (+0.5)                                                    |
| **PX** | Proximity        | 2.5  | <0.2% from upper band & rising (not applied if FB already fired)                         |
| **RA** | RSI Acceleration | 2.0  | RSI +5 pts over 3 candles (+2.0)                                                         |
| **SQ** | Squeeze          | 1.0  | Linear decay `min(1, max(0,(3.5−bw%)/2.5))` — tighter band = bigger bonus                |
| **GW** | Gamma Wall       | 1.5  | OI runway tier: VACUUM<25% (+1.5), CLEAN<40% (+1.0), PASSABLE<60% (+0.5), CONGESTED (+0) |

---

## 4. Filters & selection — who actually qualifies

A stock must clear **all** of these to be selectable:

**Hard reject guards (in `scoreStocks`):**

- **Risk distance** ≤ **1.5%**: `|close − supertrend|/close` (else "Risk too high").
- **Bandwidth** ≤ **3.5%**: `(upperBB−lowerBB)/midBB` (else "Over-extended").
- **1-hour Supertrend alignment** (period 10, mult 2, day-boundary-aware 60-min candles): LONG requires 1h ST = **UP**. (Backtested: 9 misaligned trades = 0% WR.)

**Safety filters (`applySafetyFilters`):**

- Min score ≥ **7.0**; RSI not >85 or <15; gap ≤ 2.0%; ≥1.5% from circuit; daily move ≤ 5.0%.
- Counter-trend entries need Base ≥ **8.0**; flat-sector breakouts need Base ≥ **6.5**.

**Selection (`selectTopStocks`):**

1. Sort by score desc, keep score ≥ **7.0**.
2. **Sector cap: max 2 stocks per sector** (correlation control).
3. Validate a tradeable ATM option for each (below), stop at **3** stocks.

**Option/liquidity gate per candidate:**

- Nearest expiry from instrument data; build a 3-strike window `[ATM-1, ATM, ATM+1]`.
- OI-leader must have ≥2× OI of runner-up, with absolute wall OI ≥ **10,000**.
- Premium floor **₹40** (₹20–40 = toxic liquidity, −₹28.7K historically).
- Liquidity: accept if **`OI ≥ 500×lotSize` OR `volume ≥ 500`** (matched between scanner and executor).

The scanner returns up to **3** stocks, each with score, bias (LONG today), sector, and a validated ATM option.

---

## 5. Deployment & retention — Manager decides per slot

Every scan, each of the 3 slots gets one decision:

```
LOCK   → has active position OR armed pullback OR FVG watch  → never touch
KEEP   → idle, score still ≥ 6.0                            → retain
SWAP   → a swap reason fires                                → stop & replace
DEPLOY → empty slot                                         → deploy best candidate
```

**LOCK** (`lockOnActivePosition:true`) protects in-flight state: `hasActivePosition` OR `hasArmedSignal` (pullback) OR `hasFvgWatch` (FVG). This is why an armed/​watching slot is never stolen mid-setup.

**Swap reasons:**

- _Hard (fire immediately):_ `not_in_scan`, `bias_flip`, `bias_not_allowed`, `in_cooldown`.
- _Soft (deferred if slot age < `minDeploymentAgeMinutes`=10 min):_ `momentum_died` (score < 6.0), `stale_breakout`, `outperformed` (a better idle-slot candidate beats current by ≥ **4.0** score delta).

**Bias gating per slot:** Slot 3 (FVG) is **LONG-only**; with `enableShortEntries:false` **all** slots are LONG-only.

**Deploy** creates a fresh `BollingerBandStrategy` instance (`bollinger-slot{N}-{symbol}`), seeds it with the scanner's option + 10 days of candles, capital ₹65,000, records `deployedAt` (drives the 10-min soft-swap guard), and `start()`s it.

**Anti-churn / safety:**

- `minDeploymentAgeMinutes:10` — new deploys settle 10 min before soft-swaps.
- **Symbol cooldown:** 30 min after any exit **+ same-day re-entry block** (same stock can't re-enter that day).
- **Slot post-loss lockout** (`enableSameSlotPostLossLockout:true`): a slot that took a loss is locked for the rest of the day.
- **Kill switch** (`scannerKillSwitch`): after **4** consecutive losing trades in a day, all entries are blocked.

---

## 6. Live candle ingestion (all slots)

- Each 5-min cycle fetches the latest closed candle (`getHistoricalData`, last 10 min).
- **`floorTo5Min`** normalizes every candle timestamp to its 5-min boundary so the multi-day seed (`:00`) and live fetches (Kite echoes the request seconds, e.g. `:07`) align. **Without this, the same bar gets pushed twice** — the duplicate-candle bug fixed 2026-06-16 that had broken FVG windows and skewed indicators.
- Dedup: identical timestamp+OHLC → ignore; same timestamp, new OHLC → update in place; newer → push. Keep last 50 candles. Then recompute RSI(10)/Supertrend(10,2)/Bollinger(20,2) and run entry/exit checks.

---

## 7. Entry — three modes

All modes share **pre-entry filters** (evaluated before any arm/enter). Active ones today:

- **Pivot guard** (block all entries until PDH/PDL/pivots loaded).
- **Slot post-loss lockout**, **kill switch**, **symbol cooldown**.
- **Lunch block** 11:00 → **13:00** IST (`lunchBlockEndMinutesIst:780`) — blocks **immediate** entries only; pullback & FVG may still ARM.
- **Afternoon cutoff** ≥ **14:00** — blocks **immediate** entries only; pullback & FVG may still ARM/progress.
- _Gated OFF currently:_ extended gap trap, stale-breakout filter, wide-range-day filter, extreme-NIFTY-range filter, VIX lot reduction.

### 7a. Slot 1 — Immediate (control)

LONG fires when **all** are true on the just-closed 5-min candle:

1. `close > BB upper`
2. `RSI(10) ∈ [68, 85]`
3. `Supertrend = UP`
4. `close > R1` **or** `close > PDH`
5. candle bullish (`close ≥ open`)

→ selects ATM CE, places the BUY. (Subject to lunch/2 PM blocks above.)

### 7b. Slot 2 — Pullback (`enablePullbackEntry`)

State machine: **ARM → PULLBACK_SEEN → CONFIRMED → enter**.

- **ARM** when the immediate LONG conditions hit (stores signal candle high/low/close/RSI).
- **PULLBACK_SEEN**: a later candle with `RSI < 60` and `close < signalHigh`; tracks running pullback low.
- **CONFIRMED → ENTER**: bullish candle that `close > signalHigh` and `RSI > 60`.
- **Timeouts:** no pullback within **8 candles** (40 min) → abandon; no confirm within **2 candles** (10 min) after pullback → abandon.
- **Other abandons:** price extends > **1.5%** beyond signal close (won't chase), or Supertrend flips DOWN.
- **Structural stop** (`useStructuralStockStop:true`): `pullbackLow × (1 − 0.0005)` stored on the position.

### 7c. Slot 3 — FVG retrace (`enableFvgEntry`, LONG-only)

A **bullish Fair-Value Gap** = 3 candles where `c1.high < c3.low` (a price imbalance). Zone = `[floor=c1.high, ceiling=c3.low]`, structural stop `slLevel=c2.low`, must be ≥ **0.15%** of impulse close (`fvgMinGapPct`).

Lifecycle: **ARM → (find FVG) → wait for retrace → TRIGGER → ratchet → ENTER**.

1. **ARM** on the LONG signal candle.
2. **Lookback** (`enableFvgLookback`, 5 candles): at ARM, immediately scan the last 5 three-candle windows (c3 ≤ signal) for an **untouched** FVG and seed it. (Added 2026-06-09 to catch retests of the breakout-impulse gap itself — the BOSCH case.)
3. **Forward scan** (up to **8** candles): if no FVG yet, look for one forming from post-arm candles.
4. **Upgrade** (`enableFvgUpgrade`, added 2026-06-17): while **pre-trigger only**, if a newer candle completes a valid FVG with a **strictly newer impulse**, replace the watched zone. This lets the big signal-impulse gap (which completes one candle _after_ arm) supersede a marginal earlier gap — the **HAL** case. Stops upgrading the instant a trigger is set.
5. **TRIGGER**: first candle to wick into `[floor, ceiling]` sets the trigger at that candle's high.
6. **Ratchet**: subsequent in-zone candles with a lower high ratchet the trigger down (better fill).
7. **ENTER**: a later candle's high ≥ trigger → BUY. Structural stop = `slLevel × (1 − 0.0005)`.
8. **Invalidation:** candle **closes below floor** (`fvgInvalidateOnFloorClose:true`) → cancel & free slot; or **lifetime > 48 candles** (~4 h); or no FVG formed within the 8-candle scan window.

### 7d. Option selection & sizing (all modes)

- ATM CE on the nearest expiry; fallback 1-OTM if ATM premium < **₹40**.
- Order-time guards: premium ≥ ₹40, `OI≥500×lot OR vol≥500`, bid-ask spread ≤ **2%**. (Exits never blocked.)
- **Lots = floor(capital / 40,000), min 1.** Default ₹65,000/slot → 1 lot. (VIX lot reduction gated off.)

---

## 8. Exit & Stop-Loss — the protection stack

Exits converge on `executeExit(reason)` (single sell path, race-guarded by `isExecutingExit`). **Active layers today** (gated-off ones noted):

| #   | Exit                       | Trigger                                                                                                                                                                  | Basis  | Status                                  |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------- |
| 1   | **EOD safety**             | **15:19 IST** one-shot timer (before 3:25 broker square-off)                                                                                                             | option | **Always on**                           |
| 2   | **Emergency hard stop**    | underlying moves **±5%** from entry (polled every 30s)                                                                                                                   | stock  | **Always on**                           |
| 3   | **Structural stock stop**  | underlying crosses the structural level (pullback low / FVG `slLevel`, −0.05% buffer)                                                                                    | stock  | **On** (`useStructuralStockStop`)       |
| 4   | **Gamma RSI climax**       | **option** RSI(14) **≥ 85** on 15-min candle (60s grace after entry)                                                                                                     | option | **Always on**                           |
| 5   | **RSI trail**              | activate when **option** 5-min RSI(14) **≥ 85** → trail floor at candle low (ratchets up); live-poll every 5s, exit if LTP ≤ floor; secondary exit if 5-min RSI < **75** | option | **Always on**                           |
| 6   | **Supertrend break**       | 5-min **stock** candle **closes below Supertrend(10,2)** → `LONG_SUPERTREND_BREAK`                                                                                       | stock  | **Always on**                           |
| 7   | Premium hard stop (8%)     | option premium −8% from entry                                                                                                                                            | option | **OFF** (`enablePremiumHardStop:false`) |
| 8   | Breakout no-follow-through | entry high not exceeded in 3 candles                                                                                                                                     | stock  | **OFF**                                 |
| 9   | RSI confirmation (F7)      | stock RSI(10) < 62 within 2 candles of entry                                                                                                                             | stock  | **OFF**                                 |

**Minimum holding time** (`minHoldingTimeMinutes:20`): defers most exits until the trade is ≥20 min old — **except** emergency stop, structural stop, EOD, gamma climax, RSI trail, and manual/restart exits, which are always allowed.

**In practice** (matches live logs): the two dominant exits are **`LONG_SUPERTREND_BREAK`** (trend exit) and **`EOD_SAFETY_EXIT_3:19PM`**; layers 7–9 effectively never fire because they're off.

**Reconciliation:** every 2 min (staggered per slot) the bot checks broker net positions; if the broker squared a position the bot didn't, it reconciles and records P&L.

**P&L:** `gross = (exit − entry) × qty`; `net = gross − round-trip charges` (₹20+₹20 brokerage + STT 0.15% sell + SEBI + GST 18% + IPFT). Capital updates after each exit; trade record persisted to the slot's JSON.

---

## 9. End-to-end timeline (one LONG trade, Slot 3 FVG example)

```
09:23–14:58   Scanner scores universe every 5 min
   ↓          Stock X: score ≥7, 1h ST up, risk<1.5%, bandwidth<3.5%, ATM option liquid
DEPLOY        Manager places X into empty Slot 3 (LONG), seeds option+history, deployedAt set
   ↓
ARM           5-min candle meets LONG breakout conditions → FVG watch armed
LOOKBACK      Seeds an untouched FVG from the last 5 windows (if any)
UPGRADE       If the signal-impulse forms a bigger FVG next candle → supersede (pre-trigger)
RETRACE       Price wicks back into [floor, ceiling] → TRIGGER set; ratchets down on lower highs
ENTER         Candle high ≥ trigger → BUY ATM CE (1 lot), structural stop = c2.low − 0.05%
   ↓          Slot LOCKED (protected from swaps); emergency/structural/RSI monitors start
MANAGE        Each 5-min close: supertrend-break check; option RSI climax/trail; 5% emergency
EXIT          Supertrend break OR RSI trail OR structural stop OR 15:19 EOD → executeExit()
   ↓          P&L = gross − charges; capital updated; 30-min + same-day cooldown on X;
              if loss → Slot 3 locked for the day
```

---

## 10. Current configuration snapshot (2026-06-17)

**Direction & slots:** LONG-only · Slot 1 immediate · Slot 2 pullback (`pullbackSlots:[1]`) · Slot 3 FVG (`fvgSlots:[2]`).

**Active flags:** `enableSameSlotPostLossLockout:true`, `lunchBlockEndMinutesIst:780`, `minHoldingTimeMinutes:20`, `scannerKillSwitch{enabled:true, maxConsecutiveLossesPerDay:4}`, `enablePullbackEntry:true`, `enableFvgEntry:true`, `enableFvgLookback:true`(5), `enableFvgUpgrade:true`, `useStructuralStockStop:true`, `liquidityOiMultiplier:500`, `liquidityMinVolFallback:500`.

**Disabled flags:** `enableShortEntries`, `enablePremiumHardStop`, `enableRsiConfirmationExit`, `enableBreakoutNoFollowThroughExit`, `enableExtendedGapTrap`, `enableStaleBreakoutFilter`, `enableWideRangeDayFilter`, `enableExtremeNiftyRangeFilter`, `enableVixLotReduction`.

**Key constants:** scan 09:23–14:58/5min · minScore 7.0 · top 3 · max 2/sector · premium ≥₹40 · liquidity OI≥500×lot OR vol≥500 · keepThreshold 6.0 · outperform delta 4.0 · minDeployAge 10min · capital ₹65k/slot · 1 lot/₹40k · emergency ±5% · EOD 15:19 · gamma/trail RSI 85 · supertrend(10,2) · BB(20,2) · RSI(10 stock /14 option).

---

## 11. Verification status (2026-06-17)

- `tsc --noEmit`: **clean**.
- QC harnesses: **`qc-fvg-replay` 53/53**, **`qc-candle-dedup` 17/17**, **`qc-bias-filter` 17/17**.
- VM: pm2 **online, 0 restarts**; loaded flags match config; scanner selecting with sector caps; all 3 slots tracked. Live today: lookback fired (HAL `FVG PRE-FORMED`), full FVG lifecycle → entry (SIEMENS), candle timestamps floored to `:00`.

> **Maintenance note:** the QC harnesses mirror production logic (`detectBullishFvg`, `findRecentUntouchedBullishFvg`, `maybeUpgradeFvg`, `progressFvgWatch`, the dedup/append branch). If you change any of these in `BollingerBandStrategy.ts`, update the matching mirror in `scripts/qc-*.ts`.
