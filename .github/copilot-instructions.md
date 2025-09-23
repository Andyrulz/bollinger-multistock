# Copilot Instructions

## Project Overview

Node.js TypeScript trading bot for Zerodha using KiteConnect API. Focus on clean, simple authentication and basic portfolio access.

## Project Structure

- `src/index.ts` - Main application with Express server and authentication flow
- `src/services/AuthService.ts` - Zerodha OAuth authentication handling
- `src/utils/Logger.ts` - Winston-based logging utility

## Key Requirements

- Clean, minimal codebase focused on authentication
- Daily login flow for Zerodha tokens (expire at 6 AM)
- Basic portfolio and market data access
- Comprehensive error handling and logging
- No complex trading logic or risk management initially

## Development Guidelines

- Keep dependencies minimal
- Focus on core authentication functionality
- Maintain comprehensive documentation
- Use TypeScript for type safety
- Follow Express.js best practices for API endpoints
