import { CandidateResult, DailyCandle, GateResult } from '../domain/types';

export interface OpportunityWeights {
  entryStructure: number;
  rewardAvailability: number;
  momentumTrend: number;
  contractionCleanliness: number;
  recentDemand: number;
  sectorLeadership: number;
}

export interface OpportunityParameters {
  weights: OpportunityWeights;
  minimumScore: number;
  minimumChartRoomR: number;
  entryValiditySessions: number;
  maximumGapAbovePivot: number;
  targetR: number;
  maximumHoldingSessions: number;
  slippageBps: number;
  roundTripCostBps: number;
}

export interface OpportunityBreakdown {
  score: number;
  components: OpportunityWeights;
  penalty: number;
  chartRoomR: number;
  eligible: boolean;
  rejectionReasons: string[];
}

export interface SimulatedTrade {
  symbol: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entry: number;
  stop: number;
  exit: number;
  initialRisk: number;
  rMultiple: number;
  maximumFavorableR: number;
  maximumAdverseR: number;
  outcome: 'TARGET' | 'STOP' | 'TIME';
  score: number;
}

const defaultWeights: OpportunityWeights = {
  entryStructure: 30,
  rewardAvailability: 20,
  momentumTrend: 20,
  contractionCleanliness: 15,
  recentDemand: 10,
  sectorLeadership: 5,
};

