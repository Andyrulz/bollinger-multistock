/**
 * QC harness — Phase 3 FVG state machine.
 * Mirrors the production logic in BollingerBandStrategy.progressFvgWatch.
 * If they drift, BOTH must be updated.
 */

interface Candle { timestamp: Date; open: number; high: number; low: number; close: number; }

interface FvgWatch {
  armedAt: Date;
  signalClose: number;
  candlesScanned: number;
  lastProgressedCandleTs: Date | null;
  fvg: { floor: number; ceiling: number; slLevel: number; width: number; impulseTs: Date } | null;
  trigger: number | null;
  triggerCandleTs: Date | null;
}

const FLAGS = { fvgMinGapPct: 0.0015, fvgMaxScanCandles: 8, fvgMaxLifeCandles: 48, fvgInvalidateOnFloorClose: true, enableFvgLookback: true, fvgLookbackCandles: 5, enableFvgUpgrade: true };

function detectBullishFvg(c1: Candle, c2: Candle, c3: Candle, impulseClose: number, minGapPct: number) {
  if (!(c1.high < c3.low)) return null;
  const width = c3.low - c1.high;
  if (width < impulseClose * minGapPct) return null;
  return { floor: c1.high, ceiling: c3.low, slLevel: c2.low, width };
}

/**
 * Mirror of BollingerBandStrategy.findRecentUntouchedBullishFvg. If they drift, BOTH must update.
 */
function findRecentUntouchedBullishFvg(
  history: Candle[],
  signalCandle: Candle,
  lookbackCandles: number,
  minGapPct: number,
  invalidateOnFloorClose: boolean,
): { floor: number; ceiling: number; slLevel: number; width: number; impulseTs: Date } | null {
  if (history.length < 3) return null;
  let signalIdx = history.length - 1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i]!.timestamp.getTime() === signalCandle.timestamp.getTime()) {
      signalIdx = i; break;
    }
  }
  const oldestC3 = Math.max(2, signalIdx - lookbackCandles + 1);
  for (let c3Idx = signalIdx; c3Idx >= oldestC3; c3Idx--) {
    const c1 = history[c3Idx - 2], c2 = history[c3Idx - 1], c3 = history[c3Idx];
    if (!c1 || !c2 || !c3) continue;
    const fvg = detectBullishFvg(c1, c2, c3, signalCandle.close, minGapPct);
    if (!fvg) continue;
    let touched = false;
    for (let k = c3Idx + 1; k <= signalIdx; k++) {
      const cand = history[k];
      if (!cand) continue;
      if (cand.low <= fvg.ceiling) { touched = true; break; }
      if (invalidateOnFloorClose && cand.close < fvg.floor) { touched = true; break; }
    }
    if (touched) continue;
    return { ...fvg, impulseTs: c2.timestamp };
  }
  return null;
}

interface QcEvent { stage: string; detail?: any; }
const events: QcEvent[] = [];

