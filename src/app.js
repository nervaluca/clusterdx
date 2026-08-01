'use strict';

/* ── BANDE ── */
const BANDS = [
  ['160',[1800,2000]],['80',[3500,4000]],['40',[7000,7300]],
  ['20',[14000,14350]],['17',[18068,18168]],['15',[21000,21450]],
  ['12',[24890,24990]],['10',[28000,29700]],['6',[50000,54000]],
];
const BCOL = {
  '160':'#c084fc','80':'#f87171','40':'#fb923c','20':'#4ade80',
  '17':'#22d3ee','15':'#60a5fa','12':'#a78bfa','10':'#fbbf24','6':'#f472b6','?':'#6b7280'
};
function band(f){ f=parseFloat(f); for(const[b,[l,h]] of BANDS) if(f>=l&&f<=h) return b; return '?'; }

/* ── PARSER SPOT ── */
function parseSpot(line){
  const m=line.match(/^DX\s+de\s+([\w\/\-]+)[\s:]+(\d{4,6}\.?\d*)\s+([\w\/\d]+)\s*(.*?)(\d{4}Z)?\s*$/i);
  if(!m) return null;
  const freq=parseFloat(m[2]); if(isNaN(freq)) return null;
  const comment=m[4].trim();
  const c=comment.toUpperCase();
  let mode='SSB';
  if(/\bFT8\b/.test(c)) mode='FT8';
  else if(/\bFT4\b/.test(c)) mode='FT4';
  else if(/\bCW\b/.test(c)) mode='CW';
  else if(/\bRTTY\b|\bPSK\b|\bDIGI\b/.test(c)) mode='DIGI';
  else if(/\bAM\b/.test(c)) mode='AM';
  else {
    const b=band(freq);
    const ft8={20:14074,40:7074,15:21074,10:28074,17:18100,80:3573,6:50313};
    if(ft8[b]&&Math.abs(freq-ft8[b])<5) mode='FT8';
    else if(freq%1===0||(freq*10)%5===0) mode='CW';
  }
  return {
    id:Date.now()+Math.random(), call:m[3].toUpperCase(),
    dxcc:m[3].toUpperCase().replace(/\/.*$/,'').substring(0,4),
    freq:freq.toFixed(1), mode, comment:comment||'—',
    de:m[1].toUpperCase(),
    time:m[5]?m[5].slice(0,4):utcNow(), isNew:true
  };
}

/* ── STATO ── */
let spots=[], filtBand='ALL', filtMode='ALL', selMode='CW';
let Plugin=null, isNative=false, connected=false, connSrv=null;
let reconnTimer=null, demoTimer=null, customSrvs=[];

const SERVERS=[
  {name:'DX.IW1FZR.IT', host:'dx.iw1fzr.it',       port:7300},
  {name:'DXC.EA5WA',    host:'dxc.ea5wa.com',       port:7300},
  {name:'GB7DXC',       host:'gb7dxc.gb7dxc.com',   port:7300},
  {name:'K4UTE',        host:'k4ute.com',            port:7300},
  {name:'VK6HZ',        host:'dx.vk6hz.id.au',      port:7300},
];

/* ── CAPACITOR INIT ── */
async function initCap(){
  try{
    if(!window.Capacitor) return false;
    Plugin=window.Capacitor.registerPlugin('TelnetCluster');
    if(!Plugin) return false;
    Plugin.addListener('spotReceived', ev=>onLine(ev.line));
    Plugin.addListener('rawLine',      ev=>onLine(ev.line));
    Plugin.addListener('connected',    ev=>onConn(ev));
    Plugin.addListener('disconnected', ()=>onDisconn());
    Plugin.addListener('connectionError', ev=>onErr(ev.message));
    logc('Plugin TCP nativo OK','ok');
    return true;
  }catch(e){ return false; }
}

/* ── CONNESSIONE ── */
async function connect(srv){
  clearTimeout(reconnTimer);
  connSrv=srv; setState('ing');
  logc(`Connessione a ${srv.name}…`,'info');
  if(isNative&&Plugin){
    try{ await Plugin.disconnect().catch(()=>{}); await Plugin.connect({host:srv.host,port:srv.port}); }
    catch(e){ onErr(e.message); }
  } else {
    setState('err'); toast('⚠ TCP disponibile solo nell\'APK');
  }
}
function disconnect(){
  clearTimeout(reconnTimer); connSrv=null;
  if(isNative&&Plugin) Plugin.disconnect().catch(()=>{});
  onDisconn();
}
async function sendCmd(data){
  if(!isNative||!Plugin){ toast('⚠ Non connesso'); return; }
  try{ await Plugin.send({data}); logc('> '+data,'ok'); }
  catch(e){ logc('Errore invio: '+e.message,'err'); }
}

