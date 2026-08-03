# Trading Bot Architecture & System Documentation

> **Last Updated**: April 2, 2026
> **Repository**: `Andyrulz/bollinger-multistock` on GitHub
> **Production VM**: Azure VM at `98.70.40.23` (PM2 process: `trading-bot-bollinger`, port 3001)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Infrastructure & Deployment](#2-infrastructure--deployment)
3. [Project Structure](#3-project-structure)
4. [Core Architecture](#4-core-architecture)
5. [Services Layer](#5-services-layer)
6. [Bollinger Band Strategy — The Trading Engine](#6-bollinger-band-strategy--the-trading-engine)
7. [Entry Conditions](#7-entry-conditions)
8. [Exit Framework — 12-Layer Protection](#8-exit-framework--12-layer-protection)
9. [Market Scanner — TMV Scoring Engine](#9-market-scanner--tmv-scoring-engine)
10. [Position Recovery & Crash Resilience](#10-position-recovery--crash-resilience)
11. [Data Persistence & File Map](#11-data-persistence--file-map)
12. [Dashboard & API Endpoints](#12-dashboard--api-endpoints)
13. [Monitoring & Health Checks](#13-monitoring--health-checks)
14. [Scripts & Tooling](#14-scripts--tooling)
15. [Test Suite](#15-test-suite)
16. [Configuration Reference](#16-configuration-reference)
17. [Environment Variables](#17-environment-variables)
18. [Complete Lifecycle — Startup to Trade to Shutdown](#18-complete-lifecycle--startup-to-trade-to-shutdown)

---

## 1. System Overview

A professional-grade Node.js TypeScript intraday options trading bot that:

- **Scans** 70+ NSE stocks every 5 minutes using a TMV (Trend, Momentum, Volume) scoring algorithm
- **Selects** the top 3 candidates and deploys Bollinger Band breakout strategies in 3 independent slots
- **Trades** stock ATM options (CE for LONG, PE for SHORT) on the Zerodha KiteConnect API
- **Protects** capital with 12 layered exit mechanisms — from 5-second RSI pollers to EOD hard exits
- **Recovers** from crashes with full position state persistence to disk
- **Rebalances** slots hourly via Smart Retention (never touching slots with active positions)

### Key Design Principles

| Principle                        | Implementation                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clean separation of concerns** | MarketScanner is a pure service (zero strategy knowledge). StrategyManager orchestrates, doesn't trade. Strategies handle execution. No circular dependencies. |
| **Crash resilience**             | Per-slot JSON files persist positions, capital, and trade history. Recovery rebuilds all monitoring loops on restart.                                          |
| **Rate limit compliance**        | Single QuoteManager polling loop (1 API call for all symbols). Batch historical data at 2 stocks/sec. Slot stagger offsets (0s, 1s, 2s).                       |
| **Capital preservation**         | 12 exit layers, VIX-aware lot sizing, wide-range-day filters, same-day re-entry blocks, 30-min post-exit cooldowns.                                            |
| **Type safety**                  | Full TypeScript with `strict: true`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`.                                                          |

---

## 2. Infrastructure & Deployment

### Production Stack

```
Azure VM (Ubuntu)
├── PM2 Process Manager
│   ├── trading-bot-bollinger (port 3001) ← This bot
│   └── trading-bot-multi-strategy (port 3000) ← Separate independent bot
├── Nginx Reverse Proxy
│   ├── /tradebot-multistock → localhost:3001
│   └── /tradebot-kite → localhost:3000
└── HTTPS via Let's Encrypt
```

| Detail      | Value                                 |
| ----------- | ------------------------------------- |
| VM Host     | `azureuser@98.70.40.23`               |
| SSH Key     | `nifty-trading-bot_key.pem`           |
| Deploy Path | `~/tradebot-bollinger`                |
| PM2 Name    | `trading-bot-bollinger`               |
| Port        | `3001`                                |
| Base Path   | `/tradebot-multistock`                |
| Node.js     | Production (compiled JS from `dist/`) |
| Timezone    | `Asia/Kolkata` (IST)                  |

### PM2 Configuration (`ecosystem.config.js`)

```javascript
{
  name: 'trading-bot-bollinger',
  script: 'dist/index.js',
  instances: 1,
  autorestart: true,
  max_memory_restart: '1G',
  exp_backoff_restart_delay: 100,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 5000,
  env: {
    NODE_ENV: 'production',
    PORT: 3001,
    BASE_PATH: '/tradebot-multistock',
    TZ: 'Asia/Kolkata'
  }
}
```

### Deployment Process

```bash
# Local: Build TypeScript
npm run build

# Transfer compiled files to VM
scp -i key.pem dist/strategies/bollinger-band/BollingerBandStrategy.js azureuser@98.70.40.23:~/tradebot-bollinger/dist/strategies/bollinger-band/
scp -i key.pem dist/index.js azureuser@98.70.40.23:~/tradebot-bollinger/dist/

# VM: Restart
pm2 restart trading-bot-bollinger
```

---

## 3. Project Structure

```
tradebot-bollinger-multistock/
├── src/                         # TypeScript source
│   ├── index.ts                 # Express server, dashboard, routes
│   ├── core/
│   │   ├── StrategyBase.ts      # Abstract base class for strategies
│   │   ├── StrategyManager.ts   # Central orchestrator (2,500+ lines)
│   │   └── StrategyRegistry.ts  # Strategy factory & instance registry
│   ├── services/
│   │   ├── AuthService.ts       # Zerodha OAuth + session management
│   │   ├── SessionPersistence.ts # AES-256-CBC encrypted session storage
│   │   ├── MarketScanner.ts     # TMV scoring engine (3,000+ lines)
│   │   ├── QuoteManager.ts      # Real-time quote polling (Publisher-Subscriber)
│   │   └── OIHistoryService.ts  # Smart Money detection via OI analysis
│   ├── strategies/
│   │   └── bollinger-band/
│   │       └── BollingerBandStrategy.ts  # Trading engine (3,500+ lines)
│   ├── config/
│   │   ├── universe.ts          # Pre-loaded 70+ stock universe
│   │   └── sectorTokens.ts     # Sector index token mapping
│   ├── utils/
│   │   ├── Logger.ts            # Winston logging with rotation
│   │   ├── InstrumentCache.ts   # Daily NFO instruments cache
│   │   └── StateLock.ts         # Atomic state transition manager
│   └── data/                    # Runtime data files (persisted state)
├── config/
│   └── strategies.json          # Strategy configuration
├── data/
│   ├── auth/session.json        # Encrypted Zerodha session
│   ├── cache/                   # Daily instrument caches
│   └── strategy/                # Strategy state backups
├── scripts/                     # Utility and analysis scripts
├── tests/                       # Jest test suite
├── docs/                        # Documentation
├── logs/                        # Winston log files
├── dist/                        # Compiled JavaScript output
├── ecosystem.config.js          # PM2 process config
├── tsconfig.json                # TypeScript compiler config
└── package.json                 # Dependencies and scripts
```

---

## 4. Core Architecture

### 4.1 StrategyBase (`src/core/StrategyBase.ts`)

Abstract base class all strategies inherit from.

**Interfaces:**

```typescript
interface StrategyConfig {
  id: string; // e.g., "bollinger-slot1-cholafin"
  name: string; // Human-readable name
  enabled: boolean; // Active/inactive toggle
  description: string; // Description and timeframe
  timeframe: string; // "5min"
  instruments: string[]; // Stock symbols (e.g., ["CHOLAFIN"])
  riskPerTrade: number; // Risk % per trade (0.8 = 0.8%)
  maxPositions: number; // Max concurrent positions per slot (1)
}

interface StrategyMetrics {
  isActive: boolean;
  isStreaming: boolean;
  totalTrades: number;
  profitLoss: number;
  winRate: number;
  lastTradeTime?: Date;
  lastUpdateTime: Date;
  errorCount: number;
  healthStatus: "healthy" | "warning" | "error" | "stopped";
}
```

**Abstract methods** (implemented by BollingerBandStrategy):

- `initialize()` — One-time setup (load historical data, calculate indicators)
- `start()` — Begin monitoring and trading
- `stop()` — Cease trading, cleanup timers
- `getStatus()` — Return current position, metrics, trade history
- `processMarketData(data)` — Handle incoming market data

**Common methods**: `getConfig()`, `getMetrics()`, `getId()`, `getName()`, `isEnabled()`, `isRunning()`, `updateMetrics()`, `setHealthStatus()`

### 4.2 StrategyManager (`src/core/StrategyManager.ts`)

Central orchestrator managing 3 independent trading slots. **2,500+ lines**.

**Slot System:**

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     SLOT 0      │  │     SLOT 1      │  │     SLOT 2      │
│  Capital: ₹65K  │  │  Capital: ₹65K  │  │  Capital: ₹65K  │
│  Stock: CHOLAFIN│  │  Stock: TCS     │  │  Stock: (empty)  │
│  State: LOCKED  │  │  State: ACTIVE  │  │  State: EMPTY    │
│  (has position) │  │  (monitoring)   │  │  (available)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

Each `SlotState` tracks:

```typescript
{
  slotNumber: number; // 0, 1, 2
  symbol: string | null; // Current stock
  strategyId: string | null; // Strategy instance ID
  deployedAt: Date | null; // Deployment time
  lastScanScore: number | null; // Latest TMV score
  lastScanBias: "LONG" | "SHORT" | null;
  locked: boolean; // True if has active position
  lastRetentionDecision: string; // 'LOCK'|'KEEP'|'SWAP'|'DEPLOY'
  lastRetentionReason: string; // Human-readable reason
}
```

**Smart Retention Logic** (runs at each scan interval):

| Decision   | Condition                         | Action                            |
| ---------- | --------------------------------- | --------------------------------- |
| **LOCK**   | Slot has active position          | Skip entirely — never disturb     |
| **KEEP**   | Stock still in top 3, score ≥ 6.0 | Retain current strategy           |
| **SWAP**   | Stock not in top 3 or score < 6.0 | Stop old strategy, deploy new one |
| **DEPLOY** | Slot empty, candidate available   | Deploy top-ranked stock           |

**Cooldown System:**

- `symbolCooldownMap` — 30-minute post-exit lockout per symbol
- `symbolsTradedToday` — Same-day re-entry block (populated from disk on startup)

**Initialization Pipeline:**

1. `registerStrategies()` → Register BollingerBandStrategy class
2. `restoreSlotStatesFromDisk()` → Find active positions from crash recovery
3. `restoreLockedSlotStrategies()` → Rebuild strategy instances for locked slots
4. `loadStrategyConfigs()` → Read `config/strategies.json`
5. Start health monitoring (30-sec interval)
6. Schedule pre-market check (8:50 AM)
7. Schedule scanner (every 5 min from 09:23 to 14:58)
8. Initialize OI History Service

### 4.3 StrategyRegistry (`src/core/StrategyRegistry.ts`)

Singleton factory for strategy class registration and instance management.

**Key behavior:**

- `registerStrategy("bollinger-band", BollingerBandStrategy)` — Register class
- `createInstance(id, kiteConnect, ...)` — Factory method
  - If authenticated: initialize immediately
  - If NOT authenticated: defer until `initializePendingStrategies()` (called after OAuth callback)
- `removeInstance(id)` — Stops strategy and removes from registry

---

## 5. Services Layer

### 5.1 AuthService (`src/services/AuthService.ts`)

Handles Zerodha OAuth2 authentication with session persistence.

**Flow:**

```
User → /auth/login → Zerodha OAuth → /auth/callback?request_token=XXX
                                           │
                                           ▼
                                    generateSession()
                                           │
                                    ┌──────┴──────┐
                                    │ Save to disk │  (AES-256-CBC encrypted)
                                    └──────┬──────┘
                                           │
                                    initializePendingStrategies()
                                           │
                                    Redirect to Dashboard
```

**Token validation:**

- 5-minute cache TTL (avoids hammering Zerodha API)
- Distinguishes transient errors (ECONNABORTED, ETIMEDOUT, etc.) from auth errors
- Transient errors don't clear session; auth errors do

**Session lifecycle:**

- Tokens expire at **6 AM next day** (Zerodha standard)
- On restart: loads encrypted session, validates token, resumes if valid

### 5.2 SessionPersistence (`src/services/SessionPersistence.ts`)

Encrypted session storage using AES-256-CBC.

**Encryption:**

```
Algorithm:  AES-256-CBC
Key:        SHA256(API_KEY + API_SECRET + "trading_bot_session_key").digest('hex').slice(0, 32)
IV:         Random 16 bytes (new per encryption)
File:       data/auth/session.json (mode 0o600)
```

**Persisted format:**

```json
{
  "data": "<hex-encrypted-blob>",
  "iv": "<hex-iv>",
  "timestamp": "2026-04-02T09:15:00Z"
}
```

### 5.3 QuoteManager (`src/services/QuoteManager.ts`)

Singleton real-time quote provider using Publisher-Subscriber pattern.

**Why it exists:** Prevents API saturation from multiple independent pollers. One polling loop serves all subscribers.

```
Strategy A subscribes("TCS26APR3500CE")  ──┐
Strategy B subscribes("RELIANCE26APR2500PE") ──┤── Single getQuote() call per tick
Strategy C subscribes("INFY26APR1500CE")  ──┘          │
                                                        ▼
                                               Distribute quotes to
                                               respective callbacks
```

**Behavior:**

- Auto-starts polling on first subscriber
- Auto-stops on last unsubscribe
- 1-second polling interval
- Circuit breaker: stops after 10 consecutive errors
- Staleness detection: flags if no data for >5 seconds
- Single API call batches all subscribed symbols

### 5.4 OIHistoryService (`src/services/OIHistoryService.ts`)

Smart Money detection via Open Interest analysis.

**Theory:** High OI change + low price change = institutional accumulation/distribution ("Coiled Spring").

**Signals:**

| Signal         | OI Change     | Price Change      | Interpretation                      |
| -------------- | ------------- | ----------------- | ----------------------------------- |
| ACCUMULATION   | ↑ (≥5%)       | Flat (≤1.5%)      | Institutions buying → Bullish       |
| DISTRIBUTION   | ↑ (≥5%)       | Flat/down (≤1.5%) | Institutions selling → Bearish      |
| SHORT_COVERING | ↓ (≤-5%)      | ↑                 | Shorts closing → Bullish            |
| LONG_UNWINDING | ↓ (≤-5%)      | ↓                 | Longs closing → Bearish             |
| CONFLICT       | Contradictory | —                 | **Disqualifies stock** (score -999) |

**Daily cycle:**

- Loads yesterday's OI from `data/oi-history.json` on startup
- Saves current OI at **3:40 PM** daily for next-day use
- Blocks scoring during expiry week (Tue–Thu before monthly expiry)

---

## 6. Bollinger Band Strategy — The Trading Engine

`src/strategies/bollinger-band/BollingerBandStrategy.ts` — **3,500+ lines**, the core trading logic.

### 6.1 All Constants & Thresholds

| Category            | Constant                             | Value                    | Purpose                               |
| ------------------- | ------------------------------------ | ------------------------ | ------------------------------------- |
| **Capital**         | `INITIAL_CAPITAL`                    | ₹65,000                  | Default per-slot capital              |
| **Capital**         | Lot formula                          | `floor(capital / 40000)` | 1 lot per ₹40K, min 1                 |
| **Capital**         | `VIX_FALLING_THRESHOLD`              | -5%                      | Halve lots when VIX falls >5%         |
| **Bollinger Bands** | Period                               | 20                       | 20-candle SMA                         |
| **Bollinger Bands** | StdDev                               | 2.0                      | 2σ bands                              |
| **RSI**             | Period                               | 14                       | Standard RSI                          |
| **RSI**             | LONG entry range                     | 60–85                    | Sweet spot for breakout               |
| **RSI**             | SHORT entry range                    | 15–40                    | Sweet spot for breakdown              |
| **Supertrend**      | Period                               | 10                       | ATR lookback                          |
| **Supertrend**      | Multiplier                           | 2.0                      | ATR multiplier                        |
| **Option**          | `MIN_PREMIUM`                        | ₹40                      | Reject cheap options                  |
| **Option**          | `MAX_SPREAD_PERCENT`                 | 2.0%                     | Bid-ask spread limit                  |
| **Regime**          | `WIDE_RANGE_DAY_THRESHOLD`           | 1.3                      | 130% ADR blocks entries               |
| **Regime**          | `EXTREME_INTRADAY_RANGE_PCT`         | 1.5%                     | Nifty range kill-switch               |
| **Regime**          | Narrow Range Day                     | <0.7 × ADR               | Previous calm day = skip              |
| **Regime**          | `NIFTY_50_TOKEN`                     | 256265                   | For intraday range monitoring         |
| **Regime**          | `INDIA_VIX_TOKEN`                    | 264969                   | For VIX regime detection              |
| **Exit**            | `PREMIUM_HARD_STOP_PCT`              | 8%                       | Exit if premium drops 8% from entry   |
| **Exit**            | `EMERGENCY_STOP_PERCENT`             | 5.0%                     | Flash crash protection on underlying  |
| **Exit**            | `EMERGENCY_POLL_INTERVAL_MS`         | 30,000                   | 30-second emergency check             |
| **Exit**            | `OPTION_RSI_CLIMAX_THRESHOLD`        | 85                       | 15-min gamma climax detection         |
| **Exit**            | `OPTION_RSI_CHECK_INTERVAL`          | 15 min                   | How often gamma RSI checked           |
| **Exit**            | `OPTION_RSI_MICRO_GRACE_SECONDS`     | 60                       | Grace period to prevent double-fire   |
| **Exit**            | `RSI_TRAIL_ACTIVATION_THRESHOLD`     | 85                       | 5-min option RSI activates trail      |
| **Exit**            | `RSI_TRAIL_SECONDARY_EXIT_THRESHOLD` | 75                       | Candle-close RSI below exits          |
| **Exit**            | `RSI_TRAIL_POLL_INTERVAL_MS`         | 5,000                    | 5-second live premium polling         |
| **Exit**            | `RSI_CONFIRMATION_WINDOW`            | 2 candles                | F7 quick reversal window              |
| **Exit**            | `RSI_CONFIRMATION_LONG_THRESHOLD`    | 62                       | Exit if RSI drops below               |
| **Exit**            | `RSI_CONFIRMATION_SHORT_THRESHOLD`   | 32                       | Exit if RSI rises above               |
| **Exit**            | EOD exit time                        | 3:11 PM IST              | Auto-exit before CAS and squareoff    |
| **Staleness**       | Consecutive candles                  | 3+                       | Exit if 3+ candles still outside band |
| **Staleness**       | `MAX_CANDLE_GAP_MS`                  | 6 min                    | Max gap between consecutive candles   |
| **Polling**         | `MIN_POLLING_INTERVAL`               | 900ms                    | Minimum REST API interval             |
| **Polling**         | `MAX_CONSECUTIVE_FAILURES`           | 5                        | Max failures before circuit break     |
| **Polling**         | `CANDLE_RETRY_INTERVAL`              | 10,000ms                 | Retry delay for candle fetching       |
| **Reconciliation**  | Interval                             | 2 min                    | Check broker position still exists    |
| **Slot Stagger**    | Offset                               | `slotIndex × 1,000ms`    | Prevents API collision between slots  |

### 6.2 Technical Indicators Calculated

All indicators are computed from 5-minute candles of the **signal stock** (underlying equity):

1. **Bollinger Bands** — SMA(20) ± 2σ → `upper`, `middle`, `lower`
2. **RSI(14)** — Wilder's RMA smoothing on 5-min closes
3. **Supertrend(10, 2.0)** — TradingView-compatible, returns `trend` (UP/DOWN) and `value`
4. **ATR(10)** — Average True Range (component of Supertrend)
5. **Daily Pivots** — PP, R1/R2/R3, S1/S2/S3 from previous day OHLC
6. **ADR** — Average Daily Range over 5 days (for regime filtering)
7. **VWAP** — Volume-Weighted Average Price for current session
8. **15-Min Option RSI** — RSI(14) on 15-minute option candles (for Gamma Climax)
9. **5-Min Option RSI** — RSI(14) on 5-minute option candles (for RSI Trail)
10. **1-Hour Supertrend** — Derived from 60-minute candles (for entry alignment)

### 6.3 Position Lifecycle

```
IDLE (monitoring) → ENTRY SIGNAL → PLACE ORDER → ACTIVE POSITION → EXIT TRIGGER → PLACE EXIT ORDER → RECORD P&L → IDLE
       │                                              │
       └── Scanner may SWAP stock ──────────────────── └── 12 possible exit paths
```

**Position state object:**

```typescript
{
  type: 'LONG' | 'SHORT',
  instrument: { tradingsymbol, instrument_token, lot_size, ... },
  entryPrice: number,           // Premium at entry
  quantity: number,             // Shares (lots × lot_size)
  entryTime: Date,
  entryStockPrice: number,     // Underlying at entry
  entryCandleLow: number,      // RSI Trail floor baseline
  entryCandleHigh: number,
  entryOrderId: string,        // Zerodha order ID
  highestPremium: number,      // Peak for trailing stop
  trailingSL: number,          // Current trailing stop level
  breakoutValidation: { ... }, // Breakout candle tracking
  rsiConfirmation: { ... },    // F7 quick reversal state
}
```

### 6.4 Monitoring Timer Architecture

When a position is active, multiple independent monitoring loops run concurrently:

```
┌─────────────────────────────────────────────────────────────┐
│                    ACTIVE POSITION                           │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Master Cycle     │  │ Emergency Stop   │                │
│  │ (5-min aligned)  │  │ (every 30 sec)   │                │
│  │                  │  │                  │                │
│  │ • BB/RSI/ST     │  │ • 5% underlying  │                │
│  │ • Supertrend    │  │   drop check     │                │
│  │ • Premium stop  │  │                  │                │
│  │ • Stale check   │  │                  │                │
│  │ • RSI confirm   │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Gamma RSI        │  │ RSI Trail 5-Min  │                │
│  │ (every 15 min)   │  │ (every 5 sec     │                │
│  │                  │  │  when activated)  │                │
│  │ • 15-min option  │  │                  │                │
│  │   RSI ≥ 85       │  │ • Candle LOW     │                │
│  │   → EXIT         │  │   ratcheting     │                │
│  └──────────────────┘  │ • RSI < 75 exit  │                │
│                        └──────────────────┘                │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Reconciliation   │  │ EOD Timer        │                │
│  │ (every 2 min)    │  │ (fires at 3:19)  │                │
│  │                  │  │                  │                │
│  │ • Verify broker  │  │ • Force close    │                │
│  │   still has pos  │  │   all positions  │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Entry Conditions

### LONG Entry (All must be true at candle close)

| #   | Condition                | Detail                                             |
| --- | ------------------------ | -------------------------------------------------- |
| 1   | **BB Breakout**          | Close > Upper Bollinger Band                       |
| 2   | **RSI Confirmation**     | RSI(14) between 60 and 85                          |
| 3   | **Supertrend UP**        | 5-min Supertrend trend = "UP"                      |
| 4   | **Above Pivot/PDH**      | Price > R1 pivot OR > Previous Day High            |
| 5   | **Not Wide-Range Day**   | Previous day range < 1.3 × ADR                     |
| 6   | **Not Narrow Range Day** | Previous day range > 0.7 × ADR                     |
| 7   | **Not Extreme Intraday** | Nifty session range < 1.5%                         |
| 8   | **Not Stale**            | ≤2 consecutive candles outside band at current RSI |
| 9   | **Post-Exit Cooldown**   | Stock not in 30-min cooldown                       |
| 10  | **No Same-Day Re-entry** | Stock not already traded today                     |
| 11  | **No Active Position**   | Slot is free                                       |
| 12  | **Min Premium**          | ATM option premium ≥ ₹40                           |
| 13  | **1-Hour ST Alignment**  | 1-hour Supertrend also UP                          |

### SHORT Entry (Inverse logic)

| #    | Condition                                                                  | Detail                                 |
| ---- | -------------------------------------------------------------------------- | -------------------------------------- |
| 1    | **BB Breakdown**                                                           | Close < Lower Bollinger Band           |
| 2    | **RSI Confirmation**                                                       | RSI(14) between 15 and 40              |
| 3    | **Supertrend DOWN**                                                        | 5-min Supertrend trend = "DOWN"        |
| 4    | **Below Pivot/PDL**                                                        | Price < S1 pivot OR < Previous Day Low |
| 5–13 | Same regime/cooldown/alignment filters as LONG (inverted where applicable) |

### Option Selection

- **LONG**: Buys **CE** (Call) at ATM or 1-strike OTM
- **SHORT**: Buys **PE** (Put) at ATM or 1-strike OTM
- Strike selection: Closest to underlying price with premium ≥ ₹40
- Expiry: Next available stock option expiry

### Lot Sizing

```
lots = floor(currentCapital / 40,000)
lots = max(lots, 1)                        // Always trade at least 1 lot
if VIX change < -5%:
    lots = floor(lots / 2)                 // Halve on falling VIX
quantity = lots × lotSize                  // lotSize from universe config
```

---

## 8. Exit Framework — 12-Layer Protection

Exits are prioritized — the first trigger wins. Multiple monitors run concurrently.

### Layer 1: Premium Hard Stop (8%)

| Attribute           | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| **Threshold**       | Option premium drops ≥8% from entry price                |
| **Check frequency** | Every 5-min candle close                                 |
| **Purpose**         | Prevents death spiral on runaway losses                  |
| **Data**            | 0 winners killed, 13 losers stopped early → saved ₹6,662 |

### Layer 2: Emergency Hard Stop (5%)

| Attribute           | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| **Threshold**       | Underlying stock moves ≥5% against position                    |
| **Check frequency** | Every 30 seconds                                               |
| **Purpose**         | Flash crash / circuit-break protection                         |
| **Formula**         | `abs(currentPrice - entryStockPrice) / entryStockPrice ≥ 0.05` |

### Layer 3: Gamma RSI Climax

| Attribute           | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| **Threshold**       | 15-minute option RSI ≥ 85                                   |
| **Check frequency** | Every 15 minutes                                            |
| **Grace period**    | 60 seconds (prevents double-fire)                           |
| **Purpose**         | Detects overbought premium climax → mean reversion imminent |

### Layer 4: RSI Trail Premium Stop (LONG & SHORT)

| Attribute          | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| **Activation**     | 5-min option RSI ≥ 85                                                  |
| **Floor**          | Entry candle LOW — ratchets up via `Math.max(floor, latestCandle.low)` |
| **Poll interval**  | Every 5 seconds (live premium check)                                   |
| **Exit trigger**   | Premium drops below floor price                                        |
| **Secondary exit** | 5-min option RSI drops below 75 on candle close                        |
| **Purpose**        | Captures climax profit, exits on first pullback                        |

### Layer 5: Supertrend Break

| Attribute           | Value                                                           |
| ------------------- | --------------------------------------------------------------- |
| **Trigger**         | LONG: close < Supertrend value. SHORT: close > Supertrend value |
| **Check frequency** | Every 5-min candle close                                        |
| **Purpose**         | Trend reversal detection                                        |

### Layer 6: RSI Quick Reversal (F7)

| Attribute      | Value                                                 |
| -------------- | ----------------------------------------------------- |
| **Window**     | First 2 candles after entry (10 minutes)              |
| **LONG exit**  | RSI drops below 62                                    |
| **SHORT exit** | RSI rises above 32                                    |
| **Purpose**    | Detects failed breakouts early — avoids 20% of losers |

### Layer 7: Stale Breakout

| Attribute   | Value                                                  |
| ----------- | ------------------------------------------------------ |
| **Trigger** | 3+ consecutive candles outside BB at current RSI level |
| **Max gap** | 6 minutes between candles                              |
| **Purpose** | Exit exhausted moves that lost momentum                |

### Layer 8: EOD Safety Exit

| Attribute    | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| **Time**     | 3:11 PM IST                                                  |
| **Purpose**  | Close all positions before broker auto-squareoff at ~3:25 PM |
| **Behavior** | Unconditional — overrides all other logic                    |

### Layer 9: Trailing Stop Loss

| Attribute   | Value                                                  |
| ----------- | ------------------------------------------------------ |
| **Method**  | Tracks highest premium (LONG) / lowest premium (SHORT) |
| **Trail %** | Dynamic based on strategy config (default ~12%)        |
| **Purpose** | Allows profit to run while protecting gains            |

### Layer 10: Extended Range Day Exit

| Attribute   | Value                                          |
| ----------- | ---------------------------------------------- |
| **Trigger** | Daily range exceeds 1.8 × ADR during session   |
| **Purpose** | Exit before extreme volatility causes whipsaws |

### Layer 11: Broker Auto-Squareoff Detection

| Attribute           | Value                                          |
| ------------------- | ---------------------------------------------- |
| **Check frequency** | Every 2 minutes                                |
| **Trigger**         | Position no longer exists at broker            |
| **Purpose**         | Reconciles if broker auto-squared the position |

### Layer 12: Extreme Intraday Range Kill-Switch

| Attribute   | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| **Trigger** | Nifty 50 session range exceeds 1.5%                               |
| **Purpose** | Market-wide panic detection — blocks new entries, may force exits |

---

## 9. Market Scanner — TMV Scoring Engine

`src/services/MarketScanner.ts` — **3,000+ lines**. Pure service (zero strategy knowledge).

### Scoring Pipeline

```
70+ Stocks in Universe
        │
        ▼
┌─ Step 1: Sector Filtering ─────────────────────────────┐
│  GREEN (>0.25%) │ RED (<-0.25%) │ FLAT (-0.25 to 0.25)│
│  All stocks pass, sector bonus varies                   │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Step 2: Tradeability Guards ──────────────────────────┐
│  ✗ Risk Distance > 1.5% of close → REJECT             │
│  ✗ BB Bandwidth > 3.5% of middle → REJECT             │
│  ✗ 1-Hour Supertrend misaligned → REJECT              │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Step 3: Base Score (Max 6.0) ─────────────────────────┐
│  Trend     (Max 3.0): EMA crossovers + VWAP position   │
│  Momentum  (Max 3.5): RSI sweet spot positioning        │
│  Volume    (Max 1.0): RVOL > 1.5 (+1.0)               │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Step 4: Bonus Scoring (if base ≥ 5.0) ───────────────┐
│  Sector        (Max 2.0): GREEN +1.0, FLAT +0.5       │
│  Smart Money   (Max 2.0): OI-based coiled spring       │
│  Fresh Breakout  (+1.5): First candle outside BB       │
│  RVOL Surge      (+2.0): Dynamic volume tier           │
│  Proximity       (+2.0): Close to band, approaching    │
│  RSI Acceleration(+1.5): RSI moving in bias direction  │
│  Squeeze         (+1.0): Tight BB width gradient       │
│  Gamma Wall      (+1.5): Options Greeks concentration  │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Step 5: Safety Filters ──────────────────────────────┐
│  Score ≥ 7.0 (minimum deployment threshold)            │
│  ATM option premium ≥ ₹40                              │
│  Not in 30-min cooldown, not traded today              │
└─────────────────────────────────────────────────────────┘
        │
        ▼
   Top 3 Stocks → Deploy to Slots
```

### Score Breakdown

| Component            | Max Score | LONG Criteria                                                                | SHORT Criteria                        |
| -------------------- | --------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| **Trend**            | 3.0       | Price > EMA8 (+1.0), EMA8 > EMA21, Price > EMA50 (+0.5), Price > VWAP (+1.5) | Inverse                               |
| **Momentum**         | 3.5       | RSI 60–75 "sweet spot" (+1.5), RSI 75–85 "extended" (+0.8)                   | RSI 25–40 (+1.5), RSI 15–25 (+0.8)    |
| **Volume**           | 1.0       | RVOL > 1.5 (+1.0), RVOL 1.2–1.5 (+0.5)                                       | Same                                  |
| **Sector**           | 2.0       | GREEN sector (+1.0), FLAT (+0.5), RED (0)                                    | Inverse                               |
| **Smart Money**      | 2.0       | ACCUMULATION or SHORT_COVERING aligned (+2.0)                                | DISTRIBUTION or LONG_UNWINDING (+2.0) |
| **Fresh Breakout**   | 1.5       | First candle outside BB                                                      | Same                                  |
| **RVOL Surge**       | 2.0       | Dynamic per volume tier                                                      | Same                                  |
| **Proximity**        | 2.0       | Close to band and approaching                                                | Same                                  |
| **RSI Acceleration** | 1.5       | RSI moving in bias direction                                                 | Same                                  |
| **Squeeze**          | 1.0       | Gradient based on BB width tightness                                         | Same                                  |
| **Gamma Wall**       | 1.5       | Option concentration + runway ratio                                          | Same                                  |

### Scan Schedule

Every 5 minutes from market open to close:

```
09:23, 09:28, 09:33, 09:38, 09:43, 09:48, 09:53, 09:58,
10:03, 10:08, ... (every 5 min) ..., 14:53, 14:58
```

**Last scan cutoff**: 14:58 — no scans after this to avoid late-day entries.

### Historical Data Caching

- Fetches 10 days of 5-minute candles for ALL universe stocks
- Batches: 2 stocks per second (Zerodha: 3 req/sec limit)
- Retries failed stocks after 5-second cooldown
- Abort threshold: if >20% stocks fail, scan aborted
- Cached in memory (`cachedHistoricalData` Map) for reuse across scan intervals

---

## 10. Position Recovery & Crash Resilience

### What happens when the bot crashes?

```
                    BOT CRASH
                        │
                        ▼
        Positions still open at broker
        Slot data persisted on disk
                        │
                        ▼
                   BOT RESTART
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
    restoreSlotStatesFromDisk()  initializeSession()
    (reads bollinger-slot*.json)  (loads encrypted token)
            │                       │
            ▼                       ▼
    Found active position?    Token valid?
    YES → Mark slot LOCKED    YES → Resume auth
            │                       │
            ▼                       ▼
    restoreLockedSlotStrategies()
            │
            ▼
    Create fresh strategy instance
    Load historical data
    Rebuild all monitoring loops:
      • Master cycle (5-min)
      • Emergency stop (30-sec)
      • Gamma RSI (15-min)
      • RSI Trail (if was active)
      • Reconciliation (2-min)
      • EOD timer
            │
            ▼
    POSITION FULLY MONITORED AGAIN
```

### Zombie Position Guard

On recovery, the bot validates that the broker still has the position:

- Fetches current positions from Zerodha API
- If position exists → resume monitoring
- If position gone → fetch exit order, record P&L, clear slot
- Prevents indefinite monitoring of positions the broker already squared off

### What survives across restarts

| Data                | Persistence | File                                       |
| ------------------- | ----------- | ------------------------------------------ |
| Active positions    | Per slot    | `src/data/bollinger-slot{1,2,3}.json`      |
| Capital per slot    | Per slot    | Same files                                 |
| Trade history       | Per slot    | Same files                                 |
| RSI Trail state     | Per slot    | Same files                                 |
| Auth session        | Encrypted   | `data/auth/session.json`                   |
| OI history          | Daily       | `data/oi-history.json`                     |
| Historical candles  | Cached      | `src/data/bollinger-historical-cache.json` |
| Instrument NFO list | Daily       | `data/cache/instruments-nfo-{date}.json`   |

---

## 11. Data Persistence & File Map

### Runtime Data Files

| File                                       | Purpose                           | Updated                  |
| ------------------------------------------ | --------------------------------- | ------------------------ |
| `src/data/bollinger-slot1.json`            | Slot 0: capital, trades, position | Every trade/state change |
| `src/data/bollinger-slot2.json`            | Slot 1: capital, trades, position | Every trade/state change |
| `src/data/bollinger-slot3.json`            | Slot 2: capital, trades, position | Every trade/state change |
| `src/data/bollinger-historical-cache.json` | Cached 5-min candle data          | Daily at ~3:25 PM        |
| `src/data/oi-history.json`                 | Yesterday's futures OI            | Daily at 3:40 PM         |
| `src/data/bollinger-trading-data.json`     | Aggregated trade stats            | On trade completion      |
| `src/data/trading-data.json`               | Legacy trade data                 | Deprecated               |
| `src/data/trade-drawdown-analysis.json`    | Drawdown analysis                 | Manual script output     |
| `data/auth/session.json`                   | Encrypted Zerodha token           | On auth + daily refresh  |
| `data/cache/instruments-nfo-{date}.json`   | NFO instruments (15MB+)           | Daily on first access    |
| `data/cache/nse-token-map.json`            | NSE token lookups                 | On generate-universe     |
| `data/strategy/strategy-state.json`        | Strategy state backup             | Periodic                 |

### Slot Data Schema

```json
{
  "capital": 72450,
  "tradeHistory": [
    {
      "tradeId": "BB_CHOLAFIN_1712044500000",
      "entryOrderId": "26040200012345",
      "exitOrderId": "26040200012399",
      "instrument": {
        "tradingsymbol": "CHOLAFIN26APR1700CE",
        "instrument_token": 12345678,
        "lot_size": 625
      },
      "direction": "LONG",
      "quantity": 625,
      "entryPrice": 63.85,
      "exitPrice": 86.75,
      "entryTime": "2026-04-02T07:35:00.000Z",
      "exitTime": "2026-04-02T08:50:00.000Z",
      "pnl": 14312.5,
      "exitReason": "MANUAL_EXIT",
      "status": "CLOSED",
      "strategy": "BOLLINGER_BAND"
    }
  ],
  "activePosition": null,
  "rsiTrailState": null,
  "lastUpdated": "2026-04-02T10:00:00.000Z"
}
```

---

## 12. Dashboard & API Endpoints

### Dashboard (`GET /`)

HTML dashboard served from Express with real-time data:

- **Strategy Status**: All 3 slots with stock name, bias, entry/exit status
- **Aggregate Metrics**: Total P&L, Win Rate, ROI, Profit Factor, Risk-Reward Ratio
- **Active Positions**: Current position details, unrealized P&L
- **Entry Condition Analysis**: LONG/SHORT strength indicators per slot
- **Scanner Results**: Latest TMV scores with retain/swap decisions
- **Sector Performance**: Breakdown of GREEN/RED/FLAT sectors

**Performance calculations:**

```
Total P&L     = Σ(trade.pnl) across all slots
Win Rate      = (wins / closedTrades) × 100
Profit Factor = Σ(winning trades) / Σ(losing trades)
ROI           = ((currentCapital - initialCapital) / initialCapital) × 100
Risk-Reward   = avgWin / avgLoss
```

### API Routes

| Method | Path                       | Description                        |
| ------ | -------------------------- | ---------------------------------- |
| `GET`  | `/`                        | HTML dashboard                     |
| `GET`  | `/health`                  | Health check (timestamp + OK)      |
| `GET`  | `/auth/status`             | Auth status (5-min cache)          |
| `GET`  | `/auth/login`              | Redirect to Zerodha OAuth          |
| `GET`  | `/auth/callback`           | OAuth callback handler             |
| `POST` | `/auth/logout`             | Invalidate session                 |
| `GET`  | `/auth/session-info`       | Session metadata for debugging     |
| `GET`  | `/api/quote-manager/stats` | QuoteManager subscriber stats      |
| `GET`  | `/api/slots`               | Slot states (from StrategyManager) |

---

## 13. Monitoring & Health Checks

### Health Monitoring Loop (every 30 seconds)

- Checks all registered strategy instances
- Tracks cumulative error counts
- Restarts crashed strategies
- Updates health status: `healthy` | `warning` | `error` | `stopped`

### StateLock (`src/utils/StateLock.ts`)

Prevents race conditions in concurrent trading operations:

```typescript
// Example: Prevents two exit triggers from executing simultaneously
await globalStateLock.executeAtomic("exit-position", async () => {
  // Only one exit can run at a time per position
  await executeExit();
});
```

- Queue-based with 30-second timeout
- `acquire(key, timeoutMs)` → Returns release function
- `executeAtomic(key, operation)` → Acquires, executes, releases
- Singleton export: `globalStateLock`

### Logging (`src/utils/Logger.ts`)

Winston-based with file rotation:

| Transport | File               | Max Size | Max Files | Level            |
| --------- | ------------------ | -------- | --------- | ---------------- |
| Console   | —                  | —        | —         | INFO (colorized) |
| Combined  | `logs/trading.log` | 5 MB     | 5 files   | INFO             |
| Errors    | `logs/error.log`   | —        | —         | ERROR only       |

Format: `YYYY-MM-DD HH:mm:ss [LEVEL]: MESSAGE`

---

## 14. Scripts & Tooling

| Script                        | Command                                   | Purpose                                                     |
| ----------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `generate-universe.ts`        | `npm run generate-universe`               | Regenerates `src/config/universe.ts` from CSV + API data    |
| `create-instruments-cache.ts` | `npm run update-data`                     | Pre-caches NFO instruments for faster startup               |
| `validate-universe.ts`        | `ts-node scripts/validate-universe.ts`    | QC checks on universe (duplicates, missing symbols, tokens) |
| `test-get-instruments.ts`     | `ts-node scripts/test-get-instruments.ts` | Tests session + instrument fetching                         |
| `factor-analysis.js`          | `node scripts/factor-analysis.js`         | Analyzes exit factor effectiveness                          |
| `analyze-coforge-trade.js`    | `node scripts/analyze-coforge-trade.js`   | Post-trade analysis with real candle data                   |
| `backtest-long-rsi-trail.js`  | `node scripts/backtest-long-rsi-trail.js` | Backtests RSI trail thresholds (83/84/85)                   |
| `market-regime-analysis.js`   | `node scripts/market-regime-analysis.js`  | Studies volatility regimes and ADR patterns                 |
| `score-analysis.js`           | `node scripts/score-analysis.js`          | TMV scoring statistical analysis                            |
| `time-analysis.js`            | `node scripts/time-analysis.js`           | Entry/exit time distribution analysis                       |
| `qc-f7-implementation.js`     | `node scripts/qc-f7-implementation.js`    | QC for RSI Quick Reversal (F7)                              |
| `qc-f8-implementation.js`     | `node scripts/qc-f8-implementation.js`    | QC for 1-Hour Supertrend (F8)                               |

### npm Scripts

```json
{
  "start": "node dist/index.js", // Production
  "dev": "ts-node src/index.ts", // Development
  "build": "tsc", // Compile TypeScript
  "watch": "tsc -w", // Watch mode compile
  "generate-universe": "ts-node scripts/generate-universe.ts",
  "update-data": "ts-node scripts/create-instruments-cache.ts",
  "test": "jest", // Run tests
  "test:watch": "jest --watch" // Watch mode tests
}
```

---

## 15. Test Suite

### Framework: Jest + ts-jest

Configuration in `jest.config.js`:

```javascript
{
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  verbose: true,
  testTimeout: 10000
}
```

### Test Files

**`tests/services/MarketScanner.test.ts`**

- Unit tests for TMV scoring logic
- Mocks: KiteConnect, Logger, InstrumentCache
- Tests: Sector analysis, symbol extraction regex (e.g., `extractStockSymbol("M&M26FEB2500CE")` → `"M&M"`)

**`tests/services/QuoteManager.test.ts`**

- Unit tests for Publisher-Subscriber pattern
- Mocks: KiteConnect
- Tests: Subscription lifecycle, auto-start/stop polling, multiple subscribers per symbol

---

## 16. Configuration Reference

### `config/strategies.json`

```json
{
  "templates": {
    "bollinger-stock-template": {
      "name": "Bollinger Band Stock Template",
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
  },
  "strategies": [
    {
      "id": "bollinger-band-01",
      "name": "5m option Buy: bollinger band entry and trail",
      "enabled": false,
      "description": "Manual NIFTY strategy (disabled in scanner mode)",
      "timeframe": "5min",
      "instruments": ["NIFTY", "BANKNIFTY"],
      "riskPerTrade": 0.8,
      "maxPositions": 2,
      "config": {
        "period": 20,
        "stdDev": 2.0,
        "riskReward": { "stopLoss": 2.0, "target": 4.0 },
        "positionSizing": { "riskAmount": 10000, "riskPercentage": 2.0 },
        "capitalAllocation": 200000
      }
    }
  ],
  "global": {
    "autoStart": false,
    "scannerMode": true,
    "healthCheckInterval": 30000,
    "logging": { "level": "info", "separateFiles": true },
    "riskManagement": {
      "maxDailyLoss": 50000,
      "maxDrawdown": 100000,
      "emergencyStop": true
    }
  }
}
```

### `src/config/universe.ts`

Auto-generated file containing 70+ stocks across 11+ sectors:

```typescript
export interface UniverseStock {
  symbol: string;           // "HDFCBANK"
  instrumentToken: number;  // 341249
  sector: string;           // "NIFTY BANK"
  sectorToken: number;      // 260105
  lotSize: number;          // 550
}

export const UNIVERSE: UniverseStock[] = [ ... ];
```

**Sectors covered**: NIFTY BANK, NIFTY IT, NIFTY AUTO, NIFTY METAL, NIFTY ENERGY, NIFTY PHARMA, NIFTY FIN SERVICE, NIFTY INFRA, NIFTY CONSUMER DURABLES, NIFTY REALTY, NIFTY HEALTHCARE, NIFTY MEDIA, NIFTY PSU BANK.

### `src/config/sectorTokens.ts`

Maps sector names to Zerodha instrument tokens:

```typescript
export const SECTOR_TOKENS: Record<string, number> = {
  "NIFTY 50": 256265,
  "NIFTY BANK": 260105,
  "NIFTY IT": 259849,
  // ... 14 sectors total
};
```

### TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

---

## 17. Environment Variables

Required in `.env` (root directory, not in Git):

| Variable             | Example                | Purpose                              |
| -------------------- | ---------------------- | ------------------------------------ |
| `ZERODHA_API_KEY`    | `q4aaem75hl0solt9`     | Zerodha API key                      |
| `ZERODHA_API_SECRET` | `(secret)`             | Zerodha API secret                   |
| `PORT`               | `3001`                 | Express server port                  |
| `BASE_PATH`          | `/tradebot-multistock` | URL prefix for nginx proxy           |
| `NODE_ENV`           | `production`           | Environment mode                     |
| `LOG_LEVEL`          | `info`                 | Winston log level                    |
| `TZ`                 | `Asia/Kolkata`         | Timezone (critical for market hours) |

---

## 18. Complete Lifecycle — Startup to Trade to Shutdown

### Phase 1: Server Startup

```
1. Express server starts on port 3001
2. TradingBot constructor initializes:
   ├── KiteConnect client (15s timeout)
   ├── AuthService → loads encrypted session → validates token
   ├── QuoteManager singleton
   ├── StrategyManager initialization:
   │   ├── Register BollingerBandStrategy class
   │   ├── restoreSlotStatesFromDisk() → detect active positions
   │   ├── restoreLockedSlotStrategies() → rebuild monitoring
   │   ├── Load strategies from config/strategies.json
   │   ├── Start health monitoring (30s loop)
   │   ├── Schedule pre-market check (8:50 AM)
   │   ├── Schedule scanner (every 5 min, 09:23–14:58)
   │   └── Initialize OIHistoryService
   └── Mount Express routes + dashboard
```

### Phase 2: Authentication

```
First time (no session):
  User → /auth/login → Zerodha OAuth → /auth/callback
  → generateSession() → saveSession() (encrypted)
  → initializePendingStrategies() → redirect to dashboard

Subsequent starts:
  Bot loads encrypted session from disk
  → validateToken() → if valid, resume immediately
  → if expired (past 6 AM next day), prompt re-login
```

### Phase 3: Pre-Market (8:50 AM)

```
1. Check if instrument cache needs refresh
2. MarketScanner caches 10 days of 5-min data for all 70+ stocks
3. Batch fetching: 2 stocks/sec with retry logic
4. >20% failure → abort (insufficient data)
```

### Phase 4: Scanner Cycle (09:23 – 14:58, every 5 min)

```
1. MarketScanner.scanUniverse()
   ├── Fetch sector index quotes
   ├── For each stock: Calculate TMV score
   │   ├── Tradeability guards (risk distance, bandwidth, 1h ST)
   │   ├── Base score (trend + momentum + volume)
   │   ├── Bonus scoring (if base ≥ 5.0)
   │   └── Safety filters (min score 7.0, min premium ₹40)
   └── Return top 3 stocks

2. Smart Retention decisions per slot:
   ├── LOCK: Has position → skip
   ├── KEEP: Stock still top-3 and score ≥ 6.0
   ├── SWAP: Stock fell off → stop old, deploy new
   └── DEPLOY: Empty slot → deploy ranked stock
```

### Phase 5: Trading Cycle (5-minute aligned, per slot)

```
Every 5 minutes (with slot stagger offset):
1. Fetch latest completed 5-min candle
2. Update indicators: BB, RSI, Supertrend, Pivots
3. If NO position:
   │  Check LONG entry conditions → if ALL true → executeLongEntry()
   │  Check SHORT entry conditions → if ALL true → executeShortEntry()
   │
4. If HAS position:
   │  Check all 12 exit layers (priority order)
   │  First trigger wins → executeExit()
   │  Record P&L, update capital, save to disk
   │
5. Update dashboard metrics
```

### Phase 6: Position Monitoring (when active)

```
Concurrent monitoring loops:
├── Master cycle: 5-min candle-based checks (BB, RSI, ST, staleness)
├── Emergency stop: 30-sec check (5% underlying threshold)
├── Gamma RSI: 15-min check (option RSI ≥ 85 climax)
├── RSI Trail: 5-sec polling when activated (premium floor)
├── Reconciliation: 2-min broker position verification
└── EOD timer: Fires at 3:11 PM IST (unconditional exit)
```

### Phase 7: End of Day (3:06 PM – 3:41 PM)

```
3:06 PM  → Block new entries and clear pending pullback/FVG states
3:11 PM  → EOD safety exit: Force-close all positions
3:15 PM  → Stop continuous underlying candle ingestion; CAS begins
3:40 PM  → Derivatives continuous trading closes
3:41 PM  → Clear scanner cache and reset slot state for next session
```

### Phase 8: Overnight

```
Bot remains running (PM2 autorestart if needed)
Session token valid until 6 AM next day
All state persisted to disk
Next morning: cycle repeats from Phase 3
```

---

## Appendix A: Dependencies

| Package       | Version | Purpose                 |
| ------------- | ------- | ----------------------- |
| `kiteconnect` | ^5.1.0  | Zerodha broker API      |
| `express`     | ^4.18.2 | HTTP server             |
| `dotenv`      | ^16.3.1 | Environment variables   |
| `winston`     | ^3.11.0 | Structured logging      |
| `axios`       | ^1.13.2 | HTTP client             |
| `csv-parser`  | ^3.2.0  | CSV parsing             |
| `typescript`  | ^5.2.2  | Language compiler       |
| `ts-node`     | ^10.9.1 | Dev-time TS execution   |
| `jest`        | ^30.2.0 | Test framework          |
| `ts-jest`     | ^29.4.6 | Jest TypeScript support |

## Appendix B: Zerodha API Rate Limits

| Limit                  | Value     | Bot Compliance             |
| ---------------------- | --------- | -------------------------- |
| Requests per second    | 3         | Batch fetching at 2/sec    |
| Symbols per quote call | 500       | QuoteManager batches at 40 |
| Historical data        | 3 req/sec | 2 stocks/sec with 1s delay |
| Order placement        | 10/sec    | Single orders only         |

## Appendix C: Key Formulas

**Bollinger Bands:**
$$\text{Upper} = \text{SMA}(20) + 2\sigma, \quad \text{Lower} = \text{SMA}(20) - 2\sigma$$

**RSI (Wilder's):**
$$\text{RSI} = 100 - \frac{100}{1 + \frac{\text{AvgGain}}{\text{AvgLoss}}}$$

**Supertrend:**
$$\text{Upper Band} = \frac{\text{High} + \text{Low}}{2} + (2.0 \times \text{ATR}(10))$$
$$\text{Lower Band} = \frac{\text{High} + \text{Low}}{2} - (2.0 \times \text{ATR}(10))$$

**ATR:**
$$\text{TR} = \max(\text{High} - \text{Low}, |\text{High} - \text{PrevClose}|, |\text{Low} - \text{PrevClose}|)$$
$$\text{ATR}(n) = \frac{1}{n}\sum_{i=1}^{n} \text{TR}_i$$

**Pivots:**
$$\text{PP} = \frac{H + L + C}{3}, \quad R_1 = 2\text{PP} - L, \quad S_1 = 2\text{PP} - H$$

**ADR:**
$$\text{ADR} = \frac{1}{5}\sum_{i=1}^{5}(H_i - L_i)$$

**P&L:**
$$\text{P\&L}_{\text{LONG}} = (\text{exitPrice} - \text{entryPrice}) \times \text{quantity}$$
$$\text{P\&L}_{\text{SHORT}} = (\text{entryPrice} - \text{exitPrice}) \times \text{quantity}$$

---

_This document is the single source of truth for the trading bot architecture. Update it when making significant changes to the codebase._
