import { StrategyBase, StrategyConfig } from './StrategyBase';
import { Logger } from '../utils/Logger';

export interface StrategyConstructor {
  new (kiteConnect: any, logger: Logger, config: StrategyConfig): StrategyBase;
}

/**
 * Registry for managing strategy classes and their instantiation
 * Supports dynamic loading and registration of strategy classes
 */
export class StrategyRegistry {
  private static strategies: Map<string, StrategyConstructor> = new Map();
  private static instances: Map<string, StrategyBase> = new Map();
  private static logger: Logger;

  public static initialize(logger: Logger): void {
    this.logger = logger;
    this.logger.info('🏭 Strategy Registry initialized');
  }

  /**
   * Register a strategy class with the registry
   */
  public static registerStrategy(id: string, strategyClass: StrategyConstructor): void {
    this.strategies.set(id, strategyClass);
    this.logger.info(`📝 Registered strategy: ${id}`);
  }

  /**
   * Create and register an instance of a strategy
   */
  public static async createInstance(
    id: string, 
    kiteConnect: any, 
    logger: Logger, 
    config: StrategyConfig
  ): Promise<StrategyBase> {
    const StrategyClass = this.strategies.get(id);
    
    if (!StrategyClass) {
      throw new Error(`Strategy class not found for ID: ${id}`);
    }

    if (this.instances.has(config.id)) {
      throw new Error(`Strategy instance already exists for ID: ${config.id}`);
    }

    try {
      const instance = new StrategyClass(kiteConnect, logger, config);
      await instance.initialize();
      
      this.instances.set(config.id, instance);
      this.logger.info(`✅ Created strategy instance: ${config.name} (${config.id})`);
      
      return instance;
    } catch (error) {
      this.logger.error(`❌ Failed to create strategy instance ${config.id}:`, error);
      throw error;
    }
  }

  /**
   * Get a strategy instance by ID
   */
  public static getInstance(id: string): StrategyBase | undefined {
    return this.instances.get(id);
  }

  /**
   * Get all strategy instances
   */
  public static getAllInstances(): Map<string, StrategyBase> {
    return new Map(this.instances);
  }

  /**
   * Remove a strategy instance
   */
  public static async removeInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    
    if (!instance) {
      return false;
    }

    try {
      if (instance.isRunning()) {
        await instance.stop();
      }
      
      this.instances.delete(id);
      this.logger.info(`🗑️ Removed strategy instance: ${id}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to remove strategy instance ${id}:`, error);
      return false;
    }
  }

  /**
   * Get list of registered strategy classes
   */
  public static getRegisteredStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get list of active strategy instances
   */
  public static getActiveInstances(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Check if a strategy class is registered
   */
  public static isRegistered(id: string): boolean {
    return this.strategies.has(id);
  }

  /**
   * Check if a strategy instance exists
   */
  public static hasInstance(id: string): boolean {
    return this.instances.has(id);
  }
}