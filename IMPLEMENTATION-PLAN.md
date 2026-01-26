# Market Scanner Implementation Plan

**Date**: January 25, 2026  
**Project**: TMV Market Scanner + Multi-Stock Bollinger Band Strategy  
**Status**: AWAITING APPROVAL - NO CODE CHANGES YET

---

## 📋 Executive Summary

This plan implements a market scanner that:

1. Selects top 3 high-momentum stocks daily at 09:30 AM
2. Deploys separate Bollinger Band strategy instances on each
3. Manages 3 concurrent trading positions
4. Handles pre-market data caching and session dependencies

**Total Estimated Development Time**: 4-5 days  
**Risk Level**: Medium (significant architecture changes)  
**Breaking Changes**: Yes (StrategyManager, BollingerBandStrategy modifications)

---

## 🎯 Requirements Analysis

### From market_scanner.md:

**Core Requirements:**

1. ✅ TMV (Trend, Momentum, Volume) scoring system (0-10 points)
2. ✅ Scan 100+ stock universe at 09:30 AM
3. ✅ Select top 3 stocks (score ≥7)
4. ✅ Deploy Bollinger Band strategy on each selected stock
5. ✅ Trade stock options (CE/PE, monthly expiry)
6. ✅ Equal capital allocation (₹65k per stock)
7. ✅ Pre-market data caching at 09:00 AM
8. ✅ Single execution per day (lock & load)
9. ✅ Expiry day blackout (Monday/Tuesday)
10. ✅ Handle 0-3 qualified stocks gracefully

**Integration Points:**

- AuthService (reactive login detection)
- StrategyManager (scanner integration)
- BollingerBandStrategy (stock adaptation)
- QuoteManager (centralized polling)

---

## 🏗️ Architecture Changes Overview

### New Components (5 files):

1. `src/services/MarketScanner.ts` - TMV scoring engine
2. `src/services/QuoteManager.ts` - Centralized quote polling
3. `src/config/universe.ts` - Stock universe (TypeScript)
4. `src/config/sectorTokens.ts` - Sector index tokens (TypeScript)
5. `tests/services/MarketScanner.test.ts` - Unit tests

### Modified Components (5 files):

1. `src/core/StrategyManager.ts` - Scanner integration + pre-market logic
2. `src/core/StrategyRegistry.ts` - Add QuoteManager parameter to factory method
3. `src/strategies/bollinger-band/BollingerBandStrategy.ts` - Stock support
4. `src/index.ts` - QuoteManager injection + dashboard updates
5. `config/strategies.json` - New template structure

### New Data Files (2 files):

1. `data/trading-data.json` - Unified multi-strategy P&L
2. `data/strategy/strategy-state.json` - Unified state persistence

---

## 📁 Detailed File-by-File Implementation

---

## 1. NEW FILE: `src/config/universe.ts`

**Purpose**: Define scannable stock universe with sector mappings

**Size**: ~250 lines

**Implementation**:

```typescript
/**
 * Universe configuration for market scanner
 * Contains 100+ stocks from NIFTY F&O segment
 * Maps each stock to its sector index for confluence check
 */

export interface UniverseStock {
  symbol: string; // Kite tradingsymbol (e.g., "RELIANCE", "M&M")
  sector: string; // Sector name for logging
  sectorToken: number; // Instrument token for sector index
  lotSize: number; // Fallback lot size (if API fetch fails)
}

/**
 * ⚠️ OPTIMIZATION: lotSize as Fallback
 *
 * If kite.getInstruments() fails during option selection,
 * we can use the hardcoded lotSize to calculate quantity.
 * This prevents complete failure due to transient API errors.
 *
 * Update lot sizes annually (NSE changes them occasionally).
 */

// Primary export - complete stock universe
export const UNIVERSE: UniverseStock[] = [
  // Banking (NIFTY BANK - 260105)
  {
    symbol: "HDFCBANK",
    sector: "NIFTY BANK",
    sectorToken: 260105,
    lotSize: 550,
  },
  {
    symbol: "ICICIBANK",
    sector: "NIFTY BANK",
    sectorToken: 260105,
    lotSize: 1375,
  },
  {
    symbol: "SBIN",
    sector: "NIFTY PSU BANK",
    sectorToken: 261129,
    lotSize: 1500,
  },
  {
    symbol: "KOTAKBANK",
    sector: "NIFTY BANK",
    sectorToken: 260105,
    lotSize: 400,
  },
  {
    symbol: "AXISBANK",
    sector: "NIFTY BANK",
    sectorToken: 260105,
    lotSize: 1200,
  },
  {
    symbol: "INDUSINDBK",
    sector: "NIFTY BANK",
    sectorToken: 260105,
    lotSize: 900,
  },
  {
    symbol: "BANKBARODA",
    sector: "NIFTY PSU BANK",
    sectorToken: 261129,
    lotSize: 4200,
  },
  {
    symbol: "PNB",
    sector: "NIFTY PSU BANK",
    sectorToken: 261129,
    lotSize: 8400,
  },

  // IT (NIFTY IT - 259849)
  { symbol: "TCS", sector: "NIFTY IT", sectorToken: 259849, lotSize: 125 },
  { symbol: "INFY", sector: "NIFTY IT", sectorToken: 259849, lotSize: 300 },
  { symbol: "HCLTECH", sector: "NIFTY IT", sectorToken: 259849, lotSize: 600 },
  { symbol: "TECHM", sector: "NIFTY IT", sectorToken: 259849, lotSize: 400 },
  { symbol: "WIPRO", sector: "NIFTY IT", sectorToken: 259849, lotSize: 1200 },
  { symbol: "LTIM", sector: "NIFTY IT", sectorToken: 259849, lotSize: 250 },

  // Auto (NIFTY AUTO - 257289)
  {
    symbol: "TATAMOTORS",
    sector: "NIFTY AUTO",
    sectorToken: 257289,
    lotSize: 1500,
  },
  { symbol: "MARUTI", sector: "NIFTY AUTO", sectorToken: 257289, lotSize: 50 },
  { symbol: "M&M", sector: "NIFTY AUTO", sectorToken: 257289, lotSize: 375 },
  {
    symbol: "BAJAJ-AUTO",
    sector: "NIFTY AUTO",
    sectorToken: 257289,
    lotSize: 75,
  },
  {
    symbol: "EICHERMOT",
    sector: "NIFTY AUTO",
    sectorToken: 257289,
    lotSize: 175,
  },

  // Metal (NIFTY METAL - 258313)
  {
    symbol: "TATASTEEL",
    sector: "NIFTY METAL",
    sectorToken: 258313,
    lotSize: 3000,
  },
  {
    symbol: "JSWSTEEL",
    sector: "NIFTY METAL",
    sectorToken: 258313,
    lotSize: 800,
  },
  {
    symbol: "HINDALCO",
    sector: "NIFTY METAL",
    sectorToken: 258313,
    lotSize: 1275,
  },
  { symbol: "VEDL", sector: "NIFTY METAL", sectorToken: 258313, lotSize: 2400 },

  // Energy (NIFTY ENERGY - 256521)
  {
    symbol: "RELIANCE",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 250,
  },
  {
    symbol: "ONGC",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 3700,
  },
  {
    symbol: "NTPC",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 3900,
  },
  {
    symbol: "POWERGRID",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 2700,
  },
  {
    symbol: "COALINDIA",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 2025,
  },
  {
    symbol: "BPCL",
    sector: "NIFTY ENERGY",
    sectorToken: 256521,
    lotSize: 1900,
  },

  // Pharma (NIFTY PHARMA - 258569)
  {
    symbol: "SUNPHARMA",
    sector: "NIFTY PHARMA",
    sectorToken: 258569,
    lotSize: 350,
  },
  {
    symbol: "DRREDDY",
    sector: "NIFTY PHARMA",
    sectorToken: 258569,
    lotSize: 100,
  },
  {
    symbol: "CIPLA",
    sector: "NIFTY PHARMA",
    sectorToken: 258569,
    lotSize: 500,
  },
  {
    symbol: "DIVISLAB",
    sector: "NIFTY PHARMA",
    sectorToken: 258569,
    lotSize: 150,
  },

  // Financial Services (NIFTY FIN SERVICE - 257545)
  {
    symbol: "BAJFINANCE",
    sector: "NIFTY FIN SERVICE",
    sectorToken: 257545,
    lotSize: 125,
  },
  {
    symbol: "BAJAJFINSV",
    sector: "NIFTY FIN SERVICE",
    sectorToken: 257545,
    lotSize: 500,
  },

  // FMCG (NIFTY FMCG - 257033)
  { symbol: "ITC", sector: "NIFTY FMCG", sectorToken: 257033, lotSize: 1600 },
  {
    symbol: "HINDUNILVR",
    sector: "NIFTY FMCG",
    sectorToken: 257033,
    lotSize: 300,
  },
  {
    symbol: "BRITANNIA",
    sector: "NIFTY FMCG",
    sectorToken: 257033,
    lotSize: 150,
  },

  // Infra (NIFTY INFRA - 257801)
  { symbol: "LT", sector: "NIFTY INFRA", sectorToken: 257801, lotSize: 1700 },
  {
    symbol: "BHARTIARTL",
    sector: "NIFTY INFRA",
    sectorToken: 257801,
    lotSize: 550,
  },

  // Consumer Durables (261641)
  {
    symbol: "TITAN",
    sector: "NIFTY CONSUMER DURABLES",
    sectorToken: 261641,
    lotSize: 250,
  },
  {
    symbol: "ASIANPAINT",
    sector: "NIFTY CONSUMER DURABLES",
    sectorToken: 261641,
    lotSize: 200,
  },

  // Add remaining stocks to reach 100+ total...
];

// Helper to get unique sectors
export function getUniqueSectors(): Array<{ name: string; token: number }> {
  const sectorMap = new Map<number, string>();

  for (const stock of UNIVERSE) {
    sectorMap.set(stock.sectorToken, stock.sector);
  }

  return Array.from(sectorMap.entries()).map(([token, name]) => ({
    name,
    token,
  }));
}

// Validation helper
export function validateSymbol(symbol: string): UniverseStock | null {
  return UNIVERSE.find((s) => s.symbol === symbol) || null;
}
```

