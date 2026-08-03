# Codebase Documentation: Professional Trading Bot Architecture

**Date**: January 25, 2026  
**Project**: Zerodha Bollinger Band Multi-Stock Trading Bot  
**Stack**: Node.js + TypeScript + Express + KiteConnect API

---

## 🏗️ Architecture Overview

This is a **professional-grade Node.js/TypeScript trading bot** built for **Zerodha's KiteConnect API** with a **modular strategy system**. The architecture follows **clean design principles** with clear separation of concerns, implementing the Strategy Pattern for extensible trading logic.

**Key Design Principles:**

- Strategy Pattern for pluggable trading algorithms
- Factory Pattern for strategy instantiation
- Clean Architecture with separated concerns
- Type-safe implementation throughout
- Production-ready error handling and recovery

---

## 📐 Core Architecture Components

### 1. Strategy Pattern Implementation

#### **StrategyBase.ts** - Abstract Base Class

**Location**: `src/core/StrategyBase.ts`

**Purpose**: Defines the contract that all trading strategies must implement.

**Key Methods:**

```typescript
abstract initialize(): Promise<void>;     // Setup phase
abstract start(): Promise<void>;          // Begin trading
abstract stop(): Promise<void>;           // Stop trading
abstract getStatus(): StrategyStatus;     // Get current state
abstract processMarketData(data: any): Promise<void>;  // Handle market updates
```

**Shared Functionality:**

- Metrics tracking (`totalTrades`, `profitLoss`, `winRate`, `healthStatus`)
- Logging utilities (`logStrategyEvent()`)
- Configuration management (`getConfig()`, `getMetrics()`)
- Health status management (`setHealthStatus()`)

**Interfaces:**

```typescript
interface StrategyConfig {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  timeframe: string;
  instruments: string[];
  riskPerTrade: number;
  maxPositions: number;
  [key: string]: any; // Strategy-specific config
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

---

#### **StrategyRegistry.ts** - Factory & Instance Manager

**Location**: `src/core/StrategyRegistry.ts`

**Purpose**: Central registry for strategy classes and their instances.

**Key Features:**

1. **Strategy Registration**: Register strategy classes before instantiation
2. **Instance Creation**: Factory method with validation
3. **Deferred Initialization**: Handles pre-authentication strategy creation
4. **Lifecycle Management**: Track and cleanup strategy instances

**Critical Methods:**

```typescript
registerStrategy(id: string, strategyClass: StrategyConstructor): void
createInstance(id: string, kiteConnect: any, logger: Logger, config: StrategyConfig): Promise<StrategyBase>
getInstance(id: string): StrategyBase | undefined
initializePendingStrategies(): Promise<void>  // Called after authentication
removeInstance(id: string): Promise<boolean>
```

**Authentication Flow:**

```
Bot Start → Create Strategy Instances → Wait for Auth → Initialize Strategies → Start Trading
```

---

#### **StrategyManager.ts** - Central Orchestrator

**Location**: `src/core/StrategyManager.ts` (391 lines)

**Purpose**: Manages the entire strategy ecosystem.

**Responsibilities:**

1. Load strategy configurations from `config/strategies.json`
2. Register all available strategy classes
3. Create strategy instances from configurations
4. Control strategy lifecycle (start/stop individual or all)
5. Aggregate global metrics across all strategies
6. Health monitoring and reporting

**Key Methods:**

```typescript
initialize(): Promise<void>                          // Setup system
startStrategy(strategyId: string): Promise<boolean>  // Start specific strategy
stopStrategy(strategyId: string): Promise<boolean>   // Stop specific strategy
startAllStrategies(): Promise<void>                  // Start all enabled
stopAllStrategies(): Promise<void>                   // Emergency stop all
getStrategyStatus(strategyId: string): StrategyStatus | null
getAllStrategyStatuses(): Map<string, StrategyStatus>
getGlobalMetrics(): GlobalMetrics                    // System-wide stats
```

**Global Metrics:**

```typescript
interface GlobalMetrics {
  totalStrategies: number;
  activeStrategies: number;
  totalProfitLoss: number;
  totalTrades: number;
  systemHealth: "healthy" | "warning" | "error";
}
```

---

### 2. Authentication & Session Management

#### **AuthService.ts** - Zerodha OAuth Handler

**Location**: `src/services/AuthService.ts` (400 lines)

**Purpose**: Manages Zerodha authentication and session lifecycle.

**OAuth Flow:**

```
1. getLoginUrl() → Redirect user to Zerodha login
2. User authenticates on Zerodha
3. Callback with request_token
4. generateSession(requestToken) → Get access_token
5. setAccessToken() → Enable API calls
6. Persist session for future use
```

**Key Features:**

1. **Session Restoration**: Auto-restore on bot restart
2. **Token Validation**: Test token with `getProfile()` API call
3. **Session Persistence**: Save/load encrypted sessions
4. **Initialization Promise**: Async startup with session restore

**Critical Methods:**

```typescript
getLoginUrl(): string                                    // Zerodha login URL
generateSession(requestToken: string): Promise<SessionData>
isAuthenticated(): boolean                               // Quick check
isAuthenticatedAndValid(): Promise<boolean>             // Validate with API
invalidateSession(): Promise<void>                       // Logout
getSessionInfo(): Promise<SessionInfo>                   // Debug info
```

**Session Data Structure:**

```typescript
interface SessionData {
  user_type: string;
  email: string;
  user_name: string;
  user_id: string;
  api_key: string;
  access_token: string;
  public_token: string;
  refresh_token: string;
  login_time: string;
  exchanges: string[];
  products: string[];
  order_types: string[];
}
```

---

#### **SessionPersistence.ts** - Encrypted Storage

**Location**: `src/services/SessionPersistence.ts` (300 lines)

**Purpose**: Secure session storage with encryption.

**Security Features:**

1. **AES-256-CBC Encryption**: Military-grade encryption
2. **Key Derivation**: Uses API credentials + salt for consistent key
3. **Secure Permissions**: Files set to 0o600 (owner read/write only)
4. **Expiry Management**: Auto-expires at 6 AM (Zerodha token expiry)

**Encryption Process:**

```typescript
API_KEY + API_SECRET + "trading_bot_session_key"
  → SHA-256 Hash
  → 32-byte Key
  → AES-256-CBC Encryption