function progressFvgWatch(history: Candle[], watch: FvgWatch, latest: Candle): string {
  const ts = latest.timestamp.getTime();
  if (watch.lastProgressedCandleTs !== null && watch.lastProgressedCandleTs.getTime() === ts) {
    return 'DEDUPED';
  }
  watch.lastProgressedCandleTs = latest.timestamp;
  watch.candlesScanned++;

  if (watch.fvg && FLAGS.fvgInvalidateOnFloorClose && latest.close < watch.fvg.floor) {
    events.push({ stage: 'FVG_INVALIDATED', detail: { close: latest.close, floor: watch.fvg.floor, scanned: watch.candlesScanned } });
    return 'INVALIDATED';
  }

  if (watch.candlesScanned > FLAGS.fvgMaxLifeCandles) {
    events.push({ stage: 'FVG_INVALIDATED', detail: { reason: 'lifetime_exceeded' } });
    return 'INVALIDATED';
  }

  if (!watch.fvg) {
    if (history.length >= 3) {
      const c1 = history[history.length - 3]!, c2 = history[history.length - 2]!, c3 = history[history.length - 1]!;
      if (c2.timestamp.getTime() >= watch.armedAt.getTime()) {
        const fvg = detectBullishFvg(c1, c2, c3, watch.signalClose, FLAGS.fvgMinGapPct);
        if (fvg) {
          watch.fvg = { ...fvg, impulseTs: c2.timestamp };
          events.push({ stage: 'FVG_FORMED', detail: fvg });
          return 'FVG_FORMED';
        }
      }
    }
    if (watch.candlesScanned >= FLAGS.fvgMaxScanCandles) {
      events.push({ stage: 'FVG_INVALIDATED', detail: { reason: 'scan_window_expired' } });
      return 'INVALIDATED';
    }
    return 'SCANNING';
  }

  // Option 1 — mirror of BollingerBandStrategy.maybeUpgradeFvg. While pre-trigger, a
  // newer-impulse valid FVG supersedes the watched zone. If they drift, BOTH must update.
  if (FLAGS.enableFvgUpgrade && watch.trigger === null && watch.fvg && history.length >= 3) {
    const c1 = history[history.length - 3]!, c2 = history[history.length - 2]!, c3 = history[history.length - 1]!;
    if (c2.timestamp.getTime() >= watch.armedAt.getTime()
        && c2.timestamp.getTime() > watch.fvg.impulseTs.getTime()) {
      const upgraded = detectBullishFvg(c1, c2, c3, watch.signalClose, FLAGS.fvgMinGapPct);
      if (upgraded) {
        const prev = watch.fvg;
        watch.fvg = { ...upgraded, impulseTs: c2.timestamp };
        events.push({ stage: 'FVG_UPGRADED', detail: { from: { floor: prev.floor, ceiling: prev.ceiling }, to: upgraded } });
        return 'FVG_UPGRADED';
      }
    }
  }

  const fvg = watch.fvg;
  const wickInside = latest.low <= fvg.ceiling && latest.high >= fvg.floor;
  const sameAsTrigger = watch.triggerCandleTs !== null && latest.timestamp.getTime() === watch.triggerCandleTs.getTime();

  if (watch.trigger === null) {
    if (wickInside) {
      watch.trigger = latest.high;
      watch.triggerCandleTs = latest.timestamp;
      events.push({ stage: 'FVG_TRIGGER_SET', detail: { trigger: watch.trigger } });
      return 'TRIGGER_SET';
    }
    return 'WAITING_TRIGGER';
  }

  if (!sameAsTrigger && latest.high >= watch.trigger) {
    events.push({ stage: 'FVG_ENTRY', detail: { trigger: watch.trigger, candleHigh: latest.high, slLevel: fvg.slLevel } });
    return 'ENTRY';
  }

  if (!sameAsTrigger && wickInside && latest.high < watch.trigger) {
    const old = watch.trigger;
    watch.trigger = latest.high;
    watch.triggerCandleTs = latest.timestamp;
    events.push({ stage: 'FVG_TRIGGER_LOWERED', detail: { from: old, to: watch.trigger } });
    return 'TRIGGER_LOWERED';
  }

  return 'IDLE';
}

function ts(t: string): Date { return new Date(`2026-06-04T${t}:00+05:30`); }
function c(t: string, o: number, h: number, l: number, cl: number): Candle {
  return { timestamp: ts(t), open: o, high: h, low: l, close: cl };
}
function freshWatch(signal: Candle): FvgWatch {
  return {
    armedAt: signal.timestamp, signalClose: signal.close,
    candlesScanned: 0, lastProgressedCandleTs: null,
    fvg: null, trigger: null, triggerCandleTs: null,
  };
}

let passN = 0, failN = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { passN++; console.log(`✅ ${name}`); }
  else { failN++; console.log(`❌ ${name}`); if (extra !== undefined) console.log('   ', JSON.stringify(extra)); }
}

function runSequence(history: Candle[], watch: FvgWatch, post: Candle[]): { result: string; events: QcEvent[] } {
  events.length = 0;
  const hist = [...history];
  let result = 'INIT';
  for (const cand of post) {
    hist.push(cand);
    result = progressFvgWatch(hist, watch, cand);
    if (result === 'INVALIDATED' || result === 'ENTRY') break;
  }
  return { result, events: [...events] };
}

// S1: TITAN ARM #2 — FVG forms, 13:50 floor close invalidates
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4218, 4206, 4210),
    c('13:30', 4210, 4209, 4202, 4205),
    c('13:35', 4205, 4208, 4199, 4202),
    c('13:40', 4202, 4205, 4195, 4198),
    c('13:45', 4198, 4200, 4188, 4193),
    c('13:50', 4193, 4195, 4180, 4186),
  ]);
  check('S1 TITAN ARM #2 floor-close invalidate', r.result === 'INVALIDATED');
  check('S1 candlesScanned = 8 (one per candle)', watch.candlesScanned === 8, { got: watch.candlesScanned });
}

