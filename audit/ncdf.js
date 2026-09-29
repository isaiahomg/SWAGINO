const fs=require('fs');
function mk(Z0){
  const SQRT1_2PI=1/Math.sqrt(2*Math.PI);
  // returns tail Q(|x|) = P(Z>|x|) and N
  return function normCdf(x){
    if(isNaN(x))return NaN;
    const ax=Math.abs(x);
    let q;
    if(ax<Z0){
      // Maclaurin series of the integral: N(x)-1/2 = phi(0) * sum x^(2n+1) (-1/2)^n / (n! (2n+1))
      // use the everywhere-positive form: N(x)-1/2 = phi(x) * sum x^(2n+1)/(1*3*5*...*(2n+1))
      let term=ax,sum=ax;const x2=ax*ax;
      for(let n=1;n<200;n++){term*=x2/(2*n+1);sum+=term;if(term<sum*1e-17)break;}
      const h=Math.exp(-0.5*x2)*SQRT1_2PI*sum;   // = N(ax)-1/2
      return x>=0?0.5+h:0.5-h;
    }
    // continued fraction for the Mills ratio: Q(x)=phi(x)/(x+1/(x+2/(x+3/(x+...)))), modified Lentz
    const tiny=1e-300;let f=ax,C=ax,D=0;
    for(let n=1;n<500;n++){
      D=ax+n*D;if(D===0)D=tiny;D=1/D;
      C=ax+n/C;if(C===0)C=tiny;
      const del=C*D;f*=del;if(Math.abs(del-1)<1e-16)break;
    }
    const xh=Math.round(ax*16)/16;q=Math.exp(-0.5*xh*xh)*Math.exp(-0.5*(ax-xh)*(ax+xh))*SQRT1_2PI/f;
    return x>=0?1-q:q;
  };
}
const ref=JSON.parse(fs.readFileSync('ncdf_ref.json'));
for(const Z0 of [1,1.5,2,2.5,3]){
  const f=mk(Z0);let maxRelTail=0,maxAbs=0,at=null;
  for(const [x,t,neg] of ref){
    const v=f(x); const refN=neg?t:1-t;
    maxAbs=Math.max(maxAbs,Math.abs(v-refN));
    if(neg&&t>0){const r=Math.abs(v-t)/t;if(r>maxRelTail){maxRelTail=r;at=x;}}
  }
  const t0=process.hrtime.bigint();let s=0;for(let i=0;i<2e6;i++)s+=f((i%7000)/1000-3.5);
  const ns=Number(process.hrtime.bigint()-t0)/2e6;
  console.log('Z0',Z0,'maxAbs',maxAbs.toExponential(2),'maxRel(lower tail)',maxRelTail.toExponential(2),'at',at,'ns/call',ns.toFixed(0));
}
console.log('--- |x|<=37 (tails >= ~1e-300, normal floats)');
for(const Z0 of [1,1.5,2,2.5,3]){
  const f=mk(Z0);let mr=0,at=null,mru=0;
  for(const [x,t,neg] of ref){
    if(Math.abs(x)>37)continue;
    const v=f(x);
    if(neg){const r=Math.abs(v-t)/t;if(r>mr){mr=r;at=x;}}
    else{const r=Math.abs(v-(1-t))/(1-t);if(r>mru)mru=r;}
  }
  console.log('Z0',Z0,'maxRel lower tail',mr.toExponential(2),'at',at&&at.toFixed(4),'maxRel upper',mru.toExponential(2));
}
