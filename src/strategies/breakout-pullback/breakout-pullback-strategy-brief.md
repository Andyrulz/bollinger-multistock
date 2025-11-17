# NIFTY Breakout-Pullback Trading Strategy

## 📋 Strategy Overview

**Trading Style**: Swing trading on 1-minute NIFTY futures with 5-minute pivot analysis  
**Capital**: ₹200,000 (independent from Bollinger Band strategy)  
**Position Sizing**: Risk-based (5% account risk per trade)  
**Maximum Positions**: 1 active position at a time  
**Trading Hours**: 9:15 AM - 3:30 PM  
**Position Type**: Always BUY options (CE for LONG signals, PE for SHORT signals)

---

## 🎯 Core Strategy Logic

### **Strategy Concept**

This is a **pivot breakout-retracement system** that:

1. Identifies pivot highs/lows using 15-bar lookback on 5-minute candles
2. Detects breakouts on 1-minute candles with volume confirmation
3. Waits for a **marking candle** (retracement) to set precise entry and stop-loss
4. Enters on retracement and targets breakout continuation
5. Uses dynamic stop-loss that can update based on price action

### **Three-Phase System**

#### **Phase 1: Pivot Detection** (5-minute candles)

- Continuously scan for pivot highs and pivot lows
- Pivot High: Bar with 15 bars lower on each side
- Pivot Low: Bar with 15 bars higher on each side
- These become breakout reference levels

#### **Phase 2: Breakout Detection** (1-minute candles)

- Monitor for 1-minute candles breaking above pivot high (LONG) or below pivot low (SHORT)
- Require volume > 50-period SMA for confirmation
- Breakout candle must not gap (avoid false signals)
- State: `WAITING_FOR_BREAKOUT` → `WAITING_FOR_ENTRY`

#### **Phase 3: Marking Candle & Entry** (1-minute candles)

- Wait for **opposite-direction marking candle** within 10 bars of breakout
- Marking candle provides entry level and stop-loss
- Entry and SL can update up to 1 time if stop-loss extends ≥1 point
- Maximum 20 minutes from breakout to entry
- State: `WAITING_FOR_ENTRY` → `IN_TRADE` (when entry level hit)

---

## 📊 Entry Conditions

### **LONG Breakout Setup**

**Breakout Requirements** (1-minute candle):

- ✅ **Price**: Close > Latest Pivot High
- ✅ **Volume**: Candle volume > 50-period SMA
- ✅ **No Gap**: Candle low < Pivot High (touches pivot level)
- ✅ **Trend**: Bullish candle (Close > Open) for valid breakout
- ✅ **State**: `WAITING_FOR_BREAKOUT` (no active trade)
- ✅ **Market Hours**: Between 9:15 AM - 3:30 PM

**Marking Candle** (opposite direction - retracement):

- Must appear within 10 bars after breakout
- Must be **bearish/RED** (Close < Open) - opposite of bullish breakout
- Represents pullback/retracement after the breakout
- Provides: Entry = High, Stop Loss = Low
- Updates allowed: Maximum 1 update if SL extends ≥1 point

**Entry Trigger**:

- NIFTY futures LTP ≥ Entry Level (marking candle high)
- Must occur within 20 minutes of breakout
- Places market BUY order for Call Option

### **SHORT Breakout Setup**

**Breakout Requirements** (1-minute candle):

- ✅ **Price**: Close < Latest Pivot Low
- ✅ **Volume**: Candle volume > 50-period SMA
- ✅ **No Gap**: Candle high > Pivot Low (touches pivot level)
- ✅ **Trend**: Bearish candle (Close < Open) for valid breakout
- ✅ **State**: `WAITING_FOR_BREAKOUT` (no active trade)
- ✅ **Market Hours**: Between 9:15 AM - 3:30 PM

**Marking Candle** (opposite direction - retracement):

- Must appear within 10 bars after breakout
- Must be **bullish/GREEN** (Close > Open) - opposite of bearish breakout
- Represents pullback/retracement after the breakout
- Provides: Entry = Low, Stop Loss = High
- Updates allowed: Maximum 1 update if SL extends ≥1 point

**Entry Trigger**:

- NIFTY futures LTP ≤ Entry Level (marking candle low)
- Must occur within 20 minutes of breakout
- Places market BUY order for Put Option

---

## 🚪 Exit Conditions

### **Target Calculation**

```
Target Level = Entry Level ± (NIFTY Futures Price / 1000)

Example:
- NIFTY Futures = 24,500
- LONG Entry = 24,520
- Target = 24,520 + (24,500 / 1000) = 24,520 + 24.5 ≈ 24,545 (25 points)
```

