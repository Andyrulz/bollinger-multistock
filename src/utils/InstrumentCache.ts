/**
 * InstrumentCache - Automated daily caching for Zerodha NFO instruments
 * 
 * Benefits:
 * - Zero maintenance: Automatically fetches and caches daily
 * - Self-healing: If cache is corrupt, refetches from API
 * - Fast: Subsequent startups use cached data (milliseconds vs seconds)
 * - Clean: Auto-deletes old cache files
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

export class InstrumentCache {
  private static CACHE_DIR = path.join(__dirname, '../../data/cache');

  constructor(private kiteConnect: any, private logger: Logger) {
    // Ensure cache directory exists
    if (!fs.existsSync(InstrumentCache.CACHE_DIR)) {
      fs.mkdirSync(InstrumentCache.CACHE_DIR, { recursive: true });
    }
  }

  /**
   * Get NFO instruments with automated daily caching
   * 1. Check for 'instruments-nfo-YYYY-MM-DD.json'
   * 2. If exists -> Return cached data
   * 3. If missing -> Fetch API, Save JSON, Return
   */
  async getNFOInstruments(): Promise<any[]> {
    const today = new Date().toISOString().split('T')[0]; // "2026-01-26"
    const filePath = path.join(InstrumentCache.CACHE_DIR, `instruments-nfo-${today}.json`);

    // 1. Try Cache
    if (fs.existsSync(filePath)) {
      try {
        this.logger.info('📂 Loading NFO instruments from today\'s cache...');
        const rawData = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(rawData);
        // Important: Restore Date objects (JSON turns them to strings)
        const instruments = data.map((i: any) => ({ ...i, expiry: new Date(i.expiry) }));
        this.logger.info(`✅ Loaded ${instruments.length} instruments from cache`);
        return instruments;
      } catch (error) {
        this.logger.warn(`⚠️ Corrupt cache file, refetching: ${error}`);
        // Fallthrough to API fetch
      }
    }

    // 2. Fetch from API
    this.logger.info('⬇️ Fetching NFO instruments from Zerodha API...');
    const startTime = Date.now();
    const instruments = await this.kiteConnect.getInstruments('NFO');
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info(`✅ Fetched ${instruments.length} instruments in ${duration}s`);

    // 3. Save to Disk
    this.logger.info(`💾 Caching instruments to ${filePath}...`);
    fs.writeFileSync(filePath, JSON.stringify(instruments));

    // 4. Cleanup Old Cache (Fire and Forget)
    const todayStr = today;
    if (todayStr) {
      this.cleanupOldFiles(todayStr);
    }

    return instruments;
  }

  /**
   * Delete cache files that are NOT for today
   */
  private cleanupOldFiles(todayStr: string): void {
    fs.readdir(InstrumentCache.CACHE_DIR, (err, files) => {
      if (err) return;
      files.forEach(file => {
        if (file.startsWith('instruments-nfo-') && !file.includes(todayStr)) {
          const filePath = path.join(InstrumentCache.CACHE_DIR, file);
          fs.unlink(filePath, (unlinkErr) => {
            if (!unlinkErr) {
              this.logger.debug(`🗑️ Cleaned up old cache: ${file}`);
            }
          });
        }
      });
    });
  }
}
