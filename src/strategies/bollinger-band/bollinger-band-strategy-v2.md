# NIFTY Bollinger Band Trading Strategy

## 📋 Strategy Overview

**Trading Style**: Intraday options trading on 5-minute NIFTY50 spot candles  
**Capital**: ₹200,000 (independent from Breakout-Pullback strategy)  
**Position Size**: Fixed 10 lots per trade  
**Maximum Positions**: 1 active position at a time  
**Trading Hours**: 9:15 AM - 3:30 PM  
**Position Type**: Always BUY options (CE for LONG signals, PE for SHORT signals)

---

## 🎯 Core Strategy Logic

### **Entry Conditions**

#### **LONG Entry** (Buy Call Option)

ALL conditions must be met simultaneously at 5-minute candle close:

- ✅ **Trend Filter**: Close > Supertrend(10,2) line (bullish)
- ✅ **Momentum Filter**: 65 ≤ RSI(10) ≤ 85
- ✅ **Range Filter**: Close ≥ Upper Bollinger Band **AND** (Close > R1 **OR** Close > R2)
- ✅ **Position Check**: No active position

#### **SHORT Entry** (Buy Put Option)

ALL conditions must be met simultaneously at 5-minute candle close:

- ✅ **Trend Filter**: Close < Supertrend(10,2) line (bearish)
- ✅ **Momentum Filter**: 15 ≤ RSI(10) ≤ 35
- ✅ **Range Filter**: Close ≤ Lower Bollinger Band **AND** Close ≤ R1
- ✅ **Position Check**: No active position

### **Exit Conditions**

#### **LONG Exit**

- **Single Path**: Exit ONLY on 5-minute candle close below Bollinger Band midline
- **No Real-time Monitoring**: Wait for full 5-minute candle completion
- **Order Type**: Market order for immediate fill

#### **SHORT Exit**

- **Trailing Stop Loss**: 12% below highest premium seen
- **Real-time Monitoring**: 1-second REST API polling
- **Dynamic Adjustment**: SL updates as premium makes new highs
- **Example**:
  - Entry at ₹200 → Initial SL = ₹176 (12% below entry)
  - Premium rises to ₹400 → SL = ₹352 (12% below new high)
  - Premium drops to ₹360 → SL stays ₹352 (never decreases)
  - If premium ≤ ₹352 → Immediate market order exit
- **Order Type**: Market order for immediate fill

#### **End-of-Day Safety**

- **3:28 PM**: Force-close any remaining positions (safety net)
- **MIS Auto-squareoff**: Broker closes positions at market close
- **Zero Overnight**: No carry-forward positions

---

## 📊 Technical Indicators

### **1. Daily Pivot Levels** (calculated from previous trading day)

```
PP = (High + Low + Close) / 3

R1 = (2 × PP) - Low
S1 = (2 × PP) - High

R2 = PP + (High - Low)
S2 = PP - (High - Low)

R3 = High + 2 × (PP - Low)
S3 = Low - 2 × (High - PP)
```

_Levels remain constant for entire trading session_

### **2. Bollinger Bands** (20-period, 2 standard deviations)

```
Middle Band = SMA(close, 20)
Upper Band = Middle + (2 × StdDev(close, 20))
Lower Band = Middle - (2 × StdDev(close, 20))
```

_Recalculated on every 5-minute candle close_

### **3. RSI** (10-period, TradingView formula)

```
change = current_close - previous_close
up = RMA(max(change, 0), 10)
down = RMA(-min(change, 0), 10)
RSI = 100 - (100 / (1 + up / down))
```

_RMA = Relative Moving Average (exponentially weighted)_

### **4. Supertrend** (10-period ATR, multiplier 2)

```
ATR = Average True Range(10)
Basic Upper Band = (High + Low) / 2 + (2 × ATR)
Basic Lower Band = (High + Low) / 2 - (2 × ATR)
```

_Trend determined by price position relative to Supertrend line_

---

