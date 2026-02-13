Starting: *Compile & deliver findings report* (8/8)

Now let me check one more file - the index.ts and StrategyManager.ts initialization (first 500 lines) were read in the prior conversation. Let me do a few targeted searches for potential issue patterns I've identified:  

Searched for text `fetchExitOrderFromBroker`, 2 results

Searched for regex `SELL.*transaction_type|transaction_type.*SELL` (`**/src/**`), 1 result

Searched for regex `currentMinutes === 935|currentTime === 935`, 3 results

Searched for regex `lot_size|lotSize` (`**/src/strategies/**`), 10 results

Searched for regex `clearInterval|clearTimeout` (`**/src/**`), 25 results

Searched for regex `entryCandleLow|entryCandleHigh` (`**/src/strategies/**`), 20 results

Now let me check the post-market cleanup timing issue I spotted: 

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/core/StrategyManager.ts#855-855), lines 855 to 880

Searched for regex `SHORT.*cutoff|2:55|14.*55` (`**/src/strategies/**`), 8 results

Searched for regex `LONG.*cutoff|LONG.*blocked.*time|late.*LONG|3:.*PM.*LONG` (`**/src/strategies/**`), 2 results

Searched for regex `setInterval.*[^0-9](?:startHealth|healthMonitoring)` (`**/src/**`), no results

Summarized conversation history

Searched for text `startHealthMonitoring` (`**/src/**`), 4 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#2195-2195), lines 2195 to 2270

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#500-500), lines 500 to 560

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/core/StrategyManager.ts#690-690), lines 690 to 750

Searched for text `scheduleDailyCacheRefresh` (`**/src/**`), 4 results

Searched for regex `LONG.*cutoff|cutoff.*LONG|entry.*cutoff|late.*entry|NO_NEW_LONG` (`**/src/**`), 4 results

Searched for text `scheduleEODExit` (`**/src/**`), 3 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#1748-1748), lines 1748 to 1800

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#3710-3710), lines 3710 to 3760

Searched for regex `SHORT.*2:55|14:55|1455|NO_NEW_SHORT` (`**/src/**`), 4 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#2900-2900), lines 2900 to 2960

Searched for regex `entry.*block|block.*entry|skip.*entry|entry.*skip|NO_ENTRY|noEntry|entryAllowed` (`**/src/strategies/**`), 20 results

Searched for regex `calculateATR|atr.*calculation` (`**/src/**`), 2 results

Searched for text `processCandleCompletion` (`**/src/**`), 3 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#1530-1530), lines 1530 to 1570

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#2700-2700), lines 2700 to 2780

Searched for text `calculateSupertrend` (`**/src/services/MarketScanner.ts`), 2 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/services/MarketScanner.ts#1870-1870), lines 1870 to 1950

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#2330-2330), lines 2330 to 2370

Searched for text `hadPositionBeforeExitCheck` (`**/src/strategies/**`), 2 results

Now let me verify a few final patterns for the report:  

Searched for text `forceClosePosition` (`**/src/strategies/**`), 3 results

Searched for regex `previousDayClose.*===.*0|previousDayHigh.*===.*0|previousDayLow.*===.*0` (`**/src/**`), no results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#3698-3698), lines 3698 to 3712

Searched for regex `previousDayClose\s*>\s*0` (`**/src/**`), 2 results

Searched for regex `this\.previousDayClose\s*=|this\.previousDayHigh\s*=|this\.previousDayLow\s*=` (`**/src/strategies/**`), 7 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#1840-1840), lines 1840 to 1870

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts#760-760), lines 760 to 790

Searched for regex `previousDayClose.*:\s*number|previousDayClose\s*=\s*0` (`**/src/strategies/**`), 1 result

Good catch - `previousDayClose` is initialized to 0 and is NOT reset in `dailyCleanup()`. Now let me check one more thing about the `OIHistoryService` and remaining utility files:   

Searched for text `OIHistoryService` (`**/src/**`), 20 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/utils/StateLock.ts#1-1), lines 1 to 50

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/utils/InstrumentCache.ts#1-1), lines 1 to 50

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/utils/InstrumentCache.ts#50-50), lines 50 to 90

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/utils/StateLock.ts#50-50), lines 50 to 150

