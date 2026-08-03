import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultScanParameters, loadConfig, scannerPresets } from '../config/loadConfig';
import { MarketDataSyncResult, MarketDataSyncService } from '../data/MarketDataSyncService';
import { MomentumDatabaseAdapter } from '../data/MomentumDatabaseAdapter';
import { OfficialUniverseProvider } from '../data/OfficialUniverseProvider';
import { SwingMarketDatabase } from '../data/SwingMarketDatabase';
import { DailyCandle, ScanParameters, ScanResult, ScannerConfig, WatchlistState } from '../domain/types';
import { SwingScreener } from '../screener/SwingScreener';
import { enrichCandidatesWithSectorRotation, SectorRotationService } from '../sectors/SectorRotationService';
import { CorporateActionQcService } from '../data/CorporateActionQcService';

export interface ScanReport extends ScanResult {
  benchmarkSource: string;
  benchmarkWarning?: string;
  dataSync?: MarketDataSyncResult;
  scanParameters?: ScanParameters;
}

export interface GateSummary {
  gate: string;
  passed: number;
  failed: number;
}

export type ScanPhase = 'IDLE' | 'UNIVERSE' | 'DATA_SYNC' | 'SCREENING' | 'SECTOR_ROTATION' | 'SAVING' | 'COMPLETE' | 'FAILED';

export interface ScanRunStatus {
  running: boolean;
  phase: ScanPhase;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  scanId: string | null;
  previousScanId: string | null;
  asOfDate: string | null;
  resultsChanged: boolean | null;
  addedSymbols: string[];
  removedSymbols: string[];
  researchCount: number | null;
  qualifiedCount: number | null;
}

export class ScannerService {
  private readonly config = loadConfig();
  private readonly bootstrapSource = new MomentumDatabaseAdapter();
  private readonly source = new SwingMarketDatabase();
  private readonly synchronizer = new MarketDataSyncService(this.source, this.bootstrapSource);
  private readonly outputDirectory = path.resolve(process.env.SWING_OUTPUT_DIR ?? './data/scans');
  private latest?: ScanReport;
  private running?: Promise<ScanReport>;
  private scanStatus: ScanRunStatus = {
    running: false, phase: 'IDLE', message: 'Scanner idle', startedAt: null, completedAt: null,
    lastError: null, scanId: null, previousScanId: null, asOfDate: null, resultsChanged: null,
    addedSymbols: [], removedSymbols: [], researchCount: null, qualifiedCount: null,
  };

  constructor() {
    fs.mkdirSync(this.outputDirectory, { recursive: true });
    this.latest = this.loadLatestFromDisk();
  }

  close(): void {
    this.source.close();
    this.bootstrapSource.close();
  }

  getQc() {
    return this.source.getQc();
  }

  isRunning(): boolean {
    return this.running !== undefined;
  }

  getSyncStatus() {
    return this.synchronizer.getStatus();
  }

  getScanStatus(): ScanRunStatus {
    return { ...this.scanStatus, addedSymbols: [...this.scanStatus.addedSymbols], removedSymbols: [...this.scanStatus.removedSymbols] };
  }

  getScannerConfiguration() {
    return { defaults: defaultScanParameters(this.config), presets: scannerPresets(this.config) };
  }

  getCorporateActionPolicy() {
    return this.source.getCorporateActionPolicy();
  }

  async runCorporateActionQc() {
    const universe = this.source.getActiveUniverse();
    if (universe.length === 0) throw new Error('Canonical universe is empty; run market-data synchronization first');
    return new CorporateActionQcService(this.source).run(universe);
  }

  getSectors() {
    const universe = this.source.getActiveUniverse();
    const counts = new Map<string, number>();
    for (const member of universe) counts.set(member.industry || 'UNMAPPED', (counts.get(member.industry || 'UNMAPPED') ?? 0) + 1);
    return {
      mapped: universe.filter((member) => member.industry.trim().length > 0).length,
      total: universe.length,
      sectors: [...counts.entries()].map(([sector, constituentCount]) => ({ sector, constituentCount }))
        .sort((left, right) => right.constituentCount - left.constituentCount || left.sector.localeCompare(right.sector)),
    };
  }