## 🔄 Strategy Execution Flow

### **Initialization (when strategy starts)**

1. **Historical Data Loading**

   - Fetch 7-14 days of 5-minute NIFTY50 spot candles (300-400 candles)
   - Ensures sufficient data for all indicators (BB needs 20 periods minimum)
   - Handles weekends and market holidays automatically

2. **Daily Pivot Calculation**

   - Fetch previous trading day's OHLC data
   - Calculate PP, R1/R2/R3, S1/S2/S3 levels
   - Store for entire session (constant values)

3. **Initial Indicator Calculation**

   - Calculate RSI(10), Supertrend(10,2), Bollinger Bands(20,2)
   - Build baseline from historical candles

4. **Start Real-time Monitoring**
   - Begin 5-minute candle building from live NIFTY50 spot data
   - Ready to evaluate entry/exit conditions

### **Every 5-Minute Candle Close**

**Processing Order** (critical sequence):

1. **Check Position State**

   ```
   IF no active position:
     → Evaluate LONG and SHORT entry conditions
     → If satisfied: Select option and execute entry

   IF active position exists:
     → Check exit conditions based on position type
     → If satisfied: Execute market order exit
   ```

2. **Update Technical Indicators**
   ```
   → Add completed candle to historical data
   → Recalculate all indicators:
      - RSI(10)
      - Supertrend(10,2)
      - Bollinger Bands(20,2)
   → Ready for next candle evaluation
   ```

### **Real-time SHORT Position Monitoring**

Once SHORT position active:

1. **Start 1-second REST API polling** for option premium
2. **Track highest premium** seen since entry
3. **Calculate trailing SL** = Highest Premium × 0.88 (12% below)
4. **Check exit condition** every second:
   - If current premium ≤ trailing SL → Execute exit immediately
5. **Stop polling** once position closed

---

## 💹 Option Selection & Position Sizing

### **Option Selection Algorithm**

```typescript
// 1. Calculate target premium (1% of NIFTY50 spot)
const targetPremium = nifty50SpotPrice * 0.01;

// 2. Determine option type based on signal
const optionType = direction === "LONG" ? "CE" : "PE";

// 3. Get next Tuesday expiry (for liquidity)
const nextTuesday = getNextTuesdayExpiry();

// 4. Filter options by expiry and type
const candidates = allOptions.filter(
  (opt) => opt.expiry === nextTuesday && opt.instrument_type === optionType
);

// 5. Select option with premium closest to target
const selectedOption = candidates.reduce((closest, current) => {
  const closestDiff = Math.abs(closest.premium - targetPremium);
  const currentDiff = Math.abs(current.premium - targetPremium);
  return currentDiff < closestDiff ? current : closest;
});
```

### **Position Sizing**

- **Fixed Lot Size**: 10 lots per trade
- **NIFTY Lot Size**: 75 shares per lot
- **Total Quantity**: 750 shares per trade (10 × 75)
- **Capital Check**: Ensure sufficient capital before entry
- **Manual Adjustment**: Can be modified based on market conditions

### **Trade Execution**

- **Entry Order**: BUY market order (CE for LONG, PE for SHORT)
- **Exit Order**: SELL market order (ensures immediate fill)
- **Order Confirmation**: 10-second timeout with retry logic
- **Actual Fill Price**: Retrieved from Zerodha order history

---

## 📈 P&L Calculation

### **Universal Formula** (applies to ALL positions)

Since we always BUY options (never short/sell them):

```
Unrealized P&L = (Current Premium - Entry Premium) × Quantity
Realized P&L = (Exit Premium - Entry Premium) × Quantity
```

### **Examples**

**LONG Position:**

- Entry: BUY 750 CE @ ₹246.50
- Exit: SELL 750 CE @ ₹247.00
- P&L = (247.00 - 246.50) × 750 = **+₹375 profit**

**SHORT Position:**

