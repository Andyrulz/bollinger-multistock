import { KiteConnect } from 'kiteconnect';
// Import KiteTicker using require for now due to module structure
const { KiteTicker } = require('kiteconnect');
import { Logger } from '../utils/Logger';

export interface NiftyFuturesData {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  tick_size: number;
  lot_size: number;
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
  timestamp: Date;
}

export class NiftyFuturesStrategy {
  private kiteConnect: any;
  private ticker?: any;
  private logger: Logger;
  private currentMonthFutures?: NiftyFuturesData;
  private isStreaming: boolean = false;
  private tickCallbacks: Array<(tick: TickData) => void> = [];

  constructor(kiteConnect: any, logger: Logger) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
  }

  /**
   * Find the current month Nifty futures contract
   */
  public async findCurrentMonthNiftyFutures(): Promise<NiftyFuturesData | null> {
    try {
      this.logger.info('Fetching all NFO instruments to find current month Nifty futures');
      
      // Get all NFO (derivatives) instruments
      const instruments = await this.kiteConnect.getInstruments('NFO');
      
      // Filter for Nifty futures
      const niftyFutures = instruments.filter((instrument: any) => 
        instrument.name === 'NIFTY' && 
        instrument.instrument_type === 'FUT'
      );

      if (niftyFutures.length === 0) {
        this.logger.error('No Nifty futures found');
        return null;
      }

      // Find the current month contract (nearest expiry)
      const currentDate = new Date();
      const validFutures = niftyFutures
        .filter((instrument: any) => new Date(instrument.expiry) > currentDate)
        .sort((a: any, b: any) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());

      if (validFutures.length === 0) {
        this.logger.error('No valid future contracts found');
        return null;
      }

      const currentMonthContract = validFutures[0];
      
      this.currentMonthFutures = {
        instrument_token: currentMonthContract.instrument_token,
        tradingsymbol: currentMonthContract.tradingsymbol,
        name: currentMonthContract.name,
        expiry: currentMonthContract.expiry,
        strike: currentMonthContract.strike,
        tick_size: currentMonthContract.tick_size,
        lot_size: currentMonthContract.lot_size
      };

      this.logger.info(`Found current month Nifty futures: ${this.currentMonthFutures.tradingsymbol} (Token: ${this.currentMonthFutures.instrument_token}, Expiry: ${this.currentMonthFutures.expiry})`);
      
      return this.currentMonthFutures;
    } catch (error) {
      this.logger.error('Error finding current month Nifty futures:', error);
      throw error;
    }
  }

  /**
   * Start streaming price data for current month Nifty futures
   */
  public async startPriceStreaming(): Promise<void> {
    try {
      if (!this.currentMonthFutures) {
        await this.findCurrentMonthNiftyFutures();
        if (!this.currentMonthFutures) {
          throw new Error('Unable to find current month Nifty futures');
        }
      }

      if (this.isStreaming) {
        this.logger.warn('Price streaming already active');
        return;
      }

      const accessToken = this.kiteConnect.access_token;
      const apiKey = this.kiteConnect.api_key;

      if (!accessToken) {
        throw new Error('Access token not available. Please authenticate first.');
      }

      this.logger.info(`🚀 Initializing WebSocket connection for price streaming`);
      this.logger.info(`📡 API Key: ${apiKey}, Token Available: ${!!accessToken}`);
      
      // Initialize KiteTicker with proper configuration
      this.ticker = new KiteTicker({
        api_key: apiKey,
        access_token: accessToken,
        reconnect: true,        // Enable auto-reconnection
        max_retry: 10,          // Max retry attempts  
        max_delay: 60000        // Max delay between retries (60 seconds)
      });

      // Set up event handlers BEFORE connecting
      this.setupTickerEvents();

      // Connect to WebSocket
      this.logger.info('🔌 Connecting to WebSocket...');
      this.ticker.connect();
      
      this.isStreaming = true;
      this.logger.info('✅ WebSocket connection initiated');

    } catch (error) {
      this.logger.error('❌ Error starting price streaming:', error);
      this.isStreaming = false;
      throw error;
    }
  }

  /**
   * Stop price streaming
   */
  public async stopPriceStreaming(): Promise<void> {
    try {
      if (this.ticker && this.isStreaming) {
        this.logger.info('Stopping price streaming');
        this.ticker.disconnect();
        this.ticker = undefined;
        this.isStreaming = false;
        this.logger.info('Price streaming stopped');
      }
    } catch (error) {
      this.logger.error('Error stopping price streaming:', error);
    }
  }

  /**
   * Subscribe to price updates callback
   */
  public onPriceUpdate(callback: (tick: TickData) => void): void {
    this.tickCallbacks.push(callback);
  }

  /**
   * Get current Nifty futures contract info
   */
  public getCurrentContract(): NiftyFuturesData | undefined {
    return this.currentMonthFutures;
  }

  /**
   * Get current streaming status
   */
  public isStreamingActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupTickerEvents(): void {
    if (!this.ticker || !this.currentMonthFutures) {
      this.logger.error('❌ Cannot setup ticker events - ticker or contract missing');
      return;
    }

    const token = this.currentMonthFutures.instrument_token;
    this.logger.info(`📡 Setting up events for token: ${token} (${this.currentMonthFutures.tradingsymbol})`);

    // Connection established
    this.ticker.on('connect', () => {
      this.logger.info('🔗 WebSocket connected successfully');
      
      try {
        // Subscribe to the instrument token
        this.logger.info(`📡 Subscribing to token: ${token}`);
        this.ticker!.subscribe([token]);
        
        // Set to full mode for complete market data including OHLC
        this.ticker!.setMode(this.ticker!.modeFull, [token]);
        
        this.logger.info(`✅ Subscribed to ${this.currentMonthFutures!.tradingsymbol} (Token: ${token}) in FULL mode`);
        
        // Add health check after connection
        setTimeout(() => {
          this.logger.info(`💊 Health Check: Callbacks registered: ${this.tickCallbacks.length}, Streaming: ${this.isStreaming}`);
        }, 5000);
        
      } catch (error) {
        this.logger.error('❌ Error during subscription:', error);
      }
    });

    // Market data received (binary messages)
    this.ticker.on('ticks', (ticks: any[]) => {
      if (!ticks || ticks.length === 0) {
        this.logger.debug('📭 Received empty ticks array');
        return;
      }
      
      this.logger.info(`📊 RECEIVED ${ticks.length} TICK(S) from WebSocket`);
      
      ticks.forEach((tick, index) => {
        this.logger.debug(`📈 Raw Tick ${index + 1}:`, {
          token: tick.instrument_token,
          ltp: tick.last_price,
          volume: tick.volume,
          ohlc: tick.ohlc,
          timestamp: tick.exchange_timestamp || tick.timestamp
        });
        
        // Filter for our specific instrument
        if (tick.instrument_token === this.currentMonthFutures!.instrument_token) {
          const tickData: TickData = {
            instrument_token: tick.instrument_token,
            last_price: tick.last_price || 0,
            volume: tick.volume || 0,
            buy_quantity: tick.buy_quantity || 0,
            sell_quantity: tick.sell_quantity || 0,
            ohlc: {
              open: tick.ohlc?.open || 0,
              high: tick.ohlc?.high || 0,
              low: tick.ohlc?.low || 0,
              close: tick.ohlc?.close || 0
            },
            change: tick.change || 0,
            timestamp: new Date()
          };

          // Enhanced logging for actual market data
          this.logger.info(`💹 MARKET DATA: ${this.currentMonthFutures!.tradingsymbol} | LTP: ₹${tickData.last_price.toFixed(2)} | Vol: ${tickData.volume} | OHLC: O:${tickData.ohlc.open} H:${tickData.ohlc.high} L:${tickData.ohlc.low} C:${tickData.ohlc.close}`);

          // Execute all registered callbacks
          this.logger.debug(`📞 Executing ${this.tickCallbacks.length} callback(s)`);
          this.tickCallbacks.forEach((callback, callbackIndex) => {
            try {
              callback(tickData);
              this.logger.debug(`✅ Callback ${callbackIndex + 1} executed successfully`);
            } catch (error) {
              this.logger.error(`❌ Error in callback ${callbackIndex + 1}:`, error);
            }
          });
        } else {
          this.logger.warn(`⚠️  Received tick for different instrument: ${tick.instrument_token} (expected: ${this.currentMonthFutures!.instrument_token})`);
        }
      });
    });

    // Handle text messages (non-market data like errors, order updates)
    this.ticker.on('message', (data: any) => {
      try {
        if (typeof data === 'string') {
          const message = JSON.parse(data);
          this.logger.info('📨 WebSocket text message:', message);
          
          if (message.type === 'error') {
            this.logger.error('🚨 WebSocket error message:', message.data);
          } else if (message.type === 'message') {
            this.logger.info('📢 WebSocket notification:', message.data);
          }
        } else {
          this.logger.debug('📦 WebSocket binary message received (market data)');
        }
      } catch (error) {
        this.logger.debug('📦 Non-JSON WebSocket message received');
      }
    });

    // Connection lost
    this.ticker.on('disconnect', (error: any) => {
      this.logger.warn('🔌 WebSocket disconnected:', error);
      this.isStreaming = false;
    });

    // WebSocket errors
    this.ticker.on('error', (error: any) => {
      this.logger.error('❌ WebSocket error:', error);
      // Don't set streaming to false on error, let reconnection handle it
    });

    // Connection closed
    this.ticker.on('close', (reason: string) => {
      this.logger.info(`🚪 WebSocket closed: ${reason}`);
      this.isStreaming = false;
    });

    // Reconnection attempts
    this.ticker.on('reconnecting', (reconnect_count: number, reconnect_interval: number) => {
      this.logger.info(`🔄 WebSocket reconnecting: attempt ${reconnect_count}, interval ${reconnect_interval}s`);
    });

    // Reconnection failed
    this.ticker.on('noreconnect', () => {
      this.logger.error('💀 WebSocket reconnection failed. Manual intervention required.');
      this.isStreaming = false;
    });

    // Order updates (if any)
    this.ticker.on('order_update', (order: any) => {
      this.logger.info('� Order update received:', order);
    });

    this.logger.info('� WebSocket event handlers configured successfully');
  }

  /**
   * Get latest market data (without streaming)
   */
  public async getCurrentPrice(): Promise<any> {
    try {
      if (!this.currentMonthFutures) {
        this.logger.info('No current contract, fetching...');
        await this.findCurrentMonthNiftyFutures();
      }

      if (!this.currentMonthFutures) {
        throw new Error('Current month futures not available');
      }

      this.logger.info(`📊 Fetching REST API quote for: ${this.currentMonthFutures.tradingsymbol}`);
      
      const quote = await this.kiteConnect.getQuote(this.currentMonthFutures.tradingsymbol);
      
      this.logger.info(`✅ REST API quote received:`, quote);
      
      return quote[this.currentMonthFutures.tradingsymbol];
    } catch (error) {
      this.logger.error('❌ Error getting current price via REST API:', error);
      throw error;
    }
  }

  /**
   * Test method to simulate a tick (for debugging)
   */
  public simulateTestTick(): void {
    if (!this.currentMonthFutures) {
      this.logger.warn('Cannot simulate tick - no current contract');
      return;
    }

    const testTick: TickData = {
      instrument_token: this.currentMonthFutures.instrument_token,
      last_price: 25250.50,
      volume: 12345,
      buy_quantity: 1000,
      sell_quantity: 800,
      ohlc: {
        open: 25200.00,
        high: 25300.00,
        low: 25150.00,
        close: 25250.50
      },
      change: 50.50,
      timestamp: new Date()
    };

    this.logger.info(`🧪 SIMULATING TEST TICK: LTP: ₹${testTick.last_price}, Volume: ${testTick.volume}`);
    
    // Call all registered callbacks with test data
    this.tickCallbacks.forEach((callback, index) => {
      try {
        callback(testTick);
        this.logger.info(`✅ Test tick callback ${index + 1} executed successfully`);
      } catch (error) {
        this.logger.error(`❌ Error in test tick callback ${index + 1}:`, error);
      }
    });
  }

  /**
   * Get callback count for debugging
   */
  public getCallbackCount(): number {
    return this.tickCallbacks.length;
  }
}