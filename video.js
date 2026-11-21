
"use strict";
const $=id=>document.getElementById(id);
const v=$("video");
let detector=null,loading=null,fileURL=null,job=null,records=[],last=null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1)):null;
const q=(a,p)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),z=(b.length-1)*p,i=Math.floor(z);return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(z-i)};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const fmt=(x,k=2)=>Number.isFinite(x)?x.toFixed(k):"—";
const safe=s=>String(s||"test").replace(/[^\w-]/g,"_").slice(0,45);
function status(s){$("status").textContent=s}
function progress(n,total){const p=total?Math.min(100,Math.round(n/total*100)):0;$("progress").value=p;$("progressText").textContent=p+"% · 已处理 "+n+"/"+total+" 个采样点";}
async function load(){
 if(detector)return detector;
 if(loading)return loading;
 loading=(async()=>{
  const base=new URL("./",import.meta.url);
  let step="加载识别库";
  try{
   status("正在从本站加载MediaPipe识别库……");
   const mp=await import(new URL("vendor/vision_bundle.mjs",base).href);
   step="下载本地模型";
   const resp=await fetch(new URL("model/hand_landmarker.task",base));
   if(!resp.ok)throw Error("模型HTTP "+resp.status);
   const bytes=new Uint8Array(await resp.arrayBuffer());
   if(bytes.byteLength<100000)throw Error("模型文件异常");
   step="初始化WASM";
   status("模型文件已获取，正在初始化WASM……");
   const vision=await mp.FilesetResolver.forVisionTasks(new URL("vendor/wasm",base).href.replace(/\/$/,""));
   step="创建手部识别器";
   detector=await mp.HandLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetBuffer:bytes,delegate:"CPU"},
    runningMode:"VIDEO",numHands:1,
    minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5
   });
   status("模型加载成功；可开始30 fps逐帧分析。");
   return detector;
  }catch(e){throw Error(step+"失败："+(e.message||String(e)))}
 })();
 try{return await loading}catch(e){loading=null;status(e.message);throw e}
}
$("load").onclick=()=>load().catch(()=>{});
$("file").onchange=()=>{
 if(job){status("分析中不能更换视频，请先中止。");return}
 if(fileURL)URL.revokeObjectURL(fileURL);
 const file=$("file").files?.[0];if(!file)return;
 fileURL=URL.createObjectURL(file);v.src=fileURL;v.load();
 status("已选择："+file.name+"。建议先人工数出实际对合次数，用于验证。");
};