- Entry: BUY 750 PE @ ₹246.50
- Exit: SELL 750 PE @ ₹228.00
- P&L = (228.00 - 246.50) × 750 = **-₹13,875 loss**

**Capital Update:**

```
New Capital = Previous Capital + P&L
```

---

## 🏗️ Technical Architecture

### **Data Flow**

```
Historical Data (7-14 days) → Indicator Initialization
         ↓
Live NIFTY50 Spot (5-min candles) → Indicator Updates
         ↓
Entry Signal Detection → Option Selection → Market Order (BUY)
         ↓
Position Monitoring:
  ├─ LONG: 5-minute candle close checks only
  └─ SHORT: 1-second REST API polling (trailing SL)
         ↓
Exit Signal Detection → Market Order (SELL) → P&L Calculation
```

### **Monitoring Systems**

#### **LONG Position Monitoring**

- **Method**: Candle-close processing only
- **Frequency**: Every 5 minutes (on candle completion)
- **Data Source**: Completed 5-minute candle close price
- **Exit Check**: Compare candle close vs BB midline
- **API Efficiency**: Minimal (no additional polling needed)

#### **SHORT Position Monitoring**

- **Method**: REST API polling with circuit breaker
- **Frequency**: 1-second intervals
- **Data Source**: Live option premium via KiteConnect API
- **Exit Check**: Current premium vs trailing SL level
- **Circuit Breaker**: Stop after 10 consecutive failures
- **Backoff Logic**: 5-second intervals on repeated failures

### **State Persistence**

Strategy state saved to disk for recovery:

```typescript
{
  currentPosition: {
    type: 'LONG' | 'SHORT',
    instrument: OptionInstrument,
    entryPrice: number,
    entryTime: Date,
    quantity: number,
    entryOrderId: string
  },
  highestPremiumSeen: number,  // For SHORT trailing SL
  currentTrailingSL: number,   // For SHORT positions
  tradeHistory: TradeRecord[],
  metrics: StrategyMetrics,
  currentCapital: number
}
```

### **Error Handling & Safety**

- **Guard Flags**: Prevent concurrent entry/exit execution
- **Atomic State Locks**: Ensure consistent state updates
- **Circuit Breakers**: Stop monitoring on repeated failures
- **Order Verification**: Confirm order placement before state update
- **Emergency Exit**: Manual force-close functionality
- **End-of-Day Safety**: Automatic position closure at 3:28 PM

---

## 📊 Dashboard Information

### **Current Position Panel**

- Position Type: LONG/SHORT/None
- Option Symbol (e.g., NIFTY25100CE)
- Entry Price & Time
- Current Premium (real-time for SHORT, 5-min for LONG)
- Unrealized P&L (color-coded: green profit, red loss)
- Position Duration

### **SHORT Position Specific** (when active)

- Highest Premium Seen: ₹XXX.XX
- Current Trailing SL: ₹XXX.XX (12% below high)
- Distance to SL: ₹XX.XX (XXX points)
- Monitoring Status: ✅ Active polling (1s intervals)

### **Technical Indicators Panel**

- NIFTY50 Spot: ₹XX,XXX.XX
- RSI(10): XX (color: green >65, red <35, gray neutral)
- Supertrend: ₹XX,XXX.XX (color: green bullish, red bearish)
- Bollinger Bands:
  - Upper: ₹XX,XXX.XX
  - Middle: ₹XX,XXX.XX
  - Lower: ₹XX,XXX.XX
- Daily Pivots: PP, R1/R2/R3, S1/S2/S3

### **Strategy Metrics**

- Total Trades: XX
- Winning Trades: XX (XX%)
- Total P&L: ₹XX,XXX
- Current Capital: ₹XXX,XXX
- Last Update: HH:MM:SS

### **Recent Trades Log**

| Entry Time | Exit Time | Direction | Entry ₹ | Exit ₹ | P&L ₹  | Reason   |
| ---------- | --------- | --------- | ------- | ------ | ------ | -------- |
| 10:15      | 10:45     | LONG      | 246.50  | 247.00 | +375   | BB Mid   |
| 11:20      | 11:50     | SHORT     | 246.50  | 228.00 | -13875 | Trail SL |

