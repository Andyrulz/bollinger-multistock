/**
 * Universe Generator Script
 * Downloads Zerodha's public instruments list and generates universe.ts with tokens
 * Run: npm run generate-universe
 * 
 * IMPORTANT: Lot sizes are fetched from NFO segment (futures), not NSE equity
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';

// Your target universe (names & sectors only) - Full list per spec
const TARGETS = [
  // --- BANKS (High Liquidity) ---
  { symbol: "HDFCBANK", sector: "NIFTY BANK" },
  { symbol: "ICICIBANK", sector: "NIFTY BANK" },
  { symbol: "SBIN", sector: "NIFTY PSU BANK" },
  { symbol: "AXISBANK", sector: "NIFTY BANK" },
  { symbol: "KOTAKBANK", sector: "NIFTY BANK" },
  { symbol: "INDUSINDBK", sector: "NIFTY BANK" },
  { symbol: "BANKBARODA", sector: "NIFTY PSU BANK" },
  { symbol: "PNB", sector: "NIFTY PSU BANK" },
  { symbol: "CANBK", sector: "NIFTY PSU BANK" },      // Added - was missing
  { symbol: "AUBANK", sector: "NIFTY BANK" },          // Added - was missing
  { symbol: "FEDERALBNK", sector: "NIFTY BANK" },
  { symbol: "IDFCFIRSTB", sector: "NIFTY BANK" },
  { symbol: "BANDHANBNK", sector: "NIFTY BANK" },      // Added - was missing
  
  // --- FINANCIAL SERVICES (Volatile) ---
  { symbol: "BAJFINANCE", sector: "NIFTY FIN SERVICE" },
  { symbol: "BAJAJFINSV", sector: "NIFTY FIN SERVICE" },
  { symbol: "CHOLAFIN", sector: "NIFTY FIN SERVICE" },   // Added - was missing
  { symbol: "SHRIRAMFIN", sector: "NIFTY FIN SERVICE" }, // Added - was missing
  { symbol: "RECLTD", sector: "NIFTY FIN SERVICE" },
  { symbol: "PFC", sector: "NIFTY FIN SERVICE" },        // Added - was missing
  { symbol: "SBILIFE", sector: "NIFTY FIN SERVICE" },
  { symbol: "HDFCLIFE", sector: "NIFTY FIN SERVICE" },
  { symbol: "MUTHOOTFIN", sector: "NIFTY FIN SERVICE" },
  
  // --- IT (Trend Followers) ---
  { symbol: "TCS", sector: "NIFTY IT" },
  { symbol: "INFY", sector: "NIFTY IT" },
  { symbol: "HCLTECH", sector: "NIFTY IT" },
  { symbol: "TECHM", sector: "NIFTY IT" },
  { symbol: "WIPRO", sector: "NIFTY IT" },
  { symbol: "LTIM", sector: "NIFTY IT" },
  { symbol: "COFORGE", sector: "NIFTY IT" },
  { symbol: "PERSISTENT", sector: "NIFTY IT" },
  { symbol: "MPHASIS", sector: "NIFTY IT" },             // Added - was missing
  
  // --- AUTO (Cyclical Momentum) ---
  { symbol: "TMPV", sector: "NIFTY AUTO" },              // TATAMOTORS new symbol
  { symbol: "MARUTI", sector: "NIFTY AUTO" },
  { symbol: "M&M", sector: "NIFTY AUTO" },
  { symbol: "BAJAJ-AUTO", sector: "NIFTY AUTO" },
  { symbol: "EICHERMOT", sector: "NIFTY AUTO" },
  { symbol: "TVSMOTOR", sector: "NIFTY AUTO" },
  { symbol: "HEROMOTOCO", sector: "NIFTY AUTO" },
  { symbol: "ASHOKLEY", sector: "NIFTY AUTO" },          // Added - was missing
  { symbol: "BHARATFORG", sector: "NIFTY AUTO" },        // Added - was missing
  // REMOVED: BALKRISIND - No F&O options available
  // REMOVED: MRF - ₹1L+ share price, massive bid-ask spread, unsuitable for momentum scalping
  // REMOVED: APOLLOTYRE - No F&O options available
  
  // --- METAL (High Beta/Commodity) ---
  { symbol: "TATASTEEL", sector: "NIFTY METAL" },
  { symbol: "JSWSTEEL", sector: "NIFTY METAL" },
  { symbol: "HINDALCO", sector: "NIFTY METAL" },
  { symbol: "VEDL", sector: "NIFTY METAL" },
  { symbol: "JINDALSTEL", sector: "NIFTY METAL" },
  { symbol: "SAIL", sector: "NIFTY METAL" },
  { symbol: "NMDC", sector: "NIFTY METAL" },
  { symbol: "NATIONALUM", sector: "NIFTY METAL" },
  { symbol: "ADANIENT", sector: "NIFTY METAL" },
  
  // --- ENERGY & OIL ---
  { symbol: "RELIANCE", sector: "NIFTY ENERGY" },
  { symbol: "ONGC", sector: "NIFTY ENERGY" },
  { symbol: "NTPC", sector: "NIFTY ENERGY" },
  { symbol: "POWERGRID", sector: "NIFTY ENERGY" },
  { symbol: "COALINDIA", sector: "NIFTY ENERGY" },
  { symbol: "BPCL", sector: "NIFTY ENERGY" },
  { symbol: "IOC", sector: "NIFTY ENERGY" },
  { symbol: "TATAPOWER", sector: "NIFTY ENERGY" },
  { symbol: "ADANIGREEN", sector: "NIFTY ENERGY" },      // Added - was missing
  { symbol: "GAIL", sector: "NIFTY ENERGY" },
  
  // --- PHARMA (Defensive/Trend) ---
  { symbol: "SUNPHARMA", sector: "NIFTY PHARMA" },
  { symbol: "DRREDDY", sector: "NIFTY PHARMA" },
  { symbol: "CIPLA", sector: "NIFTY PHARMA" },
  { symbol: "DIVISLAB", sector: "NIFTY PHARMA" },
  { symbol: "APOLLOHOSP", sector: "NIFTY PHARMA" },
  { symbol: "AUROPHARMA", sector: "NIFTY PHARMA" },
  { symbol: "LUPIN", sector: "NIFTY PHARMA" },
  { symbol: "ALKEM", sector: "NIFTY PHARMA" },           // Added - was missing
  { symbol: "TORNTPHARM", sector: "NIFTY PHARMA" },
  { symbol: "BIOCON", sector: "NIFTY PHARMA" },
  { symbol: "ZYDUSLIFE", sector: "NIFTY PHARMA" },
  
  // --- FMCG (Consumption) ---
  { symbol: "ITC", sector: "NIFTY FMCG" },
  { symbol: "HINDUNILVR", sector: "NIFTY FMCG" },
  { symbol: "BRITANNIA", sector: "NIFTY FMCG" },
  { symbol: "TATACONSUM", sector: "NIFTY FMCG" },        // Added - was missing
  { symbol: "DABUR", sector: "NIFTY FMCG" },
  { symbol: "MARICO", sector: "NIFTY FMCG" },
  { symbol: "GODREJCP", sector: "NIFTY FMCG" },
  { symbol: "COLPAL", sector: "NIFTY FMCG" },
  
  // --- INFRA / DEFENSE / CAPITAL GOODS ---
  { symbol: "LT", sector: "NIFTY INFRA" },
  { symbol: "BHARTIARTL", sector: "NIFTY INFRA" },
  { symbol: "ULTRACEMCO", sector: "NIFTY INFRA" },
  { symbol: "SIEMENS", sector: "NIFTY INFRA" },
  { symbol: "ABB", sector: "NIFTY INFRA" },
  { symbol: "HAL", sector: "NIFTY INFRA" },
  { symbol: "BEL", sector: "NIFTY INFRA" },
  { symbol: "INDIGO", sector: "NIFTY INFRA" },           // Added - was missing
  { symbol: "CUMMINSIND", sector: "NIFTY INFRA" },
  { symbol: "BOSCHLTD", sector: "NIFTY INFRA" },
  { symbol: "AMBUJACEM", sector: "NIFTY INFRA" },
  // REMOVED: ACC - No F&O options available
  { symbol: "SHREECEM", sector: "NIFTY INFRA" },
  { symbol: "ADANIPORTS", sector: "NIFTY INFRA" },
  { symbol: "CONCOR", sector: "NIFTY INFRA" },
  
  // --- REALTY (High Momentum) ---
  { symbol: "DLF", sector: "NIFTY REALTY" },
  { symbol: "GODREJPROP", sector: "NIFTY REALTY" },      // Added - was missing
  { symbol: "OBEROIRLTY", sector: "NIFTY REALTY" },
  { symbol: "INDHOTEL", sector: "NIFTY REALTY" },
  
  // --- CONSUMER DURABLES / RETAIL ---
  { symbol: "TITAN", sector: "NIFTY CONSUMER DURABLES" },
  { symbol: "ASIANPAINT", sector: "NIFTY CONSUMER DURABLES" },
  { symbol: "TRENT", sector: "NIFTY CONSUMER DURABLES" }, // Added - was missing
  { symbol: "HAVELLS", sector: "NIFTY CONSUMER DURABLES" },
  { symbol: "VOLTAS", sector: "NIFTY CONSUMER DURABLES" },
  // REMOVED: BERGEPAINT - No F&O options available
  { symbol: "PIDILITIND", sector: "NIFTY CONSUMER DURABLES" },
  { symbol: "CROMPTON", sector: "NIFTY CONSUMER DURABLES" },
  
  // --- CHEMICALS / OTHERS ---
  { symbol: "UPL", sector: "NIFTY 50" },                 // NIFTY CHEM not available, map to NIFTY 50
  { symbol: "PIIND", sector: "NIFTY 50" },               // Added - was missing
  { symbol: "SRF", sector: "NIFTY 50" },                 // Added - was missing
  { symbol: "GRASIM", sector: "NIFTY 50" },
  { symbol: "DMART", sector: "NIFTY 50" },
];

// Sector token map (hardcoded - these rarely change)
const SECTOR_TOKENS: Record<string, number> = {
  "NIFTY 50": 256265,
  "NIFTY BANK": 260105,
  "NIFTY IT": 259849,
  "NIFTY AUTO": 257289,
  "NIFTY METAL": 258313,
  "NIFTY ENERGY": 256521,
  "NIFTY PHARMA": 258569,
  "NIFTY FMCG": 257033,
  "NIFTY PSU BANK": 261129,
  "NIFTY FIN SERVICE": 257545,
  "NIFTY INFRA": 257801,
  "NIFTY REALTY": 260617,
  "NIFTY CONSUMER DURABLES": 261641,
};

async function generateUniverse() {
  console.log("📂 Reading instruments from local CSV file...");
  
  const nseInstruments: any[] = [];
  const nfoInstruments: any[] = [];
  const fs = await import('fs');
  const path = await import('path');
  
  try {
    // Use local CSV file from data/ folder
    const csvPath = path.join(__dirname, '../data/instruments.csv');
    
    if (!fs.existsSync(csvPath)) {
      console.error('❌ instruments.csv not found at:', csvPath);
      console.error('💡 Download from: https://api.kite.trade/instruments');
      console.error('💡 Save as: data/instruments.csv');
      process.exit(1);
    }
    
    console.log(`✅ Found CSV at: ${csvPath}`);

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row: any) => {
        // Collect NSE Equity for instrument tokens
        if (row.exchange === 'NSE' && row.segment === 'NSE') {
          nseInstruments.push(row);
        }
        // Collect NFO Futures for lot sizes (these have actual lot sizes)
        if (row.exchange === 'NFO' && row.segment === 'NFO-FUT') {
          nfoInstruments.push(row);
        }
      })
      .on('end', () => {
        console.log(`✅ Parsed ${nseInstruments.length} NSE instruments from CSV`);
        console.log(`✅ Parsed ${nfoInstruments.length} NFO-FUT instruments from CSV`);
        processList(nseInstruments, nfoInstruments);
      })
      .on('error', (error: Error) => {
        console.error('❌ CSV parsing error:', error);
        process.exit(1);
      });
  } catch (error) {
    console.error('❌ File read failed:', error);
    process.exit(1);
  }
}

function processList(nseInstruments: any[], nfoInstruments: any[]) {
  const finalUniverse: any[] = [];
  const missing: string[] = [];
  const noFnoLotSize: string[] = [];

  for (const target of TARGETS) {
    // Find matching NSE instrument for token
    const nseMatch = nseInstruments.find(i => i.tradingsymbol === target.symbol);

    if (nseMatch) {
      // Find matching NFO futures for lot size
      // NFO futures have format like "HDFCBANK26JANFUT" where name = "HDFCBANK"
      const nfoMatch = nfoInstruments.find(i => i.name === target.symbol);
      
      let lotSize = 1; // Default fallback
      if (nfoMatch) {
        lotSize = parseInt(nfoMatch.lot_size) || 1;
      } else {
        // Stock doesn't have F&O - will use default lot size
        noFnoLotSize.push(target.symbol);
      }

      finalUniverse.push({
        symbol: target.symbol,
        instrumentToken: parseInt(nseMatch.instrument_token),
        sector: target.sector,
        sectorToken: SECTOR_TOKENS[target.sector] || 256265,
        lotSize: lotSize
      });
    } else {
      missing.push(target.symbol);
    }
  }

  // Generate TypeScript file content
  const fileContent = `/**
 * AUTO-GENERATED UNIVERSE CONFIG
 * Generated on: ${new Date().toISOString()}
 * Source: Zerodha Public Instruments List
 * 
 * ⚠️ DO NOT EDIT MANUALLY
 * To update: Run 'npm run generate-universe'
 */

