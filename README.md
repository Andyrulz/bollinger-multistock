# NIFTY Futures Trading Bot

A professional Node.js TypeScript trading bot for automated NIFTY futures trading using Zerodha's KiteConnect API. Features real-time price streaming, pivot point detection, and breakout-retracement strategy implementation.

## 🚀 Key Features

- **NIFTY Futures Strategy**: Professional breakout-retracement strategy with pivot detection
- **Real-Time Price Streaming**: 1-second manual polling system (no WebSocket dependencies)
- **Professional Pivot Detection**: 15,15 lookback algorithm for accurate pivot highs/lows
- **5-Minute Candle Analysis**: Real-time candle building and analysis
- **Integrated Strategy Control**: Single-button start/stop with automated price streaming
- **Zerodha Integration**: Secure OAuth authentication with KiteConnect API
- **Comprehensive Logging**: Detailed trade and pivot detection logging
- **Clean Architecture**: Production-ready, minimal codebase

## 🎯 Trading Strategy Overview

### NIFTY Breakout Retracement Strategy

The bot implements a professional breakout-retracement strategy specifically designed for NIFTY futures:

- **Instrument**: NIFTY futures (current month contract)
- **Timeframe**: 5-minute candles for analysis
- **Pivot Detection**: 15,15 lookback algorithm (31 candles minimum)
- **Price Streaming**: Real-time 1-second polling via REST API
- **Strategy Logic**: Breakout detection with retracement confirmation

### Real-Time Features

- **Live Price Updates**: Every 1 second via KiteConnect REST API
- **Candle Building**: Real-time 5-minute OHLCV candle construction
- **Pivot Updates**: Fresh pivot analysis every 5 minutes
- **Strategy Integration**: Single-click start/stop with automatic streaming

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

3. Set up environment variables:

```bash
cp .env.example .env
```

4. Edit the `.env` file with your Zerodha API credentials:

```env
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
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

# 4. Start NIFTY futures strategy (single click!)
```

**🎯 Strategy Dashboard:**

- **Main Interface**: http://localhost:3000/ (Strategy control panel)
- **Authentication**: http://localhost:3000/auth/login (Daily login required)
- **Status Check**: http://localhost:3000/auth/status

### Trading Strategy Usage

1. **Authenticate**: Complete Zerodha login (daily requirement)
2. **Start Strategy**: Single button click starts:
   - Real-time NIFTY price streaming (1-second updates)
   - 5-minute candle building
   - Pivot point detection (15,15 algorithm)
   - Breakout monitoring
3. **Monitor**: Live logs show pivot detection and strategy status
4. **Stop Strategy**: Single button stops all operations

### What You'll See When Running

**Real-Time Logs:**

```
🔺 NEW PIVOT HIGH (15,15): ₹23,450.75 at 9/24/2025, 12:45:00 PM
🔻 NEW PIVOT LOW (15,15): ₹23,425.50 at 9/24/2025, 12:50:00 PM
📊 NIFTY: ₹23,438.25 | Volume: 1,234,567 | Change: +0.35%
✅ Pivot analysis complete (15,15) - analyzed 2 pivot(s)
```

### First Time Setup

1. **Get Zerodha API Credentials**: Visit [Kite Connect](https://developers.kite.trade/) to create an app
2. **Configure Redirect URL**: Set to `http://localhost:3000/auth/callback` in your Zerodha app settings
3. **Install and Configure**: Follow installation steps below

### Daily Authentication Process

**⚠️ IMPORTANT**: Zerodha access tokens expire daily at 6 AM (regulatory requirement). You must re-authenticate every trading day.

1. **Start the Bot**: `npm run dev`
2. **Check Status**: Visit http://localhost:3000/ - you'll see authentication status
3. **Authenticate**: Click login link or visit http://localhost:3000/auth/login
4. **Complete Zerodha Login**: Enter credentials, PIN, complete 2FA if required
5. **Verify**: You'll be redirected back with success confirmation
6. **Ready**: Bot is now authenticated for the trading session!

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

| Endpoint               | Description                        | Example                               |
| ---------------------- | ---------------------------------- | ------------------------------------- |
| `GET /`                | Strategy dashboard & control panel | http://localhost:3000/                |
| `GET /health`          | Health check                       | http://localhost:3000/health          |
| `GET /auth/status`     | Check authentication status        | http://localhost:3000/auth/status     |
| `GET /auth/login`      | Start authentication               | http://localhost:3000/auth/login      |
| `POST /strategy/start` | Start NIFTY breakout strategy      | Called via dashboard button           |
| `POST /strategy/stop`  | Stop NIFTY breakout strategy       | Called via dashboard button           |
| `GET /strategy/status` | Get current strategy status        | http://localhost:3000/strategy/status |

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
- **Updates**: Fresh analysis every 5 minutes
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

## Professional Support & Development

### Development Setup

This codebase follows professional development standards:

- **TypeScript**: Full type safety and modern JavaScript features
- **Clean Architecture**: Separation of concerns with modular design
- **Production Ready**: Error handling, logging, and monitoring built-in
- **Extensible**: Easy to add new strategies and features

### Trading Strategy Extensions

The current breakout-retracement strategy can be extended with:

- **Multiple Timeframes**: Add higher timeframe confirmation
- **Volume Analysis**: Incorporate volume-based signals
- **Risk Management**: Stop-loss and position sizing rules
- **Multiple Instruments**: Expand beyond NIFTY futures

For advanced strategy development and professional support, this codebase provides a solid foundation for institutional-quality trading systems.
