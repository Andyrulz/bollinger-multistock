# Context: TMV (Trend, Momentum, Volume) Market Scanner Module

## 1. Project Objective

**Goal**: Implement a "Market Scanner" module that runs during the first 15-30 minutes of the trading session (09:15 AM - 09:45 AM).
**Purpose**: To dynamically identify the top 3-5 "High Momentum" stocks from the NIFTY F&O universe.
**Output**: Pass these stock symbols to the existing `BollingerBandStrategy` for trade execution.
**Source Strategy**: Based on Asit Baran Pati's "TMV Ranking System" (Trend, Momentum, Volume).

## 2. Architectural Placement

- **New Service**: `src/services/MarketScanner.ts`
- **Integration**:
  - `StrategyManager` triggers `MarketScanner` at 09:30 AM (after first 15m candle closes).
  - `MarketScanner` fetches data for a predefined "Universe" (NIFTY 50 + Top Liquid F&O).
  - `MarketScanner` returns a sorted array of `ScoredStock` objects.
  - `StrategyManager` instantiates `BollingerBandStrategy` for the top 3 results.

## 3. The Trading Universe (NIFTY 50 + High Beta F&O)

**Constraint**: The bot must ONLY scan these specific stocks. They are selected for high liquidity (tight bid-ask spreads for option buying) and volatility.

### Universe Configuration

**⚠️ CRITICAL FILE FORMAT NOTE**:

The configuration below contains comments for developer guidance. **DO NOT use a `.json` file** as JSON does not support comments and will cause parsing errors on startup.

**Recommended Approach**: Create `src/config/universe.ts` as a **TypeScript file** that exports a const array. This allows comments and provides type safety.

```typescript
// src/config/universe.ts
export interface UniverseStock {
  symbol: string;
  sector: string;
}

export const UNIVERSE: UniverseStock[] = [
  // ... array content below
];
```

**File**: `src/config/universe.ts` (TypeScript, NOT JSON - to support comments)

- **Data Structure**: Map `Stock Symbol` -> `Sector Index Symbol`.
- **Logic**: Before buying `HDFCBANK`, check if `NIFTY BANK` is Green. Before buying `TCS`, check if `NIFTY IT` is Green. (explained further)

**⚠️ CRITICAL - Stock Symbol Validation**:

Kite is **extremely specific** with tradingsymbols. Do NOT guess or assume formatting.

**Known Correct Symbols**:

- `M&M` → Exactly `M&M` (not `MandM` or `M_M`)
- `BAJAJ-AUTO` → Exactly `BAJAJ-AUTO` (with hyphen)
- `L&T` → Actually `LT` (no ampersand for Larsen & Toubro)

**Implementation Requirement**:

Create a **Universe Validation Script** to verify all 40 symbols before going live:

```typescript
// scripts/validate-universe.ts
import { KiteConnect } from "kiteconnect";

async function validateUniverse() {
  const universe = loadUniverseConfig();
  const instruments = await kite.getInstruments("NSE");

  for (const stock of universe) {
    const found = instruments.find((i) => i.tradingsymbol === stock.symbol);
    if (!found) {
      console.error(`❌ INVALID SYMBOL: ${stock.symbol}`);
    } else {
      console.log(`✅ ${stock.symbol} → Token: ${found.instrument_token}`);
    }
  }
}
```

**Add to package.json**:

```json
"scripts": {
  "validate-universe": "ts-node scripts/validate-universe.ts"
}
```

Run `npm run validate-universe` before deployment to catch symbol errors.

{
"universe": [
// --- BANKS (High Liquidity) ---
{ "symbol": "HDFCBANK", "sector": "NIFTY BANK" },
{ "symbol": "ICICIBANK", "sector": "NIFTY BANK" },
{ "symbol": "SBIN", "sector": "NIFTY PSU BANK" },
{ "symbol": "AXISBANK", "sector": "NIFTY BANK" },
{ "symbol": "KOTAKBANK", "sector": "NIFTY BANK" },
{ "symbol": "INDUSINDBK", "sector": "NIFTY BANK" },
{ "symbol": "BANKBARODA", "sector": "NIFTY PSU BANK" },
{ "symbol": "PNB", "sector": "NIFTY PSU BANK" },
{ "symbol": "CANBK", "sector": "NIFTY PSU BANK" },
{ "symbol": "AUBANK", "sector": "NIFTY BANK" },
{ "symbol": "FEDERALBNK", "sector": "NIFTY BANK" },
{ "symbol": "IDFCFIRSTB", "sector": "NIFTY BANK" },
{ "symbol": "BANDHANBNK", "sector": "NIFTY BANK" },

    // --- FINANCIAL SERVICES (Volatile) ---
    { "symbol": "BAJFINANCE", "sector": "NIFTY FIN SERVICE" },
    { "symbol": "BAJAJFINSV", "sector": "NIFTY FIN SERVICE" },
    { "symbol": "CHOLAFIN",   "sector": "NIFTY FIN SERVICE" },
    { "symbol": "SHRIRAMFIN", "sector": "NIFTY FIN SERVICE" },
    { "symbol": "RECLTD",     "sector": "NIFTY FIN SERVICE" },
    { "symbol": "PFC",        "sector": "NIFTY FIN SERVICE" },
    { "symbol": "SBILIFE",    "sector": "NIFTY FIN SERVICE" },
    { "symbol": "HDFCLIFE",   "sector": "NIFTY FIN SERVICE" },

    // --- IT (Trend Followers) ---
    { "symbol": "TCS",        "sector": "NIFTY IT" },
    { "symbol": "INFY",       "sector": "NIFTY IT" },
    { "symbol": "HCLTECH",    "sector": "NIFTY IT" },
    { "symbol": "TECHM",      "sector": "NIFTY IT" },
    { "symbol": "WIPRO",      "sector": "NIFTY IT" },
    { "symbol": "LTIM",       "sector": "NIFTY IT" },
    { "symbol": "COFORGE",    "sector": "NIFTY IT" },
    { "symbol": "PERSISTENT", "sector": "NIFTY IT" },
    { "symbol": "MPHASIS",    "sector": "NIFTY IT" },

    // --- AUTO (Cyclical Momentum) ---
    { "symbol": "TATAMOTORS", "sector": "NIFTY AUTO" },
    { "symbol": "MARUTI",     "sector": "NIFTY AUTO" },
    { "symbol": "M&M",        "sector": "NIFTY AUTO" },
    { "symbol": "BAJAJ-AUTO", "sector": "NIFTY AUTO" },
    { "symbol": "EICHERMOT",  "sector": "NIFTY AUTO" },
    { "symbol": "TVSMOTOR",   "sector": "NIFTY AUTO" },
    { "symbol": "HEROMOTOCO", "sector": "NIFTY AUTO" },
    { "symbol": "ASHOKLEY",   "sector": "NIFTY AUTO" },
    { "symbol": "BHARATFORG", "sector": "NIFTY AUTO" },
    { "symbol": "BALKRISIND", "sector": "NIFTY AUTO" },

    // --- METAL (High Beta/Commodity) ---
    { "symbol": "TATASTEEL",  "sector": "NIFTY METAL" },
    { "symbol": "JSWSTEEL",   "sector": "NIFTY METAL" },
    { "symbol": "HINDALCO",   "sector": "NIFTY METAL" },
    { "symbol": "VEDL",       "sector": "NIFTY METAL" },
    { "symbol": "JINDALSTEL", "sector": "NIFTY METAL" },
    { "symbol": "SAIL",       "sector": "NIFTY METAL" },
    { "symbol": "NMDC",       "sector": "NIFTY METAL" },
    { "symbol": "NATIONALUM", "sector": "NIFTY METAL" },

    // --- ENERGY & OIL ---
    { "symbol": "RELIANCE",   "sector": "NIFTY ENERGY" },
    { "symbol": "ONGC",       "sector": "NIFTY ENERGY" },
    { "symbol": "NTPC",       "sector": "NIFTY ENERGY" },
    { "symbol": "POWERGRID",  "sector": "NIFTY ENERGY" },
    { "symbol": "COALINDIA",  "sector": "NIFTY ENERGY" },
    { "symbol": "BPCL",       "sector": "NIFTY ENERGY" },
    { "symbol": "IOC",        "sector": "NIFTY ENERGY" },
    { "symbol": "TATAPOWER",  "sector": "NIFTY ENERGY" },
    { "symbol": "ADANIGREEN", "sector": "NIFTY ENERGY" },
    { "symbol": "GAIL",       "sector": "NIFTY ENERGY" },

    // --- PHARMA (Defensive/Trend) ---
    { "symbol": "SUNPHARMA",  "sector": "NIFTY PHARMA" },
    { "symbol": "DRREDDY",    "sector": "NIFTY PHARMA" },
    { "symbol": "CIPLA",      "sector": "NIFTY PHARMA" },
    { "symbol": "DIVISLAB",   "sector": "NIFTY PHARMA" },
    { "symbol": "APOLLOHOSP", "sector": "NIFTY PHARMA" },
    { "symbol": "AUROPHARMA", "sector": "NIFTY PHARMA" },
    { "symbol": "LUPIN",      "sector": "NIFTY PHARMA" },
    { "symbol": "ALKEM",      "sector": "NIFTY PHARMA" },

    // --- FMCG (Consumption) ---
    { "symbol": "ITC",        "sector": "NIFTY FMCG" },
    { "symbol": "HINDUNILVR", "sector": "NIFTY FMCG" },
    { "symbol": "BRITANNIA",  "sector": "NIFTY FMCG" },
    { "symbol": "TATACONSUM", "sector": "NIFTY FMCG" },
    { "symbol": "DABUR",      "sector": "NIFTY FMCG" },
    { "symbol": "MARICO",     "sector": "NIFTY FMCG" },
    { "symbol": "GODREJCP",   "sector": "NIFTY FMCG" },

    // --- INFRA / DEFENSE / CAPITAL GOODS ---
    { "symbol": "LT",         "sector": "NIFTY INFRA" },
    { "symbol": "BHARTIARTL", "sector": "NIFTY INFRA" },
    { "symbol": "ULTRACEMCO", "sector": "NIFTY INFRA" },
    { "symbol": "SIEMENS",    "sector": "NIFTY INFRA" }, // Often maps to Infra/Cap Goods
    { "symbol": "ABB",        "sector": "NIFTY INFRA" },
    { "symbol": "HAL",        "sector": "NIFTY INFRA" }, // Defense momentum
    { "symbol": "BEL",        "sector": "NIFTY INFRA" }, // Defense momentum
    { "symbol": "INDIGO",     "sector": "NIFTY INFRA" },

    // --- REALTY (High Momentum) ---
    { "symbol": "DLF",        "sector": "NIFTY REALTY" },
    { "symbol": "GODREJPROP", "sector": "NIFTY REALTY" },

    // --- CONSUMER DURABLES / RETAIL ---
    { "symbol": "TITAN",      "sector": "NIFTY CONSUMER DURABLES" },
    { "symbol": "ASIANPAINT", "sector": "NIFTY CONSUMER DURABLES" },
    { "symbol": "TRENT",      "sector": "NIFTY CONSUMER DURABLES" }, // Super momentum stock
    { "symbol": "HAVELLS",    "sector": "NIFTY CONSUMER DURABLES" },
    { "symbol": "VOLTAS",     "sector": "NIFTY CONSUMER DURABLES" },

    // --- ADANI PACK / COMMODITIES ---
    { "symbol": "ADANIENT",   "sector": "NIFTY METAL" }, // Correlates strongly with Metal/Commodities
    { "symbol": "ADANIPORTS", "sector": "NIFTY INFRA" },
    { "symbol": "UPL",        "sector": "NIFTY CHEM" },  // Or map to NIFTY 50 if CHEM index unavailable
    { "symbol": "PIIND",      "sector": "NIFTY CHEM" },
    { "symbol": "SRF",        "sector": "NIFTY CHEM" }

]
}

