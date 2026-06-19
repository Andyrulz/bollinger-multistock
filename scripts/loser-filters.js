const fs=require('fs');
const path=require('path');
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
}

function fmt(name,t){
  if(!t.length){console.log(name.padEnd(60),'n=0');return;}
  const w=t.filter(x=>x.pnl>0).length;
  const pnl=t.reduce((s,x)=>s+x.pnl,0);
  const big=t.filter(x=>x.pnl>3000).length;
  const ev=(pnl/t.length).toFixed(0);
  console.log(name.padEnd(60),'n='+String(t.length).padStart(3),'WR='+((w/t.length*100).toFixed(0)+'%').padStart(4),'PnL='+pnl.toFixed(0).padStart(7),'EV='+ev.padStart(5),'BigW='+big);
}

console.log('=== TOTAL TRADES:',all.length,'===\n');

console.log('--- Days-to-expiry (DTE) granular ---');
fmt('DTE 0-2',all.filter(t=>t._dte!==undefined&&t._dte<=2));
fmt('DTE 3-5',all.filter(t=>t._dte>=3&&t._dte<=5));
fmt('DTE 6-10',all.filter(t=>t._dte>=6&&t._dte<=10));
fmt('DTE 11-15',all.filter(t=>t._dte>=11&&t._dte<=15));
fmt('DTE 16-20',all.filter(t=>t._dte>=16&&t._dte<=20));
fmt('DTE 21-25',all.filter(t=>t._dte>=21&&t._dte<=25));
fmt('DTE 26-35',all.filter(t=>t._dte>=26&&t._dte<=35));
fmt('DTE >35',all.filter(t=>t._dte>35));

console.log('\n--- Direction x DTE ---');
fmt('LONG  + DTE 6-14',all.filter(t=>t.direction==='LONG'&&t._dte>=6&&t._dte<=14));
fmt('LONG  + DTE 15+',all.filter(t=>t.direction==='LONG'&&t._dte>=15));
fmt('SHORT + DTE 6-14',all.filter(t=>t.direction==='SHORT'&&t._dte>=6&&t._dte<=14));
fmt('SHORT + DTE 15+',all.filter(t=>t.direction==='SHORT'&&t._dte>=15));

console.log('\n--- Strike round number ---');
fmt('Strike ends in 00 (round)',all.filter(t=>t._strikeEnd===0));
fmt('Strike ends in 50',all.filter(t=>t._strikeEnd===50));
fmt('Strike ends other',all.filter(t=>t._strikeEnd!==0&&t._strikeEnd!==50));

console.log('\n--- LONG + DTE + premium ---');
fmt('LONG + DTE 7-14 + prem >=50',all.filter(t=>t.direction==='LONG'&&t._dte>=7&&t._dte<=14&&t.entryPrice>=50));
fmt('LONG + DTE 7-14 + prem >=50 + strike%100==0',all.filter(t=>t.direction==='LONG'&&t._dte>=7&&t._dte<=14&&t.entryPrice>=50&&t._strikeEnd===0));

console.log('\n--- Sector concentration check (top symbols and their pattern) ---');
const symStats={};
for(const t of all){
  const s=t.instrument?.name;
  if(!symStats[s])symStats[s]={n:0,p:0,w:0,big:0};
  symStats[s].n++;
  symStats[s].p+=t.pnl;
  if(t.pnl>0)symStats[s].w++;
  if(t.pnl>3000)symStats[s].big++;
}
console.log('\nTop 20 most-traded symbols:');
console.log('symbol'.padEnd(18),'n'.padStart(3),'WR'.padStart(5),'PnL'.padStart(8),'BigW'.padStart(5));
const symArr=Object.entries(symStats).sort((a,b)=>b[1].n-a[1].n).slice(0,25);
for(const [s,v] of symArr){
  const wr=(v.w/v.n*100).toFixed(0);
  console.log(s.padEnd(18),String(v.n).padStart(3),(wr+'%').padStart(5),v.p.toFixed(0).padStart(8),String(v.big).padStart(5));
}

