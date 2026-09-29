// Real-time daily-row behaviour + early-close session handling, old vs new. Daily history = REAL Tradier.
const {boot,done,etMs}=require('./h.js');
(async()=>{
  for(const build of ['old','new']){
    const out={};
    // 1) post-market prints must not move the regular-session daily bar; the closing-auction second may
    {const A=await boot({build,sym:'TSLA',t0:etMs('2026-09-28',16,30,0),cfg:{tf0:'D',tf1:'W',paneN:2}});await A.stopPolling();
     out.postMarket=await A.page.evaluate(()=>{const r=dailyRows[dailyRows.length-1];const before={c:r.close,h:r.high,l:r.low};
       const at=(h,m,s)=>{const b=new Date();return Math.floor(parseEtStamp('2026-09-28 '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'))/1000);};
       updateForming(before.h+5,100,false,null,at(16,29,50));            // after-hours print above the day's high
       const afterAH={c:r.close,h:r.high,l:r.low};
       updateForming(before.c+0.01,100,false,null,at(16,0,0));             // closing-auction second
       const afterAuction={c:r.close};
       const dPane=panes[0];renderPane(dPane);const cd=dPane.candles.data();const last=cd[cd.length-1];
       return{date:r.date,before,afterAH,afterAuction,dChartClose:last.close,dChartHigh:last.high};});
     await A.close();}
    // 2) a feed with no row for today before the open: the row must appear once the session is open
    process.env.NO_TODAY_PREOPEN='1';
    {const A=await boot({build,sym:'SPY',t0:etMs('2026-09-28',8,0,0),cfg:{tf0:'D',tf1:'W',paneN:2}});await A.stopPolling();
     const pre=await A.page.evaluate(()=>dailyRows[dailyRows.length-1].date);
     await A.setNow(etMs('2026-09-28',9,31,0));
     await A.page.evaluate(async()=>{await rollDailyIfNeeded();});
     const post=await A.page.evaluate(()=>{panes[0].tf='D';renderPane(panes[0]);const d=panes[0].candles.data();return{lastRow:dailyRows[dailyRows.length-1].date,dChartLast:d[d.length-1].time};});
     out.missingToday={preOpenLastRow:pre,...post};
     await A.close();}
    delete process.env.NO_TODAY_PREOPEN;
    // 3) early-close day (2026-11-27, 13:00 close): regular-session filter, session shading, calendar
    {const A=await boot({build,sym:'SPY',t0:etMs('2026-09-28',21,0,0),cfg:{paneN:1}});await A.stopPolling();
     out.earlyClose=await A.page.evaluate(()=>{cfg.sess='rth';const k=m=>sessKeep({etYmd:'2026-11-27',etMin:m});
       const r={rth_12_55:k(775),rth_13_05:k(785),rth_15_55:k(955),normalDay_15_55:sessKeep({etYmd:'2026-11-25',etMin:955})};cfg.sess='eth';
       const c=marketCalendar(2026);r.jul3={closed:c.closed.has('2026-07-03'),early:c.early.has('2026-07-03')};
       r.juneteenth2021Closed=isMarketHoliday('2021-06-18');r.juneteenth2022Closed=isMarketHoliday('2022-06-20');
       r.dayOfMourning2025Closed=isMarketHoliday('2025-01-09');
       try{r.shade_13_30=sessClass(810,'2026-11-27');r.shade_13_30_normal=sessClass(810,'2026-11-25');}catch(e){r.shade=String(e);}
       return r;});
     await A.close();}
    console.log(build,JSON.stringify(out,null,1));
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