// Note: Ensure symbols match KiteConnect tradingsymbol format.

## 4. The TMV Logic & Scoring Algorithm

The scanner assigns a **Total Score (0-10)** to each stock based on four weighted categories.
**Selection Criteria**: Select stocks with Score >= 7 AND Sector Confirmation.

### Phase 1: The Sector Check (Pre-Scan Filter)

Time: 09:30 AM Action:

Fetch % Change for all unique sector indices in the Universe list.

Identify "Green Sectors" (Change > 0.25%) and "Red Sectors" (Change < -0.25%).

Filter:

If Sector is Green, only look for Long (Buy) signals in its stocks.

If Sector is Red, only look for Short (Sell) signals in its stocks.

If Sector is Flat (-0.1% to +0.1%), Ignore all stocks in that sector (avoid chop).

**⚠️ CRITICAL IMPLEMENTATION NOTE - Sector Index Tokens**:

Zerodha/Kite API does NOT accept sector names as strings. You MUST use Instrument Tokens.

**⚠️ FILE FORMAT**: The JSON below has comments for documentation. In actual code, either:

1. **Remove all comments** if using a .json file, OR
2. **Use TypeScript** (`src/config/sectorTokens.ts`) with `export const SECTOR_TOKENS = { ... }`

```typescript
// KITE SECTOR INDICES TOKENS (NSE INDICES Segment)
// Use this as TypeScript const or remove comments for JSON
{
  "NIFTY 50": 256265,
  "NIFTY BANK": 260105,
  "NIFTY IT": 259849,
  "NIFTY AUTO": 257289,
  "NIFTY METAL": 258313,
  "NIFTY INFRA": 257801,
  "NIFTY ENERGY": 256521,
  "NIFTY FMCG": 257033,
  "NIFTY PHARMA": 258569,
  "NIFTY PSU BANK": 261129,
  "NIFTY FIN SERVICE": 257545,
  "NIFTY CONSUMER DURABLES": 261641
  "NIFTY REALTY": 260617,
  "NIFTY PSE (for HAL/BEL/CoalIndia fallback)": 260361,
// For Chemicals (UPL/SRF): Since 'NIFTY CHEM' isn't a main index, map them to 'NIFTY 50' (256265) or 'NIFTY COMMODITIES' (261385) in the universe config to avoid "Index Not Found" errors.
}
```

**Usage Example**:

```typescript
// WRONG - Will fail
const quote = await kite.getQuote("NIFTY BANK");

// CORRECT - Use instrument token
const NIFTY_BANK_TOKEN = 260105;
const quote = await kite.getQuote([NIFTY_BANK_TOKEN]);
const bankChange = quote[NIFTY_BANK_TOKEN].net_change_percent;
```

### Phase 2: The Individual Stock Scoring (0-10 Scale)

#### A. Trend (Trend Alignment) - Max 3 Points

_Logic_: We want stocks trending on both Intraday (5m) and Higher Timeframes (1H/Daily).
_Indicators_:
_ **EMAs**: 8, 21, 50 (Period) on 5-min chart.
_ **VWAP**: Intraday VWAP.

| Condition                 | Logic Check                                             | Points   |
| :------------------------ | :------------------------------------------------------ | :------- |
| **Short-Term Trend**      | `Close(5m) > 8 EMA` AND `8 EMA > 21 EMA`                | **+1**   |
| **Trend Stability**       | `Close(5m) > 50 EMA` (No immediate overhead resistance) | **+0.5** |
| **Volume Weighted Value** | `Close(5m) > VWAP`                                      | **+1.5** |

#### B. Momentum (Velocity) - Max 3 Points

_Logic_: Is the stock moving fast enough to give an option premium spike?
_Indicators_:
_ **RSI (14)** on 5-min and 15-min charts.
_ **ADX (14)** on 5-min chart.

| Condition          | Logic Check                                     | Points |
| :----------------- | :---------------------------------------------- | :----- |
| **RSI Bull Zone**  | `RSI(5m) > 60` (Pure Momentum Zone)             | **+1** |
| **RSI Rising**     | `RSI(5m) > RSI(15m)` (Momentum is accelerating) | **+1** |
| **Trend Strength** | `ADX(14) > 25` (Trending, not chopping)         | **+1** |

#### C. Volume (Fuel) - Max 2 Points

_Logic_: Is there institutional participation driving the move?
_Indicators_:
\_ **RVOL (Relative Volume)**: Current 15m Vol / Avg 15m Vol (last 10 days).

**⚠️ IMPLEMENTATION NOTE - OI Component Removed**:

Original TMV scoring included "OI Build-up" detection. However:

- **Technical Constraint**: Kite Quote API for NSE Equity (Spot) does NOT provide Open Interest
- **Workaround Cost**: Would require fetching Futures instrument tokens for all 40 stocks (doubles API calls)
- **Complexity**: Mapping Spot → Futures adds fragile dependency

**Decision**: Remove OI scoring. Compensate with enhanced volume weighting.

| Condition               | Logic Check                                   | Points |
| :---------------------- | :-------------------------------------------- | :----- |
| **Volume Shock Strong** | `Volume(Last 15m) > 3.0 * AverageVolume(15m)` | **+2** |
| **Volume Shock Mild**   | `Volume(Last 15m) > 2.0 * AverageVolume(15m)` | **+1** |

**Rationale**: High relative volume + trend alignment is sufficient for intraday momentum detection.

#### D. Sector Confluence (The "Asit Rule") - Max 2 Points

_Logic_: Never buy a bank if BANKNIFTY is red.
_Indicators_:
_ Compare Stock % Change vs Sector Index % Change.
_ _Map_: HDFC/ICICI -> BANKNIFTY, INFY/TCS -> NIFTYIT, RELIANCE -> NIFTY50.

| Condition          | Logic Check                                              | Points |
| :----------------- | :------------------------------------------------------- | :----- |
| **Sector Green**   | `Sector Index Change % > 0` (for Longs)                  | **+1** |
| **Outperformance** | `Stock Change % > Sector Change %` (Leader, not laggard) | **+1** |

---

## 5. Technical Implementation Specifications

### Step 1: Data Requirements (KiteConnect API)

The `MarketScanner` requires two distinct data sets:

1.  **Historical Data (Batch Fetch)**:
    - `GET /instruments/historical/:instrument_token/minute`
    - **Timeframe**: 5minute
    - **Range**: Last 10 days (needed for Average Volume calculation).
2.  **Live Quote (Batch Fetch)**:
    - `GET /quote?i=NSE:RELIANCE&i=NSE:INFY...`
    - **Fields**: `last_price`, `ohlc`, `volume`, `net_change` (Note: OI not available for spot equity).

**15-Minute Candle Derivation**:

The scanner needs 15-minute data for RSI comparison and volume analysis, but **do NOT fetch 15-min data separately**.

**Efficient Approach - Aggregate from 5-Min**:

```typescript
function derive15MinCandles(fiveMinCandles: Candle[]): Candle[] {
  const fifteenMinCandles: Candle[] = [];

  // Group every 3 consecutive 5-min candles
  for (let i = 0; i < fiveMinCandles.length; i += 3) {
    const group = fiveMinCandles.slice(i, i + 3);

    if (group.length === 3) {
      fifteenMinCandles.push({
        timestamp: group[0].timestamp,
        open: group[0].open,
        high: Math.max(group[0].high, group[1].high, group[2].high),
        low: Math.min(group[0].low, group[1].low, group[2].low),
        close: group[2].close,
        volume: group[0].volume + group[1].volume + group[2].volume,
      });
    }
  }

  return fifteenMinCandles;
}
```

**Benefits**:

- Zero extra API calls
- Perfect alignment (15-min candles are exact aggregates)
- Same data source ensures consistency

### Step 2: The Scoring Loop (Pseudo-Code)

interface StockScore {
symbol: string;
totalScore: number;
breakdown: { trend: number, momentum: number, volume: number };
bias: 'LONG' | 'SHORT';
valid: boolean;
}

async function scanUniverse(instruments: string[]): Promise<ScoredStock[]> {
const scores: StockScore[] = [];

    // 1. Sector Check (Pre-calculation)
    // Returns map: { 'NIFTY BANK': 0.5, 'NIFTY IT': -0.4 }
    const sectorStatus = await getSectorPerformances();

    for (const stock of instruments) {
        const sectorChange = sectorStatus[stock.sector];
        let bias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

        // Filter: Confluence Check
        if (sectorChange > 0.25) bias = 'LONG';
        else if (sectorChange < -0.25) bias = 'SHORT';
        else continue; // Skip stocks in flat sectors

        // Fetch Data & Indicators...
        // ... (getHistoricalData, calculateEMA, etc.) ...

        let score = 0;

        // --- SCORING LOGIC ---

        // A. TREND (Max 3.0)
        if (bias === 'LONG') {
            if (close > vwap) score += 1.5;
            if (close > ema8 && ema8 > ema21) score += 1.5;
        } else { // SHORT
            if (close < vwap) score += 1.5;
            if (close < ema8 && ema8 < ema21) score += 1.5;
        }

        // B. MOMENTUM (Max 4.0)
        // RSI Logic (Same for both, as RSI < 40 is bearish momentum)
        if (bias === 'LONG') {
            if (rsi > 60 && rsi < 80) score += 2.0;
            if (currentRSI > previous15mRSI) score += 1.0;
        } else { // SHORT
            if (rsi < 40 && rsi > 20) score += 2.0; // Bearish Zone
            if (currentRSI < previous15mRSI) score += 1.0; // Momentum falling
        }
        // ADX is direction agnostic (measures strength)
        if (adx > 25) score += 1.0;

        // C. VOLUME & OI (Max 3.0)
        // Volume Shock (Direction Agnostic)
        if (rvol > 2.0) score += 1.5;

        // Build-up Check
        if (bias === 'LONG') {
            // Price Up + OI Up (Long Build-up)
            if (quote.net_change > 0 && quote.oi > previous_oi) score += 1.5;
        } else {
            // Price Down + OI Up (Short Build-up)
            if (quote.net_change < 0 && quote.oi > previous_oi) score += 1.5;
        }

        // D. SECTOR CONFLUENCE (Max 2.0)
        // We already filtered for sector direction, now check relative strength
        if (bias === 'LONG') {
             if (quote.net_change_percent > sectorChange) score += 1.0; // Leader
             score += 1.0; // Base point for Sector being Green
        } else {
             if (quote.net_change_percent < sectorChange) score += 1.0; // Weaker than sector
             score += 1.0; // Base point for Sector being Red
        }

        if (score >= 7) {
            scores.push({ symbol: stock.symbol, totalScore: score, bias, ... });
        }
    }

    // Return Top 3 sorted by Score
    return scores.sort((a,b) => b.totalScore - a.totalScore).slice(0, 3);

}

