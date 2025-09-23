import { KiteConnect } from 'kiteconnect';
import { AuthService } from './services/AuthService';
import { NiftyFuturesStrategy, TickData } from './services/NiftyFuturesStrategy';
import { NiftyBreakoutRetracementStrategy } from './services/NiftyBreakoutRetracementStrategy';
import { Logger } from './utils/Logger';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class TradingBot {
  private kiteConnect: any; // Using any for now due to type complexity
  private authService: AuthService;
  private niftyStrategy: NiftyFuturesStrategy;
  private breakoutStrategy: NiftyBreakoutRetracementStrategy;
  private logger: Logger;
  private app: express.Application;
  private latestTick?: TickData;

  constructor() {
    this.logger = new Logger();
    this.app = express();
    
    if (!process.env.ZERODHA_API_KEY || !process.env.ZERODHA_API_SECRET) {
      throw new Error('ZERODHA_API_KEY and ZERODHA_API_SECRET must be set in environment variables');
    }

    this.kiteConnect = new KiteConnect({
      api_key: process.env.ZERODHA_API_KEY
    });

    this.authService = new AuthService(this.kiteConnect, this.logger);
    this.niftyStrategy = new NiftyFuturesStrategy(this.kiteConnect, this.logger);
    this.breakoutStrategy = new NiftyBreakoutRetracementStrategy(this.kiteConnect, this.logger, this.niftyStrategy);

    // Set up price update callback
    this.niftyStrategy.onPriceUpdate((tick: TickData) => {
      this.latestTick = tick;
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'OK', timestamp: new Date().toISOString() });
    });

    // Authentication status endpoint
    this.app.get('/auth/status', (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const sessionData = this.authService.getSessionData();
      
      res.json({
        authenticated: isAuthenticated,
        user: sessionData ? sessionData.user_name : null,
        loginTime: sessionData ? sessionData.login_time : null,
        message: isAuthenticated 
          ? 'Bot is authenticated and ready for trading'
          : 'Bot is not authenticated. Visit /auth/login to authenticate.'
      });
    });

    // Help endpoint - now serves beautiful HTML instead of JSON
    this.app.get('/', (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const sessionData = this.authService.getSessionData();
      
      const htmlResponse = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zerodha Trading Bot</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .dashboard {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 40px;
            max-width: 800px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .logo {
            font-size: 3.5rem;
            margin-bottom: 10px;
        }
        
        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: #2d3748;
            margin-bottom: 10px;
            letter-spacing: -0.02em;
        }
        
        .subtitle {
            color: #718096;
            font-size: 1.1rem;
            font-weight: 400;
        }
        
        .status-card {
            background: linear-gradient(135deg, #f7fafc, #edf2f7);
            border-radius: 16px;
            padding: 24px;
            margin: 30px 0;
            border: 1px solid #e2e8f0;
            position: relative;
            overflow: hidden;
        }
        
        .status-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
        }
        
        .status-card.success {
            background: linear-gradient(135deg, #f0fff4, #e6fffa);
            border-color: #68d391;
        }
        
        .status-card.success::before {
            background: linear-gradient(90deg, #48bb78, #38b2ac);
        }
        
        .status-card.warning {
            background: linear-gradient(135deg, #fffbf0, #fef5e7);
            border-color: #f6e05e;
        }
        
        .status-card.warning::before {
            background: linear-gradient(90deg, #f6e05e, #ed8936);
        }
        
        .status-text {
            font-size: 1.2rem;
            font-weight: 600;
            color: #2d3748;
            text-align: center;
        }
        
        .actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 40px 0;
        }
        
        .action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 18px 24px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            border-radius: 16px;
            font-weight: 600;
            font-size: 1rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
        }
        
        .action-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 30px rgba(102, 126, 234, 0.4);
            text-decoration: none;
            color: white;
        }
        
        .action-btn.primary {
            background: linear-gradient(135deg, #4299e1, #3182ce);
            box-shadow: 0 4px 20px rgba(66, 153, 225, 0.3);
        }
        
        .action-btn.success {
            background: linear-gradient(135deg, #48bb78, #38a169);
            box-shadow: 0 4px 20px rgba(72, 187, 120, 0.3);
        }
        
        .action-btn.info {
            background: linear-gradient(135deg, #38b2ac, #319795);
            box-shadow: 0 4px 20px rgba(56, 178, 172, 0.3);
        }
        
        .endpoints-section {
            background: #f8fafc;
            border-radius: 20px;
            padding: 30px;
            margin: 30px 0;
            border: 1px solid #e2e8f0;
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: #2d3748;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .endpoint-list {
            display: grid;
            gap: 12px;
        }
        
        .endpoint {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px 20px;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            text-decoration: none;
            color: #4a5568;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 0.9rem;
            transition: all 0.2s ease;
        }
        
        .endpoint:hover {
            background: #f7fafc;
            border-color: #cbd5e0;
            transform: translateX(4px);
            text-decoration: none;
            color: #2d3748;
        }
        
        .endpoint .method {
            background: #667eea;
            color: white;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
            min-width: 50px;
            text-align: center;
        }
        
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
        }
        
        .footer-text {
            color: #718096;
            font-size: 0.95rem;
            line-height: 1.6;
        }
        
        .footer-text a {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
        }
        
        @media (max-width: 640px) {
            .dashboard {
                padding: 24px;
                margin: 10px;
            }
            
            h1 {
                font-size: 2rem;
            }
            
            .logo {
                font-size: 2.5rem;
            }
            
            .actions-grid {
                grid-template-columns: 1fr;
                gap: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <div class="logo">🤖</div>
            <h1>Zerodha Trading Bot</h1>
            <p class="subtitle">Your intelligent trading companion</p>
        </div>
        
        <div class="status-card ${isAuthenticated ? 'success' : 'warning'}">
            <div class="status-text">
                ${isAuthenticated 
                  ? `✅ <strong>Authenticated</strong> as ${sessionData?.user_name || 'User'}` 
                  : '⚠️ <strong>Not Authenticated</strong> - Click "Daily Login" to start'
                }
            </div>
        </div>

        ${isAuthenticated ? `
        <div class="status-card">
            <div class="status-text">
                📈 <strong>Nifty Futures Strategy</strong><br>
                <small style="font-weight: normal; opacity: 0.8;">
                    Current Month Contract | Real-time Price Streaming Available
                </small>
            </div>
        </div>
        ` : ''}

        <div class="actions-grid">
            <a href="/auth/login" class="action-btn primary">
                🔐 Daily Login
            </a>
            <a href="/auth/status" class="action-btn info">
                📊 Check Status
            </a>
            <a href="/portfolio" class="action-btn success">
                💼 Portfolio
            </a>
            <a href="/health" class="action-btn">
                ❤️ Health Check
            </a>
            ${isAuthenticated ? `
            <a href="/strategy/nifty/contract" class="action-btn" style="background: linear-gradient(135deg, #f093fb, #f5576c);">
                📈 Nifty Contract
            </a>
            <a href="/strategy/status" class="action-btn" style="background: linear-gradient(135deg, #4facfe, #00f2fe);">
                🎯 Strategy Status
            </a>
            <a href="/breakout-strategy" class="action-btn" style="background: linear-gradient(135deg, #a8edea, #fed6e3);">
                📊 Breakout Strategy
            </a>
            ` : ''}
        </div>

        <div class="endpoints-section">
            <h3 class="section-title">
                📡 API Endpoints
            </h3>
            <div class="endpoint-list">
                <a href="/" class="endpoint">
                    <span class="method">GET</span>
                    <span>/ (This Dashboard)</span>
                </a>
                <a href="/health" class="endpoint">
                    <span class="method">GET</span>
                    <span>/health (Health Check)</span>
                </a>
                <a href="/auth/status" class="endpoint">
                    <span class="method">GET</span>
                    <span>/auth/status (Authentication Status)</span>
                </a>
                <a href="/portfolio" class="endpoint">
                    <span class="method">GET</span>
                    <span>/portfolio (Holdings & Positions)</span>
                </a>
                <a href="/market-data/NSE:RELIANCE" class="endpoint">
                    <span class="method">GET</span>
                    <span>/market-data/NSE:RELIANCE (Live Market Data)</span>
                </a>
                <a href="/strategy/nifty/contract" class="endpoint">
                    <span class="method">GET</span>
                    <span>/strategy/nifty/contract (Current Month Nifty Contract)</span>
                </a>
                <a href="/strategy/nifty/price" class="endpoint">
                    <span class="method">GET</span>
                    <span>/strategy/nifty/price (Live Nifty Price)</span>
                </a>
                <a href="/strategy/nifty/start-stream" class="endpoint">
                    <span class="method">POST</span>
                    <span>/strategy/nifty/start-stream (Start Price Streaming)</span>
                </a>
                <a href="/strategy/nifty/stop-stream" class="endpoint">
                    <span class="method">POST</span>
                    <span>/strategy/nifty/stop-stream (Stop Price Streaming)</span>
                </a>
                <a href="/strategy/status" class="endpoint">
                    <span class="method">GET</span>
                    <span>/strategy/status (Overall Strategy Status)</span>
                </a>
                <a href="/breakout-strategy" class="endpoint">
                    <span class="method">GET</span>
                    <span>/breakout-strategy (Breakout Strategy Dashboard)</span>
                </a>
                <a href="/breakout-strategy/status" class="endpoint">
                    <span class="method">GET</span>
                    <span>/breakout-strategy/status (Breakout Strategy Status)</span>
                </a>
                <a href="/breakout-strategy/pivots" class="endpoint">
                    <span class="method">GET</span>
                    <span>/breakout-strategy/pivots (Latest Pivot Points)</span>
                </a>
            </div>
        </div>

        <div class="footer">
            <div class="footer-text">
                💡 <strong>Daily Routine:</strong> Start bot → Click "Daily Login" → Authenticate → Done!<br>
                📖 This page refreshes automatically to show current status
            </div>
        </div>
    </div>
</body>
</html>
      `;
      
      res.send(htmlResponse);
    });

    // Authentication routes
    this.app.get('/auth/login', (req: Request, res: Response) => {
      try {
        const loginUrl = this.authService.getLoginUrl();
        this.logger.info(`Redirecting to Zerodha login: ${loginUrl}`);
        this.logger.info('After login, you will be redirected back to http://localhost:3000/auth/callback');
        res.redirect(loginUrl);
      } catch (error) {
        this.logger.error('Failed to generate login URL:', error);
        res.status(500).json({ error: 'Failed to generate login URL' });
      }
    });

    this.app.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
      try {
        this.logger.info('Received auth callback with query params:', req.query);
        const requestToken = req.query.request_token as string;
        const status = req.query.status as string;
        
        if (status === 'error') {
          const error = req.query.error as string;
          this.logger.error('Authentication error from Zerodha:', error);
          res.status(400).json({ error: `Authentication failed: ${error}` });
          return;
        }
        
        if (!requestToken) {
          this.logger.error('No request token received in callback');
          res.status(400).json({ error: 'Request token is required' });
          return;
        }

        this.logger.info(`Processing request token: ${requestToken.substring(0, 10)}...`);
        const sessionData = await this.authService.generateSession(requestToken);
        
        this.logger.info('Authentication successful, bot is now ready for trading');
        res.json({ 
          message: 'Authentication successful! Bot is now ready for trading.', 
          user: sessionData.user_name,
          loginTime: sessionData.login_time,
          nextSteps: [
            'Visit /portfolio to see your holdings and positions',
            'Visit /market-data/NSE:RELIANCE to get market data for any symbol',
            'Check the logs for trading activity'
          ]
        });
      } catch (error) {
        this.logger.error('Authentication failed:', error);
        res.status(500).json({ 
          error: 'Authentication failed', 
          details: error instanceof Error ? error.message : 'Unknown error',
          help: 'Make sure your API secret is correct and the request token is valid'
        });
      }
    });

    // Portfolio endpoint (placeholder)
    this.app.get('/portfolio', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Simple portfolio endpoint using direct kiteConnect calls
        const holdings = await this.kiteConnect.getHoldings();
        const positions = await this.kiteConnect.getPositions();
        res.json({ holdings, positions });
      } catch (error) {
        this.logger.error('Failed to fetch portfolio:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
      }
    });

    // Market data endpoint (placeholder)
    this.app.get('/market-data/:symbol', async (req: Request, res: Response): Promise<void> => {
      try {
        const symbol = req.params.symbol;
        if (!symbol) {
          res.status(400).json({ error: 'Symbol is required' });
          return;
        }
        
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }
        
        // Simple market data using direct kiteConnect calls
        const quote = await this.kiteConnect.getQuote(symbol);
        res.json(quote);
      } catch (error) {
        this.logger.error('Failed to fetch market data:', error);
        res.status(500).json({ error: 'Failed to fetch market data' });
      }
    });

    // Strategy endpoints
    this.app.get('/strategy/nifty/contract', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const contract = await this.niftyStrategy.findCurrentMonthNiftyFutures();
        if (!contract) {
          res.status(404).json({ error: 'No current month Nifty futures found' });
          return;
        }

        res.json({
          success: true,
          contract: contract,
          message: `Found current month contract: ${contract.tradingsymbol}`
        });
      } catch (error) {
        this.logger.error('Failed to get Nifty contract:', error);
        res.status(500).json({ error: 'Failed to get Nifty contract' });
      }
    });

    this.app.get('/strategy/nifty/price', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const price = await this.niftyStrategy.getCurrentPrice();
        res.json({
          success: true,
          price: price,
          streaming_active: this.niftyStrategy.isStreamingActive(),
          latest_tick: this.latestTick || null
        });
      } catch (error) {
        this.logger.error('Failed to get Nifty price:', error);
        res.status(500).json({ error: 'Failed to get Nifty price' });
      }
    });

    this.app.post('/strategy/nifty/start-stream', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        if (this.niftyStrategy.isStreamingActive()) {
          res.json({
            success: true,
            message: 'Streaming is already active',
            contract: this.niftyStrategy.getCurrentContract()
          });
          return;
        }

        await this.niftyStrategy.startPriceStreaming();
        res.json({
          success: true,
          message: 'Price streaming started successfully',
          contract: this.niftyStrategy.getCurrentContract()
        });
      } catch (error) {
        this.logger.error('Failed to start price streaming:', error);
        res.status(500).json({ 
          error: 'Failed to start price streaming',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.post('/strategy/nifty/stop-stream', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.niftyStrategy.isStreamingActive()) {
          res.json({
            success: true,
            message: 'Streaming is not currently active'
          });
          return;
        }

        await this.niftyStrategy.stopPriceStreaming();
        res.json({
          success: true,
          message: 'Price streaming stopped successfully'
        });
      } catch (error) {
        this.logger.error('Failed to stop price streaming:', error);
        res.status(500).json({ 
          error: 'Failed to stop price streaming',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.get('/strategy/status', (req: Request, res: Response) => {
      const contract = this.niftyStrategy.getCurrentContract();
      res.json({
        authenticated: this.authService.isAuthenticated(),
        streaming_active: this.niftyStrategy.isStreamingActive(),
        current_contract: contract || null,
        latest_tick: this.latestTick || null,
        timestamp: new Date().toISOString()
      });
    });

    // Breakout Retracement Strategy endpoints
    this.app.get('/breakout-strategy/status', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Get basic strategy state without calling potentially problematic methods
        const isActive = this.breakoutStrategy.isStrategyActive();
        const candleCount = this.breakoutStrategy.getCandleCount();
        
        // Safely get other data
        let strategyState;
        let latestPivots;
        let livePrice;
        let isMarketHours = false;
        let priceStreamingActive = false;
        
        try {
          strategyState = this.breakoutStrategy.getStrategyState();
          latestPivots = this.breakoutStrategy.getLatestPivots();
          livePrice = this.breakoutStrategy.getLivePrice();
          isMarketHours = this.breakoutStrategy.isMarketHours();
          priceStreamingActive = this.breakoutStrategy.isPriceStreamingActive();
        } catch (error) {
          this.logger.error('Error getting detailed strategy data:', error);
        }

        res.json({
          success: true,
          strategy_active: isActive,
          market_hours: isMarketHours,
          candle_count: candleCount,
          current_contract: strategyState?.currentContract || null,
          latest_pivots: latestPivots || { pivotHigh: null, pivotLow: null },
          last_update: strategyState?.lastUpdateTime || new Date(),
          live_price: livePrice || null,
          price_streaming_active: priceStreamingActive,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Failed to get breakout strategy status:', error);
        res.status(500).json({ 
          error: 'Failed to get strategy status',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.post('/breakout-strategy/start', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        if (this.breakoutStrategy.isStrategyActive()) {
          res.json({
            success: true,
            message: 'Breakout strategy is already active',
            strategy_state: this.breakoutStrategy.getStrategyState()
          });
          return;
        }

        await this.breakoutStrategy.startStrategy();
        res.json({
          success: true,
          message: 'Breakout retracement strategy started successfully',
          strategy_state: this.breakoutStrategy.getStrategyState()
        });
      } catch (error) {
        this.logger.error('Failed to start breakout strategy:', error);
        res.status(500).json({ 
          error: 'Failed to start breakout strategy',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.post('/breakout-strategy/stop', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.breakoutStrategy.isStrategyActive()) {
          res.json({
            success: true,
            message: 'Breakout strategy is not currently active'
          });
          return;
        }

        await this.breakoutStrategy.stopStrategy();
        res.json({
          success: true,
          message: 'Breakout retracement strategy stopped successfully'
        });
      } catch (error) {
        this.logger.error('Failed to stop breakout strategy:', error);
        res.status(500).json({ 
          error: 'Failed to stop breakout strategy',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.get('/breakout-strategy/pivots', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const latestPivots = this.breakoutStrategy.getLatestPivots();
        res.json({
          success: true,
          pivots: latestPivots,
          strategy_active: this.breakoutStrategy.isStrategyActive(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Failed to get pivot data:', error);
        res.status(500).json({ error: 'Failed to get pivot data' });
      }
    });

    // Price streaming control endpoints
    this.app.post('/breakout-strategy/start-streaming', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        if (this.breakoutStrategy.isPriceStreamingActive()) {
          res.json({
            success: true,
            message: 'Price streaming is already active'
          });
          return;
        }

        await this.breakoutStrategy.startManualPriceStreaming();
        res.json({
          success: true,
          message: 'Price streaming started successfully'
        });
      } catch (error) {
        this.logger.error('Failed to start price streaming:', error);
        res.status(500).json({ 
          error: 'Failed to start price streaming',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.post('/breakout-strategy/stop-streaming', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.breakoutStrategy.isPriceStreamingActive()) {
          res.json({
            success: true,
            message: 'Price streaming is not currently active'
          });
          return;
        }

        await this.breakoutStrategy.stopManualPriceStreaming();
        res.json({
          success: true,
          message: 'Price streaming stopped successfully'
        });
      } catch (error) {
        this.logger.error('Failed to stop price streaming:', error);
        res.status(500).json({ 
          error: 'Failed to stop price streaming',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Breakout strategy dashboard page
    this.app.get('/breakout-strategy', (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const sessionData = this.authService.getSessionData();
      const strategyActive = this.breakoutStrategy.isStrategyActive();
      const latestPivots = this.breakoutStrategy.getLatestPivots();
      const livePrice = this.breakoutStrategy.getLivePrice();
      const priceStreamingActive = this.breakoutStrategy.isPriceStreamingActive();
      const isMarketHours = this.breakoutStrategy.isMarketHours();
      
      const htmlResponse = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nifty Breakout Retracement Strategy</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .dashboard {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.2);
            margin-bottom: 30px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .logo {
            font-size: 3rem;
            margin-bottom: 10px;
        }
        
        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: #2d3748;
            margin-bottom: 10px;
            letter-spacing: -0.02em;
        }
        
        .subtitle {
            color: #718096;
            font-size: 1.1rem;
            font-weight: 400;
        }
        
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        
        .status-card {
            background: linear-gradient(135deg, #f7fafc, #edf2f7);
            border-radius: 16px;
            padding: 24px;
            border: 1px solid #e2e8f0;
            position: relative;
            overflow: hidden;
        }
        
        .status-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
        }
        
        .status-card.success::before {
            background: linear-gradient(90deg, #48bb78, #38b2ac);
        }
        
        .status-card.warning::before {
            background: linear-gradient(90deg, #f6e05e, #ed8936);
        }
        
        .status-card.error::before {
            background: linear-gradient(90deg, #f56565, #e53e3e);
        }
        
        .card-title {
            font-size: 1.2rem;
            font-weight: 700;
            color: #2d3748;
            margin-bottom: 12px;
        }
        
        .card-content {
            color: #4a5568;
            line-height: 1.6;
        }
        
        .pivot-price {
            font-size: 1.5rem;
            font-weight: 700;
            color: #2d3748;
            margin: 8px 0;
        }
        
        .pivot-time {
            font-size: 0.9rem;
            color: #718096;
        }
        
        .actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        
        .action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 18px 24px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            border-radius: 16px;
            font-weight: 600;
            font-size: 1rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
            border: none;
            cursor: pointer;
        }
        
        .action-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 30px rgba(102, 126, 234, 0.4);
            text-decoration: none;
            color: white;
        }
        
        .action-btn.success {
            background: linear-gradient(135deg, #48bb78, #38a169);
            box-shadow: 0 4px 20px rgba(72, 187, 120, 0.3);
        }
        
        .action-btn.danger {
            background: linear-gradient(135deg, #f56565, #e53e3e);
            box-shadow: 0 4px 20px rgba(245, 101, 101, 0.3);
        }
        
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
            margin-bottom: 20px;
            padding: 8px 16px;
            border-radius: 8px;
            transition: background-color 0.2s;
        }
        
        .back-link:hover {
            background-color: rgba(102, 126, 234, 0.1);
            text-decoration: none;
            color: #667eea;
        }
        
        .refresh-info {
            text-align: center;
            color: #718096;
            font-size: 0.9rem;
            margin-top: 20px;
            padding: 16px;
            background: rgba(113, 128, 150, 0.1);
            border-radius: 12px;
        }
    </style>
    <script>
        // Auto refresh every 30 seconds
        setTimeout(() => {
            window.location.reload();
        }, 30000);
        
        async function startStrategy() {
            try {
                const response = await fetch('/breakout-strategy/start', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    window.location.reload();
                } else {
                    alert('Failed to start strategy: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                alert('Error starting strategy: ' + error.message);
            }
        }
        
        async function stopStrategy() {
            try {
                const response = await fetch('/breakout-strategy/stop', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    window.location.reload();
                } else {
                    alert('Failed to stop strategy: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                alert('Error stopping strategy: ' + error.message);
            }
        }
        
        async function startStreaming() {
            try {
                const response = await fetch('/breakout-strategy/start-streaming', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    window.location.reload();
                } else {
                    alert('Failed to start streaming: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                alert('Error starting streaming: ' + error.message);
            }
        }
        
        async function stopStreaming() {
            try {
                const response = await fetch('/breakout-strategy/stop-streaming', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    window.location.reload();
                } else {
                    alert('Failed to stop streaming: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                alert('Error stopping streaming: ' + error.message);
            }
        }
    </script>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">
            ← Back to Main Dashboard
        </a>
        
        <div class="dashboard">
            <div class="header">
                <div class="logo">📈</div>
                <h1>Nifty Breakout Retracement Strategy</h1>
                <div class="subtitle">15,15 Pivot Detection • 5-Minute Timeframe • Auto Updates</div>
            </div>

            ${!isAuthenticated ? `
            <div class="status-card error">
                <div class="card-title">⚠️ Authentication Required</div>
                <div class="card-content">
                    Please authenticate first by visiting the <a href="/auth/login">login page</a>.
                </div>
            </div>
            ` : `
            
            <div class="status-grid">
                <div class="status-card ${strategyActive ? 'success' : 'warning'}">
                    <div class="card-title">📊 Strategy Status</div>
                    <div class="card-content">
                        <strong>Status:</strong> ${strategyActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}<br>
                        <strong>Market Hours:</strong> ${isMarketHours ? '🟢 OPEN' : '🔴 CLOSED'}<br>
                        <strong>Candles Loaded:</strong> ${this.breakoutStrategy.getCandleCount()}<br>
                        <strong>Live Streaming:</strong> ${priceStreamingActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}
                    </div>
                </div>

                <div class="status-card ${livePrice ? 'success' : 'warning'}">
                    <div class="card-title">💰 Live Price</div>
                    <div class="card-content">
                        ${livePrice ? `
                            <div class="pivot-price">₹${livePrice.last_price.toFixed(2)}</div>
                            <div class="pivot-time">Volume: ${livePrice.volume.toLocaleString()}</div>
                            <div class="pivot-time">OHLC: ${livePrice.ohlc.open.toFixed(2)} | ${livePrice.ohlc.high.toFixed(2)} | ${livePrice.ohlc.low.toFixed(2)} | ${livePrice.ohlc.close.toFixed(2)}</div>
                        ` : priceStreamingActive ? 'Waiting for price data...' : 'Price streaming not active'}
                    </div>
                </div>

                <div class="status-card ${latestPivots.pivotHigh ? 'success' : 'warning'}">
                    <div class="card-title">📈 Latest Pivot HIGH</div>
                    <div class="card-content">
                        ${latestPivots.pivotHigh ? `
                            <div class="pivot-price">₹${latestPivots.pivotHigh.price.toFixed(2)}</div>
                            <div class="pivot-time">${new Date(latestPivots.pivotHigh.timestamp).toLocaleString()}</div>
                        ` : 'No pivot high detected yet'}
                    </div>
                </div>

                <div class="status-card ${latestPivots.pivotLow ? 'success' : 'warning'}">
                    <div class="card-title">📉 Latest Pivot LOW</div>
                    <div class="card-content">
                        ${latestPivots.pivotLow ? `
                            <div class="pivot-price">₹${latestPivots.pivotLow.price.toFixed(2)}</div>
                            <div class="pivot-time">${new Date(latestPivots.pivotLow.timestamp).toLocaleString()}</div>
                        ` : 'No pivot low detected yet'}
                    </div>
                </div>
            </div>

            <div class="actions-grid">
                ${!strategyActive ? `
                <button onclick="startStrategy()" class="action-btn success">
                    ▶️ Start Strategy
                </button>
                ` : `
                <button onclick="stopStrategy()" class="action-btn danger">
                    ⏹️ Stop Strategy
                </button>
                `}
                
                ${!priceStreamingActive ? `
                <button onclick="startStreaming()" class="action-btn success">
                    📡 Start Live Streaming
                </button>
                ` : `
                <button onclick="stopStreaming()" class="action-btn danger">
                    📡 Stop Live Streaming
                </button>
                `}
                
                <a href="/breakout-strategy/status" class="action-btn">
                    📊 Strategy Status API
                </a>
                
                <a href="/breakout-strategy/pivots" class="action-btn">
                    📍 Pivot Data API
                </a>
            </div>
            `}

            <div class="refresh-info">
                🔄 This page auto-refreshes every 30 seconds<br>
                💡 Strategy recalculates pivots every 5 minutes during market hours (9:15 AM - 3:30 PM)
            </div>
        </div>
    </div>
</body>
</html>
      `;
      
      res.send(htmlResponse);
    });
  }

  public async start(): Promise<void> {
    try {
      // Check if we have a valid access token
      if (!this.authService.isAuthenticated()) {
        this.logger.warn('Bot is not authenticated. Please visit /auth/login to authenticate.');
      }

      // Start the web server
      const port = process.env.PORT || 3000;
      this.app.listen(port, () => {
        this.logger.info(`Trading bot server started on port ${port}`);
        this.logger.info('Visit http://localhost:3000/auth/login to authenticate with Zerodha');
      });

    } catch (error) {
      this.logger.error('Failed to start trading bot:', error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    this.logger.info('Stopping trading bot...');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start the bot
const bot = new TradingBot();
bot.start().catch((error) => {
  console.error('Failed to start trading bot:', error);
  process.exit(1);
});

export { TradingBot };