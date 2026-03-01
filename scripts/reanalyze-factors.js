/**
 * Fresh Factor Reanalysis Script — Post F7+F8 Implementation
 * 
 * Analyzes all 84 trades from Feb 3–27, 2026 through the lens of:
 * - F7 (RSI Quick Reversal) already implemented → filters applied first
 * - F8 (1-Hour ST Alignment) already implemented → filters applied first
 * - Then evaluates remaining factors F1, F2, F3, F5, F6 on SURVIVING trades
 * 
 * CORRECTED HYPOTHESES:
 * - F2: Both narrow BB (weak breakouts) AND wide BB (exhaustion) 
 * - F3: LARGE body candles (>0.7%) = exhaustion/reversal, especially CE side
 * - F5: Price at new extreme but RSI NOT confirming (hidden divergence at entry)
 * 
 * Run: node scripts/reanalyze-factors.js
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'factor-analysis-results.json');
const trades = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

// ═══════════════════════════════════════════════════════════════════
// STEP 1: Apply F7 + F8 filters to get the SURVIVING trade pool
// ═══════════════════════════════════════════════════════════════════

// F8: 1-Hour ST Alignment filter (pre-entry, scanner level)
// Reject: LONG + 1h ST DOWN, or SHORT + 1h ST UP
const f8Filtered = [];
const afterF8 = [];

for (const t of trades) {
  const f8 = t.factors.f8_hourlySTAlignment;
  if (f8.wouldFilter) {
    f8Filtered.push(t);
  } else {
    afterF8.push(t);
  }
}

// F7: RSI Quick Reversal filter (post-entry, strategy level)
// LONG: exit if RSI drops below 62 within 2 candles
// SHORT: exit if RSI rises above 32 within 2 candles
const f7Filtered = [];
const surviving = [];

for (const t of afterF8) {
  const f7 = t.factors.f7_rsiQuickReversal;
  // Apply the LOCKED thresholds: LONG <62, SHORT >32
  let wouldF7Filter = false;
  
  // Some trades may not have rsiNextCandles (applicable: false)
  if (!f7.rsiNextCandles || !Array.isArray(f7.rsiNextCandles)) {
    // No RSI data — cannot filter, keep the trade
    wouldF7Filter = false;
  } else if (t.direction === 'LONG') {
    // Check if any of the first 2 candles after entry had RSI < 62
    const rsiValues = f7.rsiNextCandles.slice(0, 2).map(Number);
    wouldF7Filter = rsiValues.some(r => r < 62);
  } else {
    // SHORT: Check if any of the first 2 candles after entry had RSI > 32
    const rsiValues = f7.rsiNextCandles.slice(0, 2).map(Number);
    wouldF7Filter = rsiValues.some(r => r > 32);
  }
  
  if (wouldF7Filter) {
    f7Filtered.push(t);
  } else {
    surviving.push(t);
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR REANALYSIS — Post F7+F8 Implementation');
console.log('  84 trades from Feb 3–27, 2026');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
console.log('─── IMPLEMENTED FILTER IMPACT ─────────────────────────────────');
console.log(`  F8 filtered (1h ST misaligned):  ${f8Filtered.length} trades removed`);
console.log(`  F7 filtered (RSI quick reversal): ${f7Filtered.length} trades removed (from remaining ${afterF8.length})`);
console.log(`  SURVIVING POOL: ${surviving.length} trades`);
console.log('');

const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
const f8PnlRemoved = f8Filtered.reduce((s, t) => s + t.pnl, 0);
const f7PnlRemoved = f7Filtered.reduce((s, t) => s + t.pnl, 0);
const survivingPnl = surviving.reduce((s, t) => s + t.pnl, 0);
const survivingWins = surviving.filter(t => t.pnl > 0).length;
const survivingWR = ((survivingWins / surviving.length) * 100).toFixed(1);

console.log(`  Original PnL:   ₹${totalPnl.toFixed(0)}`);
console.log(`  F8 removed PnL:  ₹${f8PnlRemoved.toFixed(0)} (all losers)`);
console.log(`  F7 removed PnL:  ₹${f7PnlRemoved.toFixed(0)}`);
console.log(`  Surviving PnL:   ₹${survivingPnl.toFixed(0)} (${surviving.length} trades, ${survivingWR}% WR)`);
console.log('');

// List F8 filtered trades
console.log('  F8 filtered trades:');
for (const t of f8Filtered) {
  const f8 = t.factors.f8_hourlySTAlignment;
  console.log(`    ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} 1h:${f8.st60min.padEnd(4)} PnL: ₹${t.pnl.toFixed(0)}`);
}
console.log('');

// List F7 filtered trades (from after-F8 pool)
console.log('  F7 filtered trades (after F8):');
for (const t of f7Filtered) {
  const f7 = t.factors.f7_rsiQuickReversal;
  const rsis = f7.rsiNextCandles.slice(0, 2).map(Number);
  const threshold = t.direction === 'LONG' ? '<62' : '>32';
  const triggerRSI = t.direction === 'LONG' ? Math.min(...rsis) : Math.max(...rsis);
  console.log(`    ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} RSI: ${triggerRSI.toFixed(1)} ${threshold}  PnL: ₹${t.pnl.toFixed(0)}`);
}

console.log('');
console.log('───────────────────────────────────────────────────────────────');
console.log('  SURVIVING TRADES (analysis pool for remaining factors):');
console.log('───────────────────────────────────────────────────────────────');
for (const t of surviving) {
  const f2 = t.factors.f2_bbWidth;
  const f3 = t.factors.f3_candleWidth;
  const f7 = t.factors.f7_rsiQuickReversal;
  const entryRSI = f7.entryRSI != null ? f7.entryRSI.toFixed(1) : 'N/A';
  console.log(`  ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} PnL:${String('₹' + t.pnl.toFixed(0)).padStart(8)}  BBw:${f2.widthPct.toFixed(2)}%  Candle:${f3.widthPct.toFixed(2)}%  EntryRSI:${entryRSI}  Exit:${t.exitReason}`);
}

// ═══════════════════════════════════════════════════════════════════
// FACTOR 1: SHORT Near S2 After 12 PM
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR 1: SHORT Near S2 After 12 PM');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

const f1Applicable = surviving.filter(t => t.factors.f1_shortS2.applicable);
const f1Before12 = surviving.filter(t => t.direction === 'SHORT' && parseInt(t.entryHourIST.split(':')[0]) < 12);
const f1After12 = surviving.filter(t => t.direction === 'SHORT' && parseInt(t.entryHourIST.split(':')[0]) >= 12);
const f1NearS2 = f1Applicable.filter(t => t.factors.f1_shortS2.applicable);

console.log(`  Surviving SHORTs: ${surviving.filter(t => t.direction === 'SHORT').length}`);
console.log(`  SHORTs before 12 PM: ${f1Before12.length} | PnL: ₹${f1Before12.reduce((s,t) => s+t.pnl, 0).toFixed(0)} | WR: ${((f1Before12.filter(t=>t.pnl>0).length/Math.max(f1Before12.length,1))*100).toFixed(0)}%`);
console.log(`  SHORTs after 12 PM:  ${f1After12.length} | PnL: ₹${f1After12.reduce((s,t) => s+t.pnl, 0).toFixed(0)} | WR: ${((f1After12.filter(t=>t.pnl>0).length/Math.max(f1After12.length,1))*100).toFixed(0)}%`);
console.log(`  F1 applicable (near S2 after 12):  ${f1NearS2.length}`);

if (f1NearS2.length > 0) {
  console.log('');
  console.log('  Near-S2 trades:');
  for (const t of f1NearS2) {
    const f1 = t.factors.f1_shortS2;
    console.log(`    ${t.symbol.padEnd(12)} ${t.date} ${t.entryHourIST} PnL: ₹${t.pnl.toFixed(0)} | ${JSON.stringify(f1)}`);
  }
}

// F1: Also analyze all after-12 SHORTs in detail
console.log('');
console.log('  All after-12PM SHORTs (detail):');
for (const t of f1After12) {
  const f1 = t.factors.f1_shortS2;
  console.log(`    ${t.symbol.padEnd(12)} ${t.date} ${t.entryHourIST} PnL: ₹${t.pnl.toFixed(0).padStart(7)} ${f1.applicable ? '⚠️ NEAR S2' : ''}`);
}

// ═══════════════════════════════════════════════════════════════════
// FACTOR 2: Bollinger Band Width — BOTH floor and ceiling analysis
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR 2: BB Width — Narrow (weak breakout) AND Wide (exhaustion)');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

// Distribution of BB widths in surviving pool
const bbWidths = surviving.map(t => ({ symbol: t.symbol, date: t.date, dir: t.direction, pnl: t.pnl, bbw: t.factors.f2_bbWidth.widthPct }));
bbWidths.sort((a, b) => a.bbw - b.bbw);

console.log('  BB Width distribution (sorted):');
for (const t of bbWidths) {
  const marker = t.pnl > 0 ? '✅' : '❌';
  console.log(`    ${marker} ${t.symbol.padEnd(12)} ${t.date} ${t.dir.padEnd(5)} BBw: ${t.bbw.toFixed(3)}%  PnL: ₹${t.pnl.toFixed(0)}`);
}

// MINIMUM threshold sweep (narrow BB = weak breakout)
console.log('');
console.log('  ── MINIMUM BB Width Threshold Sweep (reject if too narrow) ──');
console.log('  Threshold | Filtered | Kept | Kept PnL    | Kept WR | Improvement');
for (const threshold of [0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.0]) {
  const kept = surviving.filter(t => t.factors.f2_bbWidth.widthPct >= threshold);
  const filtered = surviving.filter(t => t.factors.f2_bbWidth.widthPct < threshold);
  const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
  const improvement = keptPnl - survivingPnl;
  const marker = improvement > 2000 ? '⭐' : '';
  console.log(`  ${threshold.toFixed(2).padStart(6)}%  |    ${String(filtered.length).padStart(2)}    |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
}

// MAXIMUM threshold sweep (wide BB = exhaustion) 
console.log('');
console.log('  ── MAXIMUM BB Width Threshold Sweep (reject if too wide — exhaustion) ──');
console.log('  Threshold | Filtered | Kept | Kept PnL    | Kept WR | Improvement');
for (const threshold of [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 3.0, 3.5]) {
  const kept = surviving.filter(t => t.factors.f2_bbWidth.widthPct <= threshold);
  const filtered = surviving.filter(t => t.factors.f2_bbWidth.widthPct > threshold);
  const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
  const improvement = keptPnl - survivingPnl;
  const marker = improvement > 2000 ? '⭐' : '';
  console.log(`  ${threshold.toFixed(1).padStart(6)}%  |    ${String(filtered.length).padStart(2)}    |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
}

// GOLDILOCKS zone (both floor and ceiling)
console.log('');
console.log('  ── GOLDILOCKS ZONE (min AND max together) ──');
console.log('  Min  | Max  | Kept | Kept PnL    | Kept WR | Improvement');
const minOptions = [0.5, 0.6, 0.65, 0.7];
const maxOptions = [2.0, 2.5, 3.0, 3.5];
for (const min of minOptions) {
  for (const max of maxOptions) {
    const kept = surviving.filter(t => t.factors.f2_bbWidth.widthPct >= min && t.factors.f2_bbWidth.widthPct <= max);
    const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
    const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
    const improvement = keptPnl - survivingPnl;
    const marker = improvement > 2000 ? '⭐' : '';
    console.log(`  ${min.toFixed(2)} | ${max.toFixed(1)} |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTOR 3: Breakout Candle Body Width — LARGE candle exhaustion
// (User's corrected hypothesis: large candles = exhaustion/reversal)
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR 3: Large Breakout Candle = Exhaustion/Reversal');
console.log('  (Corrected hypothesis: big candles post 0.7% = exhaustion)');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

// Distribution sorted by candle width
const candleWidths = surviving.map(t => ({
  symbol: t.symbol, date: t.date, dir: t.direction, pnl: t.pnl,
  cw: t.factors.f3_candleWidth.widthPct,
  type: t.direction === 'LONG' ? 'CE' : 'PE'
}));
candleWidths.sort((a, b) => a.cw - b.cw);

console.log('  Breakout candle width distribution (sorted):');
for (const t of candleWidths) {
  const marker = t.pnl > 0 ? '✅' : '❌';
  const bigMarker = t.cw > 0.7 ? ' 🔴BIG' : t.cw > 0.5 ? ' 🟡MED' : '';
  console.log(`    ${marker} ${t.symbol.padEnd(12)} ${t.date} ${t.dir.padEnd(5)} ${t.type} CandleW: ${t.cw.toFixed(3)}%  PnL: ₹${t.pnl.toFixed(0)}${bigMarker}`);
}

// MAXIMUM candle width threshold sweep (reject LARGE candles)
console.log('');
console.log('  ── MAXIMUM Candle Width Threshold (reject if candle too big — exhaustion) ──');
console.log('  Threshold | Filtered | Kept | Kept PnL    | Kept WR | Improvement');
for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]) {
  const kept = surviving.filter(t => t.factors.f3_candleWidth.widthPct <= threshold);
  const filtered = surviving.filter(t => t.factors.f3_candleWidth.widthPct > threshold);
  const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
  const improvement = keptPnl - survivingPnl;
  const marker = improvement > 2000 ? '⭐' : '';
  console.log(`  ${threshold.toFixed(2).padStart(6)}%  |    ${String(filtered.length).padStart(2)}    |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
}

// Split by direction: CE (LONG) vs PE (SHORT) 
console.log('');
console.log('  ── LARGE CANDLE: LONG/CE side only (user hypothesis: CE exhaustion) ──');
console.log('  Threshold | Filtered | Kept | Kept PnL    | Kept WR | Improvement');
const survivingLong = surviving.filter(t => t.direction === 'LONG');
const longPnl = survivingLong.reduce((s, t) => s + t.pnl, 0);
for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  const kept = survivingLong.filter(t => t.factors.f3_candleWidth.widthPct <= threshold);
  const filtered = survivingLong.filter(t => t.factors.f3_candleWidth.widthPct > threshold);
  const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
  const improvement = keptPnl - longPnl;
  const marker = improvement > 1000 ? '⭐' : '';
  console.log(`  ${threshold.toFixed(2).padStart(6)}%  |    ${String(filtered.length).padStart(2)}    |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
}

console.log('');
console.log('  ── LARGE CANDLE: SHORT/PE side only ──');
console.log('  Threshold | Filtered | Kept | Kept PnL    | Kept WR | Improvement');
const survivingShort = surviving.filter(t => t.direction === 'SHORT');
const shortPnl = survivingShort.reduce((s, t) => s + t.pnl, 0);
for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  const kept = survivingShort.filter(t => t.factors.f3_candleWidth.widthPct <= threshold);
  const filtered = survivingShort.filter(t => t.factors.f3_candleWidth.widthPct > threshold);
  const keptPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const keptWR = kept.length > 0 ? ((kept.filter(t => t.pnl > 0).length / kept.length) * 100).toFixed(0) : '0';
  const improvement = keptPnl - shortPnl;
  const marker = improvement > 1000 ? '⭐' : '';
  console.log(`  ${threshold.toFixed(2).padStart(6)}%  |    ${String(filtered.length).padStart(2)}    |  ${String(kept.length).padStart(2)}  | ₹${keptPnl.toFixed(0).padStart(7)} | ${keptWR.padStart(4)}%  | ${improvement >= 0 ? '+' : ''}₹${improvement.toFixed(0)} ${marker}`);
}

// Detailed: trades with candle width > 0.7%
console.log('');
console.log('  ── ALL trades with candle width > 0.7% (exhaustion candidates) ──');
const bigCandles = surviving.filter(t => t.factors.f3_candleWidth.widthPct > 0.7);
for (const t of bigCandles) {
  const marker = t.pnl > 0 ? '✅' : '❌';
  console.log(`    ${marker} ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} CandleW: ${t.factors.f3_candleWidth.widthPct.toFixed(3)}%  PnL: ₹${t.pnl.toFixed(0)}  Exit: ${t.exitReason}`);
}
const bigCandlePnl = bigCandles.reduce((s, t) => s + t.pnl, 0);
const bigCandleWR = bigCandles.length > 0 ? ((bigCandles.filter(t => t.pnl > 0).length / bigCandles.length) * 100).toFixed(0) : '0';
console.log(`  Summary: ${bigCandles.length} trades > 0.7%, PnL: ₹${bigCandlePnl.toFixed(0)}, WR: ${bigCandleWR}%`);


// ═══════════════════════════════════════════════════════════════════
// FACTOR 5: RSI Divergence at Entry (Hidden Divergence)
// User's corrected hypothesis:
// SHORT: price at new 10-candle low, but RSI NOT at new 10-candle low → don't short
// LONG: price at new 10-candle high, but RSI NOT at new 10-candle high → don't go long
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR 5: RSI Divergence — Hidden Divergence at Entry');
console.log('  SHORT: price new low but RSI not new low → bearish momentum fading');
console.log('  LONG: price new high but RSI not new high → bullish momentum fading');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

// The existing f5_rsiDivergence data from the analysis file
const f5Divergent = surviving.filter(t => t.factors.f5_rsiDivergence.hasDivergence);
const f5NoDivergent = surviving.filter(t => !t.factors.f5_rsiDivergence.hasDivergence);

console.log(`  With divergence (counter-signal):  ${f5Divergent.length} trades`);
console.log(`  Without divergence:                ${f5NoDivergent.length} trades`);
console.log('');

if (f5Divergent.length > 0) {
  const divPnl = f5Divergent.reduce((s, t) => s + t.pnl, 0);
  const divWR = ((f5Divergent.filter(t => t.pnl > 0).length / f5Divergent.length) * 100).toFixed(0);
  const noDivPnl = f5NoDivergent.reduce((s, t) => s + t.pnl, 0);
  const noDivWR = ((f5NoDivergent.filter(t => t.pnl > 0).length / f5NoDivergent.length) * 100).toFixed(0);
  
  console.log(`  Divergent:     PnL: ₹${divPnl.toFixed(0)}, WR: ${divWR}%`);
  console.log(`  Non-divergent: PnL: ₹${noDivPnl.toFixed(0)}, WR: ${noDivWR}%`);
  console.log('');
  console.log('  Divergent trades detail:');
  for (const t of f5Divergent) {
    const f5 = t.factors.f5_rsiDivergence;
    const marker = t.pnl > 0 ? '✅' : '❌';
    console.log(`    ${marker} ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} PnL: ₹${t.pnl.toFixed(0)}  Divergence: ${f5.isCounterSignal ? 'COUNTER' : 'CONFIRMING'}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTOR 6: PSAR Trail
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FACTOR 6: PSAR Trail Analysis');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

const f6WouldImprove = surviving.filter(t => t.factors.f6_psarTrail.wouldImprove);
const f6WouldHurt = surviving.filter(t => t.factors.f6_psarTrail.wouldHurt);
const f6NoChange = surviving.filter(t => !t.factors.f6_psarTrail.wouldImprove && !t.factors.f6_psarTrail.wouldHurt);

console.log(`  Would improve (exit loser earlier): ${f6WouldImprove.length}`);
console.log(`  Would hurt (exit winner earlier):   ${f6WouldHurt.length}`);
console.log(`  No change:                          ${f6NoChange.length}`);
console.log('');

// Detail the improve and hurt
console.log('  ── PSAR Would IMPROVE (saves money) ──');
for (const t of f6WouldImprove) {
  const f6 = t.factors.f6_psarTrail;
  const marker = t.pnl > 0 ? '✅→⚠️' : '❌→✅';
  console.log(`    ${marker} ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} PnL: ₹${t.pnl.toFixed(0).padStart(7)}  PSAR exit: candle #${f6.psarExitCandle} (actual: #${f6.actualExitCandle})`);
}

console.log('');
console.log('  ── PSAR Would HURT (loses money) ──');
for (const t of f6WouldHurt) {
  const f6 = t.factors.f6_psarTrail;
  console.log(`    ⚠️ ${t.symbol.padEnd(12)} ${t.date} ${t.direction.padEnd(5)} PnL: ₹${t.pnl.toFixed(0).padStart(7)}  PSAR exit: candle #${f6.psarExitCandle} (actual: #${f6.actualExitCandle})`);
}

// PSAR exit candle distribution
console.log('');
console.log('  ── PSAR Exit Candle Distribution ──');
const psarExitCandles = {};
for (const t of surviving) {
  const c = t.factors.f6_psarTrail.psarExitCandle;
  if (c !== null && c !== undefined) {
    psarExitCandles[c] = (psarExitCandles[c] || 0) + 1;
  }
}
const sortedCandles = Object.entries(psarExitCandles).sort((a,b) => Number(a[0]) - Number(b[0]));
for (const [candle, count] of sortedCandles) {
  console.log(`    Candle #${candle}: ${count} trades ${candle === '1' ? '← Too sensitive!' : ''}`);
}

// ═══════════════════════════════════════════════════════════════════
// COMBINED SUMMARY — What's left to gain after F7+F8
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  COMBINED SUMMARY — Marginal Value After F7+F8');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
console.log(`  Baseline (post F7+F8): ${surviving.length} trades, ₹${survivingPnl.toFixed(0)}, ${survivingWR}% WR`);
console.log('');

// Best F2 (minimum BB width)
const f2BestThreshold = 0.7;
const f2Kept = surviving.filter(t => t.factors.f2_bbWidth.widthPct >= f2BestThreshold);
const f2KeptPnl = f2Kept.reduce((s, t) => s + t.pnl, 0);
const f2Improvement = f2KeptPnl - survivingPnl;
console.log(`  F2 (BB width ≥ ${f2BestThreshold}%): ${surviving.length - f2Kept.length} filtered, ${f2Kept.length} kept, PnL: ₹${f2KeptPnl.toFixed(0)}, Δ: ${f2Improvement >= 0 ? '+' : ''}₹${f2Improvement.toFixed(0)}`);

// F2 max threshold test
const f2Max = 2.5;
const f2MaxKept = surviving.filter(t => t.factors.f2_bbWidth.widthPct <= f2Max);
const f2MaxKeptPnl = f2MaxKept.reduce((s, t) => s + t.pnl, 0);
const f2MaxImprovement = f2MaxKeptPnl - survivingPnl;
console.log(`  F2 (BB width ≤ ${f2Max}%): ${surviving.length - f2MaxKept.length} filtered, ${f2MaxKept.length} kept, PnL: ₹${f2MaxKeptPnl.toFixed(0)}, Δ: ${f2MaxImprovement >= 0 ? '+' : ''}₹${f2MaxImprovement.toFixed(0)}`);

// Best F3 (max candle width)
for (const threshold of [0.5, 0.7, 0.8]) {
  const f3Kept = surviving.filter(t => t.factors.f3_candleWidth.widthPct <= threshold);
  const f3KeptPnl = f3Kept.reduce((s, t) => s + t.pnl, 0);
  const f3Improvement = f3KeptPnl - survivingPnl;
  console.log(`  F3 (candle ≤ ${threshold}%): ${surviving.length - f3Kept.length} filtered, ${f3Kept.length} kept, PnL: ₹${f3KeptPnl.toFixed(0)}, Δ: ${f3Improvement >= 0 ? '+' : ''}₹${f3Improvement.toFixed(0)}`);
}

// F5 (divergence)
if (f5Divergent.length > 0) {
  const f5KeptPnl = f5NoDivergent.reduce((s, t) => s + t.pnl, 0);
  const f5Improvement = f5KeptPnl - survivingPnl;
  console.log(`  F5 (no divergence): ${f5Divergent.length} filtered, ${f5NoDivergent.length} kept, PnL: ₹${f5KeptPnl.toFixed(0)}, Δ: ${f5Improvement >= 0 ? '+' : ''}₹${f5Improvement.toFixed(0)}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  END OF ANALYSIS');
console.log('═══════════════════════════════════════════════════════════════════');
