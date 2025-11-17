# Risk Reduction Plan: 5% → 3% (Breakout Pullback Strategy)

## Deep Analysis Report

## Executive Summary

Complete analysis of Breakout Pullback strategy for reducing risk from 5% (0.05) to 3% (0.03). This report maps the entire data flow, identifies all change locations, and provides comprehensive implementation guidance.

---

## Configuration Data Flow Architecture

### 1. Initialization Flow

```
Application Start (index.ts)
    ↓
BreakoutPullbackStrategy Constructor
    ↓
TradeExecutionService (BreakoutPullbackExecutor) Constructor
    ↓
loadPersistedData()
    ↓
Read: src/data/trading-data.json
    ↓ (if exists)
Load existing config with riskPerTrade
    ↓ (if NOT exists)
Create default config with riskPerTrade: 0.05
    ↓
Store in this.persistedData.config
```

### 2. Configuration Access Flow

```
Dashboard UI Request (/execution)
    ↓
getTradingConfig() → BreakoutPullbackStrategy
    ↓
getTradingConfig() → TradeExecutionService
    ↓
return this.persistedData.config (includes riskPerTrade)
    ↓
Display in UI with fallback values
```

### 3. Configuration Update Flow

```
User edits form at /execution/config
    ↓
POST /execution/config (index.ts:2045)
    ↓
updateTradingConfig(updates) → BreakoutPullbackStrategy
    ↓
updateTradingConfig(updates) → TradeExecutionService
    ↓
Merge: this.persistedData.config = {...config, ...updates}
    ↓
savePersistedData() → Write to trading-data.json
```

### 4. Usage in Trading Flow

```
Trade Signal Detected
    ↓
placeMarketOrder(tradeSetup) → TradeExecutionService
    ↓
calculatePositionSize(stopLossPoints, optionPrice)
    ↓
Extract: const { capital, riskPerTrade } = this.persistedData.config
    ↓
Calculate: maxRiskAmount = capital × riskPerTrade
    ↓
Calculate: maxLots = floor(maxRiskAmount / riskPerLot)
    ↓
Log position sizing details
    ↓
Place order with calculated lots
```

---

## Complete Change Inventory

### File 1: BreakoutPullbackExecutor.ts

**Location**: `src/strategies/breakout-pullback/BreakoutPullbackExecutor.ts`

#### Change 1.1: Type Definition Comment (Line 53)

**Purpose**: Documentation for TradingConfig interface
**Impact**: Documentation only, no functional impact

```typescript
// CURRENT:
riskPerTrade: number; // 5% = 0.05

// CHANGE TO:
riskPerTrade: number; // 3% = 0.03
```

#### Change 1.2: Default Configuration Value (Line 244)

**Purpose**: Default value when no persisted data exists
**Impact**: CRITICAL - Sets initial risk percentage for new installations
**Context**: Inside `loadPersistedData()` method, used when trading-data.json doesn't exist

```typescript
// CURRENT (Line 242-244):
const defaultData: PersistedData = {
  config: {
    capital: 200000,           // ₹2,00,000
    riskPerTrade: 0.05,       // 5%  ← CHANGE THIS
    maxRetries: 3,

// CHANGE TO:
const defaultData: PersistedData = {
  config: {
    capital: 200000,           // ₹2,00,000
    riskPerTrade: 0.03,       // 3%  ← CHANGED
    maxRetries: 3,
```

#### Change 1.3: Position Sizing Comment (Line 418)

**Purpose**: Documentation for calculation logic
**Impact**: Documentation only, calculation uses actual config value
**Context**: Inside `calculatePositionSize()` method

```typescript
// CURRENT:
const maxRiskAmount = capital * riskPerTrade; // ₹10,000 for 5% of ₹2,00,000

// CHANGE TO:
const maxRiskAmount = capital * riskPerTrade; // ₹6,000 for 3% of ₹2,00,000
```

### File 2: Dashboard UI (src/index.ts)

**Location**: `src/index.ts`

All changes are fallback display values when `tradingConfig` is not loaded. These ensure UI shows correct default even during initialization.

#### Change 2.1: Position Size Display (Line 3075)

**Purpose**: Manual order form display
**Context**: Inside manual trade entry form

```typescript
// CURRENT:
<div><strong>Position Size:</strong> Auto-calculated (${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% risk)</div>

// CHANGE TO:
<div><strong>Position Size:</strong> Auto-calculated (${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% risk)</div>
```

#### Change 2.2: Risk per Trade Display (Line 3093)

**Purpose**: Strategy status overview
**Context**: Inside strategy state display section

```typescript
// CURRENT:
<strong>Risk per Trade:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%<br>

// CHANGE TO:
<strong>Risk per Trade:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%<br>
```

