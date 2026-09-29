const fs=require('fs');
const load=f=>{const src=fs.readFileSync(f,'utf8');const g=re=>re.exec(src)[0];
  const code=[g(/function normPdf\(x\)\{[^\n]*\}/),g(/function normCdf\(x\)\{[\s\S]*?\n\}/),g(/function bsD1D2[\s\S]*?\n\}/),g(/function bsPrice[\s\S]*?\n\}/),g(/function bsVega[\s\S]*?\n\}/),
    g(/const IV_MIN=[^\n]*/),g(/const IV_TOL=[^\n]*/),g(/const IV_NR_MAX_ITER=[^\n]*/),g(/function solveIV[\s\S]*?\n\}/)].join('\n');
  const inst={};new Function('inst',code.replace(/const /g,'var ')+';inst.solveIV=solveIV;inst.bsPrice=bsPrice;inst.normCdf=normCdf;')(inst);return inst;};
const NEW=load('/home/user/SWAGINO/swagino.html'),OLD=load('site/old/swagino.html');
// true prices from the high-precision CDF; the question is what each solver recovers from them
let n=0;const st={old:{fail:0,maxErr:0,sumErr:0},new:{fail:0,maxErr:0,sumErr:0}};
for(const S of [5,50,500])for(const m of [0.6,0.8,0.9,1,1.1,1.25,1.5])for(const T of [1/365,7/365,30/365,0.5,1])for(const sig of [0.15,0.3,0.6,1.2])for(const put of [false,true]){
  const K=S*m,r=0.037;const px=NEW.bsPrice(put,S,K,T,r,0,sig);if(!(px>1e-4))continue;n++;
  for(const [k,I] of [['old',OLD],['new',NEW]]){const iv=I.solveIV(put,S,K,T,r,0,px);
    if(iv==null){st[k].fail++;continue;}const e=Math.abs(iv-sig);st[k].maxErr=Math.max(st[k].maxErr,e);st[k].sumErr+=e;}
}
for(const k of ['old','new'])st[k].meanErr=(st[k].sumErr/n).toExponential(2),st[k].maxErr=st[k].maxErr.toExponential(2),delete st[k].sumErr;
console.log('cases',n,JSON.stringify(st));
console.log('N(1) old',OLD.normCdf(1),'new',NEW.normCdf(1),'N(-6) old',OLD.normCdf(-6),'new',NEW.normCdf(-6));
// identifiable cases only: a 1e-4 change in sigma moves the price by > 100x IV_TOL
let m=0;const s2={old:{bad:0,maxErr:0},new:{bad:0,maxErr:0}};
for(const S of [5,50,500])for(const mm of [0.6,0.8,0.9,1,1.1,1.25,1.5])for(const T of [1/365,7/365,30/365,0.5,1])for(const sig of [0.15,0.3,0.6,1.2])for(const put of [false,true]){
  const K=S*mm,r=0.037;const px=NEW.bsPrice(put,S,K,T,r,0,sig);
  if(Math.abs(NEW.bsPrice(put,S,K,T,r,0,sig+1e-4)-px)<1e-4)continue;m++;
  for(const [k,I] of [['old',OLD],['new',NEW]]){const iv=I.solveIV(put,S,K,T,r,0,px);const e=iv==null?1:Math.abs(iv-sig);
    s2[k].maxErr=Math.max(s2[k].maxErr,e);if(e>1e-4)s2[k].bad++;}
}
console.log('identifiable',m,JSON.stringify(s2));
