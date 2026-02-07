import { KiteConnect } from 'kiteconnect';
import { AuthService } from './services/AuthService';
import { QuoteManager } from './services/QuoteManager';
import { StrategyManager } from './core/StrategyManager';
import { StrategyRegistry } from './core/StrategyRegistry';
import { Logger } from './utils/Logger';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

class TradingBot {
  private kiteConnect: any;
  private authService: AuthService;
  private quoteManager: QuoteManager;
  private strategyManager: StrategyManager;
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
    
    // Initialize QuoteManager singleton
    this.quoteManager = new QuoteManager(this.kiteConnect, this.logger);
    
    // Initialize Strategy Manager
    const configPath = path.join(__dirname, '..', 'config', 'strategies.json');
    this.strategyManager = new StrategyManager(
      this.kiteConnect,
      this.authService,
      this.logger,
      this.quoteManager,
      {
        configPath,
        autoStart: false,
        healthCheckInterval: 30000
      }
    );

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

    // =============================
    // AUTHENTICATION ENDPOINTS
    // =============================

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

    this.app.get('/auth/login', (req: Request, res: Response) => {
      try {
        const loginUrl = this.authService.getLoginUrl();
        this.logger.info(`Redirecting to Zerodha login: ${loginUrl}`);
        res.redirect(loginUrl);
      } catch (error) {
        this.logger.error('Failed to get login URL:', error);
        res.status(500).json({ error: 'Failed to get login URL' });
      }
    });

