# NIFTY Trading Bot - QC Testing Checklist

**Document Version**: v1.0  
**Created**: October 3, 2025  
**Last Updated**: October 3, 2025  
**Purpose**: Standardized quality control testing protocol for comprehensive system validation

---

## 📋 **PRE-QC PREPARATION**

### **Environment Setup**

- [ ] Trading bot server running on localhost:3000
- [ ] All log files accessible (logs/trading.log, logs/error.log)
- [ ] Data persistence files present (data/trading-data.json, data/auth/session.json)
- [ ] PowerShell terminal available for API testing
- [ ] Network connectivity to Zerodha APIs confirmed

### **Documentation Preparation**

- [ ] Bugs.md file cleaned and ready for updates
- [ ] Previous QC results archived
- [ ] Testing tools and scripts prepared

---

## 🔍 **QC TEST SUITE**

## **1. Authentication Flow Testing** ✅

### **Test 1.1: Session Status Validation**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/auth/status" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `authenticated: True`
- [ ] Valid user name displayed
- [ ] Session persistence enabled
- [ ] Valid expiry time (future date)
- [ ] Login time recorded

### **Test 1.2: Session Persistence Files**

```powershell
Test-Path "data\auth\session.json"
```

**Expected Results:**

- [ ] Session file exists
- [ ] File has recent modification time
- [ ] File size > 0 bytes

### **Test 1.3: Zerodha API Access**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/portfolio" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] Portfolio data returned successfully
- [ ] Holdings array present
- [ ] Positions data present
- [ ] No authentication errors

**Pass Criteria**: All authentication endpoints functional, session persistence working, Zerodha API access confirmed

---

## **2. Strategy Initialization Testing** ✅

### **Test 2.1: Contract Loading**

```powershell
# Start strategy first
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/start" -Method POST -UseBasicParsing
# Then check contract
Invoke-WebRequest -Uri "http://localhost:3000/strategy/nifty/contract" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `success: True`
- [ ] Valid NIFTY futures contract (current month)
- [ ] Contract has instrument_token, tradingsymbol, expiry
- [ ] Lot size: 75

### **Test 2.2: Strategy Status Check**

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
$status.strategy_state | Select-Object isActive,currentContract,tradeState
```

**Expected Results:**

- [ ] `strategy_active: True`
- [ ] Current contract populated with valid data
- [ ] Trade state: `waiting_for_breakout`
- [ ] Candle count > 300 (historical data loaded)

### **Test 2.3: QC-4 State Validation Check**

```powershell
Get-Content "logs/trading.log" | Select-String -Pattern "Starting trade state validation|validation.*passed|stale" | Select-Object -Last 5
```

**Expected Results:**

- [ ] "Starting trade state validation sync check..." log present
- [ ] Either "validation passed" OR "stale signal cleared" message
- [ ] No orphaned trade IDs detected
- [ ] Clean state transition completed

**Pass Criteria**: Contract loading successful, historical data restored, QC-4 validation working, strategy active

---

## **3. Price Streaming System Testing** ✅

### **Test 3.1: Streaming Health Check**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/streaming-health" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `success: True`
- [ ] `strategy_streaming_active: True`
- [ ] `has_live_price: True`
- [ ] `price_age_seconds: 0` (or very low)
- [ ] Valid last_price and volume data

### **Test 3.2: Polling Health Validation**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/polling-health" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `status: HEALTHY`
- [ ] Success rate > 99%
- [ ] `consecutiveFailures: 0`
- [ ] `circuitBreakerOpen: False`
- [ ] Race condition protection active

### **Test 3.3: Price Data Consistency**

```powershell
for ($i=1; $i -le 3; $i++) {
    $price = (Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json).live_price
    Write-Host "Reading $i : ₹$($price.last_price) | Volume: $($price.volume) | Timestamp: $($price.timestamp)"
    Start-Sleep 2
}
```

**Expected Results:**

