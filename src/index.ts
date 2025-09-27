import { KiteConnect } from 'kiteconnect';
import { AuthService } from './services/AuthService';
import { NiftyBreakoutRetracementStrategy } from './services/NiftyBreakoutRetracementStrategy';
import { Logger } from './utils/Logger';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class TradingBot {
  private kiteConnect: any; // Using any for now due to type complexity
  private authService: AuthService;
  private breakoutStrategy: NiftyBreakoutRetracementStrategy;
  private logger: Logger;
  private app: express.Application;

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
    this.breakoutStrategy = new NiftyBreakoutRetracementStrategy(this.kiteConnect, this.logger);

    // Price updates are now managed by the breakout strategy
    // this.latestTick is populated through strategy.getLivePrice() calls

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
      
      // Get trade state information if authenticated
      let tradeStateInfo: any = null;
      if (isAuthenticated) {
        try {
          tradeStateInfo = this.breakoutStrategy.getTradeStateInfo();
        } catch (error) {
          this.logger.error('Error getting trade state info for dashboard:', error);
        }
      }
      
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
        
        .endpoint.deprecated {
            background: #fef5e7;
            border-color: #f6ad55;
            opacity: 0.7;
        }
        
        .endpoint.deprecated:hover {
            background: #fed7aa;
            border-color: #f6ad55;
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
        <div class="status-card" style="border-left: 4px solid ${
          tradeStateInfo?.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
          tradeStateInfo?.tradeState === 'waiting_for_entry' ? '#F59E0B' :
          tradeStateInfo?.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
        };">
            <div class="status-text">
                🎯 <strong>Trade State:</strong> 
                <span style="text-transform: capitalize; color: ${
                  tradeStateInfo?.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
                  tradeStateInfo?.tradeState === 'waiting_for_entry' ? '#F59E0B' :
                  tradeStateInfo?.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
                };">
                    ${tradeStateInfo?.tradeState?.replace(/_/g, ' ') || 'Loading...'}
                </span><br>
                <small style="font-weight: normal; opacity: 0.8;">
                    ${
                      !tradeStateInfo ? 'Strategy initializing...' :
                      tradeStateInfo.tradeState === 'waiting_for_breakout' ? 'Monitoring for breakout signals' :
                      tradeStateInfo.tradeState === 'waiting_for_entry' && tradeStateInfo.tradeSetupRequest ? 
                        `Entry: ₹${tradeStateInfo.tradeSetupRequest.entryLevel} | SL: ₹${tradeStateInfo.tradeSetupRequest.stopLossLevel} | Target: ₹${tradeStateInfo.tradeSetupRequest.targetLevel}` :
                      tradeStateInfo.tradeState === 'in_trade' && tradeStateInfo.tradeSetupRequest ?
                        `Active ${tradeStateInfo.tradeSetupRequest.direction} trade | SL: ₹${tradeStateInfo.tradeSetupRequest.stopLossLevel} | Target: ₹${tradeStateInfo.tradeSetupRequest.targetLevel}` :
                      'Trade state active'
                    }
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
                <a href="/strategy/nifty/start-stream" class="endpoint deprecated">
                    <span class="method">POST</span>
                    <span>/strategy/nifty/start-stream (⚠️ DEPRECATED - Use Breakout Strategy)</span>
                </a>
                <a href="/strategy/nifty/stop-stream" class="endpoint deprecated">
                    <span class="method">POST</span>
                    <span>/strategy/nifty/stop-stream (⚠️ DEPRECATED - Use Breakout Strategy)</span>
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
                <a href="/execution/status" class="endpoint">
                    <span class="method">GET</span>
                    <span>/execution/status (Trade Execution Status)</span>
                </a>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #e1e5e9;">
                    <h4 style="margin-bottom: 10px; color: #2563eb;">💼 Trade Execution</h4>
                    <button onclick="runTest('/execution/initialize-instruments')" class="test-button">
                        Initialize Instruments
                    </button>
                    <button onclick="toggleTradingMode()" class="test-button warning" id="trading-mode-btn">
                        Toggle Paper/Live Trading
                    </button>
                </div>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #e1e5e9;">
                    <h4 style="margin-bottom: 10px; color: #2563eb;">🧪 Manual Testing Endpoints</h4>
                    <button onclick="runTest('/test/volume-sma50')" class="test-button">
                        Test Volume SMA50
                    </button>
                    <button onclick="runTest('/test/breakout-detection')" class="test-button">
                        Test Breakout Detection
                    </button>
                    <button onclick="runTest('/test/candle-building')" class="test-button">
                        Test Candle Building
                    </button>
                    <button onclick="runTest('/test/run-all-manual')" class="test-button primary">
                        🚀 Run All Tests
                    </button>
                    <button onclick="runTest('/test/clear-data')" class="test-button warning">
                        🧹 Clear Test Data
                    </button>
                </div>
            </div>
        </div>

        <div class="footer">
            <div class="footer-text">
                💡 <strong>Daily Routine:</strong> Start bot → Click "Daily Login" → Authenticate → Done!<br>
                📖 This page refreshes automatically to show current status<br>
                🧪 <strong>Testing:</strong> Use the test buttons above to validate strategy logic components
            </div>
        </div>
    </div>

    <script>
        async function runTest(endpoint) {
            const button = event.target;
            const originalText = button.textContent;
            
            button.textContent = 'Running...';
            button.disabled = true;
            
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    button.textContent = '✅ Success';
                    button.style.backgroundColor = '#10b981';
                    alert('Test completed successfully! Check the console logs for detailed results.');
                } else {
                    button.textContent = '❌ Failed';
                    button.style.backgroundColor = '#ef4444';
                    alert('Test failed: ' + result.message);
                }
            } catch (error) {
                button.textContent = '❌ Error';
                button.style.backgroundColor = '#ef4444';
                alert('Test error: ' + error.message);
            }
            
            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
                button.style.backgroundColor = '';
            }, 3000);
        }

        async function toggleTradingMode() {
            const button = document.getElementById('trading-mode-btn');
            const originalText = button.textContent;
            
            button.textContent = 'Updating...';
            button.disabled = true;
            
            try {
                // First get current config
                const statusResponse = await fetch('/execution/status');
                const statusData = await statusResponse.json();
                const currentMode = statusData.trading_config?.paperTradingMode;
                const newMode = !currentMode;
                
                // Update config
                const updateResponse = await fetch('/execution/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        paperTradingMode: newMode
                    })
                });
                
                const result = await updateResponse.json();
                
                if (result.success) {
                    button.textContent = newMode ? '📝 Paper Trading' : '🚀 Live Trading';
                    button.className = newMode ? 'test-button warning' : 'test-button success';
                    alert('Trading mode switched to: ' + (newMode ? 'Paper Trading' : 'Live Trading'));
                } else {
                    button.textContent = '❌ Failed';
                    alert('Failed to update trading mode: ' + result.message);
                }
            } catch (error) {
                button.textContent = '❌ Error';
                alert('Error updating trading mode: ' + error.message);
            }
            
            setTimeout(() => {
                button.disabled = false;
                if (button.textContent.includes('❌')) {
                    button.textContent = originalText;
                }
            }, 3000);
        }
    </script>

    <style>
        .test-button {
            display: inline-block;
            margin: 5px;
            padding: 10px 16px;
            background: #6366f1;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        .test-button:hover {
            background: #4f46e5;
        }
        
        .test-button:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }
        
        .test-button.primary {
            background: #059669;
            font-weight: 600;
        }
        
        .test-button.primary:hover {
            background: #047857;
        }
        
        .test-button.warning {
            background: #dc2626;
        }
        
        .test-button.warning:hover {
            background: #b91c1c;
        }
        
        .test-button.info {
            background: #0ea5e9;
        }
        
        .test-button.info:hover {
            background: #0284c7;
        }
    </style>
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

        // Get contract from the breakout strategy state
        const state = this.breakoutStrategy.getStrategyState();
        const contract = state.currentContract;
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

        // Get live price from breakout strategy
        const strategyLivePrice = this.breakoutStrategy.getLivePrice();
        const state = this.breakoutStrategy.getStrategyState();
        const contract = state.currentContract;
        
        // Use strategy's live price if available, otherwise fetch via REST API  
        let price = null;
        if (strategyLivePrice) {
          price = {
            last_price: strategyLivePrice.last_price,
            volume: strategyLivePrice.volume,
            ohlc: strategyLivePrice.ohlc
          };
        } else if (contract) {
          // Fallback to REST API if no live price from strategy
          try {
            const quote = await this.kiteConnect.getQuote([contract.tradingsymbol]);
            const contractQuote = quote[contract.tradingsymbol];
            if (contractQuote) {
              price = {
                last_price: contractQuote.last_price,
                volume: contractQuote.volume,
                ohlc: contractQuote.ohlc
              };
            }
          } catch (error) {
            this.logger.warn('Failed to fetch quote via REST API:', error);
          }
        }
        
        // Log the price data for debugging
        this.logger.info(`📊 Price Data: ${JSON.stringify(price)}`);
        
        res.json({
          success: true,
          price: price, // This is the actual market data from REST API
          streaming_active: this.breakoutStrategy.isPriceStreamingActive(), // Get from strategy
          latest_tick: strategyLivePrice || null, // Get from strategy (might be test data)
          message: 'Live streaming data is managed by breakout strategy. Use /breakout-strategy/status for real-time updates.',
          note: 'price = REST API data, latest_tick = WebSocket data (if available)'
        });
      } catch (error) {
        this.logger.error('Failed to get Nifty price:', error);
        res.status(500).json({ error: 'Failed to get Nifty price' });
      }
    });

    // ===== STANDALONE STREAMING ENDPOINTS REMOVED =====
    // Price streaming is now handled exclusively by the breakout strategy
    // Use /breakout-strategy/status to get live price data

    // Redirect legacy streaming endpoints to strategy endpoints
    this.app.post('/strategy/nifty/start-stream', async (req: Request, res: Response): Promise<void> => {
      res.json({
        success: false,
        message: 'Standalone price streaming removed. Use /breakout-strategy/start to start strategy with integrated streaming.',
        redirect: '/breakout-strategy/start'
      });
    });

    this.app.post('/strategy/nifty/stop-stream', async (req: Request, res: Response): Promise<void> => {
      res.json({
        success: false,
        message: 'Standalone price streaming removed. Use /breakout-strategy/stop to stop strategy.',
        redirect: '/breakout-strategy/stop'
      });
    });

    this.app.get('/strategy/status', (req: Request, res: Response) => {
      const state = this.breakoutStrategy.getStrategyState();
      const contract = state.currentContract;
      res.json({
        authenticated: this.authService.isAuthenticated(),
        streaming_active: this.breakoutStrategy.isPriceStreamingActive(), // Get from strategy instead
        current_contract: contract || null,
        latest_tick: this.breakoutStrategy.getLivePrice() || null, // Get from strategy instead
        timestamp: new Date().toISOString(),
        message: 'For comprehensive streaming data, use /breakout-strategy/status'
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
        let breakoutDetectionActive = false;
        let latestBreakoutSignal;
        let oneMinuteCandleCount = 0;
  let volumeSMA50: number | undefined;
  let latestOneMinuteCandle: any;
  let tradeStateInfo: any;
        
        try {
          strategyState = this.breakoutStrategy.getStrategyState();
          latestPivots = this.breakoutStrategy.getLatestPivots();
          livePrice = this.breakoutStrategy.getLivePrice();
          isMarketHours = this.breakoutStrategy.isMarketHours();
          priceStreamingActive = this.breakoutStrategy.isPriceStreamingActive();
          breakoutDetectionActive = this.breakoutStrategy.isBreakoutDetectionActive();
          latestBreakoutSignal = this.breakoutStrategy.getLatestBreakoutSignal();
          oneMinuteCandleCount = this.breakoutStrategy.getOneMinuteCandleCount();
          volumeSMA50 = this.breakoutStrategy.getCurrentVolumeSMA50();
          latestOneMinuteCandle = this.breakoutStrategy.getLatestOneMinuteCandle();
          tradeStateInfo = this.breakoutStrategy.getTradeStateInfo();
        } catch (error) {
          this.logger.error('Error getting detailed strategy data:', error);
        }

        // Get execution service data
        let executionStatus: any;
        let currentCapital: number | undefined;
        let activePosition: any;
        try {
          executionStatus = this.breakoutStrategy.getExecutionStatus();
          currentCapital = this.breakoutStrategy.getCurrentCapital();
          activePosition = this.breakoutStrategy.getActivePosition();
        } catch (error) {
          this.logger.error('Error getting execution service data:', error);
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
          breakout_detection_active: breakoutDetectionActive,
          latest_breakout_signal: latestBreakoutSignal || null,
          one_minute_candle_count: oneMinuteCandleCount,
          volume_sma_50: typeof volumeSMA50 === 'number' ? volumeSMA50 : null,
            latest_one_minute_candle: latestOneMinuteCandle || null,
          // Trade State Information
          trade_state: tradeStateInfo?.tradeState || 'waiting_for_breakout',
          trade_setup: tradeStateInfo?.tradeSetupRequest || null,
          current_trade_id: tradeStateInfo?.currentTradeId || null,
          // Execution Service Information
          execution_status: executionStatus || null,
          current_capital: currentCapital || null,
          active_position: activePosition || null,
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

        // Initialize instruments before starting strategy
        try {
          await this.breakoutStrategy.initializeInstruments();
          this.logger.info('✅ Option instruments initialized');
        } catch (error) {
          this.logger.error('Failed to initialize instruments:', error);
          res.status(500).json({ 
            error: 'Failed to initialize option instruments',
            details: error instanceof Error ? error.message : 'Unknown error'
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

    // Streaming health check endpoint
    this.app.get('/breakout-strategy/streaming-health', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const livePrice = this.breakoutStrategy.getLivePrice();
        const isStreamingActive = this.breakoutStrategy.isPriceStreamingActive();
        const state = this.breakoutStrategy.getStrategyState();
        const contract = state.currentContract;
        const isMarketHours = this.breakoutStrategy.isMarketHours();

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          streaming_health: {
            strategy_streaming_active: isStreamingActive,
            nifty_streaming_active: false, // Always false since we removed utility class
            has_live_price: !!livePrice,
            market_hours: isMarketHours,
            contract: contract,
            last_price: livePrice?.last_price || null,
            last_volume: livePrice?.volume || null,
            price_age_seconds: livePrice && livePrice.timestamp ? Math.round((new Date().getTime() - livePrice.timestamp.getTime()) / 1000) : null
          },
          diagnostics: {
            strategy_active: this.breakoutStrategy.isStrategyActive(),
            candle_count: this.breakoutStrategy.getCandleCount(),
            one_minute_candle_count: this.breakoutStrategy.getOneMinuteCandleCount(),
            breakout_detection_active: this.breakoutStrategy.isBreakoutDetectionActive()
          }
        });
      } catch (error) {
        this.logger.error('Error getting streaming health:', error);
        res.status(500).json({ 
          error: 'Failed to get streaming health',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Memory info endpoint for 1-minute candle storage optimization
    this.app.get('/breakout-strategy/memory-info', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const memoryInfo = this.breakoutStrategy.getCandleMemoryInfo();
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          memory_optimization: memoryInfo
        });
      } catch (error) {
        this.logger.error('Error getting memory info:', error);
        res.status(500).json({ error: 'Failed to get memory info' });
      }
    });

    // Test endpoint to simulate tick data (for debugging streaming)
    this.app.post('/breakout-strategy/test-tick', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Legacy endpoint - redirects to direct strategy method
        this.breakoutStrategy.simulateDirectTestTick();
        
        res.json({
          success: true,
          message: 'Test tick simulated successfully (legacy endpoint - use /breakout-strategy/test-direct-tick instead)',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error simulating test tick:', error);
        res.status(500).json({ 
          error: 'Failed to simulate test tick',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Direct strategy test tick endpoint
    this.app.post('/breakout-strategy/test-direct-tick', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Simulate tick directly in our strategy
        this.breakoutStrategy.simulateDirectTestTick();
        
        res.json({
          success: true,
          message: 'Direct strategy test tick simulated successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error simulating direct test tick:', error);
        res.status(500).json({ 
          error: 'Failed to simulate direct test tick',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // ===========================
    // TRADE EXECUTION SERVICE ENDPOINTS
    // ===========================

    // Get execution service status
    this.app.get('/execution/status', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const executionStatus = this.breakoutStrategy.getExecutionStatus();
        const currentCapital = this.breakoutStrategy.getCurrentCapital();
        const activePosition = this.breakoutStrategy.getActivePosition();
        const tradeHistory = this.breakoutStrategy.getTradeHistory();
        const tradingConfig = this.breakoutStrategy.getTradingConfig();

        res.json({
          success: true,
          execution_status: executionStatus,
          current_capital: currentCapital,
          active_position: activePosition,
          trade_history: tradeHistory.slice(-10), // Last 10 trades only
          trading_config: tradingConfig,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error getting execution status:', error);
        res.status(500).json({ 
          error: 'Failed to get execution status',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Paginated trade history endpoint
    this.app.get('/api/trades', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 per page
        const offset = (page - 1) * limit;
        
        const allTrades = this.breakoutStrategy.getTradeHistory();
        const totalTrades = allTrades.length;
        const paginatedTrades = allTrades.slice(offset, offset + limit);
        
        res.json({
          success: true,
          trades: paginatedTrades,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalTrades / limit),
            totalTrades,
            hasMore: offset + limit < totalTrades,
            limit
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error fetching paginated trade history:', error);
        res.status(500).json({ 
          error: 'Failed to fetch trade history',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Initialize instruments
    this.app.post('/execution/initialize-instruments', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('Initializing option instruments...');
        await this.breakoutStrategy.initializeInstruments();
        
        res.json({
          success: true,
          message: 'Option instruments initialized successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error initializing instruments:', error);
        res.status(500).json({ 
          error: 'Failed to initialize instruments',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Get trading configuration page
    this.app.get('/execution/config', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const tradingConfig = this.breakoutStrategy.getTradingConfig();
        const currentCapital = this.breakoutStrategy.getCurrentCapital();
        
        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trading Configuration</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        .dashboard { 
            background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(20px);
            border-radius: 24px; padding: 40px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; color: #374151; }
        .form-group input, .form-group select { 
            width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px;
            font-size: 14px; transition: border-color 0.2s;
        }
        .form-group input:focus, .form-group select:focus { 
            outline: none; border-color: #667eea; box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        .btn { 
            padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2);
            color: white; border: none; border-radius: 8px; font-weight: 600;
            cursor: pointer; transition: transform 0.2s;
        }
        .btn:hover { transform: translateY(-2px); }
        .back-link { color: #667eea; text-decoration: none; margin-bottom: 20px; display: inline-block; }
        .warning { background: #fef3cd; color: #856404; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .info { background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="dashboard">
            <a href="/breakout-strategy" class="back-link">← Back to Strategy Dashboard</a>
            
            <h1>⚙️ Trading Configuration</h1>
            
            ${tradingConfig.paperTradingMode ? `
            <div class="warning">
                <strong>⚠️ Paper Trading Mode Active</strong><br>
                No real trades will be placed. All trades are simulated for testing purposes.
            </div>
            ` : `
            <div class="warning">
                <strong>🚀 Live Trading Mode Active</strong><br>
                Real trades will be placed using your Zerodha account. Ensure sufficient funds are available.
            </div>
            `}
            
            <div class="info">
                <strong>💰 Current Capital:</strong> ₹${currentCapital.toLocaleString()}
            </div>
            
            <form id="configForm">
                <div class="form-group">
                    <label for="capital">Capital (₹)</label>
                    <input type="number" id="capital" name="capital" value="${tradingConfig.capital}" min="10000" step="1000" required>
                    <small style="color: #6b7280;">Minimum: ₹10,000</small>
                </div>
                
                <div class="form-group">
                    <label for="riskPerTrade">Risk per Trade (%)</label>
                    <input type="number" id="riskPerTrade" name="riskPerTrade" value="${(tradingConfig.riskPerTrade * 100).toFixed(1)}" min="0.5" max="10" step="0.1" required>
                    <small style="color: #6b7280;">Recommended: 2-5% per trade</small>
                </div>
                
                <div class="form-group">
                    <label for="paperTradingMode">Trading Mode</label>
                    <select id="paperTradingMode" name="paperTradingMode" required>
                        <option value="true" ${tradingConfig.paperTradingMode ? 'selected' : ''}>📝 Paper Trading (Simulation)</option>
                        <option value="false" ${!tradingConfig.paperTradingMode ? 'selected' : ''}>🚀 Live Trading (Real Money)</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="niftyLotSize">NIFTY Lot Size</label>
                    <input type="number" id="niftyLotSize" name="niftyLotSize" value="${tradingConfig.niftyLotSize}" min="25" max="200" required>
                    <small style="color: #6b7280;">Standard NIFTY lot size is 75</small>
                </div>
                
                <div class="form-group">
                    <label for="maxRetries">Max Order Retries</label>
                    <input type="number" id="maxRetries" name="maxRetries" value="${tradingConfig.maxRetries}" min="1" max="10" required>
                </div>
                
                <div class="form-group">
                    <label for="orderTimeout">Order Timeout (ms)</label>
                    <input type="number" id="orderTimeout" name="orderTimeout" value="${tradingConfig.orderTimeout}" min="1000" max="30000" step="1000" required>
                </div>
                
                <button type="submit" class="btn">💾 Update Configuration</button>
            </form>
        </div>
    </div>
    
    <script>
        document.getElementById('configForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const config = {
                capital: parseInt(formData.get('capital')),
                riskPerTrade: parseFloat(formData.get('riskPerTrade')) / 100,
                paperTradingMode: formData.get('paperTradingMode') === 'true',
                niftyLotSize: parseInt(formData.get('niftyLotSize')),
                maxRetries: parseInt(formData.get('maxRetries')),
                orderTimeout: parseInt(formData.get('orderTimeout'))
            };
            
            try {
                const response = await fetch('/execution/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ Configuration updated successfully!');
                    window.location.reload();
                } else {
                    alert('❌ Error: ' + result.error);
                }
            } catch (error) {
                alert('❌ Network error: ' + error.message);
            }
        });
    </script>
</body>
</html>
        `);
      } catch (error) {
        this.logger.error('Error serving execution config page:', error);
        res.status(500).json({ 
          error: 'Failed to load configuration page',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Update trading configuration
    this.app.post('/execution/config', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const updates = req.body;
        this.breakoutStrategy.updateTradingConfig(updates);
        
        res.json({
          success: true,
          message: 'Trading configuration updated successfully',
          new_config: this.breakoutStrategy.getTradingConfig(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error updating trading configuration:', error);
        res.status(500).json({ 
          error: 'Failed to update trading configuration',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // ===========================
    // TESTING ENDPOINTS
    // ===========================

    // Test with manual price fetch endpoint
    this.app.post('/test/manual-price-fetch', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('Testing manual price fetch');
        
        try {
          await this.breakoutStrategy.testManualPriceFetch();
          res.json({
            success: true,
            message: 'Manual price fetch test completed',
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          this.logger.error('Error testing manual price fetch:', error);
          res.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        this.logger.error('Test manual price fetch endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Manual Testing Endpoints for Strategy Logic
    this.app.post('/test/volume-sma50', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          this.breakoutStrategy.testVolumeSMA50Calculation();
          res.json({ success: true, message: 'Volume SMA50 test completed. Check logs for results.' });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ success: false, message: 'Test failed', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    this.app.post('/test/breakout-detection', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          this.breakoutStrategy.testBreakoutDetectionLogic();
          res.json({ success: true, message: 'Breakout detection test completed. Check logs for results.' });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ success: false, message: 'Test failed', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    this.app.post('/test/candle-building', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          this.breakoutStrategy.testCandleBuildingLogic();
          res.json({ success: true, message: 'Candle building test completed. Check logs for results.' });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ success: false, message: 'Test failed', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    this.app.post('/test/run-all-manual', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          this.breakoutStrategy.runAllManualTests();
          res.json({ success: true, message: 'All manual tests completed. Check logs for detailed results.' });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ success: false, message: 'All tests failed', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    this.app.post('/test/clear-data', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          this.breakoutStrategy.clearTestData();
          res.json({ success: true, message: 'Test data cleared successfully. Strategy reset to clean state.' });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ success: false, message: 'Clear data failed', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    this.app.get('/breakout-strategy/marking-candle', (req: Request, res: Response) => {
      try {
        if (this.breakoutStrategy) {
          const markingCandleState = this.breakoutStrategy.getMarkingCandleState();
          
          res.json({ 
            success: true, 
            message: 'Marking candle state retrieved',
            data: markingCandleState
          });
        } else {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
        }
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Marking candle state retrieval failed', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // Debug endpoint to test various NIFTY instruments
    this.app.get('/debug/instruments', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('Fetching NIFTY instruments');
        
        try {
          // Try to get instruments for NFO (derivatives)
          const instruments = await this.kiteConnect.getInstruments('NFO');
          
          // Filter for NIFTY futures
          const niftyFutures = instruments.filter((instrument: any) => 
            instrument.name === 'NIFTY' && 
            instrument.instrument_type === 'FUT'
          );

          res.json({
            success: true,
            niftyFuturesCount: niftyFutures.length,
            niftyFutures: niftyFutures.slice(0, 5), // First 5 only to avoid overwhelming output
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          this.logger.error('Error fetching instruments:', error);
          res.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        this.logger.error('Debug instruments endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Debug endpoint to test quote fetching
    this.app.get('/debug/quote/:symbol', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const symbol = req.params.symbol;
        this.logger.info(`Fetching quote for symbol: ${symbol}`);
        
        try {
          const quote = await this.kiteConnect.getQuote([symbol]);
          res.json({
            success: true,
            symbol: symbol,
            quote: quote,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          this.logger.error(`Error fetching quote for ${symbol}:`, error);
          res.json({
            success: false,
            symbol: symbol,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        this.logger.error('Debug quote endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Breakout strategy dashboard page
    this.app.get('/breakout-strategy', (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const sessionData = this.authService.getSessionData();
      const strategyActive = this.breakoutStrategy.isStrategyActive();
      const strategyState = this.breakoutStrategy.getStrategyState();
      const currentContract = strategyState?.currentContract;
      const latestPivots = this.breakoutStrategy.getLatestPivots();
      const livePrice = this.breakoutStrategy.getLivePrice();
      const priceStreamingActive = this.breakoutStrategy.isPriceStreamingActive();
      const isMarketHours = this.breakoutStrategy.isMarketHours();
      const breakoutDetectionActive = this.breakoutStrategy.isBreakoutDetectionActive();
      const latestBreakoutSignal = this.breakoutStrategy.getLatestBreakoutSignal();
      const oneMinuteCandleCount = this.breakoutStrategy.getOneMinuteCandleCount();
      const volumeSMA50 = this.breakoutStrategy.getCurrentVolumeSMA50();
      const latestOneMinuteCandle = this.breakoutStrategy.getLatestOneMinuteCandle();
      const markingCandleState = this.breakoutStrategy.getMarkingCandleState();
      const tradeStateInfo = this.breakoutStrategy.getTradeStateInfo();
      
      // Get execution service data
      const executionStatus = this.breakoutStrategy.getExecutionStatus();
      const currentCapital = this.breakoutStrategy.getCurrentCapital();
      const activePosition = this.breakoutStrategy.getActivePosition();
      const tradingConfig = this.breakoutStrategy.getTradingConfig();
      const tradeHistory = this.breakoutStrategy.getTradeHistory();
      
      // Calculate performance metrics
      const totalTrades = tradeHistory.length;
      const closedTrades = tradeHistory.filter(trade => trade.status === 'CLOSED');
      
      // Separate paper and live trades for accurate P&L calculation
      const isPaperMode = tradingConfig?.paperTradingMode;
      const liveTrades = closedTrades.filter(trade => !trade.isPaperTrade);
      const paperTrades = closedTrades.filter(trade => trade.isPaperTrade);
      
      // Calculate P&L based on trading mode
      const totalPnL = isPaperMode ? 
        paperTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) : // Paper mode: show paper P&L
        liveTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);    // Live mode: show only live P&L
      
      // Use appropriate trade set for metrics calculation
      const relevantTrades = isPaperMode ? paperTrades : liveTrades;
      const winningTrades = relevantTrades.filter(trade => (trade.pnl || 0) > 0);
      const losingTrades = relevantTrades.filter(trade => (trade.pnl || 0) < 0);
      const winRate = relevantTrades.length > 0 ? (winningTrades.length / relevantTrades.length) * 100 : 0;
      const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) / winningTrades.length : 0;
      const avgLoss = losingTrades.length > 0 ? losingTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0) / losingTrades.length : 0;
      const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin * winningTrades.length) / Math.abs(avgLoss * losingTrades.length) : 0;
      
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
        
        .status-card.info::before {
            background: linear-gradient(90deg, #4299e1, #3182ce);
        }
        
        .status-card.neutral::before {
            background: linear-gradient(90deg, #a0aec0, #718096);
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
        
        .breakout-signal {
            margin-top: 15px;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid;
        }
        
        .breakout-signal.long_breakout {
            background: linear-gradient(135deg, #f0fff4, #e6fffa);
            border-color: #48bb78;
        }
        
        .breakout-signal.short_breakout {
            background: linear-gradient(135deg, #fff5f5, #fed7d7);
            border-color: #f56565;
        }
        
        .signal-title {
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 10px;
        }
        
        .signal-details {
            font-size: 0.9rem;
            line-height: 1.4;
        }
        
        .signal-details div {
            margin: 2px 0;
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

                <div class="status-card" style="border-left: 4px solid ${
                  tradeStateInfo.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
                  tradeStateInfo.tradeState === 'waiting_for_entry' ? '#F59E0B' :
                  tradeStateInfo.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
                };">
                    <div class="card-title">🎯 Trade State</div>
                    <div class="card-content">
                        <div style="font-weight: 600; color: ${
                          tradeStateInfo.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
                          tradeStateInfo.tradeState === 'waiting_for_entry' ? '#F59E0B' :
                          tradeStateInfo.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
                        }; font-size: 18px; text-transform: capitalize; margin-bottom: 10px;">
                            ${tradeStateInfo.tradeState.replace(/_/g, ' ')}
                        </div>
                        ${
                          tradeStateInfo.tradeState === 'waiting_for_breakout' ? 
                            '<div style="color: #6b7280;">Monitoring for breakout signals</div>' :
                          tradeStateInfo.tradeState === 'waiting_for_entry' && tradeStateInfo.tradeSetupRequest ?
                            `<div style="font-size: 14px;">
                               <strong>Direction:</strong> ${tradeStateInfo.tradeSetupRequest.direction}<br>
                               <strong>Entry:</strong> ₹${tradeStateInfo.tradeSetupRequest.entryLevel}<br>
                               <strong>Stop Loss:</strong> ₹${tradeStateInfo.tradeSetupRequest.stopLossLevel}<br>
                               <strong>Target:</strong> ₹${tradeStateInfo.tradeSetupRequest.targetLevel}
                             </div>` :
                          tradeStateInfo.tradeState === 'in_trade' && tradeStateInfo.tradeSetupRequest ?
                            `<div style="font-size: 14px;">
                               <strong>Active ${tradeStateInfo.tradeSetupRequest.direction} Trade</strong><br>
                               <strong>Entry:</strong> ₹${tradeStateInfo.tradeSetupRequest.entryLevel}<br>
                               <strong>Stop Loss:</strong> ₹${tradeStateInfo.tradeSetupRequest.stopLossLevel}<br>
                               <strong>Target:</strong> ₹${tradeStateInfo.tradeSetupRequest.targetLevel}<br>
                               ${tradeStateInfo.currentTradeId ? `<strong>Trade ID:</strong> ${tradeStateInfo.currentTradeId}` : ''}
                             </div>` :
                          '<div style="color: #6b7280;">Trade state active</div>'
                        }
                    </div>
                </div>
                <div class="status-card info">
                    <div class="card-title">📝 Option Instrument & Trade Execution</div>
                    <div class="card-content">
                        ${activePosition && activePosition.instrument ? `
                        <div style="font-size: 14px; margin-bottom: 10px;">
                            <strong>Instrument:</strong> ${activePosition.instrument.tradingsymbol} (${activePosition.instrument.instrument_type})<br>
                            <strong>Strike:</strong> ₹${activePosition.instrument.strike}<br>
                            <strong>Expiry:</strong> ${new Date(activePosition.instrument.expiry).toLocaleDateString()}<br>
                            <strong>Lot Size:</strong> ${activePosition.instrument.lot_size}<br>
                        </div>
                        <div style="font-size: 14px;">
                            <strong>Order ID:</strong> ${activePosition.entryOrderId}<br>
                            <strong>Direction:</strong> ${activePosition.direction}<br>
                            <strong>Quantity:</strong> ${activePosition.quantity}<br>
                            <strong>Entry Price:</strong> ₹${activePosition.entryPrice}<br>
                            <strong>Status:</strong> OPEN<br>
                        </div>
                        ` : '<div style="color: #6b7280;">No active option trade</div>'}
                        ${activePosition && activePosition.pnl !== undefined ? `
                        <div style="font-size: 14px; margin-top: 10px;">
                            <strong>P&L:</strong> ₹${activePosition.pnl.toLocaleString()}<br>
                            <strong>Exit Price:</strong> ₹${activePosition.exitPrice || '-'}<br>
                            <strong>Exit Reason:</strong> ${activePosition.exitReason || '-'}<br>
                            <strong>Status:</strong> CLOSED
                        </div>
                        ` : ''}
                    </div>
                </div>

                <div class="status-card" style="border-left: 4px solid ${tradingConfig?.paperTradingMode ? '#F59E0B' : '#10B981'};">
                    <div class="card-title">💼 Execution Service</div>
                    <div class="card-content">
                        <div style="font-weight: 600; color: ${tradingConfig?.paperTradingMode ? '#F59E0B' : '#10B981'}; font-size: 16px; margin-bottom: 10px;">
                            ${tradingConfig?.paperTradingMode ? '📝 PAPER TRADING' : '🚀 LIVE TRADING'}
                        </div>
                        <div style="font-size: 14px;">
                            <strong>Capital:</strong> ₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}<br>
                            <strong>Risk per Trade:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%<br>
                            <strong>Active Position:</strong> ${activePosition ? 'YES' : 'NO'}<br>
                            <strong>Total Trades:</strong> ${executionStatus?.totalTrades || 0}
                        </div>
                    </div>
                </div>

                <div class="status-card ${livePrice ? 'success' : 'warning'}">
                    <div class="card-title">💰 Live Price</div>
                    <div class="card-content">
                        ${livePrice ? `
                            <div class="pivot-time" style="margin-bottom: 5px; font-weight: 600; color: #1f2937;">📊 ${currentContract ? currentContract.tradingsymbol : 'NIFTY FUTURES'}</div>
                            <div class="pivot-price">₹${livePrice.last_price.toFixed(2)}</div>
                            <div class="pivot-time">Volume: ${livePrice.volume.toLocaleString()}</div>
                            <div class="pivot-time">OHLC: ${livePrice.ohlc.open.toFixed(2)} | ${livePrice.ohlc.high.toFixed(2)} | ${livePrice.ohlc.low.toFixed(2)} | ${livePrice.ohlc.close.toFixed(2)}</div>
                        ` : priceStreamingActive ? 'Waiting for price data...' : 'Price streaming not active'}
                    </div>
                </div>

                <div class="status-card ${(latestPivots.pivotHigh && latestPivots.pivotLow) ? 'success' : 'warning'}">
                    <div class="card-title">� 5-Minute Pivot Levels</div>
                    <div class="card-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <div style="font-weight: 600; color: #16a34a; margin-bottom: 5px;">📈 Pivot HIGH</div>
                                ${latestPivots.pivotHigh ? `
                                    <div class="pivot-price" style="font-size: 16px;">₹${latestPivots.pivotHigh.price.toFixed(2)}</div>
                                    <div class="pivot-time" style="font-size: 12px;">${new Date(latestPivots.pivotHigh.timestamp).toLocaleString()}</div>
                                ` : '<div style="color: #9ca3af;">Not detected</div>'}
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #dc2626; margin-bottom: 5px;">📉 Pivot LOW</div>
                                ${latestPivots.pivotLow ? `
                                    <div class="pivot-price" style="font-size: 16px;">₹${latestPivots.pivotLow.price.toFixed(2)}</div>
                                    <div class="pivot-time" style="font-size: 12px;">${new Date(latestPivots.pivotLow.timestamp).toLocaleString()}</div>
                                ` : '<div style="color: #9ca3af;">Not detected</div>'}
                            </div>
                        </div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                            📅 Updates every 5 minutes • 15,15 lookback algorithm
                        </div>
                    </div>
                </div>

                <div class="status-card ${breakoutDetectionActive ? 'success' : 'warning'}">
                    <div class="card-title">🎯 Breakout Detection</div>
                    <div class="card-content">
                        <strong>Status:</strong> ${breakoutDetectionActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}<br>
                        <strong>1-Min Candles:</strong> ${oneMinuteCandleCount}/50<br>
                        <strong>Vol SMA (50):</strong> ${typeof volumeSMA50 === 'number' ? volumeSMA50.toFixed(0) : `N/A (${oneMinuteCandleCount}/50)`}<br>
            ${latestOneMinuteCandle ? `<strong>Last 1m Vol:</strong> ${latestOneMinuteCandle.volume.toLocaleString()}${volumeSMA50 ? ` (${((latestOneMinuteCandle.volume / volumeSMA50) * 100).toFixed(0)}% of SMA)` : ''}<br>` : ''}
                        ${latestBreakoutSignal ? `
                            <div class="breakout-signal ${latestBreakoutSignal.type}">
                                <div class="signal-title">${latestBreakoutSignal.type === 'long_breakout' ? '🟢 LONG BREAKOUT' : '🔴 SHORT BREAKOUT'}</div>
                                <div class="signal-details">
                                    <div>Breakout Price: ₹${latestBreakoutSignal.price.toFixed(2)}</div>
                                    <div>Pivot ${latestBreakoutSignal.pivotType.toUpperCase()}: ₹${latestBreakoutSignal.pivotPrice.toFixed(2)}</div>
                                    <div>Candle: O:${latestBreakoutSignal.candleOpen.toFixed(2)} C:${latestBreakoutSignal.candleClose.toFixed(2)}</div>
                                    <div>Volume: ${latestBreakoutSignal.volume.toLocaleString()} (${latestBreakoutSignal.volumeRatio.toFixed(2)}x SMA50)</div>
                                    <div>Time: ${new Date(latestBreakoutSignal.timestamp).toLocaleString()}</div>
                                </div>
                            </div>
                        ` : breakoutDetectionActive ? 'Monitoring for breakouts...' : 'Detection not active'}
                    </div>
                </div>

                <div class="status-card ${markingCandleState.isActive ? 'info' : 'neutral'}">
                    <div class="card-title">🕯️ Marking Candle</div>
                    <div class="card-content">
                        <strong>Status:</strong> ${markingCandleState.isActive ? '🟡 TRACKING' : '⚪ INACTIVE'}<br>
                        ${markingCandleState.isActive ? `
                            <strong>Search Phase:</strong> ${markingCandleState.searchPhase.toUpperCase()}<br>
                            <strong>Update Count:</strong> ${markingCandleState.currentMarkingCandle?.updateCount || 0}/3<br>
                            ${markingCandleState.currentMarkingCandle ? `
                                <div class="marking-candle-details" style="margin-top: 8px; padding: 8px; background: #f8fafc; border-radius: 4px; font-size: 13px;">
                                    <div><strong>Entry Price:</strong> ₹${markingCandleState.currentMarkingCandle.entryPrice.toFixed(2)}</div>
                                    <div><strong>Stop Loss:</strong> ₹${markingCandleState.currentMarkingCandle.stopLoss.toFixed(2)}</div>
                                    <div><strong>Candle:</strong> O:${markingCandleState.currentMarkingCandle.candle.open.toFixed(2)} H:${markingCandleState.currentMarkingCandle.candle.high.toFixed(2)} L:${markingCandleState.currentMarkingCandle.candle.low.toFixed(2)} C:${markingCandleState.currentMarkingCandle.candle.close.toFixed(2)}</div>
                                    <div><strong>Time:</strong> ${new Date(markingCandleState.currentMarkingCandle.candle.timestamp).toLocaleString()}</div>
                                </div>
                            ` : markingCandleState.searchPhase === 'initial' ? `
                                <div><strong>Bars Processed:</strong> ${markingCandleState.barsProcessedSinceBreakout}/5</div>
                                <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Looking for opposite direction candle...</div>
                            ` : ''}
                            ${markingCandleState.breakoutReference ? `
                                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 12px;">
                                    <strong>Breakout Type:</strong> ${markingCandleState.breakoutReference.type === 'long_breakout' ? '📈 LONG' : '📉 SHORT'} | 
                                    <strong>Time Limit:</strong> ${markingCandleState.startTime ? `${Math.floor((Date.now() - new Date(markingCandleState.startTime).getTime()) / (1000 * 60))}/18 min` : 'N/A'}
                                </div>
                            ` : ''}
                        ` : markingCandleState.tradeSkipped ? 'Trade skipped - waiting for next breakout' : 'Waiting for breakout signal...'}
                    </div>
                </div>

                <div class="status-card ${totalPnL >= 0 ? 'success' : 'danger'}">
                    <div class="card-title">📈 Performance Analytics ${isPaperMode ? '(Paper Trading)' : '(Live Trading)'}</div>
                    <div class="card-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                            <div>
                                <div><strong>Total P&L:</strong> <span style="color: ${totalPnL >= 0 ? '#10B981' : '#EF4444'}; font-weight: 600;">₹${totalPnL.toLocaleString()}</span></div>
                                <div><strong>Relevant Trades:</strong> ${relevantTrades.length}${isPaperMode ? ' (Paper)' : ' (Live)'}</div>
                                <div><strong>Win Rate:</strong> ${winRate.toFixed(1)}% (${winningTrades.length}W/${losingTrades.length}L)</div>
                                <div><strong>Profit Factor:</strong> ${profitFactor > 0 ? profitFactor.toFixed(2) : 'N/A'}</div>
                            </div>
                            <div>
                                <div><strong>Avg Win:</strong> <span style="color: #10B981;">₹${avgWin.toLocaleString()}</span></div>
                                <div><strong>Avg Loss:</strong> <span style="color: #EF4444;">₹${avgLoss.toLocaleString()}</span></div>
                                <div><strong>ROI:</strong> ${((totalPnL / 100000) * 100).toFixed(2)}%</div>
                                <div><strong>All Trades:</strong> ${totalTrades} (${paperTrades.length}P/${liveTrades.length}L)</div>
                            </div>
                        </div>
                        ${!isPaperMode && paperTrades.length > 0 ? `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                            📝 ${paperTrades.length} paper trades (₹${paperTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0).toLocaleString()}) excluded from live P&L
                        </div>
                        ` : ''}
                    </div>
                </div>

                <div class="status-card info">
                    <div class="card-title">📋 Recent Trade History</div>
                    <div class="card-content">
                        ${tradeHistory.length > 0 ? `
                            <div style="max-height: 200px; overflow-y: auto;">
                                ${tradeHistory.slice(-5).reverse().map(trade => `
                                    <div style="padding: 8px; margin: 4px 0; background: #f8fafc; border-radius: 4px; border-left: 3px solid ${(trade.pnl || 0) >= 0 ? '#10B981' : '#EF4444'}; font-size: 12px;">
                                        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 4px;">
                                            <div style="font-weight: 600; color: #1f2937;">${trade.instrument.tradingsymbol} (${trade.direction})</div>
                                            <div style="color: ${(trade.pnl || 0) >= 0 ? '#10B981' : '#EF4444'}; font-weight: 600;">₹${(trade.pnl || 0).toLocaleString()}</div>
                                        </div>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; color: #6b7280;">
                                            <div><strong>Entry:</strong> ₹${trade.entryPrice}</div>
                                            <div><strong>Exit:</strong> ₹${trade.exitPrice || '-'}</div>
                                            <div><strong>Qty:</strong> ${trade.quantity}</div>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #6b7280;">
                                            <div><strong>Reason:</strong> ${trade.exitReason || trade.status}</div>
                                            <div><strong>Date:</strong> ${new Date(trade.entryTime).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <div style="text-align: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb;">
                                <small style="color: #6b7280;">Showing last 5 trades • <a href="/execution/status" style="color: #3B82F6;">View all trades</a></small>
                            </div>
                        ` : '<div style="color: #6b7280;">No trades executed yet</div>'}
                    </div>
                </div>

                <div class="status-card warning">
                    <div class="card-title">⚙️ System Configuration</div>
                    <div class="card-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                            <div>
                                <div><strong>NIFTY Contract:</strong> ${currentContract ? currentContract.tradingsymbol : 'Loading...'}</div>
                                <div><strong>Lot Size:</strong> ${tradingConfig?.niftyLotSize || 75}</div>
                                <div><strong>Max Retries:</strong> ${tradingConfig?.maxRetries || 3}</div>
                                <div><strong>Order Timeout:</strong> ${tradingConfig?.orderTimeout || 5000}ms</div>
                            </div>
                            <div>
                                <div><strong>Data File:</strong> trading-data.json</div>
                                <div><strong>Log Level:</strong> INFO</div>
                                <div><strong>Pivot Algorithm:</strong> 15,15 lookback</div>
                                <div><strong>Volume SMA:</strong> 50-period</div>
                            </div>
                        </div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                            💡 Toggle paper trading mode in <a href="/execution/config" style="color: #3B82F6;">execution config</a>
                        </div>
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
                
                <a href="/breakout-strategy/status" class="action-btn">
                    📊 Strategy Status API
                </a>
                
                <a href="/breakout-strategy/pivots" class="action-btn">
                    📍 Pivot Data API
                </a>
                
                <a href="/breakout-strategy/marking-candle" class="action-btn">
                    🕯️ Marking Candle API
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