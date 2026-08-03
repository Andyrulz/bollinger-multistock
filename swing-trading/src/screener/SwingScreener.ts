import crypto from 'node:crypto';
import { DatabaseQc } from '../data/MomentumDatabaseAdapter';
import { calendarAgeDays, validateCandles } from '../data/DataQualityService';
import { CandidateResult, DailyCandle, GateResult, MarketGateMode, ScanResult, ScannerConfig, UniverseMember } from '../domain/types';
import { compareCandidates, scoreCandidate, scoreLowRiskSetup } from './CandidateScorer';
import { analyzeSetup, classifySetup } from './SetupAnalyzer';
import { evaluateStageTwo } from './StageTwoEvaluator';
import { relativeStrengthLineSlope, relativeStrengthPercentile, weightedReturn } from './RelativeStrengthService';
import { detectFinalTightArea, detectImpulse, evaluateAccumulation, evaluateLiquidity, evaluateTightening } from './StructureDetectors';
import { mean, percentileRank, sma, trueRange, atr } from './indicators';

interface PreparedMember {
  member: UniverseMember;
  candles: DailyCandle[];
  relativeStrength: number | null;
  sectorReturn: number | null;
}

export interface ScreenerDataSource {
  readonly sourcePath: string;
  getQc(): DatabaseQc;
  getDailyCandles(symbol: string, limit: number, asOfDate?: string): DailyCandle[];
  getCorporateActionPolicy?(): { status: 'VERIFIED' | 'FAILED' | 'INSUFFICIENT' } | null;
}

function failed(gate: GateResult): boolean {
  return !gate.passed;
}

function marketGate(benchmark: readonly DailyCandle[]): GateResult {
  if (benchmark.length < 10) return { gate: 'MARKET_ENVIRONMENT', passed: false, code: 'BLOCKED_DATA_BENCHMARK_MISSING', evidence: { rows: benchmark.length } };
  const close = benchmark.at(-1)?.close ?? 0;
  const sma10 = sma(benchmark, 10);
  const passed = close > sma10;
  return { gate: 'MARKET_ENVIRONMENT', passed, code: passed ? 'MARKET_GATE_OPEN' : 'ENTRY_BLOCKED_MARKET_GATE', evidence: { close, sma10, symbol: 'NIFTY_MIDSMALLCAP_400' } };
}

function evaluateCleanAction(candles: readonly DailyCandle[], start: number): GateResult {
  const area = candles.slice(start);
  const overlaps: number[] = [];
  let path = 0;
  for (let index = 1; index < area.length; index += 1) {
    const previous = area[index - 1];
    const current = area[index];
    if (!previous || !current) continue;
    const overlap = Math.max(0, Math.min(previous.high, current.high) - Math.max(previous.low, current.low));
    overlaps.push(overlap / Math.max(previous.high - previous.low, Number.EPSILON));
    path += Math.abs(current.close - previous.close);
  }
  const net = Math.abs((area.at(-1)?.close ?? 0) - (area[0]?.close ?? 0));
  const efficiency = path > 0 ? net / path : 0;
  const averageOverlap = overlaps.length > 0 ? mean(overlaps) : 0;
  const passed = efficiency <= 0.55 && averageOverlap >= 0.20;
  return { gate: 'CLEAN_ACTION', passed, code: passed ? 'CLEAN_ACTION_PASSED' : 'CLEAN_ACTION_FAILED', evidence: { efficiency, averageOverlap } };
}

function evaluateThrust(candles: readonly DailyCandle[], lowIndex: number, highIndex: number): GateResult {
  const duration = highIndex - lowIndex;
  const gain = (candles[highIndex]?.high ?? 0) / (candles[lowIndex]?.low ?? 1) - 1;
  const atr20 = atr(candles, 20, Math.max(21, highIndex));
  let wideRangeAdvanceDays = 0;
  for (let index = Math.max(lowIndex + 1, 21); index <= highIndex; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (candle && previous && candle.close > candle.open && candle.close > previous.close && trueRange(candle, previous.close) >= 1.25 * atr20) wideRangeAdvanceDays += 1;
  }
  const speed = duration > 0 ? gain / duration : 0;
  const passed = speed >= 0.004 && wideRangeAdvanceDays >= 1;
  return { gate: 'THRUST', passed, code: passed ? 'THRUST_PASSED' : 'THRUST_FAILED', evidence: { duration, gain, gainPerSession: speed, wideRangeAdvanceDays } };
}

export class SwingScreener {
  constructor(private readonly source: ScreenerDataSource, private readonly config: ScannerConfig) {}

