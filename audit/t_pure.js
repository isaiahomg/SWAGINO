// Pure-layer checks, run on BOTH builds: bucket stamps (batch + tick), Saty Day length determinism,
// Time Warp D/W/M/Y against an independent calendar-period reference.
const {boot,done,etMs}=require('./h.js');
const SYMS=process.argv[2]?process.argv[2].split(','):['QQQ','TSLA','LOWP'];
(async()=>{
  const report={};
  for(const build of ['old','new']){
    const R=report[build]={stamp:{bars:0,bad:0,ohlcvBad:0,tickBad:0},saty:[],warp:{}};
    for(const sym of SYMS){
      const A=await boot({build,sym,t0:etMs('2026-09-28',11,7,0),cfg:{tf0:'60',tf1:'240',ribbon0:true,ribbon1:true}});
      await A.stopPolling();
      // ---- 1. bucket stamps: every coarse bar must be stamped at its bucket's start, and carry the
      // OHLCV of exactly the sub-bars in that bucket. Reference written here from the definition.
      const st=await A.page.evaluate(()=>{
        const out={bars:0,bad:0,ohlcvBad:0,tickBad:0,examples:[]};
        const etOf=t=>{const p=etParts(new Date(t*1000));return{ymd:p.ymd,m:p.h*60+p.m};};
        for(const sess of ['eth','rth']){
          cfg.sess=sess;_serCache.clear();
          const anchor=sess==='rth'?570:240;
          for(const tf of ['10','60','240']){
            const g=+tf;
            const ser=seriesForTF(tf);
            // reference: which source the app uses (deeper of b5/b15; 10m always b5)
            const depth=a=>a.length?a[0].t:Infinity;
            const src=(tf==='10'||depth(bars5)<depth(bars15)||!bars15.length?bars5:bars15).filter(sessKeep);
            const ref=new Map();
            for(const b of src){
              const e=etOf(b.t);const idx=Math.floor((((e.m-anchor)%1440)+1440)%1440/g);
              const startM=(anchor+idx*g)%1440;
              const tStart=b.t-(e.m-startM)*60-(b.t%60);
              const k=tStart;const r=ref.get(k);
              if(!r)ref.set(k,{o:b.o,h:b.h,l:b.l,c:b.c,v:b.v,t:tStart});
              else{r.h=Math.max(r.h,b.h);r.l=Math.min(r.l,b.l);r.c=b.c;r.v+=b.v;}
            }
            for(const bar of ser){
              out.bars++;
              const e=etOf(bar.t);
              const onGrid=((((e.m-anchor)%1440)+1440)%1440)%g===0&&bar.t%60===0;
              if(!onGrid){out.bad++;if(out.examples.length<4)out.examples.push({sess,tf,t:bar.t,et:e});continue;}
              const r=ref.get(bar.t);
              if(!r||r.o!==bar.open||r.h!==bar.high||r.l!==bar.low||r.c!==bar.close||r.v!==bar.volume)out.ohlcvBad++;
              if(toChartTime(bar.t)!==bar.time)out.ohlcvBad++;
            }
            if(ser.length!==ref.size)out.ohlcvBad+=Math.abs(ser.length-ref.size);
            // tick: the live forming bar must land on the same time as the batch's last bar
            const p=panes[0];p.tf=tf;renderPane(p);
            paneTick(p);
            const d=p.candles.data();const last=d[d.length-1];
            if(!last||last.time!==ser[ser.length-1].time){out.tickBad++;}
          }
        }
        cfg.sess='eth';_serCache.clear();
        return out;
      });
      for(const k of ['bars','bad','ohlcvBad','tickBad'])R.stamp[k]+=st[k];
      if(st.examples.length)R.stamp.examples=(R.stamp.examples||[]).concat(st.examples.map(x=>Object.assign({sym},x)));
      // ---- 2. Saty Day length: must not depend on today's still-forming range.
      const sa=await A.page.evaluate(()=>{
        const C=satyC();C.mode='day';C.autoLen=true;
        const today=nowET().ymd;const r=dailyRows[dailyRows.length-1];
        if(r.date!==today)return{err:'no today row'};
        const orig={h:r.high,l:r.low,c:r.close};
        const res=[];
        const scen=[[1,1],[1.001,0.999],[1.02,0.98],[1.06,0.94],[1.15,0.85]];
        for(const [hu,ld] of scen){
          r.high=orig.h*hu;r.low=orig.l*ld;
          satyAutoCache.clear();
          const s=satyCompute(dailyRows);
          const rows=satyPeriods('day',dailyRows);
          res.push({range:+(r.high-r.low).toFixed(2),len:satyLen(typeof satyFitRows==='function'?satyFitRows('day',rows):rows),atr:s&&+s.atr.toFixed(6)});
        }
        Object.assign(r,{high:orig.h,low:orig.l,close:orig.c});
        // reference: auto length fitted on completed days only, from the definition
        const done=satyPeriods('day',dailyRows).filter(x=>x.key<today);
        const refLen=satyAutoLen(done);
        const atr=satyATR(satyPeriods('day',dailyRows),refLen);
        return{res,refLen};
      });
      R.saty.push(Object.assign({sym},sa));
      // ---- 3. Time Warp D/W/M/Y: ribbon fast EMA vs an independent calendar reference.
      const drows=await A.page.evaluate(()=>dailyRows.map(r=>({date:r.date,close:r.close})));
      for(const warp of ['D','W','M','Y']){
        for(const tf of ['5','60','D','W']){
          const got=await A.page.evaluate(([warp,tf])=>{
            cfg.satyRibbon.timeWarp=warp;const p=panes[0];p.tf=tf;p._rbRenderCache=null;renderPane(p);
            return{fast:p.rbSets.fast,piv:p.rbSets.piv,ymd:seriesForTF(tf).map(d=>d.ymd),lens:[+cfg.satyRibbon.fastEma||8,+cfg.satyRibbon.pivotEma||21]};
          },[warp,tf]);
          // reference
          const keyOf=ymd=>{
            if(warp==='D')return ymd;
            if(warp==='M')return ymd.slice(0,7);
            if(warp==='Y')return ymd.slice(0,4);
            const d=new Date(ymd+'T00:00:00Z');const dow=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-dow+1);return d.toISOString().slice(0,10);
          };
          const per=[];for(const r of drows){const w=new Date(r.date+'T12:00:00Z').getUTCDay();if(!w||w===6)continue;
            const k=keyOf(r.date);if(per.length&&per[per.length-1].k===k)per[per.length-1].c=r.close;else per.push({k,c:r.close});}
          const ema=(arr,n)=>{const o=new Array(arr.length).fill(null);if(arr.length<n)return o;let s=0;for(let i=0;i<n;i++)s+=arr[i];o[n-1]=s/n;const k=2/(n+1);for(let i=n;i<arr.length;i++)o[i]=arr[i]*k+o[i-1]*(1-k);return o;};
          let bad=0,cmp=0;
          for(const [li,L] of [[0,'fast'],[1,'piv']]){
            const e=ema(per.map(x=>x.c),got.lens[li]);
            got.ymd.forEach((ymd,i)=>{
              const k=keyOf(ymd);let j=-1;for(let q=0;q<per.length;q++){if(per[q].k<k)j=q;else break;}
              const want=j>=0?e[j]:null;const have=got[L][i];cmp++;
              if(!(want==null&&have==null)&&!(want!=null&&have!=null&&Math.abs(want-have)<=1e-9*Math.abs(want)))bad++;
            });
          }
          const key=warp+'@'+tf;R.warp[key]=R.warp[key]||{cmp:0,bad:0};R.warp[key].cmp+=cmp;R.warp[key].bad+=bad;
        }
      }
      if(A.errors.length)R.errors=(R.errors||[]).concat(A.errors.slice(0,3).map(e=>sym+': '+e.slice(0,200)));
      await A.close();
    }
  }
  console.log(JSON.stringify(report,null,1));
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
