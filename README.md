# Zerodha Trading Bot

A clean and minimal Node.js TypeScript application for Zerodha authentication and basic portfolio access using KiteConnect API.

## Features

- **Zerodha Integration**: Authentication with Zerodha's KiteConnect API
- **OAuth Flow**: Secure OAuth-based authentication with session management
- **Portfolio Access**: Basic portfolio and position viewing
- **Market Data**: Simple market data retrieval
- **Web Interface**: RESTful API endpoints for monitoring
- **Logging**: Structured logging with Winston
- **Clean Architecture**: Minimal, focused codebase

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

### Daily Usage (Market Hours)

**⚡ Quick Commands:**
```bash
# 1. Start the bot
npm run dev

# 2. Open browser and visit
http://localhost:3000/auth/login

# 3. Complete Zerodha authentication

# 4. Verify authentication
http://localhost:3000/auth/status
```

**🔖 Bookmark these URLs:**
- **Main Dashboard**: http://localhost:3000/ (Beautiful web interface)
- **Daily Login**: http://localhost:3000/auth/login
- **Status Check**: http://localhost:3000/auth/status  
- **Portfolio**: http://localhost:3000/portfolio

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

| Variable              | Description              | Default     |
| --------------------- | ------------------------ | ----------- |
| `ZERODHA_API_KEY`     | Your Zerodha API key     | Required    |
| `ZERODHA_API_SECRET`  | Your Zerodha API secret  | Required    |
| `PORT`                | Server port              | 3000        |
| `NODE_ENV`            | Environment mode         | development |
| `LOG_LEVEL`           | Logging level            | info        |

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

| Endpoint                   | Description                 | Example                                        |
| -------------------------- | --------------------------- | ---------------------------------------------- |
| `GET /`                    | Help and status page        | http://localhost:3000/                         |
| `GET /health`              | Health check                | http://localhost:3000/health                   |
| `GET /auth/status`         | Check authentication status | http://localhost:3000/auth/status              |
| `GET /auth/login`          | Start authentication        | http://localhost:3000/auth/login               |
| `GET /portfolio`           | View holdings and positions | http://localhost:3000/portfolio                |
| `GET /market-data/:symbol` | Get live market data        | http://localhost:3000/market-data/NSE:RELIANCE |

### 🚨 Troubleshooting

**Common Issues:**

1. **"Invalid api_key or access_token" Error**
   - **Cause**: Not authenticated or token expired
   - **Solution**: Re-authenticate via `/auth/login`

2. **Redirect URL Mismatch**
   - **Error**: "Redirect URI mismatch"  
   - **Solution**: Ensure Zerodha app redirect URL is exactly: `http://localhost:3000/auth/callback`

3. **Authentication Fails**
   - **Check**: API secret is correct in `.env` file
   - **Check**: No special characters or spaces in credentials
   - **Try**: Regenerate API credentials in Zerodha console

4. **Bot Not Starting**
   - **Check**: Port 3000 is not in use
   - **Solution**: Kill any processes using port 3000 or change PORT in `.env`

**Debug Commands:**
```bash
# Check if bot is running
curl http://localhost:3000/health

# Check authentication status  
curl http://localhost:3000/auth/status

# Test portfolio access (after auth)
curl http://localhost:3000/portfolio
```

### Market Data Access

The bot provides simple market data access:

```typescript
// Get quotes for symbols
GET /market-data/NSE:RELIANCE
```

### Portfolio Access

Basic portfolio viewing:

```typescript
// Get holdings and positions
GET /portfolio
```

## Project Structure

```
src/
├── index.ts                 # Main application entry point
├── services/
│   └── AuthService.ts       # Authentication and session management
└── utils/
    └── Logger.ts           # Logging utility
```

## Scripts

### Development Scripts

- `npm start` - Start the compiled application
- `npm run dev` - Start in development mode with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch mode compilation
- `npm run clean` - Clean dist directory

### Daily Usage Script

```bash
# Easy startup script (recommended)
./start-bot.sh

# Or manually
npm run dev
```

## 📚 Documentation

| Document                    | Purpose                            |
| --------------------------- | ---------------------------------- |
| [README.md](./README.md)    | Complete documentation (this file) |
| `.env.example`              | Environment configuration template |

## Error Handling

The bot includes comprehensive error handling:

- **API Errors**: Detailed error logging and user-friendly messages
- **Network Issues**: Graceful handling of connection failures  
- **Authentication**: Clear guidance for re-authentication
- **Order Failures**: Detailed error logging and notification

## Logging

Structured logging with multiple levels:

- **Console**: Colored output for development
- **File**: Persistent logging to `logs/trading.log`
- **Error File**: Separate error log at `logs/error.log`

## Security Considerations

- Never commit your `.env` file with real credentials
- Use environment variables for all sensitive configuration
- Monitor logs for suspicious activity
- Regular security updates for dependencies

## Disclaimer

This trading bot is for educational and development purposes. The codebase is kept clean and minimal, focusing on:

- **Authentication**: Secure OAuth flow with Zerodha
- **Basic Access**: Portfolio viewing and market data retrieval
- **Clean Architecture**: Simple, maintainable code structure
- **Future-Ready**: Easy to extend with trading logic when needed

## License

MIT License - see LICENSE file for details

## Support

For issues and support:

1. Check the logs in the `logs/` directory
2. Review the configuration in `.env`
3. Ensure API credentials are valid
4. Check Zerodha's API status and limits