  getSectorRotation(trailWeeks = 8) {
    const universe = this.source.getActiveUniverse();
    return new SectorRotationService(this.source).calculate(universe, this.latest?.asOfDate, trailWeeks, this.latest?.candidates ?? []);
  }

  getWatchlist(state: WatchlistState) {
    return this.source.listWatchlist(state);
  }

  getWatchlistStates() {
    return this.source.getWatchlistStates();
  }

  addToSecondary(symbols: string[]) {
    const latest = this.latest;
    if (!latest) throw new Error('Run the scanner before adding candidates to a watchlist');
    const candidates = new Map(latest.candidates.map((candidate) => [candidate.symbol, candidate]));
    return [...new Set(symbols)].map((symbol) => {
      const candidate = candidates.get(symbol);
      if (!candidate) throw new Error(`Candidate not found in latest scan: ${symbol}`);
      return this.source.addToSecondary(candidate, latest.scanId, latest.configVersion);
    });
  }

  transitionWatchlist(symbol: string, state: WatchlistState) {
    return this.source.transitionWatchlist(symbol, state);
  }

  updateWatchlistDetails(symbol: string, notes: string, priority: number) {
    return this.source.updateWatchlistDetails(symbol, notes, priority);
  }

  getLatest(): ScanReport | undefined {
    return this.latest;
  }

  getGateSummary(): GateSummary[] {
    const totals = new Map<string, GateSummary>();
    for (const candidate of this.latest?.candidates ?? []) {
      for (const gate of candidate.gates) {
        const total = totals.get(gate.gate) ?? { gate: gate.gate, passed: 0, failed: 0 };
        if (gate.passed) total.passed += 1;
        else total.failed += 1;
        totals.set(gate.gate, total);
      }
    }
    return [...totals.values()].sort((left, right) => left.gate.localeCompare(right.gate));
  }

