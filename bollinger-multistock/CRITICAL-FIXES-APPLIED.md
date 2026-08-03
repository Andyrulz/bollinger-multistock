# Critical Fixes Applied to market_scanner.md

## Date: January 25, 2026

### ✅ FIXES SUCCESSFULLY APPLIED

#### 1. Implementation Priority Note (Section 8)

**Status**: ✅ FIXED

Added note at the start of Section 8 (Implementation Specifications & Business Logic) stating:

> **⚠️ IMPLEMENTATION PRIORITY NOTE**: This section (8) contains the **definitive implementation logic** for all components. If there are any conflicts or ambiguities between Section 5 and Section 8, **always prioritize Section 8**.

**Location**: Line ~495 (start of Section 8)

---

#### 2. TypeScript Universe Configuration (Section 3)

**Status**: ✅ FIXED

Added warning about JSON comment issues and recommendation to use TypeScript:

```markdown
**⚠️ CRITICAL FILE FORMAT NOTE**:

The configuration below contains comments for developer guidance. **DO NOT use a `.json` file** as JSON does not support comments and will cause parsing errors on startup.

**Recommended Approach**: Create `src/config/universe.ts` as a **TypeScript file** that exports a const array.
```

**Location**: Section 3 (Universe Configuration)

---

#### 3. Unit Test Requirement for Symbol Extraction Regex

**Status**: ✅ ALREADY PRESENT

The regex unit test requirement is already documented in Section 8.21:

```typescript
// ⚠️ CRITICAL TESTING REQUIREMENT:
// This regex MUST be unit-tested against:
//   - "M&M26FEB2500CE" → Should extract "M&M"
//   - "BAJAJ-AUTO26FEB2500CE" → Should extract "BAJAJ-AUTO"
//   - "LT26FEB2500CE" → Should extract "LT" (not "L&T")
// If these tests fail, broker reconciliation will break.
```

**Location**: Line ~1777-1785 (Section 8.21 - extractStockSymbol method)

---

### ⚠️ REMAINING CRITICAL FIXES REQUIRED

#### 4. EOD Cache Reset Logic (**HIGH PRIORITY**)

**Status**: ⚠️ **NEEDS MANUAL ADDITION**

**Problem**: If bot runs continuously (e.g., on a server), `isDataCached` remains true from yesterday, causing "Forever Cache" bug.

**Required Fix**: Add this code to Section 8.5 (Startup & Data Synchronization) after the "Abort check if logged in after 09:30" block:

```typescript
      // Abort check if logged in after 09:30
      if (currentTime >= 570 && !this.isDataCached) {
        this.logger.error('🚫 Login after 09:30 - Scanner aborted');
        this.needsPreMarketFetch = false;
        clearInterval(this.preMarketCheckInterval);
      }

      // ⚠️ CRITICAL: EOD Cache Reset (Prevents "Forever Cache" bug on multi-day runs)
      // If bot runs continuously (e.g., on a server), cached data from yesterday
      // must be cleared to force fresh fetch tomorrow morning
      if (currentTime === 935) { // 15:35 PM (5 minutes post-market)
        this.logger.info('🧹 Post-market cleanup: Resetting cache for next day');
        this.isDataCached = false;
        this.needsPreMarketFetch = false;
        this.cachedHistoricalData = [];

        // Optional: Trigger garbage collection if available
        if (global.gc) {
          global.gc();
          this.logger.debug('♻️ Garbage collection triggered');
        }
      }

    }, 60000); // Check every minute
```

**Location to Add**: Section 8.5, inside the `schedulePreMarketCheck()` method's interval function

**Why Critical**: Without this, a bot running 24/7 will use yesterday's data indefinitely, causing stale signals and incorrect trading decisions.

---

#### 5. Sector Tokens JSON Comment Warning

**Status**: ⚠️ **NEEDS MANUAL ADDITION**

**Problem**: Section 4 has `// KITE SECTOR INDICES TOKENS` JSON with comments that will cause parsing errors.

**Required Fix**: Add warning before the JSON block (around line 223):

