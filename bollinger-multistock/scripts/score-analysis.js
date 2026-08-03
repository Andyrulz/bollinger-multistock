/**
 * Score Analysis Script
 * Matches scanner scores to trade entries and analyzes scoring patterns
 * for winners vs losers. Temporary analysis script.
 */
const fs = require('fs');
const path = require('path');

// ========== STEP 1: Parse all scanner scores from logs ==========
const logDir = path.join(__dirname, '..', 'logs');
const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort();

const allScores = []; // {date, time, symbol, score, base, tac, bias, T, M, V, S, FB, RV, PX, RA, SQ, GW}

logFiles.forEach(lf => {
  const raw = fs.readFileSync(path.join(logDir, lf), 'utf8');
  const rawLines = raw.split('\n');
  // Join continuation lines (lines not starting with date)
  const joinedLines = [];
  rawLines.forEach(line => {
    if (/^\d{4}-\d{2}-\d{2}/.test(line)) {
      joinedLines.push(line);
    } else if (joinedLines.length > 0) {
      joinedLines[joinedLines.length - 1] += ' ' + line.trim();
    }
  });

  joinedLines.forEach(line => {
    const m = line.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}.*?\d+\.\s+([\w&-]+):\s+Score=(\d+\.?\d*)\s+\(Base:(\d+\.?\d*)\s*\+\s*Tac:(\d+\.?\d*)\)\s+\[(LONG|SHORT)\]\s*\|\s*T:(\d+\.?\d*)\s+M:(\d+\.?\d*)\s+V:(\d+\.?\d*)\s+S:(\d+\.?\d*)\s*\|\s*Tac:\s*FB:(\d+)\s+RV:(\d+)\s+PX:(\d+\.?\d*)\s+RA:(\d+)\s+SQ:(\d+\.?\d*)\s+GW:(\d+\.?\d*)/);
    if (m) {
      allScores.push({
        date: m[1], time: m[2], symbol: m[3],
        score: parseFloat(m[4]), base: parseFloat(m[5]), tac: parseFloat(m[6]),
        bias: m[7],
        T: parseFloat(m[8]), M: parseFloat(m[9]), V: parseFloat(m[10]), S: parseFloat(m[11]),
        FB: parseInt(m[12]), RV: parseInt(m[13]), PX: parseFloat(m[14]), RA: parseInt(m[15]),
        SQ: parseFloat(m[16]), GW: parseFloat(m[17]),
      });
    }
  });
});

console.log(`Total score entries parsed: ${allScores.length}`);

// ========== STEP 2: Load all trades ==========
const dataDir = path.join(__dirname, '..', 'src', 'data');
const trades = [];

for (let i = 1; i <= 3; i++) {
  const fp = path.join(dataDir, `bollinger-slot${i}.json`);
  if (!fs.existsSync(fp)) continue;
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (data.tradeHistory) {
    data.tradeHistory.forEach(t => {
      if ((t.status === 'closed' || t.status === 'CLOSED') && t.entryTime && t.pnl !== undefined) {
        trades.push({ ...t, slot: i });
      }
    });
  }
}
console.log(`Total trades loaded: ${trades.length}`);

// ========== STEP 3: Match scores to trades ==========
// For each trade, find the scanner score closest in time BEFORE the entry
// (scanner runs, then deploy happens shortly after)

