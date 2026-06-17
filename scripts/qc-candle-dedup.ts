/**
 * QC harness — candle-dedup timestamp normalization (Jun 2026 fix).
 *
 * Reproduces the ABB 2026-06-16 mid-bar-deploy bug: a multi-day seed fetch returns
 * the in-progress bar with a clean :00 timestamp, while the narrow live fetch returns
 * the SAME bar (now complete) with a :07 timestamp. Without flooring, dedup pushed a
 * duplicate that shifted the FVG window by one slot and made the lookback return null.
 *
 * Mirrors BollingerBandStrategy.floorTo5Min + the processCandle dedup/append branch
 * + detectBullishFvg + findRecentUntouchedBullishFvg. If they drift, BOTH must update.
 */

interface Candle { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number; }

// ── mirror of BollingerBandStrategy.floorTo5Min ──
function floorTo5Min(date: Date): Date {
  const FIVE_MIN_MS = 5 * 60 * 1000;
  return new Date(Math.floor(date.getTime() / FIVE_MIN_MS) * FIVE_MIN_MS);
}

// ── mirror of the processCandle dedup/append branch (lines ~2700-2726) ──
function appendCandle(hist: Candle[], newCandle: Candle): 'PUSH' | 'UPDATE' | 'DUPLICATE' {
  const last = hist[hist.length - 1];
  const isDuplicate = !!last &&
    newCandle.timestamp.getTime() === last.timestamp.getTime() &&
    newCandle.open === last.open && newCandle.high === last.high &&
    newCandle.low === last.low && newCandle.close === last.close;
  if (isDuplicate) return 'DUPLICATE';
  const isNewer = !last || newCandle.timestamp.getTime() > last.timestamp.getTime();
  if (isNewer) { hist.push(newCandle); if (hist.length > 50) hist.splice(0, hist.length - 50); return 'PUSH'; }
  if (last && newCandle.timestamp.getTime() === last.timestamp.getTime()) {
    hist[hist.length - 1] = newCandle; return 'UPDATE';
  }
  return 'PUSH';
}

// ── mirror of detectBullishFvg ──
function detectBullishFvg(c1: Candle, c2: Candle, c3: Candle, impulseClose: number, minGapPct: number) {
  if (!(c1.high < c3.low)) return null;
  const width = c3.low - c1.high;
  if (width < impulseClose * minGapPct) return null;
  return { floor: c1.high, ceiling: c3.low, slLevel: c2.low, width };
}

// ── mirror of findRecentUntouchedBullishFvg ──
function findRecentUntouchedBullishFvg(hist: Candle[], signalCandle: Candle, lookbackCandles: number, minGapPct: number, invalidateOnFloorClose: boolean) {
  if (hist.length < 3) return null;
  let signalIdx = hist.length - 1;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i] && hist[i]!.timestamp.getTime() === signalCandle.timestamp.getTime()) { signalIdx = i; break; }
  }
  const oldestC3 = Math.max(2, signalIdx - lookbackCandles + 1);
  for (let c3Idx = signalIdx; c3Idx >= oldestC3; c3Idx--) {
    const c1 = hist[c3Idx - 2], c2 = hist[c3Idx - 1], c3 = hist[c3Idx];
    if (!c1 || !c2 || !c3) continue;
    const fvg = detectBullishFvg(c1, c2, c3, signalCandle.close, minGapPct);
    if (!fvg) continue;
    let touched = false;
    for (let k = c3Idx + 1; k <= signalIdx; k++) {
      const cand = hist[k];
      if (!cand) continue;
      if (cand.low <= fvg.ceiling) { touched = true; break; }
      if (invalidateOnFloorClose && cand.close < fvg.floor) { touched = true; break; }
    }
    if (touched) continue;
    return { ...fvg, impulseTimestamp: c2.timestamp };
  }
  return null;
}

let passN = 0, failN = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { passN++; console.log(`✅ ${name}`); }
  else { failN++; console.log(`❌ ${name}`); if (extra !== undefined) console.log('   ', JSON.stringify(extra)); }
}

function ist(t: string): Date { return new Date(`2026-06-16T${t}+05:30`); }
function raw(t: string, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: ist(t), open: o, high: h, low: l, close: c };
}

// ── Helper: build candleHistory the way the bot does, WITH flooring (the fix) ──
function buildWithFloor(seed: Candle[], live: Candle[]): { hist: Candle[]; ops: string[] } {
  const hist: Candle[] = seed.map(c => ({ ...c, timestamp: floorTo5Min(c.timestamp) }));
  const ops: string[] = [];
  for (const c of live) {
    const floored: Candle = { ...c, timestamp: floorTo5Min(c.timestamp) };
    ops.push(appendCandle(hist, floored));
  }
  return { hist, ops };
}

// ── Helper: build WITHOUT flooring (the bug) for contrast ──
function buildNoFloor(seed: Candle[], live: Candle[]): { hist: Candle[]; ops: string[] } {
  const hist: Candle[] = seed.map(c => ({ ...c }));
  const ops: string[] = [];
  for (const c of live) ops.push(appendCandle(hist, { ...c }));
  return { hist, ops };
}

