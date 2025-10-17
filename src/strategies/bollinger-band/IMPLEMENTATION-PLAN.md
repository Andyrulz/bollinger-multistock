# Bollinger Band Strategy - Imp - Load 7 days of 5-minute NIFTY50 spot historical candles

- Handle weekends/holidays automatically (7-day window ensures sufficient data)
- If insufficient data, extend day by day up to 14 days maximum
- Stop iteration once sufficient candles obtained (minimum 20 for Bollinger Bands)
- Store in local array for indicator calculations
- Calculate initial technical indicators from historical data:
  - RSI(10) - requires minimum 10 candles
  - Supertrend(10,2) - requires minimum 10 candles
  - Bollinger Bands(20,2) - requires minimum 20 candleson Plan & Flow

## **Key Corrections & Requirements**

### **1. Entry Condition Corrections**

- **SHORT Entry**: Close <= **R1** (not S1) - corrected as per user feedback
- **LONG Entry**: Close > Upper BB + RSI(70-80) + Supertrend green + Above R1/R2

### **2. Independence Requirement**

- **No Dependencies**: Strategy 2 must be completely independent from Strategy 1
- **No TradeExecutionService**: Copy/implement order execution code directly within BollingerBandStrategy
- **Independent Controls**: Can be started/stopped independently regardless of Strategy 1 state
- **Assume Strategy 1 doesn't exist**: Build as standalone system

### **3. Capital Allocation**

- **Independent**: ₹200,000 separate capital allocation
- **Fixed Position Size**: 10 lots per trade (no dynamic sizing)
- **No Capital Constraints**: Unlike Strategy 1's dual-constraint approach

---

## **Implementation Flow**

### **Phase A: Strategy Initialization (When strategy.start() is called)**

1. **Historical Data Loading**

   ```
   - Load 7 days of 5-minute NIFTY50 spot historical candles
   - Handle weekends/holidays automatically (7-day window ensures sufficient data)
   - If insufficient data, extend day by day up to 14 days maximum
   - Stop iteration once sufficient candles obtained (minimum 20 for Bollinger Bands)
   - Store in local array for indicator calculations
   - Calculate initial technical indicators from historical data:
     * RSI(10) - requires minimum 10 candles
     * Supertrend(10,2) - requires minimum 10 candles
     * Bollinger Bands(20,2) - requires minimum 20 candles
   ```

2. **Daily Pivot Setup**

   ```
   - Fetch previous trading day's NIFTY50 spot OHLC
   - Calculate pivot levels: PP, R1, S1, R2, S2, R3, S3
   - Store for intraday reference
   ```

3. **Real-Time Monitoring Initialization**
   ```
   - Start 1-second LTP polling for NIFTY50 spot
   - Initialize 5-minute candle building process
   - Set strategy status to "RUNNING"
   ```

### **Phase B: 5-Minute Candle Close Processing**

**CRITICAL: Process in this exact sequence to prevent look-ahead bias**

#### **B.1: Trade State Processing (FIRST)**

```typescript
// Step 1: Check position state and process entry/exit logic
if (currentPosition === null) {
  // NO POSITION - Check entry conditions using CURRENT indicators

  // LONG Entry Check
  if (
    close > bollingerBands.upper &&
    rsi >= 70 && rsi <= 80 &&
    supertrend.trend === "UP" &&
    (close > pivots.R1 || close > pivots.R2)
  ) {
    // Initialize option instrument (1% of NIFTY50 spot LTP)
    const optionInstrument = selectOptionInstrument("CE", nifty50SpotLTP);

    // Place market order for 10 lots fixed
    await executeOrder("BUY", optionInstrument, 10, "MIS");

    // Update position state
    currentPosition = {
      type: "LONG",
      instrument: optionInstrument,
      entryPrice: optionLTP,
      quantity: 10,
      entryTime: new Date()
    };
  }

  // SHORT Entry Check
  else if (
    close < bollingerBands.lower &&
    rsi >= 10 && rsi <= 30 &&
    supertrend.trend === "DOWN" &&
    close <= pivots.R1  // Corrected: R1 not S1
  ) {
    // Initialize PUT option instrument
    const optionInstrument = selectOptionInstrument("PE", nifty50SpotLTP);

    // Place market order for 10 lots fixed
    await executeOrder("BUY", optionInstrument, 10, "MIS");

    // Update position state with trailing SL initialization
    currentPosition = {
      type: "SHORT",
      instrument: optionInstrument,
      entryPrice: optionLTP,
      quantity: 10,
      entryTime: new Date(),
      trailingSL: optionLTP * 0.88, // 12% below entry
      highestPremium: optionLTP     // Track for trailing
    };
  }
}

else {
  // ALREADY IN POSITION - Check exit conditions

  if (currentPosition.type === "LONG") {
    // LONG Exit: NIFTY50 spot close < Bollinger Midline
    if (nifty50SpotClose < bollingerBands.middle) {
      await executeOrder("SELL", currentPosition.instrument, 10, "MIS");
      currentPosition = null; // Clear position
    }
  }

  else if (currentPosition.type === "SHORT") {
    // SHORT Exit: Check trailing SL (handled in real-time monitoring)
    // This is processed separately in 1-second LTP polling
  }
}
    rsi <= 30 &&
    supertrend.trend === "DOWN" &&
    close <= pivots.R1
  ) {
    // CORRECTED: R1 not S1

    // Initialize option instrument (1% of NIFTY50 spot LTP)
    const optionInstrument = selectOptionInstrument("PE", nifty50SpotLTP);

    // Place market order for 10 lots
    await executeOrder("BUY", optionInstrument, 10, "MIS");

    // Set position state with trailing SL
    currentPosition = {
      type: "SHORT",
      instrument: optionInstrument,
      entryPrice: optionLTP,
      quantity: 10,
      entryTime: new Date(),
      highestPremium: optionLTP,
      trailingSL: optionLTP * 0.88, // 12% below entry
    };
  }
}
```