```

**File Format:**

```typescript
interface EncryptedSessionFile {
  data: string; // Encrypted session JSON
  iv: string; // Initialization vector (hex)
  timestamp: string; // Creation time
}
```

**Persisted Session:**

```typescript
interface PersistedSession {
  accessToken: string;
  sessionData: SessionData;
  expiryTime: Date; // 6 AM next day
  createdAt: Date;
  lastValidated: Date;
}
```

**Key Methods:**

```typescript
saveSession(accessToken: string, sessionData: SessionData): Promise<void>
loadSession(): Promise<PersistedSession | null>
clearSession(): Promise<void>
hasValidSession(): Promise<boolean>
```

**Session Lifecycle:**

```
Login → Save Encrypted → Store to data/auth/session.json
Bot Restart → Load Session → Decrypt → Validate Token → Resume Trading
6 AM Next Day → Token Expires → Require Re-login
```

---

### 3. Trading Strategy Implementation

#### **BollingerBandStrategy.ts** - Production Trading Logic

**Location**: `src/strategies/bollinger-band/BollingerBandStrategy.ts` (3,895 lines)

**Purpose**: Complete Bollinger Band strategy with options trading, position management, and comprehensive safety systems.

---

#### Strategy Overview

**Trading Instrument**: NIFTY50 Index Options (CE/PE)  
**Timeframe**: 5-minute candles  
**Capital Allocation**: ₹2,00,000 (separate from other strategies)  
**Product Type**: MIS (Intraday)  
**Lot Sizing**: Dynamic - 1 lot per ₹40,000 capital (minimum 1 lot)

---

#### Technical Indicators

**1. RSI (Relative Strength Index)**

- **Period**: 10
- **Formula**: TradingView RMA (Running Moving Average)

```typescript
RSI = 100 - (100 / (1 + RS))
RS = Average Gain / Average Loss (using RMA smoothing)
```

- **Implementation**: `calculateRSI(candles: Candle[], period: number): number`

**2. Bollinger Bands**

- **Period**: 20
- **Standard Deviation**: 2.0

```typescript
Middle Band = SMA(close, 20)
Upper Band = Middle Band + (2 × StdDev)
Lower Band = Middle Band - (2 × StdDev)
```

- **Implementation**: `calculateBollingerBands(candles, period, stdDevMultiplier): BollingerBands`

**3. Supertrend**

- **Period**: 10
- **Multiplier**: 2
- **Formula**: TradingView-compatible algorithm

```typescript
ATR = RMA of True Range over 10 periods
Basic Upper Band = HL2 + (2 × ATR)
Basic Lower Band = HL2 - (2 × ATR)
Final Bands = Adjusted based on previous values and price action
Trend = UP if Close > Final Upper Band, DOWN otherwise
```

- **Implementation**: `calculateSupertrend(candles, period, multiplier): Supertrend`

**4. Daily Pivot Points**

- **Source**: Previous trading day OHLC

```typescript
PP = (High + Low + Close) / 3
R1 = (2 × PP) - Low,  S1 = (2 × PP) - High
R2 = PP + (High - Low),  S2 = PP - (High - Low)
R3 = High + 2 × (PP - Low),  S3 = Low - 2 × (High - PP)
```

- **Implementation**: `calculateDailyPivots(previousDayOHLC): PivotLevels`

---

#### Entry Signals

**LONG Entry (CE Options):**

```typescript
✅ Price > Upper Bollinger Band
✅ RSI between 68-85 (overbought momentum)
✅ Supertrend = UP
✅ Price > R1 OR Price > R2
✅ Candle is Bullish (Close >= Open)
```

**SHORT Entry (PE Options):**

```typescript
✅ Price < Lower Bollinger Band
✅ RSI between 10-30 (oversold momentum)
✅ Supertrend = DOWN
✅ Price <= PP (Pivot Point)
✅ Candle is Bearish (Close <= Open)
```

**Entry Restrictions:**

- Market hours only: 9:15 AM - 3:30 PM
- First candle exception: 9:15-9:25 bypasses bullish/bearish check
- SHORT blocked after 2:55 PM on non-Friday days

---

#### Exit Logic

**LONG Position Exit (CE Options):**

1. **Entry Candle Low Breach** (5-minute candle close check)
   - Exits if NIFTY50 spot closes below entry candle's low
   - Checked at 5-minute candle completion
   - Prevents further downside after entry

2. **12% Trailing Stop Loss** (Real-time polling - every 1 second)
   - Tracks highest premium achieved
   - Stop loss = Highest Premium × 0.88 (12% below peak)
   - Exits when current premium ≤ trailing SL
   - Locks in profits as premium rises

**SHORT Position Exit (PE Options):**

1. **12% Trailing Stop Loss** (Real-time polling - every 1 second)
   - Tracks highest premium achieved
   - Stop loss = Highest Premium × 0.88 (12% below peak)
   - Exits when current premium ≤ trailing SL

2. **Time-Decay Safety** (Real-time polling)
   - Exits if no new high for 15 minutes
   - Prevents holding depreciating options

**Common Exit Triggers:**

- EOD Safety Exit: 3:28 PM automatic exit
- Position Reconciliation: Auto-exit if broker squareoff detected
- Manual Clear: Dashboard button to force exit

---

#### Option Selection Logic

**Real-time Selection** (at signal time, not predictive):

1. **Target Premium Calculation:**
   - LONG: 1% of NIFTY50 spot price
   - SHORT: 1% of NIFTY50 spot price

2. **Strike Range:**
   - Find ATM (At-The-Money) strike
   - Select ATM ± 25 strikes (51 total options)

3. **Premium Matching:**
   - Fetch live quotes for all 51 options
   - Find option with premium closest to target
   - Select CE for LONG, PE for SHORT

4. **Expiry:**
   - Always uses next Tuesday expiry
   - Weekly options for liquidity

**Example:**

```
NIFTY Spot = 25,200
Target Premium = 252 (1% of 25,200)
ATM Strike = 25,200
Range = 24,575 to 25,825 (±25 strikes of 25 each)
Selected: NIFTY25JAN2625200CE @ ₹255 (closest to ₹252 target)
```

---

#### Position Management

**Dynamic Lot Sizing:**

```typescript
Lots = floor(Current Capital / 40,000)
Minimum = 1 lot
Example: ₹2,00,000 capital = 5 lots
```

**Position Structure:**

```typescript
interface Position {
  type: "LONG" | "SHORT";
  instrument: any; // Option details (tradingsymbol, lot_size, strike, etc.)
  entryPrice: number; // Premium at entry
  quantity: number; // Number of lots
  entryTime: Date;
  entryCandleTimestamp: Date;
  entryCandleLow: number; // For LONG exit check
  entryCandleHigh: number;
  trailingSL: number; // Current trailing stop loss level
  highestPremium: number; // Peak premium achieved
  entryOrderId: string; // Broker order ID
  exitOrderId?: string;
  timeDecayTrailing?: {
    // For SHORT positions
    lastHighTime: Date;
  };
}
```

**Position Persistence:**

- Saved to `src/data/bollinger-trading-data.json` after every change
- Includes active position, capital, and trade history
- Auto-recovers position on bot restart
- Critical for handling unexpected shutdowns

---

#### Capital Management

**Initial Capital**: ₹2,00,000 (separate pool per strategy)

**P&L Calculation:**

```typescript
// Options are always BUY (CE or PE)
// P&L = (Exit Price - Entry Price) × Total Quantity
Total Quantity = Lots × Lot Size
Example: 5 lots × 65 shares/lot = 325 shares
Exit ₹260, Entry ₹250 = ₹10 profit per share
Total P&L = ₹10 × 325 = ₹3,250
```

**Capital Updates:**

```typescript
New Capital = Previous Capital + Trade P&L
Example: ₹2,00,000 + ₹3,250 = ₹2,03,250
Next trade lots = floor(203,250 / 40,000) = 5 lots
```

**Trade History:**

```typescript
interface TradeRecord {
  tradeId: string;
  entryOrderId: string;
  exitOrderId: string;
  instrument: any;
  direction: "LONG" | "SHORT";
  quantity: number; // Total shares
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
  pnl: number;
  exitReason: string; // "12% Trailing SL", "Entry Candle Low", etc.
  status: "CLOSED";
  strategy: "BOLLINGER_BAND";
}
```

**Statistics Tracking:**

```typescript
- Total Trades
- Win Rate (%)
- Average Win / Average Loss
- Profit Factor
- Total P&L
- ROI (Return on Investment)
- Current Capital
- Capital Change (%)
```

---

#### Real-time Monitoring Systems

**1. Master Cycle** (5-minute candle fetching)

**Purpose**: Fetch completed candles at precise intervals aligned to market timing

**Timing:**

- Triggers at X:X0:05, X:X5:05, X:X0:10, etc. (5 seconds after candle close)
- Accounts for API latency and data availability
- Uses `setInterval` with 5-minute intervals (300,000ms)

**Process:**

```
09:20:05 → Fetch 09:15-09:20 candle → Update indicators → Check signals
09:25:05 → Fetch 09:20-09:25 candle → Update indicators → Check signals
... continues every 5 minutes
```

**Candle Validation:**

- Checks candle age (warns if >6 minutes old)
- Duplicate prevention (timestamp + OHLC comparison)
- Race condition protection (`isFetchingCandle` flag)
- Timeout protection (45-second max per fetch)

**Implementation**: `startMasterCycle()`, `fetchLatest5MinuteCandle()`

---

**2. Position Monitoring** (1-second polling)

**Purpose**: Real-time premium tracking for trailing stop loss

**Method**: REST API polling (pure HTTP, no WebSocket)

**Polling Frequency:**

- 1 second intervals during active position
- Recursive `setTimeout` (not `setInterval`) to prevent overlap
- Backoff to 5 seconds if consecutive failures (≥5)

**Monitored Metrics:**

```typescript
- Current Option Premium
- Unrealized P&L
- Highest Premium Achieved
- Trailing Stop Loss Level
- Minutes Since Entry
- Minutes Since Last High
```

**Exit Checks:**

- LONG: 12% trailing SL breach
- SHORT: 12% trailing SL + time-decay (15 min)

**Race Condition Protection:**

```typescript
isPollingInProgress: boolean; // Prevent overlapping polls
lastPollingTime: Date; // Track timing
consecutivePollingFailures: number; // Circuit breaker
```

**Implementation**: `startPollingBasedMonitoring()`, `checkShortExitUnified()`, `checkLongExitSimple()`

---

**3. Position Reconciliation** (5-minute intervals)

**Purpose**: Detect broker auto-squareoffs or manual exits

**Process:**

```
1. Fetch current positions from broker API
2. Check if bot's position exists in broker's net positions
3. If mismatch detected:
   - Log discrepancy
   - Fetch exit order details from broker
   - Calculate P&L from exit order
   - Update capital and trade history
   - Clear bot's position state
