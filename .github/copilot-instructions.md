# Copilot Instructions

## Project Overview

Professional Node.js TypeScript NIFTY futures trading bot using Zerodha's KiteConnect API. Features automated breakout-retracement strategy with real-time pivot detection and manual polling system.

## Project Structure

- `src/index.ts` - Main Express server with strategy dashboard and simplified UX
- `src/services/AuthService.ts` - Zerodha OAuth authentication handling
- `src/services/NiftyBreakoutRetracementStrategy.ts` - Main trading strategy with pivot detection
- `src/utils/Logger.ts` - Winston-based logging utility

## Key Requirements

- **NIFTY Breakout Strategy**: Professional breakout-retracement with 15,15 pivot detection
- **Real-time Price Streaming**: 1-second manual polling (no WebSocket dependencies)
- **Integrated UX**: Single-button strategy control with automatic price streaming
- **Professional Pivot Detection**: 15,15 lookback algorithm for reliable pivot points
- **5-minute Candle Analysis**: Real-time candle building and breakout monitoring
- **Comprehensive Logging**: Detailed strategy and pivot detection logging

## Development Guidelines

- **Clean Architecture**: Separation of concerns with integrated strategy workflow
- **Manual Polling System**: REST API polling every 1000ms for price updates
- **Professional Standards**: Type safety, error handling, and monitoring built-in
- **Strategy Integration**: Price streaming automatically starts/stops with strategy
- **No Standalone Components**: All functionality integrated into main breakout strategy