**Critical Notes:**

- ⚠️ Must verify ALL symbols using `scripts/validate-universe.ts` before deployment
- ⚠️ Pay special attention to: M&M, BAJAJ-AUTO, LT (not L&T)
- ⚠️ Total should be 100+ stocks for statistical significance

---

## 2. NEW FILE: `src/config/sectorTokens.ts`

**Purpose**: Centralized sector index token mapping

**Size**: ~50 lines

**Implementation**:

```typescript
/**
 * Sector Index Instrument Tokens
 * Source: NSE INDICES segment via KiteConnect
 *
 * CRITICAL: These are NOT tradingsymbols - they are instrument_token values
 * Use with kite.getQuote([token]) not kite.getQuote("NIFTY BANK")
 */

export const SECTOR_TOKENS: Record<string, number> = {
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
  "NIFTY CONSUMER DURABLES": 261641,
  "NIFTY REALTY": 260617,
};

// Type-safe accessor
export function getSectorToken(sectorName: string): number | null {
  return SECTOR_TOKENS[sectorName] || null;
}

// Reverse lookup (token → name)
export function getSectorName(token: number): string | null {
  const entry = Object.entries(SECTOR_TOKENS).find(([_, t]) => t === token);
  return entry ? entry[0] : null;
}
```

---

## 3. NEW FILE: `src/services/QuoteManager.ts`

**Purpose**: Centralized quote polling to avoid rate limit exhaustion

**Size**: ~200 lines

**Current Problem**: 3 strategies × 1 poll/sec = 3 API calls/sec (at threshold)

**Solution**: Single polling loop for all strategies

**Implementation**:

```typescript
import { Logger } from "../utils/Logger";

/**
 * QuoteManager - Centralized Quote Polling Service
 *
 * Problem: Multiple strategies polling independently = rate limit risk
 * Solution: Publisher-Subscriber pattern with single API call
 *
 * Benefits:
 * - Constant 1 API call/sec regardless of strategy count
 * - Auto-start when first subscriber registers
 * - Auto-stop when last subscriber unregisters
 * - Centralized error handling and retry logic
 */

type QuoteCallback = (quote: any) => void;

export class QuoteManager {
  private subscribers: Map<string, Set<QuoteCallback>> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  private consecutiveErrors: number = 0;
  private lastSuccessfulFetch: number = Date.now(); // ⚠️ OPTIMIZATION: Staleness detection

  constructor(
    private kiteConnect: any,
    private logger: Logger,
  ) {}

  /**
   * Subscribe to real-time quote updates
   * @param symbol - Trading symbol (e.g., "RELIANCE26FEB2500CE")
   * @param callback - Called with quote on each update
   */
  subscribe(symbol: string, callback: QuoteCallback): void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }

    this.subscribers.get(symbol)!.add(callback);

    this.logger.debug(
      `📊 QuoteManager: Subscribed to ${symbol} (Total symbols: ${this.subscribers.size})`,
    );

    // Auto-start polling when first subscriber registers
    if (!this.isPolling) {
      this.startPolling();
    }
  }

  /**
   * Unsubscribe from quote updates
   */
  unsubscribe(symbol: string, callback: QuoteCallback): void {
    const callbacks = this.subscribers.get(symbol);
    if (callbacks) {
      callbacks.delete(callback);

      // Remove symbol if no more subscribers
      if (callbacks.size === 0) {
        this.subscribers.delete(symbol);
        this.logger.debug(
          `📉 QuoteManager: Unsubscribed from ${symbol} (Remaining: ${this.subscribers.size})`,
        );
      }
    }

    // Auto-stop polling when all subscribers are gone
    if (this.subscribers.size === 0 && this.isPolling) {
      this.stopPolling();
    }
  }

  /**
   * Start polling loop
   */
  private startPolling(): void {
    if (this.isPolling) return;

    this.logger.info("🔄 QuoteManager: Starting polling loop");
    this.isPolling = true;
    this.consecutiveErrors = 0;

    this.pollingInterval = setInterval(async () => {
      await this.fetchAndPublish();
    }, 1000); // 1 second
  }

  /**
   * Stop polling loop
   */
  private stopPolling(): void {
    if (!this.isPolling) return;

    this.logger.info("⏸️ QuoteManager: Stopping polling loop (0 subscribers)");

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isPolling = false;
  }

  /**
   * Fetch quotes for all subscribed symbols and publish to callbacks
   */
  private async fetchAndPublish(): Promise<void> {
    const symbols = Array.from(this.subscribers.keys());

    if (symbols.length === 0) return;

    try {
      // SINGLE API CALL for all symbols
      const quotes = await this.kiteConnect.getQuote(symbols);

      // Publish updates to subscribers
      for (const [symbol, callbacks] of this.subscribers.entries()) {
        const quote = quotes[symbol];

        if (quote) {
          callbacks.forEach((cb) => {
            try {
              cb(quote);
            } catch (error) {
              this.logger.error(
                `Error in quote callback for ${symbol}:`,
                error,
              );
            }
          });
        } else {
          this.logger.warn(`No quote data received for ${symbol}`);
        }
      }

      // Reset error count on success
      this.consecutiveErrors = 0;
      this.lastSuccessfulFetch = Date.now(); // ⚠️ Update staleness timestamp
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.error(
        `QuoteManager polling error (${this.consecutiveErrors} consecutive):`,
        error,
      );

      // Circuit breaker
      if (this.consecutiveErrors >= 10) {
        this.logger.error(
          "🚨 QuoteManager: 10 consecutive errors, stopping polling",
        );
        this.stopPolling();
      }
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    isPolling: boolean;
    subscriberCount: number;
    symbols: string[];
    consecutiveErrors: number;
    dataStale: boolean; // ⚠️ OPTIMIZATION: Staleness indicator
    lastFetchAge: number; // Milliseconds since last successful fetch
  } {
    const now = Date.now();
    const lastFetchAge = now - this.lastSuccessfulFetch;
    const dataStale = lastFetchAge > 5000; // Stale if > 5 seconds

    if (dataStale && this.isPolling) {
      this.logger.warn(
        `⚠️ QuoteManager: Data feed stale (${(lastFetchAge / 1000).toFixed(1)}s since last update)`,
      );
    }

    return {
      isPolling: this.isPolling,
      subscriberCount: this.subscribers.size,
      symbols: Array.from(this.subscribers.keys()),
      consecutiveErrors: this.consecutiveErrors,
      dataStale,
      lastFetchAge,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info("QuoteManager: Shutting down...");
    this.stopPolling();
    this.subscribers.clear();
  }
}
```

**Integration Points:**

- Created in `src/index.ts` as singleton
- Injected into StrategyManager constructor
- Passed to each BollingerBandStrategy instance

---

## 4. NEW FILE: `src/services/MarketScanner.ts`

**Purpose**: TMV scoring engine to select top 3 stocks

**Size**: ~800 lines (complex, many indicators)

**Key Sections:**

### 4.1 Interface Definitions