### **LONG Exit**

- **Target Hit**: NIFTY LTP ≥ Target Level → Market order exit
- **Stop Loss Hit**: NIFTY LTP ≤ Stop Loss Level → Market order exit
- **End of Day**: Force exit at 3:28 PM → Market order

### **SHORT Exit**

- **Target Hit**: NIFTY LTP ≤ Target Level → Market order exit
- **Stop Loss Hit**: NIFTY LTP ≥ Stop Loss Level → Market order exit
- **End of Day**: Force exit at 3:28 PM → Market order

### **Exit Processing**

- Real-time monitoring via WebSocket (sub-second latency)
- REST API fallback if WebSocket fails
- Atomic state locks prevent concurrent exits
- Market orders ensure immediate fills

---

## 🔢 Position Sizing & Risk Management

### **Risk-Based Position Sizing**

```typescript
// Calculate position size based on 5% account risk
const stopLossPoints = Math.abs(entryLevel - stopLossLevel);
const riskAmount = currentCapital * 0.05; // 5% of capital
const maxQuantityFromRisk = Math.floor(riskAmount / stopLossPoints);

// Calculate maximum affordable based on capital
const estimatedOptionPrice = targetPremium; // ~1% of futures price
const maxQuantityFromCapital = Math.floor(
  currentCapital / estimatedOptionPrice
);

// Use lesser of the two constraints
const finalQuantity = Math.min(maxQuantityFromRisk, maxQuantityFromCapital);

// Convert to lot-based quantity
const lotSize = 75; // NIFTY lot size
const lots = Math.floor(finalQuantity / lotSize);
const finalQuantity = lots * lotSize;
```

### **Capital Constraints**

**Example Calculation**:

- Capital: ₹200,000
- Entry: 24,520, Stop Loss: 24,515 → Risk = 5 points
- Risk Amount: ₹200,000 × 5% = ₹10,000
- Max Quantity (Risk): ₹10,000 / 5 = 2,000 shares
- Option Price: ₹245 (1% of 24,500)
- Max Quantity (Capital): ₹200,000 / ₹245 = 816 shares
- Final: Use 816 shares → 10 lots (10 × 75 = 750 shares)

**Safety Checks**:

- Never risk more than 5% of capital per trade
- Never use more capital than available
- Minimum 1 lot, maximum based on smaller of risk/capital constraints
- Real-time capital tracking with P&L updates

---

## 💹 Option Selection

### **Premium-Based Selection** (1% targeting)

```typescript
// 1. Calculate target premium
const niftyFuturesPrice = currentLTP; // e.g., 24,500
const targetPremium = niftyFuturesPrice * 0.01; // 245

// 2. Get next Tuesday expiry for liquidity
const getNextTuesdayExpiry = (): Date => {
  const today = new Date();
  const currentDay = today.getDay(); // 0 = Sunday, 2 = Tuesday
  let daysToAdd = 2 - currentDay;
  if (daysToAdd <= 0) daysToAdd += 7; // Next Tuesday
  const nextTuesday = new Date(today);
  nextTuesday.setDate(today.getDate() + daysToAdd);
  return nextTuesday;
};

// 3. Determine option type
const optionType = direction === "LONG" ? "CE" : "PE";

// 4. Filter candidates
const candidates = allNiftyOptions.filter(
  (opt) => opt.expiry === nextTuesday && opt.instrument_type === optionType
);

// 5. Select closest premium to target
const selectedOption = candidates.reduce((closest, current) => {
  const closestDiff = Math.abs(closest.premium - targetPremium);
  const currentDiff = Math.abs(current.premium - targetPremium);
  return currentDiff < closestDiff ? current : closest;
});
```

### **Why 1% Premium Targeting?**

- **Liquidity**: ATM and near-ATM options have best spreads
- **Leverage**: Reasonable leverage without extreme risk
- **Movement**: Responds well to NIFTY futures moves
- **Exit**: Easy to exit without slippage

---

## 📈 P&L Calculation

### **Universal Formula** (applies to ALL positions)

Since we always BUY options (never short/sell them):

```
Unrealized P&L = (Current Option Premium - Entry Premium) × Quantity
Realized P&L = (Exit Option Premium - Entry Premium) × Quantity
```

### **Examples**

**LONG Trade (Profitable)**:

```
Entry: BUY 750 shares 24500CE @ ₹245.00
Target Hit: NIFTY reaches 24,545
Exit: SELL 750 shares 24500CE @ ₹270.00
P&L = (270.00 - 245.00) × 750 = ₹18,750 profit
```

