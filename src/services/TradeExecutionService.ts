import { KiteConnect } from 'kiteconnect';
import { Logger } from '../utils/Logger';
import { TradeSetupRequest } from './NiftyBreakoutRetracementStrategy';
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
}

export interface TradingConfig {
  capital: number;              // Current capital (updated after each trade)
  riskPerTrade: number;        // 5% = 0.05
  maxRetries: number;          // 3
  orderTimeout: number;        // 5000ms
  paperTradingMode: boolean;   // true for testing
  niftyLotSize: number;       // 75 for NIFTY
}

export interface PersistedData {
  config: TradingConfig;
  activePosition?: ActivePosition;
  tradeHistory: TradeRecord[];
  lastUpdated: Date;
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

  constructor(kiteConnect: any, logger: Logger) {
    this.kiteConnect = kiteConnect;
    this.logger = logger;
    this.dataFilePath = path.join(__dirname, '../../data/trading-data.json');
    
    // Initialize with default data
    this.persistedData = this.loadPersistedData();
    
    // Ensure data directory exists
    this.ensureDataDirectory();
    
    this.logger.info('🚀 TradeExecutionService initialized');
    this.logger.info(`💰 Current Capital: ₹${this.persistedData.config.capital.toLocaleString()}`);
    if (this.persistedData.activePosition) {
      this.logger.info(`📊 Active Position Found: ${this.persistedData.activePosition.tradeId}`);
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
        capital: 100000,           // ₹1,00,000
        riskPerTrade: 0.05,       // 5%
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

  private async selectATMOption(direction: 'LONG' | 'SHORT', niftyPrice: number): Promise<OptionInstrument> {
    if (this.niftyInstruments.length === 0) {
      await this.loadInstruments();
    }

    const nextTuesdayExpiry = this.getNextTuesdayExpiry();
    const optionType = direction === 'LONG' ? 'CE' : 'PE';
    
    this.logger.info(`🎯 Selecting ${optionType} ATM option for NIFTY price: ₹${niftyPrice}`);
    this.logger.info(`📅 Target expiry: ${nextTuesdayExpiry.toDateString()}`);

    // Find options with correct expiry and type
    const relevantOptions = this.niftyInstruments.filter(opt => {
      const isSameExpiry = Math.abs(opt.expiry.getTime() - nextTuesdayExpiry.getTime()) < 24 * 60 * 60 * 1000; // Within 1 day
      return isSameExpiry && opt.instrument_type === optionType;
    });

    if (relevantOptions.length === 0) {
      throw new Error(`No ${optionType} options found for expiry ${nextTuesdayExpiry.toDateString()}`);
    }

    // Find ATM (strike closest to NIFTY price)
    const atmOption = relevantOptions.reduce((closest, current) => {
      const closestDiff = Math.abs(closest.strike - niftyPrice);
      const currentDiff = Math.abs(current.strike - niftyPrice);
      return currentDiff < closestDiff ? current : closest;
    });

    this.logger.info(`✅ Selected ATM Option: ${atmOption.tradingsymbol} | Strike: ₹${atmOption.strike}`);
    return atmOption;
  }

  // ===========================
  // POSITION SIZING
  // ===========================

  private calculatePositionSize(stopLossPoints: number, optionPrice: number): number {
    const { capital, riskPerTrade, niftyLotSize } = this.persistedData.config;
    const maxRiskAmount = capital * riskPerTrade; // ₹5,000 for 5% of ₹1,00,000
    
    // Risk per lot = SL points × lot size
    const riskPerLot = stopLossPoints * niftyLotSize;
    
    // Maximum lots we can afford
    const maxLots = Math.floor(maxRiskAmount / riskPerLot);
    
    this.logger.info(`📊 Position Sizing Calculation:`);
    this.logger.info(`   💰 Capital: ₹${capital.toLocaleString()}`);
    this.logger.info(`   🎯 Risk per trade: ${(riskPerTrade * 100).toFixed(1)}% = ₹${maxRiskAmount.toLocaleString()}`);
    this.logger.info(`   📉 SL Points: ${stopLossPoints}`);
    this.logger.info(`   💵 Option Price: ₹${optionPrice}`);
    this.logger.info(`   📊 Risk per lot: ${stopLossPoints} × ${niftyLotSize} = ₹${riskPerLot}`);
    this.logger.info(`   🎲 Max lots: ₹${maxRiskAmount} ÷ ₹${riskPerLot} = ${maxLots} lots`);

    return Math.max(1, maxLots); // Minimum 1 lot
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

      // Select ATM option based on underlying price
      const selectedOption = await this.selectATMOption(tradeSetup.direction, tradeSetup.underlyingPrice);
      
      // Get current option price for position sizing
      const optionPrice = await this.getOptionPrice(selectedOption);
      
      // Calculate stop loss points (difference between entry and stop loss levels)
      const stopLossPoints = Math.abs(tradeSetup.entryLevel - tradeSetup.stopLossLevel);
      
      // Calculate position size
      const lotSize = this.calculatePositionSize(stopLossPoints, optionPrice);
      const quantity = lotSize * this.persistedData.config.niftyLotSize;

      // Generate trade ID
      const tradeId = `TRADE_${Date.now()}`;

      if (this.persistedData.config.paperTradingMode) {
        this.logger.info('📝 PAPER TRADING MODE - Simulating order placement');
        const simulatedOrderId = `PAPER_${Date.now()}`;
        
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
          target: tradeSetup.targetLevel
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
          validity: 'DAY'
        };

        this.logger.info('📤 Placing real market order...');
        this.logger.info(`   Order params: ${JSON.stringify(orderParams, null, 2)}`);

        const orderResponse = await this.kiteConnect.placeOrder('regular', orderParams);
        const orderId = orderResponse.order_id;

        // Wait for order confirmation
        await this.waitForOrderConfirmation(orderId);

        // Create active position record
        this.persistedData.activePosition = {
          tradeId,
          entryOrderId: orderId,
          instrument: selectedOption,
          direction: tradeSetup.direction,
          quantity,
          entryPrice: optionPrice, // Will be updated with actual fill price
          entryTime: new Date(),
          stopLoss: tradeSetup.stopLossLevel,
          target: tradeSetup.targetLevel
        };

        this.savePersistedData();

        this.logger.info(`✅ Real order placed successfully`);
        this.logger.info(`   📋 Trade ID: ${tradeId}`);
        this.logger.info(`   🎫 Zerodha Order ID: ${orderId}`);
        this.logger.info(`   📊 Instrument: ${selectedOption.tradingsymbol}`);
        this.logger.info(`   🎲 Quantity: ${quantity} (${lotSize} lots)`);

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

        // Update capital based on P&L
        this.updateCapitalAfterTrade(pnl);

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
          status: 'CLOSED'
        };

        this.persistedData.tradeHistory.push(tradeRecord);
        delete this.persistedData.activePosition;
        this.savePersistedData();

        this.logger.info(`✅ Paper position closed successfully`);
        this.logger.info(`   💰 Exit Price: ₹${currentPrice}`);
        this.logger.info(`   📈 P&L: ₹${pnl > 0 ? '+' : ''}${pnl.toLocaleString()}`);
        this.logger.info(`   💰 New Capital: ₹${this.persistedData.config.capital.toLocaleString()}`);

      } else {
        // Real order to close position
        const closeOrderParams = {
          exchange: position.instrument.exchange,
          tradingsymbol: position.instrument.tradingsymbol,
          transaction_type: 'SELL', // Always SELL to close position
          quantity: position.quantity,
          order_type: 'MARKET',
          product: 'MIS',
          validity: 'DAY'
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
          status: 'CLOSED'
        };

        this.persistedData.tradeHistory.push(tradeRecord);
        delete this.persistedData.activePosition;
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
  // HELPER METHODS
  // ===========================

  private async getOptionPrice(option: OptionInstrument): Promise<number> {
    try {
      if (this.persistedData.config.paperTradingMode) {
        // Return simulated price for paper trading
        return 100 + Math.random() * 50; // ₹100-150 random price
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
        } else if (latestOrder.status === 'REJECTED' || latestOrder.status === 'CANCELLED') {
          throw new Error(`Order ${orderId} was ${latestOrder.status}: ${latestOrder.status_message}`);
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

  private calculatePnL(position: ActivePosition, exitPrice: number): number {
    const { entryPrice, quantity, direction } = position;
    
    if (direction === 'LONG') {
      return (exitPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - exitPrice) * quantity;
    }
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
}