#### Change 2.3: Risk Percentage Display (Line 3457)

**Purpose**: Performance metrics section
**Context**: Inside risk management statistics display

```typescript
// CURRENT:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%

// CHANGE TO:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%
```

#### Change 2.4: Capital Risk Display (Line 4491)

**Purpose**: Trade state information panel
**Context**: Inside active trade monitoring display

```typescript
// CURRENT:
<div><strong>Capital Risk:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%</div>

// CHANGE TO:
<div><strong>Capital Risk:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%</div>
```

#### Change 2.5: Per Trade Display (Line 4847)

**Purpose**: Setup visualization panel
**Context**: Inside trade setup details display

```typescript
// CURRENT:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade

// CHANGE TO:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% per trade
```

#### Change 2.6: Capital Risk Display #2 (Line 5085)

**Purpose**: Strategy overview information
**Context**: Inside strategy description section

```typescript
// CURRENT:
<div>• Capital risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade</div>

// CHANGE TO:
<div>• Capital risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% per trade</div>
```

### File 3: Persisted Data (CRITICAL)

**Location**: `src/data/trading-data.json`

#### Change 3.1: Runtime Configuration Update

**Purpose**: Update actual running configuration
**Impact**: CRITICAL - This is the live configuration used by the system
**Current State**:

```json
{
  "config": {
    "capital": 165649.999994,
    "riskPerTrade": 0.05,  // ← Currently set to 5%
    "maxRetries": 3,
    "orderTimeout": 5000,
    "paperTradingMode": false,
    "niftyLotSize": 75
  },
  "tradeHistory": [...],
  "lastUpdated": "..."
}
```

**Two Update Options**:

**Option A: Manual Edit** (Recommended for precision)

1. Stop the application
2. Edit the file directly:
   ```json
   "riskPerTrade": 0.03,  // Changed from 0.05
   ```
3. Restart application

**Option B: Dashboard UI** (User-friendly)

1. Navigate to `/execution/config`
2. Change "Risk per Trade (%)" field from `5.0` to `3.0`
3. Click "💾 Update Configuration"
4. System automatically updates file and applies changes

---

## Files NOT Requiring Changes

### 1. BreakoutPullbackStrategy.ts (4,009 lines)

**Why**: Pure strategy logic with no direct risk configuration

- Contains pivot detection algorithm
- Manages marking candle system
- Handles trade signals
- Delegates configuration to TradeExecutionService via passthrough methods

**Key Evidence**:

```typescript
// Lines 3873-3874: Passthrough getter
public getTradingConfig(): any {
  return this.tradeExecutionService.getTradingConfig();
}

// Lines 3887-3888: Passthrough updater
public updateTradingConfig(updates: any): void {
  this.tradeExecutionService.updateTradingConfig(updates);
}
```

### 2. BreakoutPullbackWrapper.ts (131 lines)

**Why**: Adapter pattern - only bridges to core strategy

- No configuration logic
- No risk management code
- Pure adapter for multi-strategy architecture

### 3. config/strategies.json (66 lines)

**Why**: Strategy registry metadata only

- Contains `"riskPerTrade": 1.0` which is NOT used by executor
- Metadata for strategy manager/registry
- NOT loaded by TradeExecutionService

**Evidence**: No references to this file in Executor or Strategy classes

### 4. Bollinger Band Strategy (3,530 lines)

**Why**: Completely separate strategy

- Uses different position sizing model (1 lot per ₹40,000 capital)
- Independent configuration system
- No shared configuration with Breakout Pullback

---

## Impact Analysis

### Position Sizing Impact

**Current (5%)**:

- Risk amount: ₹10,000 on ₹2,00,000 capital
- Example: 20pt SL = 6-7 lots

**Proposed (3%)**:

- Risk amount: ₹6,000 on ₹2,00,000 capital
- Example: 20pt SL = 4 lots
- **Reduction**: 40% smaller position sizes

### Detailed Example Scenarios

#### Scenario 1: Tight Stop Loss (15 points)

```
Stop Loss: 15 points
Risk per lot: 15 × 75 = ₹1,125

Current (5%):
  Risk amount: ₹10,000
  Max lots: floor(₹10,000 / ₹1,125) = 8 lots (600 units)

Proposed (3%):
  Risk amount: ₹6,000
  Max lots: floor(₹6,000 / ₹1,125) = 5 lots (375 units)

Impact: 37.5% reduction (3 lots fewer)
```

#### Scenario 2: Wide Stop Loss (25 points)