**SHORT Trade (Loss)**:

```
Entry: BUY 750 shares 24500PE @ ₹245.00
Stop Loss Hit: NIFTY breaks above SL
Exit: SELL 750 shares 24500PE @ ₹220.00
P&L = (220.00 - 245.00) × 750 = -₹18,750 loss
```

**Capital Update**:

```
New Capital = Previous Capital + Realized P&L
₹200,000 + ₹18,750 = ₹218,750
```

---

## 🔄 Complete Trade Flow

### **Full Lifecycle Example (LONG Trade)**

**09:15 AM - Strategy Start**

```
1. Load historical 5-minute candles (72 hours to get ~100 candles)
2. Detect pivot points (15,15 lookback algorithm)
3. Fetch historical 1-minute candles (5 days to get 50+ candles)
4. Calculate initial Volume SMA50
5. Start WebSocket price streaming
6. State: WAITING_FOR_BREAKOUT
```

**10:23 AM - Pivot High Detected**

```
Latest Pivot High: ₹24,515 @ 10:15 AM
(High with 15 lower bars on each side on 5-min chart)
Continue monitoring for breakout...
```

**10:47 AM - LONG Breakout**

```
1-minute candle completes:
  Open: 24,512, High: 24,525, Low: 24,510, Close: 24,518
  Volume: 185,000 (SMA50: 120,000) ✅
  Close > Pivot High (24,518 > 24,515) ✅
  Low < Pivot (24,510 < 24,515) - No gap ✅
  Bullish candle (24,518 > 24,512) ✅

Action: Transition to WAITING_FOR_ENTRY
Start marking candle search (10-bar window, 20-min limit)
```

**10:48 AM - Marking Candle Found**

```
1-minute candle (1 bar after breakout):
  Open: 24,522, High: 24,524, Low: 24,516, Close: 24,517
  Bearish/RED candle (24,517 < 24,522) ✅ Opposite direction (retracement)

Entry Level: 24,524 (marking candle high)
Stop Loss: 24,516 (marking candle low)
Risk: 8 points

Calculate Target:
  Target = 24,524 + (24,500 / 1000) = 24,524 + 24.5 ≈ 24,549

Select Option:
  Target Premium: 24,500 × 1% = ₹245
  Selected: NIFTY 24500CE (Next Tuesday expiry)
  Current Premium: ₹248

Position Sizing:
  Risk: 8 points, Risk Amount: ₹10,000 (5%)
  Max Qty: 1,250 shares
  Lots: 16 lots = 1,200 shares
  Trade Cost: ₹248 × 225 = ₹55,800

Monitor entry level: Waiting for NIFTY ≥ 24,524
```

**10:51 AM - Entry Triggered**

```
NIFTY LTP: 24,525 ≥ Entry 24,524 ✅

Action: Execute Entry
1. Place MARKET BUY order for 1,200 shares NIFTY 24500CE
2. Order filled @ ₹250 (actual fill price)
3. State: IN_TRADE
4. Start monitoring: SL = 24,516, Target = 24,549

Active Position:
  Direction: LONG
  Option: NIFTY 24500CE
  Quantity: 1,200 shares
  Entry Price: ₹250
  Entry Time: 10:51:23 AM
  Stop Loss: 24,516 NIFTY (₹8 risk)
  Target: 24,549 NIFTY
```

**11:15 AM - Target Hit**

```
NIFTY LTP: 24,550 ≥ Target 24,549 ✅

Action: Execute Exit (Target)
1. Place MARKET SELL order for 1,200 shares NIFTY 24500CE
2. Order filled @ ₹275 (actual fill price)
3. Calculate P&L: (275 - 250) × 1,200 = ₹30,000 profit
4. Update Capital: ₹200,000 + ₹30,000 = ₹230,000
5. Record Trade History
6. State: WAITING_FOR_BREAKOUT
7. Resume pivot detection and breakout monitoring

Trade Record:
  Entry: 10:51 AM @ ₹250
  Exit: 11:15 AM @ ₹275
  Duration: 24 minutes
  P&L: +₹30,000 (15% return on ₹200K capital)
  Exit Reason: TARGET_HIT
```

---

## 🏗️ Technical Architecture

### **Data Flow**