// S2: Clean entry
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4220, 4203, 4208),
    c('13:30', 4208, 4225, 4205, 4222),
  ]);
  check('S2 Clean entry', r.result === 'ENTRY');
  check('S2 slLevel = c2.low (4188)', r.events.find(e => e.stage === 'FVG_ENTRY')?.detail?.slLevel === 4188);
}

// S3: Same-candle replay — dedup blocks entry on same-ts higher-high update
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const h2 = [...hist];
  for (const cand of [c('13:15', 4189, 4203, 4188, 4202), c('13:20', 4204.4, 4215, 4204.4, 4212)]) {
    h2.push(cand); progressFvgWatch(h2, watch, cand);
  }
  const tickA = c('13:25', 4212, 4220, 4203, 4208);
  const tickB = { ...tickA, high: 4225 };
  h2.push(tickA);
  events.length = 0;
  const rA = progressFvgWatch(h2, watch, tickA);
  h2[h2.length - 1] = tickB;
  const rB = progressFvgWatch(h2, watch, tickB);
  check('S3 Trigger set on first tick', rA === 'TRIGGER_SET');
  check('S3 Same-ts replay deduped', rB === 'DEDUPED');
  check('S3 No ENTRY emitted', !events.find(e => e.stage === 'FVG_ENTRY'));
}

// S4: Sub-min-gap rejected, scan window expires
{
  const signal = c('13:10', 4180, 4191, 4178, 4190);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4190, 4192, 4189, 4191),
    c('13:20', 4193, 4195, 4193, 4194),
    c('13:25', 4194, 4196, 4194, 4195),
    c('13:30', 4195, 4197, 4195, 4196),
    c('13:35', 4196, 4198, 4196, 4197),
    c('13:40', 4197, 4199, 4197, 4198),
    c('13:45', 4198, 4200, 4198, 4199),
    c('13:50', 4199, 4201, 4199, 4200),
  ]);
  check('S4 Sub-min-gap → INVALIDATED', r.result === 'INVALIDATED');
  check('S4 Reason = scan_window_expired',
    r.events[r.events.length - 1]?.detail?.reason === 'scan_window_expired');
}

// S5: Ratchet + breach
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4220, 4203, 4208),
    c('13:30', 4208, 4215, 4202, 4210),
    c('13:35', 4210, 4212, 4200, 4205),
    c('13:40', 4205, 4213, 4204, 4210),
  ]);
  check('S5 Ratchet + breach → ENTRY', r.result === 'ENTRY');
  check('S5 Two ratchet events', r.events.filter(e => e.stage === 'FVG_TRIGGER_LOWERED').length === 2);
}

// S6: Re-fetch storm — same closed candle 10x must NOT exhaust window
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const cand = c('13:15', 4189, 4203, 4188, 4202);
  hist.push(cand);
  events.length = 0;
  let dedupCount = 0;
  for (let i = 0; i < 10; i++) {
    if (progressFvgWatch(hist, watch, cand) === 'DEDUPED') dedupCount++;
  }
  check('S6 Re-fetch deduped 9 times', dedupCount === 9, { dedupCount });
  check('S6 candlesScanned == 1 (not 10)', watch.candlesScanned === 1, { got: watch.candlesScanned });
}

// S7: Signal-as-impulse FVG
{
  const signal = c('13:10', 4180, 4203, 4178, 4202);
  const watch = freshWatch(signal);
  const hist = [
    c('13:00', 4170, 4180, 4168, 4178),
    c('13:05', 4178, 4191, 4175, 4180),
    signal,
  ];
  const r = runSequence(hist, watch, [c('13:15', 4204.4, 4215, 4204.4, 4212)]);
  check('S7 Signal-as-impulse FVG forms', r.result === 'FVG_FORMED');
  check('S7 slLevel = signal.low (4178)', watch.fvg?.slLevel === 4178);
}

// S8: Pre-arm window rejected
{
  const hist = [
    c('13:00', 4170, 4180, 4168, 4178),
    c('13:05', 4178, 4205, 4175, 4200),
    c('13:10', 4205, 4215, 4205, 4210),
  ];
  const watch = freshWatch(hist[2]!);
  events.length = 0;
  const r = progressFvgWatch(hist, watch, hist[hist.length - 1]!);
  check('S8 Pre-arm window not auto-detected',
    !events.find(e => e.stage === 'FVG_FORMED'));
}

