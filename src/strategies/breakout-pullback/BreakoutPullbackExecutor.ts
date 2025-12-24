import { KiteConnect } from 'kiteconnect';
import { Logger } from '../../utils/Logger';
import { TradeSetupRequest } from './BreakoutPullbackStrategy';
import * as fs from 'fs';
import * as path from 'path';

// ===========================
// INTERFACES & TYPES
// ===========================

export interface OptionInstrument {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
  strike: number;
  expiry: Date;
  instrument_type: string;
  lot_size: number;
}

export interface ActivePosition {
  tradeId: string;
  entryOrderId: string;
  instrument: OptionInstrument;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  entryTime: Date;
  stopLoss: number;
  target: number;
  // Trailing stop loss fields (60% of target distance)
  originalStopLoss: number;        // Store initial SL for reference
  isTrailingActive: boolean;       // Has 60% been reached?
  trailingTrigger: number;         // The 60% price level
  trailedAt?: Date;                // Timestamp when SL moved to cost
}

export interface TradeRecord {
  tradeId: string;
  entryOrderId: string;
  exitOrderId?: string;
  instrument: OptionInstrument;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  exitPrice?: number;
  entryTime: Date;
  exitTime?: Date;
  pnl?: number;
  exitReason?: 'TARGET' | 'STOP_LOSS' | 'MANUAL';
  status: 'OPEN' | 'CLOSED';
  isPaperTrade: boolean; // Track if this was a paper trade
}

export interface TradingConfig {
  capital: number;              // Current capital (updated after each trade)
  riskPerTrade: number;        // 3% = 0.03
  maxRetries: number;          // 3
  orderTimeout: number;        // 5000ms
  paperTradingMode: boolean;   // true for testing
  niftyLotSize: number;       // 75 for NIFTY
}

export interface PersistedData {
  config: TradingConfig;
  activePosition?: ActivePosition;
  tradeHistory: TradeRecord[];
  activeInstrument?: OptionInstrument & {
    selectedAt: Date;
    direction: 'LONG' | 'SHORT';
    underlyingPrice: number;
  };
  lastUpdated: Date;
}

export interface DetailedPosition {
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  instrument: string;
  strikePrice: number;
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  entryOrderId: string;
  stopLoss: number;
  target: number;
  currentLTP: number | null;
  currentLTPTimestamp: Date | null;
  unrealizedPnL: number | null;
  percentChange: number | null;
  minutesSinceEntry: number;
  secondsSinceLastUpdate: number | null;
  isActive: boolean;
}

// ===========================
// MAIN SERVICE CLASS
// ===========================

export class TradeExecutionService {
  private kiteConnect: any;
  private logger: Logger;
  private persistedData: PersistedData;
  private dataFilePath: string;
  private instruments: OptionInstrument[] = [];
  private niftyInstruments: OptionInstrument[] = [];

  // Cached option price for active position monitoring (no extra API calls)
  private cachedOptionPrice: number | null = null;
  private cachedOptionTimestamp: Date | null = null;

  constructor(kiteConnect: any, logger: Logger) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.dataFilePath = path.join(__dirname, '../../data/trading-data.json');

    // Initialize with default data
    this.persistedData = this.loadPersistedData();

    // Ensure data directory exists
    this.ensureDataDirectory();

    // Setup graceful shutdown handlers
    this.setupGracefulShutdown();