### Step 3: Integration with Strategy Manager

The MarketScanner does NOT place trades. It only returns symbols.

Initialization: On bot.start(), MarketScanner loads the "Universe"

Trigger: Use a Cron or setInterval to run scanUniverse() at 09:30 AM IST.

Handoff:

TypeScript example
// Inside StrategyManager
const topStocks = await this.marketScanner.scanUniverse();

for (const stock of topStocks) {
const config = this.createConfigForStock(stock); // Clone default BB config
await this.startStrategy(new BollingerBandStrategy(config));
this.logger.info(`🚀 Starting Bot on High Momentum Stock: ${stock}`);
}

## 6. Constraint & Safety Checks (very Important)

Exhaustion Check: If RSI > 85, DISCARD. The move is likely over; don't buy the top.

Gap Up Trap: If Open > Previous Close + 2%, DISCARD. Risk/Reward is poor.

Circuit Limit: Check upper_circuit_limit from Quote API. If Price is within 1% of Upper Circuit, DISCARD.

Liquidity: Ensure Average Daily Volume > 1,000,000 (pre-filter in Universe config).

## 7. Required Libraries

tulind or technicalindicators: For calculating EMA, RSI, ADX, VWAP efficiently in Node.js.

date-fns or moment-timezone: For strict IST time checking (09:15-09:30 windows).

---

## 8. Implementation Specifications & Business Logic

**⚠️ IMPLEMENTATION PRIORITY NOTE**:

This section (8) contains the **definitive implementation logic** for all components. If there are any conflicts or ambiguities between Section 5 (Technical Implementation Specifications) and Section 8, **always prioritize Section 8**. Section 5 provides conceptual overview; Section 8 provides production-ready specifications.

---

### 8.1 Instrument Type & Execution Model

**Trading Instrument**: Stock Options (CE/PE)

**Capital Context**: ₹2,00,000 total capital

**Why Options**:

- **Stock Futures**: Margin requirements for one lot (e.g., RELIANCE) = ₹1.2L - ₹1.5L. Would only allow trading 1 stock, defeating the "Top 3" scanner purpose.
- **Equity Delivery**: Requires massive capital for meaningful returns from intraday moves.
- **Stock Options**: Buying options allows trading 3 different stocks with ₹65k allocated to each.

**Execution Model**:

```
Analysis Layer:    Stock Spot Price (NSE Equity)
                   ↓
Indicator Layer:   Calculate BB, RSI, Supertrend on Spot
                   ↓
Signal Layer:      Entry/Exit signals from Spot price
                   ↓
Execution Layer:   BUY/SELL Stock Options (CE/PE)
```

**Rationale**: Option charts are noisy due to time decay. Technical indicators are most reliable on the underlying asset (spot).

---

### 8.2 Multi-Strategy Architecture

**Deployment Model**: 3 Separate BollingerBandStrategy Instances

**Implementation**:

```typescript
// Scanner returns: ["RELIANCE", "TCS", "HDFCBANK"]
const topStocks = await scanner.scanUniverse();

// Create independent strategy instances
for (const stock of topStocks) {
  const strategyInstance = new BollingerBandStrategy({
    id: `bollinger-${stock.symbol.toLowerCase()}`,
    symbol: stock.symbol,
    direction: stock.bias, // 'LONG' or 'SHORT'
    capital: 65000,
  });

  await strategyManager.startStrategy(strategyInstance);
}
```

**Benefits**:

- Independent race condition flags (`isProcessingExit`, `isPollingInProgress`)
- Isolated trailing stop loss loops
- Fault tolerance: If TCS strategy crashes, RELIANCE continues unaffected
- Separate position reconciliation per stock

**Resource Management**:

- Each strategy manages own EOD timer (3:28 PM exit)
- Each strategy maintains own trade history
- Each strategy monitors own option premium (1-second polling)

---

### 8.3 Capital Allocation Model

**Total Capital**: ₹2,00,000

**Per-Strategy Allocation**: ₹65,000 (3 strategies)

**Justification**:

- **Equal Weighting**: Cannot predict which of top 3 will perform best
- **Standard Approach**: Momentum basket strategies use equal weights
- **Buffer**: ₹5,000 reserved for emergency scenarios

**Lot Size Calculation**:

```typescript
// CRITICAL: Fetch lot size from instruments master
const lotSize = instrument.lot_size; // e.g., RELIANCE: 250, HDFCBANK: 550

// Calculate affordable lots
const costPerLot = optionPrice * lotSize;
const affordableLots = Math.floor(allocatedCapital / costPerLot);

// Example: RELIANCE ATM ₹40, Lot 250
// Cost = 40 * 250 = ₹10,000
// Lots = floor(65000 / 10000) = 6 lots
```

---

### 8.4 Direction Bias Enforcement

**Rule**: Strict Adherence to Scanner Bias

**Implementation Logic**:

```typescript
if (scannerBias === "LONG") {
  // ONLY evaluate CE entry conditions
  // IGNORE all SHORT/PE signals
  strategy.enabledDirections = ["LONG"];
} else if (scannerBias === "SHORT") {
  // ONLY evaluate PE entry conditions
  // IGNORE all LONG/CE signals
  strategy.enabledDirections = ["SHORT"];
}
```

**Rationale**:

- **Momentum Edge**: Higher timeframe trend alignment provides statistical edge
- **Risk Management**: Contra-trades against a 9/10 scored stock are low probability
- **Clarity**: Eliminates conflicting signals (scanner says LONG, BB says SHORT)

**Example Scenario**:

```
Scanner Result: RELIANCE - Score 8.5 - Bias: LONG (NIFTY ENERGY Green)
Strategy Action: Monitor for Bollinger Band upper breakout + RSI 68-85
Strategy Ignore: Lower band breakdown + RSI 10-30 (SHORT signals)
```

---

### 8.5 Startup & Data Synchronization (Reactive Workflow)

**Constraint**: Kite API requires `access_token` for ALL calls, including historical data.

**The "Late-Binding" Logic**:

The `PreMarketRoutine` (fetching 10-day history for 40 stocks) is NOT strictly bound to 09:00 AM clock time. It is bound to: **(Time >= 09:00 AM) AND (Session == Valid)**.

**Implementation Logic**:

1. **Scheduled Check (09:00 AM)**:

   ```typescript
   setInterval(() => {
     const now = new Date();
     if (now.getHours() === 9 && now.getMinutes() === 0) {
       if (authService.isAuthenticated()) {
         fetchPreMarketData();
       } else {
         needsPreMarketFetch = true; // Flag for later
         logger.info("⏳ Waiting for login to fetch pre-market data");
       }
     }
   }, 60000); // Check every minute
   ```

2. **On Login Success Event**:

   ```typescript
   authService.on("login_success", async () => {
     logger.info("✅ Login successful");

     const now = new Date();
     const currentTime = now.getHours() * 60 + now.getMinutes();

     // Between 09:00 and 09:30
     if (currentTime >= 540 && currentTime < 570 && needsPreMarketFetch) {
       logger.info("🔄 Fetching pre-market data immediately after login");
       await fetchPreMarketData();
       needsPreMarketFetch = false;
     }

     // After 09:30 (too late)
     if (currentTime >= 570) {
       logger.error(
         "🚫 Login after 09:30 - Market momentum window closed. Standby mode.",
       );
       isDataCached = false; // Block scanner execution
     }
   });
   ```

3. **Scanner Trigger (09:30 AM)**:

   ```typescript
   // CRITICAL: Verify data integrity before scanning
   async function runScanner() {
     if (!isDataCached) {
       logger.warn("⏳ Data not cached yet. Waiting 5 seconds...");
       await sleep(5000);

       if (!isDataCached) {
         logger.error("❌ Data fetch failed or incomplete. Aborting scan.");
         return []; // No trades today
       }
     }

     // Proceed with scan
     return await scanUniverse();
   }
   ```

**Scenarios**:

**Scenario A - Early Login (08:50 AM)**:

- 08:50: Login success
- 09:00: Scheduler fires → `isAuthenticated() == true` → `fetchPreMarketData()` runs
- 09:30: Scanner triggers with cached data ✅

**Scenario B - On-Time Login (09:15 AM)** [Most Common]:

- 09:00: Scheduler fires → `isAuthenticated() == false` → Set `needsPreMarketFetch = true`
- 09:15: Login success → Event fires → Check time (09:15 is between 09:00-09:30) → `fetchPreMarketData()` runs immediately
- 09:30: Scanner triggers with cached data ✅

**Scenario C - Late Login (09:35 AM)**:

- 09:35: Login success → Event fires → Check time (09:35 > 09:30) → Log "Too late" → Set `isDataCached = false`
- 09:30: Scanner blocked (data integrity check fails) → Bot standby ❌

**Result**: Authentication dependency handled gracefully across all login timing scenarios.

---

### 8.6 Scanner Execution Timing

**Frequency**: Single Execution at 09:30 AM

**Timeline**:

```
09:00:00  Pre-market data fetch (if logged in)
09:15:00  Market Opens
09:30:00  Scanner triggers (first 15-min candle closes)
09:30:05  Scanner completes → Returns top 3 stocks
09:30:10  3 Strategy instances created with pre-loaded data
09:35:05  First possible trade entry (next 5-min candle close)
15:28:00  All strategies auto-exit (EOD safety)
```

**"Lock & Load" Approach**:

- Scanner runs **once**, selects winners, commits for the day
- **No continuous re-scanning**: Avoids complex logic to kill active strategies if rankings change
- **Stability**: Once entered RELIANCE at 09:40, position holds regardless of later rank changes

**Why Not Continuous**:

- **Complexity**: Killing a LONG position in RELIANCE at 09:45 because HDFCBANK overtook it adds significant risk
- **Whipsaw Risk**: Rapid rank changes could cause excessive entries/exits
- **Capital Tie-up**: Difficult to manage mid-position strategy swaps
  🚨 CRITICAL CORRECTION - Expiry Differences\*\*:

**NIFTY/BANKNIFTY**: Weekly expiries (Tuesday/Wednesday/Thursday)  
**STOCKS**: Monthly expiries ONLY (Last Thursday of the month)

**DO NOT use `getNextTuesdayExpiry()` for stocks. It will fail.**

**Implementation**:

```typescript
function getOptionExpiry(symbol: string): Date {
  const isIndex = ["NIFTY", "BANKNIFTY"].includes(symbol);

  if (isIndex) {
    return getNextWeeklyExpiry(); // Tuesday for NIFTY
  } else {
    return getCurrentMonthExpiry(); // Last Thursday
  }
}

function getCurrentMonthExpiry(): Date {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  // Get last day of current month
  const lastDay = new Date(year, month + 1, 0);

  // Find last Thursday (4 = Thursday)
  let lastThursday = lastDay;
  while (lastThursday.getDay() !== 4) {
    lastThursday.setDate(lastThursday.getDate() - 1);
  }

  // If today > last Thursday, move to next month
  if (today > lastThursday) {
    const nextMonth = new Date(year, month + 2, 0);
    while (nextMonth.getDay() !== 4) {
      nextMonth.setDate(nextMonth.getDate() - 1);
    }
    return nextMonth;
  }

  return lastThursday;
}
```

