import { Logger } from '../../utils/Logger';
import { TradeExecutionService } from './BreakoutPullbackExecutor';
import { globalStateLock } from '../../utils/StateLock';
import { StrategyStatePersistence, PersistedStrategyState } from '../../services/StrategyStatePersistence';
import { KiteTicker } from 'kiteconnect';

// WebSocket-based real-time price streaming for optimal performance
// Eliminates REST API rate limiting issues by using WebSocket ticks
// Includes REST API fallback for maximum reliability

// Define types locally since we removed the utility class
export interface NiftyFuturesData {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: Date;
  strike: number;
  tick_size: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}

export interface TickData {
  instrument_token: number;
  last_price: number;
  volume: number;
  buy_quantity: number;
  sell_quantity: number;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  change: number;
  last_trade_time: Date;
  exchange_timestamp: Date;
  timestamp?: Date; // For our test ticks
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
}

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PivotPoint {
  price: number;
  timestamp: Date;
  type: 'high' | 'low';
}

export interface BreakoutSignal {
  type: 'long_breakout' | 'short_breakout';
  price: number; // breakout candle close price
  timestamp: Date;
  volume: number; // breakout candle volume
  volumeMA50: number; // 50-period SMA of 5m candle volumes
  pivotPrice: number; // the pivot level that was broken
  pivotType: 'high' | 'low'; // which pivot was broken
  candleOpen: number; // breakout candle open price
  candleClose: number; // breakout candle close price
  candleHigh: number; // breakout candle high price
  candleLow: number; // breakout candle low price
  volumeRatio: number; // volume / volumeMA50 (for analysis)
}

export interface MarkingCandle {
  candle: Candle; // The actual candle data
  entryPrice: number; // high for long, low for short
  stopLoss: number; // low for long, high for short
  updateCount: number; // 0 for first marking candle, 1 for update
  detectedAt: Date; // when this marking candle was detected
}

export interface MarkingCandleState {
  isActive: boolean; // whether we're currently tracking marking candles
  breakoutReference: BreakoutSignal | null; // reference to the original breakout
  startTime: Date | null; // when breakout occurred (20-min timer starts here)
  currentMarkingCandle: MarkingCandle | null; // current active marking candle
  searchPhase: 'initial' | 'updates' | 'expired' | 'completed'; // current phase
  barsProcessedSinceBreakout: number; // count bars since breakout for 10-bar initial search
  maxUpdatesReached: boolean; // whether 1 update has been reached
  timeExpired: boolean; // whether 20-minute limit has been exceeded
  tradeSkipped: boolean; // whether this setup has been skipped
}

export enum TradeState {
  WAITING_FOR_BREAKOUT = 'waiting_for_breakout',
  WAITING_FOR_ENTRY = 'waiting_for_entry', 
  IN_TRADE = 'in_trade'
}

export interface DailyPivotLevels {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface TradeSetupRequest {
  strategyId: string;
  direction: 'LONG' | 'SHORT';
  entryLevel: number;
  stopLossLevel: number;
  targetLevel: number;
  underlyingPrice: number;
  timestamp: Date;
  // Trailing stop loss fields (60% of target distance)
  originalStopLossLevel: number;   // Store initial SL for reference
  trailingTriggerLevel: number;    // The 60% price level
}

export interface StrategyState {
  isActive: boolean;
  currentContract?: NiftyFuturesData;
  livePrice?: TickData;
  lastUpdateTime?: Date;
  priceStreamingActive: boolean;
  breakoutDetectionActive: boolean;
  tradeState: TradeState; // Current trade state
  currentTradeId?: string; // ID of active trade setup/execution
  tradeSetupRequest?: TradeSetupRequest; // Current trade setup details
  candles: Candle[];
  latestPivotHigh?: PivotPoint | undefined;
  latestPivotLow?: PivotPoint | undefined;
  latestBreakoutSignal?: BreakoutSignal | undefined;
  markingCandleState: MarkingCandleState; // new marking candle state
  currentVolumeSMA50: number;
  // Volume tracking for incremental calculation (for WebSocket tick processing)
  lastCumulativeVolume: number; // Last known cumulative daily volume
  // Historical candle processing tracking (prevents replay on restart)
  lastProcessedCandleForBreakout?: Date | undefined; // Last candle that ran through checkForBreakout()
  lastFiveMinuteBoundary?: Date | undefined; // Last 5-minute boundary timestamp for API fetching
}

export class BreakoutPullbackStrategy {
  private kiteConnect: any;
  private logger: Logger;
  private strategyState: StrategyState;
  private tradeExecutionService: TradeExecutionService;
  private strategyPersistence: StrategyStatePersistence;
  
  // WebSocket properties (replacing manual polling)
  private kiteTicker: any | null = null;
  private isWebSocketActive = false;
  private webSocketReconnectAttempts = 0;
  private maxWebSocketReconnectAttempts = 10;

  // Circuit breaker properties for WebSocket management
  private webSocketFailureCount = 0;
  private lastWebSocketFailureTime: Date | null = null;
  private webSocketSuccessCount = 0;
  private totalWebSocketAttempts = 0;
  private isWebSocketCircuitBreakerOpen = false;
  private nextWebSocketRetryTime: Date | null = null;

  // Shutdown flag to prevent fallback handlers during intentional stop
  private isShuttingDown: boolean = false;

  // WebSocket event listener references for cleanup (prevents unhandled rejections during disconnect)
  private websocketConnectHandler: (() => void) | null = null;
  private websocketDisconnectHandler: ((error: any) => void) | null = null;
  private websocketErrorHandler: ((error: any) => void) | null = null;
  private websocketReconnectHandler: ((count: number, interval: number) => void) | null = null;
  private websocketNoreconnectHandler: (() => void) | null = null;
  private websocketTicksHandler: ((ticks: any[]) => void) | null = null;

  // Legacy properties (kept for backward compatibility and fallback)
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private isManualStreamingActive = false;
  private pollingFailureCount = 0;
  private lastPollingFailureTime: Date | null = null;
  private pollingSuccessCount = 0;
  private totalPollingAttempts = 0;
  private isCircuitBreakerOpen = false;
  private nextRetryTime: Date | null = null;

  // Throttling and resource management (legacy - kept for fallback)
  private lastApiCallTime: Date | null = null;
  private minTimeBetweenCalls = 300;

  // Daily pivot levels for directional bias filtering
  private dailyPivots: DailyPivotLevels | null = null;

  /**
   * RACE CONDITION PROTECTION STATUS
   * Get current status of atomic state locks for monitoring
   */
  public getStateLockStatus(): { 
    activeLocks: string[], 
    isTradeEntryLocked: boolean, 
    isTradeExitLocked: boolean,
    queueStatus: { [key: string]: { locked: boolean; queueLength: number } }
  } {
    const activeLocks = globalStateLock.getActiveLocks();
    const queueStatus = globalStateLock.getQueueStatus();
    
    return {
      activeLocks,
      isTradeEntryLocked: globalStateLock.isLocked('trade-entry'),
      isTradeExitLocked: globalStateLock.isLocked('trade-exit'),
      queueStatus
    };
  }
  private activeApiCallsCount = 0;
  private maxConcurrentCalls = 1; // Limit concurrent API calls

  // Health monitoring
  private healthMonitoringInterval: NodeJS.Timeout | null = null;

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

  private breakoutDetectionInterval: NodeJS.Timeout | null = null;

  // Strategy state persistence
  private persistenceTimer: NodeJS.Timeout | null = null;
  private isDirty = false; // Track if state needs saving
  private readonly PERSISTENCE_INTERVAL = 5000; // 5 seconds

  // Five-minute candle data from API
  private currentOneMinuteCandle: {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tickCount: number;
  } | null = null;

  private updateTimer: NodeJS.Timeout | undefined;

  // Five-minute candle processing
  private lastProcessedFiveMinuteTime: number = 0; // Track last processed 5-min boundary
  private isProcessingFiveMinute: boolean = false;  // Prevent concurrent processing

  // Execution guard flags to prevent race conditions
  private isExecutingEntry: boolean = false;
  private isExecutingExit: boolean = false;

  constructor(kiteConnect: any, logger?: Logger) {
    this.kiteConnect = kiteConnect;
    this.logger = logger || new Logger();
    this.tradeExecutionService = new TradeExecutionService(kiteConnect, this.logger);
    this.strategyPersistence = new StrategyStatePersistence(this.logger);
    
    this.strategyState = {
      isActive: false,
      priceStreamingActive: false,
      breakoutDetectionActive: false,
      tradeState: TradeState.WAITING_FOR_BREAKOUT,
      candles: [],
      currentVolumeSMA50: 0,
      lastCumulativeVolume: 0,
      markingCandleState: {
        isActive: false,
        breakoutReference: null,
        startTime: null,
        currentMarkingCandle: null,
        searchPhase: 'initial',
        barsProcessedSinceBreakout: 0,
        maxUpdatesReached: false,
        timeExpired: false,
        tradeSkipped: false
      }
    };
  }

  /**
   * Start the strategy
   */
  public async startStrategy(): Promise<void> {
    try {
      this.logger.info('Starting Nifty Breakout Retracement Strategy...');
      
      // Try to restore previous state first
      const restoredState = await this.strategyPersistence.loadStrategyState();
      
      // Determine if we need fresh initialization
      let needsFreshInit = false;
      
      if (restoredState) {
        // Check if this is a new trading day
        const isNewDay = this.isNewTradingDay(restoredState);
        
        if (isNewDay) {
          this.logger.info('📅 NEW TRADING DAY DETECTED - Performing daily cleanup');
          await this.dailyCleanup();
          needsFreshInit = true;
        } else {
          // Same day - try to restore state
          if (await this.validateAndRestoreState(restoredState)) {
            this.logger.info('🔄 Strategy state restored successfully (same trading day)');
            
            // Always recalculate daily pivots on startup (even with restored state)
            // Pivots are date-specific and must use latest previous day's data
            await this.initializeDailyPivots();
          } else {
            // Validation failed - need fresh init
            needsFreshInit = true;
          }
        }
      } else {
        // No saved state - need fresh init
        needsFreshInit = true;
      }
      
      // Fresh initialization if needed (new day, no state, or validation failed)
      if (needsFreshInit) {
        this.logger.info('📝 Starting fresh strategy initialization...');
        
        // Initialize current month Nifty futures contract
        await this.initializeNiftyFuturesContract();
        
        if (!this.strategyState.currentContract) {
          throw new Error('Failed to initialize futures contract');
        }

        // Load historical 5-minute candles for pivot detection
        await this.loadHistoricalCandles();

        // Initialize 5-minute boundary tracking to prevent processing historical candles
        // Use the LAST historical candle timestamp so only NEW live candles are processed
        if (this.strategyState.candles.length > 0) {
          const lastHistoricalCandle = this.strategyState.candles[this.strategyState.candles.length - 1]!;
          this.lastProcessedFiveMinuteTime = lastHistoricalCandle.timestamp.getTime();
          this.logger.info(`✅ Initialized 5-minute boundary tracking from last historical candle: ${lastHistoricalCandle.timestamp.toLocaleString()}`);
          this.logger.info(`📊 Will only process NEW 5-minute candles after this timestamp`);
        } else {
          // Fallback: If no historical candles, use current boundary
          const now = new Date();
          const currentMinute = now.getMinutes();
          const currentFiveMinBoundary = Math.floor(currentMinute / 5) * 5;
          this.lastProcessedFiveMinuteTime = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            now.getHours(),
            currentFiveMinBoundary,
            0,
            0
          ).getTime();
          this.logger.warn(`⚠️ No historical candles found - initialized to current boundary: ${new Date(this.lastProcessedFiveMinuteTime).toLocaleTimeString()}`);
        }

        // CRITICAL: Mark all historical candles as already processed for breakout detection
        // This prevents replaying historical candles through breakout logic on new day startup
        if (this.strategyState.candles.length > 0) {
          const lastHistoricalCandle = this.strategyState.candles[this.strategyState.candles.length - 1]!;
          this.strategyState.lastProcessedCandleForBreakout = lastHistoricalCandle.timestamp;
          this.logger.info(`✅ lastProcessedCandleForBreakout initialized to: ${lastHistoricalCandle.timestamp.toLocaleString()}`);
        }

        // Calculate daily pivots for directional bias filtering
        await this.initializeDailyPivots();
      }

      // CRITICAL FIX: Cross-validate strategy state with TradeExecutionService
      await this.validateTradeStateSync();

      // Start manual price streaming
      await this.startManualPriceStreaming();
      
      // Start breakout detection  
      await this.startBreakoutDetection();
      
      // Start persistence system
      this.startPersistenceTimer();
      
      // Start health monitoring system
      this.startHealthMonitoring();
      
      this.strategyState.isActive = true;
      this.markStateAsDirty(); // Save initial state
      
      this.logger.info('Nifty Breakout Retracement Strategy started successfully with health monitoring');
      
    } catch (error) {
      this.trackError('strategy_start', error, true);
      throw error;
    }
  }

