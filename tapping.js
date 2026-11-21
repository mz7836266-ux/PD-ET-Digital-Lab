
const $=id=>document.getElementById(id);
let ppm=null,practiceDone=false,active=null,results=[];
const now=()=>performance.now();
const show=s=>$("status").textContent=s;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const std=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1)):null;
$("cal").style.width=$("slider").value+"px";
$("slider").oninput=()=>{$("cal").style.width=$("slider").value+"px";ppm=null;$("start").disabled=true;show("校准发生变化，请重新确认。")};
function layout(){
 if(!ppm)return false;
 const stage=$("stage"),size=30*ppm,gap=90*ppm;
 stage.style.height=Math.max(220,65*ppm)+"px";
 for(const [i,key] of ["A","B"].entries()){
  const e=stage.querySelector('[data-target="'+key+'"]');
  e.style.width=size+"px";e.style.height=size+"px";
  e.style.left="calc(50% "+(i?" + ":" - ")+(gap/2)+"px)";
 }
 return stage.clientWidth>=(90+30)*ppm+15;
}
$("confirm").onclick=()=>{
 ppm=Number($("slider").value)/100;
 const fits=layout();
 show(fits?"校准完成："+ppm.toFixed(2)+" CSS px/mm。":"当前屏幕空间不足，请横屏后重新校准。");
 $("start").disabled=!fits||!practiceDone;
};
window.addEventListener("resize",()=>{if(active)active.flags.push("窗口大小变化");else if(ppm){ppm=null;$("start").disabled=true;show("屏幕尺寸变化，请重新校准")}}); 
const tapStage=$("stage");
tapStage.addEventListener("pointerdown",e=>{
 if(!active)return;
 if(e.cancelable)e.preventDefault();
 if(e.pointerType==="touch"&&e.isPrimary===false){active.flags.push("多点触控");return}
 const elapsed=now()-active.start;
 if(elapsed<0||elapsed>=active.duration)return;
 const target=e.target.closest("[data-target]")?.dataset.target||"OUT";
 const correct=target===active.expected;
 const r=tapStage.getBoundingClientRect();
 active.events.push({elapsed_ms:elapsed,target,correct,x_mm:(e.clientX-r.left)/ppm,y_mm:(e.clientY-r.top)/ppm,pointer_type:e.pointerType});
 if(correct)active.expected=target==="A"?"B":"A";
 const hits=active.events.filter(x=>x.target!=="OUT");
 $("count").textContent=hits.length;
 $("correct").textContent=active.events.filter(x=>x.correct).length;
 $("rate").textContent=(hits.length/Math.max(.5,elapsed/1000)).toFixed(2);
},{passive:false});
tapStage.addEventListener("contextmenu",e=>e.preventDefault());
function run(practice){
 if(!ppm||!layout()){show("请先确认校准。");return}
 if(active)return;
 if(!practice&&!practiceDone){show("请先练习5秒。");return}
 const duration=practice?5000:20000;
 active={practice,start:now(),created_at:new Date().toISOString(),duration,expected:"A",events:[],flags:[],hand:$("hand").value};
 $("practice").disabled=true;$("start").disabled=true;
 function tick(){
  if(!active)return;
  const left=Math.ceil(Math.max(0,duration-(now()-active.start))/1000);
  $("clock").textContent="00:"+String(left).padStart(2,"0");
  if(left===0){finish();return}
  requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}
function finish(){
 const s=active;if(!s)return;active=null;
 $("practice").disabled=false;$("start").disabled=!ppm;
 if(s.practice){practiceDone=true;show("练习结束。");return}
 const good=s.events.filter(x=>x.correct),dts=good.slice(1).map((x,i)=>x.elapsed_ms-good[i].elapsed_ms);
 results.push({subject_id:$("subject").value,device:$("device").value,hand:s.hand,timestamp:s.created_at,duration_seconds:20,target_distance_mm:90,target_diameter_mm:30,px_per_mm:ppm,events:s.events,quality_flags:s.flags,metrics:{all_touches:s.events.length,correct_touches:good.length,mean_correct_iti_ms:mean(dts),sd_correct_iti_ms:std(dts),correct_rate_s:good.length/20}});
 show("正式测试已保存。当前共有"+results.length+"条试次。请及时下载CSV和JSON。");
}
$("practice").onclick=()=>run(true);
$("start").onclick=()=>run(false);
function download(content,name,type){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$("json").onclick=()=>download(JSON.stringify({version:"0.4.1",exported_at:new Date().toISOString(),trials:results},null,2),"tablet-tapping.json","application/json");
$("csv").onclick=()=>{
 const rows=results.flatMap((r,i)=>r.events.map((e,j)=>[i+1,r.subject_id,r.hand,j+1,e.elapsed_ms,e.target,e.correct,e.x_mm,e.y_mm,e.pointer_type]));
 const headers=["trial","subject_id","hand","event_no","elapsed_ms","target","correct","x_mm","y_mm","pointer_type"];
 const cell=v=>{let s=String(v??"");if(/^[=+@-]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
 download("\ufeff"+[headers.join(","),...rows.map(x=>x.map(cell).join(","))].join("\r\n"),"tablet-tapping.csv","text/csv;charset=utf-8");
};
