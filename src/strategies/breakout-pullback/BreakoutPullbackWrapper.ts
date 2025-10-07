import { StrategyBase, StrategyConfig, StrategyStatus } from '../../core/StrategyBase';
import { Logger } from '../../utils/Logger';
import { BreakoutPullbackStrategy } from './BreakoutPullbackStrategy';

/**
 * Wrapper class that adapts the existing BreakoutPullbackStrategy to work with the new StrategyBase interface
 * This preserves the original strategy logic while making it compatible with the multi-strategy architecture
 */
export class BreakoutPullbackWrapper extends StrategyBase {
  private coreStrategy: BreakoutPullbackStrategy;

  constructor(kiteConnect: any, logger: Logger, config: StrategyConfig) {
    super(kiteConnect, logger, config);
    
    // Initialize the core strategy with the original interface
    this.coreStrategy = new BreakoutPullbackStrategy(kiteConnect, logger);
  }

  async initialize(): Promise<void> {
    try {
      this.logStrategyEvent('info', 'Initializing Breakout Pullback Strategy');
      
      // The original strategy doesn't have an explicit initialize method
      // But we can set up any required initialization here
      this.setHealthStatus('healthy');
      this.isInitialized = true;
      
      this.logStrategyEvent('info', 'Strategy initialized successfully');
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to initialize strategy', error);
      this.setHealthStatus('error');
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      this.logStrategyEvent('info', 'Starting strategy');
      
      // Call the original strategy's start method
      await this.coreStrategy.startStrategy();
      
      this.updateMetrics({
        isActive: true,
        isStreaming: true,
        healthStatus: 'healthy'
      });

      this.logStrategyEvent('info', 'Strategy started successfully');
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to start strategy', error);
      this.setHealthStatus('error');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.logStrategyEvent('info', 'Stopping strategy');
      
      // Call the original strategy's stop method
      await this.coreStrategy.stopStrategy();
      
      this.updateMetrics({
        isActive: false,
        isStreaming: false,
        healthStatus: 'stopped'
      });

      this.logStrategyEvent('info', 'Strategy stopped successfully');
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to stop strategy', error);
      this.setHealthStatus('error');
      throw error;
    }
  }

  getStatus(): StrategyStatus {
    const coreStatus = this.coreStrategy.getStrategyState();
    const tradeHistory = this.coreStrategy.getTradeExecutionService().getTradeHistory();
    const activePosition = this.coreStrategy.getTradeExecutionService().getActivePosition();
    
    // Map the original strategy state to the new interface
    return {
      config: this.getConfig(),
      metrics: {
        ...this.getMetrics(),
        isActive: coreStatus.isActive,
        isStreaming: coreStatus.priceStreamingActive,
        totalTrades: tradeHistory.length,
        profitLoss: this.calculateTotalPnL(tradeHistory),
        winRate: this.calculateWinRate(tradeHistory)
      },
      currentPosition: activePosition,
      recentTrades: tradeHistory.slice(-10) // Last 10 trades
    };
  }

  async processMarketData(data: any): Promise<void> {
    try {
      // The original strategy processes market data through its own polling mechanism
      // This method can be used for external data feeding if needed
      this.updateMetrics({ lastUpdateTime: new Date() });
    } catch (error) {
      this.logStrategyEvent('error', 'Error processing market data', error);
      this.metrics.errorCount++;
    }
  }

  private calculateTotalPnL(trades: any[]): number {
    return trades.reduce((total, trade) => {
      return total + (trade.realizedPnl || 0);
    }, 0);
  }

  private calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    
    const winningTrades = trades.filter(trade => (trade.realizedPnl || 0) > 0);
    return (winningTrades.length / trades.length) * 100;
  }

  // Expose the core strategy for direct access if needed
  public getCoreStrategy(): BreakoutPullbackStrategy {
    return this.coreStrategy;
  }
}