  run(
    universe: UniverseMember[], benchmark: DailyCandle[], asOfDate?: string, allowStale = false,
    marketGateMode: MarketGateMode = 'REQUIRED', nearMissLimit = 20,
  ): ScanResult {
    const qc = this.source.getQc();
    const effectiveDate = asOfDate ?? qc.latestDate;
    const globalBlocks: string[] = [];
    if (qc.integrity !== 'ok') globalBlocks.push('BLOCKED_DATA_DATABASE_INTEGRITY');
    if (qc.invalidOhlcRows > 0) globalBlocks.push('DATA_WARNING_SOURCE_HAS_INVALID_OHLC');
    if (!allowStale && calendarAgeDays(effectiveDate) > this.config.maximumDataAgeCalendarDays) globalBlocks.push('BLOCKED_DATA_STALE');
    if (benchmark.length < 200) globalBlocks.push('BLOCKED_DATA_MIDSMALLCAP_BENCHMARK');
    const adjustmentPolicy = this.source.getCorporateActionPolicy?.();
    if (adjustmentPolicy?.status !== 'VERIFIED') globalBlocks.push('BLOCKED_DATA_ADJUSTMENT_POLICY_UNVERIFIED');

    const prepared: PreparedMember[] = universe.map((member) => {
      const candles = this.source.getDailyCandles(member.symbol, 340, effectiveDate);
      let relativeStrength: number | null = null;
      let sectorReturn: number | null = null;
      if (candles.length >= 252) {
        relativeStrength = weightedReturn(candles);
        const latest = candles.at(-1)?.close ?? 0;
        const prior = candles.at(-64)?.close ?? latest;
        sectorReturn = prior > 0 ? latest / prior - 1 : null;
      }
      return { member, candles, relativeStrength, sectorReturn };
    });
    const rsPopulation = prepared.flatMap((item) => item.relativeStrength === null ? [] : [item.relativeStrength]);
    const sectorReturns = new Map<string, number>();
    for (const industry of new Set(prepared.map((item) => item.member.industry))) {
      const values = prepared.filter((item) => item.member.industry === industry).flatMap((item) => item.sectorReturn === null ? [] : [item.sectorReturn]);
      if (values.length >= 2) sectorReturns.set(industry, [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0);
    }
    const sectorPopulation = [...sectorReturns.values()];
    const commonMarketGate = marketGate(benchmark.filter((candle) => candle.date <= effectiveDate));

    const candidates = prepared.map((item): CandidateResult => {
      const gates: GateResult[] = [];
      const dataGate = validateCandles(item.candles, this.config.minimumHistorySessions);
      gates.push(dataGate);
      const averageTradedValue = item.candles.length >= 20 ? mean(item.candles.slice(-20).map((candle) => candle.close * candle.volume)) : 0;
      const result: CandidateResult = {
        symbol: item.member.symbol, company: item.member.company, sector: item.member.industry, asOfDate: item.candles.at(-1)?.date ?? effectiveDate,
        status: 'REJECTED', score: 0, structuralRisk: null, rsPercentile: null, averageTradedValue, gates,
      };
      if (failed(dataGate)) return result;
      const liquidity = evaluateLiquidity(item.candles, this.config);
      gates.push(liquidity, commonMarketGate);
      if (failed(liquidity)) return result;
      const stage = evaluateStageTwo(item.candles, this.config.stageTwoMode ?? 'STRICT');
      gates.push(stage.gate);
      const rsPercentile = item.relativeStrength === null ? 0 : relativeStrengthPercentile(item.relativeStrength, rsPopulation);
      result.rsPercentile = rsPercentile;
      const rsSlope = relativeStrengthLineSlope(item.candles, benchmark, this.config.relativeStrengthSlopeSessions);
      const rsGate: GateResult = {
        gate: 'RELATIVE_STRENGTH', passed: rsPercentile >= this.config.relativeStrengthPercentile && rsSlope !== null && rsSlope > 0,
        code: rsPercentile >= this.config.relativeStrengthPercentile && rsSlope !== null && rsSlope > 0 ? 'RELATIVE_STRENGTH_PASSED' : 'RELATIVE_STRENGTH_FAILED',
        evidence: { percentile: rsPercentile, slope: rsSlope, requiredPercentile: this.config.relativeStrengthPercentile },
      };
      gates.push(rsGate);
      if (failed(stage.gate) || failed(rsGate)) return result;
      const tight = detectFinalTightArea(item.candles, this.config);
      gates.push(tight.gate);
      if (!tight.evidence) return result;
      result.tightArea = tight.evidence;
      const impulse = detectImpulse(item.candles, tight.evidence.startIndex, this.config);
      gates.push(impulse.gate);
      if (!impulse.evidence) return result;
      result.impulse = impulse.evidence;
      const accumulation = evaluateAccumulation(item.candles, impulse.evidence, this.config);
      const tightening = evaluateTightening(item.candles, impulse.evidence, tight.evidence, this.config);
      const cleanAction = evaluateCleanAction(item.candles, impulse.evidence.highIndex);
      const thrust = evaluateThrust(item.candles, impulse.evidence.lowIndex, impulse.evidence.highIndex);
      gates.push(accumulation, tightening, cleanAction, thrust);
      const sectorReturn = sectorReturns.get(item.member.industry);
      const sectorPercentile = sectorReturn === undefined ? null : percentileRank(sectorReturn, sectorPopulation);
      const sectorGate: GateResult = {
        gate: 'SECTOR_STRENGTH', passed: sectorPercentile !== null && sectorPercentile >= this.config.sectorPercentileThreshold,
        code: sectorPercentile !== null && sectorPercentile >= this.config.sectorPercentileThreshold ? 'SECTOR_STRENGTH_PASSED' : 'SECTOR_STRENGTH_FAILED',
        evidence: { industry: item.member.industry, return63: sectorReturn ?? null, percentile: sectorPercentile, threshold: this.config.sectorPercentileThreshold },
      };
      gates.push(sectorGate);
      const stop = tight.evidence.low - Math.max(0.1, tight.evidence.low * 0.001);
      const entry = tight.evidence.pivot;
      const structuralRisk = (entry - stop) / entry;
      result.structuralRisk = structuralRisk;
      const high52 = Math.max(...item.candles.slice(-252).map((candle) => candle.high));
      const perShareRisk = entry - stop;
      const targetR = perShareRisk > 0 ? entry * 0.25 / perShareRisk : 0;
      const chartRoomR = perShareRisk > 0 ? Math.max(0, high52 - entry) / perShareRisk : 0;
      const riskGate: GateResult = {
        gate: 'RISK_REWARD', passed: structuralRisk > 0 && structuralRisk <= this.config.maximumStructuralRisk && targetR >= 5 && chartRoomR >= 2,
        code: structuralRisk > 0 && structuralRisk <= this.config.maximumStructuralRisk && targetR >= 5 && chartRoomR >= 2 ? 'RISK_REWARD_PASSED' : 'INSUFFICIENT_REWARD_RISK',
        evidence: { entry, stop, structuralRisk, targetR, chartRoomR, high52Week: high52 },
      };
      gates.push(riskGate);
      const stockPass = [accumulation, tightening, cleanAction, thrust, sectorGate, riskGate].every((gate) => gate.passed);
      if (!stockPass) return result;
      if (!commonMarketGate.passed && marketGateMode === 'REQUIRED') return result;
      if (!commonMarketGate.passed && marketGateMode === 'WATCHLIST') {
        result.status = 'WAIT_MARKET';
        result.score = scoreCandidate(result);
        return result;
      }
      result.status = globalBlocks.some((code) => code.startsWith('BLOCKED_')) ? 'BLOCKED_DATA' : 'PASSED';
      result.score = scoreCandidate(result);
      return result;
    });

    for (const [index, candidate] of candidates.entries()) {
      const candles = prepared[index]?.candles ?? [];
      candidate.setupLabels = [];
      candidate.lowRiskScore = 0;
      if (candles.length >= 252) {
        candidate.setupEvidence = analyzeSetup(candles, candidate);
        candidate.setupLabels = classifySetup(candidate);
        candidate.lowRiskScore = scoreLowRiskSetup(candidate);
      }
      candidate.passedGateCount = candidate.gates.filter((gate) => gate.passed).length;
      candidate.evaluatedGateCount = candidate.gates.length;
      candidate.failedGateCodes = candidate.gates.filter((gate) => !gate.passed).map((gate) => gate.code);
    }
    const ranked = candidates.filter((candidate) => candidate.status !== 'REJECTED').sort(compareCandidates);
    const nearMisses = candidates
      .filter((candidate) => candidate.status === 'REJECTED'
        && candidate.gates.find((gate) => gate.gate === 'DATA_QUALITY')?.passed
        && candidate.gates.find((gate) => gate.gate === 'LIQUIDITY')?.passed)
      .sort((left, right) => (right.lowRiskScore ?? 0) - (left.lowRiskScore ?? 0)
        || (right.passedGateCount ?? 0) - (left.passedGateCount ?? 0)
        || (right.evaluatedGateCount ?? 0) - (left.evaluatedGateCount ?? 0)
        || (right.rsPercentile ?? 0) - (left.rsPercentile ?? 0)
        || right.averageTradedValue - left.averageTradedValue
        || left.symbol.localeCompare(right.symbol))
      .slice(0, nearMissLimit);
    return {
      scanId: crypto.createHash('sha256').update(`${this.config.version}|${effectiveDate}|${universe.map((item) => item.symbol).join(',')}`).digest('hex').slice(0, 16),
      configVersion: this.config.version, asOfDate: effectiveDate, generatedAt: new Date().toISOString(),
      universeSource: 'NSE_INDICES_NIFTY_MIDSMALLCAP_400_CURRENT', dataSource: this.source.sourcePath,
      universeCount: universe.length, evaluatedCount: candidates.length, passedCount: ranked.filter((candidate) => candidate.status === 'PASSED').length,
      blocked: globalBlocks, topCandidates: ranked.slice(0, this.config.topCandidates), nearMisses, candidates,
    };
  }
}