console.log('\n--- Drop symbols with >=3 trades and 0% WR (chronic losers) ---');
const blacklist=new Set();
for(const [s,v] of Object.entries(symStats)){
  if(v.n>=3 && v.w===0) blacklist.add(s);
}
console.log('Blacklist (>=3 trades, 0% WR):',Array.from(blacklist).join(','));
fmt('All EXCEPT chronic loser symbols',all.filter(t=>!blacklist.has(t.instrument?.name)));

console.log('\n--- Time between candle close and entry (entry latency) ---');
// Entry candle is the candle that ended just before entry time. 5-min candles end at :00, :05, :10...
// Entry latency = seconds after candle close
function latencySec(t){
  const dt=new Date(t.entryTime);
  const secsIntoHour=dt.getUTCMinutes()*60+dt.getUTCSeconds();
  const candleEndSec=Math.floor(secsIntoHour/300)*300;
  return secsIntoHour-candleEndSec;
}
fmt('Entry latency 0-60s after candle close',all.filter(t=>latencySec(t)<60));
fmt('Entry latency 60-120s',all.filter(t=>latencySec(t)>=60&&latencySec(t)<120));
fmt('Entry latency 120-180s',all.filter(t=>latencySec(t)>=120&&latencySec(t)<180));
fmt('Entry latency 180-300s',all.filter(t=>latencySec(t)>=180));

console.log('\n--- Charges as % of pnl drag ---');
let totalCharges=0,totalGrossPnl=0,totalNetPnl=0;
for(const t of all){
  totalCharges+=t.charges?.totalCharges||0;
  totalGrossPnl+=t.grossPnl||0;
  totalNetPnl+=t.pnl;
}
console.log('Total gross PnL:',totalGrossPnl.toFixed(0));
console.log('Total charges:',totalCharges.toFixed(0));
console.log('Total net PnL:',totalNetPnl.toFixed(0));
console.log('Charges per trade avg:',(totalCharges/all.length).toFixed(0));
console.log('Charges as % of gross PnL:',(totalCharges/Math.abs(totalGrossPnl)*100).toFixed(0)+'%');

console.log('\n=== STACKED RULES TEST (drop chronic losers + Mon morning + LONG + DTE filter) ===');
const v1=all.filter(t=>
  t.direction==='LONG' &&
  t._dte>=7 && t._dte<=18 &&
  t.entryPrice>=50 && t.entryPrice<=200 &&
  !blacklist.has(t.instrument?.name) &&
  !(t._istMin>=750&&t._istMin<780) // skip 12:30 bucket
);
fmt('V1: LONG + DTE7-18 + prem50-200 + no blacklist + no 12:30',v1);

const v2=v1.filter(t=>t._dow===1||t._dow===3); // Mon + Wed
fmt('V2: V1 + Mon/Wed only',v2);

const v3=all.filter(t=>
  t.direction==='LONG' &&
  t._dte>=7 && t._dte<=20 &&
  t.entryPrice>=50 &&
  t._strikeEnd===0  // round-strike preference
);
fmt('V3: LONG + DTE7-20 + prem>=50 + round strike',v3);

const v4=v3.filter(t=>!(t._istMin>=750&&t._istMin<780));
fmt('V4: V3 + no 12:30 bucket',v4);

console.log('\n--- Position #2 in same slot/day quality check ---');
// If 1st trade today already at +X, skip 2nd. Or if 1st loss, force skip 2nd.
const slotMap={};
for(const t of all){
  const k=t._slot+'_'+t.entryTime.slice(0,10);
  (slotMap[k]=slotMap[k]||[]).push(t);
}
const onlyFirstOfSlot=[];
for(const arr of Object.values(slotMap)){
  arr.sort((a,b)=>new Date(a.entryTime)-new Date(b.entryTime));
  onlyFirstOfSlot.push(arr[0]);
}
fmt('Only FIRST trade per slot per day',onlyFirstOfSlot);

console.log('\n--- Combined "Best of" rule ---');
const best=onlyFirstOfSlot.filter(t=>
  t.direction==='LONG' &&
  t._dte>=7 && t._dte<=20 &&
  t.entryPrice>=50 &&
  !(t._istMin>=750&&t._istMin<780)
);
fmt('BEST: 1st-of-slot + LONG + DTE7-20 + prem>=50 + skip 12:30',best);
