const fs=require('fs');
const src=fs.readFileSync('/home/user/SWAGINO/swagino.html','utf8');
const m=/function normCdf\(x\)\{[\s\S]*?\n\}/.exec(src);
eval(m[0]);
const ref=JSON.parse(fs.readFileSync('ncdf_ref_mp.json'));
let mr=0,ma=0,at=null;
for(const [x,t,neg,u] of ref){
  const v=normCdf(x),r=neg?t:u;ma=Math.max(ma,Math.abs(v-r));
  if(Math.abs(x)<=37){const q=Math.abs(v-r)/r;if(q>mr){mr=q;at=x;}}
}
console.log('maxRel',mr.toExponential(2),'at',at,'maxAbs',ma.toExponential(2));
console.log('edge', normCdf(0), normCdf(NaN), normCdf(Infinity), normCdf(-Infinity), normCdf(1.5), normCdf(-1.5), normCdf(1.4999999999999998));
// symmetry / monotonicity across the switch point
let mono=true,prev=-1;for(let x=-10;x<=10;x+=1e-4){const v=normCdf(x);if(v<prev){mono=false;console.log('non-monotone at',x);break;}prev=v;}
console.log('monotone',mono);
