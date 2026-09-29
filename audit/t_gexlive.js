// End-to-end live GEX in the app, REAL SPY 2026-09-29 chain. After the bootstrap, spot moves and a subset of
// contracts re-quote (mid = BS price at the new spot with the contract's IV). The rendered board must equal the
// definition: every qualifying contract's GEX at the CURRENT spot/time with its latest IV.
const {boot,done,etMs}=require('./h.js');const fs=require('fs');
const chain=JSON.parse(fs.readFileSync('real/chain_SPY_2026-09-29.json'));
(async()=>{
  for(const build of ['old','new']){
    const A=await boot({build,sym:'SPY',t0:etMs('2026-09-28',13,0,0),cfg:{paneN:1}});await A.stopPolling();
    await A.page.route(/\/v1\/markets\/options\//,async route=>{const u=route.request().url();
      const body=/expirations/.test(u)?{expirations:{date:['2026-09-29','2026-10-02']}}:{options:{option:chain}};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
    await A.page.route(/\/v1\/markets\/quotes/,async route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({quotes:{quote:{symbol:'SPY',last:765.61,bid:765.6,ask:765.62,trade_date:Date.now(),prevclose:771.35}}})}));
    const res=await A.page.evaluate(async()=>{
      clearTimeout(gexTimer);lastPx=765.61;
      await computeChainGex();
      const boot0=Object.keys(gexByStrike).length;
      const S0=765.61,S1=S0*1.004;lastPx=S1;
      let seed=11;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
      const r=+cfg.gexRfr/100;const ticked=[];
      // ticks: the ticking contract's mid is the BS price at the new spot with an IV 1 vol point off its old one
      for(const [sym,c] of gexContracts){if(rnd()>0.4)continue;
        const T=yearsToExpiry(c.ex);const ivOld=solveIV(c.isPut,S0,c.strike,T,r,0,(c.bid+c.ask)/2);if(ivOld==null)continue;
        const px=bsPrice(c.isPut,S1,c.strike,T,r,0,ivOld+0.01);const h=Math.max(0.005,px*0.01);
        handleGexQuoteTick({symbol:sym,bid:px-h,ask:px+h});ticked.push(sym);}
      await new Promise(res=>setTimeout(res,1600));   // throttled re-render
      // REFERENCE from the quotes themselves: each contract's IV from its current mid (solved at the spot its
      // quote was observed: S0 for untouched contracts, S1 for re-quoted ones), gamma at S1 and the current T.
      const ref={};let refN=0;
      for(const [sym,c] of gexContracts){
        const T=yearsToExpiry(c.ex);const S_q=ticked.includes(sym)?S1:S0;
        if(!(c.bid>0&&c.ask>0&&c.bid<=c.ask))continue;const mid=(c.bid+c.ask)/2;
        const b=bsBounds(c.isPut,S_q,c.strike,T,r,0);if(!(mid>b.lo&&mid<b.hi))continue;
        const iv=solveIV(c.isPut,S_q,c.strike,T,r,0,mid);if(iv==null||!c.inStrikeWindow)continue;
        ref[c.strike]=(ref[c.strike]||0)+gexContract(bsGamma(S1,c.strike,T,r,0,iv),c.oi,S1,c.isPut);refN++;}
      const keys=new Set([...Object.keys(ref),...Object.keys(gexByStrike)]);let tot=0;for(const k in ref)tot+=Math.abs(ref[k]);
      let worst=0;for(const k of keys){worst=Math.max(worst,Math.abs((gexByStrike[k]||0)-(ref[k]||0))/tot);}
      const B=LS.gex&&LS.gex.meta||null;
      return{bootStrikes:boot0,ticked:ticked.length,maxStrikeErrPctOfBoard:+(worst*100).toFixed(6),
        boardNet:Object.values(gexByStrike).reduce((a,b)=>a+b,0),refNet:Object.values(ref).reduce((a,b)=>a+b,0),
        levels:(LS.gex&&LS.gex.levels||[]).slice(0,3).map(l=>l.label.split(' ')[0]+' '+l.price)};
    });
    console.log(build,JSON.stringify(res));console.log('  errors',A.errors.slice(0,2));
    await A.close();
  }
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
