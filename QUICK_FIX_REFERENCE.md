# Quick Reference: Bug Locations and Fixes

## Overview Map

```
FILE: src/strategies/bollinger-band/BollingerBandStrategy.ts
═══════════════════════════════════════════════════════════════

┌─ Line 759: getLiveOptionPremium() ─────────────────┐
│ 🔴 BUGGY: Uses fallback price silently             │
│ Fallback: 259.54 (synthetic, not real)             │
│ Impact: Returns bad data as if good                │
└─────────────────────────────────────────────────────┘
           ↓
        Calls: getLastCompletedCandleClose()
           ↓
┌─ Line 3329: getLastCompletedCandleClose() ────────┐
│ Returns 25948 (from 09:25:00 candle, 4min old)    │
│ Used in: 25948 × 0.01 = 259.54 (synthetic)        │
└─────────────────────────────────────────────────────┘
           ↓
       Returns to caller
           ↓
┌─ Line 1943-1979: startLongPositionMonitoring() ───┐
│ Receives: currentPremium = 259.54 (stale)         │
│ Passes to: checkLongExitSimple(259.54)             │
│ 🔴 BUGGY: No validation of price source           │
└─────────────────────────────────────────────────────┘
           ↓
┌─ Line 2899-2956: checkLongExitSimple() ──────────┐
│ 🔴 BUGGY: Uses price without validation           │
│ Compares: 259.54 <= 266.46?                       │
│ Result: YES → EXIT TRIGGERED                      │
│ Reality: Price was actually ~295, not 259.54      │
└─────────────────────────────────────────────────────┘
           ↓
     Position closed on corrupted data
```

---

## Bug #1: Line 759-790 - getLiveOptionPremium()

### Current Code (BUGGY)

```typescript
private async getLiveOptionPremium(instrumentToken: number): Promise<number> {
  if (!instrumentToken) return 0;

  try {
    // Try to fetch real price
    const quote = await this.kiteConnect.getQuote([instrumentToken.toString()]);
    const data = quote[instrumentToken.toString()];

    if (data && data.last_price && data.last_price > 0) {
      return data.last_price;  // ✓ GOOD: Returns real price
    }

    return 0;
  } catch (error) {
    // ❌ BUG STARTS HERE: Error occurred (ECONNABORTED)
    this.logger.error(`Error fetching live premium for token ${instrumentToken}:`, error);

    // ❌ PROBLEM: Falls back to stale data
    const currentNifty = this.getLastCompletedCandleClose();  // Returns 25948
    if (currentNifty > 0) {
      return currentNifty * 0.01;  // Returns 259.48 (4 min old!)
      // ↑ Caller doesn't know this is stale/synthetic
    }

    return 0;
  }
}
```

### What Should Be Done

**Option A: Return 0 on any error**

```typescript
private async getLiveOptionPremium(instrumentToken: number): Promise<number> {
  if (!instrumentToken) return 0;

  try {
    const quote = await this.kiteConnect.getQuote([instrumentToken.toString()]);
    const data = quote[instrumentToken.toString()];

    if (data && data.last_price && data.last_price > 0) {
      return data.last_price;
    }

    return 0;
  } catch (error) {
    this.logger.error(`Error fetching live premium for token ${instrumentToken}:`, error);
    // ✓ FIXED: Return 0 instead of fallback
    // Caller knows: 0 = no data available
    return 0;
  }
}
```

**Option B: Return object with metadata** (Better)

