/**
 * Market Regime Analysis Script
 * 
 * Fetches NIFTY 50, India VIX, NIFTY Bank daily + intraday data via KiteConnect.
 * Correlates with trade history from all 3 slots.
 * Outputs comprehensive market regime analysis.
 * 
 * Usage: node scripts/market-regime-analysis.js
 * Requires: Bot running on localhost:3000 with valid auth
 */

const { KiteConnect } = require('kiteconnect');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ===== INSTRUMENT TOKENS =====
const NIFTY_50_TOKEN = 256265;
const INDIA_VIX_TOKEN = 264969;
const NIFTY_BANK_TOKEN = 260105;

// ===== DATE RANGE =====
// Multi-stock era: Jan 28, 2026 – Mar 25, 2026
const FROM_DATE = '2026-01-26';
const TO_DATE = '2026-03-29';

async function main() {
  // Decrypt session from persisted auth (same logic as SessionPersistence.ts)
  const crypto = require('crypto');
  const sessionPath = path.join(__dirname, '..', 'data', 'auth', 'session.json');
  const sessionRaw = fs.readFileSync(sessionPath, 'utf8');
  const encryptedFile = JSON.parse(sessionRaw);
  
  const apiKey = process.env.ZERODHA_API_KEY || '';
  const apiSecret = process.env.ZERODHA_API_SECRET || '';
  const encryptionKey = crypto.createHash('sha256')
    .update(apiKey + apiSecret + 'trading_bot_session_key')
    .digest('hex');
  
  const iv = Buffer.from(encryptedFile.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedFile.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  const session = JSON.parse(decrypted);
  
  const kc = new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });
  kc.setAccessToken(session.accessToken);
  
  console.log('=== Market Regime Analysis ===');
  console.log(`Period: ${FROM_DATE} to ${TO_DATE}`);
  console.log('Fetching data...\n');

  // ===== FETCH ALL DATA =====
  const [niftyDaily, vixDaily, nifty5min, bankNiftyDaily] = await Promise.all([
    fetchWithRetry(() => kc.getHistoricalData(NIFTY_50_TOKEN, 'day', FROM_DATE, TO_DATE)),
    fetchWithRetry(() => kc.getHistoricalData(INDIA_VIX_TOKEN, 'day', FROM_DATE, TO_DATE)),
    fetchWithRetry(() => kc.getHistoricalData(NIFTY_50_TOKEN, '5minute', FROM_DATE, TO_DATE)),
    fetchWithRetry(() => kc.getHistoricalData(NIFTY_BANK_TOKEN, 'day', FROM_DATE, TO_DATE)),
  ]);
  
  console.log(`NIFTY daily candles: ${niftyDaily.length}`);
  console.log(`VIX daily candles: ${vixDaily.length}`);
  console.log(`NIFTY 5-min candles: ${nifty5min.length}`);
  console.log(`BankNIFTY daily candles: ${bankNiftyDaily.length}`);

  // ===== LOAD TRADES =====
  const trades = loadAllTrades();
  console.log(`Total trades loaded: ${trades.length}\n`);

  // ===== BUILD DAILY MARKET MAP =====
  const dailyMap = buildDailyMarketMap(niftyDaily, vixDaily, bankNiftyDaily, nifty5min);
  
  // ===== ENRICH TRADES WITH MARKET DATA =====
  const enrichedTrades = enrichTradesWithMarketData(trades, dailyMap);
  
  // ===== OUTPUT ANALYSIS =====
  console.log('========================================');
  console.log('     MARKET REGIME ANALYSIS REPORT');
  console.log('========================================\n');
  
  // 1. Daily Market Overview
  printDailyOverview(dailyMap);
  
  // 2. VIX Analysis
  analyzeVIX(enrichedTrades);
  
  // 3. Gap Analysis
  analyzeGap(enrichedTrades);
  
  // 4. ADR Analysis (Average Daily Range)
  analyzeADR(enrichedTrades);
  
  // 5. NIFTY Trend Analysis
  analyzeNiftyTrend(enrichedTrades, dailyMap);
  
  // 6. Intraday Range at Entry
  analyzeIntradayRange(enrichedTrades);
  
  // 7. Previous Day Patterns
  analyzePreviousDayPatterns(enrichedTrades, dailyMap);
  
  // 8. VIX Change Direction
  analyzeVIXChange(enrichedTrades);
  
  // 9. NIFTY Bollinger Band Width
  analyzeNiftyBBWidth(enrichedTrades, dailyMap);
  
  // 10. NIFTY RSI at Entry
  analyzeNiftyRSI(enrichedTrades, dailyMap);
  
  // 11. Multi-Factor Regime Classification
  classifyRegimes(enrichedTrades, dailyMap);
  
  // 12. Composite Summary
  printCompositeSummary(enrichedTrades, dailyMap);

  // Save enriched data for future reference
  const outputPath = path.join(__dirname, '..', 'data', 'market-regime-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({ dailyMap: Object.fromEntries(dailyMap), enrichedTrades, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\nFull data saved to: ${outputPath}`);
}

