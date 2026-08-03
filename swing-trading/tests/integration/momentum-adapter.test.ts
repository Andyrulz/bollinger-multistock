import fs from 'node:fs';
import path from 'node:path';
import { MomentumDatabaseAdapter } from '../../src/data/MomentumDatabaseAdapter';

const databasePath = path.resolve('./data/momentum.db');
const integration = fs.existsSync(databasePath) ? describe : describe.skip;

integration('momentum database read-only adapter', () => {
  test('passes integrity and key-quality checks', () => {
    const source = new MomentumDatabaseAdapter(databasePath);
    try {
      const qc = source.getQc();
      expect(qc.integrity).toBe('ok');
      expect(qc.duplicateCandleKeys).toBe(0);
      expect(qc.pricedSymbols).toBeGreaterThan(900);
    } finally {
      source.close();
    }
  });

  test('returns strictly ordered candles for an active symbol', () => {
    const source = new MomentumDatabaseAdapter(databasePath);
    try {
      const candles = source.getDailyCandles('RELIANCE', 260);
      expect(candles).toHaveLength(260);
      expect(candles.every((candle, index) => index === 0 || (candles[index - 1]?.date ?? '') < candle.date)).toBe(true);
    } finally {
      source.close();
    }
  });
});
