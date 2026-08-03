import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SwingMarketDatabase } from '../../src/data/SwingMarketDatabase';
import { CandidateResult } from '../../src/domain/types';

const candidate: CandidateResult = {
  symbol: 'TEST', company: 'Test Limited', sector: 'Information Technology', asOfDate: '2026-07-17',
  status: 'REJECTED', score: 72, structuralRisk: 0.04, rsPercentile: 91, averageTradedValue: 50_000_000,
  gates: [], passedGateCount: 8, evaluatedGateCount: 10, failedGateCodes: ['TEST_GATE'],
  sectorQuadrant: 'IMPROVING', sectorRsRatio: 99.2, sectorMomentum: 102.4, sectorRotationDate: '2026-07-17',
};

describe('Watchlist persistence and transitions', () => {
  test('deduplicates, preserves Primary against scanner downgrade, persists details, and validates transitions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swing-watchlist-'));
    const databasePath = path.join(directory, 'market.db');
    let store = new SwingMarketDatabase(databasePath);
    try {
      expect(store.addToSecondary(candidate, 'scan-1', 'config-1').state).toBe('SECONDARY');
      expect(store.addToSecondary(candidate, 'scan-1', 'config-1').state).toBe('SECONDARY');
      expect(store.listWatchlist('SECONDARY')).toHaveLength(1);

      expect(store.transitionWatchlist('TEST', 'PRIMARY').state).toBe('PRIMARY');
      expect(store.addToSecondary({ ...candidate, score: 99 }, 'scan-2', 'config-2').state).toBe('PRIMARY');
      expect(store.updateWatchlistDetails('TEST', 'Wait for clean pivot', 5).priority).toBe(5);

      store.close();
      store = new SwingMarketDatabase(databasePath);
      expect(store.listWatchlist('PRIMARY')[0]?.notes).toBe('Wait for clean pivot');
      expect(store.transitionWatchlist('TEST', 'SECONDARY').state).toBe('SECONDARY');
      expect(store.transitionWatchlist('TEST', 'ARCHIVED').state).toBe('ARCHIVED');
      expect(() => store.transitionWatchlist('TEST', 'PRIMARY')).toThrow('Only a Secondary Watchlist entry');
      expect(store.getWatchlistStates()).toEqual({});
    } finally {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