// ===== HELPER FUNCTIONS =====

async function fetchWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function loadAllTrades() {
  const trades = [];
  for (const slotNum of [1, 2, 3]) {
    const slotPath = path.join(__dirname, '..', 'src', 'data', `bollinger-slot${slotNum}.json`);
    const data = JSON.parse(fs.readFileSync(slotPath, 'utf8'));
    for (const t of data.tradeHistory) {
      trades.push({
        slot: slotNum,
        stock: t.instrument.name,
        direction: t.direction,
        pnl: Math.round(t.pnl),
        exitReason: t.exitReason,
        entryTime: new Date(t.entryTime),
        exitTime: new Date(t.exitTime),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        // IST date key
        dateKey: toISTDateKey(new Date(t.entryTime)),
        entryHourIST: new Date(new Date(t.entryTime).getTime() + 5.5 * 3600000).getHours(),
      });
    }
  }
  trades.sort((a, b) => a.entryTime - b.entryTime);
  return trades;
}

function toISTDateKey(dt) {
  const ist = new Date(dt.getTime() + 5.5 * 3600000);
  return ist.toISOString().split('T')[0]; // YYYY-MM-DD
}

function buildDailyMarketMap(niftyDaily, vixDaily, bankNiftyDaily, nifty5min) {
  const map = new Map();
  
  // Build NIFTY daily map
  for (let i = 0; i < niftyDaily.length; i++) {
    const d = niftyDaily[i];
    const dateKey = toISTDateKey(new Date(d.date));
    const prevDay = i > 0 ? niftyDaily[i - 1] : null;
    
    const dailyRange = d.high - d.low;
    const dailyRangePct = (dailyRange / d.open) * 100;
    const gapPct = prevDay ? ((d.open - prevDay.close) / prevDay.close) * 100 : 0;
    const dayReturn = ((d.close - d.open) / d.open) * 100;
    const fromPrevClose = prevDay ? ((d.close - prevDay.close) / prevDay.close) * 100 : 0;
    
    // Calculate 5-day, 10-day, 20-day moving averages of CLOSE
    const closes = niftyDaily.slice(Math.max(0, i - 19), i + 1).map(c => c.close);
    const sma5 = i >= 4 ? avg(niftyDaily.slice(i - 4, i + 1).map(c => c.close)) : null;
    const sma10 = i >= 9 ? avg(niftyDaily.slice(i - 9, i + 1).map(c => c.close)) : null;
    const sma20 = i >= 19 ? avg(niftyDaily.slice(i - 19, i + 1).map(c => c.close)) : null;
    
    // Calculate ADR (Average Daily Range) over last 14 days
    const last14 = niftyDaily.slice(Math.max(0, i - 13), i + 1);
    const adr = avg(last14.map(c => ((c.high - c.low) / c.open) * 100));
    
    // Calculate daily RSI(14)
    const rsi14 = calcRSI(niftyDaily.slice(0, i + 1).map(c => c.close), 14);
    
    // Calculate Bollinger Bands on daily close (20, 2)
    const bb = calcBB(niftyDaily.slice(0, i + 1).map(c => c.close), 20, 2);
    
    // Previous day metrics
    const prevDayRange = prevDay ? ((prevDay.high - prevDay.low) / prevDay.open) * 100 : null;
    const prevDayIsNarrow = prevDayRange !== null ? prevDayRange < adr * 0.7 : null; // NR day = range < 70% of ADR
    const prevDayIsWide = prevDayRange !== null ? prevDayRange > adr * 1.3 : null; // Wide day = range > 130% of ADR
    
    map.set(dateKey, {
      // NIFTY data
      niftyOpen: d.open,
      niftyHigh: d.high,
      niftyLow: d.low,
      niftyClose: d.close,
      niftyVolume: d.volume,
      dailyRange,
      dailyRangePct,
      gapPct,
      gapDirection: gapPct > 0.2 ? 'GAP_UP' : gapPct < -0.2 ? 'GAP_DOWN' : 'FLAT',
      dayReturn,
      dayDirection: dayReturn > 0.1 ? 'UP' : dayReturn < -0.1 ? 'DOWN' : 'FLAT',
      fromPrevClose,
      sma5, sma10, sma20,
      aboveSMA5: sma5 ? d.close > sma5 : null,
      aboveSMA10: sma10 ? d.close > sma10 : null,
      aboveSMA20: sma20 ? d.close > sma20 : null,
      adr,
      adrRatio: dailyRangePct / adr, // how today's range compares to ADR
      rsi14,
      bbWidth: bb ? bb.width : null,
      bbPctB: bb ? bb.pctB : null,
      prevDayRange,
      prevDayIsNarrow,
      prevDayIsWide,
      prevDayClose: prevDay ? prevDay.close : null,
      // VIX — filled below
      vixOpen: null, vixHigh: null, vixLow: null, vixClose: null,
      vixChange: null, vixLevel: null,
      // Bank NIFTY — filled below
      bankNiftyReturn: null,
    });
  }
  
  // Fill in VIX data
  for (const v of vixDaily) {
    const dateKey = toISTDateKey(new Date(v.date));
    if (map.has(dateKey)) {
      const entry = map.get(dateKey);
      entry.vixOpen = v.open;
      entry.vixHigh = v.high;
      entry.vixLow = v.low;
      entry.vixClose = v.close;
    }
  }
  
  // Calculate VIX change from previous day
  let prevVix = null;
  for (const [key, entry] of map) {
    if (entry.vixClose !== null) {
      if (prevVix !== null) {
        entry.vixChange = ((entry.vixClose - prevVix) / prevVix) * 100;
      }
      entry.vixLevel = entry.vixClose < 13 ? 'LOW' : entry.vixClose < 16 ? 'MODERATE' : entry.vixClose < 20 ? 'ELEVATED' : 'HIGH';
      prevVix = entry.vixClose;
    }
  }
  
  // Fill in Bank NIFTY
  for (const b of bankNiftyDaily) {
    const dateKey = toISTDateKey(new Date(b.date));
    if (map.has(dateKey)) {
      map.get(dateKey).bankNiftyReturn = ((b.close - b.open) / b.open) * 100;
    }
  }
  
  // Build 5-min intraday maps per date
  const intradayByDate = new Map();
  for (const c of nifty5min) {
    const dateKey = toISTDateKey(new Date(c.date));
    if (!intradayByDate.has(dateKey)) intradayByDate.set(dateKey, []);
    intradayByDate.get(dateKey).push(c);
  }
  
  // Calculate intraday metrics
  for (const [dateKey, candles] of intradayByDate) {
    if (!map.has(dateKey)) continue;
    const entry = map.get(dateKey);
    
    // Morning session range (first 30 min = 6 candles, 9:15-9:45 IST)
    const morningCandles = candles.slice(0, 6);
    if (morningCandles.length >= 6) {
      const morningHigh = Math.max(...morningCandles.map(c => c.high));
      const morningLow = Math.min(...morningCandles.map(c => c.low));
      entry.morningRangePct = ((morningHigh - morningLow) / morningCandles[0].open) * 100;
      entry.morningDirection = morningCandles[5].close > morningCandles[0].open ? 'UP' : 'DOWN';
    }
    
    // First hour range (12 candles, 9:15-10:15 IST) 
    const firstHourCandles = candles.slice(0, 12);
    if (firstHourCandles.length >= 12) {
      const fhHigh = Math.max(...firstHourCandles.map(c => c.high));
      const fhLow = Math.min(...firstHourCandles.map(c => c.low));
      entry.firstHourRangePct = ((fhHigh - fhLow) / firstHourCandles[0].open) * 100;
      entry.firstHourDirection = firstHourCandles[11].close > firstHourCandles[0].open ? 'UP' : 'DOWN';
    }
    
    // Calculate running high/low at each 5-min interval
    entry.intradayCandles = candles;
  }

  return map;
}