```
KiteConnect API
├─ WebSocket Streaming (Primary)
│  └─ Tick Processing → 1-minute Candle Builder
│     ├─ Volume accumulation
│     ├─ OHLC tracking
│     └─ Candle completion detection
│
└─ REST API (Fallback + Historical)
   ├─ Historical 5-minute candles → Pivot Detection
   ├─ Historical 1-minute candles → Volume SMA50
   └─ LTP polling if WebSocket fails

Strategy Processing
├─ Pivot Detection (5-min candles, 15,15 lookback)
├─ Breakout Detection (1-min candles, volume confirmation)
├─ Marking Candle System (5-bar search, 18-min limit, 2 updates max)
├─ Entry Monitoring (WebSocket real-time)
└─ Exit Monitoring (WebSocket real-time)

Trade Execution Service
├─ Option Selection (1% premium targeting)
├─ Position Sizing (risk-based calculation)
├─ Order Placement (market orders)
├─ Position Verification (broker state sync)
└─ P&L Tracking (real-time unrealized, realized on exit)
```

### **WebSocket Price Streaming**

**Primary Data Source**:

- Sub-second latency for entry/exit monitoring
- Automatic reconnection on failure (10 attempts)
- Circuit breaker after 5 consecutive failures
- Health monitoring every 30 seconds

**REST API Fallback**:

- Activates if WebSocket circuit breaker opens
- 1-second polling interval
- Same circuit breaker protection
- Automatic failback to WebSocket when healthy

**Tick Processing**:

```typescript
// Build 1-minute candles from real-time ticks
onTick(tick: TickData) {
  if (!currentOneMinuteCandle) {
    // Start new candle
    currentOneMinuteCandle = {
      timestamp: currentMinuteStart,
      open: tick.last_price,
      high: tick.last_price,
      low: tick.last_price,
      close: tick.last_price,
      volume: volumeSinceLastCandle,
      tickCount: 1
    };
  } else {
    // Update existing candle
    currentOneMinuteCandle.high = Math.max(high, tick.last_price);
    currentOneMinuteCandle.low = Math.min(low, tick.last_price);
    currentOneMinuteCandle.close = tick.last_price;
    currentOneMinuteCandle.volume = volumeSinceLastCandle;
    currentOneMinuteCandle.tickCount++;
  }

  // Check for candle completion (new minute started)
  if (tick.timestamp.getMinutes() !== currentMinute) {
    completeOneMinuteCandle();
    checkForBreakout(completedCandle);
  }
}
```

---

## 📊 Pivot Detection Algorithm

### **15,15 Lookback Method**

**Pivot High Detection**:

```typescript
// Requires 15 lower bars on EACH side
function detectPivotHigh(candles: Candle[], index: number): boolean {
  const candidateHigh = candles[index].high;

  // Check 15 bars before
  for (let i = index - 15; i < index; i++) {
    if (candles[i].high >= candidateHigh) return false;
  }

  // Check 15 bars after
  for (let i = index + 1; i <= index + 15; i++) {
    if (candles[i].high >= candidateHigh) return false;
  }

  return true; // Valid pivot high
}
```

**Pivot Low Detection**:

```typescript
// Requires 15 higher bars on EACH side
function detectPivotLow(candles: Candle[], index: number): boolean {
  const candidateLow = candles[index].low;

  // Check 15 bars before
  for (let i = index - 15; i < index; i++) {
    if (candles[i].low <= candidateLow) return false;
  }

  // Check 15 bars after
  for (let i = index + 1; i <= index + 15; i++) {
    if (candles[i].low <= candidateLow) return false;
  }

  return true; // Valid pivot low
}
```

**Why 15,15?**

- Balanced between sensitivity and reliability
- Filters out minor fluctuations
- Captures significant swing points
- Industry standard for swing trading

---

## 🎯 Marking Candle System

### **Two-Phase Detection**

**Phase 1: Initial Search (5-bar window)**

```
Breakout occurs at bar 0
Search bars 1-5 for opposite-direction candle

LONG Breakout → Wait for bullish marking candle (Close > Open)
SHORT Breakout → Wait for bearish marking candle (Open > Close)

If found: Set Entry and SL
If not found by bar 5: Abandon trade, return to WAITING_FOR_BREAKOUT
```

**Phase 2: Dynamic Updates (up to 2 updates, 18-min limit)**

```
After initial marking candle found:
- Monitor subsequent bars for SL extension ≥1 point
- Update Entry and SL if better level found
- Maximum 2 updates allowed
- Total time limit: 18 minutes from breakout
- If limits exceeded: Lock in current levels, proceed to entry

Example LONG Updates:
Initial Marking: Entry 24,522, SL 24,516 (6 points)
Update 1: Entry 24,524, SL 24,517 (7 points) - SL moved up 1 point ✅
Update 2: Entry 24,526, SL 24,519 (7 points) - SL moved up 2 more points ✅
Update 3: NOT ALLOWED - Max 2 updates reached
```

