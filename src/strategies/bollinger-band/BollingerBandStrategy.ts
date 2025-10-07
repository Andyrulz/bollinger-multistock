import { StrategyBase, StrategyConfig, StrategyStatus } from '../../core/StrategyBase';
import { Logger } from '../../utils/Logger';
import { BollingerBandExecutor } from './BollingerBandExecutor';

/**
 * Bollinger Band Strategy
 * Strategy: 5m option Buy: bollinger band entry and trail
 * 
 * This strategy uses Bollinger Bands to identify entry points and employs trailing stops
 * for position management. It operates on 5-minute timeframe data.
 */
export class BollingerBandStrategy extends StrategyBase {
  private executor: BollingerBandExecutor;
  private isStreaming: boolean = false;
  private streamingInterval?: NodeJS.Timeout | undefined;
  private currentCandles: any[] = [];
  private bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  } | null = null;

  constructor(kiteConnect: any, logger: Logger, config: StrategyConfig) {
    super(kiteConnect, logger, config);
    
    this.executor = new BollingerBandExecutor(kiteConnect, logger);
  }

  /**
   * Initialize the strategy
   */
  public async initialize(): Promise<void> {
    try {
      this.logStrategyEvent('info', 'Initializing Bollinger Band Strategy...');
      
      // Initialize the executor
      await this.executor.initialize();
      
      this.isInitialized = true;
      this.setHealthStatus('healthy');
      
      this.logStrategyEvent('info', 'Strategy initialized successfully');
      
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to initialize strategy', error);
      this.setHealthStatus('error');
      throw error;
    }
  }

  /**
   * Start the strategy
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Strategy must be initialized before starting');
    }

    if (this.metrics.isActive) {
      this.logStrategyEvent('warn', 'Strategy already running');
      return;
    }

    try {
      this.logStrategyEvent('info', 'Starting Bollinger Band Strategy...');
      
      // Start data streaming for 5-minute candles
      await this.startDataStreaming();
      
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

  /**
   * Stop the strategy
   */
  public async stop(): Promise<void> {
    if (!this.metrics.isActive) {
      this.logStrategyEvent('warn', 'Strategy not running');
      return;
    }

    try {
      this.logStrategyEvent('info', 'Stopping Bollinger Band Strategy...');
      
      // Stop data streaming
      await this.stopDataStreaming();
      
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

  /**
   * Get current strategy status
   */
  public getStatus(): StrategyStatus {
    const recentTrades = this.executor.getRecentTrades();
    const currentPosition = this.executor.getCurrentPosition();

    return {
      config: this.getConfig(),
      metrics: this.getMetrics(),
      currentPosition,
      recentTrades
    };
  }

  /**
   * Process market data
   */
  public async processMarketData(data: any): Promise<void> {
    try {
      // Add new candle data
      this.currentCandles.push(data);
      
      // Keep only the last 50 candles (for Bollinger Band calculation)
      if (this.currentCandles.length > 50) {
        this.currentCandles.shift();
      }
      
      // Calculate Bollinger Bands
      this.calculateBollingerBands();
      
      // Check for trading signals
      await this.checkTradingSignals(data);
      
      this.updateMetrics({ lastUpdateTime: new Date() });
      
    } catch (error) {
      this.logStrategyEvent('error', 'Error processing market data', error);
      this.setHealthStatus('warning');
    }
  }

  /**
   * Start data streaming for 5-minute candles
   */
  private async startDataStreaming(): Promise<void> {
    if (this.isStreaming) {
      return;
    }

    this.logStrategyEvent('info', 'Starting 5-minute data streaming...');
    
    // Simulate 5-minute data streaming (in real implementation, this would fetch actual data)
    this.streamingInterval = setInterval(async () => {
      try {
        await this.fetchAndProcess5MinData();
      } catch (error) {
        this.logStrategyEvent('error', 'Error in data streaming', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    this.isStreaming = true;
    this.logStrategyEvent('info', '5-minute data streaming started');
  }

  /**
   * Stop data streaming
   */
  private async stopDataStreaming(): Promise<void> {
    if (!this.isStreaming) {
      return;
    }

    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = undefined;
    }

    this.isStreaming = false;
    this.logStrategyEvent('info', '5-minute data streaming stopped');
  }

  /**
   * Fetch and process 5-minute data
   */
  private async fetchAndProcess5MinData(): Promise<void> {
    try {
      // In a real implementation, this would fetch actual 5-minute OHLC data
      // For now, we'll create mock data
      const mockCandle = {
        timestamp: new Date(),
        open: 25000 + Math.random() * 100 - 50,
        high: 25000 + Math.random() * 100,
        low: 25000 - Math.random() * 100,
        close: 25000 + Math.random() * 100 - 50,
        volume: Math.floor(Math.random() * 10000)
      };

      await this.processMarketData(mockCandle);
      
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to fetch 5-minute data', error);
    }
  }

  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(): void {
    if (this.currentCandles.length < 20) {
      return; // Need at least 20 periods for calculation
    }

    const period = this.config.config?.period || 20;
    const stdDev = this.config.config?.stdDev || 2.0;
    
    // Get the last 'period' candles
    const recentCandles = this.currentCandles.slice(-period);
    
    // Calculate Simple Moving Average (SMA)
    const closes = recentCandles.map(candle => candle.close);
    const sma = closes.reduce((sum, close) => sum + close, 0) / period;
    
    // Calculate Standard Deviation
    const variance = closes.reduce((sum, close) => sum + Math.pow(close - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate Bollinger Bands
    this.bollingerBands = {
      upper: sma + (stdDev * standardDeviation),
      middle: sma,
      lower: sma - (stdDev * standardDeviation)
    };

    this.logStrategyEvent('info', 
      `Bollinger Bands: Upper=${this.bollingerBands.upper.toFixed(2)}, ` +
      `Middle=${this.bollingerBands.middle.toFixed(2)}, ` +
      `Lower=${this.bollingerBands.lower.toFixed(2)}`
    );
  }

  /**
   * Check for trading signals
   */
  private async checkTradingSignals(currentCandle: any): Promise<void> {
    if (!this.bollingerBands) {
      return;
    }

    const currentPrice = currentCandle.close;
    
    // Long signal: Price closes below lower band (oversold)
    if (currentPrice <= this.bollingerBands.lower) {
      this.logStrategyEvent('info', `Long signal detected: Price ${currentPrice} <= Lower Band ${this.bollingerBands.lower.toFixed(2)}`);
      await this.generateTradingSignal('LONG', currentPrice);
    }
    
    // Short signal: Price closes above upper band (overbought)
    else if (currentPrice >= this.bollingerBands.upper) {
      this.logStrategyEvent('info', `Short signal detected: Price ${currentPrice} >= Upper Band ${this.bollingerBands.upper.toFixed(2)}`);
      await this.generateTradingSignal('SHORT', currentPrice);
    }
  }

  /**
   * Generate trading signal
   */
  private async generateTradingSignal(direction: 'LONG' | 'SHORT', price: number): Promise<void> {
    try {
      this.logStrategyEvent('info', `Generating ${direction} signal at price ${price}`);
      
      // Check if we already have a position
      const currentPosition = this.executor.getCurrentPosition();
      if (currentPosition) {
        this.logStrategyEvent('warn', 'Position already exists, skipping signal');
        return;
      }
      
      // Execute the trade through the executor
      await this.executor.executeTrade(direction, price);
      
      this.updateMetrics({
        totalTrades: this.metrics.totalTrades + 1
      });
      
    } catch (error) {
      this.logStrategyEvent('error', 'Failed to generate trading signal', error);
    }
  }

  /**
   * Get current Bollinger Bands
   */
  public getBollingerBands() {
    return this.bollingerBands;
  }

  /**
   * Get executor instance
   */
  public getExecutor(): BollingerBandExecutor {
    return this.executor;
  }

  /**
   * Get current candles
   */
  public getCurrentCandles() {
    return [...this.currentCandles];
  }
}