```

**Detects:**

- Broker MIS auto-squareoff (3:30 PM)
- Manual exits via Zerodha Kite app
- Connection-loss scenarios where exit succeeded but bot didn't know

**Implementation**: `reconcilePositions()`, `clearActivePosition()`

---

**4. EOD Safety Exit** (scheduled 3:28 PM)

**Purpose**: Exit position before broker's 3:30 PM MIS squareoff

**Scheduling:**

```typescript
Current Time < 3:28 PM → Schedule timer for 3:28 PM
3:28 PM → Force close position with market order
3:28 PM+ → No schedule (market closing soon)
```

**Reason**: Avoid broker's potentially unfavorable auto-squareoff price

**Implementation**: `scheduleEODExit()`, `forceClosePosition()`

---

#### Error Recovery & Resilience

**1. System Sleep Detection**

**Problem**: Laptop sleep/hibernate disrupts `setInterval` timing

**Solution**: Track last operation times and detect abnormal gaps

**Master Cycle Disruption:**

```typescript
Expected: 5 minutes between candle fetches
Threshold: 6 minutes (20% tolerance)
If Gap > Threshold:
  - Log warning with gap duration
  - Realign to next 5-minute boundary
  - Reset interval with correct timing
```

**Position Monitoring Disruption:**

```typescript
Expected: <2 seconds between polls
Threshold: 10 seconds
If Gap > Threshold:
  - CRITICAL warning (stop loss may be breached)
  - Force immediate position check
  - Log potential loss exposure
  - Update health status to 'warning'
```

**Reconciliation Disruption:**

```typescript
Expected: 5 minutes between checks
Threshold: 10 minutes
If Gap > Threshold:
  - Execute immediate reconciliation
  - Check for broker changes during gap
```

**Implementation**: `detectMasterCycleDisruption()`, `detectPositionMonitoringDisruption()`, `detectReconciliationDisruption()`

---

**2. Retry Mechanisms**

**Candle Fetch Retry:**

- Continuous retry every 10 seconds until successful
- Critical for trend-following (can't afford to miss signals)
- Auto-stops when successful

**Trade Entry Retry:**

- 3 attempts with exponential backoff: 1s, 2s, 5s
- Prevents missed trade opportunities
- Logs all attempts and failures

**Generic Retry Infrastructure:**

```typescript
retryOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number,
  delays: number[]
): Promise<T>
```

**Implementation**: `fetchLatest5MinuteCandleWithRetry()`, `executeLongEntryWithRetry()`, `executeShortEntryWithRetry()`

---

**3. Race Condition Protection**

**Purpose**: Prevent duplicate orders or concurrent exit attempts

**Protected Operations:**

```typescript
isExecutingLongEntry: boolean; // LONG entry guard
isExecutingShortEntry: boolean; // SHORT entry guard
isProcessingLongExit: boolean; // LONG exit guard
isProcessingShortExit: boolean; // SHORT exit guard
isClearingPosition: boolean; // Manual clear guard
isPollingInProgress: boolean; // Polling guard
isFetchingCandle: boolean; // Candle fetch guard
```

**Pattern:**

```typescript
if (guardFlag) {
  log("Operation already in progress, skipping");
  return;
}