function enrichTradesWithMarketData(trades, dailyMap) {
  return trades.map(t => {
    const dayData = dailyMap.get(t.dateKey);
    if (!dayData) return { ...t, hasMarketData: false };
    
    // Find the NIFTY price at entry time
    let niftyAtEntry = dayData.niftyOpen;
    let rangePctAtEntry = 0;
    if (dayData.intradayCandles) {
      const entryIST = new Date(t.entryTime.getTime() + 5.5 * 3600000);
      const entryTimeStr = entryIST.toISOString();
      let runHigh = -Infinity, runLow = Infinity;
      for (const c of dayData.intradayCandles) {
        const candleIST = new Date(new Date(c.date).getTime() + 5.5 * 3600000);
        if (candleIST <= entryIST) {
          niftyAtEntry = c.close;
          runHigh = Math.max(runHigh, c.high);
          runLow = Math.min(runLow, c.low);
        }
      }
      if (runHigh > -Infinity) {
        rangePctAtEntry = ((runHigh - runLow) / dayData.niftyOpen) * 100;
      }
    }
    
    return {
      ...t,
      hasMarketData: true,
      // VIX
      vixClose: dayData.vixClose,
      vixLevel: dayData.vixLevel,
      vixChange: dayData.vixChange,
      // Gap
      gapPct: dayData.gapPct,
      gapDirection: dayData.gapDirection,
      // Range
      dailyRangePct: dayData.dailyRangePct,
      adr: dayData.adr,
      adrRatio: dayData.adrRatio,
      // Trend
      aboveSMA5: dayData.aboveSMA5,
      aboveSMA10: dayData.aboveSMA10,
      aboveSMA20: dayData.aboveSMA20,
      dayDirection: dayData.dayDirection,
      dayReturn: dayData.dayReturn,
      // RSI / BB
      rsi14: dayData.rsi14,
      bbWidth: dayData.bbWidth,
      bbPctB: dayData.bbPctB,
      // Previous day
      prevDayRange: dayData.prevDayRange,
      prevDayIsNarrow: dayData.prevDayIsNarrow,
      prevDayIsWide: dayData.prevDayIsWide,
      // Morning
      morningRangePct: dayData.morningRangePct,
      morningDirection: dayData.morningDirection,
      firstHourRangePct: dayData.firstHourRangePct,
      firstHourDirection: dayData.firstHourDirection,
      // At entry
      niftyAtEntry,
      rangePctAtEntry,
      // Bank NIFTY divergence
      bankNiftyReturn: dayData.bankNiftyReturn,
    };
  });
}

