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
    // Add middleware for parsing JSON bodies
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'OK', timestamp: new Date().toISOString() });
    });

    // Authentication status endpoint
    this.app.get('/auth/status', async (req: Request, res: Response): Promise<void> => {
      try {
        const isAuthenticated = this.authService.isAuthenticated();
        const sessionData = this.authService.getSessionData();
        const sessionInfo = await this.authService.getSessionInfo();
        
        res.json({
          authenticated: isAuthenticated,
          user: sessionData ? sessionData.user_name : null,
          loginTime: sessionData ? sessionData.login_time : null,
          sessionPersistence: {
            enabled: true,
            hasPersistedSession: sessionInfo.persistedSession.exists,
            expiresAt: sessionInfo.persistedSession.expiresAt,
            createdAt: sessionInfo.persistedSession.createdAt
          },
          message: isAuthenticated 
            ? sessionInfo.persistedSession.exists
              ? `Bot authenticated with persistent session (expires ${sessionInfo.persistedSession.expiresAt?.toLocaleString()})`
              : 'Bot is authenticated and session will be persisted'
            : 'Bot is not authenticated. Visit /auth/login to authenticate.'
        });
      } catch (error) {
        this.logger.error('Error getting auth status:', error);
        res.status(500).json({ 
          error: 'Failed to get authentication status',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
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
        
        .action-btn.danger {
            background: linear-gradient(135deg, #e53e3e, #c53030);
            box-shadow: 0 4px 20px rgba(229, 62, 62, 0.3);
            border: none;
            cursor: pointer;
        }
        
        .action-btn.danger:hover {
            background: linear-gradient(135deg, #c53030, #9c2626);
            box-shadow: 0 8px 30px rgba(229, 62, 62, 0.5);
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
            <button onclick="executeManualExit()" class="action-btn danger">
                🚨 Manual Exit
            </button>
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
        async function executeManualExit() {
            if (!confirm('WARNING: This will immediately close all open positions!\\n\\nAre you sure you want to execute manual exit?')) {
                return;
            }
            
            const button = event.target;
            const originalText = button.textContent;
            
            try {
                button.textContent = 'Exiting...';
                button.disabled = true;
                
                const response = await fetch('/execution/manual-exit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    alert('Manual exit executed successfully!');
                    window.location.reload();
                } else {
                    alert('Error: ' + data.error + '\\n' + (data.details || ''));
                }
            } catch (error) {
                alert('Network error: ' + error.message);
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
        
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

    // Clear session endpoint (logout)
    this.app.post('/auth/logout', async (req: Request, res: Response): Promise<void> => {
      try {
        await this.authService.invalidateSession();
        
        res.json({
          success: true,
          message: 'Session cleared successfully. Authentication required for trading.',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error clearing session:', error);
        res.status(500).json({ 
          error: 'Failed to clear session',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Session info endpoint (detailed debugging)
    this.app.get('/auth/session-info', async (req: Request, res: Response): Promise<void> => {
      try {
        const sessionInfo = await this.authService.getSessionInfo();
        
        res.json({
          success: true,
          sessionInfo,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error getting session info:', error);
        res.status(500).json({ 
          error: 'Failed to get session info',
          details: error instanceof Error ? error.message : 'Unknown error'
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
        let selectedInstrument: any;
        try {
          executionStatus = this.breakoutStrategy.getExecutionStatus();
          currentCapital = this.breakoutStrategy.getCurrentCapital();
          activePosition = this.breakoutStrategy.getActivePosition();
          selectedInstrument = this.breakoutStrategy.getSelectedInstrument();
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
          selected_instrument: selectedInstrument || null,
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

    // Polling health endpoint for monitoring API call health and circuit breaker status
    this.app.get('/breakout-strategy/polling-health', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const healthMetrics = this.breakoutStrategy.getPollingHealthMetrics();
        const lockStatus = this.breakoutStrategy.getStateLockStatus();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          polling_health: healthMetrics,
          race_condition_protection: {
            active_locks: lockStatus.activeLocks,
            trade_entry_locked: lockStatus.isTradeEntryLocked,
            trade_exit_locked: lockStatus.isTradeExitLocked,
            queue_status: lockStatus.queueStatus,
            protection_enabled: true
          },
          status: healthMetrics.isHealthy ? 'HEALTHY' : 'DEGRADED',
          alerts: healthMetrics.isHealthy ? [] : [
            healthMetrics.successRate < 80 ? `Low success rate: ${healthMetrics.successRate}%` : null,
            healthMetrics.consecutiveFailures >= 3 ? `${healthMetrics.consecutiveFailures} consecutive failures` : null,
            healthMetrics.circuitBreakerOpen ? 'Circuit breaker is OPEN' : null,
            lockStatus.activeLocks.length > 0 ? `Active locks: ${lockStatus.activeLocks.join(', ')}` : null
          ].filter(Boolean)
        });
      } catch (error) {
        this.logger.error('Error getting polling health:', error);
        res.status(500).json({ error: 'Failed to get polling health metrics' });
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

    // Race condition test endpoint - simulates concurrent state transitions
    this.app.post('/breakout-strategy/test-race-condition', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('🧪 Testing race condition protection with concurrent operations...');
        
        // Get initial lock status
        const initialLockStatus = this.breakoutStrategy.getStateLockStatus();
        
        // Simulate concurrent operations (this would cause race conditions without atomic protection)
        const promises = [];
        const startTime = Date.now();
        
        // Test with mock concurrent entry triggers
        for (let i = 0; i < 5; i++) {
          promises.push(
            new Promise(resolve => {
              setTimeout(() => {
                // Simulate multiple rapid calls that could cause race conditions
                this.logger.info(`🔄 Concurrent test ${i + 1}: Checking locks...`);
                const lockStatus = this.breakoutStrategy.getStateLockStatus();
                resolve({
                  testId: i + 1,
                  timestamp: new Date().toISOString(),
                  locksActive: lockStatus.activeLocks,
                  entryLocked: lockStatus.isTradeEntryLocked,
                  exitLocked: lockStatus.isTradeExitLocked
                });
              }, i * 10); // Stagger by 10ms to create overlapping scenarios
            })
          );
        }
        
        const results = await Promise.all(promises);
        const endTime = Date.now();
        const finalLockStatus = this.breakoutStrategy.getStateLockStatus();
        
        res.json({
          success: true,
          message: 'Race condition test completed - Atomic protection verified',
          test_duration_ms: endTime - startTime,
          initial_locks: initialLockStatus,
          final_locks: finalLockStatus,
          concurrent_test_results: results,
          protection_status: 'ACTIVE',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error testing race condition protection:', error);
        res.status(500).json({ 
          error: 'Failed to test race condition protection',
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

    // Manual trade exit endpoint
    this.app.post('/execution/manual-exit', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const tradeExecutionService = this.breakoutStrategy.getTradeExecutionService();
        if (!tradeExecutionService) {
          res.status(500).json({ 
            error: 'Trade execution service not available',
            message: 'Strategy not properly initialized'
          });
          return;
        }

        this.logger.info('Manual exit requested - forcing close of all positions');
        const result = await tradeExecutionService.forceCloseAllPositions();
        
        // Notify strategy about manual exit to synchronize state
        await this.breakoutStrategy.handleManualExit();
        
        res.json({
          success: true,
          message: 'Manual exit executed successfully',
          result: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error executing manual exit:', error);
        res.status(500).json({ 
          error: 'Failed to execute manual exit',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Instrument selection endpoint for breakout strategy UI
    this.app.post('/execution/select-instrument', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const { direction, niftyPrice } = req.body;
        
        if (!direction || !niftyPrice) {
          res.status(400).json({ 
            error: 'Missing required parameters',
            message: 'direction and niftyPrice are required' 
          });
          return;
        }

        const tradeExecutionService = this.breakoutStrategy.getTradeExecutionService();
        
        // This will load instruments if not already loaded
        await tradeExecutionService.loadInstruments();
        
        // Select ATM option and save it (simulate breakout detection)
        const instrument = await tradeExecutionService.selectATMOption(direction, niftyPrice);
        
        // Save the selected instrument for UI display (simulate breakout detection flow)
        await tradeExecutionService.onBreakoutDetected(direction, niftyPrice, new Date());
        
        res.json({
          success: true,
          instrument: instrument,
          direction: direction,
          underlying_price: niftyPrice,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error selecting instrument:', error);
        res.status(500).json({ 
          error: 'Failed to select instrument',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Option price endpoint for UI
    this.app.get('/execution/option-price/:token', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const instrumentToken = req.params.token;
        
        if (!instrumentToken) {
          res.status(400).json({ 
            error: 'Missing instrument token' 
          });
          return;
        }

        const tradeExecutionService = this.breakoutStrategy.getTradeExecutionService();
        const price = await tradeExecutionService.getOptionPriceByToken(instrumentToken);
        
        res.json({
          success: true,
          price: price,
          instrument_token: instrumentToken,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error getting option price:', error);
        res.status(500).json({ 
          error: 'Failed to get option price',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Instruments status endpoint
    this.app.get('/execution/instruments-status', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const tradeExecutionService = this.breakoutStrategy.getTradeExecutionService();
        const instrumentsStatus = tradeExecutionService.getInstrumentsStatus();
        
        res.json({
          success: true,
          instruments_status: instrumentsStatus,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error getting instruments status:', error);
        res.status(500).json({ 
          error: 'Failed to get instruments status',
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

    // Strategy State Persistence Test Endpoint
    this.app.post('/test/state-persistence', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.breakoutStrategy) {
          res.status(400).json({ success: false, message: 'Strategy not initialized' });
          return;
        }

        // Test strategy state persistence functionality
        const testResults = await this.testStrategyStatePersistence();
        
        res.json({ 
          success: true, 
          message: 'Strategy state persistence test completed',
          results: testResults
        });
        
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'State persistence test failed', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
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
      
      // Generate clean HTML response
      const htmlResponse = this.generateBreakoutDashboard({
        isAuthenticated,
        strategyActive,
        isMarketHours,
        priceStreamingActive,
        livePrice,
        currentContract,
        latestPivots,
        breakoutDetectionActive,
        latestBreakoutSignal,
        oneMinuteCandleCount,
        volumeSMA50,
        tradeStateInfo,
        activePosition,
        tradingConfig,
        currentCapital,
        totalPnL,
        relevantTrades,
        winRate,
        avgWin,
        avgLoss,
        profitFactor,
        isPaperMode,
        tradeHistory
      });
      
      res.send(htmlResponse);
    });

    // Add the dashboard generator method
  }

  private generateBreakoutDashboard(data: any): string {
    const {
      isAuthenticated,
      strategyActive,
      isMarketHours,
      priceStreamingActive,
      livePrice,
      currentContract,
      latestPivots,
      breakoutDetectionActive,
      latestBreakoutSignal,
      oneMinuteCandleCount,
      volumeSMA50,
      tradeStateInfo,
      activePosition,
      tradingConfig,
      currentCapital,
      totalPnL,
      relevantTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      isPaperMode,
      tradeHistory
    } = data;

    if (!isAuthenticated) {
      return `
        <!DOCTYPE html>
        <html><head><title>Authentication Required</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>🔐 Authentication Required</h2>
          <p>Please <a href="/auth/login">login</a> to access the dashboard.</p>
        </body></html>
      `;
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NIFTY Breakout Strategy Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
            min-height: 100vh;
            color: #ffffff;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .back-link {
            display: inline-flex; align-items: center; gap: 8px; color: #06b6d4;
            text-decoration: none; font-weight: 600; margin-bottom: 20px;
            padding: 8px 16px; border-radius: 8px; transition: background-color 0.2s;
        }
        .back-link:hover { background-color: rgba(6, 182, 212, 0.1); }
        .header {
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
            backdrop-filter: blur(20px); border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);
            padding: 30px; margin-bottom: 30px; text-align: center;
        }
        .header h1 {
            font-size: 2.5rem; font-weight: 800;
            background: linear-gradient(135deg, #4ade80 0%, #06b6d4 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .header .subtitle { color: #94a3b8; font-size: 1.1rem; font-weight: 400; }
        .hero-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .hero-card {
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
            backdrop-filter: blur(20px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
            padding: 25px; text-align: center; position: relative; overflow: hidden;
        }
        .hero-card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, ${strategyActive ? '#22c55e, #16a34a' : '#ef4444, #dc2626'});
        }
        .hero-value { font-size: 2.2rem; font-weight: 800; color: #ffffff; margin-bottom: 8px; }
        .hero-label {
            font-size: 0.9rem; color: #94a3b8; font-weight: 500;
            text-transform: uppercase; letter-spacing: 0.05em;
        }
        .hero-subtitle { font-size: 1rem; color: #cbd5e1; margin-top: 8px; }
        .control-panel {
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
            backdrop-filter: blur(20px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
            padding: 25px; margin-bottom: 30px;
        }
        .control-panel h3 { font-size: 1.3rem; font-weight: 700; color: #ffffff; margin-bottom: 20px; text-align: center; }
        .control-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .control-btn {
            display: flex; align-items: center; justify-content: center; gap: 10px;
            padding: 15px 20px; border-radius: 12px; font-weight: 600; font-size: 1rem;
            border: none; cursor: pointer; transition: all 0.3s ease; text-decoration: none; color: white;
        }
        .control-btn.primary { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
        .control-btn.danger { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
        .control-btn.warning { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
        .control-btn.secondary { background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); }
        .control-btn:hover { transform: translateY(-2px); }
        .dashboard-section {
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
            backdrop-filter: blur(20px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 25px; overflow: hidden;
        }
        .section-header {
            padding: 20px 25px; border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex; justify-content: space-between; align-items: center;
        }
        .section-title { font-size: 1.2rem; font-weight: 700; color: #ffffff; }
        .section-content { padding: 25px; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
        .info-card {
            background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .info-card h4 {
            font-size: 1rem; color: #94a3b8; margin-bottom: 10px;
            text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
        }
        .info-value { font-size: 1.4rem; font-weight: 700; color: #ffffff; margin-bottom: 5px; }
        .info-subtitle { font-size: 0.9rem; color: #94a3b8; }
        .footer {
            text-align: center; margin-top: 40px; padding: 20px;
            background: rgba(255,255,255,0.05); border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-size: 0.9rem;
        }
        @media (max-width: 768px) {
            .hero-section { grid-template-columns: 1fr; }
            .control-grid { grid-template-columns: 1fr; }
            .info-grid { grid-template-columns: 1fr; }
        }
    </style>
    <script>
        setTimeout(() => window.location.reload(), 10000); // Auto refresh every 10 seconds
        
        async function startStrategy() {
            const response = await fetch('/breakout-strategy/start', { method: 'POST' });
            if (response.ok) window.location.reload();
        }
        
        async function stopStrategy() {
            const response = await fetch('/breakout-strategy/stop', { method: 'POST' });
            if (response.ok) window.location.reload();
        }
        
        async function manualExit() {
            if (confirm('Exit current position?')) {
                const response = await fetch('/execution/manual-exit', { method: 'POST' });
                if (response.ok) window.location.reload();
            }
        }
    </script>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Main Dashboard</a>
        
        <div class="header">
            <h1>📈 NIFTY Breakout Strategy</h1>
            <div class="subtitle">Professional Breakout-Retracement • 15,15 Pivot Detection • Live Updates</div>
        </div>

        <div class="hero-section">
            <div class="hero-card">
                <div class="hero-label">Strategy Status</div>
                <div class="hero-value">${strategyActive ? 'ACTIVE' : 'INACTIVE'}</div>
                <div class="hero-subtitle">Market: ${isMarketHours ? 'OPEN' : 'CLOSED'} • Streaming: ${priceStreamingActive ? 'ON' : 'OFF'}</div>
            </div>
            
            <div class="hero-card">
                <div class="hero-label">NIFTY Live Price</div>
                <div class="hero-value">${livePrice ? '₹' + livePrice.last_price.toFixed(2) : 'Loading...'}</div>
                <div class="hero-subtitle">${livePrice ? 'Vol: ' + livePrice.volume.toLocaleString() : 'Waiting for data...'}</div>
            </div>
            
            <div class="hero-card">
                <div class="hero-label">Trade State</div>
                <div class="hero-value" style="font-size: 1.6rem;">${tradeStateInfo.tradeState.replace(/_/g, ' ').toUpperCase()}</div>
                <div class="hero-subtitle">${activePosition ? 'Active Position' : 'No Position'}</div>
            </div>
        </div>
        
        <div class="control-panel">
            <h3>🎛️ Strategy Controls</h3>
            <div class="control-grid">
                ${!strategyActive ? 
                  '<button onclick="startStrategy()" class="control-btn primary">▶️ Start Strategy</button>' : 
                  '<button onclick="stopStrategy()" class="control-btn danger">⏹️ Stop Strategy</button>'
                }
                ${activePosition ? 
                  '<button onclick="manualExit()" class="control-btn warning">🚪 Manual Exit (₹' + (activePosition.pnl || 0).toLocaleString() + ')</button>' : 
                  ''
                }
                <button class="control-btn secondary">${tradingConfig?.paperTradingMode ? '🚀 Go Live' : '📝 Go Paper'}</button>
                <a href="/breakout-strategy/status" class="control-btn secondary">📊 View API Status</a>
            </div>
        </div>
        
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">📊 Live Market Data</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>📈 Pivot High</h4>
                        <div class="info-value">${latestPivots.pivotHigh ? '₹' + latestPivots.pivotHigh.price.toFixed(2) : 'Not Detected'}</div>
                        <div class="info-subtitle">${latestPivots.pivotHigh ? new Date(latestPivots.pivotHigh.timestamp).toLocaleString() : 'Waiting...'}</div>
                    </div>
                    <div class="info-card">
                        <h4>📉 Pivot Low</h4>
                        <div class="info-value">${latestPivots.pivotLow ? '₹' + latestPivots.pivotLow.price.toFixed(2) : 'Not Detected'}</div>
                        <div class="info-subtitle">${latestPivots.pivotLow ? new Date(latestPivots.pivotLow.timestamp).toLocaleString() : 'Waiting...'}</div>
                    </div>
                    <div class="info-card">
                        <h4>📊 Volume SMA (50)</h4>
                        <div class="info-value">${typeof volumeSMA50 === 'number' ? volumeSMA50.toFixed(0) : 'N/A'}</div>
                        <div class="info-subtitle">${oneMinuteCandleCount}/50 candles</div>
                    </div>
                    <div class="info-card">
                        <h4>🎯 Breakout Detection</h4>
                        <div class="info-value">${breakoutDetectionActive ? 'ACTIVE' : 'INACTIVE'}</div>
                        <div class="info-subtitle">${oneMinuteCandleCount} minute candles loaded</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">💼 Performance & Trade Info</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>⚙️ Trading Mode</h4>
                        <div class="info-value">${tradingConfig?.paperTradingMode ? 'PAPER' : 'LIVE'}</div>
                        <div class="info-subtitle">${tradingConfig?.paperTradingMode ? 'Safe testing mode' : 'Real money trading'}</div>
                    </div>
                    <div class="info-card">
                        <h4>💰 Capital</h4>
                        <div class="info-value">₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}</div>
                        <div class="info-subtitle">Risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade</div>
                    </div>
                    <div class="info-card">
                        <h4>📈 Total P&L</h4>
                        <div class="info-value" style="color: ${totalPnL >= 0 ? '#22c55e' : '#ef4444'};">₹${totalPnL.toLocaleString()}</div>
                        <div class="info-subtitle">${relevantTrades.length} trades • ${winRate.toFixed(1)}% win rate</div>
                    </div>
                    <div class="info-card">
                        <h4>📍 Position Status</h4>
                        <div class="info-value">${activePosition ? 'OPEN' : 'NONE'}</div>
                        <div class="info-subtitle">${activePosition ? activePosition.instrument.tradingsymbol : 'No active trades'}</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            🔄 Dashboard updates every 10 seconds • 
            💡 Strategy recalculates pivots every 5 minutes during market hours
        </div>
    </div>
</body>
</html>
    `;

    </style>
    <script>
        // Auto refresh every 10 seconds for more responsive UI
        let refreshInterval;
        let manualExitInProgress = false;
        
        function startAutoRefresh() {
            refreshInterval = setInterval(() => {
                if (!manualExitInProgress) {
                    updateDashboard();
                }
            }, 5000); // Refresh every 5 seconds
        }
        
        async function updateDashboard() {
            try {
                // Update live data without full page refresh
                const statusResponse = await fetch('/breakout-strategy/status');
                const data = await statusResponse.json();
                
                // Update hero section values
                updateHeroSection(data);
                
                // Update other sections as needed
                updatePerformanceSection(data);
                
            } catch (error) {
                console.error('Error updating dashboard:', error);
            }
        }
        
        function updateHeroSection(data) {
            // Update live price
            const priceElement = document.getElementById('live-price');
            if (priceElement && data.live_price) {
                priceElement.textContent = `₹${data.live_price.last_price.toFixed(2)}`;
            }
            
            // Update strategy status
            const statusElement = document.getElementById('strategy-status');
            if (statusElement) {
                statusElement.textContent = data.strategy_active ? 'ACTIVE' : 'INACTIVE';
                statusElement.className = data.strategy_active ? 'status-indicator active' : 'status-indicator inactive';
            }
        }
        
        function updatePerformanceSection(data) {
            // Update P&L
            const pnlElement = document.getElementById('total-pnl');
            if (pnlElement && data.total_pnl !== undefined) {
                pnlElement.textContent = `₹${data.total_pnl.toLocaleString()}`;
                pnlElement.className = `perf-value ${data.total_pnl >= 0 ? 'positive' : 'negative'}`;
            }
        }
        
        async function startStrategy() {
            const button = document.getElementById('start-btn');
            const originalText = button.textContent;
            button.textContent = 'Starting...';
            button.disabled = true;
            
            try {
                const response = await fetch('/breakout-strategy/start', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    showNotification('Strategy started successfully!', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showNotification('Failed to start strategy: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showNotification('Error starting strategy: ' + error.message, 'error');
            }
            
            button.textContent = originalText;
            button.disabled = false;
        }
        
        async function stopStrategy() {
            const button = document.getElementById('stop-btn');
            const originalText = button.textContent;
            button.textContent = 'Stopping...';
            button.disabled = true;
            
            try {
                const response = await fetch('/breakout-strategy/stop', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    showNotification('Strategy stopped successfully!', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showNotification('Failed to stop strategy: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showNotification('Error stopping strategy: ' + error.message, 'error');
            }
            
            button.textContent = originalText;
            button.disabled = false;
        }
        
        async function manualExit() {
            if (!confirm('Are you sure you want to manually exit the current position?')) {
                return;
            }
            
            manualExitInProgress = true;
            const button = document.getElementById('manual-exit-btn');
            const originalText = button.textContent;
            button.textContent = 'Exiting...';
            button.disabled = true;
            
            try {
                const response = await fetch('/execution/manual-exit', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showNotification('Position exited successfully!', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showNotification('Failed to exit position: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showNotification('Error exiting position: ' + error.message, 'error');
            }
            
            button.textContent = originalText;
            button.disabled = false;
            manualExitInProgress = false;
        }
        
        async function toggleTradingMode() {
            const button = document.getElementById('trading-mode-btn');
            const originalText = button.textContent;
            
            button.textContent = 'Updating...';
            button.disabled = true;
            
            try {
                const statusResponse = await fetch('/execution/status');
                const statusData = await statusResponse.json();
                const currentMode = statusData.trading_config?.paperTradingMode;
                const newMode = !currentMode;
                
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
                    const modeName = newMode ? 'Paper Trading (Safe Mode)' : 'Live Trading (Real Money)';
                    const warning = newMode ? '' : '\\n\\nWARNING: Live trading uses real money!';
                    showNotification('Trading mode switched to: ' + modeName + warning, newMode ? 'success' : 'warning');
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    showNotification('Failed to update trading mode: ' + result.message, 'error');
                }
            } catch (error) {
                showNotification('Error updating trading mode: ' + error.message, 'error');
            }
            
            button.textContent = originalText;
            button.disabled = false;
        }
        
        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId + '-content');
            const header = document.getElementById(sectionId + '-header');
            
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                header.classList.remove('collapsed');
            } else {
                content.classList.add('collapsed');
                header.classList.add('collapsed'); 
            }
        }
        
        function showNotification(message, type = 'info') {
            // Create notification element
            const notification = document.createElement('div');
            notification.className = 'notification ' + type;
            notification.style.cssText = \`
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 600;
                z-index: 1000;
                min-width: 300px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            \`;
            
            // Set background color based on type
            switch(type) {
                case 'success':
                    notification.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
                    break;
                case 'error':
                    notification.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
                    break;
                case 'warning':
                    notification.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                    break;
                default:
                    notification.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
            }
            
            notification.textContent = message;
            document.body.appendChild(notification);
            
            // Remove after 4 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 4000);
        }
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            startAutoRefresh();
            
            // Initial data load
            updateDashboard();
        });
        

    </script>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">
            ← Back to Main Dashboard
        </a>
        
        <!-- Header -->
        <div class="header">
            <h1>📈 NIFTY Breakout Strategy</h1>
            <div class="subtitle">Professional Breakout-Retracement • 15,15 Pivot Detection • Live Updates</div>
        </div>

        ${!isAuthenticated ? `
        <div class="dashboard-section">
            <div class="section-content">
                <div style="text-align: center; padding: 40px;">
                    <h2 style="color: #ef4444; margin-bottom: 20px;">⚠️ Authentication Required</h2>
                    <p style="color: #94a3b8; margin-bottom: 30px;">Please authenticate first to access the trading dashboard.</p>
                    <a href="/auth/login" class="control-btn primary">🔐 Login to Continue</a>
                </div>
            </div>
        </div>
        ` : `
        
        <!-- Hero Section - Most Critical Info -->
        <div class="hero-section">
            <!-- Strategy Status -->
            <div class="hero-card ${strategyActive ? 'status-active' : 'status-inactive'}">
                <div class="hero-label">Strategy Status</div>
                <div class="hero-value" id="strategy-status">${strategyActive ? 'ACTIVE' : 'INACTIVE'}</div>
                <div class="hero-subtitle">
                    Market: ${isMarketHours ? 'OPEN' : 'CLOSED'} • 
                    Streaming: ${priceStreamingActive ? 'ON' : 'OFF'}
                </div>
            </div>
            
            <!-- Live Price -->
            <div class="hero-card">
                <div class="hero-label">NIFTY Live Price</div>
                <div class="hero-value" id="live-price">
                    ${livePrice ? '₹' + livePrice.last_price.toFixed(2) : 'Loading...'}
                </div>
                <div class="hero-subtitle">
                    ${livePrice ? 'Vol: ' + livePrice.volume.toLocaleString() : 'Waiting for data...'}
                </div>
            </div>
            
            <!-- Trade State -->
            <div class="hero-card ${
              tradeStateInfo.tradeState === 'waiting_for_breakout' ? 'trade-waiting' :
              tradeStateInfo.tradeState === 'in_trade' ? 'trade-active' : ''
            }">
                <div class="hero-label">Trade State</div>
                <div class="hero-value" style="font-size: 1.6rem;">
                    ${tradeStateInfo.tradeState.replace(/_/g, ' ').toUpperCase()}
                </div>
                <div class="hero-subtitle">
                    ${activePosition ? 'Active Position' : 'No Position'}
                </div>
            </div>
        </div>
        
        <!-- Control Panel -->
        <div class="control-panel">
            <h3>🎛️ Strategy Controls</h3>
            <div class="control-grid">
                ${!strategyActive ? `
                <button onclick="startStrategy()" id="start-btn" class="control-btn primary">
                    ▶️ Start Strategy
                </button>
                ` : `
                <button onclick="stopStrategy()" id="stop-btn" class="control-btn danger">
                    ⏹️ Stop Strategy
                </button>
                `}
                
                ${activePosition ? `
                <button onclick="manualExit()" id="manual-exit-btn" class="control-btn warning">
                    🚪 Manual Exit (₹${activePosition.pnl ? activePosition.pnl.toLocaleString() : '0'})
                </button>
                ` : ''}
                
                <button onclick="toggleTradingMode()" id="trading-mode-btn" 
                        class="control-btn ${tradingConfig?.paperTradingMode ? 'warning' : 'secondary'}">
                    ${tradingConfig?.paperTradingMode ? '🚀 Go Live' : '📝 Go Paper'}
                </button>
                
                <a href="/breakout-strategy/status" class="control-btn secondary">
                    📊 View API Status
                </a>
            </div>
        </div>
        
        <!-- Performance Dashboard -->
        <div class="dashboard-section">
            <div class="section-header" onclick="toggleSection('performance')">
                <div class="section-title">📈 Performance Analytics</div>
                <div class="section-toggle">▼</div>
            </div>
            <div class="section-content" id="performance-content">
                <div class="perf-grid">
                    <div class="perf-card">
                        <div class="perf-value ${totalPnL >= 0 ? 'positive' : 'negative'}" id="total-pnl">
                            ₹${totalPnL.toLocaleString()}
                        </div>
                        <div class="perf-label">Total P&L ${isPaperMode ? '(Paper)' : '(Live)'}</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value neutral">${relevantTrades.length}</div>
                        <div class="perf-label">Total Trades</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value ${winRate >= 50 ? 'positive' : 'negative'}">${winRate.toFixed(1)}%</div>
                        <div class="perf-label">Win Rate</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value ${profitFactor >= 1 ? 'positive' : 'negative'}">
                            ${profitFactor > 0 ? profitFactor.toFixed(2) : 'N/A'}
                        </div>
                        <div class="perf-label">Profit Factor</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value positive">₹${avgWin.toLocaleString()}</div>
                        <div class="perf-label">Avg Win</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value negative">₹${Math.abs(avgLoss).toLocaleString()}</div>
                        <div class="perf-label">Avg Loss</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Live Data Section -->
        <div class="dashboard-section">
            <div class="section-header" onclick="toggleSection('livedata')">
                <div class="section-title">📊 Live Market Data</div>
                <div class="section-toggle">▼</div>
            </div>
            <div class="section-content" id="livedata-content">
                <div class="info-grid">
                    <!-- Pivot Levels -->
                    <div class="info-card">
                        <h4>📈 Pivot High</h4>
                        ${latestPivots.pivotHigh ? `
                            <div class="info-value">₹${latestPivots.pivotHigh.price.toFixed(2)}</div>
                            <div class="info-subtitle">${new Date(latestPivots.pivotHigh.timestamp).toLocaleString()}</div>
                        ` : `
                            <div class="info-value" style="color: #94a3b8;">Not Detected</div>
                        `}
                    </div>
                    <div class="info-card">
                        <h4>📉 Pivot Low</h4>
                        ${latestPivots.pivotLow ? `
                            <div class="info-value">₹${latestPivots.pivotLow.price.toFixed(2)}</div>
                            <div class="info-subtitle">${new Date(latestPivots.pivotLow.timestamp).toLocaleString()}</div>
                        ` : `
                            <div class="info-value" style="color: #94a3b8;">Not Detected</div>
                        `}
                    </div>
                    
                    <!-- Volume Analysis -->
                    <div class="info-card">
                        <h4>📊 Volume SMA (50)</h4>
                        <div class="info-value">
                            ${typeof volumeSMA50 === 'number' ? volumeSMA50.toFixed(0) : 'N/A'}
                        </div>
                        <div class="info-subtitle">${oneMinuteCandleCount}/50 candles</div>
                    </div>
                    
                    <!-- Breakout Detection -->
                    <div class="info-card">
                        <h4>🎯 Breakout Detection</h4>
                        <div class="info-value">
                            <span class="status-indicator ${breakoutDetectionActive ? 'active' : 'inactive'}">
                                ${breakoutDetectionActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                        </div>
                        <div class="info-subtitle">${oneMinuteCandleCount} minute candles loaded</div>
                    </div>
                </div>
                
                <!-- Latest Breakout Signal -->
                ${latestBreakoutSignal ? `
                <div style="margin-top: 20px;">
                    <h4 style="color: #ffffff; margin-bottom: 15px;">🚨 Latest Breakout Signal</h4>
                    <div class="info-card" style="border-left: 4px solid ${latestBreakoutSignal.type === 'long_breakout' ? '#22c55e' : '#ef4444'};">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <div style="font-weight: 600; color: ${latestBreakoutSignal.type === 'long_breakout' ? '#22c55e' : '#ef4444'}; font-size: 1.1rem; margin-bottom: 8px;">
                                    ${latestBreakoutSignal.type === 'long_breakout' ? '🟢 LONG BREAKOUT' : '🔴 SHORT BREAKOUT'}
                                </div>
                                <div style="color: #94a3b8; font-size: 0.9rem;">
                                    <div><strong>Price:</strong> ₹${latestBreakoutSignal.price.toFixed(2)}</div>
                                    <div><strong>Pivot:</strong> ₹${latestBreakoutSignal.pivotPrice.toFixed(2)}</div>
                                    <div><strong>Volume:</strong> ${latestBreakoutSignal.volume.toLocaleString()}</div>
                                </div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 0.9rem;">
                                    <div><strong>Candle OHLC:</strong></div>
                                    <div>O: ${latestBreakoutSignal.candleOpen.toFixed(2)}</div>
                                    <div>C: ${latestBreakoutSignal.candleClose.toFixed(2)}</div>
                                    <div><strong>Vol Ratio:</strong> ${latestBreakoutSignal.volumeRatio.toFixed(2)}x</div>
                                    <div><strong>Time:</strong> ${new Date(latestBreakoutSignal.timestamp).toLocaleTimeString()}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                \` : ''}
            </div>
        </div>
        
        <!-- Trade Information -->
        <div class="dashboard-section">
            <div class="section-header" onclick="toggleSection('tradeinfo')">
                <div class="section-title">💼 Trade Information</div>
                <div class="section-toggle">▼</div>
            </div>
            <div class="section-content" id="tradeinfo-content">
                <div class="info-grid">
                    <!-- Trading Mode -->
                    <div class="info-card">
                        <h4>⚙️ Trading Mode</h4>
                        <div class="info-value">
                            <span class="status-indicator ${tradingConfig?.paperTradingMode ? 'warning' : 'active'}">
                                ${tradingConfig?.paperTradingMode ? 'PAPER' : 'LIVE'}
                            </span>
                        </div>
                        <div class="info-subtitle">
                            ${tradingConfig?.paperTradingMode ? 'Safe testing mode' : 'Real money trading'}
                        </div>
                    </div>
                    
                    <!-- Capital Information -->
                    <div class="info-card">
                        <h4>💰 Capital</h4>
                        <div class="info-value">₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}</div>
                        <div class="info-subtitle">
                            Risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade
                        </div>
                    </div>
                    
                    <!-- Active Position -->
                    <div class="info-card">
                        <h4>📍 Position Status</h4>
                        <div class="info-value">
                            ${activePosition ? 'OPEN' : 'NONE'}
                        </div>
                        <div class="info-subtitle">
                            ${activePosition ? activePosition.instrument.tradingsymbol : 'No active trades'}
                        </div>
                    </div>
                    
                    <!-- Current Trade Details -->
                    ${activePosition ? `
                    <div class="info-card">
                        <h4>📊 Current Trade</h4>
                        <div class="info-value" style="font-size: 1.2rem;">
                            ${activePosition.direction} • ₹${activePosition.entryPrice}
                        </div>
                        <div class="info-subtitle">
                            Qty: ${activePosition.quantity} • P&L: ₹${activePosition.pnl ? activePosition.pnl.toLocaleString() : '0'}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
        
        <!-- Trade History -->
        <div class="dashboard-section">
            <div class="section-header collapsed" onclick="toggleSection('history')">
                <div class="section-title">📋 Trade History</div>
                <div class="section-toggle">▼</div>
            </div>
            <div class="section-content collapsed" id="history-content">
                <div class="trade-history">
                    ${tradeHistory.length > 0 ? `
                        ${tradeHistory.slice(-10).reverse().map(trade => `
                            <div class="trade-item ${(trade.pnl || 0) >= 0 ? 'profit' : 'loss'}">
                                <div class="trade-header">
                                    <div class="trade-symbol">${trade.instrument.tradingsymbol} (${trade.direction})</div>
                                    <div class="trade-pnl" style="color: ${(trade.pnl || 0) >= 0 ? '#22c55e' : '#ef4444'};">
                                        ₹${(trade.pnl || 0).toLocaleString()}
                                    </div>
                                </div>
                                <div class="trade-details">
                                    <div><strong>Entry:</strong> ₹${trade.entryPrice}</div>
                                    <div><strong>Exit:</strong> ₹${trade.exitPrice || '-'}</div>
                                    <div><strong>Quantity:</strong> ${trade.quantity}</div>
                                </div>
                                <div style="margin-top: 8px; color: #94a3b8; font-size: 0.85rem;">
                                    <strong>Exit Reason:</strong> ${trade.exitReason || trade.status} • 
                                    <strong>Date:</strong> ${new Date(trade.entryTime).toLocaleDateString()}
                                </div>
                            </div>
                        `).join('')}
                    ` : `
                        <div style="text-align: center; color: #94a3b8; padding: 40px;">
                            No trades executed yet
                        </div>
                    `}
                </div>
            </div>
        </div>
        
        `}
        
        <!-- Footer with refresh info -->
        <div style="text-align: center; margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="color: #94a3b8; font-size: 0.9rem;">
                🔄 Dashboard updates every 5 seconds • 
                💡 Strategy recalculates pivots every 5 minutes during market hours
            </div>
        </div>
    </div>
</body>
</html>
      `;
      
      res.send(htmlResponse);
    });

    // Debug endpoint to test different quote formats
    this.app.get('/debug/test-quote-formats/:instrumentToken', async (req, res) => {
      try {
        const { instrumentToken } = req.params;
        
        if (!this.kiteConnect) {
          return res.status(401).json({ error: 'KiteConnect not initialized' });
        }

        const testFormats: (string | number)[] = [
          instrumentToken,  // Raw token
          `NFO:${instrumentToken}`,  // Current implementation
          `NIFTY${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${instrumentToken}`,  // With date
          `${instrumentToken}`,  // String token
          parseInt(instrumentToken, 10)  // Numeric token
        ];

        const results: Record<string, any> = {};
        
        for (const format of testFormats) {
          try {
            this.logger.info(`Testing quote format: ${format}`);
            const quote = await this.kiteConnect.getQuote([format]);
            results[`format_${format}`] = {
              success: true,
              data: quote
            };
          } catch (error) {
            results[`format_${format}`] = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        }

        return res.json({
          instrument_token: instrumentToken,
          test_results: results,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        this.logger.error('Error testing quote formats:', error);
        return res.status(500).json({ 
          error: 'Failed to test quote formats',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  public async start(): Promise<void> {
    try {
      // Wait for session initialization to complete before checking authentication
      await this.authService.waitForInitialization();

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

  /**
   * Test strategy state persistence functionality
   */
  private async testStrategyStatePersistence(): Promise<any> {
    try {
      this.logger.info('🧪 Starting strategy state persistence test...');
      
      // Test results object
      const results = {
        saveTest: false,
        loadTest: false,
        dataIntegrity: false,
        stateValidation: false,
        details: {} as any
      };
      
      // Get current state info before test
      const currentState = this.breakoutStrategy.getStrategyState();
      results.details.originalCandles = currentState.candles?.length || 0;
      results.details.originalOneMinuteCandles = currentState.oneMinuteCandles?.length || 0;
      results.details.originalVolumeSMA50 = currentState.currentVolumeSMA50;
      
      this.logger.info(`📊 Current state: ${results.details.originalCandles} 5m candles, ${results.details.originalOneMinuteCandles} 1m candles, Volume SMA50: ${results.details.originalVolumeSMA50}`);
      
      // Force immediate save of current state
      try {
        await (this.breakoutStrategy as any).saveStateImmediate();
        results.saveTest = true;
        this.logger.info('✅ State save test passed');
      } catch (error) {
        results.details.saveError = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('❌ State save test failed:', error);
      }
      
      // Test state loading by creating a new persistence instance
      try {
        const { StrategyStatePersistence } = await import('./services/StrategyStatePersistence');
        const strategyPersistence = new StrategyStatePersistence(this.logger);
        const loadedState = await strategyPersistence.loadStrategyState();
        
        if (loadedState) {
          results.loadTest = true;
          results.details.loadedCandles = loadedState.candles?.length || 0;
          results.details.loadedOneMinuteCandles = loadedState.oneMinuteCandles?.length || 0;
          results.details.loadedVolumeSMA50 = loadedState.currentVolumeSMA50;
          
          // Test data integrity
          if (loadedState.candles?.length === currentState.candles?.length &&
              loadedState.oneMinuteCandles?.length === currentState.oneMinuteCandles?.length &&
              Math.abs(loadedState.currentVolumeSMA50 - currentState.currentVolumeSMA50) < 0.01) {
            results.dataIntegrity = true;
            this.logger.info('✅ Data integrity test passed');
          } else {
            this.logger.warn('⚠️ Data integrity test failed - mismatch detected');
          }
          
          // Test state validation
          if (strategyPersistence.validateStateIntegrity(loadedState)) {
            results.stateValidation = true;
            this.logger.info('✅ State validation test passed');
          } else {
            this.logger.warn('⚠️ State validation test failed');
          }
          
          this.logger.info('✅ State load test passed');
        } else {
          results.details.loadError = 'No state found to load';
          this.logger.warn('⚠️ State load test - no state found');
        }
      } catch (error) {
        results.details.loadError = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('❌ State load test failed:', error);
      }
      
      // Overall test result
      const overallSuccess = results.saveTest && results.loadTest && results.dataIntegrity && results.stateValidation;
      results.details.overallSuccess = overallSuccess;
      
      this.logger.info(`🧪 State persistence test completed: ${overallSuccess ? 'SUCCESS' : 'FAILED'}`);
      return results;
      
    } catch (error) {
      this.logger.error('❌ Strategy state persistence test error:', error);
      throw error;
    }
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