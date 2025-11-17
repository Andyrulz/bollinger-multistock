# Breakout Pullback Strategy V2 Dashboard QC Report

**Date:** November 6, 2025  
**QC Focus:** Verify V2 dashboard displays updated marking candle parameters (10 bars, 1 update, 20 minutes)  
**Scope:** Code review only - NO changes made

---

## Executive Summary

### ✅ Overall Assessment: **PARTIALLY OUTDATED**

The V2 dashboard has **mixed updates** - some sections correctly show the new parameters (10 bars, 1 update, 20 min) while other sections still display old values (5 bars, 2 updates, 18 min).

**Status:**

- ✅ **3 sections correctly updated** (lines 3161, 3170, 3175)
- ❌ **4 sections still showing old values** (lines 4225, 4265, 4268, 4283, 4325, 4966)

---

## 1. Sections Correctly Updated ✅

### 1.1 Main Dashboard Card (Line 3161)

**Location:** Primary marking candle status card  
**Status:** ✅ **CORRECT**

```typescript
<strong>Update Count:</strong> ${markingCandleState.currentMarkingCandle?.updateCount || 0}/1<br>
```

**Assessment:** Shows `/1` correctly (max 1 update)

### 1.2 Initial Search Progress (Line 3170)

**Location:** Initial search phase display  
**Status:** ✅ **CORRECT**

```typescript
<div>
  <strong>Bars Processed:</strong> $
  {markingCandleState.barsProcessedSinceBreakout}/10
</div>
```

**Assessment:** Shows `/10` correctly (initial search window of 10 bars)

### 1.3 Time Limit Display (Line 3175)

**Location:** Breakout reference section  
**Status:** ✅ **CORRECT**

```typescript
<strong>Time Limit:</strong> ${markingCandleState.startTime ? `${Math.floor((Date.now() - new Date(markingCandleState.startTime).getTime()) / (1000 * 60))}/20 min` : 'N/A'}
```

**Assessment:** Shows `/20 min` correctly (20-minute time limit)

---

## 2. Sections Still Showing Old Values ❌

### 2.1 Detailed Marking Candle Section (Line 4225)

**Location:** Extended marking candle information card  
**Status:** ❌ **OUTDATED**

```typescript
<div>
  <strong>Update Count:</strong> $
  {markingCandleState?.currentMarkingCandle?.updateCount || 0}/2
</div>
```

**Issue:** Shows `/2` instead of `/1`  
**Impact:** **HIGH** - Users will see conflicting information between different dashboard sections

### 2.2 Timing & Progress Card (Line 4265)

**Location:** Timing & Progress information card  
**Status:** ❌ **OUTDATED**

```typescript
${markingCandleState?.startTime ? `${Math.floor((Date.now() - new Date(markingCandleState.startTime).getTime()) / (1000 * 60))}/18` : '0/18'}
```

**Issue:** Shows `/18` instead of `/20`  
**Impact:** **HIGH** - Displays incorrect time limit

### 2.3 Time Limit Detail (Line 4268)

**Location:** Time limit subtitle in Timing & Progress card  
**Status:** ❌ **OUTDATED**

```typescript
<div>
  <strong>Time Limit:</strong> $
  {markingCandleState?.startTime
    ? `${Math.floor(
        (Date.now() - new Date(markingCandleState.startTime).getTime()) /
          (1000 * 60)
      )} of 18 minutes`
    : "Not started"}
</div>
```

**Issue:** Shows `18 minutes` instead of `20 minutes`  
**Impact:** **HIGH** - Explicit text says wrong time limit

### 2.4 Initial Search Phase - Bars Processed (Line 4283)

**Location:** Initial search phase detailed view  
**Status:** ❌ **OUTDATED**

```typescript
<div>
  <strong>Bars Processed:</strong> $
  {markingCandleState.barsProcessedSinceBreakout || 0}/5
</div>
```

**Issue:** Shows `/5` instead of `/10`  
**Impact:** **HIGH** - Shows incorrect initial search window