**Expiry Proximity Filter**:

- **DO NOT skip stocks** based on "days to expiry" unless it's literally expiry day
- **If today IS expiry day**: Move to next month's expiry
- **Otherwise**: Monthly stock options maintain reasonable liquidity throughout the month

---

## \*\*

### 8.7 P&L Tracking - Unified File Architecture

**File**: `data/trading-data.json`

**Structure**:

```json
{
  "date": "2026-01-25",
  "globalCapital": 200000,
  "scannerLog": {
    "scanTime": "09:30:05",
    "qualifiedStocks": 5,
    "selected": ["RELIANCE", "TCS", "HDFCBANK"],
    "greenSectors": ["NIFTY ENERGY", "NIFTY IT"],
    "redSectors": ["NIFTY AUTO"]
  },
  "strategies": {
    "bollinger-reliance": {
      "symbol": "RELIANCE",
      "bias": "LONG",
      "scanScore": 8.5,
      "allocatedCapital": 65000,
      "pnl": 1200,
      "trades": [
        {
          "entryTime": "09:45:00",
          "exitTime": "10:30:00",
          "instrument": "RELIANCE26FEB2500CE",
          "entryPrice": 40,
          "exitPrice": 52,
          "quantity": 1500,
          "pnl": 1200,
          "exitReason": "12% Trailing SL"
        }
      ],
      "activePosition": null
    },
    "bollinger-tcs": {
      "symbol": "TCS",
      "bias": "LONG",
      "scanScore": 8.2,
      "allocatedCapital": 65000,
      "pnl": -500,
      "trades": [
        {
          "entryTime": "11:00:00",
          "exitTime": "13:45:00",
          "instrument": "TCS26FEB3500CE",
          "entryPrice": 25,
          "exitPrice": 21,
          "quantity": 2600,
          "pnl": -500,
          "exitReason": "Entry Candle Low Breach"
        }
      ],
      "activePosition": null
    },
    "bollinger-hdfcbank": {
      "symbol": "HDFCBANK",
      "bias": "SHORT",
      "scanScore": 7.8,
      "allocatedCapital": 65000,
      "pnl": 800,
      "trades": [],
      "activePosition": {
        "instrument": "HDFCBANK26FEB1600PE",
        "entryTime": "14:00:00",
        "entryPrice": 32,
        "quantity": 2035,
        "highestPremium": 35,
        "trailingSL": 30.8
      }
    }
  },
  "dailySummary": {
    "totalPnL": 1500,
    "tradesExecuted": 2,
    "strategiesActive": 3,
    "winRate": 0.5
  }
}
```

**Benefits**:

- **Atomic Updates**: Single file write captures entire portfolio state
- **Dashboard Efficiency**: Aggregate P&L = `sum(strategies[*].pnl)`
- **Audit Trail**: Complete daily trading history in one location
- **Crash Recovery**: Strategy manager reads all active positions from one source

**Write Pattern**:

```typescript
// Each strategy calls this after trade execution
function updateTradingData(strategyId: string, tradeData: Trade) {
  const data = loadTradingData();

  data.strategies[strategyId].trades.push(tradeData);
  data.strategies[strategyId].pnl += tradeData.pnl;
  data.dailySummary.totalPnL = Object.values(data.strategies).reduce(
    (sum, s) => sum + s.pnl,
    0,
  );

  saveTradingData(data);
}
```

---

### 8.8 Sector Check Persistence

**Role**: Entry Gatekeeper (NOT Exit Trigger)

**Logic**:

```
Sector Check = Pre-Entry Filter
NOT = Position Management Tool
```

**Scenario Example**:

```
09:30 AM: NIFTY BANK +0.5% (Green) → HDFCBANK qualifies for LONG
09:40 AM: Enter HDFCBANK CE option @ ₹120
10:30 AM: NIFTY BANK -0.3% (Red) → Sector turns bearish
```

**Action**: **DO NOTHING**

- Rely on technical stop loss (12% trailing SL)
- Rely on entry candle low breach
- If sector weakness is real → Stock price drops → Technical stops trigger naturally

**Rationale**: Sector timing is imperfect. Your technical exits are more reliable than macro sector flips.

---

### 8.9 Strategy State Persistence - Unified Architecture

**File**: `data/strategy/strategy-state.json`

**Purpose**: Crash recovery for all active strategy instances

**Structure**:

```json
{
  "lastUpdated": 1706173800000,
  "instances": {
    "bollinger-reliance": {
      "stage": "IN_POSITION",
      "symbol": "RELIANCE",
      "data": {
        "instrument": "RELIANCE26FEB2500CE",
        "entryPrice": 40,
        "quantity": 1500,
        "entryTime": "09:45:00",
        "highestPremium": 52,
        "trailingSL": 45.76,
        "entryCandle": {
          "timestamp": "09:45:00",
          "open": 2505,
          "high": 2520,
          "low": 2500,
          "close": 2515
        }
      }
    },
    "bollinger-tcs": {
      "stage": "SEARCHING",
      "symbol": "TCS",
      "data": {
        "lastCheckTime": "10:30:00",
        "noSignalCount": 12
      }
    },
    "bollinger-hdfcbank": {
      "stage": "IN_POSITION",
      "symbol": "HDFCBANK",
      "data": {
        "instrument": "HDFCBANK26FEB1600PE",
        "entryPrice": 32,
        "quantity": 2035,
        "entryTime": "14:00:00",
        "highestPremium": 35,
        "trailingSL": 30.8
      }
    }
  }
}
```

**Crash Recovery Flow**:

```typescript
// On bot restart
async function recoverStrategies() {
  const stateFile = loadStrategyState();

  for (const [strategyId, state] of Object.entries(stateFile.instances)) {
    logger.info(`🔄 Recovering strategy: ${strategyId}`);

    // Re-instantiate strategy with saved state
    const strategy = new BollingerBandStrategy({
      id: strategyId,
      symbol: state.symbol,
      restoreFromState: state.data,
    });

    // Strategy constructor reads state.data and restores:
    // - Active position details
    // - Trailing SL levels
    // - Entry candle references
    // - Monitoring timers

    await strategyManager.startStrategy(strategy);
  }

  logger.info(
    `✅ Recovered ${Object.keys(stateFile.instances).length} strategies`,
  );
}
```

**Benefits**:

- **Single Source of Truth**: One file contains all strategy states
- **Atomic Recovery**: All-or-nothing restoration prevents partial state corruption
- **Timestamp Verification**: `lastUpdated` helps detect stale state files

---

### 8.10 Option Selection Algorithm

**Strategy**: Strictly ATM (At-The-Money)

**Logic**:

```typescript
// Fetch current spot price
const spotPrice = await getStockSpotPrice('RELIANCE'); // e.g., 2510

// Get all option strikes for next Tuesday expiry
const availableStrikes = [2400, 2450, 2500, 2550, 2600, ...];

// Find ATM strike (closest to spot)
const atmStrike = findClosestStrike(spotPrice, availableStrikes);
// Result: 2500 (closest to 2510)

// Select option type based on bias
const optionType = bias === 'LONG' ? 'CE' : 'PE';

// Final instrument: RELIANCE26FEB2500CE
```

**⚠️ CRITICAL IMPLEMENTATION NOTE - Option Symbol Construction**:

Zerodha option symbols follow a STRICT format: `SYMBOL + YY + MMM + STRIKE + TYPE`

**Format Rules**:

- **Symbol**: Stock name (e.g., RELIANCE, HDFCBANK)
- **Year**: 2 digits (26 for 2026)
- **Month**: 3 letters UPPERCASE (JAN, FEB, MAR, APR, MAY, JUN, JUL, AUG, SEP, OCT, NOV, DEC)
- **Strike**: No decimal, no padding (2500, not 2500.00)

---

**Minimum Premium Floor - Liquidity Protection**:

**Rule**: Even if ATM, reject if premium < ₹10

**Rationale**:

- Low-priced stocks (₹50-₹100) may have options at ₹0.50-₹2
- These are "option traps": Huge bid-ask spreads, no liquidity, slippage kills profits
- ₹10 minimum ensures tradeable instruments

**Implementation** (in MarketScanner scoring phase):

```typescript
// After finding ATM strike
const atmOption = await findATMStrike(stock, spotPrice, expiry, type);

if (atmOption.premium < 10) {
  logger.warn(
    `${stock}: Premium too low (₹${atmOption.premium}). Liquidity risk - DISCARD`,
  );
  continue; // Skip to next stock
}

// If passed, this stock is a valid candidate
if (score >= 7) {
  candidates.push({
    symbol: stock,
    score: score,
    atmOption: atmOption, // Pass validated option details
  });
}
```

**Global Configuration**:

```json
{
  "scanner": {
    "minOptionPremium": 10,
    "minScoreThreshold": 7
  }
}
```

**Result**: Top 3 stocks will only contain high-quality, liquid, tradeable instruments.

- **Type**: CE or PE

**Examples**:

```typescript
// CORRECT
RELIANCE26FEB2500CE  // February 2026, 2500 strike, Call
HDFCBANK26MAR1600PE  // March 2026, 1600 strike, Put
TCS26JAN3500CE       // January 2026, 3500 strike, Call

// WRONG - Will cause "Symbol Not Found" errors
RELIANCE25FEB26 2500CE    // Wrong year position + space
RELIANCE-26-FEB-2500-CE   // Hyphens not allowed
RELIANCE26FEBRUARY2500CE  // Full month name
RELIANCE26Feb2500CE       // Lowercase month
```

**Implementation Recommendation**:

```typescript
// Create a robust symbol formatter
function formatOptionSymbol(
  stock: string,
  expiry: Date,
  strike: number,
  type: "CE" | "PE",
): string {
  const year = expiry.getFullYear().toString().slice(-2);
  const monthNames = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = monthNames[expiry.getMonth()];

  return `${stock}${year}${month}${strike}${type}`;
}

// Usage
const symbol = formatOptionSymbol("RELIANCE", nextTuesday, 2500, "CE");
// Output: RELIANCE26FEB2500CE
```

**Pro Tip**: After constructing the symbol, validate it exists by fetching from instruments master before attempting to trade.

**Why NOT "1% Premium Rule"**:

- Stock option premiums vary wildly based on volatility
- RELIANCE ATM might be ₹40, TCS ATM might be ₹15
- ATM options provide best delta (price movement sensitivity)

**Lot Size Handling**:

```typescript
// CRITICAL: Each stock has different lot size
// RELIANCE: 250, HDFCBANK: 550, TCS: 125

const instrument = await getInstrumentDetails(tradingsymbol);
const lotSize = instrument.lot_size;

// Calculate quantity
const optionPremium = 40; // Current market price
const costPerLot = optionPremium * lotSize;
const affordableLots = Math.floor(allocatedCapital / costPerLot);

console.log(`
  Stock: RELIANCE
  Option: RELIANCE25FEB26 2500CE
  Premium: ₹${optionPremium}
  Lot Size: ${lotSize}
  Cost/Lot: ₹${costPerLot}
  Capital: ₹${allocatedCapital}
  Quantity: ${affordableLots} lots (${affordableLots * lotSize} shares)
