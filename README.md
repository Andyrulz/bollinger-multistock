# Trading Systems Workspace

This repository contains two deliberately separated trading applications:

- **[bollinger-multistock/](bollinger-multistock/)** — the existing production intraday stock-options bot using Bollinger Band entries, Smart Retention, Zerodha authentication, persistence, and deployment tooling.
- **[swing-trading/](swing-trading/)** — the planned long-only NSE cash-equity swing-trading system. It currently contains an approved review specification and an implementation scaffold only; it cannot place orders.

## Safety boundary

The Bollinger application remains independently buildable and deployable. The swing application will have separate configuration, risk capital, runtime state, journal, scanner, execution, and deployment lifecycle. Authentication integration will be designed during implementation without coupling swing positions to the three Bollinger slots.

## Existing bot commands

Run commands from [bollinger-multistock/](bollinger-multistock/):

- `npm run build`
- `npm test`
- `npm run dev`

See the application-specific README and documentation inside that folder for operational details.
