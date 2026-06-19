const fs=require('fs');
const files=['src/data/bollinger-slot1.json','src/data/bollinger-slot2.json','src/data/bollinger-slot3.json'];
const all=[];
for(const f of files){
  const d=JSON.parse(fs.readFileSync(f,'utf8'));
  if(d.tradeHistory) all.push(...d.tradeHistory.map(t=>({...t,_slot:f.match(/slot(\d)/)[1]})));
}
all.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
for(const t of all){
  const dt=new Date(t.entryTime);
  t._istMin=dt.getUTCHours()*60+dt.getUTCMinutes()+330;
  t._dow=dt.getUTCDay();
  if(t.instrument?.expiry) t._dte=Math.floor((new Date(t.instrument.expiry)-dt)/86400000);
  t._strikeEnd=t.instrument?.strike%100;
  t._dur=(new Date(t.exitTime)-dt)/60000;
}

// Build chronic blacklist
const symStats={};
for(const t of all){
  const s=t.instrument?.name;
  if(!symStats[s])symStats[s]={n:0,w:0};
  symStats[s].n++;if(t.pnl>0)symStats[s].w++;
}
const blacklist=new Set();
for(const [s,v] of Object.entries(symStats)) if(v.n>=3 && v.w===0) blacklist.add(s);

const slotMap={};
for(const t of all){
  const k=t._slot+'_'+t.entryTime.slice(0,10);
  (slotMap[k]=slotMap[k]||[]).push(t);
}
for(const arr of Object.values(slotMap)) arr.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
const firstOrAfterWin=new Set();
for(const arr of Object.values(slotMap)){
  firstOrAfterWin.add(arr[0].tradeId);
  for(let i=1;i<arr.length;i++) if(arr[i-1].pnl>0) firstOrAfterWin.add(arr[i].tradeId);
}

// Stack D filter
const stackD=t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId);

console.log('=== ROBUSTNESS / OUT-OF-SAMPLE CHECK ===');
console.log('Use FIRST half (training) to derive blacklist + rules, test on SECOND half');
// Sort by date
const half=Math.floor(all.length/2);
const train=all.slice(0,half);
const test=all.slice(half);
const trainCut=train[train.length-1].entryTime.slice(0,10);
console.log('Train ends:',trainCut,'(n='+train.length+')');
console.log('Test starts:',test[0].entryTime.slice(0,10),'(n='+test.length+')');

// Build train-only blacklist
const trainSymStats={};
for(const t of train){
  const s=t.instrument?.name;
  if(!trainSymStats[s])trainSymStats[s]={n:0,w:0};
  trainSymStats[s].n++;if(t.pnl>0)trainSymStats[s].w++;
}
const trainBlacklist=new Set();
for(const [s,v] of Object.entries(trainSymStats)) if(v.n>=3 && v.w===0) trainBlacklist.add(s);
console.log('Train-only blacklist:',Array.from(trainBlacklist).join(','));

// Train slot map
const trainSlotMap={};
for(const t of train){
  const k=t._slot+'_'+t.entryTime.slice(0,10);
  (trainSlotMap[k]=trainSlotMap[k]||[]).push(t);
}
for(const arr of Object.values(trainSlotMap)) arr.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
const trainFirstOrAfterWin=new Set();
for(const arr of Object.values(trainSlotMap)){
  trainFirstOrAfterWin.add(arr[0].tradeId);
  for(let i=1;i<arr.length;i++) if(arr[i-1].pnl>0) trainFirstOrAfterWin.add(arr[i].tradeId);
}
// For test, rebuild slot map fresh
const testSlotMap={};
for(const t of test){
  const k=t._slot+'_'+t.entryTime.slice(0,10);
  (testSlotMap[k]=testSlotMap[k]||[]).push(t);
}
for(const arr of Object.values(testSlotMap)) arr.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
const testFirstOrAfterWin=new Set();
for(const arr of Object.values(testSlotMap)){
  testFirstOrAfterWin.add(arr[0].tradeId);
  for(let i=1;i<arr.length;i++) if(arr[i-1].pnl>0) testFirstOrAfterWin.add(arr[i].tradeId);
}

