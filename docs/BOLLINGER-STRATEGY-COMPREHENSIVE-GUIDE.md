# Multi-Stock Bollinger Band Trading System - Comprehensive Guide

## 📋 Executive Summary

This is a **multi-stock momentum trading system** that:

1. **Scans 100+ F&O stocks** every morning at 9:30 AM using a TMV (Trend, Momentum, Volume) scoring engine
2. **Selects top 3 stocks** with score ≥7
3. **Deploys independent Bollinger Band strategy instances** on each selected stock
4. **Trades stock options** (CE for LONG, PE for SHORT) - **NOT** NIFTY/BANKNIFTY index options

### ⚠️ Key Distinction

**This is NOT a NIFTY50 index strategy!**

The system trades **individual stock options** (like RELIANCE, HDFCBANK, TCS, INFY, etc.) based on a daily momentum scanner. Each day, different stocks may be selected based on their TMV scores.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MARKET SCANNER                              │
│  • Runs daily at 09:30 AM                                       │
│  • Scores 100+ F&O stocks on TMV (0-10 scale)                  │
│  • Selects top 3 with score ≥7                                 │
│  • Determines LONG or SHORT bias for each                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  STRATEGY DEPLOYMENT                            │
│  For each selected stock (e.g., RELIANCE, TCS, INFY):          │
│  • Creates independent BollingerBandStrategy instance          │
│  • Allocates ₹65,000 capital per stock                         │
│  • Passes scanner's bias (LONG/SHORT) and historical data      │
│  • Up to 3 concurrent strategy instances                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│         BOLLINGER BAND STRATEGY (x3 independent instances)      │
│                                                                 │
│  Instance 1: bollinger-reliance                                │
│    • Monitors RELIANCE 5-minute candles                        │
│    • Trades RELIANCE CE/PE options                             │
│    • ₹65,000 capital                                           │
│                                                                 │
│  Instance 2: bollinger-tcs                                     │
│    • Monitors TCS 5-minute candles                             │
│    • Trades TCS CE/PE options                                  │
│    • ₹65,000 capital                                           │
│                                                                 │
│  Instance 3: bollinger-infy                                    │
│    • Monitors INFY 5-minute candles                            │
│    • Trades INFY CE/PE options                                 │
│    • ₹65,000 capital                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🕐 Daily Timeline - Complete Breakdown

### Phase 1: Pre-Market Data Fetch (09:00 AM)

| Time         | Event                             | Description                                                                     |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------- |
| **09:00 AM** | **Historical Data Fetch Trigger** | StrategyManager checks if user is logged in                                     |
|              | **If Authenticated**              | Immediately starts fetching 10 days of 5-minute candle data for ALL 100+ stocks |
|              | **If NOT Authenticated**          | Sets `needsPreMarketFetch = true` flag, waits for login                         |
|              | **Rate Limit Compliance**         | Fetches in batches of 3 stocks per second (Zerodha API limit)                   |
|              | **Expected Duration**             | ~35-40 seconds for complete universe                                            |
|              | **Data Storage**                  | Cached in memory (`MarketScanner.cachedHistoricalData`)                         |

**Stock Universe Includes:**

- Banking: HDFCBANK, ICICIBANK, SBIN, AXISBANK, KOTAKBANK, etc.
- IT: TCS, INFY, WIPRO, HCLTECH, TECHM, etc.
- Auto: MARUTI, M&M, TATAMOTORS, BAJAJ-AUTO, etc.
- Pharma: SUNPHARMA, DRREDDY, CIPLA, DIVISLAB, etc.
- Oil & Gas: RELIANCE, ONGC, BPCL, IOC, etc.
- And 80+ more F&O stocks

### Phase 2: Reactive Login Handling (09:00 - 09:30 AM)

| Scenario                        | Behavior                                      |
| ------------------------------- | --------------------------------------------- |
| **Login before 09:00**          | Data fetched at 09:00 exactly                 |
| **Login between 09:00 - 09:30** | Data fetched immediately upon login detection |
| **Login after 09:30**           | Scanner aborted for the day - too late        |
| **No login**                    | No trading for the day                        |

