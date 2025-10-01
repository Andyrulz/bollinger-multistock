import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { SessionData } from './AuthService';

// Interface for persisted session data
export interface PersistedSession {
  accessToken: string;
  sessionData: SessionData;
  expiryTime: Date;
  createdAt: Date;
  lastValidated: Date;
}

// Encrypted storage format
interface EncryptedSessionFile {
  data: string; // encrypted session data
  iv: string;   // initialization vector
  timestamp: string;
}

export class SessionPersistence {
  private readonly sessionFilePath: string;
  private readonly logger: Logger;
  private readonly encryptionKey: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.sessionFilePath = path.join(__dirname, '../../data/auth/session.json');
    
    // Generate consistent encryption key from API credentials
    // This ensures same key across restarts while keeping it secure
    const apiKey = process.env.ZERODHA_API_KEY || '';
    const apiSecret = process.env.ZERODHA_API_SECRET || '';
    this.encryptionKey = crypto.createHash('sha256')
      .update(apiKey + apiSecret + 'trading_bot_session_key')
      .digest('hex');
    
    this.ensureSessionDirectory();
  }

  /**
   * Ensure session directory exists with proper permissions
   */
  private ensureSessionDirectory(): void {
    const sessionDir = path.dirname(this.sessionFilePath);
    
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      this.logger.info('📁 Created secure session directory');
    }
  }

  /**
   * Encrypt session data for secure storage
   */
  private encryptSessionData(sessionData: PersistedSession): EncryptedSessionFile {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey.slice(0, 32)), iv);
    
    let encrypted = cipher.update(JSON.stringify(sessionData), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      data: encrypted,
      iv: iv.toString('hex'),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Decrypt session data from storage
   */
  private decryptSessionData(encryptedFile: EncryptedSessionFile): PersistedSession | null {
    try {
      const iv = Buffer.from(encryptedFile.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey.slice(0, 32)), iv);
      let decrypted = decipher.update(encryptedFile.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const sessionData = JSON.parse(decrypted);
      
      // Convert date strings back to Date objects
      sessionData.expiryTime = new Date(sessionData.expiryTime);
      sessionData.createdAt = new Date(sessionData.createdAt);
      sessionData.lastValidated = new Date(sessionData.lastValidated);
      
      return sessionData;
    } catch (error) {
      this.logger.error('❌ Failed to decrypt session data:', error);
      return null;
    }
  }

  /**
   * Save session to encrypted file
   */
  public async saveSession(accessToken: string, sessionData: SessionData): Promise<void> {
    try {
      const now = new Date();
      
      // Zerodha tokens expire at 6 AM the next day
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(6, 0, 0, 0);
      
      const persistedSession: PersistedSession = {
        accessToken,
        sessionData,
        expiryTime: tomorrow,
        createdAt: now,
        lastValidated: now
      };

      const encryptedData = this.encryptSessionData(persistedSession);
      
      // Write to file with secure permissions
      fs.writeFileSync(this.sessionFilePath, JSON.stringify(encryptedData, null, 2), { 
        mode: 0o600 // Read/write for owner only
      });
      
      this.logger.info(`💾 Session saved securely - expires at ${tomorrow.toLocaleString()}`);
    } catch (error) {
      this.logger.error('❌ Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Load and validate session from file
   */
  public async loadSession(): Promise<PersistedSession | null> {
    try {
      if (!fs.existsSync(this.sessionFilePath)) {
        this.logger.debug('📂 No saved session found');
        return null;
      }

      const fileContent = fs.readFileSync(this.sessionFilePath, 'utf8');
      const encryptedFile: EncryptedSessionFile = JSON.parse(fileContent);
      
      const session = this.decryptSessionData(encryptedFile);
      if (!session) {
        this.logger.warn('⚠️ Failed to decrypt saved session');
        await this.clearSession(); // Remove corrupted session
        return null;
      }

      // Check if session has expired
      const now = new Date();
      if (now > session.expiryTime) {
        this.logger.info('⏰ Saved session has expired - clearing');
        await this.clearSession();
        return null;
      }

      // Update last validated timestamp (in memory only, don't re-save during load)
      session.lastValidated = now;
      
      this.logger.info(`🔑 Loaded valid session - expires at ${session.expiryTime.toLocaleString()}`);
      return session;
      
    } catch (error) {
      this.logger.error('❌ Failed to load session:', error);
      await this.clearSession(); // Clean up on error
      return null;
    }
  }

  /**
   * Clear saved session
   */
  public async clearSession(): Promise<void> {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
        this.logger.info('🗑️ Session cleared');
      }
    } catch (error) {
      this.logger.error('❌ Failed to clear session:', error);
    }
  }

  /**
   * Check if we have a valid saved session
   */
  public async hasValidSession(): Promise<boolean> {
    const session = await this.loadSession();
    return session !== null;
  }

  /**
   * Get session info for debugging
   */
  public async getSessionInfo(): Promise<{ exists: boolean; expiresAt?: Date; createdAt?: Date }> {
    const session = await this.loadSession();
    
    if (!session) {
      return { exists: false };
    }

    return {
      exists: true,
      expiresAt: session.expiryTime,
      createdAt: session.createdAt
    };
  }
}