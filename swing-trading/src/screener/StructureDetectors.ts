import { DailyCandle, GateResult, ImpulseEvidence, ScannerConfig, TightAreaEvidence } from '../domain/types';
import { atr, mean, median, sma, trueRange } from './indicators';

export function detectFinalTightArea(candles: readonly DailyCandle[], config: ScannerConfig): { gate: GateResult; evidence?: TightAreaEvidence } {
  const candidates: TightAreaEvidence[] = [];
  const attempts: Array<TightAreaEvidence & { checks: Record<string, boolean> }> = [];
  const atr20 = atr(candles, 20);
  for (let length = config.minimumFinalTightAreaSessions; length <= config.maximumFinalTightAreaSessions; length += 1) {
    const startIndex = candles.length - length;
    const area = candles.slice(startIndex);
    const high = Math.max(...area.map((candle) => candle.high));
    const low = Math.min(...area.map((candle) => candle.low));
    const depth = high / low - 1;
    const midpoint = low + (high - low) / 2;
    const upperHalfCloses = area.filter((candle) => candle.close >= midpoint).length;
    const sma10 = sma(candles, 10);
    const previousSma10 = sma(candles, 10, candles.length - 1);
    const pivotDistance = Math.abs(high - sma10) / high;
    const finalThree = area.slice(-3);
    const finalThreeAtr = mean(finalThree.map((candle, index) => {
      const absoluteIndex = candles.length - finalThree.length + index;
      return trueRange(candle, candles[absoluteIndex - 1]?.close ?? candle.close);
    }));
    const precedingVolume = candles.slice(Math.max(0, startIndex - 20), startIndex).map((candle) => candle.volume);
    const volumeRatio = precedingVolume.length === 20 ? median(area.map((candle) => candle.volume)) / median(precedingVolume) : Number.POSITIVE_INFINITY;
    const wideDistribution = area.some((candle, index) => candle.close < candle.open
      && trueRange(candle, candles[startIndex + index - 1]?.close ?? candle.close) >= 1.5 * atr20
      && candle.volume >= 1.5 * median(candles.slice(Math.max(0, startIndex + index - 20), startIndex + index).map((item) => item.volume)));
    const evidence = {
        startIndex, endIndex: candles.length - 1, startDate: area[0]?.date ?? '', endDate: area.at(-1)?.date ?? '',
        high, low, depth, pivot: high, sma10, pivotDistance, atrContraction: finalThreeAtr / atr20, upperHalfCloses, volumeRatio,
    };
    const checks = {
      depth: depth <= config.maximumFinalTightAreaDepth,
      upperHalfCloses: upperHalfCloses >= config.minimumUpperHalfCloses,
      atrContraction: finalThreeAtr <= config.maximumAtrContraction * atr20,
      distribution: !wideDistribution,
      volumeContraction: !config.requireVolumeContraction || volumeRatio < 1,
      risingSma10: !config.requireRisingSma10 || sma10 > previousSma10,
      pivotProximity: pivotDistance <= config.maximumPivotDistanceFromSma10,
      sma10Location: sma10 >= low * 0.99 && sma10 <= high,
    };
    attempts.push({ ...evidence, checks });
    if (Object.values(checks).every(Boolean)) candidates.push(evidence);
  }
  const evidence = candidates.sort((left, right) => left.depth - right.depth || right.startIndex - left.startIndex)[0];
  return {
    gate: {
      gate: 'FINAL_TIGHT_AREA', passed: evidence !== undefined,
      code: evidence ? 'FINAL_TIGHT_AREA_PASSED' : 'FINAL_TIGHT_AREA_NOT_FOUND',
      evidence: evidence ? { ...evidence } : {
        searchedLengths: [config.minimumFinalTightAreaSessions, config.maximumFinalTightAreaSessions],
        closestAttempt: attempts.sort((left, right) =>
          Object.values(right.checks).filter(Boolean).length - Object.values(left.checks).filter(Boolean).length
          || left.depth - right.depth)[0] ?? null,
      },
    },
    ...(evidence ? { evidence } : {}),
  };
}

