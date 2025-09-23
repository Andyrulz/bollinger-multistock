/**
 * Test script for Nifty Futures Strategy
 * Run this after authenticating to test the strategy functionality
 * 
 * Usage: node test-strategy.js
 */

const baseUrl = 'http://localhost:3000';

async function testStrategy() {
  console.log('🧪 Testing Nifty Futures Strategy...\n');

  try {
    // 1. Check overall strategy status
    console.log('1️⃣ Checking strategy status...');
    const statusResponse = await fetch(`${baseUrl}/strategy/status`);
    const status = await statusResponse.json();
    console.log('Status:', JSON.stringify(status, null, 2));
    
    if (!status.authenticated) {
      console.log('\n❌ Not authenticated. Please visit http://localhost:3000/auth/login first');
      return;
    }
    
    console.log('\n✅ Authenticated! Continuing tests...\n');

    // 2. Find current month Nifty futures contract
    console.log('2️⃣ Finding current month Nifty futures contract...');
    const contractResponse = await fetch(`${baseUrl}/strategy/nifty/contract`);
    const contractData = await contractResponse.json();
    console.log('Contract:', JSON.stringify(contractData, null, 2));

    if (!contractData.success) {
      console.log('\n❌ Failed to get contract information');
      return;
    }

    console.log(`\n✅ Found contract: ${contractData.contract.tradingsymbol}`);
    console.log(`   Expiry: ${contractData.contract.expiry}`);
    console.log(`   Token: ${contractData.contract.instrument_token}`);
    console.log(`   Lot Size: ${contractData.contract.lot_size}\n`);

    // 3. Get current price (without streaming)
    console.log('3️⃣ Getting current price...');
    const priceResponse = await fetch(`${baseUrl}/strategy/nifty/price`);
    const priceData = await priceResponse.json();
    console.log('Price Data:', JSON.stringify(priceData, null, 2));

    if (priceData.success && priceData.price) {
      console.log(`\n✅ Current Price: ₹${priceData.price.last_price}`);
      if (priceData.price.ohlc) {
        console.log(`   OHLC: O:${priceData.price.ohlc.open} H:${priceData.price.ohlc.high} L:${priceData.price.ohlc.low} C:${priceData.price.ohlc.close}`);
      }
    }

    // 4. Test starting price streaming
    console.log('\n4️⃣ Testing price streaming...');
    console.log('Starting price stream...');
    
    const startStreamResponse = await fetch(`${baseUrl}/strategy/nifty/start-stream`, {
      method: 'POST'
    });
    const startStreamData = await startStreamResponse.json();
    console.log('Start Stream Response:', JSON.stringify(startStreamData, null, 2));

    if (startStreamData.success) {
      console.log('\n✅ Price streaming started successfully!');
      console.log('💡 Check the bot logs to see real-time price updates');
      
      // Wait a few seconds for some ticks
      console.log('\n⏳ Waiting 10 seconds for price updates...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Check status again to see if we have tick data
      const statusAfterStream = await fetch(`${baseUrl}/strategy/status`);
      const statusDataAfterStream = await statusAfterStream.json();
      
      if (statusDataAfterStream.latest_tick) {
        console.log('\n📊 Latest tick received:');
        console.log(`   Price: ₹${statusDataAfterStream.latest_tick.last_price}`);
        console.log(`   Volume: ${statusDataAfterStream.latest_tick.volume}`);
        console.log(`   Time: ${statusDataAfterStream.latest_tick.timestamp}`);
      }

      // Stop streaming
      console.log('\n5️⃣ Stopping price stream...');
      const stopStreamResponse = await fetch(`${baseUrl}/strategy/nifty/stop-stream`, {
        method: 'POST'
      });
      const stopStreamData = await stopStreamResponse.json();
      console.log('Stop Stream Response:', JSON.stringify(stopStreamData, null, 2));
      
      if (stopStreamData.success) {
        console.log('\n✅ Price streaming stopped successfully!');
      }
    }

    console.log('\n🎉 Strategy test completed!');
    console.log('\n💡 Next steps:');
    console.log('   - Visit http://localhost:3000 to see the beautiful dashboard');
    console.log('   - Use the strategy endpoints in your trading logic');
    console.log('   - Check the logs for real-time price updates when streaming');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   - The bot is running (npm run dev)');
    console.log('   - You are authenticated via /auth/login');
    console.log('   - Your Zerodha credentials are correct');
  }
}

// Add fetch for Node.js if not available
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testStrategy();