### **Update Criteria**

**For LONG Marking Candles**:

- New marking candle high > current entry ✅
- New marking candle low > current SL **by ≥1 point** ✅
- Update count < 2 ✅
- Time < 18 minutes from breakout ✅

**For SHORT Marking Candles**:

- New marking candle low < current entry ✅
- New marking candle high < current SL **by ≥1 point** ✅
- Update count < 2 ✅
- Time < 18 minutes from breakout ✅

### **Abandonment Rules**

Trade setup is abandoned if:

- No marking candle found within 5 bars
- Entry level not hit within 18 minutes
- Market hours end (3:30 PM reached)

When abandoned:

- Clear marking candle state
- Reset trade setup
- Transition back to WAITING_FOR_BREAKOUT
- Resume pivot and breakout detection

---

## 🔒 Race Condition Protection

### **Atomic State Locks**

```typescript
// Prevent concurrent entry execution
await globalStateLock.executeAtomic("trade-entry", async () => {
  // Double-check conditions inside lock
  if (isExecutingEntry) return; // Already processing
  if (tradeState !== "WAITING_FOR_ENTRY") return; // State changed
  if (!tradeSetupRequest) return; // No setup

  isExecutingEntry = true;
  try {
    await executeTradeEntry();
    transitionToState("IN_TRADE");
  } finally {
    isExecutingEntry = false;
  }
});

// Prevent concurrent exit execution
await globalStateLock.executeAtomic("trade-exit", async () => {
  if (isExecutingExit) return;
  if (tradeState !== "IN_TRADE") return;

  isExecutingExit = true;
  try {
    await executeTradeExit(reason);
    transitionToState("WAITING_FOR_BREAKOUT");
  } finally {
    isExecutingExit = false;
  }
});
```

### **Guard Flags**

- `isExecutingEntry`: Prevents concurrent entry attempts
- `isExecutingExit`: Prevents concurrent exit attempts
- Both checked before and inside atomic locks
- Reset in finally blocks to ensure cleanup

### **State Verification**

Before critical operations:

1. Check strategy state matches expected
2. Verify broker position matches strategy state
3. Sync if mismatch detected
4. Log any discrepancies for review

---

## 📊 State Persistence & Recovery

### **Persistent State**

```typescript
interface PersistedStrategyState {
  strategyId: string;
  isActive: boolean;
  tradeState: TradeState;
  currentContract: NiftyFuturesData | null;

  // Trade Setup
  tradeSetupRequest: TradeSetupRequest | null;
  currentTradeId: string | null;

  // Market Data
  latestPivotHigh: PivotPoint | null;
  latestPivotLow: PivotPoint | null;
  latestBreakoutSignal: BreakoutSignal | null;

  // Marking Candle State
  markingCandleState: MarkingCandleState;

  // Historical Data
  candles: Candle[]; // Last 100 5-minute candles
  oneMinuteCandles: Candle[]; // Last 50 1-minute candles
  currentVolumeSMA50: number;

  // Metadata
  lastUpdateTime: Date;
  persistedAt: Date;
}
```

### **Auto-Save System**

- **Interval**: Every 5 seconds if state is "dirty"
- **Immediate Save**: On critical state transitions (breakout, entry, exit)
- **Dirty Flag**: Set when any state changes
- **File Location**: `data/strategy/strategy-state.json`

### **Recovery on Restart**

```
1. Load persisted state from disk
2. Validate state integrity (timestamps, data consistency)
3. Sync with broker position
4. Restore WebSocket streaming
5. Resume from last known state:
   - WAITING_FOR_BREAKOUT: Resume pivot detection
   - WAITING_FOR_ENTRY: Resume marking candle search and entry monitoring
   - IN_TRADE: Resume exit monitoring (SL/Target checks)
```

---

## 🎨 Dashboard Information

### **Strategy Status Panel**

**Current State**:

- Trade State: `WAITING_FOR_BREAKOUT` / `WAITING_FOR_ENTRY` / `IN_TRADE`
- NIFTY Futures: Symbol, LTP, Last Update Time
- WebSocket Status: Connected / Disconnected / Fallback to REST
- Circuit Breaker: Open / Closed

**Latest Pivots**:

- Pivot High: ₹XX,XXX.XX @ HH:MM:SS
- Pivot Low: ₹XX,XXX.XX @ HH:MM:SS
- Time Since Detection: X minutes ago

### **Active Breakout Panel** (when in WAITING_FOR_ENTRY)

**Breakout Details**:

