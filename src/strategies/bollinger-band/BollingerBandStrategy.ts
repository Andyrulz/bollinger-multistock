import { Logger } from '../../utils/Logger';
import { StrategyBase, StrategyConfig, StrategyStatus } from '../../core/StrategyBase';

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
  entryOrderId: string;        // Store real order ID from KiteConnect
  exitOrderId?: string;        // Store exit order ID when position closed
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
  private NIFTY50_INSTRUMENT_TOKEN: number = 256265; // This will be fetched dynamically
  
  // Position management
  private currentPosition: Position | null = null;
  
  // 5-minute candle building
  private currentCandle: CurrentCandle | null = null;
  
  // Real-time monitoring
  private ltpPollingInterval: NodeJS.Timeout | null = null;
  private currentNiftyLTP: number = 0;
  private candleCheckInterval: NodeJS.Timeout | null = null;
  
  // Race condition protection for position exit processing
  private isProcessingShortExit: boolean = false;
  private isProcessingLongExit: boolean = false;
  
  // Race condition protection for position entry processing
  private isExecutingLongEntry: boolean = false;
  private isExecutingShortEntry: boolean = false;
  
  // Race condition protection for polling operations
  private isPollingInProgress: boolean = false;
  private lastPollingTime: Date | null = null;
  private consecutivePollingFailures: number = 0;
  private readonly MIN_POLLING_INTERVAL = 900; // Minimum 900ms between polls
  private readonly MAX_CONSECUTIVE_FAILURES = 5; // Backoff threshold
  
  // Cached position state for dashboard display
  private cachedCurrentPrice: number = 0;
  private cachedUnrealizedPnL: number = 0;
  private lastPriceUpdateTime: Date | null = null;
  
  // REST API position monitoring
  private shortMonitoringInterval?: NodeJS.Timeout;

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

  // Simplified timer management - single clean 5-minute cycle
  private masterCycleInterval: NodeJS.Timeout | null = null;
  private currentCyclePhase: 'waiting' | '4th-minute' | '5th-minute' | '6th-minute' = 'waiting';

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
        
        this.logger.info('?? Bollinger Band capital loaded', {
          capital: this.currentCapital,
          totalTrades: this.tradeHistory.length
        });
      } else {
        // Create initial data file
        this.saveCapitalData();
        this.logger.info('?? Bollinger Band capital initialized at ?2,00,000');
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
      this.NIFTY50_INSTRUMENT_TOKEN = nifty50Token;
      
      // Step 1: Load historical candle data with fallback for pre-market hours
      await this.loadHistoricalDataWithFallback();
      
      // Step 2: Calculate daily pivots (use fallback if needed)
      await this.calculateDailyPivotsWithFallback();
      
      // Step 3: Initialize technical indicators
      this.updateTechnicalIndicators();
      
      // Step 4: Schedule daily cache refresh at 3:25 PM
      this.scheduleDailyCacheRefresh();
      
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
    
    // Predictive WebSocket removed - using real-time selection
    
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
    this.logger.info('?? Starting daily cleanup for new trading day...');
    
    try {
      // Clear historical data (keep only logs)
      this.candleHistory = [];
      this.currentIndicators = null;
      this.dailyPivots = null;
      this.currentCandle = null;
      this.currentNiftyLTP = 0;
      
      // Clear position data
      this.currentPosition = null;
      
      // Reset cached position state
      this.cachedCurrentPrice = 0;
      this.cachedUnrealizedPnL = 0;
      this.lastPriceUpdateTime = null;
      
      // Clear option data
      // REST API monitoring will be reinitialized automatically
      
      // Predictive WebSocket removed - using real-time selection
      
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
      
      this.logger.info('? Daily cleanup completed - ready for new trading day');
    } catch (error) {
      this.logger.error('? Error during daily cleanup:', error);
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
      // Current position information for P&L tracking (updated via REST API polling)
      positionInfo: this.currentPosition ? {
        type: this.currentPosition.type,
        instrument: this.currentPosition.instrument,
        quantity: this.currentPosition.quantity,
        entryPrice: this.currentPosition.entryPrice,
        entryTime: this.currentPosition.entryTime,
        currentPrice: this.cachedCurrentPrice, // Real-time price from polling
        unrealizedPnL: this.cachedUnrealizedPnL, // Real-time P&L from polling
        lastUpdated: this.lastPriceUpdateTime, // Timestamp of last price update
        tradingSymbol: this.currentPosition.instrument.tradingsymbol,
        trailingSL: this.currentPosition.trailingSL, // Trailing stop loss level
        highestPremium: this.currentPosition.highestPremium // Highest premium achieved
      } : null
    } as StrategyStatus;
  }

  // Implement abstract method from StrategyBase
  public async processMarketData(data: any): Promise<void> {
    // NOTE: This strategy uses polling-based architecture via fetchLatest5MinuteCandle()
    // Real-time market data processing is handled by startRealTimeMonitoring() 
    // which fetches 5-minute candles at precise intervals aligned to market timing
    this.logger.debug('Processing market data:', data);
  }

  /**
   * Get live option premium from REST API polling
   * Returns the last traded price from real-time data or fallback price if not available
   */
  private async getLiveOptionPremium(instrumentToken: number): Promise<number> {
    if (!instrumentToken) return 0;
    
    try {
      // Get current option price via REST API
      const quote = await this.kiteConnect.getQuote([instrumentToken.toString()]);
      const data = quote[instrumentToken.toString()];
      
      if (data && data.last_price && data.last_price > 0) {
        return data.last_price;
      }
      
      // No fallback needed - REST API will provide current price
      
      return 0;
    } catch (error) {
      this.logger.error(`Error fetching live premium for token ${instrumentToken}:`, error);
      
      // Fallback: estimate based on NIFTY price
      const currentNifty = this.getLastCompletedCandleClose();
      if (currentNifty > 0) {
        return currentNifty * 0.01; // 1% of NIFTY as reasonable estimate
      }
      
      return 0;
    }
  }

  /**
   * Calculate unrealized P&L for current position
   * Since we always BUY options (CE or PE), P&L = (currentPrice - entryPrice) * quantity
   */
  private async calculateUnrealizedPnL(): Promise<number> {
    if (!this.currentPosition) return 0;
    
    const currentPrice = await this.getLiveOptionPremium(this.currentPosition.instrument.instrument_token);
    if (currentPrice === 0) return 0; // Can't calculate without current price
    
    // We BUY options at entry and SELL at exit, so profit = (exit/current - entry) * quantity
    // This applies to both LONG (CE) and SHORT (PE) directions
    const priceDiff = currentPrice - this.currentPosition.entryPrice;
    
    return priceDiff * this.currentPosition.quantity;
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
   * PRODUCTION FIX: Load historical data with fallback for pre-market initialization
   * This allows the bot to start before market hours without failing
   */
  private async loadHistoricalDataWithFallback(): Promise<void> {
    this.logger.info('Loading historical data with production fallback...');
    
    try {
      // Try normal historical data loading first
      await this.loadHistoricalData();
      this.logger.info('? Historical data loaded successfully via API');
      return;
      
    } catch (error) {
      this.logger.warn('?? API historical data failed, trying cache fallback', error);
      
      // Fallback: Try to load cached historical data
      try {
        await this.loadCachedHistoricalData();
        this.logger.info('? Historical data loaded from cache');
        return;
      } catch (cacheError) {
        this.logger.error('? Both API and cache failed - cannot initialize strategy safely', {
          apiError: error instanceof Error ? error.message : String(error),
          cacheError: cacheError instanceof Error ? cacheError.message : String(cacheError)
        });
        throw new Error('Failed to load historical data from both API and cache. Strategy cannot start safely without proper market data.');
      }
    }
  }

  /**
   * Load cached historical data from file system
   */
  private async loadCachedHistoricalData(): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join(__dirname, '../../data/bollinger-historical-cache.json');
    
    if (!fs.existsSync(cacheFile)) {
      throw new Error('No cached historical data available');
    }
    
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const cacheAge = Date.now() - new Date(cacheData.timestamp).getTime();
    const maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    if (cacheAge > maxCacheAge) {
      throw new Error('Cached data too old');
    }
    
    this.candleHistory = cacheData.candles.map((candle: any) => ({
      timestamp: new Date(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    }));
    
    this.logger.info(`Loaded ${this.candleHistory.length} candles from cache`);
  }

  /**
   * Cache historical data for future pre-market startups
   */
  private async cacheHistoricalData(): Promise<void> {
    if (this.candleHistory.length === 0) return;
    
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join(__dirname, '../../data/bollinger-historical-cache.json');
    
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(cacheFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const cacheData = {
        timestamp: new Date().toISOString(),
        candles: this.candleHistory,
        symbol: 'NIFTY50',
        timeframe: '5min'
      };
      
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      this.logger.info('?? Historical data cached successfully');
    } catch (error) {
      this.logger.error('? Failed to cache historical data:', error);
    }
  }

  /**
   * Schedule daily cache refresh at 3:25 PM to ensure fresh data for next day
   */
  private scheduleDailyCacheRefresh(): void {
    const now = new Date();
    const refreshTime = new Date();
    refreshTime.setHours(15, 25, 0, 0); // 3:25 PM IST
    
    // If 3:25 PM has passed today, schedule for next trading day
    if (now >= refreshTime) {
      refreshTime.setDate(refreshTime.getDate() + 1);
      // Skip weekends - if Saturday, schedule for Monday
      if (refreshTime.getDay() === 6) refreshTime.setDate(refreshTime.getDate() + 2);
      if (refreshTime.getDay() === 0) refreshTime.setDate(refreshTime.getDate() + 1);
    }
    
    const timeUntilRefresh = refreshTime.getTime() - now.getTime();
    
    this.logger.info(`?? Scheduled daily cache refresh at: ${refreshTime.toLocaleString()}`);
    
    setTimeout(async () => {
      try {
        this.logger.info('?? Daily cache refresh starting at 3:25 PM...');
        
        // Only refresh if we have current data
        if (this.candleHistory.length > 0) {
          await this.cacheHistoricalData();
          this.logger.info('? Daily cache refresh completed successfully');
        } else {
          this.logger.warn('?? No candle data available for cache refresh');
        }
        
        // Schedule next day's refresh
        this.scheduleDailyCacheRefresh();
        
      } catch (error) {
        this.logger.error('? Daily cache refresh failed:', error);
        // Still schedule next refresh attempt
        this.scheduleDailyCacheRefresh();
      }
    }, timeUntilRefresh);
  }

  /**
   * Calculate daily pivots with fallback for pre-market hours
   */
  private async calculateDailyPivotsWithFallback(): Promise<void> {
    try {
      await this.calculateDailyPivotsFromMarketData();
      this.logger.info('? Daily pivots calculated from market data');
    } catch (error) {
      this.logger.warn('?? Failed to fetch pivot data, using fallback', error);
      this.calculateFallbackPivots();
    }
  }

  /**
   * Calculate fallback pivot levels using approximate values
   */
  private calculateFallbackPivots(): void {
    // Use approximate NIFTY levels for pre-market
    const approximateOHLC = {
      high: 25200,
      low: 25100, 
      close: 25150
    };
    
    this.dailyPivots = this.calculateDailyPivots(approximateOHLC);
    this.logger.info('?? Using fallback pivot levels for pre-market operation', this.dailyPivots);
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
   * Simplified: Only 5th minute entry signals - NO prediction system
   */
  private startRealTimeMonitoring(): void {
    this.logger.info('?? Starting simplified 5-minute monitoring (5th minute entry only - no prediction)...');
    
    // Clear any existing timer first
    this.stopRealTimeMonitoring();
    
    // Calculate initial alignment to next 5-minute boundary
    const now = new Date();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    
    // Find next 5-minute interval (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    const nextInterval = Math.ceil(currentMinutes / 5) * 5;
    const minutesUntilNext = (nextInterval === 60) ? (60 - currentMinutes) : (nextInterval - currentMinutes);
    const secondsUntilAlignment = (60 - currentSeconds) + (minutesUntilNext - 1) * 60;
    
    this.logger.info(`? Aligning to next 5-minute boundary in ${Math.floor(secondsUntilAlignment / 60)}:${(secondsUntilAlignment % 60).toString().padStart(2, '0')}`);
    
    // Start the master cycle after alignment timing
    setTimeout(() => {
      this.startMasterCycle();
    }, secondsUntilAlignment * 1000);
    
    // Start fetching latest candle data immediately to check for entry signals
    this.fetchLatest5MinuteCandle().catch(error => {
      this.logger.error('Initial candle fetch failed:', error);
    });
    
    // Start position monitoring if we have any active position that needs exit monitoring
    if (this.currentPosition) {
      this.startPositionMonitoring().catch(error => {
        this.logger.error('Failed to start position monitoring:', error);
      });
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
    
    // Clear master cycle interval
    if (this.masterCycleInterval) {
      clearInterval(this.masterCycleInterval);
      this.masterCycleInterval = null;
    }
    
    // Reset cycle state
    this.currentCyclePhase = 'waiting';
    
    // Cleanup option WebSocket if no positions
    if (!this.currentPosition) {
      // WebSocket cleanup removed - using pure REST API
    }
    
    this.logger.info('Real-time monitoring stopped');
  }

  /**
   * Master cycle initialization - sets up the strategy monitoring
   * Uses intelligent candle checking only during market hours
   */
  private startMasterCycle(): void {
    this.logger.info('?? Starting Bollinger Band strategy master cycle');
    
    // Check for new 5-minute candles every 5 minutes (300 seconds)
    // This aligns with natural candle completion timing
    this.masterCycleInterval = setInterval(() => {
      // Only fetch during market hours (9:15 AM to 3:30 PM)
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = hours * 60 + minutes;
      const marketStart = 9 * 60 + 15; // 9:15 AM
      const marketEnd = 15 * 60 + 30;  // 3:30 PM
      
      if (currentTime >= marketStart && currentTime <= marketEnd) {
        this.fetchLatest5MinuteCandle().catch(error => {
          this.logger.error('? Error fetching 5-minute candle:', error);
        });
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    this.logger.info('? Master cycle started - checking for new candles every 5 minutes during market hours');
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
        this.logger.warn('💊 STRATEGY HEALTH REPORT (UNHEALTHY):', healthReport);
      } else {
        this.logger.info('💚 Strategy health: OK', {
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
        this.logger.info('🔄 Daily error counts reset');
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
      this.logger.info(`?? Fetching 5-minute candle at ${now.toLocaleTimeString()}`);
      
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

        this.logger.info(`?? New 5-minute candle: ${newCandle.timestamp.toLocaleTimeString()} OHLC: ${newCandle.open}/${newCandle.high}/${newCandle.low}/${newCandle.close} V:${newCandle.volume}`);

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
            this.logger.info(`📊 New 5-minute candle: NIFTY50 ${newCandle.close} (${newCandle.timestamp.toLocaleTimeString()})`);
          } else {
            // Same timestamp but different OHLC - update existing candle (live candle update)
            if (lastHistoricalCandle && newCandle.timestamp.getTime() === lastHistoricalCandle.timestamp.getTime()) {
              this.candleHistory[this.candleHistory.length - 1] = newCandle;
              this.logger.debug(`🔄 Updated current 5-minute candle: NIFTY50 ${newCandle.close}`);
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
          
          // Check position exit conditions with new candle data (LONG uses candle close, SHORT uses real-time)
          if (this.currentPosition) {
            await this.checkPositionExit(newCandle.close);
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
   * Stop all position monitoring when no active positions
   */
  private stopPositionMonitoring(): void {
    // Stop position monitoring system
    this.stopShortPositionMonitoring();
    
    this.logger.info('Position monitoring stopped (no active positions)');
    
    // Also cleanup option WebSocket subscriptions
    // WebSocket cleanup removed - using pure REST API
  }

  /**
   * Pure REST API position monitoring - reliable and predictable
   */
  private async startPositionMonitoring(): Promise<void> {
    if (!this.currentPosition) {
      this.logger.warn('Cannot start position monitoring - no active position');
      return;
    }
    
    this.logger.info(`?? Starting ${this.currentPosition.type} position monitoring (REST API polling)`);

    // Stop any existing monitoring first
    this.stopShortPositionMonitoring();

    const instrumentToken = this.currentPosition.instrument.instrument_token;
    
    // Start REST API polling-based monitoring
    this.startPollingBasedMonitoring(instrumentToken);
  }

  /**
   * Stop position monitoring 
   */
  private stopShortPositionMonitoring(): void {
    // Clear polling timeout (using clearTimeout instead of clearInterval for recursive setTimeout)
    if (this.shortMonitoringInterval) {
      clearTimeout(this.shortMonitoringInterval);
      delete this.shortMonitoringInterval;
    }
    
    // Reset polling flags and counters
    this.isPollingInProgress = false;
    this.consecutivePollingFailures = 0;
    this.lastPollingTime = null;
    
    this.logger.info('🛑 Position monitoring stopped');
  }

  /**
   * Pure REST API polling-based monitoring
   * Uses recursive setTimeout to prevent overlapping async operations
   */
  private startPollingBasedMonitoring(instrumentToken: number): void {
    // Recursive polling function that waits for completion before scheduling next poll
    const pollOnce = async () => {
      // Check if position still exists
      if (!this.currentPosition) {
        this.stopShortPositionMonitoring();
        return;
      }

      // Circuit breaker: Stop if too many consecutive failures
      if (this.consecutivePollingFailures >= 10) {
        this.logger.error('🔴 Circuit breaker: Too many polling failures, stopping monitoring');
        this.stopShortPositionMonitoring();
        return;
      }

      // Check if previous poll is still running (safety check)
      if (this.isPollingInProgress) {
        this.logger.debug('⏭️ Skipping poll - previous operation still in progress');
        // Schedule next poll anyway to maintain cadence
        this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
        return;
      }

      this.isPollingInProgress = true;
      const pollStartTime = Date.now();
      
      try {
        // Get current premium via REST API
        const currentPremium = await this.getLiveOptionPremium(instrumentToken);
        
        if (currentPremium > 0) {
          // Update cached position state for dashboard display
          this.cachedCurrentPrice = currentPremium;
          
          // Calculate and cache unrealized P&L
          // Since we always BUY options (CE or PE), profit when price goes up
          if (this.currentPosition) {
            const priceDiff = currentPremium - this.currentPosition.entryPrice;
            this.cachedUnrealizedPnL = priceDiff * this.currentPosition.quantity;
            this.lastPriceUpdateTime = new Date();
          }
          
          // Now proceed with exit checks
          if (this.currentPosition.type === 'SHORT') {
            await this.checkShortExitUnified(currentPremium, 'polling');
          } else if (this.currentPosition.type === 'LONG') {
            await this.checkLongTrailingSL(currentPremium);
          }
          
          // Success - reset failure counter
          this.consecutivePollingFailures = 0;
        }
      } catch (error) {
        this.logger.error(`Error in REST API ${this.currentPosition?.type} monitoring:`, error);
        this.consecutivePollingFailures++;
      } finally {
        this.isPollingInProgress = false;
        this.lastPollingTime = new Date();
      }

      // Calculate smart delay with backoff on failures
      let delay = 1000; // Default 1 second
      
      // Apply backoff if consecutive failures
      if (this.consecutivePollingFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        delay = 5000; // Back off to 5 seconds
        this.logger.warn(`⚠️ Multiple polling failures detected, backing off to ${delay}ms interval`);
      } else {
        // Smart debouncing: Ensure minimum interval between polls
        const timeSinceLastPoll = Date.now() - pollStartTime;
        if (timeSinceLastPoll < this.MIN_POLLING_INTERVAL) {
          delay = this.MIN_POLLING_INTERVAL - timeSinceLastPoll + 1000;
        }
      }

      // Schedule next poll AFTER current one completes (prevents overlapping)
      this.shortMonitoringInterval = setTimeout(pollOnce, delay);
    };

    this.logger.info(`🔄 Using pure REST API ${this.currentPosition?.type || 'position'} monitoring (1s intervals, recursive with backoff)`);
    
    // Start first poll
    pollOnce();
  }

  // === All WebSocket methods removed - Using pure REST API polling ===
  // WebSocket monitoring, health checks, and subscription methods have been
  // replaced with reliable REST API calls for position monitoring

  private async checkPositionExit(candleClose?: number): Promise<void> {
    if (!this.currentPosition) return;

    try {
      if (this.currentPosition.type === 'LONG') {
        // For LONG positions: Use ONLY 5-minute candle close (never real-time LTP)
        if (candleClose !== undefined) {
          this.currentNiftyLTP = candleClose; // Store for dashboard
          await this.checkLongExitOnCandleClose(candleClose);
        } else {
          this.logger.warn('LONG position exit called without candle close price');
        }
      } else if (this.currentPosition.type === 'SHORT') {
        // For SHORT positions: Use pure REST API polling monitoring (via startPositionMonitoring)
        // Position monitoring is handled by startPositionMonitoring() -> startPollingBasedMonitoring()
        this.logger.debug('SHORT position monitoring handled by dedicated polling system');
      }
      
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
      
      // Exit conditions are now handled by dedicated systems:
      // - LONG: checkLongExitOnCandleClose() via candle completion
      // - SHORT: checkShortExitUnified() via startShortPositionMonitoring()
      // No need to call checkExitConditions() anymore
      
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
      this.logger.debug('🔒 Signal check skipped - Outside market hours (9:15 AM - 3:30 PM)');
      return;
    }
    
    // Use latest completed candle from history instead of currentCandle
    if (this.candleHistory.length === 0) return;
    const latestCandle = this.candleHistory[this.candleHistory.length - 1];
    if (!latestCandle) return;
    
    const { rsi, supertrend, bollingerBands } = this.currentIndicators;
    const { r1, r2 } = this.dailyPivots;
    const close = latestCandle.close;
    
    this.logger.info('?? BOLLINGER ENTRY ANALYSIS - Checking signals...');
    this.logger.info(`?? Current Indicators: RSI=${rsi.toFixed(2)}, BB_Upper=${bollingerBands.upper.toFixed(2)}, BB_Lower=${bollingerBands.lower.toFixed(2)}, Supertrend=${supertrend.trend}, Price=${close}`);
    
    // LONG Entry Signal - Expanded RSI range for better signal generation
    const longConditions = {
      priceAboveUpperBB: close > bollingerBands.upper,
      rsiInRange: rsi >= 65 && rsi <= 85, // Expanded from restrictive 70-80
      supertrendBullish: supertrend.trend === 'UP',
      aboveR1OrR2: close > r1 || close > r2
    };
    
    const longSignal = Object.values(longConditions).every(Boolean);
    
    if (longSignal) {
      this.logger.info('🚀 LONG entry signal detected', {
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
      this.logger.info('🔻 SHORT entry signal detected', {
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
    // Position overlap protection - ensure no existing position
    if (this.currentPosition !== null) {
      this.logger.warn('Skipping LONG entry - position already exists', {
        existingPosition: this.currentPosition.type,
        instrument: this.currentPosition.instrument?.tradingsymbol
      });
      return;
    }

    // Race condition protection - prevent concurrent entry executions
    if (this.isExecutingLongEntry) {
      this.logger.debug('🔒 LONG entry execution already in progress, skipping duplicate trigger');
      return;
    }

    this.isExecutingLongEntry = true;

    try {
      // Real-time option selection instead of prediction
      const targetPremium = nifty50Price * 0.01; // 1% of NIFTY
      const ceOption = await this.selectOptionInstrument('CE', targetPremium);
      
      if (!ceOption) {
        this.logger.error('? LONG entry failed: Could not find suitable CE option');
        return;
      }

      this.logger.info('?? CE Option selected for LONG entry', {
        symbol: ceOption.tradingsymbol,
        premium: ceOption.last_price,
        target: targetPremium.toFixed(2),
        niftyPrice: nifty50Price.toFixed(2),
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Option already validated above - proceed with entry
      this.logger.info(`?? Executing LONG entry with real-time selected option: ${ceOption.tradingsymbol}`);
      const orderResult = await this.executeOrder('BUY', ceOption, this.FIXED_LOTS);
      
      if (orderResult.success) {
        this.currentPosition = {
          type: 'LONG',
          instrument: ceOption,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          entryTime: new Date(),
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`
        };
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring().catch(error => {
          this.logger.error('Failed to start position monitoring:', error);
        });
        
        this.metrics.totalTrades++;
        // Update metrics to reflect successful trade execution
        this.updateMetrics({ 
          totalTrades: this.metrics.totalTrades,
          healthStatus: 'healthy',
          lastTradeTime: new Date()
        });
        this.logger.info('✅ LONG position opened', {
          instrument: ceOption.tradingsymbol,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS
        });
      }
      
    } catch (error) {
      this.logger.error('❌ Error executing LONG entry:', error);
      
      // Smart error handling: Check if position was created despite error
      if (this.currentPosition) {
        // Position exists - order likely succeeded despite error message
        this.logger.warn('⚠️ LONG entry error but position exists - order likely succeeded');
        this.logger.info('✅ Position monitoring will continue normally');
      } else {
        // No position - genuine entry failure
        this.logger.info('📉 LONG entry failed - no position created');
        this.trackError('execution_long_entry', error, true);
      }
    } finally {
      // Always reset guard flag after execution completes
      this.isExecutingLongEntry = false;
    }
  }

  /**
   * Execute SHORT entry with PE option selection
   */
  private async executeShortEntry(nifty50Price: number): Promise<void> {
    // Position overlap protection - ensure no existing position
    if (this.currentPosition !== null) {
      this.logger.warn('Skipping SHORT entry - position already exists', {
        existingPosition: this.currentPosition.type,
        instrument: this.currentPosition.instrument?.tradingsymbol
      });
      return;
    }

    // Race condition protection - prevent concurrent entry executions
    if (this.isExecutingShortEntry) {
      this.logger.debug('🔒 SHORT entry execution already in progress, skipping duplicate trigger');
      return;
    }

    this.isExecutingShortEntry = true;

    try {
      // Real-time option selection instead of prediction
      const targetPremium = nifty50Price * 0.01; // 1% of NIFTY
      const peOption = await this.selectOptionInstrument('PE', targetPremium);
      
      if (!peOption) {
        this.logger.error('? SHORT entry failed: Could not find suitable PE option');
        return;
      }

      this.logger.info('?? PE Option selected for SHORT entry', {
        symbol: peOption.tradingsymbol,
        premium: peOption.last_price,
        target: targetPremium.toFixed(2),
        niftyPrice: nifty50Price.toFixed(2),
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Option already validated - proceed with entry
      this.logger.info(`?? Executing SHORT entry with real-time selected option: ${peOption.tradingsymbol}`);
      const orderResult = await this.executeOrder('BUY', peOption, this.FIXED_LOTS);
      
      if (orderResult.success) {
        this.currentPosition = {
          type: 'SHORT',
          instrument: peOption,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          entryTime: new Date(),
          trailingSL: orderResult.price * 0.88, // 12% below entry
          highestPremium: orderResult.price,
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`
        };
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring().catch(error => {
          this.logger.error('Failed to start position monitoring:', error);
        });
        
        this.metrics.totalTrades++;
        // Update metrics to reflect successful trade execution
        this.updateMetrics({ 
          totalTrades: this.metrics.totalTrades,
          healthStatus: 'healthy',
          lastTradeTime: new Date()
        });
        this.logger.info('✅ SHORT position opened', {
          instrument: peOption.tradingsymbol,
          entryPrice: orderResult.price,
          quantity: this.FIXED_LOTS,
          trailingSL: this.currentPosition?.trailingSL
        });
      }
      
    } catch (error) {
      this.logger.error('❌ Error executing SHORT entry:', error);
      
      // Smart error handling: Check if position was created despite error
      if (this.currentPosition) {
        // Position exists - order likely succeeded despite error message
        this.logger.warn('⚠️ SHORT entry error but position exists - order likely succeeded');
        this.logger.info('✅ Position monitoring will continue normally');
      } else {
        // No position - genuine entry failure
        this.logger.info('📉 SHORT entry failed - no position created');
        this.trackError('execution_short_entry', error, true);
      }
    } finally {
      // Always reset guard flag after execution completes
      this.isExecutingShortEntry = false;
    }
  }

  // ===========================
  // EXIT LOGIC
  // ===========================

  /**
   * DEPRECATED: Check exit conditions during real-time monitoring
   * REPLACED BY: Position-specific exit systems
   * - LONG exits: handled by checkLongExitOnCandleClose() via candle completion
   * - SHORT exits: handled by startShortPositionMonitoring() with unified exit logic
   * This method is no longer used and will be removed in future versions
   */
  private async checkExitConditions(nifty50LTP: number): Promise<void> {
    if (!this.currentPosition) return;
    
    // All exit processing has been moved to dedicated position-specific systems
    // LONG: checkLongExitOnCandleClose() called from checkPositionExit()
    // SHORT: checkShortExitUnified() called from startShortPositionMonitoring()
    
    this.logger.debug('?? checkExitConditions() called but all exit logic moved to dedicated systems', {
      positionType: this.currentPosition.type,
      niftyLTP: nifty50LTP.toFixed(2)
    });
  }

  /**
   * Check LONG exit conditions (real-time NIFTY50 vs previous Mid BB)
   * DEPRECATED: This method should not be used for real-time monitoring
   * Use checkLongExitOnCandleClose() instead for proper candle-close exits
   */
  private async checkLongExitConditions(nifty50LTP: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    
    const previousMidBB = this.currentIndicators.bollingerBands.middle;
    
    if (nifty50LTP < previousMidBB) {
      this.logger.info('🚪 LONG exit signal: NIFTY50 below Mid BB', {
        nifty50LTP: nifty50LTP.toFixed(2),
        midBB: previousMidBB.toFixed(2)
      });
      
      await this.executeExit('LONG_EXIT_SIGNAL');
    }
  }

  /**
   * Check LONG exit conditions ONLY on 5-minute candle close
   * This is the ONLY method that should trigger LONG exits
   */
  private async checkLongExitOnCandleClose(candleClosePrice: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    if (this.currentPosition.type !== 'LONG') return;
    
    const bbMidline = this.currentIndicators.bollingerBands.middle;
    
    // ONLY exit if completed 5-minute candle close is below BB midline
    if (candleClosePrice < bbMidline) {
      this.logger.info('?? LONG exit signal: 5-minute candle close below BB midline', {
        candleClose: candleClosePrice.toFixed(2),
        bbMidline: bbMidline.toFixed(2),
        exitType: 'CANDLE_CLOSE_ONLY',
        timestamp: new Date().toLocaleTimeString()
      });
      
      await this.executeExit('LONG_CANDLE_CLOSE_EXIT');
    } else {
      this.logger.debug('?? LONG position held: candle close above BB midline', {
        candleClose: candleClosePrice.toFixed(2),
        bbMidline: bbMidline.toFixed(2)
      });
    }
  }

  // Deprecated WebSocket-based methods removed - using checkShortExitUnified() with REST API polling

  /**
   * Unified SHORT exit handler - Single entry point for all SHORT exit checks
   * Consolidates logic with source tracking and race condition protection
   */
  private async checkShortExitUnified(currentPremium: number, source: 'polling'): Promise<void> {
    if (!this.currentPosition || this.currentPosition.type !== 'SHORT') return;
    
    // Race condition protection - ensure only one exit check at a time
    if (this.isProcessingShortExit) {
      this.logger.debug(`? SHORT exit check already in progress, skipping ${source} request`);
      return;
    }
    
    this.isProcessingShortExit = true;
    
    try {
      // Update highest premium and trailing SL
      if (currentPremium > (this.currentPosition.highestPremium || 0)) {
        this.currentPosition.highestPremium = currentPremium;
        this.currentPosition.trailingSL = currentPremium * 0.88; // 12% below new high
        
        this.logger.info(`?? Trailing SL updated (${source})`, {
          newHigh: currentPremium.toFixed(2),
          newSL: this.currentPosition.trailingSL.toFixed(2),
          source: source,
          timestamp: new Date().toLocaleTimeString()
        });
      }
      
      // Check if trailing SL is hit
      if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
        this.logger.info(`?? SHORT exit signal: Trailing SL hit (${source})`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL.toFixed(2),
          source: source,
          timestamp: new Date().toLocaleTimeString()
        });
        
        await this.executeExit(`SHORT_TRAILING_SL_${source.toUpperCase()}`);
      } else {
        this.logger.debug(`?? SHORT position held (${source})`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL?.toFixed(2) || 'not-set',
          source: source
        });
      }
      
    } catch (error) {
      this.logger.error(`Error in unified SHORT exit check (${source}):`, error);
    } finally {
      this.isProcessingShortExit = false;
    }
  }

  /**
   * Check LONG trailing SL (similar to SHORT logic but for LONG positions)
   */
  private async checkLongTrailingSL(currentPremium: number): Promise<void> {
    if (!this.currentPosition || this.currentPosition.type !== 'LONG') return;
    
    // Race condition protection
    if (this.isProcessingLongExit) {
      this.logger.debug('? LONG exit already in progress, skipping');
      return;
    }
    
    this.isProcessingLongExit = true;
    
    try {
      // Update trailing SL (same logic as SHORT)
      if (currentPremium > (this.currentPosition.highestPremium || 0)) {
        this.currentPosition.highestPremium = currentPremium;
        this.currentPosition.trailingSL = currentPremium * 0.88; // 12% below new high
        
        this.logger.info(`?? LONG Trailing SL updated`, {
          newHigh: currentPremium.toFixed(2),
          newSL: this.currentPosition.trailingSL.toFixed(2),
          timestamp: new Date().toLocaleTimeString()
        });
      }
      
      // Check if trailing SL hit
      if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
        this.logger.info(`?? LONG exit signal: Trailing SL hit`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL.toFixed(2),
          timestamp: new Date().toLocaleTimeString()
        });
        
        await this.executeExit('LONG_TRAILING_SL');
      }
    } catch (error) {
      this.logger.error('Error in LONG trailing SL check:', error);
    } finally {
      this.isProcessingLongExit = false;
    }
  }

  /**
   * Check candle-based exit signals (called on 5-minute candle completion)
   */
  private async checkCandleBasedExitSignals(): Promise<void> {
    // Additional candle-based exit logic can be implemented here
    // LONG positions use ONLY 5-minute candle close via checkLongExitOnCandleClose()
    // SHORT positions use unified real-time monitoring via startShortPositionMonitoring()
  }

  /**
   * Execute position exit
   */
  private async executeExit(reason: string): Promise<void> {
    if (!this.currentPosition) return;
    
    try {
      const orderResult = await this.executeOrder('SELL', this.currentPosition.instrument, this.FIXED_LOTS);
      
      if (orderResult.success) {
        // Calculate P&L correctly for options trading: (Exit Premium - Entry Premium) � Total Quantity
        const totalQuantity = this.FIXED_LOTS * 75; // NIFTY lot size � number of lots
        const pnl = (orderResult.price - this.currentPosition.entryPrice) * totalQuantity;
        this.metrics.profitLoss += pnl;
        
        // Update capital with P&L
        this.currentCapital += pnl;
        
        // Create trade record for history
        const tradeRecord = {
          tradeId: `BB_${Date.now()}`,
          entryOrderId: this.currentPosition.entryOrderId, // Use real entry order ID
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
        
        this.logger.info('✅ Position closed', {
          reason,
          instrument: this.currentPosition.instrument.tradingsymbol,
          entryPrice: this.currentPosition.entryPrice,
          exitPrice: orderResult.price,
          pnl: pnl.toFixed(2),
          newCapital: this.currentCapital.toFixed(2)
        });
        
        // Position cleared - REST API polling will stop automatically
        
        this.currentPosition = null;
        
        // Reset cached position state for dashboard
        this.cachedCurrentPrice = 0;
        this.cachedUnrealizedPnL = 0;
        this.lastPriceUpdateTime = null;
        
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
      this.logger.error('❌ Error executing exit:', error);
      
      // Smart error handling: Verify actual position state before clearing
      if (this.currentPosition) {
        // Position object still exists in strategy state
        // This could be:
        // 1) Race condition (another exit attempt succeeded and this one failed)
        // 2) Real error (order submission failed)
        // 3) Network error (order may have succeeded but confirmation failed)
        
        this.logger.warn('⚠️ Exit error but position object still exists in strategy state');
        
        // Since Bollinger Band doesn't have direct position verification API,
        // we'll keep the position object and continue monitoring
        // The monitoring system will naturally stop when position truly doesn't exist
        
        this.logger.warn('🔧 Keeping position state to continue monitoring');
        this.logger.warn('📊 Position monitoring will continue - manual intervention may be needed if position actually closed');
        
        // Don't clear position - let monitoring continue
        // If position was actually closed, next monitoring cycle will handle it
        return;
      } else {
        // Position already cleared - error happened after successful exit
        this.logger.info('✅ Position already cleared - error occurred after successful exit');
        this.logger.info('📝 This is likely a benign error during cleanup');
      }
    }
  }

  /**
   * Force close position (for end-of-day or strategy stop)
   */
  private async forceClosePosition(reason: string): Promise<void> {
    if (!this.currentPosition) return;
    
    this.logger.warn('🔴 Force closing position:', reason);
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
      
      this.logger.info(`🎯 Selecting ${optionType} option by PREMIUM for NIFTY price: ₹${targetPremium.toFixed(2)}`);
      this.logger.info(`📅 Target expiry: ${nextTuesdayExpiry.toDateString()}`);
      
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
        // Add the current price to the option object for UI display
        const currentPrice = quotes[bestOption.instrument_token].last_price;
        bestOption.last_price = currentPrice;
        
        this.logger.info('Option selected', {
          tradingsymbol: bestOption.tradingsymbol,
          targetPremium: targetPremium.toFixed(2),
          actualPremium: currentPrice.toFixed(2),
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
      
      const orderResponse = await this.kiteConnect.placeOrder('regular', orderParams);
      
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
      this.logger.error(`🚨 CRITICAL ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    } else {
      this.logger.warn(`⚠️ ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    }
    
    // Alert if too many consecutive errors
    if (this.healthStatus.consecutiveErrors >= 5) {
      this.logger.error(`🔥 STRATEGY HEALTH ALERT: ${this.healthStatus.consecutiveErrors} consecutive errors detected!`, {
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
      this.logger.error('?? 5-minute candle fetch failed, starting retry mechanism:', error);
      
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
      this.logger.error('? LONG entry failed after all retry attempts:', error);
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
      this.logger.error('? SHORT entry failed after all retry attempts:', error);
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
          this.logger.info(`? ${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`?? ${operationName} attempt ${attempt}/${maxAttempts} failed:`, error);
        
        if (attempt < maxAttempts) {
          const delay = attempt <= delays.length ? delays[attempt - 1] : delays[delays.length - 1];
          this.logger.info(`?? Retrying ${operationName} in ${delay}ms...`);
          await this.sleep(delay!);
        }
      }
    }
    
    this.logger.error(`? ${operationName} failed after ${maxAttempts} attempts`);
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
        this.logger.info('? Candle fetch recovered successfully');
      } catch (error) {
        this.logger.warn('?? Candle retry failed, will try again in 10 seconds');
      }
    }, this.CANDLE_RETRY_INTERVAL);
    
    this.logger.info('?? Started candle retry mechanism (10-second intervals)');
  }

  /**
   * Stop candle retry mechanism when successful
   */
  private stopCandleRetryMechanism(): void {
    if (this.candleRetryTimer) {
      clearInterval(this.candleRetryTimer);
      this.candleRetryTimer = undefined as any;
      this.logger.info('? Stopped candle retry mechanism (operation successful)');
    }
  }

}