guardFlag = true;
try {
  // ... critical operation
} finally {
  guardFlag = false; // Always reset
}
```

---

**4. Health Monitoring**

**Tracked Metrics:**

```typescript
interface HealthStatus {
  dataStreamHealthy: boolean; // Candle fetching OK
  executionHealthy: boolean; // Order placement OK
  lastHeartbeat: Date; // Last successful operation
  consecutiveErrors: number; // Error streak
  criticalErrorsToday: number; // Daily critical errors
}
```

**Error Tracking:**

```typescript
errorCounts: Map<string, number>; // Counts by error type
lastErrorTime: Map<string, Date>; // Timestamps by error type
```

**Health Checks:**

- Every 5 minutes: Log health report
- Alert if ≥5 consecutive errors
- Reset counters at 9:15 AM daily

**Implementation**: `trackError()`, `resetErrorCount()`, `getHealthReport()`, `startHealthMonitoring()`

---

**5. Historical Data Caching**

**Purpose**: Allow pre-market startup (before 9:15 AM)

**Cache File**: `src/data/bollinger-historical-cache.json`

**Cache Contents:**

```typescript
{
  timestamp: string;        // Cache creation time
  candles: Candle[];        // Last fetched 5-min candles
  symbol: 'NIFTY50';
  timeframe: '5min';
}
```

**Refresh Schedule:**

- Every day at 3:25 PM
- Automatic re-schedule for next day

**Fallback Logic:**

```
1. Try API fetch (normal path)
2. If fails → Try cache (max age: 7 days)
3. If both fail → Initialization error
```

**Implementation**: `loadHistoricalDataWithFallback()`, `cacheHistoricalData()`, `scheduleDailyCacheRefresh()`

---

#### Order Execution

**Order Parameters:**

```typescript
{
  exchange: 'NFO',                    // NSE Futures & Options
  tradingsymbol: 'NIFTY25JAN2625200CE',
  transaction_type: 'BUY' | 'SELL',
  quantity: lots × lot_size,          // e.g., 5 × 65 = 325
  product: 'MIS',                     // Intraday
  order_type: 'MARKET',               // Immediate execution
  validity: 'DAY',
  tag: 'BB_TRADE'                     // Identify bot orders
}
```

**Order Flow:**

```
1. placeOrder() → Get order_id
2. Poll getOrderHistory(order_id) every 1 second
3. Wait for status = 'COMPLETE'
4. Extract average_price
5. Return { success: true, price, orderId }
```

**Order Status Handling:**

- `COMPLETE` → Success, get fill price
- `REJECTED` / `CANCELLED` → Error, throw exception
- Timeout after 120 attempts (2 minutes)

**Implementation**: `executeOrder()`, `waitForOrderExecution()`

---

#### Capital Validation

**Purpose**: Ensure data integrity between trades and capital

**Validation Formula:**

```typescript
Expected Capital = Initial Capital + Sum(All Trade P&Ls)
Actual Capital = this.currentCapital

If |Actual - Expected| > ₹1:
  → Log CRITICAL error with details
  → Flag for manual review
