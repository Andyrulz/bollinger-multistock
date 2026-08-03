import { ScannerConfig } from '../domain/types';
import { SwingScreener } from '../screener/SwingScreener';
import { MomentumResearchDatabase } from './MomentumResearchDatabase';
import {
  defaultOpportunityParameters, OpportunityParameters, OpportunityWeights,
  scoreOpportunity, simulateTrade, SimulatedTrade,
} from './OpportunityModel';

export interface PerformanceMetrics {
  trades: number;
  expectancyR: number;
  medianR: number;
  hit2R: number;
  stopRate: number;
  cvar5R: number;
  maximumDrawdownPct: number;
  profitFactor: number;
  objective: number;
}

export interface ParameterSet {
  id: string;
  scanner: ScannerConfig;
  opportunity: OpportunityParameters;
}

export interface EvaluatedSet {
  parameters: ParameterSet;
  allMetrics: PerformanceMetrics;
  validationMetrics: PerformanceMetrics[];
  meanValidationObjective: number;
  worstValidationObjective: number;
  trades: SimulatedTrade[];
}

export interface OptimizationReport {
  methodology: Record<string, unknown>;
  dateCoverage: { from: string; to: string; scanDates: number; frequency: string };
  parameterSets: number;
  evaluatedSets: Array<{
    id: string;
    scanner: Partial<ScannerConfig>;
    opportunity: OpportunityParameters;
    allMetrics: PerformanceMetrics;
    validationMetrics: PerformanceMetrics[];
    meanValidationObjective: number;
    worstValidationObjective: number;
  }>;
  finalists: Array<{
    rank: number;
    id: string;
    meanValidationObjective: number;
    worstValidationObjective: number;
    allMetrics: PerformanceMetrics;
    holdoutMetrics: PerformanceMetrics;
    scanner: Partial<ScannerConfig>;
    opportunity: OpportunityParameters;
    bootstrap: BootstrapSummary;
  }>;
  warnings: string[];
}

interface BootstrapSummary {
  paths: number;
  expectancyR: { p05: number; median: number; p95: number };
  maximumDrawdownPct: { p05: number; median: number; p95: number };
  probabilityPositiveExpectancy: number;
}

interface OptimizerOptions {
  from: string;
  to: string;
  samples: number;
  seed: number;
  frequency: 'WEEKLY' | 'MONTHLY';
  bootstrapPaths: number;
}

const validationWindows = [
  ['2021-01-01', '2021-12-31'],
  ['2022-01-01', '2022-12-31'],
  ['2023-01-01', '2023-12-31'],
  ['2024-01-01', '2024-12-31'],
] as const;
const holdout: readonly [string, string] = ['2025-01-01', '2026-02-28'];

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function quantile(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)))] ?? 0;
}

function metrics(trades: readonly SimulatedTrade[]): PerformanceMetrics {
  if (trades.length === 0) {
    return { trades: 0, expectancyR: 0, medianR: 0, hit2R: 0, stopRate: 0, cvar5R: 0, maximumDrawdownPct: 0, profitFactor: 0, objective: -100 };
  }
  const returns = trades.map((trade) => trade.rMultiple).sort((a, b) => a - b);
  const expectancyR = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const medianR = quantile(returns, 0.5);
  const hit2R = trades.filter((trade) => trade.outcome === 'TARGET').length / trades.length;
  const stopRate = trades.filter((trade) => trade.outcome === 'STOP').length / trades.length;
  const tail = returns.slice(0, Math.max(1, Math.ceil(returns.length * 0.05)));
  const cvar5R = tail.reduce((sum, value) => sum + value, 0) / tail.length;
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  let equity = 1;
  let peak = 1;
  let maximumDrawdownPct = 0;
  for (const trade of [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))) {
    equity *= Math.max(0.5, 1 + trade.rMultiple * 0.01);
    peak = Math.max(peak, equity);
    maximumDrawdownPct = Math.max(maximumDrawdownPct, (peak - equity) / peak);
  }
  const samplePenalty = Math.min(1, trades.length / 30);
  const objective = samplePenalty * (
    0.35 * expectancyR
      + 0.20 * hit2R
      + 0.15 * medianR
      - 0.15 * Math.abs(Math.min(0, cvar5R))
      - 0.10 * maximumDrawdownPct
  );
  return {
    trades: trades.length,
    expectancyR: round(expectancyR), medianR: round(medianR), hit2R: round(hit2R), stopRate: round(stopRate),
    cvar5R: round(cvar5R), maximumDrawdownPct: round(maximumDrawdownPct),
    profitFactor: round(losses > 0 ? gains / losses : gains), objective: round(objective),
  };
}

