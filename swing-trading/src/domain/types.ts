export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UniverseMember {
  company: string;
  industry: string;
  symbol: string;
  series: string;
  isin: string;
}

export interface ScannerConfig {
  version: string;
  universeUrl: string;
  minimumPrice: number;
  minimumHistorySessions: number;
  minimumAverageTradedValue: number;
  relativeStrengthPercentile: number;
  relativeStrengthLookback: number;
  relativeStrengthSlopeSessions: number;
  impulseLookbackSessions: number;
  minimumImpulseGain: number;
  minimumAccumulationDays: number;
  minimumVolumeDominance: number;
  minimumTighteningSessions: number;
  maximumTighteningSessions: number;
  maximumTighteningDepth: number;
  minimumFinalTightAreaSessions: number;
  maximumFinalTightAreaSessions: number;
  maximumFinalTightAreaDepth: number;
  maximumPivotDistanceFromSma10: number;
  minimumUpperHalfCloses: number;
  maximumAtrContraction: number;
  requireVolumeContraction: boolean;
  requireRisingSma10: boolean;
  maximumStructuralRisk: number;
  sectorPercentileThreshold: number;
  maximumDataAgeCalendarDays: number;
  topCandidates: number;
  stageTwoMode?: StageTwoMode;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  code: string;
  evidence: Record<string, unknown>;
}

export interface ImpulseEvidence {
  lowIndex: number;
  highIndex: number;
  lowDate: string;
  highDate: string;
  low: number;
  high: number;
  gain: number;
}

export interface TightAreaEvidence {
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
  high: number;
  low: number;
  depth: number;
  pivot: number;
  sma10: number;
  pivotDistance: number;
  atrContraction: number;
  upperHalfCloses: number;
  volumeRatio: number;
}

export type StageTwoMode = 'LOW_RISK' | 'STRICT' | 'RESEARCH';

export type SetupLabel =
  | 'EARLY_TREND_TRANSITION'
  | 'BASE_BREAKOUT_RETEST'
  | 'POST_BREAKOUT_TIGHTNESS'
  | 'POST_52W_HIGH_CONTINUATION';

export interface SetupEvidence {
  close: number;
  high52Week: number;
  distanceFrom52WeekHigh: number;
  previous52WeekHigh: number;
  distanceFromPrevious52WeekHigh: number;
  abovePrevious52WeekHigh: boolean;
  sma10: number;
  sma20: number;
  sma50: number;
  sma200: number;
  aboveSma200: boolean;
  bullishShortMaOrder: boolean;
  risingSma10: boolean;
  risingSma20: boolean;
  risingSma50: boolean;
  risingSma200: boolean;
  unusualBullishVolumeEvents: number;
  maximumBullishVolumeRatio: number;
  defendedBullishFvgCount: number;
  recentBreakout: boolean;
  breakoutLevel: number | null;
  breakoutDate: string | null;
  breakoutRetest: boolean;
  evidenceSignals: string[];
}

export interface CandidateResult {
  symbol: string;
  company: string;
  sector: string;
  asOfDate: string;
  status: 'PASSED' | 'REJECTED' | 'BLOCKED_DATA' | 'WAIT_MARKET';
  score: number;
  structuralRisk: number | null;
  rsPercentile: number | null;
  averageTradedValue: number;
  gates: GateResult[];
  passedGateCount?: number;
  evaluatedGateCount?: number;
  failedGateCodes?: string[];
  sectorQuadrant?: SectorQuadrant;
  sectorRsRatio?: number;
  sectorMomentum?: number;
  sectorRotationDate?: string;
  watchlistState?: WatchlistState;
  impulse?: ImpulseEvidence;
  tightArea?: TightAreaEvidence;
  setupLabels?: SetupLabel[];
  setupEvidence?: SetupEvidence;
  lowRiskScore?: number;
}

export interface ScanResult {
  scanId: string;
  configVersion: string;
  asOfDate: string;
  generatedAt: string;
  universeSource: string;
  dataSource: string;
  universeCount: number;
  evaluatedCount: number;
  passedCount: number;
  blocked: string[];
  topCandidates: CandidateResult[];
  nearMisses: CandidateResult[];
  candidates: CandidateResult[];
}

export type MarketGateMode = 'REQUIRED' | 'WATCHLIST' | 'IGNORE';

export interface ScanParameters {
  stageTwoMode: StageTwoMode;
  minimumPrice: number;
  minimumAverageTradedValue: number;
  relativeStrengthPercentile: number;
  relativeStrengthSlopeSessions: number;
  minimumImpulseGain: number;
  minimumAccumulationDays: number;
  minimumVolumeDominance: number;
  maximumTighteningDepth: number;
  minimumFinalTightAreaSessions: number;
  maximumFinalTightAreaSessions: number;
  maximumFinalTightAreaDepth: number;
  maximumPivotDistanceFromSma10: number;
  minimumUpperHalfCloses: number;
  maximumAtrContraction: number;
  requireVolumeContraction: boolean;
  requireRisingSma10: boolean;
  maximumStructuralRisk: number;
  sectorPercentileThreshold: number;
  topCandidates: number;
  nearMissLimit: number;
  marketGateMode: MarketGateMode;
}

export type SectorQuadrant = 'LEADING' | 'WEAKENING' | 'LAGGING' | 'IMPROVING';

export interface SectorRotationPoint {
  date: string;
  ratio: number;
  momentum: number;
  quadrant: SectorQuadrant;
}

export interface SectorRotationTrail {
  sector: string;
  constituentCount: number;
  qualifiedCount: number;
  watchlistCount: number;
  current: SectorRotationPoint;
  previousQuadrant: SectorQuadrant | null;
  ratioChange: number;
  momentumChange: number;
  points: SectorRotationPoint[];
}

export interface SectorRotationResult {
  asOfDate: string | null;
  benchmark: string;
  mappingCoverage: { mapped: number; total: number; unmapped: string[] };
  methodology: {
    name: string;
    frequency: 'WEEKLY';
    ratioLookbackWeeks: number;
    momentumLookbackWeeks: number;
    trailWeeks: number;
    note: string;
  };
  sectors: SectorRotationTrail[];
}

export type WatchlistState = 'SECONDARY' | 'PRIMARY' | 'ARCHIVED';

export interface WatchlistEntry {
  symbol: string;
  company: string;
  sector: string;
  state: WatchlistState;
  priority: number;
  notes: string;
  sourceScanId: string;
  sourceScanDate: string;
  configVersion: string;
  candidate: CandidateResult;
  addedAt: string;
  promotedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}
