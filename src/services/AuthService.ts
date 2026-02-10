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

  // Validation caching to avoid hammering Zerodha API on every dashboard load
  private lastValidationTime: number = 0;
  private lastValidationResult: boolean = false;
  private readonly VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
        
        // Populate validation cache so first dashboard load doesn't trigger another getProfile()
        this.lastValidationResult = true;
        this.lastValidationTime = Date.now();
        
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
      this.lastValidationResult = false;
      this.lastValidationTime = 0;
      await this.sessionPersistence.clearSession();
    }
  }

  /**
   * Check if an error is transient (network/timeout) vs auth-related (token invalid).
   * Transient errors should NOT trigger session destruction.
   */
  private isTransientError(error: any): boolean {
    // Network/timeout errors — session is fine, network isn't
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.code === 'ENOTFOUND') {
      return true;
    }
    // KiteConnect wraps server errors as NetworkException (not auth-related)
    if (error?.error_type === 'NetworkException') {
      return true;
    }
    // Axios network errors with no response received
    if (error?.message && /network|timeout|socket/i.test(error.message) && !error?.error_type) {
      return true;
    }
    return false;
  }

  /**
   * Validate current token by making a test API call.
   * Only clears session on genuine auth errors (TokenException), NOT on transient network issues.
   */
  private async validateToken(): Promise<void> {
    try {
      if (!this.accessToken) {
        throw new Error('No access token to validate');
      }

      // Test the token with a lightweight API call
      await this.kiteConnect.getProfile();
      this.logger.debug('✅ Token validation successful');
    } catch (error: any) {
      if (this.isTransientError(error)) {
        // Network issue — do NOT destroy the session, just warn
        this.logger.warn(`⚠️ Token validation skipped (transient error: ${error.code || error.error_type || error.message}). Keeping session intact.`);
        // Don't throw — treat as "assume valid" so startup continues
        return;
      }
      // Genuine auth error (TokenException, 403, etc.) — clear session
      this.logger.warn('❌ Token validation failed (auth error):', error);
      delete this.accessToken;
      delete this.sessionData;
      this.lastValidationResult = false;
      this.lastValidationTime = 0;
      await this.sessionPersistence.clearSession();
      throw error;
    }
  }

  public getLoginUrl(): string {
    return this.kiteConnect.getLoginURL();
  }

  public async generateSession(requestToken: string): Promise<SessionData> {
    const apiSecret = process.env.ZERODHA_API_SECRET;
    if (!apiSecret) {
      throw new Error('ZERODHA_API_SECRET environment variable is not set');
    }

    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Generating session with request token (attempt ${attempt}/${maxRetries})`);
        const response = await this.kiteConnect.generateSession(requestToken, apiSecret);
        
        this.accessToken = response.access_token;
        this.sessionData = response;
        
        // Set the access token for future API calls
        this.kiteConnect.setAccessToken(this.accessToken);
        
        // Persist the session for future use
        if (this.accessToken && this.sessionData) {
          await this.sessionPersistence.saveSession(this.accessToken, this.sessionData);
        }
        
        // Reset validation cache on new session
        this.lastValidationResult = true;
        this.lastValidationTime = Date.now();
        
        this.logger.info(`Session generated and saved successfully for user: ${response.user_name}`);
        return response;
      } catch (error: any) {
        if (this.isTransientError(error) && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          this.logger.warn(`⚠️ generateSession attempt ${attempt} failed (transient: ${error.code || error.error_type || error.message}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        this.logger.error(`Failed to generate session (attempt ${attempt}):`, error);
        throw error;
      }
    }
    // TypeScript requires a return — this line is unreachable due to throw in final iteration
    throw new Error('generateSession: exhausted all retries');
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Check if token is both present and valid with the API.
   * Uses a cache to avoid hammering Zerodha API on every dashboard/status request.
   * Only clears session on genuine auth errors, not transient network issues.
   */
  public async isAuthenticatedAndValid(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }

    // Return cached result if still fresh
    const now = Date.now();
    if (this.lastValidationResult && (now - this.lastValidationTime) < this.VALIDATION_CACHE_TTL) {
      return true;
    }

    try {
      // Test with a lightweight API call
      await this.kiteConnect.getProfile();
      this.lastValidationResult = true;
      this.lastValidationTime = now;
      return true;
    } catch (error: any) {
      if (this.isTransientError(error)) {
        // Network issue — do NOT destroy the session
        this.logger.warn(`⚠️ Auth validation skipped (transient: ${error.code || error.error_type || error.message}). Assuming session is still valid.`);
        // If we had a previous successful validation, trust it
        if (this.lastValidationResult) {
          return true;
        }
        // Never validated successfully — can't assume valid, but don't clear either
        return false;
      }
      // Genuine auth error (TokenException, 403, expired token)
      this.logger.warn('❌ Token validation failed (auth error) during auth check:', error);
      delete this.accessToken;
      delete this.sessionData;
      this.lastValidationResult = false;
      this.lastValidationTime = 0;
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
        // Best-effort remote invalidation — don't let failure block local cleanup
        try {
          await this.kiteConnect.invalidateAccessToken(this.accessToken);
        } catch (remoteError) {
          this.logger.warn('Remote token invalidation failed (continuing with local cleanup):', remoteError);
        }

        delete this.accessToken;
        delete this.sessionData;
        this.lastValidationResult = false;
        this.lastValidationTime = 0;
        
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
   * Clear session when KiteConnect's session expiry hook fires.
   * This is triggered by the library itself when it detects a TokenException.
   */
  public async clearSessionOnExpiry(): Promise<void> {
    this.logger.warn('🔒 Session expiry hook triggered by KiteConnect — clearing session');
    delete this.accessToken;
    delete this.sessionData;
    this.lastValidationResult = false;
    this.lastValidationTime = 0;
    await this.sessionPersistence.clearSession();
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