## Pre-Session Setup

At start of each trading day, fetch the LAST TRADING DAY's high, low, and close (skip weekends/holidays).
Compute Daily Pivot Levels:- Strategy is on 5 minute candle

## Core Pillars

1. Market Context: Intraday system operating on 5-minute candles.
2. Trend Filter: Supertrend (10, 2) on 5-minute candles
3. Momentum Filter: (on 5-minute candles)

- RSI (10-period) >=70 and <=80 for long
- RSI (10-period) <=30 and >=10 for short

4. Volatility & Range Framework: Daily Pivot Levels + Bollinger Bands (20, 2) on 5-minute candles.
5. Exit Discipline: Bollinger Midline or end-of-day flat-out rule (MIS order handles this).

Signal generating instrument: Current month futures
Trading Instrument: Option who's LTP is around 1% of Nifty fut price at time of breakout (similar to implementation in strategy 1)

## Strategy Independence & Architecture

- **Mutually Exclusive**: This strategy operates independently from Strategy 1 (Breakout-Pullback)
- **Capital Management**: Independent 5% risk per trade, no capital splitting between strategies
- **Session Management**: Reuses existing authentication and session system
- **Dashboard Integration**: Separate page/controls for independent start/stop functionality
- **Data Requirements**: 5-minute candle close data + Real-time option LTP monitoring (1-second polling)
- **Single Script Architecture**: Combined strategy logic and trade execution in one class
- **Independent Polling**: Own LTP monitoring system, completely isolated from Strategy 1
- **Exit Orders**: Always use MARKET orders to ensure immediate fills on exit signals

## Strategy Flow

1. Pre-Session Setup
   At start of each trading day, fetch previous day’s high, low, and close.
   Compute Daily Pivot Levels:
   PP = (High + Low + Close) / 3
   R1/S1, R2/S2, R3/S3 are support and resistance levels using standard formulas below - classic type standard pivots.
   First Level:
   R1 = (2 × P) - Low
   S1 = (2 × P) - High

Second Level:
R2 = P + (High - Low)
S2 = P - (High - Low)

Third Level:
R3 = High + 2 × (P - Low)
S3 = Low - 2 × (High - P)
These levels remain constant for the entire session.

2. Intraday Live Monitoring (5-minute bars)

For each new 5-minute candle:

- Update Supertrend (10, 2) direction.
  - For LONG trades: Price should be ABOVE Supertrend line (Close > Supertrend)
  - For SHORT trades: Price should be BELOW Supertrend line (Close < Supertrend)
- Compute RSI (10) on 5-minute candles using TradingView formula:
  - change = current_close - previous_close
  - up = RMA(max(change, 0), 10) // RMA = Exponentially Weighted Moving Average
  - down = RMA(-min(change, 0), 10)
  - RSI = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
- Compute Bollinger Bands (20, 2) on price.
  - bbLength = 20
  - bbStdDev = 2.0
  - basis = ta.sma(close, bbLength)
  - dev = bbStdDev \* ta.stdev(close, bbLength)
  - upperBB = basis + dev
  - lowerBB = basis - dev

3. Long Entry Logic

Trigger when ALL conditions are satisfied simultaneously at 5-minute candle close:

- Supertrend direction = bullish (Close > Supertrend line).
- RSI ≥ 70 and RSI <=80 (confirmation of strength but not exhaustion).
- Close ≥ R1 AND Close ≥ Upper Bollinger Band (both conditions must be true).
- No open long position currently.
  → Enter Long at close of the 5m candle.
  → Stop further entries until this trade is closed.

4. Short Entry Logic

Trigger when ALL conditions are satisfied simultaneously at 5-minute candle close:

- Supertrend direction = bearish (Close < Supertrend line).
- RSI ≤ 30 and RSI >=10 (confirmation of weakness but not exhaustion).
- Close ≤ S1 AND Close ≤ Lower Bollinger Band (both conditions must be true).
- No open short position currently.
  → Enter Short at close of candle.
  → Stop further entries until this trade is closed.

5. Trade Management Rules

- No re-entry while any position is active.
- After trade closure (exit), immediate re-entry is allowed if conditions are met.
- No daily limit on number of trades - unlimited re-entries possible after each closure.

6. Exit Conditions:

**LONG Trade Exit** (Futures-based signal at 5-minute candle close):

- Exit when NIFTY Futures Close < Bollinger Midline (strict mathematical comparison, no buffer)
- Uses futures price signal, NOT option premium
- Evaluated only at 5-minute candle completion

**SHORT Trade Exit** (Real-time option premium monitoring):

- 12% trailing stop-loss on PUT option premium with continuous monitoring
- **Real-time LTP Polling**: Monitor option price every 1 second
- **Trailing Logic**:
  - Entry at ₹200 → Initial SL = ₹176 (12% below entry)
  - Premium rises to ₹400 (new high) → SL = ₹352 (12% below new high)
  - Premium drops to ₹360 → SL remains ₹352 (never decreases)
- **Exit Trigger**: If current option LTP ≤ trailing SL → IMMEDIATE MARKET ORDER exit
- **State Persistence**: Track "highest premium since entry" across sessions