// ===== ANALYSIS FUNCTIONS =====

function printDailyOverview(dailyMap) {
  console.log('--- 1. DAILY MARKET OVERVIEW ---');
  console.log('Date       | NIFTY Close | Day%   | Gap%   | VIX    | ADR%   | RSI14  | BB%B');
  console.log('-'.repeat(90));
  for (const [date, d] of dailyMap) {
    if (!d.vixClose) continue;
    console.log(
      `${date} | ${d.niftyClose?.toFixed(0).padStart(10)} | ${fmtPct(d.dayReturn)} | ${fmtPct(d.gapPct)} | ${d.vixClose?.toFixed(2).padStart(6)} | ${d.adr?.toFixed(2).padStart(5)}% | ${d.rsi14?.toFixed(1).padStart(6)} | ${d.bbPctB?.toFixed(2).padStart(5)}`
    );
  }
  console.log('');
}

function analyzeVIX(trades) {
  console.log('--- 2. VIX LEVEL ANALYSIS ---');
  const withVix = trades.filter(t => t.vixClose !== null && t.hasMarketData);
  
  // VIX buckets: <13 (low), 13-16 (moderate), 16-20 (elevated), >20 (high)
  const buckets = [
    { label: 'VIX < 13 (Low Vol)', filter: t => t.vixClose < 13 },
    { label: 'VIX 13-16 (Moderate)', filter: t => t.vixClose >= 13 && t.vixClose < 16 },
    { label: 'VIX 16-20 (Elevated)', filter: t => t.vixClose >= 16 && t.vixClose < 20 },
    { label: 'VIX > 20 (High Vol)', filter: t => t.vixClose >= 20 },
  ];
  
  printBucketAnalysis(withVix, buckets);
  console.log('');
}

