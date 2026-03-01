/**
 * Factor Analysis Script - Tests 8 improvement factors against all post-Feb 3 trades
 * Run: node scripts/factor-analysis.js
 * 
 * Factors:
 * 1. SHORT entry near S2 after 12 PM
 * 2. BB width at entry (% of price)
 * 3. Breakout candle width (high-low as % of price)
 * 5. RSI divergence in previous 10 candles
 * 6. PSAR trail for LONG exits
 * 7. RSI drop below 65 / above 35 immediately after entry
 * 8. 1-hour Supertrend alignment
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ============================================================
// SETUP: Kite API connection
// ============================================================
function getKiteConnect() {
  const KiteConnect = require('kiteconnect').KiteConnect;
  const apiKey = process.env.ZERODHA_API_KEY || 'q4aaem75hl0solt9';
  const apiSecret = process.env.ZERODHA_API_SECRET || 'smulr5rp0dt6rv8ou0217udftad9qagj';
  const encKey = crypto.createHash('sha256')
    .update(apiKey + apiSecret + 'trading_bot_session_key').digest('hex');
  const sessionRaw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'auth', 'session.json'), 'utf8'));
  const iv = Buffer.from(sessionRaw.iv, 'hex');
  const dec = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encKey.slice(0, 32)), iv);
  let d = dec.update(sessionRaw.data, 'hex', 'utf8');
  d += dec.final('utf8');
  const session = JSON.parse(d);
  const kc = new KiteConnect({ api_key: apiKey });
  kc.setAccessToken(session.accessToken);
  return kc;
}

// ============================================================
// INDICATOR CALCULATIONS (matching bot's logic)
// ============================================================

function calculateATR(candles, period) {
  if (candles.length < period + 1) return 1;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return 1;
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

function calculateSupertrend(candles, period = 10, multiplier = 2) {
  if (candles.length < period + 1) return { value: candles[candles.length - 1]?.close || 0, trend: 'UP' };
  const stValues = [];
  for (let i = period; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const atr = calculateATR(slice, period);
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUB = hl2 + multiplier * atr;
    const basicLB = hl2 - multiplier * atr;
    let finalUB, finalLB, trend, st;
    if (stValues.length === 0) {
      finalUB = basicUB; finalLB = basicLB;
      trend = c.close <= finalUB ? -1 : 1;
      st = trend === 1 ? finalLB : finalUB;
    } else {
      const prev = stValues[stValues.length - 1];
      const prevClose = candles[i - 1]?.close || c.close;
      finalUB = (basicUB < prev.finalUB || prevClose > prev.finalUB) ? basicUB : prev.finalUB;
      finalLB = (basicLB > prev.finalLB || prevClose < prev.finalLB) ? basicLB : prev.finalLB;
      if (prev.trend === 1) {
        trend = c.close < prev.st ? -1 : 1;
      } else {
        trend = c.close > prev.st ? 1 : -1;
      }
      st = trend === 1 ? finalLB : finalUB;
    }
    stValues.push({ close: c.close, finalUB, finalLB, trend, st, timestamp: c.date || c.timestamp });
  }
  const last = stValues[stValues.length - 1];
  return { value: last.st, trend: last.trend === 1 ? 'UP' : 'DOWN', stValues };
}

function calculateRSI(candles, period = 10) {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateBB(candles, period = 20, stdDev = 2) {
  if (candles.length < period) return null;
  const closes = candles.slice(-period).map(c => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd, width: (2 * stdDev * sd / mean) * 100 };
}

function calculatePivots(prevDayCandles) {
  if (!prevDayCandles || prevDayCandles.length === 0) return null;
  let high = -Infinity, low = Infinity, close = prevDayCandles[prevDayCandles.length - 1].close;
  prevDayCandles.forEach(c => { high = Math.max(high, c.high); low = Math.min(low, c.low); });
  const pp = (high + low + close) / 3;
  return {
    pp, r1: 2 * pp - low, s1: 2 * pp - high,
    r2: pp + (high - low), s2: pp - (high - low),
    r3: high + 2 * (pp - low), s3: low - 2 * (high - pp),
    pdh: high, pdl: low, pdc: close
  };
}

function calculatePSAR(candles, startAF = 0.05, increment = 0.02, maxAF = 0.2) {
  if (candles.length < 2) return [];
  const results = [];
  let isUpTrend = candles[1].close > candles[0].close;
  let af = startAF;
  let ep = isUpTrend ? candles[0].high : candles[0].low;
  let sar = isUpTrend ? candles[0].low : candles[0].high;

  results.push({ sar, isUpTrend, timestamp: candles[0].date || candles[0].timestamp });

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevSar = sar;

    // Update SAR
    sar = prevSar + af * (ep - prevSar);

    if (isUpTrend) {
      // Clamp SAR to previous lows
      if (i >= 2) sar = Math.min(sar, candles[i - 1].low, candles[i - 2].low);
      else sar = Math.min(sar, candles[i - 1].low);

      if (c.low < sar) {
        // Reversal to downtrend
        isUpTrend = false;
        sar = ep; // Use the highest point as new SAR
        ep = c.low;
        af = startAF;
      } else {
        if (c.high > ep) {
          ep = c.high;
          af = Math.min(af + increment, maxAF);
        }
      }
    } else {
      // Clamp SAR to previous highs
      if (i >= 2) sar = Math.max(sar, candles[i - 1].high, candles[i - 2].high);
      else sar = Math.max(sar, candles[i - 1].high);

      if (c.high > sar) {
        // Reversal to uptrend
        isUpTrend = true;
        sar = ep;
        ep = c.high;
        af = startAF;
      } else {
        if (c.low < ep) {
          ep = c.low;
          af = Math.min(af + increment, maxAF);
        }
      }
    }
    results.push({ sar, isUpTrend, timestamp: c.date || c.timestamp });
  }
  return results;
}

// Build 1-hour candles from 5-min candles
function build1HourCandles(candles5min) {
  const hourMap = {};
  candles5min.forEach(c => {
    const d = new Date(c.date || c.timestamp);
    const h = d.getUTCHours();
    const dateStr = d.toISOString().slice(0, 10);
    // Align to hour boundaries (IST: 9-10, 10-11, etc.)
    const key = `${dateStr}_${h}`;
    if (!hourMap[key]) {
      hourMap[key] = { date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0), 
                        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      hourMap[key].high = Math.max(hourMap[key].high, c.high);
      hourMap[key].low = Math.min(hourMap[key].low, c.low);
      hourMap[key].close = c.close;
      hourMap[key].volume += (c.volume || 0);
    }
  });
  return Object.values(hourMap).sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Check RSI divergence: price making higher high but RSI making lower high (bearish), or vice versa
function checkRSIDivergence(candles, direction) {
  if (candles.length < 10) return { hasDivergence: false };
  const recent = candles.slice(-10);
  const rsiValues = [];
  // Calculate RSI at each of the last 10 candle positions
  for (let i = 0; i < recent.length; i++) {
    const slice = candles.slice(0, candles.length - 10 + i + 1);
    rsiValues.push(calculateRSI(slice, 10));
  }
  
  // Find local price highs/lows and corresponding RSI
  if (direction === 'LONG') {
    // Bearish divergence: price higher high, RSI lower high
    let priceHighs = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].high > recent[i-1].high && recent[i].high > recent[i+1].high) {
        priceHighs.push({ idx: i, price: recent[i].high, rsi: rsiValues[i] });
      }
    }
    // Also check last candle
    if (recent.length >= 2 && recent[recent.length-1].high > recent[recent.length-2].high) {
      priceHighs.push({ idx: recent.length-1, price: recent[recent.length-1].high, rsi: rsiValues[recent.length-1] });
    }
    if (priceHighs.length >= 2) {
      const last = priceHighs[priceHighs.length - 1];
      const prev = priceHighs[priceHighs.length - 2];
      if (last.price > prev.price && last.rsi < prev.rsi) {
        return { hasDivergence: true, type: 'BEARISH', priceDelta: last.price - prev.price, rsiDelta: last.rsi - prev.rsi };
      }
    }
  } else {
    // Bullish divergence: price lower low, RSI higher low
    let priceLows = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].low < recent[i-1].low && recent[i].low < recent[i+1].low) {
        priceLows.push({ idx: i, price: recent[i].low, rsi: rsiValues[i] });
      }
    }
    if (recent.length >= 2 && recent[recent.length-1].low < recent[recent.length-2].low) {
      priceLows.push({ idx: recent.length-1, price: recent[recent.length-1].low, rsi: rsiValues[recent.length-1] });
    }
    if (priceLows.length >= 2) {
      const last = priceLows[priceLows.length - 1];
      const prev = priceLows[priceLows.length - 2];
      if (last.price < prev.price && last.rsi > prev.rsi) {
        return { hasDivergence: true, type: 'BULLISH', priceDelta: last.price - prev.price, rsiDelta: last.rsi - prev.rsi };
      }
    }
  }
  return { hasDivergence: false };
}

// ============================================================
// DATA FETCHING
// ============================================================

async function fetchStockData(kc, token, symbol, tradeDateStr) {
  // Fetch 14 days back from trade date for multi-day history (needed for ST/BB warmup)
  const tradeDate = new Date(tradeDateStr + 'T00:00:00+05:30');
  const fromDate = new Date(tradeDate);
  fromDate.setDate(fromDate.getDate() - 14);
  const toDate = new Date(tradeDateStr + 'T15:30:00+05:30');

  try {
    // Fetch 5-minute candles
    const data5min = await kc.getHistoricalData(token, '5minute', fromDate, toDate);
    
    // Fetch 60-minute candles for 1hr ST
    const data60min = await kc.getHistoricalData(token, '60minute', fromDate, toDate);
    
    return { candles5min: data5min, candles60min: data60min, symbol };
  } catch (err) {
    console.error(`  ERROR fetching ${symbol}: ${err.message}`);
    return null;
  }
}

// ============================================================
// MAIN ANALYSIS
// ============================================================

async function main() {
  console.log('==========================================================');
  console.log('FACTOR ANALYSIS - Post Feb 3 Trades (New System)');
  console.log('==========================================================\n');

  const kc = getKiteConnect();
  const tokenMap = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'cache', 'nse-token-map.json'), 'utf8'));

  // Load all trades
  const dataDir = path.join(__dirname, '..', 'src', 'data');
  const s1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'bollinger-slot1.json'), 'utf8'));
  const s2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'bollinger-slot2.json'), 'utf8'));
  const s3 = JSON.parse(fs.readFileSync(path.join(dataDir, 'bollinger-slot3.json'), 'utf8'));
  const cutoff = new Date('2026-02-03T00:00:00Z');
  const allTrades = [...s1.tradeHistory, ...s2.tradeHistory, ...s3.tradeHistory]
    .filter(t => new Date(t.entryTime) >= cutoff)
    .sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));

  console.log(`Total trades to analyze: ${allTrades.length}\n`);

  // Group by stock+date for efficient fetching
  const stockDateMap = {};
  allTrades.forEach((t, idx) => {
    const date = new Date(t.entryTime).toISOString().slice(0, 10);
    const symbol = t.instrument.name;
    const key = `${symbol}|${date}`;
    if (!stockDateMap[key]) stockDateMap[key] = { symbol, date, trades: [] };
    stockDateMap[key].trades.push({ ...t, tradeIndex: idx });
  });

  const uniquePairs = Object.keys(stockDateMap);
  console.log(`Unique stock+date pairs to fetch: ${uniquePairs.length}`);
  console.log('Fetching historical data (this may take a few minutes)...\n');

  // Fetch data with rate limiting (3 requests per second max)
  const dataCache = {};
  let fetchCount = 0;
  for (const key of uniquePairs) {
    const { symbol, date } = stockDateMap[key];
    const token = tokenMap[symbol];
    if (!token) {
      console.log(`  SKIP ${symbol}: No NSE token found`);
      continue;
    }
    
    const data = await fetchStockData(kc, token, symbol, date);
    if (data) {
      dataCache[key] = data;
      fetchCount++;
      if (fetchCount % 10 === 0) console.log(`  Fetched ${fetchCount}/${uniquePairs.length}...`);
    }
    
    // Rate limit: 3 calls per pair (5min + 60min), wait 700ms between pairs
    await new Promise(r => setTimeout(r, 700));
  }

  console.log(`\nData fetched for ${fetchCount} stock+date pairs.\n`);
  console.log('==========================================================');
  console.log('ANALYZING FACTORS...');
  console.log('==========================================================\n');

  // Analysis results per trade
  const results = [];

  for (const trade of allTrades) {
    const date = new Date(trade.entryTime).toISOString().slice(0, 10);
    const symbol = trade.instrument.name;
    const key = `${symbol}|${date}`;
    const data = dataCache[key];

    if (!data) {
      results.push({ trade, factors: null, reason: 'NO_DATA' });
      continue;
    }

    const entryTimeUTC = new Date(trade.entryTime);
    const exitTimeUTC = new Date(trade.exitTime);

    // Find candles up to entry time
    const candlesBeforeEntry = data.candles5min.filter(c => new Date(c.date) < entryTimeUTC);
    const entryCandle = data.candles5min.find(c => {
      const ct = new Date(c.date);
      return ct <= entryTimeUTC && (entryTimeUTC - ct) < 5 * 60 * 1000;
    }) || candlesBeforeEntry[candlesBeforeEntry.length - 1];

    // Candles during the trade (for exit analysis)
    const candlesDuringTrade = data.candles5min.filter(c => {
      const ct = new Date(c.date);
      return ct >= entryTimeUTC && ct <= exitTimeUTC;
    });

    // Candles after entry (including entry candle + next few)
    const candlesAfterEntry = data.candles5min.filter(c => new Date(c.date) >= entryTimeUTC);

    // Get previous day candles for pivots
    const prevDayStr = getPrevTradingDay(date);
    const prevDayCandles = data.candles5min.filter(c => {
      const d = new Date(c.date).toISOString().slice(0, 10);
      return d === prevDayStr;
    });
    const todayCandles = data.candles5min.filter(c => {
      const d = new Date(c.date).toISOString().slice(0, 10);
      return d === date;
    });

    const candlesUpToEntry = data.candles5min.filter(c => new Date(c.date) <= entryTimeUTC);
    
    // ============ COMPUTE INDICATORS AT ENTRY ============

    // Pivots
    const pivots = calculatePivots(prevDayCandles);

    // BB at entry
    const bb = candlesUpToEntry.length >= 20 ? calculateBB(candlesUpToEntry, 20, 2) : null;

    // RSI at entry
    const rsi = candlesUpToEntry.length >= 11 ? calculateRSI(candlesUpToEntry, 10) : null;

    // 5-min Supertrend at entry
    const st5 = candlesUpToEntry.length >= 11 ? calculateSupertrend(candlesUpToEntry, 10, 2) : null;

    // 1-hour Supertrend at entry
    const candles60BeforeEntry = data.candles60min.filter(c => new Date(c.date) < entryTimeUTC);
    const st60 = candles60BeforeEntry.length >= 11 ? calculateSupertrend(candles60BeforeEntry, 10, 2) : null;

    // Entry candle metrics
    const entryCandleWidth = entryCandle ? ((entryCandle.high - entryCandle.low) / entryCandle.close * 100) : null;
    const entryPrice = entryCandle ? entryCandle.close : null;

    // Entry hour (IST)
    const entryHourIST = entryTimeUTC.getUTCHours() + 5 + (entryTimeUTC.getUTCMinutes() + 30) / 60;

    // ============ FACTOR ANALYSIS ============
    const factors = {};

    // Factor 1: SHORT entry near S2 after 12 PM
    if (trade.direction === 'SHORT' && pivots) {
      const isAfter12 = entryHourIST >= 12;
      const distToS2 = entryPrice ? ((entryPrice - pivots.s2) / entryPrice * 100) : null;
      const closeAboveS2 = entryPrice > pivots.s2;
      const closeBelowS2 = entryPrice < pivots.s2;
      
      // Check if any subsequent candle closes above S2 (early exit signal)
      let candleAboveS2AfterEntry = null;
      if (closeBelowS2 && candlesDuringTrade.length > 1) {
        for (let i = 1; i < candlesDuringTrade.length; i++) {
          if (candlesDuringTrade[i].close > pivots.s2) {
            candleAboveS2AfterEntry = {
              candle: i,
              close: candlesDuringTrade[i].close,
              timestamp: candlesDuringTrade[i].date
            };
            break;
          }
        }
      }

      factors.f1_shortS2 = {
        isAfter12,
        s2: pivots.s2,
        entryClose: entryPrice,
        distToS2Pct: distToS2,
        closeAboveS2,
        closeBelowS2,
        closeVeryNearAboveS2: closeAboveS2 && distToS2 !== null && distToS2 < 0.5,
        candleAboveS2AfterEntry,
        wouldFilter: isAfter12 && closeAboveS2 && distToS2 !== null && distToS2 < 0.5,
        wouldEarlyExit: closeBelowS2 && candleAboveS2AfterEntry !== null,
      };
    } else {
      factors.f1_shortS2 = { applicable: false };
    }

    // Factor 2: BB width at entry
    if (bb) {
      factors.f2_bbWidth = {
        widthPct: bb.width,
        upper: bb.upper,
        lower: bb.lower,
        middle: bb.middle,
      };
    } else {
      factors.f2_bbWidth = { applicable: false };
    }

    // Factor 3: Breakout candle width
    factors.f3_candleWidth = {
      widthPct: entryCandleWidth,
      high: entryCandle?.high,
      low: entryCandle?.low,
      close: entryCandle?.close,
    };

    // Factor 5: RSI divergence in previous 10 candles
    if (candlesUpToEntry.length >= 12) {
      const div = checkRSIDivergence(candlesUpToEntry, trade.direction);
      factors.f5_rsiDivergence = {
        ...div,
        // For LONG: bearish divergence is bad (counter-signal)
        // For SHORT: bullish divergence is bad (counter-signal)
        isCounterSignal: (trade.direction === 'LONG' && div.hasDivergence && div.type === 'BEARISH') ||
                         (trade.direction === 'SHORT' && div.hasDivergence && div.type === 'BULLISH'),
      };
    } else {
      factors.f5_rsiDivergence = { applicable: false };
    }

    // Factor 6: PSAR trail for LONG exits
    if (trade.direction === 'LONG' && candlesDuringTrade.length > 1) {
      const psar = calculatePSAR(candlesDuringTrade, 0.05, 0.02, 0.2);
      // For LONG: exit when candle close drops below PSAR
      let psarExitCandle = null;
      for (let i = 1; i < candlesDuringTrade.length; i++) {
        if (psar[i] && !psar[i].isUpTrend && candlesDuringTrade[i].close < psar[i].sar) {
          psarExitCandle = i;
          break;
        }
      }
      
      // Also compute min(current_close, psar) trail
      let minTrailExit = null;
      let highest = candlesDuringTrade[0].close;
      for (let i = 1; i < candlesDuringTrade.length; i++) {
        const c = candlesDuringTrade[i];
        if (c.close > highest) highest = c.close;
        const trailLevel = psar[i] ? Math.min(highest, psar[i].sar) : highest;
        if (c.close < trailLevel && trailLevel < highest) {
          minTrailExit = {
            candle: i,
            close: c.close,
            trailLevel,
            psar: psar[i]?.sar,
            timestamp: c.date
          };
          break;
        }
      }

      // Estimate P&L if PSAR exit was used instead of actual exit
      // We need to map stock candle exit to option premium - approximate via ratio
      const actualHoldCandles = candlesDuringTrade.length;
      const psarHoldCandles = psarExitCandle || actualHoldCandles;
      
      factors.f6_psarTrail = {
        psarExitCandle,
        actualExitCandle: actualHoldCandles - 1,
        earlierExit: psarExitCandle !== null && psarExitCandle < actualHoldCandles - 1,
        laterExit: psarExitCandle === null || psarExitCandle > actualHoldCandles - 1,
        minTrailExit,
        // If PSAR would have exited earlier on a loser, that's an improvement
        wouldImprove: trade.pnl < 0 && psarExitCandle !== null && psarExitCandle < actualHoldCandles - 1,
        wouldHurt: trade.pnl > 0 && psarExitCandle !== null && psarExitCandle < actualHoldCandles - 1,
      };
    } else {
      factors.f6_psarTrail = { applicable: false, direction: trade.direction };
    }

    // Factor 7: RSI drop below 65 / above 35 after entry
    if (candlesAfterEntry.length >= 3 && rsi !== null) {
      // Check next 2-3 candles after entry for RSI reversal
      const rsiValues = [];
      const base = candlesUpToEntry.slice(); // all candles up to entry
      for (let i = 0; i < Math.min(4, candlesAfterEntry.length); i++) {
        base.push(candlesAfterEntry[i]);
        const r = calculateRSI(base, 10);
        rsiValues.push({ candle: i, rsi: r, timestamp: candlesAfterEntry[i].date });
      }

      let quickReversal = false;
      let reversalDetails = null;
      if (trade.direction === 'LONG') {
        // LONG: RSI should stay above 65. If it drops below 65 in first 2 candles, bad sign
        for (let i = 1; i <= Math.min(2, rsiValues.length - 1); i++) {
          if (rsiValues[i].rsi < 65) {
            quickReversal = true;
            reversalDetails = { candle: i, rsi: rsiValues[i].rsi, threshold: 65 };
            break;
          }
        }
      } else {
        // SHORT: RSI should stay below 35. If it rises above 35 quickly, bad sign
        for (let i = 1; i <= Math.min(2, rsiValues.length - 1); i++) {
          if (rsiValues[i].rsi > 35) {
            quickReversal = true;
            reversalDetails = { candle: i, rsi: rsiValues[i].rsi, threshold: 35 };
            break;
          }
        }
      }

      factors.f7_rsiQuickReversal = {
        entryRSI: rsi,
        rsiNextCandles: rsiValues.slice(1).map(r => r.rsi.toFixed(1)),
        quickReversal,
        reversalDetails,
        // If quick reversal and trade was a loser, filter would have helped
        wouldFilter: quickReversal,
      };
    } else {
      factors.f7_rsiQuickReversal = { applicable: false };
    }

    // Factor 8: 1-hour Supertrend alignment
    if (st60 && st5) {
      const aligned = (trade.direction === 'LONG' && st5.trend === 'UP' && st60.trend === 'UP') ||
                      (trade.direction === 'SHORT' && st5.trend === 'DOWN' && st60.trend === 'DOWN');
      factors.f8_hourlySTAlignment = {
        st5min: st5.trend,
        st60min: st60.trend,
        tradeDirection: trade.direction,
        aligned,
        wouldFilter: !aligned,
      };
    } else {
      factors.f8_hourlySTAlignment = { applicable: false, st5: st5?.trend, st60: st60?.trend };
    }

    results.push({
      tradeIndex: allTrades.indexOf(trade),
      symbol,
      date,
      direction: trade.direction,
      pnl: trade.pnl,
      exitReason: trade.exitReason,
      entryHourIST: Math.floor(entryHourIST) + ':' + String(Math.round((entryHourIST % 1) * 60)).padStart(2, '0'),
      factors,
    });
  }

  // ============================================================
  // OUTPUT RESULTS
  // ============================================================
  
  console.log('\n==========================================================');
  console.log('FACTOR 1: SHORT ENTRY NEAR S2 AFTER 12 PM');
  console.log('==========================================================');
  analyzeF1(results);

  console.log('\n==========================================================');
  console.log('FACTOR 2: BOLLINGER BAND WIDTH AT ENTRY');
  console.log('==========================================================');
  analyzeF2(results);

  console.log('\n==========================================================');
  console.log('FACTOR 3: BREAKOUT CANDLE WIDTH');
  console.log('==========================================================');
  analyzeF3(results);

  console.log('\n==========================================================');
  console.log('FACTOR 5: RSI DIVERGENCE BEFORE ENTRY');
  console.log('==========================================================');
  analyzeF5(results);

  console.log('\n==========================================================');
  console.log('FACTOR 6: PSAR TRAIL FOR LONG EXITS');
  console.log('==========================================================');
  analyzeF6(results);

  console.log('\n==========================================================');
  console.log('FACTOR 7: RSI QUICK REVERSAL AFTER ENTRY');
  console.log('==========================================================');
  analyzeF7(results);

  console.log('\n==========================================================');
  console.log('FACTOR 8: 1-HOUR SUPERTREND ALIGNMENT');
  console.log('==========================================================');
  analyzeF8(results);

  // Save raw results
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'factor-analysis-results.json'), 
    JSON.stringify(results, null, 2));
  console.log('\n\nRaw results saved to data/factor-analysis-results.json');
}

// ============================================================
// ANALYSIS FUNCTIONS
// ============================================================

function analyzeF1(results) {
  const applicable = results.filter(r => r.factors?.f1_shortS2?.applicable !== false && r.factors?.f1_shortS2);
  const after12 = applicable.filter(r => r.factors.f1_shortS2.isAfter12);
  const before12 = applicable.filter(r => !r.factors.f1_shortS2.isAfter12);
  
  console.log(`\nSHORT trades with pivot data: ${applicable.length}`);
  console.log(`  Before 12 PM: ${before12.length} trades, PnL: ₹${before12.reduce((s,r) => s + r.pnl, 0).toFixed(0)}, WR: ${(before12.filter(r=>r.pnl>0).length/before12.length*100||0).toFixed(0)}%`);
  console.log(`  After 12 PM:  ${after12.length} trades, PnL: ₹${after12.reduce((s,r) => s + r.pnl, 0).toFixed(0)}, WR: ${(after12.filter(r=>r.pnl>0).length/after12.length*100||0).toFixed(0)}%`);
  
  // S2 proximity analysis (after 12)
  const nearS2 = after12.filter(r => r.factors.f1_shortS2.closeVeryNearAboveS2);
  const farS2 = after12.filter(r => !r.factors.f1_shortS2.closeVeryNearAboveS2);
  console.log(`\n  After 12 - Close very near above S2 (<0.5%): ${nearS2.length} trades, PnL: ₹${nearS2.reduce((s,r)=>s+r.pnl,0).toFixed(0)}`);
  console.log(`  After 12 - Not near S2: ${farS2.length} trades, PnL: ₹${farS2.reduce((s,r)=>s+r.pnl,0).toFixed(0)}`);
  
  // Detailed per-trade for near-S2
  if (nearS2.length > 0) {
    console.log(`\n  Near-S2 trades:`);
    nearS2.forEach(r => console.log(`    ${r.symbol} ${r.date} PnL:₹${r.pnl.toFixed(0)} dist:${r.factors.f1_shortS2.distToS2Pct?.toFixed(2)}% S2:${r.factors.f1_shortS2.s2?.toFixed(1)}`));
  }

  // Below S2 + candle above S2 early exit
  const belowS2 = applicable.filter(r => r.factors.f1_shortS2.closeBelowS2);
  const earlyExitCandidates = belowS2.filter(r => r.factors.f1_shortS2.wouldEarlyExit);
  console.log(`\n  Entered below S2: ${belowS2.length} trades`);
  console.log(`  Would early exit (candle closed above S2): ${earlyExitCandidates.length} trades`);
  earlyExitCandidates.forEach(r => {
    const ea = r.factors.f1_shortS2.candleAboveS2AfterEntry;
    console.log(`    ${r.symbol} ${r.date} PnL:₹${r.pnl.toFixed(0)} exit@candle#${ea.candle} close:${ea.close.toFixed(1)} vs S2:${r.factors.f1_shortS2.s2.toFixed(1)} [actual exit: ${r.exitReason}]`);
  });
  
  // All SHORT trades with distance to S2
  console.log(`\n  All SHORT trades - distance to S2:`);
  applicable.forEach(r => {
    const f = r.factors.f1_shortS2;
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.entryHourIST.padEnd(6)} PnL:${String(r.pnl.toFixed(0)).padStart(7)} dist_S2:${f.distToS2Pct?.toFixed(2).padStart(6)}% ${f.closeAboveS2?'ABOVE':'BELOW'} S2:${f.s2?.toFixed(1)} close:${f.entryClose?.toFixed(1)}`);
  });
}

function analyzeF2(results) {
  const applicable = results.filter(r => r.factors?.f2_bbWidth?.widthPct !== undefined);
  
  // Sort by BB width
  const sorted = [...applicable].sort((a, b) => a.factors.f2_bbWidth.widthPct - b.factors.f2_bbWidth.widthPct);
  
  console.log(`\nTrades with BB data: ${applicable.length}`);
  console.log(`BB width range: ${sorted[0]?.factors.f2_bbWidth.widthPct.toFixed(3)}% to ${sorted[sorted.length-1]?.factors.f2_bbWidth.widthPct.toFixed(3)}%`);
  
  // Monte Carlo: test different thresholds
  console.log('\n  THRESHOLD ANALYSIS (filter trades with BB width below threshold):');
  console.log('  Threshold | Filtered | Remaining | Filtered PnL | Remaining PnL | Rem WR | Improvement');
  
  const basePnl = applicable.reduce((s, r) => s + r.pnl, 0);
  const baseWR = applicable.filter(r => r.pnl > 0).length / applicable.length;
  
  for (let thresh = 0.3; thresh <= 2.0; thresh += 0.1) {
    const filtered = applicable.filter(r => r.factors.f2_bbWidth.widthPct < thresh);
    const remaining = applicable.filter(r => r.factors.f2_bbWidth.widthPct >= thresh);
    const filtPnl = filtered.reduce((s, r) => s + r.pnl, 0);
    const remPnl = remaining.reduce((s, r) => s + r.pnl, 0);
    const remWR = remaining.length > 0 ? (remaining.filter(r => r.pnl > 0).length / remaining.length * 100) : 0;
    const improvement = remPnl - basePnl;
    console.log(`  ${thresh.toFixed(1).padStart(5)}%   | ${String(filtered.length).padStart(8)} | ${String(remaining.length).padStart(9)} | ₹${filtPnl.toFixed(0).padStart(10)} | ₹${remPnl.toFixed(0).padStart(11)} | ${remWR.toFixed(0).padStart(4)}% | ₹${improvement.toFixed(0).padStart(9)}`);
  }
  
  // Per-trade detail
  console.log('\n  All trades by BB width:');
  sorted.forEach(r => {
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.direction.padEnd(5)} BB:${r.factors.f2_bbWidth.widthPct.toFixed(3).padStart(6)}% PnL:${String(r.pnl.toFixed(0)).padStart(7)} ${r.exitReason.substring(0,25)}`);
  });
}

function analyzeF3(results) {
  const applicable = results.filter(r => r.factors?.f3_candleWidth?.widthPct !== null && r.factors?.f3_candleWidth?.widthPct !== undefined);
  const sorted = [...applicable].sort((a, b) => a.factors.f3_candleWidth.widthPct - b.factors.f3_candleWidth.widthPct);
  
  console.log(`\nTrades with candle width data: ${applicable.length}`);
  console.log(`Candle width range: ${sorted[0]?.factors.f3_candleWidth.widthPct.toFixed(3)}% to ${sorted[sorted.length-1]?.factors.f3_candleWidth.widthPct.toFixed(3)}%`);
  
  const basePnl = applicable.reduce((s, r) => s + r.pnl, 0);
  
  console.log('\n  THRESHOLD ANALYSIS (filter trades with candle width below threshold):');
  console.log('  Threshold | Filtered | Remaining | Filtered PnL | Remaining PnL | Rem WR | Improvement');
  
  for (let thresh = 0.2; thresh <= 1.2; thresh += 0.05) {
    const filtered = applicable.filter(r => r.factors.f3_candleWidth.widthPct < thresh);
    const remaining = applicable.filter(r => r.factors.f3_candleWidth.widthPct >= thresh);
    const filtPnl = filtered.reduce((s, r) => s + r.pnl, 0);
    const remPnl = remaining.reduce((s, r) => s + r.pnl, 0);
    const remWR = remaining.length > 0 ? (remaining.filter(r => r.pnl > 0).length / remaining.length * 100) : 0;
    const improvement = remPnl - basePnl;
    console.log(`  ${thresh.toFixed(2).padStart(6)}% | ${String(filtered.length).padStart(8)} | ${String(remaining.length).padStart(9)} | ₹${filtPnl.toFixed(0).padStart(10)} | ₹${remPnl.toFixed(0).padStart(11)} | ${remWR.toFixed(0).padStart(4)}% | ₹${improvement.toFixed(0).padStart(9)}`);
  }
  
  console.log('\n  All trades by candle width:');
  sorted.forEach(r => {
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.direction.padEnd(5)} CW:${r.factors.f3_candleWidth.widthPct.toFixed(3).padStart(6)}% PnL:${String(r.pnl.toFixed(0)).padStart(7)} ${r.exitReason.substring(0,25)}`);
  });
}

function analyzeF5(results) {
  const applicable = results.filter(r => r.factors?.f5_rsiDivergence?.applicable !== false);
  const withDiv = applicable.filter(r => r.factors.f5_rsiDivergence.hasDivergence);
  const noDiv = applicable.filter(r => !r.factors.f5_rsiDivergence.hasDivergence);
  const counterSignal = applicable.filter(r => r.factors.f5_rsiDivergence.isCounterSignal);
  
  console.log(`\nTrades analyzed: ${applicable.length}`);
  console.log(`  With RSI divergence: ${withDiv.length} trades, PnL: ₹${withDiv.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(withDiv.filter(r=>r.pnl>0).length/withDiv.length*100||0).toFixed(0)}%`);
  console.log(`  No divergence: ${noDiv.length} trades, PnL: ₹${noDiv.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(noDiv.filter(r=>r.pnl>0).length/noDiv.length*100||0).toFixed(0)}%`);
  console.log(`  Counter-signal divergence: ${counterSignal.length} trades, PnL: ₹${counterSignal.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(counterSignal.filter(r=>r.pnl>0).length/counterSignal.length*100||0).toFixed(0)}%`);
  
  if (withDiv.length > 0) {
    console.log('\n  Trades with divergence:');
    withDiv.forEach(r => {
      const f = r.factors.f5_rsiDivergence;
      console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.direction.padEnd(5)} ${f.type.padEnd(8)} counter:${f.isCounterSignal?'YES':'no '} PnL:${String(r.pnl.toFixed(0)).padStart(7)}`);
    });
  }
}

function analyzeF6(results) {
  const applicable = results.filter(r => r.factors?.f6_psarTrail?.applicable !== false && r.direction === 'LONG');
  const wouldImprove = applicable.filter(r => r.factors.f6_psarTrail.wouldImprove);
  const wouldHurt = applicable.filter(r => r.factors.f6_psarTrail.wouldHurt);
  const noChange = applicable.filter(r => !r.factors.f6_psarTrail.wouldImprove && !r.factors.f6_psarTrail.wouldHurt);
  
  console.log(`\nLONG trades analyzed for PSAR trail: ${applicable.length}`);
  console.log(`  Would improve (earlier exit on losers): ${wouldImprove.length}`);
  console.log(`  Would hurt (earlier exit on winners): ${wouldHurt.length}`);
  console.log(`  No change: ${noChange.length}`);
  
  console.log('\n  Per-trade PSAR analysis:');
  applicable.forEach(r => {
    const f = r.factors.f6_psarTrail;
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} PnL:${String(r.pnl.toFixed(0)).padStart(7)} PSAR_exit@candle:${f.psarExitCandle||'NONE'} actual@candle:${f.actualExitCandle} ${f.earlierExit?'EARLIER':'LATER/SAME'} ${f.wouldImprove?'✅IMPROVE':f.wouldHurt?'❌HURT':'➖NEUTRAL'} [${r.exitReason.substring(0,20)}]`);
  });
}

function analyzeF7(results) {
  const applicable = results.filter(r => r.factors?.f7_rsiQuickReversal?.applicable !== false);
  const withReversal = applicable.filter(r => r.factors.f7_rsiQuickReversal.quickReversal);
  const noReversal = applicable.filter(r => !r.factors.f7_rsiQuickReversal.quickReversal);
  
  console.log(`\nTrades analyzed: ${applicable.length}`);
  console.log(`  Quick RSI reversal: ${withReversal.length} trades, PnL: ₹${withReversal.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(withReversal.filter(r=>r.pnl>0).length/withReversal.length*100||0).toFixed(0)}%`);
  console.log(`  No quick reversal:  ${noReversal.length} trades, PnL: ₹${noReversal.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(noReversal.filter(r=>r.pnl>0).length/noReversal.length*100||0).toFixed(0)}%`);
  
  // Would-filter analysis
  const filteredPnl = withReversal.reduce((s, r) => s + r.pnl, 0);
  const keptPnl = noReversal.reduce((s, r) => s + r.pnl, 0);
  console.log(`\n  If filtered: Would remove ${withReversal.length} trades (₹${filteredPnl.toFixed(0)}), keep ${noReversal.length} trades (₹${keptPnl.toFixed(0)})`);
  console.log(`  Net improvement: ₹${(-filteredPnl).toFixed(0)}`);
  
  console.log('\n  Quick reversal trades:');
  withReversal.forEach(r => {
    const f = r.factors.f7_rsiQuickReversal;
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.direction.padEnd(5)} entryRSI:${f.entryRSI.toFixed(1)} next:[${f.rsiNextCandles.join(',')}] PnL:${String(r.pnl.toFixed(0)).padStart(7)} [${r.exitReason.substring(0,20)}]`);
  });
}

function analyzeF8(results) {
  const applicable = results.filter(r => r.factors?.f8_hourlySTAlignment?.aligned !== undefined);
  const aligned = applicable.filter(r => r.factors.f8_hourlySTAlignment.aligned);
  const misaligned = applicable.filter(r => !r.factors.f8_hourlySTAlignment.aligned);
  
  console.log(`\nTrades with both 5-min and 1-hr ST data: ${applicable.length}`);
  console.log(`  Aligned (both STs match direction): ${aligned.length} trades, PnL: ₹${aligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(aligned.filter(r=>r.pnl>0).length/aligned.length*100||0).toFixed(0)}%`);
  console.log(`  Misaligned: ${misaligned.length} trades, PnL: ₹${misaligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(misaligned.filter(r=>r.pnl>0).length/misaligned.length*100||0).toFixed(0)}%`);
  
  // Per direction
  const longAligned = aligned.filter(r => r.direction === 'LONG');
  const longMisaligned = misaligned.filter(r => r.direction === 'LONG');
  const shortAligned = aligned.filter(r => r.direction === 'SHORT');
  const shortMisaligned = misaligned.filter(r => r.direction === 'SHORT');
  
  console.log(`\n  LONG aligned: ${longAligned.length} trades, PnL: ₹${longAligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(longAligned.filter(r=>r.pnl>0).length/longAligned.length*100||0).toFixed(0)}%`);
  console.log(`  LONG misaligned: ${longMisaligned.length} trades, PnL: ₹${longMisaligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(longMisaligned.filter(r=>r.pnl>0).length/longMisaligned.length*100||0).toFixed(0)}%`);
  console.log(`  SHORT aligned: ${shortAligned.length} trades, PnL: ₹${shortAligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(shortAligned.filter(r=>r.pnl>0).length/shortAligned.length*100||0).toFixed(0)}%`);
  console.log(`  SHORT misaligned: ${shortMisaligned.length} trades, PnL: ₹${shortMisaligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)}, WR: ${(shortMisaligned.filter(r=>r.pnl>0).length/shortMisaligned.length*100||0).toFixed(0)}%`);
  
  // If we filtered misaligned trades
  const filteredPnl = misaligned.reduce((s, r) => s + r.pnl, 0);
  console.log(`\n  If filtered misaligned: Remove ${misaligned.length} trades (₹${filteredPnl.toFixed(0)}), keep ${aligned.length} trades (₹${aligned.reduce((s,r)=>s+r.pnl,0).toFixed(0)})`);
  console.log(`  Net improvement: ₹${(-filteredPnl).toFixed(0)}`);
  
  console.log('\n  Per-trade detail:');
  applicable.forEach(r => {
    const f = r.factors.f8_hourlySTAlignment;
    console.log(`    ${r.symbol.padEnd(14)} ${r.date} ${r.direction.padEnd(5)} 5m:${f.st5min.padEnd(4)} 1h:${f.st60min.padEnd(4)} ${f.aligned?'✅ALIGNED':'❌MISALIGN'} PnL:${String(r.pnl.toFixed(0)).padStart(7)}`);
  });
}

// Helper: get previous trading day (rough - skip weekends)
function getPrevTradingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Run
main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
