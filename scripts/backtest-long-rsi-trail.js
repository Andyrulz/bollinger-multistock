/**
 * Backtest LONG RSI Trail exit across winning LONG trades
 * Tests thresholds: 83, 84, 85 on 5-min option RSI(14)
 * Run on VM: node scripts/backtest-long-rsi-trail.js
 */

const KiteConnect = require('kiteconnect').KiteConnect;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Session decryption (same as bot) ──
function decryptSession() {
    const sessionPath = path.join(__dirname, '..', 'data', 'auth', 'session.json');
    const raw = fs.readFileSync(sessionPath, 'utf8');
    const { data, iv } = JSON.parse(raw);

    const apiKey = process.env.KITE_API_KEY || process.env.ZERODHA_API_KEY || 'q4aaem75hl0solt9';
    let apiSecret;
    try {
        const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const match = envFile.match(/(?:KITE_API_SECRET|ZERODHA_API_SECRET)=(.+)/);
        if (match) apiSecret = match[1].trim();
    } catch (e) { }
    if (!apiSecret) throw new Error('Cannot read API_SECRET from .env');

    const keyHex = crypto.createHash('sha256')
        .update(apiKey + apiSecret + 'trading_bot_session_key')
        .digest('hex');
    const key = Buffer.from(keyHex.slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

// ── RSI calculation (Wilder's RMA) ──
function calcRSI(closes, period = 14) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return rsi;

    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gainSum += diff; else lossSum += Math.abs(diff);
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return rsi;
}

// ── Fetch historical candles ──
async function fetchCandles(kc, token, from, to, interval) {
    const apiKey = 'q4aaem75hl0solt9';
    const accessToken = kc.access_token || kc._accessToken;
    const url = `https://api.kite.trade/instruments/historical/${token}/${interval}?from=${from}&to=${to}`;
    const resp = await fetch(url, {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` }
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`API ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return (data.data?.candles || []).map(c => ({
        time: new Date(c[0]), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
    }));
}

// ── Resolve instrument token from trading symbol ──
async function resolveToken(kc, tradingSymbol) {
    // Try NFO instruments cache
    const cacheDir = path.join(__dirname, '..', 'data', 'cache');
    if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('instruments-nfo'));
        for (const file of files) {
            try {
                const instruments = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
                const match = instruments.find(i => i.tradingsymbol === tradingSymbol);
                if (match) return match.instrument_token;
            } catch (e) { }
        }
    }
    
    // Fetch from API
    const instruments = await kc.getInstruments('NFO');
    const match = instruments.find(i => i.tradingsymbol === tradingSymbol);
    if (match) return match.instrument_token;
    throw new Error(`Token not found for ${tradingSymbol}`);
}

// ── Simulate RSI Trail for a LONG trade ──
function simulateRsiTrail(candles5min, entryTime, entryPrice, exitTime, qty, threshold) {
    const result = {
        threshold,
        activated: false,
        activationTime: null,
        activationRsi: null,
        floorPrice: null,
        exitTime: null,
        exitPrice: null,
        pnl: null,
        maxRsi: 0,
        rsiTimeline: []
    };

    // Calculate RSI on 5-min closes
    const closes = candles5min.map(c => c.close);
    const rsiValues = calcRSI(closes);

    // Find candles during the trade period (and a bit after for simulation)
    const entryTs = new Date(entryTime).getTime();
    // Extend simulation to EOD to see what would have happened
    const eodTs = new Date(entryTime).setHours(15, 30, 0, 0);

    for (let i = 0; i < candles5min.length; i++) {
        const candleTs = candles5min[i].time.getTime();
        if (candleTs < entryTs) continue;
        if (candleTs > eodTs) break;

        const rsi = rsiValues[i];
        if (rsi === null) continue;

        if (rsi > result.maxRsi) result.maxRsi = rsi;

        // Track RSI timeline during trade
        const timeStr = candles5min[i].time.toLocaleTimeString('en-IN', { 
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' 
        });

        result.rsiTimeline.push({
            time: timeStr,
            close: candles5min[i].close,
            low: candles5min[i].low,
            rsi: rsi.toFixed(1)
        });

        if (!result.activated) {
            // Check for activation
            if (rsi >= threshold) {
                result.activated = true;
                result.activationTime = timeStr;
                result.activationRsi = rsi.toFixed(1);
                result.floorPrice = candles5min[i].low;
            }
        } else {
            // Trail is active — check for exit
            // Update floor (ratcheting UP for LONG)
            const newFloor = Math.max(result.floorPrice, candles5min[i].low);
            
            // Check if LOW of this candle broke previous floor (simulating 5s poll catching it)
            if (candles5min[i].low <= result.floorPrice) {
                // Exit triggered — realistic fill is near the candle close
                // (5s polling would catch it mid-candle, between low and close)
                result.exitTime = timeStr;
                result.exitPrice = (candles5min[i].low + candles5min[i].close) / 2; // mid estimate
                result.pnl = (result.exitPrice - entryPrice) * qty;
                break;
            }
            
            result.floorPrice = newFloor;
        }
    }

    // If never exited, mark as "held to EOD"
    if (result.activated && !result.exitTime) {
        const lastCandle = candles5min[candles5min.length - 1];
        const lastTimeStr = lastCandle.time.toLocaleTimeString('en-IN', { 
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' 
        });
        result.exitTime = lastTimeStr + ' (EOD)';
        result.exitPrice = lastCandle.close;
        result.pnl = (lastCandle.close - entryPrice) * qty;
    }

    if (!result.activated) {
        result.pnl = null; // never activated
    }

    return result;
}

// ── Main ──
async function main() {
    console.log('═'.repeat(80));
    console.log('  LONG RSI TRAIL BACKTEST — Testing Thresholds 83 / 84 / 85');
    console.log('═'.repeat(80));

    const session = decryptSession();
    const accessToken = session.accessToken;
    const apiKey = 'q4aaem75hl0solt9';
    const kc = { access_token: accessToken };
    console.log('✅ Authenticated\n');

    // Define trades to test
    // Known tokens from prior analysis / cache
    const knownTokens = {
        'COFORGE26APR1180CE': 24187906,
    };
    
    // qty is approximate based on ~25k capital / entry price per lot
    const trades = [
        { 
            stock: 'PFC', option: 'PFC26FEB402.5CE', 
            date: '2026-02-04', entryTime: '2026-02-04T10:00:00+05:30',
            exitTime: '2026-02-04T15:24:00+05:30',
            entryPrice: 13.10, exitPrice: 20.60, actualPnl: 9750,
            exitReason: 'EOD_SAFETY', lotSize: 1300
        },
        {
            stock: 'ULTRACEMCO', option: 'ULTRACEMCO26FEB12800CE',
            date: '2026-02-09', entryTime: '2026-02-09T09:55:00+05:30',
            exitTime: '2026-02-09T14:22:00+05:30',
            entryPrice: 210.00, exitPrice: 365.00, actualPnl: 7750,
            exitReason: 'MANUAL', lotSize: 50
        },
        {
            stock: 'MUTHOOTFIN', option: 'MUTHOOTFIN26FEB3800CE',
            date: '2026-02-10', entryTime: '2026-02-10T10:25:00+05:30',
            exitTime: '2026-02-10T13:00:00+05:30',
            entryPrice: 159.50, exitPrice: 193.00, actualPnl: 9213,
            exitReason: 'MANUAL', lotSize: 275
        },
        {
            stock: 'SHRIRAMFIN', option: 'SHRIRAMFIN26FEB1030CE',
            date: '2026-02-09', entryTime: '2026-02-09T12:05:00+05:30',
            exitTime: '2026-02-09T12:15:00+05:30',
            entryPrice: 26.25, exitPrice: 29.50, actualPnl: 2681,
            exitReason: 'GAMMA_CLIMAX_RSI92', lotSize: 825
        },
        {
            stock: 'M&M', option: 'M&M26FEB3650CE',
            date: '2026-02-10', entryTime: '2026-02-10T11:00:00+05:30',
            exitTime: '2026-02-10T12:15:00+05:30',
            entryPrice: 89.45, exitPrice: 106.90, actualPnl: 3490,
            exitReason: 'GAMMA_CLIMAX_RSI88', lotSize: 200
        },
        {
            stock: 'BANKBARODA', option: 'BANKBARODA26MAR320CE',
            date: '2026-02-26', entryTime: '2026-02-26T13:45:00+05:30',
            exitTime: '2026-02-26T15:19:00+05:30',
            entryPrice: 10.75, exitPrice: 12.50, actualPnl: 5119,
            exitReason: 'EOD_SAFETY', lotSize: 2925
        },
        {
            stock: 'LT', option: 'LT26MAR3460CE',
            date: '2026-03-24', entryTime: '2026-03-24T12:35:00+05:30',
            exitTime: '2026-03-24T13:45:00+05:30',
            entryPrice: 56.80, exitPrice: 104.55, actualPnl: 8356,
            exitReason: 'GAMMA_CLIMAX_RSI87', lotSize: 175
        },
        {
            stock: 'INDIGO', option: 'INDIGO26MAR4250CE',
            date: '2026-03-25', entryTime: '2026-03-25T10:55:00+05:30',
            exitTime: '2026-03-25T11:15:00+05:30',
            entryPrice: 55.95, exitPrice: 80.35, actualPnl: 3660,
            exitReason: 'GAMMA_CLIMAX_RSI86', lotSize: 150
        },
        {
            stock: 'COFORGE', option: 'COFORGE26APR1180CE',
            date: '2026-04-02', entryTime: '2026-04-02T13:05:00+05:30',
            exitTime: '2026-04-02T14:20:00+05:30',
            entryPrice: 63.85, exitPrice: 86.75, actualPnl: 8588,
            exitReason: 'MANUAL', lotSize: 375
        }
    ];

    const thresholds = [83, 84, 85];
    const summaryResults = {};
    thresholds.forEach(t => summaryResults[t] = { activations: 0, totalPnl: 0, trades: [] });

    for (const trade of trades) {
        const dateStr = trade.date;
        const fromDate = `${dateStr} 09:10:00`;
        const toDate = `${dateStr} 15:30:00`;

        console.log(`\n${'─'.repeat(80)}`);
        console.log(`  ${trade.stock} | ${trade.option} | ${trade.date}`);
        console.log(`  Entry: ₹${trade.entryPrice} → Exit: ₹${trade.exitPrice} | Actual P&L: ₹${trade.actualPnl} (${trade.exitReason})`);
        console.log(`${'─'.repeat(80)}`);

        // We need the option token — try to find it
        let optionToken = knownTokens[trade.option] || null;
        
        if (!optionToken) {
            try {
                const instrumentsCsv = path.join(__dirname, '..', 'data', 'instruments.csv');
                if (fs.existsSync(instrumentsCsv)) {
                    const csvData = fs.readFileSync(instrumentsCsv, 'utf8');
                    const lines = csvData.split('\n');
                    for (const line of lines) {
                        if (line.includes(trade.option)) {
                            optionToken = parseInt(line.split(',')[0]);
                            break;
                        }
                    }
                }
            } catch (e) { }
        }
        
        if (!optionToken) {
            // Try current NFO instruments cache
            try {
                const cacheDir = path.join(__dirname, '..', 'data', 'cache');
                if (fs.existsSync(cacheDir)) {
                    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('instruments-nfo'));
                    for (const file of files) {
                        const instruments = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
                        const match = instruments.find(i => i.tradingsymbol === trade.option);
                        if (match) { optionToken = match.instrument_token; break; }
                    }
                }
            } catch (e) { }
        }

        if (!optionToken) {
            console.log(`  ❌ SKIPPED — Token not found for ${trade.option}`);
            continue;
        }

        console.log(`  Token: ${optionToken}`);

        // Fetch 5-min option candles
        let candles5min;
        try {
            await new Promise(r => setTimeout(r, 400)); // rate limit
            candles5min = await fetchCandles(kc, optionToken, fromDate, toDate, '5minute');
            console.log(`  📥 Fetched ${candles5min.length} 5-min candles`);
        } catch (e) {
            console.log(`  ❌ SKIPPED — API error: ${e.message}`);
            continue;
        }

        if (candles5min.length < 20) {
            console.log(`  ❌ SKIPPED — Insufficient candles (${candles5min.length})`);
            continue;
        }

        // Calculate qty from actual P&L and price diff
        const qty = Math.round(trade.actualPnl / (trade.exitPrice - trade.entryPrice));

        // Test each threshold
        for (const threshold of thresholds) {
            const result = simulateRsiTrail(candles5min, trade.entryTime, trade.entryPrice, trade.exitTime, qty, threshold);
            
            const tag = result.activated 
                ? (result.exitPrice ? `Exit ₹${result.exitPrice.toFixed(2)} at ${result.exitTime} → P&L ₹${result.pnl.toFixed(0)}` 
                   : 'Activated but no exit triggered')
                : `NOT ACTIVATED (max RSI: ${result.maxRsi.toFixed(1)})`;
            
            console.log(`  RSI ${threshold}: ${tag}`);
            
            if (result.activated) {
                summaryResults[threshold].activations++;
                summaryResults[threshold].totalPnl += (result.pnl || 0);
                summaryResults[threshold].trades.push({
                    stock: trade.stock,
                    pnl: result.pnl ? Math.round(result.pnl) : null,
                    actualPnl: trade.actualPnl,
                    diff: result.pnl ? Math.round(result.pnl - trade.actualPnl) : null,
                    activationTime: result.activationTime,
                    exitTime: result.exitTime
                });
            }
        }

        // Print RSI timeline for this trade
        const closes = candles5min.map(c => c.close);
        const rsiValues = calcRSI(closes);
        const entryTs = new Date(trade.entryTime).getTime();
        
        console.log(`\n  5-min RSI Timeline (post-entry):`);
        console.log(`  ${'Time'.padEnd(8)} ${'Close'.padStart(8)} ${'Low'.padStart(8)} ${'RSI'.padStart(7)}  Signal`);
        
        for (let i = 0; i < candles5min.length; i++) {
            if (candles5min[i].time.getTime() < entryTs) continue;
            const rsi = rsiValues[i];
            if (rsi === null) continue;
            
            const timeStr = candles5min[i].time.toLocaleTimeString('en-IN', { 
                hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' 
            });
            
            let signal = '';
            if (rsi >= 85) signal = '🔥 >=85';
            else if (rsi >= 84) signal = '⚡ >=84';
            else if (rsi >= 83) signal = '📈 >=83';
            else if (rsi >= 80) signal = '~80+';
            
            console.log(`  ${timeStr.padEnd(8)} ${candles5min[i].close.toFixed(2).padStart(8)} ${candles5min[i].low.toFixed(2).padStart(8)} ${rsi.toFixed(1).padStart(7)}  ${signal}`);
        }
    }

    // ── Summary ──
    console.log(`\n${'═'.repeat(80)}`);
    console.log('  SUMMARY: RSI TRAIL THRESHOLD COMPARISON');
    console.log('═'.repeat(80));

    for (const threshold of thresholds) {
        const r = summaryResults[threshold];
        console.log(`\n  RSI >= ${threshold}:`);
        console.log(`    Activations: ${r.activations} / ${trades.length} trades`);
        console.log(`    Total P&L from trail: ₹${r.totalPnl.toFixed(0)}`);
        console.log(`    Trades:`);
        for (const t of r.trades) {
            const diffStr = t.diff !== null ? (t.diff >= 0 ? `+${t.diff}` : `${t.diff}`) : 'N/A';
            console.log(`      ${t.stock.padEnd(15)} Trail: ₹${(t.pnl || 0).toString().padStart(6)} | Actual: ₹${t.actualPnl.toString().padStart(6)} | Diff: ₹${diffStr.padStart(6)} | Activated: ${t.activationTime} → Exit: ${t.exitTime}`);
        }
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log('  RECOMMENDATION');
    console.log('═'.repeat(80));

    // Find the best threshold
    let bestThreshold = 85;
    let bestScore = -Infinity;
    for (const threshold of thresholds) {
        const r = summaryResults[threshold];
        // Score = total improvement over actual exits, weighted by activation rate
        const avgImprovement = r.trades.reduce((sum, t) => sum + (t.diff || 0), 0);
        const score = avgImprovement; // simple: total P&L improvement
        console.log(`  RSI ${threshold}: ${r.activations} activations, total improvement: ₹${avgImprovement}`);
        if (score > bestScore) {
            bestScore = score;
            bestThreshold = threshold;
        }
    }
    console.log(`\n  ✅ Best threshold: RSI >= ${bestThreshold}`);
    console.log('═'.repeat(80));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
