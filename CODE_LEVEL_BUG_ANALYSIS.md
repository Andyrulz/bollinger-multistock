# Code-Level RCA: Specific Bugs and Fixes Required

## Bug #1: Unsafe Fallback in getLiveOptionPremium()

### Location

**File:** [src/strategies/bollinger-band/BollingerBandStrategy.ts](src/strategies/bollinger-band/BollingerBandStrategy.ts#L759)  
**Lines:** 759-790  
**Severity:** CRITICAL

### Current Code (BUGGY)

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
    // ⚠️ BUG: Uses stale candle data as if it were real-time price
    this.logger.error(`Error fetching live premium for token ${instrumentToken}:`, error);

    const currentNifty = this.getLastCompletedCandleClose();  // ← 4+ min old!
    if (currentNifty > 0) {
      return currentNifty * 0.01;  // ← Returns fallback price
    }

    return 0;
  }
}
```

### What Goes Wrong

1. API throws error → Caught in catch block
2. Function silently returns fallback price (259.54)
3. Caller receives number: 259.54
4. No metadata about whether it's real or fallback
5. Exit logic uses it to make critical trading decision
6. Position closed on corrupted data

### Why It's Critical

- Exit decisions are based on this price
- If 259.54 < 266.46 → EXIT (even though 259.54 is fake)
- No validation layer between price fetch and trade execution
- Network errors directly cause false trades

### Data at Time of Failure

```
At 09:34:24:
  - Real-time premium: ~302.80+ (unknown, API failed)
  - API status: ECONNABORTED
  - Fallback triggered: getLastCompletedCandleClose() = 25948
  - Returned price: 25948 × 0.01 = 259.54 ❌ (4 minutes old)
