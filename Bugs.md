1. Query 5m candles every 5 min exact - fixed
2. Volume 50 sma start of day fix - fixed
3. Breakout - price should not have crossed the pivot high in the past 15 candles
4. Marking candle - timelimit for first marking candle is within first 5 mins of breakout - fixed
5. Dynamic SL update -> Dynamic Marking candle update (before entry is triggered) [Wording change ; low priority]
6. Marking candle update - less than vs greater than - fixed
7. If entry triggered, marking candle update stops (update mermaid diagram in documentation)
8. NIFTY FUT price streaming - web socket
9. Waiting for trade state -> Need additional "Marking candle update" state
10. manual trade exit
11. Max time in trade
12. MIS trade instead of CNC - fixed

---

1. 5-minute Candles Querying Issue
   Location: NiftyBreakoutRetracementStrategy.ts - startBreakoutDetection() method Problem: 5-minute candles are only loaded once at startup. They should be refreshed every 5 minutes exactly during market hours. Current Code: Only calls this.detectPivotPoints() every 5 minutes Expected: Should also refresh historical 5-minute candles every 5 minutes

2. Volume SMA50 Start-of-Day Initialization
   Location: NiftyBreakoutRetracementStrategy.ts - fetchHistorical1MinuteCandles() method Problem: If there are fewer than 50 historical 1-minute candles available, volume SMA50 will be unreliable initially Current Code: Warns when less than 50 candles but doesn't handle graceful degradation Impact: Breakout detection may fail early in the trading session

3. Breakout Validation - Missing Pivot Crossing Check
   Location: NiftyBreakoutRetracementStrategy.ts - checkForBreakout() method Problem: Missing validation to ensure price hasn't crossed the pivot high/low in the past 15 candles Current Code: Only checks if current candle breaks the pivot, but doesn't verify recent price history Impact: May trigger false breakouts on repeated attempts

4. Marking Candle Time Limit Logic Error
   Location: NiftyBreakoutRetracementStrategy.ts - processMarkingCandle() method Problem: Uses "5 bars" limit instead of "5 minutes" for initial marking candle search Current Code: if (markingState.barsProcessedSinceBreakout <= 5) Expected: Should be time-based (5 minutes) not bar-based (5 bars)

5. Marking Candle Update Logic - Incorrect SL Condition
   Location: NiftyBreakoutRetracementStrategy.ts - checkForMarkingCandleUpdate() method Problem: SL update condition is backwards - it extends risk instead of reducing it Current Code: For LONG breakouts, checks (currentSL - newSL) >= 1 which moves SL away from entry Expected: Should check (newSL - currentSL) >= 1 to move SL closer to entry (reduce risk)

6. Missing Marking Candle Update State
   Location: TradeState enum in NiftyBreakoutRetracementStrategy.ts Problem: Only has 3 states: WAITING_FOR_BREAKOUT, WAITING_FOR_ENTRY, IN_TRADE Missing: Should have MARKING_CANDLE_UPDATE state between breakout and entry Impact: State management is unclear when marking candle updates are happening

7. Entry Trigger Handling - Missing Update Stop
   Location: NiftyBreakoutRetracementStrategy.ts - checkEntryTrigger() method Problem: Marking candle updates continue even after entry is triggered Expected: Should stop marking candle updates once entry level is crossed

8. NIFTY Futures Price Streaming Issue
   Location: NiftyBreakoutRetracementStrategy.ts - fetchAndProcessLivePrice() method Problem: Uses NFO:${contract.tradingsymbol} format, but Kite API might expect different format Potential Issue: Symbol format may not be correct for quote fetching

9. Volume SMA50 Division by Zero Risk
   Location: NiftyBreakoutRetracementStrategy.ts - updateVolumeSMA50() method Problem: If oneMinuteCandles is empty, sets SMA to 0, which could cause issues in breakout detection Impact: Division by zero or invalid volume ratio calculations

10. State Recovery Logic Gap
    Location: NiftyBreakoutRetracementStrategy.ts - performStateRecovery() method Problem: State recovery doesn't handle marking candle system state restoration Impact: If system restarts during marking candle phase, state may be inconsistent
