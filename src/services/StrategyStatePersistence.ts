import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { Logger } from '../utils/Logger';
import {
  StrategyState,
  Candle,
  PivotPoint,
  BreakoutSignal,
  MarkingCandleState,
  TradeState,
  TradeSetupRequest,
  NiftyFuturesData
} from '../strategies/breakout-pullback/BreakoutPullbackStrategy';

// Interface for persisted strategy state
export interface PersistedStrategyState {
  // Core strategy state
  isActive: boolean;
  currentContract?: NiftyFuturesData | undefined;
  tradeState: TradeState;
  currentTradeId?: string | undefined;
  tradeSetupRequest?: TradeSetupRequest | undefined;
  
  // Historical data (CRITICAL - takes time to rebuild)
  candles: Candle[]; // 5-minute candles (pivot detection)
  oneMinuteCandles: Candle[]; // 1-minute candles (volume SMA50)
  
  // Pivot detection state (CRITICAL - expensive to recalculate)
  latestPivotHigh?: PivotPoint | undefined;
  latestPivotLow?: PivotPoint | undefined;
  
  // Breakout & volume state (CRITICAL - real-time dependent)
  latestBreakoutSignal?: BreakoutSignal | undefined;
  markingCandleState: MarkingCandleState;
  currentVolumeSMA50: number;
  lastCumulativeVolume: number;
  currentMinuteAccumulatedVolume: number;
  lastProcessedOneMinuteCandleTime?: Date | undefined;
  
  // Timestamps for validation
  lastUpdateTime: Date;
  lastPersistTime: Date;
  version: string; // For future compatibility
}

// Encrypted storage format
interface EncryptedStateFile {
  data: string; // encrypted strategy state
  iv: string;   // initialization vector
  timestamp: string;
  version: string;
}

// Compressed candles cache format
interface CandlesCache {
  candles5m: Candle[];
  candles1m: Candle[];
  timestamp: Date;
  contract?: NiftyFuturesData | undefined;
}

export class StrategyStatePersistence {
  private readonly stateFilePath: string;
  private readonly backupFilePath: string;
  private readonly candlesCachePath: string;
  private readonly logger: Logger;
  private readonly encryptionKey: string;
  private readonly version = '1.0.0';

  constructor(logger: Logger) {
    this.logger = logger;
    
    // Setup file paths
    this.stateFilePath = path.join(__dirname, '../../data/strategy/strategy-state.json');
    this.backupFilePath = path.join(__dirname, '../../data/strategy/strategy-backup.json');
    this.candlesCachePath = path.join(__dirname, '../../data/strategy/candles-cache.json');
    
    // Generate consistent encryption key from API credentials + strategy salt
    const apiKey = process.env.ZERODHA_API_KEY || '';
    const apiSecret = process.env.ZERODHA_API_SECRET || '';
    this.encryptionKey = crypto.createHash('sha256')
      .update(apiKey + apiSecret + 'nifty_strategy_state_key')
      .digest('hex');
    
    this.ensureStrategyDirectory();
  }

  /**
   * Ensure strategy directory exists with proper permissions
   */
  private ensureStrategyDirectory(): void {
    const strategyDir = path.dirname(this.stateFilePath);
    
    if (!fs.existsSync(strategyDir)) {
      fs.mkdirSync(strategyDir, { recursive: true, mode: 0o700 });
      this.logger.info('📁 Created secure strategy state directory');
    }
  }