- [ ] Prices updating consistently
- [ ] Timestamps incrementing (live data)
- [ ] Volume data present and logical
- [ ] No stale data (same timestamp across readings)

### **Test 3.4: Memory Management**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/memory-info" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `memoryOptimized: True`
- [ ] Candle count at or near `maxAllowed`
- [ ] No memory leaks indicated

**Pass Criteria**: >99% polling success rate, real-time data flowing, memory optimized, health monitoring operational

---

## **4. Breakout Detection Logic Testing** ✅

### **Test 4.1: Pivot Point Analysis**

```powershell
Get-Content "logs/trading.log" | Select-String -Pattern "pivot|PIVOT|Pivot" | Select-Object -Last 10
```

**Expected Results:**

- [ ] "Pivot analysis complete (15,15)" messages every 5 minutes
- [ ] Latest Pivot HIGH and LOW values present
- [ ] Scheduled pivot detection timing accurate
- [ ] Analysis covers sufficient historical data

### **Test 4.2: Current Pivot Status**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/pivots" -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `success: True`
- [ ] `strategy_active: True`
- [ ] Pivot data structure present (may be empty during after-hours)

### **Test 4.3: Breakout Detection Status**

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
Write-Host "Breakout Detection Active: $($status.breakout_detection_active)"
Write-Host "Trade State: $($status.trade_state)"
Write-Host "Latest Signal: $($status.latest_breakout_signal)"
```

**Expected Results:**

- [ ] `breakout_detection_active: True`
- [ ] `trade_state: waiting_for_breakout` (when no active trades)
- [ ] `latest_breakout_signal: null/empty` (clean state)

**Pass Criteria**: 15,15 pivot algorithm operational, breakout detection active, clean trade state

---

## **5. Trade Execution Flow Testing** ✅

### **Test 5.1: Execution Service Status**

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
$status.execution_status
```

**Expected Results:**

- [ ] `hasActivePosition: False` (when no trades)
- [ ] `currentCapital` > 0 (available funds)
- [ ] `totalTrades` >= 0 (historical count)
- [ ] `paperTradingMode` matches configuration

### **Test 5.2: Risk Management Configuration**

```powershell
$data = Get-Content "data/trading-data.json" | ConvertFrom-Json
$data.config
```

**Expected Results:**

- [ ] `riskPerTrade` between 0.01-0.10 (1%-10%)
- [ ] `maxRetries` >= 3
- [ ] `orderTimeout` reasonable (3000-10000ms)
- [ ] `niftyLotSize: 75`

### **Test 5.3: Position State Validation**

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
Write-Host "Active Position: $($status.active_position)"
Write-Host "Current Trade ID: $($status.current_trade_id)"
Write-Host "Trade Setup: $($status.trade_setup)"
```

**Expected Results:**

- [ ] All fields empty when no active trades
- [ ] No orphaned positions or trade IDs
- [ ] Clean state alignment

**Pass Criteria**: Trade execution service operational, risk management configured, clean position state

---

## **6. Manual Exit Integration Testing (QC-3 Validation)** ✅

### **Test 6.1: Manual Exit Endpoint**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/execution/manual-exit" -Method POST -UseBasicParsing | ConvertFrom-Json
```

**Expected Results:**

- [ ] `success: True`
- [ ] Message: "Manual exit executed successfully"
- [ ] No server errors or crashes
- [ ] Appropriate handling of no-position scenario

### **Test 6.2: Strategy Integration Logs**

```powershell
Get-Content "logs/trading.log" | Select-String -Pattern "Manual exit|manual exit" | Select-Object -Last 5
```

**Expected Results:**

- [ ] "Manual exit requested" log entry
- [ ] "Processing manual exit - Current state:" log entry
- [ ] Appropriate state handling (warning if no active trade)
- [ ] No error messages or exceptions

### **Test 6.3: State Synchronization Check**