Now I have enough context to compile the complete findings report. Let me also check the `index.ts` for any server-level issues: 

Searched for regex `app\.(get|post|listen|use)|SIGTERM|SIGINT|process\.on` (`**/src/index.ts`), 20 results

Searched for regex `SIGTERM|SIGINT|process\.on|graceful` (`**/src/index.ts`), 10 results

Read [](file:///c%3A/Users/aabishek/Documents/repo-local/tradebot-bollinger-multistock/src/index.ts#2945-2945), lines 2945 to 2975

Now I have all the data. Let me compile the comprehensive QC findings report.

---

# COMPREHENSIVE QC AUDIT REPORT

**Scope**: Every source file in src, every logic path, end-to-end review  
**Mode**: READ-ONLY — no code changes applied  
**Date**: Based on codebase as of Feb 12, 2026

---

## CRITICAL (Can Lose Real Money)

### 1. NO LATE-DAY LONG ENTRY CUTOFF
**File**: BollingerBandStrategy.ts  
SHORT entries are blocked after 2:55 PM (non-Friday) at BollingerBandStrategy.ts. **There is NO equivalent restriction for LONG entries.** A LONG signal at 3:14 PM would execute an option BUY, only to be force-closed at 3:19 PM by EOD exit — less than 5 minutes of runway. With spread + slippage on both entry and exit, this is almost guaranteed to lose money.

### 2. `previousDayClose` NOT Reset in `dailyCleanup()`
**File**: BollingerBandStrategy.ts  
`dailyCleanup()` resets `previousDayHigh = 0` and `previousDayLow = 0` at BollingerBandStrategy.ts, but **does NOT reset `previousDayClose`**. If the daily pivot API call (`calculateDailyPivotsFromMarketData`) fails on a new day, the Gap Trap filter at BollingerBandStrategy.ts and BollingerBandStrategy.ts uses the **stale** `previousDayClose` from N days ago. The `todayChangePct` calculation becomes wrong, potentially letting through dangerous gap trades or blocking valid ones.

### 3. `previousDayHigh`/`previousDayLow` Reset to 0 — Entry Conditions Become Trivially True
**File**: BollingerBandStrategy.ts  
After `dailyCleanup()`, both are set to `0`. If `calculateDailyPivotsFromMarketData()` then fails and fallback pivots are used ([line 1822](src/strategies/bollinger-band/BollingerBandStrategy.ts#L1822)), it attempts to set them. But if ALL pivot paths fail, the LONG condition `close > PDH` (where PDH = 0) is **always true**, and SHORT condition `close < PDL` (where PDL = 0) is **always false**, creating asymmetric trading behavior.

### 4. Graceful Shutdown Does NOT Call `StrategyManager.shutdown()`
**File**: index.ts  
Both `SIGTERM` and `SIGINT` handlers call `process.exit(0)` immediately **without invoking** `StrategyManager.shutdown()`. This means:
- Running strategies are NOT stopped gracefully
- Position state may not be saved to disk
- Active orders are abandoned without cancellation
- Timer cleanup in `stop()` never executes

---

## HIGH (Significant Logic Issues)

### 5. `startHealthMonitoring()` Interval NEVER Cleaned Up
**File**: BollingerBandStrategy.ts  
The `setInterval` at BollingerBandStrategy.ts does **not** store the interval reference. The `stop()` method has no code to clear it. With 3 slots, each restart leaks 3 intervals. Over a trading day with rebalancing, this accumulates increasingly many phantom health monitors.

(Compare: `StrategyManager.startHealthMonitoring()` at StrategyManager.ts correctly stores `this.healthCheckTimer` and clears on restart.)

### 6. `scheduleDailyCacheRefresh()` setTimeout Chain NEVER Cleaned Up
**File**: BollingerBandStrategy.ts  
Uses recursive `setTimeout` but the handle is never stored. The `stop()` method cannot cancel it. Each restart via rebalancing creates an additional hanging timeout. When it fires after the strategy has been stopped and swapped, it runs `this.cacheHistoricalData()` on a detached (stopped) strategy with potentially stale references.

### 7. Scanner vs Strategy Use Different ATR Algorithms → Different Supertrend Values
**File**: MarketScanner.ts vs BollingerBandStrategy.ts  
- **MarketScanner**: ATR = SMA of last N true ranges (simple average at MarketScanner.ts)
- **BollingerBandStrategy**: ATR = RMA / Wilder's smoothing (exponential at BollingerBandStrategy.ts)

This means scanner may rank a stock as "Supertrend BULLISH" but the strategy calculates "Supertrend BEARISH" for the same stock, causing no entry signals despite being deployed.

### 8. Scanner Supertrend Uses Single Static ATR for All Bars
**File**: MarketScanner.ts  
The scanner calculates ATR **once** as SMA of the last `period` TRs, then uses that single `atr` value for ALL bars in the Supertrend loop ([line 1912](src/services/MarketScanner.ts#L1912): `const basicUB = hl2 + (multiplier * atr)`). This means the Supertrend bands don't adapt to changing volatility across the candle series — the entire calculation is pinned to the trailing ATR snapshot.

### 9. `processCandleCompletion()` Dead Code — Duplicate Candle Risk If Reactivated
**File**: BollingerBandStrategy.ts  
`processCandleCompletion()` pushes candles to `candleHistory` and keeps last 100. The active code path `fetchLatest5MinuteCandle()` does the same but keeps last 50. If the polling-based code path (`buildFiveMinuteCandle` → `completeFiveMinuteCandle` → `processCandleCompletion`) is ever reactivated alongside the master cycle, candles would be double-counted, corrupting all indicator calculations.

### 10. Exit Check Has 15-Second Window — Can Miss Exits on Slow API
**File**: BollingerBandStrategy.ts  
Exit checks only fire when `minutes % 5 === 0 && seconds <= 15`. If the candle fetch + API response takes more than 15 seconds (network hiccup, API throttling), the exit check is **skipped entirely** for that candle. The position continues until the next 5-minute boundary. Combined with the Emergency Hard Stop's 5% threshold, a 4.9% adverse move lasting one full candle is unprotected.

---

## MEDIUM (Logic Inconsistencies / Robustness)

### 11. `fetchLatest5MinuteCandle()` Only Fetches Last 10 Minutes of Data
**File**: BollingerBandStrategy.ts  
`fromDate` is `toDate - 10 minutes`. This gives exactly 2 candles. If the API delays returning data (data is not yet available for the latest candle), you get only the previous candle. The code takes `historicalData[historicalData.length - 1]`, which would be the stale candle. The "candle age" warning at BollingerBandStrategy.ts detects this, but only **warns** — it doesn't skip or retry.

### 12. `candleHistory` Size Inconsistency: 50 vs 100
**File**: BollingerBandStrategy.ts  
- `fetchLatest5MinuteCandle()` trims to 50 candles
- `processCandleCompletion()` trims to 100 candles

If code paths are ever mixed, Bollinger Bands (20-period) and Supertrend (10-period + ATR warmup) could compute from different history depths.

### 13. `dailyCleanup()` Clears `currentPosition` Without Checking Active Orders
**File**: BollingerBandStrategy.ts  
`dailyCleanup()` sets `this.currentPosition = null` and saves to disk. If somehow called while an order is in `waitForOrderExecution()`, the strategy loses track of the live position. The order would remain on the broker but the bot believes it has no position.

### 14. `waitForOrderExecution()` Clean Kill Can Leave Orphan Broker Orders
**File**: BollingerBandStrategy.ts  
When `waitForOrderExecution()` receives a "clean kill" signal (order still OPEN), it returns `null` without cancelling the order on the broker. The calling code treats `null` as "order didn't execute" and proceeds, but the broker order may fill later, creating an untracked position.

### 15. SmartMoney OI Analysis Only Active on Non-Expiry Weeks
**File**: MarketScanner.ts  
During expiry weeks, Smart Money scoring is entirely skipped (`oiScore: 0.0`). This removes 2.0 points of scoring capacity, making all stocks score lower during expiry weeks. No compensating weight redistribution occurs.

### 16. `startPositionMonitoring()` Timer Logic — Emergency Stop Starts Even Without Position
**File**: BollingerBandStrategy.ts  
`startPositionMonitoring()` starts the QuoteManager subscription and Emergency Hard Stop. These run continuously polling LTP even when no position is active. The `processLTPUpdate()` returns early if no position, but the overhead of constant quote polling per slot is unnecessary.

### 17. Scanner `selectTopStocks()` — `findATMOption()` Failure Silently Drops Stock
**File**: MarketScanner.ts  
If `findATMOption()` throws or returns no valid option (Eiffel Tower failure, OI too low), the stock is silently skipped. With all 3 top stocks failing option validation, rebalancing deploys nothing, leaving slots empty unnecessarily.

---

## LOW (Minor / Edge Cases)

### 18. `removeFromQueue()` in StateLock Matches by Wrong Resolver
**File**: StateLock.ts  
`removeFromQueue` compares `entry.resolve === resolveFunction`, but `resolveFunction` is the outer Promise's `resolve`, not the queue entry's wrapped `resolve`. The identity comparison may never match, meaning timed-out queue entries could accumulate and fire late.

### 19. Scanner `derive15MinCandles()` Assumes Exact 3:1 Ratio
**File**: MarketScanner.ts  
Groups 5-min candles into 15-min by sets of 3. If the API returns an odd number of candles (e.g., short trading day, holidays), the last 1-2 candles are dropped, potentially losing the most recent data point.

### 20. InstrumentCache Expiry Date Restoration — `new Date(string)` Timezone Risk
**File**: InstrumentCache.ts  
`expiry: new Date(i.expiry)` restores dates from JSON strings. If the server timezone changes or daylight saving applies differently, expiry comparison in option selection could be off by a day, potentially selecting the wrong expiry.

### 21. StrategyManager `rebalanceStrategies` KEEP Threshold Always 6.0
**File**: StrategyManager.ts  
The KEEP threshold is hardcoded at `score >= 6.0`. If market conditions change (low volatility day), all stocks may score below 6.0, causing constant SWAP churn even when current stocks are the best available.

### 22. Cooldown Check Uses Static Method But State Is Instance-Scoped
**File**: StrategyManager.ts  
`StrategyManager.addSymbolCooldown()` and `isSymbolOnCooldown()` use a static `symbolCooldowns` Map, meaning cooldowns are shared across all StrategyManager instances. Currently there's only one instance, but this is fragile.

---

## INFORMATIONAL (Design Notes / Not Bugs)

### 23. `uncaughtException` Handler Calls `process.exit(1)` — No Strategy Cleanup
**File**: index.ts  
On uncaught exception, the process crashes immediately. This is standard practice (continuing is unsafe), but combined with finding #4, positions are abandoned.

### 24. RSI Ranges Differ for LONG (68-85) vs SHORT (15-40)
**File**: BollingerBandStrategy.ts and BollingerBandStrategy.ts  
Intentional asymmetry but the SHORT range is significantly wider (25 points) vs LONG (17 points), making SHORT entries easier to trigger. Worth noting for strategy tuning.

### 25. Polling-Based Monitoring (`startPollingBasedMonitoring`) Is Fully Disabled
**File**: BollingerBandStrategy.ts  
The method exists as dead code. All candle processing goes through the master cycle → `fetchLatest5MinuteCandle()`. The `buildFiveMinuteCandle`, `completeFiveMinuteCandle`, `processCandleCompletion` chain is vestigial.

### 26. Scanner Scores Stocks on `-grade` Metric, `grade` is Removed Downstream
**File**: MarketScanner.ts  
`scoreStocks()` returns grade/tier metadata, but `selectTopStocks()` primarily uses the numeric score. The grading is for logging/display only.

---

## SUMMARY TABLE

| Severity | Count | Key Risks |
|----------|-------|-----------|
| **CRITICAL** | 4 | Late LONG entry, stale PDC, PDH/PDL=0, no graceful shutdown |
| **HIGH** | 6 | Leaked intervals, ATR mismatch, dead code risk, missed exits |
| **MEDIUM** | 7 | Stale candle data, orphan orders, position tracking gaps |
| **LOW** | 5 | Edge cases in StateLock, cache dates, rebalance churn |
| **INFORMATIONAL** | 4 | Dead code, design notes |
| **Total** | **26** | |