```typescript
import { Logger } from "../utils/Logger";
import { UNIVERSE, UniverseStock } from "../config/universe";
import tulind from "tulind"; // Fast C++ indicator library

/**
 * MarketScanner - TMV (Trend, Momentum, Volume) Stock Selection
 *
 * Runs once daily at 09:30 AM
 * Scores 100+ stocks on 0-10 scale
 * Selects top 3 with score ≥7
 * Passes to StrategyManager for deployment
 */

export interface ScoredStock {
  symbol: string;
  score: number;
  bias: "LONG" | "SHORT";
  sector: string;
  sectorToken: number;
  breakdown: {
    trend: number; // Max 3.0
    momentum: number; // Max 3.0
    volume: number; // Max 2.0
    sector: number; // Max 2.0
  };
  spotPrice: number;
  atmOption: {
    tradingsymbol: string;
    strike: number;
    premium: number;
    expiry: Date;
  };
  historicalData: Candle[]; // Pass to strategy
  valid: boolean;
}

export interface ScannerResult {
  scanTime: Date;
  scannedCount: number;
  qualifiedCount: number;
  selected: ScoredStock[];
  greenSectors: string[];
  redSectors: string[];
  flatSectors: string[];
  failedStocks: string[];
}

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**⚠️ CRITICAL: Circular Dependency Prevention**

```typescript
/**
 * ARCHITECTURAL RULE: MarketScanner is a PURE SERVICE
 *
 * DO NOT import StrategyManager, StrategyRegistry, or any strategy classes.
 * MarketScanner only:
 * - Accepts data (kite, logger, config)
 * - Returns data (ScannerResult)
 * - Has zero knowledge of how data is consumed
 *
 * This prevents circular dependencies:
 * StrategyManager → MarketScanner ✅
 * MarketScanner → StrategyManager ❌ FORBIDDEN
 *
 * If you need shared types, create src/types/common.ts
 */
```

### 4.2 Constructor & Configuration

```typescript
export class MarketScanner {
  private universe: UniverseStock[] = UNIVERSE;
  private cachedHistoricalData: Map<string, Candle[]> = new Map();
  private isDataCached: boolean = false;

  constructor(
    private kiteConnect: any,
    private logger: Logger,
    private config: {
      minScore: number;          // 7.0
      topCount: number;          // 3
      minPremium: number;        // ₹10
      sectorChangeThreshold: {   // 0.25%
        green: number;
        red: number;
      };
    }
  ) {}