function analyzeGap(trades) {
  console.log('--- 3. GAP UP/DOWN ANALYSIS ---');
  const valid = trades.filter(t => t.hasMarketData && t.gapPct !== undefined);
  
  const buckets = [
    { label: 'Big Gap Down (<-0.5%)', filter: t => t.gapPct < -0.5 },
    { label: 'Small Gap Down (-0.5 to -0.2%)', filter: t => t.gapPct >= -0.5 && t.gapPct < -0.2 },
    { label: 'Flat Open (-0.2 to +0.2%)', filter: t => t.gapPct >= -0.2 && t.gapPct <= 0.2 },
    { label: 'Small Gap Up (+0.2 to +0.5%)', filter: t => t.gapPct > 0.2 && t.gapPct <= 0.5 },
    { label: 'Big Gap Up (>+0.5%)', filter: t => t.gapPct > 0.5 },
  ];
  
  printBucketAnalysis(valid, buckets);
  console.log('');
}

function analyzeADR(trades) {
  console.log('--- 4. ADR (Avg Daily Range) & RANGE ANALYSIS ---');
  const valid = trades.filter(t => t.hasMarketData && t.adr);
  
  // ADR ratio: today's range vs ADR
  const buckets = [
    { label: 'Narrow Day (range < 70% ADR)', filter: t => t.adrRatio < 0.7 },
    { label: 'Normal Day (70-130% ADR)', filter: t => t.adrRatio >= 0.7 && t.adrRatio <= 1.3 },
    { label: 'Wide Day (range > 130% ADR)', filter: t => t.adrRatio > 1.3 },
  ];
  
  printBucketAnalysis(valid, buckets);
  
  // ADR absolute levels
  console.log('\n  ADR Absolute Level:');
  const adrBuckets = [
    { label: 'ADR < 0.8%', filter: t => t.adr < 0.8 },
    { label: 'ADR 0.8-1.2%', filter: t => t.adr >= 0.8 && t.adr < 1.2 },
    { label: 'ADR > 1.2%', filter: t => t.adr >= 1.2 },
  ];
  printBucketAnalysis(valid, adrBuckets);
  console.log('');
}

function analyzeNiftyTrend(trades, dailyMap) {
  console.log('--- 5. NIFTY TREND (SMA POSITION) ---');
  const valid = trades.filter(t => t.hasMarketData && t.aboveSMA20 !== null);
  
  const buckets = [
    { label: 'Above SMA5+SMA10+SMA20 (Strong Up)', filter: t => t.aboveSMA5 && t.aboveSMA10 && t.aboveSMA20 },
    { label: 'Above SMA20 only (Weak Up)', filter: t => t.aboveSMA20 && (!t.aboveSMA5 || !t.aboveSMA10) },
    { label: 'Below SMA20 (Downtrend)', filter: t => !t.aboveSMA20 },
  ];
  
  printBucketAnalysis(valid, buckets);
  
  // By direction within trend
  console.log('\n  LONG trades vs NIFTY trend:');
  const longs = valid.filter(t => t.direction === 'LONG');
  const longBuckets = [
    { label: 'LONG + NIFTY above SMA20', filter: t => t.aboveSMA20 },
    { label: 'LONG + NIFTY below SMA20', filter: t => !t.aboveSMA20 },
  ];
  printBucketAnalysis(longs, longBuckets);
  
  console.log('\n  SHORT trades vs NIFTY trend:');
  const shorts = valid.filter(t => t.direction === 'SHORT');
  const shortBuckets = [
    { label: 'SHORT + NIFTY above SMA20', filter: t => t.aboveSMA20 },
    { label: 'SHORT + NIFTY below SMA20', filter: t => !t.aboveSMA20 },
  ];
  printBucketAnalysis(shorts, shortBuckets);
  console.log('');
}

function analyzeIntradayRange(trades) {
  console.log('--- 6. INTRADAY RANGE AT ENTRY ---');
  const valid = trades.filter(t => t.hasMarketData && t.rangePctAtEntry > 0);
  
  const buckets = [
    { label: 'Low range at entry (<0.5%)', filter: t => t.rangePctAtEntry < 0.5 },
    { label: 'Medium range at entry (0.5-1.0%)', filter: t => t.rangePctAtEntry >= 0.5 && t.rangePctAtEntry < 1.0 },
    { label: 'High range at entry (1.0-1.5%)', filter: t => t.rangePctAtEntry >= 1.0 && t.rangePctAtEntry < 1.5 },
    { label: 'Extreme range at entry (>1.5%)', filter: t => t.rangePctAtEntry >= 1.5 },
  ];
  
  printBucketAnalysis(valid, buckets);
  console.log('');
}