```typescript
interface PriceData {
  value: number;
  source: 'API' | 'FALLBACK' | 'NONE';
  isReal: boolean;
  age: number;  // milliseconds
  error?: string;
}

private async getLiveOptionPremium(instrumentToken: number): Promise<PriceData> {
  if (!instrumentToken) {
    return { value: 0, source: 'NONE', isReal: false, age: 0 };
  }

  const fetchStartTime = Date.now();

  try {
    const quote = await this.kiteConnect.getQuote([instrumentToken.toString()]);
    const data = quote[instrumentToken.toString()];

    if (data && data.last_price && data.last_price > 0) {
      return {
        value: data.last_price,
        source: 'API',
        isReal: true,
        age: Date.now() - fetchStartTime
      };
    }

    return { value: 0, source: 'NONE', isReal: false, age: 0 };
  } catch (error) {
    this.logger.error(`Error fetching live premium for token ${instrumentToken}:`, error);
    // ✓ FIXED: Still return FALLBACK but marked as non-real
    const currentNifty = this.getLastCompletedCandleClose();
    if (currentNifty > 0) {
      return {
        value: currentNifty * 0.01,
        source: 'FALLBACK',
        isReal: false,  // ← Explicitly marked as NOT real
        age: Date.now() - this.lastPriceUpdateTime?.getTime() || 9999,
        error: 'API_ERROR'
      };
    }

    return { value: 0, source: 'NONE', isReal: false, age: 0, error: 'NO_DATA' };
  }
}
```

---

## Bug #2: Line 2899-2956 - checkLongExitSimple()

### Current Code (BUGGY)

```typescript
private async checkLongExitSimple(currentPremium: number, source: 'polling'): Promise<void> {
  if (!this.currentPosition || this.currentPosition.type !== 'LONG') return;

  if (this.isProcessingLongExit) {
    this.logger.debug(`🔒 LONG exit check already in progress`);
    return;
  }

  this.isProcessingLongExit = true;

  try {
    // ❌ BUG: No validation of currentPremium
    // Could be 259.54 (fallback from stale candle)
    // Could be 302.80 (real-time from API)
    // No way to tell!

    if (currentPremium > (this.currentPosition.highestPremium || 0)) {
      // Updates highest premium with potentially stale price
      this.currentPosition.highestPremium = currentPremium;
      // ... logging ...
    }

    if (this.currentPosition.highestPremium) {
      // Calculate SL based on highestPremium
      const simpleSL = this.currentPosition.highestPremium * 0.88;

      if (!this.currentPosition.trailingSL || simpleSL > this.currentPosition.trailingSL) {
        this.currentPosition.trailingSL = simpleSL;
        // ... logging ...
      }
    }

    // ❌ CRITICAL BUG: Exit based on potentially stale price
    if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
      // At 09:34:24:
      // currentPremium = 259.54 (stale fallback)
      // trailingSL = 266.46 (correct)
      // 259.54 <= 266.46? YES → EXIT!

      this.logger.info(`🔴 LONG exit signal: Trailing SL hit (${source})`, {
        currentPremium: currentPremium.toFixed(2),  // 259.54
        trailingSL: this.currentPosition.trailingSL.toFixed(2),  // 266.46
      });

      await this.executeExit(`LONG_TRAILING_SL_${source.toUpperCase()}`);
    }
  } finally {
    this.isProcessingLongExit = false;
  }
}
```

### What Should Be Done

**Add price validation layer**

