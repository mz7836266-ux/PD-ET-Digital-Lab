import {mkdir,cp,copyFile,writeFile,stat} from "node:fs/promises";
import path from "node:path";
const root=process.cwd();
const dist=path.join(root,"dist");
const vendor=path.join(root,"node_modules","@mediapipe","tasks-vision");
await mkdir(path.join(dist,"vendor"),{recursive:true});
await mkdir(path.join(dist,"model"),{recursive:true});
for(const f of ["index.html","video.js","tapping.html","tapping.js","style.css"]){
 await copyFile(path.join(root,f),path.join(dist,f));
}
await copyFile(path.join(vendor,"vision_bundle.mjs"),path.join(dist,"vendor","vision_bundle.mjs"));
await cp(path.join(vendor,"wasm"),path.join(dist,"vendor","wasm"),{recursive:true});
const modelURL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const response=await fetch(modelURL,{signal:AbortSignal.timeout(120000)});
if(!response.ok)throw Error("Model download HTTP "+response.status);
const buffer=Buffer.from(await response.arrayBuffer());
if(buffer.length<100000)throw Error("Model file unexpectedly small");
await writeFile(path.join(dist,"model","hand_landmarker.task"),buffer);
await writeFile(path.join(dist,".nojekyll"),"");
console.log("Model bytes:",buffer.length);
console.log("WASM bytes:",(await stat(path.join(dist,"vendor","wasm","vision_wasm_internal.wasm"))).size);
console.log("GitHub Pages build complete");
