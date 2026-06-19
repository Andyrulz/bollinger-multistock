const fs=require('fs');
const files=['src/data/bollinger-slot1.json','src/data/bollinger-slot2.json','src/data/bollinger-slot3.json'];
const all=[];
for(const f of files){
  const d=JSON.parse(fs.readFileSync(f,'utf8'));
  if(d.tradeHistory) all.push(...d.tradeHistory.map(t=>({...t,_slot:f.match(/slot(\d)/)[1]})));
}
all.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));

// Annotate
for(const t of all){
  const dt=new Date(t.entryTime);
  t._istMin=dt.getUTCHours()*60+dt.getUTCMinutes()+330;
  t._dow=dt.getUTCDay();
  if(t.instrument?.expiry) t._dte=Math.floor((new Date(t.instrument.expiry)-dt)/86400000);
  t._strikeEnd=t.instrument?.strike%100;
  t._dur=(new Date(t.exitTime)-dt)/60000;
  t._charges=t.charges?.totalCharges||0;
  t._gross=t.grossPnl!==undefined?t.grossPnl:t.pnl;
}

function fmt(name,t){
  if(!t.length){console.log(name.padEnd(60),'n=0');return;}
  const w=t.filter(x=>x.pnl>0).length;
  const pnl=t.reduce((s,x)=>s+x.pnl,0);
  const gross=t.reduce((s,x)=>s+x._gross,0);
  const charges=t.reduce((s,x)=>s+x._charges,0);
  const big=t.filter(x=>x.pnl>3000).length;
  const ev=(pnl/t.length).toFixed(0);
  const winAvg=w?(t.filter(x=>x.pnl>0).reduce((s,x)=>s+x.pnl,0)/w).toFixed(0):'-';
  const lossAvg=t.length-w?(t.filter(x=>x.pnl<=0).reduce((s,x)=>s+x.pnl,0)/(t.length-w)).toFixed(0):'-';
  console.log(name.padEnd(60),'n='+String(t.length).padStart(3),'WR='+((w/t.length*100).toFixed(0)+'%').padStart(4),'PnL='+pnl.toFixed(0).padStart(7),'Gross='+gross.toFixed(0).padStart(7),'EV='+ev.padStart(5),'aW='+String(winAvg).padStart(5),'aL='+String(lossAvg).padStart(5),'BigW='+big);
}

const cut=new Date('2026-04-02T18:00:00+05:30');
const pre=all.filter(t=>new Date(t.entryTime)<cut);
const post=all.filter(t=>new Date(t.entryTime)>=cut);

// Build chronic loser blacklist
const symStats={};
for(const t of all){
  const s=t.instrument?.name;
  if(!symStats[s])symStats[s]={n:0,w:0};
  symStats[s].n++;
  if(t.pnl>0)symStats[s].w++;
}
const blacklist=new Set();
for(const [s,v] of Object.entries(symStats)){
  if(v.n>=3 && v.w===0) blacklist.add(s);
}

console.log('=== BASELINES ===');
fmt('ALL TIME',all);
fmt('PRE Apr-02',pre);
fmt('POST Apr-02',post);

console.log('\n=== INDIVIDUAL FILTER IMPACT (applied to ALL TIME) ===');
const rules=[
  ['F1: LONG only',(t)=>t.direction==='LONG'],
  ['F2: SHORT only',(t)=>t.direction==='SHORT'],
  ['F3: DTE 6-20',(t)=>t._dte>=6&&t._dte<=20],
  ['F4: DTE 7-14 (sweet spot)',(t)=>t._dte>=7&&t._dte<=14],
  ['F5: Round strike (00)',(t)=>t._strikeEnd===0],
  ['F6: Prem >= 50',(t)=>t.entryPrice>=50],
  ['F7: Skip 12:30 bucket',(t)=>!(t._istMin>=750&&t._istMin<780)],
  ['F8: No chronic-loser symbols',(t)=>!blacklist.has(t.instrument?.name)],
  ['F9: First-trade-of-day per slot',null],
  ['F10: 1st-trade-or-after-win same slot',null],
];

