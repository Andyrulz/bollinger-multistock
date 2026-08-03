import { DailyCandle } from '../domain/types';

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot calculate mean of an empty set');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot calculate median of an empty set');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function sma(candles: readonly DailyCandle[], period: number, endExclusive = candles.length): number {
  if (period <= 0 || endExclusive < period || endExclusive > candles.length) {
    throw new Error(`Insufficient candles for SMA${period}`);
  }
  return mean(candles.slice(endExclusive - period, endExclusive).map((candle) => candle.close));
}

export function trueRange(candle: DailyCandle, previousClose: number): number {
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
}

export function atr(candles: readonly DailyCandle[], period: number, endExclusive = candles.length): number {
  if (endExclusive < period + 1) throw new Error(`Insufficient candles for ATR${period}`);
  const ranges: number[] = [];
  for (let index = endExclusive - period; index < endExclusive; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) throw new Error('Invalid ATR index');
    ranges.push(trueRange(candle, previous.close));
  }
  return mean(ranges);
}

export function percentileRank(value: number, population: readonly number[]): number {
  if (population.length === 0) return 0;
  const below = population.filter((candidate) => candidate < value).length;
  const equal = population.filter((candidate) => candidate === value).length;
  return 100 * (below + 0.5 * equal) / population.length;
}

export function linearSlope(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}