function analyzePreviousDayPatterns(trades, dailyMap) {
  console.log('--- 7. PREVIOUS DAY PATTERNS ---');
  const valid = trades.filter(t => t.hasMarketData && t.prevDayIsNarrow !== null);
  
  const buckets = [
    { label: 'After Narrow-Range Day (NR)', filter: t => t.prevDayIsNarrow },
    { label: 'After Normal-Range Day', filter: t => !t.prevDayIsNarrow && !t.prevDayIsWide },
    { label: 'After Wide-Range Day', filter: t => t.prevDayIsWide },
  ];
  
  printBucketAnalysis(valid, buckets);
  console.log('');
}

function analyzeVIXChange(trades) {
  console.log('--- 8. VIX CHANGE DIRECTION ---');
  const valid = trades.filter(t => t.hasMarketData && t.vixChange !== null);
  
  const buckets = [
    { label: 'VIX Falling (< -3%)', filter: t => t.vixChange < -3 },
    { label: 'VIX Stable (-3% to +3%)', filter: t => t.vixChange >= -3 && t.vixChange <= 3 },
    { label: 'VIX Rising (> +3%)', filter: t => t.vixChange > 3 },
    { label: 'VIX Spiking (> +8%)', filter: t => t.vixChange > 8 },
  ];
  
  printBucketAnalysis(valid, buckets);
  console.log('');
}

function analyzeNiftyBBWidth(trades, dailyMap) {
  console.log('--- 9. NIFTY DAILY BB WIDTH (Volatility Compression) ---');
  const valid = trades.filter(t => t.hasMarketData && t.bbWidth !== null);
  
  // Collect all BB widths for percentile calculation
  const allWidths = [...dailyMap.values()].filter(d => d.bbWidth).map(d => d.bbWidth).sort((a, b) => a - b);
  const p25 = allWidths[Math.floor(allWidths.length * 0.25)];
  const p50 = allWidths[Math.floor(allWidths.length * 0.50)];
  const p75 = allWidths[Math.floor(allWidths.length * 0.75)];
  
  console.log(`  BB Width quartiles: P25=${p25?.toFixed(2)}% P50=${p50?.toFixed(2)}% P75=${p75?.toFixed(2)}%`);
  
  const buckets = [
    { label: `Tight Squeeze (BB Width < ${p25?.toFixed(2)}%)`, filter: t => t.bbWidth < p25 },
    { label: `Normal (BB Width ${p25?.toFixed(2)}-${p75?.toFixed(2)}%)`, filter: t => t.bbWidth >= p25 && t.bbWidth <= p75 },
    { label: `Wide/Expanded (BB Width > ${p75?.toFixed(2)}%)`, filter: t => t.bbWidth > p75 },
  ];
  
  printBucketAnalysis(valid, buckets);
  console.log('');
}

function analyzeNiftyRSI(trades, dailyMap) {
  console.log('--- 10. NIFTY DAILY RSI(14) ---');
  const valid = trades.filter(t => t.hasMarketData && t.rsi14 !== null);
  
  const buckets = [
    { label: 'Oversold (RSI < 40)', filter: t => t.rsi14 < 40 },
    { label: 'Neutral-Low (RSI 40-50)', filter: t => t.rsi14 >= 40 && t.rsi14 < 50 },
    { label: 'Neutral-High (RSI 50-60)', filter: t => t.rsi14 >= 50 && t.rsi14 < 60 },
    { label: 'Overbought (RSI > 60)', filter: t => t.rsi14 >= 60 },
  ];
  
  printBucketAnalysis(valid, buckets);
  
  // By direction
  console.log('\n  LONG vs SHORT performance by RSI zone:');
  for (const dir of ['LONG', 'SHORT']) {
    const dirTrades = valid.filter(t => t.direction === dir);
    console.log(`  ${dir}:`);
    const dirBuckets = [
      { label: `  RSI < 45`, filter: t => t.rsi14 < 45 },
      { label: `  RSI 45-55`, filter: t => t.rsi14 >= 45 && t.rsi14 < 55 },
      { label: `  RSI > 55`, filter: t => t.rsi14 >= 55 },
    ];
    printBucketAnalysis(dirTrades, dirBuckets);
  }
  console.log('');
}

