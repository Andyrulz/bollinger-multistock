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

export interface BreakoutSignal {
  timestamp: Date;
  type: 'bullish_breakout' | 'bearish_breakdown';
  price: number;
  volume: number;
  volumeMA: number;
  pivotPrice: number;
  candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
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
  // Breakout detection data
  oneMinuteCandleData: Candle[];
  latestBreakoutSignal?: BreakoutSignal;
  breakoutDetectionActive: boolean;
  currentVolumeSMA50?: number; // Cached 50-period volume SMA for 1-min candles
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
  
  // 1-minute candle tracking
  private currentMinuteCandle: {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null = null;

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
      priceStreamingActive: false,
      oneMinuteCandleData: [],
      breakoutDetectionActive: false
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

      // Start breakout detection
      await this.startBreakoutDetection();

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
      
      // Stop breakout detection
      this.stopBreakoutDetection();
      
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
        
        // Process tick for 1-minute candle generation
        this.processTickForOneMinuteCandle(tick);
        
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
   * Load historical 1-minute candle data for breakout detection (last 50 candles)
   */
  private async loadOneMinuteHistoricalData(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available for loading 1-minute data');
      }

      const toDate = new Date();
      const fromDate = new Date(toDate);
      fromDate.setHours(fromDate.getHours() - 24); // Get last 24 hours to ensure we have 50+ candles

      this.logger.info(`Loading 1-minute historical data from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

      const historicalData = await this.kiteConnect.getHistoricalData(
        this.strategyState.currentContract.instrument_token,
        'minute',
        fromDate,
        toDate
      );

      if (!historicalData || historicalData.length === 0) {
        this.logger.warn('No 1-minute historical data received');
        return;
      }

      this.strategyState.oneMinuteCandleData = historicalData.map((candle: any) => ({
        timestamp: new Date(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      }));

      // Sort by timestamp and keep only the last 50 candles
      this.strategyState.oneMinuteCandleData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      this.strategyState.oneMinuteCandleData = this.strategyState.oneMinuteCandleData.slice(-50);

      this.logger.info(`Loaded ${this.strategyState.oneMinuteCandleData.length} 1-minute candles for breakout detection`);
      
      if (this.strategyState.oneMinuteCandleData.length > 0) {
        const firstCandle = this.strategyState.oneMinuteCandleData[0];
        const lastCandle = this.strategyState.oneMinuteCandleData[this.strategyState.oneMinuteCandleData.length - 1];
        if (firstCandle && lastCandle) {
          this.logger.info(`1-minute data range: ${firstCandle.timestamp.toISOString()} to ${lastCandle.timestamp.toISOString()}`);
        }
      }

    } catch (error) {
      this.logger.error('Error loading 1-minute historical data:', error);
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
   * Check if breakout detection is active
   */
  public isBreakoutDetectionActive(): boolean {
    return this.strategyState.breakoutDetectionActive;
  }

  /**
   * Get latest breakout signal
   */
  public getLatestBreakoutSignal(): BreakoutSignal | undefined {
    return this.strategyState.latestBreakoutSignal;
  }

  /**
   * Get 1-minute candle count
   */
  public getOneMinuteCandleCount(): number {
    return this.strategyState.oneMinuteCandleData.length;
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
   * Calculate 50-period volume moving average from 1-minute data
   */
  private calculateVolumeMA(): number {
    if (this.strategyState.oneMinuteCandleData.length < 50) {
      this.logger.warn('Not enough 1-minute data for volume MA calculation');
      return 0;
    }

    const volumes = this.strategyState.oneMinuteCandleData.slice(-50).map(candle => candle.volume);
    const sum = volumes.reduce((acc, vol) => acc + vol, 0);
    return sum / volumes.length;
  }

  /**
   * Add new 1-minute candle and check for breakout
   */
  private async addOneMinuteCandle(candle: Candle): Promise<void> {
    // Add new candle to 1-minute data
    this.strategyState.oneMinuteCandleData.push(candle);
    
    // Keep only last 50 candles
    if (this.strategyState.oneMinuteCandleData.length > 50) {
      this.strategyState.oneMinuteCandleData = this.strategyState.oneMinuteCandleData.slice(-50);
    }

    // Update cached 50-period volume SMA (only meaningful when we have 50 candles)
    if (this.strategyState.oneMinuteCandleData.length >= 50) {
      this.strategyState.currentVolumeSMA50 = this.calculateVolumeMA();
    } else {
      // Remove the property so UI can detect absence cleanly under exactOptionalPropertyTypes
      delete this.strategyState.currentVolumeSMA50;
    }

    // Check for breakout if we have enough data and pivots
    if (this.strategyState.oneMinuteCandleData.length >= 50 && 
        this.strategyState.breakoutDetectionActive &&
        (this.strategyState.latestPivotHigh || this.strategyState.latestPivotLow)) {
      await this.checkForBreakout(candle);
    }
  }

  /**
   * Check for bullish breakout or bearish breakdown
   */
  private async checkForBreakout(candle: Candle): Promise<void> {
    try {
      const volumeMA = this.calculateVolumeMA();
      
      // Check if volume is higher than average
      if (candle.volume <= volumeMA) {
        return; // No high volume, skip
      }

      let signal: BreakoutSignal | null = null;

      // Check for bullish breakout
      if (this.strategyState.latestPivotHigh && 
          candle.open < this.strategyState.latestPivotHigh.price && 
          candle.close > this.strategyState.latestPivotHigh.price) {
        
        signal = {
          timestamp: candle.timestamp,
          type: 'bullish_breakout',
          price: candle.close,
          volume: candle.volume,
          volumeMA: volumeMA,
          pivotPrice: this.strategyState.latestPivotHigh.price,
          candle: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume
          }
        };

        this.logger.info(`🟢 BULLISH BREAKOUT DETECTED! Price: ₹${candle.close}, Pivot: ₹${this.strategyState.latestPivotHigh.price}, Volume: ${candle.volume} (MA: ${volumeMA.toFixed(0)})`);
      }
      
      // Check for bearish breakdown
      else if (this.strategyState.latestPivotLow && 
               candle.open > this.strategyState.latestPivotLow.price && 
               candle.close < this.strategyState.latestPivotLow.price) {
        
        signal = {
          timestamp: candle.timestamp,
          type: 'bearish_breakdown',
          price: candle.close,
          volume: candle.volume,
          volumeMA: volumeMA,
          pivotPrice: this.strategyState.latestPivotLow.price,
          candle: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume
          }
        };

        this.logger.info(`🔴 BEARISH BREAKDOWN DETECTED! Price: ₹${candle.close}, Pivot: ₹${this.strategyState.latestPivotLow.price}, Volume: ${candle.volume} (MA: ${volumeMA.toFixed(0)})`);
      }

      // Store the latest signal if detected
      if (signal) {
        this.strategyState.latestBreakoutSignal = signal;
        this.strategyState.lastUpdateTime = new Date();
      }

    } catch (error) {
      this.logger.error('Error checking for breakout:', error);
    }
  }

  /**
   * Get the current cached 50-period volume SMA (1-min candles)
   */
  public getCurrentVolumeSMA50(): number | undefined {
    return this.strategyState.currentVolumeSMA50;
  }

  /**
   * Get the latest 1-minute candle (if any)
   */
  public getLatestOneMinuteCandle(): Candle | undefined {
    if (!this.strategyState.oneMinuteCandleData.length) return undefined;
    return this.strategyState.oneMinuteCandleData[this.strategyState.oneMinuteCandleData.length - 1];
  }

  /**
   * Start breakout detection
   */
  public async startBreakoutDetection(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available for breakout detection');
      }

      // Load 1-minute historical data
      await this.loadOneMinuteHistoricalData();
      
      // Activate breakout detection
      this.strategyState.breakoutDetectionActive = true;
      
      this.logger.info('Breakout detection started successfully');
    } catch (error) {
      this.logger.error('Error starting breakout detection:', error);
      throw error;
    }
  }

  /**
   * Process incoming ticks to generate 1-minute candles
   */
  private processTickForOneMinuteCandle(tick: TickData): void {
    try {
      const now = new Date();
      const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

      // Check if we need to start a new minute candle
      if (!this.currentMinuteCandle || this.currentMinuteCandle.timestamp.getTime() !== currentMinute.getTime()) {
        
        // Save the previous minute candle if it exists
        if (this.currentMinuteCandle) {
          const completedCandle: Candle = {
            timestamp: this.currentMinuteCandle.timestamp,
            open: this.currentMinuteCandle.open,
            high: this.currentMinuteCandle.high,
            low: this.currentMinuteCandle.low,
            close: this.currentMinuteCandle.close,
            volume: this.currentMinuteCandle.volume
          };
          
          // Add to 1-minute data and check for breakout
          this.addOneMinuteCandle(completedCandle);
        }

        // Start new minute candle
        this.currentMinuteCandle = {
          timestamp: currentMinute,
          open: tick.last_price,
          high: tick.last_price,
          low: tick.last_price,
          close: tick.last_price,
          volume: tick.volume || 0
        };
      } else {
        // Update current minute candle
        if (this.currentMinuteCandle) {
          this.currentMinuteCandle.high = Math.max(this.currentMinuteCandle.high, tick.last_price);
          this.currentMinuteCandle.low = Math.min(this.currentMinuteCandle.low, tick.last_price);
          this.currentMinuteCandle.close = tick.last_price;
          this.currentMinuteCandle.volume = tick.volume || 0; // Use latest volume (cumulative for the day)
        }
      }

    } catch (error) {
      this.logger.error('Error processing tick for 1-minute candle:', error);
    }
  }

  /**
   * Stop breakout detection
   */
  public stopBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
    this.logger.info('Breakout detection stopped');
  }

  /**
   * Manual stop of price streaming (for testing or manual control)
   */
  public async stopManualPriceStreaming(): Promise<void> {
    await this.stopPriceStreaming();
  }
}