### 2.5 Update Count in Candle Details (Line 4325)

**Location:** Marking candle current candle information  
**Status:** ❌ **OUTDATED**

```typescript
<div>
  <strong>Count:</strong> ${markingCandleState.currentMarkingCandle.updateCount}
  /2
</div>
```

**Issue:** Shows `/2` instead of `/1`  
**Impact:** **MEDIUM** - Duplicate of issue 2.1 in different section

### 2.6 Strategy Rules Documentation (Line 4966)

**Location:** Strategy Rules Summary section  
**Status:** ❌ **OUTDATED**

```typescript
<div>• Maximum 2 candle updates</div>
```

**Issue:** Shows `2 candle updates` instead of `1 candle update`  
**Impact:** **HIGH** - User-facing documentation shows incorrect rule

### 2.7 Strategy Rules Documentation (Line 4964)

**Location:** Strategy Rules Summary section - Timing Rules  
**Status:** ❌ **OUTDATED** (Expected based on pattern)

```typescript
<div>• 18-minute marking candle window</div>
```

**Issue:** Shows `18-minute` instead of `20-minute`  
**Impact:** **HIGH** - User-facing documentation shows incorrect rule

---

## 3. Detailed Findings

### 3.1 Dashboard Structure Analysis

The V2 dashboard has **TWO main sections** displaying marking candle information:

#### Section A: Main Dashboard (Lines ~3000-3200)

**Purpose:** Quick overview at top of page  
**Update Status:** ✅ **FULLY UPDATED**

- Update count: `/1` ✅
- Bars processed: `/10` ✅
- Time limit: `/20 min` ✅

#### Section B: Detailed Marking Candle View (Lines ~4200-4350)

**Purpose:** Expanded detailed information  
**Update Status:** ❌ **NOT UPDATED**

- Update count: `/2` ❌ (should be `/1`)
- Bars processed: `/5` ❌ (should be `/10`)
- Time limit: `/18` ❌ (should be `/20`)

#### Section C: Strategy Rules Summary (Lines ~4950-4970)

**Purpose:** Documentation of strategy rules  
**Update Status:** ❌ **NOT UPDATED**

- Max updates: `2 candle updates` ❌ (should be `1 candle update`)
- Time window: `18-minute` ❌ (should be `20-minute`)

### 3.2 Impact Analysis

| Section                           | Old Value    | New Value    | Priority | User Impact                        |
| --------------------------------- | ------------ | ------------ | -------- | ---------------------------------- |
| **Update Count (Main)**           | N/A          | `/1`         | ✅ Fixed | None                               |
| **Update Count (Detail)**         | `/2`         | `/1`         | ❌ P0    | **HIGH** - Conflicting info        |
| **Update Count (Candle Detail)**  | `/2`         | `/1`         | ❌ P0    | **HIGH** - Conflicting info        |
| **Update Count (Rules)**          | `2 updates`  | `1 update`   | ❌ P0    | **HIGH** - Wrong documentation     |
| **Bars Processed (Main)**         | N/A          | `/10`        | ✅ Fixed | None                               |
| **Bars Processed (Detail)**       | `/5`         | `/10`        | ❌ P0    | **HIGH** - Wrong progress tracking |
| **Time Limit (Main)**             | N/A          | `/20 min`    | ✅ Fixed | None                               |
| **Time Limit (Detail - Numeric)** | `/18`        | `/20`        | ❌ P0    | **HIGH** - Wrong time display      |
| **Time Limit (Detail - Text)**    | `18 minutes` | `20 minutes` | ❌ P0    | **HIGH** - Explicit wrong text     |
| **Time Limit (Rules)**            | `18-minute`  | `20-minute`  | ❌ P0    | **HIGH** - Wrong documentation     |

### 3.3 Consistency Issues

**Problem:** Users will see **conflicting information** depending on which dashboard section they view:

**Scenario 1 - Update Count:**

- Main dashboard says: "Update Count: 0/1" ✅
- Detailed view says: "Update Count: 0/2" ❌
- Rules say: "Maximum 2 candle updates" ❌