function onConn(){
  connected=true; setState('on'); logc('Connesso a '+(connSrv?connSrv.name:''),'ok');
  renderSrvs(); stopDemo();
  const mc=document.getElementById('my-call').value.trim()||'IW1FZR';
  setTimeout(async()=>{
    await sendCmd(mc);
    await sendCmd('SET/SKIMMER');
    await sendCmd('SET/FT8');
  },800);
  try{ localStorage.setItem('dxc-last',JSON.stringify(connSrv)); }catch(e){}
}
function onDisconn(){
  const was=connected; connected=false; setState('off');
  logc('Disconnesso.','info'); renderSrvs();
  if(was&&connSrv){ logc('Riconnessione in 20s…','info'); reconnTimer=setTimeout(()=>connect(connSrv),20000); }
}
function onErr(msg){
  connected=false; setState('err'); logc('Errore: '+msg,'err'); renderSrvs();
  if(connSrv){ reconnTimer=setTimeout(()=>connect(connSrv),20000); }
}
function onLine(line){
  line=line.trim(); if(!line) return;
  logc(line,'rx');
  const s=parseSpot(line); if(s) addSpot(s);
}

/* ── SPOTS ── */
function addSpot(s){
  const dup=spots.slice(0,20).find(x=>x.call===s.call&&x.freq===s.freq);
  if(dup) return;
  spots.unshift(s); if(spots.length>500) spots.pop();
  renderSpots(); updateStats();
}
function filtered(){
  const q=(document.getElementById('search')||{value:''}).value.trim().toUpperCase();
  return spots.filter(s=>{
    if(filtBand!=='ALL'&&band(parseFloat(s.freq))!==filtBand) return false;
    if(filtMode!=='ALL'&&s.mode!==filtMode) return false;
    if(q&&!s.call.includes(q)&&!s.dxcc.includes(q)&&
       !s.comment.toUpperCase().includes(q)&&!s.de.includes(q)) return false;
    return true;
  });
}
function renderSpots(){
  const list=document.getElementById('spot-list'); if(!list) return;
  const fs=filtered();
  document.getElementById('badge').textContent=fs.length+' spot';
  if(!fs.length){
    list.innerHTML=`<div class="empty">Nessuno spot con i filtri selezionati<br>
      <span style="color:var(--green);font-size:10px">
        ${spots.length?spots.length+' spot totali':'Tocca SERVER per connetterti'}
      </span></div>`; return;
  }
  list.innerHTML='';
  fs.forEach(s=>{
    const b=band(parseFloat(s.freq)), col=BCOL[b]||'#888';
    const d=document.createElement('div');
    d.className='sitem'+(s.isNew?' new':'');
    d.innerHTML=
      `<div><div class="sfreq" style="color:${col}"><span class="bdot" style="background:${col}"></span>${parseFloat(s.freq).toFixed(1)}</div>
       <div class="sband">${b}m</div></div>
       <div><div><span class="scall">${s.call}</span>${s.isNew?'<span class="nbadge">NEW</span>':''}</div>
       <div class="sde">DE: ${s.de}</div><div class="scomm">${s.comment}</div></div>
       <div class="sright"><span class="smode mode${s.mode}">${s.mode}</span>
       <div class="stime">${s.time}z</div><div class="sdxcc">${s.dxcc}</div></div>`;
    d.onclick=()=>{ s.isNew=false; document.getElementById('s-freq').value=s.freq; selModeStr(s.mode); updPrev(); toast(`📡 ${s.call}  ${s.freq} kHz  ${s.mode}`); };
    list.appendChild(d);
  });
  setTimeout(()=>spots.forEach(s=>s.isNew=false),2000);
}

/* ── FILTRI ── */
function fBand(b){ filtBand=b; document.querySelectorAll('[id^="fb-"]').forEach(c=>c.classList.remove('active')); document.getElementById('fb-'+b).classList.add('active'); renderSpots(); }
function fMode(m){ filtMode=m; document.querySelectorAll('[id^="fm-"]').forEach(c=>c.classList.remove('active')); document.getElementById('fm-'+m).classList.add('active'); renderSpots(); }

