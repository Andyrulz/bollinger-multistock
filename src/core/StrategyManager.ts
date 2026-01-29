import { StrategyBase, StrategyConfig, StrategyStatus } from './StrategyBase';
import { StrategyRegistry } from './StrategyRegistry';
import { Logger } from '../utils/Logger';
import { InstrumentCache } from '../utils/InstrumentCache';
import { MarketScanner, ScoredStock, ScannerResult } from '../services/MarketScanner';
import { QuoteManager } from '../services/QuoteManager';
import { AuthService } from '../services/AuthService';
import { OIHistoryService } from '../services/OIHistoryService';
import fs from 'fs';
import path from 'path';

export interface StrategyManagerConfig {
  configPath: string;
  autoStart: boolean;
  healthCheckInterval: number;
}

export interface GlobalMetrics {
  totalStrategies: number;
  activeStrategies: number;
  totalProfitLoss: number;
  totalTrades: number;
  systemHealth: 'healthy' | 'warning' | 'error';
}

/**
 * Smart Retention Configuration
 * Controls hourly rebalancing behavior
 */
export interface SmartRetentionConfig {
  enabled: boolean;
  scanTimes: string[];              // ['09:35', '10:35', '11:35', '12:35', '13:35', '14:35']
  keepThreshold: number;            // 6.0 - minimum score to retain existing strategy
  minDeployScore: number;           // 7.0 - minimum score to deploy NEW strategy
  lockOnActivePosition: boolean;    // true - never swap if in position
  swapOnBiasFlip: boolean;          // true - swap if LONG↔SHORT flip
  lastScanCutoff: string;           // '14:35' - no scans after this
}

/**
 * Slot state tracking for Smart Retention
 */
export interface SlotState {
  slotNumber: number;               // 0, 1, 2
  symbol: string | null;            // 'CHOLAFIN' or null if empty
  strategyId: string | null;        // 'bollinger-cholafin' or null
  deployedAt: Date | null;          // When strategy was deployed
  lastScanScore: number | null;     // Score from last scan
  lastScanBias: 'LONG' | 'SHORT' | null;  // Bias from last scan
  locked: boolean;                  // True if has active position
}

/**
 * Retention decision for logging
 */
type RetentionDecision = 'LOCK' | 'KEEP' | 'SWAP' | 'DEPLOY';
type SwapReason = 'empty_slot' | 'active_position' | 'still_top_tier' | 'momentum_died' | 'bias_flip' | 'not_in_scan';

/**
 * Central manager for all trading strategies
 * Handles loading, starting, stopping, and monitoring of multiple strategies
 */
export class StrategyManager {
  private kiteConnect: any;
  private logger: Logger;
  private config: StrategyManagerConfig;
  private healthCheckTimer?: NodeJS.Timeout;
  private isInitialized: boolean = false;
  private marketScanner: MarketScanner;
  private quoteManager: QuoteManager;
  private instrumentCache: InstrumentCache;
  private authService: AuthService;
  private preMarketCheckInterval: NodeJS.Timeout | null = null;
  private needsPreMarketFetch: boolean = false;
  private isDataCached: boolean = false;
  private hasScannerRunToday: boolean = false; // Prevent duplicate scanner runs
  private lastScannerDate: string = ''; // Track date of last scan

  // Smart Retention: Slot tracking
  private slotStates: SlotState[] = [
    { slotNumber: 0, symbol: null, strategyId: null, deployedAt: null, lastScanScore: null, lastScanBias: null, locked: false },
    { slotNumber: 1, symbol: null, strategyId: null, deployedAt: null, lastScanScore: null, lastScanBias: null, locked: false },
    { slotNumber: 2, symbol: null, strategyId: null, deployedAt: null, lastScanScore: null, lastScanBias: null, locked: false },
  ];

  // Smart Retention: Configuration
  private smartRetentionConfig: SmartRetentionConfig = {
    enabled: true,
    scanTimes: ['09:18', '10:18', '11:18', '12:18', '13:18', '14:18'],
    keepThreshold: 6.0,
    minDeployScore: 7.0,
    lockOnActivePosition: true,
    swapOnBiasFlip: true,
    lastScanCutoff: '14:18',
  };

  // Hourly scanner timer (setTimeout for precise XX:18:05 timing)
  private nextScanTimer: NodeJS.Timeout | null = null;
  
  // Race condition guard: Prevents concurrent scans
  private isScanInProgress: boolean = false;

  // OI History Service for Smart Money detection
  private oiHistoryService: OIHistoryService | null = null;
  private eodOISaverTimer: NodeJS.Timeout | null = null;

  constructor(
    kiteConnect: any,
    authService: AuthService,
    logger: Logger,
    quoteManager: QuoteManager,
    config: StrategyManagerConfig
  ) {
    this.kiteConnect = kiteConnect;
    this.authService = authService;
    this.logger = logger;
    this.quoteManager = quoteManager;
    this.config = config;

    // Initialize InstrumentCache (shared across scanner and strategies)
    this.instrumentCache = new InstrumentCache(this.kiteConnect, this.logger);

    // Initialize MarketScanner with InstrumentCache
    this.marketScanner = new MarketScanner(
      this.kiteConnect,
      this.logger,
      this.instrumentCache,
      {
        minScore: 7.0,
        topCount: 3,
        minPremium: 10,
        sectorChangeThreshold: { green: 0.25, red: -0.25 },
      }
    );
  }

