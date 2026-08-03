import { CandidateResult, DailyCandle, UniverseMember } from '../../src/domain/types';
import { enrichCandidatesWithSectorRotation, SectorRotationService } from '../../src/sectors/SectorRotationService';

function weeklySeries(weeklyReturn: number, weeks = 70): DailyCandle[] {
  const candles: DailyCandle[] = [];
  let close = 100;
  const date = new Date('2025-01-03T00:00:00Z');
  for (let index = 0; index < weeks; index += 1) {
    close *= 1 + weeklyReturn;
    candles.push({
      date: date.toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1_000,
    });
    date.setUTCDate(date.getUTCDate() + 7);
  }
  return candles;
}

const universe: UniverseMember[] = [
  { symbol: 'LEAD1', company: 'Leader One', industry: 'Leading Industry', series: 'EQ', isin: 'INE1' },
  { symbol: 'LEAD2', company: 'Leader Two', industry: 'Leading Industry', series: 'EQ', isin: 'INE2' },
  { symbol: 'LAG1', company: 'Laggard One', industry: 'Lagging Industry', series: 'EQ', isin: 'INE3' },
  { symbol: 'LAG2', company: 'Laggard Two', industry: 'Lagging Industry', series: 'EQ', isin: 'INE4' },
];

describe('SectorRotationService', () => {
  test('builds weekly sector trails and reports complete mapping coverage', () => {
    const source = {
      getIndexCandles: () => weeklySeries(0.005),
      getDailyCandles: (symbol: string) => weeklySeries(symbol.startsWith('LEAD') ? 0.012 : -0.004),
    };
    const result = new SectorRotationService(source).calculate(universe, undefined, 8);

    expect(result.mappingCoverage).toEqual({ mapped: 4, total: 4, unmapped: [] });
    expect(result.methodology.frequency).toBe('WEEKLY');
    expect(result.methodology.note).toContain('not the proprietary JdK formula');
    expect(result.sectors).toHaveLength(2);
    expect(result.sectors.every((sector) => sector.points.length === 8)).toBe(true);
    expect(result.sectors.find((sector) => sector.sector === 'Leading Industry')?.current.ratio).toBeGreaterThan(100);
    expect(result.sectors.find((sector) => sector.sector === 'Lagging Industry')?.current.ratio).toBeLessThan(100);
  });

  test('labels missing industry mappings instead of guessing', () => {
    const source = { getIndexCandles: () => weeklySeries(0), getDailyCandles: () => weeklySeries(0) };
    const result = new SectorRotationService(source).calculate([
      ...universe,
      { symbol: 'UNKNOWN', company: 'Unknown', industry: '', series: 'EQ', isin: 'INE5' },
    ]);
    expect(result.mappingCoverage.unmapped).toEqual(['UNKNOWN']);
    expect(result.mappingCoverage.mapped).toBe(4);
  });

  test('enriches candidates with the exact sector snapshot and reports unavailable sectors', () => {
    const source = {
      getIndexCandles: () => weeklySeries(0.005),
      getDailyCandles: (symbol: string) => weeklySeries(symbol.startsWith('LEAD') ? 0.012 : -0.004),
    };
    const rotation = new SectorRotationService(source).calculate(universe, undefined, 8);
    const candidates: CandidateResult[] = [
      {
        symbol: 'LEAD1', company: 'Leader One', sector: 'Leading Industry', asOfDate: '2026-04-24',
        status: 'REJECTED' as const, score: 0, structuralRisk: null, rsPercentile: 90,
        averageTradedValue: 1_000_000, gates: [],
      },
      {
        symbol: 'UNKNOWN', company: 'Unknown', sector: 'Unknown Industry', asOfDate: '2026-04-24',
        status: 'REJECTED' as const, score: 0, structuralRisk: null, rsPercentile: 50,
        averageTradedValue: 1_000_000, gates: [],
      },
    ];

    const qc = enrichCandidatesWithSectorRotation(candidates, rotation);

    expect(qc).toEqual({ enriched: 1, unavailable: ['Unknown Industry'] });
    expect(candidates[0]?.sectorQuadrant).toBe(rotation.sectors.find((sector) => sector.sector === 'Leading Industry')?.current.quadrant);
    expect(candidates[0]?.sectorRsRatio).toBeGreaterThan(100);
    expect(candidates[0]?.sectorRotationDate).toBe(rotation.asOfDate);
    expect(candidates[1]?.sectorQuadrant).toBeUndefined();
  });
});