### Phase 3: Market Scanner Execution (09:30 AM)

| Time         | Step                             | Description                                                            |
| ------------ | -------------------------------- | ---------------------------------------------------------------------- |
| **09:30:05** | **Scanner Starts**               | 5-second delay after market open for stability                         |
|              | **Step 1: Sector Analysis**      | Fetches sector index prices (NIFTY BANK, NIFTY IT, NIFTY PHARMA, etc.) |
|              |                                  | Classifies sectors as GREEN (>0.25%), RED (<-0.25%), or FLAT           |
|              | **Step 2: Stock Filtering**      | Filters universe by sector alignment                                   |
|              |                                  | GREEN sector → Only LONG candidates                                    |
|              |                                  | RED sector → Only SHORT candidates                                     |
|              |                                  | FLAT sector → Excluded                                                 |
|              | **Step 3: TMV Scoring**          | For each filtered stock, calculates:                                   |
|              |                                  | **T (Trend)**: 0-3 points based on Supertrend position                 |
|              |                                  | **M (Momentum)**: 0-3 points based on RSI and price change             |
|              |                                  | **V (Volume)**: 0-2 points based on volume vs average                  |
|              |                                  | **Sector Confluence**: 0-2 bonus points                                |
|              |                                  | **Total Score**: 0-10 points                                           |
|              | **Step 4: Safety Filters**       | Removes stocks:                                                        |
|              |                                  | - Within 2% of circuit limits                                          |
|              |                                  | - Premium < ₹10 (illiquid)                                             |
|              |                                  | - Gap > 3% from previous close                                         |
|              | **Step 5: Top 3 Selection**      | Sorts by score descending                                              |
|              |                                  | Selects top 3 with score ≥ 7                                           |
|              |                                  | May select 0, 1, 2, or 3 stocks                                        |
|              | **Step 6: ATM Option Selection** | For each selected stock:                                               |
|              |                                  | Finds **monthly expiry** options (last Tuesday of month)               |
|              |                                  | Selects ATM strike based on current spot price                         |
|              |                                  | ATM option stored with scanner result, used at entry time              |
|              |                                  | Verifies premium ≥ ₹10 (live) or ≥ ₹1 (testing mode)                   |

### Phase 4: Strategy Deployment (09:30 - 09:31 AM)

For each selected stock (e.g., RELIANCE with score 8.5, LONG bias):

```typescript
// System creates config like this:
{
  id: "bollinger-reliance",
  name: "Bollinger Band - RELIANCE",
  enabled: true,
  description: "Scanner: 8.50 | Bias: LONG",
  timeframe: "5min",
  instruments: ["RELIANCE"],
  config: {
    scannerData: {
      score: 8.5,
      bias: "LONG",
      sector: "NIFTY OIL & GAS",
      atmOption: {
        tradingsymbol: "RELIANCE26JAN2900CE",
        strike: 2900,
        premium: 125,
        expiry: "2026-01-29"
      },
      historicalData: [...300 candles...]
    },
    capitalAllocation: 65000,
    strategyIndex: 0  // For staggered polling (0, 1, 2)
  }
}
```

Each strategy instance:

1. Receives pre-fetched historical data (no additional API calls)
2. Initializes technical indicators immediately
3. Starts monitoring its assigned stock
4. Operates completely independently of other instances

### Phase 5: Trading Session (09:30 AM - 3:28 PM)

**Every 5 Minutes (Candle Completion):**

Each strategy instance independently:

1. Fetches latest 5-minute candle for its stock
2. Updates indicators (BB, RSI, Supertrend)
3. Checks entry conditions if no position
4. Checks exit conditions if position active
5. Executes trades via market orders

**Every 1 Second (When Position Active):**

- REST API polling for option premium
- Trailing stop loss calculation
- Real-time P&L tracking

**Staggered Polling:**

- Strategy 0: Polls at X:XX:04 seconds
- Strategy 1: Polls at X:XX:05 seconds
- Strategy 2: Polls at X:XX:06 seconds
- Prevents API rate limit issues

### Phase 6: End of Day (3:28 PM - 3:35 PM)