#### **B.2: Technical Indicator Updates (SECOND)**

```typescript
// Step 2: AFTER trade processing, update indicators with new candle
// This prevents lookahead bias in entry/exit decisions

// Add new completed 5-minute candle to historical dataset
candleHistory.push({
  timestamp: currentCandleClose,
  open: candleOpen,
  high: candleHigh,
  low: candleLow,
  close: candleClose,
  volume: candleVolume,
});

// Recalculate all technical indicators with updated dataset
const updatedIndicators = {
  rsi: calculateRSI(candleHistory, 10),
  supertrend: calculateSupertrend(candleHistory, 10, 2),
  bollingerBands: calculateBollingerBands(candleHistory, 20, 2),
};

// Update current indicator values for next candle's evaluation
currentIndicators = updatedIndicators;

// Log indicator updates for monitoring
Logger.info("Indicators updated", {
  rsi: updatedIndicators.rsi,
  supertrend: updatedIndicators.supertrend.trend,
  bb_upper: updatedIndicators.bollingerBands.upper,
  bb_middle: updatedIndicators.bollingerBands.middle,
  bb_lower: updatedIndicators.bollingerBands.lower,
});
```

#### **Flow Validation & Edge Cases**

```typescript
// Critical validations to add in implementation:

// 1. Candle Completion Detection
const isCandleComplete = (timestamp) => {
  return timestamp.getSeconds() === 0 && timestamp.getMinutes() % 5 === 0;
};

// 2. Option Liquidity Validation
const validateOptionLiquidity = async (instrument) => {
  const ltp = await getOptionLTP(instrument);
  return ltp > 0 && ltp < nifty50SpotLTP * 0.05; // Basic liquidity check
};

// 3. Failed Order Recovery
const handleOrderFailure = (error, orderDetails) => {
  Logger.error("Order execution failed", { error, orderDetails });
  // Implement retry logic or alert mechanism
};
```

#### **B.3: Update Technical Indicators**

```typescript
// After trade state checks, update indicators with new candle
candleHistory.push(newCandle);

// Recalculate indicators
rsi = calculateRSI(candleHistory, 10);
supertrend = calculateSupertrend(candleHistory, 10, 2);
bollingerBands = calculateBollingerBands(candleHistory, 20, 2);

// Store previous candle's mid BB for LONG exit reference
previousCandle.bollingerMid = bollingerBands.middle;
```

### **Phase C: End-of-Day Protocol**

```typescript
// 3:28 PM Safety Check - Force close any remaining positions
const endOfDayCheck = () => {
  const currentTime = new Date();
  const cutoffTime = new Date();
  cutoffTime.setHours(15, 28, 0, 0); // 3:28 PM

  if (currentTime >= cutoffTime && currentPosition !== null) {
    Logger.warn("End-of-day safety trigger: Force closing position");

    // Execute immediate market order exit
    executeOrder("SELL", currentPosition.instrument, 10, "MIS")
      .then(() => {
        currentPosition = null;
        Logger.info("End-of-day: Position successfully closed");
      })
      .catch((error) => {
        Logger.error("End-of-day: Failed to close position", error);
      });
  }
};

// MIS Order Auto-Squareoff (Primary mechanism)
// Note: Zerodha MIS orders automatically square off around 3:20 PM
// Our 3:28 PM check serves as safety net for any edge cases
```