```typescript
private async checkLongExitSimple(priceData: PriceData, source: 'polling'): Promise<void> {
  if (!this.currentPosition || this.currentPosition.type !== 'LONG') return;

  if (this.isProcessingLongExit) {
    this.logger.debug(`🔒 LONG exit check already in progress`);
    return;
  }

  // ✓ FIXED: Validate price quality FIRST
  if (!priceData.isReal) {
    this.logger.warn(`⚠️ Skipping LONG exit check: Price is ${priceData.source}, not real-time`);

    // Optional: Detect if data is too stale
    if (priceData.age > 5000) {  // > 5 seconds old
      this.logger.warn(`⚠️ Price data is ${priceData.age}ms old, waiting for real-time data`);
    }

    return;  // Skip exit logic
  }

  // Detect unrealistic price moves
  const lastKnownHigh = this.currentPosition.highestPremium || priceData.value;
  const priceDrop = lastKnownHigh - priceData.value;
  const dropPercent = (priceDrop / lastKnownHigh) * 100;

  if (dropPercent > 30) {
    // ✓ FIXED: Require confirmation on huge drops
    this.logger.warn(`⚠️ Suspicious ${dropPercent.toFixed(1)}% drop detected`, {
      lastHigh: lastKnownHigh.toFixed(2),
      current: priceData.value.toFixed(2),
      age: priceData.age,
      source: priceData.source
    });

    // Don't exit immediately, log for manual review
    this.recordAnomalyData(priceData);
    return;  // Skip exit logic
  }

  this.isProcessingLongExit = true;

  try {
    // Rest of the logic...
    const currentPremium = priceData.value;

    if (currentPremium > (this.currentPosition.highestPremium || 0)) {
      this.currentPosition.highestPremium = currentPremium;
      // ... logging ...
    }

    if (this.currentPosition.highestPremium) {
      const simpleSL = this.currentPosition.highestPremium * 0.88;

      if (!this.currentPosition.trailingSL || simpleSL > this.currentPosition.trailingSL) {
        this.currentPosition.trailingSL = simpleSL;
        // ... logging ...
      }
    }

    // Now this is safer because we validated priceData first
    if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
      // ✓ FIXED: Only reached if price is real-time and reasonable

      this.logger.info(`🔴 LONG exit signal: Trailing SL hit (${source})`, {
        currentPremium: currentPremium.toFixed(2),
        trailingSL: this.currentPosition.trailingSL.toFixed(2),
        source: priceData.source,
        priceAge: priceData.age
      });

      await this.executeExit(`LONG_TRAILING_SL_${source.toUpperCase()}`);
    }
  } finally {
    this.isProcessingLongExit = false;
  }
}
```

---

## Bug #3: Line ~1890+ - Polling Loop in startLongPositionMonitoring()

### Current Code (BUGGY)

```typescript
// Somewhere in startLongPositionMonitoring():
const pollOnce = async () => {
  // ... guard clauses ...

  if (this.isPollingInProgress) {
    this.logger.debug("Skipping poll - previous operation still in progress");
    // ❌ BUG: Still schedules next poll with fallback data
    this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
    return;
  }

  this.isPollingInProgress = true;

  try {
    // ❌ Receives potentially stale price (259.54)
    const currentPremium = await this.getLiveOptionPremium(instrumentToken);

    if (currentPremium > 0) {
      this.cachedCurrentPrice = currentPremium;

      // ... calculate P&L ...

      // ❌ Exit check runs with stale price
      await this.checkLongExitSimple(currentPremium, "polling");
      // At 09:34:24, this receives 259.54 and triggers exit
    }
  } catch (error) {
    this.logger.error("Poll error:", error);
    // ❌ Still schedules next poll after error
  } finally {
    // ❌ BUG: Always schedules next poll, even if data is bad
    this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
  }
};
```

### What Should Be Done

**Add circuit breaker and pause logic**