// S9: Floor-close priority over trigger
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4210, 4220, 4185, 4188),
  ]);
  check('S9 Wick + close<floor → INVALIDATED', r.result === 'INVALIDATED');
  check('S9 No TRIGGER_SET emitted', !r.events.find(e => e.stage === 'FVG_TRIGGER_SET'));
}

// S10: Wick above ceiling — no touch, no trigger
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4220, 4206, 4215),
  ]);
  check('S10 Above-ceiling wick → no trigger', !r.events.find(e => e.stage === 'FVG_TRIGGER_SET'));
}

// S11: Persistence round-trip
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4220, 4203, 4208),
  ]);
  const restored = JSON.parse(JSON.stringify(watch)) as FvgWatch;
  restored.armedAt = new Date(restored.armedAt);
  if (restored.lastProgressedCandleTs) restored.lastProgressedCandleTs = new Date(restored.lastProgressedCandleTs);
  if (restored.triggerCandleTs) restored.triggerCandleTs = new Date(restored.triggerCandleTs);
  if (restored.fvg) restored.fvg.impulseTs = new Date(restored.fvg.impulseTs);
  check('S11 fvg.floor preserved', restored.fvg?.floor === 4191);
  check('S11 trigger preserved', restored.trigger === 4220);
  const hist2 = [...hist, c('13:15', 4189, 4203, 4188, 4202), c('13:20', 4204.4, 4215, 4204.4, 4212), c('13:25', 4212, 4220, 4203, 4208)];
  events.length = 0;
  const r2 = progressFvgWatch(hist2, restored, c('13:30', 4208, 4225, 4205, 4222));
  check('S11 Restored watch can fire ENTRY', r2 === 'ENTRY');
}

// S12: Wick exactly equal to ceiling (boundary touch)
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4212, 4220, 4204.4, 4215),  // low EXACTLY at ceiling
  ]);
  check('S12 Wick at boundary (low==ceiling) → trigger set (inclusive)',
    !!r.events.find(e => e.stage === 'FVG_TRIGGER_SET'));
}

// S13: Close exactly equal to floor (boundary)
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4203, 4188, 4202),
    c('13:20', 4204.4, 4215, 4204.4, 4212),
    c('13:25', 4210, 4220, 4188, 4191),    // close EXACTLY at floor — strict < means NOT invalidate
  ]);
  check('S13 Close == floor (not <) → NOT invalidated (strict<)',
    r.result !== 'INVALIDATED');
}

// S14: Min-gap exactly at threshold (>=)
{
  const signal = c('13:10', 4180, 4191, 4178, 4000);  // signal close = 4000, 0.15% = 6.0
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  // Width exactly 6.0: c1=signal (high=4191), c2 (impulse), c3.low=4197
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4196, 4188, 4195),     // c2 — impulse
    c('13:20', 4197, 4210, 4197, 4205),     // c3 — low=4197, gap=4197-4191=6.0 = threshold
  ]);
  check('S14 Gap == minGap → accepted (>=)', !!watch.fvg);
}

// S15: All 3-candle windows have sub-min gaps (or no gap) → never forms → INVALIDATED at window expiry
{
  const signal = c('13:10', 4180, 4191, 4178, 4000);  // 0.15% = 6.0
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  // Engineered: every consecutive 3-candle window has c3.low <= c1.high (no gap) or gap < 6.0
  const r = runSequence(hist, watch, [
    c('13:15', 4189, 4192, 4188, 4190),     // c1=signal(h=4191), c2=13:15(h=4192), c3=13:15 → window not done yet
    c('13:20', 4190, 4193, 4189, 4191),     // window: c1=signal(4191) c2=13:15(4192) c3=13:20(low=4189) → 4189<4191 → no FVG
    c('13:25', 4191, 4194, 4190, 4192),     // c1=13:15(4192) c2=13:20(4193) c3=13:25(low=4190) → 4190<4192 → no FVG
    c('13:30', 4192, 4195, 4191, 4193),
    c('13:35', 4193, 4196, 4192, 4194),
    c('13:40', 4194, 4197, 4193, 4195),
    c('13:45', 4195, 4198, 4194, 4196),
    c('13:50', 4196, 4199, 4195, 4197),     // 8th post-arm candle
  ]);
  check('S15 No FVG ever forms → INVALIDATED at window expiry',
    r.result === 'INVALIDATED' && !r.events.find(e => e.stage === 'FVG_FORMED'));
}