---

## 🚀 Strategy Independence

### **Mutually Exclusive Operation**

- Completely independent from Breakout-Pullback strategy
- Separate capital allocation (₹200,000)
- Independent start/stop controls
- Own REST API polling system
- Isolated error handling and recovery

### **Resource Efficiency**

| State          | API Calls/Minute | Notes                                 |
| -------------- | ---------------- | ------------------------------------- |
| No Position    | 0.4              | Historical candle fetch (1 per 5 min) |
| LONG Position  | 0.4              | Candle-close checks only              |
| SHORT Position | 60.4             | 1s option polling + candle checks     |

**Comparison with Breakout-Pullback:**

- 30x more efficient when no position active
- 30x more efficient with LONG positions
- Similar efficiency with SHORT positions

---

## ⚙️ Configuration & Controls

### **Strategy Parameters** (adjustable)

```typescript
{
  FIXED_LOTS: 10,              // Position size
  RSI_PERIOD: 10,              // RSI calculation period
  RSI_LONG_MIN: 65,            // RSI minimum for LONG entry
  RSI_LONG_MAX: 85,            // RSI maximum for LONG entry
  RSI_SHORT_MIN: 15,           // RSI minimum for SHORT entry
  RSI_SHORT_MAX: 35,           // RSI maximum for SHORT entry
  BB_PERIOD: 20,               // Bollinger Bands period
  BB_STD_DEV: 2.0,             // Bollinger Bands std deviation
  ST_PERIOD: 10,               // Supertrend ATR period
  ST_MULTIPLIER: 2,            // Supertrend multiplier
  SHORT_TRAILING_SL_PCT: 0.12, // 12% trailing SL for SHORT
  EOD_EXIT_TIME: '15:28:00'    // End-of-day exit time
}
```

### **Manual Controls**

- **Start Strategy**: Begin monitoring and trading
- **Stop Strategy**: Halt all monitoring (keeps active positions)
- **Force Exit**: Emergency close current position
- **View Trade History**: Review all completed trades
- **Adjust Parameters**: Modify strategy settings (requires restart)

---

## 📝 Trade Management Rules

### **Entry Rules**

1. Maximum 1 active position at any time
2. No new entries until current position closed
3. Immediate re-entry allowed after closure if conditions met
4. No daily trade limit (unlimited re-entries possible)
5. Entry only during market hours (9:15 AM - 3:25 PM)

### **Exit Rules**

1. LONG: Only on 5-minute candle close below BB midline
2. SHORT: Immediate on trailing SL breach (any second)
3. Both: Force exit at 3:28 PM (end-of-day safety)
4. Both: MIS auto-squareoff at market close
5. Always use market orders for guaranteed fills

### **Risk Management**

1. Fixed position size (10 lots = ₹XX,XXX capital per trade)
2. SHORT positions have built-in 12% trailing SL
3. LONG positions exit on BB midline (technical signal)
4. No overnight positions (zero carry-forward risk)
5. Circuit breakers prevent system failures from cascading
6. Emergency manual exit always available

---

## 🔍 Strategy Validation

### **Entry Signal Validation**

Before placing any trade:

- ✅ Verify all indicator values calculated correctly
- ✅ Confirm ALL entry conditions simultaneously met
- ✅ Check no existing position active
- ✅ Verify sufficient capital available
- ✅ Confirm market hours (9:15 AM - 3:25 PM)
- ✅ Validate option selection (premium ~ 1% of NIFTY50)

### **Exit Signal Validation**

Before executing exit:

- ✅ Confirm position exists in both strategy state and broker records
- ✅ Verify exit condition truly met (not false positive)
- ✅ Check option instrument still tradeable
- ✅ Validate market hours (extend to 3:30 PM for exits)

### **State Consistency Checks**

