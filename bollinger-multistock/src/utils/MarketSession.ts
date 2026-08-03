const IST_OFFSET_MINUTES = 330;

export const MARKET_TIMES_IST = {
  open: 9 * 60 + 15,
  entryCutoff: 15 * 60 + 6,
  eodExit: 15 * 60 + 11,
  underlyingContinuousClose: 15 * 60 + 15,
  casOrderEntryStart: 15 * 60 + 20,
  casMatchingStart: 15 * 60 + 30,
  casMatchingEnd: 15 * 60 + 35,
  derivativesClose: 15 * 60 + 40,
  cleanup: 15 * 60 + 41,
} as const;

export type MarketSessionPhase =
  | 'PRE_OPEN'
  | 'CONTINUOUS_ENTRY'
  | 'CONTINUOUS_EXIT_ONLY'
  | 'CAS_TRANSITION'
  | 'CAS_ORDER_ENTRY'
  | 'CAS_MATCHING'
  | 'DERIVATIVES_ONLY'
  | 'CLOSED';

export function getIstMinutes(date: Date = new Date()): number {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function isNseWeekday(date: Date = new Date()): boolean {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const day = shifted.getUTCDay();
  return day >= 1 && day <= 5;
}

export function getMarketSessionPhase(date: Date = new Date()): MarketSessionPhase {
  const minutes = getIstMinutes(date);

  if (minutes < MARKET_TIMES_IST.open) return 'PRE_OPEN';
  if (minutes < MARKET_TIMES_IST.entryCutoff) return 'CONTINUOUS_ENTRY';
  if (minutes < MARKET_TIMES_IST.underlyingContinuousClose) return 'CONTINUOUS_EXIT_ONLY';
  if (minutes < MARKET_TIMES_IST.casOrderEntryStart) return 'CAS_TRANSITION';
  if (minutes < MARKET_TIMES_IST.casMatchingStart) return 'CAS_ORDER_ENTRY';
  if (minutes < MARKET_TIMES_IST.casMatchingEnd) return 'CAS_MATCHING';
  if (minutes < MARKET_TIMES_IST.derivativesClose) return 'DERIVATIVES_ONLY';
  return 'CLOSED';
}

export function isEntryAllowed(date: Date = new Date()): boolean {
  return isNseWeekday(date) && getMarketSessionPhase(date) === 'CONTINUOUS_ENTRY';
}

export function isUnderlyingContinuousSession(date: Date = new Date()): boolean {
  if (!isNseWeekday(date)) return false;
  const phase = getMarketSessionPhase(date);
  return phase === 'CONTINUOUS_ENTRY' || phase === 'CONTINUOUS_EXIT_ONLY';
}

export function isEodRecoveryWindow(date: Date = new Date()): boolean {
  if (!isNseWeekday(date)) return false;
  const minutes = getIstMinutes(date);
  return minutes >= MARKET_TIMES_IST.eodExit && minutes < MARKET_TIMES_IST.derivativesClose;
}

export function millisecondsUntilIstTimeToday(
  targetMinutesIst: number,
  now: Date = new Date()
): number | null {
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const targetUtc = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate(),
    0,
    targetMinutesIst - IST_OFFSET_MINUTES,
    0,
    0
  );
  const delay = targetUtc - now.getTime();
  return delay > 0 ? delay : null;
}