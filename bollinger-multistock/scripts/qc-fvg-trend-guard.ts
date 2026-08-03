/**
 * QC harness — FVG trend safety (Fix 1 + Fix 1b).
 * Mirrors BollingerBandStrategy.fvgEntryTrendOk + the progressFvgWatch entry-fire branch and the
 * regime-flip invalidation. Pure logic, no Kite/network. If the strategy drifts, update BOTH.
 *
 *  Fix 1  — fvgRequireTrendAtEntry: FVG LONG fires only if Supertrend=UP AND close>Supertrend.
 *  Fix 1b — fvgInvalidateOnTrendFlip: free the slot the moment Supertrend flips DOWN during a watch.
 */

interface Candle { high: number; low: number; open: number; close: number; }
interface ST { trend: 'UP' | 'DOWN'; value: number; }

// ── mirror of BollingerBandStrategy.fvgEntryTrendOk ──
function fvgEntryTrendOk(candle: Candle, st: ST | null): boolean {
  if (!st) return false;
  return st.trend === 'UP' && candle.close > st.value;
}

type Outcome = 'ENTER' | 'DEFER' | 'INVALIDATE' | 'WAIT';

/**
 * Mirror of the relevant progressFvgWatch decision points for a candle when an FVG + trigger exist.
 * Order matches the strategy: floor-close → lifetime → regime-flip(Fix 1b) → ... → entry-fire(Fix 1).
 */
function decide(opts: {
  candle: Candle;
  st: ST | null;
  trigger: number;
  fvgFloor: number;
  requireTrendAtEntry: boolean;
  invalidateOnTrendFlip: boolean;
  invalidateOnFloorClose?: boolean;
}): Outcome {
  const { candle, st, trigger, fvgFloor, requireTrendAtEntry, invalidateOnTrendFlip } = opts;
  const floorClose = opts.invalidateOnFloorClose ?? true;

  // INVALIDATE: floor close
  if (floorClose && candle.close < fvgFloor) return 'INVALIDATE';

  // Fix 1b: regime flip → free slot
  if (invalidateOnTrendFlip && st?.trend === 'DOWN') return 'INVALIDATE';

  // entry-fire branch: high >= trigger
  if (candle.high >= trigger) {
    if (requireTrendAtEntry && !fvgEntryTrendOk(candle, st)) return 'DEFER';
    return 'ENTER';
  }
  return 'WAIT';
}

let passN = 0, failN = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { passN++; console.log(`✅ ${name}`); }
  else { failN++; console.log(`❌ ${name}`); if (extra !== undefined) console.log('   ', JSON.stringify(extra)); }
}

// ── fvgEntryTrendOk unit ──
check('TG1 ST UP & close>ST → ok', fvgEntryTrendOk({ high: 110, low: 100, open: 101, close: 108 }, { trend: 'UP', value: 105 }) === true);
check('TG2 ST DOWN → not ok', fvgEntryTrendOk({ high: 110, low: 100, open: 101, close: 108 }, { trend: 'DOWN', value: 105 }) === false);
check('TG3 ST UP but close<=ST → not ok', fvgEntryTrendOk({ high: 110, low: 100, open: 101, close: 104 }, { trend: 'UP', value: 105 }) === false);
check('TG4 no indicator → not ok (no blind entry)', fvgEntryTrendOk({ high: 110, low: 100, open: 101, close: 108 }, null) === false);

// ── APOLLOHOSP replay: trigger 8646.50, ST DOWN @8671.11, entry candle high 8646.50 close 8639.50, FVG floor 8635 ──
{
  const candle = { high: 8646.50, low: 8635.10, open: 8645.00, close: 8639.50 };
  const st: ST = { trend: 'DOWN', value: 8671.11 };
  // With both fixes ON: regime-flip invalidates first (frees slot) — no bad entry
  check('APOLLO both fixes → INVALIDATE (slot freed, no entry)',
    decide({ candle, st, trigger: 8646.50, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: true }) === 'INVALIDATE');
  // Fix 1 only (no regime-flip): trend guard defers the entry — still no bad fill
  check('APOLLO Fix 1 only → DEFER (no entry below ST)',
    decide({ candle, st, trigger: 8646.50, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: false }) === 'DEFER');
  // Legacy (both OFF): would ENTER the bad trade (regression guard — documents old behavior)
  check('APOLLO legacy (both OFF) → ENTER (the bug we fixed)',
    decide({ candle, st, trigger: 8646.50, fvgFloor: 8635, requireTrendAtEntry: false, invalidateOnTrendFlip: false }) === 'ENTER');
}

// ── Good entry: ST UP, close above ST and above trigger → ENTER (stop below entry) ──
{
  const candle = { high: 8700, low: 8650, open: 8655, close: 8690 };
  const st: ST = { trend: 'UP', value: 8640 };
  check('GOOD ST UP & close>ST & high>=trigger → ENTER',
    decide({ candle, st, trigger: 8680, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: true }) === 'ENTER');
  check('GOOD entry has stop below entry (close>ST)', candle.close > st.value);
}

// ── Regime flip while waiting (no trigger breach this candle): Fix 1b frees the slot ──
{
  const candle = { high: 8650, low: 8636, open: 8648, close: 8641 }; // high < trigger, close above floor
  const st: ST = { trend: 'DOWN', value: 8665 };
  check('FLIP mid-watch (high<trigger) → INVALIDATE via Fix 1b',
    decide({ candle, st, trigger: 8700, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: true }) === 'INVALIDATE');
  check('FLIP mid-watch with Fix 1b OFF → WAIT (legacy keeps watching)',
    decide({ candle, st, trigger: 8700, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: false }) === 'WAIT');
}

// ── Floor close takes precedence over everything ──
{
  const candle = { high: 8700, low: 8600, open: 8660, close: 8630 }; // close 8630 < floor 8635
  const st: ST = { trend: 'UP', value: 8620 };
  check('FLOORCLOSE precedence → INVALIDATE even with ST UP & high>=trigger',
    decide({ candle, st, trigger: 8650, fvgFloor: 8635, requireTrendAtEntry: true, invalidateOnTrendFlip: true }) === 'INVALIDATE');
}

// ── Healthy uptrend, no flip, normal trigger breach unaffected ──
{
  const candle = { high: 8720, low: 8700, open: 8705, close: 8715 };
  const st: ST = { trend: 'UP', value: 8690 };
  check('UPTREND normal breach → ENTER (behavior unchanged)',
    decide({ candle, st, trigger: 8710, fvgFloor: 8650, requireTrendAtEntry: true, invalidateOnTrendFlip: true }) === 'ENTER');
}

console.log(`\n── Result: ${passN} passed, ${failN} failed ──`);
process.exit(failN > 0 ? 1 : 0);