---

## **Real-Time Monitoring for LONG Positions**

### **Special Case: LONG Exit Monitoring**

Since LONG positions require real-time NIFTY50 spot LTP monitoring (not just 5-min candle close), implement parallel monitoring:

```typescript
// During 1-second LTP polling (when LONG position exists)
if (currentPosition?.type === "LONG") {
  const currentSpotLTP = await getNifty50SpotLTP();

  if (currentSpotLTP < previousCandle.bollingerMid) {
    // Immediate exit - don't wait for 5-min candle close
    await executeOrder("SELL", currentPosition.instrument, 10, "MIS");
    currentPosition = null;
  }
}
```

---

## **Architecture Components**

### **Single File Structure: BollingerBandStrategy.ts**

```typescript
class BollingerBandStrategy {
  // Core Methods
  - initialize()          // Load historical data, setup pivots
  - start()              // Begin monitoring and candle processing
  - stop()               // Stop strategy and close positions
  - processCandle()      // Handle 5-min candle completion
  - checkEntry()         // Evaluate entry conditions
  - checkExit()          // Handle exit/SL logic
  - executeOrder()       // Direct order placement (no external dependencies)
  - selectOptionInstrument() // 1% premium selection algorithm

  // Technical Indicators (copied/implemented directly)
  - calculateRSI()
  - calculateSupertrend()
  - calculateBollingerBands()
  - calculateDailyPivots()

  // Utility Methods
  - buildCandle()        // Convert 1-sec LTP to 5-min candles
  - getOptionLTP()       // Real-time option premium fetching
  - getNifty50SpotLTP() // Real-time NIFTY50 spot LTP fetching
}
```

### **Independent Order Execution**

- Copy order placement logic directly into strategy
- No dependency on TradeExecutionService
- Handle MIS orders, error handling, timeout management
- Track order status and execution confirmations

---

## **Implementation Decisions (Based on User Feedback):**

1. **Historical Data Loading**:

   - Start with 7-day window for 5-minute NIFTY50 spot candles
   - If insufficient data (due to holidays), extend day by day up to 14 days maximum
   - Stop iteration once sufficient candles obtained (minimum 20 for Bollinger Bands)

2. **Option Strike Selection**:

   - Use Next Tuesday expiry logic (same as Strategy 1 approach)
   - Target 1% of NIFTY50 spot LTP for option premium selection

3. **Real-Time Polling**:

   - 1-second LTP polling frequency confirmed sufficient for both LONG and SHORT exits
   - No higher frequency needed

4. **Error Handling & Timeouts**:

   - 120-second retry limit for API failures
   - Force market order closure after timeout expires
   - Ensure no hanging positions during API issues

5. **Position Recovery After Restart**:

   - Store position entry details in logs/JSON for persistence
   - Restore position state on strategy restart including:
     - Entry price, time, quantity for all positions
     - `highestPremium` and `trailingSL` for SHORT positions from logs
   - Continue exit monitoring with restored state

6. **Market Hours Validation**:
   - No explicit market hours check (avoid timezone issues)
   - LTP polling and entry signals naturally limited to market hours
   - Strategy relies on market activity for timing

---

## **Final Implementation Summary**

### **Key Technical Specifications:**

- **Historical Data**: 7-14 day adaptive loading for 5-minute candles
- **Indicators**: RSI(10), Supertrend(10,2), Bollinger Bands(20,2), Daily Pivots
- **Position Size**: Fixed 10 lots per trade
- **Capital**: Independent ₹200,000 allocation
- **Expiry**: Next Tuesday expiry logic for options
- **Polling**: 1-second LTP frequency for real-time monitoring
- **Timeout**: 120-second retry with force market order closure
- **Persistence**: JSON-based position state storage and recovery

### **Architecture:**

- **Single File**: BollingerBandStrategy.ts (no external dependencies)
- **Independent**: Complete isolation from Strategy 1
- **Self-Contained**: All order execution, indicators, and monitoring within strategy

### **Ready for Implementation:**

✅ All clarifications answered and documented
✅ Flow logic validated and refined  
✅ Technical specifications confirmed
✅ Error handling and edge cases addressed
✅ Position management and recovery planned

**Status: READY TO BEGIN CODING**
