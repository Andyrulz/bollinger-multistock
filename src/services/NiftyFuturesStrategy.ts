import { KiteConnect } from 'kiteconnect';
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

      this.logger.info('Initializing WebSocket connection for price streaming');
      
      // Initialize KiteTicker
      this.ticker = new KiteTicker({
        api_key: apiKey,
        access_token: accessToken
      });

      // Set up event handlers
      this.setupTickerEvents();

      // Connect to WebSocket
      this.ticker.connect();
      
      this.isStreaming = true;
      this.logger.info('WebSocket connection initiated');

    } catch (error) {
      this.logger.error('Error starting price streaming:', error);
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
    if (!this.ticker || !this.currentMonthFutures) return;

    this.ticker.on('connect', () => {
      this.logger.info('WebSocket connected successfully');
      
      // Subscribe to current month Nifty futures with 'quote' mode for OHLC data
      const token = this.currentMonthFutures!.instrument_token;
      this.ticker!.subscribe([token]);
      this.ticker!.setMode(this.ticker!.modeFull, [token]); // Full mode for complete data
      
      this.logger.info(`Subscribed to ${this.currentMonthFutures!.tradingsymbol} (Token: ${token})`);
    });

    this.ticker.on('ticks', (ticks: any[]) => {
      ticks.forEach(tick => {
        if (tick.instrument_token === this.currentMonthFutures!.instrument_token) {
          const tickData: TickData = {
            instrument_token: tick.instrument_token,
            last_price: tick.last_price,
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

          // Log price update (you might want to reduce this frequency in production)
          this.logger.debug(`${this.currentMonthFutures!.tradingsymbol} - LTP: ₹${tickData.last_price.toFixed(2)}, Volume: ${tickData.volume}`);

          // Call all registered callbacks
          this.tickCallbacks.forEach(callback => {
            try {
              callback(tickData);
            } catch (error) {
              this.logger.error('Error in tick callback:', error);
            }
          });
        }
      });
    });

    this.ticker.on('disconnect', (error: any) => {
      this.logger.warn('WebSocket disconnected:', error);
      this.isStreaming = false;
    });

    this.ticker.on('error', (error: any) => {
      this.logger.error('WebSocket error:', error);
    });

    this.ticker.on('close', (reason: string) => {
      this.logger.info(`WebSocket closed: ${reason}`);
      this.isStreaming = false;
    });

    this.ticker.on('reconnecting', (reconnect_count: number, reconnect_interval: number) => {
      this.logger.info(`WebSocket reconnecting: attempt ${reconnect_count}, interval ${reconnect_interval}s`);
    });

    this.ticker.on('noreconnect', () => {
      this.logger.error('WebSocket reconnection failed. Manual intervention required.');
      this.isStreaming = false;
    });

    // Enable auto-reconnection
    this.ticker.autoReconnect(true, 10, 5);
  }

  /**
   * Get latest market data (without streaming)
   */
  public async getCurrentPrice(): Promise<any> {
    try {
      if (!this.currentMonthFutures) {
        await this.findCurrentMonthNiftyFutures();
      }

      if (!this.currentMonthFutures) {
        throw new Error('Current month futures not available');
      }

      const quote = await this.kiteConnect.getQuote(this.currentMonthFutures.tradingsymbol);
      return quote[this.currentMonthFutures.tradingsymbol];
    } catch (error) {
      this.logger.error('Error getting current price:', error);
      throw error;
    }
  }
}