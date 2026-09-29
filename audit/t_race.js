// Symbol switch while the previous symbol's background loads are still in flight (realistic API latency).
const {boot,done,etMs}=require('./h.js');
const build=process.argv[2]||'new';
(async()=>{
  const res=[];
  const N=+(process.argv[3]||4);for(let trial=0;trial<N;trial++){
    const A=await boot({build,sym:'QQQ',raw:true,delayMs:300,stall:trial%2?{re:/symbol=QQQ&interval=15min/,ms:6000}:null,t0:etMs('2026-09-28',21,0,0),cfg:{tf0:'60',tf1:'D',paneN:2,saty0:true,saty1:true,struct0:true}});
    // switch the instant the first chart is up — 15m history, backfill and the quote for QQQ are still in flight
    await A.page.evaluate(async()=>{$('#symInput').value='TSLA';await connect();});
    await A.page.waitForTimeout(12000);
    const got=await A.page.evaluate(()=>({sym:cfg.sym,b5:bars5.map(b=>[b.t,b.c]),b15:bars15.map(b=>[b.t,b.c]),daily:dailyRows.map(r=>[r.date,r.close]),
      satyLenDrawn:panes[1].satyState&&panes[1].satyState.atr,
      bosKinds:(()=>{const p=panes[0];renderPane(p);const a=(p.brks||[]).map(b=>b.kind+b.dir+b.i);
        const data=seriesForTF(p.tf,paneData(p));const PP=paneParams(p);const fresh=lastBreaks(data,p.sw,PP.swing,data.length-0,new Map()).map(b=>b.kind+b.dir+b.i);
        return{cached:a.join(','),fresh:fresh.join(',')};})(),satyFresh:(()=>{satyAutoCache.clear();const s=satyCompute(dailyRows,cfg.sym);return s&&s.atr;})()}));
    const chk=(arr,iv)=>{let bad=0;for(const [t,c] of arr){const p=A.mock.etParts(t*1000);const day=A.mock.day5('TSLA',p.ymd);
      let ref;if(iv===5)ref=day.find(x=>x.t===t);else{const xs=day.filter(x=>Math.floor(x.t/900)*900===t);ref=xs.length?{c:xs[xs.length-1].c}:null;}
      if(!ref||Math.abs(+ref.c.toFixed(4)-c)>1e-9)bad++;}return bad;};
    const realT=new Map(A.mock.dailyBase('TSLA').map(r=>[r.date,r.close]));
    const dailyBad=got.daily.filter(([d,c])=>realT.get(d)!==c).length;
    res.push({trial,sym:got.sym,bars5Foreign:chk(got.b5,5),bars15Foreign:chk(got.b15,15),dailyForeign:dailyBad,n5:got.b5.length,n15:got.b15.length,
      satyAtrDrawn:got.satyLenDrawn,satyAtrTrue:got.satyFresh,bosKindsMatch:got.bosKinds.cached===got.bosKinds.fresh});
    console.log(build,JSON.stringify(res[res.length-1]));
    await A.close();
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
