/**
 * One-time migration script: Add charges breakdown to all existing trades
 * 
 * For each trade:
 *   - grossPnl = old pnl (raw price diff × qty)
 *   - charges = { buy, sell, totalCharges } calculated from ChargesCalculator
 *   - pnl = grossPnl - charges.totalCharges (net P&L)
 * 
 * Capital is recalculated as: 65000 + Σ(net pnl)
 * 
 * Usage:
 *   node scripts/migrate-charges.js --dry-run    (preview only)
 *   node scripts/migrate-charges.js --apply       (write changes)
 */

const fs = require('fs');
const path = require('path');
const { calculateRoundTripCharges } = require('../dist/utils/ChargesCalculator');

const INITIAL_CAPITAL = 65000;
const SLOT_FILES = [1, 2, 3].map(i =>
  path.join(__dirname, '..', 'src', 'data', `bollinger-slot${i}.json`)
);

const dryRun = process.argv.includes('--dry-run');
const apply = process.argv.includes('--apply');

if (!dryRun && !apply) {
  console.log('Usage: node scripts/migrate-charges.js --dry-run | --apply');
  process.exit(1);
}

console.log(`\n=== Charges Migration ${dryRun ? '(DRY RUN)' : '(APPLYING)'} ===\n`);

for (const filePath of SLOT_FILES) {
  const slotName = path.basename(filePath);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const trades = data.tradeHistory || [];

  if (trades.length === 0) {
    console.log(`${slotName}: No trades, skipping.`);
    continue;
  }

  // Check if already migrated
  if (trades[0].grossPnl !== undefined) {
    console.log(`${slotName}: Already migrated (grossPnl exists), skipping.`);
    continue;
  }

  const oldCapital = data.capital;
  let totalCharges = 0;

  for (const trade of trades) {
    const grossPnl = trade.pnl; // Current pnl IS the gross
    const charges = calculateRoundTripCharges(trade.entryPrice, trade.exitPrice, trade.quantity);
    const netPnl = grossPnl - charges.totalCharges;

    trade.grossPnl = grossPnl;
    trade.charges = {
      buy: charges.buy,
      sell: charges.sell,
      totalCharges: charges.totalCharges,
    };
    trade.pnl = Math.round(netPnl * 100) / 100; // round to 2dp

    totalCharges += charges.totalCharges;
  }

  // Recalculate capital from scratch
  const newCapital = Math.round(
    (INITIAL_CAPITAL + trades.reduce((sum, t) => sum + t.pnl, 0)) * 100
  ) / 100;

  data.capital = newCapital;
  data.lastUpdated = new Date().toISOString();

  // Validate consistency
  const calcCheck = INITIAL_CAPITAL + trades.reduce((s, t) => s + t.pnl, 0);
  const consistent = Math.abs(newCapital - calcCheck) < 0.01;

  console.log(`${slotName}:`);
  console.log(`  Trades: ${trades.length}`);
  console.log(`  Total charges: Rs.${totalCharges.toFixed(2)}`);
  console.log(`  Old capital: Rs.${oldCapital.toFixed(2)}`);
  console.log(`  New capital: Rs.${newCapital.toFixed(2)}`);
  console.log(`  Capital drop: Rs.${(oldCapital - newCapital).toFixed(2)}`);
  console.log(`  Consistency check: ${consistent ? 'PASSED' : 'FAILED'}`);
  console.log();

  if (apply) {
    // Backup first
    const backupPath = filePath + '.pre-charges-backup';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
      console.log(`  Backup: ${path.basename(backupPath)}`);
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  Written: ${slotName}`);
    console.log();
  }
}

if (dryRun) {
  console.log('--- DRY RUN complete. Use --apply to write changes. ---\n');
} else {
  console.log('--- Migration complete. Files updated. ---\n');
}