function summary(name,trades){
  if(!trades.length){console.log(name.padEnd(50),'n=0');return;}
  const w=trades.filter(x=>x.pnl>0).length;
  const pnl=trades.reduce((s,x)=>s+x.pnl,0);
  const ev=(pnl/trades.length).toFixed(0);
  console.log(name.padEnd(50),'n='+String(trades.length).padStart(3),'WR='+((w/trades.length*100).toFixed(0)+'%').padStart(4),'PnL='+pnl.toFixed(0).padStart(7),'EV='+ev.padStart(5));
}

console.log('\n--- TRAIN PERFORMANCE ---');
summary('Train baseline',train);
const trainStackD=train.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!trainBlacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&trainFirstOrAfterWin.has(t.tradeId));
summary('Train Stack D',trainStackD);

console.log('\n--- TEST (OUT-OF-SAMPLE) PERFORMANCE ---');
summary('Test baseline',test);
// Use TRAIN-derived blacklist on test data
const testStackD=test.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!trainBlacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&testFirstOrAfterWin.has(t.tradeId));
summary('Test Stack D (train blacklist)',testStackD);

// What if we just dropped SHORTs in test? Most robust simple rule.
summary('Test LONG only',test.filter(t=>t.direction==='LONG'));
summary('Test LONG + DTE 6-20',test.filter(t=>t.direction==='LONG'&&t._dte>=6&&t._dte<=20));
summary('Test LONG + DTE 6-20 + Prem 50',test.filter(t=>t.direction==='LONG'&&t._dte>=6&&t._dte<=20&&t.entryPrice>=50));
summary('Test LONG + DTE 6-20 + Prem 50 + skip 12:30',test.filter(t=>t.direction==='LONG'&&t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!(t._istMin>=750&&t._istMin<780)));

console.log('\n=== CONSECUTIVE LOSER DRAWDOWN ===');
// Worst N-in-a-row, max drawdown
let cum=0,maxCum=0,maxDD=0,curStreak=0,maxStreak=0;
for(const t of all){
  cum+=t.pnl;
  if(cum>maxCum)maxCum=cum;
  const dd=maxCum-cum;
  if(dd>maxDD)maxDD=dd;
  if(t.pnl<=0){curStreak++;maxStreak=Math.max(maxStreak,curStreak)}
  else curStreak=0;
}
console.log('Baseline: Max drawdown ₹',maxDD.toFixed(0),'  Max consecutive losers:',maxStreak);

// Same with Stack D
const sd=all.filter(stackD);
let cum2=0,maxCum2=0,maxDD2=0,curStreak2=0,maxStreak2=0;
for(const t of sd){
  cum2+=t.pnl;
  if(cum2>maxCum2)maxCum2=cum2;
  const dd=maxCum2-cum2;
  if(dd>maxDD2)maxDD2=dd;
  if(t.pnl<=0){curStreak2++;maxStreak2=Math.max(maxStreak2,curStreak2)}
  else curStreak2=0;
}
console.log('Stack D: Max drawdown ₹',maxDD2.toFixed(0),'  Max consecutive losers:',maxStreak2);

