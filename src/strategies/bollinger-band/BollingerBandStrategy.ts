import { Logger } from '../../utils/Logger';
import { StrategyBase, StrategyConfig, StrategyStatus } from '../../core/StrategyBase';
import { KiteTicker } from 'kiteconnect';

/**
 * Bollinger Band Strategy - Complete Implementation
 * Signal Instrument: NIFTY50 Spot
 * Independent Strategy with all functionality built-in
 */

// Interfaces for type safety
interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

interface Supertrend {
  value: number;
  trend: 'UP' | 'DOWN';
}

interface PivotLevels {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

interface CurrentCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean;
}

interface Position {
  type: 'LONG' | 'SHORT';
  instrument: any;
  entryPrice: number;
  quantity: number; // Total shares (lots * lot_size), e.g., 10 lots * 75 = 750 shares
  entryTime: Date;
  trailingSL?: number;
  highestPremium?: number;
}

export class BollingerBandStrategy extends StrategyBase {
  
  // Configuration constants
  private readonly FIXED_LOTS = 10;
  private readonly CAPITAL_ALLOCATION = 200000;
  
  // Historical data and indicators
  private candleHistory: Candle[] = [];
  private currentIndicators: {
    rsi: number;
    supertrend: Supertrend;
    bollingerBands: BollingerBands;
  } | null = null;
  private dailyPivots: PivotLevels | null = null;
  
  // NIFTY50 spot instrument token (needs to be set based on instruments list)
  private readonly NIFTY50_INSTRUMENT_TOKEN = 256265; // This will be fetched dynamically
  
  // Position management
  private currentPosition: Position | null = null;
  
  // 5-minute candle building
  private currentCandle: CurrentCandle | null = null;
  
  // Real-time monitoring
  private ltpPollingInterval: NodeJS.Timeout | null = null;
  private currentNiftyLTP: number = 0;
  private candleCheckInterval: NodeJS.Timeout | null = null;
  
  // WebSocket for option premium monitoring (only when positions are active)
  private optionWebSocket: any | null = null;
  private subscribedOptionTokens: Set<number> = new Set();
  private optionPremiumData: Map<number, number> = new Map();

  // Error monitoring and health tracking
  private errorCounts: Map<string, number> = new Map();
  private lastErrorTime: Map<string, Date> = new Map();
  private healthStatus: {
    dataStreamHealthy: boolean;
    executionHealthy: boolean;
    lastHeartbeat: Date;
    consecutiveErrors: number;
    criticalErrorsToday: number;
  } = {
    dataStreamHealthy: true,
    executionHealthy: true,
    lastHeartbeat: new Date(),
    consecutiveErrors: 0,
    criticalErrorsToday: 0
  };

  // Capital and trade management (separate from breakout strategy)
  private currentCapital: number = 200000; // 2 lakh initial capital
  private tradeHistory: any[] = [];
  private readonly BOLLINGER_DATA_FILE = 'data/bollinger-trading-data.json';

  // Retry infrastructure for error recovery
  private candleRetryTimer?: NodeJS.Timeout;
  private readonly MAX_RETRY_ATTEMPTS = 10; // For critical operations
  private readonly CANDLE_RETRY_INTERVAL = 10000; // 10 seconds for candle fetch
  private readonly TRADE_RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s exponential backoff

  constructor(kiteConnect: any, logger: Logger, config: StrategyConfig) {
    super(kiteConnect, logger, config);
    this.loadCapitalData(); // Load persisted capital on startup
  }