// S16: Lifetime cap — FVG forms but price never touches; 48-candle cap fires
{
  const signal = c('13:10', 4180, 4191, 4178, 4189);
  const watch = freshWatch(signal);
  const hist = [c('13:00', 4170, 4180, 4168, 4178), c('13:05', 4178, 4185, 4175, 4180), signal];
  // Form FVG quickly, then drift upward forever (never re-touch, never close < floor)
  const post: Candle[] = [
    c('13:15', 4189, 4203, 4188, 4202),         // c2 impulse
    c('13:20', 4204.4, 4215, 4204.4, 4212),     // c3 — FVG forms here
  ];
  // 50 more candles drifting up; low always > ceiling (4204.4); close always > floor (4191)
  for (let i = 0; i < 50; i++) {
    const base = 4215 + i * 0.5;
    post.push({ timestamp: new Date(signal.timestamp.getTime() + (3 + i) * 5 * 60 * 1000), open: base, high: base + 1, low: base, close: base + 0.5 });
  }
  const r = runSequence(hist, watch, post);
  check('S16 Lifetime cap fires (no touch for hours)', r.result === 'INVALIDATED');
  check('S16 Reason = lifetime_exceeded',
    r.events[r.events.length - 1]?.detail?.reason === 'lifetime_exceeded');
  check('S16 candlesScanned = 49 when lifetime fires (> 48)', watch.candlesScanned === 49, { got: watch.candlesScanned });
}

// ─── Lookback (Jun 2026) — BollingerBandStrategy.findRecentUntouchedBullishFvg ───

// L1: BOSCH 2026-06-09 — breakout-impulse FVG retest. Signal candle is c3 itself.
//     c1=09:45 (h=37210), c2=09:50 (h=37430,l=37155), c3=09:55 (l=37365). Gap=155, minGap=37565*0.0015=56.3 → ✅
{
  const ts2 = (t: string): Date => new Date(`2026-06-09T${t}:00+05:30`);
  const cc = (t: string, o: number, h: number, l: number, cl: number): Candle =>
    ({ timestamp: ts2(t), open: o, high: h, low: l, close: cl });
  const history: Candle[] = [
    cc('09:15', 36855, 37015, 36745, 36925),
    cc('09:20', 36910, 37000, 36830, 37000),
    cc('09:25', 37000, 37100, 37000, 37030),
    cc('09:30', 37035, 37050, 36990, 36995),
    cc('09:35', 36970, 37005, 36885, 36890),
    cc('09:40', 36890, 37005, 36885, 36985),
    cc('09:45', 36985, 37210, 36985, 37160),
    cc('09:50', 37155, 37430, 37155, 37410),
    cc('09:55', 37410, 37645, 37365, 37565),  // signal
  ];
  const signal = history[history.length - 1]!;
  const fvg = findRecentUntouchedBullishFvg(history, signal, FLAGS.fvgLookbackCandles, FLAGS.fvgMinGapPct, FLAGS.fvgInvalidateOnFloorClose);
  check('L1 BOSCH lookback finds FVG', !!fvg);
  check('L1 BOSCH floor=37210 (09:45 high)', fvg?.floor === 37210);
  check('L1 BOSCH ceiling=37365 (09:55 low)', fvg?.ceiling === 37365);
  check('L1 BOSCH slLevel=37155 (09:50 low)', fvg?.slLevel === 37155);
  check('L1 BOSCH impulseTs=09:50', fvg?.impulseTs.getTime() === ts2('09:50').getTime());

  // Now seed watch with lookback FVG and progress through 10:00 → 10:10.
  const watch = freshWatch(signal);
  if (fvg) watch.fvg = { floor: fvg.floor, ceiling: fvg.ceiling, slLevel: fvg.slLevel, width: fvg.width, impulseTs: fvg.impulseTs };
  const post: Candle[] = [
    cc('10:00', 37565, 37600, 37425, 37425),
    cc('10:05', 37425, 37455, 37360, 37375),  // wick into zone (low=37360 ≤ ceiling=37365) → trigger SET at high 37455
    cc('10:10', 37375, 37545, 37375, 37450),  // high=37545 ≥ trigger 37455 → ENTRY
  ];
  events.length = 0;
  const hist = [...history];
  let result = 'INIT';
  for (const cand of post) {
    hist.push(cand);
    result = progressFvgWatch(hist, watch, cand);
    if (result === 'INVALIDATED' || result === 'ENTRY') break;
  }
  check('L1 BOSCH progresses to ENTRY by 10:10', result === 'ENTRY');
  const entryEvt = events.find(e => e.stage === 'FVG_ENTRY');
  check('L1 BOSCH trigger captured at 37455', entryEvt?.detail?.trigger === 37455);
  check('L1 BOSCH slLevel forwarded to entry (37155)', entryEvt?.detail?.slLevel === 37155);
}

