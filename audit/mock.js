// Deterministic synthetic Tradier backend for the SWAGINO harness. NOT market data: prices are a
// seeded random walk. Shapes mirror Tradier's JSON (history / timesales / quotes).
const ET='America/New_York';
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:ET,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function etParts(ms){const p={};fmt.formatToParts(new Date(ms)).forEach(x=>p[x.type]=x.value);if(p.hour==='24')p.hour='00';
  return{ymd:`${p.year}-${p.month}-${p.day}`,h:+p.hour,m:+p.minute,s:+p.second};}
function etEpoch(ymd,h,m){ // ET wall clock -> epoch ms
  const [Y,Mo,D]=ymd.split('-').map(Number);const want=Date.UTC(Y,Mo-1,D,h,m,0);let g=want;
  for(let i=0;i<2;i++){const p=etParts(g);const [a,b,c]=p.ymd.split('-').map(Number);g+=want-Date.UTC(a,b-1,c,p.h,p.m,0);}
  return g;
}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){let u=0,v=0;while(!u)u=r();while(!v)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
const BASE={SPY:660,QQQ:590,AAPL:250,MSFT:510,GOOGL:250,AMZN:230,NVDA:180,META:760,TSLA:440,LOWP:2.4};
function weekdays(from,to){const out=[];let d=new Date(from+'T12:00:00Z');const end=new Date(to+'T12:00:00Z');
  while(d<=end){const w=d.getUTCDay();if(w&&w<6)out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}

function makeMock(nowMsFn){
  const dailyCache=new Map(),dayCache=new Map();
  function dailyBase(sym){
    if(dailyCache.has(sym))return dailyCache.get(sym);
    // REAL Tradier daily history when we have it (real/<SYM>_daily.json); synthetic otherwise
    try{const R=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'real',sym+'_daily.json')));
      const rows=R.map(x=>({date:x.date,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,_real:true}));
      dailyCache.set(sym,rows);return rows;}catch(e){}
    const today=etParts(nowMsFn()).ymd;
    const days=weekdays('2014-01-02',today);
    const r=rng(hash('D'+sym));const vol=sym==='TSLA'||sym==='NVDA'?0.028:sym==='LOWP'?0.04:0.013;
    const lr=days.map(()=>gauss(r)*vol+0.0003);
    let cum=0;const cl=lr.map(x=>cum+=x);const shift=Math.log(BASE[sym]||100)-cl[cl.length-1];
    const rows=[];let prev=Math.exp(cl[0]+shift-lr[0]);
    days.forEach((ymd,i)=>{
      const c=Math.exp(cl[i]+shift),o=prev*Math.exp(gauss(r)*vol*0.3);
      const h=Math.max(o,c)*Math.exp(Math.abs(gauss(r))*vol*0.6),l=Math.min(o,c)*Math.exp(-Math.abs(gauss(r))*vol*0.6);
      rows.push({date:ymd,open:o,high:h,low:l,close:c,volume:Math.round(5e6*(0.5+r()))});prev=c;
    });
    dailyCache.set(sym,rows);return rows;
  }
  // full 04:00-20:00 5m path for one day (deterministic, independent of "now")
  function day5(sym,ymd){
    const k=sym+'|'+ymd;if(dayCache.has(k))return dayCache.get(k);
    const D=dailyBase(sym);const i=D.findIndex(x=>x.date===ymd);
    const prevC=i>0?D[i-1].close:(i===0?D[0].open:D[D.length-1].close);
    const target=i>=0?D[i].close:prevC;
    const r=rng(hash('I'+k));const n=192,vol=(sym==='LOWP'?0.004:0.0015);
    const steps=[];let s=0;for(let j=0;j<n;j++){s+=gauss(r)*vol;steps.push(s);}
    const bars=[];let px=prevC;
    for(let j=0;j<n;j++){
      const m=240+5*j;const rth=m>=570&&m<960;
      const bridge=steps[j]-steps[n-1]*(j+1)/n+Math.log(target/prevC)*(j+1)/n;
      const c=prevC*Math.exp(bridge),o=px;
      const h=Math.max(o,c)*(1+Math.abs(gauss(r))*vol*0.5),l=Math.min(o,c)*(1-Math.abs(gauss(r))*vol*0.5);
      px=c;
      const drop=rth?(sym==='LOWP'?r()<0.1:false):r()<0.35;
      const v=Math.round((rth?40000:3000)*(0.3+r()));
      if(drop)continue;
      const t=etEpoch(ymd,Math.floor(m/60),m%60)/1000;
      bars.push({t,o,h,l,c,v});
    }
    dayCache.set(k,bars);return bars;
  }
  const nowS=()=>Math.floor(nowMsFn()/1000);
  function bars5(sym,ymd){const now=nowS();return day5(sym,ymd).filter(b=>b.t<=now).map(b=>{
    if(b.t+300>now){ // forming: truncate deterministically by elapsed share
      return Object.assign({},b);}
    return b;});}
  function bars15(sym,ymd){
    const out=[];for(const b of bars5(sym,ymd)){const k=Math.floor(b.t/900)*900;const L=out[out.length-1];
      if(L&&L.t===k){L.h=Math.max(L.h,b.h);L.l=Math.min(L.l,b.l);L.c=b.c;L.v+=b.v;}
      else out.push({t:k,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v});}
    return out;}
  function daily(sym){
    const today=etParts(nowMsFn()).ymd;
    if(dailyBase(sym)[0]&&dailyBase(sym)[0]._real){
      // option: model a feed that has no row for today before the 09:30 open
      const p=etParts(nowMsFn()),mm=p.h*60+p.m;
      if(process.env.NO_TODAY_PREOPEN==='1'&&mm<570)return dailyBase(sym).filter(x=>x.date<today);
      return dailyBase(sym).filter(x=>x.date<=today);}
    const D=dailyBase(sym).filter(x=>x.date<today);
    const b=bars5(sym,today).filter(x=>{const p=etParts(x.t*1000);const m=p.h*60+p.m;return m>=570&&m<960;});
    if(b.length){D.push({date:today,open:b[0].o,high:Math.max(...b.map(x=>x.h)),low:Math.min(...b.map(x=>x.l)),close:b[b.length-1].c,volume:b.reduce((a,x)=>a+x.v,0)});}
    return D;
  }
  const rnd=x=>+x.toFixed(4);
  function handle(url,method){
    const u=new URL(url);const q=u.searchParams;const sym=(q.get('symbol')||q.get('symbols')||'QQQ').toUpperCase();
    const path=u.pathname;
    if(path.endsWith('/markets/events/session'))return{status:500,body:{fault:'stream disabled in harness'}};
    if(path.endsWith('/markets/history')){
      const start=q.get('start')||'1900-01-01',end=q.get('end')||'2999-12-31';
      const rows=daily(sym).filter(x=>x.date>=start&&x.date<=end).map(x=>x._real?{date:x.date,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume}:({date:x.date,open:rnd(x.open),high:rnd(x.high),low:rnd(x.low),close:rnd(x.close),volume:x.volume}));
      return{status:200,body:{history:{day:rows}}};
    }
    if(path.endsWith('/markets/timesales')){
      const iv=q.get('interval');const s=q.get('start'),e=q.get('end');
      const sMs=etEpoch(s.slice(0,10),+s.slice(11,13),+s.slice(14,16)),eMs=etEpoch(e.slice(0,10),+e.slice(11,13),+e.slice(14,16));
      const today=etParts(nowMsFn()).ymd;
      const oldest=weekdays('2000-01-01',today).slice(-45)[0];   // mimic Tradier's limited intraday retention
      const days=weekdays(etParts(sMs).ymd,etParts(eMs).ymd).filter(d=>d>=oldest);
      const out=[];
      for(const d of days){for(const b of (iv==='15min'?bars15(sym,d):bars5(sym,d))){
        if(b.t*1000<sMs||b.t*1000>eMs)continue;
        const p=etParts(b.t*1000);
        out.push({time:`${p.ymd}T${String(p.h).padStart(2,'0')}:${String(p.m).padStart(2,'0')}:00`,timestamp:b.t,price:rnd(b.c),
          open:rnd(b.o),high:rnd(b.h),low:rnd(b.l),close:rnd(b.c),volume:b.v,vwap:rnd((b.h+b.l+b.c)/3)});}}
      return{status:200,body:{series:out.length?{data:out}:null}};
    }
    if(path.endsWith('/markets/quotes')){
      const today=etParts(nowMsFn()).ymd;const b=bars5(sym,today);const D=dailyBase(sym).filter(x=>x.date<today);
      const last=b.length?b[b.length-1].c:D[D.length-1].close;
      return{status:200,body:{quotes:{quote:{symbol:sym,last:rnd(last),bid:rnd(last-0.01),ask:rnd(last+0.01),prevclose:rnd(D[D.length-1].close),
        trade_date:nowMsFn(),volume:1000000,change:0,change_percentage:0}}}};
    }
    if(path.includes('/options/'))return{status:200,body:{expirations:null,options:null}};
    return{status:404,body:{fault:'unmocked '+path}};
  }
  return{handle,dailyBase,day5,daily,etParts,etEpoch};
}
module.exports={makeMock,etParts,etEpoch,weekdays};