| Time        | Event                | Description                                                  |
| ----------- | -------------------- | ------------------------------------------------------------ |
| **3:28 PM** | **EOD Safety Exit**  | All open positions force-closed                              |
|             |                      | Staggered: Strategy 0 at 3:28:00, 1 at 3:28:05, 2 at 3:28:10 |
| **3:30 PM** | **Market Close**     | NSE session ends                                             |
| **3:35 PM** | **Cache Cleanup**    | Scanner clears historical data                               |
|             | **Strategy Cleanup** | All instances stopped                                        |
|             | **Memory Cleanup**   | Garbage collection triggered                                 |

**Why 3:28 PM, not 3:25 PM?**

- NSE auto-squareoff happens between 3:15-3:25 PM
- Bot exits at 3:28 PM to avoid broker's forced exit fees
- With staggered exits (0/5/10 sec offset), prevents API burst
- 3:28 PM gives 2-minute buffer before market close

---

## 📊 TMV Scoring Algorithm - Detailed Breakdown

### Trend Score (Max 3 points)

| Condition                                     | Points |
| --------------------------------------------- | ------ |
| Price > Supertrend AND Supertrend trending UP | 3.0    |
| Price > Supertrend                            | 2.0    |
| Price near Supertrend (within 0.3%)           | 1.0    |
| Price < Supertrend                            | 0.0    |

### Momentum Score (Max 3 points)

| Condition                                                | Points       |
| -------------------------------------------------------- | ------------ |
| RSI 60-75 (strong bullish) OR RSI 25-40 (strong bearish) | 2.0          |
| Today's change > 1.5% in bias direction                  | +1.0         |
| RSI > 75 or < 25 (extreme)                               | -0.5 penalty |

### Volume Score (Max 2 points)

| Condition                               | Points |
| --------------------------------------- | ------ |
| Today's volume > 150% of 20-day average | 2.0    |
| Today's volume > 100% of 20-day average | 1.0    |
| Below average volume                    | 0.0    |

### Sector Confluence Bonus (Max 2 points)

| Condition                                            | Points |
| ---------------------------------------------------- | ------ |
| Stock bias matches sector direction strongly (>0.5%) | 2.0    |
| Stock bias matches sector direction (>0.25%)         | 1.0    |
| Mismatch                                             | 0.0    |

### Example Scoring

```
RELIANCE on Jan 26, 2026:
  Sector: NIFTY OIL & GAS (+0.8% - GREEN)
  Stock Price: ₹2,890 (above Supertrend ₹2,850)
  RSI: 68 (bullish momentum)
  Volume: 135% of average
  Today's Change: +1.2%

Scoring:
  Trend:     3.0 (above Supertrend, trend UP)
  Momentum:  2.5 (RSI in sweet spot + good daily change)
  Volume:    1.0 (above average but not exceptional)
  Sector:    2.0 (strong GREEN sector match)

  TOTAL:     8.5 → SELECTED with LONG bias
```

---

## 🎯 Bollinger Band Strategy Logic (Per Stock)

Once a stock is selected and strategy deployed, here's how it trades:

### Entry Conditions

#### LONG Entry (Buy Call Option)

ALL conditions must be TRUE at 5-minute candle close:

| Condition                | Logic                                   |
| ------------------------ | --------------------------------------- |
| **Trend Filter**         | Stock price > Supertrend(10,2)          |
| **Momentum Filter**      | 68 ≤ RSI(10) ≤ 85                       |
| **BB Breakout**          | Close ≥ Upper Bollinger Band            |
| **Level Confirmation**   | Close > R1 OR Close > R2 (daily pivots) |
| **Candle Direction**     | Close > Open (bullish candle)           |
| **No Existing Position** | Position == null                        |
| **Scanner Bias Match**   | Scanner said LONG for this stock        |

#### SHORT Entry (Buy Put Option)

ALL conditions must be TRUE at 5-minute candle close:

| Condition                | Logic                             |
| ------------------------ | --------------------------------- |
| **Trend Filter**         | Stock price < Supertrend(10,2)    |
| **Momentum Filter**      | 10 ≤ RSI(10) ≤ 30                 |
| **BB Breakout**          | Close ≤ Lower Bollinger Band      |
| **Level Confirmation**   | Close ≤ PP (daily pivot point)    |
| **Candle Direction**     | Close < Open (bearish candle)     |
| **No Existing Position** | Position == null                  |
| **Scanner Bias Match**   | Scanner said SHORT for this stock |
| **Time Check**           | Before 2:55 PM (except Fridays)   |

**Time Restrictions:**

- SHORT entries blocked after 2:55 PM Monday-Thursday
- Fridays: No time restriction (SHORT entries allowed all day)
- Rationale: Late-day SHORTs have less time to play out

### Exit Conditions

#### LONG Exit - Simple 12% Trailing Stop

```
When position type = LONG:
  Trailing SL = Highest Premium × 0.88 (constant 12%)

  As premium rises → Update SL = New High × 0.88
  Exit when: Current Premium ≤ Trailing SL
```

#### SHORT Exit - Complex Time-Decay Trailing Stop

**Time-Based Trailing Schedule:**

```
Minutes Since Entry │ Trailing %  │ Effective SL
────────────────────┼─────────────┼─────────────────────────
0-20 minutes        │    12%      │ Highest × 0.88
20-30 minutes       │     9%      │ Highest × 0.91
30-35 minutes       │     7%      │ Highest × 0.93
35-40 minutes       │     6%      │ Highest × 0.94
40+ minutes         │     5%      │ Highest × 0.95
```

**Stagnation Rule:**

```
If no new high for 10+ minutes:
  Cap trailing at 9% (Math.min(current%, 9%))
  Prevents using looser stops when momentum dies
```

**Performance Checkpoints:**

```
15-minute checkpoint:
  • If premium hasn't risen ₹5 from entry → EXIT
  • Catches trades that "stall out" early

20-minute checkpoint:
  • If premium hasn't risen ₹10 from entry → EXIT
  • Forces exit on weak momentum trades
```

**SHORT Exit Summary:**

```
Exit triggers (in order of priority):
1. Performance checkpoint failure (15-min or 20-min)
2. Time-decay trailing SL hit (5-12% depending on time)
3. Underlying-based exit (stock price > entry candle high)
4. EOD Safety Exit (3:28 PM)
```

#### Underlying-Based Exit (5-minute Candle Close)

**For LONG:**

```
Exit Threshold = MAX(Entry Candle Low, BB Middle Line)
Exit when: 5-min candle close < Exit Threshold
```

**For SHORT:**

```
Exit Threshold = Entry Candle High
Exit when: 5-min candle close > Exit Threshold
```

### Position Sizing

```
Available Capital: ₹65,000 per stock
Utilization: 75% (₹48,750 usable)
Cost per Lot: Premium × Lot Size

Lots = floor(Usable Capital / Cost per Lot)
Max Lots = 10 (liquidity cap)
Min Lots = 0 (NO minimum 1 lot override!)

⚠️ IMPORTANT: If usable capital < cost per lot, the trade is SKIPPED.
   The system returns 0 lots and logs "Insufficient capital - Trading paused"

Example (RELIANCE):
  Capital: ₹65,000
  Usable (75%): ₹48,750
  Premium: ₹125
  Lot Size: 250
  Cost/Lot: ₹31,250
  Lots = floor(48,750 / 31,250) = 1 lot ✓

Example (High Premium):
  Capital: ₹65,000
  Usable (75%): ₹48,750
  Premium: ₹250
  Lot Size: 250
  Cost/Lot: ₹62,500
  Lots = floor(48,750 / 62,500) = 0 lots → TRADE SKIPPED
```

---

## 💰 Capital Allocation

| Stock Instance           | Capital      | Max Risk     |
| ------------------------ | ------------ | ------------ |
| Stock 1 (e.g., RELIANCE) | ₹65,000      | ₹65,000      |
| Stock 2 (e.g., TCS)      | ₹65,000      | ₹65,000      |
| Stock 3 (e.g., INFY)     | ₹65,000      | ₹65,000      |
| **Total Required**       | **₹195,000** | **₹195,000** |