```

**Validation Trigger**: After every trade exit

**Implementation**: `validateCapitalConsistency()`

---

### 4. Logging System

#### **Logger.ts** - Winston-based Logging

**Location**: `src/utils/Logger.ts` (200 lines)

**Purpose**: Centralized logging with multiple transports and log rotation.

**Configuration:**

```typescript
{
  level: process.env.LOG_LEVEL || 'info',
  format: timestamp + error stack + custom printf,
  transports: [
    Console (colored, simple format),
    File 'logs/trading.log' (all logs, 5MB max, 5 files),
    File 'logs/error.log' (errors only, 5MB max, 5 files)
  ]
}
```

**Log Levels:**

- `debug`: Verbose debugging info
- `info`: Normal operations, trade executions, signals
- `warn`: Recoverable issues, retries, warnings
- `error`: Failures, exceptions, critical errors

**Methods:**

```typescript
logger.info(message: string, meta?: any): void
logger.warn(message: string, meta?: any): void
logger.error(message: string, error?: any): void
logger.debug(message: string, meta?: any): void
```

**Log Format:**

```
2026-01-25 14:30:45 [INFO]: [Bollinger Band Strategy] LONG entry signal detected { close: 25245.50, rsi: 72.34, ... }
```

**Strategy-Specific Logging:**

```typescript
protected logStrategyEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: any
): void
```

**Log Rotation:**

- Max file size: 5MB
- Max files: 5 (keeps last 5 rotations)
- Auto-rotation on size threshold

---

### 5. Express Dashboard & API

#### **index.ts** - Main Server

**Location**: `src/index.ts` (831 lines)

**Purpose**: Web interface for monitoring and controlling the trading bot.

---

#### Dashboard Routes

**Main Dashboard** - `GET /`

**Features:**

- Real-time authentication status
- Session information (user, expiry time)
- Quick action buttons (Login, Strategy Dashboard)
- API endpoint directory
- Modern gradient UI with glassmorphism

**Strategy Dashboard** - `GET /strategy/:id`

**Displays:**

- Strategy status (Active/Inactive)
- Total trades, P&L, win rate
- Current configuration
- Control buttons (Start/Stop)
- Real-time metrics

---

#### API Endpoints

**Authentication:**

```
GET  /auth/login         → Redirect to Zerodha OAuth
GET  /auth/callback      → Handle OAuth callback
POST /auth/logout        → Invalidate session
GET  /auth/status        → Current auth status (JSON)
GET  /auth/session-info  → Session persistence info (JSON)
```

**Strategy Management:**

```
GET  /strategies                  → All strategies status (JSON)
GET  /strategies/:id              → Specific strategy status (JSON)
POST /strategies/:id/start        → Start a strategy
POST /strategies/:id/stop         → Stop a strategy
POST /strategies/start-all        → Start all enabled
POST /strategies/stop-all         → Stop all
POST /api/strategy/:id/clear-position → Manual position clear
```

**Health Check:**

```
GET /health → { status: 'OK', timestamp }
```

---

#### Response Formats

**Success Response:**

```json
{
  "success": true,
  "message": "Strategy bollinger-band-01 started successfully",
  "timestamp": "2026-01-25T14:30:45.123Z"
}
```

**Error Response:**

```json
{
  "error": "Not authenticated",
  "message": "Please visit /auth/login to authenticate first"
}
```

**Strategy Status Response:**

```json
{
  "success": true,
  "timestamp": "2026-01-25T14:30:45.123Z",
  "strategy": {
    "config": {
      /* StrategyConfig */
    },
    "metrics": {
      /* StrategyMetrics */
    },
    "currentPosition": {
      /* Position | null */
    },
    "recentTrades": [
      /* Trade[] */
    ],
    "allTrades": [
      /* Trade[] */
    ],
    "tradeStats": {
      /* Statistics */
    },
    "capitalAllocation": 200000,
    "currentCapital": 203250,
    "currentLots": 5,
    "indicators": {
      /* RSI, BB, Supertrend */
    },
    "pivots": {
      /* PP, R1-R3, S1-S3 */
    },
    "candleCount": 42,
    "positionInfo": {
      /* Real-time position data */
    }
  }
}
```

---

#### Server Initialization

**Startup Sequence:**

```
1. Load environment variables (.env)
2. Initialize KiteConnect client
3. Create AuthService (async session restore)
4. Create StrategyManager
5. Setup Express routes
6. Wait for auth initialization
7. Initialize StrategyManager (load configs)
8. Start HTTP server on port 3000
9. Log dashboard URLs
```

**Error Handling:**

- Unhandled Promise Rejections: Log and continue
- Uncaught Exceptions: Log and exit(1)
- SIGTERM/SIGINT: Graceful shutdown

**Implementation**: `TradingBot` class

---

## 📊 Data Flow Architecture

### Complete Trading Cycle

```
┌─────────────────────────────────────────────────────────────────┐
│                         MARKET DATA                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              MASTER CYCLE (Every 5 Minutes)                      │
│  09:20:05 → Fetch 09:15-09:20 candle from KiteConnect API       │
│  09:25:05 → Fetch 09:20-09:25 candle                            │
│  ...                                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              CANDLE VALIDATION & STORAGE                         │
│  • Check freshness (age < 6 minutes)                             │
│  • Duplicate prevention (timestamp + OHLC)                       │
│  • Add to candleHistory (keep last 50)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              INDICATOR CALCULATION                               │
│  • RSI (10-period)                                               │
│  • Bollinger Bands (20-period, 2σ)                              │
│  • Supertrend (10-period, 2x)                                    │
│  • Daily Pivots (from previous day)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              POSITION CHECK (Priority 1)                         │
│  IF Active Position:                                             │
│    LONG  → Check entry candle low breach                         │
│    SHORT → (Handled by 1-second polling)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              SIGNAL DETECTION (Priority 2)                       │
│  IF No Position:                                                 │
│    Check LONG conditions (5 criteria)                            │
│    Check SHORT conditions (5 criteria)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              TRADE EXECUTION                                     │
│  IF Signal Detected:                                             │
│    1. Select option (1% premium, ATM±25)                         │
│    2. Calculate lot size (capital / 40,000)                      │
│    3. Place market order (BUY)                                   │
│    4. Wait for fill (poll order status)                          │
│    5. Create Position object                                     │
│    6. Save to disk (persistence)                                 │
│    7. Start position monitoring                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         POSITION MONITORING (Every 1 Second)                     │
│  REST API Polling:                                               │
│    • Get current option premium                                  │
│    • Update unrealized P&L                                       │
│    • Track highest premium                                       │
│    • Check trailing stop loss (12%)                              │
│    • Check time-decay (SHORT: 15 min)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXIT EXECUTION                                      │
│  IF Exit Condition Met:                                          │
│    1. Place market order (SELL)                                  │
│    2. Wait for fill                                              │
│    3. Calculate P&L                                              │
│    4. Update capital                                             │
│    5. Add to trade history                                       │
│    6. Save to disk                                               │
│    7. Clear position                                             │
│    8. Stop monitoring                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        Back to Master Cycle
```

---

### Authentication Flow

```
┌──────────────┐
│  Bot Starts  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────┐
│  AuthService Initialization      │
│  Load session from disk           │
└──────┬───────────────────────────┘
       │
       ├─── Has Valid Session? ──┐
       │                         │
       ▼ Yes                     ▼ No
┌──────────────────┐      ┌──────────────────┐
│  Validate Token  │      │  Wait for Login  │
│  (getProfile())  │      │  User visits /   │
└──────┬───────────┘      │  auth/login      │
       │                  └──────┬───────────┘
       ▼                         │
┌──────────────────┐            │
│  Token Valid?    │            │
└──────┬───────────┘            │
       │                        │
       ├─ Yes ─────────────┐    │
       │                   │    │
       ▼ No                │    │
┌──────────────────┐       │    │
│  Clear Session   │       │    │
│  Require Re-Auth │       │    │
└──────┬───────────┘       │    │
       │                   │    │
       └───────────────────┘    │
                                │
                                ▼
                      ┌──────────────────────┐
                      │  Zerodha OAuth Flow  │
                      │  1. Login page       │
                      │  2. User auth        │
                      │  3. Callback         │
                      └──────┬───────────────┘
                             │
                             ▼
                      ┌──────────────────────┐
                      │  Generate Session    │
                      │  Get access_token    │
                      │  Save to disk        │
                      └──────┬───────────────┘
                             │
                             ▼
                      ┌──────────────────────┐
                      │  Set KiteConnect     │
                      │  access_token        │
                      └──────┬───────────────┘
                             │
                             ▼
                      ┌──────────────────────┐
                      │  Initialize Pending  │
                      │  Strategies          │
                      └──────┬───────────────┘
                             │
                             ▼
                      ┌──────────────────────┐
                      │  Ready to Trade      │
                      └──────────────────────┘
