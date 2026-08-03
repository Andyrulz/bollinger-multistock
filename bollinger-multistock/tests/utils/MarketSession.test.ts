import {
  MARKET_TIMES_IST,
  getMarketSessionPhase,
  isEodRecoveryWindow,
  isEntryAllowed,
  isUnderlyingContinuousSession,
  millisecondsUntilIstTimeToday,
} from '../../src/utils/MarketSession';

const atIst = (hours: number, minutes: number, seconds: number = 0): Date =>
  new Date(Date.UTC(2026, 7, 3, hours - 6, minutes + 30, seconds));

describe('MarketSession', () => {
  test('allows entries before 15:06 and blocks them at 15:06', () => {
    expect(isEntryAllowed(atIst(15, 5, 59))).toBe(true);
    expect(isEntryAllowed(atIst(15, 6))).toBe(false);
  });

  test('keeps the underlying continuous only until 15:15', () => {
    expect(isUnderlyingContinuousSession(atIst(15, 14, 59))).toBe(true);
    expect(isUnderlyingContinuousSession(atIst(15, 15))).toBe(false);
  });

  test('does not open entry or candle sessions on weekends', () => {
    const saturday = new Date(Date.UTC(2026, 7, 8, 4, 30)); // 10:00 IST
    expect(isEntryAllowed(saturday)).toBe(false);
    expect(isUnderlyingContinuousSession(saturday)).toBe(false);
  });

  test('reports the CAS and derivatives-only phases', () => {
    expect(getMarketSessionPhase(atIst(15, 15))).toBe('CAS_TRANSITION');
    expect(getMarketSessionPhase(atIst(15, 20))).toBe('CAS_ORDER_ENTRY');
    expect(getMarketSessionPhase(atIst(15, 30))).toBe('CAS_MATCHING');
    expect(getMarketSessionPhase(atIst(15, 35))).toBe('DERIVATIVES_ONLY');
    expect(getMarketSessionPhase(atIst(15, 40))).toBe('CLOSED');
  });

  test('allows restart recovery exits from 15:11 until derivatives close', () => {
    expect(isEodRecoveryWindow(atIst(15, 10, 59))).toBe(false);
    expect(isEodRecoveryWindow(atIst(15, 11))).toBe(true);
    expect(isEodRecoveryWindow(atIst(15, 39, 59))).toBe(true);
    expect(isEodRecoveryWindow(atIst(15, 40))).toBe(false);
  });

  test('calculates timer delays independently of the host timezone', () => {
    const now = atIst(15, 5);
    expect(millisecondsUntilIstTimeToday(MARKET_TIMES_IST.entryCutoff, now)).toBe(60_000);
    expect(millisecondsUntilIstTimeToday(MARKET_TIMES_IST.eodExit, now)).toBe(6 * 60_000);
    expect(millisecondsUntilIstTimeToday(MARKET_TIMES_IST.entryCutoff, atIst(15, 6))).toBeNull();
  });
});