# Monitoring & Debugging Endpoints

**Purpose**: Quick reference guide for production monitoring endpoints  
**Last Updated**: November 21, 2025

---

## Overview

These 3 endpoints provide critical debugging capabilities during live trading without cluttering the production UI. All endpoints are safe to use during active trading sessions.

---

## 1. WebSocket Health Monitor

### Endpoint

```
GET /breakout-strategy/streaming-health
```

### Purpose

Real-time health monitoring for WebSocket price streaming

### Returns

```json
{
  "streaming": true/false,
  "priceAge": 1234,  // milliseconds since last price update
  "lastPrice": 26150.25,
  "marketHours": true/false,
  "strategyActive": true/false,
  "candleCount": 75,
  "ongoingCandles": 5,
  "timestamp": "2025-11-21T10:30:00.000Z"
}
```

### Use Cases

- ✅ Diagnose WebSocket connection issues
- ✅ Check if prices are stale (priceAge > 5000ms indicates problem)
- ✅ Verify streaming is active during market hours
- ✅ Monitor candle data accumulation

### Example Usage

```bash
# PowerShell
curl http://localhost:3000/breakout-strategy/streaming-health

# Browser
http://localhost:3000/breakout-strategy/streaming-health
```

### Risk Level

🟢 **ZERO RISK** - Read-only, no state modification

---

## 2. Manual Pivot Detection Trigger

### Endpoint

```
POST /breakout-strategy/trigger-pivot-detection
```

### Purpose

Manually trigger pivot level recalculation without restarting strategy

### Returns

```json
{
  "success": true,
  "message": "Pivot detection triggered successfully",
  "pivots": {
    "pp": 26167.33,
    "r1": 26271.47,
    "s1": 26088.02,
    "r2": 26375.61,
    "s2": 25983.88
  },
  "dailyOHLC": {
    "date": "2025-11-19",
    "open": 26115.5,
    "high": 26245.3,
    "low": 26089.35,
    "close": 26167.35
  },
  "timestamp": "2025-11-21T10:30:00.000Z"
}
```

### Use Cases

- ✅ Refresh pivots after market data anomaly
- ✅ Verify pivot calculation logic
- ✅ Update pivots without strategy restart
- ✅ Debug pivot-related trading decisions

### Example Usage

```bash
# PowerShell
curl -X POST http://localhost:3000/breakout-strategy/trigger-pivot-detection

# JavaScript (fetch)
fetch('http://localhost:3000/breakout-strategy/trigger-pivot-detection', {
  method: 'POST'
}).then(r => r.json()).then(console.log);
```

### Risk Level

🟢 **ZERO RISK** - Isolated function, doesn't affect running strategy

### Notes

- Requires authentication (valid Zerodha session)
- Safe to use during live trading
- Pivot changes apply immediately to strategy logic

---

## 3. Candle Data Inspector

### Endpoint

```
GET /breakout-strategy/one-minute-candles
```

### Purpose

Returns raw 1-minute candle buffer for quality verification

### Returns

```json
{
  "success": true,
  "candles": [
    {
      "timestamp": "2025-11-21T09:15:00.000Z",
      "open": 26150.25,
      "high": 26152.75,
      "low": 26148.0,
      "close": 26150.5,
      "volume": 125000
    }
    // ... up to 5 candles (last 5 minutes)
  ],
  "candleCount": 5,
  "timestamp": "2025-11-21T10:30:00.000Z"
}
```

### Use Cases

- ✅ Verify candle building logic
- ✅ Check OHLC data quality
- ✅ Debug candle timestamp alignment
- ✅ Validate volume data accuracy

### Example Usage

```bash
# PowerShell
curl http://localhost:3000/breakout-strategy/one-minute-candles

# Browser
http://localhost:3000/breakout-strategy/one-minute-candles
```

### Risk Level

🟢 **ZERO RISK** - Read-only data access

### Notes

- Returns last 5 minutes of 1-minute candles
- Useful for verifying 5-minute candle consolidation
- Compare with TradingView for accuracy verification

---

## Production Usage Guidelines

### When to Use These Endpoints

**During Market Hours:**

1. ✅ Streaming health checks (every few minutes)
2. ✅ Pivot verification (once per day, or after anomaly)
3. ✅ Candle quality checks (when suspicious price action)

**During Development:**

1. ✅ Testing pivot calculation changes
2. ✅ Verifying candle building logic
3. ✅ Diagnosing WebSocket reliability

### When NOT to Use

- ❌ Don't spam endpoints (rate limiting may apply in future)
- ❌ Don't use for automated trading decisions (use strategy state API instead)
- ❌ Don't rely on these for critical alerts (use proper monitoring instead)

---

## Integration Examples

### 1. Health Check Script (PowerShell)

