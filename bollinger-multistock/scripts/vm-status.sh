#!/usr/bin/env bash
set -e
DATA=/home/azureuser/tradebot-bollinger/dist/data
echo "=== Slot files ==="
ls -lh $DATA/bollinger-slot*.json

for f in $DATA/bollinger-slot1.json $DATA/bollinger-slot2.json $DATA/bollinger-slot3.json; do
  echo ""
  echo "=== $f ==="
  node -e "
    const d=require('$f');
    const th=d.tradeHistory||[];
    console.log('symbol:', d.symbol);
    console.log('currentCapital:', d.currentCapital);
    console.log('totalTrades:', th.length);
    if (th.length){
      const tail = th.slice(-5);
      console.log('last 5 trades:');
      tail.forEach(t=>{
        const pnl = (t.totalPnl ?? t.netPnl ?? t.pnl ?? '?');
        const dt  = t.exitTime || t.entryTime || t.timestamp || '?';
        console.log('  ' + dt + ' | ' + (t.symbol||t.optionSymbol||'?') + ' | ' + (t.exitReason||'?') + ' | pnl=' + pnl);
      });
    }
    if (d.activePosition){
      console.log('ACTIVE POSITION:', JSON.stringify({
        sym: d.activePosition.optionSymbol||d.activePosition.symbol,
        direction: d.activePosition.direction,
        entryTime: d.activePosition.entryTime,
        entryPrice: d.activePosition.entryPrice,
        ltp: d.activePosition.currentPrice,
        pnl: d.activePosition.unrealizedPnl
      }));
    }
    // Phase 0+1 state
    console.log('slotLocked:', d.slotLockedToday || d.lockedDate || 'no');
    console.log('dailyLossStreak:', d.dailyLossStreak || 0);
    console.log('symbolsTradedToday:', (d.symbolsTradedToday||[]).join(',') || 'none');
  "
done

echo ""
echo "=== Trades since May 15 deploy (across all slots) ==="
node -e "
  const fs=require('fs');
  const all=[];
  for(const f of ['$DATA/bollinger-slot1.json','$DATA/bollinger-slot2.json','$DATA/bollinger-slot3.json']){
    const d=JSON.parse(fs.readFileSync(f));
    (d.tradeHistory||[]).forEach(t=>{
      const dt = t.exitTime || t.entryTime || t.timestamp || '';
      if (dt && new Date(dt) >= new Date('2026-05-15T00:00:00Z')){
        all.push({dt, sym:(t.symbol||t.optionSymbol||'?'), reason:t.exitReason||'?', pnl: Number(t.totalPnl ?? t.netPnl ?? t.pnl ?? 0)});
      }
    });
  }
  all.sort((a,b)=>new Date(a.dt)-new Date(b.dt));
  console.log('count:', all.length);
  let net=0;
  all.forEach(t=>{ net += t.pnl; console.log('  ' + t.dt + ' | ' + t.sym + ' | ' + t.reason + ' | ' + t.pnl.toFixed(2)); });
  console.log('NET P&L since May 15:', net.toFixed(2));
  const wins = all.filter(t=>t.pnl>0).length;
  const losses = all.filter(t=>t.pnl<0).length;
  console.log('Wins:', wins, 'Losses:', losses, 'Win rate:', all.length?((wins/all.length*100).toFixed(1)+'%'):'n/a');
"
