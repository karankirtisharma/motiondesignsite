import './style.css';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let runtime:import('./runtime/experience').Experience|undefined;
let lightweight=false,still=0,starting=false,lastSceneState="";
let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let quality:'high'|'balanced'|'mobile'='balanced';
try{const q=localStorage.getItem('md-quality');if(q==='high'||q==='balanced'||q==='mobile')quality=q;reduced ||= localStorage.getItem('md-reduce-motion')==='true';}catch{}
const stills=[{file:'exterior',title:'The exterior',text:'Cream limestone, bronze framing and a quiet approach.'},{file:'reception',title:'Reception',text:'Limestone, bronze, six exhibits and sweeping ceiling lights.'},{file:'exhibits',title:'Studies in motion',text:'Ideas, material studies, animation, rigging, camera and generative form.'},{file:'reverse',title:'Another perspective',text:'A view back through reception toward the entrance.'}];
const dialog=$<HTMLDialogElement>('settings-dialog'),roomsDialog=$<HTMLDialogElement>('rooms-dialog');
$('settings-button').onclick=()=>dialog.showModal();$('close-settings').onclick=()=>dialog.close();$('rooms-button').onclick=()=>roomsDialog.showModal();$('close-rooms').onclick=()=>roomsDialog.close();
for(const d of [dialog,roomsDialog])d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
$<HTMLSelectElement>('quality').value=quality;
$<HTMLSelectElement>('quality').onchange=e=>{quality=(e.target as HTMLSelectElement).value as typeof quality;try{localStorage.setItem('md-quality',quality);}catch{}runtime?.setQuality(quality);};
$<HTMLInputElement>('reduce-motion').checked=reduced;
$<HTMLInputElement>('reduce-motion').onchange=e=>{reduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('md-reduce-motion',String(reduced));}catch{}runtime?.setReducedMotion(reduced);if(reduced)setLightweight(true);};
function announce(text:string){$('announcer').textContent=text;}
function showStill(){const s=stills[still];($('poster').querySelector('img') as HTMLImageElement).src=`/posters/${s.file}.webp`;$('still-title').textContent=s.title;$('still-description').textContent=s.text;$('still-count').textContent=`${String(still+1).padStart(2,'0')} / ${String(stills.length).padStart(2,'0')}`;document.body.classList.toggle('interior',still>0);announce(s.title);}
function setLightweight(value:boolean){lastSceneState="";lightweight=value;document.body.classList.toggle('lightweight',value);$('lightweight-panel').hidden=!value;$('lightweight-button').innerHTML=value?'Return to 3D <span aria-hidden="true">↗</span>':'View without 3D <span aria-hidden="true">↗</span>';if(value){runtime?.pause();document.body.classList.remove('gpu-ready','exploring');$('exploration-panel').hidden=true;$('loading-status').hidden=true;showStill();$('mode-label').textContent='THE BUILDING / STILL VIEWS';}else{$('mode-label').textContent='AN ARCHITECTURAL EXPERIENCE';if(runtime){runtime.resume();document.body.classList.add('gpu-ready');}else void start3D();}}
$('previous-view').onclick=()=>{still=(still+stills.length-1)%stills.length;showStill();};$('next-view').onclick=()=>{still=(still+1)%stills.length;showStill();};
$('lightweight-button').onclick=()=>setLightweight(!lightweight);$('settings-lightweight').onclick=()=>{dialog.close();setLightweight(true);};$('retry-button').onclick=()=>setLightweight(false);
$('enter-button').onclick=()=>runtime?.enter();$('return-button').onclick=()=>runtime?.returnToPath();
document.querySelector('.brand')?.addEventListener('click',e=>{e.preventDefault();if(lightweight){still=0;showStill();}else void runtime?.seek(0);});
document.querySelectorAll<HTMLButtonElement>('[data-anchor]').forEach(b=>b.onclick=()=>void runtime?.exploreAnchor(b.dataset.anchor!));$('previous-anchor').onclick=()=>runtime?.cycleAnchor(-1);$('next-anchor').onclick=()=>runtime?.cycleAnchor(1);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open&&!roomsDialog.open)runtime?.returnToPath();});
const names:Record<string,string>={exterior:'The approach',reception:'Reception',spine:'The spine',meeting:'Meeting room',founder:'Founder’s studio',lounge:'The lounge',lab:'The lab','motion-floor':'Motion floor',upper:'The upper gallery','render-hall':'Render hall'};
async function start3D(){if(starting)return;starting=true;$('loading-status').hidden=false;$('loading-copy').textContent='Preparing the building';$('retry-button').hidden=true;
 try{const {Experience}=await import('./runtime/experience');runtime=new Experience($<HTMLCanvasElement>('scene'),{quality,reduced,onReady:()=>{if(!lightweight)document.body.classList.add('gpu-ready');$('loading-status').hidden=true;},onStatus:text=>{$('loading-copy').textContent=text;$('loading-status').hidden=!text;},onChange:s=>{
  if(lightweight)return;$('progress-fill').style.transform=`scaleY(${s.phase})`;
  const state=[s.room,s.exploring,s.reception,s.anchor,s.chapterIndex,s.description].join('|');if(state===lastSceneState)return;lastSceneState=state;
  document.body.classList.toggle('interior',s.room!=='exterior');document.body.classList.toggle('exploring',s.exploring);
  $('room-label').textContent=names[s.room]||s.chapter;$('phase-number').textContent=String(s.chapterIndex+1).padStart(2,'0');
  $('enter-label').textContent=s.room==='exterior'?'Scroll to enter':'Look around';$('enter-button').hidden=s.exploring;$('return-button').hidden=!s.exploring;$('exploration-panel').hidden=!s.exploring;
  $('exploration-heading').textContent=(names[s.room]||s.chapter).toUpperCase();($('exploration-panel').querySelector('.viewpoints') as HTMLElement).hidden=!s.reception;($('exploration-panel').querySelector('.viewpoint-arrows') as HTMLElement).hidden=!s.reception;
  $('exhibit-description').textContent=s.description;if(s.anchor)document.querySelectorAll<HTMLButtonElement>('[data-anchor]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.anchor===s.anchor)));
 },onFail:error=>{console.error(error);document.body.dataset.error=String(error);setLightweight(true);$('retry-button').hidden=false;announce('Showing still views while the 3D view is unavailable.');}});
 await runtime.init();$('room-list').replaceChildren(...runtime.getChapters().map((c,i)=>{const b=document.createElement('button');b.className='room-link';b.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span>${c.title}<span aria-hidden="true">↗</span>`;b.onclick=()=>{roomsDialog.close();runtime?.travelToRoom(c.id);};return b;}));
 }catch(error){console.error(error);document.body.dataset.error=String(error);runtime=undefined;setLightweight(true);$('retry-button').hidden=false;announce('Showing still views. You can retry the 3D experience.');}finally{starting=false;}
}
const saveData=(navigator as Navigator&{connection?:{saveData:boolean}}).connection?.saveData;
if(reduced||saveData||new URLSearchParams(location.search).has('lightweight'))setLightweight(true);else void start3D();