- Type: LONG / SHORT
- Breakout Price: ₹XX,XXX.XX
- Pivot Reference: ₹XX,XXX.XX
- Volume: XXX,XXX (X.XXx SMA50)
- Time: HH:MM:SS

**Marking Candle Search**:

- Status: Searching / Found / Abandoned
- Bars Processed: X / 5
- Time Elapsed: X / 18 minutes
- Update Count: X / 2

**Trade Setup** (when marking candle found):

- Entry Level: ₹XX,XXX.XX
- Stop Loss: ₹XX,XXX.XX
- Target: ₹XX,XXX.XX
- Risk: XX points
- Selected Option: NIFTYXXXXCE/PE
- Estimated Cost: ₹XX,XXX
- Position Size: XXX shares (X lots)

### **Active Position Panel** (when IN_TRADE)

**Position Details**:

- Direction: LONG / SHORT
- Option: NIFTYXXXXCE/PE
- Entry: ₹XXX.XX @ HH:MM:SS
- Current: ₹XXX.XX (real-time)
- Quantity: XXX shares
- Duration: XX minutes

**Levels**:

- Entry (NIFTY): ₹XX,XXX.XX
- Stop Loss (NIFTY): ₹XX,XXX.XX
- Target (NIFTY): ₹XX,XXX.XX
- Current (NIFTY): ₹XX,XXX.XX

**P&L**:

- Unrealized P&L: ₹X,XXX (color-coded)
- P&L %: +X.XX%
- Distance to Target: XX points
- Distance to SL: XX points

### **Volume Analysis**

- Current 1m Volume: XXX,XXX
- Volume SMA50: XXX,XXX
- Volume Ratio: X.XXx
- Breakout Volume Threshold: Met / Not Met

### **Performance Metrics**

- Total Trades: XX
- Winning Trades: XX (XX%)
- Total P&L: ₹XX,XXX
- Current Capital: ₹XXX,XXX
- Largest Win: ₹X,XXX
- Largest Loss: ₹X,XXX
- Average Trade: ₹XXX
- Today's Trades: XX
- Today's P&L: ₹X,XXX

### **Recent Trades Log**

| Time  | Direction | Entry  | Exit   | Duration | P&L     | Reason |
| ----- | --------- | ------ | ------ | -------- | ------- | ------ |
| 11:15 | LONG      | 250.00 | 275.00 | 24m      | +₹7,500 | Target |
| 10:05 | SHORT     | 240.00 | 235.00 | 18m      | +₹1,875 | Target |
| 09:45 | LONG      | 245.00 | 242.00 | 12m      | -₹1,125 | SL Hit |

---

## ⚙️ Strategy Configuration

### **Adjustable Parameters**

```typescript
{
  // Pivot Detection
  PIVOT_LOOKBACK: 15,              // Bars on each side for pivot
  PIVOT_CANDLE_INTERVAL: '5minute', // 5-minute candles

  // Volume Confirmation
  VOLUME_SMA_PERIOD: 50,           // 50-period SMA
  VOLUME_CANDLE_INTERVAL: '1minute', // 1-minute candles

  // Marking Candle System
  MARKING_INITIAL_BARS: 5,         // Initial search window
  MARKING_MAX_UPDATES: 2,          // Maximum updates allowed
  MARKING_TIME_LIMIT: 18,          // Minutes from breakout
  MARKING_SL_EXTENSION: 1,         // Minimum SL extension (points)

  // Position Sizing
  RISK_PER_TRADE: 0.05,            // 5% account risk
  TARGET_PREMIUM_PCT: 0.01,        // 1% of futures for option
  NIFTY_LOT_SIZE: 75,              // Shares per lot

  // Target Calculation
  TARGET_DIVISOR: 1000,            // Futures price / 1000

  // Trading Hours
  MARKET_START: '09:15:00',
  MARKET_END: '15:30:00',
  EOD_EXIT: '15:28:00',

  // WebSocket Settings
  WS_MAX_RECONNECT: 10,
  WS_CIRCUIT_BREAKER: 5,           // Failures before opening
  WS_HEALTH_CHECK_INTERVAL: 30000, // 30 seconds

  // Fallback Polling
  POLLING_INTERVAL: 1000,          // 1 second
  POLLING_CIRCUIT_BREAKER: 10
}
```

---

## 🚀 Strategy Independence

### **Mutually Exclusive Operation**

- Completely independent from Bollinger Band strategy
- Separate capital allocation (₹200,000)
- Independent WebSocket connection
- Own state management and persistence
- Isolated error handling and recovery
- Independent start/stop controls

