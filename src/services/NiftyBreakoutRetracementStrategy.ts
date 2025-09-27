import { Logger } from '../utils/Logger';
import { TradeExecutionService } from './TradeExecutionService';

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
  type: 'long_breakout' | 'short_breakout';
  price: number; // breakout candle close price
  timestamp: Date;
  volume: number; // breakout candle volume
  volumeMA50: number; // 50-period SMA of 1m candle volumes
  pivotPrice: number; // the pivot level that was broken
  pivotType: 'high' | 'low'; // which pivot was broken
  candleOpen: number; // breakout candle open price
  candleClose: number; // breakout candle close price
  candleHigh: number; // breakout candle high price
  candleLow: number; // breakout candle low price
  volumeRatio: number; // volume / volumeMA50 (for analysis)
}

export interface MarkingCandle {
  candle: Candle; // The actual candle data
  entryPrice: number; // high for long, low for short
  stopLoss: number; // low for long, high for short
  updateCount: number; // 0 for first marking candle, 1-3 for updates
  detectedAt: Date; // when this marking candle was detected
}

export interface MarkingCandleState {
  isActive: boolean; // whether we're currently tracking marking candles
  breakoutReference: BreakoutSignal | null; // reference to the original breakout
  startTime: Date | null; // when breakout occurred (18-min timer starts here)
  currentMarkingCandle: MarkingCandle | null; // current active marking candle
  searchPhase: 'initial' | 'updates' | 'expired' | 'completed'; // current phase
  barsProcessedSinceBreakout: number; // count bars since breakout for 5-bar initial search
  maxUpdatesReached: boolean; // whether 3 updates have been reached
  timeExpired: boolean; // whether 18-minute limit has been exceeded
  tradeSkipped: boolean; // whether this setup has been skipped
}

export enum TradeState {
  WAITING_FOR_BREAKOUT = 'waiting_for_breakout',
  WAITING_FOR_ENTRY = 'waiting_for_entry', 
  IN_TRADE = 'in_trade'
}

export interface TradeSetupRequest {
  strategyId: string;
  direction: 'LONG' | 'SHORT';
  entryLevel: number;
  stopLossLevel: number;
  targetLevel: number;
  underlyingPrice: number;
  timestamp: Date;
}

export interface StrategyState {
  isActive: boolean;
  currentContract?: NiftyFuturesData;
  livePrice?: TickData;
  lastUpdateTime?: Date;
  priceStreamingActive: boolean;
  breakoutDetectionActive: boolean;
  tradeState: TradeState; // Current trade state
  currentTradeId?: string; // ID of active trade setup/execution
  tradeSetupRequest?: TradeSetupRequest; // Current trade setup details
  candles: Candle[];
  oneMinuteCandles: Candle[];
  latestPivotHigh?: PivotPoint | undefined;
  latestPivotLow?: PivotPoint | undefined;
  latestBreakoutSignal?: BreakoutSignal | undefined;
  markingCandleState: MarkingCandleState; // new marking candle state
  currentVolumeSMA50: number;
  // New breakout detection state
  lastProcessedOneMinuteCandleTime?: Date | undefined; // track last processed 1m candle to avoid duplicates
}

export class NiftyBreakoutRetracementStrategy {
  private kiteConnect: any;
  private logger: Logger;
  private strategyState: StrategyState;
  private tradeExecutionService: TradeExecutionService;
  
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
    this.tradeExecutionService = new TradeExecutionService(kiteConnect, this.logger);
    