export interface UniverseStock {
  symbol: string;
  instrumentToken: number;
  sector: string;
  sectorToken: number;
  lotSize: number;
}

export const UNIVERSE: UniverseStock[] = ${JSON.stringify(finalUniverse, null, 2)};
`;

  // Write to file
  const outputPath = path.join(__dirname, '../src/config/universe.ts');
  fs.writeFileSync(outputPath, fileContent);

  console.log(`\n✨ Success! Universe generated with ${finalUniverse.length} stocks.`);
  console.log(`📁 Saved to: ${outputPath}`);
  
  if (missing.length > 0) {
    console.warn(`\n⚠️  WARNING: Could not find tokens for ${missing.length} symbols:`);
    console.warn(missing.join(', '));
    console.warn("\n💡 Possible reasons:");
    console.warn("   - Symbol spelling (e.g., 'M&M' exact format matters)");
    console.warn("   - Stock delisted or suspended");
    console.warn("   - Symbol recently changed");
    process.exit(1);
  }
  
  if (noFnoLotSize.length > 0) {
    console.warn(`\n⚠️  INFO: ${noFnoLotSize.length} stocks have no F&O (using default lot size 1):`);
    console.warn(noFnoLotSize.join(', '));
    console.warn("   These stocks may not be tradeable in options.");
  }
  
  console.log('\n✅ All symbols matched successfully!');
  console.log(`\n📊 Summary:`);
  console.log(`   Total stocks: ${finalUniverse.length}`);
  console.log(`   Stocks with F&O lot sizes: ${finalUniverse.length - noFnoLotSize.length}`);
  console.log(`   Sectors covered: ${new Set(finalUniverse.map(s => s.sector)).size}`);
  console.log(`\n🚀 Ready to use! Restart your bot to use the new universe.`);
}

generateUniverse();
