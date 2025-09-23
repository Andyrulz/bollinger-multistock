import { NiftyFuturesStrategy, NiftyFuturesData, TickData } from './NiftyFuturesStrategy';
import { Logger } from '../utils/Logger';

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PivotPoint {
  timestamp: Date;
  price: number;
  type: 'high' | 'low';
  candleIndex: number;
  confirmed: boolean;
}

export interface StrategyState {
  isActive: boolean;
  currentContract?: NiftyFuturesData;
  latestPivotHigh?: PivotPoint;
  latestPivotLow?: PivotPoint;
  candleData: Candle[];
  lastUpdateTime: Date;
  marketHours: {
    start: string; // "09:15"
    end: string;   // "15:30"
  };
  livePrice?: TickData;
  priceStreamingActive: boolean;
}

export class NiftyBreakoutRetracementStrategy {
  private kiteConnect: any;
  private logger: Logger;
  private niftyStrategy: NiftyFuturesStrategy;
  private strategyState: StrategyState;
  private updateTimer?: NodeJS.Timeout | undefined;
  private readonly LOOKBACK_PERIOD = 15;
  private readonly CANDLE_INTERVAL = 5; // 5 minutes
  private readonly HISTORICAL_DAYS = 7; // 7 calendar days for safety

  constructor(kiteConnect: any, logger: Logger, niftyStrategy: NiftyFuturesStrategy) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.niftyStrategy = niftyStrategy;
    