    this.strategyState = {
      isActive: false,
      priceStreamingActive: false,
      breakoutDetectionActive: false,
      tradeState: TradeState.WAITING_FOR_BREAKOUT,
      candles: [],
      oneMinuteCandles: [],
      currentVolumeSMA50: 0,
      markingCandleState: {
        isActive: false,
        breakoutReference: null,
        startTime: null,
        currentMarkingCandle: null,
        searchPhase: 'initial',
        barsProcessedSinceBreakout: 0,
        maxUpdatesReached: false,
        timeExpired: false,
        tradeSkipped: false
      }
    };
  }

  /**
   * Fetch historical 1-minute candles for volume SMA50 initialization
   * Uses progressive date range expansion to ensure we get at least 50 trading candles
   */
  private async fetchHistorical1MinuteCandles(): Promise<void> {
    try {
      if (!this.strategyState.currentContract) {
        this.logger.error('No current contract available for historical data fetch');
        return;
      }

      const instrumentToken = this.strategyState.currentContract.instrument_token;
      const toDate = new Date();
      let allHistoricalCandles: Candle[] = [];
      
      // Progressive date range expansion to ensure we get at least 50 candles
      const dateRanges = [
        { hours: 2, description: '2 hours' },
        { hours: 6, description: '6 hours' },
        { hours: 12, description: '12 hours' },
        { hours: 24, description: '1 day' },
        { hours: 48, description: '2 days' },
        { hours: 72, description: '3 days' },
        { hours: 96, description: '4 days' },
        { hours: 120, description: '5 days' }
      ];

      this.logger.info(`📈 Fetching historical 1-minute candles for ${this.strategyState.currentContract.tradingsymbol}`);
      this.logger.info(`🎯 Target: At least 50 trading candles for Volume SMA50 calculation`);

      for (const range of dateRanges) {
        const fromDate = new Date();
        fromDate.setHours(fromDate.getHours() - range.hours);
        
        this.logger.info(`📅 Trying ${range.description} range: ${fromDate.toISOString()} to ${toDate.toISOString()}`);

        try {
          const historicalData = await this.kiteConnect.getHistoricalData(
            instrumentToken,
            'minute',
            fromDate,
            toDate
          );

          if (historicalData && historicalData.length > 0) {
            // Convert to our Candle format
            const historicalCandles: Candle[] = historicalData.map((kiteCandle: any) => ({
              timestamp: new Date(kiteCandle.date),
              open: kiteCandle.open,
              high: kiteCandle.high,
              low: kiteCandle.low,
              close: kiteCandle.close,
              volume: kiteCandle.volume
            }));

            // Sort by timestamp to ensure proper order
            historicalCandles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            
            allHistoricalCandles = historicalCandles;
            this.logger.info(`📊 Retrieved ${historicalCandles.length} candles from ${range.description} range`);

            // Check if we have enough candles for SMA50
            if (historicalCandles.length >= 50) {
              this.logger.info(`✅ Success! Got ${historicalCandles.length} candles (≥50 required)`);
              break;
            } else {
              this.logger.warn(`⚠️ Only ${historicalCandles.length} candles from ${range.description}, expanding range...`);
            }
          } else {
            this.logger.warn(`⚠️ No data returned for ${range.description} range`);
          }
        } catch (rangeError) {
          this.logger.error(`❌ Failed to fetch ${range.description} range:`, rangeError);
          continue; // Try next range
        }
      }

      if (allHistoricalCandles.length === 0) {
        this.logger.error('❌ Failed to retrieve any historical 1-minute data after trying all date ranges');
        return;
      }

      // Keep only the latest 50 candles for memory optimization
      const candlesToKeep = allHistoricalCandles.slice(-50);
      this.strategyState.oneMinuteCandles = candlesToKeep;

      this.logger.info(`✅ Loaded ${allHistoricalCandles.length} historical candles (keeping latest ${candlesToKeep.length})`);
      
      // Calculate initial volume SMA50 if we have enough data
      if (candlesToKeep.length >= 50) {
        this.updateVolumeSMA50();
        this.logger.info(`📊 Initial Volume SMA50 calculated: ${this.strategyState.currentVolumeSMA50.toFixed(2)}`);
      } else {
        this.logger.warn(`⚠️ Only ${candlesToKeep.length} candles available after all attempts. Volume confirmation will be limited initially.`);
        // Still calculate SMA with available data
        if (candlesToKeep.length > 0) {
          this.updateVolumeSMA50();
          this.logger.info(`📊 Partial Volume SMA${candlesToKeep.length} calculated: ${this.strategyState.currentVolumeSMA50.toFixed(2)}`);
        }
      }

      // Set last processed time to the last historical candle
      if (allHistoricalCandles.length > 0) {
        const lastCandle = allHistoricalCandles[allHistoricalCandles.length - 1];
        if (lastCandle) {
          this.strategyState.lastProcessedOneMinuteCandleTime = lastCandle.timestamp;
          this.logger.info(`🕐 Last processed 1m candle time set to: ${lastCandle.timestamp.toLocaleString()}`);
        }
      }

    } catch (error) {
      this.logger.error('Failed to fetch historical 1-minute candles:', error);
    }
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

      // Load historical 5-minute candles for pivot detection
      await this.loadHistoricalCandles();

      // Load historical 1-minute candles for volume SMA50 initialization
      await this.fetchHistorical1MinuteCandles();

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

      // Monitor trade levels based on current state
      this.monitorTradeLevels(tickData.last_price);

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
   * Get memory usage summary for 1-minute candles
   */
  public getCandleMemoryInfo(): { count: number, maxAllowed: number, memoryOptimized: boolean } {
    const count = this.strategyState.oneMinuteCandles.length;
    return {
      count: count,
      maxAllowed: 50,
      memoryOptimized: count <= 50
    };
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
    
    // Set up periodic pivot detection synchronized to 5-minute candle closes
    this.scheduleNext5MinutePivotDetection();
  }

  private scheduleNext5MinutePivotDetection(): void {
    if (!this.strategyState.breakoutDetectionActive) {
      return; // Don't schedule if detection is not active
    }

    const now = new Date();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    const currentMs = now.getMilliseconds();
    
    // Calculate next 5-minute boundary (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    let nextCandleMinute: number;
    
    // If we're exactly at a 5-minute boundary and past 1 second, or past any boundary, go to NEXT boundary
    if ((currentMinutes % 5 === 0 && currentSeconds >= 1) || (currentMinutes % 5 !== 0)) {
      // We're past the current boundary, calculate the next one
      nextCandleMinute = (Math.floor(currentMinutes / 5) + 1) * 5;
    } else {
      // We're before the 1-second mark of current boundary, use current boundary
      nextCandleMinute = Math.ceil(currentMinutes / 5) * 5;
    }
    
    const nextCandleTime = new Date(now);
    
    if (nextCandleMinute >= 60) {
      // Roll over to next hour
      nextCandleTime.setHours(nextCandleTime.getHours() + 1);
      nextCandleTime.setMinutes(0);
    } else {
      nextCandleTime.setMinutes(nextCandleMinute);
    }
    
    nextCandleTime.setSeconds(1); // Run 1 second after candle closes
    nextCandleTime.setMilliseconds(0);
    
    const timeUntilNext = nextCandleTime.getTime() - now.getTime();
    
    // Ensure we never schedule for a negative time (safety check)
    if (timeUntilNext <= 0) {
      this.logger.warn(`⚠️ Timing calculation error - timeUntilNext: ${timeUntilNext}ms. Forcing 5min delay.`);
      // Force next detection to be 5 minutes from now
      const fallbackTime = new Date(now.getTime() + (5 * 60 * 1000));
      this.breakoutDetectionInterval = setTimeout(() => {
        this.detectPivotPoints();
        this.scheduleNext5MinutePivotDetection();
      }, 5 * 60 * 1000);
      return;
    }
    
    this.logger.info(`📅 Next 5m pivot detection scheduled for: ${nextCandleTime.toLocaleTimeString()} (in ${Math.round(timeUntilNext/1000)}s)`);
    
    this.breakoutDetectionInterval = setTimeout(() => {
      this.detectPivotPoints();
      // Schedule the next detection
      this.scheduleNext5MinutePivotDetection();
    }, timeUntilNext);
  }

  private stopBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
    if (this.breakoutDetectionInterval) {
      clearTimeout(this.breakoutDetectionInterval); // Changed from clearInterval to clearTimeout
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
        const completedCandle: Candle = {
          timestamp: this.currentOneMinuteCandle.timestamp,
          open: this.currentOneMinuteCandle.open,
          high: this.currentOneMinuteCandle.high,
          low: this.currentOneMinuteCandle.low,
          close: this.currentOneMinuteCandle.close,
          volume: this.currentOneMinuteCandle.volume
        };
        
        this.strategyState.oneMinuteCandles.push(completedCandle);
        
        // Keep only the latest 50 candles for memory optimization
        if (this.strategyState.oneMinuteCandles.length > 50) {
          this.strategyState.oneMinuteCandles = this.strategyState.oneMinuteCandles.slice(-50);
          this.logger.debug('🗑️ Trimmed 1m candles to latest 50 for memory optimization');
        }
        
        // Update volume SMA50
        this.updateVolumeSMA50();
        
        // Check for breakout on the completed candle
        this.checkForBreakout(completedCandle);
        
        // Process marking candle logic after breakout check
        this.processMarkingCandle(completedCandle);
        
        this.logger.debug(`✅ 1m candle completed: O:${completedCandle.open.toFixed(2)} H:${completedCandle.high.toFixed(2)} L:${completedCandle.low.toFixed(2)} C:${completedCandle.close.toFixed(2)} V:${completedCandle.volume}`);
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
   * Update 50-period Simple Moving Average of 1-minute candle volumes
   * Always uses exactly the last 50 candles (or all available if less than 50)
   */
  private updateVolumeSMA50(): void {
    const oneMinuteCandles = this.strategyState.oneMinuteCandles;
    
    if (oneMinuteCandles.length === 0) {
      this.strategyState.currentVolumeSMA50 = 0;
      return;
    }
    
    // Use all available candles (up to 50 max due to our trimming)
    const period = Math.min(50, oneMinuteCandles.length);
    const recentCandles = oneMinuteCandles.slice(-period);
    
    // Calculate simple moving average of volumes
    const totalVolume = recentCandles.reduce((sum, candle) => sum + candle.volume, 0);
    this.strategyState.currentVolumeSMA50 = totalVolume / period;
    
    this.logger.debug(`📊 Volume SMA50 updated: ${this.strategyState.currentVolumeSMA50.toFixed(0)} (based on ${period} candles, total array size: ${oneMinuteCandles.length})`);
  }

  /**
   * Check completed 1-minute candle for breakout signals
   */
  private checkForBreakout(completedCandle: Candle): void {
    try {
      // Skip breakout detection if not in WAITING_FOR_BREAKOUT state
      if (this.strategyState.tradeState !== TradeState.WAITING_FOR_BREAKOUT) {
        this.logger.debug(`🔒 Breakout detection disabled - Current state: ${this.strategyState.tradeState}`);
        return;
      }

      // Skip if we don't have pivots or sufficient volume data
      if (!this.strategyState.latestPivotHigh && !this.strategyState.latestPivotLow) {
        this.logger.debug('🔍 No pivots available for breakout detection');
        return;
      }
      
      if (this.strategyState.oneMinuteCandles.length < 50) {
        this.logger.debug(`🔍 Insufficient 1m candles for volume SMA50 (${this.strategyState.oneMinuteCandles.length}/50)`);
        return;
      }
      
      if (this.strategyState.currentVolumeSMA50 <= 0) {
        this.logger.debug('🔍 Volume SMA50 not available');
        return;
      }
      
      // Avoid processing the same candle multiple times
      if (this.strategyState.lastProcessedOneMinuteCandleTime && 
          completedCandle.timestamp.getTime() === this.strategyState.lastProcessedOneMinuteCandleTime.getTime()) {
        return;
      }
      
      this.strategyState.lastProcessedOneMinuteCandleTime = completedCandle.timestamp;
      
      const volumeRatio = completedCandle.volume / this.strategyState.currentVolumeSMA50;
      
      this.logger.debug(`🔍 Breakout check: O:${completedCandle.open.toFixed(2)} C:${completedCandle.close.toFixed(2)} V:${completedCandle.volume} (${volumeRatio.toFixed(2)}x SMA50)`);
      
      // Check for LONG breakout (above pivot high)
      if (this.strategyState.latestPivotHigh) {
        const pivotHigh = this.strategyState.latestPivotHigh.price;
        
        if (completedCandle.close > pivotHigh && 
            completedCandle.open < pivotHigh && 
            completedCandle.volume > this.strategyState.currentVolumeSMA50) {
          
          const breakoutSignal: BreakoutSignal = {
            type: 'long_breakout',
            price: completedCandle.close,
            timestamp: completedCandle.timestamp,
            volume: completedCandle.volume,
            volumeMA50: this.strategyState.currentVolumeSMA50,
            pivotPrice: pivotHigh,
            pivotType: 'high',
            candleOpen: completedCandle.open,
            candleClose: completedCandle.close,
            candleHigh: completedCandle.high,
            candleLow: completedCandle.low,
            volumeRatio: volumeRatio
          };
          
          this.strategyState.latestBreakoutSignal = breakoutSignal;
          
          this.logger.info(`🚀 LONG BREAKOUT DETECTED!`);
          this.logger.info(`   📈 Breakout Price: ₹${completedCandle.close.toFixed(2)} (Open: ₹${completedCandle.open.toFixed(2)})`);
          this.logger.info(`   🎯 Pivot High: ₹${pivotHigh.toFixed(2)}`);
          this.logger.info(`   📊 Volume: ${completedCandle.volume.toLocaleString()} (${volumeRatio.toFixed(2)}x SMA50: ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
          this.logger.info(`   ⏰ Time: ${completedCandle.timestamp.toLocaleString()}`);
          
          // Transition to WAITING_FOR_ENTRY state
          this.transitionToState(TradeState.WAITING_FOR_ENTRY, 'LONG breakout detected');
          
          // Start marking candle tracking for this breakout
          this.startMarkingCandleTracking(breakoutSignal);
          
          return; // Don't check for short breakout if we found long breakout
        }
      }
      
      // Check for SHORT breakout (below pivot low)
      if (this.strategyState.latestPivotLow) {
        const pivotLow = this.strategyState.latestPivotLow.price;
        
        if (completedCandle.close < pivotLow && 
            completedCandle.open > pivotLow && 
            completedCandle.volume > this.strategyState.currentVolumeSMA50) {
          
          const breakoutSignal: BreakoutSignal = {
            type: 'short_breakout',
            price: completedCandle.close,
            timestamp: completedCandle.timestamp,
            volume: completedCandle.volume,
            volumeMA50: this.strategyState.currentVolumeSMA50,
            pivotPrice: pivotLow,
            pivotType: 'low',
            candleOpen: completedCandle.open,
            candleClose: completedCandle.close,
            candleHigh: completedCandle.high,
            candleLow: completedCandle.low,
            volumeRatio: volumeRatio
          };
          
          this.strategyState.latestBreakoutSignal = breakoutSignal;
          
          this.logger.info(`🚀 SHORT BREAKOUT DETECTED!`);
          this.logger.info(`   📉 Breakout Price: ₹${completedCandle.close.toFixed(2)} (Open: ₹${completedCandle.open.toFixed(2)})`);
          this.logger.info(`   🎯 Pivot Low: ₹${pivotLow.toFixed(2)}`);
          this.logger.info(`   📊 Volume: ${completedCandle.volume.toLocaleString()} (${volumeRatio.toFixed(2)}x SMA50: ${this.strategyState.currentVolumeSMA50.toFixed(0)})`);
          this.logger.info(`   ⏰ Time: ${completedCandle.timestamp.toLocaleString()}`);
          
          // Transition to WAITING_FOR_ENTRY state
          this.transitionToState(TradeState.WAITING_FOR_ENTRY, 'SHORT breakout detected');
          
          // Start marking candle tracking for this breakout
          this.startMarkingCandleTracking(breakoutSignal);
        }
      }
      
    } catch (error) {
      this.logger.error('❌ Error in breakout detection:', error);
    }
  }

  // ================================================================================
  // MARKING CANDLE MODULE - Entry & Stop Loss Level Management
  // ================================================================================
  // This module handles the marking candle detection and management system
  // which provides precise entry and stop-loss levels after a breakout is detected.
  //
  // Two-Phase System:
  // Phase 1 (Initial): Detects opposite-direction marking candles within 5 bars after breakout
  // Phase 2 (Updates): Updates entry/SL levels dynamically when SL extends by ≥1 point  
  //                   - Enforces 18-minute total time limit and maximum 3 updates per breakout
  //                   - Trade abandoned if no marking candle found in first 5 bars
  // - Provides real-time entry and stop-loss levels for trade execution
  // ================================================================================

  /**
   * TRADE STATE MANAGEMENT
   * Controls the strategy's operational state and prevents concurrent operations
   */
  private transitionToState(newState: TradeState, reason?: string): void {
    const previousState = this.strategyState.tradeState;
    this.strategyState.tradeState = newState;
    
    this.logger.info(`🔄 Trade State Transition: ${previousState} → ${newState}${reason ? ` (${reason})` : ''}`);
    
    // Perform state synchronization check and recovery
    this.performStateRecovery(newState, previousState);
    
    // Handle state-specific actions
    switch (newState) {
      case TradeState.WAITING_FOR_BREAKOUT:
        this.resetTradeSetup();
        this.enableBreakoutDetection();
        break;
        
      case TradeState.WAITING_FOR_ENTRY:
        this.disableBreakoutDetection();
        break;
        
      case TradeState.IN_TRADE:
        this.disableBreakoutDetection();
        this.disableMarkingCandleSystem();
        break;
    }
  }

  private performStateRecovery(newState: TradeState, previousState: TradeState): void {
    try {
      const activePosition = this.tradeExecutionService.getActivePosition();
      const hasStrategyTradeId = !!this.strategyState.currentTradeId;
      const hasServicePosition = !!activePosition;

      // Check for state mismatches and recover
      if (newState === TradeState.WAITING_FOR_BREAKOUT) {
        if (hasServicePosition) {
          this.logger.warn(`🔧 State Recovery: Found orphaned position ${activePosition.tradeId} - attempting cleanup`);
          // Don't automatically close - log for manual intervention
          this.logger.error(`🚨 MANUAL INTERVENTION REQUIRED: Orphaned position detected`);
        }
      }

      if (newState === TradeState.IN_TRADE) {
        if (!hasServicePosition && hasStrategyTradeId) {
          this.logger.warn(`🔧 State Recovery: Strategy has trade ID but no service position - clearing strategy state`);
          delete this.strategyState.currentTradeId;
        }
      }

      if (hasStrategyTradeId && hasServicePosition && activePosition.tradeId !== this.strategyState.currentTradeId) {
        this.logger.warn(`🔧 State Recovery: ID mismatch - Strategy: ${this.strategyState.currentTradeId}, Service: ${activePosition.tradeId}`);
        // Use service position as source of truth
        this.strategyState.currentTradeId = activePosition.tradeId;
      }

    } catch (error) {
      this.logger.error('❌ Error in state recovery:', error);
    }
  }

  private resetTradeSetup(): void {
    delete this.strategyState.currentTradeId;
    delete this.strategyState.tradeSetupRequest;
    
    // Reset marking candle state to initial
    this.strategyState.markingCandleState.isActive = false;
    this.strategyState.markingCandleState.breakoutReference = null;
    this.strategyState.markingCandleState.startTime = null;
    this.strategyState.markingCandleState.currentMarkingCandle = null;
    this.strategyState.markingCandleState.searchPhase = 'initial';
    this.strategyState.markingCandleState.barsProcessedSinceBreakout = 0;
    this.strategyState.markingCandleState.maxUpdatesReached = false;
    this.strategyState.markingCandleState.timeExpired = false;
    this.strategyState.markingCandleState.tradeSkipped = false;
  }

  private disableBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = false;
  }

  private enableBreakoutDetection(): void {
    this.strategyState.breakoutDetectionActive = true;
  }

  private disableMarkingCandleSystem(): void {
    this.strategyState.markingCandleState.isActive = false;
  }

  /**
   * TARGET CALCULATION
   * Calculates target level based on NIFTY futures price
   * Target = Entry ± (NIFTY FUT price / 1000) points
   */
  private calculateTargetLevel(entryLevel: number, direction: 'LONG' | 'SHORT'): number {
    if (!this.strategyState.livePrice) {
      throw new Error('No live price available for target calculation');
    }

    const futurePrice = this.strategyState.livePrice.last_price;
    const targetPoints = Math.round(futurePrice / 1000);
    
    const targetLevel = direction === 'LONG' 
      ? entryLevel + targetPoints 
      : entryLevel - targetPoints;

    this.logger.info(`📊 Target Calculation: Entry ${entryLevel}, FUT ${futurePrice} → Target ${targetLevel} (${targetPoints} pts)`);
    
    return targetLevel;
  }

  /**
   * TRADE SETUP REQUEST CREATION  
   * Creates trade setup request when marking candle levels are available
   */
  private createTradeSetupRequest(direction: 'LONG' | 'SHORT', entryLevel: number, stopLossLevel: number): TradeSetupRequest {
    const targetLevel = this.calculateTargetLevel(entryLevel, direction);
    
    const tradeRequest: TradeSetupRequest = {
      strategyId: 'nifty-breakout-retracement',
      direction,
      entryLevel,
      stopLossLevel,
      targetLevel,
      underlyingPrice: this.strategyState.livePrice?.last_price || 0,
      timestamp: new Date()
    };

    this.logger.info(`🎯 Trade Setup Created: ${direction} | Entry: ${entryLevel} | SL: ${stopLossLevel} | Target: ${targetLevel}`);
    
    return tradeRequest;
  }

  /**
   * CREATE AND STORE TRADE SETUP
   * Creates trade setup request from marking candle and stores it in strategy state
   */
  private createAndStoreTradeSetup(markingCandle: MarkingCandle): void {
    if (!this.strategyState.markingCandleState.breakoutReference) {
      this.logger.error('❌ Cannot create trade setup - no breakout reference');
      return;
    }

    const breakoutType = this.strategyState.markingCandleState.breakoutReference.type;
    const direction = breakoutType === 'long_breakout' ? 'LONG' : 'SHORT';
    
    const tradeRequest = this.createTradeSetupRequest(
      direction,
      markingCandle.entryPrice,
      markingCandle.stopLoss
    );

    // Store in strategy state
    this.strategyState.tradeSetupRequest = tradeRequest;
    
    this.logger.info(`💾 Trade Setup Stored in Strategy State`);
    
    // TODO: Call TradeExecutionService here when it's implemented
    // await this.tradeExecutionService.setupTrade(tradeRequest);
  }

  /**
   * TRADE LEVEL MONITORING
   * Monitors current price against entry, SL, and target levels based on trade state
   */
  private monitorTradeLevels(currentPrice: number): void {
    switch (this.strategyState.tradeState) {
      case TradeState.WAITING_FOR_ENTRY:
        this.checkEntryTrigger(currentPrice);
        break;
        
      case TradeState.IN_TRADE:
        this.checkExitTriggers(currentPrice);
        break;
        
      case TradeState.WAITING_FOR_BREAKOUT:
        // No level monitoring needed
        break;
    }
  }

  /**
   * ENTRY TRIGGER DETECTION
   * Monitors for entry level crossover in WAITING_FOR_ENTRY state
   */
  private checkEntryTrigger(currentPrice: number): void {
    if (!this.strategyState.tradeSetupRequest) {
      return; // No trade setup available
    }

    const setup = this.strategyState.tradeSetupRequest;
    const entryLevel = setup.entryLevel;
    const direction = setup.direction;

    let entryTriggered = false;

    if (direction === 'LONG' && currentPrice >= entryLevel) {
      entryTriggered = true;
      this.logger.info(`🚀 LONG ENTRY TRIGGERED! Price ${currentPrice} >= Entry ${entryLevel}`);
    } else if (direction === 'SHORT' && currentPrice <= entryLevel) {
      entryTriggered = true;
      this.logger.info(`🚀 SHORT ENTRY TRIGGERED! Price ${currentPrice} <= Entry ${entryLevel}`);
    }

    if (entryTriggered) {
      // Fire and forget async execution to avoid blocking price monitoring
      this.executeTradeEntry().catch(error => {
        this.logger.error('Entry execution error handled in async context:', error);
      });
    }
  }

  /**
   * EXIT TRIGGER DETECTION  
   * Monitors for SL/Target hits in IN_TRADE state
   */
  private checkExitTriggers(currentPrice: number): void {
    if (!this.strategyState.tradeSetupRequest) {
      return; // No active trade
    }

    const setup = this.strategyState.tradeSetupRequest;
    const stopLoss = setup.stopLossLevel;
    const target = setup.targetLevel;
    const direction = setup.direction;

    let exitTriggered = false;
    let exitReason = '';

    // Check Stop Loss
    if (direction === 'LONG' && currentPrice <= stopLoss) {
      exitTriggered = true;
      exitReason = 'STOP_LOSS';
      this.logger.info(`🛑 LONG SL HIT! Price ${currentPrice} <= SL ${stopLoss}`);
    } else if (direction === 'SHORT' && currentPrice >= stopLoss) {
      exitTriggered = true;
      exitReason = 'STOP_LOSS';
      this.logger.info(`🛑 SHORT SL HIT! Price ${currentPrice} >= SL ${stopLoss}`);
    }

    // Check Target
    if (!exitTriggered) {
      if (direction === 'LONG' && currentPrice >= target) {
        exitTriggered = true;
        exitReason = 'TARGET';
        this.logger.info(`🎯 LONG TARGET HIT! Price ${currentPrice} >= Target ${target}`);
      } else if (direction === 'SHORT' && currentPrice <= target) {
        exitTriggered = true;
        exitReason = 'TARGET';
        this.logger.info(`🎯 SHORT TARGET HIT! Price ${currentPrice} <= Target ${target}`);
      }
    }

    if (exitTriggered) {
      // Fire and forget async execution to avoid blocking price monitoring
      this.executeTradeExit(exitReason).catch(error => {
        this.logger.error('Exit execution error handled in async context:', error);
      });
    }
  }

  /**
   * TRADE ENTRY EXECUTION
   * Called when entry level is crossed - places market order via TradeExecutionService
   */
  private async executeTradeEntry(): Promise<void> {
    try {
      this.logger.info(`📞 Calling TradeExecutionService to PLACE MARKET ORDER`);
      
      if (!this.strategyState.tradeSetupRequest) {
        throw new Error('No trade setup request available for entry execution');
      }

      // Verify no active position exists before placing new order
      const activePosition = this.tradeExecutionService.getActivePosition();
      if (activePosition) {
        throw new Error(`Cannot place order: Active position exists ${activePosition.tradeId}`);
      }

      // Call TradeExecutionService to place market order
      const tradeId = await this.tradeExecutionService.placeMarketOrder(this.strategyState.tradeSetupRequest);
      this.strategyState.currentTradeId = tradeId;
      
      // Verify state synchronization
      const newActivePosition = this.tradeExecutionService.getActivePosition();
      if (!newActivePosition || newActivePosition.tradeId !== tradeId) {
        this.logger.warn(`⚠️ State sync warning: Strategy ID ${tradeId} != Service position ${newActivePosition?.tradeId}`);
      }
      
      // Transition to IN_TRADE state after successful order placement
      this.transitionToState(TradeState.IN_TRADE, 'Entry level crossed - Order placed');
      
      this.logger.info(`✅ Trade entry executed - Trade ID: ${tradeId} - Now monitoring SL/Target levels`);
    } catch (error) {
      this.logger.error('❌ Error executing trade entry:', error);
      // On error, reset back to waiting for breakout
      this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, 'Entry execution failed');
    }
  }

  /**
   * TRADE EXIT EXECUTION
   * Called when SL or Target is hit - closes position via TradeExecutionService
   */
  private async executeTradeExit(reason: string): Promise<void> {
    try {
      this.logger.info(`📞 Calling TradeExecutionService to CLOSE POSITION - Reason: ${reason}`);
      
      if (!this.strategyState.currentTradeId) {
        throw new Error('No active trade ID available for exit execution');
      }

      // Verify active position exists before closing
      const activePosition = this.tradeExecutionService.getActivePosition();
      if (!activePosition) {
        this.logger.warn(`⚠️ No active position found in service for trade ID: ${this.strategyState.currentTradeId}`);
        // Clear strategy state and continue
        delete this.strategyState.currentTradeId;
        this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade ID cleared: ${reason}`);
        return;
      }

      if (activePosition.tradeId !== this.strategyState.currentTradeId) {
        this.logger.warn(`⚠️ State sync mismatch: Strategy ID ${this.strategyState.currentTradeId} != Service ID ${activePosition.tradeId}`);
      }

      // Call TradeExecutionService to close position
      const exitReason = reason.includes('TARGET') ? 'TARGET' : 
                        reason.includes('STOP_LOSS') ? 'STOP_LOSS' : 'MANUAL';
      await this.tradeExecutionService.closePosition(this.strategyState.currentTradeId, exitReason);
      
      // Clear trade data
      delete this.strategyState.currentTradeId;
      
      // Verify position was closed
      const remainingPosition = this.tradeExecutionService.getActivePosition();
      if (remainingPosition) {
        this.logger.warn(`⚠️ Position still active after close: ${remainingPosition.tradeId}`);
      }
      
      // Transition back to WAITING_FOR_BREAKOUT
      this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade closed: ${reason}`);
      
      this.logger.info(`✅ Trade exit executed - Returning to breakout monitoring`);
    } catch (error) {
      this.logger.error('❌ Error executing trade exit:', error);
      // Even on error, try to reset state to avoid being stuck
      delete this.strategyState.currentTradeId;
      this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, `Trade exit error: ${reason}`);
    }
  }

  /**
   * MARKING CANDLE INITIALIZATION
   * Starts tracking marking candles immediately after a breakout is detected
   * 
   * @param breakoutSignal - The breakout signal that triggered marking candle tracking
   */
  private startMarkingCandleTracking(breakoutSignal: BreakoutSignal): void {
    this.logger.info(`🔍 Starting marking candle tracking for ${breakoutSignal.type}`);
    this.logger.info(`📊 Breakout Candle OHLC: O:${breakoutSignal.candleOpen} H:${breakoutSignal.candleHigh} L:${breakoutSignal.candleLow} C:${breakoutSignal.candleClose}`);
    
    this.strategyState.markingCandleState = {
      isActive: true,
      breakoutReference: breakoutSignal,
      startTime: breakoutSignal.timestamp,
      currentMarkingCandle: null,
      searchPhase: 'initial',
      barsProcessedSinceBreakout: 0,
      maxUpdatesReached: false,
      timeExpired: false,
      tradeSkipped: false
    };
    
    this.logger.info(`✅ Marking candle tracking ACTIVATED - isActive: ${this.strategyState.markingCandleState.isActive}`);
  }

  /**
   * MARKING CANDLE PROCESSING CORE
   * Main processing logic that handles marking candle detection and updates
   * Called after each completed 1-minute candle during active tracking
   * 
   * @param completedCandle - The newly completed 1-minute candle to evaluate
   */
  private processMarkingCandle(completedCandle: Candle): void {
    if (!this.strategyState.markingCandleState.isActive) {
      this.logger.debug(`🔒 Marking candle tracking not active, skipping processing`);
      return; // Not tracking marking candles
    }

    this.logger.debug(`🕯️ Processing marking candle: O:${completedCandle.open} H:${completedCandle.high} L:${completedCandle.low} C:${completedCandle.close}`);

    const markingState = this.strategyState.markingCandleState;

    // Check 18-minute time limit
    if (markingState.startTime) {
      const minutesElapsed = (completedCandle.timestamp.getTime() - markingState.startTime.getTime()) / (1000 * 60);
      this.logger.debug(`⏰ Time elapsed since breakout: ${minutesElapsed.toFixed(1)} minutes (limit: 18 minutes)`);
      if (minutesElapsed > 18) {
        this.logger.info(`⏰ 18-minute time limit exceeded for marking candle tracking`);
        this.skipMarkingCandleTrade('time_limit_exceeded');
        return;
      }
    }

    markingState.barsProcessedSinceBreakout++;
    this.logger.debug(`📊 Bars processed since breakout: ${markingState.barsProcessedSinceBreakout} (phase: ${markingState.searchPhase})`);

    if (markingState.searchPhase === 'initial') {
      // Initial search phase - looking for first marking candle within 5 bars
      if (markingState.barsProcessedSinceBreakout <= 5) {
        this.logger.debug(`🔍 Looking for initial marking candle (bar ${markingState.barsProcessedSinceBreakout}/5)`);
        const markingCandle = this.checkForInitialMarkingCandle(completedCandle);
        if (markingCandle) {
          markingState.currentMarkingCandle = markingCandle;
          markingState.searchPhase = 'updates';
          this.logger.info(`✅ INITIAL MARKING CANDLE FOUND!`);
          this.logMarkingCandleDetails(markingCandle);
          
          // Create trade setup request with marking candle levels
          this.createAndStoreTradeSetup(markingCandle);
        } else {
          this.logger.debug(`❌ No marking candle found in bar ${markingState.barsProcessedSinceBreakout}`);
        }
      } else {
        // 5 bars elapsed without finding marking candle
        this.logger.info(`❌ No marking candle found within 5 bars after breakout`);
        this.skipMarkingCandleTrade('no_marking_candle');
        return;
      }
    } else if (markingState.searchPhase === 'updates') {
      // Updates phase - looking for better marking candles
      if (!markingState.maxUpdatesReached) {
        const updatedMarkingCandle = this.checkForMarkingCandleUpdate(completedCandle);
        if (updatedMarkingCandle) {
          markingState.currentMarkingCandle = updatedMarkingCandle;
          this.logger.info(`🔄 MARKING CANDLE UPDATED! (Count: ${updatedMarkingCandle.updateCount})`);
          this.logMarkingCandleDetails(updatedMarkingCandle);

          // Update trade setup request with new levels
          this.createAndStoreTradeSetup(updatedMarkingCandle);

          if (updatedMarkingCandle.updateCount >= 3) {
            markingState.maxUpdatesReached = true;
            this.logger.info(`🚫 Maximum 3 updates reached`);
          }
        }
      } else {
        this.logger.debug(`🚫 Maximum updates reached, no more marking candle updates allowed`);
      }
    }
  }

  /**
   * INITIAL MARKING CANDLE DETECTION
   * Validates if a candle qualifies as the first marking candle after breakout
   * 
   * Requirements:
   * - Must be opposite direction to breakout (red for long, green for short)
   * - Must close within the breakout candle's high-low range (intra-range close)
   * - Must occur within 5 bars after the breakout
   * 
   * @param candle - The candle to evaluate for marking candle qualification
   * @returns MarkingCandle object if qualified, null otherwise
   */
  private checkForInitialMarkingCandle(candle: Candle): MarkingCandle | null {
    const breakoutRef = this.strategyState.markingCandleState.breakoutReference;
    if (!breakoutRef) return null;

    const isLongBreakout = breakoutRef.type === 'long_breakout';
    const breakoutCandle = {
      open: breakoutRef.candleOpen,
      close: breakoutRef.candleClose,
      high: breakoutRef.candleHigh,
      low: breakoutRef.candleLow
    };

    this.logger.debug(`🔍 Checking marking candle: Candle OHLC: O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`);
    this.logger.debug(`📊 Breakout Candle Range: H:${breakoutCandle.high} L:${breakoutCandle.low}`);

    // Check opposite direction requirement
    const candleIsRed = candle.close < candle.open;
    const candleIsGreen = candle.close > candle.open;

    if (isLongBreakout && !candleIsRed) {
      this.logger.debug(`❌ Long breakout needs RED marking candle, but candle is ${candleIsRed ? 'RED' : 'GREEN'}`);
      return null; // For long breakout, need red marking candle
    }
    if (!isLongBreakout && !candleIsGreen) {
      this.logger.debug(`❌ Short breakout needs GREEN marking candle, but candle is ${candleIsGreen ? 'GREEN' : 'RED'}`);
      return null; // For short breakout, need green marking candle
    }

    // Check intra-range close requirement
    if (candle.close < breakoutCandle.low || candle.close > breakoutCandle.high) {
      this.logger.debug(`❌ Candle close ${candle.close} outside breakout range [${breakoutCandle.low}, ${breakoutCandle.high}]`);
      return null; // Closing price must be within breakout candle's range
    }

    this.logger.info(`✅ VALID MARKING CANDLE FOUND! Close: ${candle.close} within range [${breakoutCandle.low}, ${breakoutCandle.high}]`);

    // Create marking candle
    const markingCandle: MarkingCandle = {
      candle: candle,
      entryPrice: isLongBreakout ? candle.high : candle.low,
      stopLoss: isLongBreakout ? candle.low : candle.high,
      updateCount: 0,
      detectedAt: new Date()
    };

    return markingCandle;
  }

  /**
   * MARKING CANDLE UPDATE DETECTION
   * Evaluates if a new candle should replace the current marking candle
   * 
   * Update Criteria:
   * - New candle must extend stop-loss by at least 1 point (adverse direction)
   * - Maximum 3 updates allowed per breakout sequence
   * - Any direction candle can qualify (not restricted to opposite direction)
   * 
   * @param candle - The candle to evaluate for marking candle update
   * @returns Updated MarkingCandle object if qualified, null otherwise
   */
  private checkForMarkingCandleUpdate(candle: Candle): MarkingCandle | null {
    const currentMarking = this.strategyState.markingCandleState.currentMarkingCandle;
    const breakoutRef = this.strategyState.markingCandleState.breakoutReference;
    
    if (!currentMarking || !breakoutRef) return null;

    const isLongBreakout = breakoutRef.type === 'long_breakout';
    const currentSL = currentMarking.stopLoss;

    // Check if this candle extends SL by at least 1 point
    let newSL: number;
    let slExtended: boolean;

    if (isLongBreakout) {
      newSL = candle.low;
      slExtended = (currentSL - newSL) >= 1; // SL moved lower by at least 1 point
    } else {
      newSL = candle.high;
      slExtended = (newSL - currentSL) >= 1; // SL moved higher by at least 1 point
    }

    if (!slExtended) {
      return null; // SL not extended by at least 1 point
    }

    // Create updated marking candle
    const updatedMarkingCandle: MarkingCandle = {
      candle: candle,
      entryPrice: isLongBreakout ? candle.high : candle.low,
      stopLoss: newSL,
      updateCount: currentMarking.updateCount + 1,
      detectedAt: new Date()
    };

    return updatedMarkingCandle;
  }

  /**
   * TRADE SETUP ABANDONMENT
   * Safely abandons the current marking candle trade setup while preserving pivot validity
   * 
   * @param reason - Descriptive reason for trade abandonment (for logging)
   */
  private skipMarkingCandleTrade(reason: string): void {
    this.logger.info(`🚫 Skipping marking candle trade - Reason: ${reason}`);
    this.logger.info(`🚫 MARKING CANDLE TRACKING DEACTIVATED - isActive: false`);
    
    this.strategyState.markingCandleState.tradeSkipped = true;
    this.strategyState.markingCandleState.isActive = false;
    this.strategyState.markingCandleState.searchPhase = 'expired';

    // Transition back to WAITING_FOR_BREAKOUT state
    this.transitionToState(TradeState.WAITING_FOR_BREAKOUT, reason);

    // Pivot remains valid for future breakouts as long as it's still the latest
    this.logger.info(`📍 Pivot remains valid for future breakouts`);
  }

  /**
   * MARKING CANDLE LOGGING
   * Provides comprehensive logging of marking candle details for monitoring and debugging
   * 
   * @param markingCandle - The marking candle to log details for
   */
  private logMarkingCandleDetails(markingCandle: MarkingCandle): void {
    const breakoutType = this.strategyState.markingCandleState.breakoutReference?.type;
    
    this.logger.info(`   🕯️  Marking Candle: O:₹${markingCandle.candle.open.toFixed(2)} H:₹${markingCandle.candle.high.toFixed(2)} L:₹${markingCandle.candle.low.toFixed(2)} C:₹${markingCandle.candle.close.toFixed(2)}`);
    this.logger.info(`   🎯 Entry Price: ₹${markingCandle.entryPrice.toFixed(2)} | Stop Loss: ₹${markingCandle.stopLoss.toFixed(2)}`);
    this.logger.info(`   🔢 Update Count: ${markingCandle.updateCount} | Trade Type: ${breakoutType}`);
    this.logger.info(`   ⏰ Time: ${markingCandle.candle.timestamp.toLocaleString()}`);
  }

  // ================================================================================
  // PUBLIC API METHODS - External Access to Marking Candle State
  // ================================================================================

  // ================================================================================
  // PUBLIC API METHODS - External Access to Marking Candle State
  // ================================================================================

  /**
   * Get current marking candle state for dashboard
   * @returns Current marking candle state object
   */
  public getMarkingCandleState(): MarkingCandleState {
    return this.strategyState.markingCandleState;
  }

  /**
   * Get current trade state and setup information
   * @returns Trade state information for UI monitoring
   */
  public getTradeStateInfo(): {
    tradeState: TradeState;
    tradeSetupRequest?: TradeSetupRequest;
    currentTradeId?: string;
  } {
    const result: {
      tradeState: TradeState;
      tradeSetupRequest?: TradeSetupRequest;
      currentTradeId?: string;
    } = {
      tradeState: this.strategyState.tradeState
    };

    if (this.strategyState.tradeSetupRequest) {
      result.tradeSetupRequest = this.strategyState.tradeSetupRequest;
    }
    if (this.strategyState.currentTradeId) {
      result.currentTradeId = this.strategyState.currentTradeId;
    }

    return result;
  }

  /**
   * Get comprehensive marking candle information for monitoring
   * @returns Detailed marking candle debug information object
   */
  public getMarkingCandleDebugInfo(): any {
    const state = this.strategyState.markingCandleState;
    return {
      isActive: state.isActive,
      searchPhase: state.searchPhase,
      barsProcessedSinceBreakout: state.barsProcessedSinceBreakout,
      currentMarkingCandle: state.currentMarkingCandle ? {
        updateCount: state.currentMarkingCandle.updateCount,
        entryPrice: state.currentMarkingCandle.entryPrice,
        stopLoss: state.currentMarkingCandle.stopLoss,
        candleOHLC: {
          open: state.currentMarkingCandle.candle.open,
          high: state.currentMarkingCandle.candle.high,
          low: state.currentMarkingCandle.candle.low,
          close: state.currentMarkingCandle.candle.close
        },
        detectedAt: state.currentMarkingCandle.detectedAt
      } : null,
      breakoutReference: state.breakoutReference ? {
        type: state.breakoutReference.type,
        price: state.breakoutReference.price,
        timestamp: state.breakoutReference.timestamp
      } : null,
      timingInfo: {
        startTime: state.startTime,
        timeElapsed: state.startTime ? Math.floor((Date.now() - new Date(state.startTime).getTime()) / (1000 * 60)) : 0,
        timeLimit: 18,
        maxUpdatesReached: state.maxUpdatesReached,
        timeExpired: state.timeExpired,
        tradeSkipped: state.tradeSkipped
      }
    };
  }

  // ================================================================================
  // MANUAL TESTING AND SIMULATION METHODS
  // ================================================================================

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

  /**
   * COMPREHENSIVE MANUAL TESTING METHODS
   * These methods test each component independently
   */

  /**
   * Test 1: Volume SMA50 Calculation Logic
   */
  public testVolumeSMA50Calculation(): void {
    this.logger.info('🧪 TESTING Volume SMA50 Calculation...');
    
    // Clear existing data
    this.strategyState.oneMinuteCandles = [];
    this.strategyState.currentVolumeSMA50 = 0;
    
    // Simulate 60 candles with known volumes
    const testVolumes = [
      // First 50 candles with volume 1000 each
      ...Array(50).fill(1000),
      // Next 10 candles with volume 2000 each
      ...Array(10).fill(2000)
    ];
    
    this.logger.info(`📊 Creating ${testVolumes.length} test candles...`);
    
    for (let i = 0; i < testVolumes.length; i++) {
      const testCandle: Candle = {
        timestamp: new Date(2025, 8, 24, 9, 15 + i), // 9:15 AM + i minutes
        open: 25000,
        high: 25010,
        low: 24990,
        close: 25005,
        volume: testVolumes[i]
      };
      
      this.strategyState.oneMinuteCandles.push(testCandle);
      this.updateVolumeSMA50();
      
      if (i === 49) {
        // After 50 candles, SMA50 should be 1000
        const expectedSMA = 1000;
        const actualSMA = this.strategyState.currentVolumeSMA50;
        this.logger.info(`✅ After 50 candles: Expected SMA50=${expectedSMA}, Actual=${actualSMA.toFixed(2)}`);
        
        if (Math.abs(actualSMA - expectedSMA) < 0.01) {
          this.logger.info('✅ Volume SMA50 calculation CORRECT for 50 candles');
        } else {
          this.logger.error(`❌ Volume SMA50 calculation INCORRECT! Expected ${expectedSMA}, got ${actualSMA}`);
        }
      }
      
      if (i === 59) {
        // After 60 candles (last 50 should be: 40×1000 + 10×2000)
        const expectedSMA = (40 * 1000 + 10 * 2000) / 50; // = 1400
        const actualSMA = this.strategyState.currentVolumeSMA50;
        this.logger.info(`✅ After 60 candles: Expected SMA50=${expectedSMA}, Actual=${actualSMA.toFixed(2)}`);
        
        if (Math.abs(actualSMA - expectedSMA) < 0.01) {
          this.logger.info('✅ Volume SMA50 rolling calculation CORRECT');
        } else {
          this.logger.error(`❌ Volume SMA50 rolling calculation INCORRECT! Expected ${expectedSMA}, got ${actualSMA}`);
        }
      }
    }
  }

  /**
   * Test 2: Breakout Detection Logic
   */
  public testBreakoutDetectionLogic(): void {
    this.logger.info('🧪 TESTING Breakout Detection Logic...');
    
    // Setup test pivots
    this.strategyState.latestPivotHigh = {
      price: 25100,
      timestamp: new Date(2025, 8, 24, 10, 0),
      type: 'high'
    };
    
    this.strategyState.latestPivotLow = {
      price: 24900,
      timestamp: new Date(2025, 8, 24, 10, 0),
      type: 'low'
    };
    
    // Setup volume SMA50 = 1500 for testing
    this.strategyState.currentVolumeSMA50 = 1500;
    
    // Ensure we have 50+ candles for volume requirement
    this.strategyState.oneMinuteCandles = Array(50).fill(0).map((_, i) => ({
      timestamp: new Date(2025, 8, 24, 9, 15 + i),
      open: 25000,
      high: 25010,
      low: 24990,
      close: 25005,
      volume: 1500
    }));
    
    this.logger.info(`📊 Test Setup: Pivot HIGH=₹${this.strategyState.latestPivotHigh.price}, Pivot LOW=₹${this.strategyState.latestPivotLow.price}, Volume SMA50=${this.strategyState.currentVolumeSMA50}`);
    
    // Test Case 1: Valid LONG breakout
    this.logger.info('🔍 TEST CASE 1: Valid LONG breakout');
    const longBreakoutCandle: Candle = {
      timestamp: new Date(2025, 8, 24, 11, 30),
      open: 25095, // Below pivot high
      high: 25120,
      low: 25090,
      close: 25110, // Above pivot high
      volume: 2000 // Above SMA50
    };
    
    this.logger.info(`   Candle: O=${longBreakoutCandle.open} C=${longBreakoutCandle.close} V=${longBreakoutCandle.volume}`);
    this.logger.info(`   Logic: close(${longBreakoutCandle.close}) > pivotHigh(${this.strategyState.latestPivotHigh.price}) = ${longBreakoutCandle.close > this.strategyState.latestPivotHigh.price}`);
    this.logger.info(`   Logic: open(${longBreakoutCandle.open}) < pivotHigh(${this.strategyState.latestPivotHigh.price}) = ${longBreakoutCandle.open < this.strategyState.latestPivotHigh.price}`);
    this.logger.info(`   Logic: volume(${longBreakoutCandle.volume}) > SMA50(${this.strategyState.currentVolumeSMA50}) = ${longBreakoutCandle.volume > this.strategyState.currentVolumeSMA50}`);
    
    this.checkForBreakout(longBreakoutCandle);
    
    if (this.strategyState.latestBreakoutSignal && this.strategyState.latestBreakoutSignal.type === 'long_breakout') {
      this.logger.info('✅ LONG breakout detection WORKING CORRECTLY');
    } else {
      this.logger.error('❌ LONG breakout detection FAILED');
    }
    
    // Test Case 2: Valid SHORT breakout  
    this.logger.info('🔍 TEST CASE 2: Valid SHORT breakout');
    const shortBreakoutCandle: Candle = {
      timestamp: new Date(2025, 8, 24, 11, 35),
      open: 24905, // Above pivot low
      high: 24910,
      low: 24880,
      close: 24885, // Below pivot low
      volume: 1800 // Above SMA50
    };
    
    this.logger.info(`   Candle: O=${shortBreakoutCandle.open} C=${shortBreakoutCandle.close} V=${shortBreakoutCandle.volume}`);
    this.logger.info(`   Logic: close(${shortBreakoutCandle.close}) < pivotLow(${this.strategyState.latestPivotLow.price}) = ${shortBreakoutCandle.close < this.strategyState.latestPivotLow.price}`);
    this.logger.info(`   Logic: open(${shortBreakoutCandle.open}) > pivotLow(${this.strategyState.latestPivotLow.price}) = ${shortBreakoutCandle.open > this.strategyState.latestPivotLow.price}`);
    this.logger.info(`   Logic: volume(${shortBreakoutCandle.volume}) > SMA50(${this.strategyState.currentVolumeSMA50}) = ${shortBreakoutCandle.volume > this.strategyState.currentVolumeSMA50}`);
    
    this.checkForBreakout(shortBreakoutCandle);
    
    if (this.strategyState.latestBreakoutSignal && this.strategyState.latestBreakoutSignal.type === 'short_breakout') {
      this.logger.info('✅ SHORT breakout detection WORKING CORRECTLY');
    } else {
      this.logger.error('❌ SHORT breakout detection FAILED');
    }
    
    // Test Case 3: Invalid breakout (gap up - open > pivot)
    this.logger.info('🔍 TEST CASE 3: Invalid LONG breakout (gap up)');
    const gapUpCandle: Candle = {
      timestamp: new Date(2025, 8, 24, 11, 40),
      open: 25105, // Above pivot high (should be gap)
      high: 25120,
      low: 25100,
      close: 25115, // Above pivot high
      volume: 2500 // Above SMA50
    };
    
    this.logger.info(`   Candle: O=${gapUpCandle.open} C=${gapUpCandle.close} V=${gapUpCandle.volume}`);
    this.logger.info(`   Logic: Should REJECT because open(${gapUpCandle.open}) > pivotHigh(${this.strategyState.latestPivotHigh.price})`);
    
    const previousSignal = this.strategyState.latestBreakoutSignal;
    this.checkForBreakout(gapUpCandle);
    
    if (this.strategyState.latestBreakoutSignal === previousSignal) {
      this.logger.info('✅ Gap-up rejection WORKING CORRECTLY (no new signal generated)');
    } else {
      this.logger.error('❌ Gap-up rejection FAILED (new signal was generated)');
    }
    
    // Test Case 4: Invalid breakout (insufficient volume)
    this.logger.info('🔍 TEST CASE 4: Invalid breakout (low volume)');
    const lowVolumeCandle: Candle = {
      timestamp: new Date(2025, 8, 24, 11, 45),
      open: 25095, // Below pivot high
      high: 25120,
      low: 25090,
      close: 25110, // Above pivot high
      volume: 1000 // Below SMA50 (1500)
    };
    
    this.logger.info(`   Candle: O=${lowVolumeCandle.open} C=${lowVolumeCandle.close} V=${lowVolumeCandle.volume}`);
    this.logger.info(`   Logic: Should REJECT because volume(${lowVolumeCandle.volume}) < SMA50(${this.strategyState.currentVolumeSMA50})`);
    
    const previousSignal2 = this.strategyState.latestBreakoutSignal;
    this.checkForBreakout(lowVolumeCandle);
    
    if (this.strategyState.latestBreakoutSignal === previousSignal2) {
      this.logger.info('✅ Low volume rejection WORKING CORRECTLY');
    } else {
      this.logger.error('❌ Low volume rejection FAILED');
    }
  }

  /**
   * Test 3: 1-Minute Candle Building Logic
   */
  public testCandleBuildingLogic(): void {
    this.logger.info('🧪 TESTING 1-Minute Candle Building Logic...');
    
    // Clear existing candle data
    this.currentOneMinuteCandle = null;
    this.strategyState.oneMinuteCandles = [];
    
    // Simulate ticks for the same minute
    const baseTime = new Date(2025, 8, 24, 10, 30, 0); // 10:30:00 AM
    
    const testTicks = [
      { time: new Date(baseTime.getTime() + 0 * 1000), price: 25000, volume: 1000 },    // 10:30:00
      { time: new Date(baseTime.getTime() + 15 * 1000), price: 25005, volume: 1500 },   // 10:30:15  
      { time: new Date(baseTime.getTime() + 30 * 1000), price: 24995, volume: 1800 },   // 10:30:30
      { time: new Date(baseTime.getTime() + 45 * 1000), price: 25010, volume: 2000 },   // 10:30:45
      // Next minute starts here
      { time: new Date(baseTime.getTime() + 60 * 1000), price: 25008, volume: 2200 },   // 10:31:00
    ];
    
    this.logger.info('📊 Processing test ticks...');
    
    for (let i = 0; i < testTicks.length; i++) {
      const tick = testTicks[i];
      if (!tick) continue; // Type safety check
      
      const mockTickData: TickData = {
        instrument_token: 123456,
        last_price: tick.price,
        volume: tick.volume,
        buy_quantity: 0,
        sell_quantity: 0,
        ohlc: { open: 25000, high: 25020, low: 24980, close: tick.price },
        change: 0,
        last_trade_time: tick.time,
        exchange_timestamp: tick.time,
        timestamp: tick.time
      };
      
      this.logger.info(`   Tick ${i + 1}: ${tick.time.toLocaleTimeString()} - Price: ₹${tick.price}, Volume: ${tick.volume}`);
      
      const candleCountBefore = this.strategyState.oneMinuteCandles.length;
      this.processTickForOneMinuteCandle(mockTickData);
      const candleCountAfter = this.strategyState.oneMinuteCandles.length;
      
      if (i === 4) {
        // After the 5th tick (new minute), a candle should be completed
        if (candleCountAfter > candleCountBefore) {
          const completedCandle = this.strategyState.oneMinuteCandles[candleCountAfter - 1];
          if (completedCandle) {
            this.logger.info(`✅ Candle completed: O=${completedCandle.open} H=${completedCandle.high} L=${completedCandle.low} C=${completedCandle.close} V=${completedCandle.volume}`);
            
            // Verify OHLC logic
            if (completedCandle.open === 25000 && 
                completedCandle.high === 25010 && 
                completedCandle.low === 24995 && 
                completedCandle.close === 25010) {
              this.logger.info('✅ OHLC calculation CORRECT');
            } else {
              this.logger.error('❌ OHLC calculation INCORRECT');
            }
          }
        } else {
          this.logger.error('❌ Candle completion FAILED');
        }
      }
    }
  }

  /**
   * Run all manual tests
   */
  public runAllManualTests(): void {
    this.logger.info('🚀 STARTING COMPREHENSIVE MANUAL TESTING...');
    this.logger.info('================================================');
    
    try {
      this.testVolumeSMA50Calculation();
      this.logger.info('================================================');
      
      this.testBreakoutDetectionLogic();
      this.logger.info('================================================');
      
      this.testCandleBuildingLogic();
      this.logger.info('================================================');
      
      this.logger.info('✅ ALL MANUAL TESTS COMPLETED');
      
      // Clear test data after testing
      this.clearTestData();
      
    } catch (error) {
      this.logger.error('❌ MANUAL TESTING FAILED:', error);
    }
  }

  /**
   * Clear test data and reset strategy state
   */
  public clearTestData(): void {
    this.logger.info('🧹 Clearing test data and resetting strategy state...');
    
    // Clear test breakout signals
    this.strategyState.latestBreakoutSignal = undefined;
    
    // Clear test pivot data (reset to undefined so real pivots can be detected)
    this.strategyState.latestPivotHigh = undefined;
    this.strategyState.latestPivotLow = undefined;
    
    // Clear test candle data (only affects 1m candles, keeps them optimized to max 50)
    this.strategyState.oneMinuteCandles = [];
    this.currentOneMinuteCandle = null;
    this.strategyState.currentVolumeSMA50 = 0;
    
    // Reset processed time tracking
    this.strategyState.lastProcessedOneMinuteCandleTime = undefined;
    
    this.logger.info('✅ Test data cleared, strategy ready for real market data (1m candles optimized to max 50)');
  }

  // ===========================
  // TRADE EXECUTION SERVICE ACCESS
  // ===========================

  /**
   * Get current capital from TradeExecutionService
   */
  public getCurrentCapital(): number {
    return this.tradeExecutionService.getCurrentCapital();
  }

  /**
   * Get active position from TradeExecutionService
   */
  public getActivePosition(): any {
    return this.tradeExecutionService.getActivePosition();
  }

  /**
   * Get trade history from TradeExecutionService
   */
  public getTradeHistory(): any[] {
    return this.tradeExecutionService.getTradeHistory();
  }

  /**
   * Get trading configuration from TradeExecutionService
   */
  public getTradingConfig(): any {
    return this.tradeExecutionService.getTradingConfig();
  }

  /**
   * Get execution service status
   */
  public getExecutionStatus(): any {
    return this.tradeExecutionService.getExecutionStatus();
  }

  /**
   * Update trading configuration
   */
  public updateTradingConfig(updates: any): void {
    this.tradeExecutionService.updateTradingConfig(updates);
  }

  /**
   * Initialize instruments (call this after authentication)
   */
  public async initializeInstruments(): Promise<void> {
    await this.tradeExecutionService.loadInstruments();
  }
}