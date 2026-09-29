const {boot,done,etMs}=require('./h.js');
(async()=>{for(const r of [0,1])for(const build of r?['new','old']:['old','new']){
  const A=await boot({build,sym:'SPY',t0:etMs('2026-09-28',21,0,0),cfg:{paneN:1}});await A.stopPolling();
  const t=await A.page.evaluate(()=>{const out={};for(const sess of ['eth','rth']){cfg.sess=sess;const ts=[];
    for(let k=0;k<15;k++){const a=performance.now();seriesForTFRaw('5');seriesForTFRaw('60');ts.push(performance.now()-a);}
    ts.sort((x,y)=>x-y);out[sess]=+ts[7].toFixed(2);}cfg.sess='eth';return out;});
  console.log(build,'median ms for seriesForTFRaw 5m+1H (6.8k 5m bars):',JSON.stringify(t));await A.close();}
  await done();})();