// L2: Already-touched FVG → lookback rejects, returns null
{
  const ts2 = (t: string): Date => new Date(`2026-06-09T${t}:00+05:30`);
  const cc = (t: string, o: number, h: number, l: number, cl: number): Candle =>
    ({ timestamp: ts2(t), open: o, high: h, low: l, close: cl });
  // Engineered: only ONE candidate FVG (idx 0/1/2) and it gets touched at idx 3.
  // Older windows don't exist (history length = 5); newer windows (c3=3, c3=4) don't gap.
  const history: Candle[] = [
    cc('09:40', 100, 110, 95, 108),       // c1
    cc('09:45', 108, 140, 108, 135),      // c2 (impulse)
    cc('09:50', 140, 160, 145, 155),      // c3 — gap 110→145 (width 35, minGap=165*0.0015≈0.25 → ✅)
    cc('09:55', 155, 150, 130, 140),      // TOUCHES zone (low=130 ≤ ceiling=145)
    cc('10:00', 140, 170, 138, 165),      // signal
  ];
  const signal = history[history.length - 1]!;
  const fvg = findRecentUntouchedBullishFvg(history, signal, FLAGS.fvgLookbackCandles, FLAGS.fvgMinGapPct, FLAGS.fvgInvalidateOnFloorClose);
  check('L2 already-touched FVG returns null', fvg === null);
}

// L3: Floor-close pre-signal → lookback rejects
{
  const ts2 = (t: string): Date => new Date(`2026-06-09T${t}:00+05:30`);
  const cc = (t: string, o: number, h: number, l: number, cl: number): Candle =>
    ({ timestamp: ts2(t), open: o, high: h, low: l, close: cl });
  // FVG at 09:45/09:50/09:55. A subsequent candle closes BELOW floor (37210) but doesn't wick inside zone.
  // With invalidateOnFloorClose=true that should disqualify the FVG.
  // We need: cand.low > fvg.ceiling=37365 (so untouched-by-wick), but cand.close < 37210 (floor-close).
  // That's contradictory (if low>37365 then close>=37365>37210). So instead: low<=floor but never wicks INTO zone is hard.
  // Real-world floor-close: low DOES wick below floor (and thus below zone). low<floor means low<37210 so low<37365 → wick inside zone. So floor-close ALWAYS implies a wick into zone. The floor-close branch is therefore subsumed by the touch branch in lookback. We test that the touch branch alone catches it:
  const history: Candle[] = [
    cc('09:40', 36890, 37005, 36885, 36985),
    cc('09:45', 36985, 37210, 36985, 37160),
    cc('09:50', 37155, 37430, 37155, 37410),
    cc('09:55', 37410, 37645, 37365, 37580),
    cc('10:00', 37300, 37320, 37100, 37150),  // close=37150 < floor=37210 AND wicks zone
    cc('10:05', 37150, 37700, 37145, 37680),  // signal
  ];
  const signal = history[history.length - 1]!;
  const fvg = findRecentUntouchedBullishFvg(history, signal, FLAGS.fvgLookbackCandles, FLAGS.fvgMinGapPct, FLAGS.fvgInvalidateOnFloorClose);
  check('L3 floor-closed FVG returns null', fvg === null);
}

// L4: Lookback disabled equivalent — null when lookbackCandles=0 (defensive)
{
  const ts2 = (t: string): Date => new Date(`2026-06-09T${t}:00+05:30`);
  const cc = (t: string, o: number, h: number, l: number, cl: number): Candle =>
    ({ timestamp: ts2(t), open: o, high: h, low: l, close: cl });
  const history: Candle[] = [
    cc('09:45', 36985, 37210, 36985, 37160),
    cc('09:50', 37155, 37430, 37155, 37410),
    cc('09:55', 37410, 37645, 37365, 37565),
  ];
  const signal = history[history.length - 1]!;
  // lookbackCandles=0 → oldestC3 = max(2, signalIdx - 0 + 1) = max(2, 3) = 3 > signalIdx=2 → loop doesn't run
  const fvg = findRecentUntouchedBullishFvg(history, signal, 0, FLAGS.fvgMinGapPct, FLAGS.fvgInvalidateOnFloorClose);
  check('L4 lookbackCandles=0 returns null (no scan)', fvg === null);
}