  /**
   * Initialize the strategy manager and load strategy configurations
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('⚠️ StrategyManager already initialized');
      return;
    }

    try {
      this.logger.info('🚀 Initializing Strategy Manager...');
      
      // Initialize the strategy registry
      StrategyRegistry.initialize(this.logger);
      
      // Register all available strategies
      await this.registerStrategies();
      
      // CRITICAL: Restore slot states from disk BEFORE anything else
      // This prevents scanner from overwriting active positions on restart
      await this.restoreSlotStatesFromDisk();
      
      // CRITICAL: Immediately restore strategies for LOCKED slots (active positions)
      // This must happen BEFORE any scanner runs to ensure positions are monitored
      await this.restoreLockedSlotStrategies();
      
      // Load strategy configurations
      await this.loadStrategyConfigs();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Schedule pre-market checks
      this.schedulePreMarketCheck();
      
      // Schedule hourly scanner with Smart Retention
      this.scheduleHourlyScanner();
      
      // Initialize OI History Service for Smart Money detection
      await this.initializeOIHistoryService();
      
      this.isInitialized = true;
      this.logger.info('✅ Strategy Manager initialized successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize Strategy Manager:', error);
      throw error;
    }
  }

  /**
   * CRITICAL: Restore slot states from disk on startup
   * This prevents the scanner from overwriting active positions when bot restarts
   * 
   * Checks each slot's data file (bollinger-slot{N}.json) for activePosition
   * If found, pre-populates slotState and marks as LOCKED
   */
  private async restoreSlotStatesFromDisk(): Promise<void> {
    this.logger.info('🔄 Restoring slot states from disk...');
    
    const dataDir = path.join(__dirname, '..', 'data');
    let restoredCount = 0;
    let activePositionsFound = 0;
    
    for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
      const slotNumber = slotIndex + 1;
      const slotDataFile = path.join(dataDir, `bollinger-slot${slotNumber}.json`);
      
      try {
        if (!fs.existsSync(slotDataFile)) {
          this.logger.info(`   Slot ${slotNumber}: No data file found`);
          continue;
        }
        
        const rawData = fs.readFileSync(slotDataFile, 'utf8');
        const slotData = JSON.parse(rawData);
        
        // Check if there's an active position
        if (slotData.activePosition && slotData.activePosition !== null) {
          const position = slotData.activePosition;
          
          // Extract underlying symbol from tradingsymbol (e.g., "BEL26FEB430CE" → "BEL")
          const tradingsymbol = position.instrument?.tradingsymbol || '';
          const extractedSymbol = tradingsymbol.match(/^([A-Z]+)/)?.[1];
          const symbol = extractedSymbol || position.underlying || 'UNKNOWN';
          
          // Determine direction from position type
          const direction = position.type === 'LONG' ? 'LONG' : 'SHORT';
          
          this.logger.info(`   🔒 Slot ${slotNumber}: ACTIVE POSITION FOUND - ${symbol}`);
          this.logger.info(`      Position: ${direction} | Entry: ₹${position.entryPrice} | Option: ${tradingsymbol}`);
          
          // Pre-populate slot state with SLOT-BASED strategy ID to prevent conflicts
          this.slotStates[slotIndex] = {
            slotNumber: slotIndex,
            symbol: symbol,
            strategyId: `bollinger-slot${slotNumber}-${symbol.toLowerCase()}`,
            deployedAt: position.entryTime ? new Date(position.entryTime) : new Date(),
            lastScanScore: null,
            lastScanBias: direction,
            locked: true, // CRITICAL: Lock the slot to prevent scanner from touching it
          };
          
          activePositionsFound++;
          restoredCount++;
          
          this.logger.info(`      ✅ Slot ${slotNumber} LOCKED - Scanner will NOT overwrite this position`);
          
        } else if (slotData.symbol) {
          // No active position, but strategy was deployed (slot was in use)
          this.logger.info(`   📦 Slot ${slotNumber}: Previously deployed to ${slotData.symbol} (no active position)`);
          restoredCount++;
        } else {
          this.logger.info(`   📭 Slot ${slotNumber}: Empty (no active position)`);
        }
        
      } catch (error) {
        this.logger.warn(`   ⚠️ Slot ${slotNumber}: Failed to read data file - ${error}`);
      }
    }
    
    if (activePositionsFound > 0) {
      this.logger.info(`\n🔐 POSITION PROTECTION ENABLED:`);
      this.logger.info(`   ${activePositionsFound} active position(s) found and LOCKED`);
      this.logger.info(`   Scanner will skip these slots to prevent orphaning positions`);
    } else {
      this.logger.info(`   No active positions found in slot data files`);
    }
    