const slotMap={};
for(const t of all){
  const k=t._slot+'_'+t.entryTime.slice(0,10);
  (slotMap[k]=slotMap[k]||[]).push(t);
}
for(const arr of Object.values(slotMap)) arr.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
const firstOfSlot=new Set();
const firstOrAfterWin=new Set();
for(const arr of Object.values(slotMap)){
  firstOfSlot.add(arr[0].tradeId);
  firstOrAfterWin.add(arr[0].tradeId);
  for(let i=1;i<arr.length;i++){
    if(arr[i-1].pnl>0) firstOrAfterWin.add(arr[i].tradeId);
  }
}

for(const [name,fn] of rules){
  let t;
  if(name.startsWith('F9'))t=all.filter(x=>firstOfSlot.has(x.tradeId));
  else if(name.startsWith('F10'))t=all.filter(x=>firstOrAfterWin.has(x.tradeId));
  else t=all.filter(fn);
  fmt(name,t);
}

console.log('\n=== INCREMENTAL STACKING (best filters added one by one) ===');
// Apply filters in order and report impact
let pool=[...all];
fmt('Step 0: All',pool);
pool=pool.filter(t=>t._dte>=6&&t._dte<=20);
fmt('Step 1: + DTE 6-20',pool);
pool=pool.filter(t=>t.entryPrice>=50);
fmt('Step 2: + Premium >= 50',pool);
pool=pool.filter(t=>!blacklist.has(t.instrument?.name));
fmt('Step 3: + No chronic-loser symbols',pool);
pool=pool.filter(t=>!(t._istMin>=750&&t._istMin<780));
fmt('Step 4: + Skip 12:30 IST',pool);
pool=pool.filter(t=>firstOrAfterWin.has(t.tradeId));
fmt('Step 5: + Same-day same-slot lockout after loss',pool);
pool=pool.filter(t=>t._strikeEnd===0);
fmt('Step 6: + Round strike (00) only',pool);

console.log('\n=== ALTERNATIVE STACKS ===');
fmt('Stack A: DTE 6-20 + Prem 50 + No blacklist',
  all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)));
fmt('Stack B: Stack A + LONG only',
  all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&t.direction==='LONG'));
fmt('Stack C: Stack A + Skip 12:30',
  all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)));
fmt('Stack D: Stack A + Skip 12:30 + lockout after loss',
  all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId)));
fmt('Stack E: Stack A + round strike',
  all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&t._strikeEnd===0));

console.log('\n=== SECTOR/DIRECTION SPLIT (Pre vs Post deployment) ===');
console.log('LONG perf:');
fmt('  PRE LONG',pre.filter(t=>t.direction==='LONG'));
fmt('  POST LONG',post.filter(t=>t.direction==='LONG'));
console.log('SHORT perf:');
fmt('  PRE SHORT',pre.filter(t=>t.direction==='SHORT'));
fmt('  POST SHORT',post.filter(t=>t.direction==='SHORT'));

console.log('\n=== POST-DEPLOYMENT ONLY: BEST RULES ===');
fmt('POST: Baseline',post);
fmt('POST: Stack A (DTE+Prem+Blacklist)',post.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)));
fmt('POST: Stack D (full)',post.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId)));
fmt('POST: LONG-only',post.filter(t=>t.direction==='LONG'));
fmt('POST: LONG+DTE 6-20+Prem50+NoBL+Skip12:30',post.filter(t=>t.direction==='LONG'&&t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)));

console.log('\n=== TRADE FREQUENCY UNDER FILTERS ===');
function tradesPerDay(t){
  const days=new Set(t.map(x=>x.entryTime.slice(0,10))).size;
  return {n:t.length,days,perDay:(t.length/days).toFixed(2)};
}
console.log('Baseline:',JSON.stringify(tradesPerDay(all)));
console.log('Stack A:',JSON.stringify(tradesPerDay(all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)))));
console.log('Stack D:',JSON.stringify(tradesPerDay(all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId)))));

