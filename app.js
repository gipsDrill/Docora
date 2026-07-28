import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={pdfBytes:null,pdfDoc:null,pages:[],current:0,scale:1,tool:'select',selected:null,history:[],future:[],drag:null,draw:null};
const els={landing:$('#landing'),workspace:$('#workspace'),fileInput:$('#fileInput'),dropzone:$('#dropzone'),thumbs:$('#thumbs'),canvas:$('#pdfCanvas'),overlay:$('#overlay'),pageWrap:$('#pageWrap'),download:$('#downloadBtn'),undo:$('#undoBtn'),redo:$('#redoBtn'),zoomLabel:$('#zoomLabel'),imageInput:$('#imageInput'),toast:$('#toast')};

function toast(msg){els.toast.textContent=msg;els.toast.classList.remove('hidden');setTimeout(()=>els.toast.classList.add('hidden'),2200)}
function uid(){return crypto.randomUUID?.()||Math.random().toString(36).slice(2)}
function snap(){return JSON.stringify({pages:state.pages,current:state.current})}
function checkpoint(){state.history.push(snap());if(state.history.length>50)state.history.shift();state.future=[];updateUndo()}
function restore(data){const x=JSON.parse(data);state.pages=x.pages;state.current=Math.min(x.current,state.pages.length-1);renderAll()}
function updateUndo(){els.undo.disabled=!state.history.length;els.redo.disabled=!state.future.length}

async function loadPDF(file){
 if(!file||file.type!=='application/pdf')return toast('Please choose a PDF file.');
 if(file.size>50*1024*1024)return toast('This beta supports files up to 50 MB.');
 try{
  const buf=await file.arrayBuffer();state.pdfBytes=new Uint8Array(buf);
  state.pdfDoc=await pdfjsLib.getDocument({data:state.pdfBytes.slice()}).promise;
  state.pages=[];
  for(let i=0;i<state.pdfDoc.numPages;i++)state.pages.push({source:i,rotation:0,deleted:false,annotations:[]});
  state.current=0;state.history=[];state.future=[];
  els.landing.classList.add('hidden');els.workspace.classList.remove('hidden');els.download.disabled=false;
  await renderAll();toast('PDF opened locally.');
 }catch(e){console.error(e);toast('Could not open this PDF.');}
}

async function renderAll(){await renderThumbs();await renderPage();updateUndo()}
async function renderThumbs(){els.thumbs.innerHTML='';state.pages.forEach((p,i)=>{
 const div=document.createElement('div');div.className='thumb'+(i===state.current?' active':'');div.draggable=true;div.dataset.i=i;
 const c=document.createElement('canvas');const meta=document.createElement('div');meta.className='thumb-meta';meta.innerHTML=`<span>Page ${i+1}</span><span class="thumb-controls"><button title="Rotate">↻</button></span>`;
 div.append(c,meta);els.thumbs.append(div);renderThumbCanvas(c,p);
 div.onclick=e=>{if(e.target.tagName==='BUTTON'){checkpoint();p.rotation=(p.rotation+90)%360;renderAll();return}state.current=i;renderAll()};
 div.ondragstart=e=>e.dataTransfer.setData('text/plain',i);div.ondragover=e=>e.preventDefault();div.ondrop=e=>{e.preventDefault();const from=+e.dataTransfer.getData('text/plain'),to=i;if(from===to)return;checkpoint();const [m]=state.pages.splice(from,1);state.pages.splice(to,0,m);state.current=to;renderAll()};
 })}
