import { CandidateResult, DailyCandle, SetupEvidence, SetupLabel } from '../domain/types';
import { median, sma } from './indicators';

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function slopeUp(candles: readonly DailyCandle[], period: number, sessions = 5): boolean {
  return sma(candles, period) > sma(candles, period, candles.length - sessions);
}

export function analyzeSetup(candles: readonly DailyCandle[], candidate: CandidateResult): SetupEvidence {
  const recent252 = candles.slice(-252);
  const close = candles.at(-1)?.close ?? 0;
  const high52Week = Math.max(...recent252.map((candle) => candle.high));
  const previousHighWindow = candles.slice(Math.max(0, candles.length - 272), Math.max(0, candles.length - 20));
  const previous52WeekHigh = previousHighWindow.length > 0
    ? Math.max(...previousHighWindow.map((candle) => candle.high))
    : high52Week;
  const sma10 = sma(candles, 10);
  const sma20 = sma(candles, 20);
  const sma50 = sma(candles, 50);
  const sma200 = sma(candles, 200);

  let unusualBullishVolumeEvents = 0;
  let maximumBullishVolumeRatio = 0;
  const volumeStart = Math.max(20, candles.length - 120);
  for (let index = volumeStart; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle || candle.close <= candle.open) continue;
    const baseline = median(candles.slice(index - 20, index).map((item) => item.volume));
    const ratio = baseline > 0 ? candle.volume / baseline : 0;
    if (ratio >= 1.5 && candle.close >= candle.low + (candle.high - candle.low) * 0.5) unusualBullishVolumeEvents += 1;
    maximumBullishVolumeRatio = Math.max(maximumBullishVolumeRatio, ratio);
  }

  let defendedBullishFvgCount = 0;
  const fvgStart = Math.max(2, candles.length - 120);
  for (let index = fvgStart; index < candles.length; index += 1) {
    const first = candles[index - 2];
    const third = candles[index];
    if (!first || !third || third.low <= first.high) continue;
    const gapFloor = first.high;
    const laterCloses = candles.slice(index + 1).map((candle) => candle.close);
    if (laterCloses.every((laterClose) => laterClose >= gapFloor)) defendedBullishFvgCount += 1;
  }

  let breakoutLevel: number | null = null;
  let breakoutDate: string | null = null;
  let breakoutIndex = -1;
  for (let index = Math.max(60, candles.length - 40); index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const prior = candles.slice(index - 60, index);
    const resistance = Math.max(...prior.map((item) => item.high));
    if (candle.close > resistance * 1.005) {
      breakoutLevel = resistance;
      breakoutDate = candle.date;
      breakoutIndex = index;
    }
  }
  const postBreakout = breakoutIndex >= 0 ? candles.slice(breakoutIndex + 1) : [];
  const breakoutRetest = breakoutLevel !== null && postBreakout.length > 0
    && Math.min(...postBreakout.map((candle) => candle.low)) <= breakoutLevel * 1.05
    && close >= breakoutLevel * 0.98;

  const evidenceSignals: string[] = [];
  const bullishShortMaOrder = sma10 > sma20 && sma20 > sma50;
  const risingSma10 = slopeUp(candles, 10);
  const risingSma20 = slopeUp(candles, 20);
  const risingSma50 = slopeUp(candles, 50, 20);
  const risingSma200 = slopeUp(candles, 200, 20);
  const distanceFrom52WeekHigh = high52Week > 0 ? high52Week / close - 1 : 0;
  const distanceFromPrevious52WeekHigh = previous52WeekHigh > 0 ? close / previous52WeekHigh - 1 : 0;
  if (close > sma200) evidenceSignals.push('ABOVE_SMA200');
  if (bullishShortMaOrder) evidenceSignals.push('BULLISH_10_20_50_ORDER');
  if (risingSma10 && risingSma20 && risingSma50) evidenceSignals.push('RISING_SHORT_MOVING_AVERAGES');
  if (distanceFrom52WeekHigh <= 0.30) evidenceSignals.push('WITHIN_30_PERCENT_OF_52W_HIGH');
  if (close > previous52WeekHigh) evidenceSignals.push('ABOVE_PREVIOUS_52W_HIGH');
  if (unusualBullishVolumeEvents > 0) evidenceSignals.push('RECENT_UNUSUAL_BULLISH_VOLUME');
  if (defendedBullishFvgCount > 0) evidenceSignals.push('DEFENDED_BULLISH_FVG');
  if (breakoutLevel !== null) evidenceSignals.push('RECENT_BREAKOUT');
  if (breakoutRetest) evidenceSignals.push('BREAKOUT_RETEST_HELD');
  if (candidate.tightArea?.volumeRatio !== undefined && candidate.tightArea.volumeRatio < 1) evidenceSignals.push('TIGHT_AREA_VOLUME_CONTRACTION');
  if (candidate.tightArea?.pivotDistance !== undefined && candidate.tightArea.pivotDistance <= 0.04) evidenceSignals.push('PIVOT_NEAR_SMA10');

  return {
    close,
    high52Week,
    distanceFrom52WeekHigh: finite(distanceFrom52WeekHigh),
    previous52WeekHigh,
    distanceFromPrevious52WeekHigh: finite(distanceFromPrevious52WeekHigh),
    abovePrevious52WeekHigh: close > previous52WeekHigh,
    sma10,
    sma20,
    sma50,
    sma200,
    aboveSma200: close > sma200,
    bullishShortMaOrder,
    risingSma10,
    risingSma20,
    risingSma50,
    risingSma200,
    unusualBullishVolumeEvents,
    maximumBullishVolumeRatio: finite(maximumBullishVolumeRatio),
    defendedBullishFvgCount,
    recentBreakout: breakoutLevel !== null,
    breakoutLevel,
    breakoutDate,
    breakoutRetest,
    evidenceSignals,
  };
}

export function classifySetup(candidate: CandidateResult): SetupLabel[] {
  const setup = candidate.setupEvidence;
  if (!setup) return [];
  const tight = candidate.tightArea;
  const labels: SetupLabel[] = [];
  const compact = tight !== undefined && tight.depth <= 0.08 && tight.pivotDistance <= 0.04;
  const volumeContracting = tight !== undefined && tight.volumeRatio < 1;
  const institutionalEvidence = setup.unusualBullishVolumeEvents > 0 || setup.defendedBullishFvgCount > 0;

  if (setup.aboveSma200 && setup.risingSma50 && setup.distanceFrom52WeekHigh <= 0.30
    && !setup.abovePrevious52WeekHigh && compact) labels.push('EARLY_TREND_TRANSITION');
  if (setup.breakoutRetest && compact && volumeContracting) labels.push('BASE_BREAKOUT_RETEST');
  if (setup.recentBreakout && setup.aboveSma200 && compact && volumeContracting
    && institutionalEvidence) labels.push('POST_BREAKOUT_TIGHTNESS');
  if (setup.abovePrevious52WeekHigh && setup.bullishShortMaOrder && compact
    && volumeContracting) labels.push('POST_52W_HIGH_CONTINUATION');

  return labels;
}