console.log('\n=== DAILY EQUITY CURVE (Stack D vs Baseline) ===');
const byDay={};
for(const t of all){
  const d=t.entryTime.slice(0,10);
  if(!byDay[d])byDay[d]={base:0,stackD:0};
  byDay[d].base+=t.pnl;
  if(stackD(t))byDay[d].stackD+=t.pnl;
}
let cumBase=0,cumSD=0,negDays=0,posDays=0,sdNegDays=0,sdPosDays=0,sdNoTradeDays=0;
const allDays=Object.keys(byDay).sort();
for(const d of allDays){
  cumBase+=byDay[d].base;
  cumSD+=byDay[d].stackD;
  if(byDay[d].base<0)negDays++;else if(byDay[d].base>0)posDays++;
  if(byDay[d].stackD===0)sdNoTradeDays++;
  else if(byDay[d].stackD<0)sdNegDays++;
  else sdPosDays++;
}
console.log('Total trading days:',allDays.length);
console.log('Baseline: pos days =',posDays,'neg days =',negDays,'avg pnl/day =',(cumBase/allDays.length).toFixed(0));
console.log('Stack D: pos days =',sdPosDays,'neg days =',sdNegDays,'no-trade days =',sdNoTradeDays,'avg pnl/day =',(cumSD/allDays.length).toFixed(0));

console.log('\n=== "BIG WINNER RETENTION" UNDER STACK D ===');
const bigWinners=all.filter(t=>t.pnl>3000);
const bigUnderD=bigWinners.filter(stackD);
console.log('All big winners (>3000):',bigWinners.length);
console.log('Big winners retained by Stack D:',bigUnderD.length);
console.log('Big winners DROPPED by Stack D:');
for(const t of bigWinners.filter(t=>!stackD(t))){
  const reasons=[];
  if(t._dte<6||t._dte>20)reasons.push('DTE='+t._dte);
  if(t.entryPrice<50)reasons.push('prem='+t.entryPrice);
  if(blacklist.has(t.instrument?.name))reasons.push('blacklist');
  if(t._istMin>=750&&t._istMin<780)reasons.push('12:30');
  if(!firstOrAfterWin.has(t.tradeId))reasons.push('post-loss');
  console.log('  ',t.entryTime.slice(0,16),t.direction,(t.instrument?.tradingsymbol||'?').padEnd(25),'PnL='+Math.round(t.pnl).toString().padStart(6),'why:',reasons.join(','));
}

console.log('\n=== BIG LOSERS DROPPED BY STACK D ===');
const bigLosers=all.filter(t=>t.pnl<-2000);
const bigLosersUnderD=bigLosers.filter(stackD);
console.log('All big losers (<-2000):',bigLosers.length,'PnL contribution:',bigLosers.reduce((s,t)=>s+t.pnl,0).toFixed(0));
console.log('Big losers retained by Stack D:',bigLosersUnderD.length,'PnL contribution:',bigLosersUnderD.reduce((s,t)=>s+t.pnl,0).toFixed(0));
console.log('Big losers AVOIDED by Stack D:',(bigLosers.length-bigLosersUnderD.length),'PnL saved:',(bigLosers.reduce((s,t)=>s+t.pnl,0)-bigLosersUnderD.reduce((s,t)=>s+t.pnl,0)).toFixed(0));

console.log('\n=== EXTENDING HOLDING TIME — would loosening fast stops capture more? ===');
// Look at trades that got stopped fast: did they have any chance? Use duration as proxy.
// Compare: trades exiting in first 15 min vs trades that survived longer.
const fastExits=all.filter(t=>t._dur<15);
const fastWinners=fastExits.filter(t=>t.pnl>0);
const slowExits=all.filter(t=>t._dur>=15);
console.log('Trades exited <15 min: n='+fastExits.length+' PnL='+fastExits.reduce((s,t)=>s+t.pnl,0).toFixed(0)+' WR='+(fastExits.filter(t=>t.pnl>0).length/fastExits.length*100).toFixed(0)+'%');
console.log('Trades exited >=15 min: n='+slowExits.length+' PnL='+slowExits.reduce((s,t)=>s+t.pnl,0).toFixed(0)+' WR='+(slowExits.filter(t=>t.pnl>0).length/slowExits.length*100).toFixed(0)+'%');
console.log('  -> If even half of fast losers became 50% recoveries: potential save = ',(Math.abs(fastExits.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0))*0.25).toFixed(0));