```
Stop Loss: 25 points
Risk per lot: 25 × 75 = ₹1,875

Current (5%):
  Risk amount: ₹10,000
  Max lots: floor(₹10,000 / ₹1,875) = 5 lots (375 units)

Proposed (3%):
  Risk amount: ₹6,000
  Max lots: floor(₹6,000 / ₹1,875) = 3 lots (225 units)

Impact: 40% reduction (2 lots fewer)
```

#### Scenario 3: Recent Trade (21.5 points)

```
Stop Loss: 21.5 points (from recent logs)
Risk per lot: 21.5 × 75 = ₹1,612.50

Current (5%):
  Risk amount: ₹10,000
  Max lots: floor(₹10,000 / ₹1,612.50) = 6 lots (450 units)

Proposed (3%):
  Risk amount: ₹6,000
  Max lots: floor(₹6,000 / ₹1,612.50) = 3 lots (225 units)

Impact: 50% reduction (3 lots fewer)
```

---

## Configuration Form Analysis

### Input Validation (Line 1954)

```typescript
<input type="number" id="riskPerTrade" name="riskPerTrade"
       value="${(tradingConfig.riskPerTrade * 100).toFixed(1)}"
       min="0.5"   // Minimum 0.5%
       max="10"    // Maximum 10%
       step="0.1"  // Increments of 0.1%
       required>
```

**Key Points**:

- User can set any value between 0.5% and 10%
- 3% is well within acceptable range
- Form validates input automatically
- Displays current value from config (not hardcoded)

### Form Processing (Line 1994)

```typescript
riskPerTrade: parseFloat(formData.get('riskPerTrade')) / 100,
```

- Converts percentage (3.0) to decimal (0.03)
- Automatic conversion ensures correct format
- No hardcoded values in processing logic

---

## Deployment Strategy

### Pre-Deployment Checklist

- [ ] Backup current trading-data.json
- [ ] Verify no active positions
- [ ] Review recent trade history
- [ ] Confirm paper trading mode for testing
- [ ] Document current capital state

### Option 1: Conservative Deployment (Recommended)

**Step 1: Backup**

```powershell
# Backup current state
Copy-Item src\data\trading-data.json src\data\trading-data-backup-$(Get-Date -Format 'yyyyMMdd').json

# Verify backup
Get-Content src\data\trading-data-backup-*.json | Select-String "riskPerTrade"
```

**Step 2: Code Changes**

```powershell
# Make changes in order:
# 1. BreakoutPullbackExecutor.ts (3 changes)
# 2. src/index.ts (6 changes)

# Verify changes
Select-String -Path src\strategies\breakout-pullback\BreakoutPullbackExecutor.ts -Pattern "riskPerTrade.*0.03"
(Select-String -Path src\index.ts -Pattern "'3.0'").Count  # Should show 6 lines
```

**Step 3: Update Runtime Config**

```powershell
# Stop application
# Edit src/data/trading-data.json manually:
# Change: "riskPerTrade": 0.05 → "riskPerTrade": 0.03

# Verify change
Get-Content src\data\trading-data.json | Select-String "riskPerTrade"
```

**Step 4: Testing Phase**

```powershell
# Restart in paper trading mode
npm run dev

# Monitor logs for:
# "🎯 Risk per trade: 3.0% = ₹6,000"
# "💰 Current Capital: ₹165,649"
```

**Step 5: Validation**

- Check dashboard shows "3.0%" instead of "5.0%"
- Wait for next trade signal
- Verify position sizing in logs shows reduced lots
- Confirm calculation: maxRiskAmount = capital × 0.03

### Option 2: Quick Deployment (UI-Based)

**Step 1: Deploy Code**

```powershell
# Backup first
Copy-Item src\data\trading-data.json src\data\trading-data-backup-$(Get-Date -Format 'yyyyMMdd').json

# Make code changes (9 locations)
# Restart application
npm run dev
```

**Step 2: Update via Dashboard**

1. Navigate to `http://localhost:3000/execution/config`
2. Locate "Risk per Trade (%)" field
3. Change value from `5.0` to `3.0`
4. Click "💾 Update Configuration"
5. Verify success message
6. Refresh dashboard to confirm change

---

## Testing & Validation

### Unit Test Scenarios

#### Test 1: Default Configuration

```typescript
// Expectation: New installations start with 3% risk
// Validation: Delete trading-data.json, restart, check default
Expected Log: "🎯 Risk per trade: 3.0% = ₹6,000"
```

#### Test 2: Position Sizing Calculation

```typescript
// Given: Capital = ₹200,000, SL = 20 points, riskPerTrade = 0.03
// Expected: 4 lots (300 units)

Expected Logs:
📊 Position Sizing Calculation:
   💰 Capital: ₹2,00,000
   🎯 Risk per trade: 3.0% = ₹6,000  ← Verify this line
   📉 SL Points: 20
   📊 Risk per lot: ₹1,500.00
   ✅ Final lots: 4
```

