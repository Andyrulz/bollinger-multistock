import * as path from 'path';
import { Logger } from '../../utils/Logger';
import { StrategyBase, StrategyConfig, StrategyStatus } from '../../core/StrategyBase';
import { StrategyManager } from '../../core/StrategyManager';

/**
 * Bollinger Band Strategy - Complete Implementation
 * Signal Instrument: Stock Spot (from config.instruments[0], e.g., BRITANNIA, TCS)
 * Trades stock options based on stock spot price signals
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
  instrument: any; // Contains lot_size field from Zerodha (e.g., 65 for NIFTY options as of Dec 2025)
  entryPrice: number;
  quantity: number; // Number of lots (e.g., 4 lots). Total shares = quantity × instrument.lot_size
  entryTime: Date;
  entryCandleTimestamp?: Date; // FIXED: Timestamp of entry candle for verification
  entryCandleLow?: number;     // NEW: Store entry candle's low for LONG SL logic
  entryCandleHigh?: number;    // NEW: Store entry candle's high (for future use)
  entryStockPrice?: number;    // Stock price at entry (for Emergency Hard Stop)
  entryCandle15MinTimestamp?: Date;  // For RSI exit tracking (which 15-min candle we entered on)
  trailingSL?: number;
  highestPremium?: number;
  entryOrderId: string;        // Store real order ID from KiteConnect
  exitOrderId?: string;        // Store exit order ID when position closed
  
  // Time-decay trailing stop tracking (SHORT positions only)
  timeDecayTrailing?: {
    lastHighTime: Date;        // When did we last see a new high premium?
  };
  
  // Breakout candle HIGH/LOW validation (first-breakout entries only)
  breakoutValidation?: {
    breakoutCandleHigh: number;       // HIGH of the breakout candle
    breakoutCandleLow: number;        // LOW of the breakout candle
    breakoutCandleTimestamp: Date;    // Timestamp of the breakout candle
    candlesSinceBreakout: number;     // Counter: 0 at entry, incremented each candle
    bestHighSinceBreakout: number;    // Running max HIGH of subsequent candles (LONG)
    bestLowSinceBreakout: number;     // Running min LOW of subsequent candles (SHORT)
    validated: boolean;               // true once HIGH/LOW taken out, or pre-validated for 2nd candle entry
  };

  // RSI Quick Reversal Confirmation (F7 filter)
  // After entry, checks stock RSI on each 5-min candle for 2 candles.
  // If LONG RSI < 62 or SHORT RSI > 32 → exit immediately.
  rsiConfirmation?: {
    candlesSinceEntry: number;     // Counter: 0 at entry, incremented each candle
    maxCandles: number;            // Window size (2)
    threshold: number;             // LONG: 62, SHORT: 32
    direction: 'LONG' | 'SHORT';  // Used to determine comparison direction
    confirmed: boolean;            // true once window expires without breach
    entryRsi: number;              // RSI at entry time (for logging context)
  };
}

export class BollingerBandStrategy extends StrategyBase {
  
  // Configuration constants - Default capital per slot
  private readonly INITIAL_CAPITAL = 65000;
  
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
  private previousDayClose: number = 0;  // For Extended Gap Trap filter
  private previousDayHigh: number = 0;   // For LONG entry: price > PDH condition  (0 = uninitialized)
  private previousDayLow: number = 0;    // For SHORT entry: price < PDL condition (0 = uninitialized)
  private pivotsLoaded: boolean = false;  // Guard: true only after PDH/PDL/PDC are loaded from market data
  
  // Signal instrument token (stock spot from config.instruments[0], e.g., BRITANNIA, TCS)
  private signalInstrumentToken: number = 0; // Will be fetched dynamically from stock symbol
  private signalSymbol: string = ''; // Store the stock symbol for logging
  
  // Position management
  private currentPosition: Position | null = null;
  
  // 5-minute candle building
  private currentCandle: CurrentCandle | null = null;
  
  // Real-time monitoring
  private ltpPollingInterval: NodeJS.Timeout | null = null;
  private currentStockLTP: number = 0; // Current LTP of signal stock
  private candleCheckInterval: NodeJS.Timeout | null = null;
  
  // Race condition protection for position exit processing
  private isProcessingShortExit: boolean = false;
  private isProcessingLongExit: boolean = false;
  
  // Race condition protection for manual position clearing
  private isClearingPosition: boolean = false;
  
  // Race condition protection for position entry processing
  private isExecutingLongEntry: boolean = false;
  private isExecutingShortEntry: boolean = false;
  
  // Shared InstrumentCache for efficient NFO data access
  private instrumentCache: any;
  
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
  
  // Emergency Hard Stop monitoring (flash crash protection)
  private emergencyStopInterval: NodeJS.Timeout | null = null;
  private readonly EMERGENCY_STOP_PERCENT = 5.0;      // 5% disaster threshold
  private readonly EMERGENCY_POLL_INTERVAL_MS = 30000; // 30 seconds between checks
  
  // EOD safety exit timer
  private eodExitTimer?: NodeJS.Timeout;
  
  // Position reconciliation timer
  private positionReconciliationInterval?: NodeJS.Timeout;

  // Health monitoring interval (must be cleared on stop to prevent leak on rebalance)
  private healthMonitorInterval: NodeJS.Timeout | null = null;
  // Daily cache refresh timeout (must be cleared on stop to prevent phantom fire)
  private dailyCacheRefreshTimer: NodeJS.Timeout | null = null;

  // Option RSI Climax Exit tracking (Gamma Climax detection)
  private optionRsiInterval: NodeJS.Timeout | null = null;
  private optionRsiInitialTimeout: NodeJS.Timeout | null = null;
  private readonly OPTION_RSI_CHECK_INTERVAL = 15 * 60 * 1000;  // 15 minutes
  private readonly OPTION_RSI_CLIMAX_THRESHOLD = 85;  // RSI >= 85 = Gamma Climax
  private readonly OPTION_RSI_MICRO_GRACE_SECONDS = 60;  // 60-second micro-grace to prevent double-fire

  // RSI-Activated Live Premium Trailing Stop (SHORT trades only)
  // When 5-min option RSI crosses 85, activates live polling with candle-LOW trailing floor
  private rsiTrailActivated: boolean = false;
  private rsiTrailFloorPrice: number = 0;
  private rsiTrailActivationRsi: number = 0;
  private rsiTrailPollingInterval: NodeJS.Timeout | null = null;
  private rsiTrail5MinCheckInterval: NodeJS.Timeout | null = null;
  private rsiTrail5MinInitialTimeout: NodeJS.Timeout | null = null;
  private readonly RSI_TRAIL_ACTIVATION_THRESHOLD = 85;   // 5-min option RSI >= 85 to activate
  private readonly RSI_TRAIL_SECONDARY_EXIT_THRESHOLD = 75; // 5-min RSI < 75 on candle close = exit
  private readonly RSI_TRAIL_POLL_INTERVAL_MS = 5000;      // 5 seconds between live premium polls

  // F7: RSI Quick Reversal Confirmation
  private readonly RSI_CONFIRMATION_WINDOW = 2;            // Number of candles to monitor (10 min)
  private readonly RSI_CONFIRMATION_LONG_THRESHOLD = 62;   // LONG: exit if RSI drops below this
  private readonly RSI_CONFIRMATION_SHORT_THRESHOLD = 32;  // SHORT: exit if RSI rises above this

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
  // SLOT-BASED: Capital persists at SLOT level, not stock level
  // Same slot can hold different stocks each day, but capital carries forward
  private currentCapital: number = 65000; // Default capital per slot
  private tradeHistory: any[] = [];
  private BOLLINGER_DATA_FILE: string; // Set in constructor based on slot number

  // Retry infrastructure for error recovery
  private candleRetryTimer?: NodeJS.Timeout;
  private readonly MAX_RETRY_ATTEMPTS = 10; // For critical operations
  private readonly CANDLE_RETRY_INTERVAL = 10000; // 10 seconds for candle fetch
  private readonly TRADE_RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s exponential backoff

  // Master cycle timing and state
  private masterCycleInterval: NodeJS.Timeout | null = null;
  private alignmentTimer: NodeJS.Timeout | null = null; // 🔒 CRITICAL: Track alignment setTimeout to prevent zombie strategies
  private currentCyclePhase: 'waiting' | '4th-minute' | '5th-minute' | '6th-minute' = 'waiting';
  private lastSuccessfulFetchTime: number | null = null; // Track last candle fetch for system sleep detection
  private lastReconciliationTime: number | null = null; // Track last reconciliation for system sleep detection
  
  // 🚀 RESOURCE EFFICIENCY: Slot index for staggered execution (0, 1, 2)
  // Prevents all 3 slots from firing API calls simultaneously
  private readonly slotIndex: number;
  
  // 🔒 CRITICAL FIX: Add timeout for candle fetch operations
  private readonly CANDLE_FETCH_TIMEOUT = 45000; // 45 seconds max for API calls

  constructor(kiteConnect: any, logger: Logger, quoteManager: any, instrumentCache: any, config: StrategyConfig) {
    super(kiteConnect, logger, config);
    // Store InstrumentCache for efficient NFO data access (avoids repeated 15MB API calls)
    this.instrumentCache = instrumentCache;
    
    // SLOT-BASED DATA FILE: Use strategyIndex from scanner config (0-indexed)
    // Scanner passes strategyIndex: 0, 1, 2 for first 3 stocks
    // Slot numbers are 1-indexed: slot1, slot2, slot3
    this.slotIndex = (config as any).config?.strategyIndex ?? 0;
    const slotNumber = this.slotIndex + 1;
    this.BOLLINGER_DATA_FILE = path.join(__dirname, `../../data/bollinger-slot${slotNumber}.json`);
    this.logger.info(`📁 Slot ${slotNumber}: Using data file ${this.BOLLINGER_DATA_FILE} (stagger offset: ${this.slotIndex}s)`);
    
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
        this.currentCapital = data.capital || this.INITIAL_CAPITAL;
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
        this.logger.info(`Bollinger Band capital initialized at Rs.${this.INITIAL_CAPITAL.toLocaleString()}`);
      }
    } catch (error) {
      this.logger.error('Error loading Bollinger Band capital data:', error);
      this.currentCapital = this.INITIAL_CAPITAL; // Fallback to initial capital
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
        rsiTrailState: this.currentPosition ? {
          activated: this.rsiTrailActivated,
          floorPrice: this.rsiTrailFloorPrice,
          activationRsi: this.rsiTrailActivationRsi
        } : null,
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
      
      // 🛡️ ZOMBIE POSITION GUARD: Prevent position recovery from different stock
      // Scenario: Slot 1 had INFY yesterday (crashed before EOD exit), Scanner assigns TCS today
      // The old INFY position MUST NOT be recovered into the TCS strategy instance
      const savedTradingsymbol = position.instrument?.tradingsymbol || '';
      const savedInstrumentName = position.instrument?.name || '';
      // Extract underlying - prefer instrument.name for symbols with special chars (M&M, BAJAJ-AUTO, L&TFH)
      // Regex handles &, - in symbols (e.g., "M&M26FEB3650CE" → "M&M", "BAJAJ-AUTO26FEB9500PE" → "BAJAJ-AUTO")
      const extractedBaseSymbol = savedTradingsymbol.match(/^([A-Z][A-Z&-]*)/)?.[1];
      const savedBaseSymbol = savedInstrumentName || extractedBaseSymbol;
      const currentConfigSymbol = this.config.instruments?.[0]; // e.g., "INFY" or "M&M"
      
      if (savedBaseSymbol && currentConfigSymbol && savedBaseSymbol !== currentConfigSymbol) {
        this.logger.warn(`⚠️ ZOMBIE POSITION DETECTED in Slot!`);
        this.logger.warn(`   Saved Position Symbol: ${savedTradingsymbol} (Base: ${savedBaseSymbol})`);
        this.logger.warn(`   Current Slot Expects: ${currentConfigSymbol}`);
        this.logger.warn(`   ⚠️ PURGING ghost position from memory. Capital preserved.`);
        this.logger.warn(`   ⚠️ ACTION REQUIRED: Manually verify/close ${savedTradingsymbol} in broker terminal!`);
        this.logger.warn(`   Capital (₹${data.capital}) retained for P&L continuity.`);
        
        // Purge the ghost position from disk to prevent repeated warnings
        this.currentPosition = null;
        this.saveCapitalData(); // This saves capital but clears activePosition
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
        
        // Convert breakoutValidation.breakoutCandleTimestamp if exists
        if (this.currentPosition.breakoutValidation?.breakoutCandleTimestamp) {
          this.currentPosition.breakoutValidation.breakoutCandleTimestamp = new Date(this.currentPosition.breakoutValidation.breakoutCandleTimestamp);
        }
      }
      
      // Restore RSI Trail state if it was persisted
      if (data.rsiTrailState && this.currentPosition?.type === 'SHORT') {
        this.rsiTrailActivated = data.rsiTrailState.activated || false;
        this.rsiTrailFloorPrice = data.rsiTrailState.floorPrice || 0;
        this.rsiTrailActivationRsi = data.rsiTrailState.activationRsi || 0;
        if (this.rsiTrailActivated) {
          this.logger.info(`🔄 RSI Trail state recovered: activated=true, floor=₹${this.rsiTrailFloorPrice.toFixed(2)}, activationRsi=${this.rsiTrailActivationRsi.toFixed(1)}`);
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
        
        // Start Emergency Hard Stop monitoring if we have entry stock price
        if (this.currentPosition?.entryStockPrice) {
          this.startEmergencyStopMonitoring();
        } else {
          this.logger.warn('⚠️ Cannot start Emergency Hard Stop - no entry stock price in recovered position');
        }
        
        // P0: Start Option RSI Climax monitoring for recovered positions
        this.startOptionRsiMonitoring();
        
        // Start RSI-Activated Live Premium Trailing Stop for recovered SHORT positions
        if (this.currentPosition?.type === 'SHORT') {
          this.startRsiTrail5MinMonitoring();
          // If trail was activated before restart, also resume live polling
          if (this.rsiTrailActivated && this.rsiTrailFloorPrice > 0) {
            this.startRsiTrailLivePolling();
          }
        }
        
        // NOTE: shortMonitoringInterval validation REMOVED - polling-based monitoring was replaced
        // by 5-min candle close exits (master cycle). Exit protection is provided by:
        // 1. Master cycle (startMasterCycle → fetchLatest5MinuteCandle → checkPositionExit)
        // 2. Emergency Hard Stop (startEmergencyStopMonitoring - already started above)
        // 3. Option RSI Climax (startOptionRsiMonitoring - already started above)
        // 4. RSI Trail (startRsiTrail5MinMonitoring - already started above for SHORT)
        // 5. EOD Safety Exit (scheduleEODExit - starts in start())
        
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
      
      // Step 1: Get signal instrument token dynamically from config
      // This fetches the stock's instrument token (e.g., BRITANNIA, TCS) for signal generation
      const { token, symbol } = await this.getSignalInstrumentToken();
      this.signalInstrumentToken = token;
      this.signalSymbol = symbol;
      
      this.logger.info(`🎯 Signal Instrument: ${this.signalSymbol} (Token: ${this.signalInstrumentToken})`);
      
      // Step 1b: Load historical candle data with fallback for pre-market hours
      await this.loadHistoricalDataWithFallback();
      
      // Step 2: Calculate daily pivots (use fallback if needed)
      await this.calculateDailyPivotsWithFallback();
      
      // Step 3: Initialize technical indicators
      this.updateTechnicalIndicators();
      
      // Step 4: Schedule daily cache refresh at 3:25 PM
      this.scheduleDailyCacheRefresh();
      
      // Step 5: P0 - Recover active position if exists
      await this.recoverActivePosition();
      
      // Step 6: Validate capital consistency on startup
      const validation = this.validateCapitalConsistency();
      if (!validation.valid) {
        this.logger.warn('⚠️ Capital validation failed - manual review recommended', {
          difference: validation.difference.toFixed(2)
        });
      }
      
      this._isInitialized = true;
      this.logger.info('BollingerBandStrategy: Initialization complete', {
        signalInstrument: this.signalSymbol,
        instrumentToken: this.signalInstrumentToken,
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
    
    // Stop Emergency Hard Stop monitoring
    this.stopEmergencyStopMonitoring();
    
    // P0: Stop Option RSI Climax monitoring
    this.stopOptionRsiMonitoring();
    
    // Stop RSI Trail monitoring (5-min checks + live polling)
    this.stopRsiTrailMonitoring();
    
    // Stop all monitoring
    this.stopRealTimeMonitoring();
    
    // Stop retry mechanisms
    this.stopCandleRetryMechanism();
    
    // P0: Cancel EOD exit timer
    this.cancelEODExit();
    
    // P0: Stop position reconciliation
    this.stopPositionReconciliation();
    
    // Stop health monitoring interval (prevents leak on rebalance SWAP)
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
    
    // Cancel daily cache refresh timeout (prevents phantom fire on stopped strategy)
    if (this.dailyCacheRefreshTimer) {
      clearTimeout(this.dailyCacheRefreshTimer);
      this.dailyCacheRefreshTimer = null;
    }
    
    // Predictive WebSocket removed - using real-time selection
    
    // 🔒 CRITICAL: Do NOT force close positions on stop!
    // Positions should persist across restarts for recovery
    // The position data is saved to disk and will be recovered on next start
    if (this.currentPosition) {
      this.logger.warn('⚠️ Strategy stopping with ACTIVE POSITION - position will be preserved for recovery');
      this.logger.warn(`   Position: ${this.currentPosition.instrument?.tradingsymbol} | Entry: ₹${this.currentPosition.entryPrice}`);
    }
    
    // 🔒 CRITICAL FIX: ALWAYS save on stop(), not just when position exists
    // This ensures recently-closed trades (tradeHistory entries) are flushed to disk
    // before the strategy instance is destroyed. Without this, a race condition between
    // executeExit() pushing to tradeHistory and scanner's swapStrategy() calling stop()
    // can cause completed trades to be lost forever.
    this.saveCapitalData();
    this.logger.info('💾 Strategy data saved to disk on stop()');
    
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
      const totalQuantity = quantity * this.currentPosition.instrument.lot_size; // Use instrument's actual lot size
      const pnl = (exitPrice - entryPrice) * totalQuantity;
      
      // Update capital with P&L
      this.currentCapital += pnl;
      
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
      
      // P0-FIX: Record symbol exit for cooldown tracking (prevents immediate re-entry)
      // This applies even for manual/broker exits detected via reconciliation
      if (positionSymbol) {
        const baseSymbol = positionSymbol.replace(/\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}(CE|PE)\d+$/, '');
        StrategyManager.recordSymbolExitStatic(baseSymbol);
        this.logger.info(`🔒 Cooldown applied for ${baseSymbol} (30 min block after manual/broker exit)`);
      }
      
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
      // Include ALL SELL orders (manual exits may or may not have tags)
      let exitCandidates = orders.filter((order: any) => {
        const orderTime = new Date(order.order_timestamp);
        return order.tradingsymbol === symbol
          && order.transaction_type === 'SELL'
          && order.status === 'COMPLETE'
          && orderTime > entryTime;
      });
      
      if (exitCandidates.length === 0) {
        this.logger.warn(`⚠️ No SELL orders found for ${symbol} after ${entryTime.toLocaleTimeString()}`);
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
      this.previousDayHigh = 0;
      this.previousDayLow = 0;
      this.previousDayClose = 0;
      this.pivotsLoaded = false;
      this.currentCandle = null;
      this.currentStockLTP = 0;
      
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

  /**
   * Get real-time entry analysis for dashboard display
   * Returns current conditions for LONG and SHORT entries
   */
  private getEntryAnalysis(): any {
    const price = this.getLastCompletedCandleClose();
    const indicators = this.currentIndicators;
    const pivots = this.dailyPivots;
    
    if (!indicators || !pivots || price === 0) {
      return {
        long: { conditions: [], metCount: 0, totalCount: 4, strength: 'NO_DATA' },
        short: { conditions: [], metCount: 0, totalCount: 4, strength: 'NO_DATA' }
      };
    }
    
    const { rsi, supertrend, bollingerBands } = indicators;
    const { r1, r2, s1, pp } = pivots;
    
    // LONG conditions (4 main conditions - excluding candle direction which is checked at entry time)
    const longConditions = [
      {
        name: 'Price > BB Upper',
        met: price > bollingerBands.upper,
        detail: `₹${price.toFixed(2)} ${price > bollingerBands.upper ? '>' : '<='} ₹${bollingerBands.upper.toFixed(2)}`
      },
      {
        name: 'RSI 68-85',
        met: rsi >= 68 && rsi <= 85,
        detail: `${rsi.toFixed(2)} ${rsi >= 68 && rsi <= 85 ? 'in range' : 'out of range'}`
      },
      {
        name: 'Supertrend UP',
        met: supertrend.trend === 'UP',
        detail: supertrend.trend
      },
      {
        name: 'Above R1 or PDH',
        met: price > r1 || price > this.previousDayHigh,
        detail: `₹${price.toFixed(2)} ${price > r1 ? '> R1(' + r1.toFixed(2) + ')' : price > this.previousDayHigh ? '> PDH(' + this.previousDayHigh.toFixed(2) + ')' : '< R1(' + r1.toFixed(2) + ') & PDH(' + this.previousDayHigh.toFixed(2) + ')'}`
      }
    ];
    
    // SHORT conditions (4 main conditions)
    const shortConditions = [
      {
        name: 'Price < BB Lower',
        met: price < bollingerBands.lower,
        detail: `₹${price.toFixed(2)} ${price < bollingerBands.lower ? '<' : '>='} ₹${bollingerBands.lower.toFixed(2)}`
      },
      {
        name: 'RSI 15-40',
        met: rsi >= 15 && rsi <= 40,
        detail: `${rsi.toFixed(2)} ${rsi >= 15 && rsi <= 40 ? 'in range' : 'out of range'}`
      },
      {
        name: 'Supertrend DOWN',
        met: supertrend.trend === 'DOWN',
        detail: supertrend.trend
      },
      {
        name: 'Below S1 or PDL',
        met: price < s1 || price < this.previousDayLow,
        detail: `₹${price.toFixed(2)} ${price < s1 ? '< S1(' + s1.toFixed(2) + ')' : price < this.previousDayLow ? '< PDL(' + this.previousDayLow.toFixed(2) + ')' : '> S1(' + s1.toFixed(2) + ') & PDL(' + this.previousDayLow.toFixed(2) + ')'}`
      }
    ];
    
    const longMetCount = longConditions.filter(c => c.met).length;
    const shortMetCount = shortConditions.filter(c => c.met).length;
    
    const getStrength = (met: number, total: number) => {
      if (met === total) return 'SIGNAL';
      if (met >= total - 1) return 'STRONG';
      if (met >= total / 2) return 'WEAK';
      return 'NO_SIGNAL';
    };
    
    return {
      long: {
        conditions: longConditions,
        metCount: longMetCount,
        totalCount: 4,
        strength: getStrength(longMetCount, 4)
      },
      short: {
        conditions: shortConditions,
        metCount: shortMetCount,
        totalCount: 4,
        strength: getStrength(shortMetCount, 4)
      }
    };
  }

  /**
   * Get slot-level performance metrics from trade history
   */
  private getSlotPerformanceMetrics(): any {
    const trades = this.tradeHistory;
    const totalTrades = trades.length;
    const closedTrades = trades.filter(t => t.pnl !== undefined).length;
    const openTrades = totalTrades - closedTrades;
    
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    const losses = trades.filter(t => (t.pnl || 0) <= 0 && t.pnl !== undefined).length;
    const winRate = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
    
    const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    const winningTrades = trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = trades.filter(t => (t.pnl || 0) < 0);
    
    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    
    const avgWin = wins > 0 ? totalWins / wins : 0;
    const avgLoss = losses > 0 ? totalLosses / losses : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    
    const roi = ((this.currentCapital - this.INITIAL_CAPITAL) / this.INITIAL_CAPITAL) * 100;
    
    return {
      totalTrades,
      closedTrades,
      openTrades,
      wins,
      losses,
      winRate,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor,
      roi,
      initialCapital: this.INITIAL_CAPITAL,
      currentCapital: this.currentCapital
    };
  }

  public getStatus(): StrategyStatus {
    return {
      config: this.getConfig(),
      metrics: {
        ...this.getMetrics(),
        profitLoss: this.getTotalPnL(), // Derived from currentCapital (single source of truth)
        isStreaming: false // No real-time streaming needed for 5-minute strategy
      },
      recentTrades: this.tradeHistory.slice(-10), // Last 10 trades for dashboard
      allTrades: this.getTradeHistory(), // All trades for history page
      tradeStats: this.getTradingStats(), // Pre-calculated comprehensive stats
      // Custom strategy status
      currentLots: this.calculateLots(), // Dynamic lot size based on current capital
      capitalAllocation: this.INITIAL_CAPITAL,
      currentCapital: this.currentCapital, // Current capital amount
      totalTrades: this.tradeHistory.length, // Total completed trades
      indicators: this.currentIndicators,
      pivots: this.dailyPivots,
      previousDayHigh: this.previousDayHigh, // For dashboard PDH display
      previousDayLow: this.previousDayLow,   // For dashboard PDL display
      candleCount: this.candleHistory.length,
      currentStockPrice: this.getLastCompletedCandleClose(),
      signalSymbol: this.signalSymbol,
      currentCandle: this.currentCandle,
      // Enhanced dashboard data
      entryAnalysis: this.getEntryAnalysis(), // Real-time LONG/SHORT condition analysis
      slotMetrics: this.getSlotPerformanceMetrics(), // Slot-level performance metrics
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
        lastHighTime: this.currentPosition.timeDecayTrailing?.lastHighTime,
        // NEW: Additional fields for Live Position Monitor dashboard
        entryCandleLow: this.currentPosition.entryCandleLow,
        entryCandleHigh: this.currentPosition.entryCandleHigh,
        strikeType: this.currentPosition.instrument?.strikeType || 'unknown',
        strike: this.currentPosition.instrument?.strike,
        lotSize: this.currentPosition.instrument?.lot_size,
        // Calculated fields for dashboard display
        cushion: this.currentPosition.trailingSL && this.cachedCurrentPrice > 0
          ? (this.cachedCurrentPrice - this.currentPosition.trailingSL)
          : null,
        cushionPercent: (this.currentPosition.trailingSL && this.cachedCurrentPrice > 0)
          ? ((this.cachedCurrentPrice - this.currentPosition.trailingSL) / this.cachedCurrentPrice * 100)
          : null,
        profitFromEntry: this.cachedCurrentPrice > 0 
          ? (this.cachedCurrentPrice - this.currentPosition.entryPrice)
          : 0,
        profitPercent: (this.currentPosition.entryPrice > 0 && this.cachedCurrentPrice > 0)
          ? ((this.cachedCurrentPrice - this.currentPosition.entryPrice) / this.currentPosition.entryPrice * 100)
          : 0,
        // Underlying safety threshold (for LONG: MAX of entry candle low and BB midline)
        underlyingSafetyThreshold: this.currentPosition.type === 'LONG' 
          ? Math.max(
              this.currentPosition.entryCandleLow || 0, 
              this.currentIndicators?.bollingerBands?.middle || 0
            )
          : this.currentPosition.entryCandleHigh || 0,
        // RSI Trail state (SHORT only — no new API calls, just in-memory state)
        rsiTrail: {
          activated: this.rsiTrailActivated,
          floorPrice: this.rsiTrailFloorPrice,
          activationRsi: this.rsiTrailActivationRsi,
          isPolling: this.rsiTrailPollingInterval !== null,
          is5MinMonitoring: this.rsiTrail5MinCheckInterval !== null || this.rsiTrail5MinInitialTimeout !== null
        }
      } : null
    } as StrategyStatus;
  }

  /**
   * Check if the strategy has an active (open) position
   * Used by StrategyManager to prevent ejecting strategies managing live trades
   */
  public hasActivePosition(): boolean {
    return this.currentPosition !== null;
  }

  /**
   * Check if the current breakout is stale for the given direction
   * A stale breakout has had 3+ consecutive candles outside band + RSI range
   * Used by StrategyManager to eject untradeable strategies during retention checks
   * @param direction 'LONG' or 'SHORT' - the bias assigned to this strategy
   * @returns true if the breakout is stale and entry would be blocked
   */
  public isStale(direction: 'LONG' | 'SHORT'): boolean {
    const result = this.checkBreakoutStaleness(direction);
    this.logger.debug(`[STALE CHECK] ${this.signalSymbol} ${direction}: isStale=${result.isStale}, consecutive=${result.consecutiveCount}`);
    return result.isStale;
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
    const totalQuantity = this.currentPosition.quantity * this.currentPosition.instrument.lot_size; // Use instrument's actual lot size
    
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
   * Calculate RSI(14) on Option Premium 15-minute candles
   * Used for "Gamma Climax" exit detection
   * 
   * @param candles - Array of 15-minute option candles
   * @returns RSI value (0-100) or -1 if insufficient data
   */
  private calculateOptionRSI(candles: Candle[]): number {
    const period = 14;
    
    // Need at least period + 1 candles for valid RSI
    if (candles.length < period + 1) {
      this.logger.debug(`Option RSI: Insufficient data (${candles.length}/${period + 1} candles)`);
      return -1;
    }
    
    // Use all available candles so Wilder's RMA has enough smoothing steps
    // to converge to the same value as TradingView (which uses full chart history)
    const changes: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      if (curr && prev) {
        changes.push(curr.close - prev.close);
      }
    }
    
    if (changes.length < period) return -1;
    
    // Initial average calculation
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < period; i++) {
      const change = changes[i] || 0;
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    
    avgGain /= period;
    avgLoss /= period;
    
    // Smooth with Wilder's RMA
    for (let i = period; i < changes.length; i++) {
      const change = changes[i] || 0;
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Fetch 15-minute historical data for the active option instrument
   * Returns candle closes for RSI calculation
   * 
   * @returns Array of 15-min candles (30+ for RSI stability)
   */
  private async fetchOption15MinCandles(): Promise<Candle[]> {
    if (!this.currentPosition) return [];
    
    const optionToken = this.currentPosition.instrument.instrument_token;
    const optionSymbol = this.currentPosition.instrument.tradingsymbol;
    
    try {
      const toDate = new Date();
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 5);  // 5 days lookback for 30+ 15-min candles
      
      this.logger.debug(`Fetching 15-min option data: ${optionSymbol} from ${fromDate.toISOString().split('T')[0]}`);
      
      const historicalData = await this.kiteConnect.getHistoricalData(
        optionToken,
        '15minute',  // 15-minute timeframe
        fromDate,
        toDate
      );
      
      if (!historicalData || historicalData.length < 20) {
        this.logger.warn(`Insufficient 15-min option data: ${historicalData?.length || 0} candles`);
        return [];
      }
      
      // Convert to Candle interface
      const candles: Candle[] = historicalData.map((kiteCandle: any) => ({
        timestamp: new Date(kiteCandle.date),
        open: kiteCandle.open,
        high: kiteCandle.high,
        low: kiteCandle.low,
        close: kiteCandle.close,
        volume: kiteCandle.volume || 0,
        isComplete: true
      }));
      
      this.logger.debug(`Fetched ${candles.length} 15-min option candles for RSI calculation`);
      return candles;
      
    } catch (error) {
      this.logger.error(`Failed to fetch 15-min option data for ${optionSymbol}:`, error);
      return [];
    }
  }

  /**
   * Fetch 5-minute historical data for the active option instrument
   * Used for RSI-Activated Live Premium Trailing Stop (SHORT trades)
   * 
   * @returns Array of 5-min candles (30+ for RSI stability)
   */
  private async fetchOption5MinCandles(): Promise<Candle[]> {
    if (!this.currentPosition) return [];
    
    const optionToken = this.currentPosition.instrument.instrument_token;
    const optionSymbol = this.currentPosition.instrument.tradingsymbol;
    
    try {
      const toDate = new Date();
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 5);  // 5 days lookback for 30+ 5-min candles
      
      this.logger.debug(`Fetching 5-min option data: ${optionSymbol} from ${fromDate.toISOString().split('T')[0]}`);
      
      const historicalData = await this.kiteConnect.getHistoricalData(
        optionToken,
        '5minute',  // 5-minute timeframe
        fromDate,
        toDate
      );
      
      if (!historicalData || historicalData.length < 20) {
        this.logger.warn(`Insufficient 5-min option data: ${historicalData?.length || 0} candles`);
        return [];
      }
      
      // Convert to Candle interface
      const candles: Candle[] = historicalData.map((kiteCandle: any) => ({
        timestamp: new Date(kiteCandle.date),
        open: kiteCandle.open,
        high: kiteCandle.high,
        low: kiteCandle.low,
        close: kiteCandle.close,
        volume: kiteCandle.volume || 0,
        isComplete: true
      }));
      
      this.logger.debug(`Fetched ${candles.length} 5-min option candles for RSI Trail calculation`);
      return candles;
      
    } catch (error) {
      this.logger.error(`Failed to fetch 5-min option data for ${optionSymbol}:`, error);
      return [];
    }
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
   * Check if a breakout is stale (already 3+ consecutive candles outside band + RSI range)
   * Prevents entering moves that are 10-15+ minutes old and likely exhausted
   * @param direction 'LONG' or 'SHORT'
   * @returns { isStale: boolean, consecutiveCount: number }
   */
  private checkBreakoutStaleness(direction: 'LONG' | 'SHORT'): { isStale: boolean; consecutiveCount: number } {
    // Need at least 3 completed candles to check
    if (this.candleHistory.length < 3) {
      return { isStale: false, consecutiveCount: 0 };
    }
    
    // Helper to check if a candle at given index meets staleness criteria
    // We calculate indicators using historical data up to that candle
    const checkCandleMeetsCondition = (candleIndex: number): boolean => {
      const historicalSlice = this.candleHistory.slice(0, candleIndex + 1);
      
      if (historicalSlice.length < 20) return false; // Need enough data for BB calculation
      
      const candle = historicalSlice[historicalSlice.length - 1];
      if (!candle) return false;
      
      const bb = this.calculateBollingerBands(historicalSlice, 20, 2);
      const rsi = this.calculateRSI(historicalSlice, 10);
      const close = candle.close;
      
      if (direction === 'LONG') {
        // LONG staleness: close > upper BB AND RSI in [68, 85]
        return close > bb.upper && rsi >= 68 && rsi <= 85;
      } else {
        // SHORT staleness: close < lower BB AND RSI in [15, 32]
        return close < bb.lower && rsi >= 15 && rsi <= 32;
      }
    };
    
    // Check last 3 completed candles (indices: length-1, length-2, length-3)
    const idx1 = this.candleHistory.length - 1; // Most recent completed
    const idx2 = this.candleHistory.length - 2;
    const idx3 = this.candleHistory.length - 3;
    
    // Helper: check if two candles are from the same intraday session (gap ≤ 6 minutes)
    // Prevents counting across overnight/holiday gaps as "consecutive"
    const MAX_CANDLE_GAP_MS = 6 * 60 * 1000; // 6 minutes (buffer over 5-min interval)
    const isConsecutiveSession = (newerIdx: number, olderIdx: number): boolean => {
      const newer = this.candleHistory[newerIdx];
      const older = this.candleHistory[olderIdx];
      if (!newer || !older) return false;
      return (newer.timestamp.getTime() - older.timestamp.getTime()) <= MAX_CANDLE_GAP_MS;
    };
    
    const candle1Meets = checkCandleMeetsCondition(idx1);
    const candle2Meets = checkCandleMeetsCondition(idx2);
    const candle3Meets = checkCandleMeetsCondition(idx3);
    
    const gap1to2 = isConsecutiveSession(idx1, idx2);
    const gap2to3 = isConsecutiveSession(idx2, idx3);
    
    // Count consecutive from most recent - must be unbroken chain within same session
    let consecutiveCount = 0;
    if (candle1Meets) {
      consecutiveCount = 1;
      if (candle2Meets && gap1to2) {
        consecutiveCount = 2;
        if (candle3Meets && gap2to3) {
          consecutiveCount = 3;
        }
      }
    }
    
    // Stale if all 3 consecutive candles meet conditions (Count > 2)
    const isStale = consecutiveCount >= 3;
    
    this.logger.debug(`[STALENESS CHECK] ${direction}: Candle1=${candle1Meets}, Candle2=${candle2Meets}, Candle3=${candle3Meets}, Gap1-2=${gap1to2}, Gap2-3=${gap2to3}, Consecutive=${consecutiveCount}, IsStale=${isStale}`);
    
    return { isStale, consecutiveCount };
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
   * Load 7 days of historical candles for signal stock (e.g., BRITANNIA, TCS)
   * Handle weekends/holidays by extending lookback up to 14 days if needed
   */
  private async loadHistoricalData(): Promise<void> {
    this.logger.info(`Loading historical ${this.signalSymbol} candle data...`);
    
    const maxLookbackDays = 14;
    const requiredCandles = 25; // Minimum candles needed (20 for BB + buffer)
    
    for (let lookbackDays = 7; lookbackDays <= maxLookbackDays; lookbackDays++) {
      try {
        const toDate = new Date();
        const fromDate = new Date(toDate);
        fromDate.setDate(fromDate.getDate() - lookbackDays);
        
        this.logger.info(`Fetching ${this.signalSymbol} historical data: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`);
        
        const historicalData = await this.kiteConnect.getHistoricalData(
          this.signalInstrumentToken,
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
          
          this.logger.info(`✅ ${this.signalSymbol} historical data loaded: ${this.candleHistory.length} candles`);
          return;
        } else {
          this.logger.warn(`Insufficient ${this.signalSymbol} data with ${lookbackDays} days: ${historicalData?.length || 0} candles`);
        }
        
      } catch (error) {
        this.logger.error(`Failed to fetch ${this.signalSymbol} historical data for ${lookbackDays} days:`, error);
        
        // Log detailed error info to help debug authentication issues
        if (error && typeof error === 'object') {
          this.logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
        }
      }
    }
    
    throw new Error(`Failed to load sufficient ${this.signalSymbol} historical data after ${maxLookbackDays} days`);
  }

  /**
   * PRODUCTION FIX: Load historical data with fallback for pre-market initialization
   * This allows the bot to start before market hours without failing
   */
  private async loadHistoricalDataWithFallback(): Promise<void> {
    this.logger.info(`Loading ${this.signalSymbol} historical data with production fallback...`);
    
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
        symbol: this.signalSymbol,
        timeframe: '5min'
      };
      
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      this.logger.info(`📦 ${this.signalSymbol} historical data cached successfully`);
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
    
    // Clear any existing timer to prevent duplicates on restart
    if (this.dailyCacheRefreshTimer) {
      clearTimeout(this.dailyCacheRefreshTimer);
    }
    this.dailyCacheRefreshTimer = setTimeout(async () => {
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
      this.logger.info(`✅ ${this.signalSymbol} daily pivots calculated from market data`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to fetch ${this.signalSymbol} pivot data, using fallback`, error);
      this.calculateFallbackPivots();
    }
  }

  /**
   * Calculate fallback pivot levels using approximate values
   * Note: These are placeholder values - real trading should use actual data
   */
  private calculateFallbackPivots(): void {
    // Use placeholder values for pre-market when no data is available
    // These should be replaced with real data when market opens
    this.logger.warn(`⚠️ Using placeholder pivot levels for ${this.signalSymbol} - will update when market data available`);
    
    // For stocks, we can't use a fixed fallback as prices vary widely
    // Use a generic approach: assume current indicators or mark as unavailable
    const approximateOHLC = {
      high: 1000,  // Placeholder - will be recalculated
      low: 990, 
      close: 995
    };
    
    this.dailyPivots = this.calculateDailyPivots(approximateOHLC);
    this.previousDayHigh = approximateOHLC.high;
    this.previousDayLow = approximateOHLC.low;
    this.logger.info(`⚠️ Using placeholder pivot levels for ${this.signalSymbol} pre-market operation`, this.dailyPivots);
  }

  /**
   * Calculate daily pivots from previous trading day OHLC for signal stock
   * Fetch the most recent daily candle to get previous day's data
   */
  private async calculateDailyPivotsFromMarketData(): Promise<void> {
    this.logger.info(`Calculating ${this.signalSymbol} daily pivot levels...`);
    
    try {
      // Extend date range to ensure we get recent trading data
      // Use yesterday as toDate to avoid incomplete current day data
      const toDate = new Date();
      toDate.setDate(toDate.getDate() - 1); // Use yesterday to ensure complete data
      
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 10); // Get last 10 days to ensure enough trading days
      
      this.logger.info(`Fetching ${this.signalSymbol} daily pivot data`, {
        fromDate: fromDate.toISOString().split('T')[0],
        toDate: toDate.toISOString().split('T')[0]
      });
      
      const dailyData = await this.kiteConnect.getHistoricalData(
        this.signalInstrumentToken,
        'day',
        fromDate,
        toDate
      );
      
      if (!dailyData || dailyData.length < 1) {
        throw new Error(`No daily data available for ${this.signalSymbol} pivot calculation`);
      }
      
      // Get the most recent completed trading day
      const previousDay = dailyData[dailyData.length - 1];
      
      // Store previous day OHLC for filters
      this.previousDayClose = previousDay.close;
      this.previousDayHigh = previousDay.high;   // For LONG entry condition
      this.previousDayLow = previousDay.low;     // For SHORT entry condition
      this.pivotsLoaded = true;  // Mark pivots as successfully loaded
      
      this.dailyPivots = this.calculateDailyPivots({
        high: previousDay.high,
        low: previousDay.low,
        close: previousDay.close
      });
      
      // Debug: Show all available dates to verify we're using the right one
      this.logger.info(`${this.signalSymbol} daily candles:`, {
        totalCandles: dailyData.length,
        dateRange: dailyData.length > 0 ? {
          oldest: dailyData[0].date,
          newest: dailyData[dailyData.length - 1].date
        } : 'No data',
        allDates: dailyData.map((d: any) => d.date).slice(-5) // Show last 5 dates
      });

      this.logger.info(`${this.signalSymbol} daily pivots calculated`, {
        symbol: this.signalSymbol,
        date: previousDay.date,
        forTradingDay: 'Using most recent completed trading day for pivot calculation',
        pp: this.dailyPivots.pp.toFixed(2),
        r1: this.dailyPivots.r1.toFixed(2),
        s1: this.dailyPivots.s1.toFixed(2),
        previousDayHigh: this.previousDayHigh.toFixed(2),
        previousDayLow: this.previousDayLow.toFixed(2)
      });
      
    } catch (error) {
      this.logger.error(`Failed to calculate ${this.signalSymbol} daily pivots:`, error);
      throw error;
    }
  }

  /**
   * Get signal instrument token dynamically from config.instruments[0]
   * This fetches the stock's instrument token from NSE (e.g., BRITANNIA, TCS, RELIANCE)
   * for use as the signal generator in the Bollinger Band strategy
   */
  private async getSignalInstrumentToken(): Promise<{ token: number; symbol: string }> {
    // Get stock symbol from config (e.g., "BRITANNIA", "TCS")
    const stockSymbol = this.config.instruments?.[0];
    
    if (!stockSymbol) {
      throw new Error('No stock symbol configured in config.instruments[0]. Strategy needs a signal instrument.');
    }
    
    this.logger.info(`🔍 Looking up instrument token for stock: ${stockSymbol}`);
    
    try {
      // Fetch NSE instruments to find the stock
      const nseInstruments = await this.kiteConnect.getInstruments('NSE');
      
      // Find the stock with matching tradingsymbol (exact match)
      const stockInstrument = nseInstruments.find((inst: any) => 
        inst.tradingsymbol === stockSymbol && 
        inst.instrument_type === 'EQ' // Equity stock
      );
      
      if (stockInstrument) {
        this.logger.info(`✅ Found stock instrument: ${stockSymbol}`, {
          token: stockInstrument.instrument_token,
          tradingsymbol: stockInstrument.tradingsymbol,
          name: stockInstrument.name,
          instrument_type: stockInstrument.instrument_type,
          exchange: stockInstrument.exchange
        });
        return { 
          token: stockInstrument.instrument_token, 
          symbol: stockSymbol 
        };
      }
      
      // If exact match fails, try case-insensitive match
      const stockInstrumentCaseInsensitive = nseInstruments.find((inst: any) => 
        inst.tradingsymbol?.toUpperCase() === stockSymbol.toUpperCase() && 
        inst.instrument_type === 'EQ'
      );
      
      if (stockInstrumentCaseInsensitive) {
        this.logger.info(`✅ Found stock instrument (case-insensitive): ${stockSymbol}`, {
          token: stockInstrumentCaseInsensitive.instrument_token,
          tradingsymbol: stockInstrumentCaseInsensitive.tradingsymbol,
          name: stockInstrumentCaseInsensitive.name
        });
        return { 
          token: stockInstrumentCaseInsensitive.instrument_token, 
          symbol: stockInstrumentCaseInsensitive.tradingsymbol 
        };
      }
      
      throw new Error(`Stock ${stockSymbol} not found in NSE instruments`);
      
    } catch (error) {
      this.logger.error(`Failed to get instrument token for ${stockSymbol}:`, error);
      throw new Error(`Cannot initialize strategy without signal instrument token for ${stockSymbol}`);
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
    
    // 🚀 RESOURCE EFFICIENCY: Add slot-based stagger to prevent simultaneous API calls
    // Slot 0 fires at X:X0:05, Slot 1 at X:X0:06, Slot 2 at X:X0:07
    const slotStaggerMs = this.slotIndex * 1000; // 1 second per slot
    millisecondsUntilAlignment += slotStaggerMs;
    
    const alignmentTime = new Date(now.getTime() + millisecondsUntilAlignment);
    this.logger.info(`⏰ Current time: ${now.toLocaleTimeString()}.${now.getMilliseconds()}`);
    this.logger.info(`⏰ Slot ${this.slotIndex + 1} aligning to: ${alignmentTime.toLocaleTimeString()}.${alignmentTime.getMilliseconds()} (${(millisecondsUntilAlignment / 1000).toFixed(1)}s, includes ${this.slotIndex}s stagger)`);
    
    // Start the master cycle after alignment timing
    // 🔒 CRITICAL FIX: Store alignment timeout so it can be cancelled in stop()
    // Without this, stop() during alignment creates zombie strategies that trade without slot tracking
    this.alignmentTimer = setTimeout(() => {
      this.alignmentTimer = null; // Clear reference after firing
      const triggerTime = new Date();
      this.logger.info(`✅ Slot ${this.slotIndex + 1} alignment triggered at ${triggerTime.toLocaleTimeString()}.${triggerTime.getMilliseconds()}`);
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
    
    // 🔒 CRITICAL FIX: Cancel alignment timer to prevent zombie strategy creation
    // If stop() is called during alignment delay, the setTimeout would fire later
    // and call startMasterCycle() on a supposedly-dead strategy instance
    if (this.alignmentTimer) {
      clearTimeout(this.alignmentTimer);
      this.alignmentTimer = null;
      this.logger.info('🔒 Alignment timer cancelled - preventing zombie strategy');
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
    // Clear any existing interval to prevent duplication
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
    }
    // Report health status every 5 minutes
    this.healthMonitorInterval = setInterval(() => {
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
      this.logger.info(`📥 Fetching ${this.signalSymbol} 5-minute candle at ${fetchStartTime.toLocaleTimeString()}.${fetchStartTime.getMilliseconds()}`);
      
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - 10 * 60 * 1000); // Last 10 minutes to get latest candle
      
      const historicalData = await this.kiteConnect.getHistoricalData(
        this.signalInstrumentToken,
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
        
        this.logger.info(`📊 ${this.signalSymbol} candle: ${newCandle.timestamp.toLocaleTimeString()} | Age: ${candleAgeMinutes}m ${candleAgeSeconds}s | OHLC: ${newCandle.open}/${newCandle.high}/${newCandle.low}/${newCandle.close} V:${newCandle.volume}`);
        
        // ⚠️ Alert if candle is too old (more than 6 minutes)
        // Note: 5-minute candles normally have 5m age since we fetch the just-closed bar
        if (candleAge > 6 * 60) {
          this.logger.warn(`⚠️ STALE CANDLE WARNING: ${this.signalSymbol} candle is ${candleAgeMinutes}m ${candleAgeSeconds}s old! Expected ~5m for 5-minute bars.`);
        } else if (candleAge > 5.5 * 60) {
          this.logger.info(`ℹ️ ${this.signalSymbol} candle age: ${candleAgeMinutes}m ${candleAgeSeconds}s (slightly delayed but acceptable)`);
        } else if (candleAge >= 4 * 60) {
          this.logger.info(`✅ Fresh ${this.signalSymbol} 5-minute candle: ${candleAgeMinutes}m ${candleAgeSeconds}s age (expected ~5m)`);
        } else {
          this.logger.info(`✅ Very fresh ${this.signalSymbol} candle: ${candleAgeMinutes}m ${candleAgeSeconds}s age`);
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
            this.logger.info(`[BOLLINGER] ✅ Added new 5-minute candle: ${this.signalSymbol} ${newCandle.close} (${newCandle.timestamp.toLocaleTimeString()})`);
          } else {
            // Same timestamp but different OHLC - update existing candle (live candle update)
            if (lastHistoricalCandle && newCandle.timestamp.getTime() === lastHistoricalCandle.timestamp.getTime()) {
              this.candleHistory[this.candleHistory.length - 1] = newCandle;
              this.logger.debug(`[BOLLINGER] 🔄 Updated current 5-minute candle: ${this.signalSymbol} ${newCandle.close}`);
            }
          }
          
          // Keep only last 50 candles for indicators
          if (this.candleHistory.length > 50) {
            this.candleHistory = this.candleHistory.slice(-50);
          }
          
          // Update indicators with new/updated candle
          this.updateTechnicalIndicators();
          
          // 📊 UPDATE DASHBOARD PRICE: Fetch option premium for display (every 5-min candle)
          // This was previously done by real-time polling, but now we update at candle boundaries
          if (this.currentPosition) {
            try {
              const optionPremium = await this.getLiveOptionPremium(this.currentPosition.instrument.instrument_token);
              if (optionPremium > 0) {
                this.cachedCurrentPrice = optionPremium;
                // Update highest premium tracking
                if (optionPremium > (this.currentPosition.highestPremium || 0)) {
                  this.currentPosition.highestPremium = optionPremium;
                }
                // Calculate unrealized P&L
                const priceDiff = optionPremium - this.currentPosition.entryPrice;
                const totalQuantity = this.currentPosition.quantity * this.currentPosition.instrument.lot_size;
                this.cachedUnrealizedPnL = priceDiff * totalQuantity;
                this.lastPriceUpdateTime = new Date();
                
                this.logger.info(`📊 Dashboard price updated: ${this.currentPosition.instrument.tradingsymbol} @ ₹${optionPremium.toFixed(2)} | P&L: ₹${this.cachedUnrealizedPnL.toFixed(2)}`);
              }
            } catch (priceError) {
              this.logger.warn('⚠️ Failed to update dashboard price:', priceError);
            }
          }
          
          // CRITICAL ORDER: Check exits BEFORE entries (exit existing position before considering new entry)
          const hadPositionBeforeExitCheck = this.currentPosition !== null;
          if (this.currentPosition) {
            // F7: RSI Quick Reversal Confirmation (first 2 candles only)
            // Must run BEFORE primary exit checks — if RSI confirmation fails, exit immediately
            if (this.currentPosition?.rsiConfirmation && !this.currentPosition.rsiConfirmation.confirmed) {
              await this.checkRsiConfirmation();
            }

            // Primary exit check (Supertrend/BB) — only if position still exists after RSI confirmation
            if (this.currentPosition) {
              await this.checkPositionExit(newCandle.close);
            }
            
            // Breakout validation check (only runs for first 3 candles after entry, first-breakout entries only)
            if (this.currentPosition?.breakoutValidation && !this.currentPosition.breakoutValidation.validated) {
              await this.checkBreakoutValidation(newCandle);
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

  // ═══════════════════════════════════════════════════════════════════════════
  // EMERGENCY HARD STOP SYSTEM - Flash Crash Protection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start Emergency Hard Stop monitoring
   * Lightweight 30-second polling to detect >5% stock moves against position
   * This is a circuit breaker for disasters, NOT the primary exit logic
   */
  private startEmergencyStopMonitoring(): void {
    // Clear any existing interval first
    this.stopEmergencyStopMonitoring();
    
    if (!this.currentPosition || !this.currentPosition.entryStockPrice) {
      this.logger.warn('⚠️ Cannot start Emergency Stop monitoring - no position or entry stock price');
      return;
    }
    
    const entryStockPrice = this.currentPosition.entryStockPrice;
    const positionType = this.currentPosition.type;
    
    this.logger.info(`🚨 Emergency Hard Stop monitoring STARTED`, {
      pollInterval: `${this.EMERGENCY_POLL_INTERVAL_MS / 1000}s`,
      threshold: `${this.EMERGENCY_STOP_PERCENT}%`,
      entryStockPrice: entryStockPrice.toFixed(2),
      positionType,
      triggerPrice: positionType === 'LONG' 
        ? (entryStockPrice * (1 - this.EMERGENCY_STOP_PERCENT / 100)).toFixed(2)
        : (entryStockPrice * (1 + this.EMERGENCY_STOP_PERCENT / 100)).toFixed(2)
    });
    
    // Start interval - first check after 30 seconds
    this.emergencyStopInterval = setInterval(async () => {
      await this.checkEmergencyStop();
    }, this.EMERGENCY_POLL_INTERVAL_MS);
  }

  /**
   * Stop Emergency Hard Stop monitoring
   * Called when position is closed or strategy stops
   */
  private stopEmergencyStopMonitoring(): void {
    if (this.emergencyStopInterval) {
      clearInterval(this.emergencyStopInterval);
      this.emergencyStopInterval = null;
      this.logger.info('🛑 Emergency Hard Stop monitoring stopped');
    }
  }

  /**
   * Check if stock has moved >5% against position (flash crash detection)
   * ONLY triggers on catastrophic moves - does NOT interfere with normal exits
   */
  private async checkEmergencyStop(): Promise<void> {
    if (!this.currentPosition || !this.currentPosition.entryStockPrice) {
      return;
    }
    
    try {
      // Fetch current stock LTP
      const quoteKey = `NSE:${this.signalSymbol}`;
      const quotes = await this.kiteConnect.getQuote([quoteKey]);
      const currentStockLTP = quotes[quoteKey]?.last_price;
      
      if (!currentStockLTP || currentStockLTP <= 0) {
        this.logger.warn('⚠️ Emergency Stop: Failed to fetch stock LTP');
        return;
      }
      
      const entryStockPrice = this.currentPosition.entryStockPrice;
      const movePercent = ((currentStockLTP - entryStockPrice) / entryStockPrice) * 100;
      
      // LONG: Exit if stock dropped >5%
      if (this.currentPosition.type === 'LONG') {
        if (currentStockLTP < entryStockPrice * (1 - this.EMERGENCY_STOP_PERCENT / 100)) {
          this.logger.error(`🚨🚨🚨 EMERGENCY HARD STOP TRIGGERED!`, {
            symbol: this.signalSymbol,
            positionType: 'LONG',
            entryStockPrice: entryStockPrice.toFixed(2),
            currentStockPrice: currentStockLTP.toFixed(2),
            dropPercent: movePercent.toFixed(2),
            threshold: `-${this.EMERGENCY_STOP_PERCENT}%`,
            action: 'FORCE EXIT LONG position'
          });
          
          // Stop monitoring BEFORE exit to prevent duplicate triggers
          this.stopEmergencyStopMonitoring();
          
          // Force immediate exit
          await this.executeExit('EMERGENCY_HARD_STOP');
          return;
        }
      }
      
      // SHORT: Exit if stock rose >5%
      if (this.currentPosition.type === 'SHORT') {
        if (currentStockLTP > entryStockPrice * (1 + this.EMERGENCY_STOP_PERCENT / 100)) {
          this.logger.error(`🚨🚨🚨 EMERGENCY HARD STOP TRIGGERED!`, {
            symbol: this.signalSymbol,
            positionType: 'SHORT',
            entryStockPrice: entryStockPrice.toFixed(2),
            currentStockPrice: currentStockLTP.toFixed(2),
            risePercent: movePercent.toFixed(2),
            threshold: `+${this.EMERGENCY_STOP_PERCENT}%`,
            action: 'FORCE EXIT SHORT position'
          });
          
          // Stop monitoring BEFORE exit to prevent duplicate triggers
          this.stopEmergencyStopMonitoring();
          
          // Force immediate exit
          await this.executeExit('EMERGENCY_HARD_STOP');
          return;
        }
      }
      
      // Log periodic status (every check)
      this.logger.debug(`🔍 Emergency Stop check: ${this.signalSymbol} at ₹${currentStockLTP.toFixed(2)} (${movePercent >= 0 ? '+' : ''}${movePercent.toFixed(2)}% from entry ₹${entryStockPrice.toFixed(2)})`);
      
    } catch (error) {
      this.logger.error('❌ Emergency Stop check failed:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pure REST API polling-based monitoring - DISABLED
   * 
   * Real-time polling has been disabled in favor of 5-minute candle close exit logic.
   * Exit checks now run ONLY when a 5-minute candle closes, using:
   * - LONG: Supertrend break (candleClose < Supertrend)
   * - SHORT: MIN(Supertrend, BB Middle) break (candleClose > threshold)
   * 
   * This eliminates "wick noise" and reduces API calls significantly.
   */
  private startPollingBasedMonitoring(instrumentToken: number): void {
    this.logger.info('📴 Real-time position monitoring DISABLED - using 5-min candle close ONLY');
    this.logger.info('📊 Exit logic: LONG exits when close < Supertrend | SHORT exits when close > MIN(Supertrend, BB Mid)');
    this.logger.info('⏰ Exit checks run at each 5-minute candle close (XX:00, XX:05, XX:10, etc.)');
    
    // Do NOT start polling - exit logic is now handled by checkPositionExit() 
    // which is called from fetchLatest5MinuteCandle() after indicators are updated
    return;
  }

  // === Real-time polling DISABLED - Using 5-minute candle close exit logic ===
  // Exit checks now run ONLY at 5-minute candle closes via checkPositionExit()

  /**
   * Check position exit conditions - CALLED ONLY AT 5-MINUTE CANDLE CLOSES
   * 
   * Exit Logic (Simplified for Stock Options):
   * - LONG: Exit when 5-min candle CLOSES below dynamic Supertrend
   * - SHORT: Exit when 5-min candle CLOSES above MIN(Supertrend, BB Middle)
   * 
   * This eliminates "wick noise" - no more intra-candle fake-out exits.
   */
  private async checkPositionExit(candleClose?: number): Promise<void> {
    if (!this.currentPosition) return;

    try {
      if (this.currentPosition.type === 'LONG') {
        // LONG: Exit if close < Supertrend (dynamic, updated each candle)
        if (candleClose !== undefined) {
          this.currentStockLTP = candleClose; // Store for dashboard
          await this.checkLongExitOnCandleClose(candleClose);
        } else {
          this.logger.warn('LONG position exit called without candle close price');
        }
      } else if (this.currentPosition.type === 'SHORT') {
        // SHORT: Exit if close > MIN(Supertrend, BB Middle)
        if (candleClose !== undefined) {
          this.currentStockLTP = candleClose; // Store for dashboard  
          await this.checkShortExitOnCandleClose(candleClose);
        } else {
          this.logger.warn('SHORT position exit called without candle close price');
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

  // ═══════════════════════════════════════════════════════════════
  // LEGACY POLLING CODE REMOVED
  // processLTPUpdate, buildFiveMinuteCandle, checkCandleCompletion,
  // completeFiveMinuteCandle, processCandleCompletion — all removed.
  // All candle processing now goes through the master cycle:
  //   startRealTimeMonitoring → fetchLatest5MinuteCandle → updateTechnicalIndicators
  // Exit checks: checkPositionExit (on every fresh candle fetch)
  // Entry checks: checkEntrySignals (on non-duplicate candle, no prior position)
  // ═══════════════════════════════════════════════════════════════

  // ============================================================================
  // BREAKOUT CANDLE HIGH/LOW VALIDATION
  // Post-entry gate: checks if the breakout candle's HIGH (LONG) or LOW (SHORT)
  // is exceeded within 3 candles (15 min). Only applies to first-breakout entries.
  // ============================================================================

  /**
   * Breakout Candle HIGH/LOW Validation
   * 
   * After a first-breakout entry, this checks each subsequent candle (up to 3)
   * to see if the breakout candle's extreme is exceeded.
   * - LONG: Was the breakout candle's HIGH taken out by any new candle's HIGH?
   * - SHORT: Was the breakout candle's LOW taken out by any new candle's LOW?
   * 
   * If not exceeded after 3 candles → exit (BREAKOUT_NO_FOLLOWTHROUGH)
   * If exceeded → mark validated, let trade run under normal exit mechanisms
   * 
   * @param newCandle - The just-completed 5-minute candle
   */
  private async checkBreakoutValidation(newCandle: Candle): Promise<void> {
    if (!this.currentPosition?.breakoutValidation) return;
    if (this.currentPosition.breakoutValidation.validated) return;

    const validation = this.currentPosition.breakoutValidation;
    validation.candlesSinceBreakout++;

    const isLong = this.currentPosition.type === 'LONG';

    if (isLong) {
      // Track the highest HIGH seen since breakout
      validation.bestHighSinceBreakout = Math.max(
        validation.bestHighSinceBreakout,
        newCandle.high
      );

      // Check: did any candle's HIGH exceed the breakout candle's HIGH?
      if (validation.bestHighSinceBreakout > validation.breakoutCandleHigh) {
        validation.validated = true;
        this.logger.info('✅ BREAKOUT VALIDATED: New HIGH exceeded breakout candle HIGH', {
          symbol: this.signalSymbol,
          breakoutCandleHigh: validation.breakoutCandleHigh.toFixed(2),
          newHigh: validation.bestHighSinceBreakout.toFixed(2),
          candlesAfterEntry: validation.candlesSinceBreakout
        });
        this.saveCapitalData(); // Persist validated state
        return;
      }
    } else {
      // SHORT: Track the lowest LOW seen since breakout
      validation.bestLowSinceBreakout = Math.min(
        validation.bestLowSinceBreakout,
        newCandle.low
      );

      // Check: did any candle's LOW go below the breakout candle's LOW?
      if (validation.bestLowSinceBreakout < validation.breakoutCandleLow) {
        validation.validated = true;
        this.logger.info('✅ BREAKOUT VALIDATED (SHORT): New LOW exceeded breakout candle LOW', {
          symbol: this.signalSymbol,
          breakoutCandleLow: validation.breakoutCandleLow.toFixed(2),
          newLow: validation.bestLowSinceBreakout.toFixed(2),
          candlesAfterEntry: validation.candlesSinceBreakout
        });
        this.saveCapitalData(); // Persist validated state
        return;
      }
    }

    // Have we exhausted the 3-candle (15 min) window?
    if (validation.candlesSinceBreakout >= 3) {
      const target = isLong ? validation.breakoutCandleHigh : validation.breakoutCandleLow;
      const best = isLong ? validation.bestHighSinceBreakout : validation.bestLowSinceBreakout;
      const label = isLong ? 'HIGH' : 'LOW';

      this.logger.warn(`⚠️ BREAKOUT FAILED — No ${label} follow-through in 15 min`, {
        symbol: this.signalSymbol,
        direction: this.currentPosition.type,
        [`breakoutCandle${label}`]: target.toFixed(2),
        [`best${label}InWindow`]: best.toFixed(2),
        candlesChecked: validation.candlesSinceBreakout
      });

      await this.executeExit('BREAKOUT_NO_FOLLOWTHROUGH');
      return;
    }

    // Window still open — save updated counter and best values for restart safety
    this.logger.info(`🔍 BREAKOUT VALIDATION: Candle ${validation.candlesSinceBreakout}/3 — ${isLong ? 'HIGH' : 'LOW'} not yet exceeded`, {
      symbol: this.signalSymbol,
      target: isLong ? validation.breakoutCandleHigh.toFixed(2) : validation.breakoutCandleLow.toFixed(2),
      best: isLong ? validation.bestHighSinceBreakout.toFixed(2) : validation.bestLowSinceBreakout.toFixed(2)
    });
    this.saveCapitalData();
  }

  // ============================================================================
  // RSI QUICK REVERSAL CONFIRMATION (F7)
  // Post-entry gate: checks if stock RSI(10) reverses within 2 candles (10 min).
  // LONG: exits if RSI drops below 62. SHORT: exits if RSI rises above 32.
  // Modeled after breakoutValidation — same lifecycle, same persistence.
  // ============================================================================

  /**
   * RSI Quick Reversal Confirmation (F7 Filter)
   *
   * After entry, monitors the stock RSI(10) on each 5-minute candle close:
   * - LONG: If RSI < 62 within 2 candles → exit (RSI_CONFIRMATION_FAILED)
   * - SHORT: If RSI > 32 within 2 candles → exit (RSI_CONFIRMATION_FAILED)
   * - If 2 candles pass without breach → mark confirmed, trade runs normally
   *
   * Backtested: +₹38,610 improvement, kills 38 losing trades, 0 winners lost.
   */
  private async checkRsiConfirmation(): Promise<void> {
    if (!this.currentPosition?.rsiConfirmation) return;
    if (this.currentPosition.rsiConfirmation.confirmed) return;
    if (!this.currentIndicators) return;

    const conf = this.currentPosition.rsiConfirmation;
    conf.candlesSinceEntry++;

    const currentRsi = this.currentIndicators.rsi;
    const isLong = conf.direction === 'LONG';

    // Check threshold breach
    const breached = isLong
      ? currentRsi < conf.threshold   // LONG: RSI dropped below 62
      : currentRsi > conf.threshold;  // SHORT: RSI rose above 32

    if (breached) {
      this.logger.warn(`⚠️ RSI CONFIRMATION FAILED: ${isLong ? 'LONG' : 'SHORT'} RSI ${isLong ? 'dropped below' : 'rose above'} ${conf.threshold}`, {
        symbol: this.signalSymbol,
        direction: conf.direction,
        currentRsi: currentRsi.toFixed(2),
        threshold: conf.threshold,
        entryRsi: conf.entryRsi.toFixed(2),
        candleNumber: conf.candlesSinceEntry,
        maxCandles: conf.maxCandles
      });

      await this.executeExit('RSI_CONFIRMATION_FAILED');
      return;
    }

    // Window expired without breach → confirmed
    if (conf.candlesSinceEntry >= conf.maxCandles) {
      conf.confirmed = true;
      this.logger.info(`✅ RSI CONFIRMATION PASSED: ${conf.direction} RSI held ${isLong ? 'above' : 'below'} ${conf.threshold} for ${conf.maxCandles} candles`, {
        symbol: this.signalSymbol,
        direction: conf.direction,
        currentRsi: currentRsi.toFixed(2),
        threshold: conf.threshold,
        entryRsi: conf.entryRsi.toFixed(2)
      });
      this.saveCapitalData(); // Persist confirmed state
      return;
    }

    // Window still open
    this.logger.info(`🔍 RSI CONFIRMATION: Candle ${conf.candlesSinceEntry}/${conf.maxCandles} — RSI ${currentRsi.toFixed(2)} ${isLong ? '≥' : '≤'} ${conf.threshold} ✓`, {
      symbol: this.signalSymbol,
      direction: conf.direction,
      candlesRemaining: conf.maxCandles - conf.candlesSinceEntry
    });
    this.saveCapitalData(); // Persist counter for restart safety
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
    const { r1, r2, s1, pp } = this.dailyPivots;
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
    
    // ═══════════════════════════════════════════════════════════════
    // PIVOT DATA GUARD: Block ALL entries if pivots never loaded
    // Prevents PDH=0/PDL=0 from making conditions trivially true/false
    // ═══════════════════════════════════════════════════════════════
    if (!this.pivotsLoaded) {
      this.logger.error('[BOLLINGER] 🚫 ALL entries blocked - Pivot data not loaded! PDH/PDL/PDC are uninitialized.', {
        previousDayHigh: this.previousDayHigh,
        previousDayLow: this.previousDayLow,
        previousDayClose: this.previousDayClose,
        pivotsLoaded: this.pivotsLoaded
      });
      return;  // Block ALL entries until pivots are valid
    }
    
    // LONG Entry Signal - RSI range optimized for overbought momentum
    const longConditions = {
      priceAboveUpperBB: close > bollingerBands.upper,
      rsiInRange: rsi >= 68 && rsi <= 85, // Overbought momentum confirmation
      supertrendBullish: supertrend.trend === 'UP',
      aboveR1OrPDH: close > r1 || close > this.previousDayHigh,
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
        previousDayHigh: this.previousDayHigh.toFixed(2)
      });
      
      // ═══════════════════════════════════════════════════════════════
      // LATE-DAY LONG ENTRY CUTOFF
      // Block LONG entries after 2:55 PM (except Fridays) - mirrors SHORT cutoff
      // Prevents entering positions with <24 min to EOD exit at 3:19 PM
      // ═══════════════════════════════════════════════════════════════
      const longCutoffTime = 14 * 60 + 55;  // 2:55 PM in minutes
      const isFridayLong = now.getDay() === 5;
      
      if (currentMinutes > longCutoffTime && !isFridayLong) {
        this.logger.warn('[BOLLINGER] 🚫 LONG entry blocked - After 2:55 PM (non-Friday)', {
          currentTime: now.toLocaleTimeString(),
          dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
          cutoffTime: '2:55 PM',
          reason: 'Late-day LONG restriction active - insufficient runway before EOD exit'
        });
        return;  // Skip LONG entry
      }
      
      // ═══════════════════════════════════════════════════════════════
      // EXTENDED GAP TRAP FILTER (LONG)
      // Block entry when: Extended UP + Late + RSI Falling (exhaustion)
      // ═══════════════════════════════════════════════════════════════
      const todayChangePctLong = this.previousDayClose > 0 
        ? ((close - this.previousDayClose) / this.previousDayClose) * 100 
        : 0;
      const isExtendedLong = todayChangePctLong > 3.0;  // Already UP 3%+
      const isLateLong = currentMinutes > 10 * 60 + 30;  // After 10:30 AM
      
      // RSI 5 candles ago (require -2 fall to confirm exhaustion, not noise)
      const rsi5CandlesAgoLong = this.candleHistory.length >= 6 
        ? this.calculateRSI(this.candleHistory.slice(0, -5), 10) 
        : rsi;
      const isRsiFalling = rsi < (rsi5CandlesAgoLong - 2.0);
      
      if (isExtendedLong && isLateLong && isRsiFalling) {
        this.logger.warn('[BOLLINGER] 🚫 LONG blocked - Extended Gap Trap detected', {
          todayChange: `+${todayChangePctLong.toFixed(2)}% (threshold: +3%)`,
          time: now.toLocaleTimeString(),
          rsiNow: rsi.toFixed(2),
          rsi5CandlesAgo: rsi5CandlesAgoLong.toFixed(2),
          rsiFall: (rsi5CandlesAgoLong - rsi).toFixed(2)
        });
        return;  // Skip LONG entry
      }
      
      // ═══════════════════════════════════════════════════════════════
      // STALE BREAKOUT FILTER (LONG)
      // Block entry if last 3 consecutive candles were outside band + RSI range
      // ═══════════════════════════════════════════════════════════════
      const longStaleness = this.checkBreakoutStaleness('LONG');
      if (longStaleness.isStale) {
        this.logger.warn('[BOLLINGER] 🚫 LONG blocked - Stale Breakout detected', {
          consecutiveCandles: longStaleness.consecutiveCount,
          message: `${longStaleness.consecutiveCount} candles already outside band`,
          reason: 'Move is 10-15+ minutes old, likely exhausted'
        });
        return;  // Skip LONG entry
      }
      
      // ═══════════════════════════════════════════════════════════════
      // SYMBOL COOLDOWN CHECK (LONG)
      // Block entry if symbol was recently exited (manual/broker exit detection)
      // ═══════════════════════════════════════════════════════════════
      if (StrategyManager.isSymbolInCooldownStatic(this.signalSymbol)) {
        this.logger.warn('[BOLLINGER] 🚫 LONG blocked - Symbol in cooldown', {
          symbol: this.signalSymbol,
          reason: 'Recent exit detected (manual/broker exit), waiting 30 min cooldown'
        });
        return;  // Skip LONG entry
      }
      
      // Extract entry candle values BEFORE async operations
      const entryCandleHigh = latestCandle.high;
      const entryCandleLow = latestCandle.low;
      const entryCandleTimestamp = latestCandle.timestamp; // FIXED: Capture timestamp
      
      await this.executeLongEntryWithRetry(close, entryCandleHigh, entryCandleLow, entryCandleTimestamp, longStaleness.consecutiveCount);
    } else {
      // Show why LONG was blocked
      this.logger.info('[BOLLINGER] ❌ LONG conditions not met:', {
        priceAboveUpperBB: `${longConditions.priceAboveUpperBB} (${close.toFixed(2)} > ${bollingerBands.upper.toFixed(2)})`,
        rsiInRange: `${longConditions.rsiInRange} (${rsi.toFixed(2)} in 68-85)`,
        supertrendBullish: `${longConditions.supertrendBullish} (${supertrend.trend})`,
        aboveR1OrPDH: `${longConditions.aboveR1OrPDH} (${close.toFixed(2)} > R1:${r1.toFixed(2)} or PDH:${this.previousDayHigh.toFixed(2)})`,
        candleIsBullish: `${longConditions.candleIsBullish}`
      });
    }
    
    // SHORT Entry Signal - RSI range widened for better momentum capture
    const shortConditions = {
      priceBelowLowerBB: close < bollingerBands.lower,
      rsiInRange: rsi >= 15 && rsi <= 40, // Widened from 10-30 to capture momentum before exhaustion
      supertrendBearish: supertrend.trend === 'DOWN',
      belowS1OrPDL: close < s1 || close < this.previousDayLow, // Structural break: below S1 or Previous Day Low
      candleIsBearish: candleBearishCheck // FIRST CANDLE EXCEPTION: Bypass bearish check at 9:15-9:25
    };
    
    const shortSignal = Object.values(shortConditions).every(Boolean);
    
    if (shortSignal) {
      this.logger.info('[BOLLINGER] 🔻 SHORT entry signal detected', {
        close: close.toFixed(2),
        rsi: rsi.toFixed(2),
        supertrend: supertrend.trend,
        lowerBB: bollingerBands.lower.toFixed(2),
        s1: s1.toFixed(2),
        previousDayLow: this.previousDayLow.toFixed(2)
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
      
      // ═══════════════════════════════════════════════════════════════
      // EXTENDED GAP TRAP FILTER (SHORT)
      // Block entry when: Extended DOWN + Late + RSI Recovering
      // ═══════════════════════════════════════════════════════════════
      const todayChangePctShort = this.previousDayClose > 0 
        ? ((close - this.previousDayClose) / this.previousDayClose) * 100 
        : 0;
      const isExtendedShort = todayChangePctShort < -3.0;  // Already DOWN 3%+
      const isLateShort = currentMinutes > 10 * 60 + 30;  // After 10:30 AM
      
      // RSI 5 candles ago (require +2 rise to confirm recovery, not noise)
      const rsi5CandlesAgoShort = this.candleHistory.length >= 6 
        ? this.calculateRSI(this.candleHistory.slice(0, -5), 10) 
        : rsi;
      const isRsiRecovering = rsi > (rsi5CandlesAgoShort + 2.0);
      
      if (isExtendedShort && isLateShort && isRsiRecovering) {
        this.logger.warn('[BOLLINGER] 🚫 SHORT blocked - Extended Gap Trap detected', {
          todayChange: `${todayChangePctShort.toFixed(2)}% (threshold: -3%)`,
          time: now.toLocaleTimeString(),
          rsiNow: rsi.toFixed(2),
          rsi5CandlesAgo: rsi5CandlesAgoShort.toFixed(2),
          rsiRise: (rsi - rsi5CandlesAgoShort).toFixed(2)
        });
        return;  // Skip SHORT entry
      }
      
      // ═══════════════════════════════════════════════════════════════
      // STALE BREAKOUT FILTER (SHORT)
      // Block entry if last 3 consecutive candles were outside band + RSI range
      // ═══════════════════════════════════════════════════════════════
      const shortStaleness = this.checkBreakoutStaleness('SHORT');
      if (shortStaleness.isStale) {
        this.logger.warn('[BOLLINGER] 🚫 SHORT blocked - Stale Breakout detected', {
          consecutiveCandles: shortStaleness.consecutiveCount,
          message: `${shortStaleness.consecutiveCount} candles already outside band`,
          reason: 'Move is 10-15+ minutes old, likely exhausted'
        });
        return;  // Skip SHORT entry
      }
      
      // ═══════════════════════════════════════════════════════════════
      // SYMBOL COOLDOWN CHECK (SHORT)
      // Block entry if symbol was recently exited (manual/broker exit detection)
      // ═══════════════════════════════════════════════════════════════
      if (StrategyManager.isSymbolInCooldownStatic(this.signalSymbol)) {
        this.logger.warn('[BOLLINGER] 🚫 SHORT blocked - Symbol in cooldown', {
          symbol: this.signalSymbol,
          reason: 'Recent exit detected (manual/broker exit), waiting 30 min cooldown'
        });
        return;  // Skip SHORT entry
      }
      
      // Extract entry candle values BEFORE async operations
      const entryCandleHigh = latestCandle.high;
      const entryCandleLow = latestCandle.low;
      const entryCandleTimestamp = latestCandle.timestamp; // FIXED: Capture timestamp
      
      await this.executeShortEntryWithRetry(close, entryCandleHigh, entryCandleLow, entryCandleTimestamp, shortStaleness.consecutiveCount);
    } else {
      // Show why SHORT was blocked
      this.logger.info('[BOLLINGER] ❌ SHORT conditions not met:', {
        priceBelowLowerBB: `${shortConditions.priceBelowLowerBB} (${close.toFixed(2)} < ${bollingerBands.lower.toFixed(2)})`,
        rsiInRange: `${shortConditions.rsiInRange} (${rsi.toFixed(2)} in 15-40)`,
        supertrendBearish: `${shortConditions.supertrendBearish} (${supertrend.trend})`,
        belowS1OrPDL: `${shortConditions.belowS1OrPDL} (${close.toFixed(2)} < S1:${s1.toFixed(2)} or PDL:${this.previousDayLow.toFixed(2)})`,
        candleIsBearish: `${shortConditions.candleIsBearish}`
      });
    }
  }

  /**
   * Execute LONG entry with CE option selection
   */
  private async executeLongEntry(stockPrice: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date, breakoutConsecutiveCount?: number): Promise<void> {
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
      
      // ATM-based option selection (selects ATM or 1-strike OTM with min ₹10 premium)
      const ceOption = await this.selectOptionInstrument('CE', stockPrice);
      
      if (!ceOption) {
        this.logger.error(`❌ LONG entry failed: Could not find suitable ${this.signalSymbol} CE option (ATM with premium ≥ ₹10)`);
        return;
      }

      this.logger.info(`🎯 ${this.signalSymbol} CE Option selected for LONG entry`, {
        symbol: ceOption.tradingsymbol,
        strike: ceOption.strike,
        premium: ceOption.last_price,
        stockPrice: stockPrice.toFixed(2),
        strikeType: ceOption.strikeType, // 'ATM' or '1-OTM'
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
          entryCandle15MinTimestamp: new Date(), // P0: Gamma Climax RSI check baseline
          ...(entryCandleTimestamp !== undefined && { entryCandleTimestamp: entryCandleTimestamp }),
          ...(entryCandleLow !== undefined && { entryCandleLow: entryCandleLow }),
          ...(entryCandleHigh !== undefined && { entryCandleHigh: entryCandleHigh }),
          entryStockPrice: stockPrice, // Store stock price for Emergency Hard Stop
          // trailingSL is NOT initialized here - will be calculated purely from option premium
          // in checkLongExitSimple() on first poll (12% below highest premium)
          highestPremium: orderResult.price, // Track maximum premium reached
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`,
          timeDecayTrailing: { lastHighTime: new Date() } // Initialize for time-based tracking
        };
        
        // ═══════════════════════════════════════════════════════════════
        // BREAKOUT VALIDATION: Arm or pre-validate based on consecutive count
        // consecutiveCount=1 → first breakout, needs validation
        // consecutiveCount=2 → second candle entry, already confirmed
        // ═══════════════════════════════════════════════════════════════
        if (breakoutConsecutiveCount !== undefined && breakoutConsecutiveCount <= 1) {
          this.currentPosition.breakoutValidation = {
            breakoutCandleHigh: entryCandleHigh ?? stockPrice,
            breakoutCandleLow: entryCandleLow ?? stockPrice,
            breakoutCandleTimestamp: entryCandleTimestamp ?? new Date(),
            candlesSinceBreakout: 0,
            bestHighSinceBreakout: 0,
            bestLowSinceBreakout: Infinity,
            validated: false
          };
          this.logger.info('🔍 BREAKOUT VALIDATION ARMED (first breakout — LONG)', {
            breakoutCandleHigh: this.currentPosition.breakoutValidation.breakoutCandleHigh.toFixed(2),
            deadline: '3 candles (15 min)'
          });
        } else {
          this.currentPosition.breakoutValidation = {
            breakoutCandleHigh: entryCandleHigh ?? stockPrice,
            breakoutCandleLow: entryCandleLow ?? stockPrice,
            breakoutCandleTimestamp: entryCandleTimestamp ?? new Date(),
            candlesSinceBreakout: 0,
            bestHighSinceBreakout: 0,
            bestLowSinceBreakout: Infinity,
            validated: true
          };
          this.logger.info('✅ BREAKOUT PRE-VALIDATED (entering on candle #2, breakout has follow-through — LONG)');
        }
        
        // ═══════════════════════════════════════════════════════════════
        // RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry
        // LONG: Exit if stock RSI(10) drops below 62 within 2 candles
        // ═══════════════════════════════════════════════════════════════
        this.currentPosition.rsiConfirmation = {
          candlesSinceEntry: 0,
          maxCandles: this.RSI_CONFIRMATION_WINDOW,
          threshold: this.RSI_CONFIRMATION_LONG_THRESHOLD,
          direction: 'LONG',
          confirmed: false,
          entryRsi: this.currentIndicators?.rsi ?? 0
        };
        this.logger.info('🔍 RSI CONFIRMATION ARMED (LONG)', {
          threshold: `<${this.RSI_CONFIRMATION_LONG_THRESHOLD}`,
          window: `${this.RSI_CONFIRMATION_WINDOW} candles (${this.RSI_CONFIRMATION_WINDOW * 5} min)`,
          entryRsi: this.currentPosition.rsiConfirmation.entryRsi.toFixed(2)
        });
        
        // P0: Save position to disk immediately after entry
        this.saveCapitalData();
        
        this.logger.info('✅ LONG position created with pre-captured candle data', {
          entryCandleLow: entryCandleLow?.toFixed(2),
          entryCandleHigh: entryCandleHigh?.toFixed(2),
          entryStockPrice: stockPrice.toFixed(2)
        });
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring().catch(error => {
          this.logger.error('Failed to start position monitoring:', error);
        });
        
        // Start Emergency Hard Stop monitoring (30-second flash crash protection)
        this.startEmergencyStopMonitoring();
        
        // P0: Start Option RSI Climax monitoring (15-min boundary checks, RSI >= 85 = Gamma Climax exit)
        this.startOptionRsiMonitoring();
        
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
  private async executeShortEntry(stockPrice: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date, breakoutConsecutiveCount?: number): Promise<void> {
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
      const candleHigh = entryCandleHigh !== undefined ? entryCandleHigh : stockPrice;
      
      // ATM-based option selection (selects ATM or 1-strike OTM with min ₹10 premium)
      const peOption = await this.selectOptionInstrument('PE', stockPrice);
      
      if (!peOption) {
        this.logger.error(`❌ SHORT entry failed: Could not find suitable ${this.signalSymbol} PE option (ATM with premium ≥ ₹10)`);
        return;
      }

      this.logger.info(`🎯 ${this.signalSymbol} PE Option selected for SHORT entry`, {
        symbol: peOption.tradingsymbol,
        strike: peOption.strike,
        premium: peOption.last_price,
        stockPrice: stockPrice.toFixed(2),
        strikeType: peOption.strikeType, // 'ATM' or '1-OTM'
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Option already validated - proceed with entry
      this.logger.info(`📉 Executing SHORT entry with real-time selected option: ${peOption.tradingsymbol}`);
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
          entryCandle15MinTimestamp: new Date(), // P0: Gamma Climax RSI check baseline
          ...(entryCandleTimestamp !== undefined && { entryCandleTimestamp: entryCandleTimestamp }),
          entryCandleHigh: candleHigh, // Extracted at signal detection
          entryStockPrice: stockPrice, // Store stock price for Emergency Hard Stop
          // trailingSL is NOT initialized here - will be calculated purely from option premium
          // in checkShortExitUnified() on first poll (time-decay: 12% for 0-20 min, tightening over time)
          highestPremium: orderResult.price,
          entryOrderId: orderResult.orderId || `BB_ENTRY_${Date.now()}`,
          timeDecayTrailing: { lastHighTime: new Date() } // Initialize at entry for precise stagnation tracking
        };
        
        // ═══════════════════════════════════════════════════════════════
        // BREAKOUT VALIDATION: Arm or pre-validate based on consecutive count
        // consecutiveCount=1 → first breakout, needs validation
        // consecutiveCount=2 → second candle entry, already confirmed
        // ═══════════════════════════════════════════════════════════════
        if (breakoutConsecutiveCount !== undefined && breakoutConsecutiveCount <= 1) {
          this.currentPosition.breakoutValidation = {
            breakoutCandleHigh: candleHigh,
            breakoutCandleLow: entryCandleLow ?? stockPrice,
            breakoutCandleTimestamp: entryCandleTimestamp ?? new Date(),
            candlesSinceBreakout: 0,
            bestHighSinceBreakout: 0,
            bestLowSinceBreakout: Infinity,
            validated: false
          };
          this.logger.info('🔍 BREAKOUT VALIDATION ARMED (first breakout — SHORT)', {
            breakoutCandleLow: this.currentPosition.breakoutValidation.breakoutCandleLow.toFixed(2),
            deadline: '3 candles (15 min)'
          });
        } else {
          this.currentPosition.breakoutValidation = {
            breakoutCandleHigh: candleHigh,
            breakoutCandleLow: entryCandleLow ?? stockPrice,
            breakoutCandleTimestamp: entryCandleTimestamp ?? new Date(),
            candlesSinceBreakout: 0,
            bestHighSinceBreakout: 0,
            bestLowSinceBreakout: Infinity,
            validated: true
          };
          this.logger.info('✅ BREAKOUT PRE-VALIDATED (entering on candle #2, breakout has follow-through — SHORT)');
        }
        
        // ═══════════════════════════════════════════════════════════════
        // RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry
        // SHORT: Exit if stock RSI(10) rises above 32 within 2 candles
        // ═══════════════════════════════════════════════════════════════
        this.currentPosition.rsiConfirmation = {
          candlesSinceEntry: 0,
          maxCandles: this.RSI_CONFIRMATION_WINDOW,
          threshold: this.RSI_CONFIRMATION_SHORT_THRESHOLD,
          direction: 'SHORT',
          confirmed: false,
          entryRsi: this.currentIndicators?.rsi ?? 0
        };
        this.logger.info('🔍 RSI CONFIRMATION ARMED (SHORT)', {
          threshold: `>${this.RSI_CONFIRMATION_SHORT_THRESHOLD}`,
          window: `${this.RSI_CONFIRMATION_WINDOW} candles (${this.RSI_CONFIRMATION_WINDOW * 5} min)`,
          entryRsi: this.currentPosition.rsiConfirmation.entryRsi.toFixed(2)
        });
        
        // P0: Save position to disk immediately after entry
        this.saveCapitalData();
        
        // Start position monitoring for exit conditions
        this.startPositionMonitoring().catch(error => {
          this.logger.error('Failed to start position monitoring:', error);
        });
        
        // Start Emergency Hard Stop monitoring (30-second flash crash protection)
        this.startEmergencyStopMonitoring();
        
        // P0: Start Option RSI Climax monitoring (15-min boundary checks, RSI >= 85 = Gamma Climax exit)
        this.startOptionRsiMonitoring();
        
        // Start RSI-Activated Live Premium Trailing Stop (5-min option RSI monitoring for SHORT)
        this.startRsiTrail5MinMonitoring();
        
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
  private async checkExitConditions(stockLTP: number): Promise<void> {
    if (!this.currentPosition) return;
    
    // All exit processing has been moved to dedicated position-specific systems
    // LONG: checkLongExitOnCandleClose() called from checkPositionExit()
    // SHORT: checkShortExitUnified() called from startShortPositionMonitoring()
    
    this.logger.debug('⚠️ checkExitConditions() called but all exit logic moved to dedicated systems', {
      positionType: this.currentPosition.type,
      stockLTP: stockLTP.toFixed(2)
    });
  }

  /**
   * LONG Exit Check - Supertrend-Based Exit (5-minute candle close ONLY)
   *
   * Simplified exit logic for stock options:
   * Exit when 5-minute candle CLOSES below the dynamic Supertrend value.
   *
   * This replaces the complex 12% trailing SL + entry candle low logic.
   * Supertrend naturally trails price up in uptrends, providing dynamic protection.
   *
   * @param candleClosePrice - The closing price of the just-completed 5-minute stock candle
   */
  private async checkLongExitOnCandleClose(candleClosePrice: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    if (this.currentPosition.type !== 'LONG') return;
    
    // Race condition protection - ensure only one exit check at a time
    if (this.isProcessingLongExit) {
      this.logger.debug('[LONG EXIT CHECK] Exit already in progress, skipping');
      return;
    }
    
    // Get CURRENT (dynamic) Supertrend value from just-updated indicators
    const supertrend = this.currentIndicators.supertrend.value;
    const supertrendTrend = this.currentIndicators.supertrend.trend;
    
    this.logger.info(`[LONG EXIT CHECK] 5-min candle close: ${candleClosePrice.toFixed(2)} | Supertrend: ${supertrend.toFixed(2)} (${supertrendTrend})`);
    
    // EXIT: If candle CLOSES below Supertrend
    if (candleClosePrice < supertrend) {
      this.isProcessingLongExit = true;
      
      try {
        this.logger.info('🔴 LONG EXIT SIGNAL: 5-min candle closed below Supertrend', {
          candleClose: candleClosePrice.toFixed(2),
          supertrend: supertrend.toFixed(2),
          supertrendTrend: supertrendTrend,
          breachAmount: (supertrend - candleClosePrice).toFixed(2),
          exitType: 'SUPERTREND_BREAK',
          timestamp: new Date().toLocaleTimeString()
        });
        
        await this.executeExit('LONG_SUPERTREND_BREAK');
      } finally {
        this.isProcessingLongExit = false;
      }
    } else {
      const cushion = candleClosePrice - supertrend;
      this.logger.info(`✅ LONG position held: Close ${candleClosePrice.toFixed(2)} > Supertrend ${supertrend.toFixed(2)} (cushion: +${cushion.toFixed(2)})`);
    }
  }

  /**
   * SHORT Exit Check - Supertrend/BB Middle-Based Exit (5-minute candle close ONLY)
   *
   * Simplified exit logic for stock options:
   * Exit when 5-minute candle CLOSES above MIN(Supertrend, BB Middle).
   * Uses the TIGHTER (lower) of the two levels for quicker profit protection.
   *
   * This replaces the complex time-decay trailing SL + entry candle high logic.
   *
   * @param candleClosePrice - The closing price of the just-completed 5-minute stock candle
   */
  private async checkShortExitOnCandleClose(candleClosePrice: number): Promise<void> {
    if (!this.currentIndicators || !this.currentPosition) return;
    if (this.currentPosition.type !== 'SHORT') return;
    
    // Race condition protection - ensure only one exit check at a time
    if (this.isProcessingShortExit) {
      this.logger.debug('[SHORT EXIT CHECK] Exit already in progress, skipping');
      return;
    }
    
    // Get CURRENT (dynamic) indicator values from just-updated indicators
    const supertrend = this.currentIndicators.supertrend.value;
    const supertrendTrend = this.currentIndicators.supertrend.trend;
    const bbMiddle = this.currentIndicators.bollingerBands.middle;
    
    // Use the TIGHTER stop (lower value) - MIN of Supertrend and BB Middle
    const exitThreshold = Math.min(supertrend, bbMiddle);
    const usedIndicator = exitThreshold === supertrend ? 'Supertrend' : 'BB Middle';
    
    this.logger.info(`[SHORT EXIT CHECK] 5-min candle close: ${candleClosePrice.toFixed(2)} | Supertrend: ${supertrend.toFixed(2)} | BB Mid: ${bbMiddle.toFixed(2)} | Exit threshold: ${exitThreshold.toFixed(2)} (${usedIndicator})`);
    
    // EXIT: If candle CLOSES above the tighter threshold (MIN of ST and BB Mid)
    if (candleClosePrice > exitThreshold) {
      this.isProcessingShortExit = true;
      
      try {
        const breachAmount = candleClosePrice - exitThreshold;
        this.logger.info('🔴 SHORT EXIT SIGNAL: 5-min candle closed above exit threshold', {
          candleClose: candleClosePrice.toFixed(2),
          supertrend: supertrend.toFixed(2),
          supertrendTrend: supertrendTrend,
          bbMiddle: bbMiddle.toFixed(2),
          exitThreshold: exitThreshold.toFixed(2),
          usedIndicator: usedIndicator,
          breachAmount: breachAmount.toFixed(2),
          exitType: 'SUPERTREND_BB_BREAK',
          timestamp: new Date().toLocaleTimeString()
        });
        
        await this.executeExit('SHORT_SUPERTREND_BB_BREAK');
      } finally {
        this.isProcessingShortExit = false;
      }
    } else {
      const cushion = exitThreshold - candleClosePrice;
      this.logger.info(`✅ SHORT position held: Close ${candleClosePrice.toFixed(2)} < Threshold ${exitThreshold.toFixed(2)} (${usedIndicator}) (cushion: +${cushion.toFixed(2)})`);
    }
  }

  // ============================================================================
  // OPTION RSI CLIMAX EXIT - "Gamma Climax" Profit Taking
  // Runs on 15-minute boundaries to detect blow-off tops in Eiffel Tower setups
  // ============================================================================

  /**
   * GAMMA CLIMAX EXIT - Option RSI-based profit taking
   * 
   * Runs at every 15-minute boundary when position is active.
   * Scheduler alignment guarantees we're at a boundary - no complex grace math needed.
   * 
   * Safety: Only skip if entry was within last 60 seconds (edge case prevention)
   */
  private async checkOptionRsiExit(): Promise<void> {
    if (!this.currentPosition) return;
    
    const now = new Date();
    const entryTime = this.currentPosition.entryTime;
    
    // Micro-grace: Skip only if we JUST entered (prevents double-fire on 10:14:59 entry)
    const secondsSinceEntry = (now.getTime() - entryTime.getTime()) / 1000;
    if (secondsSinceEntry < this.OPTION_RSI_MICRO_GRACE_SECONDS) {
      this.logger.debug(`[RSI EXIT] Skipping: Entry was ${secondsSinceEntry.toFixed(0)}s ago (micro-grace)`);
      return;
    }
    
    // Fetch 15-min option historical data
    const optionCandles = await this.fetchOption15MinCandles();
    
    if (optionCandles.length < 15) {
      this.logger.warn(`[RSI EXIT] Insufficient option candles: ${optionCandles.length} (need 15+)`);
      return;  // Risk-off: Don't exit without valid data
    }
    
    // Verify latest candle is closed (its timestamp should be before now)
    const latestCandle = optionCandles[optionCandles.length - 1];
    if (!latestCandle) {
      this.logger.warn(`[RSI EXIT] No latest candle available`);
      return;
    }
    
    // Sanity check: Latest candle timestamp should be in the past (closed candle)
    // KiteConnect returns open timestamp, so a 10:00 candle closes at 10:15
    const candleCloseTime = new Date(latestCandle.timestamp.getTime() + 15 * 60 * 1000);
    if (candleCloseTime > now) {
      this.logger.debug(`[RSI EXIT] Latest candle not yet closed: ${latestCandle.timestamp.toLocaleTimeString()}`);
      return;
    }
    
    // Calculate RSI(14) on option closes
    const optionRsi = this.calculateOptionRSI(optionCandles);
    
    if (optionRsi < 0) {
      this.logger.warn(`[RSI EXIT] Invalid RSI calculation`);
      return;
    }
    
    const optionSymbol = this.currentPosition.instrument.tradingsymbol;
    const positionType = this.currentPosition.type;
    
    this.logger.info(`[RSI EXIT] ${optionSymbol} | RSI(14): ${optionRsi.toFixed(1)} | Threshold: ${this.OPTION_RSI_CLIMAX_THRESHOLD}`);
    
    // GAMMA CLIMAX: Exit if RSI >= 85
    if (optionRsi >= this.OPTION_RSI_CLIMAX_THRESHOLD) {
      this.logger.info(`🔥 GAMMA CLIMAX DETECTED: ${optionSymbol} | RSI: ${optionRsi.toFixed(1)} >= ${this.OPTION_RSI_CLIMAX_THRESHOLD}`);
      this.logger.info(`   Position: ${positionType} | Entry: ₹${this.currentPosition.entryPrice.toFixed(2)} | Time in trade: ${(secondsSinceEntry / 60).toFixed(1)} mins`);
      this.logger.info(`   Action: FULL EXIT (Capturing blow-off top)`);
      
      await this.executeExit(`GAMMA_CLIMAX_RSI${optionRsi.toFixed(0)}`);
    } else {
      this.logger.info(`[RSI EXIT] ✅ RSI ${optionRsi.toFixed(1)} < ${this.OPTION_RSI_CLIMAX_THRESHOLD} - Held (no gamma climax)`);
    }
  }

  /**
   * Start 15-minute RSI exit monitoring
   * Aligned to 15-minute boundaries (9:15, 9:30, 9:45, etc.)
   */
  private startOptionRsiMonitoring(): void {
    if (this.optionRsiInterval || this.optionRsiInitialTimeout) {
      this.logger.debug('[RSI MONITOR] Already running');
      return;
    }
    
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    // Calculate next 15-minute boundary
    const nextBoundaryMinute = Math.ceil((currentMinute + 1) / 15) * 15;
    const minutesUntil = nextBoundaryMinute - currentMinute;
    const msUntilBoundary = (minutesUntil * 60 - currentSecond) * 1000;
    
    // Calculate exact next check time for logging
    const nextCheckTime = new Date(now.getTime() + msUntilBoundary);
    
    this.logger.info(`[RSI MONITOR] Starting. Next RSI check at ${nextCheckTime.toLocaleTimeString()} (in ${Math.round(msUntilBoundary / 1000)}s)`);
    
    // Initial delayed check at next 15-min boundary
    this.optionRsiInitialTimeout = setTimeout(() => {
      this.optionRsiInitialTimeout = null;
      
      // If position was closed while waiting, abort
      if (!this.currentPosition) {
        this.logger.debug('[RSI MONITOR] Position closed before first check, aborting');
        return;
      }
      
      // Run first check
      const firstCheckTime = new Date();
      this.logger.info(`[RSI MONITOR] First check triggered at ${firstCheckTime.toLocaleTimeString()}`);
      this.checkOptionRsiExit().catch(err => 
        this.logger.error('[RSI MONITOR] Error in initial check:', err)
      );
      
      // Then set up 15-minute interval
      this.optionRsiInterval = setInterval(async () => {
        if (!this.currentPosition) {
          this.stopOptionRsiMonitoring();
          return;
        }
        
        const checkTime = new Date();
        this.logger.info(`[RSI MONITOR] 15-min check triggered at ${checkTime.toLocaleTimeString()}`);
        
        try {
          await this.checkOptionRsiExit();
        } catch (error) {
          this.logger.error('[RSI MONITOR] Error in periodic check:', error);
        }
      }, this.OPTION_RSI_CHECK_INTERVAL);
      
    }, msUntilBoundary);
  }

  /**
   * Stop 15-minute RSI exit monitoring
   */
  private stopOptionRsiMonitoring(): void {
    if (this.optionRsiInitialTimeout) {
      clearTimeout(this.optionRsiInitialTimeout);
      this.optionRsiInitialTimeout = null;
    }
    if (this.optionRsiInterval) {
      clearInterval(this.optionRsiInterval);
      this.optionRsiInterval = null;
      this.logger.info('[RSI MONITOR] Stopped');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RSI-ACTIVATED LIVE PREMIUM TRAILING STOP (SHORT trades only)
  // When 5-min option RSI crosses 85, starts live polling with candle-LOW floor.
  // Primary exit: option premium breaks below most recently completed 5-min candle LOW.
  // Secondary exit: on 5-min candle close, RSI drops below 75.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if 5-min option RSI has crossed the activation threshold (85)
   * Called every 5 minutes aligned to candle boundaries.
   * If already activated, checks secondary exit (RSI < 75) and updates rolling floor.
   */
  private async check5MinOptionRsiForTrail(): Promise<void> {
    if (!this.currentPosition) return;
    
    // SHORT-only feature
    if (this.currentPosition.type !== 'SHORT') return;
    
    const now = new Date();
    const secondsSinceEntry = (now.getTime() - this.currentPosition.entryTime.getTime()) / 1000;
    
    // Micro-grace: Skip if just entered (same as 15-min RSI check)
    if (secondsSinceEntry < this.OPTION_RSI_MICRO_GRACE_SECONDS) {
      this.logger.debug(`[RSI TRAIL] Skipping: Entry was ${secondsSinceEntry.toFixed(0)}s ago (micro-grace)`);
      return;
    }
    
    // Fetch 5-min option candles
    const optionCandles = await this.fetchOption5MinCandles();
    
    if (optionCandles.length < 15) {
      this.logger.warn(`[RSI TRAIL] Insufficient 5-min option candles: ${optionCandles.length} (need 15+)`);
      return;
    }
    
    // Verify latest candle is completed (timestamp + 5min < now)
    const latestCandle = optionCandles[optionCandles.length - 1];
    if (!latestCandle) {
      this.logger.warn(`[RSI TRAIL] No latest candle available`);
      return;
    }
    
    const candleCloseTime = new Date(latestCandle.timestamp.getTime() + 5 * 60 * 1000);
    if (candleCloseTime > now) {
      this.logger.debug(`[RSI TRAIL] Latest 5-min candle not yet closed: ${latestCandle.timestamp.toLocaleTimeString()}`);
      return;
    }
    
    // Calculate RSI(14) on 5-min option closes
    const optionRsi = this.calculateOptionRSI(optionCandles);
    
    if (optionRsi < 0) {
      this.logger.warn(`[RSI TRAIL] Invalid RSI calculation`);
      return;
    }
    
    const optionSymbol = this.currentPosition.instrument.tradingsymbol;
    
    if (!this.rsiTrailActivated) {
      // === PRE-ACTIVATION: Check if RSI crosses threshold ===
      this.logger.info(`[RSI TRAIL] ${optionSymbol} | 5-min RSI(14): ${optionRsi.toFixed(1)} | Activation threshold: ${this.RSI_TRAIL_ACTIVATION_THRESHOLD}`);
      
      if (optionRsi >= this.RSI_TRAIL_ACTIVATION_THRESHOLD) {
        // ACTIVATION: Set floor to latest completed candle's LOW
        this.rsiTrailActivated = true;
        this.rsiTrailActivationRsi = optionRsi;
        this.rsiTrailFloorPrice = latestCandle.low;
        
        this.logger.info(`🔥 RSI TRAIL ACTIVATED: ${optionSymbol} | 5-min RSI: ${optionRsi.toFixed(1)} >= ${this.RSI_TRAIL_ACTIVATION_THRESHOLD}`);
        this.logger.info(`   Floor price: ₹${this.rsiTrailFloorPrice.toFixed(2)} (LOW of ${latestCandle.timestamp.toLocaleTimeString()} candle)`);
        this.logger.info(`   Starting live premium polling every ${this.RSI_TRAIL_POLL_INTERVAL_MS / 1000}s`);
        
        // Persist activation state
        this.saveCapitalData();
        
        // Start live premium polling
        this.startRsiTrailLivePolling();
      }
    } else {
      // === POST-ACTIVATION: Update rolling floor + check secondary exit ===
      
      // Update floor to latest completed candle's LOW (rolling trailing floor)
      const previousFloor = this.rsiTrailFloorPrice;
      this.rsiTrailFloorPrice = latestCandle.low;
      
      this.logger.info(`[RSI TRAIL] ${optionSymbol} | 5-min RSI: ${optionRsi.toFixed(1)} | Floor updated: ₹${previousFloor.toFixed(2)} → ₹${this.rsiTrailFloorPrice.toFixed(2)}`);
      
      // Secondary exit: RSI drops below 75 on candle close
      if (optionRsi < this.RSI_TRAIL_SECONDARY_EXIT_THRESHOLD) {
        this.logger.info(`🔥 RSI TRAIL SECONDARY EXIT: ${optionSymbol} | 5-min RSI: ${optionRsi.toFixed(1)} < ${this.RSI_TRAIL_SECONDARY_EXIT_THRESHOLD}`);
        this.logger.info(`   Activation RSI was: ${this.rsiTrailActivationRsi.toFixed(1)} | Entry: ₹${this.currentPosition.entryPrice.toFixed(2)}`);
        
        // Stop live polling BEFORE exit (prevent double-fire)
        this.stopRsiTrailMonitoring();
        
        await this.executeExit(`RSI_TRAIL_SECONDARY_EXIT_RSI${optionRsi.toFixed(0)}`);
      }
    }
  }

  /**
   * Start 5-minute RSI Trail monitoring
   * Aligned to 5-minute boundaries (9:20, 9:25, 9:30, etc.)
   * SHORT trades only — checks activation pre-trigger, and secondary exit + floor update post-trigger.
   */
  private startRsiTrail5MinMonitoring(): void {
    // Only for SHORT positions
    if (this.currentPosition?.type !== 'SHORT') {
      this.logger.debug('[RSI TRAIL] Skipping: Not a SHORT position');
      return;
    }
    
    if (this.rsiTrail5MinCheckInterval || this.rsiTrail5MinInitialTimeout) {
      this.logger.debug('[RSI TRAIL] 5-min monitoring already running');
      return;
    }
    
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    // Calculate next 5-minute boundary
    const nextBoundaryMinute = Math.ceil((currentMinute + 1) / 5) * 5;
    const minutesUntil = nextBoundaryMinute - currentMinute;
    const msUntilBoundary = (minutesUntil * 60 - currentSecond) * 1000;
    
    // Add slot stagger to avoid API collision with 15-min RSI checks
    const slotStaggerMs = this.slotIndex * 1000 + 2000; // +2s offset from 15-min checks
    const totalDelay = msUntilBoundary + slotStaggerMs;
    
    const nextCheckTime = new Date(now.getTime() + totalDelay);
    
    this.logger.info(`[RSI TRAIL] Starting 5-min monitoring. Next check at ${nextCheckTime.toLocaleTimeString()} (in ${Math.round(totalDelay / 1000)}s)`);
    if (this.rsiTrailActivated) {
      this.logger.info(`[RSI TRAIL] Resuming with activation state: floor ₹${this.rsiTrailFloorPrice.toFixed(2)}`);
    }
    
    // Initial delayed check at next 5-min boundary
    this.rsiTrail5MinInitialTimeout = setTimeout(() => {
      this.rsiTrail5MinInitialTimeout = null;
      
      if (!this.currentPosition) {
        this.logger.debug('[RSI TRAIL] Position closed before first check, aborting');
        return;
      }
      
      // Run first check
      this.logger.info(`[RSI TRAIL] First 5-min check triggered at ${new Date().toLocaleTimeString()}`);
      this.check5MinOptionRsiForTrail().catch(err =>
        this.logger.error('[RSI TRAIL] Error in initial check:', err)
      );
      
      // Then set up 5-minute interval
      this.rsiTrail5MinCheckInterval = setInterval(async () => {
        if (!this.currentPosition) {
          this.stopRsiTrailMonitoring();
          return;
        }
        
        this.logger.info(`[RSI TRAIL] 5-min check triggered at ${new Date().toLocaleTimeString()}`);
        
        try {
          await this.check5MinOptionRsiForTrail();
        } catch (error) {
          this.logger.error('[RSI TRAIL] Error in periodic check:', error);
        }
      }, 5 * 60 * 1000); // 5-minute interval
      
    }, totalDelay);
  }

  /**
   * Start live option premium polling (every 5 seconds)
   * Only called after RSI Trail activation (RSI >= 85 on 5-min option chart)
   * Exits when option premium breaks below the rolling candle-LOW floor.
   */
  private startRsiTrailLivePolling(): void {
    // Clear any existing polling
    if (this.rsiTrailPollingInterval) {
      clearInterval(this.rsiTrailPollingInterval);
      this.rsiTrailPollingInterval = null;
    }
    
    if (!this.currentPosition || !this.rsiTrailActivated) {
      this.logger.warn('[RSI TRAIL POLL] Cannot start: no position or trail not activated');
      return;
    }
    
    const optionSymbol = this.currentPosition.instrument.tradingsymbol;
    
    this.logger.info(`🎯 RSI TRAIL LIVE POLLING STARTED: ${optionSymbol}`, {
      pollInterval: `${this.RSI_TRAIL_POLL_INTERVAL_MS / 1000}s`,
      floorPrice: `₹${this.rsiTrailFloorPrice.toFixed(2)}`,
      activationRsi: this.rsiTrailActivationRsi.toFixed(1)
    });
    
    this.rsiTrailPollingInterval = setInterval(async () => {
      // Guard: position may have been closed by another exit mechanism
      if (!this.currentPosition) {
        this.stopRsiTrailMonitoring();
        return;
      }
      
      try {
        const optionTradingSymbol = this.currentPosition.instrument.tradingsymbol;
        const quoteKey = `NFO:${optionTradingSymbol}`;
        const quotes = await this.kiteConnect.getQuote([quoteKey]);
        const optionLTP = quotes[quoteKey]?.last_price;
        
        if (!optionLTP || optionLTP <= 0) {
          this.logger.warn('[RSI TRAIL POLL] Failed to fetch option LTP');
          return;
        }
        
        // Check if premium broke below floor
        if (optionLTP <= this.rsiTrailFloorPrice) {
          this.logger.info(`🔥 RSI TRAIL EXIT: ${optionTradingSymbol} | LTP ₹${optionLTP.toFixed(2)} <= Floor ₹${this.rsiTrailFloorPrice.toFixed(2)}`);
          this.logger.info(`   Entry: ₹${this.currentPosition.entryPrice.toFixed(2)} | Activation RSI: ${this.rsiTrailActivationRsi.toFixed(1)}`);
          
          // Stop polling BEFORE exit to prevent double-fire (same pattern as Emergency Stop)
          this.stopRsiTrailMonitoring();
          
          await this.executeExit('RSI_TRAIL_CANDLE_LOW_BREAK');
          return;
        }
        
        this.logger.debug(`[RSI TRAIL POLL] ${optionTradingSymbol} LTP: ₹${optionLTP.toFixed(2)} | Floor: ₹${this.rsiTrailFloorPrice.toFixed(2)} | Safe`);
        
      } catch (error) {
        this.logger.error('[RSI TRAIL POLL] Error fetching option quote:', error);
      }
    }, this.RSI_TRAIL_POLL_INTERVAL_MS);
  }

  /**
   * Stop all RSI Trail monitoring (5-min checks + live polling)
   * Called on position close, strategy stop, or when trail exit fires.
   */
  private stopRsiTrailMonitoring(): void {
    if (this.rsiTrailPollingInterval) {
      clearInterval(this.rsiTrailPollingInterval);
      this.rsiTrailPollingInterval = null;
      this.logger.info('[RSI TRAIL] Live polling stopped');
    }
    if (this.rsiTrail5MinCheckInterval) {
      clearInterval(this.rsiTrail5MinCheckInterval);
      this.rsiTrail5MinCheckInterval = null;
    }
    if (this.rsiTrail5MinInitialTimeout) {
      clearTimeout(this.rsiTrail5MinInitialTimeout);
      this.rsiTrail5MinInitialTimeout = null;
    }
    // Reset activation state
    this.rsiTrailActivated = false;
    this.rsiTrailFloorPrice = 0;
    this.rsiTrailActivationRsi = 0;
    this.logger.info('[RSI TRAIL] Monitoring stopped and state reset');
  }

  // ============================================================================
  // DEPRECATED METHODS - Kept for reference, no longer called
  // Real-time polling has been replaced with 5-minute candle close exit logic
  // ============================================================================

  /**
   * @deprecated - No longer used. Real-time polling disabled.
   * Exit logic moved to checkShortExitOnCandleClose() using Supertrend/BB Middle.
   */
  private async checkShortExitUnified(currentPremium: number, source: 'polling'): Promise<void> {
    this.logger.warn('⚠️ DEPRECATED: checkShortExitUnified called but real-time polling is disabled');
    return; // No-op - exit logic now in checkShortExitOnCandleClose()
  }

  /**
   * @deprecated - No longer used. Real-time polling disabled.
   * Exit logic moved to checkLongExitOnCandleClose() using Supertrend.
   */
  private async checkLongExitSimple(currentPremium: number, source: 'polling'): Promise<void> {
    this.logger.warn('⚠️ DEPRECATED: checkLongExitSimple called but real-time polling is disabled');
    return; // No-op - exit logic now in checkLongExitOnCandleClose()
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
        const totalQuantity = this.currentPosition.quantity * this.currentPosition.instrument.lot_size; // Use instrument's actual lot size
        const pnl = (orderResult.price - this.currentPosition.entryPrice) * totalQuantity;
        
        // Update capital with P&L
        this.currentCapital += pnl;
        
        // Create trade record for history
        const tradeRecord = {
          tradeId: `BB_${Date.now()}`,
          entryOrderId: this.currentPosition.entryOrderId, // Use real entry order ID
          exitOrderId: orderResult.orderId || `BB_EXIT_${Date.now()}`,
          instrument: this.currentPosition.instrument,
          direction: this.currentPosition.type,
          quantity: this.currentPosition.quantity * this.currentPosition.instrument.lot_size, // Total shares using actual lot size
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
        
        // P0-FIX: Record symbol exit for cooldown tracking (prevents repeated losses)
        // This notifies StrategyManager to block re-entry for 30 minutes
        StrategyManager.recordSymbolExitStatic(this.signalSymbol);
        
        // Position cleared - REST API polling will stop automatically
        
        this.currentPosition = null;
        
        // 🔒 CRITICAL FIX: Save IMMEDIATELY after clearing position and pushing trade record
        // This minimizes the race window where scanner's swapStrategy() could call stop()
        // and destroy the in-memory tradeHistory before it's persisted to disk.
        // Previously, saveCapitalData() was called AFTER all monitoring cleanup, creating a
        // window where the trade record could be lost if stop() was called concurrently.
        try {
          this.saveCapitalData();
          this.logger.info("💾 Position cleared from disk after exit");
          
          // Validate capital consistency after trade
          this.validateCapitalConsistency();
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
        
        // Stop Emergency Hard Stop monitoring
        this.stopEmergencyStopMonitoring();
        
        // P0: Stop Option RSI Climax monitoring
        this.stopOptionRsiMonitoring();
        
        // Stop RSI Trail monitoring (5-min checks + live polling)
        this.stopRsiTrailMonitoring();
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
   * P0: Schedule EOD safety exit at 3:19 PM
   * Critical fix to exit BEFORE broker's MIS auto-squareoff (~3:25 PM)
   * This avoids broker squareoff charges (₹50+ per order)
   */
  private scheduleEODExit(): void {
    const now = new Date();
    const eodTime = new Date();
    eodTime.setHours(15, 19, 0, 0); // 3:19 PM - 6 minutes before broker squareoff
    
    // Clear any existing timer first
    if (this.eodExitTimer) {
      clearTimeout(this.eodExitTimer);
      delete this.eodExitTimer;
    }
    
    // Only schedule if we haven't passed 3:19 PM today
    if (now < eodTime) {
      const delay = eodTime.getTime() - now.getTime();
      this.logger.info(`📅 EOD safety exit scheduled for 3:19 PM (in ${Math.round(delay / 60000)} minutes)`);
      
      this.eodExitTimer = setTimeout(async () => {
        if (this.currentPosition) {
          this.logger.warn('🕒 EOD safety exit triggered at 3:19 PM');
          await this.forceClosePosition('EOD_SAFETY_EXIT_3:19PM');
        } else {
          this.logger.info('✅ No active position at 3:19 PM, no EOD exit needed');
        }
      }, delay);
    } else {
      this.logger.info('⏰ Already past 3:19 PM today, no EOD exit scheduled');
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
    
    // 🚀 RESOURCE EFFICIENCY: Stagger reconciliation start per slot
    // Slot 0 starts immediately, Slot 1 after 1s, Slot 2 after 2s
    const slotStaggerMs = this.slotIndex * 1000;
    
    setTimeout(() => {
      // Run reconciliation every 2 minutes (faster detection of manual exits)
      this.positionReconciliationInterval = setInterval(async () => {
        if (this.currentPosition) {
          await this.reconcilePositions();
        }
      }, 2 * 60 * 1000); // Every 2 minutes
      
      this.logger.info(`✅ Slot ${this.slotIndex + 1} position reconciliation started (checks every 2 minutes, stagger: ${this.slotIndex}s)`);
    }, slotStaggerMs);
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
      this.logger.info(`🔄 Reconciling position: ${ourSymbol} (checking broker...)`);
      
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
        this.logger.info(`✅ Position reconciliation OK: ${ourSymbol} exists at broker (qty: ${brokerPosition.quantity})`);
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
   * Get last completed 5-minute candle close price (used as current stock price)
   */
  private getLastCompletedCandleClose(): number {
    if (this.candleHistory.length === 0) {
      return 0; // No fallback for stocks - price varies widely
    }
    const lastCandle = this.candleHistory[this.candleHistory.length - 1];
    return lastCandle ? lastCandle.close : 0;
  }

  /**
   * Get next Tuesday expiry date (for NIFTY weekly options - kept for reference)
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
   * Get next expiry date for stock options
   * Stock options in India typically have monthly expiry (last Thursday of month)
   * Some stocks also have weekly expiries - this finds the nearest available expiry
   */
  private getNextStockOptionExpiry(stockOptions: any[]): Date {
    // Get unique expiry dates sorted ascending
    const uniqueExpiries: Date[] = [...new Set(stockOptions.map((opt: any) => new Date(opt.expiry).getTime()))]
      .sort((a, b) => a - b)
      .map(ts => new Date(ts));
    
    const now = new Date();
    
    // Find the first expiry that's in the future
    for (const expiry of uniqueExpiries) {
      if (expiry.getTime() > now.getTime()) {
        this.logger.info(`📅 Found ${this.signalSymbol} expiry: ${expiry.toDateString()} (${uniqueExpiries.length} total expiries available)`);
        return expiry;
      }
    }
    
    // If no future expiry found (shouldn't happen), return the closest one
    if (uniqueExpiries.length > 0) {
      const latestExpiry = uniqueExpiries[uniqueExpiries.length - 1] as Date;
      this.logger.warn(`⚠️ No future ${this.signalSymbol} expiries found, using latest available: ${latestExpiry.toDateString()}`);
      return latestExpiry;
    }
    
    throw new Error(`No expiry dates found for ${this.signalSymbol} options`);
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
   * Select option instrument using ATM-based selection
   * Selects ATM or 1-strike OTM option with minimum ₹10 premium
   * 
   * @param optionType - 'CE' for calls, 'PE' for puts
   * @param spotPrice - Current stock spot price (used for ATM calculation)
   * @returns Option instrument with strike, premium, and strikeType
   */
  private async selectOptionInstrument(optionType: 'CE' | 'PE', spotPrice: number): Promise<any> {
    const MIN_PREMIUM = 10; // Minimum ₹10 premium required for liquidity
    
    try {
      // Get NFO instruments from cache (avoids 15MB API call on each entry)
      const instruments = await this.instrumentCache.getNFOInstruments();
      
      // Filter for stock options of specified type (using signal stock symbol)
      const stockOptions = instruments.filter((inst: any) => 
        inst.name === this.signalSymbol && 
        inst.instrument_type === optionType &&
        new Date(inst.expiry) > new Date() // Not expired
      );
      
      if (stockOptions.length === 0) {
        this.logger.warn(`⚠️ No ${this.signalSymbol} options found.`);
        const availableNames = [...new Set(instruments.map((i: any) => i.name))].sort();
        this.logger.debug(`Available option names in NFO: ${availableNames.slice(0, 20).join(', ')}...`);
        throw new Error(`No ${this.signalSymbol} options found in NFO instruments`);
      }
      
      // Get next expiry for stock options
      const nextExpiry = this.getNextStockOptionExpiry(stockOptions);
      
      this.logger.info(`🎯 Selecting ${optionType} option using ATM-BASED selection for ${this.signalSymbol}`);
      this.logger.info(`📅 Target expiry: ${nextExpiry.toDateString()}`);
      
      // Filter for next expiry options
      const expiryOptions = stockOptions.filter((opt: any) => {
        const isSameExpiry = Math.abs(new Date(opt.expiry).getTime() - nextExpiry.getTime()) < 24 * 60 * 60 * 1000;
        return isSameExpiry;
      });
      
      if (expiryOptions.length === 0) {
        throw new Error(`No suitable ${this.signalSymbol} options found for expiry ${nextExpiry.toDateString()}`);
      }
      
      // Sort options by strike price
      expiryOptions.sort((a: any, b: any) => a.strike - b.strike);
      
      // Find ATM strike
      const atmStrike = this.findATMStrike(expiryOptions, spotPrice);
      const atmOption = expiryOptions.find((opt: any) => opt.strike === atmStrike);
      
      if (!atmOption) {
        throw new Error(`ATM strike ${atmStrike} not found in ${this.signalSymbol} options`);
      }
      
      this.logger.info(`🎯 ATM Strike: ₹${atmStrike} (${this.signalSymbol} Spot: ₹${spotPrice.toFixed(2)})`);
      
      // Get strikes to check: ATM and 1-strike OTM
      // For CE: OTM = higher strike, For PE: OTM = lower strike
      const atmIndex = expiryOptions.findIndex((opt: any) => opt.strike === atmStrike);
      const otmIndex = optionType === 'CE' ? atmIndex + 1 : atmIndex - 1;
      
      // Build candidate list: [ATM, 1-OTM] (prioritize ATM)
      const candidates: Array<{ option: any; strikeType: 'ATM' | '1-OTM' }> = [];
      candidates.push({ option: atmOption, strikeType: 'ATM' });
      
      if (otmIndex >= 0 && otmIndex < expiryOptions.length) {
        candidates.push({ option: expiryOptions[otmIndex], strikeType: '1-OTM' });
      }
      
      // Get quotes for candidates
      const tokens = candidates.map(c => c.option.instrument_token);
      const quotes = await this.kiteConnect.getQuote(tokens);
      
      // Find first candidate with premium >= ₹10 (ATM preferred)
      for (const candidate of candidates) {
        const quote = quotes[candidate.option.instrument_token];
        const premium = quote?.last_price || 0;
        
        this.logger.info(`📊 Checking ${candidate.strikeType} Strike ₹${candidate.option.strike}: Premium ₹${premium.toFixed(2)}`);
        
        if (premium >= MIN_PREMIUM) {
          // Valid option found!
          candidate.option.last_price = premium;
          candidate.option.strikeType = candidate.strikeType;
          
          this.logger.info(`✅ Selected ${candidate.strikeType} option`, {
            tradingsymbol: candidate.option.tradingsymbol,
            strike: candidate.option.strike,
            premium: premium.toFixed(2),
            strikeType: candidate.strikeType
          });
          
          return candidate.option;
        } else {
          this.logger.warn(`⚠️ ${candidate.strikeType} Strike ₹${candidate.option.strike} rejected: Premium ₹${premium.toFixed(2)} < ₹${MIN_PREMIUM}`);
        }
      }
      
      // No valid option found
      this.logger.error(`❌ No ${this.signalSymbol} ${optionType} option found with premium ≥ ₹${MIN_PREMIUM}`);
      this.logger.error(`❌ ATM and 1-OTM both have insufficient liquidity`);
      return null;
      
    } catch (error) {
      this.logger.error('Error selecting option instrument:', error);
      return null;
    }
  }

  /**
   * Calculate LIMIT order price with market protection buffer
   * Zerodha blocks MARKET orders for stock options - we emulate market orders
   * using LIMIT orders with a 3% buffer to ensure fills
   * 
   * @param ltp - Last Traded Price
   * @param transaction - 'BUY' or 'SELL'
   * @returns Limit price rounded to tick size (0.05)
   */
  private calculateLimitPrice(ltp: number, transaction: 'BUY' | 'SELL'): number {
    const BUFFER_PERCENT = 0.03; // 3% market protection buffer
    const TICK_SIZE = 0.05;
    
    // BUY: willing to pay up to 3% more than LTP
    // SELL: willing to accept up to 3% less than LTP
    const rawPrice = transaction === 'BUY' 
      ? ltp * (1 + BUFFER_PERCENT)
      : ltp * (1 - BUFFER_PERCENT);
    
    // Round to tick size (options trade in 0.05 increments)
    const limitPrice = Math.round(rawPrice / TICK_SIZE) * TICK_SIZE;
    
    return Math.max(limitPrice, TICK_SIZE); // Ensure minimum price of 0.05
  }

  /**
   * Execute order (BUY/SELL) using LIMIT orders with market protection
   * Note: Zerodha blocks MARKET orders for stock options due to illiquidity
   * We use LIMIT orders with a 3% buffer to emulate market order behavior
   */
  private async executeOrder(transaction: 'BUY' | 'SELL', instrument: any, quantity: number): Promise<{ success: boolean; price: number; orderId?: string }> {
    try {
      this.logger.info('Executing order', {
        transaction,
        instrument: instrument.tradingsymbol,
        quantity
      });
      
      // Step 1: Fetch LIVE LTP for the instrument
      const quoteKey = `${instrument.exchange}:${instrument.tradingsymbol}`;
      const quotes = await this.kiteConnect.getQuote([quoteKey]);
      const quoteData = quotes[quoteKey];
      const ltp = quoteData?.last_price;
      
      if (!ltp || ltp <= 0) {
        this.logger.error('Failed to fetch LTP for limit price calculation', {
          instrument: instrument.tradingsymbol,
          quoteKey,
          quotes
        });
        return { success: false, price: 0 };
      }
      
      // Step 1.5a: LIQUIDITY GUARD - Reject penny options for ENTRY only (high slippage, low liquidity)
      // EXIT orders must ALWAYS be allowed regardless of premium — blocking exits causes stuck positions
      const MIN_OPTION_PREMIUM = 10; // Minimum ₹10 premium required for entry
      if (ltp < MIN_OPTION_PREMIUM && transaction === 'BUY') {
        this.logger.error(`❌ LIQUIDITY GUARD: Option premium ₹${ltp.toFixed(2)} is below minimum ₹${MIN_OPTION_PREMIUM}`, {
          instrument: instrument.tradingsymbol,
          ltp,
          minRequired: MIN_OPTION_PREMIUM,
          reason: 'Penny options have high slippage and low liquidity - entry rejected for safety'
        });
        return { success: false, price: 0 };
      }
      if (ltp < MIN_OPTION_PREMIUM && transaction === 'SELL') {
        this.logger.warn(`⚠️ LIQUIDITY WARNING: Exiting at low premium ₹${ltp.toFixed(2)} (below ₹${MIN_OPTION_PREMIUM}) - proceeding with exit`, {
          instrument: instrument.tradingsymbol,
          ltp
        });
      }
      
      // Step 1.5b: LIQUIDITY GUARD - Check OI and Volume before execution (ENTRY only)
      // EXIT orders must ALWAYS proceed — a stuck position is worse than slippage
      const CRITICAL_OI = 10000;   // Minimum OI to execute
      const CRITICAL_VOL = 100;    // Minimum Volume to execute
      const oi = quoteData?.oi || 0;
      const volume = quoteData?.volume || 0;
      
      if (oi < CRITICAL_OI && volume < CRITICAL_VOL && transaction === 'BUY') {
        this.logger.error(`❌ EXECUTION ABORTED: Liquidity Evaporated! ${instrument.tradingsymbol} - OI:${oi} Vol:${volume} (Need OI≥${CRITICAL_OI} OR Vol≥${CRITICAL_VOL})`, {
          instrument: instrument.tradingsymbol,
          oi,
          volume,
          criticalOI: CRITICAL_OI,
          criticalVol: CRITICAL_VOL,
          reason: 'Option liquidity dropped below critical threshold - entry aborted for safety'
        });
        return { success: false, price: 0 };
      }
      if (oi < CRITICAL_OI && volume < CRITICAL_VOL && transaction === 'SELL') {
        this.logger.warn(`⚠️ LIQUIDITY WARNING: Low liquidity exit - OI:${oi} Vol:${volume} - proceeding with exit anyway`, {
          instrument: instrument.tradingsymbol
        });
      }
      
      this.logger.info(`✅ Liquidity check passed: OI:${oi}, Vol:${volume}`, {
        instrument: instrument.tradingsymbol
      });
      
      // Step 1.5c: SPREAD CHECK - Reject entries with wide bid-ask spread (high impact cost)
      // Only check on BUY (entries) - never block exits due to spread
      if (transaction === 'BUY') {
        const MAX_SPREAD_PERCENT = 2.0; // Maximum allowed spread percentage
        const depth = quoteData?.depth;
        const bestBid = depth?.buy?.[0]?.price || 0;
        const bestAsk = depth?.sell?.[0]?.price || 0;
        
        if (bestBid > 0 && bestAsk > 0) {
          const spreadPercent = ((bestAsk - bestBid) / bestBid) * 100;
          
          if (spreadPercent > MAX_SPREAD_PERCENT) {
            this.logger.error(`❌ HIGH_SPREAD_REJECTION: ${instrument.tradingsymbol} spread ${spreadPercent.toFixed(2)}% > ${MAX_SPREAD_PERCENT}% threshold | Bid:₹${bestBid.toFixed(2)} Ask:₹${bestAsk.toFixed(2)} - ENTRY ABORTED`, {
              instrument: instrument.tradingsymbol,
              bestBid,
              bestAsk,
              spreadPercent: spreadPercent.toFixed(2),
              maxAllowed: MAX_SPREAD_PERCENT,
              reason: 'Wide bid-ask spread indicates high impact cost - entry rejected for safety'
            });
            return { success: false, price: 0 };
          }
          
          this.logger.info(`✅ Spread check passed: ${spreadPercent.toFixed(2)}% (max ${MAX_SPREAD_PERCENT}%)`, {
            instrument: instrument.tradingsymbol,
            bestBid,
            bestAsk
          });
        } else {
          this.logger.warn(`⚠️ Could not verify spread (empty depth) - proceeding with caution`, {
            instrument: instrument.tradingsymbol,
            depthAvailable: !!depth
          });
        }
      }
      
      // Step 2: Calculate limit price with market protection buffer
      const limitPrice = this.calculateLimitPrice(ltp, transaction);
      
      this.logger.info('Calculated limit price with market protection', {
        ltp,
        transaction,
        limitPrice,
        bufferPercent: '3%'
      });
      
      // Step 3: Place LIMIT order (MARKET orders blocked for stock options)
      const orderParams = {
        exchange: instrument.exchange,
        tradingsymbol: instrument.tradingsymbol,
        transaction_type: transaction,
        quantity: quantity * instrument.lot_size,
        product: 'MIS', // Intraday
        order_type: 'LIMIT',
        price: limitPrice,
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
   * Implements "Clean Kill" - auto-cancels orphan orders on timeout
   */
  private async waitForOrderExecution(orderId: string): Promise<number> {
    const maxAttempts = 24; // 5 seconds * 24 = 2 minutes
    const checkInterval = 5000; // Check every 5 seconds (reduces API calls)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const orderHistory = await this.kiteConnect.getOrderHistory(orderId);
        const latestOrder = orderHistory[orderHistory.length - 1];
        
        if (latestOrder.status === 'COMPLETE') {
          this.logger.info(`✅ Order ${orderId} filled at ₹${latestOrder.average_price || latestOrder.price}`);
          return latestOrder.average_price || latestOrder.price;
        }
        
        if (['REJECTED', 'CANCELLED'].includes(latestOrder.status)) {
          throw new Error(`Order ${latestOrder.status}: ${latestOrder.status_message}`);
        }
        
        // Wait before next check
        await this.sleep(checkInterval);
        
      } catch (error) {
        this.logger.error(`Error checking order status (attempt ${attempt + 1}):`, error);
      }
    }
    
    // === CLEAN KILL: Cancel orphan order to prevent late fills ===
    this.logger.error(`❌ Order ${orderId} timed out after 2 minutes. Attempting to CANCEL to prevent orphan...`);
    
    try {
      await this.kiteConnect.cancelOrder('regular', orderId);
      this.logger.info(`🗑️ Cancellation request sent for order ${orderId}`);
      
      // Wait for cancellation to process
      await this.sleep(2000);
      
      // Verify final order state (edge case: order may have filled during cancellation)
      const finalHistory = await this.kiteConnect.getOrderHistory(orderId);
      const finalStatus = finalHistory[finalHistory.length - 1];
      
      if (finalStatus.status === 'COMPLETE') {
        // Order filled at the last second - return success!
        this.logger.warn(`⚠️ Order ${orderId} filled during cancellation attempt! Price: ₹${finalStatus.average_price}`);
        return finalStatus.average_price || finalStatus.price;
      }
      
      if (finalStatus.status === 'CANCELLED') {
        this.logger.info(`✅ Orphan order ${orderId} cancelled successfully. No position created.`);
        throw new Error('Order execution timed out and was cancelled to prevent orphan position');
      }
      
      // Still OPEN somehow - critical error
      this.logger.error(`💀 CRITICAL: Order ${orderId} neither filled nor cancelled! Status: ${finalStatus.status}`);
      this.logger.error(`💀 MANUAL INTERVENTION REQUIRED - Check broker terminal immediately!`);
      throw new Error(`Order in unknown state (${finalStatus.status}) - MANUAL CHECK REQUIRED`);
      
    } catch (cancelError: any) {
      // Check if it's our own thrown error (not a cancellation failure)
      if (cancelError.message?.includes('cancelled') || cancelError.message?.includes('MANUAL CHECK')) {
        throw cancelError;
      }
      
      this.logger.error(`💀 CRITICAL: Failed to cancel orphan order ${orderId}!`, cancelError);
      this.logger.error(`💀 MANUAL INTERVENTION REQUIRED - Order may fill later causing unknown position!`);
      throw new Error(`Order cancellation failed - MANUAL INTERVENTION REQUIRED: ${cancelError.message}`);
    }
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
      currentStockLTP: this.currentStockLTP,
      signalSymbol: this.signalSymbol,
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
      currentStockLTP: this.currentStockLTP,
      signalSymbol: this.signalSymbol,
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
   * Calculate total P&L from current capital
   * Single source of truth: currentCapital
   */
  private getTotalPnL(): number {
    return this.currentCapital - this.INITIAL_CAPITAL;
  }

  /**
   * Validate capital consistency against trade history
   * Ensures currentCapital = 200000 + sum(all trade P&Ls)
   */
  private validateCapitalConsistency(): { valid: boolean; difference: number } {
    try {
      const calculatedCapital = this.INITIAL_CAPITAL + this.tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
      const diff = Math.abs(this.currentCapital - calculatedCapital);
      
      if (diff > 1) { // Allow ₹1 for rounding errors
        this.logger.error('❌ Capital mismatch detected!', {
          currentCapital: this.currentCapital.toFixed(2),
          calculatedFromHistory: calculatedCapital.toFixed(2),
          difference: diff.toFixed(2),
          totalTrades: this.tradeHistory.length,
          initialCapital: this.INITIAL_CAPITAL,
          totalPnLFromTrades: this.tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0).toFixed(2)
        });
        return { valid: false, difference: diff };
      }
      
      this.logger.debug('✅ Capital validation passed', {
        capital: this.currentCapital.toFixed(2),
        trades: this.tradeHistory.length
      });
      
      return { valid: true, difference: diff };
    } catch (error) {
      this.logger.error('Error validating capital:', error);
      return { valid: false, difference: 0 };
    }
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
    
    const initialCapital = this.INITIAL_CAPITAL;
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
      capitalChange: (this.currentCapital - this.INITIAL_CAPITAL).toFixed(2),
      capitalChangePercent: ((this.currentCapital - this.INITIAL_CAPITAL) / this.INITIAL_CAPITAL * 100).toFixed(2)
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
  private async executeLongEntryWithRetry(stockPrice: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date, breakoutConsecutiveCount?: number): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeLongEntry(stockPrice, entryCandleHigh, entryCandleLow, entryCandleTimestamp, breakoutConsecutiveCount),
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
  private async executeShortEntryWithRetry(stockPrice: number, entryCandleHigh?: number, entryCandleLow?: number, entryCandleTimestamp?: Date, breakoutConsecutiveCount?: number): Promise<void> {
    try {
      await this.retryOperation(
        () => this.executeShortEntry(stockPrice, entryCandleHigh, entryCandleLow, entryCandleTimestamp, breakoutConsecutiveCount),
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