    this.logger.info('🚀 TradeExecutionService initialized');
    this.logger.info(`💰 Current Capital: ₹${this.persistedData.config.capital.toLocaleString()}`);
    if (this.persistedData.activePosition) {
      this.logger.info(`📊 Active Position Found: ${this.persistedData.activePosition.tradeId}`);
      this.logger.info(`⚠️ System restarted with active position - monitoring required`);
    }
  }

  // ===========================
  // GRACEFUL SHUTDOWN HANDLING
  // ===========================

  private setupGracefulShutdown(): void {
    // NOTE: Process handlers removed from strategy component
    // Strategy components should not control application lifecycle
    // Process handlers are managed at application level (index.ts)
    this.logger.info('🔧 TradeExecutionService initialized - process handlers managed at application level');
  }

  private async gracefulShutdown(): Promise<void> {
    try {
      this.logger.info('🔄 Starting graceful shutdown sequence...');

      if (this.persistedData.activePosition) {
        this.logger.warn('⚠️ Active position detected during shutdown!');
        this.logger.info(`📊 Position: ${this.persistedData.activePosition.tradeId}`);
        this.logger.info(`📈 Instrument: ${this.persistedData.activePosition.instrument.tradingsymbol}`);
        this.logger.info(`🎲 Quantity: ${this.persistedData.activePosition.quantity}`);
        this.logger.info(`💰 Entry Price: ₹${this.persistedData.activePosition.entryPrice}`);

        if (!this.persistedData.config.paperTradingMode) {
          // Verify position still exists in broker account
          await this.syncWithBrokerState();
          this.logger.warn('🚨 IMPORTANT: Monitor position manually in Zerodha account');
          this.logger.warn('🚨 Position will persist after system shutdown');
        } else {
          this.logger.info('📝 Paper trading position - no action required');
        }
      } else {
        this.logger.info('✅ No active positions - safe to shutdown');
      }

      // Save final state
      this.savePersistedData();
      this.logger.info('💾 Final state saved successfully');

      this.logger.info('✅ Graceful shutdown completed');
    } catch (error) {
      this.logger.error('❌ Error during graceful shutdown:', error);
      throw error;
    }
  }

  public async forceCloseAllPositions(reason: string = 'SYSTEM_SHUTDOWN'): Promise<void> {
    try {
      if (!this.persistedData.activePosition) {
        this.logger.info('📋 No active positions to close');
        return;
      }

      this.logger.warn(`🚨 FORCE CLOSING POSITION - Reason: ${reason}`);
      await this.closePosition(this.persistedData.activePosition.tradeId, 'MANUAL');
      this.logger.info('✅ Position force closed successfully');
    } catch (error) {
      this.logger.error('❌ Error force closing positions:', error);
      throw error;
    }
  }

  /**
   * Clear orphaned position and record trade with actual exit price from broker
   * This is called when user manually exited on broker platform and clicks "Clear Position" button
   * Similar to BollingerBandStrategy.clearActivePosition()
   */
  public async clearOrphanedPositionWithExitPrice(): Promise<void> {
    try {
      if (!this.persistedData.activePosition) {
        this.logger.info('📋 No orphaned position to clear');
        return;
      }

      const position = this.persistedData.activePosition;
      const tradeId = position.tradeId;
      const symbol = position.instrument.tradingsymbol;
      const entryOrderId = position.entryOrderId;
      const entryTime = new Date(position.entryTime);
      const entryPrice = position.entryPrice;

      this.logger.warn(`🧹 Clearing orphaned position: ${tradeId}`);
      this.logger.info(`   📊 Symbol: ${symbol}, Entry: ₹${entryPrice}, Time: ${entryTime.toLocaleString()}`);

      // Try to fetch actual exit order from broker
      let exitPrice = entryPrice; // Fallback to entry price if can't find exit
      let exitOrderId = `MANUAL_CLEAR_${Date.now()}`;
      let exitTime = new Date();

      try {
        const exitOrder = await this.fetchExitOrderFromBroker(symbol, entryTime, position.quantity);
        if (exitOrder) {
          exitPrice = exitOrder.average_price || exitOrder.price || entryPrice;
          exitOrderId = exitOrder.order_id;
          exitTime = new Date(exitOrder.order_timestamp);

          // Validate quantity match
          if (exitOrder.quantity !== position.quantity) {
            this.logger.warn(`⚠️ Quantity mismatch detected!`, {
              entryQty: position.quantity,
              exitQty: exitOrder.quantity,
              warning: 'Using this exit order but quantities differ'
            });
          }

          this.logger.info('✅ Found actual exit order from broker', {
            exitOrderId: exitOrderId,
            exitPrice: exitPrice,
            exitTime: exitTime.toLocaleString(),
            exitQty: exitOrder.quantity
          });
        } else {
          this.logger.warn('⚠️ Could not find exit order from broker, using entry price for P&L (P&L = 0)');
        }
      } catch (error) {
        this.logger.error('❌ Error fetching exit order from broker:', error);
        this.logger.warn('⚠️ Will use entry price for P&L (P&L = 0)');
      }

      // Calculate P&L
      const pnl = this.calculatePnL(position, exitPrice);

      // Update capital with P&L (only for real trades, not paper)
      if (!this.persistedData.config.paperTradingMode) {
        this.updateCapitalAfterTrade(pnl);
      }

      // Create trade record for history
      const tradeRecord: TradeRecord = {
        tradeId: position.tradeId,
        entryOrderId: position.entryOrderId,
        exitOrderId: exitOrderId,
        instrument: position.instrument,
        direction: position.direction,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        exitPrice: exitPrice,
        entryTime: position.entryTime,
        exitTime: exitTime,
        pnl: pnl,
        exitReason: 'MANUAL',
        status: 'CLOSED',
        isPaperTrade: this.persistedData.config.paperTradingMode
      };

      // Add to trade history
      this.persistedData.tradeHistory.push(tradeRecord);

      this.logger.info('📊 Trade recorded via manual clear', {
        exitPrice: exitPrice.toFixed(2),
        pnl: `₹${pnl > 0 ? '+' : ''}${pnl.toLocaleString()}`,
        newCapital: `₹${this.persistedData.config.capital.toLocaleString()}`,
        totalTrades: this.persistedData.tradeHistory.length
      });

      // Clear active position
      delete this.persistedData.activePosition;

      // Clear active instrument as it's no longer relevant
      if (this.persistedData.activeInstrument) {
        delete this.persistedData.activeInstrument;
      }

      // Clear cached price
      this.clearOptionPriceCache();

      // Save the cleaned data with trade record
      this.savePersistedData();

      this.logger.info(`✅ Orphaned position cleared successfully with P&L recorded`);
    } catch (error) {
      this.logger.error('❌ Error clearing orphaned position:', error);
      throw error;
    }
  }

  /**
   * Fetch exit order from broker by finding SELL order after entry time
   * Similar to BollingerBandStrategy.fetchExitOrderFromBroker()
   */
  private async fetchExitOrderFromBroker(symbol: string, entryTime: Date, entryQuantity?: number): Promise<any> {
    try {
      // Fetch all orders for today
      const orders = await this.kiteConnect.getOrders();

      // Filter for this symbol's SELL orders after entry time
      // ONLY untagged orders (manual exits from broker, not bot-placed exits)
      let exitCandidates = orders.filter((order: any) => {
        const orderTime = new Date(order.order_timestamp);
        return order.tradingsymbol === symbol
          && order.transaction_type === 'SELL'
          && order.status === 'COMPLETE'
          && orderTime > entryTime
          && (!order.tag || order.tag === ''); // ONLY untagged (manual) exits
      });

      if (exitCandidates.length === 0) {
        this.logger.warn(`⚠️ No manual SELL orders found for ${symbol} after ${entryTime.toLocaleTimeString()}`);
        return null;
      }

      // If entry quantity provided, prioritize matching quantity
      if (entryQuantity) {
        const exactMatch = exitCandidates.filter((order: any) => order.quantity === entryQuantity);
        if (exactMatch.length > 0) {
          exitCandidates = exactMatch;
          this.logger.info(`✅ Found ${exactMatch.length} quantity-matching exit orders (qty=${entryQuantity})`);
        } else {
          this.logger.warn(`⚠️ No exact quantity match found. Using closest by time.`);
        }
      }

      // Sort by timestamp to get closest exit after entry
      exitCandidates.sort((a: any, b: any) =>
        new Date(a.order_timestamp).getTime() - new Date(b.order_timestamp).getTime()
      );

      const exitOrder = exitCandidates[0];
      this.logger.info(`✅ Selected exit order (${exitCandidates.length} candidates after filters)`, {
        orderId: exitOrder.order_id,
        qty: exitOrder.quantity,
        price: exitOrder.average_price,
        time: exitOrder.order_timestamp,
        tag: exitOrder.tag || 'NONE (manual)',
        quantityMatch: entryQuantity ? (exitOrder.quantity === entryQuantity ? '✅ MATCH' : '⚠️ MISMATCH') : 'N/A'
      });

      return exitOrder;
    } catch (error) {
      this.logger.error('Error fetching orders from broker:', error);
      return null;
    }
  }

  /**
   * Legacy method - kept for backward compatibility
   * Use clearOrphanedPositionWithExitPrice() instead for proper trade recording
   */
  public clearOrphanedPosition(): void {
    try {
      if (!this.persistedData.activePosition) {
        this.logger.info('📋 No orphaned position to clear');
        return;
      }

      const tradeId = this.persistedData.activePosition.tradeId;
      this.logger.warn(`🧹 Clearing orphaned position: ${tradeId}`);

      // Clear active position without placing any orders
      delete this.persistedData.activePosition;

      // Also clear active instrument as it's no longer relevant
      if (this.persistedData.activeInstrument) {
        delete this.persistedData.activeInstrument;
      }

      // Save the cleaned data
      this.savePersistedData();

      this.logger.info(`✅ Orphaned position cleared successfully`);
    } catch (error) {
      this.logger.error('❌ Error clearing orphaned position:', error);
      throw error;
    }
  }

  // ===========================
  // PERSISTENCE MANAGEMENT
  // ===========================

  private ensureDataDirectory(): void {
    const dataDir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      this.logger.info(`📁 Created data directory: ${dataDir}`);
    }
  }

  private loadPersistedData(): PersistedData {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf8'));
        // Convert date strings back to Date objects
        if (data.activePosition?.entryTime) {
          data.activePosition.entryTime = new Date(data.activePosition.entryTime);
        }
        if (data.activePosition?.instrument?.expiry) {
          data.activePosition.instrument.expiry = new Date(data.activePosition.instrument.expiry);
        }
        data.tradeHistory = data.tradeHistory?.map((trade: any) => ({
          ...trade,
          entryTime: new Date(trade.entryTime),
          exitTime: trade.exitTime ? new Date(trade.exitTime) : undefined,
          instrument: {
            ...trade.instrument,
            expiry: new Date(trade.instrument.expiry)
          }
        })) || [];
        data.lastUpdated = new Date(data.lastUpdated);

        this.logger.info('📖 Loaded persisted trading data');
        return data;
      }
    } catch (error) {
      this.logger.error('❌ Error loading persisted data:', error);
    }

    // Return default data if file doesn't exist or error occurred
    const defaultData: PersistedData = {
      config: {
        capital: 200000,           // ₹2,00,000
        riskPerTrade: 0.03,       // 3%
        maxRetries: 3,
        orderTimeout: 5000,
        paperTradingMode: true,   // Start in paper trading mode for safety
        niftyLotSize: 75
      },
      tradeHistory: [],
      lastUpdated: new Date()
    };

    this.savePersistedData(defaultData);
    this.logger.info('💾 Created default trading data');
    return defaultData;
  }

  private savePersistedData(data?: PersistedData): void {
    try {
      const dataToSave = data || this.persistedData;
      dataToSave.lastUpdated = new Date();
      fs.writeFileSync(this.dataFilePath, JSON.stringify(dataToSave, null, 2));
      this.logger.info('💾 Saved trading data to disk');
    } catch (error) {
      this.logger.error('❌ Error saving persisted data:', error);
    }
  }

  // ===========================
  // INSTRUMENT MANAGEMENT
  // ===========================

  public async loadInstruments(): Promise<void> {
    try {
      this.logger.info('📊 Loading NIFTY option instruments...');
      const allInstruments = await this.kiteConnect.getInstruments('NFO');

      // Filter for NIFTY options only
      this.niftyInstruments = allInstruments
        .filter((inst: any) =>
          inst.name === 'NIFTY' &&
          (inst.instrument_type === 'CE' || inst.instrument_type === 'PE') &&
          inst.lot_size > 0
        )
        .map((inst: any) => ({
          instrument_token: inst.instrument_token,
          tradingsymbol: inst.tradingsymbol,
          name: inst.name,
          exchange: inst.exchange,
          strike: inst.strike,
          expiry: new Date(inst.expiry),
          instrument_type: inst.instrument_type,
          lot_size: inst.lot_size
        }));

      this.logger.info(`✅ Loaded ${this.niftyInstruments.length} NIFTY option instruments`);
    } catch (error) {
      this.logger.error('❌ Error loading instruments:', error);
      throw error;
    }
  }

  private getNextTuesdayExpiry(): Date {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const tuesday = 2; // Tuesday is day 2

    let daysToAdd = tuesday - currentDay;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Next Tuesday
    }

    const nextTuesday = new Date(today);
    nextTuesday.setDate(today.getDate() + daysToAdd);
    nextTuesday.setHours(15, 30, 0, 0); // Market close time

    return nextTuesday;
  }

  /**
   * Find ATM (At-The-Money) strike closest to current price
   * 
   * @param options - Array of option instruments
   * @param currentPrice - Current underlying price (NIFTY Futures)
   * @returns ATM strike price
   */
  private findATMStrike(options: OptionInstrument[], currentPrice: number): number {
    if (options.length === 0) {
      throw new Error('No options available to find ATM strike');
    }

    // Find strike with smallest absolute difference from current price
    let atmStrike = options[0]!.strike;
    let smallestDiff = Math.abs(options[0]!.strike - currentPrice);

    for (const option of options) {
      const diff = Math.abs(option.strike - currentPrice);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        atmStrike = option.strike;
      }
    }

    this.logger.debug(`🎯 ATM Strike calculation: Price=${currentPrice}, ATM=${atmStrike}, Diff=${smallestDiff.toFixed(2)}`);

    return atmStrike;
  }

  public async selectATMOption(direction: 'LONG' | 'SHORT', niftyPrice: number): Promise<OptionInstrument> {
    if (this.niftyInstruments.length === 0) {
      await this.loadInstruments();
    }

    const nextTuesdayExpiry = this.getNextTuesdayExpiry();
    const optionType = direction === 'LONG' ? 'CE' : 'PE';
    const targetPremium = niftyPrice * 0.01; // 1% of NIFTY futures price

    this.logger.info(`🎯 Selecting ${optionType} option by PREMIUM for NIFTY price: ₹${niftyPrice}`);
    this.logger.info(`� Target Premium: ₹${targetPremium.toFixed(2)} (1% of futures price)`);
    this.logger.info(`�📅 Target expiry: ${nextTuesdayExpiry.toDateString()}`);

    // Find options with exact expiry match (precise targeting)
    let relevantOptions = this.niftyInstruments.filter(opt => {
      const isSameExpiry = opt.expiry.toDateString() === nextTuesdayExpiry.toDateString();
      return isSameExpiry && opt.instrument_type === optionType;
    });

    // Fallback: If no exact match, try ±1 day (holiday/monthly expiry edge case)
    if (relevantOptions.length === 0) {
      this.logger.warn(`⚠️ No exact expiry match for ${nextTuesdayExpiry.toDateString()}, trying ±1 day fallback...`);
      relevantOptions = this.niftyInstruments.filter(opt => {
        const daysDiff = Math.abs((opt.expiry.getTime() - nextTuesdayExpiry.getTime()) / (24 * 60 * 60 * 1000));
        return daysDiff <= 1 && opt.instrument_type === optionType;
      });

      if (relevantOptions.length > 0) {
        this.logger.info(`✅ Fallback found ${relevantOptions.length} options within ±1 day`);
      }
    }

    if (relevantOptions.length === 0) {
      throw new Error(`No ${optionType} options found for expiry ${nextTuesdayExpiry.toDateString()} or nearby dates`);
    }

    this.logger.info(`📋 Found ${relevantOptions.length} ${optionType} options, fetching live prices...`);

    // Find ATM strike and select ATM±25 range (51 options) for optimal premium matching
    const atmStrike = this.findATMStrike(relevantOptions, niftyPrice);
    const strikeRange = 25; // ±25 strikes from ATM
    const minStrike = atmStrike - (strikeRange * 50);
    const maxStrike = atmStrike + (strikeRange * 50);

    // Filter to ATM±25 range
    const selectedOptions = relevantOptions.filter(opt =>
      opt.strike >= minStrike && opt.strike <= maxStrike
    );

    this.logger.info(`🎯 ATM Strike: ₹${atmStrike} | Range: ₹${minStrike}-₹${maxStrike} | Selected: ${selectedOptions.length} options`);

    // Fetch live prices for selected options in single API call
    const symbols = selectedOptions.map(opt => `NFO:${opt.tradingsymbol}`);
    const optionsWithPremiums: Array<{ option: OptionInstrument, premium: number }> = [];

    try {
      const quotes = await this.kiteConnect.getQuote(symbols);

      for (const option of selectedOptions) {
        const symbol = `NFO:${option.tradingsymbol}`;
        const quote = quotes[symbol];

        if (quote && quote.last_price > 0) {
          optionsWithPremiums.push({
            option: option,
            premium: quote.last_price
          });
        }
      }

      this.logger.info(`✅ Fetched prices for ${optionsWithPremiums.length}/${selectedOptions.length} options`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Error fetching option prices: ${errorMessage}`);
    }

    if (optionsWithPremiums.length === 0) {
      this.logger.error('❌ No option prices available, falling back to ATM selection');
      // Fallback to old ATM logic if no prices available
      const atmOption = relevantOptions.reduce((closest, current) => {
        const closestDiff = Math.abs(closest.strike - niftyPrice);
        const currentDiff = Math.abs(current.strike - niftyPrice);
        return currentDiff < closestDiff ? current : closest;
      });
      this.logger.info(`✅ Fallback ATM Option: ${atmOption.tradingsymbol} | Strike: ₹${atmOption.strike}`);
      return atmOption;
    }

    // Find option with premium closest to target (1% of futures price)
    const bestOption = optionsWithPremiums.reduce((closest, current) => {
      const closestDiff = Math.abs(closest.premium - targetPremium);
      const currentDiff = Math.abs(current.premium - targetPremium);
      return currentDiff < closestDiff ? current : closest;
    });

    const premiumDifference = Math.abs(bestOption.premium - targetPremium);
    const premiumAccuracy = ((targetPremium - premiumDifference) / targetPremium * 100);

    this.logger.info(`✅ Selected Premium-Based Option: ${bestOption.option.tradingsymbol}`);
    this.logger.info(`   📊 Strike: ₹${bestOption.option.strike} | Premium: ₹${bestOption.premium.toFixed(2)}`);
    this.logger.info(`   🎯 Target: ₹${targetPremium.toFixed(2)} | Difference: ₹${premiumDifference.toFixed(2)} | Accuracy: ${premiumAccuracy.toFixed(1)}%`);

    return bestOption.option;
  }

  // ===========================
  // POSITION SIZING
  // ===========================

  private calculatePositionSize(stopLossPoints: number, optionPrice: number): number {
    const { capital, riskPerTrade, niftyLotSize } = this.persistedData.config;

    // Constraint 1: Risk-based sizing (existing logic)
    const maxRiskAmount = capital * riskPerTrade; // ₹6,000 for 3% of ₹2,00,000
    const riskPerLot = stopLossPoints * niftyLotSize;
    const maxLotsByRisk = Math.floor(maxRiskAmount / riskPerLot);

    // Constraint 2: Capital-based sizing (NEW - prevents capital exceeded error)
    const costPerLot = optionPrice * niftyLotSize;
    const maxLotsByCapital = Math.floor(capital / costPerLot);

    // Take minimum of both constraints (CRITICAL FIX)
    const finalLots = Math.min(maxLotsByRisk, maxLotsByCapital);

    this.logger.info(`📊 Position Sizing Calculation:`);
    this.logger.info(`   💰 Capital: ₹${capital.toLocaleString()}`);
    this.logger.info(`   🎯 Risk per trade: ${(riskPerTrade * 100).toFixed(1)}% = ₹${maxRiskAmount.toLocaleString()}`);
    this.logger.info(`   📉 SL Points: ${stopLossPoints}`);
    this.logger.info(`   💵 Option Price: ₹${optionPrice}`);
    this.logger.info(`   📊 Risk per lot: ₹${riskPerLot.toFixed(2)}`);
    this.logger.info(`   💰 Cost per lot: ₹${costPerLot.toFixed(2)}`);
    this.logger.info(`   🎲 Max lots (risk): ${maxLotsByRisk}`);
    this.logger.info(`   💸 Max lots (capital): ${maxLotsByCapital}`);
    this.logger.info(`   ✅ Final lots: ${finalLots} (minimum of constraints)`);

    return Math.max(1, finalLots); // Minimum 1 lot
  }

  // ===========================
  // ORDER MANAGEMENT
  // ===========================

  public async placeMarketOrder(tradeSetup: TradeSetupRequest): Promise<string> {
    try {
      this.logger.info('🚀 =================== TRADE ENTRY ===================');
      this.logger.info(`📊 Trade Setup: ${tradeSetup.direction} | Entry: ₹${tradeSetup.entryLevel} | SL: ₹${tradeSetup.stopLossLevel} | Target: ₹${tradeSetup.targetLevel}`);

      // Check if we already have an active position
      if (this.persistedData.activePosition) {
        throw new Error(`Cannot place new order - active position exists: ${this.persistedData.activePosition.tradeId}`);
      }

      // Validate minimum capital requirements
      const minCapitalRequired = 10000; // Minimum ₹10,000 required
      if (this.persistedData.config.capital < minCapitalRequired) {
        throw new Error(`Insufficient capital: ₹${this.persistedData.config.capital.toLocaleString()} < ₹${minCapitalRequired.toLocaleString()}`);
      }

      // Use previously selected option from breakout detection, or select new if none exists
      let selectedOption: OptionInstrument;

      if (this.persistedData.activeInstrument &&
        this.persistedData.activeInstrument.direction === tradeSetup.direction) {
        // Use the option selected during breakout detection
        selectedOption = this.persistedData.activeInstrument;
        this.logger.info(`🔄 Using previously selected option from breakout: ${selectedOption.tradingsymbol}`);
        this.logger.info(`   📊 Selected at breakout with futures price: ₹${this.persistedData.activeInstrument.underlyingPrice}`);
      } else {
        // Fallback: select new option (shouldn't normally happen with Option B approach)
        this.logger.warn('⚠️ No option pre-selected at breakout, selecting now...');
        selectedOption = await this.selectATMOption(tradeSetup.direction, tradeSetup.underlyingPrice);
      }

      // Get current option price for position sizing
      const optionPrice = await this.getOptionPrice(selectedOption);

      // Calculate stop loss points (difference between entry and stop loss levels)
      const stopLossPoints = Math.abs(tradeSetup.entryLevel - tradeSetup.stopLossLevel);

      // Calculate position size with both risk and capital constraints
      // Note: New logic ensures we never exceed available capital
      const lotSize = this.calculatePositionSize(stopLossPoints, optionPrice);
      const quantity = lotSize * this.persistedData.config.niftyLotSize;

      // Log final trade cost for verification
      const estimatedTradeCost = optionPrice * quantity;
      this.logger.info(`💰 Final Trade Cost: ₹${estimatedTradeCost.toLocaleString()} (${((estimatedTradeCost / this.persistedData.config.capital) * 100).toFixed(1)}% of capital)`);

      // Generate trade ID
      const tradeId = `TRADE_${Date.now()}`;

      if (this.persistedData.config.paperTradingMode) {
        this.logger.info('📝 PAPER TRADING MODE - Simulating order placement');
        const simulatedOrderId = `PAPER_${Date.now()}`;

        // Calculate 60% trailing trigger
        const targetDistance = Math.abs(tradeSetup.targetLevel - optionPrice);
        const trailingTriggerDistance = targetDistance * 0.60;
        const trailingTrigger = tradeSetup.direction === 'LONG' 
          ? optionPrice + trailingTriggerDistance
          : optionPrice - trailingTriggerDistance;

        // Create active position record
        this.persistedData.activePosition = {
          tradeId,
          entryOrderId: simulatedOrderId,
          instrument: selectedOption,
          direction: tradeSetup.direction,
          quantity,
          entryPrice: optionPrice,
          entryTime: new Date(),
          stopLoss: tradeSetup.stopLossLevel,
          target: tradeSetup.targetLevel,
          originalStopLoss: tradeSetup.stopLossLevel,
          isTrailingActive: false,
          trailingTrigger: trailingTrigger
        };

        this.savePersistedData();

        this.logger.info(`✅ Paper trade placed successfully`);
        this.logger.info(`   📋 Trade ID: ${tradeId}`);
        this.logger.info(`   🎫 Order ID: ${simulatedOrderId}`);
        this.logger.info(`   📊 Instrument: ${selectedOption.tradingsymbol}`);
        this.logger.info(`   🎲 Quantity: ${quantity} (${lotSize} lots)`);
        this.logger.info(`   💰 Entry Price: ₹${optionPrice}`);

        return tradeId;
      } else {
        // Real order placement
        const orderParams = {
          exchange: selectedOption.exchange,
          tradingsymbol: selectedOption.tradingsymbol,
          transaction_type: 'BUY', // Always BUY for options (direction handled by CE/PE)
          quantity: quantity,
          order_type: 'MARKET',
          product: 'MIS', // Intraday
          validity: 'DAY',
          tag: 'BP_TRADE' // Tag to identify bot-placed orders vs manual exits
        };

        this.logger.info('📤 Placing real market order...');
        this.logger.info(`   Order params: ${JSON.stringify(orderParams, null, 2)}`);

        const orderResponse = await this.kiteConnect.placeOrder('regular', orderParams);
        const orderId = orderResponse.order_id;

        // Wait for order confirmation
        await this.waitForOrderConfirmation(orderId);

        // Get actual fill price and quantity from executed order
        const actualEntryPrice = await this.getActualFillPrice(orderId);
        const actualQuantity = await this.getActualFillQuantity(orderId);

        // Check for partial fill
        if (actualQuantity < quantity) {
          this.logger.warn(`⚠️ Partial fill detected: ${actualQuantity}/${quantity} filled`);
          this.logger.info(`📊 Adjusting position size to actual filled quantity`);
        } else if (actualQuantity === quantity) {
          this.logger.info(`✅ Complete fill: ${actualQuantity} units executed`);
        }

        this.logger.info(`💰 Actual entry price: ₹${actualEntryPrice} (vs quote: ₹${optionPrice})`);

        // Calculate 60% trailing trigger based on actual entry price
        const targetDistance = Math.abs(tradeSetup.targetLevel - actualEntryPrice);
        const trailingTriggerDistance = targetDistance * 0.60;
        const trailingTrigger = tradeSetup.direction === 'LONG' 
          ? actualEntryPrice + trailingTriggerDistance
          : actualEntryPrice - trailingTriggerDistance;

        // Create active position record with actual fill price and quantity
        this.persistedData.activePosition = {
          tradeId,
          entryOrderId: orderId,
          instrument: selectedOption,
          direction: tradeSetup.direction,
          quantity: actualQuantity, // Using actual filled quantity
          entryPrice: actualEntryPrice, // Using actual fill price for accurate P&L
          entryTime: new Date(),
          stopLoss: tradeSetup.stopLossLevel,
          target: tradeSetup.targetLevel,
          originalStopLoss: tradeSetup.stopLossLevel,
          isTrailingActive: false,
          trailingTrigger: trailingTrigger
        };

        this.savePersistedData();

        // Verify position was created correctly in broker account
        await this.syncWithBrokerState();

        this.logger.info(`✅ Real order placed successfully`);
        this.logger.info(`   📋 Trade ID: ${tradeId}`);
        this.logger.info(`   🎫 Zerodha Order ID: ${orderId}`);
        this.logger.info(`   📊 Instrument: ${selectedOption.tradingsymbol}`);
        this.logger.info(`   🎲 Quantity: ${actualQuantity} (${Math.round(actualQuantity / this.persistedData.config.niftyLotSize)} lots)`);

        return tradeId;
      }
    } catch (error) {
      this.logger.error('❌ Error placing market order:', error);
      throw error;
    }
  }

  public async closePosition(tradeId: string, exitReason: 'TARGET' | 'STOP_LOSS' | 'MANUAL' = 'MANUAL'): Promise<void> {
    try {
      this.logger.info('🔚 =================== TRADE EXIT ===================');
      this.logger.info(`📋 Closing position: ${tradeId} | Reason: ${exitReason}`);

      if (!this.persistedData.activePosition || this.persistedData.activePosition.tradeId !== tradeId) {
        throw new Error(`No active position found for trade ID: ${tradeId}`);
      }

      const position = this.persistedData.activePosition;

      if (this.persistedData.config.paperTradingMode) {
        // Simulate exit price (would need real market price in actual implementation)
        const currentPrice = await this.getOptionPrice(position.instrument);
        const pnl = this.calculatePnL(position, currentPrice);

        // NOTE: Capital is NOT updated in paper trading mode - only for real trades
        this.logger.info(`📝 Paper Trade P&L: ₹${pnl > 0 ? '+' : ''}${pnl.toLocaleString()} (not affecting real capital)`);

        // Create trade record
        const tradeRecord: TradeRecord = {
          tradeId: position.tradeId,
          entryOrderId: position.entryOrderId,
          exitOrderId: `PAPER_EXIT_${Date.now()}`,
          instrument: position.instrument,
          direction: position.direction,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          entryTime: position.entryTime,
          exitTime: new Date(),
          pnl,
          exitReason,
          status: 'CLOSED',
          isPaperTrade: true
        };

        this.persistedData.tradeHistory.push(tradeRecord);
        delete this.persistedData.activePosition;
        this.clearOptionPriceCache(); // Clear cached price when position closes
        this.savePersistedData();

        this.logger.info(`✅ Paper position closed successfully`);
        this.logger.info(`   💰 Exit Price: ₹${currentPrice}`);
        this.logger.info(`   📈 Simulated P&L: ₹${pnl > 0 ? '+' : ''}${pnl.toLocaleString()} (paper only)`);
        this.logger.info(`   💰 Real Capital Unchanged: ₹${this.persistedData.config.capital.toLocaleString()}`);

      } else {
        // Real order to close position
        const closeOrderParams = {
          exchange: position.instrument.exchange,
          tradingsymbol: position.instrument.tradingsymbol,
          transaction_type: 'SELL', // Always SELL to close position
          quantity: position.quantity,
          order_type: 'MARKET',
          product: 'MIS',
          validity: 'DAY',
          tag: 'BP_TRADE' // Tag to identify bot-placed exits
        };

        const closeOrderResponse = await this.kiteConnect.placeOrder('regular', closeOrderParams);
        const closeOrderId = closeOrderResponse.order_id;

        // Wait for order confirmation
        await this.waitForOrderConfirmation(closeOrderId);

        // Get actual exit price from order details
        const exitPrice = await this.getActualFillPrice(closeOrderId);
        const pnl = this.calculatePnL(position, exitPrice);

        // Update capital based on P&L
        this.updateCapitalAfterTrade(pnl);

        // Create trade record
        const tradeRecord: TradeRecord = {
          tradeId: position.tradeId,
          entryOrderId: position.entryOrderId,
          exitOrderId: closeOrderId,
          instrument: position.instrument,
          direction: position.direction,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          exitPrice,
          entryTime: position.entryTime,
          exitTime: new Date(),
          pnl,
          exitReason,
          status: 'CLOSED',
          isPaperTrade: false
        };

        this.persistedData.tradeHistory.push(tradeRecord);
        delete this.persistedData.activePosition;
        this.clearOptionPriceCache(); // Clear cached price when position closes
        this.savePersistedData();

        this.logger.info(`✅ Real position closed successfully`);
        this.logger.info(`   🎫 Exit Order ID: ${closeOrderId}`);
        this.logger.info(`   💰 Exit Price: ₹${exitPrice}`);
        this.logger.info(`   📈 P&L: ₹${pnl > 0 ? '+' : ''}${pnl.toLocaleString()}`);
        this.logger.info(`   💰 New Capital: ₹${this.persistedData.config.capital.toLocaleString()}`);
      }
    } catch (error) {
      this.logger.error('❌ Error closing position:', error);
      throw error;
    }
  }

  // ===========================
  // POSITION VERIFICATION METHODS
  // ===========================

  private async verifyBrokerPosition(instrument: OptionInstrument, expectedQuantity: number): Promise<boolean> {
    try {
      if (this.persistedData.config.paperTradingMode) {
        this.logger.info('📝 Paper trading mode - skipping broker position verification');
        return true;
      }

      const positions = await this.kiteConnect.getPositions();
      const netPositions = positions.net || [];

      const matchingPosition = netPositions.find((pos: any) =>
        pos.tradingsymbol === instrument.tradingsymbol &&
        pos.exchange === instrument.exchange
      );

      if (!matchingPosition) {
        this.logger.warn(`⚠️ No position found in Zerodha for ${instrument.tradingsymbol}`);
        return false;
      }

      const brokerQuantity = Math.abs(matchingPosition.quantity);
      if (brokerQuantity !== expectedQuantity) {
        this.logger.warn(`⚠️ Position size mismatch: System=${expectedQuantity}, Zerodha=${brokerQuantity}`);
        return false;
      }

      this.logger.info(`✅ Position verified: ${instrument.tradingsymbol} = ${brokerQuantity} units`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error verifying broker position:`, error);
      return false;
    }
  }

  public async syncWithBrokerState(): Promise<void> {
    try {
      if (this.persistedData.config.paperTradingMode) {
        this.logger.info('📝 Paper trading mode - skipping broker sync');
        return;
      }

      if (!this.persistedData.activePosition) {
        this.logger.info('📋 No active position to sync');
        return;
      }

      const position = this.persistedData.activePosition;
      const isVerified = await this.verifyBrokerPosition(position.instrument, position.quantity);

      if (!isVerified) {
        this.logger.warn('⚠️ Position mismatch detected with broker - manual intervention may be required');
        // Could implement auto-reconciliation here if needed
      }
    } catch (error) {
      this.logger.error('❌ Error syncing with broker state:', error);
    }
  }

  // ===========================
  // HELPER METHODS
  // ===========================

  private async getOptionPrice(option: OptionInstrument): Promise<number> {
    try {
      if (this.persistedData.config.paperTradingMode) {
        // More realistic paper trading simulation based on option characteristics
        // CE options typically ₹50-200 range, PE options similar
        const basePrice = option.instrument_type === 'CE' ? 120 : 80;
        const volatility = 0.2; // 20% random movement
        const randomFactor = 1 + (Math.random() - 0.5) * volatility;
        return Math.round(basePrice * randomFactor * 100) / 100; // Round to 2 decimal places
      } else {
        const quote = await this.kiteConnect.getQuote([`${option.exchange}:${option.tradingsymbol}`]);
        const optionQuote = quote[`${option.exchange}:${option.tradingsymbol}`];
        return optionQuote.last_price;
      }
    } catch (error) {
      this.logger.error(`❌ Error getting option price for ${option.tradingsymbol}:`, error);
      throw error;
    }
  }

  private async waitForOrderConfirmation(orderId: string): Promise<void> {
    const maxRetries = 10;
    const retryInterval = 1000; // 1 second

    for (let i = 0; i < maxRetries; i++) {
      try {
        const orderDetails = await this.kiteConnect.getOrderHistory(orderId);
        const latestOrder = orderDetails[orderDetails.length - 1];

        if (latestOrder.status === 'COMPLETE') {
          this.logger.info(`✅ Order ${orderId} confirmed as COMPLETE`);
          return;
        } else if (latestOrder.status === 'REJECTED') {
          const rejectionReason = latestOrder.status_message || 'Unknown rejection reason';
          this.logger.error(`❌ Order ${orderId} REJECTED: ${rejectionReason}`);

          // Check if rejection is due to insufficient margin or limits
          if (rejectionReason.toLowerCase().includes('margin') ||
            rejectionReason.toLowerCase().includes('limit') ||
            rejectionReason.toLowerCase().includes('fund')) {
            this.logger.error(`💰 Margin/Fund related rejection - cannot retry automatically`);
            throw new Error(`Order rejected due to insufficient funds: ${rejectionReason}`);
          } else {
            this.logger.warn(`⚠️ Non-margin rejection: ${rejectionReason} - could be temporary`);
            throw new Error(`Order rejected: ${rejectionReason}`);
          }
        } else if (latestOrder.status === 'CANCELLED') {
          throw new Error(`Order ${orderId} was CANCELLED: ${latestOrder.status_message}`);
        }

        this.logger.info(`⏳ Order ${orderId} status: ${latestOrder.status}, retrying in ${retryInterval}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error(`Order confirmation timeout for ${orderId}: ${error}`);
        }
      }
    }
  }

  private async getActualFillPrice(orderId: string): Promise<number> {
    try {
      const orderDetails = await this.kiteConnect.getOrderHistory(orderId);
      const completedOrder = orderDetails.find((order: any) => order.status === 'COMPLETE');
      return completedOrder?.average_price || completedOrder?.price || 0;
    } catch (error) {
      this.logger.error(`❌ Error getting fill price for order ${orderId}:`, error);
      return 0;
    }
  }

  private async getActualFillQuantity(orderId: string): Promise<number> {
    try {
      const orderDetails = await this.kiteConnect.getOrderHistory(orderId);
      const completedOrder = orderDetails.find((order: any) => order.status === 'COMPLETE');
      return completedOrder?.filled_quantity || 0;
    } catch (error) {
      this.logger.error(`❌ Error getting fill quantity for order ${orderId}:`, error);
      return 0;
    }
  }

  private calculatePnL(position: ActivePosition, exitPrice: number): number {
    const { entryPrice, quantity, direction } = position;

    // For options: We always BUY at entry, SELL at exit
    // P&L = (exit_price - entry_price) × quantity
    // Positive when exit > entry (we sold for more than we bought)
    // Negative when exit < entry (we sold for less than we bought)
    const pnl = (exitPrice - entryPrice) * quantity;

    this.logger.info(`📊 P&L Calculation:`, {
      direction: direction,
      entryPrice: `₹${entryPrice}`,
      exitPrice: `₹${exitPrice}`,
      quantity: quantity,
      priceChange: `₹${(exitPrice - entryPrice).toFixed(2)}`,
      pnl: `₹${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`,
      result: pnl > 0 ? 'PROFIT' : pnl < 0 ? 'LOSS' : 'BREAKEVEN'
    });

    return pnl;
  }

  private updateCapitalAfterTrade(pnl: number): void {
    this.persistedData.config.capital += pnl;
    this.logger.info(`💰 Capital updated: ${pnl > 0 ? '+' : ''}₹${pnl.toLocaleString()} → ₹${this.persistedData.config.capital.toLocaleString()}`);
  }

  // ===========================
  // PUBLIC STATUS METHODS
  // ===========================

  public getCurrentCapital(): number {
    return this.persistedData.config.capital;
  }

  public getActivePosition(): ActivePosition | undefined {
    return this.persistedData.activePosition;
  }

  /**
   * Update stop loss to cost (entry price) when 60% of target is reached
   * This protects the trade from becoming a loss after achieving significant profit
   */
  public updateStopLossToCost(entryPrice: number): void {
    if (!this.persistedData.activePosition) {
      this.logger.warn('⚠️ Cannot update SL to cost - no active position');
      return;
    }
    
    const position = this.persistedData.activePosition;
    
    // Store original SL if not already stored
    if (!position.originalStopLoss) {
      position.originalStopLoss = position.stopLoss;
    }
    
    // Move SL to cost
    const previousSL = position.stopLoss;
    position.stopLoss = entryPrice;
    position.isTrailingActive = true;
    position.trailedAt = new Date();
    
    // Persist immediately
    this.savePersistedData();
    
    this.logger.info(`✅ STOP LOSS MOVED TO COST`);
    this.logger.info(`   Previous SL: ₹${previousSL.toFixed(2)} → New SL: ₹${entryPrice.toFixed(2)}`);
    this.logger.info(`   Trade now protected - minimum result: BREAKEVEN`);
  }

  public getDetailedPosition(): DetailedPosition | null {
    const position = this.persistedData.activePosition;
    if (!position) return null;

    const now = new Date();
    const entryTime = new Date(position.entryTime);
    const minutesSinceEntry = Math.floor((now.getTime() - entryTime.getTime()) / 60000);

    const cachedPrice = this.getCachedOptionPrice();
    let currentLTP: number | null = null;
    let currentLTPTimestamp: Date | null = null;
    let unrealizedPnL: number | null = null;
    let percentChange: number | null = null;
    let secondsSinceLastUpdate: number | null = null;

    if (cachedPrice) {
      currentLTP = cachedPrice.price;
      currentLTPTimestamp = cachedPrice.timestamp;

      // Calculate unrealized P&L: (current - entry) * quantity
      unrealizedPnL = (currentLTP - position.entryPrice) * position.quantity;

      // Calculate percent change
      percentChange = ((currentLTP - position.entryPrice) / position.entryPrice) * 100;

      // Calculate seconds since last update
      secondsSinceLastUpdate = Math.floor((now.getTime() - currentLTPTimestamp.getTime()) / 1000);
    }

    return {
      tradeId: position.tradeId,
      direction: position.direction,
      instrument: position.instrument.tradingsymbol,
      strikePrice: position.instrument.strike,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      entryTime: entryTime,
      entryOrderId: position.entryOrderId,
      stopLoss: position.stopLoss,
      target: position.target,
      currentLTP,
      currentLTPTimestamp,
      unrealizedPnL,
      percentChange,
      minutesSinceEntry,
      secondsSinceLastUpdate,
      isActive: true
    };
  }

  public getTradeHistory(): TradeRecord[] {
    return this.persistedData.tradeHistory;
  }

  public getTradingConfig(): TradingConfig {
    return this.persistedData.config;
  }

  public updateTradingConfig(updates: Partial<TradingConfig>): void {
    this.persistedData.config = { ...this.persistedData.config, ...updates };
    this.savePersistedData();
    this.logger.info('⚙️ Trading configuration updated');
  }

  public getExecutionStatus(): {
    hasActivePosition: boolean;
    currentCapital: number;
    totalTrades: number;
    paperTradingMode: boolean;
  } {
    return {
      hasActivePosition: !!this.persistedData.activePosition,
      currentCapital: this.persistedData.config.capital,
      totalTrades: this.persistedData.tradeHistory.length,
      paperTradingMode: this.persistedData.config.paperTradingMode
    };
  }

  /**
   * Update cached option price for active position monitoring
   * Called by strategy's WebSocket tick handler (no extra API calls)
   */
  public updateOptionPrice(price: number): void {
    this.cachedOptionPrice = price;
    this.cachedOptionTimestamp = new Date();
  }

  /**
   * Get cached option price for dashboard
   */
  public getCachedOptionPrice(): { price: number, timestamp: Date } | null {
    if (this.cachedOptionPrice === null || this.cachedOptionTimestamp === null) {
      return null;
    }
    return {
      price: this.cachedOptionPrice,
      timestamp: this.cachedOptionTimestamp
    };
  }

  /**
   * Clear cached price when position closes
   */
  private clearOptionPriceCache(): void {
    this.cachedOptionPrice = null;
    this.cachedOptionTimestamp = null;
  }

  public async getOptionPriceByToken(instrumentToken: string): Promise<number> {
    try {
      // KiteConnect getQuote API expects raw numeric instrument token, not prefixed with exchange
      const tokenNumber = parseInt(instrumentToken, 10);
      const quotes = await this.kiteConnect.getQuote([tokenNumber]);
      const quote = quotes[tokenNumber];

      if (!quote) {
        throw new Error(`No quote data found for token: ${instrumentToken}`);
      }

      return quote.last_price || 0;
    } catch (error) {
      this.logger.error(`Error fetching option price for token ${instrumentToken}:`, error);
      throw error;
    }
  }

  public getInstrumentsStatus(): {
    loaded: boolean;
    count: number;
    loadedAt?: Date;
    sampleInstruments?: any[];
  } {
    const loaded = this.niftyInstruments.length > 0;
    const result: any = {
      loaded: loaded,
      count: this.niftyInstruments.length
    };

    if (loaded) {
      result.loadedAt = new Date();
      result.sampleInstruments = this.niftyInstruments.slice(0, 5);
    }

    return result;
  }

  // ===========================
  // BREAKOUT NOTIFICATION HANDLER
  // ===========================

  /**
   * Called by strategy when a breakout is detected
   * Automatically selects option with premium closest to 1% of futures price
   */
  public async onBreakoutDetected(direction: 'LONG' | 'SHORT', underlyingPrice: number, timestamp: Date): Promise<void> {
    try {
      this.logger.info(`🎯 Breakout detected - Auto-selecting ${direction} option by premium for price: ₹${underlyingPrice}`);

      // Select option with premium closest to 1% of futures price
      const selectedOption = await this.selectATMOption(direction, underlyingPrice);

      // Store for later use when order is placed
      this.persistedData.activeInstrument = {
        ...selectedOption,
        selectedAt: timestamp,
        direction: direction,
        underlyingPrice: underlyingPrice
      };

      // Save to disk
      this.savePersistedData();

      this.logger.info(`✅ Premium-based Option auto-selected: ${selectedOption.tradingsymbol}`);
      this.logger.info(`   📊 Strike: ₹${selectedOption.strike} | Token: ${selectedOption.instrument_token}`);
      this.logger.info(`   💰 Selected with target premium: ₹${(underlyingPrice * 0.01).toFixed(2)} (1% of futures)`);

    } catch (error) {
      this.logger.error(`❌ Failed to auto-select option by premium after breakout:`, error);
      // Don't throw - this is just for UI display, not critical for trading
    }
  }

  /**
   * Get currently selected instrument for UI display
   */
  public getSelectedInstrument(): any {
    return this.persistedData.activeInstrument || null;
  }
}
