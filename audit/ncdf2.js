const fs=require('fs');
eval(fs.readFileSync('ncdf.js','utf8').split('const ref=')[0]);
const ref=JSON.parse(fs.readFileSync('ncdf_ref_mp.json'));
for(const Z0 of [1,1.5,2,2.5,3]){
  const f=mk(Z0);let mr=0,at=null,mru=0,atu=null;
  for(const [x,t,neg,u] of ref){
    if(Math.abs(x)>37)continue;
    const v=f(x);
    if(neg){const r=Math.abs(v-t)/t;if(r>mr){mr=r;at=x;}}
    else{const r=Math.abs(v-u)/u;if(r>mru){mru=r;atu=x;}}
  }
  console.log('Z0',Z0,'maxRel N(x<0)',mr.toExponential(2),'at',at.toFixed(4),'| maxRel N(x>=0)',mru.toExponential(2));
}
// A&S current implementation for comparison
function normCdfAS(x){const sign=x<0?-1:1;const ax=Math.abs(x)/Math.SQRT2;const t=1/(1+0.3275911*ax);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-ax*ax);return 0.5*(1+sign*y);}
let ma=0,mr=0,mrAt=null;
for(const [x,t,neg,u] of ref){const v=normCdfAS(x),r=neg?t:u;ma=Math.max(ma,Math.abs(v-r));if(neg&&Math.abs(x)<=8){const q=Math.abs(v-t)/t;if(q>mr){mr=q;mrAt=x;}}}
console.log('A&S current: maxAbs',ma.toExponential(2),'maxRel lower tail (|x|<=8)',mr.toExponential(2),'at',mrAt.toFixed(3));