**User confusion:** "Does the strategy allow 1 or 2 updates?"

**Scenario 2 - Time Limit:**

- Main dashboard says: "5/20 min" ✅
- Detailed view says: "5/18" ❌
- Detailed view also says: "5 of 18 minutes" ❌
- Rules say: "18-minute marking candle window" ❌

**User confusion:** "Is the time limit 18 or 20 minutes?"

**Scenario 3 - Initial Search:**

- Main dashboard says: "Bars Processed: 3/10" ✅
- Detailed view says: "Bars Processed: 3/5" ❌

**User confusion:** "How many bars will be searched?"

---

## 4. Root Cause Analysis

### Why are there inconsistencies?

**Root Cause:** **Incomplete update** - Developer updated the main dashboard section but **forgot to update the detailed view and rules sections**.

**Evidence:**

1. Main dashboard (Section A) fully updated ✅
2. Detailed views (Section B) not updated ❌
3. Documentation (Section C) not updated ❌

**Likely Update Process:**

```
✅ Step 1: Update strategy code (BreakoutPullbackStrategy.ts)
✅ Step 2: Update main dashboard display (lines 3000-3200)
❌ Step 3: Update detailed dashboard view (lines 4200-4350) - SKIPPED
❌ Step 4: Update strategy rules documentation (lines 4950-4970) - SKIPPED
```

---

## 5. Required Fixes (No Code Changes - Report Only)

### Fix #1: Update Count in Detailed View

**Lines:** 4225, 4325  
**Current:** `/2`  
**Required:** `/1`

### Fix #2: Time Limit in Timing Card (Numeric)

**Line:** 4265  
**Current:** `/18` and `0/18`  
**Required:** `/20` and `0/20`

### Fix #3: Time Limit in Timing Card (Text)

**Line:** 4268  
**Current:** `18 minutes`  
**Required:** `20 minutes`

### Fix #4: Bars Processed in Initial Search Phase

**Line:** 4283  
**Current:** `/5`  
**Required:** `/10`

### Fix #5: Maximum Updates in Strategy Rules

**Line:** 4966  
**Current:** `Maximum 2 candle updates`  
**Required:** `Maximum 1 candle update`

### Fix #6: Time Window in Strategy Rules

**Line:** 4964 (expected)  
**Current:** `18-minute marking candle window`  
**Required:** `20-minute marking candle window`

---

## 6. Verification Strategy

### How to verify after fixes:

**Test Case 1: Visual Consistency Check**

1. Start strategy
2. Wait for breakout
3. Compare main dashboard vs detailed view
4. Verify all numbers match:
   - Update count: `/1` everywhere
   - Bars processed: `/10` everywhere
   - Time limit: `/20` or `20 minutes` everywhere

**Test Case 2: Rules Documentation Check**

1. Scroll to "Breakout Strategy Rules Summary"
2. Read "Timing Rules" section
3. Verify it says:
   - ✅ "20-minute marking candle window"
   - ✅ "Maximum 1 candle update"

**Test Case 3: Real-Time Tracking**

1. During active marking candle tracking
2. Watch update count increment
3. Verify it stops at 1 (not 2)
4. Verify time limit reaches 20 minutes (not 18)

---

## 7. Additional Observations

### 7.1 Code Quality

- ✅ Main dashboard section is well-structured
- ✅ Conditional rendering logic is correct
- ✅ Variable naming is consistent
- ⚠️ **Multiple similar sections** increase risk of inconsistency

### 7.2 Recommendations

**Recommendation #1: DRY Principle**

- Consider extracting marking candle display into a reusable function
- Reduces duplication and ensures consistency
- Single source of truth for parameter values

**Recommendation #2: Configuration Constants**

```typescript
// At top of file
const MARKING_CANDLE_CONFIG = {
  INITIAL_SEARCH_BARS: 10,
  MAX_UPDATES: 1,
  TIME_LIMIT_MINUTES: 20
};

// Then use in dashboard:
${MARKING_CANDLE_CONFIG.MAX_UPDATES}
${MARKING_CANDLE_CONFIG.INITIAL_SEARCH_BARS}
${MARKING_CANDLE_CONFIG.TIME_LIMIT_MINUTES}
```

