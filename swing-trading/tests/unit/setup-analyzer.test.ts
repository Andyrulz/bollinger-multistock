import { CandidateResult, DailyCandle } from '../../src/domain/types';
import { analyzeSetup, classifySetup } from '../../src/screener/SetupAnalyzer';
import { scoreLowRiskSetup } from '../../src/screener/CandidateScorer';

function candles(count = 280): DailyCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.45;
    return {
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: index === count - 40 ? 4_000_000 : 1_000_000,
    };
  });
}

function candidate(): CandidateResult {
  return {
    symbol: 'TEST', company: 'Test', sector: 'Test', asOfDate: '2026-01-01', status: 'REJECTED',
    score: 0, structuralRisk: 0.04, rsPercentile: 90, averageTradedValue: 100_000_000, gates: [],
    tightArea: {
      startIndex: 274, endIndex: 279, startDate: '2025-10-02', endDate: '2025-10-07',
      high: 226, low: 220, depth: 0.027, pivot: 226, sma10: 222,
      pivotDistance: 0.018, atrContraction: 0.5, upperHalfCloses: 4, volumeRatio: 0.6,
    },
  };
}

describe('setup analyzer', () => {
  test('surfaces daily OHLCV evidence without fundamentals', () => {
    const result = analyzeSetup(candles(), candidate());
    expect(result.aboveSma200).toBe(true);
    expect(result.bullishShortMaOrder).toBe(true);
    expect(result.risingSma50).toBe(true);
    expect(result.unusualBullishVolumeEvents).toBeGreaterThan(0);
    expect(result.evidenceSignals).toContain('RECENT_UNUSUAL_BULLISH_VOLUME');
  });

  test('classifies a compact post-breakout continuation using computed evidence', () => {
    const stock = candidate();
    stock.setupEvidence = {
      ...analyzeSetup(candles(), stock),
      abovePrevious52WeekHigh: true,
      recentBreakout: true,
      breakoutRetest: true,
      defendedBullishFvgCount: 1,
    };
    expect(classifySetup(stock)).toEqual(expect.arrayContaining([
      'BASE_BREAKOUT_RETEST',
      'POST_BREAKOUT_TIGHTNESS',
      'POST_52W_HIGH_CONTINUATION',
    ]));
  });

  test('returns a finite score when later scanner gates have not been evaluated', () => {
    const stock = candidate();
    stock.setupEvidence = analyzeSetup(candles(), stock);
    expect(Number.isFinite(scoreLowRiskSetup(stock))).toBe(true);
  });
});