export const defaultOpportunityParameters: OpportunityParameters = {
  weights: defaultWeights,
  minimumScore: 55,
  minimumChartRoomR: 1.5,
  entryValiditySessions: 5,
  maximumGapAbovePivot: 0.02,
  targetR: 2,
  maximumHoldingSessions: 40,
  slippageBps: 10,
  roundTripCostBps: 25,
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function gate(candidate: CandidateResult, name: string): GateResult | undefined {
  return candidate.gates.find((item) => item.gate === name);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function scoreOpportunity(candidate: CandidateResult, parameters: OpportunityParameters): OpportunityBreakdown {
  const tight = candidate.tightArea;
  const setup = candidate.setupEvidence;
  const impulse = gate(candidate, 'PRIOR_IMPULSE')?.evidence ?? {};
  const tightening = gate(candidate, 'ORDERLY_TIGHTENING')?.evidence ?? {};
  const clean = gate(candidate, 'CLEAN_ACTION')?.evidence ?? {};
  const risk = gate(candidate, 'RISK_REWARD')?.evidence ?? {};
  const sector = gate(candidate, 'SECTOR_STRENGTH')?.evidence ?? {};
  const rejectionReasons: string[] = [];

  for (const required of ['DATA_QUALITY', 'LIQUIDITY', 'MARKET_ENVIRONMENT', 'STAGE_TWO', 'RELATIVE_STRENGTH', 'FINAL_TIGHT_AREA', 'PRIOR_IMPULSE']) {
    if (!gate(candidate, required)?.passed) rejectionReasons.push(required);
  }
  if (!tight || !setup || candidate.structuralRisk === null || candidate.structuralRisk <= 0) rejectionReasons.push('ENTRY_GEOMETRY');
  const chartRoomR = number(risk.chartRoomR);
  if (candidate.structuralRisk !== null && candidate.structuralRisk > 0.08) rejectionReasons.push('STRUCTURAL_RISK');
  if (chartRoomR < parameters.minimumChartRoomR) rejectionReasons.push('CHART_ROOM');

  const entryStructure = tight ? clamp(
    clamp((0.08 - tight.depth) / 0.08) * 0.35
      + clamp((0.04 - tight.pivotDistance) / 0.04) * 0.25
      + clamp(1 - tight.volumeRatio) * 0.20
      + clamp(1 - tight.atrContraction) * 0.20,
  ) : 0;
  const structuralRiskScore = candidate.structuralRisk === null ? 0 : clamp((0.08 - candidate.structuralRisk) / 0.06);
  const rewardAvailability = clamp(chartRoomR / 4) * 0.7 + structuralRiskScore * 0.3;
  const trendFlags = setup ? [setup.aboveSma200, setup.bullishShortMaOrder, setup.risingSma10, setup.risingSma20, setup.risingSma50] : [];
  const momentumTrend = clamp(
    trendFlags.filter(Boolean).length / 5 * 0.45
      + clamp(((candidate.rsPercentile ?? 0) - 50) / 50) * 0.30
      + clamp((number(impulse.gain) - 0.15) / 0.35) * 0.25,
  );
  const contractionCleanliness = clamp(
    clamp((0.18 - number(tightening.depth, 0.18)) / 0.18) * 0.30
      + clamp(1 - number(tightening.volumeRatio, 1)) * 0.25
      + (Boolean(tightening.rangeContracted) ? 0.20 : 0)
      + clamp(number(clean.averageOverlap) / 0.5) * 0.15
      + clamp((0.65 - number(clean.efficiency, 0.65)) / 0.65) * 0.10,
  );
  const recentDemand = setup ? clamp(
    Math.min(0.35, setup.unusualBullishVolumeEvents * 0.07)
      + Math.min(0.20, setup.defendedBullishFvgCount * 0.10)
      + (setup.breakoutRetest ? 0.25 : 0)
      + (setup.recentBreakout ? 0.20 : 0),
  ) : 0;
  const sectorLeadership = clamp(number(sector.percentile) / 100);
  const components: OpportunityWeights = {
    entryStructure,
    rewardAvailability,
    momentumTrend,
    contractionCleanliness,
    recentDemand,
    sectorLeadership,
  };

  let penalty = 0;
  if (gate(candidate, 'CLEAN_ACTION') && !gate(candidate, 'CLEAN_ACTION')?.passed) penalty += 12;
  if (gate(candidate, 'ORDERLY_TIGHTENING') && !gate(candidate, 'ORDERLY_TIGHTENING')?.passed) penalty += 10;
  if (gate(candidate, 'ACCUMULATION') && !gate(candidate, 'ACCUMULATION')?.passed) penalty += 8;
  if (gate(candidate, 'THRUST') && !gate(candidate, 'THRUST')?.passed) penalty += 8;
  if (gate(candidate, 'SECTOR_STRENGTH') && !gate(candidate, 'SECTOR_STRENGTH')?.passed) penalty += 4;

  const weighted = Object.entries(parameters.weights).reduce((sum, [key, weight]) => {
    return sum + components[key as keyof OpportunityWeights] * weight;
  }, 0);
  const score = Math.round(Math.max(0, weighted - penalty) * 100) / 100;
  if (score < parameters.minimumScore) rejectionReasons.push('MINIMUM_SCORE');
  return { score, components, penalty, chartRoomR, eligible: rejectionReasons.length === 0, rejectionReasons };
}

export function simulateTrade(
  candidate: CandidateResult,
  future: readonly DailyCandle[],
  score: number,
  parameters: OpportunityParameters,
): SimulatedTrade | null {
  const riskEvidence = gate(candidate, 'RISK_REWARD')?.evidence ?? {};
  const pivot = number(riskEvidence.entry, candidate.tightArea?.pivot ?? 0);
  const stop = number(riskEvidence.stop, candidate.tightArea?.low ?? 0);
  if (pivot <= stop || future.length === 0) return null;

  let entryIndex = -1;
  let entry = 0;
  for (let index = 0; index < Math.min(parameters.entryValiditySessions, future.length); index += 1) {
    const candle = future[index];
    if (!candle || candle.high < pivot) continue;
    const rawEntry = Math.max(pivot, candle.open);
    if (rawEntry / pivot - 1 > parameters.maximumGapAbovePivot) return null;
    entry = rawEntry * (1 + parameters.slippageBps / 10_000);
    entryIndex = index;
    break;
  }
  if (entryIndex < 0 || entry <= stop) return null;

  const initialRisk = entry - stop;
  const target = entry + parameters.targetR * initialRisk;
  let maximumFavorableR = Number.NEGATIVE_INFINITY;
  let maximumAdverseR = Number.POSITIVE_INFINITY;
  const end = Math.min(future.length, entryIndex + parameters.maximumHoldingSessions);
  for (let index = entryIndex; index < end; index += 1) {
    const candle = future[index];
    if (!candle) continue;
    maximumFavorableR = Math.max(maximumFavorableR, (candle.high - entry) / initialRisk);
    maximumAdverseR = Math.min(maximumAdverseR, (candle.low - entry) / initialRisk);
    const stopHit = candle.low <= stop;
    const targetHit = candle.high >= target;
    if (stopHit || targetHit) {
      const outcome = stopHit ? 'STOP' : 'TARGET';
      const rawExit = stopHit ? Math.min(stop, candle.open) : Math.max(target, Math.min(candle.open, candle.high));
      const exit = rawExit * (1 - parameters.slippageBps / 10_000);
      const costsR = entry * parameters.roundTripCostBps / 10_000 / initialRisk;
      return {
        symbol: candidate.symbol, signalDate: candidate.asOfDate, entryDate: future[entryIndex]?.date ?? '', exitDate: candle.date,
        entry, stop, exit, initialRisk, rMultiple: (exit - entry) / initialRisk - costsR,
        maximumFavorableR, maximumAdverseR, outcome, score,
      };
    }
  }
  const final = future[Math.max(entryIndex, end - 1)];
  if (!final) return null;
  const exit = final.close * (1 - parameters.slippageBps / 10_000);
  const costsR = entry * parameters.roundTripCostBps / 10_000 / initialRisk;
  return {
    symbol: candidate.symbol, signalDate: candidate.asOfDate, entryDate: future[entryIndex]?.date ?? '', exitDate: final.date,
    entry, stop, exit, initialRisk, rMultiple: (exit - entry) / initialRisk - costsR,
    maximumFavorableR, maximumAdverseR, outcome: 'TIME', score,
  };
}
