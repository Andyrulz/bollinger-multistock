import { KiteConnect } from 'kiteconnect';
import { Logger } from '../utils/Logger';
import { SessionPersistence } from './SessionPersistence';

export interface SessionData {
  user_type: string;
  email: string;
  user_name: string;
  user_shortname: string;
  broker: string;
  exchanges: string[];
  products: string[];
  order_types: string[];
  avatar_url: string;
  user_id: string;
  api_key: string;
  access_token: string;
  public_token: string;
  refresh_token: string;
  login_time: string;
}

export class AuthService {
  private accessToken?: string;
  private sessionData?: SessionData;
  private sessionPersistence: SessionPersistence;
  private initializationPromise: Promise<void>;

  constructor(
    private kiteConnect: any, // Using any for compatibility
    private logger: Logger
  ) {
    this.sessionPersistence = new SessionPersistence(logger);
    
    // Start session initialization and store the promise
    this.initializationPromise = this.initializeSession().catch(error => {
      this.logger.warn('Failed to initialize session on startup:', error);
    });
  }

  /**
   * Wait for initialization to complete
   */
  public async waitForInitialization(): Promise<void> {
    return this.initializationPromise;
  }

  /**
   * Initialize session on startup - try to restore from persisted storage
   */
  private async initializeSession(): Promise<void> {
    try {
      const persistedSession = await this.sessionPersistence.loadSession();
      
      if (persistedSession) {
        this.accessToken = persistedSession.accessToken;
        this.sessionData = persistedSession.sessionData;
        
        // Set the access token for KiteConnect
        this.kiteConnect.setAccessToken(this.accessToken);
        
        // Validate the token by making a test API call
        await this.validateToken();
        
        this.logger.info(`🔑 Session restored successfully for user: ${this.sessionData.user_name}`);
        this.logger.info(`⏰ Session expires at: ${persistedSession.expiryTime.toLocaleString()}`);
      } else {
        this.logger.info('📝 No valid persisted session found - authentication required');
      }
    } catch (error) {
      this.logger.error('Failed to initialize session:', error);
      // Clear invalid session data
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
    }
  }

  /**
   * Validate current token by making a test API call
   */
  private async validateToken(): Promise<void> {
    try {
      if (!this.accessToken) {
        throw new Error('No access token to validate');
      }

      // Test the token with a lightweight API call
      await this.kiteConnect.getProfile();
      this.logger.debug('✅ Token validation successful');
    } catch (error) {
      this.logger.warn('❌ Token validation failed:', error);
      // Clear invalid token
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
      throw error;
    }
  }

  public getLoginUrl(): string {
    return this.kiteConnect.getLoginURL();
  }

  public async generateSession(requestToken: string): Promise<SessionData> {
    try {
      const apiSecret = process.env.ZERODHA_API_SECRET;
      if (!apiSecret) {
        throw new Error('ZERODHA_API_SECRET environment variable is not set');
      }

      this.logger.info('Generating session with request token');
      const response = await this.kiteConnect.generateSession(requestToken, apiSecret);
      
      this.accessToken = response.access_token;
      this.sessionData = response;
      
      // Set the access token for future API calls
      this.kiteConnect.setAccessToken(this.accessToken);
      
      // Persist the session for future use
      if (this.accessToken && this.sessionData) {
        await this.sessionPersistence.saveSession(this.accessToken, this.sessionData);
      }
      
      this.logger.info(`Session generated and saved successfully for user: ${response.user_name}`);
      return response;
    } catch (error) {
      this.logger.error('Failed to generate session:', error);
      throw error;
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Check if token is both present and valid with the API
   */
  public async isAuthenticatedAndValid(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }

    try {
      // Test with a lightweight API call
      await this.kiteConnect.getProfile();
      return true;
    } catch (error) {
      this.logger.warn('❌ Token validation failed during auth check:', error);
      // Clear invalid token
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
      return false;
    }
  }

  public getAccessToken(): string | undefined {
    return this.accessToken;
  }

  public getSessionData(): SessionData | undefined {
    return this.sessionData;
  }

  public async getProfile() {
    try {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated. Please generate session first.');
      }

      const profile = await this.kiteConnect.getProfile();
      this.logger.info('Profile retrieved successfully');
      return profile;
    } catch (error) {
      this.logger.error('Failed to get profile:', error);
      throw error;
    }
  }

  public async invalidateSession(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.kiteConnect.invalidateAccessToken(this.accessToken);
        delete this.accessToken;
        delete this.sessionData;
        
        // Clear persisted session
        await this.sessionPersistence.clearSession();
        
        this.logger.info('Session invalidated and cleared successfully');
      }
    } catch (error) {
      this.logger.error('Failed to invalidate session:', error);
      throw error;
    }
  }

  /**
   * Get session persistence info for debugging
   */
  public async getSessionInfo(): Promise<{ 
    authenticated: boolean; 
    userName?: string; 
    persistedSession: { exists: boolean; expiresAt?: Date; createdAt?: Date } 
  }> {
    const persistedInfo = await this.sessionPersistence.getSessionInfo();
    
    const result: {
      authenticated: boolean; 
      userName?: string; 
      persistedSession: { exists: boolean; expiresAt?: Date; createdAt?: Date } 
    } = {
      authenticated: this.isAuthenticated(),
      persistedSession: persistedInfo
    };

    if (this.sessionData?.user_name) {
      result.userName = this.sessionData.user_name;
    }

    return result;
  }
}