async function renderThumbCanvas(c,p){
 const page=await state.pdfDoc.getPage(p.source+1);
 const cssVp=page.getViewport({scale:.22,rotation:p.rotation});
 const dpr=Math.min(window.devicePixelRatio||1,2.5);
 const renderVp=page.getViewport({scale:.22*dpr,rotation:p.rotation});
 c.width=Math.ceil(renderVp.width);c.height=Math.ceil(renderVp.height);
 c.style.width=cssVp.width+'px';c.style.height=cssVp.height+'px';
 const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 await page.render({canvasContext:ctx,viewport:renderVp}).promise
}
async function renderPage(){
 if(!state.pages.length)return;
 state.selected=null;showProps(null);
 const p=state.pages[state.current];
 const page=await state.pdfDoc.getPage(p.source+1);
 const cssScale=1.25*state.scale;
 const dpr=Math.min(window.devicePixelRatio||1,2.5);
 const cssVp=page.getViewport({scale:cssScale,rotation:p.rotation});
 const renderVp=page.getViewport({scale:cssScale*dpr,rotation:p.rotation});
 els.canvas.width=Math.ceil(renderVp.width);els.canvas.height=Math.ceil(renderVp.height);
 els.canvas.style.width=cssVp.width+'px';els.canvas.style.height=cssVp.height+'px';
 els.pageWrap.style.width=cssVp.width+'px';els.pageWrap.style.height=cssVp.height+'px';
 const ctx=els.canvas.getContext('2d',{alpha:false});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 await page.render({canvasContext:ctx,viewport:renderVp,background:'rgb(255,255,255)'}).promise;
 renderAnnotations();els.zoomLabel.textContent=Math.round(state.scale*100)+'%'
}

