# Multi-Stock Trading Bot 🚀

> **🎯 MULTI-STRATEGY SYSTEM**: Professional Node.js TypeScript trading bot for automated trading using Zerodha's KiteConnect API with Bollinger Band strategy and multi-stock support.

A professional algorithmic trading system built with clean architecture, comprehensive state persistence, and ready for multi-stock momentum-based trading.

## Callback URL: https://98.70.40.23/auth/callback

## Local URL: http://localhost:3000/auth/callback

## ✨ Production Features

- **📊 Bollinger Band Strategy**: 5-minute timeframe with 20-period bands and 2.0 standard deviation
- **🎯 Multi-Stock Ready**: Architecture supports trading multiple instruments simultaneously
- **🔒 Enterprise Security**: AES-256 encrypted session and state persistence
- **🏗️ Strategy Manager**: Clean architecture with StrategyBase inheritance pattern
- **🎮 Beautiful Dashboard**: Professional multi-strategy web UI with real-time monitoring
- **📈 Trade Execution**: Full integration with paper and live trading modes
- **🔍 Production Monitoring**: Winston logging with health metrics and alerting
- **💾 State Persistence**: Zero-downtime restarts with complete state recovery
- **🏢 Professional Architecture**: Clean separation of concerns with enterprise patterns

## 📊 Strategy Overview

### Bollinger Band Strategy

The bot implements a momentum-based mean-reversion trading system:

- **Market**: NIFTY futures and Bank NIFTY (expandable to any instruments)
- **Timeframe**: 5-minute candles
- **Signal Generation**: Price breakouts beyond Bollinger Bands
- **Parameters**: 20-period SMA with 2.0 standard deviation bands
- **Position Management**: Trailing stop-loss with configurable risk-reward ratios
- **Risk Management**: Per-trade risk limits and position sizing

## 🎯 **PROJECT STATUS**

> **✅ READY FOR EXPANSION**: Clean codebase with Bollinger strategy operational, prepared for multi-stock momentum scanner

### **Recent Cleanup**:

- ✅ **Removed Breakout Strategy**: Cleaned up all breakout-pullback strategy code
- ✅ **Streamlined Architecture**: Focused on Bollinger Band strategy only
- ✅ **Multi-Strategy Framework**: StrategyManager ready for additional strategies
- ✅ **Clean Documentation**: Updated all references to reflect current system

## 🚀 **FUTURE ROADMAP**

### **Planned Enhancements**:

- 🔜 **Momentum Scanner**: Market-open stock scanning for high-momentum opportunities
- 🔜 **Multi-Stock Trading**: Run Bollinger strategy on multiple stocks simultaneously
- 🔜 **Advanced Risk Management**: Per-strategy and global risk controls
- 🔜 **Performance Analytics**: Comprehensive P&L tracking and reporting

## Prerequisites

- Node.js v18.0.0 or higher
- Zerodha Kite Connect API credentials
- Active Zerodha trading account

## Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd zerodha-trading-bot
```

2. Install dependencies:

```bash
npm install
```

3. Configure your environment variables in the existing `.env` file:

```env
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

## 🚀 Quick Start

### Daily Trading Workflow

**⚡ Quick Commands:**

```bash
# 1. Start the trading bot
npm run dev

# 2. Open browser and authenticate
http://localhost:3000/auth/login

# 3. Access main dashboard
http://localhost:3000/

# 4. Start NIFTY breakout strategy (single click!)
```

**🎯 Strategy Dashboard:**

- **Main Interface**: http://localhost:3000/ (Strategy control panel)
- **Breakout Strategy (V2)**: http://localhost:3000/breakout-strategy-v2 (Clean, modern dashboard)
- **Breakout Strategy (Classic)**: http://localhost:3000/breakout-strategy (Original dashboard)
- **Authentication**: http://localhost:3000/auth/login (Daily login required)

### Strategy Operation

1. **Authenticate**: Complete Zerodha login (daily requirement)
2. **Start Strategy**: Single button click automatically starts:
   - Current month NIFTY futures contract detection
   - Historical data loading (7 days 5m + 60 minutes 1m candles)
   - Real-time price streaming (1-second updates)
   - 15,15 pivot point detection
   - Volume-confirmed breakout monitoring
3. **Monitor**: Live dashboard shows pivot levels, breakout signals, and strategy status
4. **Stop Strategy**: Single button stops all operations safely

### What You'll See When Running

**Real-Time Logs:**

