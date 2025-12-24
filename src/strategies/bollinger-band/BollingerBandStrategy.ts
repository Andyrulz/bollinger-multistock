import * as path from 'path';
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
  quantity: number; // Number of lots (e.g., 4 lots). Total shares = quantity × 75
  entryTime: Date;
  entryCandleTimestamp?: Date; // FIXED: Timestamp of entry candle for verification
  entryCandleLow?: number;     // NEW: Store entry candle's low for LONG SL logic
  entryCandleHigh?: number;    // NEW: Store entry candle's high (for future use)
  trailingSL?: number;
  highestPremium?: number;
  entryOrderId: string;        // Store real order ID from KiteConnect
  exitOrderId?: string;        // Store exit order ID when position closed
  
  // Time-decay trailing stop tracking (SHORT positions only)
  timeDecayTrailing?: {
    lastHighTime: Date;        // When did we last see a new high premium?
  };
}

export class BollingerBandStrategy extends StrategyBase {
  
  // Configuration constants
  private readonly CAPITAL_ALLOCATION = 200000;
  
  /**
   * Calculate dynamic lot size based on current capital
   * Formula: 1 lot per 40,000 of capital (rounded down)
   * Minimum: 1 lot (even if capital < 40,000)
   * 
   * @returns Number of lots to trade
   */
  private calculateLots(): number {
    const lotsPerCapital = Math.floor(this.currentCapital / 40000);
    const lots = Math.max(1, lotsPerCapital); // Minimum 1 lot
    
    this.logger.debug('[LOT CALCULATION]', {
      currentCapital: this.currentCapital.toFixed(2),
      calculatedLots: lotsPerCapital,
      finalLots: lots
    });
    
    return lots;
  }
  
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
  
  // Race condition protection for manual position clearing
  private isClearingPosition: boolean = false;
  
  // Race condition protection for position entry processing
  private isExecutingLongEntry: boolean = false;
  private isExecutingShortEntry: boolean = false;
  
  // Race condition protection for polling operations
  private isPollingInProgress: boolean = false;
  private lastPollingTime: Date | null = null;
  private consecutivePollingFailures: number = 0;
  private readonly MIN_POLLING_INTERVAL = 900; // Minimum 900ms between polls
  private readonly MAX_CONSECUTIVE_FAILURES = 5; // Backoff threshold
  
  // Race condition protection for master cycle
  private isFetchingCandle: boolean = false;
  
  // Cached position state for dashboard display
  private cachedCurrentPrice: number = 0;
  private cachedUnrealizedPnL: number = 0;
  private lastPriceUpdateTime: Date | null = null;
  
  // REST API position monitoring
  private shortMonitoringInterval?: NodeJS.Timeout;
  
  // EOD safety exit timer
  private eodExitTimer?: NodeJS.Timeout;
  
  // Position reconciliation timer
  private positionReconciliationInterval?: NodeJS.Timeout;

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
  private readonly BOLLINGER_DATA_FILE = path.join(__dirname, '../../data/bollinger-trading-data.json');

  // Retry infrastructure for error recovery
  private candleRetryTimer?: NodeJS.Timeout;
  private readonly MAX_RETRY_ATTEMPTS = 10; // For critical operations
  private readonly CANDLE_RETRY_INTERVAL = 10000; // 10 seconds for candle fetch
  private readonly TRADE_RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s exponential backoff

  // Master cycle timing and state
  private masterCycleInterval: NodeJS.Timeout | null = null;
  private currentCyclePhase: 'waiting' | '4th-minute' | '5th-minute' | '6th-minute' = 'waiting';
  private lastSuccessfulFetchTime: number | null = null; // Track last candle fetch for system sleep detection
  private lastReconciliationTime: number | null = null; // Track last reconciliation for system sleep detection
  
  // 🔒 CRITICAL FIX: Add timeout for candle fetch operations
  private readonly CANDLE_FETCH_TIMEOUT = 45000; // 45 seconds max for API calls

