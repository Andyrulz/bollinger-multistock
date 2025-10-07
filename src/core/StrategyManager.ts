import { StrategyBase, StrategyConfig, StrategyStatus } from './StrategyBase';
import { StrategyRegistry } from './StrategyRegistry';
import { Logger } from '../utils/Logger';
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

  constructor(kiteConnect: any, logger: Logger, config: StrategyManagerConfig) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.config = config;
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
      // Import and register Breakout Pullback Strategy
      const { BreakoutPullbackWrapper } = await import('../strategies/breakout-pullback/BreakoutPullbackWrapper');
      StrategyRegistry.registerStrategy('breakout-pullback', BreakoutPullbackWrapper);
      
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
      await StrategyRegistry.createInstance(strategyClass, this.kiteConnect, this.logger, config);
      
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
          id: "breakout-pullback-01",
          name: "1min breakout pullback option buy: Selling into strength scalp",
          enabled: true,
          description: "Breakout and retracement strategy with 15,15 pivot detection",
          timeframe: "1min",
          instruments: ["NIFTY"],
          riskPerTrade: 1.0,
          maxPositions: 1,
          config: {
            pivotLookback: 15,
            retracement: {
              enabled: true,
              percentage: 0.2
            }
          }
        },
        {
          id: "bollinger-band-01", 
          name: "5m option Buy: bollinger band entry and trail",
          enabled: false,
          description: "Bollinger Band breakout with trailing stop",
          timeframe: "5min",
          instruments: ["NIFTY", "BANKNIFTY"],
          riskPerTrade: 0.8,
          maxPositions: 2,
          config: {
            period: 20,
            stdDev: 2.0,
            trailType: "percentage",
            trailValue: 1.5
          }
        }
      ]
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
      await this.performHealthCheck();
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
        
        // Check if strategy is responsive
        const timeSinceUpdate = Date.now() - metrics.lastUpdateTime.getTime();
        
        if (timeSinceUpdate > 60000 && instance.isRunning()) { // 1 minute threshold
          this.logger.warn(`⚠️ Strategy ${instance.getName()} may be unresponsive (${timeSinceUpdate}ms since last update)`);
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
}