  /**
   * Main entry point - called by StrategyManager at 09:30 AM
   */
  async scanUniverse(): Promise<ScannerResult> {
    const startTime = Date.now();
    this.logger.info('🔍 MarketScanner: Starting universe scan...');

    try {
      // Step 1: Expiry day blackout check
      if (this.isStockTradingBlocked()) {
        this.logger.error('🚫 Stock options blocked (expiry week)');
        return this.emptyResult();
      }

      // Step 2: Sector filtering
      const sectorStatus = await this.analyzeSectors();
      const filteredStocks = this.filterBySector(sectorStatus);

      // Step 3: Score each stock
      const scoredStocks = await this.scoreStocks(filteredStocks, sectorStatus);

      // Step 4: Apply safety filters
      const safeStocks = this.applySafetyFilters(scoredStocks);

      // Step 5: Select top 3
      const topStocks = this.selectTopStocks(safeStocks);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info(`✅ Scanner completed in ${duration}s: ${topStocks.length}/3 selected`);

      return {
        scanTime: new Date(),
        scannedCount: filteredStocks.length,
        qualifiedCount: safeStocks.length,
        selected: topStocks,
        greenSectors: sectorStatus.green,
        redSectors: sectorStatus.red,
        flatSectors: sectorStatus.flat,
        failedStocks: [] // Track failed API calls
      };

    } catch (error) {
      this.logger.error('MarketScanner: Fatal error during scan:', error);
      return this.emptyResult();
    }
  }
```

### 4.3 Pre-Market Data Caching

```typescript
  /**
   * Pre-load historical data at 09:00 AM (before market open)
   * Called by StrategyManager's reactive auth logic
   */
  async cacheHistoricalData(): Promise<{ success: boolean; count: number }> {
    this.logger.info('📥 MarketScanner: Pre-loading historical data (10 days, 5-min)...');
    const startTime = Date.now();

    const results = await Promise.allSettled(
      this.universe.map(async (stock) => {
        try {
          // Fetch instrument token
          const instruments = await this.kiteConnect.getInstruments('NSE');
          const instrument = instruments.find((i: any) => i.tradingsymbol === stock.symbol);

          if (!instrument) {
            throw new Error(`Instrument not found: ${stock.symbol}`);
          }

          // Fetch 10 days of 5-min data
          const toDate = new Date();
          const fromDate = new Date();
          fromDate.setDate(fromDate.getDate() - 10);

          const candles = await this.kiteConnect.getHistoricalData(
            instrument.instrument_token,
            '5minute',
            fromDate,
            toDate
          );

          this.cachedHistoricalData.set(stock.symbol, candles);
          return { symbol: stock.symbol, success: true };

        } catch (error) {
          this.logger.warn(`Failed to cache ${stock.symbol}:`, error);
          return { symbol: stock.symbol, success: false };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');

    // Failure threshold check (20%)
    const failureRate = failed.length / results.length;
    if (failureRate > 0.2) {
      this.logger.error(`❌ Data cache failure rate: ${(failureRate * 100).toFixed(1)}% - ABORTING`);
      this.isDataCached = false;
      return { success: false, count: 0 };
    }

    this.isDataCached = true;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info(`✅ Cached ${successful}/${this.universe.length} stocks in ${duration}s`);

    return { success: true, count: successful };
  }

  /**
   * Check if data is ready
   */
  isReady(): boolean {
    return this.isDataCached;
  }

  /**
   * Clear cache (called at 15:35 PM for next day)
   */
  clearCache(): void {
    this.logger.info('🧹 MarketScanner: Clearing cached data');
    this.cachedHistoricalData.clear();
    this.isDataCached = false;
  }
```

### 4.4 Sector Analysis

```typescript
  /**
   * Step 1: Analyze sector performance
   * Returns: { green: [], red: [], flat: [] }
   */
  private async analyzeSectors(): Promise<{
    green: string[];
    red: string[];
    flat: string[];
    data: Map<number, { name: string; changePercent: number }>;
  }> {
    this.logger.info('📊 Analyzing sector performance...');

    // Get unique sector tokens
    const sectors = Array.from(new Set(this.universe.map(s => s.sectorToken)));

    // Batch fetch sector quotes (SINGLE API CALL)
    const quotes = await this.kiteConnect.getQuote(sectors.map(t => `NSE:${t}`));

    const green: string[] = [];
    const red: string[] = [];
    const flat: string[] = [];
    const data = new Map<number, { name: string; changePercent: number }>();

    for (const stock of this.universe) {
      const quote = quotes[`NSE:${stock.sectorToken}`];
      if (!quote) continue;

      const changePercent = quote.net_change_percent || 0;
      data.set(stock.sectorToken, { name: stock.sector, changePercent });

      if (changePercent > this.config.sectorChangeThreshold.green) {
        if (!green.includes(stock.sector)) green.push(stock.sector);
      } else if (changePercent < this.config.sectorChangeThreshold.red) {
        if (!red.includes(stock.sector)) red.push(stock.sector);
      } else {
        if (!flat.includes(stock.sector)) flat.push(stock.sector);
      }
    }

    this.logger.info(`Sectors - Green: ${green.length}, Red: ${red.length}, Flat: ${flat.length}`);
    return { green, red, flat, data };
  }

  /**
   * Filter stocks based on sector direction
   */
  private filterBySector(sectorStatus: any): UniverseStock[] {
    return this.universe.filter(stock => {
      // Skip flat sectors (avoid chop)
      if (sectorStatus.flat.includes(stock.sector)) {
        return false;
      }
      return true; // Keep green and red sectors
    });
  }
```

### 4.5 TMV Scoring (Core Algorithm)

```typescript
  /**
   * Step 2: Score each stock using TMV algorithm
   */
  private async scoreStocks(
    stocks: UniverseStock[],
    sectorStatus: any
  ): Promise<ScoredStock[]> {
    this.logger.info(`📈 Scoring ${stocks.length} stocks...`);

    const results: ScoredStock[] = [];

    for (const stock of stocks) {
      try {
        // Get cached historical data
        const candles = this.cachedHistoricalData.get(stock.symbol);
        if (!candles || candles.length < 50) {
          this.logger.warn(`${stock.symbol}: Insufficient data (${candles?.length || 0} candles)`);
          continue;
        }

        // Derive 15-min candles from 5-min
        const candles15m = this.derive15MinCandles(candles);

        // Calculate indicators
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const volumes = candles.map(c => c.volume);

        // EMA (8, 21, 50)
        const ema8 = await this.calculateEMA(closes, 8);
        const ema21 = await this.calculateEMA(closes, 21);
        const ema50 = await this.calculateEMA(closes, 50);

        // RSI (14 period, 5-min and 15-min)
        const rsi5m = await this.calculateRSI(closes, 14);
        const rsi15m = await this.calculateRSI(candles15m.map(c => c.close), 14);

        // ADX (14 period)
        const adx = await this.calculateADX(highs, lows, closes, 14);

        // VWAP
        const vwap = this.calculateVWAP(candles);

        // Relative Volume
        const rvol = this.calculateRVOL(candles, candles15m);

        // Spot price (last close)
        const spotPrice = closes[closes.length - 1];

        // Sector data
        const sectorData = sectorStatus.data.get(stock.sectorToken);
        const sectorChange = sectorData?.changePercent || 0;

        // Determine bias based on sector
        let bias: 'LONG' | 'SHORT' | null = null;
        if (sectorStatus.green.includes(stock.sector)) {
          bias = 'LONG';
        } else if (sectorStatus.red.includes(stock.sector)) {
          bias = 'SHORT';
        }

        if (!bias) continue; // Flat sector, skip

        // === SCORING LOGIC ===
        let score = 0;
        const breakdown = { trend: 0, momentum: 0, volume: 0, sector: 0 };

        // A. TREND (Max 3.0)
        if (bias === 'LONG') {
          if (spotPrice > vwap) breakdown.trend += 1.5;
          if (spotPrice > ema8 && ema8 > ema21) breakdown.trend += 1.5;
        } else { // SHORT
          if (spotPrice < vwap) breakdown.trend += 1.5;
          if (spotPrice < ema8 && ema8 < ema21) breakdown.trend += 1.5;
        }

        // B. MOMENTUM (Max 3.0)
        if (bias === 'LONG') {
          if (rsi5m > 60 && rsi5m < 85) breakdown.momentum += 2.0;
          if (rsi5m > rsi15m) breakdown.momentum += 1.0;
        } else { // SHORT
          if (rsi5m < 40 && rsi5m > 15) breakdown.momentum += 2.0;
          if (rsi5m < rsi15m) breakdown.momentum += 1.0;
        }

        // ADX (direction agnostic)
        if (adx > 25) breakdown.momentum += 1.0;

        // C. VOLUME (Max 2.0)
        if (rvol > 3.0) breakdown.volume += 2.0;
        else if (rvol > 2.0) breakdown.volume += 1.0;

        // D. SECTOR CONFLUENCE (Max 2.0)
        breakdown.sector += 1.0; // Base point for sector direction match

        // Relative strength check
        const stockChange = ((spotPrice - candles[0].close) / candles[0].close) * 100;
        if (bias === 'LONG' && stockChange > sectorChange) {
          breakdown.sector += 1.0; // Outperforming sector
        } else if (bias === 'SHORT' && stockChange < sectorChange) {
          breakdown.sector += 1.0; // Underperforming sector
        }

        // Total score
        score = breakdown.trend + breakdown.momentum + breakdown.volume + breakdown.sector;

        // Create scored stock object
        results.push({
          symbol: stock.symbol,
          score,
          bias,
          sector: stock.sector,
          sectorToken: stock.sectorToken,
          breakdown,
          spotPrice,
          atmOption: null as any, // Filled later
          historicalData: candles,
          valid: true
        });

      } catch (error) {
        this.logger.error(`Failed to score ${stock.symbol}:`, error);
      }
    }

    return results;
  }
```

### 4.6 Safety Filters

```typescript
  /**
   * Step 3: Apply safety filters
   */
  private applySafetyFilters(stocks: ScoredStock[]): ScoredStock[] {
    return stocks.filter(stock => {
      const candles = stock.historicalData;
      const lastCandle = candles[candles.length - 1];
      const prevCandle = candles[candles.length - 2];

      // 1. Minimum score threshold
      if (stock.score < this.config.minScore) {
        this.logger.debug(`${stock.symbol}: Score too low (${stock.score.toFixed(2)})`);
        return false;
      }

      // 2. RSI exhaustion check
      const closes = candles.map(c => c.close);
      const rsi = await this.calculateRSI(closes, 14);
      if (rsi > 85) {
        this.logger.warn(`${stock.symbol}: RSI exhaustion (${rsi.toFixed(1)}) - DISCARD`);
        return false;
      }

      // 3. Gap-up trap
      const gapPercent = ((lastCandle.open - prevCandle.close) / prevCandle.close) * 100;
      if (Math.abs(gapPercent) > 2.0) {
        this.logger.warn(`${stock.symbol}: Gap ${gapPercent.toFixed(2)}% - DISCARD`);
        return false;
      }

      // 4. Circuit limit check
      // (Requires additional API call for circuit limits - skip for now)

      return true;
    });
  }
```

### 4.7 Option Selection & Final Selection

```typescript
  /**
   * Step 4: Select top N stocks and find ATM options
   */
  private async selectTopStocks(stocks: ScoredStock[]): Promise<ScoredStock[]> {
    // Sort by score descending
    const sorted = stocks.sort((a, b) => b.score - a.score);

    // Take top N
    const topStocks = sorted.slice(0, this.config.topCount);

    // Find ATM options for each
    for (const stock of topStocks) {
      try {
        const atmOption = await this.findATMOption(
          stock.symbol,
          stock.spotPrice,
          stock.bias
        );

        // Premium floor check
        if (atmOption.premium < this.config.minPremium) {
          this.logger.warn(`${stock.symbol}: Premium too low (₹${atmOption.premium}) - DISCARD`);
          stock.valid = false;
          continue;
        }

        stock.atmOption = atmOption;

      } catch (error) {
        this.logger.error(`Failed to find option for ${stock.symbol}:`, error);
        stock.valid = false;
      }
    }

    // Filter out invalid
    return topStocks.filter(s => s.valid);
  }

  /**
   * Find ATM option for stock
   */
  private async findATMOption(
    symbol: string,
    spotPrice: number,
    type: 'LONG' | 'SHORT'
  ): Promise<{ tradingsymbol: string; strike: number; premium: number; expiry: Date }> {
    // Get current month last Tuesday expiry
    const expiry = this.getCurrentMonthLastTuesday();

    // Fetch all stock options for this expiry
    const instruments = await this.kiteConnect.getInstruments('NFO');
    const options = instruments.filter((i: any) =>
      i.name === symbol &&
      i.segment === 'NFO-OPT' &&
      new Date(i.expiry).toDateString() === expiry.toDateString()
    );

    // Find ATM strike (closest to spot)
    let atmStrike = this.findClosestStrike(spotPrice, options.map((o: any) => o.strike));

    // Select CE or PE based on bias
    const optionType = type === 'LONG' ? 'CE' : 'PE';
    const atmOption = options.find((o: any) =>
      o.strike === atmStrike &&
      o.instrument_type === optionType
    );

    if (!atmOption) {
      throw new Error(`ATM option not found: ${symbol} ${atmStrike}${optionType}`);
    }

    // Get current premium
    const quote = await this.kiteConnect.getQuote([`NFO:${atmOption.tradingsymbol}`]);
    const premium = quote[`NFO:${atmOption.tradingsymbol}`].last_price;

    return {
      tradingsymbol: atmOption.tradingsymbol,
      strike: atmStrike,
      premium,
      expiry
    };
  }

  /**
   * Get current month's last Tuesday
   */
  private getCurrentMonthLastTuesday(): Date {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    // Get last day of current month
    const lastDay = new Date(year, month + 1, 0);

    // Find last Tuesday (2 = Tuesday)
    let lastTuesday = lastDay;
    while (lastTuesday.getDay() !== 2) {
      lastTuesday.setDate(lastTuesday.getDate() - 1);
    }

    // If today > last Tuesday, move to next month
    if (today > lastTuesday) {
      const nextMonth = new Date(year, month + 2, 0);
      while (nextMonth.getDay() !== 2) {
        nextMonth.setDate(nextMonth.getDate() - 1);
      }
      return nextMonth;
    }

    return lastTuesday;
  }

  /**
   * Expiry day blackout check
   */
  private isStockTradingBlocked(): boolean {
    const today = new Date();
    const expiry = this.getCurrentMonthLastTuesday();
    const daysToExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysToExpiry <= 0) {
      this.logger.error('🚫 Expiry Day (Tuesday) - Stock options blocked');
      return true;
    }

    if (daysToExpiry === 1) {
      this.logger.error('🚫 Day before expiry (Monday) - Physical settlement margins active');
      return true;
    }

    if (daysToExpiry === 2) {
      this.logger.warn('⚠️ 2 days to expiry (Friday) - Liquidity check required');
      // Continue with enhanced liquidity filter
    }

    return false;
  }

  // ... Helper methods for indicators (calculateEMA, calculateRSI, etc.)
}
```

**Dependencies:**

- `tulind` package: `npm install tulind @types/tulind`
- Fast C++ library for indicators

---

## 5. MODIFY: `src/core/StrategyManager.ts`

**Current Size**: 391 lines  
**Changes**: +300 lines (scanner integration + pre-market logic)

### Changes Required:

**5.1 Add Scanner and QuoteManager Properties**

```typescript
// Add to class properties (around line 15)
private marketScanner: MarketScanner;
private quoteManager: QuoteManager;
private preMarketCheckInterval: NodeJS.Timeout | null = null;
private needsPreMarketFetch: boolean = false;
private isDataCached: boolean = false;
```

**5.2 Modify Constructor**

```typescript
// Modify constructor (around line 30)
constructor(
  private kiteConnect: any,
  private authService: AuthService,  // NEW: Add AuthService
  private logger: Logger,
  private quoteManager: QuoteManager,  // NEW: Inject QuoteManager
  private options: StrategyManagerOptions = {}
) {
  this.configPath = options.configPath || path.join(__dirname, '../../config/strategies.json');
  this.autoStart = options.autoStart ?? true;
  this.healthCheckInterval = options.healthCheckInterval || 30000;

  // Initialize MarketScanner
  this.marketScanner = new MarketScanner(
    this.kiteConnect,
    this.logger,
    {
      minScore: 7.0,
      topCount: 3,
      minPremium: 10,
      sectorChangeThreshold: { green: 0.25, red: -0.25 }
    }
  );
}
```

**5.3 Add Pre-Market Data Fetching Logic**

```typescript
// Add new method (after initialize())
private schedulePreMarketCheck(): void {
  this.logger.info('📅 Scheduling pre-market data fetch checks');

  // Run every minute starting at 09:00 AM
  this.preMarketCheckInterval = setInterval(async () => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    // Check if it's 09:00 AM
    if (currentTime === 540 && !this.isDataCached) {
      if (this.authService.isAuthenticated()) {
        this.logger.info('🕘 09:00 AM: Auth valid, fetching pre-market data');
        await this.fetchPreMarketData();
      } else {
        this.logger.info('⏳ 09:00 AM: Waiting for login...');
        this.needsPreMarketFetch = true;
      }
    }

    // Continuous check between 09:00-09:30
    if (currentTime > 540 && currentTime < 570 && this.needsPreMarketFetch) {
      if (this.authService.isAuthenticated()) {
        this.logger.info('✅ Login detected, fetching pre-market data now');
        await this.fetchPreMarketData();
        this.needsPreMarketFetch = false;
      }
    }

    // Abort check if logged in after 09:30
    if (currentTime >= 570 && !this.isDataCached) {
      this.logger.error('🚫 Login after 09:30 - Scanner aborted');
      this.needsPreMarketFetch = false;
      clearInterval(this.preMarketCheckInterval!);
    }

    // ⚠️ CRITICAL: EOD Cache Reset (Prevents "Forever Cache" bug on multi-day runs)
    // TIMING SEPARATION:
    //   15:28 PM → Strategies exit positions (BollingerBandStrategy.scheduleEODExit)
    //   15:35 PM → StrategyManager cleans up cache (7-minute safety gap)
    // This ensures strategies complete their exits before cache is cleared.
    if (currentTime === 935) { // 15:35 PM (5 minutes post-market)
      this.logger.info('🧹 Post-market cleanup: Resetting cache for next day');
      this.isDataCached = false;
      this.needsPreMarketFetch = false;
      this.marketScanner.clearCache();

      // Optional: Trigger garbage collection if available
      if (global.gc) {
        global.gc();
        this.logger.debug('♻️ Garbage collection triggered');
      }
    }

  }, 60000); // Check every minute
}

private async fetchPreMarketData(): Promise<void> {
  try {
    this.logger.info('📊 Fetching pre-market historical data...');
    const result = await this.marketScanner.cacheHistoricalData();

    if (result.success) {
      this.isDataCached = true;
      this.logger.info(`✅ Pre-market data cached: ${result.count} stocks ready`);
    } else {
      this.logger.error('❌ Pre-market data fetch failed');
      this.isDataCached = false;
    }
  } catch (error) {
    this.logger.error('Failed to fetch pre-market data:', error);
    this.isDataCached = false;
  }
}
```

**5.4 Add Scanner Trigger at 09:30 AM**

```typescript
// Add new method
private scheduleScanner(): void {
  this.logger.info('📅 Scheduling market scanner for 09:30 AM');

  const scheduleNextScan = () => {
    const now = new Date();
    const scanTime = new Date(now);
    scanTime.setHours(9, 30, 5, 0); // 09:30:05 AM

    // If already past today's scan time, schedule for tomorrow
    if (now >= scanTime) {
      scanTime.setDate(scanTime.getDate() + 1);
    }

    const delay = scanTime.getTime() - now.getTime();

    this.logger.info(`Next scan scheduled for: ${scanTime.toLocaleString()} (in ${(delay/1000/60).toFixed(0)} minutes)`);

    setTimeout(async () => {
      await this.runScanner();
      scheduleNextScan(); // Reschedule for next day
    }, delay);
  };

  scheduleNextScan();
}

private async runScanner(): Promise<void> {
  try {
    this.logger.info('🔍 09:30 AM: Running market scanner...');

    // Data integrity check
    if (!this.isDataCached) {
      this.logger.warn('⏳ Data not cached, waiting 5 seconds...');
      await this.sleep(5000);

      if (!this.isDataCached) {
        this.logger.error('❌ Scanner aborted: Data not available');
        return;
      }
    }

    // Run scanner
    const result = await this.marketScanner.scanUniverse();

    // Log results
    this.logger.info(`Scanner Results:`);
    this.logger.info(`  Scanned: ${result.scannedCount} stocks`);
    this.logger.info(`  Qualified: ${result.qualifiedCount} (score ≥7)`);
    this.logger.info(`  Selected: ${result.selected.length}/3`);
    this.logger.info(`  Green Sectors: ${result.greenSectors.join(', ')}`);
    this.logger.info(`  Red Sectors: ${result.redSectors.join(', ')}`);

    // Deploy strategies
    if (result.selected.length === 0) {
      this.logger.info('📭 No stocks qualified today. Bot in standby mode.');
      return;
    }

    await this.deployMultipleStrategies(result.selected);

  } catch (error) {
    this.logger.error('Failed to run scanner:', error);
  }
}

private async deployMultipleStrategies(stocks: ScoredStock[]): Promise<void> {
  this.logger.info(`🚀 Deploying ${stocks.length} strategy instances...`);

  const successful: string[] = [];
  const failures: Array<{symbol: string; error: string}> = [];

  for (const stock of stocks) {
    try {
      // Clone template config
      const config: StrategyConfig = {
        id: `bollinger-${stock.symbol.toLowerCase()}`,
        name: `Bollinger Band - ${stock.symbol}`,
        enabled: true,
        description: `Scanner: ${stock.score.toFixed(2)} | Bias: ${stock.bias}`,
        timeframe: '5min',
        instruments: [stock.symbol],
        riskPerTrade: 0.8,
        maxPositions: 1,
        config: {
          period: 20,
          stdDev: 2.0,
          trailType: 'percentage',
          trailValue: 1.5,
          // Scanner-specific data
          scannerData: {
            score: stock.score,
            bias: stock.bias,
            sector: stock.sector,
            atmOption: stock.atmOption,
            historicalData: stock.historicalData
          },
          capitalAllocation: 65000 // ₹65k per strategy
        }
      };

      // Create strategy instance
      const strategy = await StrategyRegistry.createInstance(
        'bollinger-band',
        this.kiteConnect,
        this.logger,
        this.quoteManager,  // Pass QuoteManager
        config
      );

      // Start strategy
      await strategy.start();

      successful.push(stock.symbol);
      this.logger.info(`✅ ${stock.symbol}: Strategy deployed`);

    } catch (error) {
      failures.push({
        symbol: stock.symbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.logger.error(`❌ ${stock.symbol}: Deployment failed - ${error}`);
    }
  }

  // Summary
  this.logger.info(`📊 Deployment Summary: ${successful.length}/${stocks.length} successful`);

  if (failures.length > 0) {
    this.logger.warn(`⚠️ Failures: ${failures.map(f => f.symbol).join(', ')}`);
  }
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**5.5 Call New Methods in initialize()**

```typescript
// Modify initialize() method (around line 50)
async initialize(): Promise<void> {
  this.logger.info('Initializing StrategyManager...');

  // ... existing code ...

  // NEW: Schedule pre-market checks
  this.schedulePreMarketCheck();

  // NEW: Schedule scanner
  this.scheduleScanner();

  this.logger.info(`StrategyManager initialized with ${this.strategies.size} strategies`);
}
```

---

## 6. MODIFY: `src/core/StrategyRegistry.ts`

**Current Size**: 200 lines  
**Changes**: Update factory method signature to accept QuoteManager

### Critical Modification:

**⚠️ COMPILATION BLOCKER**: Without this change, the code will fail to compile because BollingerBandStrategy constructor expects `quoteManager` parameter but StrategyRegistry doesn't pass it.

**6.1 Update createInstance Method Signature**

```typescript
// Around line 50 - Modify createInstance signature
public static async createInstance(
  strategyType: string,
  kiteConnect: any,
  logger: Logger,
  quoteManager: QuoteManager,  // NEW: Add QuoteManager parameter
  config: StrategyConfig
): Promise<StrategyBase> {
  const StrategyClass = this.strategies.get(strategyType);

  if (!StrategyClass) {
    throw new Error(`Strategy type '${strategyType}' not registered`);
  }

  logger.info(`Creating strategy instance: ${config.id} (${strategyType})`);

  try {
    // Create instance with QuoteManager
    const instance = new StrategyClass(
      config,
      kiteConnect,
      logger,
      quoteManager  // NEW: Pass QuoteManager to strategy constructor
    );

    // ... rest of existing code ...
  } catch (error) {
    logger.error(`Failed to create strategy instance '${config.id}':`, error);
    throw error;
  }
}
```

**6.2 Update All Call Sites**

Every location that calls `StrategyRegistry.createInstance()` must be updated:

```typescript
// OLD (will fail):
const strategy = await StrategyRegistry.createInstance(
  "bollinger-band",
  this.kiteConnect,
  this.logger,
  config,
);

// NEW (correct):
const strategy = await StrategyRegistry.createInstance(
  "bollinger-band",
  this.kiteConnect,
  this.logger,
  this.quoteManager, // NEW: Pass QuoteManager
  config,
);
```

**Locations to Update:**

- `src/core/StrategyManager.ts` (line ~120 in initialize method)
- `src/core/StrategyManager.ts` (line ~200 in deployMultipleStrategies method)
- Any other manual strategy instantiation code

**6.3 Update Type Signature**

```typescript
// Around line 10 - Update StrategyConstructor type
type StrategyConstructor = new (
  config: StrategyConfig,
  kiteConnect: any,
  logger: Logger,
  quoteManager: QuoteManager, // NEW: Add to type signature
) => StrategyBase;
```

---

## 7. MODIFY: `src/strategies/bollinger-band/BollingerBandStrategy.ts`

**Current Size**: 3,895 lines  
**Changes**: Modify ~20 locations, add stock option support

### Key Modifications:

**7.1 Add QuoteManager to Constructor**

```typescript
// Around line 100
constructor(
  config: StrategyConfig,
  private kiteConnect: any,
  logger: Logger,
  private quoteManager: QuoteManager  // NEW: Add QuoteManager
) {
  super(config, logger);
  // ... rest of constructor
}
```

**7.2 Modify Option Selection for Stocks**

```typescript
// Around line 800 - Replace selectOption() method
private async selectOption(
  type: 'CE' | 'PE'
): Promise<{ instrument: any; premium: number }> {
  try {
    // Check if this is a stock or index
    const isIndex = this.config.instruments[0] === 'NIFTY' ||
                    this.config.instruments[0] === 'BANKNIFTY';

    if (isIndex) {
      // EXISTING NIFTY logic (keep as-is)
      return await this.selectIndexOption(type);
    } else {
      // NEW: Stock option logic
      return await this.selectStockOption(type);
    }
  } catch (error) {
    this.logger.error('Failed to select option:', error);
    throw error;
  }
}

private async selectStockOption(
  type: 'CE' | 'PE'
): Promise<{ instrument: any; premium: number }> {
  const symbol = this.config.instruments[0];

  // If scanner provided ATM option, use it
  if (this.config.config.scannerData?.atmOption) {
    const atmOption = this.config.config.scannerData.atmOption;

    // Fetch current instrument details
    const instruments = await this.kiteConnect.getInstruments('NFO');
    const instrument = instruments.find((i: any) =>
      i.tradingsymbol === atmOption.tradingsymbol
    );

    if (!instrument) {
      throw new Error(`Option not found: ${atmOption.tradingsymbol}`);
    }

    // Get current premium
    const quote = await this.kiteConnect.getQuote([`NFO:${atmOption.tradingsymbol}`]);
    const premium = quote[`NFO:${atmOption.tradingsymbol}`].last_price;

    this.logger.info(`Selected scanner ATM: ${atmOption.tradingsymbol} @ ₹${premium}`);
    return { instrument, premium };
  }

  // Fallback: Find ATM option manually
  // ... (implement same logic as MarketScanner.findATMOption)
}

// Keep existing selectIndexOption() method for NIFTY
private async selectIndexOption(type: 'CE' | 'PE'): Promise<any> {
  // EXISTING NIFTY CODE - NO CHANGES
}
```

**7.3 Use Pre-Loaded Historical Data**

```typescript
// Around line 300 - Modify loadHistoricalDataWithFallback()
private async loadHistoricalDataWithFallback(): Promise<void> {
  try {
    // Check if scanner provided historical data
    if (this.config.config.scannerData?.historicalData) {
      this.logger.info('Using pre-loaded historical data from scanner');
      this.candleHistory = this.config.config.scannerData.historicalData;
      return;
    }

    // Fallback: Fetch from API (for NIFTY or manual starts)
    this.logger.info('Fetching historical data from API...');
    // ... existing API fetch code ...
  } catch (error) {
    this.logger.error('Failed to load historical data:', error);
    throw error;
  }
}
```

**7.4 Integrate QuoteManager for Position Monitoring**

```typescript
// Around line 2000 - Replace startPollingBasedMonitoring()
private startPollingBasedMonitoring(): void {
  if (!this.currentPosition) return;

  const instrument = this.currentPosition.instrument.tradingsymbol;

  this.logger.info(`Starting position monitoring via QuoteManager: ${instrument}`);

  // Create bound callback
  this.premiumCallback = (quote: any) => {
    this.handlePremiumUpdate(quote.last_price);
  };

  // Subscribe to QuoteManager
  this.quoteManager.subscribe(`NFO:${instrument}`, this.premiumCallback);
}

private handlePremiumUpdate(premium: number): void {
  if (!this.currentPosition) return;

  // Update trailing SL
  if (premium > this.currentPosition.highestPremium) {
    this.currentPosition.highestPremium = premium;
    this.currentPosition.trailingSL = premium * 0.88; // 12%

    this.logger.debug(`New high: ₹${premium} | Trail SL: ₹${this.currentPosition.trailingSL.toFixed(2)}`);
  }

  // Check stop loss
  if (premium <= this.currentPosition.trailingSL) {
    this.logger.info(`🛑 12% Trailing SL hit: Premium ₹${premium} ≤ SL ₹${this.currentPosition.trailingSL}`);
    this.exitPosition('12% Trailing SL Hit');
  }

  // Time decay check (SHORT positions only)
  if (this.currentPosition.type === 'SHORT') {
    const timeSinceHigh = Date.now() - (this.currentPosition.timeDecayTrailing?.lastHighTime.getTime() || 0);
    const minutes = timeSinceHigh / 1000 / 60;

    if (minutes > 15) {
      this.logger.info(`⏰ Time decay exit: No new high for ${minutes.toFixed(1)} minutes`);
      this.exitPosition('Time Decay - 15 min no new high');
    }
  }
}

// Modify exitPosition() to unsubscribe
private async exitPosition(reason: string): Promise<void> {
  // ... existing exit logic ...

  // Unsubscribe from QuoteManager
  if (this.currentPosition && this.premiumCallback) {
    const instrument = this.currentPosition.instrument.tradingsymbol;
    this.quoteManager.unsubscribe(`NFO:${instrument}`, this.premiumCallback);
    this.logger.info(`Unsubscribed from QuoteManager: ${instrument}`);
  }

  // ... rest of exit logic ...
}
```

**7.5 Enforce Direction Bias from Scanner**

```typescript
// Around line 1500 - Modify signal detection
private async checkForLongSignal(): Promise<void> {
  // Check if scanner enforced LONG-only
  if (this.config.config.scannerData?.bias === 'SHORT') {
    this.logger.debug('LONG signal ignored: Scanner bias is SHORT');
    return;
  }

  // ... existing LONG signal logic ...
}

private async checkForShortSignal(): Promise<void> {
  // Check if scanner enforced SHORT-only
  if (this.config.config.scannerData?.bias === 'LONG') {
    this.logger.debug('SHORT signal ignored: Scanner bias is LONG');
    return;
  }

  // ... existing SHORT signal logic ...
}
```

**7.6 Add Capital Allocation Override**

```typescript
// Around line 150 - Modify constructor
constructor(config: StrategyConfig, ...) {
  super(config, logger);

  // Override capital if scanner provided allocation
  if (config.config.capitalAllocation) {
    this.currentCapital = config.config.capitalAllocation;
    this.logger.info(`Capital allocated: ₹${this.currentCapital.toLocaleString()}`);
  } else {
    this.currentCapital = 200000; // Default
  }

  // ... rest of constructor ...
}
```

---

## 8. MODIFY: `src/index.ts`

**Current Size**: 831 lines  
**Changes**: +100 lines (QuoteManager injection, dashboard updates)

### Modifications:

**8.1 Add QuoteManager Creation**

```typescript
// Around line 30 - After AuthService creation
constructor() {
  this.logger = new Logger();
  this.app = express();

  // ... KiteConnect setup ...

  this.authService = new AuthService(this.kiteConnect, this.logger);

  // NEW: Create QuoteManager singleton
  this.quoteManager = new QuoteManager(this.kiteConnect, this.logger);

  // Create StrategyManager with dependencies
  const configPath = path.join(__dirname, '..', 'config', 'strategies.json');
  this.strategyManager = new StrategyManager(
    this.kiteConnect,
    this.authService,  // NEW: Pass AuthService
    this.logger,
    this.quoteManager,  // NEW: Pass QuoteManager
    {
      configPath,
      autoStart: false,
      healthCheckInterval: 30000
    }
  );

  this.setupRoutes();
}
```

**8.2 Add QuoteManager Stats Endpoint**

```typescript
// Add new route (around line 150)
this.app.get("/api/quote-manager/stats", (req: Request, res: Response) => {
  try {
    const stats = this.quoteManager.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    this.logger.error("Failed to get QuoteManager stats:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});
```

**8.3 Modify Dashboard to Show Multi-Strategy**

```typescript
// Around line 200 - Modify main dashboard route
this.app.get("/", async (req: Request, res: Response) => {
  const isAuth = await this.authService.isAuthenticatedAndValid();
  const strategies = await this.strategyManager.getAllStrategyStatuses();

  // Calculate aggregate stats
  let totalPnL = 0;
  let activeCount = 0;

  for (const [_, status] of strategies) {
    totalPnL += status.metrics.profitLoss || 0;
    if (status.metrics.isActive) activeCount++;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Multi-Stock Trading Bot</title>
      <style>
        /* ... existing styles ... */
        
        .strategy-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }
        
        .strategy-card {
          background: rgba(255,255,255,0.1);
          padding: 20px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.2);
        }
        
        .strategy-card.active {
          border-color: #4CAF50;
        }
      </style>
    </head>
    <body>
      <h1>🤖 Multi-Stock Trading Bot</h1>
      
      <div class="aggregate-stats">
        <h2>Aggregate Stats</h2>
        <p>Active Strategies: ${activeCount}/${strategies.size}</p>
        <p>Total P&L: ₹${totalPnL.toLocaleString()}</p>
        <p>Authentication: ${isAuth ? "✅ Valid" : "❌ Required"}</p>
      </div>
      
      <div class="strategy-grid">
        ${Array.from(strategies.entries())
          .map(
            ([id, status]) => `
          <div class="strategy-card ${status.metrics.isActive ? "active" : ""}">
            <h3>${status.config.name}</h3>
            <p>Symbol: ${status.config.instruments.join(", ")}</p>
            <p>Status: ${status.metrics.isActive ? "🟢 Active" : "⚪ Stopped"}</p>
            <p>P&L: ₹${(status.metrics.profitLoss || 0).toLocaleString()}</p>
            <p>Trades: ${status.metrics.totalTrades}</p>
            <a href="/strategy/${id}">View Details</a>
          </div>
        `,
          )
          .join("")}
      </div>
      
      <div class="actions">
        ${!isAuth ? '<a href="/auth/login" class="btn">🔑 Login</a>' : ""}
        <a href="/strategies" class="btn">📊 API Status</a>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});
```

---

## 9. MODIFY: `config/strategies.json`

**Current**: Single NIFTY strategy configuration  
**Change**: Add template structure

```json
{
  "templates": {
    "bollinger-stock-template": {
      "name": "Bollinger Band Stock Template",
      "description": "Template for scanner-deployed stock strategies",
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
      "id": "bollinger-nifty-manual",
      "name": "Bollinger Band - NIFTY (Manual)",
      "enabled": false,
      "description": "Manual NIFTY strategy (disabled during scanner mode)",
      "timeframe": "5min",
      "instruments": ["NIFTY"],
      "riskPerTrade": 0.8,
      "maxPositions": 1,
      "config": {
        "period": 20,
        "stdDev": 2.0,
        "trailType": "percentage",
        "trailValue": 1.5,
        "capitalAllocation": 200000
      }
    }
  ],
  "global": {
    "autoStart": false,
    "healthCheckInterval": 30000,
    "scannerMode": true,
    "logging": {
      "level": "info",
      "separateFiles": true
    }
  }
}
```

---

## 10. NEW FILE: `data/trading-data.json`

**Purpose**: Unified multi-strategy P&L tracking

**Initial Structure**:

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
      "pnl": 0,
      "trades": [],
      "activePosition": null
    },
    "bollinger-tcs": {
      "symbol": "TCS",
      "bias": "LONG",
      "scanScore": 8.2,
      "allocatedCapital": 65000,
      "pnl": 0,
      "trades": [],
      "activePosition": null
    },
    "bollinger-hdfcbank": {
      "symbol": "HDFCBANK",
      "bias": "SHORT",
      "scanScore": 7.8,
      "allocatedCapital": 65000,
      "pnl": 0,
      "trades": [],
      "activePosition": null
    }
  },
  "dailySummary": {
    "totalPnL": 0,
    "tradesExecuted": 0,
    "strategiesActive": 3,
    "winRate": 0
  }
}
```

---

## 11. NEW FILE: `tests/services/MarketScanner.test.ts`

**Purpose**: Unit tests for critical scanner functions

```typescript
import { MarketScanner } from "../../src/services/MarketScanner";
import { Logger } from "../../src/utils/Logger";

describe("MarketScanner", () => {
  let scanner: MarketScanner;
  let mockKite: any;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger();
    mockKite = {
      getQuote: jest.fn(),
      getInstruments: jest.fn(),
      getHistoricalData: jest.fn(),
    };

    scanner = new MarketScanner(mockKite, logger, {
      minScore: 7.0,
      topCount: 3,
      minPremium: 10,
      sectorChangeThreshold: { green: 0.25, red: -0.25 },
    });
  });

  describe("getCurrentMonthLastTuesday", () => {
    it("should return last Tuesday of current month", () => {
      const result = (scanner as any).getCurrentMonthLastTuesday();
      expect(result.getDay()).toBe(2); // Tuesday
    });

    it("should move to next month if today > last Tuesday", () => {
      // Test implementation
    });
  });

  describe("isStockTradingBlocked", () => {
    it("should block trading on expiry day (Tuesday)", () => {
      // Mock date to be last Tuesday
      const result = (scanner as any).isStockTradingBlocked();
      // Assert based on mock date
    });

    it("should block trading day before expiry (Monday)", () => {
      // Test implementation
    });
  });

  describe("Symbol Extraction Regex", () => {
    it("should extract M&M correctly", () => {
      const result = extractStockSymbol("M&M26FEB2500CE");
      expect(result).toBe("M&M");
    });

    it("should extract BAJAJ-AUTO correctly", () => {
      const result = extractStockSymbol("BAJAJ-AUTO26FEB2500CE");
      expect(result).toBe("BAJAJ-AUTO");
    });

    it("should extract LT correctly (not L&T)", () => {
      const result = extractStockSymbol("LT26FEB2500CE");
      expect(result).toBe("LT");
    });
  });
});