#### Test 3: UI Fallback Display

```typescript
// Given: tradingConfig = null (during initialization)
// Expected: All displays show "3.0%" instead of "5.0%"
// Validation: Refresh dashboard immediately after start
```

#### Test 4: Configuration Persistence

```powershell
# Given: Update via UI to 3.0%
# Expected: trading-data.json updated immediately
# Validation: Check file contents after update
Get-Content src\data\trading-data.json | Select-String "riskPerTrade"
# Should show: "riskPerTrade": 0.03,
```

### Integration Test Checklist

- [ ] Dashboard loads without errors
- [ ] Configuration form displays 3.0%
- [ ] Manual trade form shows "3.0% risk"
- [ ] Position sizing logs show reduced lots
- [ ] Active trade displays correct risk percentage
- [ ] Performance metrics show 3.0%
- [ ] Configuration update via UI works
- [ ] Restart persists configuration

---

## Rollback Procedures

### Immediate Rollback (Emergency)

```powershell
# Stop application
# Ctrl+C

# Restore backup
Copy-Item src\data\trading-data-backup-*.json src\data\trading-data.json -Force

# Revert code changes
git checkout src\strategies\breakout-pullback\BreakoutPullbackExecutor.ts
git checkout src\index.ts

# Restart
npm run dev

# Verify restoration
Get-Content src\data\trading-data.json | Select-String "riskPerTrade"
# Should show: "riskPerTrade": 0.05,
```

### Partial Rollback (Config Only)

```powershell
# Keep code changes, revert config only
# Edit trading-data.json: change 0.03 → 0.05
# OR use UI: /execution/config, change 3.0 → 5.0
```

### Verification After Rollback

```powershell
# Check logs
Select-String -Path logs\*.log -Pattern "Risk per trade" | Select-Object -Last 5

# Expected: "🎯 Risk per trade: 5.0%"
```

---

## Risk Assessment

### Low Risk Changes

- **UI Fallback Values**: Only affect display during initialization
- **Comments**: Documentation updates have no functional impact

### Medium Risk Changes

- **Default Config Value**: Only affects fresh installations
- **Persisted Data**: Can be easily reverted

### Change Safety Analysis

All changes are **LOW TO MEDIUM RISK** because:

1. **No Algorithm Changes**: Position sizing formula unchanged
2. **Configuration-Based**: Pure data changes, not logic
3. **Easily Reversible**: Simple numeric values
4. **Well-Tested Formula**: Existing calculation logic proven reliable
5. **Gradual Impact**: Only affects new trades, not existing positions

---

## Monitoring & Alerts

### Key Metrics to Watch

**Before Change (5% baseline)**:

```
Average position size: 5-7 lots
Average risk per trade: ₹8,000-₹12,000
Position size range: 3-10 lots (varies by SL)
```

**After Change (3% expected)**:

```
Average position size: 3-4 lots (40% reduction)
Average risk per trade: ₹5,000-₹7,000 (40% reduction)
Position size range: 2-6 lots (varies by SL)
```

### Log Monitoring Commands

```powershell
# Watch position sizing logs
Get-Content -Wait -Tail 50 logs\strategy-*.log | Select-String "Position Sizing"

# Check risk percentage in logs
Select-String -Path logs\*.log -Pattern "Risk per trade" | Select-Object -Last 20

# Monitor lot sizes
Select-String -Path logs\*.log -Pattern "Final lots" | Select-Object -Last 20

# Track capital changes
Select-String -Path logs\*.log -Pattern "Current Capital" | Select-Object -Last 10
```

---

## Summary

### Total Changes Required

- **3 changes** in BreakoutPullbackExecutor.ts
- **6 changes** in src/index.ts
- **1 update** in trading-data.json
- **Total: 10 locations**

### Files Modified

1. `src/strategies/breakout-pullback/BreakoutPullbackExecutor.ts`
2. `src/index.ts`
3. `src/data/trading-data.json`

### Expected Impact

- **Position Size**: 40-50% reduction
- **Risk Per Trade**: ₹10,000 → ₹6,000 (on ₹2L capital)
- **Capital Preservation**: Improved drawdown management
- **Profit Potential**: Reduced but more sustainable

### Implementation Time

- Code changes: 15-20 minutes
- Testing: 30-45 minutes
- Total: ~1 hour (including validation)

---

## Conclusion

This analysis confirms that risk reduction from 5% to 3% requires changes in only **10 specific locations** across **3 files**. The change is straightforward, low-risk, and easily reversible. All changes are configuration values - no algorithmic modifications needed.

**Ready for implementation**: All change locations identified and documented with precise line numbers and contexts.
