import { Logger } from "../utils/Logger";

/**
 * QuoteManager - Centralized Quote Polling Service
 *
 * Problem: Multiple strategies polling independently = rate limit risk
 * Solution: Publisher-Subscriber pattern with single API call
 *
 * Benefits:
 * - Constant 1 API call/sec regardless of strategy count
 * - Auto-start when first subscriber registers
 * - Auto-stop when last subscriber unregisters
 * - Centralized error handling and retry logic
 */

type QuoteCallback = (quote: any) => void;

export class QuoteManager {
  private subscribers: Map<string, Set<QuoteCallback>> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  private consecutiveErrors: number = 0;
  private lastSuccessfulFetch: number = Date.now(); // ⚠️ OPTIMIZATION: Staleness detection

  constructor(
    private kiteConnect: any,
    private logger: Logger,
  ) {}

  /**
   * Subscribe to real-time quote updates
   * @param symbol - Trading symbol (e.g., "RELIANCE26FEB2500CE")
   * @param callback - Called with quote on each update
   */
  subscribe(symbol: string, callback: QuoteCallback): void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }

    this.subscribers.get(symbol)!.add(callback);

    this.logger.debug(
      `📊 QuoteManager: Subscribed to ${symbol} (Total symbols: ${this.subscribers.size})`,
    );

    // Auto-start polling when first subscriber registers
    if (!this.isPolling) {
      this.startPolling();
    }
  }

  /**
   * Unsubscribe from quote updates
   */
  unsubscribe(symbol: string, callback: QuoteCallback): void {
    const callbacks = this.subscribers.get(symbol);
    if (callbacks) {
      callbacks.delete(callback);

      // Remove symbol if no more subscribers
      if (callbacks.size === 0) {
        this.subscribers.delete(symbol);
        this.logger.debug(
          `📉 QuoteManager: Unsubscribed from ${symbol} (Remaining: ${this.subscribers.size})`,
        );
      }
    }

    // Auto-stop polling when all subscribers are gone
    if (this.subscribers.size === 0 && this.isPolling) {
      this.stopPolling();
    }
  }

  /**
   * Start polling loop
   */
  private startPolling(): void {
    if (this.isPolling) return;

    this.logger.info("🔄 QuoteManager: Starting polling loop");
    this.isPolling = true;
    this.consecutiveErrors = 0;

    this.pollingInterval = setInterval(async () => {
      await this.fetchAndPublish();
    }, 1000); // 1 second
  }

  /**
   * Stop polling loop
   */
  private stopPolling(): void {
    if (!this.isPolling) return;

    this.logger.info("⏸️ QuoteManager: Stopping polling loop (0 subscribers)");

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isPolling = false;
  }

  /**
   * Fetch quotes for all subscribed symbols and publish to callbacks
   */
  private async fetchAndPublish(): Promise<void> {
    const symbols = Array.from(this.subscribers.keys());

    if (symbols.length === 0) return;

    try {
      // SINGLE API CALL for all symbols
      const quotes = await this.kiteConnect.getQuote(symbols);

      // 🔍 QC CHECK: Log raw API response structure (first 3 polls only)
      if (this.consecutiveErrors === 0 && this.subscribers.size > 0) {
        const pollCount = Math.floor((Date.now() - this.lastSuccessfulFetch) / 1000);
        if (pollCount <= 3 && symbols.length > 0) {
          const firstSymbol = symbols[0]!;
          const firstQuote = quotes[firstSymbol];
          this.logger.info(`📊 [QC] QuoteManager fetched ${symbols.length} symbols:`, {
            symbols,
            responseKeys: Object.keys(quotes),
            sampleQuote: firstQuote ? {
              symbol: firstSymbol,
              last_price: firstQuote.last_price,
              ohlc: firstQuote.ohlc,
              volume: firstQuote.volume,
              timestamp: firstQuote.timestamp || firstQuote.last_trade_time,
            } : 'NO_DATA'
          });
        }
      }

      // Publish updates to subscribers
      let successCount = 0;
      let missingCount = 0;
      
      for (const [symbol, callbacks] of this.subscribers.entries()) {
        const quote = quotes[symbol];

        if (quote) {
          // 🔍 QC CHECK: Validate quote data has required fields
          const isValid = this.validateQuoteData(symbol, quote);
          
          if (isValid) {
            successCount++;
            callbacks.forEach((cb) => {
              try {
                cb(quote);
              } catch (error) {
                this.logger.error(
                  `Error in quote callback for ${symbol}:`,
                  error,
                );
              }
            });
          } else {
            missingCount++;
            this.logger.warn(`⚠️ [QC] Invalid quote data for ${symbol} - skipping callbacks`);
          }
        } else {
          missingCount++;
          this.logger.warn(`No quote data received for ${symbol}`);
        }
      }
      
      // 🔍 QC CHECK: Summary log every 30 seconds
      const now = Date.now();
      if (now - this.lastSuccessfulFetch > 30000 || successCount > 0) {
        this.logger.debug(`📋 [QC] Quote delivery: ${successCount}/${symbols.length} successful, ${missingCount} missing/invalid`);
      }

      // Reset error count on success
      this.consecutiveErrors = 0;
      this.lastSuccessfulFetch = Date.now(); // ⚠️ Update staleness timestamp
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.error(
        `QuoteManager polling error (${this.consecutiveErrors} consecutive):`,
        error,
      );

      // Circuit breaker
      if (this.consecutiveErrors >= 10) {
        this.logger.error(
          "🚨 QuoteManager: 10 consecutive errors, stopping polling",
        );
        this.stopPolling();
      }
    }
  }

  /**
   * 🔍 QC CHECK: Validate quote data structure and required fields
   */
  private validateQuoteData(symbol: string, quote: any): boolean {
    // Check if quote object exists
    if (!quote || typeof quote !== 'object') {
      this.logger.error(`[QC] ${symbol}: Quote is not an object`, { quote });
      return false;
    }
    
    // Check for last_price (critical for trading decisions)
    if (typeof quote.last_price !== 'number' || quote.last_price <= 0) {
      this.logger.error(`[QC] ${symbol}: Invalid last_price`, { 
        last_price: quote.last_price,
        type: typeof quote.last_price 
      });
      return false;
    }
    
    // Check for OHLC data (used for candle analysis)
    if (!quote.ohlc || typeof quote.ohlc !== 'object') {
      this.logger.warn(`[QC] ${symbol}: Missing OHLC data`, { ohlc: quote.ohlc });
      // Don't fail validation - last_price is sufficient for exit logic
    }
    
    // Check timestamp/last_trade_time exists
    if (!quote.timestamp && !quote.last_trade_time) {
      this.logger.warn(`[QC] ${symbol}: Missing timestamp data`);
      // Don't fail - we can proceed without timestamp
    }
    
    return true;
  }

  /**
   * Get current statistics
   */
  getStats(): {
    isPolling: boolean;
    subscriberCount: number;
    symbols: string[];
    consecutiveErrors: number;
    dataStale: boolean; // ⚠️ OPTIMIZATION: Staleness indicator
    lastFetchAge: number; // Milliseconds since last successful fetch
  } {
    const now = Date.now();
    const lastFetchAge = now - this.lastSuccessfulFetch;
    const dataStale = lastFetchAge > 5000; // Stale if > 5 seconds

    if (dataStale && this.isPolling) {
      this.logger.warn(
        `⚠️ QuoteManager: Data feed stale (${(lastFetchAge / 1000).toFixed(1)}s since last update)`,
      );
    }

    return {
      isPolling: this.isPolling,
      subscriberCount: this.subscribers.size,
      symbols: Array.from(this.subscribers.keys()),
      consecutiveErrors: this.consecutiveErrors,
      dataStale,
      lastFetchAge,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info("QuoteManager: Shutting down...");
    this.stopPolling();
    this.subscribers.clear();
  }
}
