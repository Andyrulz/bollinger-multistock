import express, { Request, Response } from 'express';
import { Server } from 'node:http';
import { scanParametersSchema } from '../config/loadConfig';
import { z } from 'zod';
import { ScannerService } from './ScannerService';

export class ApiServer {
  private server?: Server;

  constructor(
    private readonly scanner: ScannerService,
    private readonly host = process.env.SWING_HOST || '127.0.0.1',
    private readonly port = Number(process.env.SWING_PORT || 3002),
  ) {}

  start(): Promise<void> {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '16kb' }));

    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'OK', mode: 'SCANNER_ONLY', tradingEnabled: false,
        running: this.scanner.isRunning(), dataSync: this.scanner.getSyncStatus(),
      });
    });

    app.get('/api/status', (_req: Request, res: Response) => {
      const latest = this.scanner.getLatest();
      res.json({
        serviceStatus: 'ONLINE',
        mode: 'SCANNER_ONLY',
        tradingEnabled: false,
        running: this.scanner.isRunning(),
        scan: this.scanner.getScanStatus(),
        latestScanId: latest?.scanId ?? null,
        latestScanTime: latest?.generatedAt ?? null,
        blocked: latest?.blocked ?? [],
        dataQuality: this.scanner.getQc(),
        dataSync: this.scanner.getSyncStatus(),
      });
    });

    app.get('/api/sync/status', (_req: Request, res: Response) => {
      res.json({ dataSync: this.scanner.getSyncStatus() });
    });

    app.get('/api/corporate-actions/qc', (_req: Request, res: Response) => {
      res.json({ tradingEnabled: false, policy: this.scanner.getCorporateActionPolicy() });
    });

    app.post('/api/corporate-actions/qc', async (_req: Request, res: Response): Promise<void> => {
      try {
        res.json({ tradingEnabled: false, policy: await this.scanner.runCorporateActionQc() });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Corporate-action QC failed' });
      }
    });

    app.get('/api/config', (_req: Request, res: Response) => {
      res.json(this.scanner.getScannerConfiguration());
    });

    app.get('/api/results/latest', (_req: Request, res: Response) => {
      const latest = this.scanner.getLatest();
      if (!latest) {
        res.json({
          serviceStatus: 'ONLINE', mode: 'SCANNER_ONLY', tradingEnabled: false,
          asOfDate: null, universeCount: 0, evaluatedCount: 0, passedCount: 0,
          blocked: ['NO_COMPLETED_SCAN'], topCandidates: [], nearMisses: [], candidates: [],
        });
        return;
      }
      const { candidates: _candidateEvidence, ...summary } = latest;
      res.json({ serviceStatus: 'ONLINE', mode: 'SCANNER_ONLY', tradingEnabled: false, ...summary });
    });

    app.get('/api/gates', (_req: Request, res: Response) => {
      res.json({ gates: this.scanner.getGateSummary() });
    });

    app.get('/api/sectors', (_req: Request, res: Response) => {
      res.json(this.scanner.getSectors());
    });

    app.get('/api/sectors/rotation', (req: Request, res: Response) => {
      const requested = Number(req.query.weeks ?? 8);
      const weeks = Number.isFinite(requested) ? Math.min(20, Math.max(4, Math.trunc(requested))) : 8;
      res.json(this.scanner.getSectorRotation(weeks));
    });

    app.get('/api/watchlists/status', (_req: Request, res: Response) => {
      res.json({ states: this.scanner.getWatchlistStates() });
    });

    app.get('/api/watchlists/:state', (req: Request, res: Response) => {
      try {
        const state = z.enum(['SECONDARY', 'PRIMARY', 'ARCHIVED']).parse((req.params.state ?? '').toUpperCase());
        res.json({ state, tradingEnabled: false, entries: this.scanner.getWatchlist(state) });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid watchlist state' });
      }
    });

    app.post('/api/watchlists/secondary/add', (req: Request, res: Response) => {
      try {
        const body = z.object({ symbols: z.array(z.string().trim().min(1).max(30)).min(1).max(100) }).strict().parse(req.body);
        res.json({ success: true, entries: this.scanner.addToSecondary(body.symbols) });
      } catch (error) {
        const notFound = error instanceof Error && error.message.includes('not found');
        res.status(notFound ? 404 : 400).json({ error: error instanceof Error ? error.message : 'Unable to add candidates' });
      }
    });

    app.post('/api/watchlists/:symbol/state', (req: Request, res: Response) => {
      try {
        const symbol = z.string().trim().min(1).max(30).parse(req.params.symbol);
        const body = z.object({ state: z.enum(['SECONDARY', 'PRIMARY', 'ARCHIVED']) }).strict().parse(req.body);
        res.json({ success: true, entry: this.scanner.transitionWatchlist(symbol, body.state) });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to transition watchlist entry' });
      }
    });

    app.post('/api/watchlists/:symbol/details', (req: Request, res: Response) => {
      try {
        const symbol = z.string().trim().min(1).max(30).parse(req.params.symbol);
        const body = z.object({ notes: z.string().max(2000), priority: z.number().int().min(0).max(5) }).strict().parse(req.body);
        res.json({ success: true, entry: this.scanner.updateWatchlistDetails(symbol, body.notes, body.priority) });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update watchlist entry' });
      }
    });

    app.post('/api/scan', async (req: Request, res: Response): Promise<void> => {
      try {
        const parameters = scanParametersSchema.parse(req.body?.parameters ?? this.scanner.getScannerConfiguration().defaults);
        const result = await this.scanner.run({ parameters });
        res.json({ serviceStatus: 'ONLINE', mode: 'SCANNER_ONLY', tradingEnabled: false, ...result });
      } catch (error) {
        const validation = error instanceof Error && error.name === 'ZodError';
        res.status(validation ? 400 : 500).json({ error: error instanceof Error ? error.message : 'Scanner failed' });
      }
    });

    return new Promise((resolve, reject) => {
      const server = app.listen(this.port, this.host, () => {
        this.server = server;
        console.log(`Swing scanner API listening on http://${this.host}:${this.port}`);
        resolve();
      });
      server.once('error', reject);
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