**Capital Isolation:** Each strategy instance manages its own capital independently. Loss in RELIANCE doesn't affect TCS capital.

---

## 📡 API Call Efficiency

### Pre-Market Phase (09:00 AM)

| Operation                             | Calls       | Rate               |
| ------------------------------------- | ----------- | ------------------ |
| Historical data (100 stocks × 1 call) | 100         | 3/second (batched) |
| Duration                              | ~35 seconds |                    |

### Scanner Phase (09:30 AM)

| Operation             | Calls       |
| --------------------- | ----------- |
| Sector indices quotes | 1 (batched) |
| Stock quotes          | 1 (batched) |
| Option chain lookups  | ~10         |
| Total                 | ~12 calls   |

### Trading Phase (Per Strategy Instance)

| State         | Calls/Minute             |
| ------------- | ------------------------ |
| No Position   | ~0.2 (5-min candle only) |
| With Position | ~60 (1-second polling)   |

### Worst Case (3 Strategies, All With Positions)

- 3 × 60 = 180 calls/minute
- Well within Zerodha's 1000 calls/minute limit

---

## 🔒 Expiry Day Handling

### Stock Options (Monthly Expiry - Last Tuesday of Month)

| Day                           | Behavior                                 | Notes                                     |
| ----------------------------- | ---------------------------------------- | ----------------------------------------- |
| **Normal Days**               | Full scanning enabled                    | Most trading days                         |
| **Friday before expiry**      | Warning: Enhanced liquidity checks       | 2 days to expiry                          |
| **Monday before expiry**      | ⚠️ BLOCKED - Physical settlement margins | 1 day to expiry, high margin requirements |
| **Last Tuesday (Expiry Day)** | ⚠️ BLOCKED - No stock options trading    | Monthly expiry day                        |

**Code Status:** `isStockTradingBlocked()` is currently **COMMENTED OUT** for testing!
In production, you should uncomment this in `MarketScanner.ts` line 106.

### NIFTY Index Options (Weekly Expiry - Every Tuesday)

If trading NIFTY/BANKNIFTY instead of stocks:

- Uses weekly Tuesday expiry
- Different blocking logic applies

### Key Distinction

| Instrument Type   | Expiry             | Blocking Days       |
| ----------------- | ------------------ | ------------------- |
| **Stock Options** | Monthly (Last Tue) | Mon + Tue of expiry |
| **NIFTY Options** | Weekly (Every Tue) | Expiry Tuesday only |

---

## 📊 What Gets Logged

### Scanner Output (09:30 AM)

```
🔍 MarketScanner: Starting universe scan...
📊 Sector Analysis: 5 GREEN, 3 RED, 4 FLAT
📊 Filtered stocks: 45 LONG candidates, 28 SHORT candidates
📊 Safety filtered: 12 removed (circuit limits, low liquidity)
📊 Top scores:
   1. RELIANCE: 8.5 (LONG)
   2. HDFCBANK: 8.2 (LONG)
   3. TATAMOTORS: 7.8 (LONG)
✅ Scanner completed: 3/3 selected
```

### Strategy Deployment

```
✅ RELIANCE: Strategy deployed (bollinger-reliance)
✅ HDFCBANK: Strategy deployed (bollinger-hdfcbank)
✅ TATAMOTORS: Strategy deployed (bollinger-tatamotors)
```

### Trade Execution

```
📈 [bollinger-reliance] LONG Entry Signal
   • Price: ₹2,890 > Upper BB ₹2,875
   • RSI: 72 ✓
   • Supertrend: BULLISH ✓
   • Buying RELIANCE26JAN2900CE @ ₹125 × 1 lot (250 qty)

🛑 [bollinger-reliance] Exit: TRAILING_SL_BREACH
   • Entry: ₹125, Exit: ₹138
   • P&L: +₹3,250 (13 × 250)
```

---

## 🚨 Error Scenarios

