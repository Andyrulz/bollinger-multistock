/**
 * Test script for Nifty Breakout Retracement Strategy
 * Run this after authenticating to test the breakout strategy functionality
 * 
 * Usage: node test-breakout-strategy.js
 */

const baseUrl = 'http://localhost:3000';

async function testBreakoutStrategy() {
  console.log('🧪 Testing Nifty Breakout Retracement Strategy...\n');

  try {
    // 1. Check authentication status
    console.log('1️⃣ Checking authentication status...');
    const authResponse = await fetch(`${baseUrl}/auth/status`);
    const authStatus = await authResponse.json();
    
    if (!authStatus.authenticated) {
      console.log('\n❌ Not authenticated. Please visit http://localhost:3000/auth/login first');
      return;
    }
    
    console.log('✅ Authenticated! Continuing tests...\n');

    // 2. Check breakout strategy status
    console.log('2️⃣ Checking breakout strategy status...');
    const statusResponse = await fetch(`${baseUrl}/breakout-strategy/status`);
    const status = await statusResponse.json();
    console.log('Strategy Status:', JSON.stringify(status, null, 2));

    if (!status.success) {
      console.log('\n❌ Failed to get strategy status');
      return;
    }

    console.log(`\n📊 Strategy Status: ${status.strategy_active ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
    console.log(`📊 Market Hours: ${status.market_hours ? '🟢 OPEN' : '🔴 CLOSED'}`);
    console.log(`📊 Candles Loaded: ${status.candle_count}`);

    // 3. Start the strategy if not active
    if (!status.strategy_active) {
      console.log('\n3️⃣ Starting breakout strategy...');
      const startResponse = await fetch(`${baseUrl}/breakout-strategy/start`, {
        method: 'POST'
      });
      const startResult = await startResponse.json();
      console.log('Start Strategy Response:', JSON.stringify(startResult, null, 2));

      if (startResult.success) {
        console.log('\n✅ Breakout strategy started successfully!');
        console.log('📈 The strategy is now loading historical data and calculating pivots...');
        
        // Wait for strategy to initialize
        console.log('\n⏳ Waiting 10 seconds for strategy to initialize...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.log('\n❌ Failed to start strategy');
        return;
      }
    } else {
      console.log('\n✅ Strategy is already active!');
    }

    // 4. Check pivot points
    console.log('\n4️⃣ Checking latest pivot points...');
    const pivotsResponse = await fetch(`${baseUrl}/breakout-strategy/pivots`);
    const pivotsData = await pivotsResponse.json();
    console.log('Pivots Data:', JSON.stringify(pivotsData, null, 2));

    if (pivotsData.success && pivotsData.pivots) {
      const { pivotHigh, pivotLow } = pivotsData.pivots;
      
      console.log('\n📈 LATEST PIVOT POINTS:');
      console.log('========================');
      
      if (pivotHigh) {
        console.log(`📈 Pivot HIGH: ₹${pivotHigh.price.toFixed(2)}`);
        console.log(`   Time: ${new Date(pivotHigh.timestamp).toLocaleString()}`);
        console.log(`   Confirmed: ${pivotHigh.confirmed ? 'YES' : 'NO'}`);
      } else {
        console.log('📈 No pivot high found yet (need more historical data)');
      }
      
      if (pivotLow) {
        console.log(`📉 Pivot LOW: ₹${pivotLow.price.toFixed(2)}`);
        console.log(`   Time: ${new Date(pivotLow.timestamp).toLocaleString()}`);
        console.log(`   Confirmed: ${pivotLow.confirmed ? 'YES' : 'NO'}`);
      } else {
        console.log('📉 No pivot low found yet (need more historical data)');
      }
      
      console.log('========================\n');
    }

    // 5. Check strategy status again
    console.log('5️⃣ Final strategy status check...');
    const finalStatusResponse = await fetch(`${baseUrl}/breakout-strategy/status`);
    const finalStatus = await finalStatusResponse.json();
    
    if (finalStatus.success) {
      console.log(`✅ Strategy is ${finalStatus.strategy_active ? 'ACTIVE' : 'INACTIVE'}`);
      console.log(`📊 Total candles loaded: ${finalStatus.candle_count}`);
      console.log(`⏰ Last update: ${new Date(finalStatus.last_update).toLocaleString()}`);
    }

    console.log('\n🎉 Breakout strategy test completed!');
    console.log('\n💡 Next steps:');
    console.log('   - Visit http://localhost:3000/breakout-strategy for the beautiful dashboard');
    console.log('   - Monitor pivot points during market hours (9:15 AM - 3:30 PM)');
    console.log('   - Strategy auto-updates every 5 minutes during market hours');
    console.log('   - Use pivot data for breakout/retracement trading decisions');
    console.log('\n📖 Algorithm Details:');
    console.log('   - Uses 15,15 lookback (15 bars before + 15 bars after)');
    console.log('   - Pivot confirmation requires 75 minutes (15 × 5-min candles)');
    console.log('   - Loads 7 days of historical 5-minute data for safety');
    console.log('   - Recalculates pivots every 5 minutes during market hours');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   - The bot is running (npm run dev)');
    console.log('   - You are authenticated via /auth/login');
    console.log('   - Your Zerodha credentials are correct');
    console.log('   - Your internet connection is stable');
  }
}

// Add fetch for Node.js if not available
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testBreakoutStrategy();