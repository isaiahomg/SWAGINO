// Intraday backfill vs Tradier's REAL retention limit (REAL_INTRADAY=1: responses recorded from api.tradier.com).
// Boot 1: no cached boundary. Boot 2: boundary cached as the app itself would have stored it after boot 1.
const {boot,done,etMs}=require('./h.js');
const build=process.argv[2]||'new',sym=process.argv[3]||'SPY';
(async()=>{
  const t0=etMs('2026-09-28',21,0,0);let cached={};
  for(const run of [1,2]){
    const seen=[];
    const A=await boot({build,sym,t0,cfg:Object.assign({tf0:'5',paneN:1},cached),raw:true});
    A.page.on('response',r=>{if(/timesales/.test(r.url()))seen.push(r.status()+' '+decodeURIComponent(new URL(r.url()).search).replace(/&session_filter=all/,''));});
    await A.page.waitForFunction(()=>/Backfill complete|Backfill halted/.test(document.body.innerText)||window.__bf,null,{timeout:120000}).catch(()=>{});
    await A.page.waitForTimeout(3000);
    const r=await A.page.evaluate(()=>({b5:[bars5.length,bars5[0].etYmd],b15:[bars15.length,bars15[0].etYmd],c5:cfg.tsRetainDays_5min,c15:cfg.tsRetainDays_15min}));
    console.log(build,'boot',run,JSON.stringify(r));seen.forEach(s=>console.log('   ',s));
    cached={tsRetainDays_5min:r.c5,tsRetainDays_15min:r.c15};
    await A.close();
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