  /**
   * Initialize current month Nifty futures contract
   */
  private async initializeNiftyFuturesContract(): Promise<void> {
    try {
      // Get all instruments
      const instruments = await this.kiteConnect.getInstruments(['NFO']);
      
      // Filter for NIFTY futures (current month)
      const niftyFutures = instruments.filter((inst: any) => 
        inst.name === 'NIFTY' && 
        inst.instrument_type === 'FUT'
      );

      if (niftyFutures.length === 0) {
        throw new Error('No NIFTY futures found');
      }

      // Sort by expiry to get current month (nearest expiry)
      niftyFutures.sort((a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
      const currentContract = niftyFutures[0];

      // Map to our interface
      const mappedContract: NiftyFuturesData = {
        instrument_token: currentContract.instrument_token,
        tradingsymbol: currentContract.tradingsymbol,
        name: currentContract.name,
        expiry: new Date(currentContract.expiry),
        strike: currentContract.strike,
        tick_size: currentContract.tick_size,
        lot_size: currentContract.lot_size,
        instrument_type: currentContract.instrument_type,
        segment: currentContract.segment,
        exchange: currentContract.exchange
      };

      this.strategyState.currentContract = mappedContract;
      this.logger.info(`Found current month Nifty futures: ${mappedContract.tradingsymbol} (Token: ${mappedContract.instrument_token}, Expiry: ${mappedContract.expiry})`);
      
    } catch (error) {
      this.logger.error('Error initializing Nifty futures contract:', error);
      throw error;
    }
  }

  /**
   * Load historical candles 
   */
  private async loadHistoricalCandles(): Promise<void> {
    try {
      const contract = this.strategyState.currentContract;
      if (!contract) {
        throw new Error('No contract available');
      }
      
      this.logger.info(`Using contract: ${contract.tradingsymbol} (Token: ${contract.instrument_token})`);
      
      // Calculate date range (last 7 days)
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      
      // Format dates as YYYY-MM-DD
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];
      
      this.logger.info(`Fetching historical candles from ${fromDateStr} to ${toDateStr}...`);
      
      // Fetch 5-minute candles for the past week
      const candles = await this.kiteConnect.getHistoricalData(
        contract.instrument_token,
        '5minute',
        fromDateStr,
        toDateStr
      );
      
      // Convert to our Candle interface
      this.strategyState.candles = candles.map((candle: any) => ({
        timestamp: new Date(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }));
      
      // Log 5-minute volume range for validation
      if (this.strategyState.candles.length > 0) {
        const recentVolumes = this.strategyState.candles.slice(-5).map(c => c.volume);
        const avgVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;
        this.logger.debug(`📊 5m candle volumes (last 5): ${recentVolumes.join(', ')}, Avg: ${avgVolume.toFixed(0)}`);
      }
      
      this.logger.info(`Loaded ${this.strategyState.candles.length} historical 5-minute candles`);
      
    } catch (error) {
      this.trackError('historical_candles_load', error, true);
      throw error;
    }
  }

  /**
   * Calculate Daily Pivot Levels from previous trading day OHLC
   * PP = (High + Low + Close) / 3
   * R1 = (2 * PP) - Low, S1 = (2 * PP) - High
   * R2 = PP + (High - Low), S2 = PP - (High - Low)
   * R3 = High + 2 * (PP - Low), S3 = Low - 2 * (High - PP)
   */
  private calculateDailyPivots(previousDayOHLC: { high: number; low: number; close: number }): DailyPivotLevels {
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
   * Calculate daily pivots from previous trading day OHLC
   * Uses NIFTY FUTURES contract (same as strategy streaming)
   */
  private async calculateDailyPivotsFromMarketData(): Promise<void> {
    this.logger.info('📊 Calculating daily pivot levels from NIFTY futures...');
    
    try {
      // Ensure contract is initialized
      if (!this.strategyState.currentContract) {
        throw new Error('Futures contract not initialized - cannot calculate pivots');
      }
      
      const futuresToken = this.strategyState.currentContract.instrument_token;
      
      // Extend date range to ensure we get recent trading data
      const toDate = new Date();
      toDate.setDate(toDate.getDate() - 1); // Use yesterday to ensure complete data
      
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 10); // Get last 10 days
      
      this.logger.info('📅 Fetching daily pivot data', {
        contract: this.strategyState.currentContract.tradingsymbol,
        token: futuresToken,
        fromDate: fromDate.toISOString().split('T')[0],
        toDate: toDate.toISOString().split('T')[0]
      });
      
      const dailyData = await this.kiteConnect.getHistoricalData(
        futuresToken,
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
      
      this.logger.info('✅ Daily pivots calculated successfully', {
        date: previousDay.date,
        contract: this.strategyState.currentContract.tradingsymbol,
        pivots: {
          pp: this.dailyPivots.pp.toFixed(2),
          r1: this.dailyPivots.r1.toFixed(2),
          r2: this.dailyPivots.r2.toFixed(2),
          s1: this.dailyPivots.s1.toFixed(2)
        }
      });
      
      this.markStateAsDirty(); // Trigger persistence
      
    } catch (error) {
      this.logger.error('❌ Failed to calculate daily pivots:', error);
      throw error;
    }
  }

  /**
   * Initialize daily pivots with error handling
   * If pivot calculation fails, strategy continues without daily bias filter
   */
  private async initializeDailyPivots(): Promise<void> {
    try {
      await this.calculateDailyPivotsFromMarketData();
      this.logger.info('✅ Daily pivot filter enabled');
    } catch (error) {
      this.logger.warn('⚠️ Daily pivot calculation failed - continuing WITHOUT pivot filter', error);
      this.logger.warn('   Strategy will trade both directions without daily bias filtering');
      this.dailyPivots = null; // Ensure it's explicitly null
    }
  }

  /**
   * Refresh recent 5-minute candles from the last existing candle to current time
   * This ensures pivot detection sees current market data while maintaining historical context
   */
  private async refreshRecentCandles(): Promise<void> {
    try {
      const contract = this.strategyState.currentContract;
      if (!contract) {
        this.logger.warn('No contract available for candle refresh');
        return;
      }

      const existingCandles = this.strategyState.candles;
      if (existingCandles.length === 0) {
        this.logger.warn('No existing candles found - need to load historical data first');
        return;
      }

      // Get the last existing candle timestamp
      const lastCandle = existingCandles[existingCandles.length - 1];
      if (!lastCandle) {
        this.logger.warn('Cannot determine last candle timestamp');
        return;
      }

      // Fetch from the day of the last candle to current time to ensure no gaps  
      const fromDate = new Date(lastCandle.timestamp);
      fromDate.setHours(0, 0, 0, 0); // Start of the day containing the last candle
      const toDate = new Date();
      
      // Format dates as YYYY-MM-DD
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];
      
      this.logger.debug(`🔄 Refreshing 5m candles from ${fromDateStr} (last candle day) to ${toDateStr}...`);
      
      // Fetch 5-minute candles from last candle date to current time
      const recentCandles = await this.kiteConnect.getHistoricalData(
        contract.instrument_token,
        '5minute',
        fromDateStr,
        toDateStr
      );
      
      if (!recentCandles || recentCandles.length === 0) {
        this.logger.debug('No new candles found in refresh period');
        return;
      }

      // Convert to our Candle interface  
      const newCandles = recentCandles.map((candle: any) => ({
        timestamp: new Date(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }));

      // Find the last candle timestamp in our existing data for deduplication
      const currentCandles = this.strategyState.candles;
      let lastExistingTime = 0;
      if (currentCandles.length > 0) {
        const lastExistingCandle = currentCandles[currentCandles.length - 1];
        if (lastExistingCandle) {
          lastExistingTime = lastExistingCandle.timestamp.getTime();
        }
      }

      // Add only new candles (ones we don't already have)
      const candlesToAdd = newCandles.filter((candle: Candle) => candle.timestamp.getTime() > lastExistingTime);
      
      if (candlesToAdd.length > 0) {
        this.strategyState.candles.push(...candlesToAdd);
        
        // Memory optimization: Keep only latest 1000 candles (about 3.5 days of 5m data)
        const maxCandles = 1000;
        if (this.strategyState.candles.length > maxCandles) {
          this.strategyState.candles = this.strategyState.candles.slice(-maxCandles);
          this.logger.debug(`🗑️ Trimmed 5m candles to latest ${maxCandles} for memory optimization`);
        }
        
        this.logger.info(`✅ Added ${candlesToAdd.length} new 5m candles (from ${fromDateStr}). Total: ${this.strategyState.candles.length}`);
        
        // Log the latest candle for verification
        const latestCandle = this.strategyState.candles[this.strategyState.candles.length - 1];
        if (latestCandle) {
          this.logger.info(`📊 Latest 5m candle: ${latestCandle.timestamp.toLocaleString()} OHLCV: ${latestCandle.open}/${latestCandle.high}/${latestCandle.low}/${latestCandle.close}/${latestCandle.volume}`);
        }
        
        // Mark state as dirty for persistence
        this.isDirty = true;
      } else {
        this.logger.debug('📊 No new 5m candles to add (all candles up to date)');
      }
      
    } catch (error) {
      this.logger.error('❌ Error refreshing recent candles:', error);
      // Don't throw - this is non-critical, pivot detection can continue with existing data
    }
  }

  /**
   * Stop the strategy
   */
  public async stopStrategy(): Promise<void> {
    try {
      this.strategyState.isActive = false;
      
      // Stop persistence timer
      this.stopPersistenceTimer();
      
      // Save final state before stopping
      try {
        await this.saveStateImmediate();
        this.logger.info('💾 Final strategy state saved before shutdown');
      } catch (error) {
        this.logger.error('❌ Failed to save final state:', error);
      }
      
      // Stop breakout detection
      this.stopBreakoutDetection();
      
      // Stop manual price streaming
      await this.stopManualPriceStreaming();
      
      // Stop health monitoring
      this.stopHealthMonitoring();
      
      if (this.updateTimer) {
        clearTimeout(this.updateTimer);
        this.updateTimer = undefined;
      }

      this.logger.info('Nifty Breakout Retracement Strategy stopped with health monitoring cleanup');
    } catch (error) {
      this.trackError('strategy_stop', error, false);
    }
  }

  /**
   * Daily cleanup for intraday strategy
   * Called at market open to clear previous day's data (keeps logs)
   */
  public async dailyCleanup(): Promise<void> {
    this.logger.info('🧹 Starting daily cleanup for new trading day...');
    
    try {
      // Clear historical data (keep only logs)
      this.strategyState.candles = [];
      delete this.strategyState.lastProcessedCandleForBreakout;
      delete this.strategyState.latestPivotHigh;
      delete this.strategyState.latestPivotLow;
      delete this.strategyState.latestBreakoutSignal;
      delete this.strategyState.livePrice;
      delete this.strategyState.lastUpdateTime;
      this.strategyState.currentVolumeSMA50 = 0;
      this.strategyState.lastCumulativeVolume = 0;
      
      // Reset trade state to waiting for breakout
      this.strategyState.tradeState = TradeState.WAITING_FOR_BREAKOUT;
      delete this.strategyState.currentTradeId;
      delete this.strategyState.tradeSetupRequest;
      
      // Reset marking candle state
      this.strategyState.markingCandleState = {
        isActive: false,
        breakoutReference: null,
        startTime: null,
        currentMarkingCandle: null,
        searchPhase: 'initial',
        barsProcessedSinceBreakout: 0,
        maxUpdatesReached: false,
        timeExpired: false,
        tradeSkipped: false
      };
      
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
      
      // Save cleaned state
      await this.saveStateImmediate();
      
      this.logger.info('✅ Daily cleanup completed - ready for new trading day');
    } catch (error) {
      this.logger.error('❌ Error during daily cleanup:', error);
      throw error;
    }
  }

  /**
   * Check if restored state is from a previous trading day
   * Used to determine if daily cleanup is needed on startup
   */
  private isNewTradingDay(restoredState: any): boolean {
    // If no lastProcessedCandleForBreakout, treat as new day (safe default)
    if (!restoredState.lastProcessedCandleForBreakout) {
      return true;
    }
    
    const lastStateDate = new Date(restoredState.lastProcessedCandleForBreakout);
    const today = new Date();
    
    // Compare calendar dates (ignoring time)
    return lastStateDate.toDateString() !== today.toDateString();
  }

  /**
   * Start WebSocket-based real-time price streaming
   */
  public async startManualPriceStreaming(): Promise<void> {
    try {
      // Reset shutdown flag when starting
      this.isShuttingDown = false;

      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available for price streaming');
      }
      
      this.logger.info(`🚀 Starting WEBSOCKET price streaming for ${this.strategyState.currentContract.tradingsymbol}`);
      
      // Initialize WebSocket connection and subscribe to instruments
      await this.initializeWebSocket();
      
      // Mark WebSocket as active
      this.isWebSocketActive = true;
      this.strategyState.priceStreamingActive = true;
      
      // Start health monitoring (log health status every 30 seconds)
      this.healthMonitoringInterval = setInterval(() => {
        this.logWebSocketHealthStatus();
      }, 30000);
      
      this.logger.info('✅ WEBSOCKET price streaming started successfully - real-time tick data with health monitoring');

    } catch (error) {
      this.logger.error('❌ Failed to start WEBSOCKET price streaming:', error);
      this.strategyState.priceStreamingActive = false;
      this.isWebSocketActive = false;
      
      // Fallback to REST API polling if WebSocket fails
      this.logger.warn('🔄 Falling back to REST API polling as backup...');
      await this.startRestApiFallback();
    }
  }

  /**
   * Check if circuit breaker should prevent API calls
   */
  private shouldCircuitBreakerBlock(): boolean {
    if (!this.isCircuitBreakerOpen) {
      return false;
    }

    // Check if retry time has passed
    if (this.nextRetryTime && new Date() >= this.nextRetryTime) {
      this.logger.info('🔄 Circuit breaker attempting recovery - testing API availability');
      return false; // Allow one test call
    }

    return true; // Block the call
  }

  /**
   * Record polling success and update circuit breaker state
   */
  private recordPollingSuccess(): void {
    this.pollingSuccessCount++;
    this.totalPollingAttempts++;
    
    // Reset failure count on success
    if (this.pollingFailureCount > 0) {
      this.logger.info(`✅ API recovered - resetting failure count (was ${this.pollingFailureCount})`);
      this.pollingFailureCount = 0;
      this.lastPollingFailureTime = null;
    }

    // Close circuit breaker on success
    if (this.isCircuitBreakerOpen) {
      this.isCircuitBreakerOpen = false;
      this.nextRetryTime = null;
      this.logger.info('🔓 Circuit breaker CLOSED - API is healthy');
    }
  }

  /**
   * Record polling failure and update circuit breaker state
   */
  private recordPollingFailure(error: any): void {
    this.pollingFailureCount++;
    this.totalPollingAttempts++;
    this.lastPollingFailureTime = new Date();

    const failureThreshold = 5; // Open circuit after 5 consecutive failures
    const successRate = this.totalPollingAttempts > 0 ? (this.pollingSuccessCount / this.totalPollingAttempts) * 100 : 0;

    this.logger.warn(`⚠️ Polling failure #${this.pollingFailureCount} | Success rate: ${successRate.toFixed(1)}% | Error: ${error.message || error}`);

    // Open circuit breaker if threshold exceeded
    if (this.pollingFailureCount >= failureThreshold && !this.isCircuitBreakerOpen) {
      this.isCircuitBreakerOpen = true;
      // Exponential backoff: 30s, 60s, 120s, 240s (max 4 minutes)
      const backoffSeconds = Math.min(30 * Math.pow(2, Math.floor(this.pollingFailureCount / 5)), 240);
      this.nextRetryTime = new Date(Date.now() + backoffSeconds * 1000);
      
      this.logger.error(`🔒 CIRCUIT BREAKER OPEN - Too many failures (${this.pollingFailureCount}). Next retry at ${this.nextRetryTime.toLocaleTimeString()}`);
    }
  }

  /**
   * Check if we should throttle the API call to prevent rate limiting
   */
  private shouldThrottleApiCall(): boolean {
    const now = new Date();
    
    // Check concurrent call limit
    if (this.activeApiCallsCount >= this.maxConcurrentCalls) {
      return true;
    }

    // Check time-based throttling
    if (this.lastApiCallTime) {
      const timeSinceLastCall = now.getTime() - this.lastApiCallTime.getTime();
      if (timeSinceLastCall < this.minTimeBetweenCalls) {
        return true;
      }
    }

    return false;
  }

  /**
   * Fetch live price using REST API and process it as a tick
   */
  private async fetchAndProcessLivePrice(): Promise<void> {
    try {
      if (!this.strategyState.currentContract || !this.isManualStreamingActive) {
        return;
      }

      // Check circuit breaker before making API call
      if (this.shouldCircuitBreakerBlock()) {
        return; // Skip this polling cycle
      }

      // Check throttling to prevent rate limiting
      if (this.shouldThrottleApiCall()) {
        return; // Skip this polling cycle due to throttling
      }

      // Track API call timing and concurrency
      this.lastApiCallTime = new Date();
      this.activeApiCallsCount++;

      const symbol = `NFO:${this.strategyState.currentContract.tradingsymbol}`;
      
      // Fetch quote using REST API
      const quotes = await this.kiteConnect.getQuote([symbol]);
      const quote = quotes[symbol];

      if (!quote) {
        this.logger.warn(`⚠️ No quote data received for ${symbol}`);
        return;
      }

      // Convert quote to tick data format
      // Validate and normalize REST API data  
      const rawVolume = quote.volume || 0;
      const validatedVolume = Math.max(0, rawVolume); // Ensure non-negative volume

      const tickData: TickData = {
        instrument_token: quote.instrument_token,
        last_price: quote.last_price || 0,
        volume: validatedVolume,
        buy_quantity: quote.buy_quantity || 0,
        sell_quantity: quote.sell_quantity || 0,
        ohlc: {
          open: quote.ohlc?.open || 0,
          high: quote.ohlc?.high || 0,
          low: quote.ohlc?.low || 0,
          close: quote.ohlc?.close || 0
        },
        change: quote.net_change || 0,
        last_trade_time: new Date(quote.last_trade_time) || new Date(),
        exchange_timestamp: new Date(quote.timestamp) || new Date(),
        timestamp: new Date()
      };

      // Update strategy state
      this.strategyState.livePrice = tickData;
      this.strategyState.lastUpdateTime = new Date();

      // Enhanced logging for manual polling with data source identification
      this.logger.info(`💹 MANUAL POLL: ${this.strategyState.currentContract.tradingsymbol} | LTP: ₹${tickData.last_price.toFixed(2)} | Vol: ${tickData.volume.toLocaleString()} | Change: ₹${tickData.change.toFixed(2)} | Source=REST_API`);

      // Monitor trade levels based on current state
      this.monitorTradeLevels(tickData.last_price);

      // Process tick for 5-minute boundary detection
      this.processTick(tickData);

      // Update option price cache if there's an active position (non-blocking)
      this.updateOptionPriceCache().catch(err => 
        this.logger.debug('Option price cache update skipped:', err)
      );

      // Record successful API call
      this.recordPollingSuccess();

    } catch (error) {
      this.logger.error('❌ Error in fetchAndProcessLivePrice:', error);
      
      // Record failed API call and update circuit breaker
      this.recordPollingFailure(error);
    } finally {
      // Always decrement active calls count for resource management
      this.activeApiCallsCount = Math.max(0, this.activeApiCallsCount - 1);
    }
  }

  /**
   * Initialize WebSocket connection
   */
  private async initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.logger.info('🔌 Initializing WebSocket connection...');

        // Get access token from kiteConnect instance
        const accessToken = this.kiteConnect.access_token;
        const apiKey = process.env.ZERODHA_API_KEY;

        if (!accessToken || !apiKey) {
          throw new Error('Missing access token or API key for WebSocket initialization');
        }

        this.kiteTicker = new KiteTicker({
          api_key: apiKey,
          access_token: accessToken
        });

        // Connection opened
        this.websocketConnectHandler = () => {
          if (!this.kiteTicker) return; // Already disconnected
          
          this.logger.info('✅ WebSocket connected successfully');
          this.isWebSocketActive = true;
          this.webSocketReconnectAttempts = 0;
          this.recordWebSocketSuccess();
          
          // CRITICAL: Stop REST API fallback when WebSocket connects
          this.stopRestApiFallback();
          
          // Subscribe to instruments immediately after connection is established
          try {
            this.subscribeToInstrument();
          } catch (error) {
            this.logger.error('❌ Failed to subscribe after WebSocket connection:', error);
            reject(error);
            return;
          }
          
          resolve();
        };
        this.kiteTicker.on('connect', this.websocketConnectHandler);

        // Connection closed
        this.websocketDisconnectHandler = (error: any) => {
          try {
            if (!this.kiteTicker) return; // Already disconnected
            
            this.logger.warn('🔌 WebSocket disconnected');
            this.isWebSocketActive = false;
            
            // Only start fallback if not intentionally shutting down
            if (this.isShuttingDown) {
              this.logger.info('🛑 WebSocket disconnected during shutdown - skipping fallback');
              return;
            }
            
            // Start REST API fallback when WebSocket disconnects
            this.logger.warn('🔄 WebSocket disconnected, starting REST API fallback...');
            this.startRestApiFallback().catch(err => {
              this.logger.error('❌ Failed to start REST API fallback after WebSocket disconnect:', err);
            });
          } catch (handlerError) {
            this.logger.error('❌ Error in disconnect handler:', handlerError);
          }
        };
        this.kiteTicker.on('disconnect', this.websocketDisconnectHandler);

        // Connection error
        this.websocketErrorHandler = (error: any) => {
          try {
            if (!this.kiteTicker) return; // Already disconnected
            
            this.logger.error('❌ WebSocket error:', error);
            this.isWebSocketActive = false;
            
            // Only handle errors if not intentionally shutting down
            if (this.isShuttingDown) {
              this.logger.info('🛑 WebSocket error during shutdown - ignoring');
              return;
            }
            
            this.recordWebSocketFailure(error);
            
            // Start REST API fallback when WebSocket errors
            this.logger.warn('🔄 WebSocket error, starting REST API fallback...');
            this.startRestApiFallback().catch(err => {
              this.logger.error('❌ Failed to start REST API fallback after WebSocket error:', err);
            });
            
            reject(error);
          } catch (handlerError) {
            this.logger.error('❌ Error in error handler:', handlerError);
            reject(handlerError);
          }
        };
        this.kiteTicker.on('error', this.websocketErrorHandler);

        // Reconnection attempt
        this.websocketReconnectHandler = (reconnect_count: number, reconnect_interval: number) => {
          try {
            if (!this.kiteTicker) return; // Already disconnected
            
            // Guard: Don't attempt reconnection if intentionally shutting down
            if (this.isShuttingDown) {
              this.logger.info('🛑 WebSocket reconnect attempt during shutdown - ignoring');
              return;
            }
            
            this.webSocketReconnectAttempts = reconnect_count;
            this.logger.info(`🔄 WebSocket reconnecting... Attempt: ${reconnect_count}/${this.maxWebSocketReconnectAttempts}, Interval: ${reconnect_interval}ms`);
            
            if (reconnect_count >= this.maxWebSocketReconnectAttempts) {
              this.logger.error('❌ WebSocket max reconnection attempts reached, falling back to REST API');
              this.startRestApiFallback().catch(err => {
                this.logger.error('❌ Failed to start REST API fallback after max reconnection attempts:', err);
              });
            }
          } catch (handlerError) {
            this.logger.error('❌ Error in reconnect handler:', handlerError);
          }
        };
        this.kiteTicker.on('reconnect', this.websocketReconnectHandler);

        // No reconnection
        this.websocketNoreconnectHandler = () => {
          try {
            if (!this.kiteTicker) return; // Already disconnected
            
            this.isWebSocketActive = false;
            
            // Only start fallback if not intentionally shutting down
            if (this.isShuttingDown) {
              this.logger.info('🛑 WebSocket no reconnect during shutdown - skipping fallback');
              return;
            }
            
            this.logger.error('❌ WebSocket unable to reconnect after maximum attempts');
            this.startRestApiFallback().catch(err => {
              this.logger.error('Failed to start REST API fallback:', err);
            });
          } catch (handlerError) {
            this.logger.error('❌ Error in noreconnect handler:', handlerError);
          }
        };
        this.kiteTicker.on('noreconnect', this.websocketNoreconnectHandler);

        // Tick data received - this is the main event handler
        this.websocketTicksHandler = (ticks: any[]) => {
          if (!this.kiteTicker) return; // Already disconnected
          this.processWebSocketTicks(ticks);
        };
        this.kiteTicker.on('ticks', this.websocketTicksHandler);

        // Connect to WebSocket
        this.kiteTicker.connect();

      } catch (error) {
        this.logger.error('❌ Failed to initialize WebSocket:', error);
        reject(error);
      }
    });
  }



  /**
   * Subscribe to NIFTY futures instrument
   */
  private subscribeToInstrument(): void {
    if (!this.kiteTicker || !this.strategyState.currentContract) {
      throw new Error('WebSocket not initialized or no current contract available');
    }

    const instrumentToken = parseInt(this.strategyState.currentContract.instrument_token.toString());
    this.logger.info(`📡 Subscribing to NIFTY futures (Token: ${instrumentToken})...`);

    try {
      // Subscribe to the instrument - must pass numbers, not strings
      this.kiteTicker.subscribe([instrumentToken]);
      
      // Set mode to FULL for complete tick data - must pass numbers, not strings
      this.kiteTicker.setMode(this.kiteTicker.modeFull, [instrumentToken]);
      
      this.logger.info('✅ WebSocket subscription completed successfully');
    } catch (error) {
      this.logger.error('❌ WebSocket subscription failed:', error);
      throw error;
    }
  }

  /**
   * Process incoming WebSocket tick data
   */
  private processWebSocketTicks(ticks: any[]): void {
    if (!this.strategyState.currentContract) {
      this.logger.warn('⚠️ Received WebSocket ticks but no current contract available');
      return;
    }

    const instrumentToken = parseInt(this.strategyState.currentContract.instrument_token.toString());
    this.logger.debug(`📡 Received ${ticks.length} WebSocket tick(s) for token ${instrumentToken}`);
    
    ticks.forEach((tick: any) => {
      if (tick.instrument_token === instrumentToken) {
        this.logger.debug(`💹 Processing tick for ${this.strategyState.currentContract?.tradingsymbol}: LTP ₹${tick.last_price}`);
        try {
          // Convert WebSocket tick to our TickData format with validation
          // CRITICAL FIX: Use volume_traded as the primary volume field for WebSocket ticks
          const rawVolume = tick.volume_traded || tick.volume || tick.total_volume || tick.day_volume || tick.cumulative_volume || 0;
          const validatedVolume = Math.max(0, rawVolume); // Ensure non-negative volume
          
          // Log successful volume extraction less frequently to reduce noise
          if (validatedVolume > 0 && Math.random() < 0.005) { // 0.5% of ticks - much less frequent
            this.logger.info(`✅ WebSocket volume extracted: ${validatedVolume} from volume_traded field`);
          } else if (validatedVolume === 0) {
            this.logger.error(`� CRITICAL: All WebSocket volume fields are ZERO! volume_traded=${tick.volume_traded}, volume=${tick.volume}`);
          }
          
          const tickData: TickData = {
            instrument_token: tick.instrument_token,
            last_price: tick.last_price || 0,
            volume: validatedVolume,
            buy_quantity: tick.buy_quantity || 0,
            sell_quantity: tick.sell_quantity || 0,
            ohlc: {
              open: tick.ohlc?.open || 0,
              high: tick.ohlc?.high || 0,
              low: tick.ohlc?.low || 0,
              close: tick.ohlc?.close || 0
            },
            change: tick.change || 0,
            last_trade_time: new Date(tick.last_trade_time) || new Date(),
            exchange_timestamp: new Date(tick.exchange_timestamp) || new Date(),
            timestamp: new Date()
          };

          // Log data source for debugging
          this.logger.debug(`📡 WebSocket tick: Price=₹${tickData.last_price}, Volume=${tickData.volume}, Source=WebSocket`);

          // Update strategy state with latest tick
          this.strategyState.livePrice = tickData;
          this.strategyState.lastUpdateTime = new Date();

          // Monitor trade levels based on current state (CRITICAL: was missing in WebSocket processing)
          this.monitorTradeLevels(tickData.last_price);

          // Process tick for 5-minute boundary detection
          this.processTick(tickData);

          // Update option price cache if there's an active position (non-blocking)
          this.updateOptionPriceCache().catch(err => 
            this.logger.debug('Option price cache update skipped:', err)
          );

          // Record successful WebSocket data reception
          this.recordWebSocketSuccess();

        } catch (error) {
          this.logger.error('❌ Error processing WebSocket tick:', error);
          this.recordWebSocketFailure(error);
        }
      }
    });
  }

  /**
   * Update option price cache if there's an active position
   * Called from WebSocket tick handler to keep option prices fresh
   */
  private async updateOptionPriceCache(): Promise<void> {
    try {
      const activePosition = this.tradeExecutionService.getActivePosition();
      if (!activePosition) return;

      const symbol = `NFO:${activePosition.instrument.tradingsymbol}`;
      const quotes = await this.kiteConnect.getQuote([symbol]);
      const quote = quotes[symbol];

      if (quote && quote.last_price) {
        this.tradeExecutionService.updateOptionPrice(quote.last_price);
      }
    } catch (error) {
      // Silently fail - option price caching is non-critical
      this.logger.debug('Failed to update option price cache:', error);
    }
  }

  /**
   * Log WebSocket health status
   */
  private logWebSocketHealthStatus(): void {
    const now = new Date();
    const lastUpdate = this.strategyState.lastUpdateTime;
    const timeSinceLastUpdate = lastUpdate ? now.getTime() - lastUpdate.getTime() : 0;
    
    const healthStatus = {
      websocketActive: this.isWebSocketActive,
      connected: this.kiteTicker?.connected || false,
      reconnectAttempts: this.webSocketReconnectAttempts,
      lastDataReceived: lastUpdate?.toLocaleTimeString() || 'Never',
      timeSinceLastData: `${Math.floor(timeSinceLastUpdate / 1000)}s`,
      successRate: this.totalWebSocketAttempts > 0 ? 
        ((this.webSocketSuccessCount / this.totalWebSocketAttempts) * 100).toFixed(1) + '%' : 'N/A',
      circuitBreakerOpen: this.isWebSocketCircuitBreakerOpen
    };

    this.logger.info('📊 WebSocket Health Status:', healthStatus);

    // Alert if no data received for more than 60 seconds during active market hours
    // Increased threshold to avoid false alerts during low-volume periods (lunch, early morning)
    if (timeSinceLastUpdate > 60000 && this.isWebSocketActive && this.isMarketHours()) {
      // Only warn during market hours to avoid false alerts during low-volume periods
      this.logger.warn('⚠️ No WebSocket data received for over 60 seconds during market hours');
    }
  }

  /**
   * Record WebSocket success and update circuit breaker state
   */
  private recordWebSocketSuccess(): void {
    this.webSocketSuccessCount++;
    this.totalWebSocketAttempts++;
    
    // Reset failure count on success
    if (this.webSocketFailureCount > 0) {
      this.logger.debug(`✅ WebSocket recovered - resetting failure count (was ${this.webSocketFailureCount})`);
      this.webSocketFailureCount = 0;
      this.lastWebSocketFailureTime = null;
    }

    // Close circuit breaker on success
    if (this.isWebSocketCircuitBreakerOpen) {
      this.isWebSocketCircuitBreakerOpen = false;
      this.nextWebSocketRetryTime = null;
      this.logger.info('🔓 WebSocket circuit breaker CLOSED - connection is healthy');
    }
  }

  /**
   * Record WebSocket failure and update circuit breaker state
   */
  private recordWebSocketFailure(error: any): void {
    this.webSocketFailureCount++;
    this.totalWebSocketAttempts++;
    this.lastWebSocketFailureTime = new Date();

    const failureThreshold = 5; // Open circuit after 5 consecutive failures
    const successRate = this.totalWebSocketAttempts > 0 ? 
      (this.webSocketSuccessCount / this.totalWebSocketAttempts) * 100 : 0;

    this.logger.warn(`⚠️ WebSocket failure #${this.webSocketFailureCount} | Success rate: ${successRate.toFixed(1)}% | Error: ${error.message || error}`);

    // Open circuit breaker if threshold exceeded
    if (this.webSocketFailureCount >= failureThreshold && !this.isWebSocketCircuitBreakerOpen) {
      this.isWebSocketCircuitBreakerOpen = true;
      // Exponential backoff: 30s, 60s, 120s, 240s (max 4 minutes)
      const backoffSeconds = Math.min(30 * Math.pow(2, Math.floor(this.webSocketFailureCount / 5)), 240);
      this.nextWebSocketRetryTime = new Date(Date.now() + backoffSeconds * 1000);
      
      this.logger.error(`🔒 WEBSOCKET CIRCUIT BREAKER OPEN - Too many failures (${this.webSocketFailureCount}). Falling back to REST API`);
      this.startRestApiFallback();
    }
  }

  /**
   * Fallback to REST API polling when WebSocket fails
   */
  private async startRestApiFallback(): Promise<void> {
    try {
      // CRITICAL: If already running, don't start again
      if (this.pricePollingInterval && this.isManualStreamingActive) {
        this.logger.info('⏭️ REST API fallback already running, skipping duplicate start');
        return;
      }
      
      this.logger.warn('🔄 Starting REST API fallback due to WebSocket issues...');
      
      // CRITICAL: Stop any existing REST API polling first to avoid conflicts
      if (this.pricePollingInterval) {
        clearInterval(this.pricePollingInterval);
        this.pricePollingInterval = null;
      }
      
      this.isManualStreamingActive = true;
      
      // Start polling every 1.5 seconds with proper error handling (safety margin for 1 req/sec limit)
      // This should ONLY run when WebSocket is not active
      this.pricePollingInterval = setInterval(async () => {
        try {
          if (!this.isWebSocketActive) {
            await this.fetchAndProcessLivePrice();
          } else {
            // WebSocket came back online, stop REST API fallback completely
            this.logger.info('✅ WebSocket is back online, stopping REST API fallback');
            this.stopRestApiFallback();
          }
        } catch (error) {
          this.logger.error('❌ Error in REST API fallback polling:', error);
        }
      }, 1500);
      
      // Fetch first price immediately (only if WebSocket is not active)
      if (!this.isWebSocketActive) {
        await this.fetchAndProcessLivePrice();
      }
      
      this.logger.info('✅ REST API fallback started successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to start REST API fallback:', error);
      throw error;
    }
  }

  /**
   * Stop REST API fallback polling
   */
  private stopRestApiFallback(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      this.logger.info('🛑 REST API fallback polling stopped - WebSocket is active');
    }
    this.isManualStreamingActive = false;
  }

  /**
   * Stop price streaming (WebSocket and fallback REST API)
   */
  public async stopManualPriceStreaming(): Promise<void> {
    try {
      this.logger.info('🛑 Stopping price streaming...');
      
      this.strategyState.priceStreamingActive = false;
      
      // Set shutdown flag to prevent fallback handlers from firing
      this.isShuttingDown = true;
      
      // Stop WebSocket connection
      if (this.kiteTicker) {
        try {
          // CRITICAL FIX: Disable auto-reconnect to prevent reconnection attempts
          // and nullify BEFORE disconnect so handlers see null and return early
          this.kiteTicker.autoReconnect(false);
          
          // Store reference, nullify first, then disconnect
          const ticker = this.kiteTicker;
          this.kiteTicker = null; // Handlers will now see null and return early
          
          ticker.disconnect();
          this.logger.info('🔌 WebSocket disconnected cleanly');
        } catch (error) {
          this.logger.warn('⚠️ Error disconnecting WebSocket:', error);
        }
      }
      
      this.isWebSocketActive = false;
      
      // Stop REST API fallback polling if active
      this.isManualStreamingActive = false;
      if (this.pricePollingInterval) {
        clearInterval(this.pricePollingInterval);
        this.pricePollingInterval = null;
        this.logger.info('🛑 REST API fallback polling stopped');
      }

      // Stop health monitoring
      if (this.healthMonitoringInterval) {
        clearInterval(this.healthMonitoringInterval);
        this.healthMonitoringInterval = null;
      }

      // Reset resource management counters
      this.activeApiCallsCount = 0;
      this.lastApiCallTime = null;
      
      // Reset circuit breaker states
      this.pollingFailureCount = 0;
      this.lastPollingFailureTime = null;
      this.isCircuitBreakerOpen = false;
      this.nextRetryTime = null;
      
      this.webSocketFailureCount = 0;
      this.lastWebSocketFailureTime = null;
      this.isWebSocketCircuitBreakerOpen = false;
      this.nextWebSocketRetryTime = null;
      this.webSocketReconnectAttempts = 0;
      
      this.logger.info('✅ Price streaming stopped - all resources cleaned up (WebSocket + REST API fallback)');
    } catch (error) {
      this.logger.error('❌ Error stopping price streaming:', error);
    }
  }

  /**
   * Get comprehensive polling health metrics
   */
  public getPollingHealthMetrics(): {
    isHealthy: boolean;
    successRate: number;
    totalAttempts: number;
    consecutiveFailures: number;
    circuitBreakerOpen: boolean;
    activeApiCalls: number;
    lastFailureTime: Date | null;
    nextRetryTime: Date | null;
    timeSinceLastSuccess: number | null;
  } {
    const successRate = this.totalPollingAttempts > 0 ? (this.pollingSuccessCount / this.totalPollingAttempts) * 100 : 100;
    const isHealthy = successRate >= 80 && this.pollingFailureCount < 3 && !this.isCircuitBreakerOpen;
    
    const timeSinceLastSuccess = this.lastApiCallTime ? Date.now() - this.lastApiCallTime.getTime() : null;

    return {
      isHealthy,
      successRate: Math.round(successRate * 100) / 100,
      totalAttempts: this.totalPollingAttempts,
      consecutiveFailures: this.pollingFailureCount,
      circuitBreakerOpen: this.isCircuitBreakerOpen,
      activeApiCalls: this.activeApiCallsCount,
      lastFailureTime: this.lastPollingFailureTime,
      nextRetryTime: this.nextRetryTime,
      timeSinceLastSuccess
    };
  }

  /**
   * Log detailed health status (called periodically for monitoring)
   */
  public logHealthStatus(): void {
    const health = this.getPollingHealthMetrics();
    const uptime = this.isManualStreamingActive ? 'Active' : 'Inactive';
    
    if (health.isHealthy) {
      this.logger.info(`💚 POLLING HEALTH: ${uptime} | Success Rate: ${health.successRate}% | Total: ${health.totalAttempts} | Active Calls: ${health.activeApiCalls}`);
    } else {
      const issues = [];
      if (health.successRate < 80) issues.push(`Low success rate: ${health.successRate}%`);
      if (health.consecutiveFailures >= 3) issues.push(`${health.consecutiveFailures} consecutive failures`);
      if (health.circuitBreakerOpen) issues.push('Circuit breaker OPEN');
      
      this.logger.warn(`🔴 POLLING HEALTH ISSUES: ${issues.join(', ')} | Total: ${health.totalAttempts} | Next retry: ${health.nextRetryTime?.toLocaleTimeString() || 'N/A'}`);
    }
  }

  // Rest of the methods remain the same...
  /**
   * Get current strategy state
   */
  public getStrategyState(): StrategyState {
    return { ...this.strategyState };
  }

  /**
   * Get latest pivot points
   */
  public getLatestPivots(): { pivotHigh?: PivotPoint | undefined; pivotLow?: PivotPoint | undefined } {
    return {
      pivotHigh: this.strategyState.latestPivotHigh,
      pivotLow: this.strategyState.latestPivotLow
    };
  }

  /**
   * Get daily pivot levels for dashboard display
   */
  public getDailyPivots(): DailyPivotLevels | null {
    return this.dailyPivots ? { ...this.dailyPivots } : null;
  }

  /**
   * Manually trigger pivot detection (for debugging)
   */
  public async triggerManualPivotDetection(): Promise<void> {
    this.logger.info('🔄 MANUAL PIVOT DETECTION triggered');
    await this.detectPivotPoints();
  }

  /**
   * Get live price
   */
  public getLivePrice(): TickData | undefined {
    return this.strategyState.livePrice;
  }

  /**
   * Check if price streaming is active
   */
  public isPriceStreamingActive(): boolean {
    return this.strategyState.priceStreamingActive;
  }

  /**
   * Check if strategy is active
   */
  public isStrategyActive(): boolean {
    return this.strategyState.isActive;
  }

  /**
   * Get candle count
   */
  public getCandleCount(): number {
    return this.strategyState.candles.length;
  }

  /**
   * Check if market hours (simplified)
   */
  public isMarketHours(): boolean {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;
    
    // NSE futures market hours: 9:15 AM to 3:30 PM
    const marketStart = 9 * 60 + 15; // 9:15 AM
    const marketEnd = 15 * 60 + 30;  // 3:30 PM
    
    return currentTime >= marketStart && currentTime <= marketEnd;
  }

  /**
   * Check if breakout detection is active
   */
  public isBreakoutDetectionActive(): boolean {
    return this.strategyState.breakoutDetectionActive;
  }

  /**
   * Get latest breakout signal
   */
  public getLatestBreakoutSignal(): BreakoutSignal | undefined {
    return this.strategyState.latestBreakoutSignal;
  }

  /**
   * Get current volume SMA 50
   */
  public getCurrentVolumeSMA50(): number {
    return this.strategyState.currentVolumeSMA50;
  }

  /**
   * Get WebSocket health status for dashboard monitoring
   */
  public getWebSocketHealthStatus(): {
    websocketActive: boolean;
    connected: boolean;
    reconnectAttempts: number;
    lastDataReceived: string;
    timeSinceLastData: string;
    successRate: string;
    circuitBreakerOpen: boolean;
    totalAttempts: number;
    successCount: number;
  } {
    const now = new Date();
    const lastUpdate = this.strategyState.lastUpdateTime;
    const timeSinceLastUpdate = lastUpdate ? now.getTime() - lastUpdate.getTime() : 0;
    
    return {
      websocketActive: this.isWebSocketActive,
      connected: this.kiteTicker?.connected || false,
      reconnectAttempts: this.webSocketReconnectAttempts,
      lastDataReceived: lastUpdate?.toLocaleTimeString() || 'Never',
      timeSinceLastData: `${Math.floor(timeSinceLastUpdate / 1000)}s`,
      successRate: this.totalWebSocketAttempts > 0 ? 
        ((this.webSocketSuccessCount / this.totalWebSocketAttempts) * 100).toFixed(1) + '%' : 'N/A',
      circuitBreakerOpen: this.isWebSocketCircuitBreakerOpen,
      totalAttempts: this.totalWebSocketAttempts,
      successCount: this.webSocketSuccessCount
    };
  }

  /**
   * Get trade execution service instance for manual operations
   */
  public getTradeExecutionService(): TradeExecutionService {
    return this.tradeExecutionService;
  }

  /**
   * Delegation methods for UI to access selected instrument info
   * Note: selectATMOption now uses premium-based selection (1% of futures price)
   */
  public async selectATMOption(direction: 'LONG' | 'SHORT', niftyPrice: number) {
    return await this.tradeExecutionService.selectATMOption(direction, niftyPrice);
  }

  public getSelectedInstrument() {
    return this.tradeExecutionService.getSelectedInstrument();  
  }

  public async getOptionPriceByToken(instrumentToken: string): Promise<number> {
    return await this.tradeExecutionService.getOptionPriceByToken(instrumentToken);
  }

  public getInstrumentsStatus() {
    return this.tradeExecutionService.getInstrumentsStatus();
  }

  // Pivot detection constants
  private readonly LOOKBACK_PERIOD = 15; // 15,15 pivot detection as per requirements
  
  // Marking candle timing constants (5-minute candles)
  private readonly INITIAL_SEARCH_BARS = 4;    // 20 minutes (4 x 5 min bars)
  private readonly TIME_LIMIT_MINUTES = 40;    // 40 minutes (8 x 5 min bars)
  
  // Stop Loss cap for risk management (maintain minimum 1:2.5 R:R)
  private readonly SL_CAP_RATIO = 0.4;         // SL capped at 40% of target distance

  // Placeholder methods for breakout detection and candle processing
  private async startBreakoutDetection(): Promise<void> {
    this.strategyState.breakoutDetectionActive = true;
    this.logger.info('Breakout detection started');
    
    // Start pivot detection immediately with current candles
    await this.detectPivotPoints();
    
    // Set up periodic pivot detection synchronized to 5-minute candle closes
    this.scheduleNext5MinutePivotDetection();
  }

  private scheduleNext5MinutePivotDetection(): void {
    if (!this.strategyState.breakoutDetectionActive) {
      return; // Don't schedule if detection is not active
    }

    const now = new Date();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    const currentMs = now.getMilliseconds();
    
    // Calculate next 5-minute boundary (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    let nextCandleMinute: number;
    
    // If we're exactly at a 5-minute boundary and past 1 second, or past any boundary, go to NEXT boundary
    if ((currentMinutes % 5 === 0 && currentSeconds >= 1) || (currentMinutes % 5 !== 0)) {
      // We're past the current boundary, calculate the next one
      nextCandleMinute = (Math.floor(currentMinutes / 5) + 1) * 5;
    } else {
      // We're before the 1-second mark of current boundary, use current boundary
      nextCandleMinute = Math.ceil(currentMinutes / 5) * 5;
    }
    
    const nextCandleTime = new Date(now);
    
    if (nextCandleMinute >= 60) {
      // Roll over to next hour
      nextCandleTime.setHours(nextCandleTime.getHours() + 1);
      nextCandleTime.setMinutes(0);
    } else {
      nextCandleTime.setMinutes(nextCandleMinute);
    }
    
    nextCandleTime.setSeconds(1); // Run 1 second after candle closes
    nextCandleTime.setMilliseconds(0);
    
    const timeUntilNext = nextCandleTime.getTime() - now.getTime();
    
    // Ensure we never schedule for a negative time (safety check)
    if (timeUntilNext <= 0) {
      this.logger.warn(`⚠️ Timing calculation error - timeUntilNext: ${timeUntilNext}ms. Forcing 5min delay.`);
      // Force next detection to be 5 minutes from now
      const fallbackTime = new Date(now.getTime() + (5 * 60 * 1000));
      this.breakoutDetectionInterval = setTimeout(async () => {
        await this.detectPivotPoints();
        this.scheduleNext5MinutePivotDetection();
      }, 5 * 60 * 1000);
      return;
    }
    
    this.logger.info(`📅 Next 5m pivot detection scheduled for: ${nextCandleTime.toLocaleTimeString()} (in ${Math.round(timeUntilNext/1000)}s)`);
    
    this.breakoutDetectionInterval = setTimeout(async () => {
      await this.detectPivotPoints();
      // Schedule the next detection
      this.scheduleNext5MinutePivotDetection();
    }, timeUntilNext);
  }

  private stopBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
    if (this.breakoutDetectionInterval) {
      clearTimeout(this.breakoutDetectionInterval); // Changed from clearInterval to clearTimeout
      this.breakoutDetectionInterval = null;
    }
    this.logger.info('Breakout detection stopped');
  }

  /**
   * Detect pivot points from 5-minute candles using 15,15 lookback
   * Uses professional pivot point detection algorithm
   * Now refreshes recent candles before analysis to include today's data
   */
  private async detectPivotPoints(): Promise<void> {
    // First, refresh recent 5-minute candles to include any newly formed candles
    await this.refreshRecentCandles();
    
    const candles = this.strategyState.candles;
    const requiredCandles = (this.LOOKBACK_PERIOD * 2) + 1; // 31 candles minimum

    this.logger.info(`🔍 PIVOT DETECTION: Checking ${candles.length} candles (need ${requiredCandles})`);

    if (candles.length < requiredCandles) {
      this.logger.warn(`⚠️ Not enough candles for pivot detection (need ${requiredCandles}, have ${candles.length})`);
      return;
    }

    let latestPivotHigh: PivotPoint | undefined;
    let latestPivotLow: PivotPoint | undefined;
    let foundPivots = 0;

    // Start from the lookback period and go until we have enough future candles
    for (let i = this.LOOKBACK_PERIOD; i < candles.length - this.LOOKBACK_PERIOD; i++) {
      const currentCandle = candles[i];
      if (!currentCandle) continue;
      
      // Check for pivot high using 15,15 lookback
      const isPivotHigh = this.isPivotHigh(i, candles);
      if (isPivotHigh) {
        latestPivotHigh = {
          price: currentCandle.high,
          timestamp: currentCandle.timestamp,
          type: 'high'
        };
        foundPivots++;
      }

      // Check for pivot low using 15,15 lookback
      const isPivotLow = this.isPivotLow(i, candles);
      if (isPivotLow) {
        latestPivotLow = {
          price: currentCandle.low,
          timestamp: currentCandle.timestamp,
          type: 'low'
        };
        foundPivots++;
      }
    }

    // Update strategy state with the latest confirmed pivots
    if (latestPivotHigh) {
      // Only update if this is a new pivot or higher than the previous one
      if (!this.strategyState.latestPivotHigh || 
          latestPivotHigh.timestamp > this.strategyState.latestPivotHigh.timestamp ||
          latestPivotHigh.price > this.strategyState.latestPivotHigh.price) {
        this.strategyState.latestPivotHigh = latestPivotHigh;
        this.logger.info(`🔺 NEW PIVOT HIGH (15,15): ₹${latestPivotHigh.price.toFixed(2)} at ${latestPivotHigh.timestamp.toLocaleString()}`);
        
        // Mark state as dirty for pivot detection persistence
        this.markStateAsDirty();
      }
    }
    
    if (latestPivotLow) {
      // Only update if this is a new pivot or lower than the previous one
      if (!this.strategyState.latestPivotLow || 
          latestPivotLow.timestamp > this.strategyState.latestPivotLow.timestamp ||
          latestPivotLow.price < this.strategyState.latestPivotLow.price) {
        this.strategyState.latestPivotLow = latestPivotLow;
        this.logger.info(`🔻 NEW PIVOT LOW (15,15): ₹${latestPivotLow.price.toFixed(2)} at ${latestPivotLow.timestamp.toLocaleString()}`);
        
        // Mark state as dirty for pivot detection persistence
        this.markStateAsDirty();
      }
    }

    if (foundPivots === 0) {
      this.logger.warn(`⚠️ NO PIVOTS FOUND in ${candles.length} candles using 15,15 lookback. Market might be in strong trend.`);
      
      // Log some sample candle data for debugging
      const recent = candles.slice(-10);
      this.logger.info(`📊 Recent 10 candles: High range ${Math.min(...recent.map(c => c.high)).toFixed(2)} - ${Math.max(...recent.map(c => c.high)).toFixed(2)}`);
      this.logger.info(`📊 Recent 10 candles: Low range ${Math.min(...recent.map(c => c.low)).toFixed(2)} - ${Math.max(...recent.map(c => c.low)).toFixed(2)}`);
    } else {
      this.logger.info(`✅ Pivot analysis complete (15,15) - found ${foundPivots} pivot(s)`);
      this.logCurrentPivots();
    }
  }

  /**
   * Check if the candle at index i is a pivot high using 15,15 lookback
   */
  private isPivotHigh(index: number, candles: Candle[]): boolean {
    const currentCandle = candles[index];
    if (!currentCandle) return false;
    
    const currentHigh = currentCandle.high;

    // Check 15 candles before
    for (let j = index - this.LOOKBACK_PERIOD; j < index; j++) {
      const candle = candles[j];
      if (!candle || candle.high >= currentHigh) {
        return false;
      }
    }

    // Check 15 candles after
    for (let j = index + 1; j <= index + this.LOOKBACK_PERIOD; j++) {
      const candle = candles[j];
      if (!candle || candle.high >= currentHigh) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if the candle at index i is a pivot low using 15,15 lookback
   */
  private isPivotLow(index: number, candles: Candle[]): boolean {
    const currentCandle = candles[index];
    if (!currentCandle) return false;
    
    const currentLow = currentCandle.low;

    // Check 15 candles before
    for (let j = index - this.LOOKBACK_PERIOD; j < index; j++) {
      const candle = candles[j];
      if (!candle || candle.low <= currentLow) {
        return false;
      }
    }

    // Check 15 candles after
    for (let j = index + 1; j <= index + this.LOOKBACK_PERIOD; j++) {
      const candle = candles[j];
      if (!candle || candle.low <= currentLow) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log current pivot points
   */
  private logCurrentPivots(): void {
    const { latestPivotHigh, latestPivotLow } = this.strategyState;

    this.logger.info('=== CURRENT PIVOT POINTS (15,15) ===');
    
    if (latestPivotHigh) {
      this.logger.info(`📈 Latest Pivot HIGH: ₹${latestPivotHigh.price.toFixed(2)} at ${latestPivotHigh.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📈 No pivot high found yet');
    }

    if (latestPivotLow) {
      this.logger.info(`� Latest Pivot LOW: ₹${latestPivotLow.price.toFixed(2)} at ${latestPivotLow.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📉 No pivot low found yet');
    }

    this.logger.info('============================');
  }

  /**
   * Process ticks to detect 5-minute boundaries and trigger candle processing
   * Uses API-provided 5-minute candles for breakout detection
   */
  private processTick(tick: TickData): void {
    // Check if we're at a 5-minute boundary (X:X0 or X:X5)
    const now = new Date(tick.last_trade_time || tick.exchange_timestamp || tick.timestamp || new Date());
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();

    // Update cumulative volume tracking for API candles
    const cumulativeVolume = tick.volume || 0;
    this.strategyState.lastCumulativeVolume = cumulativeVolume;

    // Check if current minute is 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, or 55
    // AND wait 5 seconds after boundary for API to make candle available
    // AND not already processing to prevent concurrent calls
    if (currentMinute % 5 === 0 && currentSecond >= 5 && !this.isProcessingFiveMinute) {
      // Check if we already processed this 5-minute boundary
      const lastProcessed = this.lastProcessedFiveMinuteTime;
      const currentFiveMinBoundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), currentMinute, 0, 0).getTime();

      if (!lastProcessed || currentFiveMinBoundary > lastProcessed) {
        // New 5-minute candle available - process it!
        this.isProcessingFiveMinute = true;
        this.processFiveMinuteCandle()
          .then(() => {
            // Only mark as processed if successful
            this.lastProcessedFiveMinuteTime = currentFiveMinBoundary;
            this.strategyState.lastFiveMinuteBoundary = new Date(currentFiveMinBoundary);
            this.markStateAsDirty();
            this.logger.info(`✅ Successfully processed 5-minute boundary: ${new Date(currentFiveMinBoundary).toLocaleTimeString()}`);
          })
          .catch((error) => {
            this.logger.error(`❌ Failed to process 5-minute candle at ${new Date(currentFiveMinBoundary).toLocaleTimeString()}:`, error);
            // Don't update lastProcessedFiveMinuteTime - will retry on next tick
          })
          .finally(() => {
            this.isProcessingFiveMinute = false;
          });
      }
    }
  }

  /**
   * Process 5-minute candle for breakout and marking candle detection
   * Called when a new 5-minute boundary is detected
   */
  private async processFiveMinuteCandle(): Promise<void> {
    try {
      this.logger.info('📊 Processing 5-minute candle cycle...');

      // 1. Refresh 5-minute candles from Zerodha API
      await this.refreshRecentCandles();

      // 2. Filter candles to only NEW ones (after lastProcessedCandleForBreakout)
      // This prevents replaying historical candles through breakout logic on restart
      const lastProcessedForBreakout = this.strategyState.lastProcessedCandleForBreakout;
      
      const newCandlesForAnalysis = this.strategyState.candles.filter(candle => {
        if (!lastProcessedForBreakout) return true; // First run - process all
        return candle.timestamp.getTime() > lastProcessedForBreakout.getTime();
      });

      if (newCandlesForAnalysis.length === 0) {
        this.logger.debug('📊 No new 5m candles to analyze for breakout (all already processed)');
        return;
      }

      this.logger.info(`📈 Analyzing ${newCandlesForAnalysis.length} NEW candle(s) for breakout (not replaying historical)`);

      // 3. Process each new candle in chronological order
      for (const candle of newCandlesForAnalysis) {
        this.logger.info(`📊 Processing 5m candle: ${candle.timestamp.toLocaleTimeString()} - O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`);

        // Update volume SMA50 (from 5-minute candles)
        this.updateVolumeSMA50();

        // Check for breakout (only on NEW candles)
        this.checkForBreakout(candle);

        // Process marking candle
        this.processMarkingCandle(candle);

        // Mark this candle as processed for breakout detection
        this.strategyState.lastProcessedCandleForBreakout = candle.timestamp;
        this.markStateAsDirty();
      }

    } catch (error) {
      this.logger.error('❌ Error processing 5-minute candle:', error);
      throw error; // Re-throw so .catch() in caller knows it failed
    }
  }

  /**
   * Start persistence timer for auto-save
   */
  private startPersistenceTimer(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
    
    this.persistenceTimer = setInterval(async () => {
      if (this.isDirty) {
        await this.saveStateIfDirty();
      }
    }, this.PERSISTENCE_INTERVAL);
    
    this.logger.debug('⏰ Strategy state persistence timer started');
  }

  /**
   * Stop persistence timer
   */
  private stopPersistenceTimer(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
      this.logger.debug('⏹️ Strategy state persistence timer stopped');
    }
  }

  /**
   * Mark strategy state as dirty (needs saving)
   */
  private markStateAsDirty(): void {
    this.isDirty = true;
  }

  /**
   * Save strategy state if marked as dirty
   */
  private async saveStateIfDirty(): Promise<void> {
    if (!this.isDirty) return;
    
    try {
      await this.saveStateAtomic();
      this.isDirty = false;
    } catch (error) {
      this.logger.error('❌ Failed to save strategy state:', error);
      // Keep isDirty = true to retry later
    }
  }

  /**
   * Save strategy state atomically using state lock
   */
  private async saveStateAtomic(): Promise<void> {
    return await globalStateLock.executeAtomic('strategy-persistence', async () => {
      const persistableState = this.strategyPersistence.convertStrategyStateToPersistedFormat(this.strategyState);
      await this.strategyPersistence.saveStrategyState(persistableState);
    });
  }

  /**
   * Force immediate save of strategy state
   */
  private async saveStateImmediate(): Promise<void> {
    try {
      await this.saveStateAtomic();
      this.isDirty = false;
      this.logger.debug('💾 Strategy state saved immediately');
    } catch (error) {
      this.logger.error('❌ Failed to save strategy state immediately:', error);
      throw error;
    }
  }

  /**
   * Validate and restore strategy state from persistence
   */
  private async validateAndRestoreState(restoredState: PersistedStrategyState): Promise<boolean> {
    try {
      // Additional validation beyond basic integrity checks
      if (!restoredState.currentContract) {
        this.logger.warn('⚠️ No contract found in restored state');
        return false;
      }
      
      // Check if contract is still valid (not expired)
      if (restoredState.currentContract.expiry < new Date()) {
        this.logger.warn('⚠️ Restored contract has expired, starting fresh');
        return false;
      }
      
      // Restore the strategy state
      this.strategyState.isActive = restoredState.isActive;
      this.strategyState.currentContract = restoredState.currentContract;
      // Don't restore livePrice and lastUpdateTime - will be updated by price streaming
      this.strategyState.priceStreamingActive = false; // Will be started separately
      this.strategyState.breakoutDetectionActive = false; // Will be started separately
      this.strategyState.tradeState = restoredState.tradeState;
      if (restoredState.currentTradeId) {
        this.strategyState.currentTradeId = restoredState.currentTradeId;
      }
      if (restoredState.tradeSetupRequest) {
        this.strategyState.tradeSetupRequest = restoredState.tradeSetupRequest;
      }
      this.strategyState.candles = restoredState.candles;
      this.strategyState.latestPivotHigh = restoredState.latestPivotHigh;
      this.strategyState.latestPivotLow = restoredState.latestPivotLow;
      this.strategyState.latestBreakoutSignal = restoredState.latestBreakoutSignal;
      this.strategyState.markingCandleState = restoredState.markingCandleState;
      this.strategyState.currentVolumeSMA50 = restoredState.currentVolumeSMA50;
      this.strategyState.lastCumulativeVolume = restoredState.lastCumulativeVolume;
      
      // Mark ALL restored candles as already processed for breakout detection
      // This prevents replaying historical candles through breakout logic on restart
      if (restoredState.lastProcessedCandleForBreakout) {
        // Defensive conversion: ensure it's a Date object (in case persistence layer didn't convert)
        const processedDate = restoredState.lastProcessedCandleForBreakout instanceof Date 
          ? restoredState.lastProcessedCandleForBreakout 
          : new Date(restoredState.lastProcessedCandleForBreakout);
        this.strategyState.lastProcessedCandleForBreakout = processedDate;
        this.logger.info(`✅ Historical candles marked as processed up to: ${processedDate.toISOString()}`);
      } else if (this.strategyState.candles.length > 0) {
        // Fallback: If no flag in saved state (old format), use last candle timestamp
        const lastCandle = this.strategyState.candles[this.strategyState.candles.length - 1];
        if (lastCandle) {
          this.strategyState.lastProcessedCandleForBreakout = lastCandle.timestamp;
          this.logger.info(`✅ Historical candles marked as processed up to last candle: ${lastCandle.timestamp.toLocaleString()}`);
        }
      }
      
      // Restore 5-minute boundary tracking separately
      if (restoredState.lastFiveMinuteBoundary) {
        const boundaryDate = new Date(restoredState.lastFiveMinuteBoundary);
        this.lastProcessedFiveMinuteTime = boundaryDate.getTime();
        this.strategyState.lastFiveMinuteBoundary = boundaryDate;
      }
      
      this.logger.info(`📊 Restored strategy state: ${restoredState.candles.length} 5m candles (no replay), Volume SMA50: ${restoredState.currentVolumeSMA50.toFixed(2)}`);
      
      return true;
      
    } catch (error) {
      this.logger.error('❌ Failed to restore strategy state:', error);
      return false;
    }
  }

  /**
   * CRITICAL FIX: Cross-validate strategy state with TradeExecutionService
   * Cleans up orphaned strategy state when trades are closed externally
   * Prevents phantom trade detection on restart
   */
  private async validateTradeStateSync(): Promise<void> {
    this.logger.info(`🔍 Starting trade state validation sync check...`);
    
    try {
      // Check if strategy thinks it has an active trade
      if (this.strategyState.currentTradeId) {
        this.logger.info(`🔍 Validating trade state sync - Trade ID: ${this.strategyState.currentTradeId}`);
        
        // Check if TradeExecutionService has corresponding active position
        const activePosition = this.tradeExecutionService.getActivePosition();
        
        if (!activePosition || activePosition.tradeId !== this.strategyState.currentTradeId) {
          // MISMATCH DETECTED: Strategy has trade ID but no corresponding active position
          this.logger.warn(`🧹 CLEANING ORPHANED STRATEGY STATE`);
          this.logger.warn(`   Strategy Trade ID: ${this.strategyState.currentTradeId}`);
          this.logger.warn(`   Execution Service: ${activePosition ? `Different ID: ${activePosition.tradeId}` : 'No active position'}`);
          this.logger.warn(`   Cause: Trade was likely closed externally (manual closure, system restart, etc.)`);
          
          // Clean up orphaned strategy state
          const orphanedTradeId = this.strategyState.currentTradeId;
          delete this.strategyState.currentTradeId;
          delete this.strategyState.tradeSetupRequest;
          
          // Clear stale breakout signal that caused phantom trade detection
          if (this.strategyState.latestBreakoutSignal) {
            this.logger.info(`🧹 Clearing stale breakout signal: ${this.strategyState.latestBreakoutSignal.type} @ ₹${this.strategyState.latestBreakoutSignal.price}`);
            this.strategyState.latestBreakoutSignal = undefined;
          }
          
          // Reset state to clean waiting state
          this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Cleaned orphaned trade state: ${orphanedTradeId}`);
          
          this.logger.info(`✅ Strategy state cleaned - Ready for fresh breakout detection`);
        } else {
          this.logger.info(`✅ Trade state validation passed - Active position confirmed`);
        }
      } else {
        // REVERSE CASE: Strategy has no trade ID, but check if TradeExecutionService has an active position
        const activePosition = this.tradeExecutionService.getActivePosition();
        
        if (activePosition) {
          // CRITICAL BUG FIX: Service has active position but strategy doesn't know about it
          this.logger.warn(`🚨 CRITICAL: TradeExecutionService has active position but strategy state is missing!`);
          this.logger.warn(`   Active Position ID: ${activePosition.tradeId}`);
          this.logger.warn(`   Direction: ${activePosition.direction}`);
          this.logger.warn(`   Entry: ₹${activePosition.entryPrice} | SL: ₹${activePosition.stopLoss} | Target: ₹${activePosition.target}`);
          this.logger.warn(`   Cause: Strategy state corruption or restart without proper state restoration`);
          
          // RESTORE STRATEGY STATE to match active position
          this.strategyState.currentTradeId = activePosition.tradeId;
          
          // Calculate trailing trigger from active position data
          const targetDistance = Math.abs(activePosition.target - activePosition.entryPrice);
          const trailingTriggerDistance = targetDistance * 0.60;
          const trailingTriggerLevel = activePosition.direction === 'LONG'
            ? activePosition.entryPrice + trailingTriggerDistance
            : activePosition.entryPrice - trailingTriggerDistance;
          
          // Reconstruct trade setup request from active position
          this.strategyState.tradeSetupRequest = {
            strategyId: 'breakout-pullback',
            direction: activePosition.direction,
            entryLevel: activePosition.entryPrice, // Use actual entry price from executed trade
            stopLossLevel: activePosition.stopLoss,
            targetLevel: activePosition.target,
            underlyingPrice: (activePosition.instrument as any).underlyingPrice || 0,
            timestamp: activePosition.entryTime,
            originalStopLossLevel: activePosition.originalStopLoss || activePosition.stopLoss,
            trailingTriggerLevel: trailingTriggerLevel
          };
          
          // Transition to IN_TRADE state to enable price monitoring
          this.transitionToState(TradeState.IN_TRADE, `Restored active trade: ${activePosition.tradeId}`);
          
          this.logger.info(`✅ STRATEGY STATE RESTORED - Now monitoring SL/Target levels`);
          this.logger.info(`   🎯 Monitoring Target: ₹${activePosition.target} (${activePosition.direction})`);
          this.logger.info(`   🛑 Monitoring Stop Loss: ₹${activePosition.stopLoss} (${activePosition.direction})`);
          
        } else {
          // No active trade ID and no active position - check for stale breakout signals
          if (this.strategyState.latestBreakoutSignal) {
            this.logger.info(`🧹 Found stale breakout signal without active trade - clearing to prevent phantom detection`);
            this.logger.info(`   Signal: ${this.strategyState.latestBreakoutSignal.type} @ ₹${this.strategyState.latestBreakoutSignal.price} from ${new Date(this.strategyState.latestBreakoutSignal.timestamp).toLocaleString()}`);
            this.strategyState.latestBreakoutSignal = undefined;
            this.markStateAsDirty();
            this.logger.info(`✅ Stale breakout signal cleared - Ready for fresh detection`);
          }
          
          // Check for stale marking candle state
          if (this.strategyState.markingCandleState.isActive) {
            this.logger.info(`🧹 Found stale marking candle state without active trade - clearing to prevent phantom detection`);
            this.logger.info(`   Marking candle was active with breakout: ${this.strategyState.markingCandleState.breakoutReference?.type}`);
            this.strategyState.markingCandleState.isActive = false;
            this.strategyState.markingCandleState.breakoutReference = null;
            this.strategyState.markingCandleState.currentMarkingCandle = null;
            this.strategyState.markingCandleState.startTime = null;
            this.strategyState.markingCandleState.searchPhase = 'initial';
            this.strategyState.markingCandleState.barsProcessedSinceBreakout = 0;
            this.markStateAsDirty();
            this.logger.info(`✅ Stale marking candle state cleared`);
          }
          
          if (!this.strategyState.latestBreakoutSignal && !this.strategyState.markingCandleState.isActive) {
            this.logger.info(`✅ Trade state validation passed - No active trade ID found, state is clean`);
          }
        }
      }
    } catch (error) {
      this.logger.error('❌ Error during trade state validation:', error);
      // On error, clear potentially corrupted state to be safe
      delete this.strategyState.currentTradeId;
      delete this.strategyState.tradeSetupRequest;
      this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, 'Error recovery - state cleared');
    }
  }

  /**
   * Validate historical volume data integrity
   * Checks for potential cumulative volume issues or data anomalies
   */
  private validateHistoricalVolumeData(historicalCandles: Candle[]): void {
    if (historicalCandles.length < 2) return;
    
    let cumulativeVolumeDetected = 0;
    let normalVolumeCount = 0;
    
    for (let i = 1; i < Math.min(10, historicalCandles.length); i++) {
      const prevCandle = historicalCandles[i - 1];
      const currCandle = historicalCandles[i];
      
      if (!prevCandle || !currCandle) continue;
      
      const prevVolume = prevCandle.volume;
      const currVolume = currCandle.volume;
      
      // Check if volume is increasing continuously (potential cumulative data)
      if (currVolume > prevVolume && currVolume > prevVolume * 2) {
        cumulativeVolumeDetected++;
      } else if (currVolume > 0 && currVolume < prevVolume * 10) {
        normalVolumeCount++;
      }
    }
    
    if (cumulativeVolumeDetected > normalVolumeCount) {
      this.logger.warn(`⚠️ Historical volume data may be cumulative! Cumulative pattern: ${cumulativeVolumeDetected}, Normal pattern: ${normalVolumeCount}`);
    } else {
      this.logger.debug(`✅ Historical volume data appears to be per-candle (non-cumulative). Pattern check: ${normalVolumeCount} normal vs ${cumulativeVolumeDetected} cumulative`);
    }
    
    // Log volume range for sanity check
    const volumes = historicalCandles.slice(0, 10).map(c => c.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const maxVolume = Math.max(...volumes);
    const minVolume = Math.min(...volumes);
    
    this.logger.debug(`📊 Historical volume analysis: Min=${minVolume}, Max=${maxVolume}, Avg=${avgVolume.toFixed(0)}`);
  }

  /**
   * Update 50-period Simple Moving Average of 5-minute candle volumes
   * Always uses exactly the last 50 candles (or all available if less than 50)
   */
  private updateVolumeSMA50(): void {
    const candles = this.strategyState.candles; // 5-minute candles
    
    if (candles.length === 0) {
      this.strategyState.currentVolumeSMA50 = 0;
      return;
    }
    
    // Use all available candles (up to 50 max)
    const period = Math.min(50, candles.length);
    const recentCandles = candles.slice(-period);
    
    // Calculate simple moving average of volumes
    const totalVolume = recentCandles.reduce((sum, candle) => sum + candle.volume, 0);
    this.strategyState.currentVolumeSMA50 = totalVolume / period;
    
    this.logger.debug(`📊 Volume SMA50 updated: ${this.strategyState.currentVolumeSMA50.toFixed(0)} (based on ${period} x 5m candles = ${(period * 5)} minutes, total array size: ${candles.length})`);
  }

  /**
   * Check completed 5-minute candle for breakout signals
   */
  private checkForBreakout(completedCandle: Candle): void {
    try {
      // Enhanced logging for comprehensive breakout analysis
      this.logger.info(`🔍 BREAKOUT DETECTION ANALYSIS:`);
      this.logger.info(`   📊 Candle: O:${completedCandle.open.toFixed(2)} H:${completedCandle.high.toFixed(2)} L:${completedCandle.low.toFixed(2)} C:${completedCandle.close.toFixed(2)} V:${completedCandle.volume}`);
      this.logger.info(`   ⏰ Time: ${completedCandle.timestamp.toLocaleString()}`);
      this.logger.info(`   🎯 Market Hours: ${this.isMarketHours()}`);
      this.logger.info(`   📈 Trade State: ${this.strategyState.tradeState}`);
      this.logger.info(`   📊 5m Candles: ${this.strategyState.candles.length}`);
      this.logger.info(`   📊 Volume SMA50: ${this.strategyState.currentVolumeSMA50.toFixed(0)}`);
      this.logger.info(`   🎯 Pivot High: ${this.strategyState.latestPivotHigh?.price.toFixed(2) || 'N/A'}`);
      this.logger.info(`   🎯 Pivot Low: ${this.strategyState.latestPivotLow?.price.toFixed(2) || 'N/A'}`);

      // Skip breakout detection if not in WAITING_FOR_BREAKOUT state
      if (this.strategyState.tradeState !== TradeState.WAITING_FOR_BREAKOUT) {
        this.logger.info(`🔒 BREAKOUT SKIPPED - Current state: ${this.strategyState.tradeState} (need: WAITING_FOR_BREAKOUT)`);
        return;
      }

      // Skip if we don't have pivots or sufficient volume data
      if (!this.strategyState.latestPivotHigh && !this.strategyState.latestPivotLow) {
        this.logger.info('⛔ BREAKOUT SKIPPED - No pivots available for breakout detection');
        return;
      }
      
      if (this.strategyState.candles.length < 50) {
        this.logger.info(`⛔ BREAKOUT SKIPPED - Insufficient 5m candles for volume SMA50 (${this.strategyState.candles.length}/50)`);
        return;
      }
      
      if (this.strategyState.currentVolumeSMA50 <= 0) {
        this.logger.info('⛔ BREAKOUT SKIPPED - Volume SMA50 not available or zero');
        return;
      }
      
      const volumeRatio = completedCandle.volume / this.strategyState.currentVolumeSMA50;
      
      this.logger.info(`✅ BREAKOUT CONDITIONS MET - Analyzing candle: V:${completedCandle.volume} (${volumeRatio.toFixed(2)}x SMA50)`);
      
      // Add market hours validation for breakout detection
      if (!this.isMarketHours()) {
        this.logger.info('🔒 BREAKOUT SKIPPED - Outside market hours (9:15 AM - 3:30 PM). Post-market data ignored.');
        return;
      }
      
      // Check for LONG breakout (above pivot high)
      if (this.strategyState.latestPivotHigh) {
        const pivotHigh = this.strategyState.latestPivotHigh.price;
        
        // Enhanced logging for breakout analysis
        if (completedCandle.close > pivotHigh || completedCandle.high > pivotHigh) {
          this.logger.info(`🔍 POTENTIAL LONG BREAKOUT ANALYSIS:`);
          this.logger.info(`   📊 Candle: O:${completedCandle.open.toFixed(2)} H:${completedCandle.high.toFixed(2)} L:${completedCandle.low.toFixed(2)} C:${completedCandle.close.toFixed(2)}`);
          this.logger.info(`   🎯 Pivot High: ${pivotHigh.toFixed(2)}`);
          this.logger.info(`   ✅ Close > Pivot: ${completedCandle.close > pivotHigh}`);
          this.logger.info(`   ✅ Low < Pivot: ${completedCandle.low < pivotHigh} (avoids gap-ups)`);
          this.logger.info(`   ✅ Candle Direction: ${completedCandle.close > completedCandle.open ? 'BULLISH (Green)' : 'BEARISH (Red)'}`);
          this.logger.info(`   ✅ Volume > SMA50: ${completedCandle.volume > this.strategyState.currentVolumeSMA50} (${completedCandle.volume} vs ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
        }
        
        if (completedCandle.close > pivotHigh && 
            completedCandle.low < pivotHigh && 
            completedCandle.close > completedCandle.open && 
            completedCandle.volume > this.strategyState.currentVolumeSMA50) {
          
          // Daily Pivot Filter: LONG trades only if price > R1
          if (this.dailyPivots && completedCandle.close <= this.dailyPivots.r1) {
            this.logger.info(`🚫 LONG BREAKOUT REJECTED - Daily pivot filter: Price ₹${completedCandle.close.toFixed(2)} ≤ R1 ₹${this.dailyPivots.r1.toFixed(2)}`);
            return;
          }
          
          if (this.dailyPivots) {
            this.logger.info(`✅ LONG BREAKOUT APPROVED - Daily pivot filter: Price ₹${completedCandle.close.toFixed(2)} > R1 ₹${this.dailyPivots.r1.toFixed(2)}`);
          } else {
            this.logger.info(`⚠️ LONG BREAKOUT APPROVED - Daily pivots not available, filter bypassed`);
          }
          
          const breakoutSignal: BreakoutSignal = {
            type: 'long_breakout',
            price: completedCandle.close,
            timestamp: completedCandle.timestamp,
            volume: completedCandle.volume,
            volumeMA50: this.strategyState.currentVolumeSMA50,
            pivotPrice: pivotHigh,
            pivotType: 'high',
            candleOpen: completedCandle.open,
            candleClose: completedCandle.close,
            candleHigh: completedCandle.high,
            candleLow: completedCandle.low,
            volumeRatio: volumeRatio
          };
          
          this.strategyState.latestBreakoutSignal = breakoutSignal;
          
          // Mark state as dirty for breakout signal persistence
          this.markStateAsDirty();
          
          this.logger.info(`🚀 LONG BREAKOUT DETECTED!`);
          this.logger.info(`   📈 Breakout Price: ₹${completedCandle.close.toFixed(2)} (Open: ₹${completedCandle.open.toFixed(2)})`);
          this.logger.info(`   🎯 Pivot High: ₹${pivotHigh.toFixed(2)}`);
          this.logger.info(`   📊 Volume: ${completedCandle.volume.toLocaleString()} (${volumeRatio.toFixed(2)}x SMA50: ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
          this.logger.info(`   ⏰ Time: ${completedCandle.timestamp.toLocaleString()}`);
          
          // Transition to WAITING_FOR_ENTRY state
          this.transitionToState(TradeState.WAITING_FOR_ENTRY, 'LONG breakout detected');
          
          // Start marking candle tracking for this breakout
          this.startMarkingCandleTracking(breakoutSignal);
          
          return; // Don't check for short breakout if we found long breakout
        }
      }
      
      // Check for SHORT breakout (below pivot low)
      if (this.strategyState.latestPivotLow) {
        const pivotLow = this.strategyState.latestPivotLow.price;
        
        // Enhanced logging for breakout analysis
        if (completedCandle.close < pivotLow || completedCandle.low < pivotLow) {
          this.logger.info(`🔍 POTENTIAL SHORT BREAKOUT ANALYSIS:`);
          this.logger.info(`   📊 Candle: O:${completedCandle.open.toFixed(2)} H:${completedCandle.high.toFixed(2)} L:${completedCandle.low.toFixed(2)} C:${completedCandle.close.toFixed(2)}`);
          this.logger.info(`   🎯 Pivot Low: ${pivotLow.toFixed(2)}`);
          this.logger.info(`   ✅ Close < Pivot: ${completedCandle.close < pivotLow}`);
          this.logger.info(`   ✅ High > Pivot: ${completedCandle.high > pivotLow} (avoids gap-downs)`);
          this.logger.info(`   ✅ Candle Direction: ${completedCandle.close < completedCandle.open ? 'BEARISH (Red)' : 'BULLISH (Green)'}`);
          this.logger.info(`   ✅ Volume > SMA50: ${completedCandle.volume > this.strategyState.currentVolumeSMA50} (${completedCandle.volume} vs ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
        }
        
        if (completedCandle.close < pivotLow && 
            completedCandle.high > pivotLow && 
            completedCandle.close < completedCandle.open && 
            completedCandle.volume > this.strategyState.currentVolumeSMA50) {
          
          // Daily Pivot Filter: SHORT trades only if price < R1
          if (this.dailyPivots && completedCandle.close >= this.dailyPivots.r1) {
            this.logger.info(`🚫 SHORT BREAKOUT REJECTED - Daily pivot filter: Price ₹${completedCandle.close.toFixed(2)} ≥ R1 ₹${this.dailyPivots.r1.toFixed(2)}`);
            return;
          }
          
          if (this.dailyPivots) {
            this.logger.info(`✅ SHORT BREAKOUT APPROVED - Daily pivot filter: Price ₹${completedCandle.close.toFixed(2)} < R1 ₹${this.dailyPivots.r1.toFixed(2)}`);
          } else {
            this.logger.info(`⚠️ SHORT BREAKOUT APPROVED - Daily pivots not available, filter bypassed`);
          }
          
          const breakoutSignal: BreakoutSignal = {
            type: 'short_breakout',
            price: completedCandle.close,
            timestamp: completedCandle.timestamp,
            volume: completedCandle.volume,
            volumeMA50: this.strategyState.currentVolumeSMA50,
            pivotPrice: pivotLow,
            pivotType: 'low',
            candleOpen: completedCandle.open,
            candleClose: completedCandle.close,
            candleHigh: completedCandle.high,
            candleLow: completedCandle.low,
            volumeRatio: volumeRatio
          };
          
          this.strategyState.latestBreakoutSignal = breakoutSignal;
          
          // Mark state as dirty for breakout signal persistence
          this.markStateAsDirty();
          
          this.logger.info(`🚀 SHORT BREAKOUT DETECTED!`);
          this.logger.info(`   📉 Breakout Price: ₹${completedCandle.close.toFixed(2)} (Open: ₹${completedCandle.open.toFixed(2)})`);
          this.logger.info(`   🎯 Pivot Low: ₹${pivotLow.toFixed(2)}`);
          this.logger.info(`   📊 Volume: ${completedCandle.volume.toLocaleString()} (${volumeRatio.toFixed(2)}x SMA50: ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
          this.logger.info(`   ⏰ Time: ${completedCandle.timestamp.toLocaleString()}`);
          
          // Transition to WAITING_FOR_ENTRY state
          this.transitionToState(TradeState.WAITING_FOR_ENTRY, 'SHORT breakout detected');
          
          // Start marking candle tracking for this breakout
          this.startMarkingCandleTracking(breakoutSignal);
        }
      }
      
    } catch (error) {
      this.logger.error('❌ Error in breakout detection:', error);
    }
  }

  // ================================================================================
  // MARKING CANDLE MODULE - Entry & Stop Loss Level Management
  // ================================================================================
  // This module handles the marking candle detection and management system
  // which provides precise entry and stop-loss levels after a breakout is detected.
  //
  // Two-Phase System:
  // Phase 1 (Initial): Detects opposite-direction marking candles within 10 bars after breakout
  // Phase 2 (Updates): Updates entry/SL levels dynamically when SL extends by ≥1 point  
  //                   - Enforces 20-minute total time limit and maximum 1 update per breakout
  //                   - Trade abandoned if no marking candle found in first 10 bars
  // - Provides real-time entry and stop-loss levels for trade execution
  // ================================================================================

  /**
   * TRADE STATE MANAGEMENT
   * Controls the strategy's operational state and prevents concurrent operations
   */
  private transitionToState(newState: TradeState, reason?: string): void {
    const previousState = this.strategyState.tradeState;
    this.strategyState.tradeState = newState;
    
    this.logger.info(`🔄 Trade State Transition: ${previousState} → ${newState}${reason ? ` (${reason})` : ''}`);
    
    // Mark state as dirty for immediate persistence
    this.markStateAsDirty();
    
    // For critical state transitions, save immediately
    if (newState === TradeState.WAITING_FOR_ENTRY || newState === TradeState.IN_TRADE) {
      // Don't await to avoid blocking the strategy flow, but handle errors
      this.saveStateImmediate().catch(error => {
        this.logger.error('❌ Failed to save state after critical transition:', error);
      });
    }
    
    // Perform state synchronization check and recovery
    this.performStateRecovery(newState, previousState);
    
    // Handle state-specific actions
    switch (newState) {
      case TradeState.WAITING_FOR_BREAKOUT:
        this.resetTradeSetup();
        this.enableBreakoutDetection();
        break;
        
      case TradeState.WAITING_FOR_ENTRY:
        this.disableBreakoutDetection();
        break;
        
      case TradeState.IN_TRADE:
        this.disableBreakoutDetection();
        this.disableMarkingCandleSystem();
        break;
    }
  }

  private performStateRecovery(newState: TradeState, previousState: TradeState): void {
    try {
      const activePosition = this.tradeExecutionService.getActivePosition();
      const hasStrategyTradeId = !!this.strategyState.currentTradeId;
      const hasServicePosition = !!activePosition;

      // Check for state mismatches and recover
      if (newState === TradeState.WAITING_FOR_BREAKOUT) {
        if (hasServicePosition) {
          this.logger.warn(`🔧 State Recovery: Found orphaned position ${activePosition.tradeId} - attempting cleanup`);
          // Don't automatically close - log for manual intervention
          this.logger.error(`🚨 MANUAL INTERVENTION REQUIRED: Orphaned position detected`);
        }
      }

      if (newState === TradeState.IN_TRADE) {
        if (!hasServicePosition && hasStrategyTradeId) {
          this.logger.warn(`🔧 State Recovery: Strategy has trade ID but no service position - clearing strategy state`);
          delete this.strategyState.currentTradeId;
        }
      }

      if (hasStrategyTradeId && hasServicePosition && activePosition.tradeId !== this.strategyState.currentTradeId) {
        this.logger.warn(`🔧 State Recovery: ID mismatch - Strategy: ${this.strategyState.currentTradeId}, Service: ${activePosition.tradeId}`);
        // Use service position as source of truth
        this.strategyState.currentTradeId = activePosition.tradeId;
      }

    } catch (error) {
      this.logger.error('❌ Error in state recovery:', error);
    }
  }

  private resetTradeSetup(): void {
    delete this.strategyState.currentTradeId;
    delete this.strategyState.tradeSetupRequest;
    
    // Reset marking candle state to initial
    this.strategyState.markingCandleState.isActive = false;
    this.strategyState.markingCandleState.breakoutReference = null;
    this.strategyState.markingCandleState.startTime = null;
    this.strategyState.markingCandleState.currentMarkingCandle = null;
    this.strategyState.markingCandleState.searchPhase = 'initial';
    this.strategyState.markingCandleState.barsProcessedSinceBreakout = 0;
    this.strategyState.markingCandleState.maxUpdatesReached = false;
    this.strategyState.markingCandleState.timeExpired = false;
    this.strategyState.markingCandleState.tradeSkipped = false;
  }

  private disableBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
    
    // CRITICAL FIX: Clear stale breakout signals to prevent phantom processing on restart
    if (this.strategyState.latestBreakoutSignal) {
      this.logger.info(`🧹 Clearing stale breakout signal: ${this.strategyState.latestBreakoutSignal.type} @ ₹${this.strategyState.latestBreakoutSignal.price}`);
      this.strategyState.latestBreakoutSignal = undefined;
    }
  }

  private enableBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = true;
  }

  private disableMarkingCandleSystem(): void {
    this.strategyState.markingCandleState.isActive = false;
    
    // CRITICAL FIX: Reset marking candle state to prevent phantom processing on restart
    this.strategyState.markingCandleState.searchPhase = 'initial';
    this.strategyState.markingCandleState.barsProcessedSinceBreakout = 0;
    this.strategyState.markingCandleState.tradeSkipped = false;
    this.strategyState.markingCandleState.maxUpdatesReached = false;
    this.strategyState.markingCandleState.currentMarkingCandle = null;
    this.strategyState.markingCandleState.breakoutReference = null;
    this.strategyState.markingCandleState.startTime = null;
    
    this.logger.info(`🧹 Marking candle system disabled and state reset`);
  }

  /**
   * STOP LOSS CAPPING
   * Caps stop loss at 40% of target distance to maintain minimum 1:2.5 R:R
   * 
   * @param entryPrice - Entry price level
   * @param naturalSL - Natural SL from marking candle (low for LONG, high for SHORT)
   * @param direction - Trade direction (LONG or SHORT)
   * @returns Capped SL level (returns naturalSL if already within limit)
   */
  private calculateCappedStopLoss(
    entryPrice: number,
    naturalSL: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    if (!this.strategyState.livePrice) {
      this.logger.warn('⚠️ No live price available for SL cap calculation, using natural SL');
      return naturalSL;
    }

    // Calculate target distance (same formula as calculateTargetLevel)
    const futurePrice = this.strategyState.livePrice.last_price;
    const targetPoints = Math.round(futurePrice / 1000);

    // Calculate max allowed SL distance (40% of target)
    const maxSLDistance = targetPoints * this.SL_CAP_RATIO;

    // Calculate natural SL distance
    const naturalSLDistance = Math.abs(entryPrice - naturalSL);

    // Check if capping is needed
    if (naturalSLDistance > maxSLDistance) {
      // Cap the SL
      const cappedSL = direction === 'LONG'
        ? entryPrice - maxSLDistance
        : entryPrice + maxSLDistance;

      this.logger.info(
        `⚠️ Wide marking candle detected! Natural SL: ${naturalSLDistance.toFixed(2)} pts, ` +
        `Capping at ${maxSLDistance.toFixed(2)} pts (${(this.SL_CAP_RATIO * 100)}% of ${targetPoints} pt target) ` +
        `for minimum 1:2.5 R:R`
      );
      this.logger.info(`   🔒 Natural SL: ₹${naturalSL.toFixed(2)} → Capped SL: ₹${cappedSL.toFixed(2)}`);

      return cappedSL;
    } else {
      // SL within limits, use natural SL
      this.logger.debug(
        `✅ SL within limits: ${naturalSLDistance.toFixed(2)} pts ≤ ${maxSLDistance.toFixed(2)} pts max, ` +
        `using natural SL`
      );
      return naturalSL;
    }
  }

  /**
   * TARGET CALCULATION
   * Calculates target level based on NIFTY futures price
   * Target = Entry ± (NIFTY FUT price / 1000) points
   */
  private calculateTargetLevel(entryLevel: number, direction: 'LONG' | 'SHORT'): number {
    if (!this.strategyState.livePrice) {
      throw new Error('No live price available for target calculation');
    }

    const futurePrice = this.strategyState.livePrice.last_price;
    const targetPoints = Math.round(futurePrice / 1000);
    
    const targetLevel = direction === 'LONG' 
      ? entryLevel + targetPoints 
      : entryLevel - targetPoints;

    this.logger.info(`📊 Target Calculation: Entry ${entryLevel}, FUT ${futurePrice} → Target ${targetLevel} (${targetPoints} pts)`);
    
    return targetLevel;
  }

  /**
   * TRADE SETUP REQUEST CREATION  
   * Creates trade setup request when marking candle levels are available
   */
  private createTradeSetupRequest(direction: 'LONG' | 'SHORT', entryLevel: number, stopLossLevel: number): TradeSetupRequest {
    const targetLevel = this.calculateTargetLevel(entryLevel, direction);
    
    // Calculate 60% trailing trigger
    const targetDistance = Math.abs(targetLevel - entryLevel);
    const trailingTriggerDistance = targetDistance * 0.60; // 60% of target distance
    
    let trailingTriggerLevel: number;
    if (direction === 'LONG') {
      // LONG: Target above entry, trailing trigger = entry + 60%
      trailingTriggerLevel = entryLevel + trailingTriggerDistance;
    } else {
      // SHORT: Target below entry, trailing trigger = entry - 60%
      trailingTriggerLevel = entryLevel - trailingTriggerDistance;
    }
    
    const tradeRequest: TradeSetupRequest = {
      strategyId: 'nifty-breakout-retracement',
      direction,
      entryLevel,
      stopLossLevel,
      targetLevel,
      underlyingPrice: this.strategyState.livePrice?.last_price || 0,
      timestamp: new Date(),
      originalStopLossLevel: stopLossLevel,           // Store original SL
      trailingTriggerLevel: trailingTriggerLevel      // 60% trigger level
    };

    this.logger.info(`🎯 Trade Setup Created: ${direction} | Entry: ₹${entryLevel} | SL: ₹${stopLossLevel} | Target: ₹${targetLevel}`);
    this.logger.info(`   📊 Target Distance: ${targetDistance.toFixed(2)} points | 60% Trailing Trigger: ₹${trailingTriggerLevel.toFixed(2)}`);
    
    return tradeRequest;
  }

  /**
   * CREATE AND STORE TRADE SETUP
   * Creates trade setup request from marking candle and stores it in strategy state
   */
  private createAndStoreTradeSetup(markingCandle: MarkingCandle): void {
    if (!this.strategyState.markingCandleState.breakoutReference) {
      this.logger.error('❌ Cannot create trade setup - no breakout reference');
      return;
    }

    const breakoutType = this.strategyState.markingCandleState.breakoutReference.type;
    const direction = breakoutType === 'long_breakout' ? 'LONG' : 'SHORT';
    
    const tradeRequest = this.createTradeSetupRequest(
      direction,
      markingCandle.entryPrice,
      markingCandle.stopLoss
    );

    // Store in strategy state
    this.strategyState.tradeSetupRequest = tradeRequest;
    
    this.logger.info(`💾 Trade Setup Stored in Strategy State`);
    
    // Trade execution service integration happens through onBreakoutDetected method
  }

  /**
   * TRADE LEVEL MONITORING
   * Monitors current price against entry, SL, and target levels based on trade state
   */
  private monitorTradeLevels(currentPrice: number): void {
    switch (this.strategyState.tradeState) {
      case TradeState.WAITING_FOR_ENTRY:
        this.checkEntryTrigger(currentPrice);
        break;
        
      case TradeState.IN_TRADE:
        this.checkExitTriggers(currentPrice);
        break;
        
      case TradeState.WAITING_FOR_BREAKOUT:
        // No level monitoring needed
        break;
    }
  }

  /**
   * ENTRY TRIGGER DETECTION
   * Monitors for entry level crossover in WAITING_FOR_ENTRY state
   */
  private checkEntryTrigger(currentPrice: number): void {
    if (!this.strategyState.tradeSetupRequest) {
      return; // No trade setup available
    }

    const setup = this.strategyState.tradeSetupRequest;
    const entryLevel = setup.entryLevel;
    const direction = setup.direction;

    let entryTriggered = false;

    if (direction === 'LONG' && currentPrice >= entryLevel) {
      entryTriggered = true;
      this.logger.info(`🚀 LONG ENTRY TRIGGERED! Price ${currentPrice} >= Entry ${entryLevel}`);
    } else if (direction === 'SHORT' && currentPrice <= entryLevel) {
      entryTriggered = true;
      this.logger.info(`🚀 SHORT ENTRY TRIGGERED! Price ${currentPrice} <= Entry ${entryLevel}`);
    }

    if (entryTriggered) {
      // Guard against concurrent entry executions
      if (this.isExecutingEntry) {
        this.logger.debug('🔒 Entry execution already in progress, skipping duplicate trigger');
        return;
      }

      // Set guard flag before starting execution
      this.isExecutingEntry = true;

      // Fire and forget async execution to avoid blocking price monitoring
      this.executeTradeEntry()
        .catch(error => {
          this.logger.error('Entry execution error handled in async context:', error);
        })
        .finally(() => {
          // Always reset guard flag after execution completes
          this.isExecutingEntry = false;
        });
    }
  }

  /**
   * EXIT TRIGGER DETECTION  
   * Monitors for SL/Target hits in IN_TRADE state
   * Also monitors 60% trailing trigger to move SL to cost
   */
  private checkExitTriggers(currentPrice: number): void {
    if (!this.strategyState.tradeSetupRequest) {
      return; // No active trade
    }

    const setup = this.strategyState.tradeSetupRequest;
    const direction = setup.direction;
    
    // Get active position to check trailing status
    const activePosition = this.tradeExecutionService.getActivePosition();
    if (!activePosition) {
      return; // No active position
    }

    // ========================================
    // CHECK FOR 60% TRAILING TRIGGER
    // ========================================
    if (!activePosition.isTrailingActive) {
      const trailingTrigger = setup.trailingTriggerLevel;
      let trailingTriggered = false;
      
      if (direction === 'LONG' && currentPrice >= trailingTrigger) {
        trailingTriggered = true;
        this.logger.info(`✅ LONG 60% Trailing Triggered! Price ₹${currentPrice} >= Trigger ₹${trailingTrigger.toFixed(2)}`);
      } else if (direction === 'SHORT' && currentPrice <= trailingTrigger) {
        trailingTriggered = true;
        this.logger.info(`✅ SHORT 60% Trailing Triggered! Price ₹${currentPrice} <= Trigger ₹${trailingTrigger.toFixed(2)}`);
      }
      
      if (trailingTriggered) {
        // Move SL to cost (entry price)
        const entryPrice = activePosition.entryPrice;
        this.tradeExecutionService.updateStopLossToCost(entryPrice);
        setup.stopLossLevel = entryPrice; // Update setup SL as well
        
        this.logger.info(`🛡️ STOP LOSS MOVED TO COST: ₹${entryPrice.toFixed(2)}`);
        this.logger.info(`   Original SL: ₹${setup.originalStopLossLevel.toFixed(2)} → New SL: ₹${entryPrice.toFixed(2)}`);
        this.logger.info(`   Trade now protected - minimum result: BREAKEVEN`);
        
        this.markStateAsDirty(); // Trigger persistence save
      }
    }

    // ========================================
    // CHECK STOP LOSS AND TARGET
    // ========================================
    const stopLoss = setup.stopLossLevel;  // Now uses updated SL if trailed
    const target = setup.targetLevel;

    let exitTriggered = false;
    let exitReason = '';

    // Check Stop Loss (now using potentially updated SL)
    if (direction === 'LONG' && currentPrice <= stopLoss) {
      exitTriggered = true;
      exitReason = 'STOP_LOSS';
      this.logger.info(`🛑 LONG SL HIT! Price ₹${currentPrice} <= SL ₹${stopLoss}`);
    } else if (direction === 'SHORT' && currentPrice >= stopLoss) {
      exitTriggered = true;
      exitReason = 'STOP_LOSS';
      this.logger.info(`🛑 SHORT SL HIT! Price ₹${currentPrice} >= SL ₹${stopLoss}`);
    }

    // Check Target
    if (!exitTriggered) {
      if (direction === 'LONG' && currentPrice >= target) {
        exitTriggered = true;
        exitReason = 'TARGET';
        this.logger.info(`🎯 LONG TARGET HIT! Price ₹${currentPrice} >= Target ₹${target}`);
      } else if (direction === 'SHORT' && currentPrice <= target) {
        exitTriggered = true;
        exitReason = 'TARGET';
        this.logger.info(`🎯 SHORT TARGET HIT! Price ₹${currentPrice} <= Target ₹${target}`);
      }
    }

    if (exitTriggered) {
      // Guard against concurrent exit executions
      if (this.isExecutingExit) {
        this.logger.debug('🔒 Exit execution already in progress, skipping duplicate trigger');
        return;
      }

      // Set guard flag before starting execution
      this.isExecutingExit = true;

      // Fire and forget async execution to avoid blocking price monitoring
      this.executeTradeExit(exitReason)
        .catch(error => {
          this.logger.error('Exit execution error handled in async context:', error);
        })
        .finally(() => {
          // Always reset guard flag after execution completes
          this.isExecutingExit = false;
        });
    }
  }

  /**
   * TRADE ENTRY EXECUTION
   * Called when entry level is crossed - places market order via TradeExecutionService
   * ATOMIC: Protected against race conditions with state lock
   */
  private async executeTradeEntry(): Promise<void> {
    return await globalStateLock.executeAtomic('trade-entry', async () => {
      try {
      this.logger.info(`📞 Calling TradeExecutionService to PLACE MARKET ORDER`);
      
      if (!this.strategyState.tradeSetupRequest) {
        throw new Error('No trade setup request available for entry execution');
      }

      // Verify no active position exists before placing new order
      const activePosition = this.tradeExecutionService.getActivePosition();
      if (activePosition) {
        throw new Error(`Cannot place order: Active position exists ${activePosition.tradeId}`);
      }

      // Call TradeExecutionService to place market order
      const tradeId = await this.tradeExecutionService.placeMarketOrder(this.strategyState.tradeSetupRequest);
      this.strategyState.currentTradeId = tradeId;
      
      // Verify state synchronization
      const newActivePosition = this.tradeExecutionService.getActivePosition();
      if (!newActivePosition || newActivePosition.tradeId !== tradeId) {
        this.logger.warn(`⚠️ State sync warning: Strategy ID ${tradeId} != Service position ${newActivePosition?.tradeId}`);
      }
      
      // Transition to IN_TRADE state after successful order placement
      this.transitionToState(TradeState.IN_TRADE, 'Entry level crossed - Order placed');
      
        this.logger.info(`✅ Trade entry executed - Trade ID: ${tradeId} - Now monitoring SL/Target levels`);
      } catch (error) {
        this.logger.error('❌ Error executing trade entry:', error);
        
        // Smart error handling to prevent state corruption from race conditions
        const activePosition = this.tradeExecutionService.getActivePosition();
        
        if (activePosition) {
          // Position exists - likely a race condition where another execution succeeded
          this.logger.warn(`⚠️ Entry error but position exists: ${activePosition.tradeId}`);
          
          // Check if we're already in IN_TRADE state
          if (this.strategyState.tradeState === TradeState.IN_TRADE) {
            this.logger.info(`✅ Already IN_TRADE - preserving state (race condition handled)`);
            return; // Keep current state, don't reset
          } else {
            // Position exists but state is wrong - recover
            this.logger.warn(`🔧 State recovery: Setting currentTradeId and transitioning to IN_TRADE`);
            this.strategyState.currentTradeId = activePosition.tradeId;
            this.transitionToState(TradeState.IN_TRADE, 'State recovered from orphaned position');
            return;
          }
        }
        
        // No position exists - genuine entry failure
        this.logger.info(`📉 No position found - genuine entry failure, resetting to WAITING_FOR_BREAKOUT`);
        this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, 'Entry execution failed');
      }
    });
  }

  /**
   * TRADE EXIT EXECUTION
   * Called when SL or Target is hit - closes position via TradeExecutionService
   * ATOMIC: Protected against race conditions with state lock
   */
  private async executeTradeExit(reason: string): Promise<void> {
    return await globalStateLock.executeAtomic('trade-exit', async () => {
      try {
      this.logger.info(`📞 Calling TradeExecutionService to CLOSE POSITION - Reason: ${reason}`);
      
      if (!this.strategyState.currentTradeId) {
        throw new Error('No active trade ID available for exit execution');
      }

      // Verify active position exists before closing
      const activePosition = this.tradeExecutionService.getActivePosition();
      if (!activePosition) {
        this.logger.warn(`⚠️ No active position found in service for trade ID: ${this.strategyState.currentTradeId}`);
        // Clear strategy state and continue
        delete this.strategyState.currentTradeId;
        this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade ID cleared: ${reason}`);
        return;
      }

      if (activePosition.tradeId !== this.strategyState.currentTradeId) {
        this.logger.warn(`⚠️ State sync mismatch: Strategy ID ${this.strategyState.currentTradeId} != Service ID ${activePosition.tradeId}`);
      }

      // Call TradeExecutionService to close position
      const exitReason = reason.includes('TARGET') ? 'TARGET' : 
                        reason.includes('STOP_LOSS') ? 'STOP_LOSS' : 'MANUAL';
      await this.tradeExecutionService.closePosition(this.strategyState.currentTradeId, exitReason);
      
      // Clear trade data
      delete this.strategyState.currentTradeId;
      
      // Verify position was closed
      const remainingPosition = this.tradeExecutionService.getActivePosition();
      if (remainingPosition) {
        this.logger.warn(`⚠️ Position still active after close: ${remainingPosition.tradeId}`);
      }
      
      // Transition back to WAITING_FOR_BREAKOUT
      this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade closed: ${reason}`);
      
        this.logger.info(`✅ Trade exit executed - Returning to breakout monitoring`);
      } catch (error) {
        this.logger.error('❌ Error executing trade exit:', error);
        
        // Smart error handling to verify actual position state
        const remainingPosition = this.tradeExecutionService.getActivePosition();
        
        if (remainingPosition) {
          // Position still exists despite exit error - stay in IN_TRADE to keep monitoring
          this.logger.warn(`⚠️ Exit error but position still exists: ${remainingPosition.tradeId}`);
          this.logger.warn(`🔧 Keeping state as IN_TRADE to continue monitoring SL/Target`);
          // Don't clear trade ID or change state - keep monitoring
          return;
        } else {
          // Position was closed (or never existed) - safe to reset
          this.logger.info(`✅ No position found after exit error - safe to reset state`);
          delete this.strategyState.currentTradeId;
          this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade exit error: ${reason}`);
        }
      }
    });
  }

  /**
   * Handle manual exit from the web dashboard
   * Called when user clicks manual exit button - synchronizes strategy state after position closure
   * ATOMIC: Protected against race conditions with state lock
   */
  public async handleManualExit(): Promise<void> {
    return await globalStateLock.executeAtomic('manual-exit', async () => {
      try {
        this.logger.info(`🔄 Processing manual exit - Current state: ${this.strategyState.tradeState}`);
        
        // CRITICAL: Fetch exit order and record trade with P&L before clearing
        // This is similar to BollingerBandStrategy.clearActivePosition()
        const remainingPosition = this.tradeExecutionService.getActivePosition();
        if (remainingPosition) {
          this.logger.warn(`⚠️ Found orphaned position in TradeExecutionService: ${remainingPosition.tradeId}`);
          this.logger.info(`🧹 Clearing orphaned position and fetching exit price from broker...`);
          
          try {
            // Use enhanced method that fetches exit price and records trade
            await this.tradeExecutionService.clearOrphanedPositionWithExitPrice();
            this.logger.info(`✅ Orphaned position cleared with exit price and P&L recorded`);
          } catch (error) {
            this.logger.error('❌ Error fetching exit price, falling back to basic clear:', error);
            // Fallback to basic clear if exit price fetch fails
            this.tradeExecutionService.clearOrphanedPosition();
            this.logger.info(`✅ Orphaned position cleared (without exit price)`);
          }
        }
        
        // Check if we're actually in a trade state
        if (this.strategyState.tradeState !== TradeState.IN_TRADE) {
          this.logger.warn(`⚠️ Manual exit called but not in trade state: ${this.strategyState.tradeState}`);
          // Still reset to ensure clean state
          delete this.strategyState.currentTradeId;
          delete this.strategyState.tradeSetupRequest;
          this.disableMarkingCandleSystem();
          this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, 'Manual exit - State cleanup');
          this.logger.info(`✅ Strategy state reset to WAITING_FOR_BREAKOUT`);
          return;
        }

        if (!this.strategyState.currentTradeId) {
          this.logger.warn(`⚠️ Manual exit called but no current trade ID`);
          // Still transition to ensure we don't get stuck
          this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, 'Manual exit - No trade ID');
          return;
        }

        this.logger.info(`🚨 Manual exit executed for trade ID: ${this.strategyState.currentTradeId}`);
        
        // Clear trade data
        const exitedTradeId = this.strategyState.currentTradeId;
        delete this.strategyState.currentTradeId;
        delete this.strategyState.tradeSetupRequest;
        
        // Disable marking candle system
        this.disableMarkingCandleSystem();
        
        // Transition back to WAITING_FOR_BREAKOUT
        this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Manual exit - Trade ID: ${exitedTradeId}`);
        
        this.logger.info(`✅ Manual exit processed - Strategy resumed breakout monitoring`);
        
      } catch (error) {
        this.logger.error('❌ Error processing manual exit:', error);
        // Even on error, try to reset state to avoid being stuck
        try {
          await this.tradeExecutionService.clearOrphanedPositionWithExitPrice();
        } catch (clearError) {
          this.logger.error('❌ Error clearing orphaned position during error recovery:', clearError);
          // Last resort: basic clear without exit price
          try {
            this.tradeExecutionService.clearOrphanedPosition();
          } catch (basicClearError) {
            this.logger.error('❌ Error with basic clear:', basicClearError);
          }
        }
        delete this.strategyState.currentTradeId;
        delete this.strategyState.tradeSetupRequest;
        this.disableMarkingCandleSystem();
        this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Manual exit error recovery`);
      }
    });
  }

  /**
   * MARKING CANDLE INITIALIZATION
   * Starts tracking marking candles immediately after a breakout is detected
   * 
   * @param breakoutSignal - The breakout signal that triggered marking candle tracking
   */
  private startMarkingCandleTracking(breakoutSignal: BreakoutSignal): void {
    this.logger.info(`🔍 Starting marking candle tracking for ${breakoutSignal.type}`);
    this.logger.info(`📊 Breakout Candle OHLC: O:${breakoutSignal.candleOpen} H:${breakoutSignal.candleHigh} L:${breakoutSignal.candleLow} C:${breakoutSignal.candleClose}`);
    
    this.strategyState.markingCandleState = {
      isActive: true,
      breakoutReference: breakoutSignal,
      startTime: breakoutSignal.timestamp,
      currentMarkingCandle: null,
      searchPhase: 'initial',
      barsProcessedSinceBreakout: 0,
      maxUpdatesReached: false,
      timeExpired: false,
      tradeSkipped: false
    };
    
    this.logger.info(`✅ Marking candle tracking ACTIVATED - isActive: ${this.strategyState.markingCandleState.isActive}`);

    // 🎯 NOTIFY EXECUTION SERVICE OF BREAKOUT FOR INSTRUMENT SELECTION
    const direction = breakoutSignal.type === 'long_breakout' ? 'LONG' : 'SHORT';
    const underlyingPrice = breakoutSignal.price; // Use breakout candle close price
    
    // Let execution service handle instrument selection upon breakout notification
    this.tradeExecutionService.onBreakoutDetected(direction, underlyingPrice, breakoutSignal.timestamp);
  }

  /**
   * MARKING CANDLE PROCESSING CORE
   * Main processing logic that handles marking candle detection and updates
   * Called after each completed 5-minute candle during active tracking
   * 
   * @param completedCandle - The newly completed 5-minute candle to evaluate
   */
  private processMarkingCandle(completedCandle: Candle): void {
    if (!this.strategyState.markingCandleState.isActive) {
      this.logger.debug(`🔒 Marking candle tracking not active, skipping processing`);
      return; // Not tracking marking candles
    }
    
    // Guard: Verify we're in the correct state for marking candle processing
    if (this.strategyState.tradeState !== TradeState.WAITING_FOR_ENTRY) {
      this.logger.warn(`🚫 Marking candle processing skipped - Wrong state: ${this.strategyState.tradeState} (need: WAITING_FOR_ENTRY)`);
      this.logger.warn(`   isActive=${this.strategyState.markingCandleState.isActive} but state is ${this.strategyState.tradeState}`);
      this.logger.warn(`   This indicates orphaned marking candle state - disabling tracking`);
      this.strategyState.markingCandleState.isActive = false;
      return;
    }

    this.logger.debug(`🕯️ Processing marking candle: O:${completedCandle.open} H:${completedCandle.high} L:${completedCandle.low} C:${completedCandle.close}`);

    const markingState = this.strategyState.markingCandleState;

    // Check time limit
    if (markingState.startTime) {
      const minutesElapsed = (completedCandle.timestamp.getTime() - markingState.startTime.getTime()) / (1000 * 60);
      this.logger.debug(`⏰ Time elapsed since breakout: ${minutesElapsed.toFixed(1)} minutes (limit: ${this.TIME_LIMIT_MINUTES} minutes)`);
      if (minutesElapsed > this.TIME_LIMIT_MINUTES) {
        this.logger.info(`⏰ ${this.TIME_LIMIT_MINUTES}-minute time limit exceeded for marking candle tracking`);
        this.skipMarkingCandleTrade('time_limit_exceeded');
        return;
      }
    }

    markingState.barsProcessedSinceBreakout++;
    this.logger.debug(`📊 Bars processed since breakout: ${markingState.barsProcessedSinceBreakout} (phase: ${markingState.searchPhase})`);

    if (markingState.searchPhase === 'initial') {
      // Initial search phase - looking for first marking candle within configured bars
      if (markingState.barsProcessedSinceBreakout <= this.INITIAL_SEARCH_BARS) {
        this.logger.debug(`🔍 Looking for initial marking candle (bar ${markingState.barsProcessedSinceBreakout}/${this.INITIAL_SEARCH_BARS})`);
        const markingCandle = this.checkForInitialMarkingCandle(completedCandle);
        if (markingCandle) {
          markingState.currentMarkingCandle = markingCandle;
          markingState.searchPhase = 'updates';
          this.logger.info(`✅ INITIAL MARKING CANDLE FOUND!`);
          this.logMarkingCandleDetails(markingCandle);
          
          // Create trade setup request with marking candle levels
          this.createAndStoreTradeSetup(markingCandle);
        } else {
          this.logger.debug(`❌ No marking candle found in bar ${markingState.barsProcessedSinceBreakout}`);
        }
      } else {
        // 10 bars elapsed without finding marking candle
        this.logger.info(`❌ No marking candle found within 10 bars after breakout`);
        this.skipMarkingCandleTrade('no_marking_candle');
        return;
      }
    } else if (markingState.searchPhase === 'updates') {
      // Updates phase - looking for better marking candles
      if (!markingState.maxUpdatesReached) {
        const updatedMarkingCandle = this.checkForMarkingCandleUpdate(completedCandle);
        if (updatedMarkingCandle) {
          markingState.currentMarkingCandle = updatedMarkingCandle;
          this.logger.info(`🔄 MARKING CANDLE UPDATED! (Count: ${updatedMarkingCandle.updateCount})`);
          this.logMarkingCandleDetails(updatedMarkingCandle);

          // Update trade setup request with new levels
          this.createAndStoreTradeSetup(updatedMarkingCandle);

          if (updatedMarkingCandle.updateCount >= 1) {
            markingState.maxUpdatesReached = true;
            this.logger.info(`🚫 Maximum 1 update reached`);
          }
        }
      } else {
        this.logger.debug(`🚫 Maximum updates reached, no more marking candle updates allowed`);
      }
    }
  }

  /**
   * INITIAL MARKING CANDLE DETECTION
   * Validates if a candle qualifies as the first marking candle after breakout
   * 
   * Requirements:
   * - Must be opposite direction to breakout (red for long, green for short)
   * - Must close within the breakout candle's high-low range (intra-range close)
   * - Must occur within 10 bars after the breakout
   * 
   * @param candle - The candle to evaluate for marking candle qualification
   * @returns MarkingCandle object if qualified, null otherwise
   */
  private checkForInitialMarkingCandle(candle: Candle): MarkingCandle | null {
    const breakoutRef = this.strategyState.markingCandleState.breakoutReference;
    if (!breakoutRef) return null;

    const isLongBreakout = breakoutRef.type === 'long_breakout';
    const breakoutCandle = {
      open: breakoutRef.candleOpen,
      close: breakoutRef.candleClose,
      high: breakoutRef.candleHigh,
      low: breakoutRef.candleLow
    };

    this.logger.debug(`🔍 Checking marking candle: Candle OHLC: O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`);
    this.logger.debug(`📊 Breakout Candle Range: H:${breakoutCandle.high} L:${breakoutCandle.low}`);

    // Check opposite direction requirement
    const candleIsRed = candle.close < candle.open;
    const candleIsGreen = candle.close > candle.open;

    if (isLongBreakout && !candleIsRed) {
      this.logger.debug(`❌ Long breakout needs RED marking candle, but candle is ${candleIsRed ? 'RED' : 'GREEN'}`);
      return null; // For long breakout, need red marking candle
    }
    if (!isLongBreakout && !candleIsGreen) {
      this.logger.debug(`❌ Short breakout needs GREEN marking candle, but candle is ${candleIsGreen ? 'GREEN' : 'RED'}`);
      return null; // For short breakout, need green marking candle
    }

    // Check intra-range close requirement
    if (candle.close < breakoutCandle.low || candle.close > breakoutCandle.high) {
      this.logger.debug(`❌ Candle close ${candle.close} outside breakout range [${breakoutCandle.low}, ${breakoutCandle.high}]`);
      return null; // Closing price must be within breakout candle's range
    }

    this.logger.info(`✅ VALID MARKING CANDLE FOUND! Close: ${candle.close} within range [${breakoutCandle.low}, ${breakoutCandle.high}]`);

    // Calculate entry and natural stop loss from marking candle
    const entryPrice = isLongBreakout ? candle.high : candle.low;
    const naturalSL = isLongBreakout ? candle.low : candle.high;
    const direction = isLongBreakout ? 'LONG' : 'SHORT';

    // Apply SL cap if needed (maintains minimum 1:2.5 R:R)
    const cappedSL = this.calculateCappedStopLoss(entryPrice, naturalSL, direction);

    // Create marking candle with capped SL
    const markingCandle: MarkingCandle = {
      candle: candle,
      entryPrice: entryPrice,
      stopLoss: cappedSL,
      updateCount: 0,
      detectedAt: new Date()
    };

    return markingCandle;
  }

  /**
   * MARKING CANDLE UPDATE DETECTION
   * Evaluates if a new candle should replace the current marking candle
   * 
   * Update Criteria:
   * - New candle must extend stop-loss by at least 1 point (adverse direction)
   * - Maximum 1 update allowed per breakout sequence
   * - Any direction candle can qualify (not restricted to opposite direction)
   * 
   * @param candle - The candle to evaluate for marking candle update
   * @returns Updated MarkingCandle object if qualified, null otherwise
   */
  private checkForMarkingCandleUpdate(candle: Candle): MarkingCandle | null {
    const currentMarking = this.strategyState.markingCandleState.currentMarkingCandle;
    const breakoutRef = this.strategyState.markingCandleState.breakoutReference;
    
    if (!currentMarking || !breakoutRef) return null;

    const isLongBreakout = breakoutRef.type === 'long_breakout';
    const currentSL = currentMarking.stopLoss;

    // Check if this candle extends SL by at least 1 point
    let newSL: number;
    let slExtended: boolean;

    if (isLongBreakout) {
      newSL = candle.low;
      slExtended = (currentSL - newSL) >= 1; // SL moved lower by at least 1 point
    } else {
      newSL = candle.high;
      slExtended = (newSL - currentSL) >= 1; // SL moved higher by at least 1 point
    }

    if (!slExtended) {
      return null; // SL not extended by at least 1 point
    }

    // Calculate entry and apply SL cap
    const entryPrice = isLongBreakout ? candle.high : candle.low;
    const direction = isLongBreakout ? 'LONG' : 'SHORT';

    // Apply SL cap to updated marking candle (maintains minimum 1:2.5 R:R)
    const cappedSL = this.calculateCappedStopLoss(entryPrice, newSL, direction);

    // Create updated marking candle with capped SL
    const updatedMarkingCandle: MarkingCandle = {
      candle: candle,
      entryPrice: entryPrice,
      stopLoss: cappedSL,
      updateCount: currentMarking.updateCount + 1,
      detectedAt: new Date()
    };

    return updatedMarkingCandle;
  }

  /**
   * TRADE SETUP ABANDONMENT
   * Safely abandons the current marking candle trade setup while preserving pivot validity
   * 
   * @param reason - Descriptive reason for trade abandonment (for logging)
   */
  private skipMarkingCandleTrade(reason: string): void {
    this.logger.info(`🚫 Skipping marking candle trade - Reason: ${reason}`);
    this.logger.info(`🚫 MARKING CANDLE TRACKING DEACTIVATED - isActive: false`);
    
    this.strategyState.markingCandleState.tradeSkipped = true;
    this.strategyState.markingCandleState.isActive = false;
    this.strategyState.markingCandleState.searchPhase = 'expired';

    // Transition back to WAITING_FOR_BREAKOUT state
    this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, reason);

    // Pivot remains valid for future breakouts as long as it's still the latest
    this.logger.info(`📍 Pivot remains valid for future breakouts`);
  }

  /**
   * MARKING CANDLE LOGGING
   * Provides comprehensive logging of marking candle details for monitoring and debugging
   * 
   * @param markingCandle - The marking candle to log details for
   */
  private logMarkingCandleDetails(markingCandle: MarkingCandle): void {
    const breakoutType = this.strategyState.markingCandleState.breakoutReference?.type;
    
    this.logger.info(`   🕯️  Marking Candle: O:₹${markingCandle.candle.open.toFixed(2)} H:₹${markingCandle.candle.high.toFixed(2)} L:₹${markingCandle.candle.low.toFixed(2)} C:₹${markingCandle.candle.close.toFixed(2)}`);
    this.logger.info(`   🎯 Entry Price: ₹${markingCandle.entryPrice.toFixed(2)} | Stop Loss: ₹${markingCandle.stopLoss.toFixed(2)}`);
    this.logger.info(`   🔢 Update Count: ${markingCandle.updateCount} | Trade Type: ${breakoutType}`);
    this.logger.info(`   ⏰ Time: ${markingCandle.candle.timestamp.toLocaleString()}`);
  }

  // ================================================================================
  // PUBLIC API METHODS - External Access to Marking Candle State
  // ================================================================================

  // ================================================================================
  // PUBLIC API METHODS - External Access to Marking Candle State
  // ================================================================================

  /**
   * Get current marking candle state for dashboard
   * @returns Current marking candle state object
   */
  public getMarkingCandleState(): MarkingCandleState {
    return this.strategyState.markingCandleState;
  }

  /**
   * Get current trade state and setup information
   * @returns Trade state information for UI monitoring
   */
  public getTradeStateInfo(): {
    tradeState: TradeState;
    tradeSetupRequest?: TradeSetupRequest;
    currentTradeId?: string;
  } {
    const result: {
      tradeState: TradeState;
      tradeSetupRequest?: TradeSetupRequest;
      currentTradeId?: string;
    } = {
      tradeState: this.strategyState.tradeState
    };

    if (this.strategyState.tradeSetupRequest) {
      result.tradeSetupRequest = this.strategyState.tradeSetupRequest;
    }
    if (this.strategyState.currentTradeId) {
      result.currentTradeId = this.strategyState.currentTradeId;
    }

    return result;
  }

  /**
   * Get comprehensive marking candle information for monitoring
   * @returns Detailed marking candle debug information object
   */
  public getMarkingCandleDebugInfo(): any {
    const state = this.strategyState.markingCandleState;
    return {
      isActive: state.isActive,
      searchPhase: state.searchPhase,
      barsProcessedSinceBreakout: state.barsProcessedSinceBreakout,
      currentMarkingCandle: state.currentMarkingCandle ? {
        updateCount: state.currentMarkingCandle.updateCount,
        entryPrice: state.currentMarkingCandle.entryPrice,
        stopLoss: state.currentMarkingCandle.stopLoss,
        candleOHLC: {
          open: state.currentMarkingCandle.candle.open,
          high: state.currentMarkingCandle.candle.high,
          low: state.currentMarkingCandle.candle.low,
          close: state.currentMarkingCandle.candle.close
        },
        detectedAt: state.currentMarkingCandle.detectedAt
      } : null,
      breakoutReference: state.breakoutReference ? {
        type: state.breakoutReference.type,
        price: state.breakoutReference.price,
        timestamp: state.breakoutReference.timestamp
      } : null,
      timingInfo: {
        startTime: state.startTime,
        timeElapsed: state.startTime ? Math.floor((Date.now() - new Date(state.startTime).getTime()) / (1000 * 60)) : 0,
        timeLimit: 18,
        maxUpdatesReached: state.maxUpdatesReached,
        timeExpired: state.timeExpired,
        tradeSkipped: state.tradeSkipped
      }
    };
  }

  // ================================================================================
  // MANUAL TESTING AND SIMULATION METHODS
  // ================================================================================

  /**
   * Test method for manual price fetch
   */
  public async testManualPriceFetch(): Promise<void> {
    try {
      this.logger.info('🧪 Testing manual price fetch...');
      
      if (!this.strategyState.currentContract) {
        this.logger.error('❌ No contract available for testing');
        return;
      }

      await this.fetchAndProcessLivePrice();
      this.logger.info('✅ Manual price fetch test completed');
      
    } catch (error) {
      this.logger.error('❌ Error in manual price fetch test:', error);
    }
  }

  /**
   * Simulate a test tick (for debugging)
   */
  public simulateDirectTestTick(): void {
    this.logger.info('🧪 Simulating test tick...');
    // This is just a placeholder for compatibility
  }

  /**
   * COMPREHENSIVE MANUAL TESTING METHODS
   * These methods test each component independently
   */

  // ===========================
  // TRADE EXECUTION SERVICE ACCESS
  // ===========================

  /**
   * Get current capital from TradeExecutionService
   */
  public getCurrentCapital(): number {
    return this.tradeExecutionService.getCurrentCapital();
  }

  /**
   * Get active position from TradeExecutionService
   */
  public getActivePosition(): any {
    return this.tradeExecutionService.getActivePosition();
  }

  /**
   * Get detailed position with live price data from TradeExecutionService
   */
  public getDetailedPosition(): any {
    return this.tradeExecutionService.getDetailedPosition();
  }

  /**
   * Get trade history from TradeExecutionService
   */
  public getTradeHistory(): any[] {
    return this.tradeExecutionService.getTradeHistory();
  }

  /**
   * Get trading configuration from TradeExecutionService
   */
  public getTradingConfig(): any {
    return this.tradeExecutionService.getTradingConfig();
  }

  /**
   * Get execution service status
   */
  public getExecutionStatus(): any {
    return this.tradeExecutionService.getExecutionStatus();
  }

  /**
   * Update trading configuration
   */
  public updateTradingConfig(updates: any): void {
    this.tradeExecutionService.updateTradingConfig(updates);
  }

  /**
   * Initialize instruments (call this after authentication)
   */
  public async initializeInstruments(): Promise<void> {
    await this.tradeExecutionService.loadInstruments();
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
      tradeState: this.strategyState.tradeState,
      hasPosition: !!this.strategyState.currentTradeId,
      marketDataAge: this.strategyState.lastUpdateTime ? new Date().getTime() - new Date(this.strategyState.lastUpdateTime).getTime() : 'unknown',
      timestamp: now.toISOString()
    };
    
    if (isCritical) {
      this.logger.error(`🚨 CRITICAL ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    } else {
      this.logger.warn(`⚠️ ERROR [${errorType}]: ${error?.message || error}`, errorContext);
    }
    
    // Alert if too many consecutive errors
    if (this.healthStatus.consecutiveErrors >= 5) {
      this.logger.error(`🔥 BREAKOUT STRATEGY HEALTH ALERT: ${this.healthStatus.consecutiveErrors} consecutive errors detected!`, {
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
      tradeState: this.strategyState.tradeState,
      hasPosition: !!this.strategyState.currentTradeId,
      pivotHighPrice: this.strategyState.latestPivotHigh?.price || 'none',
      pivotLowPrice: this.strategyState.latestPivotLow?.price || 'none',
      candleCount: this.strategyState.candles.length,
      lastUpdate: now.toISOString()
    };
  }

  /**
   * Start health monitoring with periodic status reports
   */
  private startHealthMonitoring(): void {
    if (this.healthMonitoringInterval) return; // Already running
    
    // Report health status every 5 minutes
    this.healthMonitoringInterval = setInterval(() => {
      this.healthStatus.lastHeartbeat = new Date();
      const healthReport = this.getHealthReport();
      
      if (!healthReport.overall) {
        this.logger.warn('💊 BREAKOUT STRATEGY HEALTH REPORT (UNHEALTHY):', healthReport);
      } else {
        this.logger.info('💚 Breakout strategy health: OK', {
          consecutiveErrors: healthReport.consecutiveErrors,
          timeSinceHeartbeat: healthReport.timeSinceHeartbeat,
          tradeState: healthReport.tradeState,
          candleCount: healthReport.candleCount
        });
      }
      
      // Reset daily error counts at market open (9:15 AM)
      const now = new Date();
      if (now.getHours() === 9 && now.getMinutes() === 15) {
        this.healthStatus.criticalErrorsToday = 0;
        this.errorCounts.clear();
        this.logger.info('🔄 Daily error counts reset for breakout strategy');
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private stopHealthMonitoring(): void {
    if (this.healthMonitoringInterval) {
      clearInterval(this.healthMonitoringInterval);
      this.healthMonitoringInterval = null;
    }
  }
}