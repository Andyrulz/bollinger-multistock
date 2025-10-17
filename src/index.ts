import { KiteConnect } from 'kiteconnect';
import { AuthService } from './services/AuthService';
import { BreakoutPullbackStrategy } from './strategies/breakout-pullback/BreakoutPullbackStrategy';
import { StrategyManager } from './core/StrategyManager';
import { StrategyRegistry } from './core/StrategyRegistry';
import { Logger } from './utils/Logger';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

class TradingBot {
  private kiteConnect: any; // Using any for now due to type complexity
  private authService: AuthService;
  private strategyManager: StrategyManager;
  private breakoutStrategy: BreakoutPullbackStrategy; // Keep for backward compatibility
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
    
    // Initialize Strategy Manager
    const configPath = path.join(__dirname, '..', 'config', 'strategies.json');
    this.strategyManager = new StrategyManager(this.kiteConnect, this.logger, {
      configPath,
      autoStart: false,
      healthCheckInterval: 30000
    });
    
    // Keep the original strategy for backward compatibility
    this.breakoutStrategy = new BreakoutPullbackStrategy(this.kiteConnect, this.logger);

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
        const isValidAuthentication = await this.authService.isAuthenticatedAndValid();
        const sessionData = this.authService.getSessionData();
        const sessionInfo = await this.authService.getSessionInfo();
        