```powershell
# Check streaming health every 5 minutes
while ($true) {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/breakout-strategy/streaming-health"

    if ($health.priceAge -gt 5000) {
        Write-Host "WARNING: Price data is stale!" -ForegroundColor Red
    }

    if (-not $health.streaming) {
        Write-Host "WARNING: Streaming is not active!" -ForegroundColor Red
    }

    Write-Host "Health: OK - Last price: $($health.lastPrice), Age: $($health.priceAge)ms" -ForegroundColor Green

    Start-Sleep -Seconds 300  # 5 minutes
}
```

### 2. Pivot Verification Script (PowerShell)

```powershell
# Trigger pivot detection and display results
$pivots = Invoke-RestMethod -Uri "http://localhost:3000/breakout-strategy/trigger-pivot-detection" -Method POST

Write-Host "Pivot Levels:" -ForegroundColor Cyan
Write-Host "  PP: $($pivots.pivots.pp)"
Write-Host "  R1: $($pivots.pivots.r1)"
Write-Host "  S1: $($pivots.pivots.s1)"
Write-Host "  Based on: $($pivots.dailyOHLC.date)"
```

### 3. Candle Quality Check (PowerShell)

```powershell
# Check if candles are building correctly
$candles = Invoke-RestMethod -Uri "http://localhost:3000/breakout-strategy/one-minute-candles"

Write-Host "Recent 1-min candles:" -ForegroundColor Cyan
$candles.candles | ForEach-Object {
    Write-Host "  $($_.timestamp): O=$($_.open) H=$($_.high) L=$($_.low) C=$($_.close) V=$($_.volume)"
}
```

---

## Comparison with Removed Endpoints

### What Was Removed

- ❌ `/debug/access-token` - Token comparison (not needed)
- ❌ `/debug/pivots` - Complex OHLC verification (redundant)
- ❌ `/debug/instrument/:token` - Instrument verification (not used)
- ❌ `/debug/instruments` - NIFTY instruments list (not needed)
- ❌ `/debug/quote/:symbol` - Quote fetching test (redundant)
- ❌ `/test/*` - All test endpoints (10 endpoints)

### What Was Kept (3 Endpoints)

- ✅ **Streaming health** - Critical for production monitoring
- ✅ **Pivot trigger** - Useful for manual refresh
- ✅ **Candle inspector** - Useful for data quality checks

**Rationale**: These 3 endpoints provide high value with zero risk, while removed endpoints were either redundant or test-only.

---

## Security Notes

### Authentication

All endpoints require valid Zerodha session:

- Endpoint will return 401 if not authenticated
- Use `/auth/login` to authenticate first
- Session persists for 24 hours

### Rate Limiting

Currently no rate limiting, but best practices:

- Don't call more than once per minute per endpoint
- Use for debugging, not automated monitoring
- Consider implementing proper monitoring solution for production

### Data Privacy

- Endpoints return your own trading data only
- No sensitive credentials exposed
- All data transmitted over localhost (no external access)

---

## Future Enhancements (Optional)

### 1. Unified Monitoring Dashboard

Create a single page using these 3 endpoints:

```
GET /breakout-strategy/monitoring
```

Returns: Combined health + pivots + candles view

### 2. WebSocket Health Alerts

Add endpoint to subscribe to health notifications:

```
POST /breakout-strategy/health-alerts/subscribe
```

### 3. Historical Pivot Data

Add endpoint to retrieve pivot history:

```
GET /breakout-strategy/pivots/history?days=7
```

---

## Troubleshooting

### Streaming Health Shows `streaming: false`

**Possible Causes:**

1. Strategy not started (use `/breakout-strategy/start`)
2. Outside market hours (9:15 AM - 3:30 PM IST)
3. WebSocket connection failed (check logs)

**Solution:**

```bash
# Check strategy status
curl http://localhost:3000/breakout-strategy/status

# Restart strategy if needed
curl -X POST http://localhost:3000/breakout-strategy/start
```

### High Price Age (> 5000ms)

**Possible Causes:**

1. Network connectivity issues
2. Zerodha API rate limiting
3. WebSocket disconnected

**Solution:**
Check logs for WebSocket errors, restart if needed

### Pivot Detection Fails

**Possible Causes:**

1. No historical data available
2. Market closed (no recent trading day)
3. Authentication expired

**Solution:**
Re-authenticate and wait for market hours

---

## Related Documentation

- **Strategy Documentation**: `src/strategies/breakout-pullback/STRATEGY-DOCUMENTATION.md`
- **Implementation Report**: `TEST-ENDPOINT-REMOVAL-IMPLEMENTATION-COMPLETE.md`
- **Removal Plan**: `TEST-ENDPOINT-REMOVAL-PLAN.md`

---

**For Support**: Check application logs at `logs/` directory  
**Dashboard**: http://localhost:3000/breakout-strategy
