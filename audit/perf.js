// Interleaved A/B of per-tick main-thread cost (JS + chart paint), old vs new build.
// Real timers/rAF; Date shifted to 11:05:05 ET. Cost = CDP Performance TaskDuration delta / ticks.
const {boot,done,etMs}=require('./h.js');
const ROUNDS=+(process.argv[2]||3),N=+(process.argv[3]||200);
(async()=>{
  const rows=[];
  for(let r=0;r<ROUNDS;r++)for(const tape of ['random','trend'])for(const build of (r%2?['new','old']:['old','new'])){
    const A=await boot({build,sym:'QQQ',shiftDate:true,t0:etMs('2026-09-28',11,5,5),
      cfg:{tf0:'5',tf1:'60',ribbon0:true,ribbon1:true,vwap0:true,vwap1:true,tfPresets:false,rsi:{smType:'sma',smLen:14,grad:true}}});
    await A.stopPolling();
    await A.page.evaluate(()=>{visPanes().forEach(p=>renderPane(p));});
    await A.page.waitForTimeout(500);
    const cdp=await A.ctx.newCDPSession(A.page);await cdp.send('Performance.enable');
    const m=async()=>{const x=await cdp.send('Performance.getMetrics');const o={};x.metrics.forEach(k=>o[k.name]=k.value);return o;};
    const before=await m();
    const js=await A.page.evaluate(async([N,tape])=>{
      let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
      let px=bars5[bars5.length-1].c;const vol=px*0.0006;let jsT=0,renders=0;
      const t0=panes[0]._structTailT;
      for(let i=0;i<N;i++){
        px+=(rnd()-0.5)*2*vol+(tape==='trend'?vol*0.7:0);
        const a=performance.now();
        updateForming(+px.toFixed(4),1+Math.floor(rnd()*300),false,null,Math.floor(Date.now()/1000));
        jsT+=performance.now()-a;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      }
      const rl=panes[0].rsi.data().slice(-1)[0];
      return{jsPerTick:jsT/N,rollover:panes[0]._structTailT!==t0,rsiNow:rl&&rl.value};
    },[N,tape]);
    const after=await m();
    const task=(after.TaskDuration-before.TaskDuration)*1000/N;
    rows.push({r,tape,build,taskMsPerTick:+task.toFixed(3),jsMsPerTick:+js.jsPerTick.toFixed(3),rollover:js.rollover,rsi:js.rsiNow});
    console.log(JSON.stringify(rows[rows.length-1]));
    await A.close();
  }
  const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  for(const tape of ['random','trend'])for(const build of ['old','new']){
    const x=rows.filter(q=>q.tape===tape&&q.build===build);
    console.log(`MEDIAN ${tape} ${build}: task ${med(x.map(q=>q.taskMsPerTick))} ms/tick, js ${med(x.map(q=>q.jsMsPerTick))} ms/tick`);
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
