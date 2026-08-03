/**
 * Emergency script to create instruments cache without calling Zerodha API
 * Run this if you're rate-limited: npx ts-node scripts/create-instruments-cache.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Hardcoded common NSE instrument tokens (these are stable and rarely change)
const COMMON_INSTRUMENTS = {
  'TCS': 2953217,
  'INFY': 408065,
  'RELIANCE': 738561,
  'HDFCBANK': 341249,
  'ICICIBANK': 1270529,
  'SBIN': 779521,
  'BHARTIARTL': 2714625,
  'WIPRO': 969473,
  'ITC': 424961,
  'HINDUNILVR': 356865,
  'KOTAKBANK': 492033,
  'LT': 2939649,
  'AXISBANK': 1510401,
  'BAJFINANCE': 81153,
  'ASIANPAINT': 60417,
  'MARUTI': 2815745,
  'SUNPHARMA': 3001089,
  'TITAN': 897537,
  'NESTLEIND': 4598529,
  'ULTRACEMCO': 2952193,
  'TATASTEEL': 895745,
  'POWERGRID': 3834113,
  'NTPC': 2977281,
  'ONGC': 633601,
  'COALINDIA': 5215745,
  // Add more as needed...
};

async function createCache() {
  const cacheData = {
    timestamp: new Date().toISOString(),
    instruments: Object.entries(COMMON_INSTRUMENTS),
    note: 'Emergency cache created during rate limit'
  };

  const cachePath = path.join(__dirname, '..', 'data', 'instruments-cache.json');
  const cacheDir = path.dirname(cachePath);
  
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
  
  console.log(`✅ Created instruments cache with ${Object.keys(COMMON_INSTRUMENTS).length} instruments`);
  console.log(`📁 Location: ${cachePath}`);
  console.log('⚠️ NOTE: This is a limited cache. Once rate limit clears, scanner will fetch full list.');
}

createCache().catch(console.error);
