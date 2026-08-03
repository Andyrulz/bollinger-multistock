import { Logger } from '../utils/Logger';

export interface StrategyConfig {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  timeframe: string;
  instruments: string[];
  riskPerTrade: number;
  maxPositions: number;
  [key: string]: any; // Allow strategy-specific config
}

export interface StrategyMetrics {
  isActive: boolean;
  isStreaming: boolean;
  totalTrades: number;
  profitLoss: number;
  winRate: number;
  lastTradeTime?: Date;
  lastUpdateTime: Date;
  errorCount: number;
  healthStatus: 'healthy' | 'warning' | 'error' | 'stopped';
}

export interface StrategyStatus {
  config: StrategyConfig;
  metrics: StrategyMetrics;
  currentPosition?: any;
  recentTrades: any[];
  allTrades?: any[]; // All trades for history page
  tradeStats?: any; // Pre-calculated comprehensive statistics
}

/**
 * Base class that all trading strategies must extend
 * Provides common interface and shared functionality
 */
export abstract class StrategyBase {
  protected logger: Logger;
  protected kiteConnect: any;
  protected config: StrategyConfig;
  protected metrics: StrategyMetrics;
  protected _isInitialized: boolean = false;

  constructor(kiteConnect: any, logger: Logger, config: StrategyConfig) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.config = config;
    this.metrics = {
      isActive: false,
      isStreaming: false,
      totalTrades: 0,
      profitLoss: 0,
      winRate: 0,
      lastUpdateTime: new Date(),
      errorCount: 0,
      healthStatus: 'stopped'
    };
  }

  // Abstract methods that each strategy must implement
  abstract initialize(): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract getStatus(): StrategyStatus;
  abstract processMarketData(data: any): Promise<void>;

  // Common methods available to all strategies
  public getConfig(): StrategyConfig {
    return { ...this.config };
  }

  public getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  public getId(): string {
    return this.config.id;
  }

  public getName(): string {
    return this.config.name;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public isRunning(): boolean {
    return this.metrics.isActive;
  }

  public get isInitialized(): boolean {
    return this._isInitialized;
  }

  protected updateMetrics(updates: Partial<StrategyMetrics>): void {
    this.metrics = {
      ...this.metrics,
      ...updates,
      lastUpdateTime: new Date()
    };
  }

  protected logStrategyEvent(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const logMessage = `[${this.config.name}] ${message}`;
    
    switch (level) {
      case 'info':
        this.logger.info(logMessage, data);
        break;
      case 'warn':
        this.logger.warn(logMessage, data);
        break;
      case 'error':
        this.logger.error(logMessage, data);
        this.metrics.errorCount++;
        break;
    }
  }

  protected setHealthStatus(status: 'healthy' | 'warning' | 'error' | 'stopped'): void {
    this.metrics.healthStatus = status;
    this.metrics.lastUpdateTime = new Date();
  }
}