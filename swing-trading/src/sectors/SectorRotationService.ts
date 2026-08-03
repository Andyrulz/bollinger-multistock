import {
  CandidateResult, DailyCandle, SectorQuadrant, SectorRotationPoint, SectorRotationResult, UniverseMember,
} from '../domain/types';

export interface SectorRotationDataSource {
  getDailyCandles(symbol: string, limit: number, asOfDate?: string): DailyCandle[];
  getIndexCandles(symbol: string, limit: number, asOfDate?: string): DailyCandle[];
}

export function enrichCandidatesWithSectorRotation(
  candidates: CandidateResult[], rotation: SectorRotationResult,
): { enriched: number; unavailable: string[] } {
  const sectors = new Map(rotation.sectors.map((sector) => [sector.sector, sector.current]));
  const unavailable = new Set<string>();
  let enriched = 0;
  for (const candidate of candidates) {
    const point = sectors.get(candidate.sector);
    if (!point) {
      unavailable.add(candidate.sector || 'UNMAPPED');
      continue;
    }
    candidate.sectorQuadrant = point.quadrant;
    candidate.sectorRsRatio = point.ratio;
    candidate.sectorMomentum = point.momentum;
    candidate.sectorRotationDate = point.date;
    enriched += 1;
  }
  return { enriched, unavailable: [...unavailable].sort() };
}

const RATIO_LOOKBACK_WEEKS = 26;
const MOMENTUM_LOOKBACK_WEEKS = 10;

function weekKey(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

function weeklyCloses(candles: readonly DailyCandle[]): Map<string, { date: string; close: number }> {
  const weeks = new Map<string, { date: string; close: number }>();
  for (const candle of candles) weeks.set(weekKey(candle.date), { date: candle.date, close: candle.close });
  return weeks;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return sorted[middle] ?? 0;
}

function quadrant(ratio: number, momentum: number): SectorQuadrant {
  if (ratio >= 100 && momentum >= 100) return 'LEADING';
  if (ratio >= 100) return 'WEAKENING';
  if (momentum >= 100) return 'IMPROVING';
  return 'LAGGING';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export class SectorRotationService {
  constructor(private readonly source: SectorRotationDataSource) {}

  calculate(
    universe: UniverseMember[], asOfDate?: string, trailWeeks = 8, candidates: CandidateResult[] = [],
  ): SectorRotationResult {
    const safeTrailWeeks = Math.min(20, Math.max(4, Math.trunc(trailWeeks)));
    const benchmarkDaily = this.source.getIndexCandles('NIFTY MIDSML 400', 420, asOfDate);
    const benchmarkWeeks = weeklyCloses(benchmarkDaily);
    const weekKeys = [...benchmarkWeeks.keys()].sort();
    const benchmarkLevels = weekKeys.map((key) => benchmarkWeeks.get(key)?.close ?? 0);
    const groups = new Map<string, UniverseMember[]>();
    const unmapped: string[] = [];
    for (const member of universe) {
      const sector = member.industry.trim();
      if (!sector) {
        unmapped.push(member.symbol);
        continue;
      }
      groups.set(sector, [...(groups.get(sector) ?? []), member]);
    }
    const candidateCounts = new Map<string, { qualified: number; watchlist: number }>();
    for (const candidate of candidates) {
      const counts = candidateCounts.get(candidate.sector) ?? { qualified: 0, watchlist: 0 };
      if (candidate.status !== 'REJECTED') counts.qualified += 1;
      else counts.watchlist += 1;
      candidateCounts.set(candidate.sector, counts);
    }
    const sectors = [...groups.entries()].flatMap(([sector, members]) => {
      const stockWeeks = members.map((member) => weeklyCloses(this.source.getDailyCandles(member.symbol, 420, asOfDate)));
      const levels: number[] = [];
      let level = 100;
      for (let index = 0; index < weekKeys.length; index += 1) {
        if (index > 0) {
          const previousKey = weekKeys[index - 1] ?? '';
          const currentKey = weekKeys[index] ?? '';
          const returns = stockWeeks.flatMap((weeks) => {
            const previous = weeks.get(previousKey)?.close;
            const current = weeks.get(currentKey)?.close;
            return previous && current && previous > 0 ? [current / previous - 1] : [];
          });
          if (returns.length >= Math.min(2, members.length)) level *= 1 + median(returns);
        }
        levels.push(level);
      }
      const benchmarkBase = benchmarkLevels[0] ?? 0;
      if (benchmarkBase <= 0) return [];
      const relative = levels.map((sectorLevel, index) => sectorLevel / ((benchmarkLevels[index] ?? benchmarkBase) / benchmarkBase * 100));
      const ratios = relative.map((value, index) => {
        if (index + 1 < RATIO_LOOKBACK_WEEKS) return null;
        const average = mean(relative.slice(index + 1 - RATIO_LOOKBACK_WEEKS, index + 1));
        return average > 0 ? value / average * 100 : null;
      });
      const points: SectorRotationPoint[] = [];
      for (let index = 0; index < ratios.length; index += 1) {
        const ratio = ratios[index];
        const priorRatio = ratios[index - MOMENTUM_LOOKBACK_WEEKS];
        if (ratio === null || ratio === undefined || priorRatio === null || priorRatio === undefined || priorRatio <= 0) continue;
        const momentum = ratio / priorRatio * 100;
        const date = benchmarkWeeks.get(weekKeys[index] ?? '')?.date;
        if (date) points.push({ date, ratio: round(ratio), momentum: round(momentum), quadrant: quadrant(ratio, momentum) });
      }
      const trail = points.slice(-safeTrailWeeks);
      const current = trail.at(-1);
      if (!current) return [];
      const previous = trail.at(-2);
      const counts = candidateCounts.get(sector) ?? { qualified: 0, watchlist: 0 };
      return [{
        sector, constituentCount: members.length, qualifiedCount: counts.qualified, watchlistCount: counts.watchlist,
        current, previousQuadrant: previous?.quadrant ?? null,
        ratioChange: round(current.ratio - (previous?.ratio ?? current.ratio)),
        momentumChange: round(current.momentum - (previous?.momentum ?? current.momentum)), points: trail,
      }];
    }).sort((left, right) => right.current.ratio - left.current.ratio || right.current.momentum - left.current.momentum);
    return {
      asOfDate: benchmarkDaily.at(-1)?.date ?? null,
      benchmark: 'NIFTY MIDSML 400',
      mappingCoverage: { mapped: universe.length - unmapped.length, total: universe.length, unmapped },
      methodology: {
        name: 'RRG-style equal-weight industry rotation', frequency: 'WEEKLY',
        ratioLookbackWeeks: RATIO_LOOKBACK_WEEKS, momentumLookbackWeeks: MOMENTUM_LOOKBACK_WEEKS,
        trailWeeks: safeTrailWeeks,
        note: 'Current-universe industry composites using median constituent weekly returns; this is a transparent RRG-style model, not the proprietary JdK formula.',
      },
      sectors,
    };
  }
}