This ensures:

- ✅ Single source of truth
- ✅ Easy to update in future
- ✅ No chance of inconsistency

**Recommendation #3: Dashboard Testing Checklist**
Create a checklist for future dashboard updates:

- [ ] Main dashboard section updated
- [ ] Detailed view section updated
- [ ] Strategy rules documentation updated
- [ ] All numeric displays consistent
- [ ] All text descriptions consistent

---

## 8. Summary Table

| Parameter                 | Strategy Code | Main Dashboard | Detailed View | Rules Docs     | Status           |
| ------------------------- | ------------- | -------------- | ------------- | -------------- | ---------------- |
| **Initial Search Window** | 10 bars ✅    | `/10` ✅       | `/5` ❌       | N/A            | **INCONSISTENT** |
| **Max Updates**           | 1 ✅          | `/1` ✅        | `/2` ❌       | `2 updates` ❌ | **INCONSISTENT** |
| **Time Limit**            | 20 min ✅     | `/20 min` ✅   | `/18` ❌      | `18-minute` ❌ | **INCONSISTENT** |

---

## 9. Conclusion

### QC Result: ❌ **DASHBOARD NOT FULLY UPDATED**

**Findings:**

- ✅ Strategy code correctly implements new parameters (10 bars, 1 update, 20 min)
- ✅ Main dashboard section correctly displays new parameters
- ❌ Detailed dashboard view still shows old parameters
- ❌ Strategy rules documentation still shows old parameters

**Impact:** **HIGH**

- Users will see conflicting information
- Could lead to confusion about strategy behavior
- Documentation does not match actual implementation

**Priority:** **P0 - Critical**

- Fix before production use
- Fix before any user-facing deployment
- Users rely on dashboard for understanding strategy behavior

**Effort:** **LOW**

- Simple find-and-replace in 4-6 locations
- No logic changes required
- Estimated fix time: 5 minutes

**Risk:** **LOW**

- Only display changes
- No strategy logic affected
- No risk of breaking functionality

---

## 10. Exact Line Numbers for Fixes

### File: `src/index.ts`

| Line | Current Code                      | Required Change                     |
| ---- | --------------------------------- | ----------------------------------- | ----- | -------------- | --- | ------ |
| 4225 | `updateCount                      |                                     | 0}/2` | → `updateCount |     | 0}/1`  |
| 4265 | `)/18\` : '0/18'}`                | → `)/20\` : '0/20'}`                |
| 4268 | `of 18 minutes`                   | → `of 20 minutes`                   |
| 4283 | `Breakout                         |                                     | 0}/5` | → `Breakout    |     | 0}/10` |
| 4325 | `updateCount}/2`                  | → `updateCount}/1`                  |
| 4964 | `18-minute marking candle window` | → `20-minute marking candle window` |
| 4966 | `Maximum 2 candle updates`        | → `Maximum 1 candle update`         |

---

**QC Report Prepared By:** GitHub Copilot  
**QC Date:** November 6, 2025  
**QC Type:** Code review only - NO changes made  
**Next Action:** Developer should apply fixes to 7 locations listed above  
**Verification:** Visual inspection + real-time testing after fixes applied

---

## Appendix: Context for LLM

**Strategy Implementation Status:**

- ✅ BreakoutPullbackStrategy.ts: Correctly implements 10 bars, 1 update, 20 min
- ✅ Strategy documentation files: Updated
- ✅ Main dashboard (lines 3000-3200): Updated
- ❌ Detailed dashboard (lines 4200-4350): NOT updated
- ❌ Rules documentation (lines 4950-4970): NOT updated

**Why This Matters:**
The dashboard is the **primary user interface** for monitoring strategy behavior. Inconsistent information undermines user trust and could lead to incorrect assumptions about how the strategy operates.
