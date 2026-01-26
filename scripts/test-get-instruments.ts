/**
 * Quick test to verify getInstruments('NFO') works
 * Run: npx ts-node scripts/test-get-instruments.ts
 */

import { KiteConnect } from 'kiteconnect';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Decrypt session (same logic as SessionPersistence)
function decryptSession(encryptedFile: any): any {
  const encryptionKey = process.env.SESSION_ENCRYPTION_KEY || 'default-key-for-session-encryption';
  const iv = Buffer.from(encryptedFile.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedFile.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

async function testGetInstruments() {
  try {
    // Load session from file
    const sessionPath = path.join(__dirname, '..', 'data', 'auth', 'session.json');
    
    if (!fs.existsSync(sessionPath)) {
      console.log('❌ No session file found. Please login first.');
      return;
    }

    const encryptedFile = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const sessionData = decryptSession(encryptedFile);
    
    if (!sessionData.accessToken) {
      console.log('❌ No access token in session. Please login first.');
      return;
    }

    console.log('📡 Connecting to Zerodha API...');
    console.log(`   Session created: ${sessionData.createdAt}`);
    console.log(`   Session expires: ${sessionData.expiryTime}`);
    
    const kite = new KiteConnect({
      api_key: process.env.ZERODHA_API_KEY || ''
    });
    kite.setAccessToken(sessionData.accessToken);

    console.log('📥 Fetching NFO instruments...');
    const startTime = Date.now();
    const instruments = await kite.getInstruments('NFO');
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ getInstruments('NFO') SUCCESS!`);
    console.log(`   Total instruments: ${instruments.length}`);
    console.log(`   Time taken: ${duration}s`);

    // Filter for a sample stock (RELIANCE)
    const relianceOptions = instruments.filter((i: any) => 
      i.name === 'RELIANCE' && 
      i.segment === 'NFO-OPT'
    );

    console.log(`\n📊 RELIANCE Options found: ${relianceOptions.length}`);

    // Get unique expiry dates
    const expiries = [...new Set(relianceOptions.map((o: any) => 
      new Date(o.expiry).toDateString()
    ))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    console.log(`\n📅 RELIANCE Expiry Dates (sorted):`);
    expiries.slice(0, 5).forEach((exp, i) => {
      const date = new Date(exp);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
      console.log(`   ${i + 1}. ${exp} (${dayName})`);
    });

    // Show nearest expiry details
    if (expiries.length === 0) {
      console.log('❌ No expiries found!');
      return;
    }
    
    const nearestExpiry = new Date(expiries[0]!);
    const today = new Date();
    const daysToExpiry = Math.floor((nearestExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    console.log(`\n🎯 Nearest Expiry Analysis:`);
    console.log(`   Today: ${today.toDateString()}`);
    console.log(`   Nearest Expiry: ${nearestExpiry.toDateString()}`);
    console.log(`   Days to Expiry: ${daysToExpiry}`);
    console.log(`   Should Block Trading: ${daysToExpiry <= 1 ? 'YES ⚠️' : 'NO ✅'}`);

    // Sample instrument data
    console.log(`\n📋 Sample RELIANCE Option (first match):`);
    const sample = relianceOptions[0];
    if (sample) {
      console.log(`   tradingsymbol: ${sample.tradingsymbol}`);
      console.log(`   expiry: ${sample.expiry}`);
      console.log(`   strike: ${sample.strike}`);
      console.log(`   instrument_type: ${sample.instrument_type}`);
      console.log(`   lot_size: ${sample.lot_size}`);
    }

  } catch (error: any) {
    console.log(`\n❌ getInstruments FAILED!`);
    console.log(`   Error: ${error.message}`);
    
    if (error.message.includes('token') || error.message.includes('session')) {
      console.log(`   → Session expired. Please login again.`);
    }
  }
}

testGetInstruments();