// L5: Min-gap check still applies in lookback
{
  const ts2 = (t: string): Date => new Date(`2026-06-09T${t}:00+05:30`);
  const cc = (t: string, o: number, h: number, l: number, cl: number): Candle =>
    ({ timestamp: ts2(t), open: o, high: h, low: l, close: cl });
  // Tiny gap, well below 0.15% of close
  const history: Candle[] = [
    cc('09:45', 100, 200, 100, 150),
    cc('09:50', 150, 210, 150, 200),
    cc('09:55', 200, 211, 200.5, 200),  // gap=0.5, minGap=200*0.0015=0.3 → just over threshold
  ];
  const signal = history[history.length - 1]!;
  const fvgBig = findRecentUntouchedBullishFvg(history, signal, 5, 0.0015, true);
  check('L5 gap above min: detected', !!fvgBig);
  // Now raise minGapPct so the same gap fails the threshold
  const fvgSmall = findRecentUntouchedBullishFvg(history, signal, 5, 0.01, true);  // 1% = 2.0 threshold
  check('L5 gap below min: rejected', fvgSmall === null);
}

// ─── FVG Upgrade (Option 1, Jun 17 2026) — track freshest FVG until trigger ───
// Real HAL 2026-06-17 fixture. Lookback locked the small 09:35/09:40/09:45 gap
// [4277.8, 4284.8] (impulse 09:40). The 09:45 huge candle's gap completes at 09:50 as
// [4285, 4312.3] (impulse 09:45, width 27.3). Price then retraces to ~4304 (inside the
// big zone) → should upgrade then trigger+enter, instead of waiting on the stale gap.
function hal(t: string, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: new Date(`2026-06-17T${t}:00+05:30`), open: o, high: h, low: l, close: c };
}

// U1: Upgrade fires on the bigger signal-impulse FVG, then enters
{
  const signal = hal('09:45', 4283.8, 4318.5, 4283.8, 4316);
  const watch = freshWatch(signal);
  // Simulate lookback pre-setting the SMALL FVG (impulse 09:40).
  watch.fvg = { floor: 4277.8, ceiling: 4284.8, slLevel: 4272, width: 7, impulseTs: new Date('2026-06-17T09:40:00+05:30') };
  const hist = [
    hal('09:35', 4275.2, 4277.8, 4272.7, 4275.3),
    hal('09:40', 4275.3, 4285, 4272, 4284.6),
    signal,
  ];
  const r = runSequence(hist, watch, [
    hal('09:50', 4316.9, 4325.5, 4312.3, 4324.2),  // completes BIG fvg [4285,4312.3] → UPGRADE
    hal('09:55', 4324.2, 4325.5, 4304.3, 4308.3),  // wicks big zone → TRIGGER_SET (high 4325.5)
    hal('10:00', 4308, 4310, 4304.4, 4305),        // inside, lower high → ratchet to 4310
    hal('10:05', 4305.2, 4313.2, 4304, 4313.1),    // high 4313.2 ≥ 4310 → ENTRY
  ]);
  check('U1 FVG_UPGRADED emitted', !!r.events.find(e => e.stage === 'FVG_UPGRADED'));
  check('U1 upgraded zone ceiling = 4312.3 (big FVG)', watch.fvg?.ceiling === 4312.3, { got: watch.fvg?.ceiling });
  check('U1 upgraded zone floor = 4285 (big FVG)', watch.fvg?.floor === 4285, { got: watch.fvg?.floor });
  check('U1 upgraded slLevel = 4283.8 (09:45 low)', watch.fvg?.slLevel === 4283.8, { got: watch.fvg?.slLevel });
  check('U1 progresses to ENTRY', r.result === 'ENTRY', { result: r.result });
}