function extractStockSymbol(optionSymbol: string): string {
  const match = optionSymbol.match(/^([A-Z&-]+)\d{2}[A-Z]{3}/);
  return match ? match[1] : optionSymbol;
}
```

---

## 📊 Implementation Phases

### Phase 1: Foundation (Day 1) - 8 hours

**Deliverables:**

- ✅ Create `universe.ts` with 100+ stocks
- ✅ Create `sectorTokens.ts`
- ✅ Create `QuoteManager.ts`
- ✅ Write unit tests for QuoteManager
- ✅ Create universe validation script

**Testing:**

- QuoteManager can batch fetch 3 symbols
- Universe validation passes for all symbols

---

### Phase 2: Scanner Core (Day 2-3) - 16 hours

**Deliverables:**

- ✅ Create `MarketScanner.ts` (core TMV logic)
- ✅ Implement pre-market data caching
- ✅ Implement sector analysis
- ✅ Implement TMV scoring
- ✅ Implement safety filters
- ✅ Write unit tests for scanner

**Testing:**

- Pre-market cache completes in <60 seconds
- Scanner completes in <5 seconds
- Safety filters correctly reject bad stocks
- Expiry day blackout works

---

### Phase 3: Integration (Day 4) - 8 hours

**Deliverables:**

- ✅ Modify `StrategyManager.ts`
- ✅ Add pre-market logic
- ✅ Add scanner scheduling
- ✅ Add strategy deployment
- ✅ Modify `index.ts` for QuoteManager injection

**Testing:**

- Pre-market fetch triggers at 09:00 AM
- Scanner triggers at 09:30 AM
- 3 strategies deploy successfully
- EOD cache reset works at 15:35 PM

---

### Phase 4: Strategy Adaptation (Day 5) - 8 hours

**Deliverables:**

- ✅ Modify `BollingerBandStrategy.ts`
- ✅ Add stock option support
- ✅ Integrate QuoteManager
- ✅ Add direction bias enforcement
- ✅ Add pre-loaded data usage

**Testing:**

- Stock options selected correctly
- Position monitoring works via QuoteManager
- Direction bias enforced
- Capital allocation correct (₹65k)

---

## 🧪 Testing Strategy

### Unit Tests

```bash
npm test tests/services/MarketScanner.test.ts
npm test tests/services/QuoteManager.test.ts
```

**Coverage Targets:**

- MarketScanner: 80%
- QuoteManager: 90%
- Critical regex: 100%

### Integration Tests

**Manual Testing Checklist:**

**Day 1 (Pre-Market Testing):**

- [ ] Start bot at 08:50 AM
- [ ] Login at 09:10 AM
- [ ] Verify data fetch starts immediately
- [ ] Verify data cached by 09:15 AM
- [ ] Check logs for "Pre-market data cached: X stocks ready"

**Day 2 (Scanner Testing):**

- [ ] Verify scanner triggers at 09:30 AM sharp
- [ ] Check scanner completes in <5 seconds
- [ ] Verify top 3 stocks selected
- [ ] Check scanner logs show scoring breakdown
- [ ] Verify no trades on expiry week Monday/Tuesday

**Day 3 (Multi-Strategy Testing):**

- [ ] Verify 3 separate strategy instances created
- [ ] Check each strategy gets correct symbol
- [ ] Verify capital allocation (₹65k each)
- [ ] Check QuoteManager shows 3 subscribers (if in positions)
- [ ] Verify independent position management

**Day 4 (EOD Testing):**

- [ ] Verify all 3 strategies exit at 15:28 PM
- [ ] Check cache reset at 15:35 PM
- [ ] Verify next day pre-market fetch scheduled

**Day 5 (Edge Cases):**

- [ ] Test with 0 qualified stocks
- [ ] Test with 1-2 qualified stocks
- [ ] Test login after 09:30 (should abort)
- [ ] Test bot restart with active positions
- [ ] Test QuoteManager auto-start/stop

---

## 🚨 Risk Mitigation

### High-Risk Areas

**1. API Rate Limiting**

- **Risk**: 100+ stocks = potential 40+ API calls at 09:30
- **Mitigation**: Pre-market caching at 09:00 AM
- **Fallback**: 20% failure tolerance in cache

**2. Symbol Format Errors**

- **Risk**: M&M, BAJAJ-AUTO incorrect formatting
- **Mitigation**: Universe validation script (mandatory)
- **Fallback**: Strategy init catches errors, continues with survivors

**3. Race Conditions**

- **Risk**: Multiple strategies accessing QuoteManager simultaneously
- **Mitigation**: QuoteManager uses Set for thread-safe callback storage
- **Fallback**: Error handling in callback execution

**4. Memory Leaks**

- **Risk**: 100+ stocks × 10 days × 5-min candles = ~50MB data
- **Mitigation**: Clear cache at 15:35 PM daily
- **Fallback**: Garbage collection trigger

**5. Expiry Calculation**

- **Risk**: Incorrect last Tuesday calculation
- **Mitigation**: Comprehensive unit tests
- **Fallback**: Manual override in config

---

## 📝 Configuration Files Summary

### Files to Create:

1. `src/config/universe.ts` (250 lines)
2. `src/config/sectorTokens.ts` (50 lines)
3. `src/services/QuoteManager.ts` (200 lines)
4. `src/services/MarketScanner.ts` (800 lines)
5. `tests/services/MarketScanner.test.ts` (150 lines)
6. `scripts/validate-universe.ts` (100 lines)
7. `data/trading-data.json` (initial structure)

### Files to Modify:

1. `src/core/StrategyManager.ts` (+300 lines)
2. `src/core/StrategyRegistry.ts` (+20 lines - QuoteManager parameter)
3. `src/strategies/bollinger-band/BollingerBandStrategy.ts` (~20 locations)
4. `src/index.ts` (+100 lines)
5. `config/strategies.json` (restructure)
6. `package.json` (add tulind dependency)

### Total Lines of Code:

- **New**: ~1,550 lines
- **Modified**: ~400 lines
- **Total**: ~1,950 lines

---

## 🔍 Validation Checklist (Before Implementation)

### Architecture Review:

- [ ] QuoteManager singleton pattern verified
- [ ] Scanner-StrategyManager integration clear
- [ ] Multi-strategy deployment logic sound
- [ ] Data flow documented
- [ ] **MarketScanner does NOT import StrategyManager (circular dependency check)**
- [ ] **StrategyRegistry.createInstance signature includes QuoteManager parameter**
- [ ] **EOD timing separation: 15:28 (Strategy Exit) vs 15:35 (Cache Reset)**

### Requirements Coverage:

- [ ] TMV scoring implemented
- [ ] Top 3 selection logic correct
- [ ] Pre-market caching addressed
- [ ] EOD cache reset included
- [ ] Expiry day blackout implemented
- [ ] 0-3 stocks handling addressed
- [ ] **lotSize fallback in universe.ts**
- [ ] **QuoteManager staleness detection**

### Code Quality:

- [ ] TypeScript types defined
- [ ] Error handling comprehensive
- [ ] Logging detailed
- [ ] Unit tests planned
- [ ] **Universe validation checks M&M, BAJAJ-AUTO, LT specifically**

### Edge Cases:

- [ ] Late login (after 09:30)
- [ ] Scanner failure (0 stocks)
- [ ] Strategy init failure (1-2 stocks)
- [ ] Bot restart mid-day
- [ ] Expiry week blocking
- [ ] **QuoteManager data feed freeze (staleness check)**
- [ ] **Multi-day bot runs (Forever Cache bug)**

---

## 📋 Deployment Checklist

### Pre-Deployment:

- [ ] Run universe validation script
- [ ] Verify all sector tokens correct
- [ ] Test on paper trading mode (5 days)
- [ ] Verify QuoteManager rate limit compliance
- [ ] Check logs for errors

### Deployment Day:

- [ ] Start bot at 08:50 AM
- [ ] Login by 09:10 AM
- [ ] Monitor pre-market cache (09:00-09:15)
- [ ] Monitor scanner execution (09:30)
- [ ] Verify 3 strategies deployed
- [ ] Watch first trades closely

### Post-Deployment:

- [ ] Daily log review
- [ ] P&L reconciliation
- [ ] Position verification
- [ ] Error rate monitoring

---

## 🎯 Success Criteria

**Scanner Performance:**

- ✅ Completes in <5 seconds
- ✅ Selects 0-3 stocks (never forces)
- ✅ Scores accurately (manual spot-check)
- ✅ Blocks on expiry week

**Multi-Strategy:**

- ✅ 3 independent instances run
- ✅ ₹65k allocated to each
- ✅ Positions managed independently
- ✅ P&L tracked separately

**Reliability:**

- ✅ Zero rate limit errors
- ✅ Pre-market cache succeeds daily
- ✅ EOD cache reset works
- ✅ System handles 0-stock days

**Integration:**

- ✅ QuoteManager reduces API calls
- ✅ Scanner-strategy handoff seamless
- ✅ Dashboard shows all strategies
- ✅ Logs are comprehensive

---

## 🔚 Approval Required

**This plan is COMPLETE and AWAITING YOUR REVIEW.**

**Please verify:**

1. Architecture approach is sound
2. File structure makes sense
3. Implementation phases are realistic
4. Risk mitigation is adequate
5. No critical requirements missed

**Once approved, I will:**

1. Create all new files
2. Modify existing files
3. Write unit tests
4. Update documentation
5. Create deployment guide

**DO NOT PROCEED WITHOUT APPROVAL.**

---

**Prepared by**: AI Assistant  
**Date**: January 25, 2026  
**Status**: ⏸️ AWAITING APPROVAL  
**Estimated Implementation Time**: 4-5 days
