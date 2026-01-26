import { Logger } from "../utils/Logger";
import { InstrumentCache } from "../utils/InstrumentCache";
import { UNIVERSE, UniverseStock } from "../config/universe";

/**
 * MarketScanner - TMV (Trend, Momentum, Volume) Stock Selection
 *
 * ARCHITECTURAL RULE: This is a PURE SERVICE
 * - Accepts data (kite, logger, config)
 * - Returns data (ScannerResult)
 * - Has zero knowledge of StrategyManager or strategy classes
 *
 * This prevents circular dependencies:
 * StrategyManager → MarketScanner ✅
 * MarketScanner → StrategyManager ❌ FORBIDDEN
 *
 * Runs once daily at 09:30 AM
 * Scores 100+ stocks on 0-10 scale
 * Selects top 3 with score ≥7
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
  upperCircuitLimit: number; // Circuit limit from quote
  lowerCircuitLimit: number; // Circuit limit from quote
  todayChangePercent: number; // Today's % change from previous close
  atmOption: {
    tradingsymbol: string;
    strike: number;
    premium: number;
    expiry: Date;
  } | null;
  historicalData: Candle[]; // Pass to strategy
  valid: boolean;
}

export interface ScannerResult {
  scanTime: Date;
  scannedCount: number;
  qualifiedCount: number;
  selected: ScoredStock[];
  allScored: ScoredStock[]; // All stocks with scores
  greenSectors: string[];
  redSectors: string[];
  flatSectors: string[];
  failedStocks: string[];
}

interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SectorStatus {
  green: string[];
  red: string[];
  flat: string[];
  data: Map<number, { name: string; changePercent: number }>;
}

export class MarketScanner {
  private universe: UniverseStock[] = UNIVERSE;
  private cachedHistoricalData: Map<string, Candle[]> = new Map();
  private isDataCached: boolean = false;
  private lastScannerRun: number = 0;
  private SCANNER_COOLDOWN_MS = 10000; // 10 seconds between scanner runs

  constructor(
    private kiteConnect: any,
    private logger: Logger,
    private instrumentCache: InstrumentCache,
    private config: {
      minScore: number; // 7.0
      topCount: number; // 3
      minPremium: number; // ₹10
      sectorChangeThreshold: {
        // 0.25%
        green: number;
        red: number;
      };
    },
  ) {}

  /**
   * Main entry point - called by StrategyManager at 09:30 AM
   */
  async scanUniverse(): Promise<ScannerResult> {
    const startTime = Date.now();
    this.logger.info("🔍 MarketScanner: Starting universe scan...");

    try {
      // Step 1: Expiry day blackout check (Monthly expiry - from actual instrument data)
      // Blocks trading on expiry day and day before due to physical settlement margins
      // TODO: Uncomment after Jan 27 expiry testing
      // if (await this.isStockTradingBlocked()) {
      //   this.logger.error("🚫 Stock options blocked (expiry week)");
      //   return this.emptyResult();
      // }
      this.logger.warn("⚠️ Expiry blocking disabled for Jan 27 testing - re-enable after expiry");

      // Step 2: Sector filtering
      const sectorStatus = await this.analyzeSectors();
      const filteredStocks = this.filterBySector(sectorStatus);

      // Step 3: Score each stock
      const scoredStocks = await this.scoreStocks(
        filteredStocks,
        sectorStatus,
      );

      // Step 4: Apply safety filters
      const safeStocks = this.applySafetyFilters(scoredStocks);

      // Step 5: Select top 3
      const topStocks = await this.selectTopStocks(safeStocks, sectorStatus);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info(
        `✅ Scanner completed in ${duration}s: ${topStocks.length}/3 selected`,
      );

      return {
        scanTime: new Date(),
        scannedCount: filteredStocks.length,
        qualifiedCount: safeStocks.length,
        selected: topStocks,
        allScored: scoredStocks, // Include all scored stocks
        greenSectors: sectorStatus.green,
        redSectors: sectorStatus.red,
        flatSectors: sectorStatus.flat,
        failedStocks: [],
      };
    } catch (error) {
      this.logger.error("MarketScanner: Fatal error during scan:", error);
      return this.emptyResult();
    }
  }

  /**
   * Pre-load historical data at 09:00 AM (before market open)
   * Called by StrategyManager's reactive auth logic
   */
  async cacheHistoricalData(): Promise<{ success: boolean; count: number }> {
    this.logger.info(
      "📥 MarketScanner: Pre-loading historical data (10 days, 5-min)...",
    );
    const startTime = Date.now();

    // Cooldown check to prevent rapid-fire scanner runs
    const timeSinceLastRun = Date.now() - this.lastScannerRun;
    if (this.lastScannerRun > 0 && timeSinceLastRun < this.SCANNER_COOLDOWN_MS) {
      const waitTime = Math.ceil((this.SCANNER_COOLDOWN_MS - timeSinceLastRun) / 1000);
      throw new Error(`⏳ Scanner cooldown: Please wait ${waitTime} seconds before running again`);
    }
    this.lastScannerRun = Date.now();

    try {
      this.logger.info("✅ Using instrument tokens from universe.ts (no API call needed)");
      this.logger.info(`📋 Universe contains ${this.universe.length} stocks with pre-loaded tokens`);

      this.logger.info(`📊 Starting historical data fetch for ${this.universe.length} stocks`);
      this.logger.info("📊 Zerodha Rate Limit: 3 historical data requests per second");
      this.logger.info(`📊 Strategy: Batch size of 3, with 1-second delay between batches`);
      this.logger.info(`📊 Expected Duration: ~${Math.ceil(this.universe.length / 3)} seconds`);

      // Zerodha Rate Limit: 3 requests/second for historical data
      // Process in batches of 3 with 1-second delays
      const batchSize = 3;
      const delayBetweenBatches = 1000; // 1 second
      
      const allResults: any[] = [];
      const totalBatches = Math.ceil(this.universe.length / batchSize);
      
      for (let i = 0; i < this.universe.length; i += batchSize) {
        const batch = this.universe.slice(i, i + batchSize);
        const currentBatch = Math.floor(i / batchSize) + 1;
        
        this.logger.info(`📥 Batch ${currentBatch}/${totalBatches}: Fetching ${batch.map(s => s.symbol).join(', ')}`);
        
        const batchStartTime = Date.now();
        const results = await Promise.allSettled(
          batch.map(async (stock) => {
            try {
              const instrumentToken = stock.instrumentToken; // From universe.ts
              
              if (!instrumentToken) {
                this.logger.error(`  ✗ ${stock.symbol}: No instrument token (run 'npm run generate-universe' first)`);
                return { symbol: stock.symbol, success: false };
              }

              // Fetch 10 days of 5-min data
              const toDate = new Date();
              const fromDate = new Date();
              fromDate.setDate(fromDate.getDate() - 10);

              const candleStartTime = Date.now();
              const candles = await this.kiteConnect.getHistoricalData(
                instrumentToken,
                "5minute",
                fromDate,
                toDate,
              );
              const candleDuration = Date.now() - candleStartTime;

              this.cachedHistoricalData.set(stock.symbol, candles);
              this.logger.info(`  ✓ ${stock.symbol}: ${candles.length} candles in ${candleDuration}ms`);
              return { symbol: stock.symbol, success: true };
          } catch (error: any) {
            this.logger.error(`  ✗ ${stock.symbol}: ${error.message || JSON.stringify(error)}`);
            return { symbol: stock.symbol, success: false };
          }
        }),
      );
      
      const batchDuration = Date.now() - batchStartTime;
      const batchSuccesses = results.filter(r => r.status === 'fulfilled').length;
      this.logger.info(`📊 Batch ${currentBatch} complete: ${batchSuccesses}/${batch.length} successful in ${batchDuration}ms`);
      
      allResults.push(...results);
      
      // Zerodha rate limit: 3 requests/second, so delay 1 second between batches
      if (i + batchSize < this.universe.length) {
        this.logger.info(`⏳ Waiting 1 second before next batch (rate limit compliance)...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    this.logger.info(`📊 Step 2 Complete: All batches processed`);
    
    const successful = allResults.filter((r) => r.status === "fulfilled").length;
    const failed = allResults.filter((r) => r.status === "rejected");

    this.logger.info(`📊 Summary: ${successful} successful, ${failed.length} failed out of ${allResults.length} total`);

    // Failure threshold check (20%)
    const failureRate = failed.length / allResults.length;
    if (failureRate > 0.2) {
      this.logger.error(
        `❌ ABORT: Data cache failure rate: ${(failureRate * 100).toFixed(1)}% exceeds 20% threshold`,
      );
      this.logger.error(`❌ ${failed.length} stocks failed, ${successful} succeeded`);
      this.isDataCached = false;
      return { success: false, count: 0 };
    }

    this.isDataCached = true;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info(
      `✅✅✅ COMPLETE: Cached ${this.cachedHistoricalData.size}/${this.universe.length} stocks in ${duration}s`,
    );

    return { success: true, count: this.cachedHistoricalData.size };
    } catch (error: any) {
      this.logger.error("❌❌❌ FATAL ERROR in cacheHistoricalData:");
      this.logger.error(`Error Type: ${error.error_type || typeof error}`);
      this.logger.error(`Error Message: ${error.message || JSON.stringify(error)}`);
      if (error.stack) {
        this.logger.error(`Stack: ${error.stack}`);
      }
      throw error; // Re-throw to be caught by caller
    }
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
    this.logger.info("🧹 MarketScanner: Clearing cached data");
    this.cachedHistoricalData.clear();
    this.isDataCached = false;
  }

  /**
   * Step 1: Analyze sector performance
   * Returns: { green: [], red: [], flat: [] }
   */
  private async analyzeSectors(): Promise<SectorStatus> {
    this.logger.info("📊 Analyzing sector performance...");

    // Get unique sector tokens
    const sectors = Array.from(
      new Set(this.universe.map((s) => s.sectorToken)),
    );

    // Batch fetch sector quotes (SINGLE API CALL)
    // Use instrument tokens directly (not NSE: prefix for indices)
    const quotes = await this.kiteConnect.getQuote(sectors);

    const green: string[] = [];
    const red: string[] = [];
    const flat: string[] = [];
    const data = new Map<number, { name: string; changePercent: number }>();

    for (const stock of this.universe) {
      const quote = quotes[stock.sectorToken];
      if (!quote) continue;

      const changePercent = quote.net_change_percent || 0;
      data.set(stock.sectorToken, {
        name: stock.sector,
        changePercent,
      });

      if (changePercent > this.config.sectorChangeThreshold.green) {
        if (!green.includes(stock.sector)) green.push(stock.sector);
      } else if (changePercent < this.config.sectorChangeThreshold.red) {
        if (!red.includes(stock.sector)) red.push(stock.sector);
      } else {
        if (!flat.includes(stock.sector)) flat.push(stock.sector);
      }
    }

    // Debug: Log sector changes
    this.logger.info(`🔍 Sector Analysis (threshold: green>${this.config.sectorChangeThreshold.green}%, red<${this.config.sectorChangeThreshold.red}%):`);
    const uniqueSectors = Array.from(new Set(this.universe.map(s => s.sector)));
    for (const sector of uniqueSectors.slice(0, 5)) {  // Log first 5
      const sectorData = Array.from(data.values()).find(d => d.name === sector);
      if (sectorData) {
        const status = green.includes(sector) ? 'GREEN' : red.includes(sector) ? 'RED' : 'FLAT';
        this.logger.info(`  ${sector}: ${sectorData.changePercent.toFixed(2)}% (${status})`);
      }
    }

    this.logger.info(
      `Sectors - Green: ${green.length}, Red: ${red.length}, Flat: ${flat.length}`,
    );
    return { green, red, flat, data };
  }

  /**
   * Filter stocks based on sector direction
   */
  private filterBySector(sectorStatus: SectorStatus): UniverseStock[] {
    // Filter stocks based on sector momentum direction
    const allSectorsFlat = sectorStatus.green.length === 0 && sectorStatus.red.length === 0;
    
    if (allSectorsFlat) {
      this.logger.warn("⚠️ All sectors flat (0% change) - market may be closed or pre-market");
      return []; // No trading when market has no direction
    }
    
    return this.universe.filter((stock) => {
      // Skip flat sectors (avoid chop)
      if (sectorStatus.flat.includes(stock.sector)) {
        return false;
      }
      return true; // Keep green and red sectors
    });
  }

  /**
   * Step 2: Score each stock using TMV algorithm
   */
  private async scoreStocks(
    stocks: UniverseStock[],
    sectorStatus: SectorStatus,
  ): Promise<ScoredStock[]> {
    this.logger.info(`📈 Scoring ${stocks.length} stocks...`);

    const results: ScoredStock[] = [];

    for (const stock of stocks) {
      try {
        // Get cached historical data
        const candles = this.cachedHistoricalData.get(stock.symbol);
        if (!candles || candles.length < 50) {
          this.logger.warn(
            `${stock.symbol}: Insufficient data (${candles?.length || 0} candles)`,
          );
          continue;
        }

        // Derive 15-min candles from 5-min
        const candles15m = this.derive15MinCandles(candles);

        // Calculate indicators
        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const volumes = candles.map((c) => c.volume);

        // EMA (8, 21, 50)
        const ema8 = this.calculateEMA(closes, 8);
        const ema21 = this.calculateEMA(closes, 21);
        const ema50 = this.calculateEMA(closes, 50);

        // RSI (14 period, 5-min and 15-min)
        const rsi5m = this.calculateRSI(closes, 14);
        const rsi15m = this.calculateRSI(
          candles15m.map((c) => c.close),
          14,
        );

        // ADX (14 period)
        const adx = this.calculateADX(highs, lows, closes, 14);

        // VWAP
        const vwap = this.calculateVWAP(candles);

        // Relative Volume
        const rvol = this.calculateRVOL(volumes);

        // Spot price (last close)
        const spotPrice = closes[closes.length - 1];
        
        if (!spotPrice || !candles[0]) {
          this.logger.warn(`${stock.symbol}: Invalid price data`);
          continue;
        }

        // Sector data
        const sectorData = sectorStatus.data.get(stock.sectorToken);
        const sectorChange = sectorData?.changePercent || 0;

        // Determine bias based on sector
        let bias: "LONG" | "SHORT" | null = null;
        if (sectorStatus.green.includes(stock.sector)) {
          bias = "LONG";
        } else if (sectorStatus.red.includes(stock.sector)) {
          bias = "SHORT";
        }
        // Flat sectors are skipped - no bias assignment

        if (!bias) continue; // Flat sector, skip

        // Fetch live quote for circuit limits and today's change
        let upperCircuitLimit = 0;
        let lowerCircuitLimit = 0;
        let todayChangePercent = 0;
        
        try {
          const quoteKey = `NSE:${stock.symbol}`;
          const quote = await this.kiteConnect.getQuote([quoteKey]);
          const stockQuote = quote[quoteKey];
          
          if (stockQuote) {
            upperCircuitLimit = stockQuote.upper_circuit_limit || 0;
            lowerCircuitLimit = stockQuote.lower_circuit_limit || 0;
            // Use net_change from quote (today's change from previous close)
            todayChangePercent = stockQuote.ohlc?.close 
              ? ((spotPrice - stockQuote.ohlc.close) / stockQuote.ohlc.close) * 100
              : 0;
          }
        } catch (quoteError) {
          this.logger.warn(`${stock.symbol}: Failed to fetch quote for circuit limits`);
        }

        // === SCORING LOGIC ===
        const breakdown = { trend: 0, momentum: 0, volume: 0, sector: 0 };

        // A. TREND (Max 3.0) - Per Spec Section 4A
        // Short-Term Trend: Close > 8 EMA AND 8 EMA > 21 EMA → +1.0
        // Trend Stability: Close > 50 EMA → +0.5
        // VWAP: Close > VWAP → +1.5
        if (bias === "LONG") {
          if (spotPrice > vwap) breakdown.trend += 1.5;           // VWAP check
          if (spotPrice > ema8 && ema8 > ema21) breakdown.trend += 1.0;  // Short-term trend
          if (spotPrice > ema50) breakdown.trend += 0.5;          // Trend stability (EMA50)
        } else {
          // SHORT
          if (spotPrice < vwap) breakdown.trend += 1.5;           // VWAP check
          if (spotPrice < ema8 && ema8 < ema21) breakdown.trend += 1.0;  // Short-term trend
          if (spotPrice < ema50) breakdown.trend += 0.5;          // Trend stability (EMA50)
        }

        // B. MOMENTUM (Max 3.0) - Per Spec Section 4B
        // RSI Bull Zone: RSI > 60 → +1.0 (not +2.0)
        // RSI Rising: RSI5m > RSI15m → +1.0
        // ADX > 25 → +1.0
        if (bias === "LONG") {
          if (rsi5m > 60 && rsi5m < 85) breakdown.momentum += 1.0;  // RSI Bull Zone
          if (rsi5m > rsi15m) breakdown.momentum += 1.0;            // RSI Rising
        } else {
          // SHORT
          if (rsi5m < 40 && rsi5m > 15) breakdown.momentum += 1.0;  // RSI Bear Zone
          if (rsi5m < rsi15m) breakdown.momentum += 1.0;            // RSI Falling
        }

        // ADX (direction agnostic)
        if (adx > 25) breakdown.momentum += 1.0;

        // C. VOLUME (Max 2.0)
        if (rvol > 3.0) breakdown.volume += 2.0;
        else if (rvol > 2.0) breakdown.volume += 1.0;

        // D. SECTOR CONFLUENCE (Max 2.0)
        breakdown.sector += 1.0; // Base point for sector direction match

        // Relative strength check - Use today's change (not 10-day-old price)
        const stockChange = todayChangePercent;
        if (bias === "LONG" && stockChange > sectorChange) {
          breakdown.sector += 1.0; // Outperforming sector
        } else if (bias === "SHORT" && stockChange < sectorChange) {
          breakdown.sector += 1.0; // Underperforming sector
        }

        // Total score
        const score =
          breakdown.trend +
          breakdown.momentum +
          breakdown.volume +
          breakdown.sector;

        // Create scored stock object
        results.push({
          symbol: stock.symbol,
          score,
          bias,
          sector: stock.sector,
          sectorToken: stock.sectorToken,
          breakdown,
          spotPrice,
          upperCircuitLimit,
          lowerCircuitLimit,
          todayChangePercent: stockChange,
          atmOption: null,
          historicalData: candles,
          valid: true,
        });
      } catch (error) {
        this.logger.error(`Failed to score ${stock.symbol}:`, error);
      }
    }

    return results;
  }

  /**
   * Step 3: Apply safety filters
   */
  private applySafetyFilters(stocks: ScoredStock[]): ScoredStock[] {
    return stocks.filter((stock) => {
      const candles = stock.historicalData;
      if (candles.length < 2) return false;
      
      const lastCandle = candles[candles.length - 1];
      const prevCandle = candles[candles.length - 2];

      // 1. Minimum score threshold
      if (stock.score < this.config.minScore) {
        this.logger.debug(
          `${stock.symbol}: Score too low (${stock.score.toFixed(2)})`,
        );
        return false;
      }

      // 2. RSI exhaustion check
      const closes = candles.map((c) => c.close);
      const rsi = this.calculateRSI(closes, 14);
      if (rsi > 85) {
        this.logger.warn(
          `${stock.symbol}: RSI exhaustion (${rsi.toFixed(1)}) - DISCARD`,
        );
        return false;
      }

      // 3. Gap-up trap
      if (!lastCandle || !prevCandle) {
        return true; // Keep stock if we can't check gap
      }
      
      const gapPercent =
        ((lastCandle.open - prevCandle.close) / prevCandle.close) * 100;
      if (Math.abs(gapPercent) > 2.0) {
        this.logger.warn(
          `${stock.symbol}: Gap ${gapPercent.toFixed(2)}% - DISCARD`,
        );
        return false;
      }

      // 4. Circuit limit check - Spec Section 6
      // If price is within 1% of circuit limit, DISCARD
      if (stock.upperCircuitLimit > 0 && stock.lowerCircuitLimit > 0) {
        const currentPrice = stock.spotPrice;
        
        if (stock.bias === "LONG") {
          // For LONG: Check proximity to upper circuit
          const proximityToUpperCircuit = ((stock.upperCircuitLimit - currentPrice) / currentPrice) * 100;
          if (proximityToUpperCircuit < 1.0) {
            this.logger.warn(
              `${stock.symbol}: Near Upper Circuit (${proximityToUpperCircuit.toFixed(2)}% away) - DISCARD`,
            );
            return false;
          }
        } else {
          // For SHORT: Check proximity to lower circuit
          const proximityToLowerCircuit = ((currentPrice - stock.lowerCircuitLimit) / currentPrice) * 100;
          if (proximityToLowerCircuit < 1.0) {
            this.logger.warn(
              `${stock.symbol}: Near Lower Circuit (${proximityToLowerCircuit.toFixed(2)}% away) - DISCARD`,
            );
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * Step 4: Select top N stocks and find ATM options
   */
  private async selectTopStocks(stocks: ScoredStock[], sectorStatus: SectorStatus): Promise<ScoredStock[]> {
    // Sort by score descending
    const sorted = stocks.sort((a, b) => b.score - a.score);

    // Log top 10 scored stocks for debugging
    this.logger.info(`📊 Top 10 Scored Stocks:`);
    sorted.slice(0, 10).forEach((stock, i) => {
      this.logger.info(`  ${i + 1}. ${stock.symbol}: Score=${stock.score.toFixed(2)} (${stock.bias}) | T:${stock.breakdown.trend.toFixed(1)} M:${stock.breakdown.momentum.toFixed(1)} V:${stock.breakdown.volume.toFixed(1)} S:${stock.breakdown.sector.toFixed(1)} | Spot=₹${stock.spotPrice.toFixed(2)}`);
    });

    // Take top N
    const topStocks = sorted.slice(0, this.config.topCount);

    // Find ATM options for each
    for (const stock of topStocks) {
      try {
        const atmOption = await this.findATMOption(
          stock.symbol,
          stock.spotPrice,
          stock.bias,
        );

        // Premium floor check - minimum ₹10 to ensure liquidity
        if (atmOption.premium < this.config.minPremium) {
          this.logger.warn(
            `${stock.symbol}: Premium too low (₹${atmOption.premium}, min: ₹${this.config.minPremium}) - DISCARD`,
          );
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
    return topStocks.filter((s) => s.valid);
  }

  /**
   * Find ATM option for stock
   */
  private async findATMOption(
    symbol: string,
    spotPrice: number,
    type: "LONG" | "SHORT",
  ): Promise<{
    tradingsymbol: string;
    strike: number;
    premium: number;
    expiry: Date;
  }> {
    // Fetch all NFO instruments from cache
    const instruments = await this.instrumentCache.getNFOInstruments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all options for this symbol expiring today or later
    const symbolOptions = instruments.filter(
      (i: any) =>
        i.name === symbol &&
        i.segment === "NFO-OPT" &&
        new Date(i.expiry) >= today,
    );

    if (symbolOptions.length === 0) {
      throw new Error(`No options found for ${symbol}`);
    }

    // Find nearest expiry from actual data
    const sortedExpiries = symbolOptions
      .map((o: any) => new Date(o.expiry).getTime())
      .sort((a, b) => a - b);
    const nearestExpiryTime = sortedExpiries[0];
    
    if (nearestExpiryTime === undefined) {
      throw new Error(`No expiry dates found for ${symbol}`);
    }
    
    const expiry = new Date(nearestExpiryTime);
    this.logger.info(`📅 Using expiry for ${symbol}: ${expiry.toDateString()} (from instrument data)`);

    // Filter for this specific expiry
    const options = symbolOptions.filter(
      (i: any) => new Date(i.expiry).getTime() === nearestExpiryTime,
    );

    // Find ATM strike (closest to spot)
    const atmStrike = this.findClosestStrike(
      spotPrice,
      options.map((o: any) => o.strike),
    );

    // Select CE or PE based on bias
    const optionType = type === "LONG" ? "CE" : "PE";
    const atmOption = options.find(
      (o: any) => o.strike === atmStrike && o.instrument_type === optionType,
    );

    if (!atmOption) {
      throw new Error(`ATM option not found: ${symbol} ${atmStrike}${optionType}`);
    }

    // Get current premium
    const quote = await this.kiteConnect.getQuote([
      `NFO:${atmOption.tradingsymbol}`,
    ]);
    const premium = quote[`NFO:${atmOption.tradingsymbol}`].last_price;

    return {
      tradingsymbol: atmOption.tradingsymbol,
      strike: atmStrike,
      premium,
      expiry,
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
    let lastTuesday = new Date(lastDay);
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
   * Get actual nearest expiry date from Zerodha instrument data
   * More reliable than mathematical calculation (handles holidays)
   * @param sampleSymbol - Any F&O stock to check expiry dates (default: RELIANCE)
   */
  private async getActualNearestExpiry(sampleSymbol: string = 'RELIANCE'): Promise<Date | null> {
    try {
      const instruments = await this.instrumentCache.getNFOInstruments();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Filter for stock options expiring today or later
      const stockOptions = instruments.filter((i: any) =>
        i.name === sampleSymbol &&
        i.segment === 'NFO-OPT' &&
        new Date(i.expiry) >= today
      );

      if (stockOptions.length === 0) {
        this.logger.warn(`No options found for ${sampleSymbol}`);
        return null;
      }

      // Get unique expiry dates, sorted ascending
      const expiryDates = stockOptions
        .map((o: any) => new Date(o.expiry).getTime())
        .filter((v: number, i: number, a: number[]) => a.indexOf(v) === i)
        .sort((a: number, b: number) => a - b);

      if (expiryDates.length === 0) return null;

      const firstExpiry = expiryDates[0];
      if (firstExpiry === undefined) return null;
      
      const nearestExpiry = new Date(firstExpiry);
      this.logger.info(`📅 Nearest expiry for ${sampleSymbol}: ${nearestExpiry.toDateString()}`);
      return nearestExpiry;
    } catch (error) {
      this.logger.error('Failed to fetch actual expiry from instruments:', error);
      return null;
    }
  }

  /**
   * Expiry day blackout check using actual instrument data
   * Blocks trading on expiry day and day before (physical settlement margins)
   */
  private async isStockTradingBlocked(): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get ACTUAL expiry from Zerodha instrument data (handles holidays)
    const expiry = await this.getActualNearestExpiry('RELIANCE');

    if (!expiry) {
      this.logger.error("🚫 Cannot determine expiry date from instruments - blocking for safety");
      return true; // Fail safe: don't trade if we can't verify expiry
    }

    expiry.setHours(0, 0, 0, 0);
    const daysToExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    this.logger.info(`📅 Expiry check: Today=${today.toDateString()}, Expiry=${expiry.toDateString()}, DaysToExpiry=${daysToExpiry}`);

    if (daysToExpiry === 0) {
      this.logger.error("🚫 Expiry Day - Stock options blocked (physical settlement)");
      return true;
    }

    if (daysToExpiry === 1) {
      this.logger.error("🚫 Day before expiry - Blocked (high margins for physical settlement)");
      return true;
    }

    if (daysToExpiry === 2) {
      this.logger.warn("⚠️ 2 days to expiry - Enhanced liquidity checks active");
      // Continue with trading but with caution
    }

    return false;
  }

  /**
   * Find closest strike to spot price
   */
  private findClosestStrike(spotPrice: number, strikes: number[]): number {
    return strikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev,
    );
  }

  /**
   * Derive 15-min candles from 5-min candles
   */
  private derive15MinCandles(candles5m: Candle[]): Candle[] {
    const candles15m: Candle[] = [];

    for (let i = 0; i < candles5m.length; i += 3) {
      const chunk = candles5m.slice(i, i + 3);
      if (chunk.length === 3 && chunk[0] && chunk[2]) {
        candles15m.push({
          date: chunk[0].date,
          open: chunk[0].open,
          high: Math.max(...chunk.map((c) => c.high)),
          low: Math.min(...chunk.map((c) => c.low)),
          close: chunk[2].close,
          volume: chunk.reduce((sum, c) => sum + c.volume, 0),
        });
      }
    }

    return candles15m;
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < data.length; i++) {
      const value = data[i];
      if (value !== undefined) {
        ema = (value - ema) * multiplier + ema;
      }
    }

    return ema;
  }

  /**
   * Calculate RSI
   */
  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const curr = closes[i];
      const prev = closes[i - 1];
      if (curr !== undefined && prev !== undefined) {
        const change = curr - prev;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smooth with remaining data
    for (let i = period + 1; i < closes.length; i++) {
      const curr = closes[i];
      const prev = closes[i - 1];
      if (curr !== undefined && prev !== undefined) {
        const change = curr - prev;
        if (change > 0) {
          avgGain = (avgGain * (period - 1) + change) / period;
          avgLoss = (avgLoss * (period - 1)) / period;
        } else {
          avgGain = (avgGain * (period - 1)) / period;
          avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
        }
      }
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Calculate ADX
   */
  private calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): number {
    if (highs.length < period + 1) return 0;

    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevHigh = highs[i - 1];
      const prevLow = lows[i - 1];
      const prevClose = closes[i - 1];

      if (high === undefined || low === undefined || prevHigh === undefined || 
          prevLow === undefined || prevClose === undefined) {
        continue;
      }

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trueRanges.push(tr);

      const plusDM =
        high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0;
      const minusDM =
        prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0;

      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    if (trueRanges.length < period) return 0;

    // Smooth indicators
    let smoothTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

    for (let i = period; i < trueRanges.length; i++) {
      const tr = trueRanges[i];
      const plusDM = plusDMs[i];
      const minusDM = minusDMs[i];
      
      if (tr !== undefined && plusDM !== undefined && minusDM !== undefined) {
        smoothTR = smoothTR - smoothTR / period + tr;
        smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM;
        smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM;
      }
    }

    const plusDI = (100 * smoothPlusDM) / smoothTR;
    const minusDI = (100 * smoothMinusDM) / smoothTR;

    const dx = (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI || 1);

    return dx;
  }

  /**
   * Calculate VWAP
   */
  private calculateVWAP(candles: Candle[]): number {
    let cumVolume = 0;
    let cumPriceVolume = 0;

    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumPriceVolume += typicalPrice * candle.volume;
      cumVolume += candle.volume;
    }

    return cumVolume > 0 ? cumPriceVolume / cumVolume : 0;
  }

  /**
   * Calculate Relative Volume
   */
  private calculateRVOL(volumes: number[]): number {
    if (volumes.length < 20) return 1.0;

    const recentVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const avgVolume = volumes.slice(-20, -10).reduce((a, b) => a + b, 0) / 10;

    return avgVolume > 0 ? recentVolume / avgVolume : 1.0;
  }

  /**
   * Empty result helper
   */
  private emptyResult(): ScannerResult {
    return {
      scanTime: new Date(),
      scannedCount: 0,
      qualifiedCount: 0,
      selected: [],
      allScored: [],
      greenSectors: [],
      redSectors: [],
      flatSectors: [],
      failedStocks: [],
    };
  }
}
