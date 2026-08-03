/**
 * QC harness — IMP-001 stateful scanner candle engine.
 * Mirrors MarketScanner's floorTo5Min / appendCandle / updateFormingCandle / flushFormingCandle /
 * isCandleStale. If those drift, update BOTH. Pure logic, no Kite/network.
 */

interface Candle { date: Date; open: number; high: number; low: number; close: number; volume: number; }

const FIVE_MIN_MS = 5 * 60 * 1000;
const CANDLE_WINDOW = 375;

// ── mirrors of MarketScanner engine ──
function floorTo5Min(ms: number): number { return Math.floor(ms / FIVE_MIN_MS) * FIVE_MIN_MS; }
function sameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear() && da.getUTCMonth() === db.getUTCMonth() && da.getUTCDate() === db.getUTCDate();
}

class Engine {
  store = new Map<string, Candle[]>();
  forming = new Map<string, { boundary: number; open: number; high: number; low: number; close: number; openDayVol: number; lastDayVol: number }>();

  appendCandle(symbol: string, candle: Candle): 'PUSH' | 'UPDATE' | 'DUPLICATE' | 'STALE' {
    const series = this.store.get(symbol);
    const c: Candle = { ...candle, date: new Date(floorTo5Min(candle.date.getTime())) };
    if (!series || series.length === 0) { this.store.set(symbol, [c]); return 'PUSH'; }
    const last = series[series.length - 1]!;
    const lastT = floorTo5Min(last.date.getTime());
    const newT = c.date.getTime();
    if (newT === lastT) {
      if (last.open === c.open && last.high === c.high && last.low === c.low && last.close === c.close) return 'DUPLICATE';
      series[series.length - 1] = c; return 'UPDATE';
    }
    if (newT < lastT) return 'STALE';
    series.push(c);
    if (series.length > CANDLE_WINDOW) series.splice(0, series.length - CANDLE_WINDOW);
    return 'PUSH';
  }

  updateFormingCandle(symbol: string, lastPrice: number, dayVolume: number, nowMs: number): void {
    if (!(lastPrice > 0)) return;
    const boundary = floorTo5Min(nowMs);
    const f = this.forming.get(symbol);
    if (!f || f.boundary !== boundary) {
      if (f && sameDay(f.boundary, boundary)) {
        this.appendCandle(symbol, { date: new Date(f.boundary), open: f.open, high: f.high, low: f.low, close: f.close, volume: Math.max(0, f.lastDayVol - f.openDayVol) });
      } else if (f) {
        this.appendCandle(symbol, { date: new Date(f.boundary), open: f.open, high: f.high, low: f.low, close: f.close, volume: 0 });
      }
      this.forming.set(symbol, { boundary, open: lastPrice, high: lastPrice, low: lastPrice, close: lastPrice, openDayVol: dayVolume, lastDayVol: dayVolume });
      return;
    }
    f.high = Math.max(f.high, lastPrice); f.low = Math.min(f.low, lastPrice); f.close = lastPrice; f.lastDayVol = dayVolume;
  }

  flushFormingCandle(symbol: string, dayVolume: number): void {
    const f = this.forming.get(symbol);
    if (!f) return;
    this.appendCandle(symbol, { date: new Date(f.boundary), open: f.open, high: f.high, low: f.low, close: f.close, volume: Math.max(0, dayVolume - f.openDayVol) });
  }

  // Finding #1 mirror
  finalizeClosedFormingCandles(nowMs: number): number {
    const cutoff = floorTo5Min(nowMs);
    let finalized = 0;
    for (const [sym, f] of this.forming.entries()) {
      if (f.boundary < cutoff) {
        const sd = sameDay(f.boundary, cutoff);
        this.appendCandle(sym, { date: new Date(f.boundary), open: f.open, high: f.high, low: f.low, close: f.close, volume: sd ? Math.max(0, f.lastDayVol - f.openDayVol) : 0 });
        this.forming.delete(sym);
        finalized++;
      }
    }
    return finalized;
  }

  isCandleStale(symbol: string, nowMs: number, maxAgeBars = 2): boolean {
    const series = this.store.get(symbol);
    if (!series || series.length === 0) return true;
    const lastT = floorTo5Min(series[series.length - 1]!.date.getTime());
    return (floorTo5Min(nowMs) - lastT) > maxAgeBars * FIVE_MIN_MS;
  }
}

let passN = 0, failN = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { passN++; console.log(`✅ ${name}`); }
  else { failN++; console.log(`❌ ${name}`); if (extra !== undefined) console.log('   ', JSON.stringify(extra)); }
}