    this.strategyState = {
      isActive: false,
      candleData: [],
      lastUpdateTime: new Date(),
      marketHours: {
        start: "09:15",
        end: "15:30"
      },
      priceStreamingActive: false
    };
  }

  /**
   * Start the breakout retracement strategy
   */
  public async startStrategy(): Promise<void> {
    try {
      this.logger.info('Starting Nifty Breakout Retracement Strategy');

      // Ensure we have the current month contract
      const contract = await this.niftyStrategy.findCurrentMonthNiftyFutures();
      if (!contract) {
        throw new Error('Unable to find current month Nifty futures contract');
      }

      this.strategyState.currentContract = contract;
      this.logger.info(`Using contract: ${contract.tradingsymbol} (Token: ${contract.instrument_token})`);

      // Load historical data
      await this.loadHistoricalData();

      // Calculate initial pivots
      this.calculatePivots();

      // Start live price streaming
      await this.startPriceStreaming();

      // Start the strategy
      this.strategyState.isActive = true;
      
      // Schedule market hour updates
      this.scheduleMarketHourUpdates();

      this.logger.info('Nifty Breakout Retracement Strategy started successfully');
      this.logCurrentPivots();

    } catch (error) {
      this.logger.error('Failed to start breakout retracement strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  public async stopStrategy(): Promise<void> {
    try {
      this.strategyState.isActive = false;
      
      // Stop price streaming
      await this.stopPriceStreaming();
      
      if (this.updateTimer) {
        clearTimeout(this.updateTimer);
        this.updateTimer = undefined;
      }

      this.logger.info('Nifty Breakout Retracement Strategy stopped');
    } catch (error) {
      this.logger.error('Error stopping strategy:', error);
    }
  }

  /**
   * Start live price streaming
   */
  private async startPriceStreaming(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available for price streaming');
      }

      this.logger.info('Starting live price streaming for breakout strategy');
      
      // Set up price update callback
      this.niftyStrategy.onPriceUpdate((tick: TickData) => {
        this.strategyState.livePrice = tick;
        this.strategyState.lastUpdateTime = new Date();
        
        // Log price updates (reduce frequency for production)
        if (Math.random() < 0.1) { // Log only 10% of updates to avoid spam
          this.logger.debug(`Live Price: ₹${tick.last_price.toFixed(2)} | Volume: ${tick.volume}`);
        }
      });

      // Start the nifty strategy streaming
      await this.niftyStrategy.startPriceStreaming();
      
      this.strategyState.priceStreamingActive = true;
      this.logger.info('Live price streaming started successfully');

    } catch (error) {
      this.logger.error('Failed to start price streaming:', error);
      throw error;
    }
  }

  /**
   * Stop live price streaming
   */
  private async stopPriceStreaming(): Promise<void> {
    try {
      if (this.strategyState.priceStreamingActive) {
        this.logger.info('Stopping live price streaming');
        await this.niftyStrategy.stopPriceStreaming();
        this.strategyState.priceStreamingActive = false;
        delete this.strategyState.livePrice;
        this.logger.info('Live price streaming stopped');
      }
    } catch (error) {
      this.logger.error('Error stopping price streaming:', error);
    }
  }

  /**
   * Load historical 5-minute candle data for the last 7 days
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available');
      }

      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - this.HISTORICAL_DAYS);

      this.logger.info(`Loading historical data from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

      // Format dates for Zerodha API (YYYY-MM-DD)
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];

      const historicalData = await this.kiteConnect.getHistoricalData(
        this.strategyState.currentContract.instrument_token,
        "5minute",
        fromDateStr,
        toDateStr
      );

      if (!historicalData || historicalData.length === 0) {
        throw new Error('No historical data received');
      }

      // Convert to our Candle format
      this.strategyState.candleData = historicalData.map((candle: any) => ({
        timestamp: new Date(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      }));

      // Sort by timestamp to ensure proper order
      this.strategyState.candleData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      this.logger.info(`Loaded ${this.strategyState.candleData.length} historical 5-minute candles`);
      
      // Log the date range of loaded data
      if (this.strategyState.candleData.length > 0) {
        const firstCandle = this.strategyState.candleData[0];
        const lastCandle = this.strategyState.candleData[this.strategyState.candleData.length - 1];
        if (firstCandle && lastCandle) {
          this.logger.info(`Data range: ${firstCandle.timestamp.toISOString()} to ${lastCandle.timestamp.toISOString()}`);
        }
      }

    } catch (error) {
      this.logger.error('Failed to load historical data:', error);
      throw error;
    }
  }

  /**
   * Calculate pivot highs and lows using 15,15 lookback
   */
  private calculatePivots(): void {
    try {
      const candles = this.strategyState.candleData;
      const requiredCandles = (this.LOOKBACK_PERIOD * 2) + 1; // 31 candles minimum

      if (candles.length < requiredCandles) {
        this.logger.warn(`Insufficient candles for pivot calculation. Need ${requiredCandles}, have ${candles.length}`);
        return;
      }

      let latestPivotHigh: PivotPoint | undefined;
      let latestPivotLow: PivotPoint | undefined;

      // Start from the lookback period and go until we have enough future candles
      for (let i = this.LOOKBACK_PERIOD; i < candles.length - this.LOOKBACK_PERIOD; i++) {
        const currentCandle = candles[i];
        if (!currentCandle) continue;
        
        // Check for pivot high
        const isPivotHigh = this.isPivotHigh(i, candles);
        if (isPivotHigh) {
          latestPivotHigh = {
            timestamp: currentCandle.timestamp,
            price: currentCandle.high,
            type: 'high',
            candleIndex: i,
            confirmed: true
          };
        }

        // Check for pivot low
        const isPivotLow = this.isPivotLow(i, candles);
        if (isPivotLow) {
          latestPivotLow = {
            timestamp: currentCandle.timestamp,
            price: currentCandle.low,
            type: 'low',
            candleIndex: i,
            confirmed: true
          };
        }
      }

      // Update strategy state
      if (latestPivotHigh) {
        this.strategyState.latestPivotHigh = latestPivotHigh;
      }
      if (latestPivotLow) {
        this.strategyState.latestPivotLow = latestPivotLow;
      }
      this.strategyState.lastUpdateTime = new Date();

      this.logger.info('Pivot calculation completed');

    } catch (error) {
      this.logger.error('Error calculating pivots:', error);
    }
  }

  /**
   * Check if the candle at index i is a pivot high
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
   * Check if the candle at index i is a pivot low
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
   * Update strategy with latest market data
   */
  private async updateStrategy(): Promise<void> {
    try {
      if (!this.strategyState.isActive || !this.strategyState.currentContract) {
        return;
      }

      // Fetch latest 5-minute candle
      const latestCandle = await this.fetchLatestCandle();
      if (!latestCandle) {
        this.logger.warn('No latest candle data available');
        return;
      }

      // Add to candle data
      this.addNewCandle(latestCandle);

      // Recalculate pivots
      this.calculatePivots();

      this.logger.debug('Strategy updated with latest market data');
      this.logCurrentPivots();

    } catch (error) {
      this.logger.error('Error updating strategy:', error);
    }
  }

  /**
   * Fetch the latest 5-minute candle
   */
  private async fetchLatestCandle(): Promise<Candle | null> {
    try {
      if (!this.strategyState.currentContract) return null;

      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setHours(fromDate.getHours() - 1); // Get last hour of data

      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];

      const recentData = await this.kiteConnect.getHistoricalData(
        this.strategyState.currentContract.instrument_token,
        "5minute",
        fromDateStr,
        toDateStr
      );

      if (!recentData || recentData.length === 0) {
        return null;
      }

      // Get the latest candle
      const latestData = recentData[recentData.length - 1];
      
      return {
        timestamp: new Date(latestData.date),
        open: latestData.open,
        high: latestData.high,
        low: latestData.low,
        close: latestData.close,
        volume: latestData.volume || 0
      };

    } catch (error) {
      this.logger.error('Error fetching latest candle:', error);
      return null;
    }
  }

  /**
   * Add new candle to the data array
   */
  private addNewCandle(newCandle: Candle): void {
    const candles = this.strategyState.candleData;
    
    // Check if this candle already exists (avoid duplicates)
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && Math.abs(lastCandle.timestamp.getTime() - newCandle.timestamp.getTime()) < 60000) {
      // Update the last candle if it's within 1 minute (same 5-min period)
      candles[candles.length - 1] = newCandle;
    } else {
      // Add new candle
      candles.push(newCandle);
    }

    // Keep only relevant data (last 1000 candles should be enough)
    if (candles.length > 1000) {
      this.strategyState.candleData = candles.slice(-1000);
    }
  }

  /**
   * Schedule updates during market hours
   */
  private scheduleMarketHourUpdates(): void {
    const scheduleNextUpdate = () => {
      if (!this.strategyState.isActive) return;

      const now = new Date();
      const currentTime = now.getHours() * 100 + now.getMinutes();
      const marketStart = 915; // 09:15
      const marketEnd = 1530;  // 15:30

      if (currentTime >= marketStart && currentTime <= marketEnd) {
        // During market hours - update every 5 minutes
        this.updateTimer = setTimeout(async () => {
          await this.updateStrategy();
          scheduleNextUpdate();
        }, 5 * 60 * 1000); // 5 minutes
        
        // Ensure price streaming is active during market hours
        if (!this.strategyState.priceStreamingActive && this.strategyState.currentContract) {
          this.startPriceStreaming().catch(error => {
            this.logger.error('Failed to start price streaming during market hours:', error);
          });
        }
      } else if (currentTime > marketEnd) {
        // After market hours - stop price streaming and check next day
        if (this.strategyState.priceStreamingActive) {
          this.stopPriceStreaming().catch(error => {
            this.logger.error('Failed to stop price streaming after market hours:', error);
          });
        }
        
        // Schedule for next market open (next day at 9:15 AM)
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 15, 0, 0);
        const msUntilMarketOpen = tomorrow.getTime() - now.getTime();
        
        this.updateTimer = setTimeout(() => {
          scheduleNextUpdate();
        }, Math.min(msUntilMarketOpen, 30 * 60 * 1000)); // Check every 30 minutes or until market open
      } else {
        // Before market hours - wait until market opens
        const today = new Date(now);
        today.setHours(9, 15, 0, 0);
        const msUntilMarketOpen = today.getTime() - now.getTime();
        
        if (msUntilMarketOpen > 0) {
          this.updateTimer = setTimeout(() => {
            scheduleNextUpdate();
          }, Math.min(msUntilMarketOpen, 30 * 60 * 1000)); // Check every 30 minutes or until market open
        } else {
          // Should not happen, but handle edge case
          this.updateTimer = setTimeout(() => {
            scheduleNextUpdate();
          }, 5 * 60 * 1000); // 5 minutes
        }
      }
    };

    scheduleNextUpdate();
  }

  /**
   * Log current pivot points
   */
  private logCurrentPivots(): void {
    const { latestPivotHigh, latestPivotLow } = this.strategyState;

    this.logger.info('=== CURRENT PIVOT POINTS ===');
    
    if (latestPivotHigh) {
      this.logger.info(`📈 Latest Pivot HIGH: ₹${latestPivotHigh.price.toFixed(2)} at ${latestPivotHigh.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📈 No pivot high found yet');
    }

    if (latestPivotLow) {
      this.logger.info(`📉 Latest Pivot LOW: ₹${latestPivotLow.price.toFixed(2)} at ${latestPivotLow.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📉 No pivot low found yet');
    }

    this.logger.info('============================');
  }

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
   * Check if strategy is active
   */
  public isStrategyActive(): boolean {
    return this.strategyState.isActive;
  }

  /**
   * Get total candles loaded
   */
  public getCandleCount(): number {
    return this.strategyState.candleData.length;
  }

  /**
   * Get market hours info
   */
  public isMarketHours(): boolean {
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes();
    const marketStart = 915; // 09:15
    const marketEnd = 1530;  // 15:30
    
    return currentTime >= marketStart && currentTime <= marketEnd;
  }

  /**
   * Get live price data
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
   * Manual start of price streaming (for testing or manual control)
   */
  public async startManualPriceStreaming(): Promise<void> {
    // Ensure we have the current contract before starting streaming
    if (!this.strategyState.currentContract) {
      this.logger.info('No contract found, fetching current month Nifty futures...');
      const contract = await this.niftyStrategy.findCurrentMonthNiftyFutures();
      if (!contract) {
        throw new Error('Unable to find current month Nifty futures contract');
      }
      this.strategyState.currentContract = contract;
      this.logger.info(`Contract set: ${contract.tradingsymbol} (Token: ${contract.instrument_token})`);
    }
    
    await this.startPriceStreaming();
  }

  /**
   * Manual stop of price streaming (for testing or manual control)
   */
  public async stopManualPriceStreaming(): Promise<void> {
    await this.stopPriceStreaming();
  }
}