// ═══════════════════════════════════════════════════════════════════════════
// ABB 2026-06-16 fixture (real Kite data)
//   Seed (multi-day fetch, clean :00) ends with the FORMING 13:15 bar as a PARTIAL
//   candle (close 6995). Then live fetches (:07) deliver the SAME bars completed.
// ═══════════════════════════════════════════════════════════════════════════
const seed: Candle[] = [
  raw('13:00:00', 6973.5, 6974, 6965, 6969),
  raw('13:05:00', 6975, 6981, 6971.5, 6979.5),
  raw('13:10:00', 6978, 6979.5, 6975, 6977.5),
  raw('13:15:00', 6977.5, 7006, 6977, 6995),   // PARTIAL (still forming at deploy 13:19)
];
const live: Candle[] = [
  raw('13:15:07', 6977.5, 7006, 6977, 6998.5), // COMPLETE 13:15 (echoed :07 second)
  raw('13:20:07', 6998.5, 7010, 6998.5, 7010),
  raw('13:25:07', 7010, 7020, 7008.5, 7014),   // signal candle
];

// ── T1: WITHOUT flooring → duplicate 13:15 is PUSHED, lookback returns null (the bug) ──
{
  const { hist, ops } = buildNoFloor(seed, live);
  const dupCount = hist.filter(c => c.timestamp.getTime() === ist('13:15:00').getTime()).length;
  // 13:15:00 partial + 13:15:07 complete both present → 2 entries representing the 13:15 bar
  const bar1315 = hist.filter(c => floorTo5Min(c.timestamp).getTime() === ist('13:15:00').getTime()).length;
  check('T1 no-floor: 13:15 bar represented twice (duplicate)', bar1315 === 2, { bar1315, ops });
  const signal = hist[hist.length - 1]!;
  const fvg = findRecentUntouchedBullishFvg(hist, signal, 5, 0.0015, true);
  check('T1 no-floor: lookback returns NULL (bug reproduced)', fvg === null, { fvg });
}

// ── T2: WITH flooring → 13:15 partial UPDATED in place, no duplicate ──
{
  const { hist, ops } = buildWithFloor(seed, live);
  check('T2 floor: first live op is UPDATE (not PUSH)', ops[0] === 'UPDATE', { ops });
  const bar1315 = hist.filter(c => c.timestamp.getTime() === ist('13:15:00').getTime());
  check('T2 floor: exactly one 13:15 candle', bar1315.length === 1, { count: bar1315.length });
  check('T2 floor: 13:15 candle is the COMPLETE one (close 6998.5)', bar1315[0]?.close === 6998.5, { got: bar1315[0]?.close });
  // No duplicate timestamps anywhere
  const seen = new Set<number>(); let anyDup = false;
  for (const c of hist) { const t = c.timestamp.getTime(); if (seen.has(t)) anyDup = true; seen.add(t); }
  check('T2 floor: no duplicate timestamps in candleHistory', !anyDup);
}

// ── T3: WITH flooring → lookback now FINDS the FVG (the fix) ──
{
  const { hist } = buildWithFloor(seed, live);
  const signal = hist[hist.length - 1]!;
  const fvg = findRecentUntouchedBullishFvg(hist, signal, 5, 0.0015, true);
  check('T3 floor: lookback returns the FVG', !!fvg);
  check('T3 floor: FVG floor = 13:10 high (6979.5)', fvg?.floor === 6979.5, { got: fvg?.floor });
  check('T3 floor: FVG ceiling = 13:20 low (6998.5)', fvg?.ceiling === 6998.5, { got: fvg?.ceiling });
  check('T3 floor: FVG slLevel = 13:15 low (6977)', fvg?.slLevel === 6977, { got: fvg?.slLevel });
  check('T3 floor: window c3=13:20 uses c1=13:10 (not duplicate 13:15)', fvg?.width === 19, { got: fvg?.width });
}

// ── T4: floorTo5Min correctness (IST boundary lands exactly) ──
{
  check('T4 floor 13:25:07 → 13:25:00', floorTo5Min(ist('13:25:07')).getTime() === ist('13:25:00').getTime());
  check('T4 floor 13:25:00 → 13:25:00 (idempotent)', floorTo5Min(ist('13:25:00')).getTime() === ist('13:25:00').getTime());
  check('T4 floor 13:29:59 → 13:25:00', floorTo5Min(ist('13:29:59')).getTime() === ist('13:25:00').getTime());
  check('T4 floor 09:15:07 → 09:15:00 (market open)', floorTo5Min(ist('09:15:07')).getTime() === ist('09:15:00').getTime());
}

// ── T5: exact-duplicate refetch is still deduped (no regression to dedup) ──
{
  const { hist } = buildWithFloor(seed, live);
  const len0 = hist.length;
  // Production floors at construction BEFORE dedup; mirror that here.
  const refetch: Candle = { ...raw('13:25:07', 7010, 7020, 7008.5, 7014), timestamp: floorTo5Min(ist('13:25:07')) };
  const op = appendCandle(hist, refetch); // same bar, floored, identical OHLC
  check('T5 identical refetch → DUPLICATE (no append)', op === 'DUPLICATE', { op });
  check('T5 history length unchanged', hist.length === len0, { len0, now: hist.length });
}

console.log(`\n── Result: ${passN} passed, ${failN} failed ──`);
process.exit(failN > 0 ? 1 : 0);