| Scenario                         | System Behavior                            |
| -------------------------------- | ------------------------------------------ |
| No login by 9:30                 | Scanner skipped for day                    |
| Scanner finds 0 qualified stocks | No strategies deployed, waits for next day |
| API failure during data fetch    | Retry 3x, then skip that stock             |
| Position monitoring fails        | Circuit breaker, emergency exit            |
| Strategy instance crash          | Isolated, other strategies continue        |

---

## 📝 Configuration File

**Location:** `config/strategies.json`

```json
{
  "templates": {
    "bollinger-stock-template": {
      "name": "Bollinger Band Stock Template",
      "description": "Template for scanner-deployed stock strategies",
      "timeframe": "5min",
      "config": {
        "period": 20,
        "stdDev": 2.0
      }
    }
  },
  "strategies": [
    {
      "id": "bollinger-band-01",
      "name": "Manual NIFTY Strategy (disabled during scanner mode)",
      "enabled": false,
      "description": "Use scanner mode instead"
    }
  ],
  "global": {
    "autoStart": false,
    "scannerMode": true,
    "healthCheckInterval": 30000
  }
}
```

---

## 🎓 Key Takeaways

1. **Not NIFTY50 Index** - Trades individual stock options
2. **Dynamic Selection** - Different stocks may be selected each day
3. **Scanner-Driven** - TMV algorithm picks high-momentum stocks
4. **Independent Instances** - Up to 3 concurrent, isolated strategies
5. **Stock Options** - Monthly expiry (last Tuesday), ATM strikes
6. **₹65K per Stock** - Fixed capital allocation per instance
7. **Pre-Market Required** - Login before 9:30 AM essential

---

## ⏰ Critical Timing Reference

| Timing Parameter         | Value                   | Code Location                      |
| ------------------------ | ----------------------- | ---------------------------------- |
| Pre-market data fetch    | 09:00:00                | StrategyManager.ts                 |
| Scanner execution        | 09:30:05                | StrategyManager.ts                 |
| SHORT entry cutoff       | 14:55 (2:55 PM)         | BollingerBandStrategy.ts:2472      |
| SHORT cutoff exception   | Fridays (no cutoff)     | BollingerBandStrategy.ts:2473-2475 |
| SHORT time-decay: 12%→9% | 20 min since entry      | BollingerBandStrategy.ts:2945      |
| SHORT time-decay: 9%→7%  | 30 min since entry      | BollingerBandStrategy.ts:2944      |
| SHORT time-decay: 7%→6%  | 35 min since entry      | BollingerBandStrategy.ts:2943      |
| SHORT time-decay: 6%→5%  | 40 min since entry      | BollingerBandStrategy.ts:2942      |
| SHORT stagnation cap     | 9% after 10 min no high | BollingerBandStrategy.ts:2951      |
| SHORT checkpoint 1       | 15 min, ₹5 required     | BollingerBandStrategy.ts:2989      |
| SHORT checkpoint 2       | 20 min, ₹10 required    | BollingerBandStrategy.ts:3011      |
| EOD safety exit          | 15:28 (3:28 PM)         | BollingerBandStrategy.ts:3345      |
| EOD stagger offset       | 5 sec per strategy      | BollingerBandStrategy.ts:3348      |
| Position reconciliation  | Every 5 minutes         | BollingerBandStrategy.ts:3391      |

---

## 🔧 Configuration Defaults (from strategies.json)

| Setting               | Default Value | Notes                         |
| --------------------- | ------------- | ----------------------------- |
| `scannerMode`         | true          | Uses market scanner           |
| `autoStart`           | false         | Requires manual trigger       |
| Capital per stock     | ₹65,000       | Set in StrategyManager        |
| Utilization factor    | 75%           | 25% buffer for drawdowns      |
| Max lots              | 10            | Liquidity protection          |
| Min score to qualify  | 7.0           | Out of 10                     |
| Top stocks selected   | 3             | Maximum concurrent strategies |
| Min premium (live)    | ₹10           | Liquidity filter              |
| Min premium (testing) | ₹1            | For after-hours testing       |

---

_Last Updated: January 26, 2026_
_Document Version: 2.0 (Code-Verified)_
_System Version: Multi-Stock Scanner + Bollinger Band Strategy_
