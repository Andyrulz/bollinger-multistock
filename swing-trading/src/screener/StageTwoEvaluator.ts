import { DailyCandle, GateResult, StageTwoMode } from '../domain/types';
import { sma } from './indicators';

export interface StageTwoEvidence {
  close: number;
  sma50: number;
  sma150: number;
  sma200: number;
  sma200TwentySessionsAgo: number;
  low52Week: number;
  high52Week: number;
}

export function evaluateStageTwo(candles: readonly DailyCandle[], mode: StageTwoMode = 'STRICT'): { gate: GateResult; evidence: StageTwoEvidence } {
  if (candles.length < 252) throw new Error('Stage 2 requires at least 252 sessions');
  const close = candles.at(-1)?.close ?? 0;
  const evidence: StageTwoEvidence = {
    close,
    sma50: sma(candles, 50),
    sma150: sma(candles, 150),
    sma200: sma(candles, 200),
    sma200TwentySessionsAgo: sma(candles, 200, candles.length - 20),
    low52Week: Math.min(...candles.slice(-252).map((candle) => candle.low)),
    high52Week: Math.max(...candles.slice(-252).map((candle) => candle.high)),
  };
  const checks = {
    aboveMovingAverages: close > evidence.sma50 && close > evidence.sma150 && close > evidence.sma200,
    movingAverageOrder: evidence.sma50 > evidence.sma150 && evidence.sma150 > evidence.sma200,
    risingSma200: evidence.sma200 > evidence.sma200TwentySessionsAgo,
    above52WeekLow: close >= evidence.low52Week * 1.25,
    near52WeekHigh: close >= evidence.high52Week * 0.85,
  };
  const passed = mode === 'STRICT'
    ? Object.values(checks).every(Boolean)
    : checks.aboveMovingAverages
      && close > evidence.sma200
      && checks.above52WeekLow
      && close >= evidence.high52Week * (mode === 'LOW_RISK' ? 0.70 : 0.60)
      && (checks.movingAverageOrder || evidence.sma50 > evidence.sma200)
      && (mode === 'RESEARCH' || checks.risingSma200 || evidence.sma200 >= evidence.sma200TwentySessionsAgo * 0.98);
  return {
    evidence,
    gate: { gate: 'STAGE_TWO', passed, code: passed ? 'STAGE_TWO_PASSED' : 'STAGE_TWO_FAILED', evidence: { ...evidence, mode, checks } },
  };
}