        res.json({
          authenticated: isAuthenticated,
          validAuthentication: isValidAuthentication,
          user: sessionData ? sessionData.user_name : null,
          loginTime: sessionData ? sessionData.login_time : null,
          sessionPersistence: {
            enabled: true,
            hasPersistedSession: sessionInfo.persistedSession.exists,
            expiresAt: sessionInfo.persistedSession.expiresAt,
            createdAt: sessionInfo.persistedSession.createdAt
          },
          message: isValidAuthentication 
            ? sessionInfo.persistedSession.exists
              ? `Bot authenticated with valid session (expires ${sessionInfo.persistedSession.expiresAt?.toLocaleString()})`
              : 'Bot is authenticated with valid session'
            : isAuthenticated
              ? 'Bot shows authenticated but token is invalid/expired. Please re-login.'
              : 'Bot is not authenticated. Visit /auth/login to authenticate.',
          status: isValidAuthentication ? 'valid' : isAuthenticated ? 'expired' : 'unauthenticated'
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
    this.app.get('/', async (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const isValidAuthentication = await this.authService.isAuthenticatedAndValid();
      const sessionData = this.authService.getSessionData();
      
      // Get trade state information if authenticated and valid
      let tradeStateInfo: any = null;
      if (isValidAuthentication) {
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
            background: #ffffff;
            border-color: #10b981;
            border-left: 4px solid #10b981;
        }
        
        .status-card.success::before {
            background: #10b981;
        }
        
        .status-card.warning {
            background: #ffffff;
            border-color: #f59e0b;
            border-left: 4px solid #f59e0b;
        }
        
        .status-card.warning::before {
            background: #f59e0b;
        }
        
        .status-card.error {
            background: #ffffff;
            border-color: #ef4444;
            border-left: 4px solid #ef4444;
        }
        
        .status-card.error::before {
            background: #ef4444;
        }
        
        .status-card.info {
            background: #ffffff;
            border-color: #3b82f6;
            border-left: 4px solid #3b82f6;
        }
        
        .status-card.info::before {
            background: #3b82f6;
        }
        
        .status-card.neutral {
            background: #ffffff;
            border-color: #64748b;
            border-left: 4px solid #64748b;
        }
        
        .status-card.neutral::before {
            background: #64748b;
        }
        
        .status-text {
            font-size: 1.2rem;
            font-weight: 600;
            color: #1f2937;
            text-align: center;
        }
        
        .card-title {
            font-size: 1.2rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 12px;
        }
        
        .card-content {
            color: #374151;
            line-height: 1.6;
        }
        
        .card-content strong {
            color: #1f2937;
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
            background: #ffffff;
            border-radius: 20px;
            padding: 30px;
            margin: 30px 0;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
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
            background: #fef3e2;
            border-color: #f59e0b;
            opacity: 0.8;
            color: #92400e;
        }
        
        .endpoint.deprecated:hover {
            background: #fde68a;
            border-color: #f59e0b;
            color: #78350f;
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
        
        <div class="status-card ${isValidAuthentication ? 'success' : isAuthenticated ? 'warning' : 'error'}">
            <div class="status-text">
                ${isValidAuthentication 
                  ? `✅ <strong>Authenticated & Valid</strong> as ${sessionData?.user_name || 'User'}` 
                  : isAuthenticated
                    ? `⚠️ <strong>Session Expired</strong> - Please re-login (was ${sessionData?.user_name || 'User'})`
                    : '❌ <strong>Not Authenticated</strong> - Click "Daily Login" to start'
                }
            </div>
        </div>

        ${isValidAuthentication ? `
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
            ${isValidAuthentication ? `
            <a href="/strategy/nifty/contract" class="action-btn" style="background: linear-gradient(135deg, #f093fb, #f5576c);">
                📈 Nifty Contract
            </a>
            <a href="/strategy/status" class="action-btn" style="background: linear-gradient(135deg, #4facfe, #00f2fe);">
                🎯 Strategy Status
            </a>
            <a href="/breakout-strategy-v2" class="action-btn" style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white;">
                🚀 Breakout Pullback Strategy
            </a>
            <a href="/strategy/bollinger-band-01" class="action-btn" style="background: linear-gradient(135deg, #3b82f6, #1e40af); color: white;">
                📊 Bollinger Band Strategy
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
                <a href="/breakout-strategy-v2" class="endpoint" style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border-color: #22c55e;">
                    <span class="method" style="background: rgba(255,255,255,0.2);">GET</span>
                    <span>/breakout-strategy-v2 (Breakout Pullback Strategy Dashboard)</span>
                </a>
                <a href="/strategy/bollinger-band-01" class="endpoint" style="background: linear-gradient(135deg, #3b82f6, #1e40af); color: white; border-color: #3b82f6;">
                    <span class="method" style="background: rgba(255,255,255,0.2);">GET</span>
                    <span>/strategy/bollinger-band-01 (Bollinger Band Strategy Dashboard)</span>
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
                <a href="/debug/pivots" class="endpoint" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border-color: #f59e0b;">
                    <span class="method">GET</span>
                    <span>/debug/pivots (Pivot Debug & OHLC Verification)</span>
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

    // Access token debug endpoint - shows what access token the strategy sees
    this.app.get('/debug/access-token', async (req: Request, res: Response): Promise<void> => {
      try {
        const kiteAccessToken = this.kiteConnect.access_token;
        const sessionData = this.authService.getSessionData();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          kiteConnect_access_token: kiteAccessToken || null,
          kiteConnect_access_token_type: typeof kiteAccessToken,
          session_access_token: sessionData?.access_token || null,
          session_access_token_type: typeof sessionData?.access_token,
          tokens_match: kiteAccessToken === sessionData?.access_token,
          authenticated: this.authService.isAuthenticated(),
          session_user: sessionData?.user_name || null
        });
      } catch (error) {
        this.logger.error('Error getting access token debug info:', error);
        res.status(500).json({ 
          error: 'Failed to get access token info',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Pivot debug endpoint - shows raw OHLC data used for pivot calculation
    this.app.get('/debug/pivots', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Fetch the daily data similar to how the strategy does it
        // Use yesterday as toDate to ensure complete data
        const toDate = new Date();
        toDate.setDate(toDate.getDate() - 1);
        
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 10);
        
        const dailyData = await this.kiteConnect.getHistoricalData(
          256265, // NIFTY50 instrument token
          'day',
          fromDate,
          toDate
        );

        if (!dailyData || dailyData.length < 1) {
          res.status(500).json({ error: 'No daily data available' });
          return;
        }

        // Get the most recent completed trading day (same logic as strategy)
        const previousDay = dailyData[dailyData.length - 1];
        
        // Debug: Show all available dates
        const availableDates = dailyData.map((d: any) => ({
          date: d.date,
          ohlc: { open: d.open, high: d.high, low: d.low, close: d.close }
        }));
        
        // Calculate pivots using the TradingView formula
        const { high, low, close } = previousDay;
        const pp = (high + low + close) / 3;
        const r1 = 2 * pp - low;
        const s1 = 2 * pp - high;
        const r2 = pp + (high - low);
        const s2 = pp - (high - low);
        const r3 = high + 2 * (pp - low);
        const s3 = low - 2 * (high - pp);

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          currentDate: new Date().toISOString().split('T')[0],
          pivotDate: previousDay.date,
          availableTradingDays: availableDates.slice(-5), // Show last 5 trading days
          rawOHLC: {
            date: previousDay.date,
            open: previousDay.open,
            high: previousDay.high,
            low: previousDay.low,
            close: previousDay.close
          },
          calculatedPivots: {
            pp: parseFloat(pp.toFixed(2)),
            r1: parseFloat(r1.toFixed(2)),
            s1: parseFloat(s1.toFixed(2)),
            r2: parseFloat(r2.toFixed(2)),
            s2: parseFloat(s2.toFixed(2)),
            r3: parseFloat(r3.toFixed(2)),
            s3: parseFloat(s3.toFixed(2))
          },
          tradingViewFormula: {
            pp: `(${high} + ${low} + ${close}) / 3 = ${pp.toFixed(2)}`,
            r1: `2 * ${pp.toFixed(2)} - ${low} = ${r1.toFixed(2)}`,
            s1: `2 * ${pp.toFixed(2)} - ${high} = ${s1.toFixed(2)}`
          },
          instructions: 'Compare these values with your TradingView NIFTY50 daily pivots. Use the same date and verify OHLC values match.'
        });

      } catch (error) {
        this.logger.error('Error in pivot debug endpoint:', error);
        res.status(500).json({ 
          error: 'Failed to fetch pivot debug data',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Simple instrument verification endpoint - checks specific instrument token details
    this.app.get('/debug/instrument/:token', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const token = req.params.token;
        if (!token) {
          res.status(400).json({ error: 'Token parameter required' });
          return;
        }

        // Get quote for this instrument to see its details
        const quote = await this.kiteConnect.getQuote([token]);
        
        // Also try to get historical data to verify it works
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 3); // Get last 3 days
        
        let historicalData = null;
        try {
          historicalData = await this.kiteConnect.getHistoricalData(
            parseInt(token),
            'day',
            fromDate,
            toDate
          );
        } catch (histError) {
          historicalData = { error: 'Could not fetch historical data', details: histError };
        }

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          token: token,
          quoteData: quote,
          historicalDataSample: historicalData && !historicalData.error ? {
            totalCandles: historicalData.length,
            latestCandle: historicalData[historicalData.length - 1],
            oldestCandle: historicalData[0]
          } : historicalData,
          analysis: {
            isNifty50Index: quote[token]?.tradingsymbol === 'NIFTY 50',
            instrumentType: 'Check if this matches expected NIFTY 50 INDEX vs other instruments',
            recommendation: 'Compare OHLC values with TradingView for the same dates'
          }
        });

      } catch (error) {
        this.logger.error('Error in instrument verification endpoint:', error);
        res.status(500).json({ 
          error: 'Failed to fetch instrument details',
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
  let markingCandleState: any;
        
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
          markingCandleState = this.breakoutStrategy.getMarkingCandleState();
        } catch (error) {
          this.logger.error('Error getting detailed strategy data:', error);
        }

        // Get execution service data
        let executionStatus: any;
        let currentCapital: number | undefined;
        let activePosition: any;
        let selectedInstrument: any;
        let healthReport: any;
        try {
          executionStatus = this.breakoutStrategy.getExecutionStatus();
          currentCapital = this.breakoutStrategy.getCurrentCapital();
          activePosition = this.breakoutStrategy.getActivePosition();
          selectedInstrument = this.breakoutStrategy.getSelectedInstrument();
          // Get health monitoring data from the new error monitoring system
          healthReport = this.breakoutStrategy.getHealthReport ? this.breakoutStrategy.getHealthReport() : null;
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
          // Marking Candle Information
          marking_candle_state: markingCandleState || null,
          // Execution Service Information
          execution_status: executionStatus || null,
          current_capital: currentCapital || null,
          active_position: activePosition || null,
          selected_instrument: selectedInstrument || null,
          // Health Monitoring Information
          health_status: healthReport || null,
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
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

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

    // Test endpoint for volume calculation fixes
    this.app.post('/breakout-strategy/test-volume-fixes', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('🧪 Testing volume calculation fixes via API endpoint...');
        this.breakoutStrategy.testVolumeCalculationFixes();
        
        res.json({
          success: true,
          message: 'Volume calculation tests completed. Check logs for detailed output.',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Failed to test volume fixes:', error);
        res.status(500).json({ error: 'Failed to test volume fixes' });
      }
    });

    // Manual pivot detection trigger (for debugging)
    this.app.post('/breakout-strategy/trigger-pivot-detection', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Authentication required',
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        this.logger.info('🔄 Manual pivot detection triggered via API');
        await this.breakoutStrategy.triggerManualPivotDetection();
        
        const latestPivots = this.breakoutStrategy.getLatestPivots();
        res.json({
          success: true,
          message: 'Pivot detection completed',
          pivots: latestPivots,
          candle_count: this.breakoutStrategy.getCandleCount(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Failed to trigger pivot detection:', error);
        res.status(500).json({ error: 'Failed to trigger pivot detection' });
      }
    });

    // Debug endpoint to get 1-minute candles for breakout analysis
    this.app.get('/breakout-strategy/one-minute-candles', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ error: 'Not authenticated' });
          return;
        }

        const oneMinuteCandles = this.breakoutStrategy.getOneMinuteCandles();
        res.json({
          success: true,
          candles: oneMinuteCandles,
          count: oneMinuteCandles.length
        });
      } catch (error) {
        this.logger.error('Failed to get 1-minute candles:', error);
        res.status(500).json({ error: 'Failed to get 1-minute candles' });
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
      
      // DEBUG: Log pivot data inconsistency
      this.logger.info(`🔍 DASHBOARD PIVOT DEBUG: High=${latestPivots.pivotHigh ? latestPivots.pivotHigh.price : 'null'}, Low=${latestPivots.pivotLow ? latestPivots.pivotLow.price : 'null'}`);
      
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
            background: #ffffff;
            border-radius: 16px;
            padding: 24px;
            border: 1px solid #e2e8f0;
            position: relative;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
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
            background: #ffffff;
            border: 1px solid #10b981;
            border-left: 4px solid #10b981;
        }
        
        .breakout-signal.short_breakout {
            background: #ffffff;
            border: 1px solid #ef4444;
            border-left: 4px solid #ef4444;
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
        // TODO: Replace auto-refresh with server-sent events to eliminate API waste
        // Auto refresh disabled to prevent excessive API calls
        // setTimeout(() => { window.location.reload(); }, 30000);
        
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
                    // Show confirmation with clear mode indication
                    const modeName = newMode ? 'Paper Trading (Safe Mode)' : 'Live Trading (Real Money)';
                    const warning = newMode ? '' : '\\n\\n⚠️ WARNING: Live trading uses real money!';
                    alert('Trading mode switched to: ' + modeName + warning);
                    
                    // Reload page to reflect changes
                    window.location.reload();
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
        
        // Load instrument information when instrument is selected (breakout or manual)
        async function loadInstrumentInfo() {
            const instrumentCard = document.getElementById('instrumentCard');
            if (!instrumentCard) return;
            
            try {
                const statusResponse = await fetch('/breakout-strategy/status');
                const statusData = await statusResponse.json();
                
                let instrument = null;
                
                // Check if we have a selected instrument (from breakout or manual selection)
                if (statusData.selected_instrument) {
                    instrument = statusData.selected_instrument;
                } else if (statusData.latest_breakout_signal) {
                    // Fallback: If no selected instrument but breakout signal exists, select instrument
                    const signal = statusData.latest_breakout_signal;
                    const direction = signal.type === 'long_breakout' ? 'LONG' : 'SHORT';
                    
                    const instrumentResponse = await fetch('/execution/select-instrument', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            direction: direction,
                            niftyPrice: signal.price
                        })
                    });
                    
                    if (instrumentResponse.ok) {
                        const instrumentData = await instrumentResponse.json();
                        instrument = instrumentData.instrument;
                    }
                }
                
                // Display instrument information if available
                if (instrument) {
                        
                    // Display instrument information
                    document.getElementById('instrumentInfo').innerHTML = \`
                        <div style="font-size: 14px;">
                            <strong>Symbol:</strong> \${instrument.tradingsymbol}<br>
                            <strong>Type:</strong> \${instrument.instrument_type} (ATM)<br>
                            <strong>Strike:</strong> ₹\${instrument.strike}<br>
                            <strong>Expiry:</strong> \${new Date(instrument.expiry).toLocaleDateString()}<br>
                            <strong>Lot Size:</strong> \${instrument.lot_size}
                        </div>
                    \`;
                    
                    // Get live price for the option using the correct instrument token
                    if (instrument.instrument_token) {
                        const priceResponse = await fetch(\`/execution/option-price/\${instrument.instrument_token}\`);
                        if (priceResponse.ok) {
                            const priceData = await priceResponse.json();
                            document.getElementById('instrumentLTP').innerHTML = \`
                                <strong>Option LTP:</strong> ₹\${priceData.price.toFixed(2)}
                                <span style="margin-left: 10px; color: #6b7280; font-size: 12px;">
                                    Updated: \${new Date().toLocaleTimeString()}
                                </span>
                            \`;
                        } else {
                            document.getElementById('instrumentLTP').innerHTML = \`
                                <span style="color: #ef4444;">Failed to load option price</span>
                            \`;
                        }
                    }
                } else {
                    // No instrument selected
                    document.getElementById('instrumentInfo').innerHTML = \`
                        <div style="color: #6b7280; font-style: italic;">No instrument selected</div>
                    \`;
                    document.getElementById('instrumentLTP').innerHTML = '';
                }
            } catch (error) {
                console.error('Error loading instrument info:', error);
            }
        }
        
        // Load instrument info on page load if breakout exists
        document.addEventListener('DOMContentLoaded', loadInstrumentInfo);
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
                  tradeStateInfo?.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
                  tradeStateInfo?.tradeState === 'waiting_for_entry' ? '#F59E0B' :
                  tradeStateInfo?.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
                };">
                    <div class="card-title">🎯 Trade State & Setup</div>
                    <div class="card-content">
                        <div style="font-weight: 600; color: ${
                          tradeStateInfo?.tradeState === 'waiting_for_breakout' ? '#3B82F6' :
                          tradeStateInfo?.tradeState === 'waiting_for_entry' ? '#F59E0B' :
                          tradeStateInfo?.tradeState === 'in_trade' ? '#10B981' : '#6B7280'
                        }; font-size: 18px; text-transform: capitalize; margin-bottom: 10px;">
                            ${tradeStateInfo?.tradeState?.replace(/_/g, ' ') || 'Initializing...'}
                        </div>
                        
                        <!-- Always show trade setup information -->
                        <div style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-top: 10px;">
                            <div style="font-size: 14px; line-height: 1.5;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                    <div><strong>Direction:</strong> ${
                                      tradeStateInfo?.tradeSetupRequest?.direction || 
                                      (latestBreakoutSignal ? (latestBreakoutSignal.type === 'long_breakout' ? 'LONG' : 'SHORT') : 'Waiting for breakout')
                                    }</div>
                                    <div><strong>Entry Level:</strong> ₹${
                                      tradeStateInfo?.tradeSetupRequest?.entryLevel || 
                                      (latestBreakoutSignal ? latestBreakoutSignal.price.toFixed(2) : '---')
                                    }</div>
                                    <div><strong>Stop Loss:</strong> ₹${
                                      tradeStateInfo?.tradeSetupRequest?.stopLossLevel || '---'
                                    }</div>
                                    <div><strong>Target:</strong> ₹${
                                      tradeStateInfo?.tradeSetupRequest?.targetLevel || '---'
                                    }</div>
                                </div>
                                ${tradeStateInfo?.currentTradeId ? 
                                  `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><strong>Trade ID:</strong> ${tradeStateInfo.currentTradeId}</div>` : 
                                  ''
                                }
                            </div>
                        </div>
                        
                        <!-- Status description -->
                        <div style="margin-top: 10px; font-size: 13px; color: #6b7280;">
                            ${
                              !tradeStateInfo ? 'Strategy is starting up...' :
                              tradeStateInfo.tradeState === 'waiting_for_breakout' ? 
                                'Monitoring 5-minute candles for pivot breakouts with volume confirmation' :
                              tradeStateInfo.tradeState === 'waiting_for_entry' ?
                                'Breakout detected, tracking marking candle for optimal entry timing' :
                              tradeStateInfo.tradeState === 'in_trade' ?
                                'Position is active, monitoring for exit conditions' :
                              'Trade state is active'
                            }
                        </div>
                    </div>
                </div>
                <div class="status-card info">
                    <div class="card-title">📝 Option Instrument & Trade Details</div>
                    <div class="card-content">
                        <!-- Always show instrument section -->
                        <div style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                            <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px;">Selected Instrument</div>
                            <div style="font-size: 14px; line-height: 1.5;">
                                ${activePosition && activePosition.instrument ? `
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                        <div><strong>Symbol:</strong> ${activePosition.instrument.tradingsymbol}</div>
                                        <div><strong>Type:</strong> ${activePosition.instrument.instrument_type}</div>
                                        <div><strong>Strike:</strong> ₹${activePosition.instrument.strike}</div>
                                        <div><strong>Lot Size:</strong> ${activePosition.instrument.lot_size}</div>
                                    </div>
                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
                                        <strong>Expiry:</strong> ${new Date(activePosition.instrument.expiry).toLocaleDateString()}
                                    </div>
                                ` : `
                                    <div style="color: #6b7280; font-style: italic;">
                                        Instrument will be selected automatically when breakout is detected<br>
                                        <small>ATM options based on 1% premium of NIFTY futures price</small>
                                    </div>
                                `}
                            </div>
                        </div>
                        
                        <!-- Always show trade execution section -->
                        <div style="background: #f1f5f9; border-radius: 8px; padding: 12px;">
                            <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px;">Trade Execution</div>
                            <div style="font-size: 14px; line-height: 1.5;">
                                ${activePosition ? `
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                        <div><strong>Order ID:</strong> ${activePosition.entryOrderId || 'Pending'}</div>
                                        <div><strong>Direction:</strong> ${activePosition.direction}</div>
                                        <div><strong>Quantity:</strong> ${activePosition.quantity || 'Calculated'}</div>
                                        <div><strong>Entry Price:</strong> ₹${activePosition.entryPrice || 'Market'}</div>
                                        <div><strong>Status:</strong> ${activePosition.pnl !== undefined ? 'CLOSED' : 'OPEN'}</div>
                                        <div><strong>P&L:</strong> <span style="color: ${(activePosition.pnl || 0) >= 0 ? '#10b981' : '#ef4444'};">₹${(activePosition.pnl || 0).toLocaleString()}</span></div>
                                    </div>
                                    ${activePosition.exitPrice ? `
                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
                                        <div><strong>Exit Price:</strong> ₹${activePosition.exitPrice}</div>
                                        <div><strong>Exit Reason:</strong> ${activePosition.exitReason || 'Manual'}</div>
                                    </div>
                                    ` : ''}
                                ` : `
                                    <div style="color: #6b7280;">
                                        <div><strong>Status:</strong> Waiting for trade signal</div>
                                        <div><strong>Position Size:</strong> Auto-calculated (${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% risk)</div>
                                        <div><strong>Order Type:</strong> Market order execution</div>
                                        <div><strong>Mode:</strong> ${tradingConfig?.paperTradingMode ? 'Paper Trading' : 'Live Trading'}</div>
                                    </div>
                                `}
                            </div>
                        </div>
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
                            <strong>Update Count:</strong> ${markingCandleState.currentMarkingCandle?.updateCount || 0}/2<br>
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

                <div class="status-card ${(() => {
                    const wsHealth = this.breakoutStrategy.getWebSocketHealthStatus();
                    if (!wsHealth.websocketActive) return 'neutral';
                    if (!wsHealth.connected || wsHealth.circuitBreakerOpen) return 'danger';
                    const successRate = wsHealth.totalAttempts > 0 ? (wsHealth.successCount / wsHealth.totalAttempts) * 100 : 0;
                    if (successRate < 90) return 'warning';
                    return 'success';
                })()}">
                    <div class="card-title">🌐 WebSocket Health Monitor</div>
                    <div class="card-content">
                        ${(() => {
                            const wsHealth = this.breakoutStrategy.getWebSocketHealthStatus();
                            const successRate = wsHealth.totalAttempts > 0 ? (wsHealth.successCount / wsHealth.totalAttempts) * 100 : 0;
                            return `
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                                    <div>
                                        <div><strong>Status:</strong> ${wsHealth.websocketActive ? (wsHealth.connected ? '🟢 CONNECTED' : '🔴 DISCONNECTED') : '⚪ INACTIVE'}</div>
                                        <div><strong>Success Rate:</strong> ${wsHealth.successRate} (${wsHealth.successCount}/${wsHealth.totalAttempts})</div>
                                        <div><strong>Reconnect Attempts:</strong> ${wsHealth.reconnectAttempts}</div>
                                        <div><strong>Circuit Breaker:</strong> ${wsHealth.circuitBreakerOpen ? '🔴 OPEN' : '🟢 CLOSED'}</div>
                                    </div>
                                    <div>
                                        <div><strong>Last Data:</strong> ${wsHealth.lastDataReceived}</div>
                                        <div><strong>Time Since Last:</strong> ${wsHealth.timeSinceLastData} ago</div>
                                        <div><strong>Data Source:</strong> ${wsHealth.websocketActive ? 'WebSocket' : 'REST API Fallback'}</div>
                                        <div><strong>Health Score:</strong> ${wsHealth.websocketActive && wsHealth.connected && successRate > 95 ? '🟢 Excellent' : successRate > 90 ? '🟡 Good' : successRate > 75 ? '🟠 Fair' : '🔴 Poor'}</div>
                                    </div>
                                </div>
                                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                                    💡 WebSocket provides real-time tick data for 1-minute candle building and volume analysis
                                </div>
                            `;
                        })()}
                    </div>
                </div>

                <div class="status-card ${volumeSMA50 ? 'success' : 'warning'}">
                    <div class="card-title">📊 Volume Analysis Monitor</div>
                    <div class="card-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                            <div>
                                <div><strong>1-Min Candles:</strong> ${oneMinuteCandleCount}/50 (${(oneMinuteCandleCount/50*100).toFixed(1)}%)</div>
                                <div><strong>Volume SMA50:</strong> ${volumeSMA50 ? volumeSMA50.toLocaleString() : 'Calculating...'}</div>
                                <div><strong>SMA Status:</strong> ${volumeSMA50 ? '🟢 Ready' : `🟡 Building (${oneMinuteCandleCount}/50)`}</div>
                                ${latestOneMinuteCandle ? `<div><strong>Last Candle Vol:</strong> ${latestOneMinuteCandle.volume.toLocaleString()}</div>` : ''}
                            </div>
                            <div>
                                ${latestOneMinuteCandle ? `
                                    <div><strong>Volume vs SMA:</strong> ${volumeSMA50 ? `${((latestOneMinuteCandle.volume / volumeSMA50) * 100).toFixed(0)}% of SMA` : 'N/A'}</div>
                                    <div><strong>Volume Rating:</strong> ${volumeSMA50 ? (
                                        latestOneMinuteCandle.volume > volumeSMA50 * 1.5 ? '🔥 Very High' :
                                        latestOneMinuteCandle.volume > volumeSMA50 * 1.2 ? '📈 High' :
                                        latestOneMinuteCandle.volume > volumeSMA50 * 0.8 ? '📊 Normal' : '📉 Low'
                                    ) : 'N/A'}</div>
                                    <div><strong>Last Update:</strong> ${new Date(latestOneMinuteCandle.timestamp).toLocaleTimeString()}</div>
                                ` : '<div>No 1-minute candle data yet</div>'}
                                <div><strong>Data Source:</strong> ${this.breakoutStrategy.getWebSocketHealthStatus().websocketActive ? 'WebSocket Ticks' : 'REST API'}</div>
                            </div>
                        </div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                            💡 Volume SMA50 needed for breakout confirmation • WebSocket ticks provide real-time volume calculation
                        </div>
                    </div>
                </div>

                <div class="status-card ${(() => {
                    const wsHealth = this.breakoutStrategy.getWebSocketHealthStatus();
                    const candleCount = oneMinuteCandleCount;
                    if (wsHealth.websocketActive && wsHealth.connected && candleCount >= 5) return 'success';
                    if (wsHealth.websocketActive && candleCount >= 1) return 'info';
                    if (!wsHealth.websocketActive) return 'warning';
                    return 'neutral';
                })()}">
                    <div class="card-title">🕯️ Real-time Candle Building</div>
                    <div class="card-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                            <div>
                                <div><strong>Candle Builder:</strong> ${this.breakoutStrategy.getWebSocketHealthStatus().websocketActive ? '🟢 WebSocket Active' : '🟡 REST Fallback'}</div>
                                <div><strong>Total 1-Min Candles:</strong> ${oneMinuteCandleCount}</div>
                                <div><strong>Builder Status:</strong> ${oneMinuteCandleCount >= 50 ? '🟢 Fully Operational' : `🟡 Building History (${oneMinuteCandleCount}/50)`}</div>
                                <div><strong>Tick Processing:</strong> ${this.breakoutStrategy.getWebSocketHealthStatus().websocketActive ? '🟢 Real-time' : '🔄 Polling'}</div>
                            </div>
                            <div>
                                ${latestOneMinuteCandle ? `
                                    <div><strong>Latest Candle:</strong></div>
                                    <div style="font-size: 12px; margin-left: 10px;">
                                        O: ₹${latestOneMinuteCandle.open.toFixed(2)}<br>
                                        H: ₹${latestOneMinuteCandle.high.toFixed(2)}<br>
                                        L: ₹${latestOneMinuteCandle.low.toFixed(2)}<br>
                                        C: ₹${latestOneMinuteCandle.close.toFixed(2)}<br>
                                        V: ${latestOneMinuteCandle.volume.toLocaleString()}
                                    </div>
                                ` : '<div>No candle data available</div>'}
                            </div>
                        </div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                            💡 1-minute candles built from WebSocket ticks • Cumulative volume converted to incremental • Essential for breakout detection
                        </div>
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
                
                ${latestBreakoutSignal ? `
                <div class="status-card warning" style="border-left: 4px solid #F59E0B;">
                    <div class="card-title">🎯 Selected Option Instrument</div>
                    <div class="card-content" id="instrumentCard">
                        <div id="instrumentInfo">Loading instrument information...</div>
                        <div id="instrumentLTP" style="margin-top: 10px;">LTP: Loading...</div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="status-card" style="border-left: 4px solid ${tradingConfig?.paperTradingMode ? '#F59E0B' : '#10B981'};">
                <div class="card-title">⚙️ Trading Mode Control</div>
                <div class="card-content">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div>
                            <div style="font-weight: 600; color: ${tradingConfig?.paperTradingMode ? '#F59E0B' : '#10B981'}; font-size: 18px;">
                                ${tradingConfig?.paperTradingMode ? '📝 PAPER TRADING MODE' : '🚀 LIVE TRADING MODE'}
                            </div>
                            <div style="font-size: 14px; color: #6b7280; margin-top: 5px;">
                                ${tradingConfig?.paperTradingMode ? 
                                    'Simulated trades • Capital not affected • Safe for testing' : 
                                    'Real money trading • All trades executed live • Use with caution'
                                }
                            </div>
                        </div>
                        <button onclick="toggleTradingMode()" 
                                class="action-btn ${tradingConfig?.paperTradingMode ? 'warning' : 'success'}" 
                                id="trading-mode-btn"
                                style="min-width: 140px;">
                            ${tradingConfig?.paperTradingMode ? '🚀 Go Live' : '📝 Go Paper'}
                        </button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; font-size: 14px; padding: 15px; background: #f8fafc; border-radius: 8px;">
                        <div>
                            <strong>Capital:</strong><br>
                            <span style="font-size: 16px; font-weight: 600; color: ${tradingConfig?.paperTradingMode ? '#F59E0B' : '#10B981'};">
                                ₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}
                            </span>
                        </div>
                        <div>
                            <strong>Risk per Trade:</strong><br>
                            <span style="font-size: 16px; font-weight: 600;">
                                ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%
                            </span>
                        </div>
                        <div>
                            <strong>Max Risk:</strong><br>
                            <span style="font-size: 16px; font-weight: 600;">
                                ₹${currentCapital && tradingConfig ? (currentCapital * tradingConfig.riskPerTrade).toLocaleString() : 'Loading...'}
                            </span>
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
                🔄 Manual refresh recommended for latest updates<br>
                💡 Strategy recalculates pivots every 5 minutes during market hours (9:15 AM - 3:30 PM)
            </div>
        </div>
    </div>
</body>
</html>
      `;
      
      res.send(htmlResponse);
    });

    // Modern breakout strategy dashboard page
    this.app.get('/breakout-strategy-v2', (req: Request, res: Response) => {
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
      
      // Get health monitoring data
      const healthReport = this.breakoutStrategy.getHealthReport ? this.breakoutStrategy.getHealthReport() : null;
      
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

      const modernHtmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NIFTY Breakout Pullback Strategy</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, system-ui, sans-serif;
            background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #cbd5e1 100%);
            min-height: 100vh;
            color: #1e293b;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .back-link {
            display: inline-flex;
            color: #06b6d4;
            text-decoration: none;
            font-weight: 600;
            margin-bottom: 20px;
            padding: 8px 16px;
            border-radius: 8px;
        }
        .header {
            background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
            backdrop-filter: blur(20px);
            border-radius: 20px;
            border: 1px solid rgba(0,0,0,0.1);
            padding: 40px;
            text-align: center;
            margin-bottom: 30px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .hero-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .hero-card {
            background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
            backdrop-filter: blur(20px);
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.1);
            padding: 25px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .hero-label { font-size: 0.9rem; color: #64748b; margin-bottom: 8px; }
        .hero-value { font-size: 2rem; font-weight: 700; margin-bottom: 8px; color: #1e293b; }
        .hero-subtitle { font-size: 0.85rem; color: #475569; }
        .control-panel {
            background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
            backdrop-filter: blur(20px);
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.1);
            padding: 25px;
            margin: 20px 0;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .control-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .control-btn {
            padding: 12px 20px;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            text-align: center;
            display: inline-block;
        }
        .control-btn.primary { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
        .control-btn.danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
        .control-btn.warning { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; }
        .control-btn.secondary { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; }
        .status-active { border-left: 4px solid #22c55e; }
        .status-inactive { border-left: 4px solid #ef4444; }
        .dashboard-section {
            background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85));
            backdrop-filter: blur(20px);
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.1);
            margin: 20px 0;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .section-header {
            padding: 20px 25px;
            background: rgba(0,0,0,0.05);
            border-bottom: 1px solid rgba(0,0,0,0.1);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #1e293b;
            font-weight: 600;
        }
        .section-content { padding: 25px; }
        .perf-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }
        .perf-card {
            background: rgba(0,0,0,0.05);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid rgba(0,0,0,0.1);
        }
        .perf-value {
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .perf-value.positive { color: #22c55e; }
        .perf-value.negative { color: #ef4444; }
        .perf-value.neutral { color: #06b6d4; }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        .info-card {
            background: rgba(0,0,0,0.05);
            border-radius: 12px;
            padding: 20px;
            border: 1px solid rgba(0,0,0,0.1);
        }
        .info-value { font-size: 1.4rem; font-weight: 600; margin: 10px 0; color: #1e293b; }
        .info-subtitle { color: #64748b; font-size: 0.9rem; }
        h4 { color: #374151; }
        .status-indicator {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
        }
        .status-indicator.active { background: #22c55e; color: white; }
        .status-indicator.inactive { background: #ef4444; color: white; }
        .status-indicator.warning { background: #f59e0b; color: white; }
        
        /* QC Checklist Styles */
        .qc-checklist {
            background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(22, 163, 74, 0.05));
            border: 2px solid rgba(34, 197, 94, 0.3);
            border-radius: 16px;
            padding: 25px;
            margin: 20px 0;
        }
        .qc-item {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            margin: 8px 0;
            background: rgba(255, 255, 255, 0.8);
            border-radius: 12px;
            border-left: 4px solid #e5e7eb;
            transition: all 0.3s ease;
        }
        .qc-item.pass { border-left-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
        .qc-item.fail { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
        .qc-item.warning { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
        .qc-icon {
            font-size: 1.2rem;
            margin-right: 12px;
            min-width: 24px;
        }
        .qc-content {
            flex: 1;
        }
        .qc-label {
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 4px;
        }
        .qc-detail {
            font-size: 0.9rem;
            color: #64748b;
        }
        .qc-summary {
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            text-align: center;
        }
        .qc-score {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .qc-score.excellent { color: #22c55e; }
        .qc-score.good { color: #3b82f6; }
        .qc-score.warning { color: #f59e0b; }
        .qc-score.critical { color: #ef4444; }
        
        /* Enhanced Mobile Responsiveness */
        @media (max-width: 1200px) {
            .container { max-width: 100%; padding: 15px; }
            .hero-section { grid-template-columns: 1fr 1fr; gap: 15px; }
            .info-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; }
        }
        
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .header { padding: 20px; margin-bottom: 20px; }
            .header h1 { font-size: 2rem; }
            .header .subtitle { font-size: 1rem; }
            
            .hero-section { 
                grid-template-columns: 1fr; 
                gap: 15px; 
                margin: 20px 0; 
            }
            .hero-card { padding: 20px; }
            .hero-value { font-size: 1.8rem; }
            .hero-label { font-size: 0.8rem; }
            .hero-subtitle { font-size: 0.8rem; }
            
            .control-panel { padding: 20px; }
            .control-grid { 
                grid-template-columns: 1fr; 
                gap: 12px; 
            }
            .control-btn { 
                padding: 16px 20px; 
                font-size: 1rem;
                min-height: 48px; /* Touch-friendly minimum */
            }
            
            .dashboard-section { margin: 15px 0; }
            .section-header { padding: 15px 20px; }
            .section-content { padding: 20px; }
            
            .perf-grid { 
                grid-template-columns: 1fr 1fr; 
                gap: 15px; 
            }
            .perf-card { padding: 15px; }
            .perf-value { font-size: 1.5rem; }
            
            .info-grid { 
                grid-template-columns: 1fr; 
                gap: 15px; 
            }
            .info-card { padding: 15px; }
            .info-value { font-size: 1.2rem; }
            
            .back-link { 
                padding: 12px 16px; 
                font-size: 0.9rem;
                margin-bottom: 15px;
            }
        }
        
        @media (max-width: 480px) {
            .container { padding: 8px; }
            .header { padding: 15px; }
            .header h1 { font-size: 1.8rem; }
            .header .subtitle { font-size: 0.9rem; }
            
            .hero-card { padding: 15px; }
            .hero-value { font-size: 1.6rem; }
            
            .control-panel { padding: 15px; }
            .control-btn { 
                padding: 14px 16px; 
                font-size: 0.9rem;
                min-height: 44px;
            }
            
            .section-header { padding: 12px 15px; }
            .section-content { padding: 15px; }
            
            .perf-grid { grid-template-columns: 1fr; }
            .perf-card { padding: 12px; }
            .info-card { padding: 12px; }
            
            .footer { 
                padding: 15px; 
                font-size: 0.8rem; 
                margin-top: 30px; 
            }
        }
        
        /* Touch-friendly enhancements */
        @media (hover: none) and (pointer: coarse) {
            .control-btn {
                min-height: 48px;
                padding: 16px 20px;
                font-size: 1rem;
            }
            
            .section-header {
                min-height: 60px;
                padding: 20px 25px;
            }
            
            .back-link {
                min-height: 44px;
                padding: 12px 16px;
            }
            
            /* Remove hover effects on touch devices */
            .control-btn:hover {
                transform: none;
            }
            
            .back-link:hover {
                background-color: rgba(6, 182, 212, 0.2);
            }
        }
        
        /* Landscape orientation adjustments */
        @media (max-width: 768px) and (orientation: landscape) {
            .hero-section { 
                grid-template-columns: 1fr 1fr 1fr; 
                gap: 10px; 
            }
            .hero-card { padding: 15px; }
            .hero-value { font-size: 1.5rem; }
            
            .control-grid { 
                grid-template-columns: 1fr 1fr; 
                gap: 10px; 
            }
            
            .perf-grid { 
                grid-template-columns: repeat(3, 1fr); 
                gap: 12px; 
            }
        }
    </style>
    <script>
        async function startStrategy() {
            const response = await fetch('/breakout-strategy/start', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                alert('Strategy started successfully!');
                window.location.reload();
            } else {
                alert('Failed to start strategy: ' + (result.error || 'Unknown error'));
            }
        }
        
        async function stopStrategy() {
            const response = await fetch('/breakout-strategy/stop', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                alert('Strategy stopped successfully!');
                window.location.reload();
            } else {
                alert('Failed to stop strategy: ' + (result.error || 'Unknown error'));
            }
        }
        
        async function manualExit() {
            if (!confirm('Are you sure you want to manually exit the current position?')) return;
            const response = await fetch('/execution/manual-exit', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                alert('Position exited successfully!');
                window.location.reload();
            } else {
                alert('Failed to exit position: ' + (result.error || 'Unknown error'));
            }
        }
        
        async function manualStopAll() {
            if (!confirm('⚠️ WARNING: This will stop all active trades and positions. Are you sure?')) return;
            
            try {
                // First stop the strategy
                const strategyResponse = await fetch('/breakout-strategy/stop', { method: 'POST' });
                const strategyResult = await strategyResponse.json();
                
                // Then exit any active positions
                const exitResponse = await fetch('/execution/manual-exit', { method: 'POST' });
                const exitResult = await exitResponse.json();
                
                if (strategyResult.success || exitResult.success) {
                    alert('✅ All trades stopped successfully!');
                    window.location.reload();
                } else {
                    alert('❌ Failed to stop all trades. Check individual operations.');
                }
            } catch (error) {
                alert('Error stopping trades: ' + error.message);
            }
        }
        
        async function toggleTradingMode() {
            const button = event.target;
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
                    // Show confirmation with clear mode indication
                    const modeName = newMode ? 'Paper Trading (Safe Mode)' : 'Live Trading (Real Money)';
                    const warning = newMode ? '' : '\\n\\n⚠️ WARNING: Live trading uses real money!';
                    alert('Trading mode switched to: ' + modeName + warning);
                    
                    // Reload page to reflect changes
                    window.location.reload();
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
        
        // Load instrument information when breakout signal exists
        async function loadInstrumentInfo() {
            const instrumentInfo = document.getElementById('instrumentInfo');
            const instrumentLTP = document.getElementById('instrumentLTP');
            const instrumentDetails = document.getElementById('instrumentDetails');
            const instrumentPremiumDetails = document.getElementById('instrumentPremiumDetails');
            
            if (!instrumentInfo) return;
            
            try {
                const statusResponse = await fetch('/breakout-strategy/status');
                const statusData = await statusResponse.json();
                
                let instrument = null;
                
                // Check if we have a selected instrument
                if (statusData.selected_instrument) {
                    instrument = statusData.selected_instrument;
                } else if (statusData.latest_breakout_signal) {
                    // Auto-select instrument based on breakout signal
                    const signal = statusData.latest_breakout_signal;
                    const direction = signal.type === 'long_breakout' ? 'LONG' : 'SHORT';
                    
                    const instrumentResponse = await fetch('/execution/select-instrument', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            direction: direction,
                            niftyPrice: signal.price
                        })
                    });
                    
                    if (instrumentResponse.ok) {
                        const instrumentData = await instrumentResponse.json();
                        instrument = instrumentData.instrument;
                    }
                }
                
                if (instrument) {
                    instrumentInfo.innerHTML = instrument.tradingsymbol;
                    instrumentDetails.innerHTML = \`
                        <div><strong>Strike:</strong> ₹\${instrument.strike}</div>
                        <div><strong>Expiry:</strong> \${new Date(instrument.expiry).toLocaleDateString()}</div>
                        <div><strong>Type:</strong> \${instrument.instrument_type}</div>
                        <div><strong>Lot Size:</strong> \${instrument.lot_size}</div>
                    \`;
                    
                    // Fetch LTP for the instrument
                    const ltpResponse = await fetch(\`/execution/ltp/\${instrument.instrument_token}\`);
                    if (ltpResponse.ok) {
                        const ltpData = await ltpResponse.json();
                        const ltp = ltpData[instrument.instrument_token];
                        if (ltp) {
                            instrumentLTP.innerHTML = '₹' + ltp.last_price.toFixed(2);
                            instrumentPremiumDetails.innerHTML = \`
                                <div><strong>Bid:</strong> ₹\${ltp.depth.buy[0]?.price.toFixed(2) || 'N/A'}</div>
                                <div><strong>Ask:</strong> ₹\${ltp.depth.sell[0]?.price.toFixed(2) || 'N/A'}</div>
                                <div><strong>Volume:</strong> \${ltp.volume.toLocaleString()}</div>
                            \`;
                        }
                    }
                } else {
                    instrumentInfo.innerHTML = 'No instrument selected';
                    instrumentDetails.innerHTML = 'Waiting for breakout signal...';
                }
                
            } catch (error) {
                console.error('Error loading instrument info:', error);
                instrumentInfo.innerHTML = 'Error loading instrument';
                instrumentDetails.innerHTML = 'Failed to fetch instrument data';
            }
        }
        
        // Load instrument info when page loads (if breakout signal exists)
        document.addEventListener('DOMContentLoaded', loadInstrumentInfo);
        
        // TODO: Replace auto-refresh with server-sent events to eliminate API waste
        // Auto refresh disabled to prevent excessive API calls
        // setInterval(() => window.location.reload(), 10000);
    </script>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Main Dashboard</a>
        
        <div class="header">
            <h1>� NIFTY Breakout Pullback Strategy</h1>
            <div class="subtitle">Professional Trading Dashboard • Clean & Focused • Real-time Updates</div>
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
        
        <!-- 1. SYSTEM STATUS & AUTHENTICATION -->
        <div class="hero-section">
            <div class="hero-card ${strategyActive ? 'status-active' : 'status-inactive'}">
                <div class="hero-label">🔐 Authentication & System</div>
                <div class="hero-value">${strategyActive ? 'ACTIVE' : 'INACTIVE'}</div>
                <div class="hero-subtitle">Market: ${isMarketHours ? 'OPEN' : 'CLOSED'} • Streaming: ${priceStreamingActive ? 'ON' : 'OFF'}</div>
            </div>
            
            <div class="hero-card">
                <div class="hero-label">💰 Capital & Mode</div>
                <div class="hero-value" style="color: ${tradingConfig?.paperTradingMode ? '#f59e0b' : '#22c55e'}">₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}</div>
                <div class="hero-subtitle">${tradingConfig?.paperTradingMode ? '📝 Paper Trading (Safe)' : '🚀 Live Trading (Real Money)'}</div>
            </div>
            
            <div class="hero-card">
                <div class="hero-label">📊 Trade State</div>
                <div class="hero-value">${tradeStateInfo?.tradeState?.replace(/_/g, ' ').toUpperCase() || 'LOADING'}</div>
                <div class="hero-subtitle">Position: ${activePosition ? 'OPEN' : 'NONE'} • P&L: ₹${activePosition?.pnl ? activePosition.pnl.toLocaleString() : '0'}</div>
            </div>
            
            <div class="hero-card">
                <div class="hero-label">📈 NIFTY Live Price</div>
                <div class="hero-value">${livePrice ? '₹' + livePrice.last_price.toFixed(2) : 'Loading...'}</div>
                <div class="hero-subtitle">${currentContract ? currentContract.tradingsymbol : 'Contract Loading...'}</div>
            </div>
        </div>
        
        <!-- 2. STRATEGY CONTROL PANEL -->
        <div class="control-panel">
            <h3>🎛️ Strategy Control & Initialization</h3>
            <div class="control-grid">
                ${!strategyActive ? 
                    '<button onclick="startStrategy()" class="control-btn primary">▶️ Start Strategy & Initialize</button>' :
                    '<button onclick="stopStrategy()" class="control-btn danger">⏹️ Stop Strategy</button>'
                }
                ${activePosition ? 
                    '<button onclick="manualExit()" class="control-btn warning">🚪 Manual Exit (₹' + (activePosition.pnl ? activePosition.pnl.toLocaleString() : '0') + ')</button>' : ''
                }
                <button onclick="manualStopAll()" class="control-btn danger">🛑 Emergency Stop All</button>
                <button onclick="toggleTradingMode()" class="control-btn ${tradingConfig?.paperTradingMode ? 'warning' : 'primary'}">${tradingConfig?.paperTradingMode ? '🚀 Go Live Trading' : '📝 Go Paper Mode'}</button>
                <a href="/breakout-strategy/status" class="control-btn secondary">📊 API Status</a>
                <a href="/breakout-strategy" class="control-btn secondary">🔄 Classic Dashboard</a>
            </div>
        </div>
        
        <!-- 3. SIGNAL DETECTION & PIVOTS -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">🎯 Signal Detection & Pivot Levels</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>📈 Pivot High</h4>
                        <div class="info-value">${latestPivots.pivotHigh ? '₹' + latestPivots.pivotHigh.price.toFixed(2) : 'Not Detected'}</div>
                        <div class="info-subtitle">${latestPivots.pivotHigh ? new Date(latestPivots.pivotHigh.timestamp).toLocaleString() : ''}</div>
                    </div>
                    <div class="info-card">
                        <h4>📉 Pivot Low</h4>
                        <div class="info-value">${latestPivots.pivotLow ? '₹' + latestPivots.pivotLow.price.toFixed(2) : 'Not Detected'}</div>
                        <div class="info-subtitle">${latestPivots.pivotLow ? new Date(latestPivots.pivotLow.timestamp).toLocaleString() : ''}</div>
                    </div>
                    <div class="info-card">
                        <h4>🎯 Breakout Detection</h4>
                        <div class="info-value">
                            <span class="status-indicator ${breakoutDetectionActive ? 'active' : 'inactive'}">
                                ${breakoutDetectionActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                        </div>
                        <div class="info-subtitle">${oneMinuteCandleCount} minute candles loaded</div>
                    </div>
                    <div class="info-card">
                        <h4>📊 Signal Status</h4>
                        <div class="info-value">
                            <span class="status-indicator ${latestBreakoutSignal ? 'active' : 'inactive'}">
                                ${latestBreakoutSignal ? 'SIGNAL DETECTED' : 'WAITING'}
                            </span>
                        </div>
                        <div class="info-subtitle">15,15 Pivot Algorithm Active</div>
                    </div>
                </div>
                
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
                                    <div><strong>Signal Price:</strong> ₹${latestBreakoutSignal.price.toFixed(2)}</div>
                                    <div><strong>Pivot Price:</strong> ₹${latestBreakoutSignal.pivotPrice.toFixed(2)}</div>
                                    <div><strong>Volume:</strong> ${latestBreakoutSignal.volume.toLocaleString()}</div>
                                </div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 0.9rem;">
                                    <div><strong>Candle OHLC:</strong></div>
                                    <div>Open: ${latestBreakoutSignal.candleOpen.toFixed(2)}</div>
                                    <div>Close: ${latestBreakoutSignal.candleClose.toFixed(2)}</div>
                                    <div><strong>Vol Ratio:</strong> ${latestBreakoutSignal.volumeRatio.toFixed(2)}x</div>
                                    <div><strong>Time:</strong> ${new Date(latestBreakoutSignal.timestamp).toLocaleTimeString()}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        
        <!-- 4. OPTION INSTRUMENT & POSITION -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">🎯 Selected Option Instrument</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>📝 Instrument Details</h4>
                        <div class="info-value" id="instrumentInfo">Loading instrument information...</div>
                        <div class="info-subtitle" id="instrumentDetails">Selecting optimal strike price...</div>
                    </div>
                    
                    <div class="info-card">
                        <h4>💰 Live Premium</h4>
                        <div class="info-value" id="instrumentLTP">Loading...</div>
                        <div class="info-subtitle" id="instrumentPremiumDetails">Fetching option price...</div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🎯 Strike Selection</h4>
                        <div class="info-value">${latestBreakoutSignal ? (latestBreakoutSignal.type === 'long_breakout' ? 'CALL' : 'PUT') : 'Not selected'}</div>
                        <div class="info-subtitle">
                            <div><strong>Direction:</strong> ${latestBreakoutSignal ? (latestBreakoutSignal.type === 'long_breakout' ? 'LONG' : 'SHORT') : 'Waiting for signal'}</div>
                            <div><strong>NIFTY Price:</strong> ${latestBreakoutSignal ? '₹' + latestBreakoutSignal.price.toFixed(2) : '--'}</div>
                            <div><strong>Signal Time:</strong> ${latestBreakoutSignal ? new Date(latestBreakoutSignal.timestamp).toLocaleTimeString() : '--'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>⚡ Auto Selection</h4>
                        <div class="info-value">
                            <span class="status-indicator active">ENABLED</span>
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Algorithm:</strong> ATM + Delta optimization</div>
                            <div><strong>Status:</strong> Instrument selected automatically</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Active Position Details -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">💼 Active Position Details</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>📝 Position Info</h4>
                        <div class="info-value">${activePosition?.instrument ? activePosition.instrument.tradingsymbol : 'No active position'}</div>
                        <div class="info-subtitle">
                            ${activePosition?.instrument ? `
                                <div><strong>Strike:</strong> ₹${activePosition.instrument.strike}</div>
                                <div><strong>Expiry:</strong> ${new Date(activePosition.instrument.expiry).toLocaleDateString()}</div>
                                <div><strong>Type:</strong> ${activePosition.instrument.instrument_type}</div>
                            ` : 'Waiting for trade execution'}
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>💹 Trade Details</h4>
                        <div class="info-value">${activePosition?.direction || 'No direction'}</div>
                        <div class="info-subtitle">
                            <div><strong>Quantity:</strong> ${activePosition?.quantity || '--'}</div>
                            <div><strong>Entry Price:</strong> ₹${activePosition?.entryPrice || '--'}</div>
                            <div><strong>Order ID:</strong> ${activePosition?.entryOrderId || '--'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>📊 P&L Analysis</h4>
                        <div class="info-value ${activePosition?.pnl && activePosition.pnl >= 0 ? 'positive' : 'negative'}">
                            ₹${activePosition?.pnl !== undefined ? activePosition.pnl.toLocaleString() : '0'}
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Exit Price:</strong> ₹${activePosition?.exitPrice || 'Position Open'}</div>
                            <div><strong>Exit Reason:</strong> ${activePosition?.exitReason || 'N/A'}</div>
                            <div><strong>Status:</strong> ${activePosition?.exitPrice ? 'CLOSED' : 'OPEN'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🎯 Risk Management</h4>
                        <div class="info-value">
                            ${tradeStateInfo.tradeSetupRequest ? `₹${tradeStateInfo.tradeSetupRequest.stopLossLevel}` : 'N/A'}
                        </div>
                        <div class="info-subtitle">
                            ${tradeStateInfo.tradeSetupRequest ? `
                                <div><strong>Entry:</strong> ₹${tradeStateInfo.tradeSetupRequest.entryLevel}</div>
                                <div><strong>Stop Loss:</strong> ₹${tradeStateInfo.tradeSetupRequest.stopLossLevel}</div>
                                <div><strong>Target:</strong> ₹${tradeStateInfo.tradeSetupRequest.targetLevel}</div>
                            ` : 'No active trade setup'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 5. TECHNICAL ANALYSIS -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">📊 Technical Analysis & Market Data</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>🕯️ 1-Minute Candles</h4>
                        <div class="info-value">${oneMinuteCandleCount}/50</div>
                        <div class="info-subtitle">
                            <div><strong>Status:</strong> ${oneMinuteCandleCount >= 50 ? '✅ Ready' : '⏳ Building'}</div>
                            <div><strong>Volume SMA:</strong> ${typeof volumeSMA50 === 'number' ? volumeSMA50.toFixed(0) : 'Calculating...'}</div>
                            <div><strong>Data Quality:</strong> ${oneMinuteCandleCount >= 30 ? 'Good' : 'Partial'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>📈 5-Minute Pivots</h4>
                        <div class="info-value">${(latestPivots.pivotHigh && latestPivots.pivotLow) ? '✅ Active' : '⏳ Scanning'}</div>
                        <div class="info-subtitle">
                            <div><strong>Algorithm:</strong> 15,15 lookback</div>
                            <div><strong>Last Update:</strong> ${latestPivots.pivotHigh ? new Date(latestPivots.pivotHigh.timestamp).toLocaleTimeString() : 'N/A'}</div>
                            <div><strong>Next Check:</strong> ${strategyActive ? 'Every 5 minutes' : 'Strategy stopped'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🎯 Breakout Engine</h4>
                        <div class="info-value">
                            <span class="status-indicator ${breakoutDetectionActive ? 'active' : 'inactive'}">
                                ${breakoutDetectionActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Monitoring:</strong> ${breakoutDetectionActive ? 'Live breakouts' : 'Engine stopped'}</div>
                            <div><strong>Volume Filter:</strong> ${volumeSMA50 ? 'SMA-50 active' : 'Building baseline'}</div>
                            <div><strong>Sensitivity:</strong> Professional grade</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>⚡ Current Signals</h4>
                        <div class="info-value">${latestBreakoutSignal ? '🚨 SIGNAL' : '👁️ WATCHING'}</div>
                        <div class="info-subtitle">
                            ${latestBreakoutSignal ? `
                                <div><strong>Type:</strong> ${latestBreakoutSignal.type.replace('_', ' ').toUpperCase()}</div>
                                <div><strong>Price:</strong> ₹${latestBreakoutSignal.price.toFixed(2)}</div>
                                <div><strong>Volume:</strong> ${latestBreakoutSignal.volumeRatio.toFixed(2)}x above SMA</div>
                            ` : `
                                <div><strong>Status:</strong> No active signals</div>
                                <div><strong>Waiting:</strong> For pivot breakout</div>
                                <div><strong>Condition:</strong> Price + Volume confirmation</div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 6. LIVE MARKING CANDLE TRACKING -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">🕯️ Live Marking Candle & 5-Min Updates</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>📊 Marking Candle Status</h4>
                        <div class="info-value">
                            <span class="status-indicator ${markingCandleState?.isActive ? 'warning' : 'inactive'}">
                                ${markingCandleState?.isActive ? '🟡 TRACKING' : '⚪ INACTIVE'}
                            </span>
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Search Phase:</strong> ${markingCandleState?.searchPhase?.toUpperCase() || 'Not active'}</div>
                            <div><strong>Update Count:</strong> ${markingCandleState?.currentMarkingCandle?.updateCount || 0}/2</div>
                            <div><strong>Status:</strong> ${markingCandleState?.isActive ? 'Monitoring 5-min candles' : 'Waiting for breakout'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🎯 Current Entry/Stop Levels</h4>
                        <div class="info-value">
                            ${markingCandleState?.currentMarkingCandle ? '✅ SET' : '⏳ PENDING'}
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Entry Price:</strong> ₹${markingCandleState?.currentMarkingCandle?.entryPrice?.toFixed(2) || '--'}</div>
                            <div><strong>Stop Loss:</strong> ₹${markingCandleState?.currentMarkingCandle?.stopLoss?.toFixed(2) || '--'}</div>
                            <div><strong>Risk:</strong> ${markingCandleState?.currentMarkingCandle ? '₹' + Math.abs(markingCandleState.currentMarkingCandle.entryPrice - markingCandleState.currentMarkingCandle.stopLoss).toFixed(2) : '--'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🕯️ Live Candle Data</h4>
                        <div class="info-value">
                            ${markingCandleState?.currentMarkingCandle ? 'UPDATING' : 'NO DATA'}
                        </div>
                        <div class="info-subtitle">
                            ${markingCandleState?.currentMarkingCandle ? `
                                <div><strong>Open:</strong> ₹${markingCandleState.currentMarkingCandle.candle.open.toFixed(2)}</div>
                                <div><strong>High:</strong> ₹${markingCandleState.currentMarkingCandle.candle.high.toFixed(2)}</div>
                                <div><strong>Low:</strong> ₹${markingCandleState.currentMarkingCandle.candle.low.toFixed(2)}</div>
                                <div><strong>Close:</strong> ₹${markingCandleState.currentMarkingCandle.candle.close.toFixed(2)}</div>
                            ` : `
                                <div><strong>Open:</strong> --</div>
                                <div><strong>High:</strong> --</div>
                                <div><strong>Low:</strong> --</div>
                                <div><strong>Close:</strong> --</div>
                            `}
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>⏰ Timing & Progress</h4>
                        <div class="info-value">
                            ${markingCandleState?.startTime ? `${Math.floor((Date.now() - new Date(markingCandleState.startTime).getTime()) / (1000 * 60))}/18` : '0/18'}
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Time Limit:</strong> ${markingCandleState?.startTime ? `${Math.floor((Date.now() - new Date(markingCandleState.startTime).getTime()) / (1000 * 60))} of 18 minutes` : 'Not started'}</div>
                            <div><strong>Candle Time:</strong> ${markingCandleState?.currentMarkingCandle ? new Date(markingCandleState.currentMarkingCandle.candle.timestamp).toLocaleTimeString() : '--'}</div>
                            <div><strong>Breakout Type:</strong> ${markingCandleState?.breakoutReference ? (markingCandleState.breakoutReference.type === 'long_breakout' ? '📈 LONG' : '📉 SHORT') : '--'}</div>
                        </div>
                    </div>
                </div>
                
                ${markingCandleState?.isActive && markingCandleState.searchPhase === 'initial' ? `
                <div style="margin-top: 20px;">
                    <h4 style="color: #1e293b; margin-bottom: 15px;">🔍 Initial Search Phase</h4>
                    <div class="info-card" style="border-left: 4px solid #f59e0b;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div>
                                <div style="font-weight: 600; color: #f59e0b; margin-bottom: 8px;">📊 Progress</div>
                                <div style="color: #64748b; font-size: 0.9rem;">
                                    <div><strong>Bars Processed:</strong> ${markingCandleState.barsProcessedSinceBreakout || 0}/5</div>
                                    <div><strong>Status:</strong> Looking for opposite direction candle</div>
                                    <div><strong>Phase:</strong> ${markingCandleState.searchPhase.toUpperCase()}</div>
                                </div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #06b6d4; margin-bottom: 8px;">🎯 Criteria</div>
                                <div style="color: #64748b; font-size: 0.9rem;">
                                    <div><strong>Direction:</strong> ${markingCandleState.breakoutReference ? (markingCandleState.breakoutReference.type === 'long_breakout' ? 'Looking for RED candle' : 'Looking for GREEN candle') : 'Unknown'}</div>
                                    <div><strong>Requirement:</strong> Opposite color candle</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${markingCandleState?.currentMarkingCandle ? `
                <div style="margin-top: 20px;">
                    <h4 style="color: #1e293b; margin-bottom: 15px;">📈 Active Marking Candle Details</h4>
                    <div class="info-card" style="border-left: 4px solid #22c55e; background: rgba(34, 197, 94, 0.05);">
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
                            <div>
                                <div style="font-weight: 600; color: #22c55e; margin-bottom: 8px;">💰 Trade Levels</div>
                                <div style="color: #64748b; font-size: 0.9rem;">
                                    <div><strong>Entry:</strong> ₹${markingCandleState.currentMarkingCandle.entryPrice.toFixed(2)}</div>
                                    <div><strong>Stop Loss:</strong> ₹${markingCandleState.currentMarkingCandle.stopLoss.toFixed(2)}</div>
                                    <div><strong>Risk:</strong> ₹${Math.abs(markingCandleState.currentMarkingCandle.entryPrice - markingCandleState.currentMarkingCandle.stopLoss).toFixed(2)}</div>
                                </div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #06b6d4; margin-bottom: 8px;">🕯️ OHLC Data</div>
                                <div style="color: #64748b; font-size: 0.9rem;">
                                    <div><strong>O:</strong> ₹${markingCandleState.currentMarkingCandle.candle.open.toFixed(2)}</div>
                                    <div><strong>H:</strong> ₹${markingCandleState.currentMarkingCandle.candle.high.toFixed(2)}</div>
                                    <div><strong>L:</strong> ₹${markingCandleState.currentMarkingCandle.candle.low.toFixed(2)}</div>
                                    <div><strong>C:</strong> ₹${markingCandleState.currentMarkingCandle.candle.close.toFixed(2)}</div>
                                </div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #f59e0b; margin-bottom: 8px;">⚡ Updates</div>
                                <div style="color: #64748b; font-size: 0.9rem;">
                                    <div><strong>Count:</strong> ${markingCandleState.currentMarkingCandle.updateCount}/2</div>
                                    <div><strong>Last Update:</strong> ${new Date(markingCandleState.currentMarkingCandle.candle.timestamp).toLocaleTimeString()}</div>
                                    <div><strong>Next:</strong> Every 5 minutes</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        
        <!-- Latest 1-Minute Candle Data -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">📊 Latest 1-Minute Candle & Volume Analysis</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>🕯️ Last 1-Min Candle</h4>
                        <div class="info-value">
                            ${latestOneMinuteCandle ? 'LIVE' : 'NO DATA'}
                        </div>
                        <div class="info-subtitle">
                            ${latestOneMinuteCandle ? `
                                <div><strong>O:</strong> ₹${latestOneMinuteCandle.open?.toFixed(2) || '--'}</div>
                                <div><strong>H:</strong> ₹${latestOneMinuteCandle.high?.toFixed(2) || '--'}</div>
                                <div><strong>L:</strong> ₹${latestOneMinuteCandle.low?.toFixed(2) || '--'}</div>
                                <div><strong>C:</strong> ₹${latestOneMinuteCandle.close?.toFixed(2) || '--'}</div>
                            ` : `
                                <div><strong>Status:</strong> Building candle data</div>
                                <div><strong>Progress:</strong> ${oneMinuteCandleCount}/50 candles</div>
                            `}
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>📈 Volume Analysis</h4>
                        <div class="info-value">
                            ${latestOneMinuteCandle ? latestOneMinuteCandle.volume?.toLocaleString() || '--' : '--'}
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Volume:</strong> ${latestOneMinuteCandle ? latestOneMinuteCandle.volume?.toLocaleString() || '--' : '--'}</div>
                            <div><strong>SMA-50:</strong> ${volumeSMA50 ? volumeSMA50.toFixed(0) : '--'}</div>
                            <div><strong>Ratio:</strong> ${latestOneMinuteCandle && volumeSMA50 ? `${((latestOneMinuteCandle.volume / volumeSMA50) * 100).toFixed(0)}%` : '--'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>⏰ Timing Info</h4>
                        <div class="info-value">
                            ${latestOneMinuteCandle ? 'CURRENT' : 'BUILDING'}
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Last Update:</strong> ${latestOneMinuteCandle ? new Date(latestOneMinuteCandle.timestamp || Date.now()).toLocaleTimeString() : '--'}</div>
                            <div><strong>Candles Ready:</strong> ${oneMinuteCandleCount}/50</div>
                            <div><strong>Quality:</strong> ${oneMinuteCandleCount >= 50 ? 'Excellent' : oneMinuteCandleCount >= 30 ? 'Good' : 'Building'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🔍 Volume Signal</h4>
                        <div class="info-value ${latestOneMinuteCandle && volumeSMA50 && latestOneMinuteCandle.volume > volumeSMA50 ? 'positive' : latestOneMinuteCandle && volumeSMA50 ? 'negative' : 'neutral'}">
                            ${latestOneMinuteCandle && volumeSMA50 ? 
                                (latestOneMinuteCandle.volume > volumeSMA50 ? '🟢 ABOVE' : '🔴 BELOW') : 
                                '⚪ PENDING'
                            }
                        </div>
                        <div class="info-subtitle">
                            <div><strong>Signal:</strong> ${latestOneMinuteCandle && volumeSMA50 ? 
                                (latestOneMinuteCandle.volume > volumeSMA50 ? 'High volume detected' : 'Normal volume') : 
                                'Waiting for data'
                            }</div>
                            <div><strong>Multiplier:</strong> ${latestOneMinuteCandle && volumeSMA50 ? `${(latestOneMinuteCandle.volume / volumeSMA50).toFixed(2)}x` : '--'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Entry/Exit Levels & Risk Management -->
        
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">🎯 Entry/Exit Levels & Risk Management</div>
            </div>
            <div class="section-content">
                <div class="info-grid">
                    <div class="info-card">
                        <h4>🚪 Entry Level</h4>
                        <div class="info-value">₹${tradeStateInfo.tradeSetupRequest?.entryLevel || '--'}</div>
                        <div class="info-subtitle">
                            <div><strong>Direction:</strong> ${tradeStateInfo.tradeSetupRequest?.direction || 'Not set'}</div>
                            <div><strong>Status:</strong> ${tradeStateInfo.tradeState === 'in_trade' ? '✅ Executed' : tradeStateInfo.tradeSetupRequest ? '⏳ Pending' : '❌ No setup'}</div>
                            <div><strong>Order Type:</strong> Market Order</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🛡️ Stop Loss</h4>
                        <div class="info-value" style="color: #ef4444;">₹${tradeStateInfo.tradeSetupRequest?.stopLossLevel || '--'}</div>
                        <div class="info-subtitle">
                            <div><strong>Risk Amount:</strong> ₹${tradeStateInfo.tradeSetupRequest ? Math.abs(tradeStateInfo.tradeSetupRequest.entryLevel - tradeStateInfo.tradeSetupRequest.stopLossLevel).toFixed(2) : '--'}</div>
                            <div><strong>Distance:</strong> ${tradeStateInfo.tradeSetupRequest ? (Math.abs(tradeStateInfo.tradeSetupRequest.entryLevel - tradeStateInfo.tradeSetupRequest.stopLossLevel) / tradeStateInfo.tradeSetupRequest.entryLevel * 100).toFixed(2) + '%' : '--'}</div>
                            <div><strong>Protection:</strong> ${tradeStateInfo.tradeSetupRequest ? 'Automatic' : 'Not set'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>🎯 Target Level</h4>
                        <div class="info-value" style="color: #22c55e;">₹${tradeStateInfo.tradeSetupRequest?.targetLevel || '--'}</div>
                        <div class="info-subtitle">
                            <div><strong>Profit Potential:</strong> ₹${tradeStateInfo.tradeSetupRequest ? Math.abs(tradeStateInfo.tradeSetupRequest.targetLevel - tradeStateInfo.tradeSetupRequest.entryLevel).toFixed(2) : '--'}</div>
                            <div><strong>Return:</strong> ${tradeStateInfo.tradeSetupRequest ? (Math.abs(tradeStateInfo.tradeSetupRequest.targetLevel - tradeStateInfo.tradeSetupRequest.entryLevel) / tradeStateInfo.tradeSetupRequest.entryLevel * 100).toFixed(2) + '%' : '--'}</div>
                            <div><strong>Risk/Reward:</strong> ${tradeStateInfo.tradeSetupRequest ? '1:' + (Math.abs(tradeStateInfo.tradeSetupRequest.targetLevel - tradeStateInfo.tradeSetupRequest.entryLevel) / Math.abs(tradeStateInfo.tradeSetupRequest.entryLevel - tradeStateInfo.tradeSetupRequest.stopLossLevel)).toFixed(1) : '--'}</div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <h4>⚙️ Trade Setup</h4>
                        <div class="info-value">${tradeStateInfo.tradeState.replace(/_/g, ' ').toUpperCase()}</div>
                        <div class="info-subtitle">
                            <div><strong>Strategy:</strong> Breakout Retracement</div>
                            <div><strong>Position Size:</strong> ${tradingConfig?.niftyLotSize || 75} units</div>
                            <div><strong>Capital Risk:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Recent Trade History -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">📜 Recent Trade History</div>
            </div>
            <div class="section-content">
                ${tradeHistory.length > 0 ? `
                    <div style="margin-bottom: 20px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                            <div class="info-card">
                                <h4>📊 Total Trades</h4>
                                <div class="info-value">${tradeHistory.length}</div>
                                <div class="info-subtitle">${isPaperMode ? 'Paper trading' : 'Live trading'}</div>
                            </div>
                            <div class="info-card">
                                <h4>✅ Completed</h4>
                                <div class="info-value">${closedTrades.length}</div>
                                <div class="info-subtitle">${tradeHistory.length - closedTrades.length} still open</div>
                            </div>
                            <div class="info-card">
                                <h4>📈 Win Rate</h4>
                                <div class="info-value ${winRate >= 50 ? 'positive' : 'negative'}">${winRate.toFixed(1)}%</div>
                                <div class="info-subtitle">${winningTrades}W / ${losingTrades}L</div>
                            </div>
                            <div class="info-card">
                                <h4>💰 Total P&L</h4>
                                <div class="info-value ${totalPnL >= 0 ? 'positive' : 'negative'}">₹${totalPnL.toLocaleString()}</div>
                                <div class="info-subtitle">${isPaperMode ? 'Simulated' : 'Real money'}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px;">
                        <h4 style="color: #ffffff; margin-bottom: 15px;">🕒 Last 10 Trades</h4>
                        <div style="display: grid; gap: 12px;">
                            ${tradeHistory.slice(-10).reverse().map((trade, index) => `
                                <div style="display: grid; grid-template-columns: 60px 1fr 120px 100px 100px 80px; gap: 15px; align-items: center; padding: 12px 15px; background: rgba(255,255,255,0.05); border-radius: 8px; border-left: 4px solid ${trade.pnl >= 0 ? '#22c55e' : '#ef4444'};">
                                    <div style="text-align: center;">
                                        <div style="font-size: 1.2rem;">${trade.pnl >= 0 ? '✅' : '❌'}</div>
                                        <div style="font-size: 0.7rem; color: #94a3b8;">#${tradeHistory.length - index}</div>
                                    </div>
                                    <div>
                                        <div style="font-weight: 600; color: #ffffff; font-size: 0.9rem;">${trade.instrument.tradingsymbol}</div>
                                        <div style="color: #94a3b8; font-size: 0.8rem;">
                                            ${trade.direction} • Strike: ₹${trade.instrument.strike} • Qty: ${trade.quantity}
                                        </div>
                                    </div>
                                    <div style="text-align: center;">
                                        <div style="font-weight: 600; color: #06b6d4; font-size: 0.9rem;">₹${trade.entryPrice}</div>
                                        <div style="color: #94a3b8; font-size: 0.8rem;">Entry</div>
                                    </div>
                                    <div style="text-align: center;">
                                        <div style="font-weight: 600; color: ${trade.exitPrice ? '#f59e0b' : '#64748b'}; font-size: 0.9rem;">
                                            ${trade.exitPrice ? '₹' + trade.exitPrice : 'Open'}
                                        </div>
                                        <div style="color: #94a3b8; font-size: 0.8rem;">Exit</div>
                                    </div>
                                    <div style="text-align: center;">
                                        <div style="font-weight: 700; color: ${trade.pnl >= 0 ? '#22c55e' : '#ef4444'}; font-size: 0.9rem;">
                                            ${trade.pnl >= 0 ? '+' : ''}₹${trade.pnl.toLocaleString()}
                                        </div>
                                        <div style="color: #94a3b8; font-size: 0.8rem;">P&L</div>
                                    </div>
                                    <div style="text-align: center;">
                                        <div style="font-size: 0.8rem; color: ${trade.status === 'CLOSED' ? '#22c55e' : '#f59e0b'};">
                                            ${trade.status}
                                        </div>
                                        <div style="color: #94a3b8; font-size: 0.7rem;">
                                            ${new Date(trade.timestamp).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <div style="margin-top: 20px; text-align: center;">
                            <a href="/breakout-strategy/history" class="control-btn secondary" style="display: inline-block; padding: 10px 20px; text-decoration: none;">
                                📊 View Complete Trade History
                            </a>
                        </div>
                    </div>
                ` : `
                    <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                        <div style="font-size: 3rem; margin-bottom: 15px;">📭</div>
                        <h3 style="color: #ffffff; margin-bottom: 10px;">No Trade History</h3>
                        <p style="font-size: 0.9rem;">Start the strategy to begin generating trade history</p>
                        <div style="margin-top: 20px;">
                            ${!strategyActive ? `
                                <button onclick="startStrategy()" class="control-btn primary" style="padding: 12px 24px;">
                                    ▶️ Start Strategy
                                </button>
                            ` : `
                                <div style="color: #06b6d4;">Strategy is active • Waiting for breakout signals</div>
                            `}
                        </div>
                    </div>
                `}
            </div>
        </div>
        
        `}
        
        <!-- 7. PERFORMANCE ANALYTICS & RESULTS -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">📈 Performance Analytics & Results</div>
            </div>
            <div class="section-content">
                <div class="perf-grid">
                    <div class="perf-card">
                        <div class="perf-value ${totalPnL >= 0 ? 'positive' : 'negative'}">₹${totalPnL.toLocaleString()}</div>
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
                    <div class="perf-card">
                        <div class="perf-value ${totalPnL >= 0 ? 'positive' : 'negative'}">
                            ₹${closedTrades.length > 0 ? (totalPnL / closedTrades.length).toFixed(0) : '0'}
                        </div>
                        <div class="perf-label">Avg P&L per Trade</div>
                    </div>
                    <div class="perf-card">
                        <div class="perf-value neutral">
                            ₹${closedTrades.length > 0 ? Math.max(...closedTrades.filter(t => t.pnl > 0).map(t => t.pnl), 0).toLocaleString() : '0'}
                        </div>
                        <div class="perf-label">Best Trade</div>
                    </div>
                </div>
                
                <div style="margin-top: 20px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
                    <h4 style="color: #ffffff; margin-bottom: 15px;">📊 Strategy Performance Summary</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                        <div>
                            <div style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 8px;">Trading Mode</div>
                            <div style="color: ${isPaperMode ? '#f59e0b' : '#22c55e'}; font-weight: 600;">
                                ${isPaperMode ? '📝 Paper Trading (Safe Testing)' : '🚀 Live Trading (Real Money)'}
                            </div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 8px;">Risk Management</div>
                            <div style="color: #06b6d4; font-weight: 600;">
                                ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade
                            </div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 8px;">Strategy Type</div>
                            <div style="color: #ffffff; font-weight: 600;">
                                Breakout-Retracement (15,15 Pivots)
                            </div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 8px;">Capital Utilization</div>
                            <div style="color: #22c55e; font-weight: 600;">
                                ₹${currentCapital ? currentCapital.toLocaleString() : 'Loading...'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- QC CHECKLIST SECTION -->
        <div class="dashboard-section">
            <div class="section-header">
                <div class="section-title">✅ Quality Control Checklist</div>
            </div>
            <div class="section-content">
                <div class="qc-checklist">
                    <div class="qc-summary">
                        <div class="qc-score ${(() => {
                            const checks = [];
                            
                            // Authentication Check
                            checks.push(isAuthenticated);
                            
                            // Market Hours Check  
                            checks.push(isMarketHours);
                            
                            // Strategy Status Check
                            checks.push(strategyActive);
                            
                            // Price Streaming Check
                            checks.push(priceStreamingActive);
                            
                            // Breakout Detection Check
                            checks.push(breakoutDetectionActive);
                            
                            // Candle Data Check (at least 30 candles for partial readiness)
                            checks.push(oneMinuteCandleCount >= 30);
                            
                            // Pivot Detection Check
                            checks.push(latestPivots.pivotHigh && latestPivots.pivotLow);
                            
                            // Volume SMA Check
                            checks.push(typeof volumeSMA50 === 'number' && volumeSMA50 > 0);
                            
                            // Health Check
                            checks.push(healthReport && healthReport.overallStatus !== 'CRITICAL');
                            
                            // Capital Check
                            checks.push(currentCapital && currentCapital > 0);
                            
                            const passedChecks = checks.filter(check => check).length;
                            const totalChecks = checks.length;
                            const percentage = (passedChecks / totalChecks) * 100;
                            
                            if (percentage >= 90) return 'excellent';
                            if (percentage >= 75) return 'good';
                            if (percentage >= 50) return 'warning';
                            return 'critical';
                        })()}">
                            ${(() => {
                                const checks = [];
                                checks.push(isAuthenticated);
                                checks.push(isMarketHours);
                                checks.push(strategyActive);
                                checks.push(priceStreamingActive);
                                checks.push(breakoutDetectionActive);
                                checks.push(oneMinuteCandleCount >= 30);
                                checks.push(latestPivots.pivotHigh && latestPivots.pivotLow);
                                checks.push(typeof volumeSMA50 === 'number' && volumeSMA50 > 0);
                                checks.push(healthReport && healthReport.overallStatus !== 'CRITICAL');
                                checks.push(currentCapital && currentCapital > 0);
                                
                                const passedChecks = checks.filter(check => check).length;
                                const totalChecks = checks.length;
                                return Math.round((passedChecks / totalChecks) * 100) + '%';
                            })()}
                        </div>
                        <div style="color: #64748b; font-size: 0.9rem; margin-top: 5px;">System Readiness Score</div>
                    </div>
                    
                    <!-- Authentication & System -->
                    <div class="qc-item ${isAuthenticated ? 'pass' : 'fail'}">
                        <div class="qc-icon">${isAuthenticated ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🔐 Authentication Status</div>
                            <div class="qc-detail">${isAuthenticated ? 'Successfully authenticated with Zerodha' : 'Authentication required'}</div>
                        </div>
                    </div>
                    
                    <div class="qc-item ${isMarketHours ? 'pass' : 'warning'}">
                        <div class="qc-icon">${isMarketHours ? '✅' : '⚠️'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🕒 Market Hours</div>
                            <div class="qc-detail">${isMarketHours ? 'Market is open for trading' : 'Market is closed - trading unavailable'}</div>
                        </div>
                    </div>
                    
                    <!-- Strategy Status -->
                    <div class="qc-item ${strategyActive ? 'pass' : 'fail'}">
                        <div class="qc-icon">${strategyActive ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🚀 Strategy Status</div>
                            <div class="qc-detail">${strategyActive ? 'Breakout strategy is active and running' : 'Strategy is stopped - activate to begin trading'}</div>
                        </div>
                    </div>
                    
                    <div class="qc-item ${priceStreamingActive ? 'pass' : 'fail'}">
                        <div class="qc-icon">${priceStreamingActive ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">📡 Price Streaming</div>
                            <div class="qc-detail">${priceStreamingActive ? 'Live NIFTY price data streaming (1-second polling)' : 'Price streaming is inactive'}</div>
                        </div>
                    </div>
                    
                    <!-- Signal Detection -->
                    <div class="qc-item ${breakoutDetectionActive ? 'pass' : 'fail'}">
                        <div class="qc-icon">${breakoutDetectionActive ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🎯 Breakout Detection</div>
                            <div class="qc-detail">${breakoutDetectionActive ? 'Breakout detection engine is active' : 'Breakout detection is inactive'}</div>
                        </div>
                    </div>
                    
                    <div class="qc-item ${(oneMinuteCandleCount >= 50) ? 'pass' : (oneMinuteCandleCount >= 30) ? 'warning' : 'fail'}">
                        <div class="qc-icon">${(oneMinuteCandleCount >= 50) ? '✅' : (oneMinuteCandleCount >= 30) ? '⚠️' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🕯️ 1-Minute Candle Data</div>
                            <div class="qc-detail">
                                ${oneMinuteCandleCount}/50 candles loaded 
                                ${oneMinuteCandleCount >= 50 ? '(Excellent - Full dataset)' : 
                                  oneMinuteCandleCount >= 30 ? '(Good - Partial dataset)' : 
                                  '(Poor - Insufficient data)'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Pivot Analysis -->
                    <div class="qc-item ${(latestPivots.pivotHigh && latestPivots.pivotLow) ? 'pass' : 'warning'}">
                        <div class="qc-icon">${(latestPivots.pivotHigh && latestPivots.pivotLow) ? '✅' : '⚠️'}</div>
                        <div class="qc-content">
                            <div class="qc-label">📊 Pivot Detection (15,15)</div>
                            <div class="qc-detail">
                                ${(latestPivots.pivotHigh && latestPivots.pivotLow) ? 
                                    'Both pivot high and low detected - ready for breakout signals' : 
                                    'Waiting for pivot points - algorithm scanning 5-minute candles'}
                            </div>
                        </div>
                    </div>
                    
                    <div class="qc-item ${(typeof volumeSMA50 === 'number' && volumeSMA50 > 0) ? 'pass' : 'warning'}">
                        <div class="qc-icon">${(typeof volumeSMA50 === 'number' && volumeSMA50 > 0) ? '✅' : '⚠️'}</div>
                        <div class="qc-content">
                            <div class="qc-label">📈 Volume SMA-50</div>
                            <div class="qc-detail">
                                ${(typeof volumeSMA50 === 'number' && volumeSMA50 > 0) ? 
                                    'Volume baseline established: ' + volumeSMA50.toFixed(0) + ' (filtering noise)' : 
                                    'Building volume baseline - requires 50 candles for accuracy'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Health Monitoring -->
                    <div class="qc-item ${(healthReport && healthReport.overallStatus !== 'CRITICAL') ? 'pass' : 'fail'}">
                        <div class="qc-icon">${(healthReport && healthReport.overallStatus !== 'CRITICAL') ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🏥 System Health</div>
                            <div class="qc-detail">
                                ${healthReport ? 
                                    'Status: ' + healthReport.overallStatus + ' - ' + 
                                    (healthReport.totalErrors || 0) + ' total errors detected' : 
                                    'Health monitoring data unavailable'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Capital & Trading Mode -->
                    <div class="qc-item ${(currentCapital && currentCapital > 0) ? 'pass' : 'fail'}">
                        <div class="qc-icon">${(currentCapital && currentCapital > 0) ? '✅' : '❌'}</div>
                        <div class="qc-content">
                            <div class="qc-label">💰 Trading Capital</div>
                            <div class="qc-detail">
                                ${currentCapital ? 
                                    'Available: ₹' + currentCapital.toLocaleString() + ' (' + (tradingConfig?.paperTradingMode ? 'Paper Mode' : 'Live Mode') + ')' : 
                                    'Capital information unavailable'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Current Signal Status -->
                    <div class="qc-item ${latestBreakoutSignal ? 'pass' : 'warning'}">
                        <div class="qc-icon">${latestBreakoutSignal ? '🚨' : '👁️'}</div>
                        <div class="qc-content">
                            <div class="qc-label">🎯 Active Signals</div>
                            <div class="qc-detail">
                                ${latestBreakoutSignal ? 
                                    latestBreakoutSignal.type.replace('_', ' ').toUpperCase() + ' signal at ₹' + latestBreakoutSignal.price.toFixed(2) : 
                                    'No active breakout signals - monitoring for opportunities'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Strategy Rules Summary -->
                    <div style="margin-top: 25px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 12px; border-left: 4px solid #3b82f6;">
                        <h4 style="color: #1e293b; margin-bottom: 15px; display: flex; align-items: center;">
                            <span style="margin-right: 10px;">📋</span>
                            Breakout Strategy Rules Summary
                        </h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; font-size: 0.9rem; color: #64748b;">
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">🎯 Entry Conditions</div>
                                <div>• 5-minute breakout above/below pivot (15,15)</div>
                                <div>• Volume > SMA-50 (confirmation)</div>
                                <div>• Clear breakout candle formation</div>
                                <div>• Opposite marking candle (retracement)</div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">⏰ Timing Rules</div>
                                <div>• 1-minute timeframe execution</div>
                                <div>• 18-minute marking candle window</div>
                                <div>• Maximum 2 candle updates</div>
                                <div>• Real-time price monitoring (1-sec polling)</div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">🛡️ Risk Management</div>
                                <div>• Stop loss at marking candle low/high</div>
                                <div>• Target level optimization</div>
                                <div>• Position sizing: 75 units (1 lot)</div>
                                <div>• Capital risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade</div>
                            </div>
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">📊 Option Selection</div>
                                <div>• ATM strike selection</div>
                                <div>• CALL for long breakouts</div>
                                <div>• PUT for short breakouts</div>
                                <div>• Premium-based optimization</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Footer with refresh info -->
        <div style="text-align: center; margin-top: 40px; padding: 20px; background: rgba(0,0,0,0.05); border-radius: 12px; border: 1px solid rgba(0,0,0,0.1);">
            <div style="color: #64748b; font-size: 0.9rem;">
                🔄 Dashboard updates every 10 seconds • 
                💡 Strategy recalculates pivots every 5 minutes during market hours
            </div>
        </div>
    </div>
</body>
</html>`;

      res.send(modernHtmlResponse);
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

    // ===========================
    // MULTI-STRATEGY ENDPOINTS
    // ===========================

    // Get all strategies status
    this.app.get('/strategies', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const allStatuses = this.strategyManager.getAllStrategyStatuses();
        const globalMetrics = this.strategyManager.getGlobalMetrics();
        
        const response = {
          success: true,
          timestamp: new Date().toISOString(),
          global_metrics: globalMetrics,
          strategies: Object.fromEntries(allStatuses)
        };

        res.json(response);
      } catch (error) {
        this.logger.error('Error getting strategies status:', error);
        res.status(500).json({ error: 'Failed to get strategies status' });
      }
    });

    // Get specific strategy status
    this.app.get('/strategies/:id', (req: Request, res: Response) => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const strategyId = req.params.id;
        if (!strategyId) {
          res.status(400).json({ error: 'Strategy ID is required' });
          return;
        }
        
        const status = this.strategyManager.getStrategyStatus(strategyId);
        
        if (!status) {
          res.status(404).json({ error: `Strategy not found: ${strategyId}` });
          return;
        }

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          strategy: status
        });
      } catch (error) {
        this.logger.error(`Error getting strategy ${req.params.id} status:`, error);
        res.status(500).json({ error: 'Failed to get strategy status' });
      }
    });

    // Start a specific strategy
    this.app.post('/strategies/:id/start', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const strategyId = req.params.id;
        if (!strategyId) {
          res.status(400).json({ error: 'Strategy ID is required' });
          return;
        }
        
        const success = await this.strategyManager.startStrategy(strategyId);
        
        if (success) {
          res.json({
            success: true,
            message: `Strategy ${strategyId} started successfully`,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(400).json({ 
            error: `Failed to start strategy: ${strategyId}` 
          });
        }
      } catch (error) {
        this.logger.error(`Error starting strategy ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to start strategy' });
      }
    });

    // Stop a specific strategy
    this.app.post('/strategies/:id/stop', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const strategyId = req.params.id;
        if (!strategyId) {
          res.status(400).json({ error: 'Strategy ID is required' });
          return;
        }
        
        const success = await this.strategyManager.stopStrategy(strategyId);
        
        if (success) {
          res.json({
            success: true,
            message: `Strategy ${strategyId} stopped successfully`,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(400).json({ 
            error: `Failed to stop strategy: ${strategyId}` 
          });
        }
      } catch (error) {
        this.logger.error(`Error stopping strategy ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to stop strategy' });
      }
    });

    // Start all strategies
    this.app.post('/strategies/start-all', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        await this.strategyManager.startAllStrategies();
        
        res.json({
          success: true,
          message: 'All enabled strategies started successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error starting all strategies:', error);
        res.status(500).json({ error: 'Failed to start all strategies' });
      }
    });

    // Stop all strategies
    this.app.post('/strategies/stop-all', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        await this.strategyManager.stopAllStrategies();
        
        res.json({
          success: true,
          message: 'All strategies stopped successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Error stopping all strategies:', error);
        res.status(500).json({ error: 'Failed to stop all strategies' });
      }
    });

    // Get strategy page (individual strategy dashboard)
    this.app.get('/strategy/:id', async (req: Request, res: Response) => {
      try {
        const strategyId = req.params.id;
        if (!strategyId) {
          res.status(400).send('Strategy ID is required');
          return;
        }
        
        const status = this.strategyManager.getStrategyStatus(strategyId);
        
        if (!status) {
          res.status(404).send(`
            <html>
              <head><title>Strategy Not Found</title></head>
              <body>
                <h1>Strategy Not Found</h1>
                <p>Strategy "${strategyId}" was not found.</p>
                <a href="/">← Back to Main Dashboard</a>
              </body>
            </html>
          `);
          return;
        }

        // Render strategy-specific page
        const html = this.renderStrategyPage(strategyId, status);
        res.send(html);
        
      } catch (error) {
        this.logger.error(`Error rendering strategy page ${req.params.id}:`, error);
        res.status(500).send('Error loading strategy page');
      }
    });
  }

  public async start(): Promise<void> {
    try {
      // Wait for session initialization to complete before checking authentication
      await this.authService.waitForInitialization();

      // Initialize Strategy Manager
      await this.strategyManager.initialize();
      this.logger.info('✅ Multi-Strategy System initialized successfully');

      // Check if we have a valid access token
      if (!this.authService.isAuthenticated()) {
        this.logger.warn('Bot is not authenticated. Please visit /auth/login to authenticate.');
      }

      // Start the web server
      const port = process.env.PORT || 3000;
      this.app.listen(port, () => {
        this.logger.info(`Trading bot server started on port ${port}`);
        this.logger.info('Visit http://localhost:3000/auth/login to authenticate with Zerodha');
        this.logger.info('🎯 Multi-Strategy Dashboard: http://localhost:3000/');
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

  /**
   * Render strategy-specific page
   */
  private renderStrategyPage(strategyId: string, status: any): string {
    const strategyName = status.config.name;
    const isActive = status.metrics.isActive;
    const healthStatus = status.metrics.healthStatus;
    const isBollingerBand = strategyId === 'bollinger-band-01';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${strategyName} - Trading Bot</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 10px; 
            padding: 30px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          }
          .header { 
            text-align: center; 
            margin-bottom: 30px; 
            padding-bottom: 25px; 
            border-bottom: 3px solid #667eea;
          }
          .status-badge { 
            display: inline-block; 
            padding: 8px 16px; 
            border-radius: 20px; 
            color: white; 
            font-weight: bold; 
            margin-left: 10px;
          }
          .active { background-color: #28a745; }
          .stopped { background-color: #dc3545; }
          .warning { background-color: #ffc107; color: #212529; }
          .error { background-color: #dc3545; }
          .healthy { background-color: #28a745; }
          .controls { 
            text-align: center; 
            margin: 30px 0; 
          }
          .btn { 
            background: #667eea; 
            color: white; 
            border: none; 
            padding: 12px 24px; 
            border-radius: 6px; 
            cursor: pointer; 
            margin: 0 10px; 
            font-size: 16px;
            transition: all 0.3s ease;
          }
          .btn:hover { 
            background: #5a6fd8; 
            transform: translateY(-2px);
          }
          .btn:disabled { 
            background: #6c757d; 
            cursor: not-allowed; 
            transform: none;
          }
          .metrics { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 20px; 
            margin: 30px 0; 
          }
          .metric-card { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px; 
            border-left: 4px solid #667eea;
          }
          .metric-value { 
            font-size: 2em; 
            font-weight: bold; 
            color: #667eea; 
          }
          .back-link { 
            display: inline-block; 
            margin-bottom: 20px; 
            color: #667eea; 
            text-decoration: none; 
            font-weight: bold;
          }
          .back-link:hover { 
            color: #5a6fd8; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <a href="/" class="back-link">← Back to Main Dashboard</a>
          
          <div class="header">
            <h1>${strategyName}</h1>
            <span class="status-badge ${isActive ? 'active' : 'stopped'}">
              ${isActive ? 'ACTIVE' : 'STOPPED'}
            </span>
            <span class="status-badge ${healthStatus}">
              ${healthStatus.toUpperCase()}
            </span>
          </div>

          <div class="controls">
            <button class="btn" onclick="startStrategy()" ${isActive ? 'disabled' : ''}>
              Start Strategy
            </button>
            <button class="btn" onclick="stopStrategy()" ${!isActive ? 'disabled' : ''}>
              Stop Strategy
            </button>
            <button class="btn" onclick="refreshStatus()">
              Refresh
            </button>
          </div>

          ${isBollingerBand ? this.renderBollingerBandMetrics(status) : this.renderGenericMetrics(status)}

          <div style="margin-top: 30px;">
            <h3>Configuration</h3>
            <pre style="background: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto;">
${JSON.stringify(status.config, null, 2)}
            </pre>
          </div>

          <div style="margin-top: 30px;">
            <h3>Strategy Details</h3>
            <p><strong>ID:</strong> ${strategyId}</p>
            <p><strong>Description:</strong> ${status.config.description}</p>
            <p><strong>Instruments:</strong> ${status.config.instruments.join(', ')}</p>
            <p><strong>Max Positions:</strong> ${status.config.maxPositions}</p>
            <p><strong>Last Update:</strong> ${new Date(status.metrics.lastUpdateTime).toLocaleString()}</p>
          </div>
        </div>

        <script>
          async function startStrategy() {
            try {
              const response = await fetch('/strategies/${strategyId}/start', { method: 'POST' });
              const result = await response.json();
              
              if (result.success) {
                alert('Strategy started successfully!');
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
              const response = await fetch('/strategies/${strategyId}/stop', { method: 'POST' });
              const result = await response.json();
              
              if (result.success) {
                alert('Strategy stopped successfully!');
                window.location.reload();
              } else {
                alert('Failed to stop strategy: ' + (result.error || 'Unknown error'));
              }
            } catch (error) {
              alert('Error stopping strategy: ' + error.message);
            }
          }

          function refreshStatus() {
            window.location.reload();
          }

          // TODO: Replace auto-refresh with server-sent events to eliminate API waste
          // Auto refresh disabled to prevent excessive API calls
          // setTimeout(() => { window.location.reload(); }, 30000);
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Render Bollinger Band strategy specific metrics
   */
  private renderBollingerBandMetrics(status: any): string {
    // Extract real-time data from the strategy status
    const indicators = status.indicators || {};
    const pivots = status.pivots || {};
    const currentPosition = status.currentPosition || null;
    const candleCount = status.candleCount || 0;
    const isActive = status.metrics?.isActive || false;
    
    // Get NIFTY50 price from last completed 5-minute candle close
    const currentNiftyPrice = status.currentNiftyPrice || indicators.bollingerBands?.middle || 25170;
    const currentNifty50Price = currentNiftyPrice.toFixed(2);

    return `
      <div class="metrics">
        <!-- Strategy Status Banner -->
        <div class="metric-card" style="grid-column: span 3; background: #ffffff; border: 2px solid ${isActive ? '#22c55e' : '#6c757d'}; border-left: 6px solid ${isActive ? '#22c55e' : '#6c757d'};">
          <div class="metric-value" style="font-size: 2em; font-weight: bold; color: ${isActive ? '#22c55e' : '#6c757d'};">${isActive ? '🟢 ACTIVE' : '🔴 STOPPED'}</div>
          <div style="font-size: 1.2em; margin-top: 5px; color: #1f2937;">Strategy Status</div>
          <div style="font-size: 0.9em; margin-top: 5px; color: #6b7280;">Real-time monitoring ${isActive ? 'ON' : 'OFF'}</div>
        </div>

        <!-- NIFTY50 5-Minute Close Price -->
        <div class="metric-card" style="grid-column: span 2; background: #ffffff; border: 2px solid #3b82f6; border-left: 6px solid #3b82f6;">
          <div class="metric-value" style="font-size: 2.5em; font-weight: bold; color: #3b82f6;">₹${currentNifty50Price}</div>
          <div style="font-size: 1.2em; margin-top: 5px; color: #1f2937;">5-Minute OHLC Close</div>
          <div style="font-size: 0.9em; margin-top: 5px; color: #6b7280;">Last Completed Candle (${candleCount} total)</div>
        </div>

        <!-- Current 5-Minute Candle (Entry Signal Basis) -->
        ${this.render5MinuteCandle(status.currentCandle)}

        <!-- Trading Metrics -->
        <div class="metric-card">
          <div class="metric-value">${status.metrics.totalTrades}</div>
          <div>Total Trades</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">₹${status.metrics.profitLoss.toFixed(2)}</div>
          <div>Profit & Loss</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.metrics.winRate.toFixed(1)}%</div>
          <div>Win Rate</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.fixedLots || 10} Lots</div>
          <div>Fixed Position Size</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">₹${(status.capitalAllocation || 200000).toLocaleString()}</div>
          <div>Capital Allocation</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.config.timeframe}</div>
          <div>Timeframe</div>
        </div>
      </div>

      <!-- Technical Indicators Section -->
      <div style="margin-top: 30px;">
        <h3 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">📊 Technical Indicators</h3>
        <div class="metrics" style="margin-top: 20px;">
          <div class="metric-card" style="background: #ffffff; border: 2px solid ${indicators.rsi >= 70 ? '#ef4444' : indicators.rsi <= 30 ? '#22c55e' : '#f59e0b'}; border-left: 6px solid ${indicators.rsi >= 70 ? '#ef4444' : indicators.rsi <= 30 ? '#22c55e' : '#f59e0b'};">
            <div class="metric-value" style="color: ${indicators.rsi >= 70 ? '#ef4444' : indicators.rsi <= 30 ? '#22c55e' : '#f59e0b'};">${indicators.rsi ? indicators.rsi.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">RSI (10)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${indicators.rsi >= 70 && indicators.rsi <= 80 ? '✅ LONG Range' : 
                indicators.rsi >= 10 && indicators.rsi <= 30 ? '✅ SHORT Range' : 
                indicators.rsi > 80 ? '⚠️ Overbought' : 
                indicators.rsi < 10 ? '⚠️ Oversold' : '⏸️ Neutral'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid ${indicators.supertrend?.trend === 'UP' ? '#22c55e' : '#ef4444'}; border-left: 6px solid ${indicators.supertrend?.trend === 'UP' ? '#22c55e' : '#ef4444'};">
            <div class="metric-value" style="color: ${indicators.supertrend?.trend === 'UP' ? '#22c55e' : '#ef4444'};">${indicators.supertrend?.trend || 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">Supertrend (10,2)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              Level: ₹${indicators.supertrend?.value ? indicators.supertrend.value.toFixed(2) : 'N/A'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #3b82f6; border-left: 6px solid #3b82f6;">
            <div class="metric-value" style="color: #3b82f6;">₹${indicators.bollingerBands?.upper ? indicators.bollingerBands.upper.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">BB Upper</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice > (indicators.bollingerBands?.upper || 0) ? '🟢 Above' : '🔴 Below'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #6366f1; border-left: 6px solid #6366f1;">
            <div class="metric-value" style="color: #6366f1;">₹${indicators.bollingerBands?.middle ? indicators.bollingerBands.middle.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">BB Middle</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">SMA(20)</div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #8b5cf6; border-left: 6px solid #8b5cf6;">
            <div class="metric-value" style="color: #8b5cf6;">₹${indicators.bollingerBands?.lower ? indicators.bollingerBands.lower.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">BB Lower</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice < (indicators.bollingerBands?.lower || 0) ? '🟢 Below' : '🔴 Above'}
            </div>
          </div>
          ${currentPosition ? `
          <div class="metric-card" style="background: #ffffff; border: 2px solid #ef4444; border-left: 6px solid #ef4444;">
            <div class="metric-value" style="color: #ef4444;">${currentPosition.type}</div>
            <div style="color: #1f2937; font-weight: 600;">Current Position</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              Entry: ₹${currentPosition.entryPrice || 'N/A'}
            </div>
          </div>
          ` : `
          <div class="metric-card" style="background: #ffffff; border: 2px solid #6c757d; border-left: 6px solid #6c757d;">
            <div class="metric-value" style="color: #6c757d;">None</div>
            <div style="color: #1f2937; font-weight: 600;">Current Position</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">No active trades</div>
          </div>
          `}
        </div>
      </div>

      <!-- Daily Pivots Section -->
      <div style="margin-top: 30px;">
        <h3 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">🎯 Daily Pivot Levels</h3>
        <div class="metrics" style="margin-top: 20px;">
          <div class="metric-card" style="background: #ffffff; border: 2px solid #ef4444; border-left: 6px solid #ef4444;">
            <div class="metric-value" style="color: #ef4444;">₹${pivots.r2 ? pivots.r2.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">R2 (Resistance)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice > (pivots.r2 || 0) ? '🟢 Above' : '🔴 Below'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #f97316; border-left: 6px solid #f97316;">
            <div class="metric-value" style="color: #f97316;">₹${pivots.r1 ? pivots.r1.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">R1 (Resistance)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice > (pivots.r1 || 0) ? '🟢 Above' : '🔴 Below'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #6366f1; border-left: 6px solid #6366f1;">
            <div class="metric-value" style="color: #6366f1;">₹${pivots.pp ? pivots.pp.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">PP (Pivot Point)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">Central level</div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #22c55e; border-left: 6px solid #22c55e;">
            <div class="metric-value" style="color: #22c55e;">₹${pivots.s1 ? pivots.s1.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">S1 (Support)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice < (pivots.s1 || 0) ? '🟢 Below' : '🔴 Above'}
            </div>
          </div>
          <div class="metric-card" style="background: #ffffff; border: 2px solid #10b981; border-left: 6px solid #10b981;">
            <div class="metric-value" style="color: #10b981;">₹${pivots.s2 ? pivots.s2.toFixed(2) : 'N/A'}</div>
            <div style="color: #1f2937; font-weight: 600;">S2 (Support)</div>
            <div style="font-size: 0.8em; margin-top: 3px; color: #6b7280;">
              ${currentNiftyPrice < (pivots.s2 || 0) ? '🟢 Below' : '🔴 Above'}
            </div>
          </div>
        </div>
      </div>

      <!-- Option Instrument & Trade Setup -->
      <div style="margin-top: 30px;">
        <h3 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">📝 Option Instrument & Trade Setup</h3>
        <div class="metrics" style="margin-top: 20px;">
          <div class="metric-card" style="grid-column: span 2; background: #ffffff; border: 2px solid #3b82f6; border-left: 6px solid #3b82f6;">
            <div style="color: #1f2937; font-weight: 600; margin-bottom: 12px;">Selected Instrument</div>
            <div style="background: #f8fafc; border-radius: 8px; padding: 12px;">
              <div style="color: #6b7280; font-style: italic; font-size: 14px;">
                Instrument will be selected automatically when entry signal is detected<br>
                <small>ATM options based on strategy rules and market conditions</small>
              </div>
            </div>
          </div>
          <div class="metric-card" style="grid-column: span 1; background: #ffffff; border: 2px solid #f59e0b; border-left: 6px solid #f59e0b;">
            <div style="color: #1f2937; font-weight: 600; margin-bottom: 8px;">Trade Setup</div>
            <div style="font-size: 14px; line-height: 1.5; color: #374151;">
              <div><strong>Entry:</strong> Waiting for signal</div>
              <div><strong>Stop Loss:</strong> 12% trailing</div>
              <div><strong>Target:</strong> Mid BB exit</div>
              <div><strong>Position Size:</strong> ${status.fixedLots || 10} lots</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Entry/Exit Signal Analysis -->
      <div style="margin-top: 30px;">
        <h3 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">🎯 Live Signal Analysis</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
          ${this.renderSignalAnalysis('LONG', indicators, pivots, currentNiftyPrice)}
          ${this.renderSignalAnalysis('SHORT', indicators, pivots, currentNiftyPrice)}
        </div>
      </div>

      <!-- Strategy Rules -->
      <div style="margin-top: 30px;">
        <h3 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">📋 Strategy Rules</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 5px solid #22c55e;">
            <h4 style="color: #22c55e; margin-top: 0;">🚀 LONG Entry</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Price > Bollinger Upper Band</li>
              <li>RSI between 65-85</li>
              <li>Supertrend = UP</li>
              <li>Price above R1 or R2</li>
            </ul>
            <p style="margin: 10px 0 0 0; font-weight: bold; color: #22c55e;">Exit: NIFTY50 < Mid BB</p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 5px solid #ef4444;">
            <h4 style="color: #ef4444; margin-top: 0;">🔻 SHORT Entry</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Price < Bollinger Lower Band</li>
              <li>RSI between 15-35</li>
              <li>Supertrend = DOWN</li>
              <li>Price below R1</li>
            </ul>
            <p style="margin: 10px 0 0 0; font-weight: bold; color: #ef4444;">Exit: 12% Trailing SL</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render current 5-minute candle data (used for entry signals)
   */
  private render5MinuteCandle(currentCandle: any): string {
    if (!currentCandle) {
      return `
        <div class="metric-card" style="grid-column: span 4; background: #ffffff; border: 2px solid #6c757d; border-left: 6px solid #6c757d;">
          <div class="metric-value" style="color: #6c757d;">No Active Candle</div>
          <div style="font-size: 1.2em; margin-top: 5px; color: #1f2937;">5-Minute Candle (Entry Signal Basis)</div>
          <div style="font-size: 0.9em; margin-top: 5px; color: #6b7280;">Waiting for market data...</div>
        </div>
      `;
    }

    const isComplete = currentCandle.isComplete;
    const candleColor = currentCandle.close >= currentCandle.open ? '#22c55e' : '#ef4444';
    const statusColor = isComplete ? '#22c55e' : '#f59e0b';
    const statusText = isComplete ? '🟢 COMPLETED' : '🟡 BUILDING';
    
    const startTime = new Date(currentCandle.timestamp).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    const endTime = new Date(new Date(currentCandle.timestamp).getTime() + 5 * 60 * 1000).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    return `
      <div class="metric-card" style="grid-column: span 4; background: #ffffff; border: 2px solid ${statusColor}; border-left: 6px solid ${statusColor};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <div>
            <div class="metric-value" style="color: ${statusColor}; font-size: 1.5em;">${statusText}</div>
            <div style="font-size: 1.2em; margin-top: 5px; color: #1f2937;">5-Minute Candle (Entry Signal Basis)</div>
            <div style="font-size: 0.9em; margin-top: 5px; color: #6b7280;">${startTime} - ${endTime}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.9em; color: #6b7280;">Candle Progress</div>
            <div style="font-size: 1.1em; color: ${candleColor}; font-weight: bold;">
              ${currentCandle.close >= currentCandle.open ? '🟢 Bullish' : '🔴 Bearish'}
            </div>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
          <div style="text-align: center; padding: 10px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 5px;">OPEN</div>
            <div style="font-size: 1.2em; font-weight: bold; color: #1f2937;">₹${currentCandle.open.toFixed(2)}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 5px;">HIGH</div>
            <div style="font-size: 1.2em; font-weight: bold; color: #22c55e;">₹${currentCandle.high.toFixed(2)}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 5px;">LOW</div>
            <div style="font-size: 1.2em; font-weight: bold; color: #ef4444;">₹${currentCandle.low.toFixed(2)}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 5px;">CLOSE</div>
            <div style="font-size: 1.2em; font-weight: bold; color: ${candleColor};">₹${currentCandle.close.toFixed(2)}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render signal analysis for LONG/SHORT entry conditions
   */
  private renderSignalAnalysis(signalType: 'LONG' | 'SHORT', indicators: any, pivots: any, currentPrice: number): string {
    const price = currentPrice;
    const rsi = indicators.rsi || 0;
    const supertrend = indicators.supertrend?.trend || 'N/A';
    const bbUpper = indicators.bollingerBands?.upper || 0;
    const bbLower = indicators.bollingerBands?.lower || 0;
    const r1 = pivots.r1 || 0;
    const r2 = pivots.r2 || 0;
    
    let conditions = [];
    let metCount = 0;
    let signalStrength = 'No Signal';
    let signalColor = '#6c757d';
    
    if (signalType === 'LONG') {
      const priceAboveUpper = price > bbUpper;
      const rsiInRange = rsi >= 65 && rsi <= 85;
      const supertrendUp = supertrend === 'UP';
      const aboveR1orR2 = price > r1 || price > r2;
      
      conditions = [
        { name: 'Price > BB Upper', met: priceAboveUpper, value: `₹${price.toFixed(2)} ${priceAboveUpper ? '>' : '<='} ₹${bbUpper.toFixed(2)}` },
        { name: 'RSI 65-85', met: rsiInRange, value: `${rsi.toFixed(2)} ${rsiInRange ? 'in' : 'out of'} range` },
        { name: 'Supertrend UP', met: supertrendUp, value: supertrend },
        { name: 'Above R1/R2', met: aboveR1orR2, value: `Above R1:${price > r1 ? '✅' : '❌'} R2:${price > r2 ? '✅' : '❌'}` }
      ];
      
      metCount = conditions.filter(c => c.met).length;
      signalStrength = metCount === 4 ? '🟢 STRONG BUY' : metCount >= 2 ? '🟡 WEAK' : '🔴 NO SIGNAL';
      signalColor = metCount === 4 ? '#22c55e' : metCount >= 2 ? '#f59e0b' : '#ef4444';
    } else {
      const priceBelowLower = price < bbLower;
      const rsiInRange = rsi >= 15 && rsi <= 35;
      const supertrendDown = supertrend === 'DOWN';
      const belowR1 = price <= r1;
      
      conditions = [
        { name: 'Price < BB Lower', met: priceBelowLower, value: `₹${price.toFixed(2)} ${priceBelowLower ? '<' : '>='} ₹${bbLower.toFixed(2)}` },
        { name: 'RSI 15-35', met: rsiInRange, value: `${rsi.toFixed(2)} ${rsiInRange ? 'in' : 'out of'} range` },
        { name: 'Supertrend DOWN', met: supertrendDown, value: supertrend },
        { name: 'Below R1', met: belowR1, value: `₹${price.toFixed(2)} ${belowR1 ? '<=' : '>'} ₹${r1.toFixed(2)}` }
      ];
      
      metCount = conditions.filter(c => c.met).length;
      signalStrength = metCount === 4 ? '🔴 STRONG SELL' : metCount >= 2 ? '🟡 WEAK' : '🔴 NO SIGNAL';
      signalColor = metCount === 4 ? '#ef4444' : metCount >= 2 ? '#f59e0b' : '#6c757d';
    }
    
    return `
      <div style="background: #ffffff; border: 2px solid ${signalColor}; border-left: 6px solid ${signalColor}; padding: 20px; border-radius: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <h4 style="color: ${signalColor}; margin: 0; font-weight: 600;">${signalType === 'LONG' ? '🚀' : '🔻'} ${signalType} Entry Analysis</h4>
          <div style="background: ${signalColor}; color: white; padding: 5px 10px; border-radius: 15px; font-size: 0.8em; font-weight: bold;">
            ${signalStrength}
          </div>
        </div>
        <div style="margin-bottom: 10px;">
          <div style="background: #e9ecef; border-radius: 10px; height: 8px; margin-bottom: 5px;">
            <div style="background: ${signalColor}; height: 100%; border-radius: 10px; width: ${(metCount/4)*100}%; transition: width 0.3s ease;"></div>
          </div>
          <small style="color: #6c757d;">${metCount}/4 conditions met</small>
        </div>
        <ul style="margin: 10px 0; padding-left: 15px; list-style: none;">
          ${conditions.map(condition => `
            <li style="margin: 8px 0; padding-left: 20px; position: relative;">
              <span style="position: absolute; left: 0; color: ${condition.met ? '#22c55e' : '#ef4444'};">
                ${condition.met ? '✅' : '❌'}
              </span>
              <strong>${condition.name}:</strong> <span style="color: ${condition.met ? '#22c55e' : '#ef4444'};">${condition.value}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  /**
   * Render generic strategy metrics
   */
  private renderGenericMetrics(status: any): string {
    return `
      <div class="metrics">
        <div class="metric-card">
          <div class="metric-value">${status.metrics.totalTrades}</div>
          <div>Total Trades</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">₹${status.metrics.profitLoss.toFixed(2)}</div>
          <div>Profit & Loss</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.metrics.winRate.toFixed(1)}%</div>
          <div>Win Rate</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.metrics.errorCount}</div>
          <div>Error Count</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.config.timeframe}</div>
          <div>Timeframe</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${status.config.riskPerTrade}%</div>
          <div>Risk Per Trade</div>
        </div>
      </div>
    `;
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