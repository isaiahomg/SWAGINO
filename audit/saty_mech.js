// Direct test of the auto-length fit's dependence on today's forming row (pure functions from the file).
const fs=require('fs');
const src=fs.readFileSync('/home/user/SWAGINO/swagino.html','utf8');
const grab=re=>{const m=re.exec(src);if(!m)throw new Error('missing '+re);return m[0];};
eval(grab(/function rmaSeries\(vals,n\)\{[\s\S]*?\n\}/));
eval(grab(/const SATY_LEN_BAND=\[[^\]]*\];/).replace('const ','var '));
eval(grab(/function satyAutoLen\(rows,look\)\{[\s\S]*?\n\}/));
const {makeMock}=require('./mock.js');
// vol-clustered daily rows (GARCH-like) so neighbouring lengths fit almost equally well
function rows(seed){let a=seed;const r=()=>{a=(a*1664525+1013904223)>>>0;return a/4294967296;};
  const g=()=>Math.sqrt(-2*Math.log(r()||1e-12))*Math.cos(2*Math.PI*r());
  const out=[];let c=100,v=0.015;
  for(let i=0;i<600;i++){v=Math.sqrt(0.000002+0.12*Math.pow(g()*v,2)+0.86*v*v);const o=c*(1+g()*v*0.3);const cl=o*(1+g()*v);
    out.push({key:'d'+String(i).padStart(4,'0'),open:o,high:Math.max(o,cl)*(1+Math.abs(g())*v*0.6),low:Math.min(o,cl)*(1-Math.abs(g())*v*0.6),close:cl});c=cl;}
  return out;}
let sensitive=0,total=0;const ex=[];
for(let seed=1;seed<=300;seed++){
  const R=rows(seed);const done=R.slice(0,-1),today=R[R.length-1];
  const lens=new Set();
  for(const f of [0.2,0.5,1,2,4,8]){               // today's range so far, as a multiple of the prior close's 1% move
    const t=Object.assign({},today);const pc=done[done.length-1].close;t.high=pc*(1+0.01*f);t.low=pc*(1-0.01*f);t.close=pc;
    lens.add(satyAutoLen(done.concat([t])));       // OLD: fitted on rows incl. today's forming row
  }
  total++;if(lens.size>1){sensitive++;if(ex.length<3)ex.push({seed,lens:[...lens],newLen:satyAutoLen(done)});}
}
console.log(`old fit changed with today's forming range on ${sensitive}/${total} symbols-days; new fit uses completed days only (one value by construction)`,ex);