`);
```

---

### 8.11 API Rate Limiting - QuoteManager (Centralized Batching)

**Problem**: 3 strategies polling independently = 3 API calls/second (at rate limit threshold)

**Risk**:

- One additional call (margin check, order status) triggers throttling
- API errors cascade to all strategies
- Difficult to track quota usage

**Solution**: `QuoteManager` Service (Publisher-Subscriber Pattern)

**Architecture**:

```typescript
class QuoteManager {
  private subscriptions: Map<string, Set<StrategyCallback>> = new Map();
  private pollingInterval: NodeJS.Timeout;

  // Strategies register interest in specific symbols
  subscribe(symbol: string, callback: StrategyCallback): void {
    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, new Set());
    }
    this.subscriptions.get(symbol).add(callback);
    logger.info(
      `📊 Registered: ${symbol} (Total subscribers: ${this.subscriptions.size})`,
    );
  }

  // Strategies unregister after exiting positions
  unsubscribe(symbol: string, callback: StrategyCallback): void {
    this.subscriptions.get(symbol)?.delete(callback);
    if (this.subscriptions.get(symbol)?.size === 0) {
      this.subscriptions.delete(symbol);
    }
  }

  // Single polling loop for ALL strategies
  startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      const symbols = Array.from(this.subscriptions.keys());

      if (symbols.length === 0) return; // No active positions

      try {
        // SINGLE API CALL for all symbols
        const quotes = await kite.getQuote(symbols);

        // Publish updates to subscribers
        for (const [symbol, callbacks] of this.subscriptions.entries()) {
          const quote = quotes[symbol];
          callbacks.forEach((cb) => cb(quote));
        }
      } catch (error) {
        logger.error("QuoteManager polling error:", error);
      }
    }, 1000); // 1 second interval
  }
}
```

**Usage in Strategy**:

```typescript
class BollingerBandStrategy {
  async enterPosition() {
    // After successful entry
    this.currentInstrument = "RELIANCE26FEB2500CE";

    // Register with QuoteManager
    quoteManager.subscribe(this.currentInstrument, (quote) => {
      this.handlePremiumUpdate(quote.last_price);
    });
  }

  async exitPosition() {
    // After exit
    quoteManager.unsubscribe(this.currentInstrument, this.handlePremiumUpdate);
    this.currentInstrument = null;
  }

  private handlePremiumUpdate(premium: number): void {
    // Update trailing SL
    if (premium > this.highestPremium) {
      this.highestPremium = premium;
      this.trailingSL = premium * 0.88;
    }

    // Check stop loss
    if (premium <= this.trailingSL) {
      this.exitPosition("12% Trailing SL Hit");
    }
  }
}
```

**Benefits**:

- **Constant API Load**: Always 1 call/second (regardless of 3 or 30 strategies)
- **Quota Buffer**: Leaves headroom for other API calls (orders, positions)
- **Centralized Error Handling**: Single point for retry logic
- **Dynamic Scaling**: Auto-adjusts to active position count

**Result**: From 3 req/sec to 1 req/sec (-67% API usage)

---

### 8.20 QuoteManager Lifecycle - Reference Counting Pattern

**Initialization Location**: `src/index.ts` (Dependency Injection)

```typescript
// src/index.ts
class TradingBot {
  private quoteManager: QuoteManager;

  constructor() {
    this.logger = new Logger();
    this.kiteConnect = new KiteConnect({
      api_key: process.env.ZERODHA_API_KEY,
    });
    this.authService = new AuthService(this.kiteConnect, this.logger);

    // Initialize QuoteManager as singleton
    this.quoteManager = new QuoteManager(this.kiteConnect, this.logger);

    // Pass to StrategyManager
    this.strategyManager = new StrategyManager(
      this.kiteConnect,
      this.authService,
      this.logger,
      this.quoteManager, // <-- Inject here
    );
  }
}
```

**StrategyManager Integration**:

```typescript
class StrategyManager {
  constructor(
    private kiteConnect: any,
    private authService: AuthService,
    private logger: Logger,
    private quoteManager: QuoteManager, // <-- Receive from bot
  ) {}

  async startStrategy(config: StrategyConfig): Promise<void> {
    const strategy = new BollingerBandStrategy(
      config,
      this.kiteConnect,
      this.logger,
      this.quoteManager, // <-- Pass to each strategy
    );

    this.activeStrategies.set(config.id, strategy);
    await strategy.start();
  }
}
```

**Auto-Start/Stop Polling** (Reference Counting):

```typescript
class QuoteManager {
  private subscribers: Map<string, Set<(quote: any) => void>> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  subscribe(symbol: string, callback: (quote: any) => void): void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }

    this.subscribers.get(symbol)!.add(callback);
    this.logger.debug(
      `📊 Subscribed: ${symbol} (Total: ${this.subscribers.size})`,
    );

    // Auto-start polling when first subscriber registers
    if (!this.isPolling) {
      this.startPolling();
    }
  }

  unsubscribe(symbol: string, callback: (quote: any) => void): void {
    const callbacks = this.subscribers.get(symbol);
    if (callbacks) {
      callbacks.delete(callback);

      // Remove symbol if no more subscribers
      if (callbacks.size === 0) {
        this.subscribers.delete(symbol);
        this.logger.debug(
          `📉 Unsubscribed: ${symbol} (Remaining: ${this.subscribers.size})`,
        );
      }
    }

    // Auto-stop polling when all subscribers are gone
    if (this.subscribers.size === 0 && this.isPolling) {
      this.stopPolling();
    }
  }

  private startPolling(): void {
    if (this.isPolling) return;

    this.logger.info("🔄 QuoteManager: Starting polling loop");
    this.isPolling = true;

    this.pollingInterval = setInterval(async () => {
      await this.fetchAndPublish();
    }, 1000);
  }

  private stopPolling(): void {
    if (!this.isPolling) return;

    this.logger.info("⏸️ QuoteManager: Stopping polling loop (0 subscribers)");

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isPolling = false;
  }

  private async fetchAndPublish(): Promise<void> {
    const symbols = Array.from(this.subscribers.keys());

    if (symbols.length === 0) return;

    try {
      // Batch fetch all symbols in ONE API call
      const quotes = await this.kiteConnect.getQuote(symbols);

      // Publish to all subscribers
      for (const [symbol, callbacks] of this.subscribers.entries()) {
        const quote = quotes[symbol];
        if (quote) {
          callbacks.forEach((cb) => cb(quote));
        }
      }
    } catch (error) {
      this.logger.error("QuoteManager fetch error:", error);
    }
  }
}
```

**Strategy Usage**:

```typescript
class BollingerBandStrategy {
  private premiumCallback: (quote: any) => void;

  async enterPosition(): Promise<void> {
    // ... execute entry order ...

    this.currentInstrument = "RELIANCE26FEB2500CE";

    // Bind callback to preserve context
    this.premiumCallback = (quote: any) => {
      this.handlePremiumUpdate(quote.last_price);
    };

    // Subscribe to premium updates
    this.quoteManager.subscribe(this.currentInstrument, this.premiumCallback);
    this.logger.info(`🔔 Monitoring premium for ${this.currentInstrument}`);
  }

  async exitPosition(reason: string): Promise<void> {
    // ... execute exit order ...

    // Unsubscribe from updates
    if (this.currentInstrument && this.premiumCallback) {
      this.quoteManager.unsubscribe(
        this.currentInstrument,
        this.premiumCallback,
      );
      this.logger.info(`🔕 Stopped monitoring ${this.currentInstrument}`);
    }

    this.currentInstrument = null;
  }
}
```

**Lifecycle Timeline**:

```
09:00 AM: QuoteManager created (0 subscribers, not polling)
09:45 AM: RELIANCE strategy enters → subscribe() → Polling starts (1 req/sec)
10:00 AM: TCS strategy enters → subscribe() → Still 1 req/sec (batched)
10:30 AM: RELIANCE exits → unsubscribe() → Still polling (TCS active)
12:00 PM: TCS exits → unsubscribe() → Polling stops (0 subscribers)
14:00 PM: HDFCBANK enters → subscribe() → Polling restarts
15:28 PM: HDFCBANK EOD exit → unsubscribe() → Polling stops
```

**Benefits**:

- **Zero waste**: Only polls when positions are active
- **Always batched**: Even 1 position = 1 API call/sec (not per-strategy)
- **Automatic**: Strategies don't manage polling lifecycle

---

### 8.12 Historical Data Optimization (Pass-Through Architecture)

**Problem**: API Load Explosion

```
40 Stocks × 10 Days × 5-min data = 40 API calls for scanner
3 Selected Stocks × 7 Days × 5-min data = 3 more API calls for strategies
Total: 43 historical data API calls
Rate Limit: 3 requests/second
Time: ~15 seconds just for data fetching
```

**Solution**: Pass-Through Pattern

```typescript
// SCANNER (09:30)
const historicalData = await fetchHistoricalData(stock, 10days);
const score = calculateTMVScore(historicalData);

// HANDOFF
if (score >= 7) {
  selectedStocks.push({
    symbol: stock,
    score: score,
    historicalData: historicalData // PASS THE DATA
  });
}

// STRATEGY INSTANTIATION
for (const stock of selectedStocks) {
  const strategy = new BollingerBandStrategy({
    symbol: stock.symbol,
    preloadedData: stock.historicalData // NO REFETCH
  });

  // Strategy appends live candles to existing array
  strategy.candleHistory = stock.historicalData;
}
```

**Benefits**:

- **Zero redundant API calls**: Strategy uses scanner's data
- **Faster startup**: Immediate trading readiness
- **API quota conservation**: Critical for rate-limited APIs

---

### 8.13 Strategy Initialization Failure - Graceful Degradation

**Principle**: Continue with Survivors (Do Not Backfill)

**Scenario**:

```
Scanner Result: [RELIANCE (8.5), TCS (8.2), HDFCBANK (7.8)]

Initialization:
  ✅ RELIANCE: Strategy started successfully
  ❌ TCS: FAILED (Option symbol not found in instruments master)
  ✅ HDFCBANK: Strategy started successfully
```

**Action**: **Run with 2 strategies (RELIANCE + HDFCBANK)**

**Implementation**:

```typescript
async function deployStrategies(scannerResults: ScoredStock[]) {
  const successfulStarts: string[] = [];
  const failures: Array<{ symbol: string; error: string }> = [];

  for (const stock of scannerResults) {
    try {
      const config = createStrategyConfig(stock);
      const strategy = new BollingerBandStrategy(config);

      await strategyManager.startStrategy(strategy);
      successfulStarts.push(stock.symbol);
      logger.info(`✅ ${stock.symbol}: Strategy deployed`);
    } catch (error) {
      failures.push({ symbol: stock.symbol, error: error.message });
      logger.error(
        `❌ ${stock.symbol}: Initialization failed - ${error.message}`,
      );

      // CRITICAL: Alert user for manual intervention
      sendAlert(`Strategy Init Failure: ${stock.symbol}`, "CRITICAL");
    }
  }

  // Summary
  logger.info(`📊 Deployment Summary: ${successfulStarts.length}/3 successful`);

  if (failures.length > 0) {
    logger.warn(`⚠️ Failures: ${failures.map((f) => f.symbol).join(", ")}`);
    // Log failures for post-mortem analysis
    logFailures(failures);
  }

  // Continue with survivors (even if only 1 or 2)
  return successfulStarts;
}
```

