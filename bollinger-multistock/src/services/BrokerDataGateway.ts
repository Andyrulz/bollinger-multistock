import express, { Request, Response } from 'express';
import { Server } from 'node:http';
import { AuthService } from './AuthService';
import { Logger } from '../utils/Logger';

export class BrokerDataGateway {
  private server: Server | undefined;
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private readonly kiteConnect: any,
    private readonly authService: AuthService,
    private readonly logger: Logger,
    private readonly port = Number(process.env.BROKER_DATA_GATEWAY_PORT || 3003),
  ) {}

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const app = express();
    app.use(express.json({ limit: '32kb' }));

    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'OK', authenticated: this.authService.isAuthenticated(), tradingOperations: false });
    });

    app.get('/auth/status', async (_req: Request, res: Response): Promise<void> => {
      const authenticated = this.authService.isAuthenticated()
        && await this.authService.isAuthenticatedAndValid();
      res.status(authenticated ? 200 : 401).json({ authenticated });
    });

    app.get('/instruments/:exchange', async (req: Request, res: Response): Promise<void> => {
      if (!await this.requireAuthentication(res)) return;
      const exchange = String(req.params.exchange || '').toUpperCase();
      if (!['NSE', 'BSE'].includes(exchange)) {
        res.status(400).json({ error: 'Unsupported exchange' });
        return;
      }
      try {
        const instruments = await this.withRateLimit(() => this.kiteConnect.getInstruments(exchange));
        res.json({ instruments });
      } catch (error) {
        this.handleBrokerError(res, 'Instrument request failed', error);
      }
    });

    app.get('/historical/:instrumentToken/day', async (req: Request, res: Response): Promise<void> => {
      if (!await this.requireAuthentication(res)) return;
      const instrumentToken = Number(req.params.instrumentToken);
      const from = this.parseDate(req.query.from);
      const to = this.parseDate(req.query.to);
      if (!Number.isInteger(instrumentToken) || instrumentToken <= 0 || !from || !to || from > to) {
        res.status(400).json({ error: 'Invalid historical-data request' });
        return;
      }
      try {
        const candles = await this.withRateLimit(() => this.kiteConnect.getHistoricalData(
          instrumentToken,
          'day',
          from,
          to,
          false,
          false,
        ));
        res.json({ candles });
      } catch (error) {
        this.handleBrokerError(res, 'Historical-data request failed', error);
      }
    });

    return new Promise((resolve, reject) => {
      const server = app.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        this.logger.info(`Read-only broker data gateway listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      server.once('error', reject);
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else {
          this.server = undefined;
          resolve();
        }
      });
    });
  }

  private async requireAuthentication(res: Response): Promise<boolean> {
    const authenticated = this.authService.isAuthenticated()
      && await this.authService.isAuthenticatedAndValid();
    if (!authenticated) res.status(401).json({ error: 'Zerodha session is not authenticated' });
    return authenticated;
  }

  private parseDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00+05:30`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.requestChain.then(async () => {
      const wait = Math.max(0, 350 - (Date.now() - this.lastRequestAt));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
      return operation();
    });
    this.requestChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private handleBrokerError(res: Response, message: string, error: any): void {
    const status = error?.error_type === 'TokenException' ? 401 : 502;
    this.logger.warn(`${message}: ${error?.message || error?.error_type || 'Unknown broker error'}`);
    res.status(status).json({ error: message, type: error?.error_type || 'BrokerError' });
  }
}