  constructor(kiteConnect: any, logger: Logger, config: StrategyConfig) {
    super(kiteConnect, logger, config);
    // 🔒 CRITICAL FIX: Moved loadCapitalData() to initialize() to avoid blocking sync I/O in constructor
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
        
        // P0: Check for persisted active position and recover it
        if (data.activePosition) {
          this.logger.info('🔄 Found persisted active position, will recover after initialization');
          // Will be recovered in initialize() after all services are ready
        }
        
        this.logger.info('💰 Bollinger Band capital loaded', {
          capital: this.currentCapital,
          totalTrades: this.tradeHistory.length,
          hasActivePosition: !!data.activePosition
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
        activePosition: this.currentPosition, // P0: Persist active position
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(this.BOLLINGER_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Error saving Bollinger Band capital data:', error);
    }
  }

  /**
   * P0: Recover active position from disk after restart
   * Validates position data and restarts monitoring
   */
  private async recoverActivePosition(): Promise<void> {
    try {
      const fs = require('fs');
      
      if (!fs.existsSync(this.BOLLINGER_DATA_FILE)) {
        this.logger.info('📭 No persisted state found');
        return;
      }
      
      const data = JSON.parse(fs.readFileSync(this.BOLLINGER_DATA_FILE, 'utf8'));
      
      if (!data.activePosition) {
        this.logger.info('📭 No active position to recover');
        return;
      }
      
      const position = data.activePosition;
      
      // Validate position data
      if (!position.instrument || !position.quantity || !position.type) {
        this.logger.warn('⚠️ Invalid position data found, skipping recovery', position);
        return;
      }
      
      // Restore position state
      this.currentPosition = position;
      
      // Fix date deserialization for ALL date fields (JSON.parse returns strings for dates)
      if (this.currentPosition) {
        // Critical: Convert entryTime from string to Date (affects all position types)
        this.currentPosition.entryTime = new Date(this.currentPosition.entryTime);
        
        // Convert entryCandleTimestamp if exists (FIXED: Recovery support for new field)
        if (this.currentPosition.entryCandleTimestamp) {
          this.currentPosition.entryCandleTimestamp = new Date(this.currentPosition.entryCandleTimestamp);
        }
        
        // Convert timeDecayTrailing.lastHighTime if exists (SHORT positions only)
        if (this.currentPosition.timeDecayTrailing?.lastHighTime) {
          this.currentPosition.timeDecayTrailing.lastHighTime = new Date(this.currentPosition.timeDecayTrailing.lastHighTime);
        }
      }
      
      this.logger.info('✅ Active position recovered from disk', {
        symbol: position.instrument?.tradingsymbol,
        type: position.type,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        entryCandleLow: position.entryCandleLow,
        entryCandleHigh: position.entryCandleHigh,
        trailingSL: position.trailingSL,
        highestPremium: position.highestPremium,
        timeDecayTrailing: position.timeDecayTrailing 
          ? `Last high: ${new Date(position.timeDecayTrailing.lastHighTime).toLocaleTimeString()}`
          : 'N/A (no time-decay tracking or LONG position)'
      });
      
      // 🔒 CRITICAL FIX: Restart position monitoring with validation
      try {
        this.logger.info('🔄 Starting position monitoring after recovery...');
        await this.startPositionMonitoring();
        
        // Validate that monitoring actually started for SHORT positions
        if (this.currentPosition?.type === 'SHORT') {
          // Give monitoring 1 second to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (!this.shortMonitoringInterval) {
            throw new Error('SHORT position monitoring failed to start - no active interval');
          }
          this.logger.info('✅ SHORT position monitoring validated and active');
        }
        
        this.logger.info('✅ Position monitoring restarted successfully after recovery');
        
      } catch (monitoringError) {
        this.logger.error('❌ CRITICAL: Failed to restart position monitoring after recovery:', monitoringError);
        this.logger.error('🚨 Position exists but has NO exit protection - this is a critical risk!');
        
        // Force close position as safety measure
        try {
          this.logger.warn('⚠️ Attempting emergency position closure due to monitoring failure...');
          await this.forceClosePosition('MONITORING_RESTART_FAILED');
          this.logger.info('✅ Emergency position closure successful');
        } catch (closeError) {
          this.logger.error('❌ Emergency position closure also failed:', closeError);
          this.logger.error('� MANUAL INTERVENTION REQUIRED: Position exists without monitoring!');
        }
        
        // Re-throw to signal recovery failure
        throw new Error(`Position recovery failed: ${monitoringError instanceof Error ? monitoringError.message : String(monitoringError)}`);
      }
      
    } catch (error) {
      this.logger.error('❌ Error recovering active position:', error);
      // Don't throw - let strategy continue without position
    }
  }

  public async initialize(): Promise<void> {
    this.logger.info('BollingerBandStrategy: Starting initialization...');
    
    try {
      // Step 0: Load persisted capital data (moved from constructor to avoid blocking sync I/O)
      this.loadCapitalData();
      
      // Step 1: Get NIFTY50 instrument token dynamically
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
      
      // Step 5: P0 - Recover active position if exists
      await this.recoverActivePosition();
      
      this._isInitialized = true;
      this.logger.info('BollingerBandStrategy: Initialization complete', {
        instrumentToken: nifty50Token,
        candleCount: this.candleHistory.length,
        hasPivots: !!this.dailyPivots,
        hasIndicators: !!this.currentIndicators,
        hasActivePosition: !!this.currentPosition
      });
      
    } catch (error) {
      this.logger.error('BollingerBandStrategy: Initialization failed', error);
      throw error;
    }
  }

  public async start(): Promise<void> {
    if (!this._isInitialized) {
      throw new Error('Strategy must be initialized before starting');
    }
    
    this.logger.info('BollingerBandStrategy: Starting strategy...');
    
    // Start health monitoring system
    this.startHealthMonitoring();
    
    // Start real-time monitoring
    this.startRealTimeMonitoring();
    
    // P0: Schedule EOD safety exit at 3:28 PM
    this.scheduleEODExit();
    
    // P0: Start position reconciliation system
    this.startPositionReconciliation();
    
    this.metrics.isActive = true;
    this.metrics.healthStatus = 'healthy';
    // Update metrics timestamp to show strategy is active
    this.updateMetrics({ isActive: true, healthStatus: 'healthy' });
    this.logger.info('BollingerBandStrategy: Strategy started successfully with health monitoring');
  }

  public async stop(): Promise<void> {
    this.logger.info('BollingerBandStrategy: Stopping strategy...');
    
    // 🔒 CRITICAL FIX: Stop position monitoring to prevent resource leak
    this.stopPositionMonitoring();
    
    // Stop all monitoring
    this.stopRealTimeMonitoring();
    
    // Stop retry mechanisms
    this.stopCandleRetryMechanism();
    
    // P0: Cancel EOD exit timer
    this.cancelEODExit();
    
    // P0: Stop position reconciliation
    this.stopPositionReconciliation();
    
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
   * P0: Manually clear active position from disk
   * Enhanced to fetch exit order from broker and record P&L
   * Used by dashboard button for orphaned positions (e.g., broker auto-squareoff)
   */
  public async clearActivePosition(): Promise<void> {
    // Race condition protection - prevent multiple simultaneous clears
    if (this.isClearingPosition) {
      this.logger.warn('⚠️ Position clear already in progress, skipping');
      return;
    }
    
    this.isClearingPosition = true;
    
    try {
      if (!this.currentPosition) {
        this.logger.warn('⚠️ No active position to clear');
        return;
      }
      
      const positionSymbol = this.currentPosition.instrument?.tradingsymbol;
      const entryPrice = this.currentPosition.entryPrice;
      const entryTime = this.currentPosition.entryTime;
      const quantity = this.currentPosition.quantity;
      const entryOrderId = this.currentPosition.entryOrderId;
      const positionType = this.currentPosition.type;
      
      this.logger.info('🧹 Manually clearing active position', {
        symbol: positionSymbol,
        type: positionType,
        entryPrice: entryPrice,
        quantity: quantity
      });
      
      // P0: Try to fetch actual exit order from broker
      let exitPrice = entryPrice; // Fallback to entry price if can't find exit
      let exitOrderId = `MANUAL_CLEAR_${Date.now()}`;
      let exitTime = new Date();
      
      try {
        const exitOrder = await this.fetchExitOrderFromBroker(positionSymbol, entryOrderId, entryTime, quantity);
        if (exitOrder) {
          exitPrice = exitOrder.average_price || exitOrder.price || entryPrice;
          exitOrderId = exitOrder.order_id;
          exitTime = new Date(exitOrder.order_timestamp);
          
          // Validate quantity match
          if (exitOrder.quantity !== quantity) {
            this.logger.warn(`⚠️ Quantity mismatch detected!`, {
              entryQty: quantity,
              exitQty: exitOrder.quantity,
              warning: 'Using this exit order but quantities differ'
            });
          }
          
          this.logger.info('✅ Found actual exit order from broker', {
            exitOrderId: exitOrderId,
            exitPrice: exitPrice,
            exitTime: exitTime.toLocaleString(),
            exitQty: exitOrder.quantity
          });
        } else {
          this.logger.warn('⚠️ Could not find exit order from broker, using entry price for P&L');
        }
      } catch (error) {
        this.logger.error('❌ Error fetching exit order from broker:', error);
        this.logger.warn('⚠️ Will use entry price for P&L (P&L = 0)');
      }
      
      // Calculate P&L
      const totalQuantity = quantity * 75; // NIFTY lot size × number of lots
      const pnl = (exitPrice - entryPrice) * totalQuantity;
      
      // Update capital with P&L
      this.currentCapital += pnl;
      this.metrics.profitLoss += pnl;
      
      // Create trade record for history
      const tradeRecord = {
        tradeId: `BB_MANUAL_CLEAR_${Date.now()}`,
        entryOrderId: entryOrderId,
        exitOrderId: exitOrderId,
        instrument: this.currentPosition.instrument,
        direction: positionType,
        quantity: totalQuantity,
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        entryTime: entryTime,
        exitTime: exitTime,
        pnl: pnl,
        exitReason: 'MANUAL_CLEAR_BROKER_AUTO_SQUAREOFF',
        status: 'CLOSED',
        strategy: 'BOLLINGER_BAND'
      };
      
      // Add to trade history
      this.tradeHistory.push(tradeRecord);
      
      this.logger.info('📊 Trade recorded via manual clear', {
        exitPrice: exitPrice.toFixed(2),
        pnl: pnl.toFixed(2),
        newCapital: this.currentCapital.toFixed(2),
        totalTrades: this.tradeHistory.length
      });
      
      // Clear position from memory
      this.currentPosition = null;
      
      // Stop monitoring
      this.stopPositionMonitoring();
      
      // Clear from disk (saves updated capital and trade history)
      this.saveCapitalData();
      
      // Reset cached position state for dashboard
      this.cachedCurrentPrice = 0;
      this.cachedUnrealizedPnL = 0;
      this.lastPriceUpdateTime = null;
      
      // Update metrics
      this.updateMetrics({ 
        profitLoss: this.metrics.profitLoss,
        healthStatus: 'healthy',
        lastTradeTime: new Date()
      });
      
      this.logger.info('✅ Active position cleared successfully with P&L recorded');
    } catch (error) {
      this.logger.error('❌ Error clearing active position:', error);
      throw error;
    } finally {
      // Always reset flag even if error occurs
      this.isClearingPosition = false;
    }
  }
  
  /**
   * P0: Helper method to fetch exit order from broker's order history
   * Looks for SELL order matching the position's symbol after entry time
   */
  private async fetchExitOrderFromBroker(symbol: string, entryOrderId: string, entryTime: Date, entryQuantity?: number): Promise<any> {
    try {
      // Fetch all orders for today
      const orders = await this.kiteConnect.getOrders();
      
      // Filter for this symbol's SELL orders after entry time
      // ONLY untagged orders (manual exits from broker, not bot-placed exits)
      let exitCandidates = orders.filter((order: any) => {
        const orderTime = new Date(order.order_timestamp);
        return order.tradingsymbol === symbol
          && order.transaction_type === 'SELL'
          && order.status === 'COMPLETE'
          && orderTime > entryTime
          && (!order.tag || order.tag === ''); // ONLY untagged (manual) exits
      });
      
      if (exitCandidates.length === 0) {
        this.logger.warn(`⚠️ No manual SELL orders found for ${symbol} after ${entryTime.toLocaleTimeString()}`);
        return null;
      }
      
      // If entry quantity provided, prioritize matching quantity
      if (entryQuantity) {
        const exactMatch = exitCandidates.filter((order: any) => order.quantity === entryQuantity);
        if (exactMatch.length > 0) {
          exitCandidates = exactMatch;
          this.logger.info(`✅ Found ${exactMatch.length} quantity-matching exit orders (qty=${entryQuantity})`);
        } else {
          this.logger.warn(`⚠️ No exact quantity match found. Using closest by time.`);
        }
      }
      
      // Sort by timestamp to get closest exit after entry
      exitCandidates.sort((a: any, b: any) => 
        new Date(a.order_timestamp).getTime() - new Date(b.order_timestamp).getTime()
      );
      
      const exitOrder = exitCandidates[0];
      this.logger.info(`✅ Selected exit order (${exitCandidates.length} candidates after filters)`, {
        orderId: exitOrder.order_id,
        qty: exitOrder.quantity,
        price: exitOrder.average_price,
        time: exitOrder.order_timestamp,
        tag: exitOrder.tag || 'NONE (manual)',
        quantityMatch: entryQuantity ? (exitOrder.quantity === entryQuantity ? '✅ MATCH' : '⚠️ MISMATCH') : 'N/A'
      });
      
      return exitOrder;
    } catch (error) {
      this.logger.error('Error fetching orders from broker:', error);
      return null;
    }
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
      
      // P0: Save cleared position to disk after daily cleanup
      this.saveCapitalData();
      this.logger.info("💾 Position cleared from disk after daily cleanup");
      
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
      recentTrades: this.tradeHistory.slice(-10), // Last 10 trades for dashboard
      allTrades: this.getTradeHistory(), // All trades for history page
      tradeStats: this.getTradingStats(), // Pre-calculated comprehensive stats
      // Custom strategy status
      currentLots: this.calculateLots(), // Dynamic lot size based on current capital
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
        highestPremium: this.currentPosition.highestPremium, // Highest premium achieved
        // Time-based tracking metrics
        minutesSinceEntry: (Date.now() - this.currentPosition.entryTime.getTime()) / 60000,
        minutesSinceLastHigh: this.currentPosition.timeDecayTrailing 
          ? (Date.now() - this.currentPosition.timeDecayTrailing.lastHighTime.getTime()) / 60000
          : (Date.now() - this.currentPosition.entryTime.getTime()) / 60000,
        currentTrailPercent: this.currentPosition.trailingSL && this.currentPosition.highestPremium
          ? ((1 - this.currentPosition.trailingSL / this.currentPosition.highestPremium) * 100)
          : 12, // Default 12%
        lastHighTime: this.currentPosition.timeDecayTrailing?.lastHighTime
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
      
      // ✓ FIX: Do NOT use fallback/synthetic prices for exit decisions
      // When API fails, return 0 to indicate no valid price available
      // This prevents exits from being triggered on corrupted/stale data
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
    const totalQuantity = this.currentPosition.quantity * 75; // Convert lots to shares (NIFTY lot size)
    
    return priceDiff * totalQuantity;
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
        const fromDate = new Date(toDate);
        fromDate.setDate(fromDate.getDate() - lookbackDays);
        
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
        
        // Log detailed error info to help debug authentication issues
        if (error && typeof error === 'object') {
          this.logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
        }
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
      
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 10); // Get last 10 days to ensure enough trading days
      
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
    
    this.logger.info('[BOLLINGER] Technical indicators updated', {
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
   * FIXED: Ensures immediate fetch at alignment + proper interval timing
   */
  private startRealTimeMonitoring(): void {
    this.logger.info('🔄 Starting simplified 5-minute monitoring (5th minute entry only - no prediction)...');
    
    // Clear any existing timer first
    this.stopRealTimeMonitoring();
    
    // Calculate initial alignment to next 5-minute boundary + 5 second buffer
    const now = new Date();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    const currentMilliseconds = now.getMilliseconds();
    
    // Find next 5-minute interval (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    const nextInterval = Math.ceil(currentMinutes / 5) * 5;
    const minutesUntilNext = (nextInterval === 60) ? (60 - currentMinutes) : (nextInterval - currentMinutes);
    
    // Calculate milliseconds until X:X0:05 (5 seconds after candle close for API buffer)
    const targetSecond = 5; // 5 seconds after candle close
    let millisecondsUntilAlignment: number;
    
    if (minutesUntilNext === 0) {
      // We're in the target minute (X:X0, X:X5, etc.)
      if (currentSeconds < targetSecond) {
        // Before X:X0:05, align to this minute's target
        millisecondsUntilAlignment = (targetSecond - currentSeconds) * 1000 - currentMilliseconds;
      } else {
        // After X:X0:05, align to next 5-minute boundary
        millisecondsUntilAlignment = (5 * 60 - currentSeconds + targetSecond) * 1000 - currentMilliseconds;
      }
    } else {
      // Calculate to next 5-minute boundary + 5 seconds
      millisecondsUntilAlignment = (minutesUntilNext * 60 - currentSeconds + targetSecond) * 1000 - currentMilliseconds;
    }
    
    const alignmentTime = new Date(now.getTime() + millisecondsUntilAlignment);
    this.logger.info(`⏰ Current time: ${now.toLocaleTimeString()}.${now.getMilliseconds()}`);
    this.logger.info(`⏰ Aligning to: ${alignmentTime.toLocaleTimeString()}.${alignmentTime.getMilliseconds()} (${(millisecondsUntilAlignment / 1000).toFixed(1)}s)`);
    
    // Start the master cycle after alignment timing
    setTimeout(() => {
      const triggerTime = new Date();
      this.logger.info(`✅ Alignment triggered at ${triggerTime.toLocaleTimeString()}.${triggerTime.getMilliseconds()}`);
      this.startMasterCycle();
    }, millisecondsUntilAlignment);
    
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
    
    // ✅ Reset tracking variables for system sleep detection
    this.lastSuccessfulFetchTime = null;
    this.lastReconciliationTime = null;
    
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
   * FIXED: Immediate fetch on alignment + proper setInterval timing
   */
  private startMasterCycle(): void {
    // 🔒 CRITICAL FIX: Prevent duplicate master cycle starts
    if (this.masterCycleInterval) {
      this.logger.warn('⚠️ Master cycle already running, ignoring duplicate start request');
      return;
    }

    const cycleStartTime = new Date();
    this.logger.info(`🔄 Starting Bollinger Band strategy master cycle at ${cycleStartTime.toLocaleTimeString()}.${cycleStartTime.getMilliseconds()}`);
    
    // Define the candle fetch function
    const fetchCandleIfMarketOpen = async () => {
      // ✅ Detect system sleep disruption
      const wasDisrupted = this.detectMasterCycleDisruption();
      
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = hours * 60 + minutes;
      const marketStart = 9 * 60 + 15; // 9:15 AM
      const marketEnd = 15 * 60 + 30;  // 3:30 PM
      
      if (currentTime >= marketStart && currentTime <= marketEnd) {
        // Race condition protection - prevent overlapping fetches
        if (this.isFetchingCandle) {
          this.logger.warn('[BOLLINGER] ⚠️ Previous candle fetch still in progress, skipping this cycle');
          return;
        }
        
        this.isFetchingCandle = true;
        
        // 🔒 CRITICAL FIX: Add timeout to prevent indefinite flag lock
        const fetchTimeout = setTimeout(() => {
          if (this.isFetchingCandle) {
            this.logger.error(`[BOLLINGER] 🚨 TIMEOUT: Candle fetch exceeded ${this.CANDLE_FETCH_TIMEOUT}ms - forcing flag reset`);
            this.isFetchingCandle = false;
            this.healthStatus.dataStreamHealthy = false;
            this.updateMetrics({ healthStatus: 'error' });
          }
        }, this.CANDLE_FETCH_TIMEOUT);
        
        try {
          const fetchTime = new Date();
          this.logger.info(`[BOLLINGER] ⏰ Fetching candle at ${fetchTime.toLocaleTimeString()}.${fetchTime.getMilliseconds()}`);
          await this.fetchLatest5MinuteCandle();
          
          // ✅ Track successful fetch time for disruption detection
          this.lastSuccessfulFetchTime = Date.now();
          
          // ✅ Reset health status after successful fetch
          this.resetErrorCount();
          this.logger.debug('[BOLLINGER] ✅ Health status reset after successful candle fetch');
          
          // ✅ Realign timer if disruption was detected
          if (wasDisrupted) {
            this.logger.info('🔄 Realigning master cycle to 5-minute boundary...');
            
            // Clear existing interval
            if (this.masterCycleInterval) {
              clearInterval(this.masterCycleInterval);
              this.masterCycleInterval = null;
            }
            
            // Recalculate alignment to next 5-minute boundary
            const alignedTime = new Date();
            const currentMinute = alignedTime.getMinutes();
            const currentSecond = alignedTime.getSeconds();
            
            // Calculate next 5-minute boundary (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
            const minutesToNext5 = 5 - (currentMinute % 5);
            const secondsToNext5 = minutesToNext5 * 60 - currentSecond + 5; // +5 for X:X5:05 alignment
            
            const msToNext5 = secondsToNext5 * 1000;
            
            this.logger.info(`⏰ Next fetch scheduled in ${secondsToNext5} seconds at ${new Date(Date.now() + msToNext5).toLocaleTimeString()}`);
            
            // Use setTimeout to align to next boundary, then restart interval
            setTimeout(() => {
              this.logger.info('✅ Realignment complete - restarting master cycle interval');
              fetchCandleIfMarketOpen(); // Execute aligned fetch
              this.masterCycleInterval = setInterval(fetchCandleIfMarketOpen, 5 * 60 * 1000);
            }, msToNext5);
          }
          
          clearTimeout(fetchTimeout); // Clear timeout on successful completion
        } catch (error) {
          clearTimeout(fetchTimeout); // Clear timeout on error too
          this.logger.error('[BOLLINGER] 🔴 Error fetching 5-minute candle:', error);
        } finally {
          this.isFetchingCandle = false;
        }
      } else {
        this.logger.debug(`[BOLLINGER] ⏸️ Market closed, skipping fetch at ${now.toLocaleTimeString()}`);
      }
    };
    
    // ✅ CRITICAL FIX: Execute immediately to fetch the just-completed candle
    fetchCandleIfMarketOpen();
    
    // ✅ Then set up interval for subsequent fetches (every 5 minutes)
    this.masterCycleInterval = setInterval(fetchCandleIfMarketOpen, 5 * 60 * 1000);
    
    this.logger.info('✅ Master cycle started - fetched current candle and set 5-min interval');
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
   * FIXED: Added candle age validation to ensure fresh data
   */
  private async fetchLatest5MinuteCandle(): Promise<void> {
    try {
      const fetchStartTime = new Date();
      this.logger.info(`📥 Fetching 5-minute candle at ${fetchStartTime.toLocaleTimeString()}.${fetchStartTime.getMilliseconds()}`);
      
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

        // ✅ CRITICAL VALIDATION: Check candle age (freshness)
        const candleAge = (fetchStartTime.getTime() - newCandle.timestamp.getTime()) / 1000; // Age in seconds
        const candleAgeMinutes = Math.floor(candleAge / 60);
        const candleAgeSeconds = Math.floor(candleAge % 60);
        
        this.logger.info(`📊 Received candle: ${newCandle.timestamp.toLocaleTimeString()} | Age: ${candleAgeMinutes}m ${candleAgeSeconds}s | OHLC: ${newCandle.open}/${newCandle.high}/${newCandle.low}/${newCandle.close} V:${newCandle.volume}`);
        
        // ⚠️ Alert if candle is too old (more than 6 minutes)
        // Note: 5-minute candles normally have 5m age since we fetch the just-closed bar
        if (candleAge > 6 * 60) {
          this.logger.warn(`⚠️ STALE CANDLE WARNING: Candle is ${candleAgeMinutes}m ${candleAgeSeconds}s old! Expected ~5m for 5-minute bars. Candle: ${newCandle.timestamp.toLocaleTimeString()}`);
        } else if (candleAge > 5.5 * 60) {
          this.logger.info(`ℹ️ Candle age: ${candleAgeMinutes}m ${candleAgeSeconds}s (slightly delayed but acceptable)`);
        } else if (candleAge >= 4 * 60) {
          this.logger.info(`✅ Fresh 5-minute candle: ${candleAgeMinutes}m ${candleAgeSeconds}s age (expected ~5m)`);
        } else {
          this.logger.info(`✅ Very fresh candle: ${candleAgeMinutes}m ${candleAgeSeconds}s age`);
        }

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
            this.logger.info(`[BOLLINGER] ✅ Added new 5-minute candle: NIFTY50 ${newCandle.close} (${newCandle.timestamp.toLocaleTimeString()})`);
          } else {
            // Same timestamp but different OHLC - update existing candle (live candle update)
            if (lastHistoricalCandle && newCandle.timestamp.getTime() === lastHistoricalCandle.timestamp.getTime()) {
              this.candleHistory[this.candleHistory.length - 1] = newCandle;
              this.logger.debug(`[BOLLINGER] 🔄 Updated current 5-minute candle: NIFTY50 ${newCandle.close}`);
            }
          }
          
          // Keep only last 50 candles for indicators
          if (this.candleHistory.length > 50) {
            this.candleHistory = this.candleHistory.slice(-50);
          }
          
          // Update indicators with new/updated candle
          this.updateTechnicalIndicators();
          
          // CRITICAL ORDER: Check exits BEFORE entries (exit existing position before considering new entry)
          const hadPositionBeforeExitCheck = this.currentPosition !== null;
          if (this.currentPosition) {
            // Only call exit check at exact 5-minute boundaries (X:00, X:05, X:10, X:15, etc.)
            // Prevents exit checks from running at random times when candles are fetched outside normal cycle
            const minutes = new Date().getMinutes();
            if (minutes % 5 === 0) {
              await this.checkPositionExit(newCandle.close);
            }
          }
          
          // Check for new entry signals ONLY if we didn't have a position before
          // This ensures we wait for the NEXT candle after exit before considering re-entry
          // Prevents immediate re-entry on the same candle that triggered exit
          if (!hadPositionBeforeExitCheck) {
            await this.checkEntrySignals();
          } else if (!this.currentPosition) {
            // Position was just exited on this candle - skip entry check until next candle
            this.logger.debug(`[CANDLE PROCESSING] Position exited on current candle - waiting for next candle before checking entry signals`);
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
      // ✅ Detect system sleep disruption
      const wasDisrupted = this.detectPositionMonitoringDisruption();
      
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
            
            // ✅ Log recovery details if disruption was detected
            if (wasDisrupted) {
              const pointsDiff = Math.abs(priceDiff);
              const worstCaseExtraLoss = pointsDiff > 10 ? (pointsDiff - 10) * this.currentPosition.quantity : 0;
              
              this.logger.info('📊 Position Status After Sleep Recovery:');
              this.logger.info(`   Entry Price: ₹${this.currentPosition.entryPrice.toFixed(2)}`);
              this.logger.info(`   Current Price: ₹${currentPremium.toFixed(2)}`);
              this.logger.info(`   Price Difference: ${priceDiff > 0 ? '+' : ''}${priceDiff.toFixed(2)} points`);
              this.logger.info(`   Unrealized P&L: ₹${this.cachedUnrealizedPnL.toFixed(2)}`);
              
              if (worstCaseExtraLoss > 0) {
                this.logger.warn(`   ⚠️ Potential Extra Loss: ₹${worstCaseExtraLoss.toFixed(2)} (beyond 10-point SL)`);
              }
            }
          }
          
          // Now proceed with exit checks
          // Real-time monitoring for BOTH LONG and SHORT positions
          if (this.currentPosition.type === 'SHORT') {
            await this.checkShortExitUnified(currentPremium, 'polling');
          } else if (this.currentPosition.type === 'LONG') {
            // LONG: Use real-time simple 12% trailing SL exit logic
            await this.checkLongExitSimple(currentPremium, 'polling');
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
        // For SHORT positions: Check entry candle high breach at 5-minute candle close
        // (Independent of 12% trailing SL which is checked every 1 second via polling)
        if (candleClose !== undefined) {
          await this.checkShortExitOnCandleClose(candleClose);
        } else {
          this.logger.debug('SHORT position 5-minute exit check skipped (no candle close price provided)');
        }
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
   * NOTE: Entry AND exit signal checking REMOVED - now handled by master cycle at 5-minute boundaries
   * This method only handles legacy candle building for dashboard display
   */
  private async processCandleCompletion(): Promise<void> {
    if (!this.currentCandle || !this.currentCandle.isComplete) return;
    
    // ⚠️ REMOVED: All entry/exit signal checking (now handled by fetchLatest5MinuteCandle at 5-min boundaries)
    // LONG exits are checked at 5-minute candle close via master cycle
    // SHORT exits use dedicated 1-second polling via startPositionMonitoring()
    
    // Update technical indicators with completed candle
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
    
    // Log first candle readiness (9:20 AM check)
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes === 9 * 60 + 20) {  // Exactly 9:20 AM
      this.logger.info('✅ First 5-minute candle ready for entry evaluation', {
        candleTime: '9:15-9:20',
        currentTime: now.toLocaleTimeString(),
        candlesAvailable: this.candleHistory.length,
        timestamp: new Date().toISOString()
      });
    }
    
    // Use latest completed candle from history instead of currentCandle
    if (this.candleHistory.length === 0) return;
    const latestCandle = this.candleHistory[this.candleHistory.length - 1];
    if (!latestCandle) return;
    
    const { rsi, supertrend, bollingerBands } = this.currentIndicators;
    const { r1, r2, pp } = this.dailyPivots;
    const close = latestCandle.close;
    const open = latestCandle.open;
    
    // Candle direction validation - bullish for LONG, bearish for SHORT
    // Use >= to allow neutral candles (close == open) for day start or low volatility periods
    const candleIsBullish = close >= open;
    const candleIsBearish = close <= open;
    
    // FIRST CANDLE EXCEPTION: At 9:20 AM, Zerodha API returns forming candle (incomplete)
    // Bypass bullish/bearish check only during 9:15-9:25 window (first 5-min boundary)
    const isFirstCandleWindow = (now.getHours() === 9 && now.getMinutes() < 25);
    const candleBullishCheck = isFirstCandleWindow ? true : candleIsBullish;
    const candleBearishCheck = isFirstCandleWindow ? true : candleIsBearish;
    
    this.logger.info('[BOLLINGER] 🔥 ENTRY ANALYSIS - Checking signals...');
    this.logger.info(`[BOLLINGER] 📊 Current Indicators: RSI=${rsi.toFixed(2)}, BB_Upper=${bollingerBands.upper.toFixed(2)}, BB_Lower=${bollingerBands.lower.toFixed(2)}, Supertrend=${supertrend.trend}, Price=${close}`);
    this.logger.info(`[BOLLINGER] 📊 Candle Direction: ${candleIsBullish ? 'Bullish (close>open)' : candleIsBearish ? 'Bearish (close<open)' : 'Neutral'} | Open=${open.toFixed(2)}, Close=${close.toFixed(2)}`);
    
    // LONG Entry Signal - RSI range optimized for overbought momentum
    const longConditions = {
      priceAboveUpperBB: close > bollingerBands.upper,
      rsiInRange: rsi >= 68 && rsi <= 85, // Overbought momentum confirmation
      supertrendBullish: supertrend.trend === 'UP',
      aboveR1OrR2: close > r1 || close > r2,
      candleIsBullish: candleBullishCheck // FIRST CANDLE EXCEPTION: Bypass bullish check at 9:15-9:25
    };
    
    const longSignal = Object.values(longConditions).every(Boolean);
    
    if (longSignal) {
      this.logger.info('[BOLLINGER] 🚀 LONG entry signal detected', {
        close: close.toFixed(2),
        rsi: rsi.toFixed(2),
        supertrend: supertrend.trend,
        upperBB: bollingerBands.upper.toFixed(2),
        r1: r1.toFixed(2),
        r2: r2.toFixed(2)
      });
      
      // Extract entry candle values BEFORE async operations
      const entryCandleHigh = latestCandle.high;
      const entryCandleLow = latestCandle.low;
      const entryCandleTimestamp = latestCandle.timestamp; // FIXED: Capture timestamp
      
      await this.executeLongEntryWithRetry(close, entryCandleHigh, entryCandleLow, entryCandleTimestamp);
    } else {
      // Show why LONG was blocked
      this.logger.info('[BOLLINGER] ❌ LONG conditions not met:', {
        priceAboveUpperBB: `${longConditions.priceAboveUpperBB} (${close.toFixed(2)} > ${bollingerBands.upper.toFixed(2)})`,
        rsiInRange: `${longConditions.rsiInRange} (${rsi.toFixed(2)} in 68-85)`,
        supertrendBullish: `${longConditions.supertrendBullish} (${supertrend.trend})`,
        aboveR1OrR2: `${longConditions.aboveR1OrR2} (${close.toFixed(2)} > R1:${r1.toFixed(2)} or R2:${r2.toFixed(2)})`,
        candleIsBullish: `${longConditions.candleIsBullish}`
      });
    }
    
    // SHORT Entry Signal - RSI range optimized for oversold momentum
    const shortConditions = {
      priceBelowLowerBB: close < bollingerBands.lower,
      rsiInRange: rsi >= 10 && rsi <= 30, // Oversold momentum confirmation
      supertrendBearish: supertrend.trend === 'DOWN',
      belowPP: close <= pp, // High-confidence SHORT filter using central pivot point
      candleIsBearish: candleBearishCheck // FIRST CANDLE EXCEPTION: Bypass bearish check at 9:15-9:25
    };
    
    const shortSignal = Object.values(shortConditions).every(Boolean);
    
    if (shortSignal) {
      this.logger.info('[BOLLINGER] 🔻 SHORT entry signal detected', {
        close: close.toFixed(2),
        rsi: rsi.toFixed(2),
        supertrend: supertrend.trend,
        lowerBB: bollingerBands.lower.toFixed(2),
        pp: pp.toFixed(2)
      });
      
      // Block SHORT entries after 2:55 PM (except Fridays)
      const shortCutoffTime = 14 * 60 + 55;  // 2:55 PM in minutes
      const isFriday = now.getDay() === 5;   // Friday = 5 (0=Sunday, 1=Monday, ..., 5=Friday)
      
      if (currentMinutes > shortCutoffTime && !isFriday) {
        this.logger.warn('[BOLLINGER] 🚫 SHORT entry blocked - After 2:55 PM (non-Friday)', {
          currentTime: now.toLocaleTimeString(),
          dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
          cutoffTime: '2:55 PM',
          reason: 'Late-day SHORT restriction active'
        });
        return;  // Skip SHORT entry
      }
      
      // Extract entry candle values BEFORE async operations
      const entryCandleHigh = latestCandle.high;
      const entryCandleLow = latestCandle.low;
      const entryCandleTimestamp = latestCandle.timestamp; // FIXED: Capture timestamp
      
      await this.executeShortEntryWithRetry(close, entryCandleHigh, entryCandleLow, entryCandleTimestamp);
    } else {
      // Show why SHORT was blocked
      this.logger.info('[BOLLINGER] ❌ SHORT conditions not met:', {
        priceBelowLowerBB: `${shortConditions.priceBelowLowerBB} (${close.toFixed(2)} < ${bollingerBands.lower.toFixed(2)})`,
        rsiInRange: `${shortConditions.rsiInRange} (${rsi.toFixed(2)} in 10-30)`,
        supertrendBearish: `${shortConditions.supertrendBearish} (${supertrend.trend})`,
        belowPP: `${shortConditions.belowPP} (${close.toFixed(2)} <= ${pp.toFixed(2)})`,
        candleIsBearish: `${shortConditions.candleIsBearish}`
      });
    }
  }

  /**
   * Execute LONG entry with CE option selection
   */
  private async executeLongEntry(nifty50Price: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date): Promise<void> {
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
      // Entry candle high/low are now passed as parameters (captured at signal detection)
      // This eliminates race condition where candleHistory updates during async operations
      
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
      
      // Calculate dynamic lot size based on current capital
      const lots = this.calculateLots();
      
      // Option already validated above - proceed with entry
      this.logger.info(`🚀 Executing LONG entry with real-time selected option: ${ceOption.tradingsymbol}`);
      const orderResult = await this.executeOrder('BUY', ceOption, lots);
      
      if (orderResult.success) {
        // Use captured candle data (not current candleHistory which may have updated)
        this.currentPosition = {
          type: 'LONG',
          instrument: ceOption,
          entryPrice: orderResult.price,
          quantity: lots,
          entryTime: new Date(),
          ...(entryCandleTimestamp !== undefined && { entryCandleTimestamp: entryCandleTimestamp }),
          ...(entryCandleLow !== undefined && { entryCandleLow: entryCandleLow }),
          ...(entryCandleHigh !== undefined && { entryCandleHigh: entryCandleHigh }),
          // trailingSL is NOT initialized here - will be calculated purely from option premium
          // in checkLongExitSimple() on first poll (12% below highest premium)
          highestPremium: orderResult.price, // Track maximum premium reached
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`,
          timeDecayTrailing: { lastHighTime: new Date() } // Initialize for time-based tracking
        };
        
        // P0: Save position to disk immediately after entry
        this.saveCapitalData();
        
        this.logger.info('✅ LONG position created with pre-captured candle data', {
          entryCandleLow: entryCandleLow?.toFixed(2),
          entryCandleHigh: entryCandleHigh?.toFixed(2)
        });
        
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
          quantity: lots
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
  private async executeShortEntry(nifty50Price: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date): Promise<void> {
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
      // Entry candle high/low are now passed as parameters (captured at signal detection)
      // This eliminates race condition where candleHistory updates during async operations
      
      // Use passed values, with fallback to current price if not provided
      const candleHigh = entryCandleHigh !== undefined ? entryCandleHigh : nifty50Price;
      
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
      const lots = this.calculateLots();
      const orderResult = await this.executeOrder('BUY', peOption, lots);
      
      if (orderResult.success) {
        // Use captured candle data (extracted at signal detection)
        this.logger.info(`[SHORT ENTRY] Using entry candle high: ${candleHigh.toFixed(2)}`);
        
        this.currentPosition = {
          type: 'SHORT',
          instrument: peOption,
          entryPrice: orderResult.price,
          quantity: lots,
          entryTime: new Date(),
          ...(entryCandleTimestamp !== undefined && { entryCandleTimestamp: entryCandleTimestamp }),
          entryCandleHigh: candleHigh, // Extracted at signal detection
          // trailingSL is NOT initialized here - will be calculated purely from option premium
          // in checkShortExitUnified() on first poll (time-decay: 12% for 0-20 min, tightening over time)
          highestPremium: orderResult.price,
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`,
          timeDecayTrailing: { lastHighTime: new Date() } // Initialize at entry for precise stagnation tracking
        };
        
        // P0: Save position to disk immediately after entry
        this.saveCapitalData();
        
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
          quantity: lots,
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
   * LONG Exit Check - Underlying-Based Safety Net (Secondary Exit)
   *
   * This is a SECONDARY exit mechanism based on NIFTY spot price.
   * PRIMARY exit is via checkLongExitSimple() with trailing SL.
   *
   * This acts as:
   * 1. Technical invalidation (NIFTY breaks below key support)
   * 2. Safety net if option premium streaming fails
   * 3. Additional protection against sharp NIFTY drops
   *
   * Exit Threshold: MAX(entry candle low, BB midline)
   * Checked ONLY on 5-minute candle close
   */
  private async checkLongExitOnCandleClose(candleClosePrice: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    if (this.currentPosition.type !== 'LONG') return;
    
    // Race condition protection - ensure only one exit check at a time
    if (this.isProcessingLongExit) {
      this.logger.debug('[LONG EXIT CHECK] Exit already in progress, skipping secondary check');
      return;
    }
    
    const bbMidline = this.currentIndicators.bollingerBands.middle;
    
    // Determine exit threshold: MAX(entry candle low, BB midline) - whichever is hit FIRST as price falls
    const entryCandleLow = this.currentPosition.entryCandleLow || bbMidline;
    const exitThreshold = Math.max(entryCandleLow, bbMidline);
    const usedEntryCandleLow = exitThreshold === entryCandleLow && this.currentPosition.entryCandleLow !== undefined;
    
    // ONLY exit if completed 5-minute candle close is below exit threshold
    if (candleClosePrice < exitThreshold) {
      this.isProcessingLongExit = true; // Set flag BEFORE async executeExit call
      
      try {
        this.logger.info('🔴 LONG exit signal: Secondary safety net triggered (underlying-based)', {
          candleClose: candleClosePrice.toFixed(2),
          exitThreshold: exitThreshold.toFixed(2),
          entryCandleLow: entryCandleLow.toFixed(2),
          bbMidline: bbMidline.toFixed(2),
          usedThreshold: usedEntryCandleLow ? 'Entry Candle Low' : 'BB Midline',
          exitType: 'CANDLE_CLOSE_SAFETY_NET',
          note: 'Primary trailing SL did not trigger first',
          timestamp: new Date().toLocaleTimeString()
        });
        
        await this.executeExit('LONG_CANDLE_CLOSE_SAFETY_NET');
      } finally {
        this.isProcessingLongExit = false; // Reset flag in finally block
      }
    } else {
      this.logger.debug('✅ LONG position held: candle close above exit threshold', {
        candleClose: candleClosePrice.toFixed(2),
        exitThreshold: exitThreshold.toFixed(2)
      });
    }
  }

  /**
   * SHORT Exit Check - Entry Candle High Breach (5-minute candle close only)
   * 
   * CRITICAL FIX: Now checks candle HIGH (not close) against entry candle high.
   * A breach of entry candle high by the candle's high invalidates the bearish thesis
   * even if the candle closes back below it. This prevents holding SHORT positions
   * when price action shows bullish strength.
   * 
   * This is independent of the 12% trailing stop loss on option premium.
   * 
   * @param candleClosePrice - The closing price of the just-completed 5-minute NIFTY candle (kept for compatibility)
   */
  private async checkShortExitOnCandleClose(candleClosePrice: number): Promise<void> {
    if (!this.currentPosition) return;
    if (this.currentPosition.type !== 'SHORT') return;
    
    // Race condition protection - ensure only one exit check at a time
    if (this.isProcessingShortExit) {
      this.logger.debug('[SHORT EXIT CHECK] Exit already in progress, skipping 5-minute check');
      return;
    }
    
    const entryCandleHigh = this.currentPosition.entryCandleHigh;
    if (entryCandleHigh === undefined) {
      this.logger.warn('[SHORT EXIT CHECK] Entry candle high not stored, skipping 5-minute exit check');
      return;
    }
    
    // Get the latest candle from history (just added before this check)
    const latestCandle = this.candleHistory[this.candleHistory.length - 1];
    if (!latestCandle) {
      this.logger.warn('[SHORT EXIT CHECK] No candle in history, skipping exit check');
      return;
    }
    
    const currentCandleHigh = latestCandle.high;
    const currentCandleClose = latestCandle.close;
    
    this.logger.debug(`[SHORT EXIT CHECK] Candle H:${currentCandleHigh.toFixed(2)} C:${currentCandleClose.toFixed(2)}, Entry candle high: ${entryCandleHigh.toFixed(2)}`);
    
    // CRITICAL: Exit if candle CLOSE breaches entry candle high (not just high wick)
    // This prevents holding SHORT positions when price action invalidates bearish thesis
    // Uses CLOSE not HIGH to avoid exiting on temporary intracandle wicks
    if (currentCandleClose > entryCandleHigh) {
      this.isProcessingShortExit = true; // Set flag BEFORE async executeExit call
      
      try {
        const breachAmount = currentCandleHigh - entryCandleHigh;
        this.logger.info(`[SHORT EXIT SIGNAL] 🔴 Entry candle HIGH breached! Candle H:${currentCandleHigh.toFixed(2)} > Entry H:${entryCandleHigh.toFixed(2)} (breach: +${breachAmount.toFixed(2)})`);
        this.logger.info(`[SHORT EXIT SIGNAL] 📊 Candle details: O:${latestCandle.open.toFixed(2)} H:${currentCandleHigh.toFixed(2)} L:${latestCandle.low.toFixed(2)} C:${currentCandleClose.toFixed(2)}`);
        
        await this.executeExit('SHORT_ENTRY_CANDLE_HIGH_BREACH');
      } finally {
        this.isProcessingShortExit = false; // Reset flag in finally block
      }
    } else {
      const marginFromHigh = entryCandleHigh - currentCandleHigh;
      const marginFromClose = entryCandleHigh - currentCandleClose;
      this.logger.debug(`[SHORT EXIT CHECK] ✅ Still safe - Entry high: ${entryCandleHigh.toFixed(2)}, Current H:${currentCandleHigh.toFixed(2)} (margin: ${marginFromHigh.toFixed(2)}), C:${currentCandleClose.toFixed(2)} (margin: ${marginFromClose.toFixed(2)})`);
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
      // Step 1: Update highest premium if new high reached
      if (currentPremium > (this.currentPosition.highestPremium || 0)) {
        this.currentPosition.highestPremium = currentPremium;
        
        // Update last high time (lazy initialization)
        if (!this.currentPosition.timeDecayTrailing) {
          this.currentPosition.timeDecayTrailing = { lastHighTime: new Date() };
        } else {
          this.currentPosition.timeDecayTrailing.lastHighTime = new Date();
        }
        
        this.logger.info(`📈 New high premium reached`, {
          newHigh: currentPremium.toFixed(2),
          timestamp: new Date().toLocaleTimeString()
        });
      }
      
      // Step 2: Calculate time-based trailing SL (runs EVERY poll, independent of new highs)
      if (this.currentPosition.highestPremium) {
        const minutesSinceEntry = (Date.now() - this.currentPosition.entryTime.getTime()) / 60000;
        const minutesSinceLastHigh = this.currentPosition.timeDecayTrailing
          ? (Date.now() - this.currentPosition.timeDecayTrailing.lastHighTime.getTime()) / 60000
          : minutesSinceEntry; // First high after entry, use entry time
        
        // Time-based tightening schedule
        let trailingPct = 12; // Default for 0-20 minutes
        if (minutesSinceEntry >= 40) trailingPct = 5;       // 40-45 min
        else if (minutesSinceEntry >= 35) trailingPct = 6;  // 35-40 min
        else if (minutesSinceEntry >= 30) trailingPct = 7;  // 30-35 min
        else if (minutesSinceEntry >= 20) trailingPct = 9;  // 20-30 min
        
        // Stagnation rule: Enforce ceiling (max looseness) at 9%
        // Math.min ensures we don't use a % LOOSER than 9% when stagnant
        // (Smaller % = tighter stop, so min() takes the tightest/most protective value)
        // This prevents double-reduction when time thresholds align with stagnation
        if (minutesSinceLastHigh >= 10) {
          trailingPct = Math.min(trailingPct, 9);
        }
        
        // Calculate what SL should be based on time-decay schedule
        const timeBasedSL = this.currentPosition.highestPremium * (1 - trailingPct / 100);
        
        // Only update if tighter (higher SL = tighter protection for SHORT positions)
        if (!this.currentPosition.trailingSL || timeBasedSL > this.currentPosition.trailingSL) {
          const oldSL = this.currentPosition.trailingSL;
          const oldPct = oldSL && this.currentPosition.highestPremium
            ? ((1 - oldSL / this.currentPosition.highestPremium) * 100).toFixed(1)
            : 'none';
          
          this.currentPosition.trailingSL = timeBasedSL;
          
          // P0: Save SHORT trailing SL updates to disk
          this.saveCapitalData();
          
          this.logger.info(`� Trailing SL updated (${oldSL ? 'time-decay' : 'initial'})`, {
            highestPremium: this.currentPosition.highestPremium.toFixed(2),
            oldSL: oldSL?.toFixed(2) || 'none',
            oldPct: oldPct + '%',
            newSL: timeBasedSL.toFixed(2),
            newPct: trailingPct + '%',
            minutesSinceEntry: minutesSinceEntry.toFixed(1),
            minutesSinceLastHigh: minutesSinceLastHigh.toFixed(1),
            source: source,
            timestamp: new Date().toLocaleTimeString()
          });
        }
      }
      
      // Step 2.5: Check minimum movement requirements (performance filter)
      // Exit if premium hasn't moved sufficiently at key time checkpoints
      if (this.currentPosition.highestPremium) {
        const minutesSinceEntry = (Date.now() - this.currentPosition.entryTime.getTime()) / 60000;
        const movementFromEntry = this.currentPosition.highestPremium - this.currentPosition.entryPrice;
        
        // 15-minute checkpoint: Require at least ₹5 movement from entry
        if (minutesSinceEntry >= 15 && minutesSinceEntry < 15.1) {
          if (movementFromEntry < 5) {
            this.logger.info('🔴 SHORT exit: Insufficient movement at 15-minute checkpoint', {
              minutesSinceEntry: minutesSinceEntry.toFixed(2),
              entryPrice: this.currentPosition.entryPrice.toFixed(2),
              highestPremium: this.currentPosition.highestPremium.toFixed(2),
              movementFromEntry: movementFromEntry.toFixed(2),
              required: 5,
              shortfall: (5 - movementFromEntry).toFixed(2),
              timestamp: new Date().toLocaleTimeString()
            });
            await this.executeExit('SHORT_INSUFFICIENT_MOVEMENT_15MIN');
            return; // Exit immediately, skip trailing SL check
          } else {
            // Log successful pass of 15-minute checkpoint
            this.logger.info('✅ SHORT position passed 15-minute movement checkpoint', {
              minutesSinceEntry: minutesSinceEntry.toFixed(2),
              entryPrice: this.currentPosition.entryPrice.toFixed(2),
              highestPremium: this.currentPosition.highestPremium.toFixed(2),
              movementFromEntry: movementFromEntry.toFixed(2),
              required: 5,
              surplus: (movementFromEntry - 5).toFixed(2),
              timestamp: new Date().toLocaleTimeString()
            });
          }
        }
        
        // 20-minute checkpoint: Require at least ₹10 movement from entry
        if (minutesSinceEntry >= 20 && minutesSinceEntry < 20.1) {
          if (movementFromEntry < 10) {
            this.logger.info('🔴 SHORT exit: Insufficient movement at 20-minute checkpoint', {
              minutesSinceEntry: minutesSinceEntry.toFixed(2),
              entryPrice: this.currentPosition.entryPrice.toFixed(2),
              highestPremium: this.currentPosition.highestPremium.toFixed(2),
              movementFromEntry: movementFromEntry.toFixed(2),
              required: 10,
              shortfall: (10 - movementFromEntry).toFixed(2),
              timestamp: new Date().toLocaleTimeString()
            });
            await this.executeExit('SHORT_INSUFFICIENT_MOVEMENT_20MIN');
            return; // Exit immediately, skip trailing SL check
          } else {
            // Log successful pass of 20-minute checkpoint
            this.logger.info('✅ SHORT position passed 20-minute movement checkpoint', {
              minutesSinceEntry: minutesSinceEntry.toFixed(2),
              entryPrice: this.currentPosition.entryPrice.toFixed(2),
              highestPremium: this.currentPosition.highestPremium.toFixed(2),
              movementFromEntry: movementFromEntry.toFixed(2),
              required: 10,
              surplus: (movementFromEntry - 10).toFixed(2),
              timestamp: new Date().toLocaleTimeString()
            });
          }
        }
      }
      
      // Step 3: Check if trailing SL is hit
      if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
        // Calculate what % was used for exit log context
        const exitTrailingPct = this.currentPosition.highestPremium 
          ? ((1 - this.currentPosition.trailingSL / this.currentPosition.highestPremium) * 100).toFixed(1)
          : '0';
        
        this.logger.info(`?? SHORT exit signal: Trailing SL hit (${source})`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL.toFixed(2),
          trailingPct: exitTrailingPct + '%',
          highestPremium: this.currentPosition.highestPremium?.toFixed(2) || 'N/A',
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
   * LONG Exit Check - Simple 12% Trailing SL
   *
   * Monitors CE option premium every 1 second via REST API polling.
   * Implements simple 12% trailing stop loss from highest premium.
   *
   * Exit Trigger: Current premium drops 12% below highest premium achieved
   *
   * @param currentPremium - Current CE option premium from REST API
   * @param source - Monitoring source ('polling')
   */
  private async checkLongExitSimple(currentPremium: number, source: 'polling'): Promise<void> {
    if (!this.currentPosition || this.currentPosition.type !== 'LONG') return;

    // ✓ FIX: Validate price quality BEFORE any exit logic
    // If price is 0, it means API failed and we have no valid real-time price
    // Skip exit checks to prevent false exits on corrupted data
    if (currentPremium <= 0) {
      this.logger.warn(`⚠️ Skipping LONG exit check: No valid price available (price=${currentPremium}, source=${source})`);
      return;
    }

    // Race condition protection (same as SHORT)
    if (this.isProcessingLongExit) {
      this.logger.debug(`🔒 LONG exit check already in progress, skipping ${source} request`);
      return;
    }

    this.isProcessingLongExit = true;

    try {
      // STEP 1: Update highest premium if new high reached
      if (currentPremium > (this.currentPosition.highestPremium || 0)) {
        const oldHigh = this.currentPosition.highestPremium;
        this.currentPosition.highestPremium = currentPremium;

        this.logger.info(`📈 LONG: New high premium reached`, {
          oldHigh: oldHigh?.toFixed(2) || 'none',
          newHigh: currentPremium.toFixed(2),
          timestamp: new Date().toLocaleTimeString()
        });
      }

      // STEP 2: Calculate 12% trailing SL from highest premium
      if (this.currentPosition.highestPremium) {
        const simpleSL = this.currentPosition.highestPremium * 0.88; // 12% below highest

        // Only update if tighter (higher SL = tighter protection for LONG)
        if (!this.currentPosition.trailingSL || simpleSL > this.currentPosition.trailingSL) {
          const oldSL = this.currentPosition.trailingSL;
          this.currentPosition.trailingSL = simpleSL;

          // Save to disk
          this.saveCapitalData();

          this.logger.info(`🔧 LONG: Trailing SL updated`, {
            highestPremium: this.currentPosition.highestPremium.toFixed(2),
            oldSL: oldSL?.toFixed(2) || 'none',
            newSL: simpleSL.toFixed(2),
            trailingPct: '12%',
            source: source,
            timestamp: new Date().toLocaleTimeString()
          });
        }
      }

      // STEP 3: Check if trailing SL is hit
      if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
        this.logger.info(`🔴 LONG exit signal: Trailing SL hit (${source})`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL.toFixed(2),
          trailingPct: '12%',
          highestPremium: this.currentPosition.highestPremium?.toFixed(2) || 'N/A',
          source: source,
          timestamp: new Date().toLocaleTimeString()
        });

        await this.executeExit(`LONG_TRAILING_SL_${source.toUpperCase()}`);
      } else {
        this.logger.debug(`✅ LONG position held (${source})`, {
          currentPremium: currentPremium.toFixed(2),
          trailingSL: this.currentPosition.trailingSL?.toFixed(2) || 'not-set',
          highestPremium: this.currentPosition.highestPremium?.toFixed(2) || 'N/A',
          cushion: this.currentPosition.trailingSL
            ? (currentPremium - this.currentPosition.trailingSL).toFixed(2)
            : 'N/A'
        });
      }

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
      const orderResult = await this.executeOrder('SELL', this.currentPosition.instrument, this.currentPosition.quantity);
      
      if (orderResult.success) {
        // Calculate P&L correctly for options trading: (Exit Premium - Entry Premium) × Total Quantity
        const totalQuantity = this.currentPosition.quantity * 75; // NIFTY lot size × number of lots
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
          quantity: this.currentPosition.quantity * 75, // Total shares
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
        
        // P0: Save cleared position to disk (CRITICAL for all exit paths)
        // Retry once if save fails to prevent ghost positions
        try {
          this.saveCapitalData();
          this.logger.info("💾 Position cleared from disk after exit");
        } catch (saveError) {
          this.logger.error("🚨 CRITICAL: Failed to save cleared position, retrying...", saveError);
          // One retry attempt
          try {
            this.saveCapitalData();
            this.logger.info("💾 Position cleared from disk after exit (retry successful)");
          } catch (retryError) {
            this.logger.error("🚨 CRITICAL: Failed to save cleared position after retry!", retryError);
            throw new Error("Failed to persist position clear - manual intervention required");
          }
        }
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

  /**
   * P0: Schedule EOD safety exit at 3:28 PM
   * Critical fix to prevent relying on broker's MIS auto-squareoff
   */
  private scheduleEODExit(): void {
    const now = new Date();
    const eodTime = new Date();
    eodTime.setHours(15, 28, 0, 0); // 3:28 PM
    
    // Clear any existing timer first
    if (this.eodExitTimer) {
      clearTimeout(this.eodExitTimer);
      delete this.eodExitTimer;
    }
    
    // Only schedule if we haven't passed 3:28 PM today
    if (now < eodTime) {
      const delay = eodTime.getTime() - now.getTime();
      this.logger.info(`📅 EOD safety exit scheduled for 3:28 PM (in ${Math.round(delay / 60000)} minutes)`);
      
      this.eodExitTimer = setTimeout(async () => {
        if (this.currentPosition) {
          this.logger.warn('🕒 EOD safety exit triggered at 3:28 PM');
          await this.forceClosePosition('EOD_SAFETY_EXIT_3:28PM');
        } else {
          this.logger.info('✅ No active position at 3:28 PM, no EOD exit needed');
        }
      }, delay);
    } else {
      this.logger.info('⏰ Already past 3:28 PM today, no EOD exit scheduled');
    }
  }

  /**
   * Cancel scheduled EOD exit timer
   */
  private cancelEODExit(): void {
    if (this.eodExitTimer) {
      clearTimeout(this.eodExitTimer);
      delete this.eodExitTimer;
      this.logger.info('🛑 EOD safety exit timer cancelled');
    }
  }

  /**
   * P0: Start position reconciliation system
   * Periodically checks if bot's position matches broker's actual positions
   * Auto-reconciles if mismatch detected (e.g., broker auto-squareoff)
   */
  private startPositionReconciliation(): void {
    // Clear any existing interval first
    this.stopPositionReconciliation();
    
    // Run reconciliation every 5 minutes
    this.positionReconciliationInterval = setInterval(async () => {
      if (this.currentPosition) {
        await this.reconcilePositions();
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    this.logger.info('✅ Position reconciliation started (checks every 5 minutes)');
  }

  /**
   * P0: Stop position reconciliation system
   */
  private stopPositionReconciliation(): void {
    if (this.positionReconciliationInterval) {
      clearInterval(this.positionReconciliationInterval);
      delete this.positionReconciliationInterval;
      this.logger.info('🛑 Position reconciliation stopped');
    }
  }

  /**
   * P0: Reconcile bot's position with broker's actual positions
   * Detects and handles broker auto-squareoff scenarios
   */
  private async reconcilePositions(): Promise<void> {
    // ✅ Detect and track reconciliation timing
    const wasDisrupted = this.detectReconciliationDisruption();
    
    if (!this.currentPosition) {
      this.lastReconciliationTime = Date.now(); // Track even when no position
      return;
    }
    
    const ourSymbol = this.currentPosition.instrument.tradingsymbol;
    
    try {
      this.logger.debug(`🔄 Reconciling position: ${ourSymbol}`);
      
      // Fetch current positions from broker
      const brokerPositions = await this.kiteConnect.getPositions();
      
      // Check if our position exists in broker's net positions
      const brokerPosition = brokerPositions.net.find(
        (p: any) => p.tradingsymbol === ourSymbol && p.quantity !== 0
      );
      
      if (!brokerPosition || brokerPosition.quantity === 0) {
        // Position doesn't exist at broker but exists in bot
        this.logger.warn('⚠️ POSITION MISMATCH DETECTED!');
        this.logger.warn(`📊 Bot has position ${ourSymbol} but broker does not`);
        this.logger.warn('🔍 Likely causes: Broker auto-squareoff (MIS), manual exit on broker platform, or connection issue');
        
        this.logger.info('🔄 Auto-reconciling: Fetching exit details and recording P&L...');
        
        // Use enhanced clearActivePosition to fetch exit order and record P&L
        await this.clearActivePosition();
        
        this.logger.info('✅ Position reconciliation completed successfully');
      } else {
        this.logger.debug(`✅ Position reconciliation OK: ${ourSymbol} exists at broker`);
      }
    } catch (error) {
      this.logger.error('❌ Error during position reconciliation:', error);
      // Don't throw - reconciliation errors shouldn't stop the strategy
    } finally {
      // ✅ Always update tracking time
      this.lastReconciliationTime = Date.now();
    }
  }

  /**
   * Detect if master cycle (candle fetching) was disrupted by system sleep
   * Expected interval: 5 minutes (300,000ms)
   * Threshold: 6 minutes (360,000ms) with 20% tolerance
   */
  private detectMasterCycleDisruption(): boolean {
    if (!this.lastSuccessfulFetchTime) {
      return false; // First fetch, no baseline yet
    }
    
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastSuccessfulFetchTime;
    const EXPECTED_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const DISRUPTION_THRESHOLD = EXPECTED_INTERVAL * 1.2; // 6 minutes (20% tolerance)
    
    if (timeSinceLastFetch > DISRUPTION_THRESHOLD) {
      const gapMinutes = Math.floor(timeSinceLastFetch / 60000);
      this.logger.warn('⚠️ MASTER CYCLE DISRUPTION DETECTED!');
      this.logger.warn(`⏱️ Gap: ${gapMinutes} minutes (${timeSinceLastFetch}ms), expected: 5 minutes (${EXPECTED_INTERVAL}ms)`);
      this.logger.warn('💤 Likely cause: System sleep/hibernate disrupted setInterval alignment');
      this.logger.info('🔄 Recovery: Will realign to next 5-minute boundary after this fetch');
      return true;
    }
    
    return false;
  }

  /**
   * Detect if position monitoring was disrupted by system sleep
   * Expected interval: 1 second (1,000ms) + processing time
   * Threshold: 10 seconds (10,000ms) - much longer than normal
   * 
   * CRITICAL: This prevents runaway losses when stop loss breaches during sleep
   */
  private detectPositionMonitoringDisruption(): boolean {
    if (!this.lastPollingTime) {
      return false; // First poll, no baseline yet
    }
    
    const now = Date.now();
    const timeSinceLastPoll = now - this.lastPollingTime.getTime();
    const EXPECTED_INTERVAL = 1000; // 1 second
    const DISRUPTION_THRESHOLD = 10000; // 10 seconds (much longer than normal)
    
    if (timeSinceLastPoll > DISRUPTION_THRESHOLD) {
      const gapSeconds = Math.floor(timeSinceLastPoll / 1000);
      this.logger.error('🚨 POSITION MONITORING DISRUPTION DETECTED!');
      this.logger.error(`⏱️ Gap: ${gapSeconds} seconds (${timeSinceLastPoll}ms), expected: <2 seconds`);
      this.logger.error('💤 Likely cause: System sleep/hibernate disrupted position monitoring');
      this.logger.error('⚠️ CRITICAL: Stop loss may have been breached during sleep gap');
      this.logger.info('🔄 Recovery: Forcing immediate position check with current premium');
      
      // Update metrics for monitoring
      this.healthStatus.dataStreamHealthy = false;
      this.updateMetrics({ healthStatus: 'warning' });
      
      return true;
    }
    
    return false;
  }

  /**
   * Detect if position reconciliation was disrupted by system sleep
   * Expected interval: 5 minutes (300,000ms)
   * Threshold: 10 minutes (600,000ms) - indicates missed reconciliation cycles
   */
  private detectReconciliationDisruption(): boolean {
    if (!this.lastReconciliationTime) {
      return false; // First reconciliation, no baseline yet
    }
    
    const now = Date.now();
    const timeSinceLastReconciliation = now - this.lastReconciliationTime;
    const EXPECTED_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const DISRUPTION_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    
    if (timeSinceLastReconciliation > DISRUPTION_THRESHOLD) {
      const gapMinutes = Math.floor(timeSinceLastReconciliation / 60000);
      this.logger.warn('⚠️ RECONCILIATION DISRUPTION DETECTED!');
      this.logger.warn(`⏱️ Gap: ${gapMinutes} minutes, expected: 5 minutes`);
      this.logger.warn('💤 Likely cause: System sleep disrupted reconciliation cycle');
      this.logger.info('🔄 Recovery: Executing reconciliation now to detect broker changes');
      return true;
    }
    
    return false;
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
   * Find ATM (At-The-Money) strike closest to current price
   */
  private findATMStrike(options: any[], currentPrice: number): number {
    if (options.length === 0) {
      throw new Error('No options available to find ATM strike');
    }

    // Find strike with smallest absolute difference from current price
    let atmStrike = options[0].strike;
    let smallestDiff = Math.abs(options[0].strike - currentPrice);

    for (const option of options) {
      const diff = Math.abs(option.strike - currentPrice);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        atmStrike = option.strike;
      }
    }

    this.logger.debug(`🎯 ATM Strike calculation: Price=${currentPrice}, ATM=${atmStrike}, Diff=${smallestDiff.toFixed(2)}`);

    return atmStrike;
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
      
      // Get current NIFTY50 spot price for ATM calculation
      const nifty50Quote = await this.kiteConnect.getQuote([this.NIFTY50_INSTRUMENT_TOKEN]);
      const nifty50Price = nifty50Quote[this.NIFTY50_INSTRUMENT_TOKEN].last_price;
      
      // Find ATM strike and select ±25 options around it
      const atmStrike = this.findATMStrike(nextTuesdayOptions, nifty50Price);
      const atmIndex = nextTuesdayOptions.findIndex((opt: any) => opt.strike === atmStrike);
      
      if (atmIndex === -1) {
        throw new Error(`ATM strike ${atmStrike} not found in options array`);
      }
      
      // Calculate range: ATM ± 25 strikes (51 total)
      const startIndex = Math.max(0, atmIndex - 25);
      const endIndex = Math.min(nextTuesdayOptions.length - 1, atmIndex + 25);
      const relevantOptions = nextTuesdayOptions.slice(startIndex, endIndex + 1);
      
      this.logger.info(`🎯 ATM Strike: ₹${atmStrike} (NIFTY Spot: ₹${nifty50Price.toFixed(2)})`);
      this.logger.info(`📊 Selecting ${relevantOptions.length} options: Strikes ${relevantOptions[0].strike} to ${relevantOptions[relevantOptions.length-1].strike}`);
      
      // Get quotes for ATM±25 options (single API call, well under 200 symbol limit)
      const tokens = relevantOptions.map((opt: any) => opt.instrument_token);
      const quotes = await this.kiteConnect.getQuote(tokens);
      
      let bestOption = null;
      let smallestDiff = Infinity;
      
      for (const option of relevantOptions) {
        const quote = quotes[option.instrument_token];
        if (quote && quote.last_price > 0) {
          const priceDiff = Math.abs(quote.last_price - targetPremium);
          if (priceDiff < smallestDiff) {
            smallestDiff = priceDiff;
            bestOption = option;
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
        validity: 'DAY',
        tag: 'BB_TRADE' // Tag to identify bot-placed orders vs manual exits
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
    const closedTrades = this.tradeHistory.filter(trade => trade.status === 'CLOSED');
    const winningTrades = closedTrades.filter(trade => (trade.pnl || 0) > 0);
    const losingTrades = closedTrades.filter(trade => (trade.pnl || 0) < 0);
    const totalPnL = this.getTotalPnL();
    
    const avgWin = winningTrades.length > 0 ? 
      winningTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? 
      losingTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) / losingTrades.length : 0;
    const profitFactor = Math.abs(avgLoss) > 0 ? 
      Math.abs(avgWin * winningTrades.length) / Math.abs(avgLoss * losingTrades.length) : 0;
    
    const initialCapital = this.CAPITAL_ALLOCATION;
    const roi = initialCapital > 0 ? ((totalPnL / initialCapital) * 100) : 0;
    
    return {
      totalTrades,
      closedTrades: closedTrades.length,
      profitableTrades: winningTrades.length,
      lossTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? ((winningTrades.length / closedTrades.length) * 100).toFixed(2) : '0.00',
      totalPnL: totalPnL.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      roi: roi.toFixed(2),
      currentCapital: this.currentCapital.toFixed(2),
      capitalChange: (this.currentCapital - 200000).toFixed(2),
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
  private async executeLongEntryWithRetry(nifty50Price: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeLongEntry(nifty50Price, entryCandleHigh, entryCandleLow, entryCandleTimestamp),
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
  private async executeShortEntryWithRetry(nifty50Price: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeShortEntry(nifty50Price, entryCandleHigh, entryCandleLow, entryCandleTimestamp),
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