**End-of-Day Exit Protocol**:

- **3:28 PM Check**: Force-close any remaining positions with market orders (safety net)
- **3:25 PM MIS**: MIS orders will automatically square off positions at market close
- **No Overnight**: Zero carry-forward positions beyond trading day

7. Trading Instrument
   **1. Option Selection Algorithm**

```typescript
// Premium-based selection targeting 1% of NIFTY futures price
// Use Next Tuesday expiry for liquidity (copied from Strategy 1)
const getNextTuesdayExpiry = (): Date => {
  const today = new Date();
  const currentDay = today.getDay();
  const tuesday = 2;
  let daysToAdd = tuesday - currentDay;
  if (daysToAdd <= 0) daysToAdd += 7;
  const nextTuesday = new Date(today);
  nextTuesday.setDate(today.getDate() + daysToAdd);
  return nextTuesday;
};

const targetPremium = niftyPrice * 0.01; // 1% of NIFTY futures price
const nextTuesdayExpiry = getNextTuesdayExpiry();
const optionType = direction === "LONG" ? "CE" : "PE";

// Filter for next Tuesday expiry options
const relevantOptions = niftyInstruments.filter(
  (opt) =>
    Math.abs(opt.expiry.getTime() - nextTuesdayExpiry.getTime()) <
      24 * 60 * 60 * 1000 && opt.instrument_type === optionType
);

// Select option with premium closest to target
const bestOption = optionsWithPremiums.reduce((closest, current) => {
  const closestDiff = Math.abs(closest.premium - targetPremium);
  const currentDiff = Math.abs(current.premium - targetPremium);
  return currentDiff < closestDiff ? current : closest;
});
```

**2. Position Sizing Logic**

```typescript
// Fixed lot size approach - manual adjustment as needed
const fixedLotSize = 1; // Default: 1 lot per trade
// Can be adjusted manually based on market conditions and risk appetite
// Future enhancement: Dynamic sizing based on volatility or account balance
```

### **3. Order Management**

- **Entry**: Always BUY (CE for LONG, PE for SHORT direction)
- **Exit**: Always SELL to close position using MARKET ORDERS (ensures immediate fills)
- **Real-time Monitoring**: 1-second LTP polling for SHORT positions to detect SL hits
- **Exit Execution**: Immediate market order placement when exit condition is met
- **Confirmation**: Retry logic with 10-second timeout for order placement
- **Fill Price**: Retrieved from actual Zerodha order history

📊 Strategy Outcomes

Each day is an independent trading cycle.
Multiple trades may occur per day, but only one active at a time.

Metrics for backtesting:

Win %

Avg gain/loss per trade

Max drawdown

Daily trade count

Time in trade

🧠 High-Level Sequence for LLM

Initialize daily context → compute pivots from last trading day.

Loop over intraday 5-minute candles → calculate all indicators (Supertrend, RSI, Bollinger Bands).

Check for entry triggers → Place order once ALL conditions satisfied simultaneously at candle close.

Mark entry time & price → Block further entries until position is closed.

Monitor exit conditions:

- LONG: Check Bollinger Midline cross at 5-minute candle close
- SHORT: Continuously monitor option premium (1-second polling) for trailing SL hit

Execute immediate MARKET ORDER exit when conditions are met.

Record trade outcome → Reset position state → Allow immediate re-entry if conditions met.

## 🔧 Technical Implementation Notes

### **Core Architecture**

- **Class Structure**: New `BollingerBandStrategy.ts` class (standalone implementation)
- **RSI Calculation**: Use TradingView RSI formula with RMA (Relative Moving Average)
- **Supertrend Logic**: Price above/below Supertrend line determines trend direction
- **Option Selection**: Copy and adapt existing premium-based selection logic (1% targeting)
- **Dashboard Integration**: Separate page linked from main dashboard
- **Trade Execution**: Integrated within strategy class (single script approach)

### **Data Monitoring Requirements**

- **5-minute Historical Candles**: Fetch completed NIFTY futures candles for indicator calculations
- **Candle Completion Detection**: Timer to check for new completed 5-minute candles
- **Real-time Option LTP**: 1-second polling ONLY when SHORT position is active (for trailing SL)
- **No Live Futures Polling**: Unlike Strategy 1, we don't need continuous futures LTP
- **Pre-Market EOD Check**: Additional check at 3:28 PM to force-close any remaining positions

### **Independent LTP Monitoring System**

**Complete Strategy Independence**:

- **Separate Polling**: Bollinger Band strategy has its own polling timer
- **Independent Start/Stop**: Can start/stop without affecting Strategy 1
- **Isolated Resources**: Own API calls, error handling, and connection management

**Efficient Resource Usage**:

```typescript
class BollingerBandDataManager {
  private candleCheckTimer: NodeJS.Timeout | null = null;
  private optionPollingTimer: NodeJS.Timeout | null = null;
  private currentOptionToken: string | null = null;

  startStrategy() {
    // Check for new completed 5-minute candles every 30 seconds
    this.candleCheckTimer = setInterval(async () => {
      await this.checkForNewCompletedCandle();
    }, 30000); // 30-second intervals (much less frequent than Strategy 1)
  }

  private async checkForNewCompletedCandle() {
    // Fetch latest completed 5-minute candle from historical data API
    const latestCandle = await this.getLatest5MinCandle();
    if (this.isNewCandle(latestCandle)) {
      await this.processNewCandle(latestCandle);
    }
  }

  onShortPositionActivated(optionToken: string) {
    this.currentOptionToken = optionToken;
    // Start real-time option LTP monitoring for trailing SL
    this.optionPollingTimer = setInterval(async () => {
      const optionLTP = await this.kiteConnect.getLTP([optionToken]);
      this.checkTrailingSL(optionLTP[optionToken].last_price);
    }, 1000); // 1-second polling for option only
  }

  onShortPositionClosed() {
    // Stop option polling
    if (this.optionPollingTimer) {
      clearInterval(this.optionPollingTimer);
      this.optionPollingTimer = null;
    }
    this.currentOptionToken = null;
  }

  stopStrategy() {
    if (this.candleCheckTimer) clearInterval(this.candleCheckTimer);
    if (this.optionPollingTimer) clearInterval(this.optionPollingTimer);
  }
}
```

**Benefits of Efficient Design**:

- **Minimal API Usage**: No continuous futures polling (unlike Strategy 1)
- **Smart Polling**: 30-second candle checks vs Strategy 1's 1-second LTP polling
- **Conditional Monitoring**: Option LTP polling only when SHORT position active
- **Resource Efficient**: Much lower API call frequency than real-time strategies

### **API Usage Comparison**

| **Scenario**       | **Bollinger Band**                | **Strategy 1**            | **Efficiency Gain**    |
| ------------------ | --------------------------------- | ------------------------- | ---------------------- |
| **No Position**    | 2 calls/minute (candle checks)    | 60 calls/minute (LTP)     | **30x more efficient** |
| **LONG Position**  | 2 calls/minute (candle checks)    | 60 calls/minute (LTP)     | **30x more efficient** |
| **SHORT Position** | 62 calls/minute (candle + option) | 60 calls/minute (futures) | **Similar usage**      |

### **Efficient Polling Lifecycle**

**Strategy Start**:

1. Start 30-second timer to check for new completed 5-minute candles
2. No continuous LTP polling (much more efficient than Strategy 1)

**LONG Position Entry**:

- No additional polling needed (candle-based exit only)

**SHORT Position Entry**:

1. Start 1-second option LTP polling for trailing SL
2. Continue 30-second candle checks

**SHORT Position Exit**:

1. Stop option LTP polling immediately
2. Return to candle-only monitoring

**Strategy Stop**:

1. Clear candle check timer (30-second intervals)
2. Clear option polling timer (if active)
3. Zero impact on Strategy 1

### **Why Real-time Monitoring is Critical for SHORT Trades**

**Problem**: Option premiums can gap significantly within 5-minute candles
**Example Scenario**:

- PUT option entry at ₹200, current trailing SL at ₹300 (25% below ₹400 high)
- Premium suddenly drops from ₹350 to ₹250 mid-candle (market volatility)
- **Without real-time**: Loss of ₹50 per share instead of intended ₹0 exit at SL
- **With real-time**: Immediate market order exit at ₹300 when SL is breached

**Solution**: 1-second LTP polling enables immediate detection and execution

### **State Persistence Requirements**

```typescript
interface BollingerBandState {
  currentPosition: "LONG" | "SHORT" | null;
  optionSymbol: string | null;
  entryPrice: number | null;
  entryTime: Date | null;
  highestPremiumSeen: number | null; // For SHORT trailing SL
  currentTrailingSL: number | null; // For SHORT positions
  lastUpdateTime: Date;
}
```

### **Exit Monitoring Logic**

- **LONG Positions**: Check futures price vs Bollinger Midline at candle close only
- **SHORT Positions**: Continuous real-time monitoring with immediate market order execution
- **Market Orders**: Always use market orders for exits to ensure fills
- **Persistence**: Save trailing SL state to survive system restarts

### **Dashboard Requirements (Similar to Strategy 1)**

**Strategy Status Panel:**

- Current Position: LONG/SHORT/None
- Entry Price & Time
- Current P&L (real-time for SHORT, 5-min updates for LONG)
- Selected Option Symbol & LTP

**Indicator Panel:**

- Current NIFTY Futures Price
- Supertrend Direction & Value
- RSI Value (10-period)
- Bollinger Bands (Upper, Middle, Lower)
- Daily Pivot Levels (R1, R2, R3, S1, S2, S3)

**SHORT Position Specific (when active):**

- Current Option Premium
- Highest Premium Seen
- Current Trailing SL Level
- Real-time SL Distance

**Controls:**

- Start/Stop Strategy (independent of Strategy 1)
- Manual Exit Position
- Emergency Stop All

**Recent Trades Log:**

- Entry/Exit times and prices
- P&L per trade
- Exit reason (Bollinger/Trailing SL/EOD)
