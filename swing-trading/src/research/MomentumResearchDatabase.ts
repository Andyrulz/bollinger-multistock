import Database from 'better-sqlite3';
import path from 'node:path';
import { DatabaseQc } from '../data/MomentumDatabaseAdapter';
import { DailyCandle, UniverseMember } from '../domain/types';

interface PriceRow extends DailyCandle {}
interface MonthlyMemberRow {
  symbol: string;
  company: string | null;
  industry: string | null;
  marketCap: number | null;
  rank: number;
}

export interface PointInTimeUniverse {
  requestedDate: string;
  snapshotMonth: string | null;
  totalRows: number;
  resolvedRows: number;
  members: UniverseMember[];
  unresolved: string[];
}

export interface ResearchDataAudit {
  integrity: string;
  prices: { rows: number; symbols: number; sessions: number; minimumDate: string; maximumDate: string };
  monthlyUniverse: { rows: number; symbols: number; months: number; minimumMonth: string; maximumMonth: string; minimumMembers: number; averageMembers: number; maximumMembers: number };
  referenceTables: { indexMembershipRows: number; marketCapSnapshotRows: number; symbolChanges: number; symbolMappings: number };
  benchmark: { symbol: string; rows: number; minimumDate: string; maximumDate: string } | null;
  survivorshipAssessment: string[];
}

