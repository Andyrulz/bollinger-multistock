import { ApiServer } from './app/ApiServer';
import { ScannerService } from './app/ScannerService';

interface Arguments {
  command: string;
  allowStale: boolean;
  cachedUniverse: boolean;
  asOfDate?: string;
}

function parseArguments(argv: string[]): Arguments {
  const command = argv[0] ?? 'qc';
  const asOfIndex = argv.indexOf('--as-of');
  const asOfDate = asOfIndex >= 0 ? argv[asOfIndex + 1] : undefined;
  return {
    command,
    allowStale: argv.includes('--allow-stale'),
    cachedUniverse: argv.includes('--cached-universe'),
    ...(asOfDate ? { asOfDate } : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const scanner = new ScannerService();
  if (args.command === 'serve') {
    const server = new ApiServer(scanner);
    await server.start();
    const shutdown = async (): Promise<void> => {
      await server.stop();
      scanner.close();
    };
    process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
    process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
    return;
  }
  try {
    if (args.command === 'qc') {
      console.log(JSON.stringify({ mode: 'SCANNER_ONLY', tradingEnabled: false, database: scanner.getQc() }, null, 2));
      return;
    }
    if (args.command !== 'scan') throw new Error(`Unknown command: ${args.command}`);
    const result = await scanner.run({
      allowStale: args.allowStale,
      cachedUniverse: args.cachedUniverse,
      ...(args.asOfDate ? { asOfDate: args.asOfDate } : {}),
    });
    console.log(JSON.stringify({
      scanId: result.scanId, asOfDate: result.asOfDate, universe: result.universeCount,
      evaluated: result.evaluatedCount, passed: result.passedCount, ranked: result.topCandidates.length,
      blocked: result.blocked, benchmarkSource: result.benchmarkSource,
      topCandidates: result.topCandidates.map((candidate) => ({ symbol: candidate.symbol, score: candidate.score, status: candidate.status })),
    }, null, 2));
  } finally {
    scanner.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