- Strategy state vs broker position reconciliation every 5 minutes
- Automatic state correction if mismatch detected
- Persistent state saved after every trade and indicator update
- Recovery mechanism for unexpected restarts

---

## 🎓 Strategy Behavior Notes

### **What Makes This Strategy Unique**

1. **Asymmetric Exit Logic**: LONG uses candle-close, SHORT uses real-time trailing SL
2. **Bollinger-Pivot Hybrid**: Combines Bollinger Bands with daily pivot levels
3. **Triple Filter System**: Trend + Momentum + Range filters
4. **Pure Options Trading**: Always BUY options, never short/sell at entry
5. **Resource Efficient**: Smart polling reduces API load vs real-time streaming

### **Common Scenarios**

**Scenario 1: LONG Entry & Exit**

```
10:15 - Candle closes above upper BB and R2, RSI=70, Supertrend bullish
      → BUY 750 CE @ ₹246.50
10:20 - Candle closes above BB mid (no exit)
10:25 - Candle closes below BB mid
      → SELL 750 CE @ ₹247.00 (P&L: +₹375)
```

**Scenario 2: SHORT Entry with Trailing SL**

```
11:20 - Candle closes below lower BB and R1, RSI=25, Supertrend bearish
      → BUY 750 PE @ ₹246.50 (SL: ₹216.92)
11:21 - Premium rises to ₹400 (new high, SL: ₹352)
11:22 - Premium rises to ₹450 (new high, SL: ₹396)
11:23 - Premium drops to ₹390 (below SL ₹396)
      → SELL 750 PE @ ₹390 (P&L: +₹107,625)
```

**Scenario 3: End-of-Day Force Exit**

```
15:20 - LONG position still active, candle above BB mid (no exit signal)
15:28 - EOD safety check triggers
      → SELL 750 CE @ market price (force close)
```

---

## 📚 Implementation Reference

### **Key Code Locations**

- Strategy Class: `src/strategies/bollinger-band/BollingerBandStrategy.ts`
- Dashboard Page: `src/index.ts` (Bollinger Band section)
- Wrapper Class: `src/strategies/bollinger-band/BollingerBandWrapper.ts`
- State Persistence: `src/services/StrategyStatePersistence.ts`

### **Important Methods**

- `processCandleCompletion()`: Main 5-minute candle processing
- `checkEntryConditions()`: Evaluate LONG/SHORT entry signals
- `checkLongExitOnCandleClose()`: LONG exit logic
- `checkShortExitUnified()`: SHORT trailing SL logic
- `executeEntry()`: Place option buy order
- `executeExit()`: Place option sell order
- `calculateUnrealizedPnL()`: Real-time P&L calculation

### **Data Structures**

```typescript
interface CurrentPosition {
  type: "LONG" | "SHORT";
  instrument: OptionInstrument;
  entryPrice: number;
  entryTime: Date;
  quantity: number;
  entryOrderId: string;
}

interface TradeRecord {
  tradeId: string;
  entryOrderId: string;
  exitOrderId: string;
  instrument: OptionInstrument;
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
  pnl: number;
  exitReason: string;
  status: "CLOSED";
  strategy: "BOLLINGER_BAND";
}
```

---

## ✅ Pre-Production Checklist

- [x] P&L calculation formula verified (Exit - Entry)
- [x] Both LONG and SHORT exit systems tested
- [x] Dashboard displays accurate real-time data
- [x] State persistence and recovery working
- [x] Circuit breakers and error handling validated
- [x] End-of-day safety mechanisms confirmed
- [x] Option selection algorithm selecting proper strikes
- [x] Position sizing within capital limits
- [x] Market hours validation working
- [x] Manual controls (start/stop/force-exit) functional
- [x] Trade history logging complete records
- [x] Indicator calculations match TradingView
- [x] REST API polling efficient and stable
- [x] Strategy independence from Breakout-Pullback verified

**Status**: ✅ **PRODUCTION READY**
