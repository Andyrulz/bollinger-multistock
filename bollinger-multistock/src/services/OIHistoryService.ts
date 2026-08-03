/**
 * OIHistoryService - Smart Money Detection via OI Analysis
 * 
 * The "Coiled Spring" Theory (Wyckoff Principle):
 * - High OI Change + Low Price Change = Institutional Accumulation/Distribution
 * - Smart money uses iceberg orders to build positions without moving price
 * - Once filled, the stored energy releases and stock moves explosively
 * 
 * This service:
 * 1. Saves End-of-Day Futures OI at 3:40 PM daily
 * 2. Calculates OI delta for scanner scoring
 * 3. Detects "Coiled Spring" patterns for score boost
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { InstrumentCache } from '../utils/InstrumentCache';
import { UNIVERSE } from '../config/universe';

export interface OIHistoryEntry {
  futuresOI: number;
  futuresSymbol: string;
  savedAt: string;
}

export interface OIHistoryData {
  savedAt: string;
  expiryDate: string;  // Which expiry this data is for
  data: { [symbol: string]: OIHistoryEntry };
}

export interface OIAnalysisResult {
  symbol: string;
  prevOI: number;
  currentOI: number;
  oiChangePercent: number;
  priceChangePercent: number;
  isCoiledSpring: boolean;
  smartMoneySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'NONE' | 'CONFLICT';
  futuresSymbol: string;
}

export class OIHistoryService {
  private static OI_HISTORY_FILE = path.join(__dirname, '../data/oi-history.json');
  private kiteConnect: any;
  private logger: Logger;
  private instrumentCache: InstrumentCache;
  
  // Thresholds
  private MIN_OI_THRESHOLD = 100000;  // Minimum OI to consider
  private OI_CHANGE_THRESHOLD = 5;     // Minimum % change to trigger
  private PRICE_CHANGE_MAX = 1.5;      // Maximum price change for coiled spring
  
  // Cache for current session
  private yesterdayOI: OIHistoryData | null = null;
  private futuresTokenCache: Map<string, { token: number; symbol: string; expiry: Date }> = new Map();
  
  constructor(kiteConnect: any, logger: Logger, instrumentCache: InstrumentCache) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.instrumentCache = instrumentCache;
    
    // Ensure data directory exists
    const dataDir = path.dirname(OIHistoryService.OI_HISTORY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Load yesterday's OI data from disk
   * Called at scanner initialization
   */
  async loadYesterdayOI(): Promise<boolean> {
    try {
      if (!fs.existsSync(OIHistoryService.OI_HISTORY_FILE)) {
        this.logger.info('📭 OI History: No historical data found (first run)');
        return false;
      }
      
      const rawData = fs.readFileSync(OIHistoryService.OI_HISTORY_FILE, 'utf8');
      const data: OIHistoryData = JSON.parse(rawData);
      
      // Check if data is stale (> 24 hours old)
      const savedAt = new Date(data.savedAt);
      const hoursOld = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursOld > 48) {  // Allow weekend gap (48 hours)
        this.logger.warn(`⚠️ OI History: Data is ${hoursOld.toFixed(1)} hours old - too stale, skipping Smart Money scoring`);
        this.yesterdayOI = null;
        return false;
      }
      
      this.yesterdayOI = data;
      const stockCount = Object.keys(data.data).length;
      this.logger.info(`✅ OI History: Loaded ${stockCount} stocks from ${savedAt.toLocaleString()}`);
      this.logger.info(`   Expiry: ${data.expiryDate}`);
      
      return true;
    } catch (error) {
      this.logger.error('❌ OI History: Failed to load historical data:', error);
      this.yesterdayOI = null;
      return false;
    }
  }

  /**
   * Save End-of-Day Futures OI for all universe stocks
   * Called at 3:40 PM daily
   */
  async saveEndOfDayOI(): Promise<{ success: boolean; count: number; errors: string[] }> {
    this.logger.info('💾 OI History: Starting End-of-Day OI save...');
    const startTime = Date.now();
    const errors: string[] = [];
    
    try {
      // Step 1: Build futures token cache if not done
      await this.buildFuturesTokenCache();
      
      // Step 2: Fetch current OI for all futures
      const oiData: { [symbol: string]: OIHistoryEntry } = {};
      const batchSize = 50;  // Zerodha allows up to 500 symbols per quote request
      const symbols = Array.from(this.futuresTokenCache.keys());
      
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const quoteKeys = batch.map(symbol => {
          const futuresInfo = this.futuresTokenCache.get(symbol);
          return `NFO:${futuresInfo?.symbol}`;
        }).filter(k => k !== 'NFO:undefined');
        
        if (quoteKeys.length === 0) continue;
        
        try {
          const quotes = await this.kiteConnect.getQuote(quoteKeys);
          
          for (const symbol of batch) {
            const futuresInfo = this.futuresTokenCache.get(symbol);
            if (!futuresInfo) continue;
            
            const quoteKey = `NFO:${futuresInfo.symbol}`;
            const quote = quotes[quoteKey];
            
            if (quote && quote.oi !== undefined) {
              oiData[symbol] = {
                futuresOI: quote.oi,
                futuresSymbol: futuresInfo.symbol,
                savedAt: new Date().toISOString()
              };
            } else {
              errors.push(`${symbol}: No OI data in quote`);
            }
          }
        } catch (batchError) {
          this.logger.error(`Batch quote fetch failed:`, batchError);
          errors.push(`Batch ${i / batchSize + 1}: Quote fetch failed`);
        }
        
        // Rate limit compliance
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      // Step 3: Determine expiry date from first futures contract
      const firstFutures = this.futuresTokenCache.values().next().value;
      const expiryDate = firstFutures?.expiry?.toISOString().split('T')[0] || 'unknown';
      
      // Step 4: Save to disk
      const historyData: OIHistoryData = {
        savedAt: new Date().toISOString(),
        expiryDate: expiryDate,
        data: oiData
      };
      
      fs.writeFileSync(OIHistoryService.OI_HISTORY_FILE, JSON.stringify(historyData, null, 2));
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successCount = Object.keys(oiData).length;
      
      this.logger.info(`✅ OI History: Saved ${successCount}/${UNIVERSE.length} stocks in ${duration}s`);
      if (errors.length > 0) {
        this.logger.warn(`⚠️ OI History: ${errors.length} errors during save`);
      }
      
      return { success: true, count: successCount, errors };
      
    } catch (error) {
      this.logger.error('❌ OI History: Failed to save EOD data:', error);
      return { success: false, count: 0, errors: [String(error)] };
    }
  }

  /**
   * Build cache of Futures tokens for all universe stocks
   * Finds current month futures contract for each stock
   */
  private async buildFuturesTokenCache(): Promise<void> {
    if (this.futuresTokenCache.size > 0) {
      this.logger.debug('📋 Using cached futures token mapping');
      return;
    }
    
    this.logger.info('🔍 Building futures token cache...');
    
    const instruments = await this.instrumentCache.getNFOInstruments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Find current month's last Thursday (expiry)
    const currentMonthExpiry = this.getCurrentMonthExpiry();
    
    for (const stock of UNIVERSE) {
      // Find futures contract for this stock
      const futures = instruments.find((i: any) => 
        i.name === stock.symbol &&
        i.segment === 'NFO-FUT' &&
        new Date(i.expiry) >= today &&
        this.isSameMonth(new Date(i.expiry), currentMonthExpiry)
      );
      
      if (futures) {
        this.futuresTokenCache.set(stock.symbol, {
          token: futures.instrument_token,
          symbol: futures.tradingsymbol,
          expiry: new Date(futures.expiry)
        });
      } else {
        // Fallback: Try to find nearest expiry futures
        const nearestFutures = instruments
          .filter((i: any) => 
            i.name === stock.symbol &&
            i.segment === 'NFO-FUT' &&
            new Date(i.expiry) >= today
          )
          .sort((a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime())[0];
        
        if (nearestFutures) {
          this.futuresTokenCache.set(stock.symbol, {
            token: nearestFutures.instrument_token,
            symbol: nearestFutures.tradingsymbol,
            expiry: new Date(nearestFutures.expiry)
          });
        } else {
          this.logger.warn(`⚠️ No futures found for ${stock.symbol} (may be in F&O ban)`);
        }
      }
    }
    
    this.logger.info(`✅ Futures token cache: ${this.futuresTokenCache.size}/${UNIVERSE.length} stocks mapped`);
  }

  /**
   * Get current month's expiry date (last Thursday)
   */
  private getCurrentMonthExpiry(): Date {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    // Get last day of current month
    const lastDay = new Date(year, month + 1, 0);
    
    // Find last Thursday
    while (lastDay.getDay() !== 4) {  // 4 = Thursday
      lastDay.setDate(lastDay.getDate() - 1);
    }
    
    // If today is past this month's expiry, get next month's
    if (today > lastDay) {
      const nextMonthLastDay = new Date(year, month + 2, 0);
      while (nextMonthLastDay.getDay() !== 4) {
        nextMonthLastDay.setDate(nextMonthLastDay.getDate() - 1);
      }
      return nextMonthLastDay;
    }
    
    return lastDay;
  }

  /**
   * Check if two dates are in the same month
   */
  private isSameMonth(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() && 
           date1.getMonth() === date2.getMonth();
  }

  /**
   * Check if current week is expiry week
   * Returns true for Tuesday-Thursday of expiry week
   */
  isExpiryWeek(): boolean {
    const today = new Date();
    const expiry = this.getCurrentMonthExpiry();
    
    // Calculate Tuesday of expiry week (expiry - 2 days)
    const expiryTuesday = new Date(expiry);
    expiryTuesday.setDate(expiry.getDate() - 2);
    expiryTuesday.setHours(0, 0, 0, 0);
    
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    
    const expiryEnd = new Date(expiry);
    expiryEnd.setHours(23, 59, 59, 999);
    
    const isExpiry = todayStart >= expiryTuesday && todayStart <= expiryEnd;
    
    if (isExpiry) {
      this.logger.info(`📅 Expiry Week Detected: ${expiryTuesday.toDateString()} to ${expiry.toDateString()}`);
    }
    
    return isExpiry;
  }

  /**
   * Analyze OI change for a single stock
   * Used by scanner for Smart Money scoring
   */
  async analyzeStock(symbol: string, currentPrice: number, prevClose: number): Promise<OIAnalysisResult | null> {
    // Skip if no historical data
    if (!this.yesterdayOI || !this.yesterdayOI.data[symbol]) {
      return null;
    }
    
    // Skip during expiry week
    if (this.isExpiryWeek()) {
      return null;
    }
    
    const prevEntry = this.yesterdayOI.data[symbol];
    const prevOI = prevEntry.futuresOI;
    
    // Skip if below minimum OI threshold
    if (prevOI < this.MIN_OI_THRESHOLD) {
      return null;
    }
    
    // Build futures cache if needed
    await this.buildFuturesTokenCache();
    
    // Get current OI
    const futuresInfo = this.futuresTokenCache.get(symbol);
    if (!futuresInfo) {
      return null;
    }
    
    try {
      const quoteKey = `NFO:${futuresInfo.symbol}`;
      const quotes = await this.kiteConnect.getQuote([quoteKey]);
      const quote = quotes[quoteKey];
      
      if (!quote || quote.oi === undefined) {
        return null;
      }
      
      const currentOI = quote.oi;
      const oiChangePercent = ((currentOI - prevOI) / prevOI) * 100;
      const priceChangePercent = ((currentPrice - prevClose) / prevClose) * 100;
      
      // Determine Smart Money signal based on OI-Price relationship
      // Reference: Wyckoff's "Coiled Spring" and FnO Market Dynamics
      let smartMoneySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'NONE' | 'CONFLICT' = 'NONE';
      let isCoiledSpring = false;
      
      const absOiChange = Math.abs(oiChangePercent);
      
      if (absOiChange >= this.OI_CHANGE_THRESHOLD) {
        // Significant OI change detected - analyze pattern
        
        if (oiChangePercent >= this.OI_CHANGE_THRESHOLD) {
          // OI INCREASED: New positions being built
          if (priceChangePercent >= 0 && priceChangePercent <= this.PRICE_CHANGE_MAX) {
            // Price flat/slightly up + OI exploding = ACCUMULATION (Bullish)
            smartMoneySignal = 'ACCUMULATION';
            isCoiledSpring = true;
          } else if (priceChangePercent >= -this.PRICE_CHANGE_MAX && priceChangePercent < 0) {
            // Price flat/slightly down + OI exploding = DISTRIBUTION (Bearish)
            smartMoneySignal = 'DISTRIBUTION';
            isCoiledSpring = true;
          }
        } else if (oiChangePercent <= -this.OI_CHANGE_THRESHOLD) {
          // OI DECREASED: Positions being closed
          if (priceChangePercent >= 0 && priceChangePercent <= this.PRICE_CHANGE_MAX) {
            // Price flat/slightly up + OI dropping = SHORT COVERING (Bullish)
            // Shorts closing = potential upside
            smartMoneySignal = 'SHORT_COVERING';
            isCoiledSpring = true;
          } else if (priceChangePercent >= -this.PRICE_CHANGE_MAX && priceChangePercent < 0) {
            // Price flat/slightly down + OI dropping = LONG UNWINDING (Bearish)
            // Longs exiting = potential downside
            smartMoneySignal = 'LONG_UNWINDING';
            isCoiledSpring = true;
          }
        }
      }
      
      return {
        symbol,
        prevOI,
        currentOI,
        oiChangePercent,
        priceChangePercent,
        isCoiledSpring,
        smartMoneySignal,
        futuresSymbol: futuresInfo.symbol
      };
      
    } catch (error) {
      this.logger.error(`Failed to analyze OI for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Calculate Smart Money score bonus for a stock
   * Returns +2.0 for matching coiled spring, 0 for neutral, -999 for conflict
   * 
   * Signal Alignment:
   * - LONG bias: ACCUMULATION (+2.0) or SHORT_COVERING (+2.0) = Bullish
   * - SHORT bias: DISTRIBUTION (+2.0) or LONG_UNWINDING (+2.0) = Bearish
   */
  calculateSmartMoneyBonus(oiAnalysis: OIAnalysisResult | null, bias: 'LONG' | 'SHORT'): number {
    if (!oiAnalysis || !oiAnalysis.isCoiledSpring) {
      return 0;  // No signal
    }
    
    const signal = oiAnalysis.smartMoneySignal;
    
    // Check for LONG alignment (Bullish signals)
    if (bias === 'LONG') {
      if (signal === 'ACCUMULATION' || signal === 'SHORT_COVERING') {
        return 2.0;  // 💎 Bullish Smart Money matches LONG bias
      }
      if (signal === 'DISTRIBUTION' || signal === 'LONG_UNWINDING') {
        return -999;  // ⚠️ CONFLICT: Technical LONG but Smart Money bearish
      }
    }
    
    // Check for SHORT alignment (Bearish signals)
    if (bias === 'SHORT') {
      if (signal === 'DISTRIBUTION' || signal === 'LONG_UNWINDING') {
        return 2.0;  // 💎 Bearish Smart Money matches SHORT bias
      }
      if (signal === 'ACCUMULATION' || signal === 'SHORT_COVERING') {
        return -999;  // ⚠️ CONFLICT: Technical SHORT but Smart Money bullish
      }
    }
    
    return 0;
  }

  /**
   * Get full OI analysis for all universe stocks
   * Used for dashboard display and validation
   */
  async getFullAnalysis(): Promise<OIAnalysisResult[]> {
    const results: OIAnalysisResult[] = [];
    
    if (!this.yesterdayOI) {
      this.logger.warn('No yesterday OI data available for analysis');
      return results;
    }
    
    // Build futures cache
    await this.buildFuturesTokenCache();
    
    // Fetch current quotes for all futures in batches
    const symbols = Array.from(this.futuresTokenCache.keys());
    const quoteKeys: string[] = [];
    const symbolToQuoteKey: Map<string, string> = new Map();
    
    for (const symbol of symbols) {
      const futuresInfo = this.futuresTokenCache.get(symbol);
      if (futuresInfo) {
        const quoteKey = `NFO:${futuresInfo.symbol}`;
        quoteKeys.push(quoteKey);
        symbolToQuoteKey.set(symbol, quoteKey);
      }
    }
    
    // Fetch stock prices too
    const stockQuoteKeys = symbols.map(s => `NSE:${s}`);
    
    try {
      // Batch fetch (Zerodha allows 500 per request)
      const [futuresQuotes, stockQuotes] = await Promise.all([
        this.kiteConnect.getQuote(quoteKeys.slice(0, 500)),
        this.kiteConnect.getQuote(stockQuoteKeys.slice(0, 500))
      ]);
      
      for (const symbol of symbols) {
        const prevEntry = this.yesterdayOI?.data[symbol];
        if (!prevEntry) continue;
        
        const futuresInfo = this.futuresTokenCache.get(symbol);
        if (!futuresInfo) continue;
        
        const futuresQuoteKey = `NFO:${futuresInfo.symbol}`;
        const stockQuoteKey = `NSE:${symbol}`;
        
        const futuresQuote = futuresQuotes[futuresQuoteKey];
        const stockQuote = stockQuotes[stockQuoteKey];
        
        if (!futuresQuote || !stockQuote) continue;
        
        const prevOI = prevEntry.futuresOI;
        const currentOI = futuresQuote.oi || 0;
        const currentPrice = stockQuote.last_price;
        const prevClose = stockQuote.ohlc?.close || currentPrice;
        
        if (prevOI < this.MIN_OI_THRESHOLD) continue;
        
        const oiChangePercent = ((currentOI - prevOI) / prevOI) * 100;
        const priceChangePercent = ((currentPrice - prevClose) / prevClose) * 100;
        
        let smartMoneySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'NONE' | 'CONFLICT' = 'NONE';
        let isCoiledSpring = false;
        
        if (oiChangePercent >= this.OI_CHANGE_THRESHOLD) {
          if (priceChangePercent >= 0 && priceChangePercent <= this.PRICE_CHANGE_MAX) {
            smartMoneySignal = 'ACCUMULATION';
            isCoiledSpring = true;
          } else if (priceChangePercent >= -this.PRICE_CHANGE_MAX && priceChangePercent < 0) {
            smartMoneySignal = 'DISTRIBUTION';
            isCoiledSpring = true;
          }
        }
        
        results.push({
          symbol,
          prevOI,
          currentOI,
          oiChangePercent,
          priceChangePercent,
          isCoiledSpring,
          smartMoneySignal,
          futuresSymbol: futuresInfo.symbol
        });
      }
      
      // Sort by OI change descending
      results.sort((a, b) => Math.abs(b.oiChangePercent) - Math.abs(a.oiChangePercent));
      
    } catch (error) {
      this.logger.error('Failed to get full OI analysis:', error);
    }
    
    return results;
  }

  /**
   * Get the raw history data (for API endpoint)
   * Reads from disk to get latest saved data (not in-memory cache)
   */
  getHistoryData(): OIHistoryData | null {
    try {
      if (!fs.existsSync(OIHistoryService.OI_HISTORY_FILE)) {
        return null;
      }
      const rawData = fs.readFileSync(OIHistoryService.OI_HISTORY_FILE, 'utf8');
      return JSON.parse(rawData);
    } catch (error) {
      this.logger.error('Failed to read OI history file:', error);
      return this.yesterdayOI;  // Fallback to in-memory
    }
  }

  /**
   * Check if we have valid OI history data
   */
  hasValidData(): boolean {
    return this.yesterdayOI !== null && Object.keys(this.yesterdayOI.data).length > 0;
  }
}