/* ── SEND ── */
function selM(el,m){ selMode=m; document.querySelectorAll('.mchip').forEach(c=>c.classList.remove('sel')); el.classList.add('sel'); updPrev(); }
function selModeStr(m){ selMode=m; document.querySelectorAll('.mchip').forEach(c=>c.classList.toggle('sel',c.textContent===m)); }
function updPrev(){
  const call=document.getElementById('s-call').value.trim()||'[CALLSIGN]';
  const freq=document.getElementById('s-freq').value.trim()||'[FREQ]';
  const comm=document.getElementById('s-comment').value.trim()||'';
  const mc=document.getElementById('my-call').value.trim()||'IW1FZR';
  document.getElementById('s-prev').innerHTML=`<span>DX de ${mc}:</span> ${call.toUpperCase()}  ${freq}  ${selMode}  ${comm}`;
}
async function doSend(){
  const call=document.getElementById('s-call').value.trim().toUpperCase();
  const freq=document.getElementById('s-freq').value.trim();
  const comm=document.getElementById('s-comment').value.trim();
  const mc=document.getElementById('my-call').value.trim()||'IW1FZR';
  if(!call||!freq){ toast('⚠ Inserisci callsign e frequenza'); return; }
  if(connected&&isNative){ await sendCmd(`DX ${call} ${freq} ${selMode} ${comm}`); toast('✓ Spot inviato!'); }
  else toast('⚠ Non connesso al cluster');
  addSpot({id:Date.now(),call,dxcc:call.replace(/\/.*$/,'').substring(0,4),
    freq:parseFloat(freq).toFixed(1),mode:selMode,comment:comm||'de '+mc,de:mc,time:utcNow(),isNew:true});
  document.getElementById('s-call').value='';
  document.getElementById('s-comment').value='';
  updPrev(); setTimeout(()=>showTab('spots'),600);
}

/* ── SERVER ── */
function allSrvs(){ return [...SERVERS,...customSrvs]; }
function renderSrvs(){
  const list=document.getElementById('server-list'); if(!list) return;
  list.innerHTML='';
  allSrvs().forEach(srv=>{
    const isC=connected&&connSrv&&connSrv.host===srv.host;
    const d=document.createElement('div');
    d.className='ccard'+(isC?' connected':'');
    d.innerHTML=`<div class="ccdot"></div><div><div class="ccname">${srv.name}</div>
      <div class="cchost">${srv.host} · ${srv.port}</div></div>
      <div class="ccping">${isC?'✓ connesso':'Tocca →'}</div>`;
    d.onclick=()=>{ if(isC){ disconnect(); return; } connect(srv); };
    list.appendChild(d);
  });
}
function addServer(){
  const host=document.getElementById('c-host').value.trim();
  const port=parseInt(document.getElementById('c-port').value)||7300;
  const name=document.getElementById('c-name').value.trim()||host;
  if(!host){ toast('⚠ Inserisci host'); return; }
  customSrvs.push({name,host,port});
  try{ localStorage.setItem('dxc-custom',JSON.stringify(customSrvs)); }catch(e){}
  document.getElementById('c-host').value='';
  document.getElementById('c-name').value='';
  renderSrvs(); toast('✓ Server aggiunto');
}

/* ── STATS ── */
function updateStats(){
  document.getElementById('st-tot').textContent=spots.length;
  document.getElementById('st-dxcc').textContent=new Set(spots.map(s=>s.dxcc)).size;
  document.getElementById('st-ft8').textContent=spots.filter(s=>s.mode==='FT8').length;
  document.getElementById('st-cw').textContent=spots.filter(s=>s.mode==='CW').length;
  const bc={};let max=1;
  spots.forEach(s=>{const b=band(parseFloat(s.freq));bc[b]=(bc[b]||0)+1;if(bc[b]>max)max=bc[b];});
  const bars=document.getElementById('band-bars');
  if(bars){ bars.innerHTML='';
    ['160','80','40','20','17','15','10','6'].forEach(b=>{
      const v=bc[b]||0;if(!v)return;
      const col=BCOL[b],pct=Math.round(v/max*100);
      bars.innerHTML+=`<div class="brow"><div class="blbl" style="color:${col}">${b}m</div>
        <div class="btrack"><div class="bfill" style="width:${pct}%;background:${col}"></div></div>
        <div class="bcnt">${v}</div></div>`;
    });
  }
  const cc={};spots.forEach(s=>cc[s.call]=(cc[s.call]||0)+1);
  const top=Object.entries(cc).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const td=document.getElementById('top-dx');
  if(td){ td.innerHTML=''; top.forEach(([call,cnt],i)=>
    td.innerHTML+=`<div class="trow"><div class="trank">${i+1}</div>
      <div class="tcall">${call}</div><div class="tcnt">${cnt} spot</div></div>`); }
}