```bash
info: 🔺 NEW PIVOT HIGH (15,15): ₹25,198.00 at 9/24/2025, 1:15:00 PM
info: 🔻 NEW PIVOT LOW (15,15): ₹25,078.00 at 9/24/2025, 11:05:00 AM
info: � MANUAL POLL: NIFTY25SEPFUT | LTP: ₹25,119.00 | Vol: 4,133,250
info: 📊 Volume SMA50 updated: 8,340 (based on 50 candles)
info: 🚀 LONG BREAKOUT DETECTED! Price: ₹25,110.50 | Volume: 189% of SMA
```

**Live Dashboard Features:**

- Current NIFTY price with 1-second updates
- Latest confirmed pivot HIGH and LOW levels
- Breakout detection status and volume analysis
- Memory optimization status (maintains exactly 50 1-minute candles)
- One-click strategy start/stop controls

### First Time Setup

1. **Get Zerodha API Credentials**: Visit [Kite Connect](https://developers.kite.trade/) to create an app
2. **Configure Redirect URL**: Set to `http://localhost:3000/auth/callback` in your Zerodha app settings
3. **Install and Configure**: Follow installation steps below

### Authentication Process

**✅ SESSION PERSISTENCE**: The bot now automatically saves your authentication session securely. You only need to login once per day!

**🔄 Automatic Session Restoration**: When you restart the bot, it automatically restores your previous session if still valid.

1. **Start the Bot**: `npm run dev`
2. **First Time Setup**:
   - Visit http://localhost:3000/ - you'll see authentication status
   - Click login link or visit http://localhost:3000/auth/login
   - Complete Zerodha login (credentials, PIN, 2FA)
   - Session is automatically saved and encrypted
3. **Subsequent Starts**: Bot automatically authenticates using saved session
4. **Session Expiry**: Tokens expire daily at 6 AM - bot will prompt for re-authentication

**🔐 Security Features**:

- **AES-256-CBC Encryption**: Sessions encrypted using API credentials as key derivation
- **Secure Storage**: Encrypted data stored in `data/auth/session.json`
- **File Permissions**: Restricted to 0o600 (owner read/write only)
- **Automatic Cleanup**: Sessions cleared on logout, expiry, or corruption
- **Session Validation**: Automatic token validation on restoration
- **Graceful Fallback**: Seamless re-authentication if session invalid

**🔧 New API Endpoints**:

- `GET /auth/session-info`: View detailed session information and expiry
- `POST /auth/logout`: Manual logout with secure session cleanup

## Configuration

### Environment Variables

| Variable             | Description             | Default     |
| -------------------- | ----------------------- | ----------- |
| `ZERODHA_API_KEY`    | Your Zerodha API key    | Required    |
| `ZERODHA_API_SECRET` | Your Zerodha API secret | Required    |
| `PORT`               | Server port             | 3000        |
| `NODE_ENV`           | Environment mode        | development |
| `LOG_LEVEL`          | Logging level           | info        |

### Risk Management

The bot is designed for basic portfolio access and market data retrieval. Advanced trading features will be added in future iterations.

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### Authentication

**⚠️ IMPORTANT**: Zerodha access tokens expire daily at 6 AM (regulatory requirement). You must re-authenticate the bot every trading day.

#### Daily Authentication Process:

1. Start the bot: `npm run dev`
2. Visit: `http://localhost:3000/auth/login`
3. Complete Zerodha OAuth flow
4. Bot automatically receives access token and is ready for trading

#### Quick Status Check:

- **Help & Status**: http://localhost:3000/
- **Auth Status**: http://localhost:3000/auth/status
- **Portfolio**: http://localhost:3000/portfolio (after auth)

📖 **Complete Daily Guide**: See [AUTHENTICATION.md](./AUTHENTICATION.md) for detailed step-by-step instructions.

### API Endpoints

| Endpoint                             | Description                      | Purpose                            |
| ------------------------------------ | -------------------------------- | ---------------------------------- |
| `GET /`                              | Main dashboard & control panel   | Strategy overview and controls     |
| `GET /breakout-strategy`             | Live strategy dashboard          | Real-time strategy monitoring      |
| `GET /auth/login`                    | Start authentication process     | Redirects to Zerodha login         |
| `GET /auth/status`                   | Check authentication status      | Shows session persistence info     |
| `POST /auth/logout`                  | Clear saved session              | Logout and clear persistent data   |
| `GET /auth/session-info`             | Detailed session information     | Debug session persistence          |
| `POST /breakout-strategy/start`      | Start complete breakout strategy | Begin automated trading strategy   |
| `POST /breakout-strategy/stop`       | Stop all strategy operations     | Safely halt strategy and streaming |
| `GET /breakout-strategy/status`      | Get detailed strategy state      | Monitor all strategy components    |
| `GET /breakout-strategy/pivots`      | Get current pivot levels         | View latest HIGH/LOW pivot points  |
| `GET /breakout-strategy/memory-info` | Check memory optimization        | Verify 50-candle limit enforcement |

### Manual Testing Endpoints

| Endpoint                        | Description                   | Purpose                        |
| ------------------------------- | ----------------------------- | ------------------------------ |
| `POST /test/volume-sma50`       | Test volume SMA50 calculation | Validate volume analysis logic |
| `POST /test/breakout-detection` | Test breakout logic           | Verify signal generation       |
| `POST /test/candle-building`    | Test 1-minute candle logic    | Validate OHLC construction     |
| `POST /test/run-all-manual`     | Run comprehensive test suite  | Test all components together   |
| `POST /test/clear-data`         | Clear test data               | Reset to clean state           |

### 🚨 Troubleshooting

**Common Issues:**

1. **"Invalid api_key or access_token" Error**
   - **Cause**: Not authenticated or token expired
   - **Solution**: Re-authenticate via `/auth/login`

2. **Strategy Not Starting**
   - **Cause**: Bot not authenticated with Zerodha
   - **Solution**: Complete daily authentication first
   - **Check**: Verify auth status at `/auth/status`

3. **No Pivot Detection**
   - **Cause**: Insufficient historical data
   - **Solution**: Wait for 31+ candles (2.5+ hours of data)
   - **Note**: Pivot detection requires 15,15 lookback (31 candles minimum)

4. **Price Streaming Issues**
   - **Cause**: Network connectivity or API limits
   - **Solution**: Check logs for specific error messages
   - **Monitor**: Live price updates should appear every second

**Debug Commands:**

```bash
# Check if bot is running
curl http://localhost:3000/health

# Check authentication status
curl http://localhost:3000/auth/status

# Check strategy status
curl http://localhost:3000/strategy/status

# View real-time logs
tail -f logs/trading.log
```

## 📊 Strategy Details

### Professional Pivot Detection

The bot uses a sophisticated 15,15 lookback algorithm:

- **Algorithm**: 15 candles before + current candle + 15 candles after
- **Requirement**: Minimum 31 completed 5-minute candles
- **Updates**: Synchronized analysis 1 second after each 5-minute candle closes
- **Timing**: Runs at XX:00:01, XX:05:01, XX:10:01, XX:15:01, etc.
- **Validation**: Strict peak/trough confirmation rules

### Real-Time Price Streaming

- **Method**: Manual REST API polling (no WebSocket dependencies)
- **Frequency**: Every 1000ms (1-second updates)
- **Instrument**: Current month NIFTY futures contract
- **Integration**: Automatically starts/stops with strategy

### Candle Building Process

- **Timeframe**: 5-minute OHLCV candles
- **Source**: Live tick data from 1-second polling
- **Storage**: In-memory candle array for analysis
- **Updates**: Real-time candle completion and new candle creation

## Project Structure

```
src/
├── index.ts                           # Main Express server with strategy dashboard
├── services/
│   ├── AuthService.ts                # Zerodha OAuth authentication
│   └── NiftyBreakoutRetracementStrategy.ts  # Main trading strategy with pivot detection
└── utils/
    └── Logger.ts                     # Winston-based logging utility
```

### Key Components

- **Main Server**: Express.js with strategy control dashboard
- **Authentication Service**: Secure Zerodha OAuth flow management
- **Trading Strategy**: NIFTY breakout strategy with integrated price streaming
- **Pivot Detection**: Professional 15,15 lookback algorithm
- **Logging System**: Structured logging for trades, pivots, and system events

## Scripts

### Development Scripts

- `npm start` - Start the compiled application
- `npm run dev` - Start in development mode with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch mode compilation
- `npm run clean` - Clean dist directory

### Daily Usage Script

```bash
# Professional trading startup
npm run dev

# Then visit dashboard and click "Start Strategy"
# → Automatic price streaming begins
# → Pivot detection starts
# → Real-time candle building
# → Strategy monitoring active
```

## 🎯 Strategy Performance Monitoring

### Live Dashboard Features

- **Real-Time Price**: Current NIFTY futures price with 1-second updates
- **Strategy Status**: Active/Inactive with detailed state information
- **Pivot Levels**: Latest confirmed pivot highs and lows with timestamps
- **Candle Count**: Number of completed 5-minute candles available
- **Volume Data**: Real-time volume and change percentage

### Log Monitoring

The system provides comprehensive logging:

```bash
# Real-time strategy logs
tail -f logs/trading.log

# Error monitoring
tail -f logs/error.log

# Filter pivot detections only
grep "PIVOT" logs/trading.log
```

## 📚 Documentation

| Document                                                             | Purpose                            |
| -------------------------------------------------------------------- | ---------------------------------- |
| [README.md](./README.md)                                             | Complete documentation (this file) |
| `.env.example`                                                       | Environment configuration template |
| [.github/copilot-instructions.md](./.github/copilot-instructions.md) | Development guidelines             |

## Error Handling & Strategy Safety

The bot includes comprehensive error handling and safety measures:

- **API Errors**: Graceful handling of Zerodha API failures with retry logic
- **Network Issues**: Connection failure recovery and reconnection attempts
- **Authentication**: Automatic detection of expired tokens with re-auth guidance
- **Strategy Failures**: Safe strategy stop with detailed error logging
- **Data Validation**: Input validation for all market data and calculations
- **Memory Management**: Efficient candle storage and cleanup procedures

## Real-Time Logging & Monitoring

Multi-level structured logging system:

- **Console Output**: Colored real-time logs during development
- **Trading Log**: Comprehensive strategy and market activity (`logs/trading.log`)
- **Error Log**: Separate error tracking (`logs/error.log`)
- **Pivot Detection**: Special formatting for pivot high/low discoveries
- **Performance Metrics**: Strategy execution timing and efficiency stats

### Log Categories

```typescript
// Strategy Events
"🚀 NIFTY Breakout Strategy started";
"⏹️ NIFTY Breakout Strategy stopped";

// Pivot Detection
"🔺 NEW PIVOT HIGH (15,15): ₹23,450.75";
"🔻 NEW PIVOT LOW (15,15): ₹23,425.50";

// Price Streaming
"📊 NIFTY: ₹23,438.25 | Volume: 1,234,567";
"✅ 5-minute candle completed: O:23400 H:23450 L:23380 C:23438";
```

## Security & Risk Considerations

### Data Security

- Never commit your `.env` file with real API credentials
- Use environment variables for all sensitive configuration
- Monitor logs for suspicious API activity
- Regular security updates for all dependencies

### Trading Risk Management

- **Paper Trading Ready**: Easy to switch to simulated environment
- **Position Sizing**: Built-in safeguards for position management
- **Stop Loss Integration**: Framework ready for risk management rules
- **Market Hours**: Automatic handling of market session validation

### API Rate Limits

- **Efficient Polling**: Optimized 1-second intervals to stay within limits
- **Error Recovery**: Automatic backoff on rate limit errors
- **Connection Pooling**: Efficient HTTP connection management

## 🚨 Important Trading Disclaimers

### Regulatory Compliance

- **Daily Authentication**: Zerodha tokens expire at 6 AM daily (regulatory requirement)
- **Market Hours**: Strategy operates during official market trading hours
- **Risk Disclosure**: This is automated trading software - understand risks before use

### Strategy Performance

- **Backtesting Recommended**: Test strategy logic before live deployment
- **Market Conditions**: Performance varies with market volatility and conditions
- **Position Management**: Implement proper position sizing and risk controls

## License

MIT License - see LICENSE file for details

## Strategy Details

For comprehensive technical documentation, implementation details, algorithm specifications, and debugging guide, see:
**[STRATEGY-DOCUMENTATION.md](./STRATEGY-DOCUMENTATION.md)**

The strategy documentation includes:

- Complete 15,15 pivot detection algorithm
- Breakout signal generation logic
- Volume confirmation system (50-period SMA)
- Memory optimization techniques
- Real-time data processing architecture
- Testing framework and debugging procedures
- Performance metrics and troubleshooting guide

## Support & Troubleshooting

1. **Strategy Issues**: Check the comprehensive debugging guide in [STRATEGY-DOCUMENTATION.md](./STRATEGY-DOCUMENTATION.md)
2. **API Connection Problems**: Verify your `api_key` and `api_secret` in environment variables
3. **Authentication Failures**: Complete fresh login via `/auth/login` endpoint
4. **Performance Issues**: Monitor memory usage via `/breakout-strategy/memory-info` endpoint

## License

MIT License - See LICENSE file for details.