// IST 09:15 base for a trading day, in UTC ms. 2026-06-19 09:15 IST = 03:45 UTC.
const D1 = Date.UTC(2026, 5, 19, 3, 45, 0); // 09:15 IST
const D2 = Date.UTC(2026, 5, 20, 3, 45, 0); // next day 09:15 IST
function tISO(baseMs: number, minOffset: number, sec = 7): number { return baseMs + minOffset * 60000 + sec * 1000; }
function c(ts: number, o: number, h: number, l: number, cl: number, v = 100): Candle { return { date: new Date(ts), open: o, high: h, low: l, close: cl, volume: v }; }

// T1: floorTo5Min normalizes :07 → :00
{
  check('T1 floor 09:20:07 → 09:20:00', floorTo5Min(tISO(D1, 5, 7)) === tISO(D1, 5, 0));
  check('T1 floor 09:24:59 → 09:20:00', floorTo5Min(tISO(D1, 9, 59)) === tISO(D1, 5, 0));
}

// T2: append PUSH / DUPLICATE / UPDATE / STALE
{
  const e = new Engine();
  check('T2 first → PUSH', e.appendCandle('X', c(tISO(D1, 0, 0), 10, 12, 9, 11)) === 'PUSH');
  check('T2 same ts+OHLC → DUPLICATE', e.appendCandle('X', c(tISO(D1, 0, 7), 10, 12, 9, 11)) === 'DUPLICATE'); // :07 floors to same
  check('T2 same ts new OHLC → UPDATE', e.appendCandle('X', c(tISO(D1, 0, 7), 10, 13, 9, 12)) === 'UPDATE');
  check('T2 newer ts → PUSH', e.appendCandle('X', c(tISO(D1, 5, 0), 12, 14, 11, 13)) === 'PUSH');
  check('T2 older ts → STALE', e.appendCandle('X', c(tISO(D1, 0, 0), 1, 2, 0, 1)) === 'STALE');
  check('T2 series length = 2', (e.store.get('X')!.length) === 2);
  check('T2 updated bar kept (close 13 last)', e.store.get('X')![1]!.close === 13);
}

// T3: forming candle tracks running high/low; finalizes at boundary with volume delta
{
  const e = new Engine();
  // bar 09:20: ticks at :07 (1000), :30 (1010 high), :50 (995 low), :04:59 (1005 close); dayVol grows 5000→5400
  e.updateFormingCandle('Y', 1000, 5000, tISO(D1, 5, 7));
  e.updateFormingCandle('Y', 1010, 5150, tISO(D1, 5, 30));
  e.updateFormingCandle('Y', 995, 5300, tISO(D1, 5, 50));
  e.updateFormingCandle('Y', 1005, 5400, tISO(D1, 9, 59));
  // crossing into 09:25 finalizes the 09:20 bar
  e.updateFormingCandle('Y', 1006, 5450, tISO(D1, 10, 7));
  const series = e.store.get('Y')!;
  check('T3 finalized one bar', series.length === 1);
  const b = series[0]!;
  check('T3 open=1000', b.open === 1000);
  check('T3 high=1010', b.high === 1010);
  check('T3 low=995', b.low === 995);
  check('T3 close=1005', b.close === 1005);
  check('T3 volume = 5400-5000 = 400', b.volume === 400, { got: b.volume });
}

// T4: flushFormingCandle finalizes current bar idempotently
{
  const e = new Engine();
  e.updateFormingCandle('Z', 100, 1000, tISO(D1, 0, 7));
  e.updateFormingCandle('Z', 105, 1100, tISO(D1, 0, 30));
  e.flushFormingCandle('Z', 1200); // boundary getQuote dayVol=1200
  const s = e.store.get('Z')!;
  check('T4 one bar after flush', s.length === 1);
  check('T4 high=105', s[0]!.high === 105);
  check('T4 volume = 1200-1000 = 200', s[0]!.volume === 200, { got: s[0]!.volume });
  // flush again same data → dedup keeps length 1
  e.flushFormingCandle('Z', 1200);
  check('T4 idempotent flush (still 1 bar)', e.store.get('Z')!.length === 1);
}

// T5: day boundary never stitches across days
{
  const e = new Engine();
  e.updateFormingCandle('W', 50, 100, tISO(D1, 70, 7)); // last bar of day 1 region
  // jump to next trading day's first bar — must finalize prior, open new, NOT merge
  e.updateFormingCandle('W', 60, 100, tISO(D2, 0, 7));
  const s = e.store.get('W')!;
  check('T5 prior-day bar finalized separately', s.length === 1);
  check('T5 finalized bar is from day 1', sameDay(s[0]!.date.getTime(), D1));
  const f = (e.forming.get('W'))!;
  check('T5 new forming bar is day 2', sameDay(f.boundary, D2));
}