/* ── UI ── */
function setState(s){
  const dot=document.getElementById('cdot'),lbl=document.getElementById('clabel');
  dot.className='dot';
  if(s==='on'){ dot.classList.add('on'); lbl.textContent=connSrv?connSrv.name:'Connesso'; }
  else if(s==='ing'){ dot.classList.add('ing'); lbl.textContent='Connessione…'; }
  else if(s==='err'){ dot.classList.add('err'); lbl.textContent='Errore · riconn. 20s'; }
  else lbl.textContent=isNative?'Non connesso':'Modalità demo';
}
function showTab(n){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+n).classList.add('active');
  document.getElementById('panel-'+n).classList.add('active');
  if(n==='stats') updateStats();
  if(n==='cluster') renderSrvs();
}
function logc(msg,type='info'){
  const box=document.getElementById('consolebox');if(!box)return;
  const d=document.createElement('div');d.className='logline l'+type;
  d.textContent=utcNow()+'z  '+msg;box.appendChild(d);box.scrollTop=box.scrollHeight;
  while(box.children.length>120)box.removeChild(box.firstChild);
}
let _tt;
function toast(msg){
  const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),2800);
}
function utcNow(){const d=new Date();return d.getUTCHours().toString().padStart(2,'0')+':'+d.getUTCMinutes().toString().padStart(2,'0');}

/* ── DEMO MODE ── */
const DEMO=[
  {call:'JA1NUT',dxcc:'JA',freq:'14025.0',mode:'CW',comment:'599 UP',de:'IK2YFT'},
  {call:'DL8YR',dxcc:'DL',freq:'7074.0',mode:'FT8',comment:'-12 dB',de:'IW1FZR'},
  {call:'VK3KE',dxcc:'VK',freq:'14074.0',mode:'FT8',comment:'-08 dB',de:'IK5ORP'},
  {call:'T32C',dxcc:'T32',freq:'3525.0',mode:'CW',comment:'599 pile-up',de:'IW1FZR'},
  {call:'3D2CR',dxcc:'3D2',freq:'50310.0',mode:'FT8',comment:'-18 dB',de:'I8DVJ'},
  {call:'ZD8W',dxcc:'ZD8',freq:'14195.0',mode:'SSB',comment:'56 QSB',de:'IT9HLN'},
  {call:'E51DLD',dxcc:'E5',freq:'14025.0',mode:'CW',comment:'UP3',de:'IW2FUT'},
  {call:'FT8WW',dxcc:'FT',freq:'14074.0',mode:'FT8',comment:'-12 dB',de:'IW1FZR'},
  {call:'5B4ALX',dxcc:'5B',freq:'7010.0',mode:'CW',comment:'599',de:'IK5ORP'},
  {call:'XW4XR',dxcc:'XW',freq:'18130.0',mode:'SSB',comment:'57',de:'IT9HLN'},
  {call:'UA9XL',dxcc:'UA9',freq:'21225.0',mode:'SSB',comment:'59',de:'I2AAO'},
  {call:'PY2GTA',dxcc:'PY',freq:'28074.0',mode:'FT8',comment:'-15 dB',de:'IW1FZR'},
];
function loadDemo(){
  const now=Date.now();
  DEMO.forEach((s,i)=>{
    const t=new Date(now-i*150000);
    spots.push({...s,id:now+i,
      time:t.getUTCHours().toString().padStart(2,'0')+':'+t.getUTCMinutes().toString().padStart(2,'0'),
      isNew:false});
  });
}
function startDemo(){ if(demoTimer)return; demoTimer=setInterval(()=>{const s=DEMO[Math.floor(Math.random()*DEMO.length)];addSpot({...s,id:Date.now(),time:utcNow(),isNew:true});},9000); }
function stopDemo(){ clearInterval(demoTimer);demoTimer=null; }

/* ── INIT ── */
window.addEventListener('DOMContentLoaded',async()=>{
  try{ customSrvs=JSON.parse(localStorage.getItem('dxc-custom')||'[]'); }catch(e){}
  isNative=await initCap();
  loadDemo(); renderSpots(); updateStats(); renderSrvs();
  logc('DX Cluster · IW1FZR','ok');
  if(!isNative){ startDemo(); setState('off'); logc('Demo mode (APK: connettiti a un server)','info'); }
  else {
    try{
      const last=JSON.parse(localStorage.getItem('dxc-last')||'null');
      const srv=last?allSrvs().find(s=>s.host===last.host):SERVERS[0];
      if(srv) setTimeout(()=>connect(srv),600);
    }catch(e){ setTimeout(()=>connect(SERVERS[0]),600); }
  }
});

window.showTab=showTab; window.fBand=fBand; window.fMode=fMode;
window.selM=selM; window.updPrev=updPrev; window.doSend=doSend; window.addServer=addServer;
