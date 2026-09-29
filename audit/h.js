// Harness: serves site/{new,old}, mocks Tradier, fixes the page clock, boots SWAGINO.
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const {makeMock,etEpoch}=require('./mock.js');
const SITE=path.join(__dirname,'site');
let server=null,PORT=0;
function serve(){
  if(server)return Promise.resolve(PORT);
  const types={'.html':'text/html','.js':'application/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon','.css':'text/css'};
  server=http.createServer((req,res)=>{
    const p=path.join(SITE,decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p,(e,b)=>{if(e){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});res.end(b);});
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>{PORT=server.address().port;r(PORT);}));
}
let browser=null;
async function getBrowser(){if(!browser)browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});return browser;}
// ymd + ET wall clock -> epoch ms
const etMs=(ymd,h,m,s)=>etEpoch(ymd,h,m)+(s||0)*1000;
async function boot(opts){
  const {build='new',sym='QQQ',cfg={},t0,w=1500,h=1100}=opts;
  await serve();const b=await getBrowser();
  const ctx=await b.newContext({viewport:{width:w,height:h},locale:'en-US',timezoneId:'America/Chicago'});
  const page=await ctx.newPage();
  const state={now:t0};
  const mock=makeMock(()=>state.now);
  const errors=[];const hosts=new Set();
  page.on('request',r=>{try{hosts.add(new URL(r.url()).host);}catch(e){}});
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load resource/.test(m.text()))errors.push('console: '+m.text());});
  if(opts.shiftDate){
    // real timers/rAF/performance.now; only Date is offset so ET wall clock starts at t0 and keeps running
    await page.addInitScript(t0=>{const RD=Date,OFF=t0-RD.now();
      class D extends RD{constructor(...a){if(a.length===0)super(RD.now()+OFF);else super(...a);}static now(){return RD.now()+OFF;}}
      D.UTC=RD.UTC;D.parse=RD.parse;window.Date=D;},t0);
    const startReal=Date.now();Object.defineProperty(state,'now',{get:()=>t0+(Date.now()-startReal),set:()=>{}});
  }else await page.clock.install({time:t0});
  await page.route(/\/v1\/markets\//,async route=>{
    const r=mock.handle(route.request().url(),route.request().method());
    if(opts.delayMs)await new Promise(res=>setTimeout(res,opts.delayMs*(0.5+Math.random())));
    if(opts.stall&&opts.stall.re.test(route.request().url()))await new Promise(res=>setTimeout(res,opts.stall.ms));
    await route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.body)});
  });
  const c=Object.assign({sym,stream:false,proxy:true,paneN:2,link:true,tf0:'5',tf1:'5',rsiTV:1,gexRfrAuto:false},cfg);
  await page.addInitScript(([c])=>{localStorage.setItem('lc_key','test');localStorage.setItem('lc_cfg',JSON.stringify(c));},[c]);
  await page.goto(`http://127.0.0.1:${PORT}/${build}/swagino.html`);
  await page.waitForFunction(()=>typeof bars5!=='undefined'&&bars5.length>0&&typeof panes!=='undefined'&&panes[0]&&panes[0].times&&panes[0].times.length>0,null,{timeout:60000});
  if(opts.raw){return{page,ctx,state,mock,errors,hosts,async close(){await ctx.close();}};}
  // the app always boots the ticker in #symInput (QQQ); switch like a user would
  if(sym!=='QQQ'){
    await page.waitForTimeout(1500);
    await page.evaluate(async s=>{$('#symInput').value=s;await connect();},sym);
    await page.waitForFunction(s=>cfg.sym===s&&bars5.length>0&&panes[0].times.length>0,sym,{timeout:60000});
  }
  // let background loads (15m, deepen) settle
  await page.waitForTimeout(2500);
  const api={page,ctx,state,mock,errors,hosts,
    async setNow(ms){state.now=ms;await page.clock.setSystemTime(ms);},
    async stopPolling(){await page.evaluate(()=>{clearInterval(quoteTimer);clearInterval(barTimer);});},
    async close(){await ctx.close();}};
  return api;
}
async function done(){if(browser)await browser.close();if(server)server.close();}
module.exports={boot,done,etMs};
