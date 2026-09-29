const fs=require('fs');
const load=f=>{const src=fs.readFileSync(f,'utf8');const g=re=>{const m=re.exec(src);if(!m)throw new Error('missing '+re);return m[0];};
  const code=[g(/function normPdf\(x\)\{[^\n]*\}/),g(/function normCdf\(x\)\{[\s\S]*?\n\}/),g(/function bsD1D2[\s\S]*?\n\}/),g(/function bsPrice[\s\S]*?\n\}/),
    g(/function bsVega[\s\S]*?\n\}/),g(/function bsGamma[\s\S]*?\n\}/),g(/function bsBounds[\s\S]*?\n\}/),g(/const IV_MIN=[^\n]*/),g(/const IV_TOL=[^\n]*/),
    g(/const IV_NR_MAX_ITER=[^\n]*/),g(/function solveIV[\s\S]*?\n\}/),g(/function gexContract[\s\S]*?\n\}/),g(/function gexFlip[\s\S]*?\n\}/),g(/const GEX_DIV_YIELD=[^;]*;/)].join('\n');
  const I={};new Function('I',code.replace(/const /g,'var ')+';Object.assign(I,{normCdf,bsPrice,bsGamma,bsBounds,solveIV,gexContract,gexFlip,GEX_DIV_YIELD});')(I);return I;};
const NEW=load('/home/user/SWAGINO/swagino.html'),OLD=load('site/old/swagino.html');
const {etEpoch}=require('./mock.js');
const r=0.037,YEAR=365*86400*1000;
const cases=[{sym:'SPY',exp:'2026-09-29',spot:765.61},{sym:'TSLA',exp:'2026-10-02',spot:357.45}];
for(const C of cases){
  const chain=JSON.parse(fs.readFileSync(`real/chain_${C.sym}_${C.exp}.json`));
  const valMs=etEpoch('2026-09-28',16,0),T=(etEpoch(C.exp,16,0)-valMs)/YEAR;
  const board={old:{},new:{}};const stat={n:0,ivDiffMax:0,ivDiffMaxAt:null,gexRelMax:0,gexRelAt:null,nullOld:0,nullNew:0,ivVsTradier:[],gammaVsTradier:[]};
  for(const o of chain){
    const k=+o.strike,dist=Math.abs(k-C.spot)/C.spot;if(dist>0.20)continue;
    const oi=+o.open_interest;if(!isFinite(oi)||!oi)continue;
    const bid=+o.bid,ask=+o.ask,isPut=o.option_type==='put';if(!(bid>0)||!(ask>0)||bid>ask)continue;
    const mid=(bid+ask)/2;
    const res={};
    for(const [name,I] of [['old',OLD],['new',NEW]]){
      const bnd=I.bsBounds(isPut,C.spot,k,T,r,0);if(!(mid>bnd.lo&&mid<bnd.hi)){res[name]=null;continue;}
      const s=I.solveIV(isPut,C.spot,k,T,r,0,mid);if(s==null){res[name]=null;continue;}
      const g=I.bsGamma(C.spot,k,T,r,0,s);res[name]={s,g,gex:I.gexContract(g,oi,C.spot,isPut)};
      if(dist<=0.04)board[name][k]=(board[name][k]||0)+res[name].gex;
    }
    if(!res.old)stat.nullOld++;if(!res.new)stat.nullNew++;
    if(res.old&&res.new){stat.n++;
      const d=Math.abs(res.old.s-res.new.s);if(d>stat.ivDiffMax){stat.ivDiffMax=d;stat.ivDiffMaxAt=o.symbol+' mid='+mid;}
      const rg=Math.abs(res.old.gex-res.new.gex)/Math.max(1e-12,Math.abs(res.new.gex));if(rg>stat.gexRelMax){stat.gexRelMax=rg;stat.gexRelAt=o.symbol;}
      if(o.greeks&&o.greeks.mid_iv>0)stat.ivVsTradier.push(Math.abs(res.new.s-o.greeks.mid_iv));
      if(o.greeks&&o.greeks.gamma>0)stat.gammaVsTradier.push(Math.abs(res.new.g-o.greeks.gamma)/o.greeks.gamma);
    }
  }
  const rows=b=>Object.keys(b).map(k=>({strike:+k,val:b[k]})).sort((a,b)=>a.strike-b.strike);
  const summ=(I,b)=>{const R=rows(b);const pos=R.filter(x=>x.val>0),neg=R.filter(x=>x.val<0);
    const maxG=pos.length?pos.reduce((a,b)=>b.val>a.val?b:a):null,minG=neg.length?neg.reduce((a,b)=>b.val<a.val?b:a):null;
    const f=I.gexFlip(R,C.spot);return{strikes:R.length,net:R.reduce((s,x)=>s+x.val,0),maxG:maxG&&maxG.strike,minG:minG&&minG.strike,flip:f&&+f.price.toFixed(3),
      magnets:pos.slice().sort((a,b)=>b.val-a.val).slice(0,3).map(x=>x.strike),pockets:neg.slice().sort((a,b)=>a.val-b.val).slice(0,3).map(x=>x.strike)};};
  const so=summ(OLD,board.old),sn=summ(NEW,board.new);
  const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  console.log(`${C.sym} ${C.exp} T=${(T*365).toFixed(3)}d contracts solved both=${stat.n} (old-null ${stat.nullOld}, new-null ${stat.nullNew})`);
  console.log(`  max |IV old-new| = ${stat.ivDiffMax.toExponential(2)} (${stat.ivDiffMaxAt}); max per-contract |GEX old-new|/|GEX new| = ${stat.gexRelMax.toExponential(2)} (${stat.gexRelAt})`);
  console.log(`  net GEX ±4%: old ${so.net.toExponential(6)} new ${sn.net.toExponential(6)} rel ${(Math.abs(so.net-sn.net)/Math.abs(sn.net)).toExponential(2)}`);
  console.log('  board old',JSON.stringify({...so,net:undefined}));console.log('  board new',JSON.stringify({...sn,net:undefined}));
  console.log(`  vs Tradier/ORATS: median |IV-mid_iv| ${med(stat.ivVsTradier).toFixed(4)}, median rel gamma diff ${(med(stat.gammaVsTradier)*100).toFixed(1)}%`);
}
for(const C of cases){
  const chain=JSON.parse(fs.readFileSync(`real/chain_${C.sym}_${C.exp}.json`));
  const T=(etEpoch(C.exp,16,0)-etEpoch('2026-09-28',16,0))/YEAR;
  const ratios=[],ratiosOwnIv=[];
  for(const o of chain){const k=+o.strike;if(Math.abs(k-C.spot)/C.spot>0.04||!(o.bid>0&&o.ask>0))continue;const G=o.greeks;if(!G||!(G.gamma>0)||!(G.mid_iv>0))continue;
    const s=NEW.solveIV(o.option_type==='put',C.spot,k,T,r,0,(o.bid+o.ask)/2);if(s==null)continue;
    ratios.push(NEW.bsGamma(C.spot,k,T,r,0,s)/G.gamma);
    ratiosOwnIv.push(NEW.bsGamma(C.spot,k,T,r,0,G.smv_vol)/G.gamma);}
  const q=a=>{const s=a.slice().sort((x,y)=>x-y);return [s[Math.floor(s.length*0.1)],s[Math.floor(s.length/2)],s[Math.floor(s.length*0.9)]].map(x=>x.toFixed(3));};
  console.log(C.sym,'gamma ours/ORATS (p10,p50,p90), our IV:',q(ratios),'| with ORATS smv_vol plugged in:',q(ratiosOwnIv));
}
