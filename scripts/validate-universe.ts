/**
 * Universe Validation Script
 * Validates all stocks in universe for symbol format and special characters
 * 
 * Run: npx ts-node scripts/validate-universe.ts
 */

import { UNIVERSE, getUniverseSize } from "../src/config/universe";
import { SECTOR_TOKENS } from "../src/config/sectorTokens";

interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalStocks: number;
    uniqueSymbols: number;
    uniqueSectors: number;
    duplicateSymbols: string[];
    specialCharSymbols: string[];
  };
}

/**
 * Main validation function
 */
function validateUniverse(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const symbolSet = new Set<string>();
  const duplicates: string[] = [];
  const specialChars: string[] = [];
  const sectorSet = new Set<number>();

  console.log("🔍 Validating Universe Configuration...\n");

  // 1. Check universe size
  const size = getUniverseSize();
  console.log(`📊 Total Stocks: ${size}`);
  if (size < 100) {
    errors.push(`Universe size (${size}) is less than required minimum (100)`);
  }

  // 2. Validate each stock
  for (const stock of UNIVERSE) {
    // Check for duplicate symbols
    if (symbolSet.has(stock.symbol)) {
      duplicates.push(stock.symbol);
      errors.push(`Duplicate symbol found: ${stock.symbol}`);
    }
    symbolSet.add(stock.symbol);

    // Check for special characters (specifically M&M, BAJAJ-AUTO, LT)
    if (stock.symbol.includes("&") || stock.symbol.includes("-")) {
      specialChars.push(stock.symbol);
    }

    // Check sector token exists
    if (!Object.values(SECTOR_TOKENS).includes(stock.sectorToken)) {
      errors.push(
        `Invalid sector token for ${stock.symbol}: ${stock.sectorToken}`,
      );
    }

    sectorSet.add(stock.sectorToken);

    // Validate lot size
    if (stock.lotSize <= 0) {
      errors.push(`Invalid lot size for ${stock.symbol}: ${stock.lotSize}`);
    }

    // Check symbol format (uppercase, no spaces)
    if (stock.symbol !== stock.symbol.toUpperCase()) {
      errors.push(`Symbol not in uppercase: ${stock.symbol}`);
    }

    if (stock.symbol.includes(" ")) {
      errors.push(`Symbol contains spaces: ${stock.symbol}`);
    }
  }

  // 3. Special character validation
  console.log(`\n⚠️ Special Character Symbols (${specialChars.length}):`);
  if (specialChars.length > 0) {
    for (const symbol of specialChars) {
      console.log(`   - ${symbol}`);
    }
    warnings.push(
      "Special character symbols found. Ensure regex patterns handle these correctly.",
    );
  }

  // 4. Critical symbols check
  const criticalSymbols = ["M&M", "BAJAJ-AUTO", "LT"];
  console.log(`\n✅ Critical Symbol Verification:`);
  for (const critical of criticalSymbols) {
    const found = UNIVERSE.find((s) => s.symbol === critical);
    if (found) {
      console.log(
        `   ✓ ${critical}: Found (Sector: ${found.sector}, LotSize: ${found.lotSize})`,
      );
    } else {
      errors.push(`Critical symbol missing: ${critical}`);
      console.log(`   ✗ ${critical}: NOT FOUND`);
    }
  }

  // 5. Sector coverage
  console.log(`\n📊 Sector Coverage:`);
  console.log(`   Unique Sectors: ${sectorSet.size}`);
  console.log(
    `   Total Sector Tokens: ${Object.keys(SECTOR_TOKENS).length}`,
  );

  // 6. Print stats
  const stats = {
    totalStocks: size,
    uniqueSymbols: symbolSet.size,
    uniqueSectors: sectorSet.size,
    duplicateSymbols: duplicates,
    specialCharSymbols: specialChars,
  };

  // 7. Test symbol extraction regex
  console.log(`\n🧪 Testing Symbol Extraction Regex:`);
  const testOptionSymbols = [
    "M&M26FEB2500CE",
    "BAJAJ-AUTO26FEB2500CE",
    "LT26FEB2500CE",
    "RELIANCE26FEB2500CE",
    "TCS26FEB2500PE",
  ];

  for (const optionSymbol of testOptionSymbols) {
    const match = optionSymbol.match(/^([A-Z&-]+)\d{2}[A-Z]{3}/);
    const extracted = match ? match[1] : "FAILED";
    const expected = UNIVERSE.find((s) => optionSymbol.startsWith(s.symbol));

    if (expected && extracted === expected.symbol) {
      console.log(`   ✓ ${optionSymbol} → ${extracted}`);
    } else {
      console.log(
        `   ✗ ${optionSymbol} → ${extracted} (Expected: ${expected?.symbol || "UNKNOWN"})`,
      );
      errors.push(`Regex failed to extract: ${optionSymbol}`);
    }
  }

  // 8. Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 VALIDATION SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total Stocks: ${stats.totalStocks}`);
  console.log(`Unique Symbols: ${stats.uniqueSymbols}`);
  console.log(`Duplicate Symbols: ${stats.duplicateSymbols.length}`);
  console.log(`Special Character Symbols: ${stats.specialCharSymbols.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`${"=".repeat(60)}\n`);

  const success = errors.length === 0;

  if (success) {
    console.log("✅ Universe validation PASSED\n");
  } else {
    console.log("❌ Universe validation FAILED\n");
    console.log("Errors:");
    errors.forEach((err, i) => console.log(`   ${i + 1}. ${err}`));
  }

  if (warnings.length > 0) {
    console.log("\n⚠️ Warnings:");
    warnings.forEach((warn, i) => console.log(`   ${i + 1}. ${warn}`));
  }

  return { success, errors, warnings, stats };
}

// Run validation
if (require.main === module) {
  const result = validateUniverse();
  process.exit(result.success ? 0 : 1);
}

export { validateUniverse };