  run(options: { allowStale?: boolean; cachedUniverse?: boolean; asOfDate?: string; parameters?: ScanParameters } = {}): Promise<ScanReport> {
    if (this.running) return this.running;
    const previous = this.latest;
    this.scanStatus = {
      running: true, phase: 'UNIVERSE', message: 'Refreshing official universe', startedAt: new Date().toISOString(),
      completedAt: null, lastError: null, scanId: null, previousScanId: previous?.scanId ?? null,
      asOfDate: null, resultsChanged: null, addedSymbols: [], removedSymbols: [], researchCount: null, qualifiedCount: null,
    };
    this.running = this.execute(options, previous).catch((error) => {
      this.scanStatus = {
        ...this.scanStatus, running: false, phase: 'FAILED', message: 'Scanner failed',
        completedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : 'Scanner failed',
      };
      throw error;
    }).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async execute(options: { allowStale?: boolean; cachedUniverse?: boolean; asOfDate?: string; parameters?: ScanParameters }, previous?: ScanReport): Promise<ScanReport> {
    const universe = await new OfficialUniverseProvider(this.config.universeUrl).load(!options.cachedUniverse);
    this.scanStatus = { ...this.scanStatus, phase: 'DATA_SYNC', message: 'Refreshing daily candles and benchmark' };
    const dataSync = await this.synchronizer.sync(universe);
    const qc = this.source.getQc();
    const asOfDate = options.asOfDate ?? qc.latestDate;
    const benchmark = await this.loadBenchmark(asOfDate);
    const parameters = options.parameters ?? defaultScanParameters(this.config);
    const { marketGateMode, nearMissLimit, ...configOverrides } = parameters;
    const parameterHash = crypto.createHash('sha256').update(JSON.stringify(parameters)).digest('hex').slice(0, 10);
    const runtimeConfig: ScannerConfig = { ...this.config, ...configOverrides, version: `${this.config.version}-${parameterHash}` };
    this.scanStatus = { ...this.scanStatus, phase: 'SCREENING', message: `Evaluating ${universe.length} stocks`, asOfDate };
    const result = new SwingScreener(this.source, runtimeConfig).run(
      universe,
      benchmark.candles,
      asOfDate,
      options.allowStale ?? false,
      marketGateMode,
      nearMissLimit,
    );
    this.scanStatus = { ...this.scanStatus, phase: 'SECTOR_ROTATION', message: 'Calculating sector rotation context' };
    const rotation = new SectorRotationService(this.source).calculate(universe, asOfDate, 8, result.candidates);
    enrichCandidatesWithSectorRotation(result.candidates, rotation);
    if (benchmark.warning && !result.blocked.includes('BLOCKED_DATA_MIDSMALLCAP_BENCHMARK_FALLBACK')) {
      result.blocked.push('BLOCKED_DATA_MIDSMALLCAP_BENCHMARK_FALLBACK');
    }
    if (dataSync.failedSymbols > 0 && !result.blocked.includes('BLOCKED_DATA_SYNC_INCOMPLETE')) {
      result.blocked.push('BLOCKED_DATA_SYNC_INCOMPLETE');
    }
    if (dataSync.phase === 'FAILED' && !result.blocked.includes('BLOCKED_DATA_SYNC_FAILED')) {
      result.blocked.push('BLOCKED_DATA_SYNC_FAILED');
    }
    const report: ScanReport = {
      ...result,
      benchmarkSource: benchmark.source,
      ...(benchmark.warning ? { benchmarkWarning: benchmark.warning } : {}),
      dataSync,
      scanParameters: parameters,
    };
    this.scanStatus = { ...this.scanStatus, phase: 'SAVING', message: 'Saving scan report' };
    fs.writeFileSync(path.join(this.outputDirectory, `${result.asOfDate}-${result.scanId}.json`), JSON.stringify(report, null, 2));
    this.latest = report;
    const previousSymbols = new Set((previous?.nearMisses ?? []).map((candidate) => candidate.symbol));
    const currentSymbols = new Set(report.nearMisses.map((candidate) => candidate.symbol));
    const addedSymbols = [...currentSymbols].filter((symbol) => !previousSymbols.has(symbol));
    const removedSymbols = [...previousSymbols].filter((symbol) => !currentSymbols.has(symbol));
    this.scanStatus = {
      ...this.scanStatus, running: false, phase: 'COMPLETE', message: 'Scan completed', completedAt: new Date().toISOString(),
      scanId: report.scanId, previousScanId: previous?.scanId ?? null, asOfDate: report.asOfDate,
      resultsChanged: previous ? addedSymbols.length > 0 || removedSymbols.length > 0 : true,
      addedSymbols, removedSymbols, researchCount: report.nearMisses.length, qualifiedCount: report.topCandidates.length,
    };
    return report;
  }

  private async loadBenchmark(asOfDate: string): Promise<{ candles: DailyCandle[]; source: string; warning?: string }> {
    const candles = this.source.getIndexCandles('NIFTY MIDSML 400', 340, asOfDate);
    if (candles.length >= 200) return { candles, source: 'SWING_MARKET_DB:NIFTY_MIDSML_400' };
    return {
      candles,
      source: 'SWING_MARKET_DB:NIFTY_MIDSML_400_INCOMPLETE',
      warning: `MidSmallcap 400 benchmark has only ${candles.length} canonical candles`,
    };
  }

  private loadLatestFromDisk(): ScanReport | undefined {
    const files = fs.readdirSync(this.outputDirectory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({ file, modified: fs.statSync(path.join(this.outputDirectory, file)).mtimeMs }))
      .sort((left, right) => right.modified - left.modified);
    const latest = files[0];
    if (!latest) return undefined;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.outputDirectory, latest.file), 'utf8')) as ScanReport;
    } catch {
      return undefined;
    }
  }
}