**Why Not Backfill** (e.g., try 4th stock INFY):

- **Recursive Failure Risk**: INFY init might also fail → Loop of attempts
- **Quality Degradation**: 4th stock scored 7.2 (below top 3 threshold)
- **Time Sensitivity**: By the time we retry, market conditions changed
- **Complexity**: Adds significant error handling branches

**Capital Allocation**:

```typescript
// Original plan: 3 strategies × ₹65k = ₹1,95,000
// Actual: 2 strategies × ₹65k = ₹1,30,000
// Unused: ₹65,000 (remains as buffer)

// DO NOT reallocate unused capital to survivors
// Rationale: Risk management designed for ₹65k per position
```

**Root Cause Analysis**:

```typescript
// Most common failures:
// 1. Symbol format mismatch (e.g., BAJAJ-AUTO vs BAJAJAUTO)
// 2. Instrument not found in master (delisted/suspended)
// 3. Lot size = 0 (data corruption)
// 4. Insufficient margin (rare with MIS)

// Log to separate file for pattern detection
logFailureToAnalytics({
  date: today,
  symbol: stock.symbol,
  error: error.message,
  stackTrace: error.stack,
});
```

**Alerting**:

- **Telegram/Email**: Immediate notification of failure
- **Dashboard**: Red banner showing degraded mode
- **Log File**: `logs/strategy-init-failures.log`

**Result**: Trading 2 good setups > Forcing 3 mediocre ones. Preserve capital.

---

### 8.21 State File Corruption Recovery - Broker Reconciliation

**Scenario**: Bot crashes mid-trade, state file corrupted on disk

**Recovery Strategy**: Query Broker Positions API

**Implementation**:

```typescript
class StrategyManager {
  async recoverFromCrash(): Promise<void> {
    let stateData: any;

    try {
      // Attempt to load state file
      stateData = JSON.parse(
        fs.readFileSync("data/strategy/strategy-state.json", "utf8"),
      );
      this.logger.info("✅ State file loaded successfully");
    } catch (error) {
      this.logger.error(
        "❌ State file corrupted, attempting broker reconciliation...",
      );

      // Fallback: Query broker for actual positions
      stateData = await this.reconcileFromBroker();
    }

    // Restore strategies from state
    await this.restoreStrategies(stateData);
  }

  private async reconcileFromBroker(): Promise<any> {
    try {
      // Fetch current positions from Zerodha
      const positions = await this.kiteConnect.getPositions();
      const dayPositions = positions.day; // MIS positions

      this.logger.info(
        `🔍 Found ${dayPositions.length} open positions at broker`,
      );

      // Reconstruct state from broker data
      const reconstructedState: any = {
        lastUpdated: Date.now(),
        instances: {},
        source: "BROKER_RECONCILIATION",
      };

      for (const position of dayPositions) {
        // Extract stock symbol from option instrument
        // e.g., "RELIANCE26FEB2500CE" → "RELIANCE"
        const stockSymbol = this.extractStockSymbol(position.tradingsymbol);
        const strategyId = `bollinger-${stockSymbol.toLowerCase()}`;

        // Reconstruct minimal state
        reconstructedState.instances[strategyId] = {
          stage: "IN_POSITION",
          symbol: stockSymbol,
          data: {
            instrument: position.tradingsymbol,
            entryPrice: position.average_price,
            quantity: Math.abs(position.quantity),
            entryTime: "UNKNOWN_RECOVERED",
            direction: position.quantity > 0 ? "LONG" : "SHORT",
            // CRITICAL: Can't recover trailing SL or entry candle
            // Strategy will recalculate from current state
            recoveredFromBroker: true,
          },
        };

        this.logger.warn(
          `⚠️ Recovered position: ${stockSymbol} (${position.tradingsymbol})`,
        );
      }

      // Save reconstructed state to disk
      fs.writeFileSync(
        "data/strategy/strategy-state.json",
        JSON.stringify(reconstructedState, null, 2),
      );

      this.logger.info("💾 Reconstructed state saved");
      return reconstructedState;
    } catch (error) {
      this.logger.error("Failed to reconcile from broker:", error);
      throw new Error(
        "Cannot recover: State corrupted AND broker query failed",
      );
    }
  }

  private extractStockSymbol(optionSymbol: string): string {
    // "RELIANCE26FEB2500CE" → "RELIANCE"
    // "HDFCBANK26FEB1600PE" → "HDFCBANK"
    // "M&M26FEB2500CE" → "M&M"
    // "BAJAJ-AUTO26FEB2500CE" → "BAJAJ-AUTO"
    const match = optionSymbol.match(/^([A-Z&-]+)\d{2}[A-Z]{3}/);
    return match ? match[1] : optionSymbol;
  }

  // ⚠️ CRITICAL TESTING REQUIREMENT:
  // This regex MUST be unit-tested against:
  //   - "M&M26FEB2500CE" → Should extract "M&M"
  //   - "BAJAJ-AUTO26FEB2500CE" → Should extract "BAJAJ-AUTO"
  //   - "LT26FEB2500CE" → Should extract "LT" (not "L&T")
  // If these tests fail, broker reconciliation will break.

  private async restoreStrategies(stateData: any): Promise<void> {
    for (const [strategyId, state] of Object.entries(stateData.instances)) {
      try {
        const config = this.buildConfigFromState(strategyId, state);
        const strategy = new BollingerBandStrategy(
          config,
          this.kiteConnect,
          this.logger,
          this.quoteManager,
        );

        // If recovered from broker, strategy will:
        // 1. Calculate current trailing SL from current premium
        // 2. Fetch recent candles to set entry candle reference
        // 3. Resume monitoring immediately

        await strategy.restoreFromState(state.data);
        this.activeStrategies.set(strategyId, strategy);

        this.logger.info(`✅ Restored: ${strategyId}`);
      } catch (error) {
        this.logger.error(`Failed to restore ${strategyId}:`, error);
      }
    }
  }
}
```

**Strategy Restoration Logic**:

```typescript
class BollingerBandStrategy {
  async restoreFromState(stateData: any): Promise<void> {
    this.currentInstrument = stateData.instrument;
    this.currentQuantity = stateData.quantity;
    this.entryPrice = stateData.entryPrice;

    if (stateData.recoveredFromBroker) {
      this.logger.warn(
        "⚠️ Recovered from broker - Recalculating critical values...",
      );

      // Fetch current premium
      const quote = await this.kiteConnect.getQuote([this.currentInstrument]);
      const currentPremium = quote[this.currentInstrument].last_price;

      // Set trailing SL from current price (conservative)
      this.highestPremium = currentPremium;
      this.trailingSL = currentPremium * 0.88;

      // Fetch last 5 candles to set entry candle reference
      const recentCandles = await this.fetchRecentCandles(this.symbol, 5);
      this.entryCandle = recentCandles[0]; // Use oldest as proxy

      this.logger.info(
        `🔧 Recalculated: Premium=${currentPremium}, SL=${this.trailingSL}`,
      );
    } else {
      // Normal state restoration
      this.highestPremium = stateData.highestPremium;
      this.trailingSL = stateData.trailingSL;
      this.entryCandle = stateData.entryCandle;
    }

    // Resume monitoring
    this.startPositionMonitoring();
  }
}
```

**Backup Strategy** (Optional Enhancement):

```typescript
// Save backup before each write
function saveStateWithBackup(stateData: any): void {
  const mainPath = "data/strategy/strategy-state.json";
  const backupPath = "data/strategy/strategy-state.json.backup";

  try {
    // If main file exists, copy to backup
    if (fs.existsSync(mainPath)) {
      fs.copyFileSync(mainPath, backupPath);
    }

    // Write new state
    fs.writeFileSync(mainPath, JSON.stringify(stateData, null, 2));
  } catch (error) {
    logger.error("Failed to save state:", error);
    throw error;
  }
}
```

**Recovery Priority**:

1. **Primary**: Load `strategy-state.json`
2. **Fallback 1**: Load `strategy-state.json.backup`
3. **Fallback 2**: Query broker positions API
4. **Last Resort**: Start with clean slate (no positions)

**Limitations of Broker Reconciliation**:

- **Entry Candle Lost**: Can't recover exact entry candle (uses recent candle as proxy)
- **Trailing SL Reset**: Uses current premium as highest (conservative but may exit prematurely)
- **Trade History Lost**: Can't recover P&L of exited positions
- **Scanner Score Lost**: Can't recover TMV score or bias

**Result**: Position protection even with corrupted state. Conservative exit management.

---

### 8.14 Exit Logic Specification

**Use Existing BB Exit Mechanisms**:

**For LONG Positions (CE Options)**:

1. **Entry Candle Low Breach**:
   - Exit if stock spot price closes below entry candle's low
   - Checked at 5-minute candle completion
2. **12% Trailing Stop Loss**:
   - Track highest option premium achieved
   - Stop Loss = Highest Premium × 0.88
   - Exit when current premium ≤ trailing SL
   - Checked every 1 second (REST API polling)

**For SHORT Positions (PE Options)**:

1. **12% Trailing Stop Loss**:
   - Track highest option premium achieved
   - Stop Loss = Highest Premium × 0.88
   - Exit when current premium ≤ trailing SL
   - Checked every 1 second

2. **Time-Decay Safety**:
   - Exit if no new high for 15 minutes
   - Prevents holding depreciating options

**Common Exit Triggers**:

- **EOD Safety**: 3:28 PM automatic exit (all strategies)
- **Position Reconciliation**: Auto-exit if broker squareoff detected (every 5 min)
- **Manual Override**: Dashboard "Clear Position" button

**No Changes Required**: Existing exit logic is proven and reliable.

---

### 8.15 EOD (End-of-Day) Management

**Architecture**: Distributed Management (No Central Kill Switch)

**Implementation**:

```typescript
// Each strategy instance (created at 09:30)
constructor(config) {
  // ...
  this.scheduleEODExit(); // Sets timer for 15:28 today
}

private scheduleEODExit(): void {
  const eodTime = new Date();
  eodTime.setHours(15, 28, 0, 0); // 3:28 PM

  const delay = eodTime.getTime() - Date.now();

  this.eodTimer = setTimeout(async () => {
    if (this.currentPosition) {
      await this.forceClosePosition('EOD_SAFETY_EXIT_3:28PM');
    }
  }, delay);
}
```

**Benefits of Distributed Approach**:

- **Fault Tolerance**: If one strategy's timer fails, others still execute
- **Independent Cleanup**: Each strategy manages own position lifecycle
- **Clear Responsibility**: No central bottleneck for critical EOD exits

**Failure Handling**:

- If EOD timer fails → Position reconciliation (every 5 min) detects broker auto-squareoff
- If reconciliation fails → Manual dashboard intervention
- Logs provide audit trail for all exit attempts