function inWindow(trade: SimulatedTrade, from: string, to: string): boolean {
  return trade.signalDate >= from && trade.signalDate <= to;
}

function benchmarkAsOf(benchmark: readonly import('../domain/types').DailyCandle[], date: string): import('../domain/types').DailyCandle[] {
  let low = 0;
  let high = benchmark.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((benchmark[middle]?.date ?? '') <= date) low = middle + 1;
    else high = middle;
  }
  return benchmark.slice(Math.max(0, low - 340), low);
}

class SeededRandom {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state * 1_664_525 + 1_013_904_223) >>> 0;
    return this.state / 4_294_967_296;
  }
  between(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }
  integer(minimum: number, maximum: number): number {
    return Math.floor(this.between(minimum, maximum + 1));
  }
}

function normalizeWeights(random: SeededRandom): OpportunityWeights {
  const anchors = defaultOpportunityParameters.weights;
  const raw = Object.fromEntries(Object.entries(anchors).map(([key, value]) => [key, value * random.between(0.55, 1.45)])) as unknown as OpportunityWeights;
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / total * 100])) as unknown as OpportunityWeights;
}

function sampledParameters(base: ScannerConfig, count: number, seed: number): ParameterSet[] {
  const random = new SeededRandom(seed);
  const sets: ParameterSet[] = [{ id: 'baseline-proposed', scanner: { ...base, stageTwoMode: 'LOW_RISK' }, opportunity: structuredClone(defaultOpportunityParameters) }];
  for (let index = 1; index < count; index += 1) {
    const minimumFinalTightAreaSessions = random.integer(3, 5);
    sets.push({
      id: `mc-${String(index).padStart(4, '0')}`,
      scanner: {
        ...base,
        version: `research-mc-${index}`,
        stageTwoMode: 'LOW_RISK',
        relativeStrengthPercentile: random.integer(65, 85),
        relativeStrengthSlopeSessions: random.integer(10, 25),
        minimumImpulseGain: round(random.between(0.15, 0.40), 3),
        minimumAccumulationDays: random.integer(1, 4),
        minimumVolumeDominance: round(random.between(1.2, 2.0), 2),
        maximumTighteningDepth: round(random.between(0.10, 0.22), 3),
        minimumFinalTightAreaSessions,
        maximumFinalTightAreaSessions: random.integer(Math.max(7, minimumFinalTightAreaSessions), 12),
        maximumFinalTightAreaDepth: round(random.between(0.04, 0.10), 3),
        maximumPivotDistanceFromSma10: round(random.between(0.02, 0.06), 3),
        minimumUpperHalfCloses: random.integer(2, 3),
        maximumAtrContraction: round(random.between(0.5, 1.0), 2),
        maximumStructuralRisk: round(random.between(0.04, 0.08), 3),
        sectorPercentileThreshold: random.integer(40, 75),
      },
      opportunity: {
        ...defaultOpportunityParameters,
        weights: normalizeWeights(random),
        minimumScore: random.integer(45, 68),
        minimumChartRoomR: round(random.between(0.75, 2.25), 2),
        entryValiditySessions: random.integer(3, 7),
        maximumGapAbovePivot: round(random.between(0.01, 0.035), 3),
        targetR: round(random.between(1.75, 3), 2),
        maximumHoldingSessions: random.integer(25, 60),
      },
    });
  }
  return sets;
}

export class WalkForwardOptimizer {
  constructor(private readonly database: MomentumResearchDatabase, private readonly baseConfig: ScannerConfig) {}