    this.app.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
      try {
        const requestToken = req.query.request_token as string;
        
        if (!requestToken) {
          throw new Error('No request token received');
        }

        await this.authService.generateSession(requestToken);
        
        // After successful authentication, initialize pending strategies
        await StrategyRegistry.initializePendingStrategies();
        
        res.redirect('/');
      } catch (error) {
        this.logger.error('Authentication failed:', error);
        res.status(500).send(`
          <html>
            <body>
              <h1>Authentication Failed</h1>
              <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
              <a href="/auth/login">Try Again</a>
            </body>
          </html>
        `);
      }
    });

    this.app.post('/auth/logout', async (req: Request, res: Response): Promise<void> => {
      try {
        await this.authService.invalidateSession();
        res.json({ success: true, message: 'Logged out successfully' });
      } catch (error) {
        this.logger.error('Logout failed:', error);
        res.status(500).json({ error: 'Logout failed' });
      }
    });

    this.app.get('/auth/session-info', async (req: Request, res: Response): Promise<void> => {
      try {
        const sessionInfo = await this.authService.getSessionInfo();
        res.json(sessionInfo);
      } catch (error) {
        this.logger.error('Failed to get session info:', error);
        res.status(500).json({ error: 'Failed to get session info' });
      }
    });

    // =============================
    // QUOTE MANAGER ENDPOINTS
    // =============================

    this.app.get('/api/quote-manager/stats', async (req: Request, res: Response): Promise<void> => {
      try {
        const stats = this.quoteManager.getStats();
        res.json(stats);
      } catch (error) {
        this.logger.error('Failed to get quote manager stats:', error);
        res.status(500).json({ error: 'Failed to get quote manager stats' });
      }
    });

    // =============================
    // MAIN DASHBOARD
    // =============================

    this.app.get('/', async (req: Request, res: Response) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const isValidAuthentication = await this.authService.isAuthenticatedAndValid();
      const sessionData = this.authService.getSessionData();
      
      // Get active strategies from StrategyRegistry
      const activeStrategies = Array.from(StrategyRegistry.getAllInstances().values());
      const scannerResult = await this.strategyManager.getLastScannerResults();
      // Use enhanced slot states with live position data
      const slotStates = this.strategyManager.getSlotStatesWithPositions();
      
      // Calculate aggregate metrics from SLOT DATA FILES (persisted across restarts)
      // This ensures we capture ALL historical trades, not just current session
      const fs = require('fs');
      const path = require('path');
      const dataDir = path.join(__dirname, 'data');
      
      let aggregateMetrics = {
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalCapital: 195000, // 3 slots × ₹65,000
        currentCapital: 0,
        roi: 0,
        activeSlots: activeStrategies.length,
        // NEW: Performance metrics
        grossProfit: 0,
        grossLoss: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        riskRewardRatio: 0
      };
      
      // Read from all 3 slot data files to get complete trade history
      for (let slotNumber = 1; slotNumber <= 3; slotNumber++) {
        const slotFile = path.join(dataDir, `bollinger-slot${slotNumber}.json`);
        try {
          if (fs.existsSync(slotFile)) {
            const data = JSON.parse(fs.readFileSync(slotFile, 'utf8'));
            
            // Add current capital from this slot
            aggregateMetrics.currentCapital += data.capital || 65000;
            
            // Process all trades from history
            if (data.tradeHistory && Array.isArray(data.tradeHistory)) {
              for (const trade of data.tradeHistory) {
                const pnl = trade.pnl || 0;
                aggregateMetrics.totalPnL += pnl;
                aggregateMetrics.totalTrades++;
                if (pnl > 0) {
                  aggregateMetrics.wins++;
                  aggregateMetrics.grossProfit += pnl;
                } else if (pnl < 0) {
                  aggregateMetrics.losses++;
                  aggregateMetrics.grossLoss += Math.abs(pnl);
                }
              }
            }
          } else {
            // No data file yet, assume initial capital
            aggregateMetrics.currentCapital += 65000;
          }
        } catch (e) {
          // Error reading file, assume initial capital
          aggregateMetrics.currentCapital += 65000;
        }
      }
      
      // Calculate aggregate win rate and ROI
      if (aggregateMetrics.wins + aggregateMetrics.losses > 0) {
        aggregateMetrics.winRate = (aggregateMetrics.wins / (aggregateMetrics.wins + aggregateMetrics.losses)) * 100;
      }
      if (aggregateMetrics.totalCapital > 0) {
        aggregateMetrics.roi = ((aggregateMetrics.currentCapital - aggregateMetrics.totalCapital) / aggregateMetrics.totalCapital) * 100;
      }
      
      // Calculate performance metrics
      if (aggregateMetrics.grossLoss > 0) {
        aggregateMetrics.profitFactor = aggregateMetrics.grossProfit / aggregateMetrics.grossLoss;
      } else if (aggregateMetrics.grossProfit > 0) {
        aggregateMetrics.profitFactor = 999; // Infinite (no losses)
      }
      if (aggregateMetrics.wins > 0) {
        aggregateMetrics.avgWin = aggregateMetrics.grossProfit / aggregateMetrics.wins;
      }
      if (aggregateMetrics.losses > 0) {
        aggregateMetrics.avgLoss = aggregateMetrics.grossLoss / aggregateMetrics.losses;
      }
      if (aggregateMetrics.avgLoss > 0) {
        aggregateMetrics.riskRewardRatio = aggregateMetrics.avgWin / aggregateMetrics.avgLoss;
      }
      
      const htmlResponse = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TMV Scanner - Multi-Strategy Trading Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
            background: #f5f7fa;
            color: #1a202c;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        /* Header */
        .header {
            background: white;
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 24px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            border: 1px solid #e2e8f0;
            border-left: 4px solid #3b82f6;
        }
        
        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .title-section {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .logo {
            font-size: 2.5rem;
        }
        
        h1 {
            font-size: 2rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .subtitle {
            color: #64748b;
            font-size: 0.95rem;
        }
        
        .live-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid #10b981;
            border-radius: 8px;
        }
        
        .live-dot {
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        /* Auth Status */
        .auth-banner {
            padding: 16px 24px;
            border-radius: 12px;
            border-left: 4px solid;
            margin-bottom: 24px;
        }
        
        .auth-banner.success {
            background: rgba(16, 185, 129, 0.1);
            border-color: #10b981;
        }
        
        .auth-banner.error {
            background: rgba(239, 68, 68, 0.1);
            border-color: #ef4444;
        }
        
        .auth-banner.warning {
            background: rgba(245, 158, 11, 0.1);
            border-color: #f59e0b;
        }
        
        .auth-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .auth-info strong {
            color: #1a202c;
            font-weight: 600;
        }
        
        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .stat-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        
        .stat-icon {
            font-size: 1.5rem;
        }
        
        .stat-label {
            color: #64748b;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .stat-subtext {
            color: #64748b;
            font-size: 0.85rem;
        }
        
        /* Slot States Section */
        .slot-states-section {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }
        
        .slot-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
        }
        
        .slot-card {
            padding: 16px;
            background: #f8fafc;
            border-radius: 8px;
            border: 2px solid #e2e8f0;
            position: relative;
        }
        
        .slot-card.locked {
            border-color: #f59e0b;
            background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        }
        
        .slot-card.active {
            border-color: #10b981;
            background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
        }
        
        .slot-card.empty {
            border-color: #cbd5e1;
            background: #f1f5f9;
        }
        
        .slot-number {
            position: absolute;
            top: -10px;
            left: 12px;
            background: #3b82f6;
            color: white;
            padding: 2px 10px;
            border-radius: 10px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .slot-symbol {
            font-size: 1.25rem;
            font-weight: 700;
            color: #1a202c;
            margin-top: 8px;
            margin-bottom: 8px;
        }
        
        .slot-score {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .slot-score-value {
            font-weight: 700;
            color: #059669;
        }
        
        .slot-bias {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
        }
        
        .slot-bias.long {
            background: #d1fae5;
            color: #065f46;
        }
        
        .slot-bias.short {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .slot-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.8rem;
            color: #64748b;
        }
        
        .slot-status-icon {
            font-size: 1rem;
        }
        
        .slot-deployed {
            font-size: 0.75rem;
            color: #94a3b8;
            margin-top: 8px;
        }
        
        /* Scanner Section */
        .scanner-section {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }
        
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1a202c;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .badge.active {
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
        }
        
        .badge.scheduled {
            background: rgba(59, 130, 246, 0.2);
            color: #3b82f6;
        }
        
        .scanner-timeline {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
        }
        
        .timeline-item {
            padding: 16px;
            background: #f8fafc;
            border-radius: 8px;
            border-left: 3px solid;
        }
        
        .timeline-item.completed {
            border-color: #10b981;
        }
        
        .timeline-item.upcoming {
            border-color: #64748b;
        }
        
        .timeline-time {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .timeline-label {
            color: #64748b;
            font-size: 0.85rem;
        }
        
        /* Strategy Cards */
        .strategies-section {
            margin-bottom: 24px;
        }
        
        .strategies-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 16px;
        }
        
        .strategy-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .strategy-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
        }
        
        .strategy-header {
            display: flex;
            justify-content: space-between;
            align-items: start;
            margin-bottom: 16px;
        }
        
        .strategy-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .strategy-subtitle {
            color: #64748b;
            font-size: 0.85rem;
        }
        
        .status-badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .status-badge.running {
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
        }
        
        .status-badge.stopped {
            background: rgba(100, 116, 139, 0.2);
            color: #94a3b8;
        }
        
        .strategy-metrics {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .metric {
            padding: 12px;
            background: #f8fafc;
            border-radius: 8px;
        }
        
        .metric-label {
            color: #64748b;
            font-size: 0.75rem;
            margin-bottom: 4px;
        }
        
        .metric-value {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1a202c;
        }
        
        .metric-value.positive {
            color: #10b981;
        }
        
        .metric-value.negative {
            color: #ef4444;
        }
        
        .strategy-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            flex: 1;
            padding: 10px 16px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            text-align: center;
            display: inline-block;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        
        .btn-secondary {
            background: #f8fafc;
            color: #475569;
            border: 1px solid #e2e8f0;
        }
        
        .btn-secondary:hover {
            background: #f1f5f9;
            color: #334155;
        }
        
        .btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
        }
        
        /* Scanner Results Cards */
        .scanner-results {
            margin: 24px 0;
            padding: 24px;
            background: white;
            border-radius: 12px;
            border: 2px solid #10b981;
        }
        
        .scanner-results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }
        
        .result-card {
            position: relative;
            padding: 20px;
            background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
            border: 2px solid #86efac;
            border-radius: 12px;
            transition: all 0.3s;
        }
        
        .result-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.2);
        }
        
        .rank-badge {
            position: absolute;
            top: -10px;
            right: -10px;
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            color: white;
            font-weight: 700;
            font-size: 1.1rem;
            padding: 8px 16px;
            border-radius: 20px;
            box-shadow: 0 4px 12px rgba(251, 191, 36, 0.4);
        }
        
        .result-symbol {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 8px;
        }
        
        .result-score {
            font-size: 1.1rem;
            font-weight: 600;
            color: #10b981;
            margin-bottom: 8px;
        }
        
        .result-bias {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.875rem;
            margin-bottom: 8px;
        }
        
        .bias-long {
            background: #dcfce7;
            color: #166534;
        }
        
        .bias-short {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .result-sector {
            font-size: 0.875rem;
            color: #6366f1;
            margin-bottom: 8px;
            font-weight: 500;
        }
        
        .result-breakdown {
            font-size: 0.75rem;
            color: #64748b;
            font-family: 'Courier New', monospace;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 24px;
            color: #64748b;
            font-size: 0.85rem;
        }
        
        .refresh-note {
            margin-top: 12px;
            padding: 12px;
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <div class="title-section">
                    <div class="logo">🎯</div>
                    <div>
                        <h1>TMV Market Scanner</h1>
                        <p class="subtitle">Trend + Momentum + Volume Multi-Strategy System</p>
                    </div>
                </div>
                <div class="live-indicator">
                    <div class="live-dot"></div>
                    <span style="color: #10b981; font-weight: 600;">LIVE</span>
                </div>
            </div>
        </div>

        ${isValidAuthentication ? `
        <div class="auth-banner success">
            <div class="auth-content">
                <div class="auth-info">
                    <span style="font-size: 1.2rem; margin-right: 8px;">✅</span>
                    <strong>Authenticated:</strong> ${sessionData?.user_name || 'Unknown'}
                    ${sessionData?.login_time ? ` | Login: ${new Date(sessionData.login_time).toLocaleTimeString()}` : ''}
                </div>
                <a href="/auth/session-info" class="btn btn-secondary" style="flex: 0 0 auto;">Session Info</a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-icon">📊</span>
                    <span class="badge active">Active</span>
                </div>
                <div class="stat-label">Universe Size</div>
                <div class="stat-value">100</div>
                <div class="stat-subtext">NIFTY F&O stocks monitored</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-icon">🎯</span>
                    <span class="badge ${scannerResult ? 'active' : 'scheduled'}">
                        ${scannerResult ? 'Complete' : '09:30 AM'}
                    </span>
                </div>
                <div class="stat-label">Scanner Status</div>
                <div class="stat-value" id="scannerStatus">
                    ${scannerResult ? `${scannerResult.selected.length}/3 Selected` : 'Scheduled'}
                </div>
                <div class="stat-subtext">
                    ${scannerResult 
                        ? `Last scan: ${new Date(scannerResult.scanTime).toLocaleTimeString()}` 
                        : 'Daily market-open execution'}
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-icon">⚡</span>
                    <span class="badge active">Live</span>
                </div>
                <div class="stat-label">Max Concurrent</div>
                <div class="stat-value">3</div>
                <div class="stat-subtext">Top TMV-scored strategies</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-icon">💰</span>
                    <span class="stat-label">Capital Per Trade</span>
                </div>
                <div class="stat-value">₹65,000</div>
                <div class="stat-subtext">Auto-calculated lot sizing</div>
            </div>
        </div>

        <!-- Aggregate P&L Section -->
        <div class="scanner-section" style="border: 2px solid ${aggregateMetrics.totalPnL >= 0 ? '#10b981' : '#ef4444'}; background: ${aggregateMetrics.totalPnL >= 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)'};">
            <div class="section-header" style="border-bottom: 1px solid ${aggregateMetrics.totalPnL >= 0 ? '#10b981' : '#ef4444'};">
                <div class="section-title">
                    <span>💹</span> Aggregate Performance (All Slots)
                </div>
                <div style="display: flex; align-items: center; gap: 16px;">
                    <span style="font-size: 0.9rem; color: #64748b;">
                        ${aggregateMetrics.activeSlots}/3 slots active
                    </span>
                    <a href="/trade-history" class="btn btn-secondary" style="background: #f1f5f9; border: 1px solid #cbd5e1;">📜 View Trade History</a>
                </div>
            </div>
            
            <div class="stats-grid" style="margin-bottom: 0;">
                <div class="stat-card" style="border: 2px solid ${aggregateMetrics.totalPnL >= 0 ? '#10b981' : '#ef4444'};">
                    <div class="stat-header">
                        <span class="stat-icon">${aggregateMetrics.totalPnL >= 0 ? '📈' : '📉'}</span>
                        <span class="badge ${aggregateMetrics.totalPnL >= 0 ? 'active' : ''}" style="${aggregateMetrics.totalPnL < 0 ? 'background: rgba(239, 68, 68, 0.2); color: #ef4444;' : ''}">
                            ${aggregateMetrics.totalPnL >= 0 ? 'Profit' : 'Loss'}
                        </span>
                    </div>
                    <div class="stat-label">Total P&L</div>
                    <div class="stat-value" style="color: ${aggregateMetrics.totalPnL >= 0 ? '#10b981' : '#ef4444'};">
                        ₹${aggregateMetrics.totalPnL >= 0 ? '+' : ''}${aggregateMetrics.totalPnL.toFixed(2)}
                    </div>
                    <div class="stat-subtext">Combined across all slots</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-icon">📊</span>
                        <span class="stat-label">Trades</span>
                    </div>
                    <div class="stat-label">Total Trades</div>
                    <div class="stat-value">${aggregateMetrics.totalTrades}</div>
                    <div class="stat-subtext">${aggregateMetrics.wins}W / ${aggregateMetrics.losses}L</div>
                </div>
                
                <div class="stat-card" style="border: 2px solid ${aggregateMetrics.winRate >= 50 ? '#10b981' : '#f59e0b'};">
                    <div class="stat-header">
                        <span class="stat-icon">🎯</span>
                        <span class="badge ${aggregateMetrics.winRate >= 50 ? 'active' : ''}" style="${aggregateMetrics.winRate < 50 ? 'background: rgba(245, 158, 11, 0.2); color: #f59e0b;' : ''}">
                            ${aggregateMetrics.winRate >= 50 ? 'Good' : 'Needs Work'}
                        </span>
                    </div>
                    <div class="stat-label">Win Rate</div>
                    <div class="stat-value" style="color: ${aggregateMetrics.winRate >= 50 ? '#10b981' : '#f59e0b'};">
                        ${aggregateMetrics.winRate.toFixed(1)}%
                    </div>
                    <div class="stat-subtext">Target: 50%+</div>
                </div>
                
                <div class="stat-card" style="border: 2px solid ${aggregateMetrics.roi >= 0 ? '#10b981' : '#ef4444'};">
                    <div class="stat-header">
                        <span class="stat-icon">💵</span>
                        <span class="stat-label">ROI</span>
                    </div>
                    <div class="stat-label">Return on Investment</div>
                    <div class="stat-value" style="color: ${aggregateMetrics.roi >= 0 ? '#10b981' : '#ef4444'};">
                        ${aggregateMetrics.roi >= 0 ? '+' : ''}${aggregateMetrics.roi.toFixed(2)}%
                    </div>
                    <div class="stat-subtext">On ₹${aggregateMetrics.totalCapital.toLocaleString()} deployed</div>
                </div>
                
                <div class="stat-card" style="border: 2px solid ${aggregateMetrics.profitFactor >= 1.5 ? '#10b981' : aggregateMetrics.profitFactor >= 1 ? '#f59e0b' : '#ef4444'};">
                    <div class="stat-header">
                        <span class="stat-icon">⚖️</span>
                        <span class="badge" style="background: ${aggregateMetrics.profitFactor >= 1.5 ? 'rgba(16, 185, 129, 0.2)' : aggregateMetrics.profitFactor >= 1 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${aggregateMetrics.profitFactor >= 1.5 ? '#10b981' : aggregateMetrics.profitFactor >= 1 ? '#f59e0b' : '#ef4444'};">
                            ${aggregateMetrics.profitFactor >= 1.5 ? 'Excellent' : aggregateMetrics.profitFactor >= 1 ? 'Break-even' : 'Losing'}
                        </span>
                    </div>
                    <div class="stat-label">Profit Factor</div>
                    <div class="stat-value" style="color: ${aggregateMetrics.profitFactor >= 1.5 ? '#10b981' : aggregateMetrics.profitFactor >= 1 ? '#f59e0b' : '#ef4444'};">
                        ${aggregateMetrics.profitFactor >= 999 ? '∞' : aggregateMetrics.profitFactor.toFixed(2)}
                    </div>
                    <div class="stat-subtext">Gross Profit / Gross Loss (Target: 1.5+)</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-icon">📈</span>
                        <span class="stat-label">Avg Win</span>
                    </div>
                    <div class="stat-label">Average Win</div>
                    <div class="stat-value" style="color: #10b981;">
                        ₹${aggregateMetrics.avgWin.toFixed(0)}
                    </div>
                    <div class="stat-subtext">From ${aggregateMetrics.wins} winning trades</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-header">
                        <span class="stat-icon">📉</span>
                        <span class="stat-label">Avg Loss</span>
                    </div>
                    <div class="stat-label">Average Loss</div>
                    <div class="stat-value" style="color: #ef4444;">
                        ₹${aggregateMetrics.avgLoss.toFixed(0)}
                    </div>
                    <div class="stat-subtext">From ${aggregateMetrics.losses} losing trades</div>
                </div>
                
                <div class="stat-card" style="border: 2px solid ${aggregateMetrics.riskRewardRatio >= 1.5 ? '#10b981' : aggregateMetrics.riskRewardRatio >= 1 ? '#f59e0b' : '#ef4444'};">
                    <div class="stat-header">
                        <span class="stat-icon">🎰</span>
                        <span class="badge" style="background: ${aggregateMetrics.riskRewardRatio >= 1.5 ? 'rgba(16, 185, 129, 0.2)' : aggregateMetrics.riskRewardRatio >= 1 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${aggregateMetrics.riskRewardRatio >= 1.5 ? '#10b981' : aggregateMetrics.riskRewardRatio >= 1 ? '#f59e0b' : '#ef4444'};">
                            ${aggregateMetrics.riskRewardRatio >= 1.5 ? 'Good' : aggregateMetrics.riskRewardRatio >= 1 ? 'Fair' : 'Poor'}
                        </span>
                    </div>
                    <div class="stat-label">Risk:Reward</div>
                    <div class="stat-value" style="color: ${aggregateMetrics.riskRewardRatio >= 1.5 ? '#10b981' : aggregateMetrics.riskRewardRatio >= 1 ? '#f59e0b' : '#ef4444'};">
                        1:${aggregateMetrics.riskRewardRatio.toFixed(2)}
                    </div>
                    <div class="stat-subtext">Avg Win / Avg Loss (Target: 1:1.5+)</div>
                </div>
            </div>
        </div>

        <div class="scanner-section">
            <div class="section-header">
                <div class="section-title">
                    <span>🔄</span> Smart Retention Scanner
                    <span style="font-size: 0.75rem; font-weight: 400; color: #64748b; margin-left: 8px;">
                        Keep≥6.0 | Deploy≥7.0 | Scans: XX:35
                    </span>
                </div>
                <div class="scanner-actions">
                    <button onclick="runScanner()" class="btn btn-primary">🔍 Run Scanner Now</button>
                    <a href="/scanner-results" class="btn btn-secondary">📊 View Detailed Results</a>
                </div>
            </div>
            
            ${scannerResult && scannerResult.selected.length > 0 ? `
            <div class="scanner-results" style="background: linear-gradient(135deg, #fefce8 0%, #ffffff 100%); border-color: #eab308;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="color: #1a202c; margin: 0;">🔍 Scanner Candidates (Top 3 by Score)</h3>
                    <span style="font-size: 0.8rem; color: #64748b; background: #f1f5f9; padding: 4px 12px; border-radius: 12px;">
                        ⚡ Smart Retention decides if these replace existing slots
                    </span>
                </div>
                <div class="scanner-results-grid">
                    ${scannerResult.selected.map((stock: any, index: number) => {
                        // Check if this candidate is deployed in any slot
                        const deployedSlot = slotStates.find((s: any) => s.symbol === stock.symbol);
                        const isDeployed = !!deployedSlot;
                        const deployedSlotNum = deployedSlot ? deployedSlot.slotNumber + 1 : null;
                        
                        return `
                    <div class="result-card" style="border-color: ${isDeployed ? '#10b981' : '#fbbf24'}; background: ${isDeployed ? 'linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%)' : 'linear-gradient(135deg, #fffbeb 0%, #ffffff 100%)'};">
                        <div class="rank-badge">#${index + 1}</div>
                        <div class="result-symbol">${stock.symbol}</div>
                        <div class="result-score">Score: ${stock.score.toFixed(1)} <span style="color: #94a3b8; font-size: 0.75rem;">(Base:${stock.baseScore?.toFixed(1) || '?'}+Tac:${stock.tacticalBonus?.total?.toFixed(1) || '0'})</span></div>
                        <div class="result-bias ${stock.bias === 'LONG' ? 'bias-long' : 'bias-short'}">${stock.bias}</div>
                        <div class="result-sector">${stock.sector}</div>
                        <div class="result-breakdown">
                            T:${stock.breakdown.trend.toFixed(1)} | 
                            M:${stock.breakdown.momentum.toFixed(1)} | 
                            V:${stock.breakdown.volume.toFixed(1)} | 
                            S:${stock.breakdown.sector.toFixed(1)}
                        </div>
                        ${stock.tacticalBonus && stock.tacticalBonus.total > 0 ? `
                        <div style="font-size: 0.7rem; color: #7c3aed; margin-top: 4px; font-family: monospace;">
                            ⚡ FB:${stock.tacticalBonus.freshBreakout} RV:${stock.tacticalBonus.rvolSurge} PX:${stock.tacticalBonus.proximity} RA:${stock.tacticalBonus.rsiAccel} SQ:${stock.tacticalBonus.squeeze?.toFixed(1) || 0} GW:${stock.tacticalBonus.gammaWall || 0}${stock.tacticalBonus.runwayTier ? `[${stock.tacticalBonus.runwayTier.slice(0,3)}]` : ''}
                        </div>
                        ` : ''}
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0; font-size: 0.8rem; font-weight: 600; color: ${isDeployed ? '#059669' : '#d97706'};">
                            ${isDeployed ? `✅ Deployed → Slot #${deployedSlotNum}` : '⏸️ Not deployed (existing slots retained)'}
                        </div>
                    </div>
                        `;
                    }).join('')}
                </div>
            </div>
            ` : ''}
            
            <div class="scanner-timeline">
                <div class="timeline-item upcoming">
                    <div class="timeline-time">09:23 AM</div>
                    <div class="timeline-label">First scan + deployment (initial)</div>
                </div>
                <div class="timeline-item upcoming">
                    <div class="timeline-time">09:28 - 14:58</div>
                    <div class="timeline-label">5-Min Smart Retention scans</div>
                </div>
                <div class="timeline-item upcoming">
                    <div class="timeline-time">15:30 PM</div>
                    <div class="timeline-label">EOD cleanup + data persistence</div>
                </div>
            </div>
        </div>

        <!-- Smart Retention Slot States -->
        <div class="slot-states-section">
            <div class="section-header">
                <div class="section-title">
                    <span>🎰</span> Deployed Strategies - Slot States
                </div>
                <div style="font-size: 0.85rem; color: #64748b;">
                    🔒 LOCK = Position Open | 🛡️ KEEP = Score OK | ♻️ SWAP = Replaced | 🚀 DEPLOY = New
                </div>
            </div>
            
            <div class="slot-grid">
                ${slotStates.map((slot: any, idx: number) => {
                    const hasPosition = slot.hasActivePosition || slot.locked;
                    const slotClass = hasPosition ? 'locked' : (slot.symbol ? 'active' : 'empty');
                    const posInfo = slot.positionInfo;
                    
                    // Determine border color based on position P&L
                    let borderColor = '#e2e8f0';
                    let bgGradient = '#f8fafc';
                    if (hasPosition && posInfo) {
                        borderColor = posInfo.unrealizedPnL >= 0 ? '#10b981' : '#ef4444';
                        bgGradient = posInfo.unrealizedPnL >= 0 
                            ? 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)'
                            : 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
                    } else if (slot.symbol) {
                        borderColor = '#3b82f6';
                        bgGradient = 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)';
                    }
                    
                    // Retention decision icons
                    const decisionIcons: any = { 'LOCK': '🔒', 'KEEP': '🛡️', 'SWAP': '♻️', 'DEPLOY': '🚀' };
                    const decisionIcon = slot.lastRetentionDecision ? decisionIcons[slot.lastRetentionDecision] || '❓' : '';
                    
                    return `
                    <div class="slot-card ${slotClass}" style="border: 2px solid ${borderColor}; background: ${bgGradient};">
                        <div class="slot-number">Slot #${slot.slotNumber + 1}</div>
                        <div class="slot-symbol">${slot.symbol || '—'}</div>
                        ${slot.symbol ? `
                        <div class="slot-score">
                            <span class="slot-score-value">${slot.lastScanScore !== null ? slot.lastScanScore.toFixed(1) : '—'}</span>
                            <span class="slot-bias ${slot.lastScanBias?.toLowerCase() || ''}">${slot.lastScanBias || '—'}</span>
                        </div>
                        
                        ${hasPosition && posInfo ? `
                        <!-- POSITION INFO BOX -->
                        <div style="margin: 10px 0; padding: 10px; background: ${posInfo.unrealizedPnL >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; border-radius: 8px; border: 1px solid ${posInfo.unrealizedPnL >= 0 ? '#10b981' : '#ef4444'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="font-weight: 700; color: ${posInfo.type === 'LONG' ? '#059669' : '#dc2626'};">
                                    ${posInfo.type === 'LONG' ? '📈 LONG' : '📉 SHORT'}
                                </span>
                                <span style="font-size: 0.75rem; color: #64748b;">🔒 Position Open</span>
                            </div>
                            <div style="font-size: 0.8rem; color: #374151; margin-bottom: 4px; font-family: monospace;">
                                ${posInfo.tradingSymbol}
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 0.75rem;">
                                <div>Entry: ₹${posInfo.entryPrice.toFixed(2)}</div>
                                <div>Now: ₹${posInfo.currentPrice.toFixed(2)}</div>
                            </div>
                            <div style="margin-top: 6px; font-size: 1rem; font-weight: 700; color: ${posInfo.unrealizedPnL >= 0 ? '#059669' : '#dc2626'};">
                                P&L: ${posInfo.unrealizedPnL >= 0 ? '+' : ''}₹${posInfo.unrealizedPnL.toFixed(0)} (${posInfo.profitPercent >= 0 ? '+' : ''}${posInfo.profitPercent.toFixed(1)}%)
                            </div>
                            ${posInfo.trailingSL ? `
                            <div style="margin-top: 4px; font-size: 0.7rem; color: #6b7280;">
                                🛡️ Trailing SL: ₹${posInfo.trailingSL.toFixed(2)}
                            </div>
                            ` : ''}
                        </div>
                        ` : `
                        <!-- NO POSITION - MONITORING -->
                        <div class="slot-status">
                            <span class="slot-status-icon">🔍</span>
                            <span>Monitoring for signals</span>
                        </div>
                        `}
                        
                        ${slot.lastRetentionDecision ? `
                        <div style="margin-top: 8px; padding: 6px 8px; background: rgba(0,0,0,0.05); border-radius: 6px; font-size: 0.7rem; color: #475569;">
                            <span style="font-weight: 600;">${decisionIcon} ${slot.lastRetentionDecision}:</span> ${slot.lastRetentionReason || ''}
                        </div>
                        ` : ''}
                        
                        <div class="slot-deployed" style="margin-top: 6px;">
                            Deployed: ${slot.deployedAt ? new Date(slot.deployedAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '—'}
                        </div>
                        ` : `
                        <div class="slot-status">
                            <span class="slot-status-icon">⏳</span>
                            <span>Awaiting deployment</span>
                        </div>
                        `}
                    </div>
                    `;
                }).join('')}
            </div>
        </div>

        <div class="strategies-section">
            <div class="section-header">
                <div class="section-title">
                    <span>📈</span> Active Strategies ${activeStrategies.length > 0 ? `(${activeStrategies.length})` : ''}
                </div>
                <div>
                    <a href="/strategies" class="btn btn-primary" style="flex: 0 0 auto;">View All Strategies</a>
                </div>
            </div>
            
            <div class="strategies-grid">
                ${activeStrategies.length > 0 ? activeStrategies.map((strategy: any) => {
                    // Get position info properly using getStatus()
                    let posStatus = null;
                    try {
                        const status = strategy.getStatus();
                        posStatus = status?.positionInfo || null;
                    } catch (e) {}
                    
                    const strategySymbol = strategy.config?.instruments?.[0] || strategy.config?.symbol || 'Unknown';
                    
                    return `
                <div class="strategy-card" style="border: 2px solid ${posStatus ? (posStatus.unrealizedPnL >= 0 ? '#10b981' : '#ef4444') : '#3b82f6'}; background: white;">
                    <div class="strategy-header">
                        <div>
                            <div class="strategy-title">🎯 ${strategySymbol}</div>
                            <div class="strategy-subtitle">${strategy.config?.name || strategy.config?.id || 'Strategy'}</div>
                        </div>
                        <span class="status-badge ${posStatus ? 'running' : 'active'}" style="${posStatus ? 'background: rgba(16, 185, 129, 0.2); color: #059669;' : ''}">
                            ${posStatus ? '🔒 In Position' : 'Monitoring'}
                        </span>
                    </div>
                    <div class="strategy-metrics">
                        <div class="metric">
                            <div class="metric-label">Status</div>
                            <div class="metric-value">${posStatus ? '📊 ' + posStatus.type : '🔍 Scanning'}</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Capital</div>
                            <div class="metric-value">₹${(strategy.config?.config?.capitalAllocation || strategy.config?.capital || 65000).toLocaleString()}</div>
                        </div>
                    </div>
                    <div class="strategy-actions">
                        <a href="/strategy/${strategy.config?.id}" class="btn btn-secondary">View Details</a>
                    </div>
                </div>
                    `;
                }).join('') : `
                <div class="strategy-card" style="border: 2px solid #64748b; background: #f8fafc;">
                    <div class="strategy-header">
                        <div>
                            <div class="strategy-title">🤖 No Active Strategies</div>
                            <div class="strategy-subtitle">Waiting for scanner deployment</div>
                        </div>
                        <span class="status-badge scheduled">Awaiting Scan</span>
                    </div>
                    <div class="strategy-metrics">
                        <div class="metric">
                            <div class="metric-label">Strategy Count</div>
                            <div class="metric-value">0 / 3</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Next Scan</div>
                            <div class="metric-value">Every 5min</div>
                        </div>
                    </div>
                </div>
                `}
            </div>
        </div>

        <div class="refresh-note" style="margin-top: 20px;">
            <strong>📡 Real-time Updates:</strong> Slot position data updates every page refresh. 
            Use <a href="/strategies" style="color: #3b82f6; text-decoration: underline;">View All Strategies</a> 
            for detailed live metrics.
        </div>
        ` : `
        <div class="auth-banner ${isAuthenticated ? 'warning' : 'error'}">
            <div class="auth-content">
                <div class="auth-info">
                    <span style="font-size: 1.2rem; margin-right: 8px;">${isAuthenticated ? '⚠️' : '❌'}</span>
                    <strong>${isAuthenticated ? 'Session Expired' : 'Not Authenticated'}</strong>
                    <p style="margin-top: 4px; color: #94a3b8;">
                        ${isAuthenticated 
                          ? 'Your session token is invalid or expired. Please re-authenticate with Zerodha.' 
                          : 'Authentication required to access trading system. Click login to authenticate with Zerodha.'}
                    </p>
                </div>
                <a href="/auth/login" class="btn btn-success" style="flex: 0 0 auto;">
                    🔐 Login with Zerodha
                </a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-icon">🔒</span>
                </div>
                <div class="stat-label">Authentication</div>
                <div class="stat-value" style="font-size: 1.5rem;">Required</div>
                <div class="stat-subtext">Login to activate scanner</div>
            </div>
        </div>
        `}

        <div class="footer">
            <p><strong>🤖 TMV Market Scanner</strong> | Powered by Node.js + TypeScript + KiteConnect</p>
            <p style="margin-top: 8px;">100-Stock Universe • Bollinger Band Strategy • 5-Min Smart Retention Scans</p>
        </div>
    </div>
    <script>
        async function runScanner() {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = '⏳ Running Scanner...';
            
            try {
                const response = await fetch('/api/scanner/run', { method: 'POST' });
                if (response.ok) {
                    window.location.href = '/scanner-results';
                } else {
                    const data = await response.json();
                    alert('Scanner Error: ' + (data.message || 'Failed to run scanner'));
                    btn.disabled = false;
                    btn.textContent = '🔍 Run Scanner Now';
                }
            } catch (error) {
                alert('Network Error: ' + error.message);
                btn.disabled = false;
                btn.textContent = '🔍 Run Scanner Now';
            }
        }
        
        // Auto-refresh every 30 seconds
        setTimeout(() => window.location.reload(), 30000);
    </script>
</body>
</html>
      `;
      
      res.send(htmlResponse);
    });

    // =============================
    // SCANNER ENDPOINTS
    // =============================

    this.app.post('/api/scanner/run', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        // Check for force parameter (query string or body)
        const force = req.query.force === 'true' || req.body?.force === true;
        this.logger.info(`🔍 Manual scanner triggered via API${force ? ' (FORCED)' : ''}`);
        const result = await this.strategyManager.runManualScanner(force);
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          result
        });
      } catch (error) {
        this.logger.error('Manual scanner failed:', error);
        res.status(500).json({ 
          error: 'Scanner failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.app.get('/api/scanner/results', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const results = await this.strategyManager.getLastScannerResults();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          results
        });
      } catch (error) {
        this.logger.error('Failed to get scanner results:', error);
        res.status(500).json({ error: 'Failed to get scanner results' });
      }
    });

    // Slot States API endpoint
    this.app.get('/api/slots', (req: Request, res: Response): void => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const slotStates = this.strategyManager.getSlotStatesWithPositions();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          slots: slotStates.map(slot => ({
            slotNumber: slot.slotNumber,
            symbol: slot.symbol,
            strategyId: slot.strategyId,
            deployedAt: slot.deployedAt,
            lastScanScore: slot.lastScanScore,
            lastScanBias: slot.lastScanBias,
            locked: slot.locked,
            lastRetentionDecision: slot.lastRetentionDecision,
            lastRetentionReason: slot.lastRetentionReason,
            hasActivePosition: slot.hasActivePosition,
            positionInfo: slot.positionInfo,
            status: slot.hasActivePosition ? 'IN_POSITION' : (slot.locked ? 'LOCKED' : (slot.symbol ? 'MONITORING' : 'EMPTY'))
          }))
        });
      } catch (error) {
        this.logger.error('Failed to get slot states:', error);
        res.status(500).json({ error: 'Failed to get slot states' });
      }
    });

    // OI History API endpoints
    this.app.get('/api/oi-history', (req: Request, res: Response): void => {
      try {
        const oiService = this.strategyManager.getOIHistoryService();
        
        if (!oiService) {
          res.status(503).json({ 
            error: 'OI History Service not initialized',
            message: 'Service will be available after authentication'
          });
          return;
        }

        const history = oiService.getHistoryData();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          history
        });
      } catch (error) {
        this.logger.error('Failed to get OI history:', error);
        res.status(500).json({ error: 'Failed to get OI history' });
      }
    });

    this.app.get('/api/oi-analysis', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const oiService = this.strategyManager.getOIHistoryService();
        
        if (!oiService) {
          res.status(503).json({ 
            error: 'OI History Service not initialized',
            message: 'Service will be available after authentication'
          });
          return;
        }

        const analysis = await oiService.getFullAnalysis();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          analysis
        });
      } catch (error) {
        this.logger.error('Failed to get OI analysis:', error);
        res.status(500).json({ error: 'Failed to get OI analysis' });
      }
    });

    this.app.post('/api/oi-save-now', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.authService.isAuthenticated()) {
          res.status(401).json({ 
            error: 'Not authenticated', 
            message: 'Please visit /auth/login to authenticate first' 
          });
          return;
        }

        const result = await this.strategyManager.triggerEODOISave();
        
        res.json({
          success: result.success,
          timestamp: new Date().toISOString(),
          stocksSaved: result.count,
          errors: result.errors
        });
      } catch (error) {
        this.logger.error('Failed to trigger EOD OI save:', error);
        res.status(500).json({ error: 'Failed to trigger EOD OI save' });
      }
    });

    this.app.get('/scanner-results', async (req: Request, res: Response) => {
      try {
        const results = await this.strategyManager.getLastScannerResults();
        const slotStates = this.strategyManager.getSlotStatesWithPositions();
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scanner Results - TMV Market Scanner</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: #f5f7fa;
            padding: 20px;
        }
        
        .container { max-width: 1200px; margin: 0 auto; }
        
        .header {
            background: white;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        h1 { color: #1a202c; margin-bottom: 8px; }
        .timestamp { color: #718096; font-size: 0.9rem; }
        
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .summary-label { color: #718096; font-size: 0.85rem; margin-bottom: 8px; }
        .summary-value { font-size: 1.8rem; font-weight: 700; color: #2d3748; }
        
        .stocks-table {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        table { width: 100%; border-collapse: collapse; }
        th { background: #f7fafc; padding: 12px; text-align: left; color: #4a5568; font-weight: 600; }
        td { padding: 12px; border-top: 1px solid #e2e8f0; }
        
        .score { font-weight: 700; font-size: 1.1rem; }
        .score.high { color: #10b981; }
        .score.medium { color: #f59e0b; }
        .score.low { color: #ef4444; }
        
        .badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .badge.long { background: #d1fae5; color: #065f46; }
        .badge.short { background: #fee2e2; color: #991b1b; }
        
        .breakdown { font-size: 0.85rem; color: #718096; }
        
        .back-btn {
            display: inline-block;
            padding: 10px 20px;
            background: #3b82f6;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-btn">← Back to Dashboard</a>
        
        <div class="header">
            <h1>🎯 Scanner Results</h1>
            <p class="timestamp">Last scan: ${results?.scanTime ? new Date(results.scanTime).toLocaleString() : 'Never'}</p>
        </div>
        
        ${results ? `
        <div class="summary">
            <div class="summary-card">
                <div class="summary-label">Scanned</div>
                <div class="summary-value">${results.scannedCount}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">Qualified</div>
                <div class="summary-value">${results.qualifiedCount}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">Selected</div>
                <div class="summary-value">${results.selected.length}/3</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">Green Sectors</div>
                <div class="summary-value">${results.greenSectors.length}</div>
            </div>
        </div>
        
        <!-- Current Slot States -->
        <div class="header" style="margin-bottom: 20px;">
            <h2 style="margin-bottom: 16px;">🎰 Current Slot States</h2>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                ${slotStates.map((slot: any) => `
                <div style="padding: 16px; background: ${slot.locked ? '#fffbeb' : slot.symbol ? '#ecfdf5' : '#f1f5f9'}; 
                            border: 2px solid ${slot.locked ? '#f59e0b' : slot.symbol ? '#10b981' : '#cbd5e1'}; 
                            border-radius: 8px;">
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px;">Slot #${slot.slotNumber + 1}</div>
                    <div style="font-size: 1.1rem; font-weight: 700;">${slot.symbol || '— Empty —'}</div>
                    ${slot.symbol ? `
                    <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                        <span style="font-weight: 600; color: #059669;">${slot.lastScanScore !== null ? slot.lastScanScore.toFixed(1) : '—'}</span>
                        <span style="padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;
                                     background: ${slot.lastScanBias === 'LONG' ? '#d1fae5' : '#fee2e2'};
                                     color: ${slot.lastScanBias === 'LONG' ? '#065f46' : '#991b1b'};">
                            ${slot.lastScanBias || '—'}
                        </span>
                        ${slot.locked ? '<span style="font-size: 1rem;">🔒</span>' : ''}
                    </div>
                    ` : ''}
                </div>
                `).join('')}
            </div>
        </div>
        
        <div class="stocks-table">
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Symbol</th>
                        <th>Score</th>
                        <th>Bias</th>
                        <th>Smart $</th>
                        <th>Sector</th>
                        <th>Breakdown</th>
                        <th>Spot Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.allScored?.sort((a: any, b: any) => b.score - a.score).map((stock: any, idx: number) => `
                    <tr>
                        <td><strong>${idx + 1}</strong></td>
                        <td><strong>${stock.symbol}</strong></td>
                        <td><span class="score ${stock.score >= 12 ? 'high' : stock.score >= 9 ? 'medium' : 'low'}">${stock.score.toFixed(2)}</span></td>
                        <td><span class="badge ${stock.bias.toLowerCase()}">${stock.bias}</span></td>
                        <td style="text-align: center;">
                            ${stock.smartMoneySignal === 'ACCUMULATION' ? '<span title="Coiled Spring: Accumulation (OI↑ Price→)" style="font-size: 1.2rem;">💎🟢</span>' :
                              stock.smartMoneySignal === 'SHORT_COVERING' ? '<span title="Short Covering (OI↓ Price→↑)" style="font-size: 1.2rem;">💎🔵</span>' :
                              stock.smartMoneySignal === 'DISTRIBUTION' ? '<span title="Coiled Spring: Distribution (OI↑ Price→)" style="font-size: 1.2rem;">💎🔴</span>' :
                              stock.smartMoneySignal === 'LONG_UNWINDING' ? '<span title="Long Unwinding (OI↓ Price→↓)" style="font-size: 1.2rem;">💎🟠</span>' :
                              stock.smartMoneySignal === 'CONFLICT' ? '<span title="Smart Money Conflict" style="font-size: 1.2rem;">⚠️</span>' :
                              stock.smartMoneySignal === 'EXPIRY_WEEK' ? '<span title="Expiry Week - Skipped" style="font-size: 0.9rem;">📅</span>' :
                              '<span title="No Signal" style="color: #9ca3af;">—</span>'}
                        </td>
                        <td>${stock.sector}</td>
                        <td class="breakdown">
                            T:${stock.breakdown.trend.toFixed(1)} 
                            M:${stock.breakdown.momentum.toFixed(1)} 
                            V:${stock.breakdown.volume.toFixed(1)} 
                            S:${stock.breakdown.sector.toFixed(1)}
                            ${stock.breakdown.smartMoney > 0 ? '<span style="color: #10b981; font-weight: 600;"> 💎:+' + stock.breakdown.smartMoney.toFixed(1) + '</span>' : ''}
                            ${stock.tacticalBonus && stock.tacticalBonus.total > 0 ? '<br/><span style="color: #7c3aed; font-size: 0.8rem;">⚡' + stock.tacticalBonus.total.toFixed(1) + '</span>' : ''}
                        </td>
                        <td>₹${stock.spotPrice.toFixed(2)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : `
        <div class="summary-card" style="text-align: center; padding: 40px;">
            <p style="font-size: 1.2rem; color: #718096;">No scanner results available. Run the scanner to see results.</p>
        </div>
        `}
    </div>
</body>
</html>
        `;
        
        res.send(html);
      } catch (error) {
        this.logger.error('Failed to render scanner results:', error);
        res.status(500).send('Failed to load scanner results');
      }
    });

    // =============================
    // TRADE HISTORY PAGE
    // =============================
    
    this.app.get('/trade-history', async (req: Request, res: Response) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(__dirname, 'data');
        
        // Collect trade history from all slots
        const allTrades: any[] = [];
        
        for (let slotNumber = 1; slotNumber <= 3; slotNumber++) {
          const slotFile = path.join(dataDir, `bollinger-slot${slotNumber}.json`);
          try {
            if (fs.existsSync(slotFile)) {
              const data = JSON.parse(fs.readFileSync(slotFile, 'utf8'));
              if (data.tradeHistory && Array.isArray(data.tradeHistory)) {
                // Add slot number to each trade
                data.tradeHistory.forEach((trade: any) => {
                  allTrades.push({ ...trade, slotNumber });
                });
              }
            }
          } catch (e) {
            this.logger.warn(`Failed to read slot ${slotNumber} data: ${e}`);
          }
        }
        
        // Sort by exit time (most recent first)
        allTrades.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());
        
        // Calculate totals
        const totalPnL = allTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const wins = allTrades.filter(t => (t.pnl || 0) > 0).length;
        const losses = allTrades.filter(t => (t.pnl || 0) < 0).length;
        const winRate = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0;
        
        // Build trade rows HTML
        const tradeRowsHtml = allTrades.map(trade => {
          const pnl = trade.pnl || 0;
          const isProfitable = pnl > 0;
          const tradingsymbol = trade.instrument?.tradingsymbol || '—';
          const underlying = trade.instrument?.name || tradingsymbol.match(/^([A-Z]+)/)?.[1] || '—';
          
          const entryTimeStr = trade.entryTime ? new Date(trade.entryTime).toLocaleString('en-IN', { 
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }) : '—';
          
          const exitTimeStr = trade.exitTime ? new Date(trade.exitTime).toLocaleString('en-IN', { 
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }) : '—';
          
          // Calculate duration
          let durationStr = '—';
          if (trade.entryTime && trade.exitTime) {
            const entryDate = new Date(trade.entryTime);
            const exitDate = new Date(trade.exitTime);
            const durationMs = exitDate.getTime() - entryDate.getTime();
            const durationMinutes = Math.floor(durationMs / 60000);
            const hours = Math.floor(durationMinutes / 60);
            const minutes = durationMinutes % 60;
            if (hours > 0) {
              durationStr = `${hours}h ${minutes}m`;
            } else {
              durationStr = `${minutes}m`;
            }
          }
          
          return `
            <tr>
              <td><span class="slot-badge">Slot ${trade.slotNumber}</span></td>
              <td>
                <div class="symbol-cell">${tradingsymbol}</div>
                <div class="symbol-underlying">${underlying}</div>
              </td>
              <td>
                <span class="direction-badge ${trade.direction === 'LONG' ? 'long' : 'short'}">
                  ${trade.direction || '—'}
                </span>
              </td>
              <td>₹${trade.entryPrice?.toFixed(2) || '—'}</td>
              <td>₹${trade.exitPrice?.toFixed(2) || '—'}</td>
              <td>${trade.quantity || '—'}</td>
              <td class="pnl-cell ${isProfitable ? 'profit' : 'loss'}">
                ${isProfitable ? '+' : ''}₹${pnl.toFixed(2)}
              </td>
              <td class="exit-reason">${(trade.exitReason || '—').replace(/_/g, ' ')}</td>
              <td class="date-cell">${entryTimeStr}</td>
              <td class="date-cell">${exitTimeStr}</td>
              <td class="duration-cell">${durationStr}</td>
            </tr>
          `;
        }).join('');
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trade History - TMV Market Scanner</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: #f5f7fa;
            padding: 20px;
            min-height: 100vh;
        }
        
        .container { max-width: 1400px; margin: 0 auto; }
        
        .back-btn {
            display: inline-block;
            padding: 10px 20px;
            background: #3b82f6;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        
        .back-btn:hover { background: #2563eb; }
        
        .header {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-left: 4px solid #3b82f6;
        }
        
        h1 { color: #1a202c; margin-bottom: 8px; }
        .subtitle { color: #64748b; font-size: 0.9rem; }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .summary-card.profit { border: 2px solid #10b981; background: rgba(16, 185, 129, 0.05); }
        .summary-card.loss { border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.05); }
        
        .summary-label { color: #64748b; font-size: 0.85rem; margin-bottom: 8px; }
        .summary-value { font-size: 2rem; font-weight: 700; color: #1a202c; }
        .summary-value.profit { color: #10b981; }
        .summary-value.loss { color: #ef4444; }
        
        .trades-section {
            background: white;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .section-header {
            padding: 16px 24px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            font-weight: 600;
            color: #1a202c;
        }
        
        .trades-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .trades-table th {
            padding: 12px 16px;
            text-align: left;
            background: #f8fafc;
            color: #64748b;
            font-weight: 600;
            font-size: 0.85rem;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .trades-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #f1f5f9;
            vertical-align: middle;
        }
        
        .trades-table tr:hover { background: #f8fafc; }
        
        .symbol-cell {
            font-weight: 600;
            color: #1a202c;
        }
        
        .symbol-underlying {
            font-size: 0.75rem;
            color: #64748b;
            margin-top: 2px;
        }
        
        .direction-badge {
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .direction-badge.long { background: #d1fae5; color: #065f46; }
        .direction-badge.short { background: #fee2e2; color: #991b1b; }
        
        .pnl-cell { font-weight: 700; font-size: 1rem; }
        .pnl-cell.profit { color: #10b981; }
        .pnl-cell.loss { color: #ef4444; }
        
        .slot-badge {
            display: inline-block;
            padding: 2px 8px;
            background: #e2e8f0;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            color: #64748b;
        }
        
        .exit-reason {
            font-size: 0.8rem;
            color: #64748b;
            max-width: 200px;
        }
        
        .date-cell {
            font-size: 0.85rem;
            color: #64748b;
        }
        
        .duration-cell {
            font-size: 0.85rem;
            color: #3b82f6;
            font-weight: 500;
        }
        
        .empty-state {
            padding: 60px 20px;
            text-align: center;
            color: #64748b;
        }
        
        .empty-state-icon { font-size: 3rem; margin-bottom: 16px; }
        .empty-state-text { font-size: 1.1rem; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-btn">← Back to Dashboard</a>
        
        <div class="header">
            <h1>📜 Trade History</h1>
            <p class="subtitle">Complete record of all closed trades across all slots</p>
        </div>
        
        <div class="summary-grid">
            <div class="summary-card ${totalPnL >= 0 ? 'profit' : 'loss'}">
                <div class="summary-label">Total P&L</div>
                <div class="summary-value ${totalPnL >= 0 ? 'profit' : 'loss'}">
                    ${totalPnL >= 0 ? '+' : ''}₹${totalPnL.toFixed(2)}
                </div>
            </div>
            <div class="summary-card">
                <div class="summary-label">Total Trades</div>
                <div class="summary-value">${allTrades.length}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">Wins / Losses</div>
                <div class="summary-value">
                    <span style="color: #10b981;">${wins}</span> / <span style="color: #ef4444;">${losses}</span>
                </div>
            </div>
            <div class="summary-card ${winRate >= 50 ? 'profit' : ''}">
                <div class="summary-label">Win Rate</div>
                <div class="summary-value ${winRate >= 50 ? 'profit' : ''}">${winRate.toFixed(1)}%</div>
            </div>
        </div>
        
        <div class="trades-section">
            <div class="section-header">
                📊 All Trades (${allTrades.length})
            </div>
            
            ${allTrades.length > 0 ? `
            <table class="trades-table">
                <thead>
                    <tr>
                        <th>Slot</th>
                        <th>Symbol</th>
                        <th>Direction</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>Qty</th>
                        <th>P&L</th>
                        <th>Exit Reason</th>
                        <th>Entry Time</th>
                        <th>Exit Time</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${tradeRowsHtml}
                </tbody>
            </table>
            ` : `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No trades recorded yet. Trades will appear here once positions are closed.</div>
            </div>
            `}
        </div>
    </div>
</body>
</html>
        `;
        
        res.send(html);
      } catch (error) {
        this.logger.error('Failed to render trade history:', error);
        res.status(500).send('Failed to load trade history');
      }
    });

    // =============================
    // STRATEGY MANAGER ENDPOINTS
    // =============================

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
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          global_metrics: globalMetrics,
          strategies: Object.fromEntries(allStatuses)
        });
      } catch (error) {
        this.logger.error('Error getting strategies status:', error);
        res.status(500).json({ error: 'Failed to get strategies status' });
      }
    });

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

    this.app.post('/api/strategy/:id/clear-position', async (req: Request, res: Response): Promise<void> => {
      try {
        const strategyId = req.params.id;
        
        if (!strategyId) {
          res.status(400).json({ error: 'Strategy ID is required' });
          return;
        }
        
        // Allow any strategy that has clearActivePosition method (not just bollinger-band-01)
        const strategy = StrategyRegistry.getInstance(strategyId);
        if (!strategy) {
          res.status(404).json({ error: 'Strategy not found', message: `Strategy ${strategyId} not found` });
          return;
        }
        
        // Call clearActivePosition() method on Bollinger Band strategy
        if (typeof (strategy as any).clearActivePosition !== 'function') {
          res.status(500).json({ 
            error: 'Strategy does not support manual position clearing',
            message: `Strategy ${strategyId} does not have clearActivePosition method`
          });
          return;
        }
        
        await (strategy as any).clearActivePosition();
        
        this.logger.info(`✅ Position cleared for strategy: ${strategyId}`);
        res.json({ 
          success: true, 
          message: 'Active position cleared successfully with P&L recorded' 
        });
      } catch (error) {
        this.logger.error(`Error clearing position for ${req.params.id}:`, error);
        res.status(500).json({ 
          error: 'Failed to clear position',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

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

    // Individual strategy dashboard
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

        // Render simple strategy page
        // Extract enhanced data
        const entryAnalysis = (status as any).entryAnalysis || { long: { conditions: [], metCount: 0, totalCount: 4, strength: 'NO_DATA' }, short: { conditions: [], metCount: 0, totalCount: 4, strength: 'NO_DATA' } };
        const slotMetrics = (status as any).slotMetrics || { totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnL: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, roi: 0, initialCapital: 65000, currentCapital: 65000 };
        const indicators = (status as any).indicators || { rsi: 0, supertrend: { trend: 'N/A', value: 0 }, bollingerBands: { upper: 0, middle: 0, lower: 0 } };
        const pivots = (status as any).pivots || { pp: 0, r1: 0, r2: 0, s1: 0, s2: 0 };
        const currentPrice = (status as any).currentStockPrice || (status as any).currentNiftyPrice || 0;
        const signalSymbol = (status as any).signalSymbol || 'N/A';
        const positionInfo = (status as any).positionInfo || null;
        
        // Helper functions for styling
        const getStrengthBadge = (strength: string) => {
          const colors: any = { 'SIGNAL': '#10b981', 'STRONG': '#3b82f6', 'WEAK': '#f59e0b', 'NO_SIGNAL': '#ef4444', 'NO_DATA': '#6b7280' };
          return `<span style="background: ${colors[strength] || '#6b7280'}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">${strength}</span>`;
        };
        
        const getConditionIcon = (met: boolean) => met ? '✅' : '❌';
        
        const getPriceStatus = (price: number, level: number, above: boolean) => {
          const isAbove = price > level;
          return above ? (isAbove ? '🟢 Above' : '🔴 Below') : (isAbove ? '🔴 Above' : '🟢 Below');
        };

        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${status.config.name} - Trading Bot</title>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="${positionInfo ? '5' : '30'}">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header h1 { margin: 0 0 10px 0; color: #1f2937; }
    .status-badge { 
      display: inline-block; 
      padding: 8px 20px; 
      border-radius: 20px; 
      color: white; 
      font-weight: bold; 
      background: ${status.metrics.isActive ? '#10b981' : '#6b7280'};
    }
    
    .section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .section-title { font-size: 1.1rem; font-weight: 600; color: #374151; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
    
    @media (max-width: 768px) {
      .grid-2, .grid-3, .grid-4, .grid-5 { grid-template-columns: 1fr 1fr; }
    }
    
    .card { background: #f9fafb; border-radius: 10px; padding: 16px; border: 1px solid #e5e7eb; }
    .card-value { font-size: 1.5rem; font-weight: 700; color: #1f2937; margin-bottom: 4px; }
    .card-label { font-size: 0.85rem; color: #6b7280; }
    .card-status { font-size: 0.8rem; margin-top: 4px; }
    
    .card-green { border-left: 4px solid #10b981; }
    .card-red { border-left: 4px solid #ef4444; }
    .card-blue { border-left: 4px solid #3b82f6; }
    .card-yellow { border-left: 4px solid #f59e0b; }
    .card-purple { border-left: 4px solid #8b5cf6; }
    
    .analysis-box { border: 2px solid #e5e7eb; border-radius: 10px; padding: 16px; }
    .analysis-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .analysis-title { font-weight: 600; font-size: 1rem; }
    .condition-list { list-style: none; padding: 0; margin: 0; }
    .condition-item { padding: 8px 0; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; gap: 8px; }
    .condition-item:last-child { border-bottom: none; }
    .condition-name { font-weight: 500; }
    .condition-detail { color: #6b7280; font-size: 0.9rem; margin-left: auto; }
    
    .text-green { color: #10b981; }
    .text-red { color: #ef4444; }
    .text-blue { color: #3b82f6; }
    
    .actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-secondary { background: #6b7280; color: white; }
    
    .rules-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; }
    .rules-box.short { background: #fef2f2; border-color: #fecaca; }
    .rules-list { margin: 8px 0 0 0; padding-left: 20px; }
    .rules-list li { margin: 4px 0; font-size: 0.9rem; color: #374151; }
    .exit-rule { font-size: 0.85rem; color: #059669; margin-top: 8px; font-weight: 500; }
    .exit-rule.short { color: #dc2626; }
    
    /* Live Position Monitor Styles */
    .position-monitor { border: 3px solid #10b981; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); }
    .position-monitor.short-position { border-color: #f59e0b; background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); }
    .position-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid rgba(0,0,0,0.1); }
    .position-title { font-size: 1.2rem; font-weight: 700; }
    .position-badge { padding: 6px 16px; border-radius: 20px; font-weight: 700; font-size: 0.9rem; }
    .position-badge.long { background: #10b981; color: white; }
    .position-badge.short { background: #f59e0b; color: white; }
    .position-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .position-stat { background: white; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .position-stat-value { font-size: 1.3rem; font-weight: 700; color: #1f2937; }
    .position-stat-label { font-size: 0.75rem; color: #6b7280; margin-top: 4px; text-transform: uppercase; }
    .position-stat.profit { border-bottom: 3px solid #10b981; }
    .position-stat.loss { border-bottom: 3px solid #ef4444; }
    .position-stat.warning { border-bottom: 3px solid #f59e0b; }
    .position-stat.info { border-bottom: 3px solid #3b82f6; }
    .position-detail-row { display: flex; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px; }
    .position-detail-label { color: #6b7280; font-size: 0.9rem; }
    .position-detail-value { font-weight: 600; color: #1f2937; }
    .no-position { text-align: center; padding: 40px; color: #6b7280; }
    .no-position-icon { font-size: 3rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>${status.config.name}</h1>
      <span class="status-badge">${status.metrics.isActive ? '🟢 ACTIVE' : '⚫ INACTIVE'}</span>
      <p style="color: #6b7280; margin: 10px 0 0 0;">Real-time monitoring • Auto-refresh every ${positionInfo ? '5s (live position)' : '30s'}</p>
    </div>
    
    <!-- Quick Stats Row -->
    <div class="section">
      <div class="grid-4">
        <div class="card card-blue">
          <div class="card-value">₹${currentPrice.toFixed(2)}</div>
          <div class="card-label">${signalSymbol} Spot Price</div>
        </div>
        <div class="card card-green">
          <div class="card-value">${(status as any).currentLots || 1} Lots</div>
          <div class="card-label">Position Size</div>
        </div>
        <div class="card card-purple">
          <div class="card-value">₹${slotMetrics.currentCapital.toLocaleString()}</div>
          <div class="card-label">Current Capital</div>
        </div>
        <div class="card">
          <div class="card-value">${status.config.timeframe}</div>
          <div class="card-label">Timeframe</div>
        </div>
      </div>
    </div>
    
    <!-- Live Position Monitor -->
    ${positionInfo ? `
    <div class="section position-monitor ${positionInfo.type === 'SHORT' ? 'short-position' : ''}">
      <div class="position-header">
        <div>
          <div class="position-title">📊 Live Position: ${positionInfo.tradingSymbol}</div>
          <div style="color: #6b7280; font-size: 0.85rem; margin-top: 4px;">
            Strike: ₹${positionInfo.strike || 'N/A'} (${positionInfo.strikeType || 'N/A'}) • 
            Lot Size: ${positionInfo.lotSize || 'N/A'} • 
            Qty: ${positionInfo.quantity} lot(s)
          </div>
        </div>
        <span class="position-badge ${positionInfo.type === 'LONG' ? 'long' : 'short'}">${positionInfo.type === 'LONG' ? '🚀 LONG' : '🔻 SHORT'}</span>
      </div>
      
      <!-- Main Stats Row -->
      <div class="position-grid">
        <div class="position-stat info">
          <div class="position-stat-value">₹${positionInfo.entryPrice?.toFixed(2) || '0.00'}</div>
          <div class="position-stat-label">Entry Price</div>
        </div>
        <div class="position-stat ${positionInfo.currentPrice > 0 ? 'info' : ''}">
          <div class="position-stat-value">₹${positionInfo.currentPrice?.toFixed(2) || '0.00'}</div>
          <div class="position-stat-label">Current Price</div>
        </div>
        <div class="position-stat ${(positionInfo.profitFromEntry || 0) >= 0 ? 'profit' : 'loss'}">
          <div class="position-stat-value" style="color: ${(positionInfo.profitFromEntry || 0) >= 0 ? '#10b981' : '#ef4444'}">
            ${(positionInfo.profitFromEntry || 0) >= 0 ? '+' : ''}₹${positionInfo.profitFromEntry?.toFixed(2) || '0.00'}
          </div>
          <div class="position-stat-label">P&L per Lot</div>
        </div>
        <div class="position-stat ${(positionInfo.profitPercent || 0) >= 0 ? 'profit' : 'loss'}">
          <div class="position-stat-value" style="color: ${(positionInfo.profitPercent || 0) >= 0 ? '#10b981' : '#ef4444'}">
            ${(positionInfo.profitPercent || 0) >= 0 ? '+' : ''}${positionInfo.profitPercent?.toFixed(2) || '0.00'}%
          </div>
          <div class="position-stat-label">P&L %</div>
        </div>
      </div>
      
      <!-- Exit Monitoring (Supertrend-Based) -->
      <div class="position-grid">
        <div class="position-stat info">
          <div class="position-stat-value">₹${indicators.supertrend?.value?.toFixed(2) || 'N/A'}</div>
          <div class="position-stat-label">Supertrend (10,2)</div>
        </div>
        <div class="position-stat info">
          <div class="position-stat-value">₹${indicators.bollingerBands?.middle?.toFixed(2) || 'N/A'}</div>
          <div class="position-stat-label">BB Middle (20)</div>
        </div>
        <div class="position-stat ${positionInfo.type === 'LONG' ? 'warning' : 'info'}">
          <div class="position-stat-value" style="color: ${positionInfo.type === 'LONG' ? '#ef4444' : '#3b82f6'};">
            ₹${positionInfo.type === 'LONG' 
              ? (indicators.supertrend?.value?.toFixed(2) || 'N/A')
              : (Math.min(indicators.supertrend?.value || 0, indicators.bollingerBands?.middle || 0).toFixed(2) || 'N/A')}
          </div>
          <div class="position-stat-label">${positionInfo.type === 'LONG' ? 'Exit Below (ST)' : 'Exit Above (MIN)'}</div>
        </div>
        <div class="position-stat ${(positionInfo.profitPercent || 0) >= 0 ? 'profit' : 'loss'}">
          <div class="position-stat-value">
            ${positionInfo.type === 'LONG' 
              ? (currentPrice > (indicators.supertrend?.value || 0) ? '🟢 SAFE' : '🔴 EXIT')
              : (currentPrice < Math.min(indicators.supertrend?.value || Infinity, indicators.bollingerBands?.middle || Infinity) ? '🟢 SAFE' : '🔴 EXIT')}
          </div>
          <div class="position-stat-label">Exit Status</div>
        </div>
      </div>
      
      <!-- Time & Position Details -->
      <div class="grid-2" style="margin-top: 12px;">
        <div>
          <div class="position-detail-row">
            <span class="position-detail-label">⏱️ Time Since Entry</span>
            <span class="position-detail-value">${Math.floor(positionInfo.minutesSinceEntry || 0)}m ${Math.floor(((positionInfo.minutesSinceEntry || 0) % 1) * 60)}s</span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">📅 Entry Time</span>
            <span class="position-detail-value">${positionInfo.entryTime ? new Date(positionInfo.entryTime).toLocaleTimeString() : 'N/A'}</span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">🔄 Last Updated</span>
            <span class="position-detail-value">${positionInfo.lastUpdated ? Math.round((Date.now() - new Date(positionInfo.lastUpdated).getTime()) / 1000) + 's ago' : 'N/A'}</span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">📊 Exit Mode</span>
            <span class="position-detail-value">5-min Candle Close</span>
          </div>
        </div>
        <div>
          <div class="position-detail-row">
            <span class="position-detail-label">📈 Current ${signalSymbol}</span>
            <span class="position-detail-value">₹${currentPrice?.toFixed(2) || 'N/A'}</span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">🎯 ${positionInfo.type === 'LONG' ? 'Exit Below ST' : 'Exit Above MIN(ST,BB)'}</span>
            <span class="position-detail-value" style="color: #ef4444;">
              ₹${positionInfo.type === 'LONG'
                ? (indicators.supertrend?.value?.toFixed(2) || 'N/A')
                : (Math.min(indicators.supertrend?.value || 0, indicators.bollingerBands?.middle || 0).toFixed(2) || 'N/A')}
            </span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">🕐 EOD Safety Exit</span>
            <span class="position-detail-value">3:24 PM</span>
          </div>
          <div class="position-detail-row">
            <span class="position-detail-label">💰 Unrealized P&L (Total)</span>
            <span class="position-detail-value" style="color: ${(positionInfo.unrealizedPnL || 0) >= 0 ? '#10b981' : '#ef4444'}">
              ${(positionInfo.unrealizedPnL || 0) >= 0 ? '+' : ''}₹${positionInfo.unrealizedPnL?.toFixed(2) || '0.00'}
            </span>
          </div>
        </div>
      </div>
    </div>
    ` : `
    <div class="section">
      <div class="no-position">
        <div class="no-position-icon">⏳</div>
        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px;">No Active Position</div>
        <div>Waiting for entry signal...</div>
      </div>
    </div>
    `}
    
    <!-- Entry Analysis -->
    <div class="section">
      <div class="section-title">📡 Live Signal Analysis</div>
      <div class="grid-2">
        <!-- LONG Analysis -->
        <div class="analysis-box" style="border-color: #10b981;">
          <div class="analysis-header">
            <span class="analysis-title text-green">🚀 LONG Entry Analysis</span>
            ${getStrengthBadge(entryAnalysis.long.strength)}
          </div>
          <div style="color: #6b7280; font-size: 0.85rem; margin-bottom: 12px;">${entryAnalysis.long.metCount}/${entryAnalysis.long.totalCount} conditions met</div>
          <ul class="condition-list">
            ${entryAnalysis.long.conditions.map((c: any) => `
              <li class="condition-item">
                <span>${getConditionIcon(c.met)}</span>
                <span class="condition-name">${c.name}:</span>
                <span class="condition-detail">${c.detail}</span>
              </li>
            `).join('')}
          </ul>
        </div>
        
        <!-- SHORT Analysis -->
        <div class="analysis-box" style="border-color: #ef4444;">
          <div class="analysis-header">
            <span class="analysis-title text-red">🔻 SHORT Entry Analysis</span>
            ${getStrengthBadge(entryAnalysis.short.strength)}
          </div>
          <div style="color: #6b7280; font-size: 0.85rem; margin-bottom: 12px;">${entryAnalysis.short.metCount}/${entryAnalysis.short.totalCount} conditions met</div>
          <ul class="condition-list">
            ${entryAnalysis.short.conditions.map((c: any) => `
              <li class="condition-item">
                <span>${getConditionIcon(c.met)}</span>
                <span class="condition-name">${c.name}:</span>
                <span class="condition-detail">${c.detail}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    </div>
    
    <!-- Technical Indicators -->
    <div class="section">
      <div class="section-title">📊 Technical Indicators</div>
      <div class="grid-5">
        <div class="card ${indicators.rsi >= 68 ? 'card-green' : indicators.rsi <= 30 ? 'card-red' : ''}">
          <div class="card-value">${indicators.rsi?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">RSI (10)</div>
          <div class="card-status">${indicators.rsi >= 68 ? '📈 Overbought' : indicators.rsi <= 30 ? '📉 Oversold' : '⏸️ Neutral'}</div>
        </div>
        <div class="card ${indicators.supertrend?.trend === 'UP' ? 'card-green' : 'card-red'}">
          <div class="card-value">${indicators.supertrend?.trend || 'N/A'}</div>
          <div class="card-label">Supertrend (10,2)</div>
          <div class="card-status">Level: ₹${indicators.supertrend?.value?.toFixed(2) || 'N/A'}</div>
        </div>
        <div class="card ${currentPrice > indicators.bollingerBands?.upper ? 'card-green' : ''}">
          <div class="card-value">₹${indicators.bollingerBands?.upper?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">BB Upper</div>
          <div class="card-status">${currentPrice > (indicators.bollingerBands?.upper || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
        <div class="card">
          <div class="card-value">₹${indicators.bollingerBands?.middle?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">BB Middle</div>
          <div class="card-status">SMA(20)</div>
        </div>
        <div class="card ${currentPrice < indicators.bollingerBands?.lower ? 'card-red' : ''}">
          <div class="card-value">₹${indicators.bollingerBands?.lower?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">BB Lower</div>
          <div class="card-status">${currentPrice < (indicators.bollingerBands?.lower || 0) ? '🔴 Below' : '🟢 Above'}</div>
        </div>
      </div>
    </div>
    
    <!-- Daily Pivot Levels -->
    <div class="section">
      <div class="section-title">🎯 Daily Pivot Levels</div>
      <div class="grid-5">
        <div class="card">
          <div class="card-value">₹${pivots.r2?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">R2 (Resistance)</div>
          <div class="card-status">${currentPrice > (pivots.r2 || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
        <div class="card card-green">
          <div class="card-value">₹${pivots.r1?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">R1 (Resistance)</div>
          <div class="card-status">${currentPrice > (pivots.r1 || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
        <div class="card card-blue">
          <div class="card-value">₹${pivots.pp?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">PP (Pivot Point)</div>
          <div class="card-status">${currentPrice > (pivots.pp || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
        <div class="card card-red">
          <div class="card-value">₹${pivots.s1?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">S1 (Support)</div>
          <div class="card-status">${currentPrice > (pivots.s1 || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
        <div class="card">
          <div class="card-value">₹${pivots.s2?.toFixed(2) || 'N/A'}</div>
          <div class="card-label">S2 (Support)</div>
          <div class="card-status">${currentPrice > (pivots.s2 || 0) ? '🟢 Above' : '🔴 Below'}</div>
        </div>
      </div>
    </div>
    
    <!-- Strategy Rules -->
    <div class="section">
      <div class="section-title">📋 Strategy Rules (${signalSymbol} Options)</div>
      <div class="grid-2">
        <div class="rules-box">
          <strong class="text-green">🚀 LONG Entry (Buy ${signalSymbol} CE)</strong>
          <ul class="rules-list">
            <li>${signalSymbol} Price > Bollinger Upper Band</li>
            <li>RSI between 68-85 (overbought momentum)</li>
            <li>Supertrend = UP</li>
            <li>${signalSymbol} Price above R1 or R2</li>
          </ul>
          <div class="exit-rule">Exit: 5-min Candle Close < Supertrend (10,2)</div>
        </div>
        <div class="rules-box short">
          <strong class="text-red">🔻 SHORT Entry (Buy ${signalSymbol} PE)</strong>
          <ul class="rules-list">
            <li>${signalSymbol} Price < Bollinger Lower Band</li>
            <li>RSI between 15-40 (oversold momentum)</li>
            <li>Supertrend = DOWN</li>
            <li>${signalSymbol} Price below PP (Pivot Point)</li>
          </ul>
          <div class="exit-rule short">Exit: 5-min Candle Close > MIN(Supertrend, BB Middle)</div>
        </div>
      </div>
    </div>
    
    <!-- Performance Metrics -->
    <div class="section">
      <div class="section-title">📈 Slot Performance Metrics</div>
      <div class="grid-4">
        <div class="card">
          <div class="card-value">${slotMetrics.totalTrades}</div>
          <div class="card-label">Total Trades</div>
          <div class="card-status">${slotMetrics.closedTrades} closed, ${slotMetrics.openTrades} open</div>
        </div>
        <div class="card ${slotMetrics.winRate >= 50 ? 'card-green' : 'card-red'}">
          <div class="card-value">${slotMetrics.winRate.toFixed(1)}%</div>
          <div class="card-label">Win Rate</div>
          <div class="card-status">${slotMetrics.wins}W / ${slotMetrics.losses}L</div>
        </div>
        <div class="card ${slotMetrics.totalPnL >= 0 ? 'card-green' : 'card-red'}">
          <div class="card-value" style="color: ${slotMetrics.totalPnL >= 0 ? '#10b981' : '#ef4444'}">₹${slotMetrics.totalPnL >= 0 ? '+' : ''}${slotMetrics.totalPnL.toFixed(2)}</div>
          <div class="card-label">Total P&L</div>
          <div class="card-status">Realized P&L</div>
        </div>
        <div class="card">
          <div class="card-value">${slotMetrics.profitFactor === Infinity ? '∞' : slotMetrics.profitFactor.toFixed(2)}</div>
          <div class="card-label">Profit Factor</div>
        </div>
      </div>
      <div class="grid-4" style="margin-top: 16px;">
        <div class="card ${slotMetrics.roi >= 0 ? 'card-green' : 'card-red'}">
          <div class="card-value" style="color: ${slotMetrics.roi >= 0 ? '#10b981' : '#ef4444'}">${slotMetrics.roi >= 0 ? '+' : ''}${slotMetrics.roi.toFixed(2)}%</div>
          <div class="card-label">ROI</div>
          <div class="card-status">On ₹${slotMetrics.initialCapital.toLocaleString()} (Initial)</div>
        </div>
        <div class="card card-purple">
          <div class="card-value">₹${slotMetrics.currentCapital.toLocaleString()}</div>
          <div class="card-label">Current Capital</div>
          <div class="card-status">1 lot per ₹40,000</div>
        </div>
        <div class="card card-green">
          <div class="card-value">₹${slotMetrics.avgWin > 0 ? '+' : ''}${slotMetrics.avgWin.toFixed(2)}</div>
          <div class="card-label">Avg Win</div>
          <div class="card-status">${slotMetrics.wins} winning trades</div>
        </div>
        <div class="card card-red">
          <div class="card-value">₹-${Math.abs(slotMetrics.avgLoss).toFixed(2)}</div>
          <div class="card-label">Avg Loss</div>
          <div class="card-status">${slotMetrics.losses} losing trades</div>
        </div>
      </div>
    </div>
    
    <!-- Actions -->
    <div class="section">
      <div class="section-title">⚡ Actions</div>
      <div class="actions">
        ${status.metrics.isActive 
          ? `<button class="btn btn-danger" onclick="stopStrategy('${strategyId}')">⏹️ Stop Strategy</button>`
          : `<button class="btn btn-primary" onclick="startStrategy('${strategyId}')">▶️ Start Strategy</button>`
        }
        <button class="btn btn-secondary" onclick="clearPosition('${strategyId}')">🧹 Clear Position</button>
        <a href="/strategies/${strategyId}" class="btn btn-secondary">📄 View JSON</a>
        <a href="/" class="btn btn-secondary">← Back to Dashboard</a>
      </div>
    </div>
    
    <script>
    async function startStrategy(id) {
      if (!confirm('Start strategy ' + id + '?')) return;
      try {
        const res = await fetch('/strategies/' + id + '/start', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Strategy started successfully!');
          window.location.reload();
        } else {
          alert('Failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) { alert('Error: ' + e.message); }
    }
    
    async function stopStrategy(id) {
      if (!confirm('Stop strategy ' + id + '?')) return;
      try {
        const res = await fetch('/strategies/' + id + '/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Strategy stopped successfully!');
          window.location.reload();
        } else {
          alert('Failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) { alert('Error: ' + e.message); }
    }
    
    async function clearPosition(id) {
      if (!confirm('Clear active position for ' + id + '? This will record the P&L.')) return;
      try {
        const res = await fetch('/api/strategy/' + id + '/clear-position', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Position cleared successfully!');
          window.location.reload();
        } else {
          alert('Failed: ' + (data.error || data.message || 'Unknown error'));
        }
      } catch (e) { alert('Error: ' + e.message); }
    }
    </script>
  </div>
</body>
</html>
        `;
        res.send(html);
      } catch (error) {
        this.logger.error(`Error rendering strategy page ${req.params.id}:`, error);
        res.status(500).send('Internal Server Error');
      }
    });
  }

  public async start(): Promise<void> {
    try {
      // Wait for session initialization
      await this.authService.waitForInitialization();

      // Initialize Strategy Manager
      await this.strategyManager.initialize();
      this.logger.info('✅ Multi-Strategy System initialized successfully');

      // Check authentication status
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
}

// Handle process signals
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection:', reason);
  // Log but continue execution
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

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