function renderAnnotations(){els.overlay.innerHTML='';const p=state.pages[state.current];p.annotations.forEach(a=>{
 const el=document.createElement('div');el.className='annotation '+a.type+(state.selected===a.id?' selected':'');el.dataset.id=a.id;
 Object.assign(el.style,{left:(a.x*100)+'%',top:(a.y*100)+'%',width:(a.w*100)+'%',height:(a.h*100)+'%',opacity:a.opacity??1,color:a.color||'#111318',fontSize:(a.size||18)*state.scale+'px'});
 if(a.type==='text'||a.type==='date')el.textContent=a.text;
 else if(a.type==='checkbox')el.textContent='☑';
 else if(a.type==='image'||a.type==='signature'){const img=new Image();img.src=a.data;el.append(img)}
 else if(a.type==='draw')el.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${a.points}" fill="none" stroke="${a.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
 const r=document.createElement('span');r.className='resize';el.append(r);els.overlay.append(el);bindAnnotation(el,a,r);
 })}
function bindAnnotation(el,a,handle){el.onpointerdown=e=>{e.stopPropagation();state.selected=a.id;showProps(a);renderAnnotations();const rect=els.overlay.getBoundingClientRect();state.drag={id:a.id,startX:e.clientX,startY:e.clientY,x:a.x,y:a.y,rect};el.setPointerCapture?.(e.pointerId)};handle.onpointerdown=e=>{e.stopPropagation();const rect=els.overlay.getBoundingClientRect();state.drag={id:a.id,resize:true,startX:e.clientX,startY:e.clientY,w:a.w,h:a.h,rect};handle.setPointerCapture?.(e.pointerId)}}
window.addEventListener('pointermove',e=>{if(!state.drag)return;const a=currentAnn(state.drag.id);if(!a)return;const dx=(e.clientX-state.drag.startX)/state.drag.rect.width,dy=(e.clientY-state.drag.startY)/state.drag.rect.height;if(state.drag.resize){a.w=Math.max(.03,Math.min(.95-a.x,state.drag.w+dx));a.h=Math.max(.025,Math.min(.95-a.y,state.drag.h+dy))}else{a.x=Math.max(0,Math.min(1-a.w,state.drag.x+dx));a.y=Math.max(0,Math.min(1-a.h,state.drag.y+dy))}renderAnnotations()});
window.addEventListener('pointerup',()=>{if(state.drag){checkpoint();state.drag=null}});
function currentAnn(id=state.selected){return state.pages[state.current]?.annotations.find(a=>a.id===id)}

els.overlay.onclick=e=>{if(e.target!==els.overlay)return;state.selected=null;showProps(null);renderAnnotations()};
els.overlay.onpointerdown=e=>{if(state.tool==='draw'){const rect=els.overlay.getBoundingClientRect();state.draw={pts:[[(e.clientX-rect.left)/rect.width*100,(e.clientY-rect.top)/rect.height*100]],rect};e.preventDefault()}};
els.overlay.onpointermove=e=>{if(!state.draw)return;state.draw.pts.push([(e.clientX-state.draw.rect.left)/state.draw.rect.width*100,(e.clientY-state.draw.rect.top)/state.draw.rect.height*100])};
els.overlay.onpointerup=()=>{if(!state.draw)return;const xs=state.draw.pts.map(p=>p[0]),ys=state.draw.pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const points=state.draw.pts.map(p=>`${((p[0]-minX)/(maxX-minX||1))*100},${((p[1]-minY)/(maxY-minY||1))*100}`).join(' ');addAnn({type:'draw',x:minX/100,y:minY/100,w:Math.max(.03,(maxX-minX)/100),h:Math.max(.03,(maxY-minY)/100),points,color:'#6d5dfc',opacity:1});state.draw=null};

function addAnn(a){checkpoint();a.id=uid();state.pages[state.current].annotations.push(a);state.selected=a.id;renderAnnotations();showProps(a);setTool('select')}
function defaultPos(){return{x:.18,y:.18,w:.25,h:.06}}
function setTool(t){state.tool=t;$$('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t))}
$$('.tool').forEach(b=>b.onclick=()=>{
 const t=b.dataset.tool;setTool(t);
 if(t==='text')addAnn({...defaultPos(),type:'text',text:'Edit this text',size:18,color:'#111318',opacity:1});
 if(t==='whiteout')addAnn({...defaultPos(),type:'whiteout',w:.28,h:.05,color:'#ffffff',opacity:1});
 if(t==='highlight')addAnn({...defaultPos(),type:'highlight',w:.3,h:.035,color:'#ffe24b',opacity:.5});
 if(t==='shape')addAnn({...defaultPos(),type:'shape',w:.24,h:.12,color:'#5b5f69',opacity:1});
 if(t==='date')addAnn({...defaultPos(),type:'date',text:new Date().toLocaleDateString('en-GB'),size:17,color:'#111318',opacity:1});
 if(t==='checkbox')addAnn({...defaultPos(),type:'checkbox',w:.045,h:.045,size:26,color:'#111318',opacity:1});
 if(t==='image')els.imageInput.click();
 if(t==='signature')openSignature();
});
els.imageInput.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>addAnn({...defaultPos(),type:'image',w:.28,h:.18,data:r.result,opacity:1});r.readAsDataURL(f);e.target.value=''};

function showProps(a){$('#emptyProps').classList.toggle('hidden',!!a);$('#objectProps').classList.toggle('hidden',!a);if(!a)return;$('#propType').value=a.type;$('#textValueRow').classList.toggle('hidden',!['text','date'].includes(a.type));$('#propText').value=a.text||'';$('#propSize').value=a.size||18;$('#propOpacity').value=a.opacity??1;$('#propColor').value=toHex(a.color||'#111318')}
function updateProp(key,val){const a=currentAnn();if(!a)return;checkpoint();a[key]=val;renderAnnotations()}
$('#propText').onchange=e=>updateProp('text',e.target.value);$('#propSize').onchange=e=>updateProp('size',+e.target.value);$('#propOpacity').onchange=e=>updateProp('opacity',+e.target.value);$('#propColor').onchange=e=>updateProp('color',e.target.value);
$('#deleteObjBtn').onclick=()=>{const p=state.pages[state.current],i=p.annotations.findIndex(a=>a.id===state.selected);if(i<0)return;checkpoint();p.annotations.splice(i,1);state.selected=null;renderAnnotations();showProps(null)};
$('#duplicateBtn').onclick=()=>{const a=currentAnn();if(!a)return;checkpoint();const n=structuredClone(a);n.id=uid();n.x=Math.min(.95-n.w,n.x+.03);n.y=Math.min(.95-n.h,n.y+.03);state.pages[state.current].annotations.push(n);state.selected=n.id;renderAnnotations();showProps(n)};
function toHex(c){if(/^#/.test(c))return c.slice(0,7);return'#111318'}

$('#rotateBtn').onclick=()=>{checkpoint();state.pages[state.current].rotation=(state.pages[state.current].rotation+90)%360;renderAll()};
$('#deletePageBtn').onclick=()=>{if(state.pages.length===1)return toast('A PDF must contain at least one page.');checkpoint();state.pages.splice(state.current,1);state.current=Math.max(0,state.current-1);renderAll()};
$('#zoomIn').onclick=()=>{state.scale=Math.min(1.8,state.scale+.1);renderPage()};$('#zoomOut').onclick=()=>{state.scale=Math.max(.5,state.scale-.1);renderPage()};
els.undo.onclick=()=>{if(!state.history.length)return;state.future.push(snap());restore(state.history.pop());updateUndo()};els.redo.onclick=()=>{if(!state.future.length)return;state.history.push(snap());restore(state.future.pop());updateUndo()};
$('#closeDocBtn').onclick=()=>location.reload();

async function exportPDF(){
 try{els.download.disabled=true;els.download.textContent='Preparing…';const {PDFDocument,rgb,StandardFonts}=PDFLib;const src=await PDFDocument.load(state.pdfBytes);const out=await PDFDocument.create();const font=await out.embedFont(StandardFonts.Helvetica);
 for(const p of state.pages){const [copied]=await out.copyPages(src,[p.source]);out.addPage(copied);const page=out.getPage(out.getPageCount()-1);page.setRotation(PDFLib.degrees(p.rotation));const {width,height}=page.getSize();
  for(const a of p.annotations){const x=a.x*width,y=height-(a.y+a.h)*height,w=a.w*width,h=a.h*height,opacity=a.opacity??1,col=hexRgb(a.color||'#111318');
   if(a.type==='text'||a.type==='date')page.drawText(a.text||'',{x,y:y+h*.2,size:a.size||18,font,color:rgb(...col),opacity,maxWidth:w,lineHeight:(a.size||18)*1.2});
   else if(a.type==='whiteout')page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1),opacity});
   else if(a.type==='highlight')page.drawRectangle({x,y,width:w,height:h,color:rgb(1,.88,.25),opacity});
   else if(a.type==='shape')page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(...col),borderWidth:2,opacity});
   else if(a.type==='checkbox')page.drawText('✓',{x,y,size:Math.max(14,h*.9),font,color:rgb(...col),opacity});
   else if(a.type==='image'||a.type==='signature'){const bytes=await fetch(a.data).then(r=>r.arrayBuffer());let img;try{img=await out.embedPng(bytes)}catch{img=await out.embedJpg(bytes)}page.drawImage(img,{x,y,width:w,height:h,opacity})}
   else if(a.type==='draw'){const pts=a.points.split(' ').map(s=>s.split(',').map(Number));for(let i=1;i<pts.length;i++){page.drawLine({start:{x:x+pts[i-1][0]/100*w,y:y+(1-pts[i-1][1]/100)*h},end:{x:x+pts[i][0]/100*w,y:y+(1-pts[i][1]/100)*h},thickness:2,color:rgb(...col),opacity})}}
  }
 }
 const bytes=await out.save();const blob=new Blob([bytes],{type:'application/pdf'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='docora-edited.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Your PDF is ready.');
 }catch(e){console.error(e);toast('Export failed for this document.');}finally{els.download.disabled=false;els.download.textContent='Download PDF'}
}
function hexRgb(hex){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');return[parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255]}
els.download.onclick=exportPDF;

function openSignature(){const m=$('#signatureModal'),c=$('#signatureCanvas'),ctx=c.getContext('2d');m.classList.remove('hidden');ctx.clearRect(0,0,c.width,c.height);ctx.lineWidth=5;ctx.lineCap='round';ctx.strokeStyle='#15171c';let drawing=false;c.onpointerdown=e=>{drawing=true;ctx.beginPath();const r=c.getBoundingClientRect();ctx.moveTo((e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height)};c.onpointermove=e=>{if(!drawing)return;const r=c.getBoundingClientRect();ctx.lineTo((e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height);ctx.stroke()};c.onpointerup=()=>drawing=false}
$('#closeSignature').onclick=()=>$('#signatureModal').classList.add('hidden');$('#clearSignature').onclick=()=>$('#signatureCanvas').getContext('2d').clearRect(0,0,720,260);$('#useSignature').onclick=()=>{const data=$('#signatureCanvas').toDataURL('image/png');$('#signatureModal').classList.add('hidden');addAnn({...defaultPos(),type:'signature',w:.3,h:.1,data,opacity:1})};

els.fileInput.onchange=e=>loadPDF(e.target.files[0]);['dragenter','dragover'].forEach(ev=>els.dropzone.addEventListener(ev,e=>{e.preventDefault();els.dropzone.classList.add('drag')}));['dragleave','drop'].forEach(ev=>els.dropzone.addEventListener(ev,e=>{e.preventDefault();els.dropzone.classList.remove('drag')}));els.dropzone.addEventListener('drop',e=>loadPDF(e.dataTransfer.files[0]));
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?els.redo.click():els.undo.click()}if(e.key==='Delete'&&state.selected)$('#deleteObjBtn').click()});