### **Resource Usage**

| Component         | Usage            | Notes                        |
| ----------------- | ---------------- | ---------------------------- |
| WebSocket         | 1 connection     | NIFTY futures only           |
| Historical API    | 2 calls at start | 5-min + 1-min candles        |
| REST Fallback     | 60 calls/min     | Only if WebSocket fails      |
| State Persistence | 1 write/5s       | When state is dirty          |
| Memory            | ~5 MB            | 100 5-min + 50 1-min candles |

---

## 🔍 Trade Validation

### **Pre-Entry Checks**

Before placing entry order:

- ✅ Valid marking candle with entry/SL levels
- ✅ Entry level crossed in correct direction
- ✅ Within 18-minute time window
- ✅ Sufficient capital available
- ✅ Position sizing calculated and validated
- ✅ Option selected with premium near target
- ✅ No existing active position
- ✅ Market hours (before 3:25 PM)

### **Pre-Exit Checks**

Before placing exit order:

- ✅ Active position exists in strategy state
- ✅ Position verified with broker
- ✅ Exit condition truly met (SL or Target)
- ✅ Market hours (can exit until 3:30 PM)

### **State Consistency**

- Strategy state synced with broker every 5 minutes
- Automatic recovery if mismatch detected
- Manual intervention logged for orphaned positions
- State persistence ensures recovery from crashes

---

## 📚 Implementation Reference

### **Key Code Locations**

- **Main Strategy**: `src/strategies/breakout-pullback/BreakoutPullbackStrategy.ts`
- **Trade Execution**: `src/strategies/breakout-pullback/BreakoutPullbackExecutor.ts`
- **Wrapper**: `src/strategies/breakout-pullback/BreakoutPullbackWrapper.ts`
- **Dashboard**: `src/index.ts` (Breakout-Pullback section)
- **State Persistence**: `src/services/StrategyStatePersistence.ts`
- **Atomic Locks**: `src/utils/StateLock.ts`

### **Important Methods**

**Strategy Class**:

- `startStrategy()`: Initialize and start complete system
- `stopStrategy()`: Stop all operations gracefully
- `detectPivotPoints()`: 15,15 pivot detection on 5-min candles
- `checkForBreakout()`: Breakout detection on 1-min candles
- `startMarkingCandleTracking()`: Begin marking candle search
- `processMarkingCandleUpdate()`: Handle new bars and updates
- `checkEntryTrigger()`: Monitor for entry level cross
- `checkExitTriggers()`: Monitor for SL/Target hits
- `executeTradeEntry()`: Place entry order (atomic)
- `executeTradeExit()`: Place exit order (atomic)

**Executor Class**:

- `placeMarketOrder()`: Handle option selection and order placement
- `exitPosition()`: Close active position
- `calculatePositionSize()`: Risk-based sizing
- `selectATMOption()`: Premium-based option selection
- `calculatePnL()`: (exitPrice - entryPrice) × quantity
- `syncWithBrokerState()`: Verify position consistency

---

## ✅ Pre-Production Checklist

- [x] P&L calculation formula verified (Exit - Entry)
- [x] Pivot detection algorithm tested (15,15 lookback)
- [x] Breakout detection with volume confirmation working
- [x] Marking candle system fully operational (5-bar, 2 updates, 18-min)
- [x] WebSocket streaming with automatic reconnection
- [x] REST API fallback on WebSocket failure
- [x] Circuit breakers preventing cascade failures
- [x] Atomic state locks preventing race conditions
- [x] State persistence and recovery validated
- [x] Risk-based position sizing within capital limits
- [x] Option selection targeting 1% premium
- [x] Entry/Exit monitoring with sub-second latency
- [x] End-of-day safety exit at 3:28 PM
- [x] Dashboard real-time updates functional
- [x] Trade history logging complete
- [x] Error handling and logging comprehensive
- [x] Memory optimization for 24/7 operation
- [x] Strategy independence from Bollinger Band verified

**Status**: ✅ **PRODUCTION READY**

---

## 🎓 Strategy Behavior Notes

### **What Makes This Strategy Unique**

1. **Pivot-Breakout-Retracement**: Not just breakout, waits for pullback
2. **Marking Candle System**: Unique 5-bar initial + 2-update mechanism
3. **Dynamic Stop Loss**: SL can improve (tighten) up to 2 times
4. **Volume Confirmation**: 50-period SMA on 1-minute candles
5. **Risk-Based Sizing**: 1% account risk per trade
6. **WebSocket Primary**: Sub-second latency for entries/exits
7. **18-Minute Rule**: Clear time limit prevents stale setups