function classifyRegimes(trades, dailyMap) {
  console.log('--- 11. COMPOSITE MARKET REGIME CLASSIFICATION ---');
  console.log('Regimes based on: VIX + ADR + Day Direction + Gap\n');
  
  const valid = trades.filter(t => t.hasMarketData && t.vixClose !== null && t.adr);
  
  // Define regimes
  const regimes = [
    { 
      label: 'TRENDING-LOW-VOL: VIX<14, clear day direction, normal range',
      filter: t => t.vixClose < 14 && Math.abs(t.dayReturn) > 0.3 && t.adrRatio >= 0.7 && t.adrRatio <= 1.5
    },
    { 
      label: 'CHOPPY-LOW-VOL: VIX<14, flat day, narrow range',
      filter: t => t.vixClose < 14 && Math.abs(t.dayReturn) <= 0.3
    },
    { 
      label: 'TRENDING-HIGH-VOL: VIX>=14, clear direction, wide range',
      filter: t => t.vixClose >= 14 && Math.abs(t.dayReturn) > 0.3 && t.adrRatio > 1.0
    },
    { 
      label: 'CHOPPY-HIGH-VOL: VIX>=14, flat or whipsaw',
      filter: t => t.vixClose >= 14 && (Math.abs(t.dayReturn) <= 0.3 || t.adrRatio <= 1.0)
    },
  ];
  
  printBucketAnalysis(valid, regimes);
  
  // Morning-specific regimes
  console.log('\n  Morning Session Regimes:');
  const morningValid = valid.filter(t => t.morningRangePct);
  const morningRegimes = [
    { label: 'Calm Morning (range < 0.4%), LONG', filter: t => t.morningRangePct < 0.4 && t.direction === 'LONG' },
    { label: 'Calm Morning (range < 0.4%), SHORT', filter: t => t.morningRangePct < 0.4 && t.direction === 'SHORT' },
    { label: 'Volatile Morning (range > 0.8%), LONG', filter: t => t.morningRangePct > 0.8 && t.direction === 'LONG' },
    { label: 'Volatile Morning (range > 0.8%), SHORT', filter: t => t.morningRangePct > 0.8 && t.direction === 'SHORT' },
  ];
  printBucketAnalysis(morningValid, morningRegimes);
  console.log('');
}