// T6: rolling window trim to CANDLE_WINDOW
{
  const e = new Engine();
  for (let i = 0; i < CANDLE_WINDOW + 25; i++) e.appendCandle('T', c(tISO(D1, i * 5, 0), 1, 2, 0, 1));
  check('T6 trimmed to CANDLE_WINDOW', e.store.get('T')!.length === CANDLE_WINDOW, { got: e.store.get('T')!.length });
}

// T7: staleness detection
{
  const e = new Engine();
  e.appendCandle('S', c(tISO(D1, 0, 0), 1, 2, 0, 1));
  check('T7 fresh (0 bars old) not stale', !e.isCandleStale('S', tISO(D1, 0, 30)));
  check('T7 2 bars old not stale', !e.isCandleStale('S', tISO(D1, 10, 0)));
  check('T7 3 bars old → stale', e.isCandleStale('S', tISO(D1, 15, 0)));
  check('T7 unknown symbol → stale', e.isCandleStale('NOPE', tISO(D1, 0, 0)));
}

// T8: Finding #1 — finalizeClosedFormingCandles pushes the just-closed bar, idempotent, cross-day vol 0
{
  const e = new Engine();
  // build a forming 09:20 bar via polls within the bar
  e.updateFormingCandle('A', 100, 1000, tISO(D1, 5, 7));
  e.updateFormingCandle('A', 110, 1080, tISO(D1, 5, 40));
  e.updateFormingCandle('A', 105, 1120, tISO(D1, 9, 50));
  check('T8 nothing in series yet (forming only)', (e.store.get('A')?.length ?? 0) === 0);
  // scan fires at 09:25:05 → the 09:20 bar has closed
  const n1 = e.finalizeClosedFormingCandles(tISO(D1, 10, 5));
  check('T8 finalized 1 closed bar', n1 === 1);
  const s = e.store.get('A')!;
  check('T8 just-closed 09:20 bar now in series', s.length === 1 && s[0]!.date.getTime() === tISO(D1, 5, 0));
  check('T8 OHLC carried (o100 h110 l100 c105)', s[0]!.open === 100 && s[0]!.high === 110 && s[0]!.low === 100 && s[0]!.close === 105, s[0]);
  check('T8 volume = 1120-1000 = 120', s[0]!.volume === 120, { got: s[0]!.volume });
  check('T8 forming entry cleared', !e.forming.has('A'));
  // idempotent: calling again finalizes nothing
  check('T8 idempotent (0 on second call)', e.finalizeClosedFormingCandles(tISO(D1, 10, 30)) === 0);
  // current (not-yet-closed) forming bar is NOT finalized
  e.updateFormingCandle('A', 106, 1150, tISO(D1, 10, 20)); // opens 09:25 forming bar
  check('T8 open forming bar not finalized', e.finalizeClosedFormingCandles(tISO(D1, 12, 0)) === 0 && e.store.get('A')!.length === 1);
}

// T9: Finding #2 — session VWAP resets daily; legacy spans both days
{
  // Day 1: price ~100; Day 2: price ~200. Last bar is day 2.
  const candles: Candle[] = [
    c(tISO(D1, 0, 0), 100, 100, 100, 100, 10),
    c(tISO(D1, 5, 0), 100, 100, 100, 100, 10),
    c(tISO(D2, 0, 0), 200, 200, 200, 200, 10),
    c(tISO(D2, 5, 0), 200, 200, 200, 200, 10),
  ];
  const session = calcVwap(candles, true);
  const legacy = calcVwap(candles, false);
  check('T9 session VWAP = 200 (day-2 only)', session === 200, { session });
  check('T9 legacy VWAP = 150 (both days)', legacy === 150, { legacy });
  check('T9 session != legacy', session !== legacy);
  // single-day series → identical regardless of flag
  const oneDay = [c(tISO(D1, 0, 0), 100, 110, 90, 105, 10), c(tISO(D1, 5, 0), 105, 115, 100, 110, 10)];
  check('T9 single-day: session == legacy', calcVwap(oneDay, true) === calcVwap(oneDay, false));
}

// Finding #2 mirror — session-anchored vs legacy cumulative VWAP
function calcVwap(candles: Candle[], sessionAnchored: boolean): number {
  if (candles.length === 0) return 0;
  const anchorTs = candles[candles.length - 1]!.date.getTime();
  let cumVol = 0, cumPV = 0;
  for (const cd of candles) {
    if (sessionAnchored && !sameDay(cd.date.getTime(), anchorTs)) continue;
    const tp = (cd.high + cd.low + cd.close) / 3;
    cumPV += tp * cd.volume; cumVol += cd.volume;
  }
  return cumVol > 0 ? cumPV / cumVol : 0;
}

console.log(`\n── Result: ${passN} passed, ${failN} failed ──`);
process.exit(failN > 0 ? 1 : 0);