```markdown
**⚠️ FILE FORMAT**: The JSON below has comments for documentation. In actual code, either:

1. **Remove all comments** if using a .json file, OR
2. **Use TypeScript** (`src/config/sectorTokens.ts`) with `export const SECTOR_TOKENS = { ... }`
```

**Location**: Section 4 (TMV Logic), before the SECTOR_TOKENS JSON block

---

## OPTIONAL IMPROVEMENTS (Already Applied)

### ✅ Dashboard Simplification Note

Added guidance to avoid messy string concatenation HTML and use EJS or template files instead.

**Location**: Section 9.3 (Dashboard Design)

---

## IMPLEMENTATION CHECKLIST FOR CODER

When implementing, ensure:

- [ ] Use `src/config/universe.ts` (TypeScript) NOT `config/universe.json`
- [ ] Use `src/config/sectorTokens.ts` (TypeScript) NOT JSON file
- [ ] Write unit tests for `extractStockSymbol()` regex with M&M, BAJAJ-AUTO, LT
- [ ] **CRITICAL**: Implement EOD cache reset at 15:35 PM daily
- [ ] Verify all JSON configurations are comment-free OR converted to TypeScript

---

## TESTING REQUIREMENTS

### Symbol Extraction Regex Tests

```typescript
// tests/utils/symbolExtractor.test.ts
describe("extractStockSymbol", () => {
  it("should extract M&M correctly", () => {
    expect(extractStockSymbol("M&M26FEB2500CE")).toBe("M&M");
  });

  it("should extract BAJAJ-AUTO correctly", () => {
    expect(extractStockSymbol("BAJAJ-AUTO26FEB2500CE")).toBe("BAJAJ-AUTO");
  });

  it("should extract LT correctly (not L&T)", () => {
    expect(extractStockSymbol("LT26FEB2500CE")).toBe("LT");
  });

  it("should handle standard symbols", () => {
    expect(extractStockSymbol("RELIANCE26FEB2500CE")).toBe("RELIANCE");
    expect(extractStockSymbol("HDFCBANK26FEB1600PE")).toBe("HDFCBANK");
  });
});
```

### EOD Cache Reset Test

```typescript
// tests/core/StrategyManager.test.ts
describe("EOD Cache Reset", () => {
  it("should reset cache at 15:35 PM", async () => {
    // Mock time to be 15:35
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-25T15:35:00"));

    strategyManager.isDataCached = true;
    strategyManager.needsPreMarketFetch = true;

    // Trigger interval
    jest.advanceTimersByTime(60000);

    expect(strategyManager.isDataCached).toBe(false);
    expect(strategyManager.needsPreMarketFetch).toBe(false);
    expect(strategyManager.cachedHistoricalData).toEqual([]);
  });
});
```

---

## FILES TO CREATE

1. `src/config/universe.ts` - Universe stock array (TypeScript)
2. `src/config/sectorTokens.ts` - Sector instrument tokens (TypeScript)
3. `tests/utils/symbolExtractor.test.ts` - Regex unit tests
4. `tests/core/StrategyManager.test.ts` - EOD cache reset tests

---

## SEVERITY CLASSIFICATION

| Issue              | Severity        | Impact if Ignored                              |
| ------------------ | --------------- | ---------------------------------------------- |
| JSON Comments      | 🔴 **CRITICAL** | Bot crashes on startup with parse error        |
| EOD Cache Reset    | 🔴 **CRITICAL** | Stale data on multi-day runs → Wrong trades    |
| Symbol Regex Tests | 🟡 **HIGH**     | M&M/BAJAJ-AUTO recovery fails → Lost positions |
| Section 8 Priority | 🟢 **MEDIUM**   | Developer confusion during implementation      |

---

## STATUS SUMMARY

**Applied**: 3/5 critical fixes
**Remaining**: 2/5 (EOD cache reset + Sector tokens warning)

**Recommendation**: Manually add the EOD cache reset code (item #4) before starting implementation. This is the highest risk item remaining.