```

---

### Strategy Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                   BOT INITIALIZATION                          │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│               STRATEGY MANAGER INIT                           │
│  1. Initialize StrategyRegistry                               │
│  2. Register strategy classes (BollingerBandStrategy)        │
│  3. Load config/strategies.json                               │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│           CREATE STRATEGY INSTANCES                           │
│  For each enabled strategy in config:                         │
│    - Create instance (new BollingerBandStrategy(...))        │
│    - If authenticated: initialize() immediately               │
│    - If not: defer initialize() until auth                    │
│    - Add to StrategyRegistry                                  │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│         WAIT FOR AUTHENTICATION                               │
│  User visits /auth/login                                      │
│  OAuth flow completes                                         │
│  initializePendingStrategies() called                         │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│            STRATEGY INITIALIZATION                            │
│  For BollingerBandStrategy:                                   │
│    1. Load capital data from disk                             │
│    2. Recover active position (if exists)                     │
│    3. Get NIFTY50 instrument token                            │
│    4. Load historical data (7 days, 5-min)                    │
│    5. Calculate daily pivots                                  │
│    6. Update indicators                                       │
│    7. Start real-time monitoring                              │
│    8. Schedule EOD exit                                       │
│    9. Start position reconciliation                           │
│   10. Start health monitoring                                 │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│               STRATEGY START                                  │
│  User clicks "Start" or auto-start enabled                    │
│  strategyManager.startStrategy(id)                            │
│  strategy.start() called                                      │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│           ACTIVE TRADING (Loop)                               │
│  - Master cycle fetching candles                              │
│  - Signal detection                                           │
│  - Position management                                        │
│  - Real-time monitoring                                       │
│  - Reconciliation checks                                      │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│               STRATEGY STOP                                   │
│  User clicks "Stop" or emergency stop                         │
│  strategyManager.stopStrategy(id)                             │
│  strategy.stop() called                                       │
│    - Stop master cycle                                        │
│    - Stop position monitoring                                 │
│    - Stop reconciliation                                      │
│    - Force close active position (if any)                     │
│    - Update metrics                                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Features

### 1. Session Encryption

- **Algorithm**: AES-256-CBC (military-grade)
- **Key Derivation**: SHA-256 hash of API credentials + salt
- **IV**: Random 16 bytes per encryption
- **File Permissions**: 0o600 (owner read/write only)

### 2. Environment Variables

```bash
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
PORT=3000
LOG_LEVEL=info
```

- Never commit `.env` to version control
- Use `.env.example` for template

### 3. Order Tagging

- All bot orders tagged with `BB_TRADE`
- Distinguishes bot trades from manual trades
- Helps in reconciliation and debugging

### 4. Token Validation

- Test token with `getProfile()` before use
- Auto-invalidate on API errors
- Clear corrupted sessions automatically

### 5. Input Validation

- Strategy ID validation in API endpoints
- Configuration schema validation
- Order parameter validation

---

## 🚀 Scalability & Extensibility

### Multi-Strategy Support

**Current Architecture Supports:**

1. Multiple strategy instances running simultaneously
2. Independent capital pools per strategy
3. Separate health monitoring per strategy
4. Strategy-specific configurations
5. Global metrics aggregation

**Adding a New Strategy:**

1. **Create Strategy Class:**

```typescript
// src/strategies/momentum/MomentumStrategy.ts
export class MomentumStrategy extends StrategyBase {
  async initialize(): Promise<void> {
    /* ... */
  }
  async start(): Promise<void> {
    /* ... */
  }
  async stop(): Promise<void> {
    /* ... */
  }
  getStatus(): StrategyStatus {
    /* ... */
  }
  async processMarketData(data: any): Promise<void> {
    /* ... */
  }
}
```

2. **Register in StrategyManager:**

```typescript
// src/core/StrategyManager.ts
const { MomentumStrategy } =
  await import("../strategies/momentum/MomentumStrategy");
StrategyRegistry.registerStrategy("momentum", MomentumStrategy);
```

3. **Add Configuration:**

```json
// config/strategies.json
{
  "strategies": [
    {
      "id": "momentum-scanner-01",
      "name": "Market Open Momentum Scanner",
      "enabled": true,
      "timeframe": "1min",
      "instruments": ["NIFTY", "BANKNIFTY"],
      "config": {
        /* momentum-specific */
      }
    }
  ]
}
```

4. **Strategy Automatically:**
   - Loaded on bot start
   - Initialized after authentication
   - Managed via dashboard
   - Metrics aggregated

---

### Multi-Stock Support

**Current**: Strategy configured for NIFTY

**To Add BANKNIFTY:**

1. **Instrument Configuration:**

```json
{
  "instruments": ["NIFTY", "BANKNIFTY"]
}
```

2. **Strategy Loop:**

```typescript
for (const instrument of this.config.instruments) {
  const instrumentToken = await this.getInstrumentToken(instrument);
  const candles = await this.fetchCandles(instrumentToken);
  await this.checkSignals(instrument, candles);
}
```

3. **Position Management:**

```typescript
// Track multiple positions
private positions: Map<string, Position> = new Map();