function findScore(symbol, entryTime, direction) {
  const entryDate = new Date(entryTime);
  // Convert UTC to IST (+5:30)
  const istMs = entryDate.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const entryDateStr = istDate.toISOString().slice(0, 10);
  
  // Normalize symbol - strip "NFO:" prefix, extract base name
  let baseSymbol = symbol;
  if (baseSymbol.includes(':')) baseSymbol = baseSymbol.split(':')[1];
  // NFO symbols like "TATAMOTORS26FEB1100CE" - extract base
  // Trade instrument.name might be different format
  
  let bestMatch = null;
  let bestTimeDiff = Infinity;
  const entryMinutes = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  
  // Look for scores on the same date, within 60 minutes before entry
  for (const s of allScores) {
    if (s.date !== entryDateStr) continue;
    if (s.bias !== direction) continue;
    
    // Check if the score's symbol matches the trade's base instrument
    if (s.symbol.toUpperCase() !== baseSymbol.toUpperCase()) {
      continue;
    }
    
    // Time comparison (IST)
    const [sh, sm] = s.time.split(':').map(Number);
    const scoreMinutes = sh * 60 + sm;
    
    // Score should be at most 60 min before entry, or up to 10 min after (deploy delay)
    const diff = entryMinutes - scoreMinutes;
    if (diff >= -10 && diff <= 60 && Math.abs(diff) < bestTimeDiff) {
      bestTimeDiff = Math.abs(diff);
      bestMatch = s;
    }
  }
  
  // If no close match, take closest same-day match (any time) as fallback
  if (!bestMatch) {
    for (const s of allScores) {
      if (s.date !== entryDateStr) continue;
      if (s.bias !== direction) continue;
      if (s.symbol.toUpperCase() !== baseSymbol.toUpperCase()) continue;
      
      const [sh, sm] = s.time.split(':').map(Number);
      const scoreMinutes = sh * 60 + sm;
      const diff = Math.abs(entryMinutes - scoreMinutes);
      if (diff < bestTimeDiff) {
        bestTimeDiff = diff;
        bestMatch = s;
      }
    }
  }
  
  return bestMatch;
}

let matched = 0;
let unmatched = 0;
const enrichedTrades = [];

for (const t of trades) {
  // Get underlying symbol from instrument
  const instName = t.instrument?.name || t.instrumentName || '';
  // Try multiple ways to extract the base symbol
  let baseSymbol = instName;
  
  // If instrument object has tradingsymbol like "TATAMOTORS26FEB1100CE"
  const tradingSym = t.instrument?.tradingsymbol || '';
  
  // Extract base from trading symbol (remove date+strike+CE/PE)
  // Also try instrument.name directly
  let extracted = t.instrument?.name || tradingSym.replace(/\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d+[CP]E$/i, '');
  if (!extracted) extracted = instName;
  
  const score = findScore(extracted, t.entryTime, t.direction);
  
  if (score) {
    matched++;
    enrichedTrades.push({ ...t, scanScore: score, baseSymbol: extracted });
  } else {
    unmatched++;
    // Debug: show what we tried
    if (unmatched <= 5) {
      const d = new Date(t.entryTime);
      console.log(`  UNMATCHED: ${extracted} (${tradingSym}) @ ${d.toISOString().slice(0,16)} ${t.direction}`);
    }
  }
}

console.log(`Matched: ${matched}, Unmatched: ${unmatched}`);

if (enrichedTrades.length === 0) {
  console.log('\n=== DEBUG: Sample trade structure ===');
  if (trades.length > 0) {
    const t = trades[0];
    console.log('Keys:', Object.keys(t));
    console.log('instrument:', JSON.stringify(t.instrument)?.slice(0, 300));
    console.log('entryTime:', t.entryTime);
    console.log('direction:', t.direction);
  }
  console.log('\n=== DEBUG: Sample scores ===');
  allScores.slice(0, 3).forEach(s => console.log(s.symbol, s.date, s.time, s.bias));
  process.exit(0);
}

// ========== STEP 4: Analyze Winners vs Losers ==========
const winners = enrichedTrades.filter(t => t.pnl > 0);
const losers = enrichedTrades.filter(t => t.pnl <= 0);

