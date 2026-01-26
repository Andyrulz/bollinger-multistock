import { StrategyBase, StrategyConfig, StrategyStatus } from './StrategyBase';
import { StrategyRegistry } from './StrategyRegistry';
import { Logger } from '../utils/Logger';
import { InstrumentCache } from '../utils/InstrumentCache';
import { MarketScanner, ScoredStock } from '../services/MarketScanner';
import { QuoteManager } from '../services/QuoteManager';
import { AuthService } from '../services/AuthService';
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
      
      // Load strategy configurations
      await this.loadStrategyConfigs();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // NEW: Schedule pre-market checks and scanner
      this.schedulePreMarketCheck();
      this.scheduleScanner();
      
      this.isInitialized = true;
      this.logger.info('✅ Strategy Manager initialized successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize Strategy Manager:', error);
      throw error;
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
        if (instance.getName().includes('bollinger') || instance.getName().includes('5m')) {
          threshold = 360000; // 6 minutes threshold for 5-minute strategies
        }
        
        if (timeSinceUpdate > threshold && instance.isRunning()) {
          this.logger.warn(`⚠️ Strategy ${instance.getName()} may be unresponsive (${timeSinceUpdate}ms since last update, threshold: ${threshold}ms)`);
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

    await this.stopAllStrategies();
    
    this.logger.info('✅ Strategy Manager shutdown complete');
  }

  /**
   * Schedule pre-market data fetch checks
   */
  private schedulePreMarketCheck(): void {
    this.logger.info('📅 Scheduling pre-market data fetch checks');

    this.preMarketCheckInterval = setInterval(async () => {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      if (currentTime === 540 && !this.isDataCached) {
        if (await this.authService.isAuthenticatedAndValid()) {
          this.logger.info('🕘 09:00 AM: Auth valid, fetching pre-market data');
          await this.fetchPreMarketData();
        } else {
          this.logger.info('⏳ 09:00 AM: Waiting for login...');
          this.needsPreMarketFetch = true;
        }
      }

      if (currentTime > 540 && currentTime < 570 && this.needsPreMarketFetch) {
        if (await this.authService.isAuthenticatedAndValid()) {
          this.logger.info('✅ Login detected, fetching pre-market data now');
          await this.fetchPreMarketData();
          this.needsPreMarketFetch = false;
        }
      }

      if (currentTime >= 570 && !this.isDataCached) {
        this.logger.error('🚫 Login after 09:30 - Scanner aborted');
        this.needsPreMarketFetch = false;
        if (this.preMarketCheckInterval) {
          clearInterval(this.preMarketCheckInterval);
        }
      }

      if (currentTime === 935) {
        this.logger.info('🧹 Post-market cleanup: Resetting cache for next day');
        this.isDataCached = false;
        this.needsPreMarketFetch = false;
        this.marketScanner.clearCache();
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

  private scheduleScanner(): void {
    this.logger.info('📅 Scheduling market scanner for 09:30 AM');
    const scheduleNextScan = () => {
      const now = new Date();
      const scanTime = new Date(now);
      scanTime.setHours(9, 30, 5, 0);
      if (now >= scanTime) {
        scanTime.setDate(scanTime.getDate() + 1);
      }
      const delay = scanTime.getTime() - now.getTime();
      setTimeout(async () => {
        await this.runScanner();
        scheduleNextScan();
      }, delay);
    };
    scheduleNextScan();
  }

  private async runScanner(): Promise<void> {
    try {
      this.logger.info('🔍 09:30 AM: Running market scanner...');
      if (!this.isDataCached) {
        await this.sleep(5000);
        if (!this.isDataCached) {
          this.logger.error('❌ Scanner aborted: Data not available');
          return;
        }
      }
      const result = await this.marketScanner.scanUniverse();
      this.logger.info(`Scanner: ${result.scannedCount} scanned, ${result.selected.length} selected`);
      if (result.selected.length === 0) {
        this.logger.info('📭 No stocks qualified today');
        return;
      }
      await this.deployMultipleStrategies(result.selected);
    } catch (error) {
      this.logger.error('Failed to run scanner:', error);
    }
  }

  private async deployMultipleStrategies(stocks: ScoredStock[]): Promise<void> {
    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      if (!stock) continue; // Skip if undefined
      
      try {
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
            scannerData: {
              score: stock.score,
              bias: stock.bias,
              sector: stock.sector,
              atmOption: stock.atmOption,
              historicalData: stock.historicalData,
            },
            capitalAllocation: 65000,
            strategyIndex: i, // For staggered polling (0, 1, 2 -> 4th, 5th, 6th second)
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
        this.logger.info(`✅ ${stock.symbol}: Strategy deployed`);
      } catch (error) {
        this.logger.error(`❌ ${stock.symbol}: Deployment failed`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual scanner trigger for API endpoint
   */
  public async runManualScanner(): Promise<any> {
    this.logger.info('🔍 Manual scanner triggered');
    
    // Check if data is cached
    if (!this.isDataCached) {
      this.logger.warn('⚠️ Data not cached, fetching now...');
      const result = await this.marketScanner.cacheHistoricalData();
      if (!result.success) {
        throw new Error('Failed to cache historical data');
      }
      this.isDataCached = true;
    }
    
    // Run scanner
    const scannerResult = await this.marketScanner.scanUniverse();
    
    // Store results
    this.lastScannerResults = scannerResult;
    
    // Deploy strategies if stocks selected
    if (scannerResult.selected.length > 0) {
      await this.deployMultipleStrategies(scannerResult.selected);
    }
    
    return scannerResult;
  }

  /**
   * Get last scanner results
   */
  public async getLastScannerResults(): Promise<any> {
    return this.lastScannerResults || null;
  }

  private lastScannerResults: any = null;
}