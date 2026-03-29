// Analyze trade entry times and win rates to find optimal cutoff
const fs = require('fs');
const path = require('path');

// Load all trading data files
const dataFiles = [
  path.join(__dirname, '..', 'src', 'data', 'bollinger-trading-data.json'),
  path.join(__dirname, '..', 'src', 'data', 'bollinger-slot1.json'),
  path.join(__dirname, '..', 'src', 'data', 'bollinger-slot2.json'),
  path.join(__dirname, '..', 'src', 'data', 'bollinger-slot3.json'),
];

const cutoffDate = new Date('2025-02-03T00:00:00Z');
const allTrades = [];

for (const file of dataFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.tradeHistory) {
      for (const t of data.tradeHistory) {
        const entryDate = new Date(t.entryTime);
        if (entryDate >= cutoffDate && t.status === 'CLOSED') {
          allTrades.push(t);
        }
      }
    }
  } catch (e) {
    // skip missing files
  }
}

// Deduplicate by tradeId
const seen = new Set();
const trades = [];
for (const t of allTrades) {
  if (!seen.has(t.tradeId)) {
    seen.add(t.tradeId);
    trades.push(t);
  }
}

console.log(`\n=== ENTRY TIME ANALYSIS (Post Feb 3, ${trades.length} trades) ===\n`);

// Convert UTC date string to IST hours/minutes
// System is already in IST, so just use getHours/getMinutes directly
function toIST(utcDate) {
  return new Date(utcDate); // System locale handles IST
}

function getISTHours(utcDate) {
  // Use UTC time + 5:30 offset to get IST regardless of system timezone
  const d = new Date(utcDate);
  const utcMs = d.getTime();
  const istMs = utcMs + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  return { h: istDate.getUTCHours(), m: istDate.getUTCMinutes() };
}

function getTimeSlot(utcDate) {
  const { h, m } = getISTHours(utcDate);
  return `${String(h).padStart(2,'0')}:${m < 30 ? '00' : '30'}`;
}

function getHourMinute(utcDate) {
  const { h, m } = getISTHours(utcDate);
  return h * 60 + m;
}

function formatISTTime(utcDate) {
  const { h, m } = getISTHours(utcDate);
  const d = new Date(utcDate);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const s = istDate.getUTCSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${h12}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
}

function formatISTDate(utcDate) {
  const d = new Date(utcDate);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  return `${istDate.getUTCDate()}/${istDate.getUTCMonth()+1}/${istDate.getUTCFullYear()}`;
}

function getISTDay(utcDate) {
  const d = new Date(utcDate);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  return istDate.getUTCDay();
}

// 30-minute bucket analysis
const buckets = {};
for (const t of trades) {
  const slot = getTimeSlot(t.entryTime);
  if (!buckets[slot]) buckets[slot] = { wins: 0, losses: 0, totalPnl: 0, trades: [] };
  const isWin = t.pnl > 0;
  buckets[slot][isWin ? 'wins' : 'losses']++;
  buckets[slot].totalPnl += t.pnl;
  buckets[slot].trades.push({
    symbol: t.instrument?.name || t.instrument?.tradingsymbol || 'unknown',
    pnl: t.pnl,
    direction: t.direction,
    entryTime: formatISTTime(t.entryTime),
    date: formatISTDate(t.entryTime),
    dayOfWeek: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][getISTDay(t.entryTime)]
  });
}

console.log('=== 30-MIN BUCKETS ===');
console.log('Time Slot  | Trades | Wins | Losses | WR%   | Total P&L');
console.log('-'.repeat(65));
const sortedSlots = Object.keys(buckets).sort();
for (const slot of sortedSlots) {
  const b = buckets[slot];
  const total = b.wins + b.losses;
  const wr = ((b.wins / total) * 100).toFixed(1);
  console.log(`${slot}       | ${String(total).padStart(3)}    | ${String(b.wins).padStart(3)}  | ${String(b.losses).padStart(3)}    | ${wr.padStart(5)}% | ${b.totalPnl >= 0 ? '+' : ''}${b.totalPnl.toFixed(0)}`);
}

// Cumulative cutoff analysis - what if we blocked entries after time X?
console.log('\n=== CUTOFF ANALYSIS ===');
console.log('If we block entries after X, remaining trades look like:');
console.log('Cutoff  | Kept | Dropped | Kept WR% | Dropped WR% | Kept P&L   | Dropped P&L');
console.log('-'.repeat(90));

const cutoffTimes = [
  { label: '14:00', mins: 14*60 },
  { label: '14:15', mins: 14*60+15 },
  { label: '14:30', mins: 14*60+30 },
  { label: '14:45', mins: 14*60+45 },
  { label: '14:55', mins: 14*60+55 },
  { label: '15:00', mins: 15*60 },
  { label: '15:10', mins: 15*60+10 },
  { label: '15:15', mins: 15*60+15 },
  { label: '15:20', mins: 15*60+20 },
  { label: '15:30', mins: 15*60+30 },
];