  /**
   * Encrypt strategy state data for secure storage
   */
  private encryptStateData(stateData: PersistedStrategyState): EncryptedStateFile {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey.slice(0, 32)), iv);
    
    let encrypted = cipher.update(JSON.stringify(stateData), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      data: encrypted,
      iv: iv.toString('hex'),
      timestamp: new Date().toISOString(),
      version: this.version
    };
  }

  /**
   * Decrypt strategy state data from storage
   */
  private decryptStateData(encryptedFile: EncryptedStateFile): PersistedStrategyState | null {
    try {
      const iv = Buffer.from(encryptedFile.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey.slice(0, 32)), iv);
      let decrypted = decipher.update(encryptedFile.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const stateData = JSON.parse(decrypted);
      
      // Convert date strings back to Date objects
      this.convertStringDatesToObjects(stateData);
      
      return stateData;
    } catch (error) {
      this.logger.error('❌ Failed to decrypt strategy state data:', error);
      return null;
    }
  }

  /**
   * Convert date strings back to Date objects after deserialization
   */
  private convertStringDatesToObjects(stateData: any): void {
    // Convert main timestamps
    if (stateData.lastUpdateTime) stateData.lastUpdateTime = new Date(stateData.lastUpdateTime);
    if (stateData.lastPersistTime) stateData.lastPersistTime = new Date(stateData.lastPersistTime);
    if (stateData.lastProcessedOneMinuteCandleTime) {
      stateData.lastProcessedOneMinuteCandleTime = new Date(stateData.lastProcessedOneMinuteCandleTime);
    }
    
    // Convert contract expiry
    if (stateData.currentContract?.expiry) {
      stateData.currentContract.expiry = new Date(stateData.currentContract.expiry);
    }
    
    // Convert candle timestamps
    stateData.candles?.forEach((candle: any) => {
      if (candle.timestamp) candle.timestamp = new Date(candle.timestamp);
    });
    stateData.oneMinuteCandles?.forEach((candle: any) => {
      if (candle.timestamp) candle.timestamp = new Date(candle.timestamp);
    });
    
    // Convert pivot point timestamps
    if (stateData.latestPivotHigh?.timestamp) {
      stateData.latestPivotHigh.timestamp = new Date(stateData.latestPivotHigh.timestamp);
    }
    if (stateData.latestPivotLow?.timestamp) {
      stateData.latestPivotLow.timestamp = new Date(stateData.latestPivotLow.timestamp);
    }
    
    // Convert breakout signal timestamp
    if (stateData.latestBreakoutSignal?.timestamp) {
      stateData.latestBreakoutSignal.timestamp = new Date(stateData.latestBreakoutSignal.timestamp);
    }
    
    // Convert marking candle state timestamps
    if (stateData.markingCandleState) {
      const mcs = stateData.markingCandleState;
      if (mcs.startTime) mcs.startTime = new Date(mcs.startTime);
      if (mcs.breakoutReference?.timestamp) {
        mcs.breakoutReference.timestamp = new Date(mcs.breakoutReference.timestamp);
      }
      if (mcs.currentMarkingCandle) {
        if (mcs.currentMarkingCandle.candle?.timestamp) {
          mcs.currentMarkingCandle.candle.timestamp = new Date(mcs.currentMarkingCandle.candle.timestamp);
        }
        if (mcs.currentMarkingCandle.detectedAt) {
          mcs.currentMarkingCandle.detectedAt = new Date(mcs.currentMarkingCandle.detectedAt);
        }
      }
    }
    
    // Convert trade setup request timestamp
    if (stateData.tradeSetupRequest?.timestamp) {
      stateData.tradeSetupRequest.timestamp = new Date(stateData.tradeSetupRequest.timestamp);
    }
  }

  /**
   * Validate strategy state integrity
   */
  public validateStateIntegrity(state: PersistedStrategyState): boolean {
    try {
      // Check version compatibility
      if (!state.version || state.version !== this.version) {
        this.logger.warn(`⚠️ State version mismatch: ${state.version} vs ${this.version}`);
        return false;
      }
      
      // Check data freshness (not older than 24 hours)
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in ms
      if (state.lastUpdateTime && (Date.now() - state.lastUpdateTime.getTime()) > maxAge) {
        this.logger.warn('⚠️ Strategy state is older than 24 hours');
        return false;
      }
      
      // Check contract validity (not expired)
      if (state.currentContract?.expiry && state.currentContract.expiry < new Date()) {
        this.logger.warn('⚠️ Contract has expired');
        return false;
      }
      
      // Check candle data integrity
      if (state.candles && state.candles.length > 0) {
        // Ensure candles are chronologically ordered
        for (let i = 1; i < state.candles.length; i++) {
          const currentCandle = state.candles[i];
          const prevCandle = state.candles[i - 1];
          if (currentCandle && prevCandle && currentCandle.timestamp <= prevCandle.timestamp) {
            this.logger.warn('⚠️ 5m candles are not chronologically ordered');
            return false;
          }
        }
      }
      
      if (state.oneMinuteCandles && state.oneMinuteCandles.length > 0) {
        // Ensure 1m candles are chronologically ordered
        for (let i = 1; i < state.oneMinuteCandles.length; i++) {
          const currentCandle = state.oneMinuteCandles[i];
          const prevCandle = state.oneMinuteCandles[i - 1];
          if (currentCandle && prevCandle && currentCandle.timestamp <= prevCandle.timestamp) {
            this.logger.warn('⚠️ 1m candles are not chronologically ordered');
            return false;
          }
        }
      }
      
      // Check volume SMA50 bounds (reasonable values)
      if (state.currentVolumeSMA50 < 0 || state.currentVolumeSMA50 > 1000000000) {
        this.logger.warn(`⚠️ Volume SMA50 out of bounds: ${state.currentVolumeSMA50}`);
        return false;
      }
      
      // Check trade state consistency
      if (!Object.values(TradeState).includes(state.tradeState)) {
        this.logger.warn(`⚠️ Invalid trade state: ${state.tradeState}`);
        return false;
      }
      
      this.logger.debug('✅ Strategy state integrity validation passed');
      return true;
      
    } catch (error) {
      this.logger.error('❌ Strategy state validation error:', error);
      return false;
    }
  }

  /**
   * Save strategy state to encrypted file
   */
  public async saveStrategyState(state: PersistedStrategyState): Promise<void> {
    try {
      // Update timestamps
      state.lastPersistTime = new Date();
      state.version = this.version;
      
      // Create backup of existing state first
      await this.createBackup();
      
      // Encrypt and save
      const encryptedData = this.encryptStateData(state);
      const tempFilePath = this.stateFilePath + '.tmp';
      
      // Write to temporary file first (atomic operation)
      fs.writeFileSync(tempFilePath, JSON.stringify(encryptedData, null, 2), { mode: 0o600 });
      
      // Atomic rename
      fs.renameSync(tempFilePath, this.stateFilePath);
      
      this.logger.debug(`💾 Strategy state saved successfully (${this.getFileSizeKB(this.stateFilePath)} KB)`);
      
    } catch (error) {
      this.logger.error('❌ Failed to save strategy state:', error);
      throw error;
    }
  }

  /**
   * Load strategy state from encrypted file
   */
  public async loadStrategyState(): Promise<PersistedStrategyState | null> {
    try {
      // Try primary state file first
      let stateData = await this.loadStateFromFile(this.stateFilePath);
      
      if (!stateData) {
        this.logger.warn('⚠️ Primary state file failed, trying backup...');
        stateData = await this.loadStateFromFile(this.backupFilePath);
      }
      
      if (!stateData) {
        this.logger.info('📝 No valid strategy state found, will start fresh');
        return null;
      }
      
      // Validate integrity
      if (!this.validateStateIntegrity(stateData)) {
        this.logger.warn('⚠️ State validation failed, will start fresh');
        return null;
      }
      
      this.logger.info(`🔄 Strategy state loaded successfully (${this.getFileSizeKB(this.stateFilePath)} KB)`);
      return stateData;
      
    } catch (error) {
      this.logger.error('❌ Failed to load strategy state:', error);
      return null;
    }
  }

  /**
   * Load state from specific file
   */
  private async loadStateFromFile(filePath: string): Promise<PersistedStrategyState | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const encryptedFile: EncryptedStateFile = JSON.parse(fileContent);
      
      return this.decryptStateData(encryptedFile);
      
    } catch (error) {
      this.logger.error(`❌ Failed to load state from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Create backup of current state
   */
  public async createBackup(): Promise<void> {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.copyFileSync(this.stateFilePath, this.backupFilePath);
        this.logger.debug('📋 Strategy state backup created');
      }
    } catch (error) {
      this.logger.error('❌ Failed to create backup:', error);
      // Don't throw - backup failure shouldn't prevent saving
    }
  }

  /**
   * Save compressed candles cache separately for performance
   */
  public async saveCandlesCache(candles1m: Candle[], candles5m: Candle[], contract?: NiftyFuturesData): Promise<void> {
    try {
      const cacheData: CandlesCache = {
        candles1m,
        candles5m,
        timestamp: new Date(),
        contract
      };
      
      // Compress the data
      const compressed = zlib.gzipSync(JSON.stringify(cacheData));
      
      fs.writeFileSync(this.candlesCachePath, compressed, { mode: 0o600 });
      
      this.logger.debug(`💾 Candles cache saved (${candles5m.length} 5m, ${candles1m.length} 1m candles, ${Math.round(compressed.length / 1024)} KB compressed)`);
      
    } catch (error) {
      this.logger.error('❌ Failed to save candles cache:', error);
      // Don't throw - cache save failure shouldn't be fatal
    }
  }

  /**
   * Load compressed candles cache
   */
  public async loadCandlesCache(): Promise<CandlesCache | null> {
    try {
      if (!fs.existsSync(this.candlesCachePath)) {
        return null;
      }
      
      const compressed = fs.readFileSync(this.candlesCachePath);
      const decompressed = zlib.gunzipSync(compressed);
      const cacheData: CandlesCache = JSON.parse(decompressed.toString());
      
      // Convert timestamps
      if (cacheData.timestamp) cacheData.timestamp = new Date(cacheData.timestamp);
      if (cacheData.contract?.expiry) cacheData.contract.expiry = new Date(cacheData.contract.expiry);
      
      cacheData.candles1m?.forEach(candle => {
        if (candle.timestamp) candle.timestamp = new Date(candle.timestamp);
      });
      cacheData.candles5m?.forEach(candle => {
        if (candle.timestamp) candle.timestamp = new Date(candle.timestamp);
      });
      
      this.logger.debug(`🔄 Candles cache loaded (${cacheData.candles5m?.length || 0} 5m, ${cacheData.candles1m?.length || 0} 1m candles)`);
      return cacheData;
      
    } catch (error) {
      this.logger.error('❌ Failed to load candles cache:', error);
      return null;
    }
  }

  /**
   * Get file size in KB for logging
   */
  private getFileSizeKB(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return Math.round(stats.size / 1024);
    } catch {
      return 0;
    }
  }

  /**
   * Cleanup old backup files
   */
  public async cleanupOldBackups(): Promise<void> {
    try {
      // This is a simple implementation - in production you might keep multiple backups
      // For now, we just ensure the directory is clean of temp files
      const strategyDir = path.dirname(this.stateFilePath);
      const files = fs.readdirSync(strategyDir);
      
      files.forEach(file => {
        if (file.endsWith('.tmp')) {
          const fullPath = path.join(strategyDir, file);
          fs.unlinkSync(fullPath);
          this.logger.debug(`🗑️ Cleaned up temp file: ${file}`);
        }
      });
      
    } catch (error) {
      this.logger.error('❌ Failed to cleanup old backups:', error);
      // Don't throw - cleanup failure shouldn't be fatal
    }
  }

  /**
   * Convert strategy state to persistable format
   */
  public convertStrategyStateToPersistedFormat(strategyState: StrategyState): PersistedStrategyState {
    return {
      // Core strategy state
      isActive: strategyState.isActive,
      currentContract: strategyState.currentContract,
      tradeState: strategyState.tradeState,
      currentTradeId: strategyState.currentTradeId,
      tradeSetupRequest: strategyState.tradeSetupRequest,
      
      // Historical data
      candles: [...strategyState.candles], // Create copies to avoid reference issues
      oneMinuteCandles: [...strategyState.oneMinuteCandles],
      
      // Pivot detection state
      latestPivotHigh: strategyState.latestPivotHigh,
      latestPivotLow: strategyState.latestPivotLow,
      
      // Breakout & volume state
      latestBreakoutSignal: strategyState.latestBreakoutSignal,
      markingCandleState: { ...strategyState.markingCandleState },
      currentVolumeSMA50: strategyState.currentVolumeSMA50,
      lastCumulativeVolume: strategyState.lastCumulativeVolume,
      currentMinuteAccumulatedVolume: strategyState.currentMinuteAccumulatedVolume,
      lastProcessedOneMinuteCandleTime: strategyState.lastProcessedOneMinuteCandleTime,
      
      // Timestamps
      lastUpdateTime: new Date(),
      lastPersistTime: new Date(),
      version: this.version
    };
  }
}