export function detectImpulse(candles: readonly DailyCandle[], tightStartIndex: number, config: ScannerConfig): { gate: GateResult; evidence?: ImpulseEvidence } {
  const highStart = Math.max(1, candles.length - config.maximumTighteningSessions);
  const highEnd = tightStartIndex - 1;
  let best: ImpulseEvidence | undefined;
  for (let highIndex = highStart; highIndex <= highEnd; highIndex += 1) {
    const highCandle = candles[highIndex];
    if (!highCandle) continue;
    const lowStart = Math.max(0, highIndex - config.impulseLookbackSessions);
    for (let lowIndex = lowStart; lowIndex < highIndex; lowIndex += 1) {
      const lowCandle = candles[lowIndex];
      if (!lowCandle || lowCandle.low <= 0) continue;
      const gain = highCandle.high / lowCandle.low - 1;
      const sustained = candles.slice(highIndex, Math.min(highIndex + 3, candles.length)).filter((candle) => candle.close >= highCandle.high * 0.88).length >= 2;
      if (gain >= config.minimumImpulseGain && sustained && (!best || gain > best.gain)) {
        best = { lowIndex, highIndex, lowDate: lowCandle.date, highDate: highCandle.date, low: lowCandle.low, high: highCandle.high, gain };
      }
    }
  }
  return {
    gate: { gate: 'PRIOR_IMPULSE', passed: best !== undefined, code: best ? 'PRIOR_IMPULSE_PASSED' : 'PRIOR_IMPULSE_NOT_FOUND', evidence: best ? { ...best } : {} },
    ...(best ? { evidence: best } : {}),
  };
}

export function evaluateAccumulation(candles: readonly DailyCandle[], impulse: ImpulseEvidence, config: ScannerConfig): GateResult {
  let accumulationDays = 0;
  let advancingVolume = 0;
  let decliningVolume = 0;
  for (let index = impulse.lowIndex + 1; index <= impulse.highIndex; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) continue;
    if (candle.close > previous.close) advancingVolume += candle.volume;
    if (candle.close < previous.close) decliningVolume += candle.volume;
    const baseline = candles.slice(index - 20, index).map((item) => item.volume);
    if (baseline.length === 20 && candle.close > previous.close && candle.close >= (candle.high + candle.low) / 2
      && candle.volume >= config.minimumVolumeDominance * median(baseline)) accumulationDays += 1;
  }
  const dominance = decliningVolume > 0 ? advancingVolume / decliningVolume : null;
  const passed = accumulationDays >= config.minimumAccumulationDays && dominance !== null && dominance >= config.minimumVolumeDominance;
  return {
    gate: 'ACCUMULATION', passed, code: passed ? 'ACCUMULATION_PASSED' : 'ACCUMULATION_FAILED',
    evidence: { accumulationDays, advancingVolume, decliningVolume, volumeDominance: dominance },
  };
}

export function evaluateTightening(candles: readonly DailyCandle[], impulse: ImpulseEvidence, tightArea: TightAreaEvidence, config: ScannerConfig): GateResult {
  const structure = candles.slice(impulse.highIndex, tightArea.endIndex + 1);
  const depth = impulse.high / Math.min(...structure.map((candle) => candle.low)) - 1;
  const latestVolume = median(structure.slice(-5).map((candle) => candle.volume));
  const baseline = candles.slice(Math.max(0, impulse.highIndex - 20), impulse.highIndex).map((candle) => candle.volume);
  const volumeRatio = baseline.length === 20 ? latestVolume / median(baseline) : null;
  const ranges = structure.map((candle) => (candle.high - candle.low) / candle.close);
  const third = Math.max(1, Math.floor(ranges.length / 3));
  const rangeContracted = median(ranges.slice(-third)) < median(ranges.slice(0, third));
  const passed = structure.length >= config.minimumTighteningSessions && structure.length <= config.maximumTighteningSessions
    && depth <= config.maximumTighteningDepth && volumeRatio !== null && volumeRatio <= 0.75 && rangeContracted;
  return {
    gate: 'ORDERLY_TIGHTENING', passed, code: passed ? 'ORDERLY_TIGHTENING_PASSED' : 'ORDERLY_TIGHTENING_FAILED',
    evidence: { sessions: structure.length, depth, volumeRatio, rangeContracted },
  };
}

export function evaluateLiquidity(candles: readonly DailyCandle[], config: ScannerConfig): GateResult {
  const recent = candles.slice(-20);
  const averageTradedValue = mean(recent.map((candle) => candle.close * candle.volume));
  const close = candles.at(-1)?.close ?? 0;
  const passed = close >= config.minimumPrice && averageTradedValue >= config.minimumAverageTradedValue;
  return {
    gate: 'LIQUIDITY', passed, code: passed ? 'LIQUIDITY_PASSED' : 'LIQUIDITY_FAILED',
    evidence: { close, averageTradedValue, minimumPrice: config.minimumPrice, minimumAverageTradedValue: config.minimumAverageTradedValue },
  };
}