After manual exit, verify strategy state is properly updated:

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
Write-Host "Trade State: $($status.trade_state)"
```

**Expected Results:**

- [ ] Trade state transitions appropriately
- [ ] No stale trade IDs remain
- [ ] Strategy ready for new signals

**Pass Criteria**: Manual exit endpoint functional, strategy state synchronization working, no crashes

---

## **7. State Synchronization Testing (QC-4 Validation)** ✅

### **Test 7.1: Startup Validation Logs**

```powershell
Get-Content "logs/trading.log" | Select-String -Pattern "Starting trade state validation|validation.*passed|stale" | Select-Object -Last 10
```

**Expected Results:**

- [ ] "Starting trade state validation sync check..." on every restart
- [ ] Either "validation passed" OR stale signal cleanup messages
- [ ] No orphaned trade ID errors
- [ ] Clean state ready for breakout detection

### **Test 7.2: Cross-System State Alignment**

```powershell
$status = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/status" -UseBasicParsing | ConvertFrom-Json
Write-Host "Strategy Trade State: $($status.trade_state)"
Write-Host "Strategy Trade ID: $($status.current_trade_id)"
Write-Host "Execution Has Position: $($status.execution_status.hasActivePosition)"
Write-Host "Breakout Signal: $($status.latest_breakout_signal)"
```

**Expected Results:**

- [ ] All systems show consistent state
- [ ] No trade ID mismatches between Strategy and Execution
- [ ] Clean breakout signal state
- [ ] Perfect synchronization

### **Test 7.3: Restart State Validation**

```powershell
# Stop and restart strategy to trigger QC-4 validation
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/stop" -Method POST
Start-Sleep 2
Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/start" -Method POST
```

**Expected Results:**

- [ ] Strategy restarts successfully
- [ ] QC-4 validation logs appear
- [ ] No phantom trade detection
- [ ] Clean state after restart

**Pass Criteria**: QC-4 validation executing on startup, state synchronization perfect, phantom trade prevention working

---

## **8. Dashboard UI & Controls Testing** ✅

### **Test 8.1: Main Dashboard**

```powershell
$response = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing
Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Content Length: $($response.Content.Length) bytes"
```

**Expected Results:**

- [ ] HTTP Status Code: 200
- [ ] Content length > 15KB (substantial UI)
- [ ] No loading errors

### **Test 8.2: All Endpoint Health Check**

```powershell
$endpoints = @('/health', '/auth/status', '/portfolio', '/breakout-strategy/status', '/breakout-strategy/pivots', '/breakout-strategy/streaming-health', '/breakout-strategy/memory-info', '/breakout-strategy/polling-health')
foreach ($endpoint in $endpoints) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000$endpoint" -UseBasicParsing
        Write-Host "$endpoint : $($response.StatusCode) ✅"
    } catch {
        Write-Host "$endpoint : ERROR ❌"
    }
}
```

**Expected Results:**

- [ ] All 8 endpoints return HTTP 200
- [ ] No timeout errors
- [ ] JSON responses valid

### **Test 8.3: Strategy Controls**

```powershell
# Test stop/start cycle
$stop = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/stop" -Method POST -UseBasicParsing | ConvertFrom-Json
$start = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/start" -Method POST -UseBasicParsing | ConvertFrom-Json
Write-Host "STOP: $($stop.success) - START: $($start.success)"
```

**Expected Results:**

- [ ] Both operations return `success: True`
- [ ] Response time < 5 seconds each
- [ ] No server errors

**Pass Criteria**: Dashboard loading successfully, all endpoints operational, strategy controls working

---

## **9. Error Handling & Recovery Testing** ⚠️

### **Test 9.1: Invalid Endpoint Handling**

```powershell
try {
    Invoke-WebRequest -Uri "http://localhost:3000/invalid-endpoint" -UseBasicParsing
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode)"
}
```

**Expected Results:**

- [ ] HTTP 404 NotFound returned
- [ ] Server remains stable
- [ ] No crashes or exceptions

### **Test 9.2: Network Resilience**

Monitor polling health during network stress:

```powershell
$health = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/polling-health" -UseBasicParsing | ConvertFrom-Json
$health.polling_health
```

**Expected Results:**

- [ ] Success rate > 95% even under stress
- [ ] Circuit breaker functioning
- [ ] Automatic recovery mechanisms active

### **Test 9.3: Data Corruption Recovery**

Check system behavior with invalid data scenarios:
**Expected Results:**

- [ ] Graceful error handling
- [ ] Automatic data validation
- [ ] Recovery to clean state

**Pass Criteria**: Robust error handling, network resilience, graceful degradation

---

## **10. System Performance Testing** ⚠️

### **Test 10.1: Memory Usage**

```powershell
$memory = Invoke-WebRequest -Uri "http://localhost:3000/breakout-strategy/memory-info" -UseBasicParsing | ConvertFrom-Json
$memory.memory_optimization
```

**Expected Results:**

- [ ] Memory optimized: True
- [ ] Candle count at limits (no memory leaks)
- [ ] Efficient resource usage

### **Test 10.2: CPU Performance**

Monitor system performance during high activity:
**Expected Results:**

- [ ] CPU usage reasonable (<50% sustained)
- [ ] Response times consistent
- [ ] No performance degradation over time

### **Test 10.3: Logging Efficiency**

```powershell
Get-ChildItem "logs/*.log" | Select-Object Name,Length,LastWriteTime
```

**Expected Results:**

- [ ] Log files updating regularly
- [ ] File sizes reasonable (not excessive)
- [ ] Log rotation functioning (if implemented)

**Pass Criteria**: Efficient resource usage, consistent performance, proper logging

---

## 📊 **QC COMPLETION CHECKLIST**

### **Final Validation Steps**

- [ ] All 10 test sections completed
- [ ] Pass/fail status recorded for each test
- [ ] Any new issues documented in Bugs.md
- [ ] Performance metrics recorded
- [ ] System stability confirmed over testing period

### **Documentation Updates**

- [ ] Bugs.md updated with QC completion status
- [ ] Any new issues added to bug tracking
- [ ] QC results summary completed
- [ ] Next QC schedule determined

### **Production Readiness Assessment**

- [ ] **Critical Issues**: Count = 0
- [ ] **High Priority Issues**: Count = 0
- [ ] **System Performance**: Acceptable
- [ ] **State Management**: Working correctly
- [ ] **Error Recovery**: Robust

---

## 🎯 **PASS/FAIL CRITERIA**

### **MUST PASS (Production Blockers)**

- [ ] Authentication working (Test 1)
- [ ] Strategy initialization successful (Test 2)
- [ ] Price streaming >99% success rate (Test 3)
- [ ] QC-3 manual exit integration working (Test 6)
- [ ] QC-4 state synchronization working (Test 7)
- [ ] Dashboard controls functional (Test 8)

### **SHOULD PASS (Performance Standards)**

- [ ] Breakout detection operational (Test 4)
- [ ] Trade execution system ready (Test 5)
- [ ] Error handling robust (Test 9)
- [ ] Performance acceptable (Test 10)

### **OVERALL PRODUCTION READINESS**

- [ ] ✅ **APPROVED**: All critical tests pass, system ready for live trading
- [ ] ⚠️ **CONDITIONAL**: Minor issues present, approved with limitations
- [ ] ❌ **REJECTED**: Critical issues present, deployment blocked

---

## 📝 **QC EXECUTION LOG**

**QC Performed By**: **********\_\_\_\_**********  
**QC Date**: **********\_\_\_\_**********  
**QC Duration**: **********\_\_\_\_**********  
**Overall Result**: **********\_\_\_\_**********

**Notes**:

```
[Space for QC notes, issues found, and recommendations]
```

---

**Document Control**:

- **Next Review Date**: **********\_\_\_\_**********
- **Document Owner**: Trading Bot Development Team
- **Approval Required**: Yes (for production deployment)

_This checklist ensures comprehensive validation of all critical trading bot systems before production deployment._
