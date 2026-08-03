import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/loadConfig';
import { MomentumResearchDatabase } from './MomentumResearchDatabase';
import { WalkForwardOptimizer } from './WalkForwardOptimizer';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function writeReport(prefix: string, report: unknown): string {
  const directory = path.resolve('./data/research');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

function auditCoverage(database: MomentumResearchDatabase): Record<string, unknown> {
  const dates = ['2018-08-31', '2020-03-31', '2022-06-30', '2024-01-31', '2026-02-28'];
  return Object.fromEntries(dates.map((date) => {
    const universe = database.getPointInTimeUniverse(date, 'MIDSMALL_400');
    return [date, {
      snapshotMonth: universe.snapshotMonth,
      expectedMembers: universe.totalRows,
      resolvedMembers: universe.resolvedRows,
      coverage: universe.totalRows > 0 ? universe.resolvedRows / universe.totalRows : 0,
      unresolved: universe.unresolved,
    }];
  }));
}

function main(): void {
  const command = process.argv[2] ?? 'audit';
  const database = new MomentumResearchDatabase();
  try {
    if (command === 'audit') {
      const report = { generatedAt: new Date().toISOString(), database: database.audit(), pointInTimeCoverage: auditCoverage(database) };
      const output = writeReport('data-audit', report);
      console.log(JSON.stringify({ output, ...report }, null, 2));
      return;
    }
    if (command !== 'optimize') throw new Error(`Unknown research command: ${command}`);
    const samples = positiveInteger('samples', 12);
    const seed = positiveInteger('seed', 20_260_721);
    const bootstrapPaths = positiveInteger('bootstrap-paths', 2_000);
    const frequencyValue = argument('frequency', 'MONTHLY').toUpperCase();
    if (frequencyValue !== 'WEEKLY' && frequencyValue !== 'MONTHLY') throw new Error('--frequency must be WEEKLY or MONTHLY');
    const optimizer = new WalkForwardOptimizer(database, loadConfig());
    const report = optimizer.run({
      from: argument('from', '2018-08-01'),
      to: argument('to', '2026-02-28'),
      samples,
      seed,
      frequency: frequencyValue,
      bootstrapPaths,
    });
    const output = writeReport('optimization', report);
    console.log(JSON.stringify({ output, evaluatedSets: report.evaluatedSets, finalists: report.finalists, warnings: report.warnings }, null, 2));
  } finally {
    database.close();
  }
}

main();
