// Dump everything the app plots, per symbol x timeframe x config, for independent Python verification.
// Daily history = REAL Tradier bars; intraday bars = synthetic (see mock.js).
const {boot,done,etMs}=require('./h.js');
const fs=require('fs');
const SYMS=(process.argv[2]||'SPY,QQQ,AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA').split(',');
const OUT=process.argv[3]||'dump';fs.mkdirSync(OUT,{recursive:true});
const CONFIGS={
  // shipped defaults: presets on, every overlay switched on
  def:{},
  // presets off + the variants the defaults never exercise
  var:{tfPresets:false,macd:{oscType:'sma',sigType:'sma'},satyRibbon:{timeWarp:'M',showCandleBias:true,showArrows:true,showFastConv:true,showSlowConv:true}},
  // Time Warp placement (lookahead_off) across calendar and intraday warps, both session views
  wD:{tfPresets:false,satyRibbon:{timeWarp:'D',showArrows:true,showFastConv:true,showSlowConv:true}},
  wW:{tfPresets:false,sess:'rth',satyRibbon:{timeWarp:'W',showArrows:true,showFastConv:true,showSlowConv:true}},
  w1hR:{tfPresets:false,sess:'rth',satyRibbon:{timeWarp:'1h',showArrows:true,showFastConv:true,showSlowConv:true}},
  w4hR:{tfPresets:false,sess:'rth',satyRibbon:{timeWarp:'4h',showArrows:true,showFastConv:true,showSlowConv:true}},
  w20E:{tfPresets:false,satyRibbon:{timeWarp:'20m',showArrows:true,showFastConv:true,showSlowConv:true}},
};
const RSI_VAR={'5':'vwma','10':'rma','60':'wma','240':'ema','D':'bb','W':'sma'};
(async()=>{
  const hosts=new Set();
  for(const sym of SYMS)for(const cn of (process.env.CONFIGS?process.env.CONFIGS.split(','):Object.keys(CONFIGS))){
    const t0=etMs('2026-09-28',21,0,0);
    const A=await boot({build:process.env.BUILD||'new',sym,t0,cfg:Object.assign({tf0:'D',tf1:'D',paneN:1,ribbon0:true,vwap0:true,struct0:true,saty0:true},CONFIGS[cn])});
    await A.stopPolling();
    const shown=[];await A.page.exposeFunction('__err',m=>shown.push(m));
    await A.page.evaluate(()=>{const o=showErr;showErr=m=>{__err(String(m));return o(m);};});
    const res=await A.page.evaluate(([cn,RSI_VAR])=>{
      const out={sym:cfg.sym,cn,raw:{bars5:bars5.map(b=>[b.t,b.o,b.h,b.l,b.c,b.v,b.etYmd,b.etMin]),bars15:bars15.map(b=>[b.t,b.o,b.h,b.l,b.c,b.v,b.etYmd,b.etMin]),
        daily:dailyRows.map(r=>[r.date,r.open,r.high,r.low,r.close,r.volume])},tf:{},nowYmd:nowET().ymd};
      // cfg snapshot of every input the indicators read
      out.cfg=JSON.parse(JSON.stringify({sess:cfg.sess,tfPresets:cfg.tfPresets,rsi:cfg.rsi,ind:cfg.ind,macd:cfg.macd,adx:cfg.adx,satyRibbon:cfg.satyRibbon,vwap:cfg.vwap,
        satyCfg:satyC(),structCfg:cfg.structCfg,candle:cfg.candle}));
      const p=panes[0];
      for(const tf of ['5','10','60','240','D','W']){
        if(cn==='var')cfg.rsi.smType=RSI_VAR[tf];
        p.tf=tf;p._rbRenderCache=null;p._rsiRenderCache=null;p._macdRenderCache=null;p._adxRenderCache=null;
        renderPane(p);
        const data=seriesForTF(tf,paneData(p));
        const ix=new Map(data.map((d,i)=>[typeof d.time==='string'?d.time:String(d.time),i]));
        const col=(series,fields)=>{const arrs={};fields.forEach(f=>arrs[f]=new Array(data.length).fill(null));
          if(!series)return arrs;for(const x of series.data()){const i=ix.get(typeof x.time==='string'?x.time:String(x.time));if(i==null){arrs.__orphan=(arrs.__orphan||0)+1;continue;}
            fields.forEach(f=>{if(x[f]!==undefined)arrs[f][i]=x[f];});}return arrs;};
        const T={params:paneParams(p),adxLen:adxParams(p).len,
          data:data.map(d=>[d.time,d.open,d.high,d.low,d.close,d.volume,d.ymd,d.etMin,d.rth,d.t==null?null:d.t]),
          candles:col(p.candles,['open','high','low','close','color']),vol:col(p.vol,['value','color']),
          rsi:col(p.rsi,['value']).value,rsiMa:col(p.rsiMa,['value']).value,bbU:col(p.rsiBBu,['value']).value,bbL:col(p.rsiBBl,['value']).value,
          ob:col(p.rsiOB,['value']).value,os:col(p.rsiOS,['value']).value,
          macd:col(p.macdLine,['value']).value,sig:col(p.sigLine,['value']).value,hist:col(p.macdHist,['value','color']),
          adx:col(p.adxLine,['value']).value,plus:col(p.adxPlus,['value']).value,minus:col(p.adxMinus,['value']).value,
          rbFast:col(p.rbFast,['value','color']),rbPivot:col(p.rbPivot,['value','color']),rbSlow:col(p.rbSlow,['value','color']),
          rbFc:col(p.rbFastConv,['value']).value,rbSc:col(p.rbSlowConv,['value']).value,
          cloudF:col(p.rbCloudFast,['a','b','color']),cloudS:col(p.rbCloudSlow,['a','b','color']),
          vw:p.vwLines.map(s=>col(s,['value']).value),
          arrows:(p.rbArrows||[]).map(a=>[a.time,a.up,a.price]),
          lastBarsColor:(p._lastBars||[]).map(b=>b.color),
          divs:(p.divs||[]).map(d=>({side:d.side,kind:d.kind,pivot:d.pivot,from:d.from,val:d.val,fromVal:d.fromVal})),
          sw:(p.sw||[]).map(x=>({i:x.i,type:x.type,price:x.price,label:x.label})),
          brks:(p.brks||[]).map(b=>({kind:b.kind,dir:b.dir,price:b.price,i:b.i,ref:b.ref,state:b.state,at:b.at})),
          pattern:p.pattern?JSON.parse(JSON.stringify(p.pattern)):null,
          saty:p.satyState?JSON.parse(JSON.stringify(p.satyState)):null,satyWhy:p.satyWhy||null,
          satyLabels:(p.satyLabels||[]).map(l=>[l.key,l.price]),
          valsLen:{rsi:p.vals.rsi&&p.vals.rsi.length,macd:p.vals.macd&&p.vals.macd.length,adx:p.vals.adx&&p.vals.adx.length},
          orphans:0};
        out.tf[tf]=T;
      }
      computeLevels();
      out.levels=levels.map(l=>[l.key,l.label,l.price,l.cat]);out.prevClosePx=prevClosePx;out.lastPx=lastPx;out.nowHM=nowET().h*60+nowET().m;
      out.satyLen=satyLen(typeof satyFitRows==='function'?satyFitRows('day',satyPeriods('day',dailyRows)):satyPeriods('day',dailyRows),cfg.sym);
      return out;
    },[cn,RSI_VAR]);
    res.errors=shown.concat(A.errors);A.hosts.forEach(h=>hosts.add(h));
    fs.writeFileSync(`${OUT}/${sym}_${cn}.json`,JSON.stringify(res));
    console.log(sym,cn,Object.keys(res.tf).map(k=>k+':'+res.tf[k].data.length).join(' '),'errors',res.errors.length);
    await A.close();
  }
  fs.writeFileSync(`${OUT}/_hosts.json`,JSON.stringify([...hosts]));
  console.log('hosts contacted',[...hosts]);
  await done();
})().catch(e=>{console.error(e);process.exit(1);});
