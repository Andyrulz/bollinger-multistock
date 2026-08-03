/**
 * QC harness for slot bias filter (StrategyManager.allowedBiasesForSlot + handleEmptySlot).
 * Pure-logic mirror — if production logic changes, update BOTH.
 */

interface Flags { enableShortEntries: boolean; enableFvgEntry: boolean; fvgSlots?: number[]; }
interface Candidate { symbol: string; bias: 'LONG' | 'SHORT'; score: number; }

function allowedBiasesForSlot(slotIndex: number, f: Flags): Array<'LONG' | 'SHORT'> {
  if (f.enableFvgEntry && Array.isArray(f.fvgSlots) && f.fvgSlots.includes(slotIndex)) return ['LONG'];
  if (!f.enableShortEntries) return ['LONG'];
  return ['LONG', 'SHORT'];
}

function pickForSlot(slotIndex: number, candidates: Candidate[], flags: Flags, deployed: Set<string> = new Set(), cooldown: Set<string> = new Set()): Candidate | null {
  const allowed = allowedBiasesForSlot(slotIndex, flags);
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  return sorted.find(c => !deployed.has(c.symbol) && !cooldown.has(c.symbol) && allowed.includes(c.bias)) || null;
}

let passN = 0, failN = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { passN++; console.log(`✅ ${name}`); }
  else { failN++; console.log(`❌ ${name}`); if (extra !== undefined) console.log('   ', JSON.stringify(extra)); }
}

const LIVE = { enableShortEntries: false, enableFvgEntry: true, fvgSlots: [2] };  // production today

// S1: helper returns LONG-only for FVG slot
check('S1 FVG slot is LONG-only', JSON.stringify(allowedBiasesForSlot(2, LIVE)) === '["LONG"]');

// S2: helper returns LONG-only for non-FVG slot when shorts disabled
check('S2 Non-FVG slot with shorts off → LONG-only', JSON.stringify(allowedBiasesForSlot(0, LIVE)) === '["LONG"]');
check('S2b Non-FVG slot index 1 with shorts off → LONG-only', JSON.stringify(allowedBiasesForSlot(1, LIVE)) === '["LONG"]');

// S3: with shorts enabled (and no FVG), all slots are LONG+SHORT
const SHORTS_ON = { enableShortEntries: true, enableFvgEntry: false };
check('S3 Shorts on, no FVG → both biases', JSON.stringify(allowedBiasesForSlot(0, SHORTS_ON)) === '["LONG","SHORT"]');

// S4: with shorts ON and FVG on slot 2, slot 2 still LONG-only, others both
const HYBRID = { enableShortEntries: true, enableFvgEntry: true, fvgSlots: [2] };
check('S4 Hybrid: slot 0 both', JSON.stringify(allowedBiasesForSlot(0, HYBRID)) === '["LONG","SHORT"]');
check('S4 Hybrid: slot 1 both', JSON.stringify(allowedBiasesForSlot(1, HYBRID)) === '["LONG","SHORT"]');
check('S4 Hybrid: slot 2 LONG-only (FVG override)', JSON.stringify(allowedBiasesForSlot(2, HYBRID)) === '["LONG"]');

// S5: REPLAY 2026-06-04 13:14 — top-3 = [GODREJPROP SHORT 14.5, ULTRACEMCO SHORT 10.0, TITAN LONG 14.0]
// Before fix: slot 1 got GODREJPROP SHORT, slot 2 got ULTRACEMCO SHORT, slot 3 got TITAN LONG (correct only because TITAN was already locked)
// After fix: slot 1 + slot 2 should both pick TITAN... but TITAN can only deploy to ONE slot.
// Real scanner output that day for empty slots: best LONG = TITAN, second-best LONG = ? — replay strict to top-3
const jun4_1314_top3: Candidate[] = [
  { symbol: 'GODREJPROP', bias: 'SHORT', score: 14.5 },
  { symbol: 'ULTRACEMCO', bias: 'SHORT', score: 10.0 },
  { symbol: 'TITAN', bias: 'LONG', score: 14.0 },
];
// Simulate: slot 3 already has TITAN locked
const deployed_1314 = new Set(['TITAN']);
const slot1_pick = pickForSlot(0, jun4_1314_top3, LIVE, deployed_1314);
check('S5a Slot 1: skips both SHORTs, no LONG left → null', slot1_pick === null);
// Confirm: scanner top-3 was all-wrong-bias for non-FVG slots
const slot2_pick = pickForSlot(1, jun4_1314_top3, LIVE, deployed_1314);
check('S5b Slot 2: same — no eligible LONG → null', slot2_pick === null);
// Slot 3 (FVG): TITAN already deployed, so also null
const slot3_pick = pickForSlot(2, jun4_1314_top3, LIVE, deployed_1314);
check('S5c Slot 3 (FVG): TITAN already deployed → null', slot3_pick === null);