async function metadata(video){
 if(video.readyState>=1&&Number.isFinite(video.duration)&&video.duration>0&&video.videoWidth>0&&video.videoHeight>0)return;
 await new Promise((resolve,reject)=>{
  let finished=false;
  const timer=setTimeout(()=>done(Error("12秒内未能获得视频分辨率，请确认MP4采用H.264编码")),12000);
  function done(err){
   if(finished)return;finished=true;clearTimeout(timer);
   video.removeEventListener("loadedmetadata",ok);video.removeEventListener("error",bad);
   if(err)reject(err);else resolve();
  }
  function ok(){done()}
  function bad(){done(Error("浏览器无法读取该视频的元数据"))}
  video.addEventListener("loadedmetadata",ok);video.addEventListener("error",bad);
 });
 if(!Number.isFinite(video.duration)||video.duration<=0||video.videoWidth<2||video.videoHeight<2){
  throw Error("视频没有有效的时长或图像尺寸，请重新导出为H.264 MP4");
 }
}
async function primeVideo(video){
 if(video.videoWidth<2||video.videoHeight<2)throw Error("视频尺寸无效（"+video.videoWidth+"×"+video.videoHeight+"）");
 if(video.readyState>=2)return;
 try{await video.play()}catch(e){
  throw Error("首帧解码失败；无法播放视频："+(e.message||e));
 }
 const begin=performance.now();
 while(video.readyState<2&&performance.now()-begin<8000){
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 video.pause();
 if(video.readyState<2)throw Error("8秒内无法解码首帧，请将手机视频转成兼容的H.264 MP4后重试");
}
async function seek(video,time,run){
 if(run.cancelled)throw Error("用户中止分析");
 const target=Math.max(0,Math.min(time,video.duration-.005));
 if(!(target>=0))throw Error("无效的视频时间戳");
 if(Math.abs(video.currentTime-target)>=.001||video.readyState<2){
  await new Promise((resolve,reject)=>{
   let finished=false;
   const timer=setTimeout(()=>done(Error("定位第"+target.toFixed(3)+"秒画面超时，建议检查视频编码")),12000);
   function done(err){
    if(finished)return;finished=true;clearTimeout(timer);
    video.removeEventListener("seeked",ok);video.removeEventListener("error",bad);
    if(err)reject(err);else resolve();
   }
   function ok(){done()}
   function bad(){done(Error("视频定位时发生解码错误"))}
   video.addEventListener("seeked",ok);video.addEventListener("error",bad);
   try{video.currentTime=target}catch(e){done(e)}
  });
 }
 const start=performance.now();
 while(video.readyState<2&&performance.now()-start<4000){
  if(run.cancelled)throw Error("用户中止分析");
  await new Promise(resolve=>setTimeout(resolve,35));
 }
 if(video.readyState<2)throw Error("第"+target.toFixed(3)+"秒画面没有解码完成");
 await new Promise(resolve=>requestAnimationFrame(resolve));
 if(video.videoWidth<2||video.videoHeight<2)throw Error("定位后画面宽高为0");
}

function smoothSeries(rows){
 return rows.map((p,i)=>{
  const vals=[];
  for(let j=Math.max(0,i-1);j<=Math.min(rows.length-1,i+1);j++){
   if(Math.abs(rows[j].t-p.t)<=.095)vals.push(rows[j].d);
  }
  return {...p,value:q(vals,.5)};
 });
}
function detectCycles(rows,mode){
 const cfg=mode==="sensitive"?{open:.57,close:.43,prominence:.15,min:.08}:mode==="conservative"?{open:.65,close:.35,prominence:.26,min:.13}:{open:.61,close:.39,prominence:.20,min:.10};
 const series=smoothSeries(rows),events=[];
 if(series.length<20)return{count:0,events,series};
 let armed=false,peak=0,last=-100,prev=null,validPoints=0;
 for(const p of series){
  if(prev!==null&&p.t-prev>.17)armed=false;
  prev=p.t;
  const local=[];
  for(let i=0;i<series.length;i++)if(Math.abs(series[i].t-p.t)<=.85)local.push(series[i].value);
  const lo=q(local,.10),hi=q(local,.90),span=hi-lo;
  if(span<.07){armed=false;continue}
  validPoints++;
  const open=lo+cfg.open*span,close=lo+cfg.close*span;
  if(!armed){
   if(p.value>=open){armed=true;peak=p.value}
  }else{
   peak=Math.max(peak,p.value);
   if(p.value<=close){
    if(peak-p.value>=Math.max(.05,cfg.prominence*span)&&p.t-last>=cfg.min){
     events.push({time_s:p.t,amplitude_normalized:peak-p.value});last=p.t;
    }
    armed=false;
   }
  }
 }
 return{count:events.length,events,series,validPoints};
}
function finger(rows){
 if(rows.length<25)return{valid:false,reason:"关键点有效采样点不足25个"};
 const standard=detectCycles(rows,"standard"),sensitive=detectCycles(rows,"sensitive"),conservative=detectCycles(rows,"conservative");
 const ev=standard.events,periods=ev.slice(1).map((x,i)=>x.time_s-ev[i].time_s),m=mean(periods),std=sd(periods);
 const t0=rows[0].t,t1=rows[rows.length-1].t,half=(t0+t1)/2;
 const first=ev.filter(x=>x.time_s<half).map(x=>x.amplitude_normalized),last=ev.filter(x=>x.time_s>=half).map(x=>x.amplitude_normalized);
 const slopeDen=ev.reduce((sum,e,i)=>sum+(i-(ev.length-1)/2)**2,0);
 const ampMean=mean(ev.map(x=>x.amplitude_normalized));
 const slope=ev.length>=3&&slopeDen>0?ev.reduce((s,e,i)=>s+(i-(ev.length-1)/2)*(e.amplitude_normalized-ampMean),0)/slopeDen:null;
 const valid=standard.count>=2;
 return{
  valid,reason:valid?"已输出自动候选计数，需与人工次数对照":"有效完整开合周期太少，不输出可靠计数",
  count:valid?standard.count:null,candidate_count_standard:standard.count,candidate_count_sensitive:sensitive.count,candidate_count_conservative:conservative.count,
  rate_hz:valid?standard.count/Math.max(.01,t1-t0):null,mean_interval_ms:m!==null?m*1000:null,
  interval_cv_pct:m>0&&std!==null?100*std/m:null,
  amplitude_slope_per_cycle:slope,
  first_half_mean_amplitude:mean(first),second_half_mean_amplitude:mean(last),
  amplitude_decrement_pct:first.length&&last.length&&mean(first)>0?100*(mean(first)-mean(last))/mean(first):null,
  threshold_disagreement:Math.max(standard.count,sensitive.count,conservative.count)-Math.min(standard.count,sensitive.count,conservative.count),
  events:ev
 };
}
function tremor(rows){
 if(rows.length<120)return{valid:false,reason:"震颤频率分析至少需要约4秒的有效30 fps数据"};
 const t0=rows[0].t,t1=rows[rows.length-1].t;
 const gaps=rows.slice(1).map((r,i)=>r.t-rows[i].t);
 if(gaps.some(x=>x>.18))return{valid:false,reason:"关键点存在明显时间中断，无法直接进行连续频谱分析"};
 const sampleFps=30,span=t1-t0,N=Math.floor(span*sampleFps);
 if(N<120)return{valid:false,reason:"可用时间不足4秒"};
 let k=0;const x=[],y=[];
 for(let i=0;i<N;i++){
  const t=t0+i/sampleFps;
  while(k<rows.length-2&&rows[k+1].t<t)k++;
  const a=rows[k],b=rows[k+1],dt=b.t-a.t;
  if(dt<=0||dt>.18)return{valid:false,reason:"连续帧存在不合理间隔"};
  const weight=Math.max(0,Math.min(1,(t-a.t)/dt));
  x.push(a.x+(b.x-a.x)*weight);
  y.push(a.y+(b.y-a.y)*weight);
 }
 const detrend=arr=>arr.map((v,i)=>{
  let sum=0,n=0;for(let j=Math.max(0,i-8);j<=Math.min(arr.length-1,i+8);j++){sum+=arr[j];n++}
  return v-sum/n;
 });
 const xx=detrend(x),yy=detrend(y),win=120,hop=60,psd=new Map();let windows=0;
 for(let start=0;start+win<=N;start+=hop){
  windows++;
  for(let bin=12;bin<=44;bin++){
   let ar=0,ai=0,br=0,bi=0;
   for(let i=0;i<win;i++){
    const w=.5-.5*Math.cos(2*Math.PI*i/(win-1)),phase=2*Math.PI*bin*i/win,c=Math.cos(phase),s=Math.sin(phase);
    ar+=xx[start+i]*w*c;ai+=xx[start+i]*w*s;br+=yy[start+i]*w*c;bi+=yy[start+i]*w*s;
   }
   psd.set(bin,(psd.get(bin)||0)+ar*ar+ai*ai+br*br+bi*bi);
  }
 }
 const spectrum=[...psd].map(([bin,p])=>({f:bin/4,p:p/windows})).sort((a,b)=>b.p-a.p);
 const peak=spectrum[0],ratio=peak.p/Math.max(1e-12,q(spectrum.map(s=>s.p),.5));
 const rms=Math.sqrt(mean(xx.map((v,i)=>v*v+yy[i]*yy[i])));
 const valid=ratio>=4&&rms>=.005;
 return{valid,reason:valid?"发现候选震颤谱峰，频率仍需参照设备确认":"未发现可靠的周期性谱峰，或幅度低于程序的探索性阈值",frequency_hz:valid?peak.f:null,peak_to_median_power:ratio,relative_motion_rms:rms,band_hz:[3,11],count:null};
}
function draw(rows,events,type){
 const c=$("plot"),ctx=c.getContext("2d"),W=c.width,H=c.height;
 ctx.clearRect(0,0,W,H);
 ctx.strokeStyle="#a9b8c5";ctx.strokeRect(38,14,W-54,H-44);
 if(rows.length<2)return;
 const values=rows.map(r=>type==="finger"?r.d:r.x),lo=Math.min(...values),hi=Math.max(...values),t0=rows[0].t,t1=rows[rows.length-1].t;
 const px=t=>38+(t-t0)/Math.max(.01,t1-t0)*(W-54);
 const py=value=>14+(hi-value)/Math.max(.0001,hi-lo)*(H-44);
 ctx.strokeStyle="#12918b";ctx.lineWidth=2;ctx.beginPath();
 rows.forEach((r,i)=>{if(!i)ctx.moveTo(px(r.t),py(values[i]));else ctx.lineTo(px(r.t),py(values[i]))});ctx.stroke();
 if(type==="finger"){
  ctx.fillStyle="#d38b30";
  for(const e of events||[]){
   const closest=rows.reduce((a,b)=>Math.abs(b.t-e.time_s)<Math.abs(a.t-e.time_s)?b:a,rows[0]);
   ctx.beginPath();ctx.arc(px(closest.t),py(closest.d),4,0,Math.PI*2);ctx.fill();
  }
 }
 ctx.fillStyle="#6b8091";ctx.font="12px sans-serif";
 ctx.fillText("0 s",40,H-11);ctx.fillText((t1-t0).toFixed(1)+" s",W-80,H-11);
}
function filename(){return safe($("subject").value)+"_"+safe($("visit").value||"S1")+"_v05"}
function csvCell(value){
 if(value===null||value===undefined)return"";
 let s=typeof value==="object"?JSON.stringify(value):String(value);
 if(/^[=+@-]/.test(s))s="'"+s;
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function makeCSV(rows,columns){return"\uFEFF"+[columns.join(","),...rows.map(row=>columns.map(col=>csvCell(row[col])).join(","))].join("\r\n")}
function download(content,name,mime){
 const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement("a");
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function finishUI(){
 $("start").disabled=false;$("cancel").disabled=true;v.controls=true;
}
$("cancel").onclick=()=>{if(job){job.cancelled=true;status("已请求中止，当前视频结果不会保存。")}};
document.addEventListener("visibilitychange",()=>{if(document.hidden&&job){job.cancelled=true;status("页面切至后台，已中止本次分析以避免不完整数据。")}});
$("start").onclick=async()=>{
 if(job)return;
 const file=$("file").files?.[0];
 if(!file){status("请先选择视频。");return}
 $("start").disabled=true;
 try{await load();await metadata(v)}catch(e){status("启动失败："+(e.message||e));$("start").disabled=false;return}
 const fps=Number($("samplefps").value),duration=Math.min(Number($("maxsecs").value),v.duration);
 if(!(duration>0)){status("无法识别有效的视频时长");$("start").disabled=false;return}
 const total=Math.max(1,Math.floor(duration*fps));
 const run={cancelled:false,rows:[],attempts:0,detected:0,total,fps,lastStamp:-1,errors:[],startISO:new Date().toISOString()};
 job=run;$("cancel").disabled=false;v.pause();v.controls=false;
 progress(0,total);$("count").textContent="—";$("frames").textContent="—";$("coverage").textContent="—";$("fpsStat").textContent="—";
 status("正在逐帧定位视频，共计划处理 "+total+" 个取样点。此过程可能比视频播放慢得多。");
 try{
  await primeVideo(v);
  const frameCanvas=document.createElement("canvas");
  const maxSide=960;
  const scale=Math.min(1,maxSide/Math.max(v.videoWidth,v.videoHeight));
  frameCanvas.width=Math.max(2,Math.round(v.videoWidth*scale));
  frameCanvas.height=Math.max(2,Math.round(v.videoHeight*scale));
  const frameCtx=frameCanvas.getContext("2d",{willReadFrequently:true});
  if(!frameCtx)throw Error("无法创建视频分析Canvas");
  await detector.setOptions({runningMode:"IMAGE"});
  status("已确认视频尺寸："+v.videoWidth+"×"+v.videoHeight+"；开始逐帧分析");
  for(let i=0;i<total;i++){
   if(run.cancelled)throw Error("已由用户中止");
   const t=Math.min(duration-.005,(i+.5)/fps);
   await seek(v,t,run);
   if(run.cancelled)throw Error("已由用户中止");
   const stamp=Math.max(run.lastStamp+1,Math.round(t*1000));
   if(v.videoWidth<2||v.videoHeight<2||v.readyState<2){
    throw Error("第"+(i+1)+"个采样点没有有效的解码画面；宽高："+v.videoWidth+"×"+v.videoHeight+"；readyState："+v.readyState);
   }
   try{
    frameCtx.drawImage(v,0,0,frameCanvas.width,frameCanvas.height);
   }catch(e){
    throw Error("第"+(i+1)+"个采样点无法转换为Canvas图像："+(e.message||e));
   }
   let landmarks;
   try{
    landmarks=detector.detect(frameCanvas).landmarks?.[0];
   }catch(e){
    throw Error("第"+(i+1)+"个采样点的MediaPipe识别失败："+(e.message||e));
   }
   run.lastStamp=stamp;run.attempts++;
   if(landmarks){
    run.detected++;
    const scale=distance(landmarks[0],landmarks[9]);
    if(scale>.00001){
     run.rows.push({requested_time_s:t,actual_video_time_s:v.currentTime,t,d:distance(landmarks[4],landmarks[8])/scale,x:(landmarks[8].x-landmarks[0].x)/scale,y:(landmarks[8].y-landmarks[0].y)/scale});
    }
   }
   if(i%10===0||i===total-1){
    progress(i+1,total);
    status("正在分析：已完成 "+(i+1)+"/"+total+" 个取样点；检测到手部 "+run.detected+" 次。");
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  if(run.cancelled)throw Error("已由用户中止");
  const task=$("task").value,coverage=run.detected/Math.max(1,run.attempts);
  const gaps=run.rows.slice(1).map((p,i)=>p.t-run.rows[i].t);
  const metrics=task==="finger"?finger(run.rows):tremor(run.rows);
  const flags=[];
  if(coverage<.70){flags.push("关键点检出率低于70%");metrics.valid=false;metrics.reason="手部关键点覆盖率不足70%；本次计数无效";metrics.count=null;metrics.rate_hz=null}
  if(gaps.some(x=>x>.18))flags.push("关键点存在连续缺失");
  if(task==="finger"&&metrics.threshold_disagreement>Math.max(3,Math.round((metrics.candidate_count_standard||0)*.2)))flags.push("不同计数阈值差异较大，请人工核对");
  if(fps!==30&&task!=="finger")flags.push("震颤原型按30次/秒的重采样设计，其他输入帧率需额外验证");
  const record={version:"0.5.1",type:"video",record_id:"V"+Date.now(),created_at:new Date().toISOString(),subject_id:$("subject").value.trim(),visit_id:$("visit").value.trim(),side:$("hand").value,task,file_name:file.name,requested_sampling_fps:fps,planned_samples:total,processed_samples:run.attempts,detected_samples:run.detected,detected_fraction:coverage,record_duration_s:duration,source_fps_verified:false,quality_flags:flags,metrics,raw_frames:run.rows,manual_count:null,review:"未复核"};
  records.push(record);last=record;
  $("count").textContent=metrics.valid&&task==="finger"?metrics.count:"—";
  $("fpsStat").textContent=fmt(run.attempts/duration,1);
  $("frames").textContent=String(run.attempts);
  $("coverage").textContent=fmt(coverage*100,1)+"%";
  if(task==="finger"){
   $("alternates").textContent="保守阈值："+(metrics.candidate_count_conservative??"—")+"次；标准阈值："+(metrics.candidate_count_standard??"—")+"次；灵敏阈值："+(metrics.candidate_count_sensitive??"—")+"次。请以人工逐次计数核对，不应挑选接近预期值的阈值替代验证。";
  }else{
   $("alternates").textContent="探索性震颤主频："+fmt(metrics.frequency_hz,2)+" Hz；谱峰比："+fmt(metrics.peak_to_median_power,1)+"；无可靠主频时不输出疾病判断。";
  }
  $("note").textContent=metrics.reason+"。已处理"+run.attempts+"个视频时间点；"+(flags.length?"质控提示："+flags.join("；"):"自动质控未检测到预设异常")+"。";
  draw(run.rows,metrics.events,task);
  status("完成逐帧分析："+run.attempts+" 个采样点；手部检出率 "+fmt(coverage*100,1)+"%。请核对人工计数并下载数据。");
 }catch(e){
  status("本次分析未保存："+(e.message||e)+"。已处理 "+run.attempts+"/"+total+" 个取样点。");
 }finally{job=null;finishUI()}
};
$("saveReview").onclick=()=>{
 if(!last){status("尚无可复核的分析记录。");return}
 last.manual_count=$("manual").value===""?null:Number($("manual").value);last.review=$("review").value;
 status("人工复核已保存到当前记录，记得下载JSON或CSV。");
};
function summaries(){return records.map(r=>({subject_id:r.subject_id,visit_id:r.visit_id,record_id:r.record_id,task:r.task,side:r.side,file_name:r.file_name,requested_sampling_fps:r.requested_sampling_fps,planned_samples:r.planned_samples,processed_samples:r.processed_samples,detected_fraction:r.detected_fraction,valid:r.metrics.valid,count:r.metrics.count??null,candidate_standard:r.metrics.candidate_count_standard??null,candidate_sensitive:r.metrics.candidate_count_sensitive??null,candidate_conservative:r.metrics.candidate_count_conservative??null,rate_hz:r.metrics.rate_hz??null,tremor_frequency_hz:r.metrics.frequency_hz??null,manual_count:r.manual_count,review:r.review,quality_flags:r.quality_flags,created_at:r.created_at}))}
$("exportCSV").onclick=()=>{
 const cols=["subject_id","visit_id","record_id","task","side","file_name","requested_sampling_fps","planned_samples","processed_samples","detected_fraction","valid","count","candidate_standard","candidate_sensitive","candidate_conservative","rate_hz","tremor_frequency_hz","manual_count","review","quality_flags","created_at"];
 download(makeCSV(summaries(),cols),filename()+"_summary.csv","text/csv;charset=utf-8");
};
$("exportRaw").onclick=()=>{
 const rows=records.flatMap(r=>r.raw_frames.map(p=>({record_id:r.record_id,task:r.task,side:r.side,...p})));
 download(makeCSV(rows,["record_id","task","side","requested_time_s","actual_video_time_s","t","d","x","y"]),filename()+"_frames.csv","text/csv;charset=utf-8");
};
$("exportJSON").onclick=()=>download(JSON.stringify({version:"0.5.1",exported_at:new Date().toISOString(),records},null,2),filename()+"_full.json","application/json;charset=utf-8");
window.addEventListener("beforeunload",e=>{if(records.length){e.preventDefault();e.returnValue=""}});
