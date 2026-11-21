
const $=id=>document.getElementById(id);
const video=$("video");
let detector=null,loading=null,objectUrl=null,last=null,running=false;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const quantile=(a,p)=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);const z=(b.length-1)*p,i=Math.floor(z);return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(z-i)};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const fmt=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):"—";
const show=s=>$("status").textContent=s;
async function load(){
 if(detector)return detector;
 if(loading)return loading;
 loading=(async()=>{
  const base=new URL("./",import.meta.url);
  let step="下载识别库";
  try{
   show("正在从本站加载JavaScript识别库……");
   const mod=await import(new URL("vendor/vision_bundle.mjs",base).href);
   step="下载模型";
   show("正在从本站读取手部模型……");
   const response=await fetch(new URL("model/hand_landmarker.task",base));
   if(!response.ok)throw Error("模型HTTP "+response.status);
   const modelBytes=new Uint8Array(await response.arrayBuffer());
   if(modelBytes.length<100000)throw Error("模型文件尺寸异常");
   step="初始化WASM";
   show("正在初始化WASM及手部识别器……");
   const vision=await mod.FilesetResolver.forVisionTasks(new URL("vendor/wasm",base).href);
   detector=await mod.HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetBuffer:modelBytes,delegate:"CPU"},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
   show("手部模型加载成功。");
   return detector;
  }catch(e){throw Error(step+"失败："+(e.message||e))}
 })();
 try{return await loading}catch(e){loading=null;show(e.message);throw e}
}
$("load").onclick=()=>load().catch(()=>{});
$("file").onchange=()=>{
 if(running){show("正在分析，请勿切换文件。");return}
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 const f=$("file").files?.[0];if(!f)return;
 objectUrl=URL.createObjectURL(f);video.src=objectUrl;video.load();
 show("已选择视频："+f.name);
};
function finger(samples){
 if(samples.length<20)return{valid:false,reason:"有效关键点不足20帧",count:null,events:[]};
 const a=samples.map((s,i)=>{
  const near=samples.filter((p,j)=>Math.abs(i-j)<=2&&Math.abs(p.t-s.t)<.15).map(p=>p.d);
  return{...s,v:quantile(near,.5)};
 });
 const lo=quantile(a.map(x=>x.v),.1),hi=quantile(a.map(x=>x.v),.9),span=hi-lo;
 if(span<.1)return{valid:false,reason:"指尖开合范围不足",count:null,events:[]};
 const open=lo+.67*span,close=lo+.33*span;
 let state=false,peak=lo,last=-100,previous=null;const events=[];
 for(const s of a){
  if(previous!==null&&s.t-previous>.25)state=false;
  previous=s.t;
  if(!state){if(s.v>=open){state=true;peak=s.v}}
  else{
   peak=Math.max(peak,s.v);
   if(s.v<=close){
    if(peak-s.v>=Math.max(.09,.25*span)&&s.t-last>=.14){
     events.push({time_s:s.t,amplitude_normalized:peak-s.v});last=s.t;
    }
    state=false;
   }
  }
 }
 const times=events.slice(1).map((e,i)=>e.time_s-events[i].time_s);
 return{valid:events.length>=2,reason:events.length>=2?"候选对合事件已识别":"完整开合事件不足",count:events.length,rate_hz:events.length/Math.max(.01,a[a.length-1].t-a[0].t),mean_interval_s:mean(times),events};
}
function tremor(samples){
 if(samples.length<60)return{valid:false,reason:"有效帧不足",count:null};
 const span=samples[samples.length-1].t-samples[0].t;
 const gaps=samples.slice(1).map((x,i)=>x.t-samples[i].t);
 if(span<5||gaps.some(x=>x>.25))return{valid:false,reason:"时长不足或手部追踪不连续",count:null};
 const s=samples,x=s.map(p=>p.x),y=s.map(p=>p.y);
 const trend=(arr,i)=>{let n=0,z=0;for(let j=Math.max(0,i-6);j<=Math.min(s.length-1,i+6);j++){z+=arr[j];n++}return z/n};
 const fx=s.map((p,i)=>x[i]-trend(x,i)),fy=s.map((p,i)=>y[i]-trend(y,i));
 const out=[];
 for(let hz=3;hz<=10.5;hz+=.25){
  let xr=0,xi=0,yr=0,yi=0;
  s.forEach((p,i)=>{const w=.5-.5*Math.cos(2*Math.PI*i/(s.length-1)),a=2*Math.PI*hz*(p.t-s[0].t);xr+=fx[i]*w*Math.cos(a);xi+=fx[i]*w*Math.sin(a);yr+=fy[i]*w*Math.cos(a);yi+=fy[i]*w*Math.sin(a)});
  out.push({frequency_hz:hz,power:xr*xr+xi*xi+yr*yr+yi*yi});
 }
 out.sort((a,b)=>b.power-a.power);
 const peak=out[0],ratio=peak.power/Math.max(1e-12,quantile(out.map(z=>z.power),.5));
 return{valid:ratio>=4,reason:ratio>=4?"存在候选振荡谱峰":"谱峰不明确，无法可靠判断",frequency_hz:ratio>=4?peak.frequency_hz:null,candidate_cycles:null,peak_to_median_ratio:ratio};
}
function plot(rows,events){
 const c=$("plot"),ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);
 ctx.strokeStyle="#b0bac4";ctx.strokeRect(40,12,c.width-54,c.height-36);
 if(rows.length<2)return;
 const vals=rows.map(x=>x.d),lo=Math.min(...vals),hi=Math.max(...vals);
 const t0=rows[0].t,t1=rows[rows.length-1].t;
 const px=t=>40+(t-t0)/Math.max(.01,t1-t0)*(c.width-54);
 const py=v=>12+(hi-v)/Math.max(.001,hi-lo)*(c.height-36);
 ctx.strokeStyle="#168d86";ctx.lineWidth=2;ctx.beginPath();
 rows.forEach((r,i)=>{if(i)ctx.lineTo(px(r.t),py(r.d));else ctx.moveTo(px(r.t),py(r.d))});ctx.stroke();
 ctx.fillStyle="#d28b29";
 for(const e of events||[]){ctx.beginPath();ctx.arc(px(e.time_s),c.height-24,4,0,Math.PI*2);ctx.fill()}
}
$("analyze").onclick=async()=>{
 if(running)return;
 if(!$("file").files?.length){show("请先选择视频。");return}
 try{await load()}catch(e){return}
 running=true;$("analyze").disabled=true;
 const f=$("file").files[0],task=$("task").value,rows=[];
 let frames=0,detected=0,lastT=-1,lastStamp=-1,finished=false,callbackId=null;
 const finish=(reason,ok)=>{
  if(finished)return;finished=true;running=false;$("analyze").disabled=false;video.pause();
  video.removeEventListener("ended",onEnded);video.removeEventListener("error",onError);
  if(callbackId!==null&&video.cancelVideoFrameCallback)try{video.cancelVideoFrameCallback(callbackId)}catch(e){}
  if(!ok){show("分析失败："+reason);return}
  const coverage=detected/Math.max(1,frames);
  let m=task==="finger"?finger(rows):tremor(rows);
  if(coverage<.65){m.valid=false;m.count=null;m.frequency_hz=null;m.reason="手部检出率低于65%"}
  last={version:"0.4.1",created_at:new Date().toISOString(),subject_id:$("subject").value,task,side:$("side").value,file_name:f.name,frames,detected_frames:detected,coverage,metrics:m,raw_frames:rows};
  $("count").textContent=m.valid?(m.count??"—"):"无效";
  $("frequency").textContent=m.valid?fmt(m.rate_hz??m.frequency_hz):"—";
  $("coverage").textContent=fmt(coverage*100,1)+"%";
  $("note").textContent=m.reason+"；自动测量仍需人工核对。";
  plot(rows,m.events);
  show("视频分析结束，处理"+frames+"帧；"+m.reason);
 };
 const onEnded=()=>finish("播放结束",true),onError=()=>finish("视频解码错误",false);
 video.addEventListener("ended",onEnded);
 video.addEventListener("error",onError);
 function frame(_time,metadata){
  if(finished)return;
  const t=metadata?.mediaTime??video.currentTime;
  if(t>lastT+.012&&video.readyState>=2){
   lastT=t;frames++;
   try{
    const stamp=Math.max(Math.round(performance.now()),lastStamp+1);
    const out=detector.detectForVideo(video,stamp);lastStamp=stamp;
    const hand=out.landmarks?.[0];
    if(hand){
     detected++;
     const scale=dist(hand[0],hand[9]);
     if(scale>.00001)rows.push({t,d:dist(hand[4],hand[8])/scale,x:(hand[8].x-hand[0].x)/scale,y:(hand[8].y-hand[0].y)/scale});
    }
   }catch(e){finish(e.message||String(e),false);return}
  }
  if(video.ended||t>=Math.min(video.duration||30,30)-.02){finish("结束",true);return}
  if(video.requestVideoFrameCallback)callbackId=video.requestVideoFrameCallback(frame);
  else requestAnimationFrame(time=>frame(time,{mediaTime:video.currentTime}));
 }
 try{
  video.pause();video.currentTime=0;
  await video.play();
  if(video.requestVideoFrameCallback)callbackId=video.requestVideoFrameCallback(frame);
  else requestAnimationFrame(time=>frame(time,{mediaTime:video.currentTime}));
  show("视频分析中，请保持当前页面在前台。");
 }catch(e){finish(e.message||String(e),false)}
};
function download(content,name){
 const url=URL.createObjectURL(new Blob([content],{type:"application/json"}));
 const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$("export").onclick=()=>{
 if(!last){show("尚无分析数据");return}
 download(JSON.stringify({...last,manual_count:$("manual").value===""?null:Number($("manual").value)},null,2),"video-analysis.json");
};