function upperBound(candles: readonly DailyCandle[], date: string): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((candles[middle]?.date ?? '') <= date) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class MomentumResearchDatabase {
  private readonly database: Database.Database;
  private readonly candleCache = new Map<string, DailyCandle[]>();
  private readonly stockSymbols: Set<string>;
  private readonly stockIds: Map<string, number>;
  private readonly pricedSymbols: Set<string>;
  private readonly qc: DatabaseQc;
  readonly sourcePath: string;

  constructor(sourcePath = process.env.SWING_MOMENTUM_DB ?? './data/momentum.db') {
    this.sourcePath = path.resolve(sourcePath);
    this.database = new Database(this.sourcePath, { readonly: true, fileMustExist: true });
    this.database.pragma('query_only = ON');
    const stocks = this.database.prepare('SELECT id, symbol FROM stocks').all() as Array<{ id: number; symbol: string }>;
    this.stockSymbols = new Set(stocks.map((row) => row.symbol.toUpperCase()));
    this.stockIds = new Map(stocks.map((row) => [row.symbol.toUpperCase(), row.id]));
    this.pricedSymbols = new Set((this.database.prepare(`
      SELECT DISTINCT s.symbol FROM stocks s JOIN daily_prices p ON p.stock_id = s.id
    `).all() as Array<{ symbol: string }>).map((row) => row.symbol.toUpperCase()));
    this.qc = this.readQc();
  }

  close(): void {
    this.database.close();
  }

  getQc(): DatabaseQc {
    return this.qc;
  }

  getCorporateActionPolicy(): { status: 'INSUFFICIENT' } {
    return { status: 'INSUFFICIENT' };
  }

  getDailyCandles(symbol: string, limit: number, asOfDate?: string): DailyCandle[] {
    const candles = this.loadCandles(symbol);
    const end = asOfDate ? upperBound(candles, asOfDate) : candles.length;
    return candles.slice(Math.max(0, end - limit), end);
  }

  getForwardCandles(symbol: string, afterDate: string, sessions: number): DailyCandle[] {
    const candles = this.loadCandles(symbol);
    const start = upperBound(candles, afterDate);
    return candles.slice(start, start + sessions);
  }

  getIndexCandles(symbol: string, asOfDate?: string): DailyCandle[] {
    return this.database.prepare(`
      SELECT date, open, high, low, close, volume FROM index_prices
      WHERE symbol = ? ${asOfDate ? 'AND date <= ?' : ''} ORDER BY date
    `).all(...(asOfDate ? [symbol, asOfDate] : [symbol])) as DailyCandle[];
  }

  getTradingDates(from: string, to: string, frequency: 'WEEKLY' | 'MONTHLY' = 'WEEKLY'): string[] {
    const dates = this.database.prepare(`
      SELECT DISTINCT date FROM index_prices WHERE symbol = 'NIFTY500' AND date BETWEEN ? AND ? ORDER BY date
    `).all(from, to) as Array<{ date: string }>;
    const selected = new Map<string, string>();
    for (const row of dates) {
      const date = new Date(`${row.date}T00:00:00Z`);
      const key = frequency === 'MONTHLY'
        ? row.date.slice(0, 7)
        : `${date.getUTCFullYear()}-${String(this.isoWeek(date)).padStart(2, '0')}`;
      selected.set(key, row.date);
    }
    return [...selected.values()];
  }

  getPointInTimeUniverse(asOfDate: string, mode: 'TOP_500' | 'MIDSMALL_400' = 'MIDSMALL_400'): PointInTimeUniverse {
    const currentMonth = asOfDate.slice(0, 7);
    const snapshot = this.database.prepare(`
      SELECT MAX(year_month) AS month FROM market_cap_monthly WHERE year_month < ?
    `).get(currentMonth) as { month: string | null };
    if (!snapshot.month) return { requestedDate: asOfDate, snapshotMonth: null, totalRows: 0, resolvedRows: 0, members: [], unresolved: [] };

    const rows = this.database.prepare(`
      WITH ranked AS (
        SELECT m.symbol, s.name AS company, m.industry,
               m.market_cap_cr AS marketCap,
               ROW_NUMBER() OVER (ORDER BY m.market_cap_cr DESC, m.symbol) AS rank
        FROM market_cap_monthly m
        LEFT JOIN stocks s ON s.symbol = m.symbol COLLATE NOCASE
        WHERE m.year_month = ?
      )
      SELECT symbol, company, industry, marketCap, rank FROM ranked
      WHERE rank BETWEEN ? AND ? ORDER BY rank
    `).all(snapshot.month, mode === 'MIDSMALL_400' ? 101 : 1, mode === 'MIDSMALL_400' ? 500 : 500) as MonthlyMemberRow[];

    const members: UniverseMember[] = [];
    const unresolved: string[] = [];
    for (const row of rows) {
      const resolvedSymbol = this.resolveSymbol(row.symbol, asOfDate);
      if (!resolvedSymbol || !this.pricedSymbols.has(resolvedSymbol.toUpperCase())) {
        unresolved.push(row.symbol);
        continue;
      }
      members.push({
        symbol: resolvedSymbol,
        company: row.company ?? row.symbol,
        industry: row.industry?.trim() || 'UNKNOWN',
        series: 'EQ',
        isin: '',
      });
    }
    return {
      requestedDate: asOfDate,
      snapshotMonth: snapshot.month,
      totalRows: rows.length,
      resolvedRows: members.length,
      members,
      unresolved,
    };
  }

  audit(): ResearchDataAudit {
    const prices = this.database.prepare(`
      SELECT COUNT(*) AS rows, COUNT(DISTINCT stock_id) AS symbols, COUNT(DISTINCT date) AS sessions,
             MIN(date) AS minimumDate, MAX(date) AS maximumDate FROM daily_prices
    `).get() as ResearchDataAudit['prices'];
    const monthly = this.database.prepare(`
      SELECT (SELECT COUNT(*) FROM market_cap_monthly) AS rows,
             (SELECT COUNT(DISTINCT symbol) FROM market_cap_monthly) AS symbols,
             COUNT(*) AS months, MIN(year_month) AS minimumMonth, MAX(year_month) AS maximumMonth,
             MIN(memberCount) AS minimumMembers, ROUND(AVG(memberCount), 1) AS averageMembers, MAX(memberCount) AS maximumMembers
      FROM (SELECT year_month, COUNT(DISTINCT symbol) AS memberCount FROM market_cap_monthly GROUP BY year_month)
    `).get() as ResearchDataAudit['monthlyUniverse'];
    const references = this.database.prepare(`
      SELECT (SELECT COUNT(*) FROM index_membership) AS indexMembershipRows,
             (SELECT COUNT(*) FROM market_cap_snapshots) AS marketCapSnapshotRows,
             (SELECT COUNT(*) FROM symbol_changes) AS symbolChanges,
             (SELECT COUNT(*) FROM symbol_mappings) AS symbolMappings
    `).get() as ResearchDataAudit['referenceTables'];
    const benchmark = this.database.prepare(`
      SELECT symbol, COUNT(*) AS rows, MIN(date) AS minimumDate, MAX(date) AS maximumDate
      FROM index_prices WHERE symbol = 'NIFTY500' GROUP BY symbol
    `).get() as ResearchDataAudit['benchmark'];
    return {
      integrity: this.qc.integrity,
      prices,
      monthlyUniverse: monthly,
      referenceTables: references,
      benchmark: benchmark ?? null,
      survivorshipAssessment: [
        'Monthly market-cap snapshots provide a changing point-in-time universe from the prior completed month.',
        'Exact historical Nifty MidSmallcap 400 membership is unavailable because index_membership is empty.',
        'Delisted coverage cannot be proven complete; unresolved and missing-price members must remain explicit exclusions.',
        'Corporate-action adjustment semantics remain unverified; research results are provisional until discontinuity QC passes.',
      ],
    };
  }

  private loadCandles(symbol: string): DailyCandle[] {
    const key = symbol.toUpperCase();
    const cached = this.candleCache.get(key);
    if (cached) return cached;
    const stockId = this.stockIds.get(key);
    if (stockId === undefined) return [];
    const candles = this.database.prepare(`
      SELECT date, open, high, low, close, volume FROM daily_prices
      WHERE stock_id = ? ORDER BY date
    `).all(stockId) as PriceRow[];
    this.candleCache.set(key, candles);
    return candles;
  }

  private resolveSymbol(symbol: string, asOfDate: string): string | null {
    if (this.hasStock(symbol)) return symbol;
    const mapped = this.database.prepare(`
      SELECT new_symbol AS symbol FROM symbol_mappings
      WHERE old_symbol = ? COLLATE NOCASE AND (effective_date IS NULL OR effective_date <= ?)
      ORDER BY COALESCE(effective_date, '') DESC LIMIT 1
    `).get(symbol, asOfDate) as { symbol: string } | undefined;
    if (mapped && this.hasStock(mapped.symbol)) return mapped.symbol;
    const changed = this.database.prepare(`
      SELECT new_symbol AS symbol FROM symbol_changes
      WHERE old_symbol = ? COLLATE NOCASE AND change_date <= ? ORDER BY change_date DESC LIMIT 1
    `).get(symbol, asOfDate) as { symbol: string } | undefined;
    return changed && this.hasStock(changed.symbol) ? changed.symbol : null;
  }

  private hasStock(symbol: string): boolean {
    return this.stockSymbols.has(symbol.toUpperCase());
  }

  private readQc(): DatabaseQc {
    const integrity = this.database.pragma('quick_check', { simple: true }) as string;
    const summary = this.database.prepare(`
      SELECT MAX(date) AS latestDate, COUNT(DISTINCT stock_id) AS pricedSymbols FROM daily_prices
    `).get() as { latestDate: string; pricedSymbols: number };
    const invalid = this.database.prepare(`
      SELECT COUNT(*) AS count FROM daily_prices
      WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0 OR volume < 0
         OR low > high OR open < low OR open > high OR close < low OR close > high
    `).get() as { count: number };
    const duplicates = this.database.prepare(`
      SELECT COUNT(*) AS count FROM (SELECT stock_id, date FROM daily_prices GROUP BY stock_id, date HAVING COUNT(*) > 1)
    `).get() as { count: number };
    return { integrity, latestDate: summary.latestDate, pricedSymbols: summary.pricedSymbols, invalidOhlcRows: invalid.count, duplicateCandleKeys: duplicates.count };
  }

  private isoWeek(date: Date): number {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
    const start = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
    return Math.ceil((((copy.getTime() - start.getTime()) / 86_400_000) + 1) / 7);
  }
}
