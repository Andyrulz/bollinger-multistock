import { Logger } from '../utils/Logger';

// Manual polling system - no WebSocket dependencies needed
// We'll use REST API to fetch live quotes every second

// Define types locally since we removed the utility class
export interface NiftyFuturesData {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: Date;
  strike: number;
  tick_size: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}

export interface TickData {
  instrument_token: number;
  last_price: number;
  volume: number;
  buy_quantity: number;
  sell_quantity: number;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  change: number;
  last_trade_time: Date;
  exchange_timestamp: Date;
  timestamp?: Date; // For our test ticks
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
}

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PivotPoint {
  price: number;
  timestamp: Date;
  type: 'high' | 'low';
}

export interface BreakoutSignal {
  type: 'resistance_break' | 'support_break' | 'bullish_breakout' | 'bearish_breakdown';
  price: number;
  timestamp: Date;
  volume: number;
  volumeMA: number; // Adding volume moving average
  pivotPrice: number;
  pivotAge: number; // minutes since pivot was formed
}

export interface StrategyState {
  isActive: boolean;
  currentContract?: NiftyFuturesData;
  livePrice?: TickData;
  lastUpdateTime?: Date;
  priceStreamingActive: boolean;
  breakoutDetectionActive: boolean;
  candles: Candle[];
  oneMinuteCandles: Candle[];
  latestPivotHigh?: PivotPoint;
  latestPivotLow?: PivotPoint;
  latestBreakoutSignal?: BreakoutSignal;
  currentVolumeSMA50: number;
}

export class NiftyBreakoutRetracementStrategy {
  private kiteConnect: any;
  private logger: Logger;
  private strategyState: StrategyState;
  
  // Manual polling properties
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private isManualStreamingActive = false;

  private breakoutDetectionInterval: NodeJS.Timeout | null = null;

  // One-minute candle generation
  private currentOneMinuteCandle: {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tickCount: number;
  } | null = null;

  private updateTimer: NodeJS.Timeout | undefined;

  constructor(kiteConnect: any, logger?: Logger) {
    this.kiteConnect = kiteConnect;
    this.logger = logger || new Logger();
    
    this.strategyState = {
      isActive: false,
      priceStreamingActive: false,
      breakoutDetectionActive: false,
      candles: [],
      oneMinuteCandles: [],
      currentVolumeSMA50: 0
    };
  }

  /**
   * Start the strategy
   */
  public async startStrategy(): Promise<void> {
    try {
      this.logger.info('Starting Nifty Breakout Retracement Strategy...');
      
      // Initialize current month Nifty futures contract
      await this.initializeNiftyFuturesContract();
      
      if (!this.strategyState.currentContract) {
        throw new Error('Failed to initialize futures contract');
      }

      // Load historical candles first
      await this.loadHistoricalCandles();

      // Start manual price streaming
      await this.startManualPriceStreaming();
      
      // Start breakout detection  
      this.startBreakoutDetection();
      
      this.strategyState.isActive = true;
      this.logger.info('Nifty Breakout Retracement Strategy started successfully');
      
    } catch (error) {
      this.logger.error('Failed to start strategy:', error);
      throw error;
    }
  }

