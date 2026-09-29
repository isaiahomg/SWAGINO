// Live-tick replay: pane 0 is driven ONLY by ticks (updateForming -> paneTick, plus the app's own
// rollover render); pane 1 (linked, same symbol/tf) is fully re-rendered after every tick. Every
// tick-updated series' last two points must be identical in both. The page clock follows the tape
// (each tick is delivered at its own exchange time), so "is the last bar still forming" is real.
const {boot,done,etMs}=require('./h.js');
const build=process.argv[2]||'new';
const SYMS=(process.argv[3]||'QQQ,TSLA,LOWP').split(',');
const TFS=(process.argv[4]||'5,10,60').split(',');
const VARIANTS={
  sma:{tfPresets:false,rsi:{smType:'sma',smLen:14,grad:true}},
  rsiOff:{tfPresets:false,rsi:{smType:'sma',smLen:14,grad:true},ind:{rsi:{on:false}}},
  bb:{tfPresets:false,rsi:{smType:'bb',smLen:14,bbMult:2,grad:true}},
  ema:{tfPresets:false,rsi:{smType:'ema',smLen:9,grad:true}},
};
const DRIFT=process.env.DRIFT==='1';const DSIGN=process.env.DSIGN==='-1'?-1:1;
const VNAMES=(process.argv[5]||Object.keys(VARIANTS).join(',')).split(',');
(async()=>{
  const tot={runs:0,ticks:0,cmp:0,bad:{},vals:{cmp:0,bad:{}},ribbonMovedInBar:0,ribbonFormingChecks:0,errors:[]};
  for(const sym of SYMS)for(const tf of TFS)for(const vn of VNAMES){
    const V=VARIANTS[vn];
    const t0=etMs('2026-09-28',11,7,0);
    const A=await boot({build,sym,t0,cfg:Object.assign({tf0:tf,tf1:tf,ribbon0:true,ribbon1:true,vwap0:true,vwap1:true},V)});
    await A.stopPolling();
    await A.page.clock.pauseAt(t0+30000);
    const t0s=Math.floor(t0/1000)+30;
    await A.page.evaluate(()=>{
      const p0=panes[0],p1=panes[1];renderPane(p0);renderPane(p1);
      const S=[['candles',null],['vol',null],['rbFast',null],['rbPivot',null],['rbSlow',null],['rbCloudFast',null],['rbCloudSlow',null],
        ['rsi',null],['rsiMa',null],['rsiBBu',null],['rsiBBl',null],['rsiOB','ob'],['rsiOS','os'],
        ['macdLine',null],['sigLine',null],['macdHist',null],['adxLine',null],['adxPlus',null],['adxMinus',null]];
      const K=['time','open','high','low','close','value','a','b','color'];const pick=x=>K.map(k=>x[k]);const same=(a,b)=>JSON.stringify(pick(a))===JSON.stringify(pick(b));
      const fillInvisible=(pt,kind)=>{if(!pt||pt.value==null)return true;return kind==='ob'?pt.value<=+cfg.rsi.up:pt.value>=+cfg.rsi.lo;};
      window.__out={ticks:0,cmp:0,bad:{},ex:[],vals:{cmp:0,bad:{}},fillLag:0,obosTicks:0,osTicks:0,rbMoved:0,rbForming:0};
      window.__prevRb=null;
      window.__step=(px,sz,ts)=>{
        const out=window.__out;
        updateForming(px,sz,false,null,ts);
        renderPane(p1);                       // reference: full recompute
        out.ticks++;
        for(const [name,kind] of S.concat(p0.vwLines.map((_,k)=>['vw'+k,null]))){
          const s0=name.startsWith('vw')?p0.vwLines[+name.slice(2)]:p0[name];
          const s1=name.startsWith('vw')?p1.vwLines[+name.slice(2)]:p1[name];
          if(!s0||!s1)continue;
          const a=s0.data().slice(-2),b=s1.data().slice(-2);
          for(const pb of b){
            const pa=a.find(x=>x.time===pb.time)||null;out.cmp++;
            const ok=kind?((fillInvisible(pa,kind)&&fillInvisible(pb,kind))||(pa&&same(pa,pb))):(pa&&same(pa,pb));
            if(!ok){out.bad[name]=(out.bad[name]||0)+1;if(out.ex.length<6)out.ex.push({name,ts,tick:pa,ref:pb});}
          }
        }
        // Saty ribbon on a FORMING bar: equals the previous bar's value and never moves within the bar
        {const d=p0.rbFast.data();const L=d[d.length-1],P=d[d.length-2];
         const data=seriesForTF(p0.tf,paneData(p0));
         if(L&&P&&lastBarForming(p0.tf,data[data.length-1])){out.rbForming++;
           if(L.value!==P.value)out.rbMoved++;
           if(window.__prevRb&&window.__prevRb.time===L.time&&window.__prevRb.value!==L.value)out.rbMoved++;}
         window.__prevRb=L?{time:L.time,value:L.value}:null;}
        {const rl=p0.rsi.data().slice(-1)[0];
         if(rl&&rl.value!=null&&(rl.value>+cfg.rsi.up||rl.value<+cfg.rsi.lo)&&cfg.rsi.grad!==false&&cfg.ind.rsi.on){
           out.obosTicks++;if(rl.value<+cfg.rsi.lo)out.osTicks++;const ob=rl.value>+cfg.rsi.up;const f=(ob?p0.rsiOB:p0.rsiOS).data().find(x=>x.time===rl.time);
           const fv=f&&f.value!=null?f.value:(ob?+cfg.rsi.up:+cfg.rsi.lo);out.fillLag=Math.max(out.fillLag,Math.abs(fv-rl.value));}}
        for(const k of ['rsi','macd','adx']){
          const a=p0.vals&&p0.vals[k],b=p1.vals&&p1.vals[k];if(!b||!b.length)continue;out.vals.cmp++;
          const va=a&&a.length===b.length?a[a.length-1]:undefined,vb=b[b.length-1];
          if(!(va===vb||(va!=null&&vb!=null&&Math.abs(va-vb)<=1e-9*Math.max(1,Math.abs(vb)))))out.vals.bad[k]=(out.vals.bad[k]||0)+1;
        }
      };
    });
    // deterministic tape: random walk from the last close, a tick every 6-40s for ~92 minutes
    let seed=0;for(const ch of sym+tf)seed=(seed*31+ch.charCodeAt(0))>>>0;
    const r=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    let px=await A.page.evaluate(()=>bars5[bars5.length-1].c),ts=t0s;const vol=px*0.0006;let k=0;
    while(ts<t0s+92*60){
      ts+=6+Math.floor(r()*34);
      const ph=Math.floor(k/70)%4;const dr=DRIFT?(ph===0||ph===1?1:-1)*vol*0.7*DSIGN:0;k++;
      px=Math.max(0.01,px+(r()-0.5)*2*vol+dr);
      await A.page.clock.setSystemTime(ts*1000+300);
      await A.page.evaluate(([p,s,t])=>window.__step(p,s,t),[+px.toFixed(4),1+Math.floor(r()*500),ts]);
    }
    const res=await A.page.evaluate(()=>window.__out);
    tot.runs++;tot.maxFillLag=Math.max(tot.maxFillLag||0,res.fillLag);tot.obosTicks=(tot.obosTicks||0)+res.obosTicks;tot.ticks+=res.ticks;tot.cmp+=res.cmp;tot.vals.cmp+=res.vals.cmp;
    tot.ribbonMovedInBar+=res.rbMoved;tot.ribbonFormingChecks+=res.rbForming;
    for(const k in res.bad)tot.bad[k]=(tot.bad[k]||0)+res.bad[k];
    for(const k in res.vals.bad)tot.vals.bad[k]=(tot.vals.bad[k]||0)+res.vals.bad[k];
    const nb=Object.keys(res.bad).length+Object.keys(res.vals.bad).length+res.rbMoved;
    console.log(`${build} ${sym} tf=${tf} ${vn}: obosTicks=${res.obosTicks} osTicks=${res.osTicks} maxFillLag=${res.fillLag.toFixed(2)} rbForming=${res.rbForming} rbMoved=${res.rbMoved} ticks=${res.ticks} cmp=${res.cmp} bad=${JSON.stringify(res.bad)} vals=${JSON.stringify(res.vals.bad)}`+(nb&&res.ex.length?' ex='+JSON.stringify(res.ex.slice(0,2)):''));
    if(A.errors.length){tot.errors.push(...A.errors.slice(0,3).map(e=>`${sym}/${tf}/${vn}: `+e.slice(0,200)));}
    await A.close();
  }
  console.log('TOTAL',JSON.stringify(tot));
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
