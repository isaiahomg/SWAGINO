const {boot,done,etMs}=require('./h.js');
(async()=>{
  for(const build of ['old','new'])for(const sym of ['QQQ','LOWP']){
    const A=await boot({build,sym,t0:etMs('2026-09-28',11,7,0),cfg:{tf0:'5',tf1:'D',ribbon0:true,ribbon1:true,vwap0:true,vwap1:true}});
    await A.stopPolling();
    const r=await A.page.evaluate(()=>{
      const out={};
      for(const p of panes.slice(0,2)){
        renderPane(p);
        const h=p.macdHist.data().filter(x=>x.value!=null);
        const zero=h.filter(x=>x.value===0).length;
        // relative plotting error of each series vs its unrounded value
        const ix=t=>p.tIndex.get(typeof t==='string'?t:String(t));
        const relErr=(series,raw)=>{const d=series.data();let m=0;d.forEach(x=>{const i=ix(x.time);if(x.value!=null&&raw[i]!=null&&raw[i]!==0)m=Math.max(m,Math.abs(x.value-raw[i])/Math.abs(raw[i]));});return m;};
        const macdRaw=(()=>{const M=cfg.macd;const s=p.vals.close;const f=maCalc(s,M.fastLen,M.oscType),sl=maCalc(s,M.slowLen,M.oscType);return f.map((v,i)=>v==null||sl[i]==null?null:v-sl[i]);})();
        out[p.tf]={histBars:h.length,histZero:zero,
          ribbonFastMaxRelErr:relErr(p.rbFast,p.rbSets.fast).toExponential(2),
          vwapMaxRelErr:relErr(p.vwLines[0],p.vwSets[0]).toExponential(2),
          macdMaxAbsErr:(()=>{const d=p.macdLine.data();let m=0;d.forEach(x=>{const v=macdRaw[ix(x.time)];if(x.value!=null&&v!=null)m=Math.max(m,Math.abs(x.value-v));});return m.toExponential(2);})(),
          valsMacdPresent:!!(p.vals&&p.vals.macd),
          lastClose:p.lastClose};
      }
      return out;
    });
    console.log(build,sym,JSON.stringify(r));
    await A.close();
  }
  await done();
})();
