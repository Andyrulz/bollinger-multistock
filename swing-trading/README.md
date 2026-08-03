# Swing Trading System

Status: **scanner implementation in progress — trading and order execution remain disabled**.

This folder is reserved for a long-only NSE cash-equity swing-trading system inspired by public trend-following and momentum concepts associated with Mark Minervini and Dan Zanger.

## Review document

The complete proposed behavior, architecture, safety controls, journal, rollout phases, and open decisions are in [docs/SWING-TRADING-SYSTEM-SPEC.md](docs/SWING-TRADING-SYSTEM-SPEC.md).

The detailed build sequence, module structure, data requirements, database design, APIs, tests, deployment, and acceptance gates are in [docs/SWING-TRADING-IMPLEMENTATION-PLAN.md](docs/SWING-TRADING-IMPLEMENTATION-PLAN.md).

## Planned boundaries

- `src/` — strategy, scanner, market data, risk, execution, position management, and journal code.
- `config/` — swing-only, schema-validated configuration.
- `data/` — ignored runtime state and databases; never shared with Bollinger slot state.
- `docs/` — specifications and operating procedures.
- `scripts/` — research, replay, migration, and operational tooling.
- `tests/` — unit, integration, replay, and failure-injection tests.

Scanner implementation is approved. Trading, order placement, and live position management remain unapproved and disabled.

## Scanner commands

Run these commands from this folder:

- `npm run qc:data` validates the read-only momentum source.
- `npm run dev` starts the loopback scanner API on port 3002.
- `npm run scan` runs a freshness-enforced scan.
- `npm run scan:as-of` runs a research scan at the latest locally available session while preserving all unresolved data blocks.
- `npm test` runs deterministic unit and read-only integration tests.

The scanner downloads and validates the official current Nifty MidSmallcap 400 constituent CSV. It reads `data/momentum.db` in SQLite query-only mode and writes scan reports under ignored runtime data. It does not place orders, create GTTs, mutate the Bollinger session, or write to the momentum source.

Authentication is not implemented a second time. The Bollinger process remains the sole Zerodha OAuth/session owner and exposes a read-only broker-data gateway on `127.0.0.1:3003`. Swing has no API credentials, access-token decryption, login, logout, order, or GTT capability. Its UI and API are exposed through the authenticated Bollinger dashboard.

A candidate is not actionable while the output contains any `BLOCKED_DATA_*` reason. In particular, current production publication remains blocked until adjusted-price semantics, current daily freshness, and the Nifty MidSmallcap 400 benchmark are validated.