    this.logger.info(`✅ Slot state restoration complete (${restoredCount} slots processed)`);
  }

  /**
   * CRITICAL: Restore strategies for LOCKED slots immediately at boot
   * This ensures positions are being monitored BEFORE any scanner runs
   * Prevents orphaned positions when same stock is picked by scanner
   */
  private async restoreLockedSlotStrategies(): Promise<void> {
    const lockedSlots = this.slotStates.filter(s => s.locked && s.symbol);
    
    if (lockedSlots.length === 0) {
      this.logger.info('📭 No locked slots to restore');
      return;
    }
    
    this.logger.info(`\n🔧 RESTORING ${lockedSlots.length} LOCKED SLOT STRATEGIES...`);
    
    for (const slotState of lockedSlots) {
      const slotIndex = slotState.slotNumber;
      const slotNumber = slotIndex + 1;
      
      this.logger.info(`   📍 Slot ${slotNumber}: Restoring ${slotState.symbol}...`);
      
      // Check if strategy already exists in registry
      const existingStrategy = StrategyRegistry.getInstance(slotState.strategyId!);
      if (existingStrategy) {
        this.logger.info(`   ✅ Strategy ${slotState.strategyId} already running`);
        continue;
      }
      
      // Restore the strategy from slot data
      const restored = await this.restoreStrategyFromSlotData(slotIndex, slotState);
      
      if (restored) {
        this.logger.info(`   ✅ Slot ${slotNumber}: ${slotState.symbol} strategy restored and monitoring position`);
      } else {
        this.logger.error(`   ❌ CRITICAL: Slot ${slotNumber}: Failed to restore ${slotState.symbol} strategy!`);
        this.logger.error(`   ⚠️ Position may be ORPHANED - manual intervention required!`);
      }
    }
    
    this.logger.info(`✅ Locked slot restoration complete\n`);
  }

  /**
   * Restore a strategy from its slot data file
   * Used when bot restarts with an active position but strategy isn't in registry
   */
  private async restoreStrategyFromSlotData(slotIndex: number, slotState: SlotState): Promise<boolean> {
    const slotNumber = slotIndex + 1;
    const dataDir = path.join(__dirname, '..', 'data');
    const slotDataFile = path.join(dataDir, `bollinger-slot${slotNumber}.json`);
    
    try {
      if (!fs.existsSync(slotDataFile)) {
        this.logger.error(`   ❌ Slot data file not found: ${slotDataFile}`);
        return false;
      }
      
      const rawData = fs.readFileSync(slotDataFile, 'utf8');
      const slotData = JSON.parse(rawData);
      
      if (!slotData.activePosition) {
        this.logger.error(`   ❌ No active position in slot data - cannot restore`);
        return false;
      }
      
      const position = slotData.activePosition;
      const symbol = slotState.symbol || position.underlying || 'UNKNOWN';
      
      this.logger.info(`   🔧 Restoring strategy for ${symbol} from slot data...`);
      
      // Create strategy config from slot data with SLOT-BASED ID
      const config: StrategyConfig = {
        id: slotState.strategyId || `bollinger-slot${slotNumber}-${symbol.toLowerCase()}`,
        name: `Bollinger Band - ${symbol} (RESTORED)`,
        enabled: true,
        description: `Restored from active position on restart`,
        timeframe: '5min',
        instruments: [symbol],
        riskPerTrade: 0.8,
        maxPositions: 1,
        config: {
          period: 20,
          stdDev: 2.0,
          // Pass existing position data so strategy can restore it
          restoreFromPosition: true,
          restoredPositionData: position,
          capitalAllocation: slotData.capital || 65000,
          strategyIndex: slotIndex,
        },
      };
      
      // Create the strategy instance
      const strategy = await StrategyRegistry.createInstance(
        'bollinger-band',
        this.kiteConnect,
        this.logger,
        this.quoteManager,
        this.instrumentCache,
        config,
      );
      
      // Start the strategy (it will restore its position from the data file)
      await strategy.start();
      
      this.logger.info(`   ✅ Strategy ${config.id} restored and started`);
      return true;
      
    } catch (error) {
      this.logger.error(`   ❌ Failed to restore strategy from slot data:`, error);
      return false;
    }
  }

  /**
   * Register all available strategy classes
   */
  private async registerStrategies(): Promise<void> {
    this.logger.info('📋 Registering strategy classes...');
    
    try {
      // Import and register Bollinger Band Strategy
      const { BollingerBandStrategy } = await import('../strategies/bollinger-band/BollingerBandStrategy');
      StrategyRegistry.registerStrategy('bollinger-band', BollingerBandStrategy);
      
      this.logger.info(`✅ Registered ${StrategyRegistry.getRegisteredStrategies().length} strategy classes`);
      
    } catch (error) {
      this.logger.error('❌ Failed to register strategies:', error);
      throw error;
    }
  }

  /**
   * Load strategy configurations from config file
   */
  private async loadStrategyConfigs(): Promise<void> {
    this.logger.info(`📄 Loading strategy configurations from: ${this.config.configPath}`);
    
    try {
      if (!fs.existsSync(this.config.configPath)) {
        this.logger.warn('⚠️ Strategy config file not found, creating default configuration');
        await this.createDefaultConfig();
      }
      
      const configData = fs.readFileSync(this.config.configPath, 'utf8');
      const configs = JSON.parse(configData);
      
      // Create strategy instances for enabled strategies
      for (const strategyConfig of configs.strategies) {
        if (strategyConfig.enabled) {
          await this.createStrategyInstance(strategyConfig);
        } else {
          this.logger.info(`⏸️ Strategy disabled: ${strategyConfig.name}`);
        }
      }
      
      this.logger.info(`✅ Loaded ${StrategyRegistry.getActiveInstances().length} strategy configurations`);
      
    } catch (error) {
      this.logger.error('❌ Failed to load strategy configurations:', error);
      throw error;
    }
  }

  /**
   * Create a strategy instance from configuration
   */
  private async createStrategyInstance(config: StrategyConfig): Promise<void> {
    try {
      const strategyClass = config.id.replace(/-\d+$/, ''); // Remove instance number if present
      await StrategyRegistry.createInstance(strategyClass, this.kiteConnect, this.logger, this.quoteManager, this.instrumentCache, config);
      
      if (this.config.autoStart) {
        const instance = StrategyRegistry.getInstance(config.id);
        if (instance && instance.isEnabled()) {
          // Note: Don't auto-start here, let the user control this via dashboard
          this.logger.info(`⏳ Strategy ready for manual start: ${config.name}`);
        }
      }
      
    } catch (error) {
      this.logger.error(`❌ Failed to create strategy instance ${config.id}:`, error);
    }
  }

  /**
   * Start a specific strategy by ID
   */
  public async startStrategy(strategyId: string): Promise<boolean> {
    const instance = StrategyRegistry.getInstance(strategyId);
    
    if (!instance) {
      this.logger.error(`❌ Strategy not found: ${strategyId}`);
      return false;
    }

    try {
      await instance.start();
      this.logger.info(`🚀 Started strategy: ${instance.getName()}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to start strategy ${strategyId}:`, error);
      return false;
    }
  }

  /**
   * Stop a specific strategy by ID
   */
  public async stopStrategy(strategyId: string): Promise<boolean> {
    const instance = StrategyRegistry.getInstance(strategyId);
    
    if (!instance) {
      this.logger.error(`❌ Strategy not found: ${strategyId}`);
      return false;
    }

    try {
      await instance.stop();
      this.logger.info(`⏹️ Stopped strategy: ${instance.getName()}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to stop strategy ${strategyId}:`, error);
      return false;
    }
  }

  /**
   * Start all enabled strategies
   */
  public async startAllStrategies(): Promise<void> {
    const instances = StrategyRegistry.getAllInstances();
    
    for (const [id, instance] of instances) {
      if (instance.isEnabled() && !instance.isRunning()) {
        await this.startStrategy(id);
      }
    }
  }

  /**
   * Stop all running strategies
   */
  public async stopAllStrategies(): Promise<void> {
    const instances = StrategyRegistry.getAllInstances();
    
    for (const [id, instance] of instances) {
      if (instance.isRunning()) {
        await this.stopStrategy(id);
      }
    }
  }

  /**
   * Get status of a specific strategy
   */
  public getStrategyStatus(strategyId: string): StrategyStatus | null {
    const instance = StrategyRegistry.getInstance(strategyId);
    return instance ? instance.getStatus() : null;
  }

  /**
   * Get status of all strategies
   */
  public getAllStrategyStatuses(): Map<string, StrategyStatus> {
    const statuses = new Map<string, StrategyStatus>();
    const instances = StrategyRegistry.getAllInstances();
    
    for (const [id, instance] of instances) {
      statuses.set(id, instance.getStatus());
    }
    
    return statuses;
  }

  /**
   * Get global system metrics
   */
  public getGlobalMetrics(): GlobalMetrics {
    const instances = StrategyRegistry.getAllInstances();
    let totalProfitLoss = 0;
    let totalTrades = 0;
    let activeStrategies = 0;
    let hasErrors = false;
    let hasWarnings = false;

    for (const [, instance] of instances) {
      const metrics = instance.getMetrics();
      totalProfitLoss += metrics.profitLoss;
      totalTrades += metrics.totalTrades;
      
      if (metrics.isActive) {
        activeStrategies++;
      }
      
      if (metrics.healthStatus === 'error') {
        hasErrors = true;
      } else if (metrics.healthStatus === 'warning') {
        hasWarnings = true;
      }
    }

    const systemHealth = hasErrors ? 'error' : hasWarnings ? 'warning' : 'healthy';

    return {
      totalStrategies: instances.size,
      activeStrategies,
      totalProfitLoss,
      totalTrades,
      systemHealth
    };
  }

  /**
   * Create default configuration file
   */
  private async createDefaultConfig(): Promise<void> {
    const defaultConfig = {
      strategies: [
        {
          id: "bollinger-band-01", 
          name: "5m option Buy: bollinger band entry and trail",
          enabled: true,
          description: "Bollinger Band strategy with trailing stop",
          timeframe: "5min",
          instruments: ["NIFTY", "BANKNIFTY"],
          riskPerTrade: 0.8,
          maxPositions: 2,
          config: {
            period: 20,
            stdDev: 2.0,
            trailType: "percentage",
            trailValue: 1.5,
            riskReward: {
              stopLoss: 2.0,
              target: 4.0
            },
            positionSizing: {
              riskAmount: 10000,
              riskPercentage: 2.0
            }
          }
        }
      ],
      global: {
        autoStart: true,
        healthCheckInterval: 30000,
        logging: {
          level: "info",
          separateFiles: true
        },
        riskManagement: {
          maxDailyLoss: 50000,
          maxDrawdown: 100000,
          emergencyStop: true
        }
      }
    };

    // Ensure config directory exists
    const configDir = path.dirname(this.config.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(this.config.configPath, JSON.stringify(defaultConfig, null, 2));
    this.logger.info('✅ Created default strategy configuration file');
  }

  /**
   * Start health monitoring for all strategies
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('❌ Health check failed:', error);
      }
    }, this.config.healthCheckInterval);

    this.logger.info(`💓 Started health monitoring (interval: ${this.config.healthCheckInterval}ms)`);
  }

  /**
   * Perform health check on all strategies
   */
  private async performHealthCheck(): Promise<void> {
    const instances = StrategyRegistry.getAllInstances();
    
    for (const [id, instance] of instances) {
      try {
        const metrics = instance.getMetrics();
        
        // Check if strategy is responsive with strategy-specific thresholds
        const timeSinceUpdate = Date.now() - metrics.lastUpdateTime.getTime();
        
        // Strategy-aware health check thresholds
        let threshold = 60000; // Default 1 minute for real-time strategies
        
        // Bollinger Band strategy uses 5-minute intervals, so allow up to 6 minutes before warning
        // Use case-insensitive check since strategy name is "Bollinger Band - STOCK"
        const strategyName = instance.getName().toLowerCase();
        if (strategyName.includes('bollinger') || strategyName.includes('5m')) {
          threshold = 360000; // 6 minutes threshold for 5-minute strategies
        }
        
        if (timeSinceUpdate > threshold && instance.isRunning()) {
          this.logger.warn(`⚠️ Strategy ${instance.getName()} may be unresponsive (${Math.round(timeSinceUpdate/1000)}s since last update, threshold: ${threshold/1000}s)`);
        }
        
      } catch (error) {
        this.logger.error(`❌ Health check failed for strategy ${id}:`, error);
      }
    }
  }

  /**
   * Shutdown the strategy manager and all strategies
   */
  public async shutdown(): Promise<void> {
    this.logger.info('🔄 Shutting down Strategy Manager...');
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    // Clear the scheduled scan timer
    if (this.nextScanTimer) {
      clearTimeout(this.nextScanTimer);
      this.nextScanTimer = null;
    }

    await this.stopAllStrategies();
    
    this.logger.info('✅ Strategy Manager shutdown complete');
  }

  /**
   * Schedule post-market cleanup
   * Note: Pre-market data fetch is now handled by hourly scanner (fetches fresh data each scan)
   */
  private schedulePreMarketCheck(): void {
    this.logger.info('📅 Scheduling post-market cleanup timer');

    this.preMarketCheckInterval = setInterval(async () => {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      // 15:35 PM - Post-market cleanup
      if (currentTime === 935) {
        this.logger.info('🧹 Post-market cleanup: Resetting state for next day');
        this.isDataCached = false;
        this.needsPreMarketFetch = false;
        this.hasScannerRunToday = false; // Reset scanner flag for next day
        this.lastScannerResults = null;  // Clear cached results
        this.marketScanner.clearCache();
        
        // Reset slot states for next day
        for (const slot of this.slotStates) {
          slot.symbol = null;
          slot.strategyId = null;
          slot.deployedAt = null;
          slot.lastScanScore = null;
          slot.lastScanBias = null;
          slot.locked = false;
        }
        this.logger.info('🧹 Slot states reset for next trading day');
        
        if (global.gc) {
          global.gc();
        }
      }
    }, 60000);
  }

  private async fetchPreMarketData(): Promise<void> {
    try {
      this.logger.info('📊 Fetching pre-market historical data...');
      const result = await this.marketScanner.cacheHistoricalData();
      if (result.success) {
        this.isDataCached = true;
        this.logger.info(`✅ Pre-market data cached: ${result.count} stocks ready`);
      } else {
        this.isDataCached = false;
      }
    } catch (error) {
      this.logger.error('Failed to fetch pre-market data:', error);
      this.isDataCached = false;
    }
  }

  /**
   * Schedule hourly scanner with Smart Retention
   * Uses precise setTimeout to fire at exactly XX:35:05 (5 seconds after candle close)
   */
  private scheduleHourlyScanner(): void {
    this.logger.info('📅 Scheduling hourly Smart Retention scanner');
    this.logger.info(`📅 Scan times: ${this.smartRetentionConfig.scanTimes.join(', ')} (at :05 seconds)`);

    // Schedule the first scan
    this.scheduleNextScan();
    
    this.logger.info('✅ Hourly scanner scheduled');
  }

  /**
   * Calculate the next scan time (XX:35:05)
   * Returns Date object for next scheduled scan
   */
  private getNextScanTime(): Date | null {
    const now = new Date();
    const scanTimes = this.smartRetentionConfig.scanTimes;
    
    if (!scanTimes || scanTimes.length === 0) {
      return null;
    }
    
    // Try each scan time today
    for (const scanTime of scanTimes) {
      const parts = scanTime.split(':');
      if (parts.length < 2) continue;
      const hour = parseInt(parts[0]!, 10);
      const minute = parseInt(parts[1]!, 10);
      const scanDate = new Date();
      scanDate.setHours(hour, minute, 5, 0); // XX:35:05.000
      
      // If this scan time is in the future, use it
      if (scanDate > now) {
        return scanDate;
      }
    }
    
    // All scan times have passed today - schedule first scan tomorrow
    const firstScan = scanTimes[0]!;
    const firstScanParts = firstScan.split(':');
    const hour = parseInt(firstScanParts[0]!, 10);
    const minute = parseInt(firstScanParts[1]!, 10);
    const tomorrowScan = new Date();
    tomorrowScan.setDate(tomorrowScan.getDate() + 1);
    tomorrowScan.setHours(hour, minute, 5, 0);
    return tomorrowScan;
  }

  /**
   * Schedule setTimeout for the next scan at XX:35:05
   * Does NOT run any scan - only sets the timer
   */
  private scheduleNextScan(): void {
    // Clear any existing timer
    if (this.nextScanTimer) {
      clearTimeout(this.nextScanTimer);
      this.nextScanTimer = null;
    }
    
    const nextScanTime = this.getNextScanTime();
    if (!nextScanTime) {
      this.logger.warn('⚠️ Could not calculate next scan time');
      return;
    }
    
    const now = new Date();
    const delay = nextScanTime.getTime() - now.getTime();
    
    // Format time for logging
    const timeStr = nextScanTime.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
    const delayMinutes = Math.floor(delay / 60000);
    const delaySeconds = Math.floor((delay % 60000) / 1000);
    
    this.logger.info(`⏰ Next scan scheduled for ${timeStr} (in ${delayMinutes}m ${delaySeconds}s)`);
    
    // Schedule the callback
    this.nextScanTimer = setTimeout(() => {
      this.scheduledScanCallback();
    }, delay);
  }

  /**
   * Callback for scheduled scans (timer-triggered)
   * Runs the scan AND reschedules the next one
   */
  private async scheduledScanCallback(): Promise<void> {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Check if we're past the cutoff
    if (currentTime > this.smartRetentionConfig.lastScanCutoff) {
      this.logger.info(`⏭️ Skipping scan at ${currentTime} - past cutoff (${this.smartRetentionConfig.lastScanCutoff})`);
      this.scheduleNextScan(); // Schedule for tomorrow
      return;
    }
    
    // Check if authenticated
    if (!await this.authService.isAuthenticatedAndValid()) {
      this.logger.warn(`⏭️ Skipping scan at ${currentTime} - not authenticated`);
      this.scheduleNextScan(); // Try next scan time
      return;
    }
    
    this.logger.info(`🕐 ${currentTime}:05: Triggering scheduled Smart Retention scan...`);
    await this.runHourlyScan();
    
    // Schedule the next scan
    this.scheduleNextScan();
  }

  /**
   * Initialize OI History Service for Smart Money detection
   * Loads yesterday's OI data and schedules EOD saver
   */
  private async initializeOIHistoryService(): Promise<void> {
    this.logger.info('📊 Initializing OI History Service for Smart Money detection...');
    
    try {
      this.oiHistoryService = new OIHistoryService(
        this.kiteConnect,
        this.logger,
        this.instrumentCache
      );
      
      // Load yesterday's OI data
      const loaded = await this.oiHistoryService.loadYesterdayOI();
      if (loaded) {
        this.logger.info('✅ OI History: Ready for Smart Money scoring');
      } else {
        this.logger.info('📭 OI History: No prior data - Smart Money scoring disabled until EOD save');
      }
      
      // Connect to MarketScanner for Smart Money scoring
      this.marketScanner.setOIHistoryService(this.oiHistoryService);
      
      // Schedule EOD OI saver at 3:40 PM
      this.scheduleEODOISaver();
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize OI History Service:', error);
      this.oiHistoryService = null;
    }
  }

  /**
   * Schedule End-of-Day OI saver at 3:40 PM IST (weekdays only)
   */
  private scheduleEODOISaver(): void {
    this.logger.info('📅 Scheduling EOD OI Saver at 3:40 PM (weekdays only)');
    
    const scheduleNextEODSave = () => {
      const now = new Date();
      const targetHour = 15;  // 3 PM
      const targetMinute = 40;
      
      // Calculate target time
      const target = new Date(now);
      target.setHours(targetHour, targetMinute, 0, 0);
      
      // If target time has passed today, move to tomorrow
      if (now > target) {
        target.setDate(target.getDate() + 1);
      }
      
      // Skip weekends: Saturday (6) -> Monday, Sunday (0) -> Monday
      const dayOfWeek = target.getDay();
      if (dayOfWeek === 6) {
        // Saturday -> Move to Monday
        target.setDate(target.getDate() + 2);
        this.logger.info('📅 EOD OI Save: Skipping Saturday, scheduled for Monday');
      } else if (dayOfWeek === 0) {
        // Sunday -> Move to Monday
        target.setDate(target.getDate() + 1);
        this.logger.info('📅 EOD OI Save: Skipping Sunday, scheduled for Monday');
      }
      
      const delay = target.getTime() - now.getTime();
      const delayMinutes = Math.floor(delay / 60000);
      const delayHours = Math.floor(delayMinutes / 60);
      const remainingMinutes = delayMinutes % 60;
      
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const targetDayName = dayNames[target.getDay()];
      
      this.logger.info(`⏰ EOD OI Save scheduled for ${targetDayName} ${target.toLocaleTimeString()} (in ${delayHours}h ${remainingMinutes}m)`);
      
      this.eodOISaverTimer = setTimeout(async () => {
        // Double-check it's a weekday before running
        const runDay = new Date().getDay();
        if (runDay >= 1 && runDay <= 5) {
          await this.runEODOISave();
        } else {
          this.logger.info('📅 EOD OI Save: Skipped (weekend)');
        }
        // Reschedule for next trading day
        scheduleNextEODSave();
      }, delay);
    };
    
    scheduleNextEODSave();
  }

  /**
   * Run End-of-Day OI save
   */
  private async runEODOISave(): Promise<void> {
    const now = new Date();
    this.logger.info(`💾 Running EOD OI Save at ${now.toLocaleTimeString()}...`);
    
    if (!this.oiHistoryService) {
      this.logger.error('❌ OI History Service not initialized');
      return;
    }
    
    // Check if authenticated
    if (!await this.authService.isAuthenticatedAndValid()) {
      this.logger.warn('⏭️ Skipping EOD OI Save - not authenticated');
      return;
    }
    
    const result = await this.oiHistoryService.saveEndOfDayOI();
    
    if (result.success) {
      this.logger.info(`✅ EOD OI Save complete: ${result.count} stocks saved at ${now.toLocaleTimeString()}`);
    } else {
      this.logger.error(`❌ EOD OI Save failed: ${result.errors.join(', ')}`);
    }
  }

  /**
   * Get OI History Service instance (for API endpoints)
   */
  public getOIHistoryService(): OIHistoryService | null {
    return this.oiHistoryService;
  }

  /**
   * Manually trigger EOD OI save (for testing)
   */
  public async triggerEODOISave(): Promise<{ success: boolean; count: number; errors: string[] }> {
    if (!this.oiHistoryService) {
      return { success: false, count: 0, errors: ['OI History Service not initialized'] };
    }
    return this.oiHistoryService.saveEndOfDayOI();
  }

  /**
   * Run hourly scan with Smart Retention logic
   * Can be called by scheduled timer OR manual trigger
   * Has race condition guard to prevent concurrent scans
   */
  private async runHourlyScan(): Promise<void> {
    // Race condition guard: Prevent concurrent scans
    if (this.isScanInProgress) {
      this.logger.warn('⏭️ Scan already in progress, skipping this request');
      return;
    }
    
    this.isScanInProgress = true;
    
    try {
      const scanStartTime = Date.now();
      this.logger.info('🔍 Smart Retention: Starting hourly scan...');
      
      // Step 1: Re-fetch historical data (ALWAYS - fresh data is mandatory)
      this.logger.info('📊 Step 1: Re-fetching historical data for all stocks...');
      const cacheResult = await this.marketScanner.cacheHistoricalData();
      if (!cacheResult.success) {
        this.logger.error('❌ Smart Retention: Failed to cache historical data');
        return;
      }
      this.isDataCached = true;
      
      // Step 2: Run full scan
      this.logger.info('📊 Step 2: Running universe scan...');
      const scannerResult = await this.marketScanner.scanUniverse();
      this.lastScannerResults = scannerResult;
      
      this.logger.info(`📊 Scan complete: ${scannerResult.scannedCount} scanned, ${scannerResult.allScored.length} scored, ${scannerResult.selected.length} selected`);
      
      // Step 3: Rebalance strategies using Smart Retention
      this.logger.info('📊 Step 3: Rebalancing with Smart Retention...');
      await this.rebalanceStrategies(scannerResult);
      
      const duration = ((Date.now() - scanStartTime) / 1000).toFixed(1);
      this.logger.info(`✅ Smart Retention scan complete in ${duration}s`);
      
    } catch (error) {
      this.logger.error('❌ Smart Retention scan failed:', error);
    } finally {
      // Always release the lock
      this.isScanInProgress = false;
    }
  }

  /**
   * Smart Retention: Rebalance strategies based on scan results
   * 
   * Decision Logic:
   * 1. LOCK: Has active position → never touch
   * 2. KEEP: No position, but score still ≥ keepThreshold (6.0) → retain
   * 3. SWAP: Score dropped below threshold OR bias flipped → replace
   * 4. DEPLOY: Empty slot → deploy top available candidate
   */
  private async rebalanceStrategies(scannerResult: ScannerResult): Promise<void> {
    const allScored = scannerResult.allScored;
    const selectedCandidates = scannerResult.selected; // Top 3 with valid options
    
    // Track which stocks are already deployed (to avoid duplicates)
    const deployedSymbols = new Set<string>();
    
    // CRITICAL: Pre-populate deployedSymbols with LOCKED slot symbols
    // This prevents scanner from deploying the same stock to an empty slot
    for (const slotState of this.slotStates) {
      if (slotState.locked && slotState.symbol) {
        deployedSymbols.add(slotState.symbol);
        this.logger.info(`   🔒 Pre-reserving ${slotState.symbol} (locked in Slot ${slotState.slotNumber + 1})`);
      }
    }
    
    this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.info('🔄 SMART RETENTION REBALANCE');
    this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Process each slot
    for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
      const slotState = this.slotStates[slotIndex];
      if (!slotState) continue;
      
      this.logger.info(`\n📦 Slot ${slotIndex + 1}: ${slotState.symbol || '(empty)'}`);
      
      // CASE 1: Slot is empty → Deploy
      if (!slotState.symbol || !slotState.strategyId) {
        await this.handleEmptySlot(slotIndex, selectedCandidates, deployedSymbols);
        continue;
      }
      
      // CRITICAL CHECK: If slot is LOCKED (has active position from restart), never treat as empty
      if (slotState.locked) {
        this.logger.info(`   🔒 Slot ${slotIndex + 1} is LOCKED with active position - protecting ${slotState.symbol}`);
        
        // If strategy doesn't exist in registry, we need to re-create it
        let strategy = StrategyRegistry.getInstance(slotState.strategyId);
        if (!strategy) {
          this.logger.info(`   ⚠️ Strategy ${slotState.strategyId} not in registry - attempting to restore...`);
          const restored = await this.restoreStrategyFromSlotData(slotIndex, slotState);
          if (restored) {
            this.logger.info(`   ✅ Strategy restored successfully - position protected`);
          } else {
            this.logger.error(`   ❌ CRITICAL: Failed to restore strategy - position may be orphaned!`);
          }
        }
        
        // Mark as deployed and continue (never swap a locked slot)
        deployedSymbols.add(slotState.symbol!);
        this.logRetentionDecision(slotIndex, slotState.symbol!, 'LOCK', 'active_position', 'Protected from restart');
        continue;
      }
      
      // Get the running strategy instance
      const strategy = StrategyRegistry.getInstance(slotState.strategyId);
      if (!strategy) {
        this.logger.warn(`   ⚠️ Strategy ${slotState.strategyId} not found in registry - treating as empty`);
        slotState.symbol = null;
        slotState.strategyId = null;
        await this.handleEmptySlot(slotIndex, selectedCandidates, deployedSymbols);
        continue;
      }
      
      // Mark this symbol as deployed
      deployedSymbols.add(slotState.symbol);
      
      // CASE 2: Has active position → LOCK
      const status = strategy.getStatus() as any;
      const hasActivePosition = !!status?.positionInfo;
      
      if (hasActivePosition && this.smartRetentionConfig.lockOnActivePosition) {
        this.logRetentionDecision(slotIndex, slotState.symbol, 'LOCK', 'active_position', null);
        slotState.locked = true;
        continue;
      }
      slotState.locked = false;
      
      // Find current stock in new scan results
      const stockInScan = allScored.find(s => s.symbol === slotState.symbol);
      
      // CASE 3: Stock not in scan results (sector turned flat, etc.)
      if (!stockInScan) {
        this.logRetentionDecision(slotIndex, slotState.symbol, 'SWAP', 'not_in_scan', null);
        await this.swapStrategy(slotIndex, selectedCandidates, deployedSymbols);
        continue;
      }
      
      // CASE 4: Bias flipped (was LONG now SHORT or vice versa)
      if (this.smartRetentionConfig.swapOnBiasFlip && 
          slotState.lastScanBias && 
          stockInScan.bias !== slotState.lastScanBias) {
        this.logRetentionDecision(slotIndex, slotState.symbol, 'SWAP', 'bias_flip', 
          `${slotState.lastScanBias} → ${stockInScan.bias}`);
        await this.swapStrategy(slotIndex, selectedCandidates, deployedSymbols);
        continue;
      }
      
      // Update slot state with latest scan data
      slotState.lastScanScore = stockInScan.score;
      slotState.lastScanBias = stockInScan.bias;
      
      // CASE 5: Score dropped below keepThreshold
      if (stockInScan.score < this.smartRetentionConfig.keepThreshold) {
        this.logRetentionDecision(slotIndex, slotState.symbol, 'SWAP', 'momentum_died',
          `Score ${stockInScan.score.toFixed(1)} < ${this.smartRetentionConfig.keepThreshold}`);
        await this.swapStrategy(slotIndex, selectedCandidates, deployedSymbols);
        continue;
      }
      
      // CASE 6: Stock still meets threshold → KEEP
      this.logRetentionDecision(slotIndex, slotState.symbol, 'KEEP', 'still_top_tier',
        `Score ${stockInScan.score.toFixed(1)} ≥ ${this.smartRetentionConfig.keepThreshold}`);
    }
    
    this.logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logSlotSummary();
  }

  /**
   * Handle empty slot - deploy best available candidate
   */
  private async handleEmptySlot(
    slotIndex: number, 
    candidates: ScoredStock[], 
    deployedSymbols: Set<string>
  ): Promise<void> {
    // Find first candidate not already deployed
    const availableCandidate = candidates.find(c => !deployedSymbols.has(c.symbol));
    
    if (!availableCandidate) {
      this.logger.info(`   📭 No available candidates for Slot ${slotIndex + 1}`);
      return;
    }
    
    this.logRetentionDecision(slotIndex, availableCandidate.symbol, 'DEPLOY', 'empty_slot',
      `Score ${availableCandidate.score.toFixed(1)}`);
    
    await this.deployToSlot(slotIndex, availableCandidate);
    deployedSymbols.add(availableCandidate.symbol);
  }

  /**
   * Swap strategy in a slot - stop current, deploy new
   */
  private async swapStrategy(
    slotIndex: number,
    candidates: ScoredStock[],
    deployedSymbols: Set<string>
  ): Promise<void> {
    const slotState = this.slotStates[slotIndex];
    if (!slotState) return;
    
    // Step 1: Stop current strategy
    if (slotState.strategyId) {
      this.logger.info(`   ⏹️ Stopping ${slotState.symbol}...`);
      await this.stopAndRemoveStrategy(slotState.strategyId);
      
      // Remove from deployed set (it's no longer running)
      deployedSymbols.delete(slotState.symbol!);
    }
    
    // Step 2: Small delay for file I/O cleanup
    await this.sleep(500);
    
    // Step 3: Clear slot state
    slotState.symbol = null;
    slotState.strategyId = null;
    slotState.deployedAt = null;
    slotState.lastScanScore = null;
    slotState.lastScanBias = null;
    
    // Step 4: Deploy new candidate
    await this.handleEmptySlot(slotIndex, candidates, deployedSymbols);
  }

  /**
   * Deploy a strategy to a specific slot
   */
  private async deployToSlot(slotIndex: number, stock: ScoredStock): Promise<void> {
    const slotState = this.slotStates[slotIndex];
    if (!slotState) return;
    
    try {
      // Use SLOT-BASED strategy ID to prevent conflicts when same stock is in multiple slots
      const slotNumber = slotIndex + 1;
      const strategyId = `bollinger-slot${slotNumber}-${stock.symbol.toLowerCase()}`;
      
      const config: StrategyConfig = {
        id: strategyId,
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
          scannerData: {
            score: stock.score,
            bias: stock.bias,
            sector: stock.sector,
            atmOption: stock.atmOption,
            historicalData: stock.historicalData,
          },
          capitalAllocation: 65000,
          strategyIndex: slotIndex,
        },
      };
      
      const strategy = await StrategyRegistry.createInstance(
        'bollinger-band',
        this.kiteConnect,
        this.logger,
        this.quoteManager,
        this.instrumentCache,
        config,
      );
      
      await strategy.start();
      
      // Update slot state
      slotState.symbol = stock.symbol;
      slotState.strategyId = strategyId;
      slotState.deployedAt = new Date();
      slotState.lastScanScore = stock.score;
      slotState.lastScanBias = stock.bias;
      slotState.locked = false;
      
      this.logger.info(`   ✅ ${stock.symbol} deployed to Slot ${slotIndex + 1}`);
      
    } catch (error) {
      this.logger.error(`   ❌ Failed to deploy ${stock.symbol}:`, error);
    }
  }

  /**
   * Stop and remove a strategy from registry
   */
  private async stopAndRemoveStrategy(strategyId: string): Promise<void> {
    try {
      const instance = StrategyRegistry.getInstance(strategyId);
      if (instance) {
        await instance.stop();
        StrategyRegistry.removeInstance(strategyId);
        this.logger.info(`   🗑️ Removed strategy: ${strategyId}`);
      }
    } catch (error) {
      this.logger.error(`   ❌ Error stopping strategy ${strategyId}:`, error);
    }
  }

  /**
   * Log retention decision with consistent format
   */
  private logRetentionDecision(
    slotIndex: number,
    symbol: string,
    decision: RetentionDecision,
    reason: SwapReason,
    details: string | null
  ): void {
    const icons: Record<RetentionDecision, string> = {
      'LOCK': '🔒',
      'KEEP': '🛡️',
      'SWAP': '♻️',
      'DEPLOY': '🚀',
    };
    
    const reasonText: Record<SwapReason, string> = {
      'empty_slot': 'Empty slot',
      'active_position': 'Active position (protected)',
      'still_top_tier': 'Still performing well',
      'momentum_died': 'Momentum dropped',
      'bias_flip': 'Bias reversed',
      'not_in_scan': 'Dropped from scan (sector flat/filtered)',
    };
    
    const message = `   ${icons[decision]} ${decision}: ${symbol} - ${reasonText[reason]}${details ? ` (${details})` : ''}`;
    this.logger.info(message);
  }

  /**
   * Log summary of all slots
   */
  private logSlotSummary(): void {
    this.logger.info('📊 SLOT SUMMARY:');
    for (const slot of this.slotStates) {
      const status = slot.symbol 
        ? `${slot.symbol} (Score: ${slot.lastScanScore?.toFixed(1) || '?'}, ${slot.lastScanBias || '?'})${slot.locked ? ' 🔒' : ''}`
        : '(empty)';
      this.logger.info(`   Slot ${slot.slotNumber + 1}: ${status}`);
    }
  }

  // Legacy method kept for compatibility
  private async deployMultipleStrategies(stocks: ScoredStock[]): Promise<void> {
    for (let i = 0; i < stocks.length && i < 3; i++) {
      const stock = stocks[i];
      if (!stock) continue;
      await this.deployToSlot(i, stock);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual scanner trigger for API endpoint
   * Uses Smart Retention rebalancing
   * @param force - If true, forces a complete rescan even if recently scanned
   */
  public async runManualScanner(force: boolean = false): Promise<any> {
    this.logger.info(`🔍 Manual scanner triggered${force ? ' (FORCED)' : ''}`);
    
    // Check if authenticated
    if (!await this.authService.isAuthenticatedAndValid()) {
      throw new Error('Not authenticated - please login first');
    }
    
    // Run hourly scan (which includes Smart Retention)
    await this.runHourlyScan();
    
    return {
      ...this.lastScannerResults,
      slotStates: this.slotStates,
      message: 'Smart Retention scan complete'
    };
  }

  /**
   * Get last scanner results
   */
  public async getLastScannerResults(): Promise<any> {
    return this.lastScannerResults || null;
  }

  /**
   * Get current slot states for dashboard
   */
  public getSlotStates(): SlotState[] {
    return this.slotStates;
  }

  private lastScannerResults: any = null;
}