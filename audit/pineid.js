// Every identifier / property name in the app scripts that is (or mirrors) a Pine API name.
const espree=require('/opt/node22/lib/node_modules/eslint/node_modules/espree');
const fs=require('fs');const s=fs.readFileSync('/home/user/SWAGINO/swagino.html','utf8');
const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m;const hits={};
const PINE=/^(ta[A-Z]\w*|ta|na|nz|barstate\w*|security|request\w*|lookahead\w*|plot\w*|hline|fill|study|indicator|strategy|input\w*|pine\w*|Pine\w*|color_new|colorNew|tv[A-Z]\w*|rsiTV|TV\w*)$/;
while((m=re.exec(s))){const code=m[1],off=m.index+m[0].indexOf(code);
  for(const t of espree.tokenize(code,{ecmaVersion:2022,range:true})){
    if(t.type!=='Identifier')continue;if(!PINE.test(t.value))continue;
    const line=s.slice(0,off+t.range[0]).split('\n').length;(hits[t.value]=hits[t.value]||[]).push(line);}}
for(const [k,v] of Object.entries(hits))console.log(k.padEnd(18),v.length,'lines',v.slice(0,12).join(','));
