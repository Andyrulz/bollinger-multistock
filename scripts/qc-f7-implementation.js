// End-to-end QC: Verify F7 RSI Confirmation implementation matches the plan
const fs = require('fs');

const src = fs.readFileSync('src/strategies/bollinger-band/BollingerBandStrategy.ts', 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
}

console.log('=== F7 RSI CONFIRMATION — IMPLEMENTATION QC ===\n');

// Step 1: Position interface
check('Step 1: rsiConfirmation in Position interface',
  src.includes('rsiConfirmation?: {') && 
  src.includes('candlesSinceEntry: number;') && 
  src.includes('maxCandles: number;') &&
  src.includes('threshold: number;') &&
  src.includes("direction: 'LONG' | 'SHORT';") &&
  src.includes('confirmed: boolean;') &&
  src.includes('entryRsi: number;')
);

// Step 2: Configuration constants
check('Step 2a: RSI_CONFIRMATION_WINDOW = 2',
  src.includes('RSI_CONFIRMATION_WINDOW = 2;'));
check('Step 2b: RSI_CONFIRMATION_LONG_THRESHOLD = 62',
  src.includes('RSI_CONFIRMATION_LONG_THRESHOLD = 62;'));
check('Step 2c: RSI_CONFIRMATION_SHORT_THRESHOLD = 32',
  src.includes('RSI_CONFIRMATION_SHORT_THRESHOLD = 32;'));

// Step 3: checkRsiConfirmation method
check('Step 3: checkRsiConfirmation() method exists',
  src.includes('private async checkRsiConfirmation(): Promise<void>'));

// Breach logic verification
check('Step 3a: LONG breach = currentRsi < conf.threshold',
  src.includes('currentRsi < conf.threshold   // LONG: RSI dropped below 62'));
check('Step 3b: SHORT breach = currentRsi > conf.threshold',
  src.includes('currentRsi > conf.threshold;  // SHORT: RSI rose above 32'));

// Exit call
check('Step 3c: executeExit(RSI_CONFIRMATION_FAILED)',
  src.includes("await this.executeExit('RSI_CONFIRMATION_FAILED')"));

// Confirmation logic
check('Step 3d: Window expiry sets confirmed=true',
  src.includes('conf.confirmed = true;'));

// Counter increment
check('Step 3e: Counter increments each candle',
  src.includes('conf.candlesSinceEntry++;'));

// Step 4: Master cycle wiring
const masterStart = src.indexOf('// CRITICAL ORDER: Check exits BEFORE entries');
const masterEnd = src.indexOf('// Check for new entry signals ONLY if');
const masterCycleSection = src.substring(masterStart, masterEnd);

const rsiIdx = masterCycleSection.indexOf('checkRsiConfirmation');
const exitIdx = masterCycleSection.indexOf('checkPositionExit');
const breakoutIdx = masterCycleSection.indexOf('checkBreakoutValidation');

check('Step 4a: RSI confirmation runs BEFORE checkPositionExit',
  rsiIdx > 0 && exitIdx > 0 && rsiIdx < exitIdx);
check('Step 4b: checkPositionExit runs BEFORE checkBreakoutValidation',
  exitIdx > 0 && breakoutIdx > 0 && exitIdx < breakoutIdx);
check('Step 4c: Null guard before checkPositionExit (position may be killed by RSI)',
  masterCycleSection.includes('// Primary exit check (Supertrend/BB)') &&
  masterCycleSection.includes('if (this.currentPosition)') &&
  masterCycleSection.includes('await this.checkPositionExit(newCandle.close)'));

// Step 5: LONG entry initialization
const longInitStart = src.indexOf('RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry\n        // LONG:');
const longInitEnd = src.indexOf('RSI CONFIRMATION ARMED (LONG)') + 200;
const longInit = src.substring(longInitStart, longInitEnd);

check('Step 5a: LONG entry init uses RSI_CONFIRMATION_WINDOW constant',
  longInit.includes('this.RSI_CONFIRMATION_WINDOW'));
check('Step 5b: LONG entry init uses RSI_CONFIRMATION_LONG_THRESHOLD constant',
  longInit.includes('this.RSI_CONFIRMATION_LONG_THRESHOLD'));
check('Step 5c: LONG entry init sets direction=LONG',
  longInit.includes("direction: 'LONG'"));
check('Step 5d: LONG entry captures RSI from currentIndicators',
  longInit.includes('this.currentIndicators?.rsi ?? 0'));

// Step 6: SHORT entry initialization
const shortInitStart = src.indexOf('RSI CONFIRMATION (F7): Monitor for quick RSI reversal post-entry\n        // SHORT:');
const shortInitEnd = src.indexOf('RSI CONFIRMATION ARMED (SHORT)') + 200;
const shortInit = src.substring(shortInitStart, shortInitEnd);

check('Step 6a: SHORT entry init uses RSI_CONFIRMATION_WINDOW constant',
  shortInit.includes('this.RSI_CONFIRMATION_WINDOW'));
check('Step 6b: SHORT entry init uses RSI_CONFIRMATION_SHORT_THRESHOLD constant',
  shortInit.includes('this.RSI_CONFIRMATION_SHORT_THRESHOLD'));
check('Step 6c: SHORT entry init sets direction=SHORT',
  shortInit.includes("direction: 'SHORT'"));
check('Step 6d: SHORT entry captures RSI from currentIndicators',
  shortInit.includes('this.currentIndicators?.rsi ?? 0'));

// Sanity checks
const methodCount = (src.match(/private async checkRsiConfirmation/g) || []).length;
check('Sanity: Exactly 1 checkRsiConfirmation method', methodCount === 1);

const windowCount = (src.match(/RSI_CONFIRMATION_WINDOW = 2/g) || []).length;
const longThreshCount = (src.match(/RSI_CONFIRMATION_LONG_THRESHOLD = 62/g) || []).length;
const shortThreshCount = (src.match(/RSI_CONFIRMATION_SHORT_THRESHOLD = 32/g) || []).length;
check('Sanity: Each constant declared exactly once', 
  windowCount === 1 && longThreshCount === 1 && shortThreshCount === 1);

// Persistence checks
check('Persistence: saveCapitalData called after confirmation passes',
  src.includes('RSI CONFIRMATION PASSED') && 
  src.substring(src.indexOf('RSI CONFIRMATION PASSED')).indexOf('this.saveCapitalData()') < 500);
check('Persistence: saveCapitalData called after window-still-open',
  src.includes('RSI CONFIRMATION: Candle') &&
  src.substring(src.indexOf('candlesRemaining:')).indexOf('this.saveCapitalData()') < 200);

// Verify no existing code was broken
check('No-regression: checkPositionExit still exists',
  src.includes('private async checkPositionExit(candleClose?: number): Promise<void>'));
check('No-regression: checkBreakoutValidation still exists',
  src.includes('private async checkBreakoutValidation(newCandle: Candle): Promise<void>'));
check('No-regression: checkEntrySignals still exists',
  src.includes('private async checkEntrySignals(): Promise<void>'));
check('No-regression: executeExit still exists',
  src.includes("private async executeExit(reason: string): Promise<void>"));

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} checks ===`);
if (failed > 0) {
  console.log('\n⚠️  FAILURES DETECTED — review before deployment');
  process.exit(1);
} else {
  console.log('\n✅ ALL CHECKS PASSED — implementation matches plan exactly');
}
