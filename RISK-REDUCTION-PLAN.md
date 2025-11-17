# Risk Per Trade Reduction Plan: 5% → 3%

## Overview

Change risk per trade from 5% to 3% across both trading strategies to reduce overall portfolio risk.

---

## Impact Analysis

### Current Risk (5% per strategy):

- **Breakout Pullback Strategy**: 5% of ₹178,816 = ₹8,941 max risk per trade
- **Bollinger Band Strategy**: Uses fixed capital allocation with 1 lot per ₹40,000 (no direct risk %)

### Proposed Risk (3% per strategy):

- **Breakout Pullback Strategy**: 3% of ₹178,816 = ₹5,365 max risk per trade
- **Bollinger Band Strategy**: Keep existing lot calculation (₹40,000 per lot)

### Example Position Size Change:

With 21.5-point stop loss and ₹267 option price:

| Metric           | Current (5%) | Proposed (3%) | Change |
| ---------------- | ------------ | ------------- | ------ |
| Max Risk Amount  | ₹8,941       | ₹5,365        | -40%   |
| Risk per Lot     | ₹1,613       | ₹1,613        | Same   |
| Max Lots (Risk)  | 5 lots       | 3 lots        | -40%   |
| Total Units      | 375          | 225           | -40%   |
| Capital Required | ₹100,163     | ₹60,098       | -40%   |

**Result**: More conservative position sizing, lower capital deployment per trade.

---

## Files to Modify

### 1. **Breakout Pullback Strategy - Default Configuration**

#### File: `src/strategies/breakout-pullback/BreakoutPullbackExecutor.ts`

**Line 244** - Default risk per trade value:

```typescript
// CURRENT:
riskPerTrade: 0.05,       // 5%

// CHANGE TO:
riskPerTrade: 0.03,       // 3%
```

**Line 418** - Comment update (optional):

```typescript
// CURRENT:
const maxRiskAmount = capital * riskPerTrade; // ₹10,000 for 5% of ₹2,00,000

// CHANGE TO:
const maxRiskAmount = capital * riskPerTrade; // ₹6,000 for 3% of ₹2,00,000
```

**Line 53** - Type definition comment (optional):

```typescript
// CURRENT:
riskPerTrade: number; // 5% = 0.05

// CHANGE TO:
riskPerTrade: number; // 3% = 0.03
```

---

### 2. **Strategy Configuration JSON**

#### File: `config/strategies.json`

**Lines 12-13** - Breakout strategy risk:

```json
// CURRENT:
"riskPerTrade": 1.0,

// CHANGE TO:
"riskPerTrade": 0.6,
```

**Note**: This appears to be a different format (1.0 instead of 0.05). Need to verify:

- Is this percentage (1.0%) or decimal (100%)?
- Currently looks like it might be unused or legacy

**Lines 30-31** - Bollinger strategy risk:

```json
// CURRENT:
"riskPerTrade": 0.8,

// CHANGE TO:
"riskPerTrade": 0.5,
```

**Note**: Same format issue - verify actual usage.

---

### 3. **Dashboard UI Fallback Values**

#### File: `src/index.ts`

Multiple locations show fallback value of `5.0%` when config is not loaded:

**Line 3075** - Position size display:

```typescript
// CURRENT:
<div><strong>Position Size:</strong> Auto-calculated (${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% risk)</div>

// CHANGE TO:
<div><strong>Position Size:</strong> Auto-calculated (${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% risk)</div>
```

**Line 3093** - Risk per trade display:

```typescript
// CURRENT:
<strong>Risk per Trade:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%<br>

// CHANGE TO:
<strong>Risk per Trade:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%<br>
```

**Line 3457** - Risk percentage display:

```typescript
// CURRENT:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%

// CHANGE TO:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%
```

**Line 4491** - Capital risk display:

```typescript
// CURRENT:
<div><strong>Capital Risk:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}%</div>

// CHANGE TO:
<div><strong>Capital Risk:</strong> ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}%</div>
```

**Line 4847** - Per trade risk:

```typescript
// CURRENT:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade

// CHANGE TO:
${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% per trade
```

**Line 5085** - Capital risk display:

```typescript
// CURRENT:
<div>• Capital risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '5.0'}% per trade</div>

// CHANGE TO:
<div>• Capital risk: ${tradingConfig ? (tradingConfig.riskPerTrade * 100).toFixed(1) : '3.0'}% per trade</div>
```

---

### 4. **Bollinger Band Strategy** ⚠️

#### File: `src/strategies/bollinger-band/BollingerBandStrategy.ts`

**Current Implementation**: Uses a **different position sizing model**:

- Line 83: `const lotsPerCapital = Math.floor(this.currentCapital / 40000);`
- **1 lot per ₹40,000 of capital** (not risk-based)

**Options:**

**Option A: Keep Current Model (Recommended)**

- Bollinger uses simple capital-based allocation
- Already conservative (1 lot per ₹40K = 2.5 lots for ₹100K)
- No changes needed