  run(options: OptimizerOptions): OptimizationReport {
    const dates = this.database.getTradingDates(options.from, options.to, options.frequency);
    const benchmark = this.database.getIndexCandles('NIFTY500', options.to);
    const parameterSets = sampledParameters(this.baseConfig, options.samples, options.seed);
    const evaluated: EvaluatedSet[] = [];

    for (const [parameterIndex, parameters] of parameterSets.entries()) {
      console.error(`[research] parameter set ${parameterIndex + 1}/${parameterSets.length}: ${parameters.id}`);
      const screener = new SwingScreener(this.database, parameters.scanner);
      const trades: SimulatedTrade[] = [];
      const lastSignal = new Map<string, string>();
      for (const [dateIndex, date] of dates.entries()) {
        if (dateIndex % 12 === 0) console.error(`[research] ${parameters.id}: scan ${dateIndex + 1}/${dates.length} (${date})`);
        const universe = this.database.getPointInTimeUniverse(date, 'MIDSMALL_400');
        if (universe.totalRows === 0 || universe.resolvedRows / universe.totalRows < 0.90) continue;
        const result = screener.run(universe.members, benchmarkAsOf(benchmark, date), date, true, 'IGNORE', 100);
        const ranked = result.candidates
          .map((candidate) => ({ candidate, opportunity: scoreOpportunity(candidate, parameters.opportunity) }))
          .filter((item) => item.opportunity.eligible)
          .sort((left, right) => right.opportunity.score - left.opportunity.score)
          .slice(0, 5);
        for (const item of ranked) {
          const previous = lastSignal.get(item.candidate.symbol);
          if (previous && Date.parse(date) - Date.parse(previous) < 28 * 86_400_000) continue;
          const future = this.database.getForwardCandles(item.candidate.symbol, date, parameters.opportunity.entryValiditySessions + parameters.opportunity.maximumHoldingSessions + 2);
          const trade = simulateTrade(item.candidate, future, item.opportunity.score, parameters.opportunity);
          if (!trade) continue;
          trades.push(trade);
          lastSignal.set(item.candidate.symbol, date);
        }
      }
      const validationMetrics = validationWindows.map(([from, to]) => metrics(trades.filter((trade) => inWindow(trade, from, to))));
      const validObjectives = validationMetrics.filter((item) => item.trades >= 4).map((item) => item.objective);
      evaluated.push({
        parameters,
        allMetrics: metrics(trades),
        validationMetrics,
        meanValidationObjective: validObjectives.length > 0 ? validObjectives.reduce((sum, value) => sum + value, 0) / validObjectives.length : -100,
        worstValidationObjective: validObjectives.length > 0 ? Math.min(...validObjectives) : -100,
        trades,
      });
    }

    const finalists = evaluated
      .filter((item) => item.validationMetrics.every((window) => window.trades >= 4)
        && item.validationMetrics.reduce((sum, window) => sum + window.trades, 0) >= 24)
      .sort((left, right) => right.meanValidationObjective - left.meanValidationObjective || right.worstValidationObjective - left.worstValidationObjective)
      .slice(0, 5)
      .map((item, index) => ({
        rank: index + 1,
        id: item.parameters.id,
        meanValidationObjective: round(item.meanValidationObjective),
        worstValidationObjective: round(item.worstValidationObjective),
        allMetrics: item.allMetrics,
        holdoutMetrics: metrics(item.trades.filter((trade) => inWindow(trade, holdout[0], holdout[1]))),
        scanner: this.scannerSummary(item.parameters.scanner),
        opportunity: item.parameters.opportunity,
        bootstrap: this.bootstrap(item.trades.filter((trade) => inWindow(trade, holdout[0], holdout[1])), options.bootstrapPaths, options.seed + index + 1),
      }));

    return {
      methodology: {
        universe: 'Prior completed month market-cap ranks 101-500; unresolved symbols excluded',
        execution: 'Next-session pivot stop order, stop-first same-bar assumption, costs and slippage included',
        selection: 'Top five eligible opportunities per scan with 28-calendar-day symbol cooldown',
        validationWindows,
        holdout,
        optimization: 'Seeded constrained Monte Carlo; rank by mean then worst out-of-sample objective',
        bootstrap: 'Month-block bootstrap of holdout trades',
      },
      dateCoverage: { from: options.from, to: options.to, scanDates: dates.length, frequency: options.frequency },
      parameterSets: parameterSets.length,
      evaluatedSets: evaluated.map((item) => ({
        id: item.parameters.id,
        scanner: this.scannerSummary(item.parameters.scanner),
        opportunity: item.parameters.opportunity,
        allMetrics: item.allMetrics,
        validationMetrics: item.validationMetrics,
        meanValidationObjective: round(item.meanValidationObjective),
        worstValidationObjective: round(item.worstValidationObjective),
      })),
      finalists,
      warnings: [
        'Exact historical Nifty MidSmallcap 400 membership is unavailable; ranks 101-500 are an approximation.',
        'Delisted coverage and corporate-action adjustment are not proven complete.',
        'Monthly snapshots are lagged by one month to prevent month-end membership look-ahead.',
        'Optimization findings are research evidence, not authorization to change live scanner parameters.',
      ],
    };
  }

