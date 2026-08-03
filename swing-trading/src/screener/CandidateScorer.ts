import { CandidateResult, GateResult } from '../domain/types';

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function numeric(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function evidence(gates: readonly GateResult[], name: string): Record<string, unknown> {
  return gates.find((gate) => gate.gate === name)?.evidence ?? {};
}

export function scoreCandidate(candidate: CandidateResult): number {
  const stage = evidence(candidate.gates, 'STAGE_TWO');
  const impulse = evidence(candidate.gates, 'PRIOR_IMPULSE');
  const accumulation = evidence(candidate.gates, 'ACCUMULATION');
  const tightening = evidence(candidate.gates, 'ORDERLY_TIGHTENING');
  const sector = evidence(candidate.gates, 'SECTOR_STRENGTH');
  const risk = evidence(candidate.gates, 'RISK_REWARD');
  const trendScore = 20 * clamp(((candidate.rsPercentile ?? 0) - 80) / 20 * 0.5 + (Number(stage.close) / Number(stage.sma50) - 1) / 0.2 * 0.5);
  const impulseScore = 20 * clamp((Number(impulse.gain) - 0.30) / 0.40 * 0.5 + (Number(accumulation.volumeDominance) - 1.5) / 2 * 0.5);
  const tighteningScore = 20 * clamp((0.15 - Number(tightening.depth)) / 0.15 * 0.5 + (1 - Number(tightening.volumeRatio)) * 0.5);
  const sectorScore = 15 * clamp((Number(sector.percentile) - 60) / 40);
  const tightAreaScore = candidate.tightArea ? 15 * clamp((0.05 - candidate.tightArea.depth) / 0.05 * 0.6 + (0.02 - candidate.tightArea.pivotDistance) / 0.02 * 0.4) : 0;
  const executionScore = 10 * clamp((0.05 - (candidate.structuralRisk ?? 0.05)) / 0.05 * 0.5 + Number(risk.chartRoomR) / 4 * 0.5);
  return Math.round((trendScore + impulseScore + tighteningScore + sectorScore + tightAreaScore + executionScore) * 100) / 100;
}

export function scoreLowRiskSetup(candidate: CandidateResult): number {
  const setup = candidate.setupEvidence;
  if (!setup) return 0;
  const tight = candidate.tightArea;
  const impulse = evidence(candidate.gates, 'PRIOR_IMPULSE');
  const sector = evidence(candidate.gates, 'SECTOR_STRENGTH');
  const tightening = evidence(candidate.gates, 'ORDERLY_TIGHTENING');
  const risk = candidate.structuralRisk;
  const trend = 20 * clamp(
    (setup.aboveSma200 ? 0.25 : 0)
    + (setup.bullishShortMaOrder ? 0.25 : 0)
    + (setup.risingSma10 ? 0.15 : 0)
    + (setup.risingSma20 ? 0.15 : 0)
    + (setup.risingSma50 ? 0.20 : 0),
  );
  const entry = tight ? 25 * clamp(
    (0.08 - tight.depth) / 0.08 * 0.35
    + (0.04 - tight.pivotDistance) / 0.04 * 0.25
    + (1 - tight.volumeRatio) * 0.20
    + (1 - tight.atrContraction) * 0.20,
  ) : 0;
  const demand = 20 * clamp(
    Math.min(0.4, setup.unusualBullishVolumeEvents * 0.1)
    + Math.min(0.25, setup.defendedBullishFvgCount * 0.125)
    + (setup.breakoutRetest ? 0.2 : 0)
    + (setup.recentBreakout ? 0.15 : 0),
  );
  const impulseScore = 15 * clamp((numeric(impulse.gain) - 0.15) / 0.35 * 0.65
    + (numeric(tightening.volumeRatio, Number.POSITIVE_INFINITY) <= 0.75 ? 0.35 : 0));
  const leadership = 10 * clamp(((candidate.rsPercentile ?? 0) - 60) / 40 * 0.7
    + (numeric(sector.percentile) / 100) * 0.3);
  const execution = risk === null ? 0 : 10 * clamp((0.08 - risk) / 0.08 * 0.7
    + (setup.distanceFrom52WeekHigh <= 0.30 ? 0.3 : 0));
  return Math.round((trend + entry + demand + impulseScore + leadership + execution) * 100) / 100;
}

export function compareCandidates(left: CandidateResult, right: CandidateResult): number {
  return (right.lowRiskScore ?? 0) - (left.lowRiskScore ?? 0)
    || right.score - left.score
    || (left.structuralRisk ?? Number.POSITIVE_INFINITY) - (right.structuralRisk ?? Number.POSITIVE_INFINITY)
    || (right.rsPercentile ?? 0) - (left.rsPercentile ?? 0)
    || right.averageTradedValue - left.averageTradedValue
    || left.symbol.localeCompare(right.symbol);
}