// S6: Same top-3, slot 3 empty — must pick TITAN, NOT SHORT
const slot3_empty = pickForSlot(2, jun4_1314_top3, LIVE, new Set());
check('S6 Slot 3 picks TITAN (LONG) over higher-scored SHORTs', slot3_empty?.symbol === 'TITAN');

// S7: REPLAY 13:54 — Slot 3 deployment of ADANIGREEN SHORT (the bug we saw)
// Old behavior: deployed ADANIGREEN SHORT → dead slot. New: picks the next LONG, or null
const jun4_1354_top3: Candidate[] = [
  { symbol: 'ADANIGREEN', bias: 'SHORT', score: 12.0 },
  { symbol: 'HAL', bias: 'SHORT', score: 12.4 },
  { symbol: 'CHOLAFIN', bias: 'LONG', score: 6.9 },
];
const deployed_1354 = new Set(['CHOLAFIN', 'HAL']);  // both already in slots 1, 2
const slot3_1354 = pickForSlot(2, jun4_1354_top3, LIVE, deployed_1354);
check('S7 Slot 3 FVG: rejects ADANIGREEN SHORT, no other LONG → null', slot3_1354 === null);

// S8: Cooldown still respected on top of bias filter
const cool: Candidate[] = [
  { symbol: 'A', bias: 'LONG', score: 12 },
  { symbol: 'B', bias: 'LONG', score: 10 },
  { symbol: 'C', bias: 'SHORT', score: 15 },
];
const slot1_cool = pickForSlot(0, cool, LIVE, new Set(), new Set(['A']));
check('S8 Slot 1: A in cooldown, C is SHORT → picks B', slot1_cool?.symbol === 'B');

// S9: All candidates SHORT → slot returns null even though they are top-scored
const allShort: Candidate[] = [
  { symbol: 'X', bias: 'SHORT', score: 20 },
  { symbol: 'Y', bias: 'SHORT', score: 18 },
];
check('S9 All-SHORT scan → slot empty (not wrong-bias deploy)', pickForSlot(0, allShort, LIVE) === null);

// S10: All LONG → highest score wins
const allLong: Candidate[] = [
  { symbol: 'X', bias: 'LONG', score: 8 },
  { symbol: 'Y', bias: 'LONG', score: 12 },
  { symbol: 'Z', bias: 'LONG', score: 10 },
];
check('S10 All-LONG → picks Y (highest)', pickForSlot(0, allLong, LIVE)?.symbol === 'Y');

// S11: Mixed — LONG beats higher-scored SHORT in restricted slots
const mixed: Candidate[] = [
  { symbol: 'BIG_SHORT', bias: 'SHORT', score: 18 },
  { symbol: 'OK_LONG', bias: 'LONG', score: 10 },
];
check('S11 Mixed: LONG-only slot picks OK_LONG (10) over BIG_SHORT (18)',
  pickForSlot(0, mixed, LIVE)?.symbol === 'OK_LONG');
check('S11b Mixed: with shorts ON, slot picks BIG_SHORT (highest)',
  pickForSlot(0, mixed, SHORTS_ON)?.symbol === 'BIG_SHORT');

console.log(`\n── Result: ${passN} passed, ${failN} failed ──`);
process.exit(failN > 0 ? 1 : 0);