  /**
   * Initialize current month Nifty futures contract
   */
  private async initializeNiftyFuturesContract(): Promise<void> {
    try {
      // Get all instruments
      const instruments = await this.kiteConnect.getInstruments(['NFO']);
      
      // Filter for NIFTY futures (current month)
      const niftyFutures = instruments.filter((inst: any) => 
        inst.name === 'NIFTY' && 
        inst.instrument_type === 'FUT'
      );

      if (niftyFutures.length === 0) {
        throw new Error('No NIFTY futures found');
      }

      // Sort by expiry to get current month (nearest expiry)
      niftyFutures.sort((a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
      const currentContract = niftyFutures[0];

      // Map to our interface
      const mappedContract: NiftyFuturesData = {
        instrument_token: currentContract.instrument_token,
        tradingsymbol: currentContract.tradingsymbol,
        name: currentContract.name,
        expiry: new Date(currentContract.expiry),
        strike: currentContract.strike,
        tick_size: currentContract.tick_size,
        lot_size: currentContract.lot_size,
        instrument_type: currentContract.instrument_type,
        segment: currentContract.segment,
        exchange: currentContract.exchange
      };

      this.strategyState.currentContract = mappedContract;
      this.logger.info(`Found current month Nifty futures: ${mappedContract.tradingsymbol} (Token: ${mappedContract.instrument_token}, Expiry: ${mappedContract.expiry})`);
      
    } catch (error) {
      this.logger.error('Error initializing Nifty futures contract:', error);
      throw error;
    }
  }

  /**
   * Load historical candles 
   */
  private async loadHistoricalCandles(): Promise<void> {
    try {
      const contract = this.strategyState.currentContract;
      if (!contract) {
        throw new Error('No contract available');
      }
      
      this.logger.info(`Using contract: ${contract.tradingsymbol} (Token: ${contract.instrument_token})`);
      
      // Calculate date range (last 7 days)
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      
      // Format dates as YYYY-MM-DD
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];
      
      this.logger.info(`Fetching historical candles from ${fromDateStr} to ${toDateStr}...`);
      
      // Fetch 5-minute candles for the past week
      const candles = await this.kiteConnect.getHistoricalData(
        contract.instrument_token,
        '5minute',
        fromDateStr,
        toDateStr
      );
      
      // Convert to our Candle interface
      this.strategyState.candles = candles.map((candle: any) => ({
        timestamp: new Date(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }));
      
      this.logger.info(`Loaded ${this.strategyState.candles.length} historical 5-minute candles`);
      
    } catch (error) {
      this.logger.error('Error loading historical candles:', error);
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
      
      // Stop manual price streaming
      await this.stopManualPriceStreaming();
      
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
   * Start manual price streaming using REST API polling
   */
  public async startManualPriceStreaming(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        throw new Error('No current contract available for price streaming');
      }
      
      this.logger.info(`🚀 Starting MANUAL price streaming for ${this.strategyState.currentContract.tradingsymbol}`);
      
      this.isManualStreamingActive = true;
      this.strategyState.priceStreamingActive = true;
      
      // Start polling every 1 second
      this.pricePollingInterval = setInterval(async () => {
        await this.fetchAndProcessLivePrice();
      }, 1000);
      
      // Fetch first price immediately
      await this.fetchAndProcessLivePrice();
      
      this.logger.info('✅ MANUAL price streaming started successfully - polling every 1 second');

    } catch (error) {
      this.logger.error('❌ Failed to start MANUAL price streaming:', error);
      this.strategyState.priceStreamingActive = false;
      this.isManualStreamingActive = false;
      throw error;
    }
  }

  /**
   * Fetch live price using REST API and process it as a tick
   */
  private async fetchAndProcessLivePrice(): Promise<void> {
    try {
      if (!this.strategyState.currentContract || !this.isManualStreamingActive) {
        return;
      }

      const symbol = `NFO:${this.strategyState.currentContract.tradingsymbol}`;
      
      // Fetch quote using REST API
      const quotes = await this.kiteConnect.getQuote([symbol]);
      const quote = quotes[symbol];

      if (!quote) {
        this.logger.warn(`⚠️ No quote data received for ${symbol}`);
        return;
      }

      // Convert quote to tick data format
      const tickData: TickData = {
        instrument_token: quote.instrument_token,
        last_price: quote.last_price || 0,
        volume: quote.volume || 0,
        buy_quantity: quote.buy_quantity || 0,
        sell_quantity: quote.sell_quantity || 0,
        ohlc: {
          open: quote.ohlc?.open || 0,
          high: quote.ohlc?.high || 0,
          low: quote.ohlc?.low || 0,
          close: quote.ohlc?.close || 0
        },
        change: quote.net_change || 0,
        last_trade_time: new Date(quote.last_trade_time) || new Date(),
        exchange_timestamp: new Date(quote.timestamp) || new Date(),
        timestamp: new Date()
      };

      // Update strategy state
      this.strategyState.livePrice = tickData;
      this.strategyState.lastUpdateTime = new Date();

      // Enhanced logging for manual polling
      this.logger.info(`💹 MANUAL POLL: ${this.strategyState.currentContract.tradingsymbol} | LTP: ₹${tickData.last_price.toFixed(2)} | Vol: ${tickData.volume.toLocaleString()} | Change: ₹${tickData.change.toFixed(2)}`);

      // Process tick for 1-minute candle generation
      this.processTickForOneMinuteCandle(tickData);

    } catch (error) {
      this.logger.error('❌ Error in fetchAndProcessLivePrice:', error);
    }
  }

  /**
   * Stop manual price streaming
   */
  public async stopManualPriceStreaming(): Promise<void> {
    try {
      this.logger.info('🛑 Stopping MANUAL price streaming...');
      
      this.isManualStreamingActive = false;
      this.strategyState.priceStreamingActive = false;
      
      if (this.pricePollingInterval) {
        clearInterval(this.pricePollingInterval);
        this.pricePollingInterval = null;
      }
      
      this.logger.info('✅ MANUAL price streaming stopped');
    } catch (error) {
      this.logger.error('❌ Error stopping MANUAL price streaming:', error);
    }
  }

  // Rest of the methods remain the same...
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
   * Get live price
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
   * Check if strategy is active
   */
  public isStrategyActive(): boolean {
    return this.strategyState.isActive;
  }

  /**
   * Get candle count
   */
  public getCandleCount(): number {
    return this.strategyState.candles.length;
  }

  /**
   * Check if market hours (simplified)
   */
  public isMarketHours(): boolean {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;
    
    // NSE futures market hours: 9:15 AM to 3:30 PM
    const marketStart = 9 * 60 + 15; // 9:15 AM
    const marketEnd = 15 * 60 + 30;  // 3:30 PM
    
    return currentTime >= marketStart && currentTime <= marketEnd;
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
   * Get one minute candle count
   */
  public getOneMinuteCandleCount(): number {
    return this.strategyState.oneMinuteCandles.length;
  }

  /**
   * Get current volume SMA 50
   */
  public getCurrentVolumeSMA50(): number {
    return this.strategyState.currentVolumeSMA50;
  }

  /**
   * Get latest one minute candle
   */
  public getLatestOneMinuteCandle(): Candle | undefined {
    if (this.strategyState.oneMinuteCandles.length === 0) {
      return undefined;
    }
    return this.strategyState.oneMinuteCandles[this.strategyState.oneMinuteCandles.length - 1];
  }

  // Pivot detection constants
  private readonly LOOKBACK_PERIOD = 15; // 15,15 pivot detection as per requirements

  // Placeholder methods for breakout detection and candle processing
  private startBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = true;
    this.logger.info('Breakout detection started');
    
    // Start pivot detection immediately with current candles
    this.detectPivotPoints();
    
    // Set up periodic pivot detection (every 5 minutes)
    this.breakoutDetectionInterval = setInterval(() => {
      this.detectPivotPoints();
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  private stopBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
    if (this.breakoutDetectionInterval) {
      clearInterval(this.breakoutDetectionInterval);
      this.breakoutDetectionInterval = null;
    }
    this.logger.info('Breakout detection stopped');
  }

  /**
   * Detect pivot points from 5-minute candles using 15,15 lookback
   * Uses professional pivot point detection algorithm
   */
  private detectPivotPoints(): void {
    const candles = this.strategyState.candles;
    const requiredCandles = (this.LOOKBACK_PERIOD * 2) + 1; // 31 candles minimum

    if (candles.length < requiredCandles) {
      this.logger.debug(`Not enough candles for pivot detection (need ${requiredCandles}, have ${candles.length})`);
      return;
    }

    let latestPivotHigh: PivotPoint | undefined;
    let latestPivotLow: PivotPoint | undefined;
    let foundPivots = 0;

    // Start from the lookback period and go until we have enough future candles
    for (let i = this.LOOKBACK_PERIOD; i < candles.length - this.LOOKBACK_PERIOD; i++) {
      const currentCandle = candles[i];
      if (!currentCandle) continue;
      
      // Check for pivot high using 15,15 lookback
      const isPivotHigh = this.isPivotHigh(i, candles);
      if (isPivotHigh) {
        latestPivotHigh = {
          price: currentCandle.high,
          timestamp: currentCandle.timestamp,
          type: 'high'
        };
        foundPivots++;
      }

      // Check for pivot low using 15,15 lookback
      const isPivotLow = this.isPivotLow(i, candles);
      if (isPivotLow) {
        latestPivotLow = {
          price: currentCandle.low,
          timestamp: currentCandle.timestamp,
          type: 'low'
        };
        foundPivots++;
      }
    }

    // Update strategy state with the latest confirmed pivots
    if (latestPivotHigh) {
      // Only update if this is a new pivot or higher than the previous one
      if (!this.strategyState.latestPivotHigh || 
          latestPivotHigh.timestamp > this.strategyState.latestPivotHigh.timestamp ||
          latestPivotHigh.price > this.strategyState.latestPivotHigh.price) {
        this.strategyState.latestPivotHigh = latestPivotHigh;
        this.logger.info(`🔺 NEW PIVOT HIGH (15,15): ₹${latestPivotHigh.price.toFixed(2)} at ${latestPivotHigh.timestamp.toLocaleString()}`);
      }
    }
    
    if (latestPivotLow) {
      // Only update if this is a new pivot or lower than the previous one
      if (!this.strategyState.latestPivotLow || 
          latestPivotLow.timestamp > this.strategyState.latestPivotLow.timestamp ||
          latestPivotLow.price < this.strategyState.latestPivotLow.price) {
        this.strategyState.latestPivotLow = latestPivotLow;
        this.logger.info(`🔻 NEW PIVOT LOW (15,15): ₹${latestPivotLow.price.toFixed(2)} at ${latestPivotLow.timestamp.toLocaleString()}`);
      }
    }

    if (foundPivots === 0) {
      this.logger.debug('No new pivot points detected in current 15,15 analysis');
    } else {
      this.logger.info(`✅ Pivot analysis complete (15,15) - analyzed ${foundPivots} pivot(s)`);
      this.logCurrentPivots();
    }
  }

  /**
   * Check if the candle at index i is a pivot high using 15,15 lookback
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
   * Check if the candle at index i is a pivot low using 15,15 lookback
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
   * Log current pivot points
   */
  private logCurrentPivots(): void {
    const { latestPivotHigh, latestPivotLow } = this.strategyState;

    this.logger.info('=== CURRENT PIVOT POINTS (15,15) ===');
    
    if (latestPivotHigh) {
      this.logger.info(`📈 Latest Pivot HIGH: ₹${latestPivotHigh.price.toFixed(2)} at ${latestPivotHigh.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📈 No pivot high found yet');
    }

    if (latestPivotLow) {
      this.logger.info(`� Latest Pivot LOW: ₹${latestPivotLow.price.toFixed(2)} at ${latestPivotLow.timestamp.toLocaleString()}`);
    } else {
      this.logger.info('📉 No pivot low found yet');
    }

    this.logger.info('============================');
  }

  private processTickForOneMinuteCandle(tick: TickData): void {
    const now = new Date(tick.timestamp || new Date());
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

    if (!this.currentOneMinuteCandle || this.currentOneMinuteCandle.timestamp.getTime() !== currentMinute.getTime()) {
      // Save the previous candle if it exists
      if (this.currentOneMinuteCandle) {
        this.strategyState.oneMinuteCandles.push({
          timestamp: this.currentOneMinuteCandle.timestamp,
          open: this.currentOneMinuteCandle.open,
          high: this.currentOneMinuteCandle.high,
          low: this.currentOneMinuteCandle.low,
          close: this.currentOneMinuteCandle.close,
          volume: this.currentOneMinuteCandle.volume
        });
      }

      // Start a new one-minute candle
      this.currentOneMinuteCandle = {
        timestamp: currentMinute,
        open: tick.last_price,
        high: tick.last_price,
        low: tick.last_price,
        close: tick.last_price,
        volume: tick.volume,
        tickCount: 1
      };
    } else {
      // Update the current candle
      this.currentOneMinuteCandle.high = Math.max(this.currentOneMinuteCandle.high, tick.last_price);
      this.currentOneMinuteCandle.low = Math.min(this.currentOneMinuteCandle.low, tick.last_price);
      this.currentOneMinuteCandle.close = tick.last_price;
      this.currentOneMinuteCandle.volume = tick.volume; // Latest volume
      this.currentOneMinuteCandle.tickCount++;
    }
  }

  /**
   * Test method for manual price fetch
   */
  public async testManualPriceFetch(): Promise<void> {
    try {
      this.logger.info('🧪 Testing manual price fetch...');
      
      if (!this.strategyState.currentContract) {
        this.logger.error('❌ No contract available for testing');
        return;
      }

      await this.fetchAndProcessLivePrice();
      this.logger.info('✅ Manual price fetch test completed');
      
    } catch (error) {
      this.logger.error('❌ Error in manual price fetch test:', error);
    }
  }

  /**
   * Simulate a test tick (for debugging)
   */
  public simulateDirectTestTick(): void {
    this.logger.info('🧪 Simulating test tick...');
    // This is just a placeholder for compatibility
  }
}