console.log('\n=== CHARGE EFFICIENCY UNDER FILTERS ===');
function chargeEff(t){
  const gross=t.reduce((s,x)=>s+x._gross,0);
  const charges=t.reduce((s,x)=>s+x._charges,0);
  const net=t.reduce((s,x)=>s+x.pnl,0);
  return {gross:gross.toFixed(0),charges:charges.toFixed(0),net:net.toFixed(0),chargesPct:gross!==0?(charges/Math.abs(gross)*100).toFixed(0)+'%':'inf'};
}
console.log('Baseline:',JSON.stringify(chargeEff(all)));
console.log('Stack A:',JSON.stringify(chargeEff(all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)))));
console.log('Stack D:',JSON.stringify(chargeEff(all.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId)))));

console.log('\n=== SHORT DEEP DIVE: WHY DOES IT LOSE? ===');
const shortAll=all.filter(t=>t.direction==='SHORT');
console.log('All SHORTs:',shortAll.length,'PnL:',shortAll.reduce((s,t)=>s+t.pnl,0).toFixed(0));
// Group by exit
const sxg={};
for(const t of shortAll){
  const k=t.exitReason||'?';
  if(!sxg[k])sxg[k]={n:0,p:0,w:0};
  sxg[k].n++;sxg[k].p+=t.pnl;if(t.pnl>0)sxg[k].w++;
}
console.log('SHORT exit breakdown:');
for(const [k,v] of Object.entries(sxg).sort((a,b)=>a[1].p-b[1].p))
  console.log('  ',k.padEnd(35),'n=',v.n,'WR=',(v.w/v.n*100).toFixed(0)+'%','PnL=',v.p.toFixed(0));

console.log('\n=== LONG DEEP DIVE ===');
const longAll=all.filter(t=>t.direction==='LONG');
console.log('All LONGs:',longAll.length,'PnL:',longAll.reduce((s,t)=>s+t.pnl,0).toFixed(0));
const lxg={};
for(const t of longAll){
  const k=t.exitReason||'?';
  if(!lxg[k])lxg[k]={n:0,p:0,w:0};
  lxg[k].n++;lxg[k].p+=t.pnl;if(t.pnl>0)lxg[k].w++;
}
console.log('LONG exit breakdown:');
for(const [k,v] of Object.entries(lxg).sort((a,b)=>a[1].p-b[1].p))
  console.log('  ',k.padEnd(35),'n=',v.n,'WR=',(v.w/v.n*100).toFixed(0)+'%','PnL=',v.p.toFixed(0));

console.log('\n=== "WHAT IF WE REMOVED FAST STOPS" — counterfactual for POST only ===');
// Of trades exiting via RSI_CONFIRMATION_FAILED or PREMIUM_HARD_STOP, look at adjacent stock candles
// Without 5-min option data we can only approximate by removing them and seeing if base strategy survives
function counterfactual(label,trades){
  const survivors=trades.filter(t=>t.exitReason!=='RSI_CONFIRMATION_FAILED'&&t.exitReason!=='PREMIUM_HARD_STOP_8PCT');
  fmt(label,survivors);
}
counterfactual('POST: drop RSI_CONFIRMATION_FAILED + PREMIUM_HARD_STOP',post);
counterfactual('Stack D: drop RSI_CONFIRMATION_FAILED + PREMIUM_HARD_STOP',post.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId)));

console.log('\n=== MONTH-BY-MONTH POST FILTER ===');
const months={};
for(const t of all){
  const m=t.entryTime.slice(0,7);
  if(!months[m])months[m]=[];
  months[m].push(t);
}
for(const [m,ts] of Object.entries(months).sort()){
  const filtered=ts.filter(t=>t._dte>=6&&t._dte<=20&&t.entryPrice>=50&&!blacklist.has(t.instrument?.name)&&!(t._istMin>=750&&t._istMin<780)&&firstOrAfterWin.has(t.tradeId));
  const baseP=ts.reduce((s,t)=>s+t.pnl,0);
  const filtP=filtered.reduce((s,t)=>s+t.pnl,0);
  console.log(m,'base n=',ts.length,'PnL=',baseP.toFixed(0).padStart(7),'  | filtered n=',filtered.length,'PnL=',filtP.toFixed(0).padStart(7));
}
