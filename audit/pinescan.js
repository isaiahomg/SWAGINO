const espree=require('/opt/node22/lib/node_modules/eslint/node_modules/espree');
const fs=require('fs');const s=fs.readFileSync('/home/user/SWAGINO/swagino.html','utf8');
const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m;const res={comment:0,string:0,template:0,identifier:0,other:0};const strHits=[],idHits=[];
let scriptSpans=[];
while((m=re.exec(s))){
  const code=m[1],off=m.index+m[0].indexOf(code);scriptSpans.push([off,off+code.length]);
  const toks=espree.tokenize(code,{ecmaVersion:2022,comment:true,range:true});
  for(const t of toks.concat(toks.comments||[])){
    if(!/pine/i.test(t.value))continue;
    const kind=(t.type==='Line'||t.type==='Block')?'comment':t.type==='String'?'string':t.type==='Template'?'template':t.type==='Identifier'?'identifier':'other';
    const n=(t.value.match(/pine/gi)||[]).length;res[kind]+=n;
    if(kind!=='comment'){const line=s.slice(0,off+t.range[0]).split('\n').length;(kind==='identifier'?idHits:strHits).push(line+': '+t.value.slice(0,160));}
  }
}
// HTML text outside scripts
let html=s;for(const [a,b] of scriptSpans.reverse())html=html.slice(0,a)+' '.repeat(b-a)+html.slice(b);
const htmlComments=[...html.matchAll(/<!--[\s\S]*?-->/g)];let hc=0;htmlComments.forEach(x=>hc+=(x[0].match(/pine/gi)||[]).length);
const noComments=html.replace(/<!--[\s\S]*?-->/g,m=>' '.repeat(m.length));
const htmlHits=[];noComments.split('\n').forEach((l,i)=>{if(/pine/i.test(l))htmlHits.push((i+1)+': '+l.trim().slice(0,200));});
console.log('JS tokens containing "pine":',JSON.stringify(res),'| HTML comments:',hc,'| visible HTML/CSS text lines:',htmlHits.length);
console.log('string/template hits:',strHits);console.log('identifier hits:',idHits);console.log('html hits:',htmlHits);
