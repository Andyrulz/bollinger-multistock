# Trading Bot System Overview

> **Document Version:** 1.0  
> **Last Updated:** February 2, 2026  
> **System Status:** Production-Ready

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Component Deep-Dive](#component-deep-dive)
4. [Stock Selection Pipeline](#stock-selection-pipeline)
5. [Entry Logic](#entry-logic)
6. [Exit Logic](#exit-logic)
7. [Smart Retention System](#smart-retention-system)
8. [Risk Management](#risk-management)
9. [Data Flow Diagrams](#data-flow-diagrams)
10. [Configuration Reference](#configuration-reference)
11. [API & Dashboard](#api--dashboard)
12. [Operational Procedures](#operational-procedures)

---

## Executive Summary

This is a **professional Node.js/TypeScript trading bot** that trades **stock options** using a **Bollinger Band + Supertrend strategy**. The system:

- **Scans 100+ stocks** from a curated universe every hour
- **Selects top 3 stocks** based on TMV (Trend, Momentum, Volume) scoring
- **Deploys slot-based strategies** for each selected stock
- **Trades ATM options** (Calls for LONG, Puts for SHORT)
- **Uses 5-minute candle close exits** based on Supertrend/BB Middle

### Key Metrics

| Metric               | Value                  |
| -------------------- | ---------------------- |
| Slots                | 3 concurrent positions |
| Capital per Slot     | ₹65,000                |
| Lot Sizing           | 1 lot per ₹40,000      |
| Scan Frequency       | Hourly (XX:18)         |
| Entry/Exit Timeframe | 5-minute candles       |
| Minimum Score        | 7.0/10                 |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TRADING BOT                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐    │
│  │   AuthService   │───▶│  StrategyManager │───▶│  BollingerStrategy  │    │
│  │  (Session Mgmt) │    │  (Orchestrator)  │    │  (Entry/Exit Logic) │    │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘    │
│          │                      │                        │                  │
│          │                      │                        │                  │
│          │              ┌───────▼────────┐               │                  │
│          │              │ MarketScanner  │               │                  │
│          │              │ (TMV Scoring)  │               │                  │
│          │              └───────┬────────┘               │                  │
│          │                      │                        │                  │
│          ▼                      ▼                        ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        KiteConnect API                              │   │
│  │  (Historical Data, Quotes, Orders, Instruments)                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Web Dashboard (Express.js on Port 3000)                                    │
│  - Main Dashboard: /                                                        │
│  - Strategy Detail: /strategy/:id                                           │
│  - Auth: /auth/login, /auth/callback                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component                 | File                                                     | Purpose                                |
| ------------------------- | -------------------------------------------------------- | -------------------------------------- |
| **TradingBot**            | `src/index.ts`                                           | Main Express server, routes, dashboard |
| **AuthService**           | `src/services/AuthService.ts`                            | Zerodha OAuth, session persistence     |
| **StrategyManager**       | `src/core/StrategyManager.ts`                            | Slot management, Smart Retention       |
| **MarketScanner**         | `src/services/MarketScanner.ts`                          | Stock scoring, selection, guards       |
| **BollingerBandStrategy** | `src/strategies/bollinger-band/BollingerBandStrategy.ts` | Entry/exit logic                       |
| **InstrumentCache**       | `src/utils/InstrumentCache.ts`                           | NFO instrument caching                 |
| **QuoteManager**          | `src/services/QuoteManager.ts`                           | Quote batching and caching             |

---

## Component Deep-Dive

### 1. AuthService

**Location:** [src/services/AuthService.ts](../src/services/AuthService.ts)

Handles Zerodha KiteConnect authentication with encrypted session persistence.

**Features:**

- OAuth 2.0 flow via `/auth/login` and `/auth/callback`
- Encrypted session storage in `data/auth/session.json`
- Automatic session restoration on bot restart
- Token validation via `getProfile()` API call

**Session Lifecycle:**

```
User → /auth/login → Zerodha Login Page → /auth/callback → Session Stored
                                                    ↓
Bot Restart → Load Encrypted Session → Validate Token → Ready
```

### 2. StrategyManager

**Location:** [src/core/StrategyManager.ts](../src/core/StrategyManager.ts)

Central orchestrator managing 3 strategy slots with Smart Retention logic.

**Slot States:**

```typescript
interface SlotState {
  slotNumber: number; // 0, 1, 2
  symbol: string | null; // 'CHOLAFIN' or null
  strategyId: string | null; // 'bollinger-slot1-cholafin'
  deployedAt: Date | null; // When deployed
  lastScanScore: number | null; // Score from last scan
  lastScanBias: "LONG" | "SHORT" | null;
  locked: boolean; // True if has active position
}
```

**Responsibilities:**

- Initialize and register strategy classes
- Schedule hourly scans at XX:18:05
- Execute Smart Retention rebalancing
- Manage strategy lifecycle (start/stop/swap)
- Track slot states and position locks

### 3. MarketScanner

**Location:** [src/services/MarketScanner.ts](../src/services/MarketScanner.ts)

TMV (Trend, Momentum, Volume) scoring engine with tradeability guards.

**Scoring Components (Max 10.0):**
| Component | Max Score | Description |
|-----------|-----------|-------------|
| Trend | 3.0 | EMA alignment, VWAP position |
| Momentum | 3.5 | RSI sweet spot, multi-timeframe |
| Volume | 2.0 | RVOL, volume surge |
| Sector | 2.0 | Sector alignment bonus |
| Smart Money | 2.0 | OI analysis (Coiled Spring) |

**Tradeability Guards:**

```
┌─────────────────────────────────────────────────────────┐
│               PRE-FILTERING GUARDS                      │
├─────────────────────────────────────────────────────────┤
│ Guard #1: Risk Distance > 1.5%     → REJECT             │
│ Guard #2: Bandwidth > 3.5%         → REJECT             │
│ Guard #3: RSI Exhaustion (>85/<15) → REJECT (scoring)   │
│ Guard #4: Gap Trap (>2%)           → REJECT             │
│ Guard #5: Circuit Proximity (<1.5%) → REJECT            │
│ Guard #6: Sector Diversity (max 2)  → SKIP (diversity)  │
└─────────────────────────────────────────────────────────┘
```

### 4. BollingerBandStrategy

**Location:** [src/strategies/bollinger-band/BollingerBandStrategy.ts](../src/strategies/bollinger-band/BollingerBandStrategy.ts)

The actual trading strategy with entry/exit logic.

**Indicator Configuration:**
| Indicator | Parameters | Purpose |
|-----------|------------|---------|
| Bollinger Bands | Period: 20, StdDev: 2.0 | Entry zones, exit threshold |
| Supertrend | Period: 10, Multiplier: 2.0 | Dynamic stop loss |
| RSI | Period: 14 | Momentum confirmation |
| Daily Pivots | PP, R1-R3, S1-S3 | Support/resistance levels |

---

## Stock Selection Pipeline

The scanner runs hourly at XX:18:05 (e.g., 09:18, 10:18, etc.) and follows this pipeline:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        STOCK SELECTION PIPELINE                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: SECTOR ANALYSIS                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ • Fetch all sector index quotes (NIFTY BANK, IT, PHARMA, etc.)     │ │
│  │ • Classify: GREEN (>0.1%), RED (<-0.1%), FLAT (between)            │ │
│  │ • Filter universe: Keep GREEN + RED sectors only                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                           │
│  Step 2: TRADEABILITY GUARDS                                             │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ For each stock:                                                    │ │
│  │ • Calculate Supertrend (10,2) and Bollinger Bands (20,2)           │ │
│  │ • Risk Distance = |Close - Supertrend| / Close × 100               │ │
│  │   → REJECT if > 1.5%                                               │ │
│  │ • Bandwidth = (UpperBB - LowerBB) / MiddleBB × 100                 │ │
│  │   → REJECT if > 3.5%                                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                           │
│  Step 3: TMV SCORING (Max 10.0)                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ TREND (Max 3.0):                                                   │ │
│  │ • Close > VWAP → +1.5                                              │ │
│  │ • Close > EMA8 > EMA21 → +1.0 (bullish) / opposite for bearish     │ │
│  │ • Close > EMA50 → +0.5 (trend stability)                           │ │
│  │                                                                    │ │
│  │ MOMENTUM (Max 3.5):                                                │ │
│  │ • RSI Sweet Spot (LONG: 60-75, SHORT: 25-40) → +1.5                │ │
│  │ • RSI Extended (LONG: 75-85, SHORT: 15-25) → +0.5                  │ │
│  │ • RSI Rising/Falling confirmation → +1.0                           │ │
│  │ • ADX > 25 → +1.0 (trend strength)                                 │ │
│  │                                                                    │ │
│  │ VOLUME (Max 2.0):                                                  │ │
│  │ • RVOL > 1.5 → +1.0 (volume surge)                                 │ │
│  │ • RVOL > 2.0 → +1.0 additional                                     │ │
│  │                                                                    │ │
│  │ SECTOR (Max 2.0):                                                  │ │
│  │ • Sector movement > 0.5% in direction → +1.0                       │ │
│  │ • Sector movement > 1.0% in direction → +1.0 additional            │ │
│  │                                                                    │ │
│  │ SMART MONEY (Max 2.0):                                             │ │
│  │ • OI Analysis: Accumulation/Distribution detection                 │ │
│  │ • Coiled Spring bonus when OI and price diverge                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                           │
│  Step 4: SAFETY FILTERS                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ • RSI Exhaustion: LONG RSI > 85 or SHORT RSI < 15 → DISCARD        │ │
│  │ • Gap Trap: Opening gap > 2% → DISCARD                             │ │
│  │ • Circuit Limit: Price within 1.5% of circuit → DISCARD            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                           │
│  Step 5: OPTION VALIDATION & SECTOR DIVERSITY                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ For stocks with score ≥ 7.0 (sorted by score descending):          │ │
│  │ • Sector Diversity: Max 2 stocks per sector                        │ │
│  │ • Find ATM option (CE for LONG, PE for SHORT)                      │ │
│  │ • Premium Floor: Minimum ₹10                                       │ │
│  │ • Liquidity: OI ≥ 25,000 OR Volume ≥ 500                           │ │
│  │ • Select top 3 valid stocks                                        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                           │
│  OUTPUT: ScannerResult with selected stocks + ATM options                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Entry Logic

Entries are checked at every 5-minute candle close when no position exists.

### LONG Entry Conditions

```
All conditions must be TRUE:
┌─────────────────────────────────────────────────────────┐
│ 1. Price touches/crosses LOWER Bollinger Band           │
│    (candleLow ≤ BB Lower)                               │
│                                                         │
│ 2. RSI is NOT extremely oversold                        │
│    (RSI ≥ 25 - avoids catching falling knives)          │
│                                                         │
│ 3. Supertrend confirms uptrend                          │
│    (Supertrend trend = 'UP')                            │
│                                                         │
│ 4. Price above Supertrend value                         │
│    (candleClose > Supertrend)                           │
│                                                         │
│ 5. No existing position                                 │
│    (currentPosition === null)                           │
└─────────────────────────────────────────────────────────┘
                    ↓
         EXECUTE: BUY ATM CALL OPTION
```

### SHORT Entry Conditions

```
All conditions must be TRUE:
┌─────────────────────────────────────────────────────────┐
│ 1. Price touches/crosses UPPER Bollinger Band           │
│    (candleHigh ≥ BB Upper)                              │
│                                                         │
│ 2. RSI is NOT extremely overbought                      │
│    (RSI ≤ 75 - avoids shorting parabolic moves)         │
│                                                         │
│ 3. Supertrend confirms downtrend                        │
│    (Supertrend trend = 'DOWN')                          │
│                                                         │
│ 4. Price below Supertrend value                         │
│    (candleClose < Supertrend)                           │
│                                                         │
│ 5. No existing position                                 │
│    (currentPosition === null)                           │
└─────────────────────────────────────────────────────────┘
                    ↓
         EXECUTE: BUY ATM PUT OPTION
```

### Lot Sizing

```javascript
lots = Math.max(1, Math.floor(currentCapital / 40000));
// Example: ₹65,000 capital → 1 lot
// Example: ₹120,000 capital → 3 lots
```

---

## Exit Logic

**Critical Design Decision:** Exits are checked ONLY at 5-minute candle closes.

This eliminates "wick noise" where intra-candle price spikes would trigger false exits.

### LONG Position Exit

```
┌─────────────────────────────────────────────────────────┐
│                    LONG EXIT                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Check at every 5-minute candle close:                  │
│                                                         │
│  IF candleClose < Supertrend:                           │
│     → EXIT: Sell the Call option                        │
│     → Reason: LONG_SUPERTREND_BREAK                     │
│                                                         │
│  ELSE:                                                  │
│     → HOLD: Position remains open                       │
│     → Log cushion: candleClose - Supertrend             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### SHORT Position Exit

```
┌─────────────────────────────────────────────────────────┐
│                    SHORT EXIT                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Check at every 5-minute candle close:                  │
│                                                         │
│  exitThreshold = MIN(Supertrend, BB Middle)             │
│  (Uses the TIGHTER/lower level for quicker protection)  │
│                                                         │
│  IF candleClose > exitThreshold:                        │
│     → EXIT: Sell the Put option                         │
│     → Reason: SHORT_SUPERTREND_BB_BREAK                 │
│                                                         │
│  ELSE:                                                  │
│     → HOLD: Position remains open                       │
│     → Log cushion: exitThreshold - candleClose          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### EOD Safety Exit

```
┌─────────────────────────────────────────────────────────┐
│                  EOD SAFETY EXIT                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  At 3:24 PM IST (6 minutes before market close):        │
│                                                         │
│  IF position exists:                                    │
│     → FORCE EXIT: Sell at market price                  │
│     → Reason: EOD_SAFETY                                │
│                                                         │
│  Purpose: Never hold overnight (avoid gap risk)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Smart Retention System

The Smart Retention system manages which stocks stay in slots across hourly scans.

### Scan Schedule

```
Scan Times: 09:18, 10:18, 11:18, 12:18, 13:18, 14:18
Last Scan Cutoff: 14:18 (no scans after this)
```

### Retention Decision Matrix

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      SMART RETENTION DECISIONS                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  For each slot (0, 1, 2):                                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF slot is EMPTY:                                                   ││
│  │    → DEPLOY best available candidate (score ≥ 7.0)                  ││
│  │    → Decision: "DEPLOY"                                             ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF slot has ACTIVE POSITION:                                        ││
│  │    → LOCK the slot (never swap while in position)                   ││
│  │    → Decision: "LOCK" (active_position)                             ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF stock NOT in new scan (sector turned flat):                      ││
│  │    → SWAP to new candidate                                          ││
│  │    → Decision: "SWAP" (not_in_scan)                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF bias FLIPPED (was LONG, now SHORT or vice versa):                ││
│  │    → SWAP to new candidate                                          ││
│  │    → Decision: "SWAP" (bias_flip)                                   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF score DROPPED below keepThreshold (6.0):                         ││
│  │    → SWAP to new candidate                                          ││
│  │    → Decision: "SWAP" (momentum_died)                               ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ IF stock STILL QUALIFIES (score ≥ 6.0, same bias):                  ││
│  │    → KEEP in slot (no change)                                       ││
│  │    → Decision: "KEEP" (still_top_tier)                              ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
const smartRetentionConfig = {
  enabled: true,
  scanTimes: ["09:18", "10:18", "11:18", "12:18", "13:18", "14:18"],
  keepThreshold: 6.0, // Minimum score to retain existing strategy
  minDeployScore: 7.0, // Minimum score to deploy NEW strategy
  lockOnActivePosition: true,
  swapOnBiasFlip: true,
  lastScanCutoff: "14:18",
};
```

---

## Risk Management

### Position-Level Risk

| Control             | Value            | Description                              |
| ------------------- | ---------------- | ---------------------------------------- |
| Risk Distance Guard | 1.5% max         | Reject stocks with SL too far from entry |
| Bandwidth Guard     | 3.5% max         | Reject over-extended Bollinger Bands     |
| Exit Logic          | Supertrend-based | Dynamic SL that trails with price        |
| EOD Exit            | 3:24 PM          | Force exit before market close           |

### Portfolio-Level Risk

| Control                  | Value            | Description                |
| ------------------------ | ---------------- | -------------------------- |
| Max Concurrent Positions | 3                | One per slot               |
| Sector Diversity         | Max 2 per sector | Prevent concentration risk |
| Capital per Slot         | ₹65,000          | Fixed allocation           |
| Lot Sizing               | 1 lot / ₹40,000  | Dynamic based on capital   |

### Global Risk Management

```json
{
  "riskManagement": {
    "maxDailyLoss": 50000,
    "maxDrawdown": 100000,
    "emergencyStop": true
  }
}
```

---

## Data Flow Diagrams

### Hourly Scan Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                          HOURLY SCAN FLOW                             │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Timer fires at XX:18:05                                              │
│        ↓                                                              │
│  [Authentication Check]                                               │
│        ↓ (authenticated)                                              │
│  [MarketScanner.runScan()]                                            │
│        ↓                                                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 1. Fetch 5-min historical data for all 100+ stocks (parallel)  │  │
│  │ 2. Analyze sector indices (green/red/flat)                     │  │
│  │ 3. Filter by sector status                                     │  │
│  │ 4. Apply tradeability guards (risk, bandwidth)                 │  │
│  │ 5. Score stocks using TMV algorithm                            │  │
│  │ 6. Apply safety filters (RSI, gap, circuit)                    │  │
│  │ 7. Select top 3 with valid options + sector diversity          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│        ↓                                                              │
│  [ScannerResult] → [StrategyManager.rebalanceStrategies()]            │
│        ↓                                                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ For each slot (0, 1, 2):                                       │  │
│  │   - Evaluate retention decision (LOCK/KEEP/SWAP/DEPLOY)        │  │
│  │   - Stop old strategy if swapping                              │  │
│  │   - Deploy new strategy if needed                              │  │
│  │   - Update slot state                                          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│        ↓                                                              │
│  Schedule next scan at (XX+1):18:05                                   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Strategy Execution Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                      STRATEGY EXECUTION FLOW                          │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  [Strategy.start()]                                                   │
│        ↓                                                              │
│  Load historical data (50 candles) + Calculate indicators             │
│        ↓                                                              │
│  Start 5-minute candle alignment timer (staggered by slot index)      │
│        ↓                                                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ At each 5-minute boundary (+ slotIndex seconds stagger):       │  │
│  │                                                                │  │
│  │   [Fetch latest 5-min candle]                                  │  │
│  │        ↓                                                       │  │
│  │   [Update candle history (keep last 50)]                       │  │
│  │        ↓                                                       │  │
│  │   [Recalculate indicators: RSI, BB, Supertrend]                │  │
│  │        ↓                                                       │  │
│  │   [IF has position: checkPositionExit(candleClose)]            │  │
│  │        ↓                                                       │  │
│  │   [IF no position AND didn't just exit: checkEntrySignals()]   │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Loop continues until strategy.stop() is called                       │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Order Execution Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                       ORDER EXECUTION FLOW                            │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  [Entry Signal Triggered]                                             │
│        ↓                                                              │
│  Calculate lots: Math.floor(capital / 40000), min 1                   │
│        ↓                                                              │
│  Find ATM option from cached instruments                              │
│        ↓                                                              │
│  [kiteConnect.placeOrder({                                            │
│     exchange: 'NFO',                                                  │
│     tradingsymbol: 'STOCK26FEB5000CE',                                │
│     transaction_type: 'BUY',                                          │
│     quantity: lots × lot_size,                                        │
│     product: 'MIS',           // Intraday                             │
│     order_type: 'MARKET',                                             │
│     validity: 'DAY'                                                   │
│  })]                                                                  │
│        ↓                                                              │
│  [Store position: entryPrice, quantity, entryTime, orderId]           │
│        ↓                                                              │
│  [Save state to disk: data/bollinger-slot{N}.json]                    │
│                                                                       │
│  ═══════════════════════════════════════════════════════════════════  │
│                                                                       │
│  [Exit Signal Triggered (Supertrend break or EOD)]                    │
│        ↓                                                              │
│  [kiteConnect.placeOrder({                                            │
│     exchange: 'NFO',                                                  │
│     tradingsymbol: position.instrument.tradingsymbol,                 │
│     transaction_type: 'SELL',                                         │
│     quantity: position.quantity × lot_size,                           │
│     product: 'MIS',                                                   │
│     order_type: 'MARKET',                                             │
│     validity: 'DAY'                                                   │
│  })]                                                                  │
│        ↓                                                              │
│  [Calculate P&L: (exitPrice - entryPrice) × totalQuantity]            │
│        ↓                                                              │
│  [Update capital, clear position, save state]                         │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Configuration Reference

### strategies.json

**Location:** [config/strategies.json](../config/strategies.json)

```json
{
  "templates": {
    "bollinger-stock-template": {
      "name": "Bollinger Band Stock Template",
      "timeframe": "5min",
      "config": {
        "period": 20,
        "stdDev": 2.0,
        "trailType": "percentage",
        "trailValue": 1.5
      }
    }
  },
  "global": {
    "autoStart": false,
    "scannerMode": true,
    "healthCheckInterval": 30000,
    "riskManagement": {
      "maxDailyLoss": 50000,
      "maxDrawdown": 100000,
      "emergencyStop": true
    }
  }
}
```

### universe.ts

**Location:** [src/config/universe.ts](../src/config/universe.ts)

Auto-generated list of 100+ F&O stocks with:

- `symbol`: Stock symbol (e.g., "HDFCBANK")
- `instrumentToken`: NSE instrument token
- `sector`: Sector index name (e.g., "NIFTY BANK")
- `sectorToken`: Sector index instrument token
- `lotSize`: F&O lot size

### Environment Variables

```bash
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
PORT=3000
```

---

## API & Dashboard

### Web Dashboard

**URL:** `http://localhost:3000`

**Main Dashboard Features:**

- Authentication status
- System metrics (total P&L, active positions)
- Slot overview with position details
- Scanner candidates vs deployed stocks
- Quick actions (start/stop strategies)

### API Endpoints

| Endpoint                   | Method | Description            |
| -------------------------- | ------ | ---------------------- |
| `/`                        | GET    | Main dashboard HTML    |
| `/health`                  | GET    | Health check           |
| `/auth/status`             | GET    | Authentication status  |
| `/auth/login`              | GET    | Initiate Zerodha OAuth |
| `/auth/callback`           | GET    | OAuth callback         |
| `/auth/logout`             | POST   | Invalidate session     |
| `/strategy/:id`            | GET    | Strategy detail page   |
| `/api/strategy/:id/start`  | POST   | Start strategy         |
| `/api/strategy/:id/stop`   | POST   | Stop strategy          |
| `/api/scanner/run`         | POST   | Trigger manual scan    |
| `/api/quote-manager/stats` | GET    | Quote manager stats    |

---

## Operational Procedures

### Daily Startup

```
1. Bot starts automatically (PM2 or manual)
2. AuthService attempts to restore encrypted session
3. If session invalid, visit http://localhost:3000/auth/login
4. After authentication, scanner initializes
5. First scan runs at next XX:18 boundary
```

### Pre-Market Checklist

- [ ] Verify authentication status at `/auth/status`
- [ ] Check system health at `/health`
- [ ] Review any overnight error logs
- [ ] Confirm instruments cache is fresh

### During Market Hours

```
09:15 - Market opens
09:18 - First hourly scan runs
09:20 - Strategies deployed to slots
       - Entry signals checked at each 5-min candle close
       - Exit signals checked at each 5-min candle close
...
14:18 - Last hourly scan
15:24 - EOD safety exit (if any positions)
15:30 - Market closes
```

### Troubleshooting

| Issue                  | Solution                                         |
| ---------------------- | ------------------------------------------------ |
| Authentication expired | Visit `/auth/login` to re-authenticate           |
| Scanner not running    | Check `smartRetentionConfig.enabled` is `true`   |
| No entries happening   | Check tradeability guards thresholds             |
| Positions not exiting  | Verify Supertrend calculation in logs            |
| Stale candles          | Check API connectivity, historical data endpoint |

### Log Locations

| Log           | Location                 |
| ------------- | ------------------------ |
| Main bot logs | `logs/trading-bot.log`   |
| Strategy logs | `logs/strategy-{id}.log` |
| Error logs    | `logs/error.log`         |

---

## Key Technical Decisions

1. **5-Minute Candle Close Exits Only**
   - Eliminates wick noise and false exits
   - Reduces API calls vs real-time polling
   - More predictable behavior

2. **Supertrend-Based Dynamic Stop Loss**
   - Trails price naturally in trending moves
   - No fixed percentage that gets stopped out prematurely
   - Works for both LONG and SHORT positions

3. **Sector Diversity Rule**
   - Maximum 2 stocks per sector
   - Prevents correlated exposure (e.g., 3 bank stocks)
   - Improves risk-adjusted returns

4. **Staggered Slot Execution**
   - Each slot offset by 1 second
   - Prevents simultaneous API calls
   - Reduces rate limit issues

5. **Pre-Filtering Tradeability Guards**
   - Risk Distance > 1.5% rejected early
   - Bandwidth > 3.5% rejected early
   - Saves computation on geometrically untradeable setups

---

## Version History

| Version | Date        | Changes                             |
| ------- | ----------- | ----------------------------------- |
| 1.0     | Feb 2, 2026 | Initial comprehensive documentation |

---

_Document generated for Trading Bot v2.0_
