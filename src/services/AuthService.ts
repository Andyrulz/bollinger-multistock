import { KiteConnect } from 'kiteconnect';
import { Logger } from '../utils/Logger';

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

  constructor(
    private kiteConnect: any, // Using any for compatibility
    private logger: Logger
  ) {}

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
      
      this.logger.info(`Session generated successfully for user: ${response.user_name}`);
      return response;
    } catch (error) {
      this.logger.error('Failed to generate session:', error);
      throw error;
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
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
        this.logger.info('Session invalidated successfully');
      }
    } catch (error) {
      this.logger.error('Failed to invalidate session:', error);
      throw error;
    }
  }
}