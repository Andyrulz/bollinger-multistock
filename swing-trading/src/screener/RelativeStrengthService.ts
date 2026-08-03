import { DailyCandle } from '../domain/types';
import { linearSlope, percentileRank } from './indicators';

export function weightedReturn(candles: readonly DailyCandle[]): number {
  if (candles.length < 252) throw new Error('Relative strength requires 252 sessions');
  const latest = candles.at(-1)?.close ?? 0;
  const returnAt = (sessions: number): number => latest / (candles.at(-(sessions + 1))?.close ?? latest) - 1;
  return 0.4 * returnAt(63) + 0.2 * returnAt(126) + 0.2 * returnAt(189) + 0.2 * returnAt(251);
}

export function relativeStrengthPercentile(value: number, population: readonly number[]): number {
  return percentileRank(value, population);
}

export function relativeStrengthLineSlope(
  stockCandles: readonly DailyCandle[],
  benchmarkCandles: readonly DailyCandle[],
  sessions: number,
): number | null {
  const benchmarkByDate = new Map(benchmarkCandles.map((candle) => [candle.date, candle.close]));
  const ratios = stockCandles.slice(-sessions).flatMap((candle) => {
    const benchmarkClose = benchmarkByDate.get(candle.date);
    return benchmarkClose && benchmarkClose > 0 ? [candle.close / benchmarkClose] : [];
  });
  if (ratios.length !== sessions) return null;
  const base = ratios[0] ?? 1;
  return linearSlope(ratios.map((ratio) => ratio / base));
}
