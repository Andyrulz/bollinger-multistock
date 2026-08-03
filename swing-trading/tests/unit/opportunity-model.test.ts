import { CandidateResult, DailyCandle } from '../../src/domain/types';
import { defaultOpportunityParameters, scoreOpportunity, simulateTrade } from '../../src/research/OpportunityModel';

function candidate(): CandidateResult {
  return {
    symbol: 'TEST', company: 'Test', sector: 'Industrials', asOfDate: '2025-01-01', status: 'REJECTED', score: 0,
    structuralRisk: 0.04, rsPercentile: 90, averageTradedValue: 50_000_000,
    gates: [
      ...['DATA_QUALITY', 'LIQUIDITY', 'MARKET_ENVIRONMENT', 'STAGE_TWO', 'RELATIVE_STRENGTH', 'FINAL_TIGHT_AREA'].map((name) => ({ gate: name, passed: true, code: `${name}_PASSED`, evidence: {} })),
      { gate: 'PRIOR_IMPULSE', passed: true, code: 'PRIOR_IMPULSE_PASSED', evidence: { gain: 0.35 } },
      { gate: 'ACCUMULATION', passed: true, code: 'ACCUMULATION_PASSED', evidence: {} },
      { gate: 'ORDERLY_TIGHTENING', passed: true, code: 'ORDERLY_TIGHTENING_PASSED', evidence: { depth: 0.08, volumeRatio: 0.6, rangeContracted: true } },
      { gate: 'CLEAN_ACTION', passed: true, code: 'CLEAN_ACTION_PASSED', evidence: { averageOverlap: 0.4, efficiency: 0.2 } },
      { gate: 'THRUST', passed: true, code: 'THRUST_PASSED', evidence: {} },
      { gate: 'SECTOR_STRENGTH', passed: true, code: 'SECTOR_STRENGTH_PASSED', evidence: { percentile: 80 } },
      { gate: 'RISK_REWARD', passed: true, code: 'RISK_REWARD_PASSED', evidence: { entry: 100, stop: 96, chartRoomR: 3 } },
    ],
    tightArea: { startIndex: 0, endIndex: 4, startDate: '2024-12-20', endDate: '2025-01-01', high: 100, low: 96.1, depth: 0.04, pivot: 100, sma10: 99, pivotDistance: 0.01, atrContraction: 0.5, upperHalfCloses: 4, volumeRatio: 0.6 },
    setupEvidence: { close: 99, high52Week: 112, distanceFrom52WeekHigh: 0.13, previous52WeekHigh: 110, distanceFromPrevious52WeekHigh: -0.1, abovePrevious52WeekHigh: false, sma10: 99, sma20: 97, sma50: 94, sma200: 85, aboveSma200: true, bullishShortMaOrder: true, risingSma10: true, risingSma20: true, risingSma50: true, risingSma200: true, unusualBullishVolumeEvents: 2, maximumBullishVolumeRatio: 2, defendedBullishFvgCount: 1, recentBreakout: true, breakoutLevel: 95, breakoutDate: '2024-12-01', breakoutRetest: true, evidenceSignals: [] },
  };
}

function candle(date: string, open: number, high: number, low: number, close: number): DailyCandle {
  return { date, open, high, low, close, volume: 1_000_000 };
}

describe('research opportunity model', () => {
  test('scores a clean, liquid, compact setup as eligible', () => {
    const result = scoreOpportunity(candidate(), { ...defaultOpportunityParameters, minimumScore: 40 });
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThan(60);
    expect(result.chartRoomR).toBe(3);
  });

  test('uses a pessimistic stop-first assumption on ambiguous daily bars', () => {
    const setup = candidate();
    const future = [candle('2025-01-02', 100, 110, 95, 105)];
    const trade = simulateTrade(setup, future, 80, { ...defaultOpportunityParameters, targetR: 2 });
    expect(trade?.outcome).toBe('STOP');
    expect(trade?.rMultiple).toBeLessThan(-1);
  });
});