function printCompositeSummary(trades, dailyMap) {
  console.log('========================================');
  console.log('     COMPOSITE SUMMARY');
  console.log('========================================\n');
  
  const valid = trades.filter(t => t.hasMarketData && t.vixClose !== null);
  
  // Find the "ideal" conditions
  console.log('BEST CONDITIONS (sorted by avg PnL):');
  const conditions = [
    { label: 'VIX < 13', filter: t => t.vixClose < 13 },
    { label: 'VIX 13-16', filter: t => t.vixClose >= 13 && t.vixClose < 16 },
    { label: 'VIX 16-20', filter: t => t.vixClose >= 16 && t.vixClose < 20 },
    { label: 'VIX > 20', filter: t => t.vixClose >= 20 },
    { label: 'Gap Down day', filter: t => t.gapPct < -0.2 },
    { label: 'Flat open day', filter: t => Math.abs(t.gapPct) <= 0.2 },
    { label: 'Gap Up day', filter: t => t.gapPct > 0.2 },
    { label: 'After NR day', filter: t => t.prevDayIsNarrow },
    { label: 'After Wide day', filter: t => t.prevDayIsWide },
    { label: 'NIFTY above all SMAs', filter: t => t.aboveSMA5 && t.aboveSMA10 && t.aboveSMA20 },
    { label: 'NIFTY below SMA20', filter: t => !t.aboveSMA20 },
    { label: 'RSI < 45', filter: t => t.rsi14 && t.rsi14 < 45 },
    { label: 'RSI > 55', filter: t => t.rsi14 && t.rsi14 > 55 },
    { label: 'VIX falling >3%', filter: t => t.vixChange && t.vixChange < -3 },
    { label: 'VIX rising >3%', filter: t => t.vixChange && t.vixChange > 3 },
    { label: 'Morning LONG + calm open', filter: t => t.direction === 'LONG' && t.morningRangePct && t.morningRangePct < 0.4 },
    { label: 'Morning SHORT + volatile open', filter: t => t.direction === 'SHORT' && t.morningRangePct && t.morningRangePct > 0.8 },
    { label: 'BB Width tight squeeze', filter: t => t.bbWidth && t.bbWidth < 3 },
    { label: 'BB Width wide expansion', filter: t => t.bbWidth && t.bbWidth > 5 },
  ];
  
  const results = conditions.map(c => {
    const subset = valid.filter(c.filter);
    const wins = subset.filter(t => t.pnl > 0).length;
    const totalPnl = subset.reduce((s, t) => s + t.pnl, 0);
    return {
      label: c.label,
      n: subset.length,
      wr: subset.length > 0 ? (wins / subset.length * 100).toFixed(1) : 'N/A',
      avgPnl: subset.length > 0 ? Math.round(totalPnl / subset.length) : 0,
      totalPnl: Math.round(totalPnl),
    };
  }).filter(r => r.n >= 3).sort((a, b) => b.avgPnl - a.avgPnl);
  
  console.log('Condition'.padEnd(40) + 'Trades'.padStart(7) + 'WR%'.padStart(7) + 'AvgPnL'.padStart(8) + 'TotalPnL'.padStart(10));
  console.log('-'.repeat(72));
  for (const r of results) {
    console.log(`${r.label.padEnd(40)}${String(r.n).padStart(7)}${String(r.wr + '%').padStart(7)}${String(r.avgPnl).padStart(8)}${String(r.totalPnl).padStart(10)}`);
  }
  
  // Per-date P&L with market conditions
  console.log('\n\nDAILY P&L WITH MARKET CONDITIONS:');
  console.log('Date       | VIX   | Gap%   | DayRet | ADR%  | RangRatio | Trades | PnL');
  console.log('-'.repeat(85));
  
  const tradesByDate = new Map();
  for (const t of valid) {
    if (!tradesByDate.has(t.dateKey)) tradesByDate.set(t.dateKey, []);
    tradesByDate.get(t.dateKey).push(t);
  }
  
  for (const [date, dateTrades] of [...tradesByDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    const d = dailyMap.get(date);
    if (!d) continue;
    const dayPnl = dateTrades.reduce((s, t) => s + t.pnl, 0);
    const marker = dayPnl > 1000 ? ' ✅' : dayPnl < -1000 ? ' ❌' : '';
    console.log(
      `${date} | ${(d.vixClose || 0).toFixed(1).padStart(5)} | ${fmtPct(d.gapPct)} | ${fmtPct(d.dayReturn)} | ${(d.adr || 0).toFixed(2).padStart(5)} | ${(d.adrRatio || 0).toFixed(2).padStart(9)} | ${String(dateTrades.length).padStart(6)} | ${String(Math.round(dayPnl)).padStart(7)}${marker}`
    );
  }
  console.log('');
}

// ===== UTILITY FUNCTIONS =====

function printBucketAnalysis(trades, buckets) {
  for (const b of buckets) {
    const subset = trades.filter(b.filter);
    const wins = subset.filter(t => t.pnl > 0).length;
    const losses = subset.length - wins;
    const totalPnl = subset.reduce((s, t) => s + t.pnl, 0);
    const avgPnl = subset.length > 0 ? Math.round(totalPnl / subset.length) : 0;
    const wr = subset.length > 0 ? (wins / subset.length * 100).toFixed(1) : 'N/A';
    const avgWin = wins > 0 ? Math.round(subset.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins) : 0;
    const avgLoss = losses > 0 ? Math.round(subset.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses) : 0;
    
    console.log(`  ${b.label}`);
    console.log(`    n=${subset.length}  WR=${wr}%  AvgPnL=₹${avgPnl}  Total=₹${Math.round(totalPnl)}  AvgWin=₹${avgWin}  AvgLoss=₹${avgLoss}`);
  }
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function calcRSI(closes, period) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcBB(closes, period, mult) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = avg(slice);
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  const width = ((upper - lower) / mean) * 100; // as percentage
  const pctB = std > 0 ? (closes[closes.length - 1] - lower) / (upper - lower) : 0.5;
  return { upper, lower, mean, width, pctB };
}

function fmtPct(val) {
  if (val === null || val === undefined) return '  N/A ';
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`.padStart(7);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
