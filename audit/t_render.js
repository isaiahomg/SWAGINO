// Render sweep on the NEW build: every symbol x timeframe with every indicator on; the chart's own
// series must equal an independent recompute of the underlying arrays, and nothing may error.
const {boot,done,etMs}=require('./h.js');
const SYMS=(process.argv[2]||'SPY,QQQ,AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,LOWP').split(',');
(async()=>{
  const tot={renders:0,checks:0,bad:{},errors:[]};
  for(const sym of SYMS){
    const A=await boot({build:'new',sym,t0:etMs('2026-09-28',11,7,0),cfg:{tf0:'5',tf1:'60',ribbon0:true,ribbon1:true,vwap0:true,vwap1:true,
      struct0:true,struct1:true,saty0:true,saty1:true,tfPresets:false,rsi:{smType:'bb',smLen:14,grad:true}}});
    await A.stopPolling();
    const shown=[];
    await A.page.exposeFunction('__err',m=>shown.push(m));
    await A.page.evaluate(()=>{const o=showErr;showErr=m=>{__err(String(m));return o(m);};});
    const r=await A.page.evaluate(()=>{
      const out={renders:0,checks:0,bad:{}};const bad=k=>out.bad[k]=(out.bad[k]||0)+1;
      const p=panes[0];
      for(const tf of ['5','10','60','240','D','W']){
        p.tf=tf;renderPane(p);out.renders++;
        const data=seriesForTF(tf,paneData(p));
        const eq=(series,arr,round,name)=>{const m=new Map(series.data().map(x=>[x.time,x]));
          for(let i=0;i<data.length;i++){out.checks++;const want=arr[i]==null?undefined:round(arr[i],i);
            const got=m.get(data[i].time);const gv=got?got.value:undefined;
            if(gv!==want){bad(name);return;}}
          const nonNull=arr.filter(x=>x!=null).length;if([...m.values()].filter(x=>x.value!=null).length!==nonNull)bad(name+':count');};
        // candles
        const c=p.candles.data();
        if(c.length!==data.length)bad('candles:len');else data.forEach((b,i)=>{out.checks++;const x=c[i];
          if(x.time!==b.time||x.open!==b.open||x.high!==b.high||x.low!==b.low||x.close!==b.close)bad('candles');});
        const v=p.vol.data();data.forEach((b,i)=>{out.checks++;if(!v[i]||v[i].value!==b.volume)bad('vol');});
        // RSI + BB (sma 14) from the primitives, rounded by the 2-decimal rule
        const rs=rsiWithParts(data.map(d=>d.close),Math.max(1,paneParams(p).rsiLen)).rsi;
        eq(p.rsi,rs,r2,'rsi');
        const ma=maCalc(rs,14,'sma'),sd=popStdev(rs,14);
        eq(p.rsiMa,ma,r2,'rsiMa');
        eq(p.rsiBBu,ma.map((m,i)=>m==null||sd[i]==null?null:m+sd[i]*2),r2,'rsiBBu');
        // MACD 12/26/9 ema, 2 decimals finer than the bar's price
        const cl=data.map(d=>d.close),f=emaLike(cl,12),s=emaLike(cl,26);
        function emaLike(a,n){return maCalc(a,n,'ema');}
        const mac=f.map((x,i)=>x==null||s[i]==null?null:x-s[i]);const sig=maCalc(mac,9,'ema');
        eq(p.macdLine,mac,(x,i)=>+x.toFixed(pxDp(data[i].close)+2),'macd');
        eq(p.sigLine,sig,(x,i)=>+x.toFixed(pxDp(data[i].close)+2),'signal');
        // ribbon (no warp) and VWAP session, 5 significant digits
        {const e8=emaCalc(cl,8);if(data.length>=2&&lastBarForming(tf,data[data.length-1]))e8[data.length-1]=e8[data.length-2];   // forming bar repeats the previous EMA
         eq(p.rbFast,e8,x=>+x.toFixed(pxDp(x)),'rbFast');}
        if(!(tf==='D'||tf==='W')||!cfg.vwap.hideOnDWM){
          const vw=computeVwapSeries(data,'session').values;eq(p.vwLines[0],vw,x=>+x.toFixed(pxDp(x)),'vwap');}
        // crosshair lookups exist and cover every bar
        for(const k of ['rsi','macd','adx']){out.checks++;if(!p.vals[k]||p.vals[k].length!==data.length)bad('vals.'+k);}
      }
      return out;
    });
    tot.renders+=r.renders;tot.checks+=r.checks;for(const k in r.bad)tot.bad[k]=(tot.bad[k]||0)+r.bad[k];
    if(shown.length)tot.errors.push(...shown.map(m=>sym+': '+m));
    if(A.errors.length)tot.errors.push(...A.errors.map(m=>sym+': '+m.slice(0,160)));
    console.log(sym,JSON.stringify(r.bad),'shownErrors',shown.length,'pageErrors',A.errors.length);
    await A.close();
  }
  console.log('TOTAL',JSON.stringify(tot));
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