---

### 8.16 Configuration Management

**Approach**: Dynamic Template Cloning (In-Memory Only)

**File Structure**:

```json
// config/strategies.json
{
  "templates": {
    "bollinger-stock-template": {
      "timeframe": "5min",
      "riskPerTrade": 0.8,
      "maxPositions": 1,
      "config": {
        "period": 20,
        "stdDev": 2.0,
        "trailType": "percentage",
        "trailValue": 1.5
      }
    }
  }
}
```

**Runtime Instantiation**:

```typescript
// Scanner completes
const selectedStocks = [
  { symbol: "RELIANCE", bias: "LONG", score: 8.5 },
  { symbol: "TCS", bias: "LONG", score: 8.2 },
  { symbol: "HDFCBANK", bias: "SHORT", score: 7.8 },
];

// Load template
const template = loadConfig("bollinger-stock-template");

// Create instances
for (const stock of selectedStocks) {
  const config = {
    ...template,
    id: `bollinger-${stock.symbol.toLowerCase()}`,
    name: `Bollinger Band - ${stock.symbol}`,
    instruments: [stock.symbol],
    direction: stock.bias,
    capital: 65000,
    scanScore: stock.score,
    scanTime: new Date(),
  };

  // Store in memory only (do NOT write to disk)
  await strategyManager.startStrategy(config);
}
```

**Why In-Memory**:

- **Flexibility**: Configurations change daily based on scanner results
- **No Disk I/O**: Faster startup and teardown
- **Clean State**: Each day starts fresh, no stale configs
- **Template Preservation**: Base template remains unchanged

---

### 8.17 Safety Checks & Filtering

**Layer**: Pre-Instantiation (Scanner Level)

**Implementation**: Block Strategy Creation

**Safety Filters**:

1. **RSI Exhaustion Check**:

```typescript
if (rsi > 85) {
  logger.warn(`${stock}: RSI Exhaustion (${rsi}) - DISCARD`);
  return { score: 0, valid: false };
}
// Rationale: Move is likely over, buying the top is low probability
```

& Calculation Variance 2. **Gap-Up Trap**:

```typescript
const gapPercent = ((open - prevClose) / prevClose) * 100;
if (gapPercent > 2.0) {
  logger.warn(`${stock}: Gap-Up ${gapPercent}% - DISCARD`);
  return { score: 0, valid: false };
}
// Rationale: Risk/Reward is poor after big gaps
```

3. **Circuit Limit Check**:

```typescript
const quote = await kite.getQuote(stock);
const upperCircuit = quote.upper_circuit_limit;
const proximityToCircuit = ((upperCircuit - lastPrice) / lastPrice) * 100;

if (proximityToCircuit < 1.0) {
  logger.warn(
    `${stock}: Near Upper Circuit (${proximityToCircuit}%) - DISCARD`,
  );
  return { score: 0, valid: false };
}
// Rationale: Cannot exit if stock hits circuit
```

4. **Liquidity Filter**:

````typescript

---

**Handling Indicator Variance (Scanner vs Strategy)**:

**Scenario**: Scanner (tulind) calculates RSI = 61. Strategy (custom) calculates RSI = 59 for the same data.

**Question**: Is this a problem?


**5. Gap Handling - Market Open**:
```typescript
// Fetch historical data (includes yesterday's close)
const yesterdayCandles = historicalData.filter(c =>
  c.timestamp.toDateString() === yesterday.toDateString()
);
const yesterdayClose = yesterdayCandles[yesterdayCandles.length - 1].close;

// Today's first candle (09:15-09:20)
const todayOpen = historicalData[historicalData.length - 3].open; // 3rd last = 09:15 candle

// Calculate gap
const gapPercent = ((todayOpen - yesterdayClose) / yesterdayClose) * 100;

if (gapPercent > 2.0) {
  logger.warn(`${stock}: Gap-up ${gapPercent.toFixed(2)}% - DISCARD`);
  return { score: 0, valid: false };
}
// Note: Also apply for gap-down (gapPercent < -2.0) if bearish bias
````

**Data Source**: Yesterday's last candle close vs today's first candle open from same historical dataset.
**Answer**: **No - It's Actually Beneficial**

**Conceptual Framework**:

- **Scanner = Wide Net**: Casts broadly to identify potential candidates
- **Strategy = Sniper**: Precise execution with proven, tested logic

**Example Flow**:

````
09:30:00  Scanner (tulind): RELIANCE RSI = 61 → Score 8.5 → Selected
09:30:05  Strategy created for RELIANCE
09:30:06  Strategy (custom): Calculate RSI = 59 (below 60 threshold)
09:30:06  Strategy: WAIT (no immediate entry)
09:35:05  Next candle: RSI = 62 (above 60)
09:35:05  Strategy: ENTER LONG (conditions met)
```Additional Implementation Details

### 9.1 Scanner Failure Handling (< 3 Stocks Scenario)

**Question**: What if scanner returns fewer than 3 stocks?

**Answer**: Trade What You Get (Never Force Trades)

**Scenarios**:

**Scenario 1: 0 Stocks Qualify**
````

All sectors flat → No stocks pass sector filter
OR
All stocks score < 7 → None meet threshold
OR
All qualified stocks fail safety checks (RSI exhaustion, gaps, circuits)

```
**Action**: Bot sits idle for the day
**Rationale**: Preserving capital on choppy/unclear days is a feature, not a bug

**Scenario 2: 1-2 Stocks Qualify**
```

Scanner returns: [RELIANCE (8.5), TCS (7.2)]

````
**Action**: Deploy only 2 strategies
**Capital**: Allocate ₹65k to each (₹70k remains unused as buffer)
**Rationale**: Quality over quantity - don't force sub-par trades

**Implementation**:
```typescript
const qualifiedStocks = await scanner.scanUniverse();

if (qualifiedStocks.length === 0) {
  logger.info('📭 No stocks qualified today. Bot in standby mode.');
  return; // Exit gracefully, no strategies deployed
}

logger.info(`📊 Qualified stocks: ${qualifiedStocks.length}/3`);
Derive 15-min candles from 5-min (aggregate every 3)
        - Calculate EMA 8, 21, 50 using tulind
        - Calculate RSI (5m and 15m) using tulind
        - Calculate ADX using tulind
        - Calculate VWAP (manual: cumsum(price*vol) / cumsum(vol))
        - Calculate RVOL (current 15m vol / avg 15m vol)

Step 5: Score & Rank
        - Apply TMV scoring algorithm (max 10 points)
        - Filter: Score >= 7
        - Sort by score descending
        - Apply safety checks:
          ✓ RSI exhaustion (>85) → DISCARD
          ✓ Gap-up (>2%) → DISCARD
          ✓ Circuit proximity (<1%) → DISCARD
          ✓ Premium floor (<₹10) → DISCARD
        - Select top 3 from remaining candidates

09:30:05  Scanner completes in ~3 seconds (no API wait)[Empty Slot] - No qualified stock
````

---

### 9.2 Re-Entry Logic (Same Stock, Multiple Times)

**Question**: Can a strategy re-enter the same stock multiple times in one day?

**Answer**: YES - Allow Multiple Entries

**Scenario**:

```
09:45  RELIANCE: LONG entry (Score 8.5)
10:30  Exit on 12% trailing SL (+₹1,200 profit)
       Strategy state: IDLE (no position)
11:00  RELIANCE: Another BB upper breakout + RSI 72
       Strategy state: Conditions met again
```

**Action**: **Take the second entry**

**Logic**:

- The strategy instance stays **alive** until 15:28 EOD
- State cycles: `IDLE → SEARCHING → IN_POSITION → IDLE → SEARCHING...`
- Each cycle is independent (separate P&L tracking)

**Implementation**:

```typescript
class BollingerBandStrategy {
  private positionState: "IDLE" | "SEARCHING" | "IN_POSITION" = "SEARCHING";

  async checkEntrySignals() {
    // Can only enter if not already in position
    if (this.positionState === "IN_POSITION") {
      return; // Skip entry check
    }

    // Check signals (scanner bias enforced)
    if (this.meetsEntryConditions() && this.respectedBias()) {
      await this.executeEntry();
      this.positionState = "IN_POSITION";
    }
  }

  async executeExit() {
    // ... exit logic
    this.positionState = "IDLE"; // Reset after exit

    // After brief cooldown, resume searching
    setTimeout(() => {
      this.positionState = "SEARCHING";
    }, 60000); // 1-min cooldown to avoid immediate re-entry
  }
}
```

**Trade History**:

```json
{
  "symbol": "RELIANCE",
  "trades": [
    {
      "entryTime": "09:45:00",
      "exitTime": "10:30:00",
      "pnl": 1200,
      "exitReason": "12% Trailing SL"
    },
    {
      "entryTime": "11:00:00",
      "exitTime": "13:45:00",
      "pnl": -800,
      "exitReason": "Entry Candle Low Breach"
    }
  ]
}
```

**Benefits**:

- **Maximize opportunities**: Catch multiple momentum waves
- **Risk management**: Each position has independent stop loss
- **Capital efficiency**: Unused capital after first exit gets redeployed

---

### 9.3 Dashboard Design for Multi-Strategy

**Layout**: Aggregate Header + Individual Strategy Cards

**Header Section**:

```
┌─────────────────────────────────────────────────────┐
│  TRADING DASHBOARD - BOLLINGER MULTI-STOCK          │
│  Active Strategies: 3/3 | Total P&L: +₹1,500       │
│  Scan Time: 09:30:05 | Market Status: OPEN          │
└─────────────────────────────────────────────────────┘
```

**Strategy Cards** (3 columns):

```
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ RELIANCE       │ │ TCS            │ │ HDFCBANK       │
│ Score: 8.5     │ │ Score: 8.2     │ │ Score: 7.8     │
│ Bias: LONG     │ │ Bias: LONG     │ │ Bias: SHORT    │
├────────────────┤ ├────────────────┤ ├────────────────┤
│ Status: 🟢 IN  │ │ Status: 🔍 SRCH│ │ Status: 🟢 IN  │
│ Position: CE   │ │ Position: --   │ │ Position: PE   │
│ Entry: ₹45     │ │ Last Attempt:  │ │ Entry: ₹32     │
│ Current: ₹52   │ │ 11:20 (No sig) │ │ Current: ₹28   │
│ P&L: +₹2,275   │ │ Today P&L: --  │ │ P&L: +₹1,100   │
│ Trail: ₹45.76  │ │ Trades: 0      │ │ Trail: ₹28.16  │
├────────────────┤ ├────────────────┤ ├────────────────┤
│ [View Details] │ │ [View Details] │ │ [View Details] │
│ [Force Exit]   │ │ [Stop Monitor] │ │ [Force Exit]   │
└────────────────┘ └────────────────┘ └────────────────┘
```

**Scanner Log Section** (Bottom):

```
═══════════════════════════════════════════════════════
SCANNER LOG - 09:30:05
═══════════════════════════════════════════════════════
✓ Scanned 40 stocks in 2.3 seconds
✓ Green sectors: NIFTY BANK (+0.8%), NIFTY IT (+0.5%)
✓ Red sectors: NIFTY AUTO (-0.6%)
✓ Qualified: 5 stocks (score ≥7)
✓ Top 3 selected:
  1. RELIANCE (8.5) - LONG - NIFTY ENERGY leader
  2. TCS (8.2) - LONG - NIFTY IT momentum
  3. HDFCBANK (7.8) - SHORT - NIFTY BANK laggard
