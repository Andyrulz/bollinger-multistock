const KiteConnect = require('kiteconnect').KiteConnect;
const fs = require('fs');
const path = require('path');

// Load session data
const sessionPath = path.join(__dirname, 'data', 'auth', 'session.json');
const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

const kiteConnect = new KiteConnect({
  api_key: sessionData.apiKey
});

kiteConnect.setAccessToken(sessionData.accessToken);

async function fetchTodaysOrders() {
  try {
    console.log('Fetching today\'s orders from Zerodha...\n');
    
    const orders = await kiteConnect.getOrders();
    
    // Filter for today's orders
    const today = new Date().toISOString().split('T')[0]; // 2025-12-01
    const todaysOrders = orders.filter(order => 
      order.order_timestamp && order.order_timestamp.startsWith(today)
    );
    
    console.log(`Found ${todaysOrders.length} orders for today (${today}):\n`);
    
    // Group by symbol
    const bySymbol = {};
    todaysOrders.forEach(order => {
      const symbol = order.tradingsymbol;
      if (!bySymbol[symbol]) {
        bySymbol[symbol] = [];
      }
      bySymbol[symbol].push(order);
    });
    
    // Display organized by symbol
    Object.keys(bySymbol).forEach(symbol => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Symbol: ${symbol}`);
      console.log(`${'='.repeat(80)}`);
      
      const symbolOrders = bySymbol[symbol].sort((a, b) => 
        new Date(a.order_timestamp) - new Date(b.order_timestamp)
      );
      
      symbolOrders.forEach((order, idx) => {
        console.log(`\nOrder ${idx + 1}:`);
        console.log(`  Order ID: ${order.order_id}`);
        console.log(`  Transaction Type: ${order.transaction_type}`);
        console.log(`  Status: ${order.status}`);
        console.log(`  Quantity: ${order.quantity}`);
        console.log(`  Price: ₹${order.price || 'MARKET'}`);
        console.log(`  Average Price: ₹${order.average_price || 'N/A'}`);
        console.log(`  Time: ${order.order_timestamp}`);
        console.log(`  Order Type: ${order.order_type}`);
      });
      
      // Calculate P&L if both BUY and SELL exist
      const buyOrders = symbolOrders.filter(o => o.transaction_type === 'BUY' && o.status === 'COMPLETE');
      const sellOrders = symbolOrders.filter(o => o.transaction_type === 'SELL' && o.status === 'COMPLETE');
      
      if (buyOrders.length > 0 && sellOrders.length > 0) {
        const entryPrice = buyOrders[0].average_price;
        const exitPrice = sellOrders[0].average_price;
        const quantity = buyOrders[0].quantity;
        const pnl = (exitPrice - entryPrice) * quantity;
        
        console.log(`\n  📊 P&L Calculation:`);
        console.log(`     Entry: ₹${entryPrice} × ${quantity}`);
        console.log(`     Exit: ₹${exitPrice} × ${quantity}`);
        console.log(`     P&L: ₹${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`);
      }
    });
    
    console.log(`\n${'='.repeat(80)}\n`);
    
    // Save to file for reference
    const outputPath = path.join(__dirname, 'todays-orders.json');
    fs.writeFileSync(outputPath, JSON.stringify(todaysOrders, null, 2));
    console.log(`\n✅ Full order details saved to: ${outputPath}\n`);
    
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    console.error('Error details:', error.message);
  }
}

fetchTodaysOrders();