  private bootstrap(trades: readonly SimulatedTrade[], paths: number, seed: number): BootstrapSummary {
    if (trades.length === 0 || paths <= 0) {
      return { paths: 0, expectancyR: { p05: 0, median: 0, p95: 0 }, maximumDrawdownPct: { p05: 0, median: 0, p95: 0 }, probabilityPositiveExpectancy: 0 };
    }
    const random = new SeededRandom(seed);
    const grouped = new Map<string, SimulatedTrade[]>();
    for (const trade of trades) {
      const key = trade.signalDate.slice(0, 7);
      grouped.set(key, [...(grouped.get(key) ?? []), trade]);
    }
    const blocks = [...grouped.values()];
    const expectancy: number[] = [];
    const drawdown: number[] = [];
    for (let path = 0; path < paths; path += 1) {
      const sample: SimulatedTrade[] = [];
      for (let index = 0; index < blocks.length; index += 1) {
        sample.push(...(blocks[random.integer(0, blocks.length - 1)] ?? []));
      }
      const result = metrics(sample);
      expectancy.push(result.expectancyR);
      drawdown.push(result.maximumDrawdownPct);
    }
    expectancy.sort((a, b) => a - b);
    drawdown.sort((a, b) => a - b);
    return {
      paths,
      expectancyR: { p05: round(quantile(expectancy, 0.05)), median: round(quantile(expectancy, 0.5)), p95: round(quantile(expectancy, 0.95)) },
      maximumDrawdownPct: { p05: round(quantile(drawdown, 0.05)), median: round(quantile(drawdown, 0.5)), p95: round(quantile(drawdown, 0.95)) },
      probabilityPositiveExpectancy: round(expectancy.filter((value) => value > 0).length / expectancy.length),
    };
  }

  private scannerSummary(config: ScannerConfig): Partial<ScannerConfig> {
    return {
      relativeStrengthPercentile: config.relativeStrengthPercentile,
      relativeStrengthSlopeSessions: config.relativeStrengthSlopeSessions,
      minimumImpulseGain: config.minimumImpulseGain,
      minimumAccumulationDays: config.minimumAccumulationDays,
      minimumVolumeDominance: config.minimumVolumeDominance,
      maximumTighteningDepth: config.maximumTighteningDepth,
      minimumFinalTightAreaSessions: config.minimumFinalTightAreaSessions,
      maximumFinalTightAreaSessions: config.maximumFinalTightAreaSessions,
      maximumFinalTightAreaDepth: config.maximumFinalTightAreaDepth,
      maximumPivotDistanceFromSma10: config.maximumPivotDistanceFromSma10,
      minimumUpperHalfCloses: config.minimumUpperHalfCloses,
      maximumAtrContraction: config.maximumAtrContraction,
      maximumStructuralRisk: config.maximumStructuralRisk,
      sectorPercentileThreshold: config.sectorPercentileThreshold,
    };
  }
}