  /**
   * Load capital and trade history from persistent storage
   */
  private loadCapitalData(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (fs.existsSync(this.BOLLINGER_DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(this.BOLLINGER_DATA_FILE, 'utf8'));
        this.currentCapital = data.capital || 200000;
        this.tradeHistory = data.tradeHistory || [];
        
        this.logger.info('💰 Bollinger Band capital loaded', {
          capital: this.currentCapital,
          totalTrades: this.tradeHistory.length
        });
      } else {
        // Create initial data file
        this.saveCapitalData();
        this.logger.info('💰 Bollinger Band capital initialized at ₹2,00,000');
      }
    } catch (error) {
      this.logger.error('Error loading Bollinger Band capital data:', error);
      this.currentCapital = 200000; // Fallback to initial capital
    }
  }

  /**
   * Save capital and trade history to persistent storage
   */
  private saveCapitalData(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Ensure data directory exists
      const dataDir = path.dirname(this.BOLLINGER_DATA_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const data = {
        capital: this.currentCapital,
        tradeHistory: this.tradeHistory,
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(this.BOLLINGER_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Error saving Bollinger Band capital data:', error);
    }
  }

  public async initialize(): Promise<void> {
    this.logger.info('BollingerBandStrategy: Starting initialization...');
    
    try {
      // Step 0: Get NIFTY50 instrument token dynamically
      const nifty50Token = await this.getNifty50InstrumentToken();
      (this as any).NIFTY50_INSTRUMENT_TOKEN = nifty50Token;
      
      // Step 1: Load historical candle data (7-day window)
      await this.loadHistoricalData();
      
      // Step 2: Calculate daily pivots from previous trading day
      await this.calculateDailyPivotsFromMarketData();
      
      // Step 3: Initialize technical indicators with historical data
      this.updateTechnicalIndicators();
      
      this.isInitialized = true;
      this.logger.info('BollingerBandStrategy: Initialization complete', {
        instrumentToken: nifty50Token,
        candleCount: this.candleHistory.length,
        hasPivots: !!this.dailyPivots,
        hasIndicators: !!this.currentIndicators
      });
      
    } catch (error) {
      this.logger.error('BollingerBandStrategy: Initialization failed', error);
      throw error;
    }
  }

  public async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Strategy must be initialized before starting');
    }
    
    this.logger.info('BollingerBandStrategy: Starting strategy...');
    
    // Start health monitoring system
    this.startHealthMonitoring();
    
    // Start real-time monitoring
    this.startRealTimeMonitoring();
    
    this.metrics.isActive = true;
    this.metrics.healthStatus = 'healthy';
    // Update metrics timestamp to show strategy is active
    this.updateMetrics({ isActive: true, healthStatus: 'healthy' });
    this.logger.info('BollingerBandStrategy: Strategy started successfully with health monitoring');
  }

  public async stop(): Promise<void> {
    this.logger.info('BollingerBandStrategy: Stopping strategy...');
    
    // Stop all monitoring
    this.stopRealTimeMonitoring();
    
    // Stop retry mechanisms
    this.stopCandleRetryMechanism();
    
    // Force close any open positions
    if (this.currentPosition) {
      await this.forceClosePosition('STRATEGY_STOP');
    }
    
    this.metrics.isActive = false;
    this.metrics.healthStatus = 'stopped';
    // Update metrics timestamp to show strategy is stopped
    this.updateMetrics({ isActive: false, healthStatus: 'stopped' });
    this.logger.info('BollingerBandStrategy: Strategy stopped successfully');
  }

  /**
   * Daily cleanup for intraday strategy
   * Called at market open to clear previous day's data (keeps logs)
   */
  public async dailyCleanup(): Promise<void> {
    this.logger.info('🧹 Starting daily cleanup for new trading day...');
    
    try {
      // Clear historical data (keep only logs)
      this.candleHistory = [];
      this.currentIndicators = null;
      this.dailyPivots = null;
      this.currentCandle = null;
      this.currentNiftyLTP = 0;
      
      // Clear position data
      this.currentPosition = null;
      
      // Clear option data
      this.optionPremiumData.clear();
      this.subscribedOptionTokens.clear();
      
      // Reset health status
      this.healthStatus = {
        dataStreamHealthy: true,
        executionHealthy: true,
        lastHeartbeat: new Date(),
        consecutiveErrors: 0,
        criticalErrorsToday: 0
      };
      
      // Reset error tracking (keep logs but reset counters)
      this.errorCounts.clear();
      this.lastErrorTime.clear();
      
      this.logger.info('✅ Daily cleanup completed - ready for new trading day');
    } catch (error) {
      this.logger.error('❌ Error during daily cleanup:', error);
      throw error;
    }
  }

  public getStatus(): StrategyStatus {
    return {
      config: this.getConfig(),
      metrics: {
        ...this.getMetrics(),
        isStreaming: false // No real-time streaming needed for 5-minute strategy
      },
      recentTrades: this.tradeHistory.slice(-10), // Last 10 trades
      // Custom strategy status
      fixedLots: this.FIXED_LOTS,
      capitalAllocation: this.CAPITAL_ALLOCATION,
      currentCapital: this.currentCapital, // Current capital amount
      totalTrades: this.tradeHistory.length, // Total completed trades
      indicators: this.currentIndicators,
      pivots: this.dailyPivots,
      candleCount: this.candleHistory.length,
      currentNiftyPrice: this.getLastCompletedCandleClose(),
      currentCandle: this.currentCandle,
      optionWebSocketStatus: {
        connected: this.optionWebSocket !== null,
        subscribedTokens: this.subscribedOptionTokens.size
      }
    } as StrategyStatus;
  }

  // Implement abstract method from StrategyBase
  public async processMarketData(data: any): Promise<void> {
    // TODO: Implement real-time market data processing
    this.logger.debug('Processing market data:', data);
  }

  // Technical Indicator Calculations

  /**
   * Calculate RSI using TradingView formula
   * RSI = 100 - (100 / (1 + RS))
   * RS = Average Gain / Average Loss
   * Using RMA (Exponentially Weighted Moving Average)
   */
  private calculateRSI(candles: Candle[], period: number = 10): number {
    if (candles.length < period + 1) return 50; // Default neutral RSI
    
    const changes: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const currentCandle = candles[i];
      const prevCandle = candles[i - 1];
      if (currentCandle && prevCandle) {
        changes.push(currentCandle.close - prevCandle.close);
      }
    }
    
    if (changes.length < period) return 50;
    
    // Calculate initial averages for first period
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < period; i++) {
      const change = changes[i];
      if (change !== undefined) {
        if (change > 0) {
          avgGain += change;
        } else {
          avgLoss += Math.abs(change);
        }
      }
    }
    
    avgGain /= period;
    avgLoss /= period;
    
    // Apply RMA smoothing for remaining periods
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      if (change !== undefined) {
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        
        // RMA formula: (previous_average * (period - 1) + current_value) / period
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
      }
    }
    
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate Bollinger Bands
   * Middle Band = SMA(close, period)
   * Upper Band = Middle Band + (stdDev * multiplier)
   * Lower Band = Middle Band - (stdDev * multiplier)
   */
  private calculateBollingerBands(candles: Candle[], period: number = 20, stdDevMultiplier: number = 2): BollingerBands {
    if (candles.length < period) {
      // Return default bands if insufficient data
      const lastClose = candles[candles.length - 1]?.close || 0;
      return {
        upper: lastClose * 1.02,
        middle: lastClose,
        lower: lastClose * 0.98
      };
    }
    
    // Get last 'period' closes
    const closes = candles.slice(-period).map(c => c.close);
    
    // Calculate SMA (Middle Band)
    const sma = closes.reduce((sum, close) => sum + close, 0) / period;
    
    // Calculate Standard Deviation
    const variance = closes.reduce((sum, close) => sum + Math.pow(close - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
      upper: sma + (stdDev * stdDevMultiplier),
      middle: sma,
      lower: sma - (stdDev * stdDevMultiplier)
    };
  }

  /**
   * Calculate Supertrend indicator using correct algorithm
   * Based on TradingView implementation:
   * 1. Calculate ATR over period
   * 2. Basic Upper Band = HL2 + (multiplier * ATR)
   * 3. Basic Lower Band = HL2 - (multiplier * ATR)
   * 4. Final Upper Band = BasicUB < FinalUB[1] OR Close[1] > FinalUB[1] ? BasicUB : FinalUB[1]
   * 5. Final Lower Band = BasicLB > FinalLB[1] OR Close[1] < FinalLB[1] ? BasicLB : FinalLB[1]
   * 6. Supertrend = Trend == 1 ? FinalLB : FinalUB
   * 7. Trend = Close <= FinalUB ? -1 : Close >= FinalLB ? 1 : Trend[1]
   */
  private calculateSupertrend(candles: Candle[], period: number = 10, multiplier: number = 2): Supertrend {
    if (candles.length < Math.max(period + 1, 3)) {
      const lastClose = candles[candles.length - 1]?.close || 0;
      return { value: lastClose, trend: 'UP' };
    }
    
    const supertrendValues: Array<{
      close: number;
      basicUB: number;
      basicLB: number;
      finalUB: number;  
      finalLB: number;
      trend: number; // 1 = UP, -1 = DOWN
      supertrend: number;
    }> = [];
    
    // Process all candles to build proper Supertrend with continuity
    for (let i = period; i < candles.length; i++) {
      const currentCandles = candles.slice(0, i + 1);
      const atr = this.calculateATR(currentCandles, period);
      const candle = candles[i];
      const prevCandle = i > 0 ? candles[i - 1] : null;
      
      if (!candle) continue;
      
      // Calculate basic bands
      const hl2 = (candle.high + candle.low) / 2;
      const basicUB = hl2 + (multiplier * atr);
      const basicLB = hl2 - (multiplier * atr);
      
      let finalUB: number, finalLB: number, trend: number, supertrend: number;
      
      if (supertrendValues.length === 0) {
        // First calculation
        finalUB = basicUB;
        finalLB = basicLB;
        trend = candle.close <= finalUB ? -1 : 1;
        supertrend = trend === 1 ? finalLB : finalUB;
      } else {
        const prev = supertrendValues[supertrendValues.length - 1];
        const prevClose = prevCandle?.close || candle.close;
        
        if (!prev) {
          // Fallback if no previous value
          finalUB = basicUB;
          finalLB = basicLB;
          trend = candle.close <= finalUB ? -1 : 1;
          supertrend = trend === 1 ? finalLB : finalUB;
        } else {
          // Final Upper Band logic
          finalUB = (basicUB < prev.finalUB || prevClose > prev.finalUB) ? basicUB : prev.finalUB;
          
          // Final Lower Band logic  
          finalLB = (basicLB > prev.finalLB || prevClose < prev.finalLB) ? basicLB : prev.finalLB;
          
          // Trend determination - Use PREVIOUS Supertrend level for flip condition
          if (prev.trend === 1) {
            // Previous trend was UP, check if close goes below previous Supertrend level
            if (candle.close < prev.supertrend) {
              trend = -1; // Flip to DOWN
            } else {
              trend = 1;  // Stay UP
            }
          } else {
            // Previous trend was DOWN, check if close goes above previous Supertrend level  
            if (candle.close > prev.supertrend) {
              trend = 1;  // Flip to UP
            } else {
              trend = -1; // Stay DOWN
            }
          }
          
          // Supertrend value
          supertrend = trend === 1 ? finalLB : finalUB;
        }
      }
      
      supertrendValues.push({
        close: candle.close,
        basicUB,
        basicLB,
        finalUB,
        finalLB,
        trend,
        supertrend
      });
    }
    
    if (supertrendValues.length === 0) {
      const lastClose = candles[candles.length - 1]?.close || 0;
      return { value: lastClose, trend: 'UP' };
    }
    
    const lastST = supertrendValues[supertrendValues.length - 1];
    if (!lastST) {
      const lastClose = candles[candles.length - 1]?.close || 0;
      return { value: lastClose, trend: 'UP' };
    }
    
    // Debug log for the last few calculations
    const debugCount = Math.min(3, supertrendValues.length);
    const recentValues = supertrendValues.slice(-debugCount);
    
    this.logger.info('Supertrend calculation debug (TradingView compatible)', {
      parameters: { period, multiplier },
      totalCandles: candles.length,
      lastCandle: {
        timestamp: candles[candles.length - 1]?.timestamp,
        ohlc: {
          open: candles[candles.length - 1]?.open.toFixed(2),
          high: candles[candles.length - 1]?.high.toFixed(2),
          low: candles[candles.length - 1]?.low.toFixed(2),
          close: candles[candles.length - 1]?.close.toFixed(2)
        }
      },
      recentSupertrend: recentValues.map(st => ({
        close: st.close.toFixed(2),
        basicUB: st.basicUB.toFixed(2),
        basicLB: st.basicLB.toFixed(2),
        finalUB: st.finalUB.toFixed(2),
        finalLB: st.finalLB.toFixed(2),
        trend: st.trend === 1 ? 'UP' : 'DOWN',
        supertrend: st.supertrend.toFixed(2)
      })),
      finalResult: {
        value: lastST.supertrend.toFixed(2),
        trend: lastST.trend === 1 ? 'UP' : 'DOWN'
      }
    });
    
    return { 
      value: lastST.supertrend, 
      trend: lastST.trend === 1 ? 'UP' : 'DOWN' 
    };
  }

  /**
   * Calculate Average True Range (ATR) for Supertrend using Wilder's smoothing (RMA)
   * TradingView uses RMA (Running Moving Average) not SMA for ATR
   */
  private calculateATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 1; // Need enough data for RMA
    
    const trueRanges: number[] = [];
    
    // Calculate True Range for all candles
    for (let i = 1; i < candles.length; i++) {
      const currentCandle = candles[i];
      const prevCandle = candles[i - 1];
      
      if (currentCandle && prevCandle) {
        const high = currentCandle.high;
        const low = currentCandle.low;
        const prevClose = prevCandle.close;
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        trueRanges.push(Math.max(tr1, tr2, tr3));
      }
    }
    
    if (trueRanges.length < period) return 1;
    
    // Calculate ATR using RMA (Wilder's smoothing)
    // First ATR = SMA of first 'period' true ranges
    let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
    
    // Apply RMA smoothing for remaining periods: ATR = (ATR_prev * (period-1) + TR) / period
    for (let i = period; i < trueRanges.length; i++) {
      const currentTR = trueRanges[i];
      if (currentTR !== undefined) {
        atr = (atr * (period - 1) + currentTR) / period;
      }
    }
    
    return atr;
  }

  /**
   * Calculate Daily Pivot Levels from previous trading day OHLC
   * PP = (High + Low + Close) / 3
   * R1 = (2 * PP) - Low, S1 = (2 * PP) - High
   * R2 = PP + (High - Low), S2 = PP - (High - Low)
   * R3 = High + 2 * (PP - Low), S3 = Low - 2 * (High - PP)
   */
  private calculateDailyPivots(previousDayOHLC: { high: number; low: number; close: number }): PivotLevels {
    const { high, low, close } = previousDayOHLC;
    
    const pp = (high + low + close) / 3;
    
    return {
      pp,
      r1: (2 * pp) - low,
      s1: (2 * pp) - high,
      r2: pp + (high - low),
      s2: pp - (high - low),
      r3: high + 2 * (pp - low),
      s3: low - 2 * (high - pp)
    };
  }

  /**
   * Load 7 days of historical NIFTY50 spot candles
   * Handle weekends/holidays by extending lookback up to 14 days if needed
   */
  private async loadHistoricalData(): Promise<void> {
    this.logger.info('Loading historical NIFTY50 candle data...');
    
    const maxLookbackDays = 14;
    const requiredCandles = 25; // Minimum candles needed (20 for BB + buffer)
    
    for (let lookbackDays = 7; lookbackDays <= maxLookbackDays; lookbackDays++) {
      try {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - lookbackDays);
        
        this.logger.info(`Fetching historical data: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`);
        
        const historicalData = await this.kiteConnect.getHistoricalData(
          this.NIFTY50_INSTRUMENT_TOKEN,
          '5minute',
          fromDate,
          toDate
        );
        
        if (historicalData && historicalData.length >= requiredCandles) {
          // Convert KiteConnect format to our Candle interface
          this.candleHistory = historicalData.map((kiteCandle: any) => ({
            timestamp: new Date(kiteCandle.date),
            open: kiteCandle.open,
            high: kiteCandle.high,
            low: kiteCandle.low,
            close: kiteCandle.close,
            volume: kiteCandle.volume || 0
          }));
          
          this.logger.info(`Historical data loaded successfully: ${this.candleHistory.length} candles`);
          return;
        } else {
          this.logger.warn(`Insufficient data with ${lookbackDays} days: ${historicalData?.length || 0} candles`);
        }
        
      } catch (error) {
        this.logger.error(`Failed to fetch historical data for ${lookbackDays} days:`, error);
      }
    }
    
    throw new Error(`Failed to load sufficient historical data after ${maxLookbackDays} days`);
  }

  /**
   * Calculate daily pivots from previous trading day OHLC
   * Fetch the most recent daily candle to get previous day's data
   */
  private async calculateDailyPivotsFromMarketData(): Promise<void> {
    this.logger.info('Calculating daily pivot levels...');
    
    try {
      // Extend date range to ensure we get recent trading data
      // Use yesterday as toDate to avoid incomplete current day data
      const toDate = new Date();
      toDate.setDate(toDate.getDate() - 1); // Use yesterday to ensure complete data
      
      const fromDate = new Date();
      fromDate.setDate(toDate.getDate() - 10); // Get last 10 days to ensure enough trading days
      
      this.logger.info('Fetching daily pivot data', {
        fromDate: fromDate.toISOString().split('T')[0],
        toDate: toDate.toISOString().split('T')[0]
      });
      
      const dailyData = await this.kiteConnect.getHistoricalData(
        this.NIFTY50_INSTRUMENT_TOKEN,
        'day',
        fromDate,
        toDate
      );
      
      if (!dailyData || dailyData.length < 1) {
        throw new Error('No daily data available for pivot calculation');
      }
      
      // Get the most recent completed trading day
      const previousDay = dailyData[dailyData.length - 1];
      
      this.dailyPivots = this.calculateDailyPivots({
        high: previousDay.high,
        low: previousDay.low,
        close: previousDay.close
      });
      
      // Debug: Show all available dates to verify we're using the right one
      this.logger.info('Available daily candles:', {
        totalCandles: dailyData.length,
        dateRange: dailyData.length > 0 ? {
          oldest: dailyData[0].date,
          newest: dailyData[dailyData.length - 1].date
        } : 'No data',
        allDates: dailyData.map((d: any) => d.date).slice(-5) // Show last 5 dates
      });

      this.logger.info('Daily pivots calculated', {
        date: previousDay.date,
        forTradingDay: 'Using most recent completed trading day for pivot calculation',
        pp: this.dailyPivots.pp.toFixed(2),
        r1: this.dailyPivots.r1.toFixed(2),
        s1: this.dailyPivots.s1.toFixed(2)
      });
      
    } catch (error) {
      this.logger.error('Failed to calculate daily pivots:', error);
      throw error;
    }
  }

  /**
   * Get NIFTY50 instrument token dynamically from instruments list
   * This method would be called during initialization to get the correct token
   */
  private async getNifty50InstrumentToken(): Promise<number> {
    try {
      // Try to find NIFTY 50 INDEX in different exchanges and formats
      let nifty50 = null;
      
      // First try: Look for NIFTY 50 INDEX in NSE
      try {
        const nseInstruments = await this.kiteConnect.getInstruments('NSE');
        nifty50 = nseInstruments.find((inst: any) => 
          (inst.name === 'NIFTY 50' || inst.name === 'NIFTY50') && 
          (inst.instrument_type === 'INDEX' || inst.segment === 'INDICES')
        );
        
        if (nifty50) {
          this.logger.info('NIFTY50 INDEX found in NSE', {
            token: nifty50.instrument_token,
            tradingsymbol: nifty50.tradingsymbol,
            name: nifty50.name,
            instrument_type: nifty50.instrument_type,
            segment: nifty50.segment
          });
          return nifty50.instrument_token;
        }
      } catch (nseError) {
        this.logger.warn('Could not fetch NSE instruments:', nseError);
      }
      
      // Second try: Look for NIFTY 50 INDEX in INDICES exchange
      try {
        const indexInstruments = await this.kiteConnect.getInstruments('INDICES');
        nifty50 = indexInstruments.find((inst: any) => 
          inst.name === 'NIFTY 50' || inst.name === 'NIFTY50' || inst.tradingsymbol === 'NIFTY 50'
        );
        
        if (nifty50) {
          this.logger.info('NIFTY50 INDEX found in INDICES', {
            token: nifty50.instrument_token,
            tradingsymbol: nifty50.tradingsymbol,
            name: nifty50.name,
            instrument_type: nifty50.instrument_type,
            segment: nifty50.segment
          });
          return nifty50.instrument_token;
        }
      } catch (indicesError) {
        this.logger.warn('Could not fetch INDICES instruments:', indicesError);
      }
      
      // Third try: Look for any NIFTY 50 in NSE (including EQ type)
      try {
        const nseInstruments = await this.kiteConnect.getInstruments('NSE');
        nifty50 = nseInstruments.find((inst: any) => 
          inst.name === 'NIFTY 50'
        );
        
        if (nifty50) {
          this.logger.warn('Using NIFTY 50 instrument (might not be INDEX)', {
            token: nifty50.instrument_token,
            tradingsymbol: nifty50.tradingsymbol,
            name: nifty50.name,
            instrument_type: nifty50.instrument_type,
            segment: nifty50.segment,
            warning: 'This might be ETF/EQ instead of pure INDEX'
          });
          return nifty50.instrument_token;
        }
      } catch (fallbackError) {
        this.logger.warn('Fallback NSE search failed:', fallbackError);
      }
      
      throw new Error('NIFTY50 INDEX instrument not found in any exchange');
      
    } catch (error) {
      this.logger.error('Failed to get NIFTY50 instrument token:', error);
      this.logger.info('Using hardcoded fallback token 256265 - please verify this is correct NIFTY 50 INDEX');
      // Fallback to hardcoded token
      return 256265;
    }
  }

  /**
   * Update all technical indicators with current candle data
   */
  private updateTechnicalIndicators(): void {
    if (this.candleHistory.length === 0) return;
    
    this.currentIndicators = {
      rsi: this.calculateRSI(this.candleHistory, 10),
      supertrend: this.calculateSupertrend(this.candleHistory, 10, 2),
      bollingerBands: this.calculateBollingerBands(this.candleHistory, 20, 2)
    };
    
    this.logger.info('Technical indicators updated', {
      rsi: this.currentIndicators.rsi,
      supertrend: this.currentIndicators.supertrend.trend,
      bb_upper: this.currentIndicators.bollingerBands.upper,
      bb_middle: this.currentIndicators.bollingerBands.middle,
      bb_lower: this.currentIndicators.bollingerBands.lower
    });
  }

  // ===========================
  // REAL-TIME MONITORING
  // ===========================

  /**
   * Start monitoring aligned to 5-minute candle closes (0, 5, 10, 15... minutes)
   * Checks for entries precisely when new 5-minute candles complete
   */
  private startRealTimeMonitoring(): void {
    this.logger.info('🚀 Starting 5-minute candle monitoring aligned to market intervals...');
    
    // Calculate time until next 5-minute candle close
    const now = new Date();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    
    // Find next 5-minute interval (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    const nextInterval = Math.ceil(currentMinutes / 5) * 5;
    const minutesUntilNext = (nextInterval === 60) ? (60 - currentMinutes) : (nextInterval - currentMinutes);
    const secondsUntilNext = (60 - currentSeconds) + (minutesUntilNext - 1) * 60;
    
    this.logger.info(`⏰ Next 5-minute candle close in ${Math.floor(secondsUntilNext / 60)}:${(secondsUntilNext % 60).toString().padStart(2, '0')}`);
    
    // Set initial timeout to align with next 5-minute candle close
    setTimeout(() => {
      // First fetch at the aligned time with retry mechanism
      this.fetchLatest5MinuteCandleWithRetry();
      
      // Then set up regular 5-minute interval with retry capability
      this.candleCheckInterval = setInterval(async () => {
        await this.fetchLatest5MinuteCandleWithRetry();
      }, 5 * 60 * 1000); // 5 minutes
      
    }, secondsUntilNext * 1000);
    
    // Only start LTP polling if we have active positions that need exit monitoring
    if (this.currentPosition) {
      this.startPositionMonitoring();
    }
  }

  /**
   * Stop real-time monitoring and cleanup WebSocket connections
   */
  private stopRealTimeMonitoring(): void {
    if (this.ltpPollingInterval) {
      clearInterval(this.ltpPollingInterval);
      this.ltpPollingInterval = null;
    }
    
    if (this.candleCheckInterval) {
      clearInterval(this.candleCheckInterval);
      this.candleCheckInterval = null;
    }
    
    // Cleanup option WebSocket if no positions
    if (!this.currentPosition) {
      this.cleanupOptionWebSocket();
    }
    
    this.logger.info('Real-time monitoring stopped');
  }

  /**
   * Start health monitoring with periodic status reports
   */
  private startHealthMonitoring(): void {
    // Report health status every 5 minutes
    setInterval(() => {
      this.healthStatus.lastHeartbeat = new Date();
      const healthReport = this.getHealthReport();
      
      if (!healthReport.overall) {
        this.logger.warn('ðŸ’Š STRATEGY HEALTH REPORT (UNHEALTHY):', healthReport);
      } else {
        this.logger.info('ðŸ’š Strategy health: OK', {
          consecutiveErrors: healthReport.consecutiveErrors,
          timeSinceHeartbeat: healthReport.timeSinceHeartbeat,
          candleCount: healthReport.candleHistoryLength
        });
      }
      
      // Reset daily error counts at market open (9:15 AM)
      const now = new Date();
      if (now.getHours() === 9 && now.getMinutes() === 15) {
        this.healthStatus.criticalErrorsToday = 0;
        this.errorCounts.clear();
        this.logger.info('ðŸ”„ Daily error counts reset');
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Fetch latest 5-minute candle from API and check for entry signals
   * Called precisely at 5-minute candle closes (13:35:00, 13:40:00, etc.)
   */
  private async fetchLatest5MinuteCandle(): Promise<void> {
    try {
      const now = new Date();
      this.logger.info(`🕐 Fetching 5-minute candle at ${now.toLocaleTimeString()}`);
      
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - 10 * 60 * 1000); // Last 10 minutes to get latest candle
      
      const historicalData = await this.kiteConnect.getHistoricalData(
        this.NIFTY50_INSTRUMENT_TOKEN,
        '5minute',
        fromDate,
        toDate
      );

      if (historicalData && historicalData.length > 0) {
        const latestCandle = historicalData[historicalData.length - 1];
        const newCandle: Candle = {
          timestamp: new Date(latestCandle.date),
          open: latestCandle.open,
          high: latestCandle.high,
          low: latestCandle.low,
          close: latestCandle.close,
          volume: latestCandle.volume
        };

        this.logger.info(`📊 New 5-minute candle: ${newCandle.timestamp.toLocaleTimeString()} OHLC: ${newCandle.open}/${newCandle.high}/${newCandle.low}/${newCandle.close} V:${newCandle.volume}`);

        // Enhanced duplicate prevention: Check both timestamp and all OHLC values
        const lastHistoricalCandle = this.candleHistory[this.candleHistory.length - 1];
        const isDuplicate = lastHistoricalCandle && 
          newCandle.timestamp.getTime() === lastHistoricalCandle.timestamp.getTime() &&
          newCandle.open === lastHistoricalCandle.open &&
          newCandle.high === lastHistoricalCandle.high &&
          newCandle.low === lastHistoricalCandle.low &&
          newCandle.close === lastHistoricalCandle.close;

        if (!isDuplicate) {
          // Additional safety: Check if timestamp is newer (for edge cases)
          const isNewerCandle = !lastHistoricalCandle || newCandle.timestamp.getTime() > lastHistoricalCandle.timestamp.getTime();
          
          if (isNewerCandle) {
            this.candleHistory.push(newCandle);
            this.logger.info(`ðŸ“Š New 5-minute candle: NIFTY50 ${newCandle.close} (${newCandle.timestamp.toLocaleTimeString()})`);
          } else {
            // Same timestamp but different OHLC - update existing candle (live candle update)
            if (lastHistoricalCandle && newCandle.timestamp.getTime() === lastHistoricalCandle.timestamp.getTime()) {
              this.candleHistory[this.candleHistory.length - 1] = newCandle;
              this.logger.debug(`ðŸ”„ Updated current 5-minute candle: NIFTY50 ${newCandle.close}`);
            }
          }
          
          // Keep only last 50 candles for indicators
          if (this.candleHistory.length > 50) {
            this.candleHistory = this.candleHistory.slice(-50);
          }
          
          // Update indicators with new/updated candle
          this.updateTechnicalIndicators();
          
          // Check for new signals
          await this.checkEntrySignals();
          
          // Check position exit conditions with new candle data (replaces 1-second polling)
          if (this.currentPosition) {
            await this.checkPositionExit();
          }
          
          // Update metrics to show strategy is responsive
          this.updateMetrics({ healthStatus: 'healthy' });
        } else {
          // Duplicate detected - log for debugging
          this.logger.debug(` Duplicate 5-minute candle detected, skipping: ${newCandle.timestamp.toLocaleTimeString()}`);
          
          // Even for duplicates, update metrics to show we're processing
          this.updateMetrics({ healthStatus: 'healthy' });
        }
      }
    } catch (error) {
      this.trackError('candle_fetch', error, true);
      this.healthStatus.dataStreamHealthy = false;
      // Update metrics to reflect error state
      this.updateMetrics({ healthStatus: 'error' });
    }
  }

  /**
   * Start position monitoring only when we have active positions
   * Uses 5-minute candle data for exit conditions (eliminates 1-second API polling)
   */
  private startPositionMonitoring(): void {
    if (this.ltpPollingInterval) return; // Already running

    this.logger.info('🔄 Position monitoring active - exit conditions checked with each 5-minute candle (no 1-second polling)');
    // No polling interval needed - position exits are checked when new 5-minute candles arrive
    // This saves ~3600 API calls per hour while maintaining strategy integrity
  }

  /**
   * Stop position monitoring when no active positions
   */
  private stopPositionMonitoring(): void {
    // No polling interval to clear since we removed 1-second polling
    this.logger.info('Position monitoring stopped (no active positions)');
    
    // Also cleanup option WebSocket subscriptions
    this.cleanupOptionWebSocket();
  }

  /**
   * Initialize WebSocket for option premium monitoring
   * Only used when we have active option positions
   */
  private async initializeOptionWebSocket(): Promise<void> {
    try {
      if (this.optionWebSocket) {
        this.logger.info('Option WebSocket already initialized');
        return;
      }

      this.logger.info('ðŸ”Œ Initializing Option WebSocket for premium monitoring...');
      
      // Get access token from kiteConnect instance
      const accessToken = this.kiteConnect.access_token;
      const apiKey = process.env.ZERODHA_API_KEY;

      if (!accessToken || !apiKey) {
        throw new Error('Missing access token or API key for Option WebSocket initialization');
      }

      this.optionWebSocket = new KiteTicker({
        api_key: apiKey,
        access_token: accessToken
      });

      this.optionWebSocket.on('connect', () => {
        this.logger.info('âœ… Option WebSocket connected successfully');
        
        // Subscribe to any pending option instruments
        if (this.subscribedOptionTokens.size > 0) {
          const tokens = Array.from(this.subscribedOptionTokens);
          this.logger.info(`ðŸ“¡ Subscribing to ${tokens.length} option(s) on connect: ${tokens.join(', ')}`);
          this.optionWebSocket.subscribe(tokens);
          this.optionWebSocket.setMode(this.optionWebSocket.modeLTP, tokens);
        }
      });

      this.optionWebSocket.on('ticks', (ticks: any[]) => {
        ticks.forEach(tick => {
          if (this.subscribedOptionTokens.has(tick.instrument_token)) {
            this.optionPremiumData.set(tick.instrument_token, tick.last_price);
            this.logger.debug(`ðŸ“Š Option premium update: Token ${tick.instrument_token} = â‚¹${tick.last_price}`);
          }
        });
      });

      this.optionWebSocket.on('disconnect', () => {
        this.logger.warn('ðŸ”Œ Option WebSocket disconnected');
      });

      this.optionWebSocket.on('error', (error: any) => {
        this.logger.error('âŒ Option WebSocket error:', error);
      });

      this.optionWebSocket.connect();
      
    } catch (error) {
      this.logger.error('âŒ Failed to initialize Option WebSocket:', error);
      throw error;
    }
  }

  /**
   * Subscribe to option instrument for real-time premium monitoring
   */
  private async subscribeToOption(instrumentToken: number): Promise<void> {
    try {
      if (!this.optionWebSocket) {
        await this.initializeOptionWebSocket();
      }

      if (!this.subscribedOptionTokens.has(instrumentToken)) {
        this.logger.info(`ðŸ“¡ Preparing subscription for option premium: Token ${instrumentToken}`);
        
        // Add to subscribed tokens - actual subscription will happen in connect event
        this.subscribedOptionTokens.add(instrumentToken);
        
        // If WebSocket is already connected, subscribe immediately
        if (this.optionWebSocket.readyState === 1) { // WebSocket.OPEN
          this.logger.info(`ðŸ“¡ Subscribing to option premium immediately: Token ${instrumentToken}`);
          this.optionWebSocket.subscribe([instrumentToken]);
          this.optionWebSocket.setMode(this.optionWebSocket.modeLTP, [instrumentToken]);
          this.logger.info(`âœ… Option WebSocket subscription completed for token ${instrumentToken}`);
        } else {
          this.logger.info(`â³ Option subscription queued for token ${instrumentToken} (will subscribe on connect)`);
        }
      }
    } catch (error) {
      this.logger.error('âŒ Failed to subscribe to option:', error);
    }
  }

  /**
   * Unsubscribe from option and cleanup
   */
  private async unsubscribeFromOption(instrumentToken: number): Promise<void> {
    try {
      if (this.optionWebSocket && this.subscribedOptionTokens.has(instrumentToken)) {
        this.logger.info(`ðŸ“¡ Unsubscribing from option: Token ${instrumentToken}`);
        
        this.optionWebSocket.unsubscribe([instrumentToken]);
        this.subscribedOptionTokens.delete(instrumentToken);
        this.optionPremiumData.delete(instrumentToken);
        
        this.logger.info(`âœ… Option unsubscribed: Token ${instrumentToken}`);
      }
    } catch (error) {
      this.logger.error('âŒ Failed to unsubscribe from option:', error);
    }
  }

  /**
   * Cleanup option WebSocket when no positions
   */
  private cleanupOptionWebSocket(): void {
    try {
      if (this.optionWebSocket) {
        this.logger.info('ðŸ§¹ Cleaning up Option WebSocket...');
        
        // Unsubscribe from all tokens
        this.subscribedOptionTokens.forEach(token => {
          this.optionWebSocket.unsubscribe([token]);
        });
        
        this.optionWebSocket.disconnect();
        this.optionWebSocket = null;
        this.subscribedOptionTokens.clear();
        this.optionPremiumData.clear();
        
        this.logger.info('âœ… Option WebSocket cleanup completed');
      }
    } catch (error) {
      this.logger.error('âŒ Error cleaning up Option WebSocket:', error);
    }
  }

  /**
   * Check exit conditions for active position using current LTP
   */
  private async checkPositionExit(): Promise<void> {
    if (!this.currentPosition) return;

    try {
      // Get current NIFTY50 spot LTP for exit monitoring
      const quote = await this.kiteConnect.getQuote([this.NIFTY50_INSTRUMENT_TOKEN]);
      const nifty50Quote = quote[this.NIFTY50_INSTRUMENT_TOKEN];
      
      if (!nifty50Quote) {
        this.logger.warn('No quote data received for NIFTY50 position monitoring');
        return;
      }
      
      const currentLTP = nifty50Quote.last_price;
      this.currentNiftyLTP = currentLTP; // Store for dashboard
      
      // Check exit conditions
      await this.checkExitConditions(currentLTP);
      
      // Update metrics after successful position monitoring
      this.updateMetrics({
        healthStatus: 'healthy'
      });
      
    } catch (error) {
      this.logger.error('Error checking position exit:', error);
      // Update metrics with error status
      this.updateMetrics({
        healthStatus: 'error'
      });
    }
  }

  /**
   * Process LTP update and build 5-minute candles
   */
  private async processLTPUpdate(): Promise<void> {
    try {
      // Get current NIFTY50 spot LTP
      const quote = await this.kiteConnect.getQuote([this.NIFTY50_INSTRUMENT_TOKEN]);
      const nifty50Quote = quote[this.NIFTY50_INSTRUMENT_TOKEN];
      
      if (!nifty50Quote) {
        this.logger.warn('No quote data received for NIFTY50');
        return;
      }
      
      const currentLTP = nifty50Quote.last_price;
      const timestamp = new Date();
      
      // Store current LTP for dashboard display
      this.currentNiftyLTP = currentLTP;
      
      // Build 5-minute candle
      this.buildFiveMinuteCandle(currentLTP, timestamp);
      
      // Check exit conditions for existing positions
      if (this.currentPosition) {
        await this.checkExitConditions(currentLTP);
      }
      
    } catch (error) {
      this.logger.error('Error processing LTP update:', error);
    }
  }

  /**
   * Build 5-minute candle from LTP data
   */
  private buildFiveMinuteCandle(ltp: number, timestamp: Date): void {
    const candleStart = new Date(timestamp);
    candleStart.setSeconds(0, 0);
    candleStart.setMinutes(Math.floor(candleStart.getMinutes() / 5) * 5);
    
    if (!this.currentCandle || this.currentCandle.timestamp.getTime() !== candleStart.getTime()) {
      // Complete previous candle if exists
      if (this.currentCandle && !this.currentCandle.isComplete) {
        this.completeFiveMinuteCandle();
      }
      
      // Start new candle
      this.currentCandle = {
        timestamp: candleStart,
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: 0, // Volume not available from spot quotes
        isComplete: false
      };
    } else {
      // Update current candle
      this.currentCandle.high = Math.max(this.currentCandle.high, ltp);
      this.currentCandle.low = Math.min(this.currentCandle.low, ltp);
      this.currentCandle.close = ltp;
    }
  }

  /**
   * Check if 5-minute candle should be completed
   */
  private checkCandleCompletion(): void {
    if (!this.currentCandle || this.currentCandle.isComplete) return;
    
    const now = new Date();
    const candleEnd = new Date(this.currentCandle.timestamp.getTime() + 5 * 60 * 1000);
    
    if (now >= candleEnd) {
      this.completeFiveMinuteCandle();
    }
  }

  /**
   * Complete 5-minute candle and trigger strategy logic
   */
  private completeFiveMinuteCandle(): void {
    if (!this.currentCandle) return;
    
    this.currentCandle.isComplete = true;
    this.logger.info('5-minute candle completed', {
      timestamp: this.currentCandle.timestamp,
      ohlc: `O:${this.currentCandle.open} H:${this.currentCandle.high} L:${this.currentCandle.low} C:${this.currentCandle.close}`
    });
    
    // Process completed candle (main strategy logic)
    this.processCandleCompletion();
  }

  /**
   * Main strategy logic - processes completed 5-minute candle
   */
  private async processCandleCompletion(): Promise<void> {
    if (!this.currentCandle || !this.currentCandle.isComplete) return;
    
    // Step 1: Entry/Exit checks FIRST (before indicator updates)
    if (this.currentPosition === null) {
      // Check for entry signals
      await this.checkEntrySignals();
    } else {
      // Check for exit signals (5-minute candle based)
      await this.checkCandleBasedExitSignals();
    }
    
    // Step 2: Update technical indicators AFTER trade decisions
    const newCandle: Candle = {
      timestamp: this.currentCandle.timestamp,
      open: this.currentCandle.open,
      high: this.currentCandle.high,
      low: this.currentCandle.low,
      close: this.currentCandle.close,
      volume: this.currentCandle.volume
    };
    
    // Add to historical data
    this.candleHistory.push(newCandle);
    
    // Keep only last 100 candles to manage memory
    if (this.candleHistory.length > 100) {
      this.candleHistory = this.candleHistory.slice(-100);
    }
    
    // Recalculate indicators
    this.updateTechnicalIndicators();
    
    // Clear current candle
    this.currentCandle = null;
  }

  // ===========================
  // ENTRY SIGNAL LOGIC
  // ===========================

  /**
   * Check if we're within NSE market hours (9:15 AM - 3:30 PM IST)
   */
  private isMarketHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    // Market opens at 9:15 AM and closes at 3:30 PM
    const marketStart = 9 * 60 + 15; // 9:15 AM in minutes
    const marketEnd = 15 * 60 + 30;  // 3:30 PM in minutes
    const currentTime = hour * 60 + minute;
    
    return currentTime >= marketStart && currentTime <= marketEnd;
  }

  /**
   * Check for LONG/SHORT entry signals based on completed candle
   */
  private async checkEntrySignals(): Promise<void> {
    if (!this.currentIndicators || !this.dailyPivots) return;
    
    // Add market hours validation
    if (!this.isMarketHours()) {
      this.logger.debug('ðŸ”’ Signal check skipped - Outside market hours (9:15 AM - 3:30 PM)');
      return;
    }
    
    // Use latest completed candle from history instead of currentCandle
    if (this.candleHistory.length === 0) return;
    const latestCandle = this.candleHistory[this.candleHistory.length - 1];
    if (!latestCandle) return;
    
    const { rsi, supertrend, bollingerBands } = this.currentIndicators;
    const { r1, r2 } = this.dailyPivots;
    const close = latestCandle.close;
    
    this.logger.info('🎯 BOLLINGER ENTRY ANALYSIS - Checking signals...');
    this.logger.info(`📊 Current Indicators: RSI=${rsi.toFixed(2)}, BB_Upper=${bollingerBands.upper.toFixed(2)}, BB_Lower=${bollingerBands.lower.toFixed(2)}, Supertrend=${supertrend.trend}, Price=${close}`);
    
    // LONG Entry Signal - Expanded RSI range for better signal generation
    const longConditions = {
      priceAboveUpperBB: close > bollingerBands.upper,
      rsiInRange: rsi >= 65 && rsi <= 85, // Expanded from restrictive 70-80
      supertrendBullish: supertrend.trend === 'UP',
      aboveR1OrR2: close > r1 || close > r2
    };
    
    const longSignal = Object.values(longConditions).every(Boolean);
    
    if (longSignal) {
      this.logger.info('ðŸš€ LONG entry signal detected', {
        close: close.toFixed(2),
        rsi: rsi.toFixed(2),
        supertrend: supertrend.trend,
        upperBB: bollingerBands.upper.toFixed(2),
        r1: r1.toFixed(2),
        r2: r2.toFixed(2)
      });
      
      await this.executeLongEntryWithRetry(close);
    }
    
    // SHORT Entry Signal - Expanded RSI range for better signal generation
    const shortConditions = {
      priceBelowLowerBB: close < bollingerBands.lower,
      rsiInRange: rsi >= 15 && rsi <= 35, // Expanded from restrictive 10-30
      supertrendBearish: supertrend.trend === 'DOWN',
      belowR1: close <= r1
    };
    
    const shortSignal = Object.values(shortConditions).every(Boolean);
    
    if (shortSignal) {
      this.logger.info('ðŸ”» SHORT entry signal detected', {
        close: close.toFixed(2),
        rsi: rsi.toFixed(2),
        supertrend: supertrend.trend,
        lowerBB: bollingerBands.lower.toFixed(2),
        r1: r1.toFixed(2)
      });
      
      await this.executeShortEntryWithRetry(close);
    }
  }

  /**
   * Execute LONG entry with CE option selection
   */
  private async executeLongEntry(nifty50Price: number): Promise<void> {
    try {
      // Select CE option (1% of NIFTY50 spot price)
      const targetPremium = nifty50Price * 0.01;
      const ceOption = await this.selectOptionInstrument('CE', targetPremium);
      
      if (!ceOption) {
        this.logger.error('Failed to select CE option for LONG entry');
        return;
      }
      
      // Execute order
      const orderResult = await this.executeOrder('BUY', ceOption, this.FIXED_LOTS);
      
      if (orderResult.success) {
        this.currentPosition = {
          type: 'LONG',
          instrument: ceOption,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          entryTime: new Date()
        };
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring();
        
        // Subscribe to option WebSocket for real-time premium (LONG positions)
        await this.subscribeToOption(ceOption.instrument_token);
        
        this.metrics.totalTrades++;
        // Update metrics to reflect successful trade execution
        this.updateMetrics({ 
          totalTrades: this.metrics.totalTrades,
          healthStatus: 'healthy',
          lastTradeTime: new Date()
        });
        this.logger.info('âœ… LONG position opened', {
          instrument: ceOption.tradingsymbol,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS
        });
      }
      
    } catch (error) {
      this.trackError('execution_long_entry', error, true);
    }
  }

  /**
   * Execute SHORT entry with PE option selection
   */
  private async executeShortEntry(nifty50Price: number): Promise<void> {
    try {
      // Select PE option (1% of NIFTY50 spot price)
      const targetPremium = nifty50Price * 0.01;
      const peOption = await this.selectOptionInstrument('PE', targetPremium);
      
      if (!peOption) {
        this.logger.error('Failed to select PE option for SHORT entry');
        return;
      }
      
      // Execute order
      const orderResult = await this.executeOrder('BUY', peOption, this.FIXED_LOTS);
      
      if (orderResult.success) {
        this.currentPosition = {
          type: 'SHORT',
          instrument: peOption,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          entryTime: new Date(),
          trailingSL: orderResult.price * 0.88, // 12% below entry
          highestPremium: orderResult.price
        };
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring();
        
        // Subscribe to option WebSocket for real-time premium (SHORT positions)
        await this.subscribeToOption(peOption.instrument_token);
        
        this.metrics.totalTrades++;
        // Update metrics to reflect successful trade execution
        this.updateMetrics({ 
          totalTrades: this.metrics.totalTrades,
          healthStatus: 'healthy',
          lastTradeTime: new Date()
        });
        this.logger.info('âœ… SHORT position opened', {
          instrument: peOption.tradingsymbol,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          trailingSL: this.currentPosition.trailingSL
        });
      }
      
    } catch (error) {
      this.logger.error('Error executing SHORT entry:', error);
    }
  }

  // ===========================
  // EXIT LOGIC
  // ===========================

  /**
   * Check exit conditions during real-time monitoring
   */
  private async checkExitConditions(nifty50LTP: number): Promise<void> {
    if (!this.currentPosition) return;
    
    if (this.currentPosition.type === 'LONG') {
      await this.checkLongExitConditions(nifty50LTP);
    } else if (this.currentPosition.type === 'SHORT') {
      await this.checkShortExitConditions();
    }
  }

  /**
   * Check LONG exit conditions (real-time NIFTY50 vs previous Mid BB)
   */
  private async checkLongExitConditions(nifty50LTP: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    
    const previousMidBB = this.currentIndicators.bollingerBands.middle;
    
    if (nifty50LTP < previousMidBB) {
      this.logger.info('ðŸšª LONG exit signal: NIFTY50 below Mid BB', {
        nifty50LTP: nifty50LTP.toFixed(2),
        midBB: previousMidBB.toFixed(2)
      });
      
      await this.executeExit('LONG_EXIT_SIGNAL');
    }
  }

  /**
   * Check SHORT exit conditions (12% trailing SL) using WebSocket data
   */
  private async checkShortExitConditions(): Promise<void> {
    if (!this.currentPosition) return;
    
    try {
      const instrumentToken = this.currentPosition.instrument.instrument_token;
      
      // Get current option premium from WebSocket data (no REST API call!)
      const currentPremium = this.optionPremiumData.get(instrumentToken);
      
      if (!currentPremium) {
        // Fallback to REST API if WebSocket data not available
        this.logger.warn('No WebSocket premium data, falling back to REST API');
        const quote = await this.kiteConnect.getQuote([instrumentToken]);
        const optionQuote = quote[instrumentToken];
        
        if (!optionQuote) return;
        const restPremium = optionQuote.last_price;
        
        // Store in WebSocket cache for next time
        this.optionPremiumData.set(instrumentToken, restPremium);
        await this.checkShortExitLogic(restPremium);
        return;
      }
      
      // Use WebSocket premium data (primary method)
      await this.checkShortExitLogic(currentPremium);
      
    } catch (error) {
      this.logger.error('Error checking SHORT exit conditions:', error);
    }
  }

  /**
   * Execute SHORT exit logic with given premium
   */
  private async checkShortExitLogic(currentPremium: number): Promise<void> {
    if (!this.currentPosition) return;
      
    // Update highest premium and trailing SL
    if (currentPremium > (this.currentPosition.highestPremium || 0)) {
      this.currentPosition.highestPremium = currentPremium;
      this.currentPosition.trailingSL = currentPremium * 0.88; // 12% below new high
      
      this.logger.info('ðŸ“ˆ Trailing SL updated (WebSocket)', {
        newHigh: currentPremium.toFixed(2),
        newSL: this.currentPosition.trailingSL.toFixed(2)
      });
    }
    
    // Check if trailing SL is hit
    if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
      this.logger.info('ðŸšª SHORT exit signal: Trailing SL hit (WebSocket)', {
        currentPremium: currentPremium.toFixed(2),
        trailingSL: this.currentPosition.trailingSL.toFixed(2)
      });
      
      await this.executeExit('SHORT_TRAILING_SL');
    }
  }

  /**
   * Check candle-based exit signals (called on 5-minute candle completion)
   */
  private async checkCandleBasedExitSignals(): Promise<void> {
    // Additional candle-based exit logic can be implemented here
    // Currently, LONG uses real-time monitoring, SHORT uses trailing SL
  }

  /**
   * Execute position exit
   */
  private async executeExit(reason: string): Promise<void> {
    if (!this.currentPosition) return;
    
    try {
      const orderResult = await this.executeOrder('SELL', this.currentPosition.instrument, this.FIXED_LOTS);
      
      if (orderResult.success) {
        const pnl = (orderResult.price - this.currentPosition.entryPrice) * this.FIXED_LOTS * 75; // NIFTY lot size
        this.metrics.profitLoss += pnl;
        
        // Update capital with P&L
        this.currentCapital += pnl;
        
        // Create trade record for history
        const tradeRecord = {
          tradeId: `BB_${Date.now()}`,
          entryOrderId: `BB_ENTRY_${this.currentPosition.entryTime.getTime()}`,
          exitOrderId: orderResult.orderId || `BB_EXIT_${Date.now()}`,
          instrument: this.currentPosition.instrument,
          direction: this.currentPosition.type,
          quantity: this.FIXED_LOTS * 75, // Total shares
          entryPrice: this.currentPosition.entryPrice,
          exitPrice: orderResult.price,
          entryTime: this.currentPosition.entryTime,
          exitTime: new Date(),
          pnl: pnl,
          exitReason: reason,
          status: 'CLOSED',
          strategy: 'BOLLINGER_BAND'
        };
        
        // Add to trade history
        this.tradeHistory.push(tradeRecord);
        
        // Save updated capital and trade history
        this.saveCapitalData();
        
        this.logger.info('âœ… Position closed', {
          reason,
          instrument: this.currentPosition.instrument.tradingsymbol,
          entryPrice: this.currentPosition.entryPrice,
          exitPrice: orderResult.price,
          pnl: pnl.toFixed(2),
          newCapital: this.currentCapital.toFixed(2)
        });
        
        // Unsubscribe from option WebSocket before clearing position
        const instrumentToken = this.currentPosition.instrument.instrument_token;
        await this.unsubscribeFromOption(instrumentToken);
        
        this.currentPosition = null;
        
        // Update metrics to reflect successful position closure
        this.updateMetrics({ 
          profitLoss: this.metrics.profitLoss,
          healthStatus: 'healthy',
          lastTradeTime: new Date()
        });
        
        // Stop position monitoring since no active position
        this.stopPositionMonitoring();
      }
      
    } catch (error) {
      this.logger.error('Error executing exit:', error);
    }
  }

  /**
   * Force close position (for end-of-day or strategy stop)
   */
  private async forceClosePosition(reason: string): Promise<void> {
    if (!this.currentPosition) return;
    
    this.logger.warn('ðŸ”´ Force closing position:', reason);
    await this.executeExit(reason);
  }

  // ===========================
  // ORDER EXECUTION & OPTION SELECTION
  // ===========================

  /**
   * Get last completed 5-minute candle close price (used as current NIFTY price)
   */
  private getLastCompletedCandleClose(): number {
    if (this.candleHistory.length === 0) {
      return 25170; // Default fallback
    }
    const lastCandle = this.candleHistory[this.candleHistory.length - 1];
    return lastCandle ? lastCandle.close : 25170;
  }

  /**
   * Get next Tuesday expiry date (same logic as Strategy 1)
   */
  private getNextTuesdayExpiry(): Date {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const tuesday = 2; // Tuesday is day 2
    
    let daysToAdd = tuesday - currentDay;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Next Tuesday
    }
    
    const nextTuesday = new Date(today);
    nextTuesday.setDate(today.getDate() + daysToAdd);
    nextTuesday.setHours(15, 30, 0, 0); // Market close time
    
    return nextTuesday;
  }

  /**
   * Select option instrument based on target premium
   */
  private async selectOptionInstrument(optionType: 'CE' | 'PE', targetPremium: number): Promise<any> {
    try {
      // Get NIFTY options instruments
      const instruments = await this.kiteConnect.getInstruments('NFO');
      
      // Filter for NIFTY options of specified type
      const niftyOptions = instruments.filter((inst: any) => 
        inst.name === 'NIFTY' && 
        inst.instrument_type === optionType &&
        new Date(inst.expiry) > new Date() // Not expired
      );
      
      // Get next Tuesday expiry (same logic as Strategy 1)
      const nextTuesdayExpiry = this.getNextTuesdayExpiry();
      
      this.logger.info(`ðŸŽ¯ Selecting ${optionType} option by PREMIUM for NIFTY price: â‚¹${targetPremium.toFixed(2)}`);
      this.logger.info(`ðŸ“… Target expiry: ${nextTuesdayExpiry.toDateString()}`);
      
      // Filter for next Tuesday expiry options (exact match within 1 day)
      const nextTuesdayOptions = niftyOptions.filter((opt: any) => {
        const isSameExpiry = Math.abs(new Date(opt.expiry).getTime() - nextTuesdayExpiry.getTime()) < 24 * 60 * 60 * 1000; // Within 1 day
        return isSameExpiry;
      });
      
      if (nextTuesdayOptions.length === 0) {
        throw new Error('No suitable NIFTY options found');
      }
      
      // Get quotes for these options to find closest to target premium
      const tokens = nextTuesdayOptions.slice(0, 50).map((opt: any) => opt.instrument_token); // Limit to 50 for API limits
      const quotes = await this.kiteConnect.getQuote(tokens);
      
      let bestOption = null;
      let smallestDiff = Infinity;
      
      for (const token of tokens) {
        const quote = quotes[token];
        if (quote && quote.last_price > 0) {
          const priceDiff = Math.abs(quote.last_price - targetPremium);
          if (priceDiff < smallestDiff) {
            smallestDiff = priceDiff;
            bestOption = nextTuesdayOptions.find((opt: any) => opt.instrument_token === token);
          }
        }
      }
      
      if (bestOption) {
        this.logger.info('Option selected', {
          tradingsymbol: bestOption.tradingsymbol,
          targetPremium: targetPremium.toFixed(2),
          actualPremium: quotes[bestOption.instrument_token].last_price.toFixed(2),
          difference: smallestDiff.toFixed(2)
        });
      }
      
      return bestOption;
      
    } catch (error) {
      this.logger.error('Error selecting option instrument:', error);
      return null;
    }
  }

  /**
   * Execute order (BUY/SELL)
   */
  private async executeOrder(transaction: 'BUY' | 'SELL', instrument: any, quantity: number): Promise<{ success: boolean; price: number; orderId?: string }> {
    try {
      this.logger.info('Executing order', {
        transaction,
        instrument: instrument.tradingsymbol,
        quantity
      });
      
      // Place market order
      const orderParams = {
        exchange: instrument.exchange,
        tradingsymbol: instrument.tradingsymbol,
        transaction_type: transaction,
        quantity: quantity * instrument.lot_size,
        product: 'MIS', // Intraday
        order_type: 'MARKET',
        validity: 'DAY'
      };
      
      const orderResponse = await this.kiteConnect.placeOrder(orderParams);
      
      if (orderResponse.order_id) {
        // Wait for order execution and get fill price
        const fillPrice = await this.waitForOrderExecution(orderResponse.order_id);
        
        return {
          success: true,
          price: fillPrice,
          orderId: orderResponse.order_id
        };
      }
      
      return { success: false, price: 0 };
      
    } catch (error) {
      this.logger.error('Order execution failed:', error);
      return { success: false, price: 0 };
    }
  }

  /**
   * Wait for order execution and return fill price
   */
  private async waitForOrderExecution(orderId: string): Promise<number> {
    const maxAttempts = 120; // Wait up to 2 minutes
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const orderHistory = await this.kiteConnect.getOrderHistory(orderId);
        const latestOrder = orderHistory[orderHistory.length - 1];
        
        if (latestOrder.status === 'COMPLETE') {
          return latestOrder.average_price || latestOrder.price;
        }
        
        if (['REJECTED', 'CANCELLED'].includes(latestOrder.status)) {
          throw new Error(`Order ${latestOrder.status}: ${latestOrder.status_message}`);
        }
        
        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        this.logger.error(`Error checking order status (attempt ${attempt + 1}):`, error);
      }
    }
    
    throw new Error('Order execution timeout - status unknown');
  }

  /**
   * Error monitoring and health tracking system
   */
  private trackError(errorType: string, error: any, isCritical: boolean = false): void {
    const now = new Date();
    
    // Update error counts
    const currentCount = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, currentCount + 1);
    this.lastErrorTime.set(errorType, now);
    
    // Update health status
    this.healthStatus.consecutiveErrors += 1;
    if (isCritical) {
      this.healthStatus.criticalErrorsToday += 1;
      this.healthStatus.executionHealthy = false;
    }
    
    // Log error with enhanced context
    const errorContext = {
      errorType,
      count: currentCount + 1,
      isCritical,
      consecutiveErrors: this.healthStatus.consecutiveErrors,
      strategyStatus: this.getStatus(),
      hasPosition: !!this.currentPosition,
      currentNiftyLTP: this.currentNiftyLTP,
      timestamp: now.toISOString()
    };
    
    if (isCritical) {
      this.logger.error(`ðŸš¨ CRITICAL ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    } else {
      this.logger.warn(`âš ï¸ ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    }
    
    // Alert if too many consecutive errors
    if (this.healthStatus.consecutiveErrors >= 5) {
      this.logger.error(`ðŸ”¥ STRATEGY HEALTH ALERT: ${this.healthStatus.consecutiveErrors} consecutive errors detected!`, {
        errorCounts: Object.fromEntries(this.errorCounts),
        healthStatus: this.healthStatus
      });
    }
  }

  private resetErrorCount(): void {
    this.healthStatus.consecutiveErrors = 0;
    this.healthStatus.dataStreamHealthy = true;
    this.healthStatus.executionHealthy = true;
    this.healthStatus.lastHeartbeat = new Date();
  }

  public getHealthReport(): any {
    const now = new Date();
    const timeSinceHeartbeat = now.getTime() - this.healthStatus.lastHeartbeat.getTime();
    
    return {
      overall: this.healthStatus.dataStreamHealthy && this.healthStatus.executionHealthy && timeSinceHeartbeat < 60000,
      dataStream: this.healthStatus.dataStreamHealthy,
      execution: this.healthStatus.executionHealthy,
      timeSinceHeartbeat: Math.floor(timeSinceHeartbeat / 1000),
      consecutiveErrors: this.healthStatus.consecutiveErrors,
      criticalErrorsToday: this.healthStatus.criticalErrorsToday,
      errorBreakdown: Object.fromEntries(this.errorCounts),
      candleHistoryLength: this.candleHistory.length,
      hasPosition: !!this.currentPosition,
      currentNiftyLTP: this.currentNiftyLTP,
      lastUpdate: now.toISOString()
    };
  }

  // ===========================
  // CAPITAL AND TRADE MANAGEMENT GETTERS
  // ===========================

  /**
   * Get current capital amount
   */
  public getCurrentCapital(): number {
    return this.currentCapital;
  }

  /**
   * Get complete trade history
   */
  public getTradeHistory(): any[] {
    return [...this.tradeHistory]; // Return copy to prevent modification
  }

  /**
   * Get recent trades (last N trades)
   */
  public getRecentTrades(count: number = 10): any[] {
    return this.tradeHistory.slice(-count);
  }

  /**
   * Get total P&L from all completed trades
   */
  public getTotalPnL(): number {
    return this.tradeHistory.reduce((total, trade) => total + (trade.pnl || 0), 0);
  }

  /**
   * Get trading statistics
   */
  public getTradingStats(): any {
    const totalTrades = this.tradeHistory.length;
    const profitableTrades = this.tradeHistory.filter(trade => (trade.pnl || 0) > 0).length;
    const totalPnL = this.getTotalPnL();
    
    return {
      totalTrades,
      profitableTrades,
      lossTrades: totalTrades - profitableTrades,
      winRate: totalTrades > 0 ? (profitableTrades / totalTrades * 100).toFixed(2) : '0.00',
      totalPnL: totalPnL.toFixed(2),
      currentCapital: this.currentCapital.toFixed(2),
      capitalChange: (this.currentCapital - 200000).toFixed(2), // Change from initial 2L
      capitalChangePercent: ((this.currentCapital - 200000) / 200000 * 100).toFixed(2)
    };
  }

  // ===========================
  // ERROR RECOVERY INFRASTRUCTURE
  // ===========================

  /**
   * Wrapper for 5-minute candle fetch with retry mechanism
   * Retries every 10 seconds until successful - critical for trend following
   */
  private async fetchLatest5MinuteCandleWithRetry(): Promise<void> {
    try {
      // Try the normal fetch first
      await this.fetchLatest5MinuteCandle();
      
      // If successful, stop any running retry mechanism
      this.stopCandleRetryMechanism();
      
    } catch (error) {
      this.logger.error('🔴 5-minute candle fetch failed, starting retry mechanism:', error);
      
      // Start continuous retry every 10 seconds until successful
      this.startCandleRetryMechanism();
      
      // Don't throw - let retry mechanism handle it
    }
  }

  /**
   * LONG entry execution with retry mechanism
   * Critical for trend following - every trade opportunity matters
   */
  private async executeLongEntryWithRetry(nifty50Price: number): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeLongEntry(nifty50Price),
        'LONG Entry Execution',
        3, // Max 3 attempts for trade execution
        this.TRADE_RETRY_DELAYS
      );
    } catch (error) {
      this.logger.error('❌ LONG entry failed after all retry attempts:', error);
      this.trackError('execution_long_entry_retry_failed', error, true);
    }
  }

  /**
   * SHORT entry execution with retry mechanism  
   * Critical for trend following - every trade opportunity matters
   */
  private async executeShortEntryWithRetry(nifty50Price: number): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeShortEntry(nifty50Price),
        'SHORT Entry Execution',
        3, // Max 3 attempts for trade execution
        this.TRADE_RETRY_DELAYS
      );
    } catch (error) {
      this.logger.error('❌ SHORT entry failed after all retry attempts:', error);
      this.trackError('execution_short_entry_retry_failed', error, true);
    }
  }

  /**
   * Generic retry mechanism with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxAttempts: number = this.MAX_RETRY_ATTEMPTS,
    delays: number[] = this.TRADE_RETRY_DELAYS
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          this.logger.info(`✅ ${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`⚠️ ${operationName} attempt ${attempt}/${maxAttempts} failed:`, error);
        
        if (attempt < maxAttempts) {
          const delay = attempt <= delays.length ? delays[attempt - 1] : delays[delays.length - 1];
          this.logger.info(`🔄 Retrying ${operationName} in ${delay}ms...`);
          await this.sleep(delay!);
        }
      }
    }
    
    this.logger.error(`❌ ${operationName} failed after ${maxAttempts} attempts`);
    throw lastError;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start continuous candle retry mechanism
   */
  private startCandleRetryMechanism(): void {
    if (this.candleRetryTimer) {
      clearInterval(this.candleRetryTimer);
    }
    
    this.candleRetryTimer = setInterval(async () => {
      try {
        await this.fetchLatest5MinuteCandle();
        // If successful, stop retrying
        this.stopCandleRetryMechanism();
        this.logger.info('✅ Candle fetch recovered successfully');
      } catch (error) {
        this.logger.warn('⚠️ Candle retry failed, will try again in 10 seconds');
      }
    }, this.CANDLE_RETRY_INTERVAL);
    
    this.logger.info('🔄 Started candle retry mechanism (10-second intervals)');
  }

  /**
   * Stop candle retry mechanism when successful
   */
  private stopCandleRetryMechanism(): void {
    if (this.candleRetryTimer) {
      clearInterval(this.candleRetryTimer);
      this.candleRetryTimer = undefined as any;
      this.logger.info('✅ Stopped candle retry mechanism (operation successful)');
    }
  }
}
