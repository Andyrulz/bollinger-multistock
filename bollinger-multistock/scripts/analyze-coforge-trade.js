#!/usr/bin/env node
/**
 * Post-Trade Analysis: COFORGE26APR1180CE LONG (April 2, 2026)
 * 
 * Run from dist/ directory on the VM:
 *   cd ~/tradebot-bollinger && node scripts/analyze-coforge-trade.js
 * 
 * Uses the bot's encrypted session to fetch:
 * - COFORGE stock 5-min candles (full day)
 * - COFORGE26APR1180CE option 1-min, 5-min, 15-min candles
 * - Calculates RSI(14) on all timeframes
 * - Reconstructs what the system would have done vs manual exit
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { KiteConnect } = require('kiteconnect');

// ── Config ──────────────────────────────────────────────────────────
const STOCK_TOKEN = 2955009;        // COFORGE NSE
const OPTION_TOKEN = 24187906;      // COFORGE26APR1180CE
const TRADE_DATE = '2026-04-02';
const ENTRY_TIME = '2026-04-02T07:35:07.409Z';  // UTC
const ENTRY_PRICE = 63.85;
const EXIT_PRICE = 86.75;
const EXIT_TIME = '2026-04-02T08:50:38.000Z';   // UTC (manual exit)
const QUANTITY = 375;
const LOT_SIZE = 375;

// ── RSI Calculation (Wilder's RMA, matches TradingView) ─────────────
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  
  const results = [];
  
  // First RSI: simple average of gains/losses
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  
  // Pad with nulls for periods without enough data
  for (let i = 0; i < period; i++) {
    results.push(null);
  }
  
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  results.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
  
  // Subsequent RSIs: Wilder's smoothing (RMA)
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    results.push(rsi);
  }
  
  return results;
}

// ── Supertrend Calculation ──────────────────────────────────────────
function calculateSupertrend(candles, period = 10, multiplier = 2.0) {
  if (candles.length < period + 1) return [];
  
  // Calculate True Range and ATR
  const tr = [0];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i-1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  
  // ATR using RMA
  const atr = new Array(candles.length).fill(0);
  let atrSum = 0;
  for (let i = 1; i <= period; i++) atrSum += tr[i];
  atr[period] = atrSum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period;
  }
  
  // Supertrend
  const results = new Array(candles.length).fill(null);
  let prevFinalUB = 0, prevFinalLB = 0, prevST = 0, prevTrend = 1;
  
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUB = hl2 + multiplier * atr[i];
    const basicLB = hl2 - multiplier * atr[i];
    
    const finalUB = (basicUB < prevFinalUB || candles[i-1].close > prevFinalUB) ? basicUB : prevFinalUB;
    const finalLB = (basicLB > prevFinalLB || candles[i-1].close < prevFinalLB) ? basicLB : prevFinalLB;
    
    let trend;
    if (prevST === prevFinalUB) {
      trend = candles[i].close > finalUB ? 1 : -1;
    } else {
      trend = candles[i].close < finalLB ? -1 : 1;
    }
    
    const st = trend === 1 ? finalLB : finalUB;
    
    results[i] = { value: st, trend: trend === 1 ? 'UP' : 'DOWN' };
    prevFinalUB = finalUB;
    prevFinalLB = finalLB;
    prevST = st;
    prevTrend = trend;
  }
  
  return results;
}

// ── Bollinger Bands ─────────────────────────────────────────────────
function calculateBB(closes, period = 20, stdDev = 2.0) {
  const results = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { results.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    results.push({ upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd, bandwidth: (4 * stdDev * sd / mean) * 100 });
  }
  return results;
}

// ── Session Decryption ──────────────────────────────────────────────
function decryptSession() {
  const apiKey = process.env.ZERODHA_API_KEY;
  const apiSecret = process.env.ZERODHA_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('Missing ZERODHA_API_KEY or ZERODHA_API_SECRET in .env');
  
  const encKey = crypto.createHash('sha256')
    .update(apiKey + apiSecret + 'trading_bot_session_key')
    .digest('hex').slice(0, 32);
  
  // Try multiple session file locations
  const possiblePaths = [
    path.join(__dirname, '../data/auth/session.json'),
    path.join(__dirname, '../dist/data/auth/session.json'),
  ];
  
  let sessionFile;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      sessionFile = JSON.parse(fs.readFileSync(p, 'utf8'));
      console.log(`📁 Session loaded from: ${p}`);
      break;
    }
  }
  if (!sessionFile) throw new Error('No session.json found');
  
  const iv = Buffer.from(sessionFile.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encKey), iv);
  let decrypted = decipher.update(sessionFile.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  const parsed = JSON.parse(decrypted);
  // SessionPersistence uses 'accessToken' (camelCase), KiteConnect uses 'access_token'
  return { access_token: parsed.accessToken || parsed.access_token, api_key: apiKey };
}

// ── Time Helpers ────────────────────────────────────────────────────
function toIST(date) {
  return new Date(date).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Main Analysis ───────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  COFORGE LONG TRADE ANALYSIS — April 2, 2026');
  console.log('  COFORGE26APR1180CE | Entry: ₹63.85 | Manual Exit: ₹86.75');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Decrypt session and connect
  const session = decryptSession();
  const kc = new KiteConnect({ api_key: session.api_key });
  kc.setAccessToken(session.access_token);
  console.log('✅ KiteConnect authenticated\n');
  
  const from = `${TRADE_DATE} 09:15:00`;
  const to = `${TRADE_DATE} 15:30:00`;
  
  // Fetch all data in parallel
  console.log('📥 Fetching historical data...');
  const [stock5m, option5m, option1m, option15m] = await Promise.all([
    kc.getHistoricalData(STOCK_TOKEN, '5minute', from, to),
    kc.getHistoricalData(OPTION_TOKEN, '5minute', from, to),
    kc.getHistoricalData(OPTION_TOKEN, 'minute', from, to),
    kc.getHistoricalData(OPTION_TOKEN, '15minute', from, to),
  ]);
  
  console.log(`  Stock 5min: ${stock5m.length} candles`);
  console.log(`  Option 5min: ${option5m.length} candles`);
  console.log(`  Option 1min: ${option1m.length} candles`);
  console.log(`  Option 15min: ${option15m.length} candles\n`);
  
  // ── Calculate indicators on stock 5-min ──
  const stockCloses = stock5m.map(c => c.close);
  const stockRSIs = calculateRSI(stockCloses, 10); // Stock uses RSI(10)
  const stockSTs = calculateSupertrend(stock5m, 10, 2.0);
  const stockBBs = calculateBB(stockCloses, 20, 2.0);
  
  // ── Calculate RSI on option timeframes ──
  const opt5mCloses = option5m.map(c => c.close);
  const opt1mCloses = option1m.map(c => c.close);
  const opt15mCloses = option15m.map(c => c.close);
  const optRSI5m = calculateRSI(opt5mCloses);   // RSI(14) on 5-min option
  const optRSI1m = calculateRSI(opt1mCloses);   // RSI(14) on 1-min option
  const optRSI15m = calculateRSI(opt15mCloses); // RSI(14) on 15-min option
  
  // ── Print Raw Data: Stock 5-min ──
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COFORGE STOCK — 5-Minute Candles                                                                 ║');
  console.log('╠══════════╦══════════╦══════════╦══════════╦══════════╦════════╦═══════════╦══════════╦══════════════╣');
  console.log('║   Time   ║   Open   ║   High   ║    Low   ║  Close   ║ Volume ║ RSI(10)   ║ SuperT   ║   BB Band    ║');
  console.log('╠══════════╬══════════╬══════════╬══════════╬══════════╬════════╬═══════════╬══════════╬══════════════╣');
  
  const entryTimeMs = new Date(ENTRY_TIME).getTime();
  const exitTimeMs = new Date(EXIT_TIME).getTime();
  
  for (let i = 0; i < stock5m.length; i++) {
    const c = stock5m[i];
    const t = toIST(c.date);
    const candleMs = new Date(c.date).getTime();
    const rsi = stockRSIs[i] !== null ? stockRSIs[i].toFixed(1).padStart(5) : '  N/A';
    const st = stockSTs[i] ? stockSTs[i].value.toFixed(1).padStart(7) + (stockSTs[i].trend === 'UP' ? '↑' : '↓') : '     N/A';
    const bb = stockBBs[i] ? `U:${stockBBs[i].upper.toFixed(0)} M:${stockBBs[i].middle.toFixed(0)} L:${stockBBs[i].lower.toFixed(0)}` : 'N/A';
    
    let marker = '';
    if (candleMs >= entryTimeMs - 300000 && candleMs <= entryTimeMs) marker = ' ◄ ENTRY';
    if (candleMs >= exitTimeMs - 300000 && candleMs <= exitTimeMs) marker = ' ◄ EXIT';
    
    console.log(`║  ${t}  ║ ${String(c.open).padStart(7)} ║ ${String(c.high).padStart(7)} ║ ${String(c.low).padStart(7)} ║ ${String(c.close).padStart(7)} ║ ${String(c.volume).padStart(6)} ║  ${rsi}    ║ ${st} ║ ${bb.padEnd(12)} ║${marker}`);
  }
  console.log('╚══════════╩══════════╩══════════╩══════════╩══════════╩════════╩═══════════╩══════════╩══════════════╝\n');
  
  // ── Print Raw Data: Option 5-min ──
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COFORGE26APR1180CE OPTION — 5-Minute Candles                                           ║');
  console.log('╠══════════╦══════════╦══════════╦══════════╦══════════╦════════╦═══════════╦══════════════╣');
  console.log('║   Time   ║   Open   ║   High   ║    Low   ║  Close   ║ Volume ║ RSI(14)   ║   P&L from   ║');
  console.log('║          ║          ║          ║          ║          ║        ║  5-min    ║   ₹63.85     ║');
  console.log('╠══════════╬══════════╬══════════╬══════════╬══════════╬════════╬═══════════╬══════════════╣');
  
  for (let i = 0; i < option5m.length; i++) {
    const c = option5m[i];
    const t = toIST(c.date);
    const candleMs = new Date(c.date).getTime();
    const rsi = optRSI5m[i] !== null ? optRSI5m[i].toFixed(1).padStart(5) : '  N/A';
    const pnl = ((c.close - ENTRY_PRICE) * QUANTITY).toFixed(0);
    const pnlStr = (pnl >= 0 ? '+' : '') + pnl;
    
    let marker = '';
    if (candleMs >= entryTimeMs - 300000 && candleMs <= entryTimeMs) marker = ' ◄ ENTRY';
    if (candleMs >= exitTimeMs - 300000 && candleMs <= exitTimeMs) marker = ' ◄ EXIT';
    
    console.log(`║  ${t}  ║ ${String(c.open).padStart(7)} ║ ${String(c.high).padStart(7)} ║ ${String(c.low).padStart(7)} ║ ${String(c.close).padStart(7)} ║ ${String(c.volume).padStart(6)} ║  ${rsi}    ║ ${pnlStr.padStart(12)} ║${marker}`);
  }
  console.log('╚══════════╩══════════╩══════════╩══════════╩══════════╩════════╩═══════════╩══════════════╝\n');
  
  // ── Print Raw Data: Option 15-min ──
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COFORGE26APR1180CE OPTION — 15-Minute Candles (Gamma Climax RSI check)  ║');
  console.log('╠══════════╦══════════╦══════════╦══════════╦══════════╦════════╦═══════════╣');
  console.log('║   Time   ║   Open   ║   High   ║    Low   ║  Close   ║ Volume ║ RSI(14)   ║');
  console.log('╠══════════╬══════════╬══════════╬══════════╬══════════╬════════╬═══════════╣');
  
  for (let i = 0; i < option15m.length; i++) {
    const c = option15m[i];
    const t = toIST(c.date);
    const rsi = optRSI15m[i] !== null ? optRSI15m[i].toFixed(1).padStart(5) : '  N/A';
    let marker = '';
    if (optRSI15m[i] !== null && optRSI15m[i] >= 85) marker = ' 🔥 GAMMA CLIMAX!';
    else if (optRSI15m[i] !== null && optRSI15m[i] >= 80) marker = ' ⚠️  NEAR CLIMAX';
    
    console.log(`║  ${t}  ║ ${String(c.open).padStart(7)} ║ ${String(c.high).padStart(7)} ║ ${String(c.low).padStart(7)} ║ ${String(c.close).padStart(7)} ║ ${String(c.volume).padStart(6)} ║  ${rsi}    ║${marker}`);
  }
  console.log('╚══════════╩══════════╩══════════╩══════════╩══════════╩════════╩═══════════╝\n');
  
  // ── Option 1-min RSI Timeline (around trade window) ──
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  COFORGE26APR1180CE — 1-Minute RSI(14) Timeline (1:00 PM → 3:30 PM) ║');
  console.log('╠══════════╦══════════╦══════════╦═══════════╦═════════════════════════╣');
  console.log('║   Time   ║  Close   ║   High   ║ RSI(14)   ║  Signal                 ║');
  console.log('╠══════════╬══════════╬══════════╬═══════════╬═════════════════════════╣');
  
  for (let i = 0; i < option1m.length; i++) {
    const c = option1m[i];
    const candleMs = new Date(c.date).getTime();
    // Only show from 12:55 PM IST onwards (trade window)
    const cutoff = new Date('2026-04-02T07:25:00.000Z').getTime(); // 12:55 PM IST
    if (candleMs < cutoff) continue;
    
    const t = toIST(c.date);
    const rsi = optRSI1m[i] !== null ? optRSI1m[i].toFixed(1).padStart(5) : '  N/A';
    
    let signal = '';
    if (optRSI1m[i] !== null) {
      if (optRSI1m[i] >= 85) signal = '🔥 RSI >= 85 (TRAIL TRIGGER)';
      else if (optRSI1m[i] >= 80) signal = '⚠️  RSI >= 80';
      else if (optRSI1m[i] >= 75) signal = '📈 RSI >= 75';
      else if (optRSI1m[i] <= 30) signal = '📉 RSI <= 30 (oversold)';
    }
    if (candleMs >= entryTimeMs - 60000 && candleMs <= entryTimeMs) signal += ' ◄ ENTRY';
    if (candleMs >= exitTimeMs - 60000 && candleMs <= exitTimeMs) signal += ' ◄ EXIT';
    
    console.log(`║  ${t}  ║ ${String(c.close).padStart(7)} ║ ${String(c.high).padStart(7)} ║  ${rsi}    ║ ${signal.padEnd(23)} ║`);
  }
  console.log('╚══════════╩══════════╩══════════╩═══════════╩═════════════════════════╝\n');
  
  // ── Key Post-Exit Analysis ──
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  POST-EXIT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Find option high after exit, and where it eventually went
  const exitIdx5m = option5m.findIndex(c => new Date(c.date).getTime() > exitTimeMs);
  if (exitIdx5m >= 0) {
    const postExitCandles = option5m.slice(exitIdx5m);
    const highs = postExitCandles.map(c => c.high);
    const maxHigh = Math.max(...highs);
    const maxHighIdx = highs.indexOf(maxHigh);
    const maxHighTime = toIST(postExitCandles[maxHighIdx].date);
    const lastCandle = postExitCandles[postExitCandles.length - 1];
    const lastClose = lastCandle.close;
    const lastTime = toIST(lastCandle.date);
    
    console.log(`  Your exit price:        ₹${EXIT_PRICE} at ~${toIST(EXIT_TIME)}`);
    console.log(`  Post-exit option HIGH:  ₹${maxHigh} at ${maxHighTime}`);
    console.log(`  Option close (3:25 PM): ₹${lastClose} at ${lastTime}`);
    console.log(`  Money left on table:    ₹${((maxHigh - EXIT_PRICE) * QUANTITY).toFixed(0)} (to peak)`);
    console.log(`  EOD close vs your exit: ₹${((lastClose - EXIT_PRICE) * QUANTITY).toFixed(0)} (to EOD)`);
    console.log(`  Your P&L:              +₹${((EXIT_PRICE - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
    console.log(`  If held to peak:       +₹${((maxHigh - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
    console.log(`  If held to close:      +₹${((lastClose - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
  }
  
  // Find when Supertrend would have triggered exit
  console.log('\n  SUPERTREND EXIT SIMULATION:');
  let stExitTriggered = false;
  for (let i = 0; i < stock5m.length; i++) {
    const candleMs = new Date(stock5m[i].date).getTime();
    if (candleMs < entryTimeMs) continue;
    if (stockSTs[i] && stock5m[i].close < stockSTs[i].value) {
      console.log(`  ⚡ Supertrend EXIT would fire at ${toIST(stock5m[i].date)}`);
      console.log(`     Stock close: ${stock5m[i].close} < Supertrend: ${stockSTs[i].value.toFixed(2)}`);
      // Find corresponding option price
      const closestOpt = option5m.find(c => Math.abs(new Date(c.date).getTime() - candleMs) < 300000);
      if (closestOpt) {
        console.log(`     Option close: ₹${closestOpt.close}`);
        console.log(`     System P&L:  +₹${((closestOpt.close - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
      }
      stExitTriggered = true;
      break;
    }
  }
  if (!stExitTriggered) {
    console.log('  ❌ Supertrend NEVER triggered — would have held until EOD 3:19 PM exit');
    // Find option price near 3:19 PM
    const eodTime = new Date('2026-04-02T09:49:00.000Z').getTime(); // 3:19 PM IST
    const eodCandle = option5m.reduce((closest, c) => {
      const diff = Math.abs(new Date(c.date).getTime() - eodTime);
      return diff < Math.abs(new Date(closest.date).getTime() - eodTime) ? c : closest;
    });
    console.log(`     EOD exit price (~3:19): ₹${eodCandle.close}`);
    console.log(`     EOD P&L:               +₹${((eodCandle.close - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
  }
  
  // 15-min Gamma Climax check
  console.log('\n  GAMMA CLIMAX (15-min RSI >= 85) SIMULATION:');
  let gammaTriggered = false;
  for (let i = 0; i < option15m.length; i++) {
    const candleMs = new Date(option15m[i].date).getTime();
    if (candleMs < entryTimeMs) continue;
    if (optRSI15m[i] !== null && optRSI15m[i] >= 85) {
      console.log(`  🔥 Gamma Climax at ${toIST(option15m[i].date)} — RSI: ${optRSI15m[i].toFixed(1)}`);
      console.log(`     Option close: ₹${option15m[i].close}`);
      console.log(`     System P&L:  +₹${((option15m[i].close - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
      gammaTriggered = true;
      break;
    }
  }
  if (!gammaTriggered) {
    console.log('  ❌ Gamma Climax NEVER triggered (15-min RSI stayed < 85)');
  }
  
  // 5-min option RSI — would the LONG RSI trail have triggered?
  console.log('\n  HYPOTHETICAL LONG RSI TRAIL (5-min option RSI >= 85):');
  let trailActivated = false;
  let trailActivationTime = null;
  let trailFloor = 0;
  for (let i = 0; i < option5m.length; i++) {
    const candleMs = new Date(option5m[i].date).getTime();
    if (candleMs < entryTimeMs) continue;
    if (!trailActivated && optRSI5m[i] !== null && optRSI5m[i] >= 85) {
      trailActivated = true;
      trailActivationTime = toIST(option5m[i].date);
      trailFloor = option5m[i].low;
      console.log(`  🔥 Trail ACTIVATED at ${trailActivationTime} — 5min RSI: ${optRSI5m[i].toFixed(1)}`);
      console.log(`     Floor set to candle LOW: ₹${trailFloor}`);
      console.log(`     Option close: ₹${option5m[i].close}`);
      
      // Now simulate: when would floor break on 1-min data?
      console.log('\n  SIMULATED 1-MIN TRAIL POLLING AFTER ACTIVATION:');
      for (let j = 0; j < option1m.length; j++) {
        const m1Ms = new Date(option1m[j].date).getTime();
        if (m1Ms <= candleMs) continue;
        
        // Update floor on 5-min boundaries
        const matchingOpt5m = option5m.find(c5 => {
          const c5Ms = new Date(c5.date).getTime();
          return c5Ms > candleMs && c5Ms <= m1Ms && c5Ms + 300000 <= m1Ms;
        });
        if (matchingOpt5m) {
          const newFloor = matchingOpt5m.low;
          if (newFloor !== trailFloor) {
            console.log(`     Floor updated: ₹${trailFloor} → ₹${newFloor} at ${toIST(matchingOpt5m.date)}`);
            trailFloor = newFloor;
          }
        }
        
        if (option1m[j].low <= trailFloor) {
          console.log(`  ⚡ TRAIL EXIT at ${toIST(option1m[j].date)} — LTP ₹${option1m[j].low} <= Floor ₹${trailFloor}`);
          console.log(`     1-min candle close: ₹${option1m[j].close}`);
          console.log(`     Trail P&L:         +₹${((option1m[j].close - ENTRY_PRICE) * QUANTITY).toFixed(0)}`);
          break;
        }
      }
      break;
    }
  }
  if (!trailActivated) {
    console.log('  ❌ 5-min option RSI never reached 85 — trail would NOT have activated');
  }
  
  // 1-min option RSI — earliest 85+ reading
  console.log('\n  1-MIN OPTION RSI PEAKS (>= 80):');
  let peakCount = 0;
  for (let i = 0; i < option1m.length; i++) {
    const candleMs = new Date(option1m[i].date).getTime();
    if (candleMs < entryTimeMs) continue;
    if (optRSI1m[i] !== null && optRSI1m[i] >= 80) {
      console.log(`    ${toIST(option1m[i].date)} — RSI: ${optRSI1m[i].toFixed(1)} | Close: ₹${option1m[i].close}${optRSI1m[i] >= 85 ? ' 🔥' : ''}`);
      peakCount++;
      if (peakCount > 20) { console.log('    ... (truncated)'); break; }
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  END OF ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Cleanup
  try { fs.unlinkSync(path.join(__dirname, '../temp_fetch.js')); } catch(e) {}
  try { fs.unlinkSync(path.join(__dirname, '../temp_fetch2.js')); } catch(e) {}
  try { fs.unlinkSync(path.join(__dirname, '../temp_fetch3.js')); } catch(e) {}
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
