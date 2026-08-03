import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MomentumDatabaseAdapter } from '../../src/data/MomentumDatabaseAdapter';
import { SwingMarketDatabase } from '../../src/data/SwingMarketDatabase';

const momentumPath = path.resolve('./data/momentum.db');
const integration = fs.existsSync(momentumPath) ? describe : describe.skip;

integration('Swing canonical market database', () => {
  test('bootstraps validated history and advances a persistent high-water mark', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swing-market-'));
    const databasePath = path.join(directory, 'market.db');
    const momentum = new MomentumDatabaseAdapter(momentumPath);
    const store = new SwingMarketDatabase(databasePath);
    try {
      const result = store.bootstrap([{
        symbol: 'RELIANCE', company: 'Reliance Industries', industry: 'Energy', series: 'EQ', isin: 'INE002A01018',
      }], momentum);
      expect(result.instruments).toBe(1);
      expect(result.candles).toBeGreaterThan(300);
      expect(store.getDailyCandles('RELIANCE', 340).length).toBeGreaterThanOrEqual(300);

      store.markSyncComplete('RELIANCE', '2026-07-17');
      expect(store.getLastSyncedDate('RELIANCE')).toBe('2026-07-17');
      expect(store.getQc().integrity).toBe('ok');

      store.saveCorporateAction({
        symbol: 'RELIANCE', isin: 'INE002A01018', exDate: '2026-06-01', type: 'BONUS',
        subject: 'Bonus 1:1', expectedPriceFactor: 0.5, cashAmount: null, source: 'NSE_OFFICIAL',
      });
      store.saveCorporateActionPolicy({
        status: 'VERIFIED', policy: 'KITE_CANONICAL_CONTINUITY', checkedAt: '2026-07-19T00:00:00.000Z',
        actionsChecked: 20, symbolsChecked: 20, structuralActions: 10, dividendsChecked: 10,
        canonicalMatches: 20, continuityPasses: 20, symbolsReconciled: 1, candlesReconciled: 340,
        failures: 0, minimumSymbolsRequired: 20, notes: ['fixture'],
      });
      expect(store.getCorporateActionPolicy()).toMatchObject({
        status: 'VERIFIED', actionsChecked: 20, failures: 0,
      });
    } finally {
      store.close();
      momentum.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});