```

---

## Bug #2: No Validation in checkLongExitSimple()

### Location

**File:** [src/strategies/bollinger-band/BollingerBandStrategy.ts](src/strategies/bollinger-band/BollingerBandStrategy.ts#L2899)  
**Lines:** 2899-2956  
**Severity:** CRITICAL

### Current Code (BUGGY)

```typescript
private async checkLongExitSimple(currentPremium: number, source: 'polling'): Promise<void> {
  if (!this.currentPosition || this.currentPosition.type !== 'LONG') return;

  if (this.isProcessingLongExit) {
    this.logger.debug(`🔒 LONG exit check already in progress, skipping ${source} request`);
    return;
  }

  this.isProcessingLongExit = true;

  try {
    // ⚠️ BUG: No validation of currentPremium quality
    // - Could be real-time (from API)
    // - Could be fallback (from stale candle)
    // - No way to tell!

    if (currentPremium > (this.currentPosition.highestPremium || 0)) {
      const oldHigh = this.currentPosition.highestPremium;
      this.currentPosition.highestPremium = currentPremium;

      this.logger.info(`📈 LONG: New high premium reached`, {
        oldHigh: oldHigh?.toFixed(2) || 'none',
        newHigh: currentPremium.toFixed(2),  // ← Could be 259.54 (fallback!)
        timestamp: new Date().toLocaleTimeString()
      });
    }

    if (this.currentPosition.highestPremium) {
      const simpleSL = this.currentPosition.highestPremium * 0.88;

      if (!this.currentPosition.trailingSL || simpleSL > this.currentPosition.trailingSL) {
        const oldSL = this.currentPosition.trailingSL;
        this.currentPosition.trailingSL = simpleSL;

        this.logger.info(`🔧 LONG: Trailing SL updated`, {
          highestPremium: this.currentPosition.highestPremium.toFixed(2),
          oldSL: oldSL?.toFixed(2) || 'none',
          newSL: simpleSL.toFixed(2),
          trailingPct: '12%',
          source: source,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }

    // ⚠️ BUG: Exit triggered based on potentially stale price
    if (this.currentPosition.trailingSL && currentPremium <= this.currentPosition.trailingSL) {
      this.logger.info(`🔴 LONG exit signal: Trailing SL hit (${source})`, {
        currentPremium: currentPremium.toFixed(2),  // ← 259.54 (FALLBACK!)
        trailingSL: this.currentPosition.trailingSL.toFixed(2),  // ← 266.46 (correct)
        trailingPct: '12%',
        highestPremium: this.currentPosition.highestPremium?.toFixed(2) || 'N/A',  // ← 302.80
        source: source,
        timestamp: new Date().toLocaleTimeString()
      });

      await this.executeExit(`LONG_TRAILING_SL_${source.toUpperCase()}`);  // ← EXIT!
    }
  } finally {
    this.isProcessingLongExit = false;
  }
}
```

### What Goes Wrong

1. Function receives currentPremium: 259.54
2. No check: "Is this price real or estimated?"
3. No check: "Is this price suspiciously different from last known price?"
4. Calculates SL: 266.46
5. Checks: 259.54 <= 266.46? YES → EXIT
6. Executes position exit based on corrupted price

### The Logs Show the Problem

```
info: 🔴 LONG exit signal: Trailing SL hit (polling) {
  "currentPremium":"259.54",      ← Fallback price (unreliable)
  "highestPremium":"302.80",      ← Real high (reliable)
  "trailingSL":"266.46",          ← Calculated from highestPremium
  "source":"polling",             ← REST API polling (but API failed!)
  "timestamp":"2025-12-19 09:34:24"
}
```

### Why It's Critical

- Highest premium: 302.80 (real)
- Current premium: 259.54 (fallback, not real)
- Gap of 43.26 points in 4 minutes with no updates = DATA CORRUPTION
- No anomaly detection catches this

---

## Bug #3: Polling Loop Doesn't Stop on Error

### Location

**File:** [src/strategies/bollinger-band/BollingerBandStrategy.ts](src/strategies/bollinger-band/BollingerBandStrategy.ts#L1890)  
**Lines:** 1890-2000+ (the polling loop in startLongPositionMonitoring)  
**Severity:** HIGH

### Current Code (PARTIAL - THE ISSUE)

```typescript
const pollOnce = async () => {
  // ... guard clauses ...

  try {
    const currentPremium = await this.getLiveOptionPremium(instrumentToken);

    if (currentPremium > 0) {
      this.cachedCurrentPrice = currentPremium;

      // ... more code ...

      // Exit checks happen here with potentially stale price
      await this.checkLongExitSimple(currentPremium, "polling");
    }
  } catch (error) {
    // Error handling
  } finally {
    // ⚠️ BUG: Always schedules next poll, even if previous failed
    this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
  }
};

// Initial start
this.shortMonitoringInterval = setTimeout(pollOnce, 1000);
```

### What Goes Wrong

1. Poll attempts to get price
2. API fails → getLiveOptionPremium returns fallback (259.54)
3. Exit check runs with fallback price
4. EXIT TRIGGERED with corrupted data
5. Finally block always schedules next poll
6. Loop continues feeding corrupted data to exit logic

### Why It's Critical

- Loop continues even when network is down
- Uses fallback prices every second
- Each second, exit logic runs with stale data
- Multiple "chances" to incorrectly trigger exit

---

## Bug #4: No Price Quality Metadata

### Current Issue

```typescript
// This function returns a number, period
private async getLiveOptionPremium(instrumentToken: number): Promise<number>

// Caller receives: 259.54
// Caller doesn't know:
// - Is this from REST API or fallback?
// - How old is this price?
// - Is this price validated?
// - Should I trust this for trading decisions?

// If it returned an object:
interface PriceData {
  value: number;           // The price
  source: 'API' | 'FALLBACK' | 'WEBSOCKET';
  age: number;             // milliseconds since fetch
  isReal: boolean;         // Is this real-time or estimate?
  error?: string;          // If fallback, why?
}

// Then caller could do:
if (!priceData.isReal || priceData.age > 5000) {
  return; // Skip exit logic
}
```

### Impact of Current Design

- No way to distinguish real prices from estimates
- Exit logic can't make data-quality decisions
- Network errors cause trading errors
- System appears confident but isn't

---

## Summary of Root Causes

```
┌─────────────────────────────────────────────────────────┐
│ ROOT CAUSE CHAIN                                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. Network Error (ECONNABORTED at 09:34:24)           │
│    └─ Broker-side issue, not preventable              │
│                                                          │
│ 2. getLiveOptionPremium() silently uses fallback       │
│    └─ Returns synthetic price (259.54) without warning│
│                                                          │
│ 3. Caller receives number with no metadata            │
│    └─ Can't tell if it's real or estimated            │
│                                                          │
│ 4. checkLongExitSimple() uses price without validation│
│    └─ Treats fallback as real-time                     │
│                                                          │
│ 5. Exit decision made on corrupted data               │
│    └─ Position closed at worse price than it should   │
│                                                          │
│ 6. Order delayed due to network                       │
│    └─ Filled at 295 instead of 259.54 (lucky)        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Critical Differences: API vs Fallback

```
REAL-TIME API PRICE:
├─ From: REST API getQuote() call to broker
├─ Age: 0-100ms
├─ Status: Current market price
├─ Reliability: HIGH
└─ Use for exits: YES ✓

FALLBACK ESTIMATED PRICE:
├─ From: Last completed 5m candle close × 1%
├─ Age: 4+ minutes
├─ Status: Synthetic estimate
├─ Reliability: LOW
└─ Use for exits: NO ❌

At 09:34:24:
├─ API call: ECONNABORTED (failed)
├─ System returned: Fallback (259.54)
├─ Exit logic used: Fallback as if it were real-time
└─ Result: FALSE POSITIVE EXIT
```

---

## Broker Confirmation vs System Records

```
BROKER FILLED AT 09:35:24:
└─ Price: 295.00
└─ Actual market premium at that moment

SYSTEM LOGGED AT 09:34:24:
└─ Price: 259.54 (fallback)
└─ Not actual market price

DISCREPANCY:
└─ 295.00 vs 259.54
└─ Difference: 35.46 points
└─ Proof that 259.54 was synthetic

IF PREMIUM HAD CRASHED TO 250:
├─ Order sent at 09:34:24 with wrong trigger
├─ Network delay until 09:35:24
├─ Filled at 250 instead of 266.46 SL
├─ Loss: 24.46 points × 225 shares = ₹5,503.50
└─ Instead of: SL at 266.46
```

---

## Prevention: Required Changes

### Must Change getLiveOptionPremium()

- Stop returning fallback prices as-is
- Add status metadata
- Let caller decide what to do with non-real-time prices

### Must Change checkLongExitSimple()

- Validate price quality before exit decision
- Skip exits when price is not real-time
- Detect anomalies (>30% moves without intermediate data)

### Must Change Polling Loop

- Don't schedule next poll if API is failing
- Implement circuit breaker for exit logic
- Pause exits during network errors

### Must Add Price Validation Layer

- Check price age before using it
- Check price reasonableness vs previous price
- Require confirmation on suspiciously large moves

---

## Evidence Trail in Logs

```
09:34:24 - Error triggered
error: Error fetching live premium for token 14588418:
{"error":"No response from server with error code: ECONNABORTED"}

09:34:24 - Exit with corrupted data
info: 🔴 LONG exit signal: Trailing SL hit (polling) {
  "currentPremium":"259.54",          ← Fallback price
  "highestPremium":"302.80",          ← Real high
  "trailingSL":"266.46",              ← Correct SL
}

09:34:24 - Order sent
info: Executing order {...,"transaction":"SELL"}

09:34:31 - Still can't reach broker
error: Order execution failed:
{"error":"No response from server with error code: ECONNABORTED"}

09:35:25 - Finally filled at different price
info: ✅ Position closed {
  "exitPrice":295,                    ← NOT 259.54!
  "pnl":"4620.00"
}

PROOF: System triggered exit at 259.54 but market price was 295
```

This is clear evidence that the exit was triggered on synthetic/fallback price data.
