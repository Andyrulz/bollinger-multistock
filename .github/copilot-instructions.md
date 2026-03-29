# Copilot Instructions

## Project Overview

Professional Node.js TypeScript trading bot using Zerodha's KiteConnect API. Features Bollinger Band strategy with multi-stock support and comprehensive infrastructure for trading automation.

## Project Structure

- `src/index.ts` - Main Express server with multi-strategy dashboard
- `src/core/StrategyManager.ts` - Central manager for all trading strategies
- `src/core/StrategyRegistry.ts` - Strategy registration and instance management
- `src/core/StrategyBase.ts` - Base class for all trading strategies
- `src/strategies/bollinger-band/BollingerBandStrategy.ts` - Bollinger Band trading strategy
- `src/services/AuthService.ts` - Zerodha OAuth authentication handling with session persistence
- `src/services/SessionPersistence.ts` - Encrypted session storage and restoration system
- `src/services/StrategyStatePersistence.ts` - Strategy state persistence across restarts
- `src/utils/Logger.ts` - Winston-based logging utility
- `config/strategies.json` - Strategy configuration file

## Key Requirements

- **Bollinger Band Strategy**: 5-minute timeframe with 20-period bands and 2.0 standard deviation
- **Multi-Stock Support**: Ready to scale from single to multiple instruments
- **Strategy Manager Architecture**: Clean separation of concerns with StrategyBase inheritance
- **Session Persistence**: Encrypted daily session storage with automatic restoration
- **Modern Dashboard**: Clean multi-strategy interface with real-time status
- **Comprehensive Logging**: Detailed strategy execution and error logging
- **Position Management**: Automated entry, 5-layer exit protection (EOD, Emergency Stop, Gamma RSI Climax, RSI Trail Premium Stop, Supertrend Break), and state persistence

## Development Guidelines

- **No Auto Code Changes**: NEVER change any code unless the user explicitly asks for it. For analysis/research requests, only provide findings and recommendations.
- **Implementation Plan Required**: When code changes are requested, always produce a detailed implementation plan FIRST. Wait for the user to review and approve the plan before making ANY code changes.
- **Clean Architecture**: Strategy Manager pattern with StrategyBase inheritance
- **Type Safety**: Full TypeScript with proper error handling
- **Professional Standards**: Monitoring, logging, and health checks built-in
- **Scalable Design**: Ready to add momentum scanners and multiple stock support
- **Configuration-Driven**: JSON-based strategy configuration for easy modifications
