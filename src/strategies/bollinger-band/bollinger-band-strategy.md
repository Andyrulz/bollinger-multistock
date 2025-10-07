## Core Pillars - Strategy is on 5 minute candle

1. Market Context: Intraday system operating on 5-minute candles.
2. Trend Filter: Supertrend (10, 2)
3. Momentum Filter: RSI (10-period) >=65 for long and <=35 for short
4. Volatility & Range Framework: Daily Pivot Levels + Bollinger Bands (20, 2).
5. Exit Discipline: Bollinger Midline or end-of-day flat-out rule (MIS order handles this).

Signal generating instrument: Current month futures
Trading Instrument: Option who's LTP is around 1% of Nifty fut price at time of breakout (similar to implementation in strategy 1)

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
  - Direction = -1 on Tradingview → bullish bias. As in the super trend should be positive for long trades
  - Direction = 1 on Tradingview → bearish bias. super trend should be negative for short trades
- Compute RSI (10).
- Compute Bollinger Bands (20, 2) on price.
  - bbLength = 20
  - bbStdDev = 2.0
  - basis = ta.sma(close, bbLength)
  - dev = bbStdDev \* ta.stdev(close, bbLength)
  - upperBB = basis + dev
  - lowerBB = basis - dev

3. Long Entry Logic

Trigger once per day per signal sequence when all below are true on 5 minute candles:

- Supertrend direction = bullish.
- RSI ≥ 65 (confirmation of strength).
- Close ≥ R1 and ≥ Upper Bollinger Band.
- No open long position currently.
  → Enter Long at close of the 5m candle.

4. Short Entry Logic

Trigger once per day per signal sequence when all below are true:

- Supertrend direction = bearish.
- RSI ≤ 35 (confirmation of weakness).
- Close ≤ S1 and ≤ Lower Bollinger Band.
- No open short position currently.
  → Enter Short at close of candle.

5. Trade Management Rules

No re-entry while same position type is active.

6. Exit Conditions:

For a Long trade: Close below Bollinger Midline.
For a Short trade: Close above Bollinger Midline.

End-of-Day Exit: Force-close all open positions at 3:25 PM (India time). MIS order will automatically take care of this
No carry-forward overnight.

7. Trading Instrument
   **1. Option Selection Algorithm**

```typescript
// Premium-based selection targeting 1% of NIFTY futures price
const targetPremium = niftyPrice * 0.01; // 1% of NIFTY futures price
const bestOption = optionsWithPremiums.reduce((closest, current) => {
  const closestDiff = Math.abs(closest.premium - targetPremium);
  const currentDiff = Math.abs(current.premium - targetPremium);
  return currentDiff < closestDiff ? current : closest;
});
```

**2. Position Sizing Logic**

```typescript
const maxRiskAmount = capital * riskPerTrade; // 5% of capital
const riskPerLot = stopLossPoints * niftyLotSize; // Risk per lot
const maxLots = Math.floor(maxRiskAmount / riskPerLot);
return Math.max(1, maxLots); // Minimum 1 lot
```

### **3. Order Management**

- **Entry**: Always BUY (CE for LONG, PE for SHORT direction)
- **Exit**: Always SELL to close position
- **Confirmation**: Retry logic with 10-second timeout
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

Initialize daily context → compute pivots.

Loop over intraday candles → calculate indicators.

Check for entry triggers → Place order once all conditions satified and mark entry time & price. No further entries till order is closed.

Track position until exit condition or EOD cutoff.

Record trade outcome → reset position state.