for (const cutoff of cutoffTimes) {
  const kept = trades.filter(t => getHourMinute(t.entryTime) <= cutoff.mins);
  const dropped = trades.filter(t => getHourMinute(t.entryTime) > cutoff.mins);
  
  const kWins = kept.filter(t => t.pnl > 0).length;
  const kTotal = kept.length;
  const kPnl = kept.reduce((s, t) => s + t.pnl, 0);
  const kWR = kTotal > 0 ? ((kWins / kTotal) * 100).toFixed(1) : 'N/A';
  
  const dWins = dropped.filter(t => t.pnl > 0).length;
  const dTotal = dropped.length;
  const dPnl = dropped.reduce((s, t) => s + t.pnl, 0);
  const dWR = dTotal > 0 ? ((dWins / dTotal) * 100).toFixed(1) : 'N/A';
  
  console.log(`${cutoff.label}    | ${String(kTotal).padStart(3)}  | ${String(dTotal).padStart(3)}     | ${String(kWR).padStart(5)}%   | ${String(dWR).padStart(5)}%      | ${kPnl >= 0 ? '+' : ''}${kPnl.toFixed(0).padStart(8)} | ${dPnl >= 0 ? '+' : ''}${dPnl.toFixed(0).padStart(8)}`);
}

// Late entries detail (after 2:30 PM)
const lateMinutes = 14 * 60 + 30;
const lateTrades = trades.filter(t => getHourMinute(t.entryTime) > lateMinutes);
console.log(`\n=== LATE ENTRIES (After 2:30 PM): ${lateTrades.length} trades ===`);
console.log('Date       | Day  | Time     | Symbol         | Dir   | P&L');
console.log('-'.repeat(75));
lateTrades.sort((a, b) => getHourMinute(a.entryTime) - getHourMinute(b.entryTime));
for (const t of lateTrades) {
  const sym = (t.instrument?.name || t.instrument?.tradingsymbol || '???').padEnd(15);
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][getISTDay(t.entryTime)];
  console.log(`${formatISTDate(t.entryTime).padEnd(10)} | ${day}  | ${formatISTTime(t.entryTime)} | ${sym} | ${(t.direction || '?').padEnd(5)} | ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(0)}`);
}

// Friday-specific analysis
console.log('\n=== FRIDAY vs NON-FRIDAY (After 2:00 PM) ===');
const after2pm = trades.filter(t => getHourMinute(t.entryTime) > 14*60);
const friAfter2 = after2pm.filter(t => getISTDay(t.entryTime) === 5);
const nonFriAfter2 = after2pm.filter(t => getISTDay(t.entryTime) !== 5);

const friWins = friAfter2.filter(t => t.pnl > 0).length;
const friPnl = friAfter2.reduce((s, t) => s + t.pnl, 0);
const nfWins = nonFriAfter2.filter(t => t.pnl > 0).length;
const nfPnl = nonFriAfter2.reduce((s, t) => s + t.pnl, 0);

console.log(`Friday after 2PM:     ${friAfter2.length} trades, ${friWins} wins (${friAfter2.length > 0 ? ((friWins/friAfter2.length)*100).toFixed(1) : 'N/A'}%), P&L: ${friPnl >= 0 ? '+' : ''}${friPnl.toFixed(0)}`);
console.log(`Non-Friday after 2PM: ${nonFriAfter2.length} trades, ${nfWins} wins (${nonFriAfter2.length > 0 ? ((nfWins/nonFriAfter2.length)*100).toFixed(1) : 'N/A'}%), P&L: ${nfPnl >= 0 ? '+' : ''}${nfPnl.toFixed(0)}`);

// Overall stats for reference
const totalWins = trades.filter(t => t.pnl > 0).length;
const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
console.log(`\nOverall:              ${trades.length} trades, ${totalWins} wins (${((totalWins/trades.length)*100).toFixed(1)}%), P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}`);

// Finer-grained: 15-min buckets for afternoon
console.log('\n=== AFTERNOON 15-MIN BUCKETS (After 1:30 PM) ===');
const afternoonTrades = trades.filter(t => getHourMinute(t.entryTime) >= 13*60 + 30);
const fineBuckets = {};
for (const t of afternoonTrades) {
  const mins = getHourMinute(t.entryTime);
  const bucketStart = Math.floor(mins / 15) * 15;
  const h = Math.floor(bucketStart / 60);
  const m = bucketStart % 60;
  const label = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  if (!fineBuckets[label]) fineBuckets[label] = { wins: 0, losses: 0, pnl: 0 };
  const isWin = t.pnl > 0;
  fineBuckets[label][isWin ? 'wins' : 'losses']++;
  fineBuckets[label].pnl += t.pnl;
}

console.log('Bucket  | Trades | Wins | Losses | WR%   | P&L');
console.log('-'.repeat(55));
for (const slot of Object.keys(fineBuckets).sort()) {
  const b = fineBuckets[slot];
  const total = b.wins + b.losses;
  const wr = ((b.wins / total) * 100).toFixed(1);
  console.log(`${slot}    | ${String(total).padStart(3)}    | ${String(b.wins).padStart(3)}  | ${String(b.losses).padStart(3)}    | ${wr.padStart(5)}% | ${b.pnl >= 0 ? '+' : ''}${b.pnl.toFixed(0)}`);
}