### **Common Scenarios**

**Scenario 1: Perfect LONG Setup**

```
10:15 AM - Pivot High detected at 24,515
10:47 AM - LONG breakout (bullish: close 24,518 > open 24,512, volume 1.5x SMA50)
10:48 AM - Bearish/RED marking candle (high 24,524, low 24,516) - retracement
10:49 AM - Entry 24,524, SL 24,516, Target 24,549
10:51 AM - Entry triggered at 24,525
11:15 AM - Target hit at 24,550 → +₹5,625 profit
```

**Scenario 2: Marking Candle Updates**

```
11:20 AM - SHORT breakout (bearish: close 24,482 < open 24,489, volume 2.1x SMA50)
11:21 AM - Bullish/GREEN marking (low 24,479, high 24,483) - retracement
          Entry 24,479, SL 24,483 (4 points)
11:22 AM - Better bullish candle (low 24,477, high 24,481)
          Update: Entry 24,477, SL 24,481 (4 points, SL lowered 2 pts) ✅
11:23 AM - Even better (low 24,475, high 24,478)
          Update: Entry 24,475, SL 24,478 (3 points, SL lowered 3 pts) ✅
11:24 AM - Another update NOT ALLOWED (max 2 reached)
11:25 AM - Entry triggered at 24,474
```

**Scenario 3: Abandoned Setup (No Marking Candle)**

```
14:30 PM - LONG breakout detected (bullish candle)
14:31-35 PM - 5 bars pass, all bullish (no bearish/RED marking candle)
14:35 PM - Setup abandoned, return to WAITING_FOR_BREAKOUT
```

**Scenario 4: Time Limit Exceeded**

```
14:45 PM - SHORT breakout (bearish candle) with bullish/GREEN marking candle
          Entry 24,420, SL 24,425
14:46-15:03 PM - NIFTY stays above 24,420 (entry not hit)
15:03 PM - 18 minutes elapsed
15:03 PM - Setup abandoned, too much time passed
```

**Scenario 5: End-of-Day Force Exit**

```
15:20 PM - LONG position active (entered at 11:00 AM)
15:28 PM - EOD safety check triggers
15:28 PM - Force SELL at market price
          P&L depends on option premium at exit
```

---

## 📊 Performance Expectations

### **Typical Win Rate**: 50-60%

- Strategy is momentum-based
- Stop losses are tight (5-10 points typically)
- Targets are reasonable (20-25 points typically)
- Risk:Reward ratio approximately 1:2 to 1:3

### **Trade Frequency**: 2-5 trades per day

- Depends on market volatility
- More trades in trending markets
- Fewer trades in range-bound markets
- Quality over quantity (strict filters)

### **Capital Efficiency**

- 5% risk per trade balances growth with safety
- Risk-based sizing prevents over-leveraging
- Option premium targeting ensures liquidity
- Capital updated after each trade

### **Drawdown Characteristics**

- Expected maximum drawdown: 25-50% (5-10 losing trades at 5% risk each)
- Recovery typically quick in trending markets
- Reduced exposure in choppy markets (fewer signals)

---

## 🐛 Debugging & Monitoring

### **Log Levels**

```typescript
// Pivot Detection
logger.info("🔍 Pivot High detected at ₹XX,XXX.XX");
logger.info("🔍 Pivot Low detected at ₹XX,XXX.XX");

// Breakout Detection
logger.info("🚀 LONG BREAKOUT DETECTED!");
logger.info("🚀 SHORT BREAKOUT DETECTED!");
logger.info("🔒 BREAKOUT SKIPPED - Outside market hours");

// Marking Candles
logger.info("📍 MARKING CANDLE FOUND (Initial)");
logger.info("📍 MARKING CANDLE UPDATED (Update 1/2)");
logger.warn("⚠️ No marking candle found - abandoning setup");

// Entry/Exit
logger.info("🚀 LONG ENTRY TRIGGERED!");
logger.info("🎯 LONG TARGET HIT!");
logger.info("🛑 LONG SL HIT!");

// Errors
logger.error("❌ Error in breakout detection:", error);
logger.warn("⚠️ WebSocket connection lost, using REST fallback");
```

### **Health Monitoring**

- WebSocket connection status checked every 30 seconds
- Circuit breakers log when opened/closed
- State persistence logs every save operation
- Position verification logs any mismatches
- All atomic operations logged with lock acquisition/release

---

**Last Updated**: October 29, 2025  
**Version**: 1.0 (Production Ready)  
**Author**: Automated Trading System  
**Review Status**: ✅ Approved for Live Trading
