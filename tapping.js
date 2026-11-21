
"use strict";
const $=id=>document.getElementById(id);
const order=[["右手",1],["左手",1],["右手",2],["左手",2]];
let ppm=null,cal=null,trained=false,trials=[],index=0,active=null,restUntil=0,width=innerWidth;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1)):null;
const fmt=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):"—";
function status(s){$("status").textContent=s}
$("calLine").style.width=$("calSlider").value+"px";
$("calSlider").oninput=()=>{
 $("calLine").style.width=$("calSlider").value+"px";ppm=null;
 $("calInfo").textContent="需要重新确认校准";refresh();
};
function layout(){
 if(!ppm)return false;
 const field=$("stage"),d=90*ppm,size=30*ppm;
 field.style.height=Math.max(220,65*ppm)+"px";
 for(const [i,key] of ["A","B"].entries()){
  const e=field.querySelector('[data-target="'+key+'"]');
  e.style.width=size+"px";e.style.height=size+"px";
  e.style.left="calc(50% "+(i?" + ":" - ")+(d/2)+"px)";
 }
 return field.clientWidth>=(90+30)*ppm+15;
}
function refresh(){
 const valid=!!ppm&&layout();
 const task=order[index],wait=Math.max(0,Math.ceil((restUntil-performance.now())/1000));
 $("start").disabled=!!active||!valid||!trained||!task||wait>0;
 $("practice").disabled=!!active||!valid;
 $("start").textContent=!task?"所有试次完成":wait>0?"休息 "+wait+" 秒":"开始 "+task[0]+"第"+task[1]+"次（20秒）";
 if(!active)status(!valid?"请校准屏幕；如目标超出测试区域，请横屏":!trained?"先进行5秒练习":!task?"四次正式试次已完成":wait>0?"试次间休息中":"下一次："+task[0]+"第"+task[1]+"次");
}
$("calibrate").onclick=()=>{
 ppm=Number($("calSlider").value)/100;
 cal={reference_mm:100,calibration_line_px:Number($("calSlider").value),px_per_mm:ppm,viewport_width:innerWidth,viewport_height:innerHeight,device_pixel_ratio:devicePixelRatio,confirmed_at:new Date().toISOString()};
 const fits=layout();
 $("calInfo").textContent=fits?"已校准："+fmt(ppm,2)+" CSS px/mm":"宽度不足，请横屏后重做校准";
 refresh();
};
window.addEventListener("resize",()=>{
 if(Math.abs(innerWidth-width)>25){
  if(active)active.flags.push("屏幕在正式试次中调整了宽度");
  else{ppm=null;$("calInfo").textContent="屏幕尺寸已变化，需重新校准"}
 }
 width=innerWidth;refresh();
});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)active.flags.push("测试时进入后台")});
let animation=null;
function start(practice){
 if(active||!ppm||!layout()||(!practice&&(!trained||index>=order.length||performance.now()<restUntil)))return;
 const plan=practice?["练习",0]:order[index],duration=practice?5000:20000;
 active={practice,hand:plan[0],repeat:plan[1],start:performance.now(),created_at:new Date().toISOString(),duration,events:[],expected:"A",flags:[],calibration:{...cal},pointers:new Map()};
 $("hits").textContent="0";$("correct").textContent="0";$("rate").textContent="0.00";
 $("practice").disabled=true;$("start").disabled=true;$("abort").disabled=false;
 function tick(){
  if(!active)return;
  const left=Math.ceil(Math.max(0,active.duration-(performance.now()-active.start))/1000);
  $("clock").textContent="00:"+String(left).padStart(2,"0");
  if(left<=0){finish(false);return}
  animation=requestAnimationFrame(tick);
 }
 animation=requestAnimationFrame(tick);
}
$("practice").onclick=()=>start(true);
$("start").onclick=()=>start(false);
const field=$("stage");
field.addEventListener("pointerdown",e=>{
 if(!active)return;
 if(e.cancelable)e.preventDefault();
 if(e.pointerType==="touch"&&!e.isPrimary){active.flags.push("检测到多点触控");return}
 const elapsed=performance.now()-active.start;
 if(elapsed<0||elapsed>=active.duration)return;
 const element=e.target.closest("[data-target]");
 const target=element?element.dataset.target:"OUT";
 const rect=field.getBoundingClientRect();
 const item={event_no:active.events.length+1,elapsed_ms:elapsed,target,expected:active.expected,on_target:!!element,sequence_correct:!!element&&target===active.expected,x_mm:(e.clientX-rect.left)/ppm,y_mm:(e.clientY-rect.top)/ppm,pointer_type:e.pointerType,pointer_id:e.pointerId,press_duration_ms:null};
 active.events.push(item);active.pointers.set(e.pointerId,item);
 if(e.pointerType!=="touch")active.flags.push("使用非手指触屏输入");
 if(item.sequence_correct)active.expected=target==="A"?"B":"A";
 const hits=active.events.filter(x=>x.on_target);
 $("hits").textContent=hits.length;$("correct").textContent=active.events.filter(x=>x.sequence_correct).length;
 $("rate").textContent=fmt(hits.length/Math.max(.5,elapsed/1000));
},{passive:false});
function up(e){
 if(!active)return;
 const event=active.pointers.get(e.pointerId);
 if(event){event.press_duration_ms=Math.max(0,performance.now()-active.start-event.elapsed_ms);active.pointers.delete(e.pointerId)}
}
field.addEventListener("pointerup",up);field.addEventListener("pointercancel",e=>{if(active)active.flags.push("存在被取消的触摸");up(e)});
field.addEventListener("contextmenu",e=>e.preventDefault());
function finish(aborted){
 const r=active;if(!r)return;active=null;cancelAnimationFrame(animation);
 $("abort").disabled=true;$("clock").textContent="00:20";
 if(aborted){status("本次试次已作废");refresh();return}
 if(r.practice){trained=true;status("5秒练习已完成");}
 else{
  const hits=r.events.filter(x=>x.on_target),correct=r.events.filter(x=>x.sequence_correct);
  const intervals=correct.slice(1).map((x,i)=>x.elapsed_ms-correct[i].elapsed_ms).filter(x=>x>0);
  const first=correct.filter(x=>x.elapsed_ms<10000).length,second=correct.length-first;
  trials.push({trial_id:"T"+Date.now(),subject_id:$("subject").value,visit_id:$("visit").value,device:$("device").value,operator_id:$("operator").value,hand:r.hand,repeat:r.repeat,started_at:r.created_at,calibration:r.calibration,quality_flags:[...new Set(r.flags)],metrics:{on_target_count:hits.length,correct_sequence_count:correct.length,correct_rate_per_second:correct.length/20,mean_correct_iti_ms:mean(intervals),correct_iti_cv_pct:mean(intervals)>0&&sd(intervals)!==null?100*sd(intervals)/mean(intervals):null,first_half_correct:first,second_half_correct:second,rate_decrement_pct:first>0?100*(first-second)/first:null},raw_events:r.events});
  index++;restUntil=performance.now()+30000;
  $("trialNo").textContent=index+"/4";
  render();status("已保存："+r.hand+"第"+r.repeat+"次。请在结束后下载原始数据。");
 }
 refresh();
 if(index<order.length){const timer=setInterval(()=>{if(index>=order.length||performance.now()>=restUntil){clearInterval(timer)}if(!active)refresh()},350)}
}
$("abort").onclick=()=>{if(confirm("确认作废本次测试？"))finish(true)};
$("full").onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch(e){status("当前浏览器不支持全屏："+e.message)}};
function render(){
 const el=$("summary");
 if(!trials.length){el.textContent="暂无正式试次。";return}
 const esc=s=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
 el.innerHTML='<table><thead><tr><th>试次</th><th>正确次数</th><th>目标内次数</th><th>间隔CV</th><th>前后半程变化</th></tr></thead><tbody>'+
 trials.map(x=>'<tr><td>'+esc(x.hand)+x.repeat+'</td><td>'+x.metrics.correct_sequence_count+'</td><td>'+x.metrics.on_target_count+'</td><td>'+fmt(x.metrics.correct_iti_cv_pct,1)+'%</td><td>'+fmt(x.metrics.rate_decrement_pct,1)+'%</td></tr>').join("")+'</tbody></table>';
}
function csvCell(v){
 if(v===null||v===undefined)return"";
 let s=typeof v==="object"?JSON.stringify(v):String(v);
 if(/^[=+@-]/.test(s))s="'"+s;
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function csv(rows,columns){return"\uFEFF"+[columns.join(","),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(","))].join("\r\n")}
function dl(content,name,mime){const blob=new Blob([content],{type:mime}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000)}
function name(){return String($("subject").value||"TEST").replace(/[^\w-]/g,"_")+"_tablet_v05"}
$("summaryCSV").onclick=()=>{
 const rows=trials.map(x=>({trial_id:x.trial_id,subject_id:x.subject_id,visit_id:x.visit_id,device:x.device,hand:x.hand,repeat:x.repeat,...x.metrics,quality_flags:x.quality_flags,px_per_mm:x.calibration.px_per_mm}));
 const cols=["trial_id","subject_id","visit_id","device","hand","repeat","on_target_count","correct_sequence_count","correct_rate_per_second","mean_correct_iti_ms","correct_iti_cv_pct","first_half_correct","second_half_correct","rate_decrement_pct","quality_flags","px_per_mm"];
 dl(csv(rows,cols),name()+"_summary.csv","text/csv;charset=utf-8");
};
$("rawCSV").onclick=()=>{
 const rows=trials.flatMap(r=>r.raw_events.map(e=>({trial_id:r.trial_id,subject_id:r.subject_id,hand:r.hand,repeat:r.repeat,...e})));
 const cols=["trial_id","subject_id","hand","repeat","event_no","elapsed_ms","target","expected","on_target","sequence_correct","x_mm","y_mm","pointer_type","pointer_id","press_duration_ms"];
 dl(csv(rows,cols),name()+"_events.csv","text/csv;charset=utf-8");
};
$("json").onclick=()=>dl(JSON.stringify({version:"0.5.0",exported_at:new Date().toISOString(),trials},null,2),name()+"_full.json","application/json;charset=utf-8");
window.addEventListener("beforeunload",e=>{if(trials.length){e.preventDefault();e.returnValue=""}});
refresh();