✓ Strategies deployed successfully
```

**Implementation** (Express endpoint):

```typescript
app.get("/dashboard", async (req, res) => {
  const data = loadTradingData();

  const html = `
    <div class="dashboard">
      <!-- Header -->
      <div class="header">
        <h1>Active: ${Object.keys(data.strategies).length}/3</h1>
        <h2>Total P&L: ₹${calculateTotalPnL(data)}</h2>
      </div>
      
      <!-- Strategy Cards -->
      <div class="strategy-grid">
        ${Object.entries(data.strategies)
          .map(
            ([symbol, stratData]) => `
          <div class="card ${stratData.activePosition ? "active" : "idle"}">
            <h3>${symbol}</h3>
            <p>Score: ${stratData.scanScore || "N/A"}</p>
            ${renderStrategyCard(stratData)}
          </div>
        `,
          )
          .join("")}
      </div>
      
      <!-- Scanner Log -->
      <div class="scanner-log">
        ${renderScannerLog(data.scannerLog)}
      </div>
    </div>
  `;

  res.send(html);
});
```

---

## 10.

**Benefits of This Approach**:

1. **Double Verification**: Scanner identifies momentum, Strategy confirms it's still valid
2. **Conservative Entry**: Prevents entering on stale/borderline signals
3. **Proven Logic**: Keep your battle-tested custom BB calculations unchanged
4. **Risk Reduction**: Better to miss a few entries than enter on false signals

**Verdict**:

- **DO NOT** rewrite Strategy to use tulind for "consistency"
- **DO NOT** worry about 1-2 point RSI differences
- **DO** treat scanner as a filter, strategy as the decision-maker

**Implementation Note**:

```typescript
// Scanner just needs to be "close enough"
if (rsi_tulind > 58) {
  // Slightly looser threshold
  // Pass to strategy, let it verify with its own RSI
}

// Strategy remains strict
if (rsi_custom > 60 && rsi_custom < 85) {
  // Enter
}
```

// Pre-filter at universe level
const averageDailyVolume = calculateADV(stock, 30days);
if (averageDailyVolume < 1000000) {
logger.warn(`${stock}: Low Liquidity (ADV: ${averageDailyVolume}) - EXCLUDE FROM UNIVERSE`);
// Remove from scanning universe permanently
}

````

**Result**: If any safety check fails → Score = 0 → Stock never reaches top 3 → Strategy never instantiated.

---

### 8.18 Technical Indicator Library Strategy

**Scanner Layer**: Use `tulind` (Performance)

```typescript
// Scanner needs speed for 40 stocks
import * as tulind from "tulind";

const ema8 = await tulind.indicators.ema.indicator([closes], [8]);
const rsi = await tulind.indicators.rsi.indicator([closes], [14]);
const adx = await tulind.indicators.adx.indicator([highs, lows, closes], [14]);
````

**Strategy Layer**: Keep Custom Implementation (Consistency)

```typescript
// BollingerBandStrategy keeps existing TradingView-compatible code
private calculateRSI(candles: Candle[], period: number): number {
  // Existing RMA-based implementation
  // Matches TradingView exactly
  // Proven in production
}
```

**Rationale**:

- **Scanner**: Needs to be fast, not necessarily TradingView-exact
- **Strategy**: Needs to match your backtesting/TradingView precisely
- **Risk Management**: Don't change live trading math without extensive testing

**Calculation Risk**: Different RSI implementations can vary by 2-3 points. This matters when your entry condition is `RSI > 60`.

---

## 9. Revised Architecture Flow (Complete Timeline)

### Phase 1: Pre-Market (09:00 - 09:15)

```
09:00:00  Bot starts
09:00:01  Load universe configuration (40 stocks)
09:00:02  Initialize MarketScanner service
09:00:03  Initialize StrategyManager
09:00:04  Wait for market open
09:15:00  Market opens - Scanner enters standby
```

### Phase 2: Scanning Window (09:15 - 09:30)

```
09:15:00  First 5-min candle starts building
09:20:00  First 5-min candle completes
09:25:00  Second 5-min candle completes
09:30:00  Third 5-min candle completes (15 min of data ready)
09:30:01  Scanner triggers: scanUniverse()
```

### Phase 3: Scanner Execution (09:30:01 - 09:30:05)

```
Step 1: Fetch Sector Indices (1 API call)
        - NIFTY BANK, NIFTY IT, NIFTY AUTO, etc.
        - Identify Green (>0.25%) and Red (<-0.25%) sectors

Step 2: Pre-Filter Universe
        - 40 stocks → ~20-25 after sector filtering
        - Skip stocks in flat sectors

Step 3: Batch Historical Data Fetch (25 API calls)
        - 10 days × 5-min data per stock
        - Parallel execution (respect rate limits)

Step 4: Calculate Indicators (for each stock)
        - EMA 8, 21, 50
        - RSI (5m and 15m)
        - ADX
        - VWAP
        - RVOL

Step 5: Score & Rank
        - Apply TMV scoring algorithm
        - Filter: Score >= 7
        - Sort by score descending
        - Apply safety checks (RSI exhaustion, gap-up, circuit)
        - Select top 3

09:30:05  Scanner returns:
          [
            { symbol: 'RELIANCE', bias: 'LONG', score: 8.5, data: [...] },
            { symbol: 'TCS', bias: 'LONG', score: 8.2, data: [...] },
            { symbol: 'HDFCBANK', bias: 'SHORT', score: 7.8, data: [...] }
          ]
```

### Phase 4: Strategy Instantiation (09:30:06 - 09:30:10)

```
09:30:06  StrategyManager receives scanner results

For each stock:
  09:30:07  Clone 'bollinger-stock-template' config
  09:30:07  Inject: symbol, direction, capital, preloadedData
  09:30:08  Create BollingerBandStrategy instance
  09:30:08  Initialize with passed historical data (NO API call)
  09:30:09  Calculate initial indicators (BB, RSI, Supertrend, Pivots)
  09:30:09  Start master cycle (5-min candle monitoring)
  09:30:09  Schedule EOD exit (15:28:00)
  09:30:10  Start position reconciliation (every 5 min)

09:30:10  All 3 strategies active and monitoring
```

### Phase 5: Trading Execution (09:30 - 15:28)

```
09:35:05  First candle after initialization completes
          - Each strategy checks entry conditions
          - Respects direction bias (LONG-only or SHORT-only)

09:40:00  Example: RELIANCE triggers LONG entry
          - Stock spot: ₹2510
          - Above upper BB, RSI 72, Supertrend UP
          - Select ATM: 2500 CE @ ₹40
          - Calculate lots: 6 (₹65k / ₹10k per lot)
          - Place BUY order: 6 lots × 250 shares = 1500 shares
          - Wait for fill
          - Start position monitoring (1-sec polling)

09:40 - 15:28  Active position management
               - 1-second premium polling
               - 12% trailing SL updates
               - 5-minute candle exit checks
               - Position reconciliation (every 5 min)

12:30:00  Example: RELIANCE exit triggered
          - Premium dropped to trailing SL
          - Place SELL order
          - Record P&L
          - Update capital
          - Clear position
          - Continue monitoring for re-entry
```

### Phase 6: EOD Shutdown (15:28 - 15:30)

```
15:28:00  All strategies trigger EOD safety exit
          - Force close any active positions
          - Market orders for immediate execution

15:30:00  Market closes
          - Save final state to disk
          - Reconcile with broker positions
          - Log daily summary

15:30:01  Strategies stop monitoring
          - Clear timers and intervals
          - Preserve trade history
          - Ready for next day restart
```

---

## 10. Risk Management Safeguards

### Capital Protection

- **Per-Strategy Cap**: ₹65,000 (prevents single-stock overexposure)
- **Position Limits**: 1 position per strategy (max 3 concurrent)
- **Trailing Stops**: Automatic 12% loss protection
- **EOD Exit**: No overnight exposure (MIS only)

### Operational Safety

- **Rate Limiting**: Respect KiteConnect 3 req/sec for historical data
- **Race Conditions**: Independent flags per strategy instance
- **System Sleep**: Detection and recovery mechanisms
- **Position Reconciliation**: Every 5 minutes vs broker positions
- **Error Recovery**: Retry mechanisms with exponential backoff

### Market Condition Filters

- **Sector Alignment**: Only trade stocks with sector confirmation
- **Exhaustion Avoidance**: No entries if RSI > 85
- **Gap Traps**: No entries if gap > 2%
- **Circuit Protection**: No entries within 1% of circuit limits
- **Liquidity**: Pre-filtered universe (ADV > 1M shares)

### Monitoring & Alerts

- **Health Checks**: Every 5 minutes per strategy
- **Error Tracking**: Consecutive error counts with circuit breakers
- **Dashboard Visibility**: Real-time position and P&L monitoring
- **Audit Trail**: Complete logging of all decisions and executions

---

## 11. Success Metrics & Validation

### Pre-Implementation Checklist

- [ ] Universe configuration validated (40 stocks with correct symbols)
- [ ] Sector mappings verified (HDFCBANK → NIFTY BANK)
- [ ] Instrument tokens fetched for all 40 stocks
- [ ] Lot sizes confirmed for all stock options
- [ ] Rate limiting strategy tested (3 req/sec compliance)
- [ ] Template configuration prepared

### Post-Implementation Testing

- [ ] Paper trade for 5 days (no real money)
- [ ] Verify scanner completes within 5 seconds
- [ ] Confirm 3 strategies instantiate successfully
- [ ] Validate option selection (ATM accuracy)
- [ ] Test EOD exit timers (all 3 fire at 15:28)
- [ ] Verify position reconciliation catches manual exits
- [ ] Confirm capital calculations are accurate

### Performance Benchmarks

- **Scanner Speed**: < 5 seconds for 40 stocks
- **Strategy Startup**: < 2 seconds per instance
- **Entry Execution**: < 3 seconds (order placement + fill)
- **Exit Execution**: < 3 seconds
- **API Compliance**: 100% under rate limits
- **Uptime**: > 99.5% during market hours (09:15 - 15:30)

---

## 12. Implementation Priority

### Phase 1 (Core Scanner) - Week 1

1. Create `MarketScanner.ts` service
2. Implement sector check logic
3. Implement TMV scoring algorithm
4. Add safety filters (RSI, gap, circuit)
5. Test with mock data

### Phase 2 (Integration) - Week 2

1. Modify `StrategyManager` to accept scanner results
2. Implement template cloning
3. Add pass-through data architecture
4. Test scanner → strategy handoff

### Phase 3 (Strategy Adaptation) - Week 3

1. Modify `BollingerBandStrategy` to accept stock symbols
2. Add direction bias enforcement
3. Update option selection for stocks (ATM only)
4. Test with single stock first

### Phase 4 (Multi-Instance) - Week 4

1. Deploy 3 simultaneous strategies
2. Test capital allocation
3. Verify independent operation
4. End-to-end paper trading
