# Copilot Instructions

## Project Overview

Two-application trading workspace. `bollinger-multistock/` is the existing professional Node.js TypeScript bot using Zerodha's KiteConnect API. `swing-trading/` is currently a specification-only scaffold for a future, independently isolated NSE cash-equity swing system.

## Project Structure

- `bollinger-multistock/src/index.ts` - Existing Express server and dashboard
- `bollinger-multistock/src/core/StrategyManager.ts` - Bollinger strategy orchestration
- `bollinger-multistock/src/core/StrategyRegistry.ts` - Strategy registration and instance management
- `bollinger-multistock/src/core/StrategyBase.ts` - Base class for existing strategies
- `bollinger-multistock/src/strategies/bollinger-band/BollingerBandStrategy.ts` - Production Bollinger strategy
- `bollinger-multistock/src/services/AuthService.ts` - Zerodha OAuth authentication handling
- `bollinger-multistock/src/services/SessionPersistence.ts` - Encrypted session storage and restoration
- `bollinger-multistock/src/services/StrategyStatePersistence.ts` - Strategy state persistence
- `bollinger-multistock/src/utils/Logger.ts` - Winston-based logging utility
- `bollinger-multistock/config/strategies.json` - Bollinger configuration
- `swing-trading/docs/SWING-TRADING-SYSTEM-SPEC.md` - Swing-system review specification

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
- **Application Isolation**: Never couple swing state, capital, positions, schedules, or cleanup to the Bollinger three-slot manager
- **Swing Safety**: The swing scaffold must remain non-executable until its specification decisions and staged implementation are explicitly approved
