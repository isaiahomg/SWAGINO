// GEX live-update coherence on a REAL chain. Old path (current app): bootstrap at S0, then each option quote tick
// re-solves ONLY that contract at the new spot and adds its delta. Reference (the definition): every contract's
// GEX evaluated at the SAME current spot/T, with each contract's IV from its latest quote.
const fs=require('fs');
const src=fs.readFileSync('/home/user/SWAGINO/swagino.html','utf8');const g=re=>re.exec(src)[0];
const I={};new Function('I',[g(/function normPdf\(x\)\{[^\n]*\}/),g(/function normCdf\(x\)\{[\s\S]*?\n\}/),g(/function bsD1D2[\s\S]*?\n\}/),g(/function bsPrice[\s\S]*?\n\}/),
  g(/function bsVega[\s\S]*?\n\}/),g(/function bsGamma[\s\S]*?\n\}/),g(/function bsBounds[\s\S]*?\n\}/),g(/const IV_MIN=[^\n]*/),g(/const IV_TOL=[^\n]*/),
  g(/const IV_NR_MAX_ITER=[^\n]*/),g(/function solveIV[\s\S]*?\n\}/),g(/function gexContract[\s\S]*?\n\}/),g(/function gexFlip[\s\S]*?\n\}/)].join('\n').replace(/const /g,'var ')
  +';Object.assign(I,{bsPrice,bsGamma,bsBounds,solveIV,gexContract,gexFlip});')(I);
const {etEpoch}=require('./mock.js');const YEAR=365*86400*1000,r=0.037;
function run(sym,exp,S0,moves,tickShare){
  const chain=JSON.parse(fs.readFileSync(`real/chain_${sym}_${exp}.json`));
  const T0=(etEpoch(exp,16,0)-etEpoch('2026-09-28',13,0))/YEAR;
  const C=[];
  for(const o of chain){const k=+o.strike,d=Math.abs(k-S0)/S0;if(d>0.2||!(+o.open_interest>0)||!(o.bid>0&&o.ask>0&&o.bid<=o.ask))continue;
    const isPut=o.option_type==='put',mid=(o.bid+o.ask)/2,b=I.bsBounds(isPut,S0,k,T0,r,0);if(!(mid>b.lo&&mid<b.hi))continue;
    const iv=I.solveIV(isPut,S0,k,T0,r,0,mid);if(iv==null)continue;
    C.push({k,isPut,oi:+o.open_interest,iv,win:d<=0.04,val:I.gexContract(I.bsGamma(S0,k,T0,r,0,iv),+o.open_interest,S0,isPut)});}
  // old path state
  const board={};C.forEach(c=>{if(c.win)board[c.k]=(board[c.k]||0)+c.val;});
  let rng=7;const rand=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;};
  let S=S0,T=T0;const rows=b=>Object.keys(b).map(k=>({strike:+k,val:b[k]})).sort((a,b)=>a.strike-b.strike);
  const summ=(R,spot)=>{const pos=R.filter(x=>x.val>0),neg=R.filter(x=>x.val<0);const f=I.gexFlip(R,spot);
    return{maxG:pos.length?pos.reduce((a,b)=>b.val>a.val?b:a).strike:null,minG:neg.length?neg.reduce((a,b)=>b.val<a.val?b:a).strike:null,flip:f&&+f.price.toFixed(2),
      net:R.reduce((s,x)=>s+x.val,0)};};
  const out=[];
  for(const mv of moves){
    S=S0*(1+mv);T=T0-30*60*1000/YEAR;   // 30 minutes later
    // a share of contracts quote-ticks: its market mid is the BS price at the new spot with its (unchanged) IV
    for(const c of C){if(rand()>tickShare)continue;
      const mid=I.bsPrice(c.isPut,S,c.k,T,r,0,c.iv);const b=I.bsBounds(c.isPut,S,c.k,T,r,0);
      let v=0;if(mid>b.lo&&mid<b.hi){const iv=I.solveIV(c.isPut,S,c.k,T,r,0,mid);if(iv!=null){c.iv=iv;v=I.gexContract(I.bsGamma(S,c.k,T,r,0,iv),c.oi,S,c.isPut);}else c.iv=null;}else c.iv=null;
      if(c.win)board[c.k]=(board[c.k]||0)+(v-c.val);c.val=v;}
    // reference: every contract at the current spot/T with its latest IV
    const ref={};for(const c of C){if(!c.win||c.iv==null)continue;ref[c.k]=(ref[c.k]||0)+I.gexContract(I.bsGamma(S,c.k,T,r,0,c.iv),c.oi,S,c.isPut);}
    const RO=rows(board),RR=rows(ref);let worst=0,wk=null;const tot=RR.reduce((s,x)=>s+Math.abs(x.val),0);
    for(const x of RR){const o=board[x.strike]||0;const e=Math.abs(o-x.val)/tot;if(e>worst){worst=e;wk=x.strike;}}
    out.push({move:(mv*100).toFixed(2)+'%',tickShare,maxAbsStrikeErrPctOfBoard:(worst*100).toFixed(2)+'% @'+wk,old:summ(RO,S),ref:summ(RR,S)});
  }
  return{contracts:C.length,out};
}
for(const [sym,exp,S0] of [['SPY','2026-09-29',765.61],['TSLA','2026-10-02',357.45]])
  for(const share of [0.3,0.7]){const R=run(sym,exp,S0,[0.002,0.005,-0.004],share);
    console.log(sym,'contracts',R.contracts);R.out.forEach(o=>console.log(' ',JSON.stringify(o)));}