// U2: Once a trigger is set, NO further upgrade (commitment guard)
{
  const signal = hal('09:45', 4283.8, 4318.5, 4283.8, 4316);
  const watch = freshWatch(signal);
  watch.fvg = { floor: 4285, ceiling: 4312.3, slLevel: 4283.8, width: 27.3, impulseTs: new Date('2026-06-17T09:45:00+05:30') };
  // Pre-set a trigger to simulate committed state
  watch.trigger = 4320; watch.triggerCandleTs = new Date('2026-06-17T09:55:00+05:30');
  const hist = [
    hal('09:40', 4275.3, 4285, 4272, 4284.6),
    hal('09:45', 4283.8, 4318.5, 4283.8, 4316),
    hal('09:50', 4316.9, 4325.5, 4312.3, 4324.2),
  ];
  events.length = 0;
  // A newer-impulse FVG could form at 10:00 window, but trigger!=null must block upgrade.
  progressFvgWatch([...hist, hal('09:55', 4324.2, 4360, 4313, 4358)], watch, hal('09:55', 4324.2, 4360, 4313, 4358));
  check('U2 no upgrade once trigger set', !events.find(e => e.stage === 'FVG_UPGRADED'));
}

// U3: Older/equal-impulse window does NOT upgrade (monotonic guard)
{
  const signal = hal('09:45', 4283.8, 4318.5, 4283.8, 4316);
  const watch = freshWatch(signal);
  // Current FVG impulse already at 09:50 (newer than any window we will feed)
  watch.fvg = { floor: 4285, ceiling: 4312.3, slLevel: 4283.8, width: 27.3, impulseTs: new Date('2026-06-17T09:50:00+05:30') };
  const hist = [
    hal('09:40', 4275.3, 4285, 4272, 4284.6),
    hal('09:45', 4283.8, 4318.5, 4283.8, 4316),
    hal('09:50', 4316.9, 4325.5, 4312.3, 4324.2),
  ];
  events.length = 0;
  // Next candle's window has c2=09:50 which EQUALS current impulse → must NOT upgrade
  progressFvgWatch([...hist, hal('09:55', 4324.2, 4400, 4350, 4395)], watch, hal('09:55', 4324.2, 4400, 4350, 4395));
  check('U3 equal-impulse window does not upgrade', !events.find(e => e.stage === 'FVG_UPGRADED'));
}

// U4: Newer window with sub-min gap does NOT upgrade
{
  const signal = hal('09:45', 4283.8, 4318.5, 4283.8, 4316);
  const watch = freshWatch(signal);
  watch.fvg = { floor: 4277.8, ceiling: 4284.8, slLevel: 4272, width: 7, impulseTs: new Date('2026-06-17T09:40:00+05:30') };
  const hist = [
    hal('09:35', 4275.2, 4277.8, 4272.7, 4275.3),
    hal('09:40', 4275.3, 4285, 4272, 4284.6),
    signal,
  ];
  events.length = 0;
  // 09:50 window: c1=09:40 (h4285), c3=09:50 low only 4285.5 → gap 0.5 < minGap (~6.5) → no upgrade
  progressFvgWatch([...hist, hal('09:50', 4316, 4320, 4285.5, 4290)], watch, hal('09:50', 4316, 4320, 4285.5, 4290));
  check('U4 sub-min-gap newer window does not upgrade', !events.find(e => e.stage === 'FVG_UPGRADED'));
  check('U4 watch keeps original small zone', watch.fvg?.ceiling === 4284.8, { got: watch.fvg?.ceiling });
}

// U5: enableFvgUpgrade=false → no upgrade (current behavior preserved)
{
  const saved = FLAGS.enableFvgUpgrade;
  FLAGS.enableFvgUpgrade = false;
  const signal = hal('09:45', 4283.8, 4318.5, 4283.8, 4316);
  const watch = freshWatch(signal);
  watch.fvg = { floor: 4277.8, ceiling: 4284.8, slLevel: 4272, width: 7, impulseTs: new Date('2026-06-17T09:40:00+05:30') };
  const hist = [
    hal('09:35', 4275.2, 4277.8, 4272.7, 4275.3),
    hal('09:40', 4275.3, 4285, 4272, 4284.6),
    signal,
  ];
  const r = runSequence(hist, watch, [
    hal('09:50', 4316.9, 4325.5, 4312.3, 4324.2),
    hal('09:55', 4324.2, 4325.5, 4304.3, 4308.3),
    hal('10:00', 4308, 4310, 4304.4, 4305),
  ]);
  check('U5 flag off: no upgrade', !r.events.find(e => e.stage === 'FVG_UPGRADED'));
  check('U5 flag off: stale small zone never triggers (price never wicks 4284.8)',
    !r.events.find(e => e.stage === 'FVG_TRIGGER_SET'));
  FLAGS.enableFvgUpgrade = saved;
}

console.log(`\n── Result: ${passN} passed, ${failN} failed ──`);
process.exit(failN > 0 ? 1 : 0);