**Option B: Implement Risk-Based Sizing**

- Would require significant refactoring
- Need to calculate risk based on entry price and stop loss
- More complex but consistent with Breakout strategy

**Recommendation**: Keep Bollinger's current model. It's already conservative and works independently.

---

### 5. **Strategy Manager Defaults** (Legacy/Unused?)

#### File: `src/core/StrategyManager.ts`

**Line 288** - Breakout strategy:

```typescript
// CURRENT:
riskPerTrade: 1.0,

// CHANGE TO:
riskPerTrade: 0.6,
```

**Line 305** - Bollinger strategy:

```typescript
// CURRENT:
riskPerTrade: 0.8,

// CHANGE TO:
riskPerTrade: 0.5,
```

**Note**: These appear to be **unused legacy values**. Verify if StrategyManager is actually used.

---

### 6. **Persisted Data Files** 🚨

#### File: `data/strategy/strategy-state.json` (if exists)

**Action Required**: Manual update or delete and restart

If the Breakout strategy has already saved its config with `riskPerTrade: 0.05`, the default value won't apply. You'll need to either:

**Option A: Delete the file**

```bash
# On VM or local
rm data/strategy/strategy-state.json
# Strategy will recreate with new defaults
```

**Option B: Manually edit the JSON**

```json
{
  "config": {
    "riskPerTrade": 0.03,  // Change from 0.05 to 0.03
    ...
  }
}
```

**Option C: Use Dashboard UI**

- After code changes, use the config form to update risk per trade to 3%
- This will overwrite the persisted value

---

## Implementation Steps

### Step 1: Code Changes (in order)

1. ✅ Update `BreakoutPullbackExecutor.ts` line 244: `0.05` → `0.03`
2. ✅ Update `BreakoutPullbackExecutor.ts` line 418 comment (optional)
3. ✅ Update `src/index.ts` all fallback values: `'5.0'` → `'3.0'` (6 locations)
4. ⚠️ Verify `config/strategies.json` format and update if used
5. ⚠️ Verify `StrategyManager.ts` if used, update lines 288 & 305

### Step 2: Clear Persisted State

```bash
# Option 1: Delete persisted state (safest)
rm data/strategy/strategy-state.json

# Option 2: Manually edit the JSON file
# Change "riskPerTrade": 0.05 to "riskPerTrade": 0.03
```

### Step 3: Rebuild & Deploy

```bash
npm run build
# Then deploy to VM or restart locally
```

### Step 4: Verification

1. Check dashboard shows 3.0% risk
2. Verify next trade uses 3% risk calculation
3. Monitor position sizes are ~40% smaller
4. Check logs show correct risk amounts

---

## Testing Plan

### Before Deployment:

1. Update code files
2. Build project: `npm run build`
3. Run locally with test account
4. Verify dashboard shows 3% risk
5. Check position sizing calculation in logs

### After Deployment:

1. Monitor first trade entry
2. Verify position size is reduced (~3 lots instead of 5 for similar setup)
3. Check risk amount: Should be 3% of capital
4. Confirm no errors in logs

---

## Rollback Plan

If you need to revert to 5% risk:

1. Change `0.03` back to `0.05` in `BreakoutPullbackExecutor.ts`
2. Change `'3.0'` back to `'5.0'` in `src/index.ts` (6 locations)
3. Rebuild and redeploy
4. Or manually update via dashboard UI

---

## Notes & Considerations

### ✅ Pros of 3% Risk:

- More conservative position sizing
- Larger cushion for consecutive losses
- Lower capital deployment per trade
- Better for volatile market conditions
- Reduces emotional pressure

### ⚠️ Cons of 3% Risk:

- Lower profit potential per trade
- May take longer to recover from losses
- Slower capital growth in winning streaks
- Might miss opportunities due to smaller positions

### 📊 Expected Results:

With ₹178,816 capital and 21.5-point SL:

- **Position size**: 5 lots → 3 lots (40% reduction)
- **Capital usage**: ₹100K → ₹60K (40% reduction)
- **Max loss per trade**: ₹8,941 → ₹5,365 (40% reduction)

### 🎯 Break-Even Analysis:

- **At 5% risk**: Need 20 winning trades to recover from 1 max loss
- **At 3% risk**: Need 33 winning trades to recover from 1 max loss
- But with 40% smaller positions, risk of max loss is also reduced

---

## Summary

**Total Changes Required**:

- 3 lines in `BreakoutPullbackExecutor.ts`
- 6 fallback values in `src/index.ts`
- Verification of 2 legacy config files
- Manual cleanup of persisted state

**Impact**:

- 40% reduction in position size for Breakout strategy
- No change to Bollinger strategy (already uses different model)
- Lower risk per trade, more conservative approach

**Difficulty**: Low - mostly numerical value changes

**Testing Required**: High - verify position sizing calculations work correctly