function avg(arr) { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function pct(n, d) { return d === 0 ? '0%' : (n / d * 100).toFixed(1) + '%'; }

function analyzeGroup(group, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label} (n=${group.length}, Avg PnL: ₹${avg(group.map(t => t.pnl)).toFixed(0)})`);
  console.log(`${'='.repeat(60)}`);
  
  const scores = group.map(t => t.scanScore);
  
  console.log(`\n  Overall Score: ${avg(scores.map(s => s.score)).toFixed(2)}`);
  console.log(`  Base Score:    ${avg(scores.map(s => s.base)).toFixed(2)}`);
  console.log(`  Tactical:      ${avg(scores.map(s => s.tac)).toFixed(2)}`);
  
  console.log(`\n  --- Base Components ---`);
  console.log(`  Trend (T):     ${avg(scores.map(s => s.T)).toFixed(2)} / 3.0`);
  console.log(`  Momentum (M):  ${avg(scores.map(s => s.M)).toFixed(2)} / 3.5`);
  console.log(`  Volume (V):    ${avg(scores.map(s => s.V)).toFixed(2)} / 2.0`);
  console.log(`  Sector (S):    ${avg(scores.map(s => s.S)).toFixed(2)} / 2.0`);
  
  console.log(`\n  --- Tactical Bonuses ---`);
  console.log(`  FB (Fresh Breakout):  avg=${avg(scores.map(s => s.FB)).toFixed(2)}  hit=${pct(scores.filter(s => s.FB > 0).length, scores.length)}`);
  console.log(`  RV (RVOL Surge):      avg=${avg(scores.map(s => s.RV)).toFixed(2)}  hit=${pct(scores.filter(s => s.RV > 0).length, scores.length)}`);
  console.log(`  PX (Proximity):       avg=${avg(scores.map(s => s.PX)).toFixed(2)}  hit=${pct(scores.filter(s => s.PX > 0).length, scores.length)}`);
  console.log(`  RA (RSI Accel):       avg=${avg(scores.map(s => s.RA)).toFixed(2)}  hit=${pct(scores.filter(s => s.RA > 0).length, scores.length)}`);
  console.log(`  SQ (Squeeze Grad):    avg=${avg(scores.map(s => s.SQ)).toFixed(2)}  hit=${pct(scores.filter(s => s.SQ > 0).length, scores.length)}`);
  console.log(`  GW (Gamma Wall):      avg=${avg(scores.map(s => s.GW)).toFixed(2)}  hit=${pct(scores.filter(s => s.GW > 0).length, scores.length)}`);
}

analyzeGroup(winners, 'WINNERS');
analyzeGroup(losers, 'LOSERS');
analyzeGroup(enrichedTrades, 'ALL TRADES');

// ========== STEP 5: Score Quartile Analysis ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`SCORE QUARTILE ANALYSIS`);
console.log(`${'='.repeat(60)}`);

const sorted = [...enrichedTrades].sort((a, b) => a.scanScore.score - b.scanScore.score);
const q = Math.floor(sorted.length / 4);

for (let i = 0; i < 4; i++) {
  const start = i * q;
  const end = i === 3 ? sorted.length : (i + 1) * q;
  const slice = sorted.slice(start, end);
  const wins = slice.filter(t => t.pnl > 0).length;
  const totalPnl = slice.reduce((a, t) => a + t.pnl, 0);
  const minScore = slice[0].scanScore.score;
  const maxScore = slice[slice.length - 1].scanScore.score;
  console.log(`  Q${i + 1} (${minScore.toFixed(1)}-${maxScore.toFixed(1)}): ${slice.length} trades, WR=${pct(wins, slice.length)}, PnL=₹${totalPnl.toFixed(0)}`);
}

// ========== STEP 6: Component-level correlation ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`COMPONENT DIFFERENTIAL (Winners - Losers)`);
console.log(`${'='.repeat(60)}`);

if (winners.length > 0 && losers.length > 0) {
  const components = ['T', 'M', 'V', 'S', 'FB', 'RV', 'PX', 'RA', 'SQ', 'GW'];
  components.forEach(c => {
    const wAvg = avg(winners.map(t => t.scanScore[c]));
    const lAvg = avg(losers.map(t => t.scanScore[c]));
    const diff = wAvg - lAvg;
    const arrow = diff > 0.1 ? '▲ WINNERS' : diff < -0.1 ? '▼ LOSERS' : '~ NEUTRAL';
    console.log(`  ${c.padEnd(4)}: W=${wAvg.toFixed(2)} L=${lAvg.toFixed(2)} Δ=${diff > 0 ? '+' : ''}${diff.toFixed(2)} ${arrow}`);
  });
}

// ========== STEP 7: Tactical Bonus Combinatorics ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`TACTICAL BONUS COMBINATIONS`);
console.log(`${'='.repeat(60)}`);

const combos = {};
enrichedTrades.forEach(t => {
  const s = t.scanScore;
  const active = [];
  if (s.FB > 0) active.push('FB');
  if (s.RV > 0) active.push('RV');
  if (s.PX > 0) active.push('PX');
  if (s.RA > 0) active.push('RA');
  if (s.SQ > 0) active.push('SQ');
  if (s.GW > 0) active.push('GW');
  const key = active.length === 0 ? 'NONE' : active.join('+');
  if (!combos[key]) combos[key] = { wins: 0, losses: 0, pnl: 0 };
  if (t.pnl > 0) combos[key].wins++;
  else combos[key].losses++;
  combos[key].pnl += t.pnl;
});

const comboEntries = Object.entries(combos).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));
comboEntries.forEach(([combo, data]) => {
  const total = data.wins + data.losses;
  if (total >= 2) {
    console.log(`  ${combo.padEnd(25)} n=${total.toString().padStart(3)} WR=${pct(data.wins, total).padStart(6)} PnL=₹${data.pnl.toFixed(0)}`);
  }
});

// ========== STEP 8: Top/Bottom Trades Detail ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`TOP 10 WINNERS - Score Breakdown`);
console.log(`${'='.repeat(60)}`);

const byPnl = [...enrichedTrades].sort((a, b) => b.pnl - a.pnl);
byPnl.slice(0, 10).forEach((t, i) => {
  const s = t.scanScore;
  console.log(`  ${i + 1}. ${t.baseSymbol.padEnd(15)} PnL=₹${t.pnl.toFixed(0).padStart(7)} Score=${s.score.toFixed(1)} [${s.bias}] T:${s.T} M:${s.M} V:${s.V} S:${s.S} | FB:${s.FB} RV:${s.RV} PX:${s.PX} RA:${s.RA} SQ:${s.SQ} GW:${s.GW}`);
});

console.log(`\n${'='.repeat(60)}`);
console.log(`TOP 10 LOSERS - Score Breakdown`);
console.log(`${'='.repeat(60)}`);

byPnl.slice(-10).reverse().forEach((t, i) => {
  const s = t.scanScore;
  console.log(`  ${i + 1}. ${t.baseSymbol.padEnd(15)} PnL=₹${t.pnl.toFixed(0).padStart(7)} Score=${s.score.toFixed(1)} [${s.bias}] T:${s.T} M:${s.M} V:${s.V} S:${s.S} | FB:${s.FB} RV:${s.RV} PX:${s.PX} RA:${s.RA} SQ:${s.SQ} GW:${s.GW}`);
});

// ========== STEP 9: Direction Analysis ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`DIRECTION-SPECIFIC SCORING`);
console.log(`${'='.repeat(60)}`);

['LONG', 'SHORT'].forEach(dir => {
  const subset = enrichedTrades.filter(t => t.direction === dir);
  const w = subset.filter(t => t.pnl > 0);
  const l = subset.filter(t => t.pnl <= 0);
  console.log(`\n  ${dir}: ${subset.length} trades, WR=${pct(w.length, subset.length)}, PnL=₹${subset.reduce((a, t) => a + t.pnl, 0).toFixed(0)}`);
  if (w.length > 0 && l.length > 0) {
    const components = ['T', 'M', 'V', 'S', 'FB', 'RV', 'PX', 'RA', 'SQ', 'GW'];
    components.forEach(c => {
      const wAvg = avg(w.map(t => t.scanScore[c]));
      const lAvg = avg(l.map(t => t.scanScore[c]));
      const diff = wAvg - lAvg;
      if (Math.abs(diff) > 0.05) {
        const arrow = diff > 0 ? '▲' : '▼';
        console.log(`    ${c.padEnd(4)}: W=${wAvg.toFixed(2)} L=${lAvg.toFixed(2)} Δ=${diff > 0 ? '+' : ''}${diff.toFixed(2)} ${arrow}`);
      }
    });
  }
});

// ========== STEP 10: Base Score Threshold Analysis ==========
console.log(`\n${'='.repeat(60)}`);
console.log(`BASE SCORE THRESHOLD ANALYSIS`);
console.log(`${'='.repeat(60)}`);

[6, 7, 8, 9, 10].forEach(threshold => {
  const above = enrichedTrades.filter(t => t.scanScore.base >= threshold);
  const below = enrichedTrades.filter(t => t.scanScore.base < threshold);
  const aWins = above.filter(t => t.pnl > 0).length;
  const bWins = below.filter(t => t.pnl > 0).length;
  console.log(`  Base >= ${threshold}: n=${above.length} WR=${pct(aWins, above.length)} PnL=₹${above.reduce((a, t) => a + t.pnl, 0).toFixed(0)}`);
  console.log(`  Base <  ${threshold}: n=${below.length} WR=${pct(bWins, below.length)} PnL=₹${below.reduce((a, t) => a + t.pnl, 0).toFixed(0)}`);
  console.log('');
});