```typescript
private consecutivePollingFailures = 0;
private isExitLogicDisabledDueToErrors = false;

const pollOnce = async () => {
  // ... guard clauses ...

  if (this.isPollingInProgress) {
    this.logger.debug('Skipping poll - previous operation still in progress');

    // ✓ FIXED: Only reschedule if exit logic is NOT disabled
    if (!this.isExitLogicDisabledDueToErrors) {
      this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
    } else {
      this.logger.debug('Exit logic disabled - poll cancelled');
    }
    return;
  }

  this.isPollingInProgress = true;

  try {
    // ✓ FIXED: Now returns object with metadata
    const priceData = await this.getLiveOptionPremium(instrumentToken);

    if (priceData.value > 0) {
      this.cachedCurrentPrice = priceData.value;

      // ... calculate P&L ...

      // ✓ FIXED: Exit check validates price first
      if (!this.isExitLogicDisabledDueToErrors) {
        await this.checkLongExitSimple(priceData, 'polling');
      } else {
        this.logger.debug('Skipping exit check - exit logic is disabled');
      }

      // ✓ FIXED: Reset failure count on success
      if (priceData.source === 'API') {
        this.consecutivePollingFailures = 0;
        if (this.isExitLogicDisabledDueToErrors) {
          this.logger.info('🟢 Exit logic enabled - API recovered');
          this.isExitLogicDisabledDueToErrors = false;
        }
      }
    } else {
      // ✓ FIXED: Count failures
      this.consecutivePollingFailures++;

      if (this.consecutivePollingFailures >= 3) {
        // ✓ FIXED: Disable exit logic after 3 consecutive failures
        if (!this.isExitLogicDisabledDueToErrors) {
          this.logger.warn(`🔴 Disabling exit logic after ${this.consecutivePollingFailures} API failures`);
          this.isExitLogicDisabledDueToErrors = true;
        }
      }
    }

  } catch (error) {
    this.logger.error('Poll error:', error);
    this.consecutivePollingFailures++;

    if (this.consecutivePollingFailures >= 3) {
      if (!this.isExitLogicDisabledDueToErrors) {
        this.logger.warn(`🔴 Disabling exit logic after ${this.consecutivePollingFailures} errors`);
        this.isExitLogicDisabledDueToErrors = true;
      }
    }
  } finally {
    this.isPollingInProgress = false;

    // ✓ FIXED: Only reschedule if exit logic is still working
    if (!this.isExitLogicDisabledDueToErrors || this.consecutivePollingFailures < 3) {
      this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
    } else {
      this.logger.debug('Poll paused - circuit breaker active');
    }
  }
};
```

---

## Summary Table: Bugs and Fixes

| Bug | Location       | Issue                          | Fix                         | Priority    |
| --- | -------------- | ------------------------------ | --------------------------- | ----------- |
| 1   | Line 759-790   | Fallback price used silently   | Return 0 or metadata object | 🔴 CRITICAL |
| 2   | Line 2899-2956 | No price validation            | Validate before exit        | 🔴 CRITICAL |
| 3   | Line ~1890+    | Poll continues on error        | Add circuit breaker         | 🟠 HIGH     |
| 4   | Line 3329-3345 | Stale candle used for estimate | Mark as fallback            | 🟠 HIGH     |

---

## Testing the Fixes

### Test Case 1: API Failure During Position

```
Setup:
  - LONG position at 302.80 high
  - Trailing SL set to 266.46

Event:
  - API returns ECONNABORTED error

Current Behavior (BUGGY):
  - Returns 259.54 (fallback)
  - Exit triggered
  - ❌ WRONG

Fixed Behavior:
  - Returns { value: 0, isReal: false }
  - Exit skipped
  - ✓ CORRECT
```

### Test Case 2: Huge Price Drop Without Ticks

```
Setup:
  - Premium at 302.80
  - Next price update: 259.54 (drop of 43.26!)

Current Behavior (BUGGY):
  - Accepts 259.54
  - Exit triggered
  - ❌ WRONG

Fixed Behavior:
  - Detects 14.3% drop
  - Logs anomaly
  - Waits for confirmation
  - ✓ CORRECT
```

---

## Deployment Checklist

- [ ] Update getLiveOptionPremium() to return metadata
- [ ] Update checkLongExitSimple() to validate price
- [ ] Update polling loop with circuit breaker
- [ ] Update all callers of getLiveOptionPremium()
- [ ] Add unit tests for fallback scenarios
- [ ] Add integration tests for network errors
- [ ] Update logging to show price source
- [ ] Test with simulated ECONNABORTED errors
- [ ] Monitor for false exits post-deployment
- [ ] Document changes for team

---

**This is the complete technical breakdown of the bugs and fixes needed.**