// Per-instrument monitoring
for (const [symbol, position] of this.positions) {
  await this.monitorPosition(symbol, position);
}
```

---

### Future Enhancements (Ready to Implement)

**1. Momentum Scanner:**

- Scan all stocks at 9:15 AM
- Rank by momentum score
- Auto-select top 5 for trading
- Deploy Bollinger strategy on each

**2. Multiple Timeframes:**

- 1-min for scalping
- 5-min for current strategy
- 15-min for swing trades
- Multi-timeframe confirmation

**3. Risk Management:**

```typescript
interface GlobalRiskManagement {
  maxDailyLoss: number; // e.g., ₹50,000
  maxDrawdown: number; // e.g., ₹1,00,000
  maxOpenPositions: number; // e.g., 5
  perTradeRisk: number; // e.g., 2%
  emergencyStop: boolean; // Auto-stop on breach
}
```

**4. Advanced Analytics:**

- Sharpe ratio calculation
- Maximum drawdown tracking
- Win/loss streaks
- Time-based performance (morning vs afternoon)
- Instrument-wise performance

**5. Notification System:**

- Telegram bot for alerts
- Email notifications for trades
- SMS for critical errors
- Webhook for external integrations

---

## 📦 File Structure

```
tradebot-bollinger-multistock/
├── src/
│   ├── index.ts                          # Main server (831 lines)
│   ├── core/
│   │   ├── StrategyBase.ts              # Abstract strategy class
│   │   ├── StrategyManager.ts           # Strategy orchestrator (391 lines)
│   │   └── StrategyRegistry.ts          # Factory pattern (200 lines)
│   ├── services/
│   │   ├── AuthService.ts               # OAuth handler (400 lines)
│   │   └── SessionPersistence.ts        # Encrypted storage (300 lines)
│   ├── strategies/
│   │   └── bollinger-band/
│   │       └── BollingerBandStrategy.ts # Complete strategy (3,895 lines)
│   ├── utils/
│   │   ├── Logger.ts                    # Winston logger (200 lines)
│   │   └── StateLock.ts                 # Concurrency control
│   └── data/
│       ├── bollinger-trading-data.json  # Capital + trades + position
│       ├── bollinger-historical-cache.json # Pre-market data
│       └── auth/
│           └── session.json             # Encrypted session
├── config/
│   └── strategies.json                  # Strategy configurations
├── logs/
│   ├── trading.log                      # All logs (rotated)
│   └── error.log                        # Errors only (rotated)
├── docs/
│   ├── BOLLINGER-EXIT-FRAMEWORK.md      # Exit logic documentation
│   └── ZERODHA-AUTH-SYSTEM-REPLICATION-GUIDE.md
├── .env                                 # Environment variables (gitignored)
├── .env.example                         # Template
├── package.json                         # Dependencies
├── tsconfig.json                        # TypeScript config
└── README.md                            # Project overview
```

---

## 🔧 Configuration Files

### package.json

```json
{
  "dependencies": {
    "dotenv": "^16.3.1", // Environment variables
    "express": "^4.18.2", // Web server
    "kiteconnect": "^5.1.0", // Zerodha API
    "node-fetch": "^3.3.2", // HTTP client
    "winston": "^3.11.0" // Logging
  },
  "devDependencies": {
    "@types/express": "^4.17.21", // TypeScript types
    "@types/node": "^20.8.7",
    "ts-node": "^10.9.1", // Run TypeScript directly
    "typescript": "^5.2.2"
  },
  "scripts": {
    "start": "node dist/index.js", // Production
    "dev": "ts-node src/index.ts", // Development
    "build": "tsc", // Compile TypeScript
    "watch": "tsc -w", // Watch mode
    "clean": "rimraf dist" // Clean build
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### config/strategies.json

```json
{
  "strategies": [
    {
      "id": "bollinger-band-01",
      "name": "5m option Buy: bollinger band entry and trail",
      "enabled": true,
      "description": "Bollinger Band strategy with trailing stop loss",
      "timeframe": "5min",
      "instruments": ["NIFTY", "BANKNIFTY"],
      "riskPerTrade": 0.8,
      "maxPositions": 2,
      "config": {
        "period": 20,
        "stdDev": 2.0,
        "trailType": "percentage",
        "trailValue": 1.5,
        "riskReward": {
          "stopLoss": 2.0,
          "target": 4.0
        },
        "positionSizing": {
          "riskAmount": 10000,
          "riskPercentage": 2.0
        }
      }
    }
  ],
  "global": {
    "autoStart": true,
    "healthCheckInterval": 30000,
    "logging": {
      "level": "info",
      "separateFiles": true
    },
    "riskManagement": {
      "maxDailyLoss": 50000,
      "maxDrawdown": 100000,
      "emergencyStop": true
    }
  }
}
```

---

## 🚦 Operational Guidelines

### Starting the Bot

**Pre-Market (Before 9:15 AM):**

```bash
npm run dev
# Bot loads cached historical data
# Waits for authentication
# Ready to trade at market open
```

**During Market Hours:**

```bash
npm run dev
# Bot fetches real-time historical data
# Requires authentication immediately
# Starts trading after auth
```

**Production:**

```bash
npm run build
npm start
# Or use PM2 for process management
```

---

### Daily Routine

**9:00 AM** - Pre-market startup

- Bot loads historical data
- Calculates daily pivots
- Updates indicators
- Waits for user login

**9:15 AM** - Market open

- User authenticates via dashboard
- Strategies initialize
- First candle ready at 9:20 AM
- Trading begins

**Throughout Day** - Active monitoring

- Candles fetched every 5 minutes
- Position monitoring every 1 second
- Reconciliation every 5 minutes
- Health checks every 5 minutes

**3:25 PM** - Cache refresh

- Historical data cached for next day
- Prepared for pre-market startup

**3:28 PM** - EOD safety

- Auto-exit any active positions
- Avoid broker's 3:30 PM squareoff

**3:30 PM** - Market close

- Trading stops
- Capital and trades saved
- Bot can be stopped or left running

---

### Monitoring & Maintenance

**Dashboard Monitoring:**

- Visit `http://localhost:3000/`
- Check strategy status
- View recent trades
- Monitor P&L

**Log Monitoring:**

```bash
# Real-time log stream
tail -f logs/trading.log

# Error monitoring
tail -f logs/error.log

# Search logs
grep "LONG entry" logs/trading.log
grep "ERROR" logs/trading.log
```

**Health Checks:**

- API endpoint: `GET /strategies/bollinger-band-01`
- Check `healthStatus` field
- Monitor `consecutiveErrors` count
- Verify `lastTradeTime`

---

### Troubleshooting

**1. Authentication Issues:**

```bash
# Check session status
curl http://localhost:3000/auth/status

# Re-authenticate
# Visit http://localhost:3000/auth/login

# Check session file
cat src/data/auth/session.json
```

**2. Strategy Not Starting:**

- Check authentication: `GET /auth/status`
- Check strategy config: `config/strategies.json`
- Check logs: `logs/error.log`
- Verify `enabled: true` in config

**3. Missing Signals:**

- Verify candle fetching: Check logs for "5-minute candle"
- Check indicators: `GET /strategies/bollinger-band-01`
- Verify market hours (9:15 AM - 3:30 PM)
- Check entry conditions in logs

**4. Position Stuck:**

- Dashboard: Click "Clear Position" button
- API: `POST /api/strategy/bollinger-band-01/clear-position`
- Manually verify with broker

**5. System Sleep Detected:**

- Logs will show gap warnings
- Auto-recovery systems will realign
- Position monitoring continues
- Check for missed stop losses

---

## 📈 Performance Metrics

### Strategy Metrics

**From BollingerBandStrategy.getStatus():**

```typescript
{
  totalTrades: number,          // Completed trades
  profitLoss: number,           // Total P&L
  winRate: number,              // Win percentage
  currentCapital: number,       // Available capital
  capitalChange: number,        // Change from initial
  capitalChangePercent: number, // ROI
  avgWin: number,              // Average winning trade
  avgLoss: number,             // Average losing trade
  profitFactor: number,        // (Total Wins) / (Total Losses)
  maxDrawdown: number,         // Peak-to-trough decline
  sharpeRatio: number          // Risk-adjusted return
}
```

### System Metrics

**From StrategyManager.getGlobalMetrics():**

```typescript
{
  totalStrategies: number,      // All strategies
  activeStrategies: number,     // Currently trading
  totalProfitLoss: number,      // Combined P&L
  totalTrades: number,          // All trades
  systemHealth: 'healthy' | 'warning' | 'error'
}
```

### Health Metrics

**From strategy.getHealthReport():**

```typescript
{
  overall: boolean,                    // Overall health
  dataStream: boolean,                 // Candle fetching OK
  execution: boolean,                  // Order placement OK
  timeSinceHeartbeat: number,          // Seconds since last operation
  consecutiveErrors: number,           // Error streak
  criticalErrorsToday: number,         // Daily critical count
  errorBreakdown: Map<string, number>, // Errors by type
  candleHistoryLength: number,         // Available candles
  hasPosition: boolean,                // Active position
  currentNiftyLTP: number             // Latest NIFTY price
}
```

---

## 🎯 Best Practices

### Code Quality

1. ✅ **Type Safety**: Use TypeScript strict mode
2. ✅ **Error Handling**: Try-catch all async operations
3. ✅ **Logging**: Log all significant events with context
4. ✅ **Comments**: Document complex logic
5. ✅ **Race Conditions**: Use guard flags for concurrent operations

### Trading Safety

1. ✅ **Position Limits**: Enforce max positions per strategy
2. ✅ **Risk Management**: Per-trade and daily loss limits
3. ✅ **Stop Losses**: Always have exit mechanisms
4. ✅ **EOD Exits**: Auto-close before market close
5. ✅ **Reconciliation**: Verify positions match broker

### Operational Safety

1. ✅ **Session Backup**: Encrypted persistence
2. ✅ **Position Backup**: Disk persistence after changes
3. ✅ **Log Rotation**: Prevent disk space issues
4. ✅ **Health Monitoring**: Alert on errors
5. ✅ **Graceful Shutdown**: Handle SIGTERM/SIGINT

### Performance

1. ✅ **Efficient Polling**: 1-second intervals, not continuous
2. ✅ **Batch API Calls**: Fetch multiple quotes together
3. ✅ **Caching**: Cache historical data
4. ✅ **Retry Logic**: Exponential backoff
5. ✅ **Memory Management**: Keep limited candle history

---

## 🔮 Future Roadmap

### Phase 1: Enhanced Monitoring (Q1 2026)

- [ ] Telegram bot integration
- [ ] Email alerts for trades
- [ ] SMS for critical errors
- [ ] Web dashboard real-time updates (WebSocket)
- [ ] Performance charts and graphs

### Phase 2: Advanced Strategies (Q2 2026)

- [ ] Momentum scanner for market open
- [ ] Breakout strategy
- [ ] Mean reversion strategy
- [ ] Multi-timeframe confirmation
- [ ] Option selling strategies

### Phase 3: Risk Management (Q2 2026)

- [ ] Global risk limits enforcement
- [ ] Dynamic position sizing
- [ ] Correlation-based portfolio management
- [ ] Maximum drawdown protection
- [ ] Auto-stop on breach

### Phase 4: Multi-Stock Support (Q3 2026)

- [ ] BANKNIFTY support
- [ ] Stock futures support
- [ ] Top momentum stocks scanner
- [ ] Per-instrument capital allocation
- [ ] Cross-instrument correlation

### Phase 5: Analytics & Optimization (Q3 2026)

- [ ] Backtest engine
- [ ] Parameter optimization
- [ ] Machine learning signals
- [ ] Strategy performance comparison
- [ ] Forward testing framework

### Phase 6: Production Hardening (Q4 2026)

- [ ] Docker containerization
- [ ] Kubernetes deployment
- [ ] Load balancing
- [ ] Automated failover
- [ ] Cloud infrastructure (AWS/Azure)

---

## 📚 References

### Zerodha Documentation

- KiteConnect API: https://kite.trade/docs/connect/v3/
- WebSocket Streaming: https://kite.trade/docs/connect/v3/websocket/
- Order Types: https://kite.trade/docs/connect/v3/orders/

### Technical Indicators

- TradingView Pine Script: https://www.tradingview.com/pine-script-docs/
- Bollinger Bands: https://www.investopedia.com/terms/b/bollingerbands.asp
- Supertrend: https://www.investopedia.com/supertrend-indicator-7976167
- RSI: https://www.investopedia.com/terms/r/rsi.asp

### Architecture Patterns

- Strategy Pattern: https://refactoring.guru/design-patterns/strategy
- Factory Pattern: https://refactoring.guru/design-patterns/factory-method
- Clean Architecture: https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html

---

## 🤝 Contributing Guidelines

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public methods
- Include error handling in all async operations
- Log significant events with context

### Testing

- Test strategy logic with historical data
- Verify order execution in paper trading
- Test error recovery scenarios
- Validate session persistence
- Check system sleep recovery

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Update documentation
4. Submit PR with description
5. Address review comments

---

## 📄 License

MIT License - See LICENSE file for details

---

## 👥 Contact & Support

**Developer**: Trading Bot Developer  
**Email**: [Contact via GitHub]  
**GitHub**: [Repository Link]

**Support Channels:**

- GitHub Issues for bugs
- Discussions for questions
- Wiki for extended documentation

---

## 🙏 Acknowledgments

- Zerodha for KiteConnect API
- TradingView for indicator formulas
- Winston for logging framework
- TypeScript team for type safety
- Open source community

---

**Last Updated**: January 25, 2026  
**Version**: 1.0.0  
**Status**: Production-Ready

---

## Quick Reference Card

### Essential Commands

```bash
# Development
npm run dev                    # Start bot in dev mode
npm run build                  # Compile TypeScript
npm start                      # Start production bot

# Monitoring
tail -f logs/trading.log       # Watch logs
curl http://localhost:3000/health  # Health check

# Management
POST /strategies/:id/start     # Start strategy
POST /strategies/:id/stop      # Stop strategy
POST /api/strategy/:id/clear-position  # Clear position
```

### Key Files

- `src/index.ts` - Main server
- `src/strategies/bollinger-band/BollingerBandStrategy.ts` - Strategy
- `config/strategies.json` - Configuration
- `src/data/bollinger-trading-data.json` - Capital & trades
- `src/data/auth/session.json` - Encrypted session
- `logs/trading.log` - All logs

### Critical Timings

- **9:15 AM** - Market open, trading begins
- **Every 5 min** - Candle fetch, signal check
- **Every 1 sec** - Position monitoring (if active)
- **Every 5 min** - Position reconciliation
- **3:25 PM** - Historical data cache refresh
- **3:28 PM** - EOD safety exit

### Support URLs

- Dashboard: http://localhost:3000/
- Auth Status: http://localhost:3000/auth/status
- Strategy Status: http://localhost:3000/strategies/bollinger-band-01
- Login: http://localhost:3000/auth/login

---

_This documentation is comprehensive and covers all aspects of the trading bot architecture. For specific implementation details, refer to the source code files._
