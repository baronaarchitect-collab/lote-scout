/* =========================================================================
   LandX · Módulo Catastro (Cali, Bogotá, Barranquilla y Medellín)
   -------------------------------------------------------------------------
   Cuando la foto cae dentro de una ciudad con catastro abierto, este módulo
   agrega al detalle del lote:
     1. Búsqueda del lote en el catastro de esa ciudad.
     2. Plano CAD (.dxf) de la zona con el lote resaltado y medidas reales.
     3. Masa normativa 3D sobre la geometría real del lote — función Pro.
   Las fuentes de cada ciudad viven en cities.js; aquí no hay nada específico
   de una ciudad. Se carga desde app/index.html con import('./cali.js') y
   recibe un "puente" (LX) con lo que necesita de la app.
   ========================================================================= */
import {cityAt,cityById} from './cities.js';

let LX=null,CITY=null;
const $=id=>document.getElementById(id);
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('es-CO');

export const inCali=c=>!!cityAt(c);   // nombre histórico: hoy significa "en una ciudad con catastro"
// Ciudad de un lote: la del predio guardado (los guardados antes de tener varias ciudades son de Cali)
// o, si aún no tiene predio, la que contiene sus coordenadas
const cityOf=lot=>!lot?null:lot.predio?cityById(lot.predio.ciudad||'cali'):cityAt(lot.coords);

/* ===================== Geometría (compartida por DXF y 3D) ===================== */
// Proyección local equirectangular en metros alrededor de un origen (misma en plano y 3D)
function proj(lon,lat,lon0,lat0){return [(lon-lon0)*111320*Math.cos(lat0*Math.PI/180),(lat-lat0)*110540];}
function ringsOf(geom){const out=[];if(!geom)return out;
  if(geom.type==='Polygon')geom.coordinates.forEach(r=>out.push(r));
  else if(geom.type==='MultiPolygon')geom.coordinates.forEach(p=>p.forEach(r=>out.push(r)));return out;}
function biggestRing(rings){let b=rings[0]||[];rings.forEach(r=>{if(r.length>b.length)b=r;});return b;}
function centroid(geom){const r=biggestRing(ringsOf(geom));if(!r.length)return null;let x=0,y=0;r.forEach(p=>{x+=p[0];y+=p[1];});return [x/r.length,y/r.length];}
export function shoelace(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[j].x*p[i].z-p[i].x*p[j].z;return Math.abs(a/2);}
function signedArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[j].x*p[i].z-p[i].x*p[j].z;return a/2;}
// Huella del lote en metros (x este, z sur) centrada en su centroide
export function footprintOf(geom){
  const c=centroid(geom);if(!c)return {pts:[],c:null};
  let pts=biggestRing(ringsOf(geom)).map(p=>{const [x,y]=proj(p[0],p[1],c[0],c[1]);return {x,z:-y};});
  if(pts.length>2){const a=pts[0],b=pts[pts.length-1];if(Math.abs(a.x-b.x)<1e-6&&Math.abs(a.z-b.z)<1e-6)pts.pop();}
  return {pts,c};
}
// Retiro hacia adentro por bisectriz (tomado del estudio de masas de app.lifecity.com.co)
export function offsetPolygon(pts,dist){
  if(dist<=0)return pts.slice();const n=pts.length;if(n<3)return pts.slice();
  function build(sign,dd){const out=[];
    for(let i=0;i<n;i++){const prev=pts[(i-1+n)%n],cur=pts[i],next=pts[(i+1)%n];
      let e1={x:cur.x-prev.x,z:cur.z-prev.z},e2={x:next.x-cur.x,z:next.z-cur.z};
      const l1=Math.hypot(e1.x,e1.z)||1,l2=Math.hypot(e2.x,e2.z)||1;e1={x:e1.x/l1,z:e1.z/l1};e2={x:e2.x/l2,z:e2.z/l2};
      const n1={x:e1.z,z:-e1.x},n2={x:e2.z,z:-e2.x};let bx=n1.x+n2.x,bz=n1.z+n2.z;const bl=Math.hypot(bx,bz);
      if(bl<1e-6){out.push({x:cur.x+sign*n1.x*dd,z:cur.z+sign*n1.z*dd});continue;}
      bx/=bl;bz/=bl;const cosHalf=Math.max(.35,bx*n1.x+bz*n1.z);const d=sign*dd/cosHalf;out.push({x:cur.x+bx*d,z:cur.z+bz*d});}
    return out;}
  const a0=shoelace(pts);
  function tryDist(dd){const c=[build(1,dd),build(-1,dd)].map(p=>({p,a:shoelace(p),ok:signedArea(p)*signedArea(pts)>0}))
    .filter(c=>c.ok&&c.a>a0*.04&&c.a<a0*.999);if(!c.length)return null;c.sort((x,y)=>y.a-x.a);return c[0].p;}
  for(let dd=dist;dd>.05;dd-=Math.max(.1,dist*.08)){const r=tryDist(dd);if(r)return r;}
  return pts.slice();
}

/* ===================== Catastro (WFS) ===================== */
let lastFeats=[],lastKey='';
async function fetchLots(lat,lon,city){
  const key=city.id+':'+lat.toFixed(4)+','+lon.toFixed(4);
  if(lastKey===key&&lastFeats.length)return lastFeats;
  lastFeats=await city.lots(lat,lon);lastKey=key;return lastFeats;
}
function predioFrom(f){
  const p=f.properties||{};const fp=footprintOf(f.geometry);
  return {ciudad:CITY.id,npn:p.npn||'',direccion:p.direpred||'',barrio:p.nom_barrio||'',comuna:p.comuna?String(p.comuna):'',
    manzana:p.manzana||'',terreno:p.terreno||'',destinacion:p.destinacio||'',
    area:Math.round(p.shape_area?+p.shape_area:shoelace(fp.pts)),
    // Firestore no acepta arreglos anidados: la geometría GeoJSON va como texto.
    geom:JSON.stringify(f.geometry)};
}
const geomOf=predio=>{try{return JSON.parse(predio.geom);}catch(e){return null;}};

/* ===================== UI: sección en el detalle ===================== */
const CSS=`
.cali-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px}
.cali-box .t{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:8px;margin-bottom:6px}
.cali-box .kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12.5px;margin:6px 0 10px}
.cali-box .kv .k{color:var(--muted)}.cali-box .kv .npn{font-family:ui-monospace,Consolas,monospace;letter-spacing:.3px}
.cali-box .acts{display:flex;gap:8px;flex-wrap:wrap}.cali-box .acts .btn{flex:1;min-width:140px}
.cali-pro{font-size:10px;background:var(--warn);color:#3a2c05;border-radius:20px;padding:1px 7px;font-weight:700;margin-left:4px}
#caliMap{height:50vh;min-height:280px;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#0a0f15}
.cali-sel{margin-top:10px;background:var(--panel2);border:1px solid var(--accent);border-radius:12px;padding:12px;font-size:13px}
.mz-view{position:relative;height:46vh;min-height:280px;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#05080d}
.mz-view canvas{width:100%;height:100%;display:block;touch-action:none}
.mz-hud{position:absolute;top:8px;left:10px;font-size:11px;color:var(--muted);line-height:1.5;pointer-events:none}
.mz-hud b{color:var(--text);margin-left:4px}
.mz-pot{font-size:12.5px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 11px;margin:10px 0;line-height:1.5}
.mz-pot b{color:var(--warn)}
.mz-meter{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px 11px;margin-bottom:12px}
.mz-meter .lbls{display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px}
.mz-meter .bar{height:10px;border-radius:5px;background:var(--bg);overflow:hidden}
.mz-meter .bar span{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.mz-meter .bar span.over{background:var(--danger)}
.mz-ctl{margin-bottom:8px}.mz-ctl label{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted);margin-bottom:3px}
.mz-ctl label span{color:var(--text);font-weight:700}.mz-ctl input[type=range]{width:100%;accent-color:var(--accent)}
.mz-toggle{display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0 10px;color:var(--muted)}
.mz-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
.mz-stats .st{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:8px 6px;text-align:center}
.mz-stats .st b{display:block;font-size:15px}.mz-stats .st span{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.mz-card{background:var(--panel2);border:1px solid var(--border);border-left:4px solid var(--c,#a06bff);border-radius:10px;padding:9px 11px;margin-bottom:8px;cursor:pointer;font-size:12.5px;position:relative}
.mz-card.sel{border-color:var(--accent);background:#1f3244}.mz-card b{color:var(--text)}.mz-card .m{color:var(--muted);margin-top:2px}
.mz-card .del{position:absolute;right:8px;top:6px;color:var(--muted);font-size:14px;padding:2px 6px}
`;
const SECTION=`
<div class="cali-box hidden" id="caliBox">
  <div class="t">🏛️ Catastro de <span id="caliCity"></span> <span class="hint" style="margin:0" id="caliSrc"></span></div>
  <div id="caliInfo"></div>
  <div class="acts" id="caliActs"></div>
</div>`;
const CAT_MODAL=`
<div id="caliModal" class="modal hidden"><div class="sheet">
  <div class="hd"><h2>🗺️ Lotes del catastro</h2><button class="iconbtn" id="caliClose">✕</button></div>
  <div class="bd">
    <div id="caliMap"></div>
    <div class="hint" id="caliHint" style="margin-top:8px">Toca el lote que corresponde a la foto.</div>
    <div class="cali-sel hidden" id="caliSel"></div>
    <button class="btn primary" id="caliUse" style="width:100%;margin-top:10px" disabled>✅ Usar este lote</button>
  </div>
</div></div>`;
const MZ_MODAL=`
<div id="mzModal" class="modal hidden"><div class="sheet" style="max-width:720px">
  <div class="hd"><h2>🏙️ Masa normativa · <span id="mzCity"></span></h2><button class="iconbtn" id="mzClose">✕</button></div>
  <div class="bd">
    <div class="mz-view"><canvas id="mzCanvas"></canvas>
      <div class="mz-hud"><div><span id="mzCodLbl">NPN</span><b id="mzNpn">—</b></div><div>LOTE<b id="mzArea">—</b></div></div></div>
    <div class="mz-pot" id="mzPot"></div>
    <div class="row" style="margin-bottom:6px"><div class="field" style="margin:0"><label for="mzIc">Índice de construcción máx.</label><input id="mzIc" inputmode="decimal" placeholder="Ej: 2,4"></div>
      <div class="field" style="margin:0"><label for="mzPisosMax">Pisos máximos</label><input id="mzPisosMax" inputmode="numeric" placeholder="Ej: 8"></div></div>
    <div class="hint" style="margin:0 0 12px">Se llenan solos con la norma de la ciudad. Cámbialos si tu ficha normativa dice otra cosa.</div>
    <div class="mz-meter"><div class="lbls"><span>Área construida</span><span id="mzMtrTxt">0 / — m²</span></div>
      <div class="bar"><span id="mzMtrBar"></span></div><div class="hint" id="mzMtrNote"></div></div>
    <div class="mz-ctl"><label>Pisos <span id="mzvFloors">5</span></label><input type="range" id="mzFloors" min="1" max="40" value="5"></div>
    <div class="mz-ctl"><label>Altura de piso (m) <span id="mzvFh">3.0</span></label><input type="range" id="mzFh" min="2.4" max="6" step="0.1" value="3"></div>
    <div class="mz-ctl"><label>Retiro / aislamiento (m) <span id="mzvOff">3</span></label><input type="range" id="mzOff" min="0" max="15" step="0.5" value="3"></div>
    <label class="mz-toggle"><input type="checkbox" id="mzStack"> Apilar sobre la masa superior (podio + torre)</label>
    <button class="btn primary" id="mzAdd" style="width:100%">＋ Crear masa</button>
    <div class="hint">Cada masa extruye la huella real del lote con el retiro elegido. Toca una masa de la lista para ajustarla con estos mismos controles.</div>
    <div class="mz-stats">
      <div class="st"><b id="mzCount">0</b><span>Masas</span></div><div class="st"><b id="mzH">0 m</b><span>Altura</span></div>
      <div class="st"><b id="mzBuilt">0</b><span>m² constr.</span></div><div class="st"><b id="mzIdx">0.00</b><span>Índice</span></div></div>
    <div id="mzList"></div>
    <div class="row" style="margin-top:6px"><button class="btn sm" id="mzTop">⊥ Planta</button><button class="btn sm" id="mzIso">◇ Isométrica</button></div>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="mzSave" style="flex:1.4">💾 Guardar en el lote</button><button class="btn" id="mzSheet">📄 Lámina</button><button class="btn" id="mzDxf">📐 DXF</button></div>
    <div class="hint" style="margin-top:8px">La lámina trae isométrica, planta, alzado y el cuadro de masas listo para imprimir o guardar en PDF. El DXF incluye las huellas de las masas sobre el plano del lote.</div>
  </div>
</div></div>`;

export function init(bridge){
  LX=bridge;
  const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
  $('dAnalyze').insertAdjacentHTML('beforebegin',SECTION);
  document.body.insertAdjacentHTML('beforeend',CAT_MODAL+MZ_MODAL);
  $('caliClose').onclick=()=>$('caliModal').classList.add('hidden');
  $('caliUse').onclick=usePending;
  $('mzClose').onclick=()=>$('mzModal').classList.add('hidden');
  bindMasas();
}

export function onDetail(lot){
  const box=$('caliBox');
  const city=cityOf(lot);
  if(!lot||!city){box.classList.add('hidden');return;}
  $('caliCity').textContent=city.name;$('caliSrc').textContent='· '+city.norma;
  box.classList.remove('hidden');
  const p=lot.predio;
  if(!p){
    $('caliInfo').innerHTML='<div class="hint" style="margin:0 0 10px">Esta foto está en '+city.name+'. Busca el lote en el catastro para obtener su '+city.codigo.toLowerCase()+', el plano CAD con medidas reales y la masa normativa.</div>';
    $('caliActs').innerHTML='<button class="btn" id="caliFind">🗺️ Buscar el lote en el catastro</button>';
  }else{
    $('caliInfo').innerHTML=`<div class="kv">
      <span class="k">${city.codigo}</span><span class="npn">${esc(p.npn)||'—'}</span>
      ${p.direccion?`<span class="k">Dirección</span><span>${esc(p.direccion)}</span>`:''}
      ${p.barrio?`<span class="k">Barrio</span><span>${esc(p.barrio)}${p.comuna?' · Comuna '+esc(p.comuna):''}</span>`:`<span class="k">Manzana</span><span>${esc(p.manzana)||'—'}</span>`}
      <span class="k">Área</span><span>${fmt(p.area||0)} m² · ${lot.masas&&lot.masas.length?lot.masas.length+' masa(s) guardada(s)':'sin masa'}</span></div>`;
    $('caliActs').innerHTML=`<button class="btn" id="caliDxf">📐 Descargar plano CAD</button>
      <button class="btn primary" id="caliMasas">🏙️ Crear masa normativa${LX.isPro()?'':'<span class="cali-pro">PRO</span>'}</button>
      <button class="btn sm ghost" id="caliFind" style="flex-basis:100%">↻ Cambiar de lote</button>`;
    $('caliDxf').onclick=()=>downloadDXF(lot);
    $('caliMasas').onclick=()=>openMasas(lot);
  }
  $('caliFind').onclick=()=>openCatastro(lot);
}

/* ===================== Modal catastro ===================== */
let cmap,cWfs,cWms=null,cMarker,cSelLayer,pending=null;
async function openCatastro(lot){
  CITY=cityAt(lot.coords)||cityOf(lot);
  if(!CITY){LX.toast('Esta ubicación no está en una ciudad con catastro disponible');return;}
  pending=null;$('caliSel').classList.add('hidden');$('caliUse').disabled=true;
  $('caliModal').classList.remove('hidden');
  const {lat,lon}=lot.coords;
  if(!cmap){
    cmap=L.map('caliMap',{zoomControl:true}).setView([lat,lon],18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'}).addTo(cmap);
    cMarker=L.layerGroup().addTo(cmap);cWfs=L.layerGroup().addTo(cmap);cSelLayer=L.layerGroup().addTo(cmap);
  }
  cMarker.clearLayers();cWfs.clearLayers();cSelLayer.clearLayers();
  // Capa de contexto (imagen de todos los lotes): solo las ciudades que la publican
  if(cWms){cmap.removeLayer(cWms);cWms=null;}
  if(CITY.wms)cWms=L.tileLayer.wms(CITY.wms.url,{layers:CITY.wms.layers,format:'image/png',transparent:true,version:'1.1.0',opacity:.5}).addTo(cmap);
  L.marker([lat,lon]).addTo(cMarker).bindTooltip('📷 Tu foto',{permanent:true,direction:'top'});
  cmap.setView([lat,lon],18);setTimeout(()=>cmap.invalidateSize(),150);
  $('caliHint').innerHTML='<span class="spin"></span> Buscando lotes del catastro…';
  try{
    const feats=await fetchLots(lat,lon,CITY);
    L.geoJSON({type:'FeatureCollection',features:feats},{style:{color:'#3aa0ff',weight:1,fillColor:'#3aa0ff',fillOpacity:.07},
      onEachFeature:(f,layer)=>{layer.on('click',()=>pick(f));}}).addTo(cWfs);
    $('caliHint').textContent=`${feats.length} lotes en la zona. Toca el que corresponde a la foto.`;
    // Preselecciona el lote que contiene la foto, si existe
    const hit=feats.find(f=>pointInGeom(lon,lat,f.geometry));if(hit)pick(hit);
    if(lot.predio&&!hit){const same=feats.find(f=>(f.properties||{}).npn===lot.predio.npn);if(same)pick(same);}
  }catch(e){console.warn(e);$('caliHint').innerHTML='⚠️ No se pudieron cargar los lotes de '+CITY.name+' (servidor de la Alcaldía ocupado). <a href="#" id="caliRetry">Reintentar</a>';
    $('caliRetry').onclick=ev=>{ev.preventDefault();lastKey='';openCatastro(lot);};}
}
function pointInGeom(x,y,geom){
  return ringsOf(geom).some(r=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;}return inside;});
}
function pick(f){
  pending=f;const p=predioFrom(f);
  cSelLayer.clearLayers();L.geoJSON({type:'Feature',geometry:f.geometry},{style:{color:'#2f9e6e',weight:3,fillColor:'#2f9e6e',fillOpacity:.35}}).addTo(cSelLayer);
  $('caliSel').classList.remove('hidden');
  const det=[p.barrio?p.barrio+(p.comuna?' · Comuna '+p.comuna:''):(p.manzana?'Manzana '+p.manzana:''),fmt(p.area)+' m²',p.destinacion].filter(Boolean).map(esc).join(' · ');
  $('caliSel').innerHTML=`<b>${esc(CITY.codigo)} ${esc(p.npn)||'—'}</b><br>${p.direccion?esc(p.direccion)+'<br>':''}<span class="hint" style="margin:0">${det}</span>`;
  $('caliUse').disabled=false;
}
async function usePending(){
  if(!pending)return;const predio=predioFrom(pending);
  $('caliUse').disabled=true;$('caliUse').innerHTML='<span class="spin"></span>';
  try{await LX.patchCurrent({predio});$('caliModal').classList.add('hidden');LX.toast('Lote del catastro guardado ✓');onDetail(LX.current);}
  catch(e){console.error(e);LX.toast('No se pudo guardar el lote.');}
  finally{$('caliUse').disabled=false;$('caliUse').textContent='✅ Usar este lote';}
}

/* ===================== Plano CAD (DXF R12) ===================== */
export function buildDXF(lot,feats){
  const sel=lot.predio,geom=geomOf(sel);if(!geom)return null;
  const o=centroid(geom),lon0=o[0],lat0=o[1];
  if(!feats.length)feats=[{properties:{npn:sel.npn,terreno:sel.terreno},geometry:geom}];
  const n=v=>v.toFixed(3);
  const ascii=s=>(''+s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\x20-\x7E]/g,'');
  const poly=(pts,layer)=>{if(pts.length<2)return '';let s=`0\nPOLYLINE\n8\n${layer}\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n1\n`;
    pts.forEach(([x,y])=>{s+=`0\nVERTEX\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0.0\n`;});return s+`0\nSEQEND\n8\n${layer}\n`;};
  const txt=(x,y,h,str,layer)=>`0\nTEXT\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0.0\n40\n${h}\n1\n${ascii(str)}\n`;
  const ringM=r=>{let q=r.slice();if(q.length>1&&q[0][0]===q[q.length-1][0]&&q[0][1]===q[q.length-1][1])q=q.slice(0,-1);return q.map(p=>proj(p[0],p[1],lon0,lat0));};
  let ents='';
  feats.forEach(f=>{const npn=(f.properties||{}).npn;const isSel=npn&&sel.npn&&npn===sel.npn;const layer=isSel?'LOTE_SELECCIONADO':'LOTES';
    ringsOf(f.geometry).forEach(r=>{ents+=poly(ringM(r),layer);});
    const t=(f.properties||{}).terreno;if(t&&!isSel){const c=centroid(f.geometry);const [x,y]=proj(c[0],c[1],lon0,lat0);ents+=txt(x,y,1.4,String(parseInt(t,10)||t),'TEXTO');}});
  // Medidas reales del lote seleccionado
  const ring=ringM(biggestRing(ringsOf(geom)));let area=0,perim=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];const len=Math.hypot(b[0]-a[0],b[1]-a[1]);perim+=len;
    if(len>=1.2)ents+=txt((a[0]+b[0])/2,(a[1]+b[1])/2,1.5,len.toFixed(2)+' m','COTAS');}
  area=Math.abs(area)/2;
  ents+=txt(0,0,4,'LOTE SELECCIONADO','LOTE_SELECCIONADO')+txt(0,-6,2.4,cityOf(lot).codigo+' '+(sel.npn||'s/d'),'LOTE_SELECCIONADO');
  if(sel.direccion)ents+=txt(0,-11,2.4,sel.direccion,'LOTE_SELECCIONADO');
  ents+=txt(0,-16,2.2,'Area '+area.toFixed(1)+' m2  Perim '+perim.toFixed(1)+' m','LOTE_SELECCIONADO');
  if(lot.coords){const [x,y]=proj(lot.coords.lon,lot.coords.lat,lon0,lat0);ents+=`0\nCIRCLE\n8\nTEXTO\n10\n${n(x)}\n20\n${n(y)}\n30\n0.0\n40\n2.5\n`;}
  // Huellas de las masas guardadas (misma proyección: x este, y norte = -z)
  const fp=footprintOf(geom).pts;
  (lot.masas||[]).forEach((m,i)=>{const pts=offsetPolygon(fp,+m.offset||0).map(p=>[p.x,-p.z]);ents+=poly(pts,'MASAS');
    const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    ents+=txt(cx,cy+2+i*3,1.6,`Masa ${i+1}: ${m.floors} pisos x ${(+m.floorH).toFixed(1)} m = ${(m.floors*m.floorH).toFixed(1)} m`,'MASAS');});
  const layers=[['LOTES',5],['LOTE_SELECCIONADO',1],['COTAS',2],['TEXTO',7],['MASAS',6]];
  const tables=`0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n`+
    `0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`+layers.map(([nm,c])=>`0\nLAYER\n2\n${nm}\n70\n0\n62\n${c}\n6\nCONTINUOUS\n`).join('')+`0\nENDTAB\n0\nENDSEC\n`;
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n${tables}0\nSECTION\n2\nENTITIES\n${ents}0\nENDSEC\n0\nEOF\n`;
}
async function downloadDXF(lot){
  if(!lot||!lot.predio)return;
  LX.toast('Preparando el plano…');
  const geom=geomOf(lot.predio),c=centroid(geom);let feats=[];
  try{feats=await fetchLots(c[1],c[0],cityOf(lot));}catch(e){console.warn('sin vecinos',e);}
  const dxf=buildDXF(lot,feats);if(!dxf){LX.toast('El lote no tiene geometría');return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([dxf],{type:'application/dxf'}));
  const filename='plano_lote_'+(lot.predio.npn||'cali').replace(/[^\w-]/g,'')+'.dxf';
  a.download=filename;a.click();
  // Copia automática al correo de la cuenta (si el backend de correo está configurado)
  const to=LX.email(),url=LX.reportEndpoint();
  if(!to||!url){LX.toast('Plano CAD descargado (.dxf, abre en AutoCAD)');return;}
  const p=lot.predio;
  const payload={email:to,filename,mimeType:'application/dxf',docBase64:btoa(unescape(encodeURIComponent(dxf))),
    subject:'Plano CAD del lote '+(p.npn||'')+(p.direccion?' - '+p.direccion:''),
    body:'Hola,\n\nAdjunto el plano CAD (.dxf) de la zona, con el lote resaltado, a escala real en metros, con las medidas de cada lado y el area.\n\n'+
      'Ciudad: '+cityOf(lot).name+'\n'+cityOf(lot).codigo+': '+(p.npn||'s/d')+(p.direccion?'\nDireccion: '+p.direccion:'')+(p.barrio?'\nBarrio: '+p.barrio:'')+'\nArea: '+(p.area||'s/d')+' m2\n\n'+
      'El .dxf se abre con AutoCAD, QGIS o LibreCAD. Gmail no lo previsualiza: descargalo y abrelo con un programa CAD.\n\n- Enviado desde LandX · landx.lifecity.com.co'};
  LX.toast('Plano descargado. Enviando copia a '+to+'…');
  try{await fetch(url,{method:'POST',body:JSON.stringify(payload)});LX.toast('Plano descargado y enviado a '+to+' ✓');}
  catch(e){try{await fetch(url,{method:'POST',mode:'no-cors',body:JSON.stringify(payload)});LX.toast('Plano descargado y enviado a '+to+' ✓');}
    catch(e2){LX.toast('Plano descargado. No se pudo enviar el correo.');}}
}

/* ===================== Masa normativa 3D (Pro) ===================== */
let THREE,OrbitControls,renderer,scene,camera,controls,gLot,gMasses,mounted=false;
let LOT=null; // {lot, city, pts, area, norm, ic, maxBuild, maxFloors}
let masses=[],sel=null,uidn=1;
const PALETTE=[0xa06bff,0x4dd0e1,0xf4b942,0x6bd96b,0xff8f6b,0xff5b9c];

async function openMasas(lot){
  if(!LX.isPro()){LX.showUpgrade('La masa normativa 3D sobre el lote del catastro es una función Pro.');return;}
  const geom=geomOf(lot.predio);if(!geom){LX.toast('El lote no tiene geometría');return;}
  $('mzModal').classList.remove('hidden');
  try{await mount();}catch(e){console.error(e);LX.toast('No se pudo cargar el visor 3D (revisa tu conexión).');return;}
  const fp=footprintOf(geom);
  const city=cityOf(lot);
  LOT={lot,city,pts:fp.pts,c:fp.c,area:lot.predio.area||Math.round(shoelace(fp.pts)),norm:null,ic:0,maxBuild:0,maxFloors:null};
  $('mzCity').textContent=city.name;$('mzCodLbl').textContent=city.codigo.toUpperCase();$('mzIc').value='';$('mzPisosMax').value='';
  $('mzNpn').textContent=lot.predio.npn||'—';$('mzArea').textContent=fmt(LOT.area)+' m²';
  masses=[];sel=null;uidn=1;gMasses.clear();
  (lot.masas||[]).forEach(m=>{masses.push({id:uidn++,floors:+m.floors||3,floorH:+m.floorH||3,offset:+m.offset||0,baseZ:+m.baseZ||0,color:PALETTE[(uidn-2)%PALETTE.length]});});
  sel=masses[masses.length-1]||null;
  drawLot();rebuildAll();refresh();viewIso();resize();
  // Norma de la ciudad en el punto. Lo que el usuario haya digitado y guardado tiene prioridad.
  $('mzPot').innerHTML='<span class="spin"></span> Consultando la norma de '+esc(city.name)+'…';
  try{
    const n=await city.norm(fp.c[0],fp.c[1],LOT.area);if(!LOT||LOT.lot!==lot)return;
    LOT.norm=n;$('mzPot').innerHTML=n.html;
    if(n.maxBuild)$('mzIc').value=(n.maxBuild/LOT.area).toFixed(2).replace('.',',');
    if(n.maxFloors){$('mzPisosMax').value=n.maxFloors;
      if(!masses.length){$('mzFloors').value=Math.min(n.maxFloors,40);syncLabels();}}
  }catch(e){console.warn(e);$('mzPot').textContent='No se pudo consultar la norma de '+city.name+' ahora. Digita abajo los valores de tu ficha normativa y sigue modelando.';}
  const g=lot.norma||{};if(g.ic)$('mzIc').value=String(g.ic).replace('.',',');if(g.pisos)$('mzPisosMax').value=g.pisos;
  readNorm();
}
// Pasa a LOT lo que dicen los campos de norma (llenados por la ciudad o por el usuario)
function readNorm(){
  if(!LOT)return;
  const ic=parseFloat(String($('mzIc').value).replace(',','.'))||0,p=parseInt($('mzPisosMax').value)||0;
  LOT.ic=ic;LOT.maxBuild=ic>0?ic*LOT.area:0;LOT.maxFloors=p>0?p:null;refresh();
}
async function mount(){
  if(mounted)return;
  THREE=await import('three');({OrbitControls}=await import('three/addons/controls/OrbitControls.js'));
  const canvas=$('mzCanvas');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x05080d,1);
  scene=new THREE.Scene();scene.fog=new THREE.Fog(0x05080d,500,2600);
  camera=new THREE.PerspectiveCamera(45,1,.5,20000);camera.position.set(120,110,120);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.495;controls.minDistance=8;controls.maxDistance=2500;
  scene.add(new THREE.AmbientLight(0x4a5878,.8));
  const sun=new THREE.DirectionalLight(0xffd9a0,1.15);sun.position.set(120,220,90);scene.add(sun);
  const fill=new THREE.DirectionalLight(0x6080ff,.35);fill.position.set(-120,90,-140);scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.MeshStandardMaterial({color:0x0d1218,roughness:.95}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.2;scene.add(ground);
  scene.add(new THREE.GridHelper(1000,100,0x1a2230,0x11161e));
  gLot=new THREE.Group();scene.add(gLot);gMasses=new THREE.Group();scene.add(gMasses);
  (function loop(){requestAnimationFrame(loop);if($('mzModal').classList.contains('hidden'))return;resize();controls.update();renderer.render(scene,camera);})();
  mounted=true;
}
function resize(){const c=$('mzCanvas'),w=c.clientWidth,h=c.clientHeight;if(w&&h&&(c.width!==w*renderer.getPixelRatio()||c.height!==h*renderer.getPixelRatio())){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}}
function toShape(pts){const s=new THREE.Shape();s.moveTo(pts[0].x,-pts[0].z);for(let i=1;i<pts.length;i++)s.lineTo(pts[i].x,-pts[i].z);return s;}
function drawLot(){
  gLot.clear();if(LOT.pts.length<3)return;
  const geo=new THREE.ShapeGeometry(toShape(LOT.pts));geo.rotateX(-Math.PI/2);
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x3a6ea5,transparent:true,opacity:.35,side:THREE.DoubleSide,roughness:.9}));mesh.position.y=.05;gLot.add(mesh);
  const pts=LOT.pts.map(p=>new THREE.Vector3(p.x,.15,p.z));pts.push(pts[0].clone());
  gLot.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x6fb3ff})));
}
function buildMass(m){
  if(m.group){gMasses.remove(m.group);m.group.traverse(o=>{o.geometry&&o.geometry.dispose&&o.geometry.dispose();});}
  const g=new THREE.Group();const pts=offsetPolygon(LOT.pts,m.offset);m.fArea=shoelace(pts);
  const h=m.floors*m.floorH;const geo=new THREE.ExtrudeGeometry(toShape(pts),{depth:h,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,m.baseZ,0);
  const on=sel===m;
  g.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:m.color,transparent:true,opacity:on?.8:.62,roughness:.5,metalness:.15,emissive:on?m.color:0,emissiveIntensity:on?.15:0})));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:on?0xffffff:m.color,transparent:true,opacity:on?.9:.5})));
  const ring=pts.map(p=>new THREE.Vector3(p.x,0,p.z));ring.push(ring[0].clone());
  for(let f=1;f<m.floors;f++){const y=m.baseZ+f*m.floorH;g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(p=>new THREE.Vector3(p.x,y,p.z))),new THREE.LineBasicMaterial({color:m.color,transparent:true,opacity:.25})));}
  gMasses.add(g);m.group=g;
}
const topOfStack=()=>masses.reduce((t,m)=>Math.max(t,m.baseZ+m.floors*m.floorH),0);
const totalBuilt=()=>masses.reduce((a,m)=>a+m.fArea*m.floors,0);
const totalFloors=()=>masses.reduce((a,m)=>a+m.floors,0);
function rebuildAll(){masses.forEach(buildMass);}
function addMass(){
  if(!LOT||LOT.pts.length<3)return;
  const m={id:uidn++,floors:+$('mzFloors').value,floorH:+$('mzFh').value,offset:+$('mzOff').value,baseZ:$('mzStack').checked?topOfStack():0,color:PALETTE[(uidn-2)%PALETTE.length]};
  masses.push(m);sel=m;rebuildAll();refresh();
}
function selectMass(m){sel=m;$('mzFloors').value=m.floors;$('mzFh').value=m.floorH;$('mzOff').value=m.offset;syncLabels();rebuildAll();refresh();}
function deleteMass(id){const m=masses.find(x=>x.id===id);if(m&&m.group)gMasses.remove(m.group);masses=masses.filter(x=>x.id!==id);if(sel&&sel.id===id)sel=masses[masses.length-1]||null;rebuildAll();refresh();}
function syncLabels(){$('mzvFloors').textContent=$('mzFloors').value;$('mzvFh').textContent=(+$('mzFh').value).toFixed(1);$('mzvOff').textContent=$('mzOff').value;}
function refresh(){
  if(!LOT)return;
  const built=Math.round(totalBuilt()),h=topOfStack();
  $('mzCount').textContent=masses.length;$('mzH').textContent=h.toFixed(1)+' m';$('mzBuilt').textContent=fmt(built);$('mzIdx').textContent=(LOT.area?built/LOT.area:0).toFixed(2);
  const max=Math.round(LOT.maxBuild),bar=$('mzMtrBar'),mf=LOT.maxFloors;
  // La altura se mide en la masa más alta: dos masas lado a lado no suman pisos
  const pisos=masses.length?Math.max(...masses.map(m=>Math.round(m.baseZ/m.floorH)+m.floors)):0;
  const notas=[];
  if(max){$('mzMtrTxt').textContent=`${fmt(built)} / ${fmt(max)} m²`;bar.style.width=Math.min(100,built/max*100)+'%';
    notas.push(built>max?`⚠ Excede el índice en ${fmt(built-max)} m²`:`✓ Dentro del índice · disponible ${fmt(max-built)} m²`);}
  else if(mf){$('mzMtrTxt').textContent=`${pisos} / ${mf} pisos`;bar.style.width=Math.min(100,pisos/mf*100)+'%';}
  else{$('mzMtrTxt').textContent=`${fmt(built)} m² · sin máximo de norma`;bar.style.width='0%';}
  if(mf)notas.push(pisos>mf?`⚠ Excede la altura (${pisos} de ${mf} pisos)`:`✓ Dentro de la altura · quedan ${mf-pisos} piso(s)`);
  bar.classList.toggle('over',!!((max&&built>max)||(mf&&pisos>mf)));
  $('mzMtrNote').textContent=notas.join(' · ');
  const list=$('mzList');
  if(!masses.length){list.innerHTML='<div class="hint" style="margin:8px 0">Sin masas. Ajusta pisos, altura y retiro, y toca «Crear masa».</div>';return;}
  list.innerHTML=masses.map((m,i)=>`<div class="mz-card${sel===m?' sel':''}" data-id="${m.id}" style="--c:#${m.color.toString(16).padStart(6,'0')}"><span class="del" data-del="${m.id}">✕</span>
    <b>Masa ${i+1}</b> · ${m.floors} pisos × ${m.floorH.toFixed(1)} m = ${(m.floors*m.floorH).toFixed(1)} m${m.baseZ>0?' · sobre +'+m.baseZ.toFixed(1)+' m':''}
    <div class="m">Huella ${fmt(m.fArea)} m² · retiro ${m.offset} m · construidos ${fmt(m.fArea*m.floors)} m²</div></div>`).join('');
  list.querySelectorAll('.mz-card').forEach(c=>c.onclick=()=>selectMass(masses.find(m=>m.id==c.dataset.id)));
  list.querySelectorAll('[data-del]').forEach(d=>d.onclick=e=>{e.stopPropagation();deleteMass(+d.dataset.del);});
}
function viewIso(){const s=Math.max(60,Math.sqrt(LOT.area)*2.2,topOfStack()*1.6);camera.position.set(s,s,s);controls.target.set(0,topOfStack()/3,0);}
function viewTop(){const s=Math.max(60,Math.sqrt(LOT.area)*2.6);camera.position.set(0,s,.01);controls.target.set(0,0,0);}
const studyData=()=>masses.map(m=>({floors:m.floors,floorH:+m.floorH.toFixed(2),offset:m.offset,baseZ:+m.baseZ.toFixed(2)}));
async function saveStudy(){
  if(!LOT)return;const b=$('mzSave');b.disabled=true;
  const norma={ic:LOT.ic||0,pisos:LOT.maxFloors||0};
  try{await LX.patchCurrent({masas:studyData(),norma});LX.toast('Masa guardada en el lote ✓');onDetail(LX.current);}
  catch(e){console.error(e);LX.toast('No se pudo guardar.');}
  finally{b.disabled=false;}
}
function capture(setup){
  const p0=camera.position.clone(),t0=controls.target.clone();setup();camera.lookAt(controls.target);camera.updateProjectionMatrix();renderer.render(scene,camera);
  const url=$('mzCanvas').toDataURL('image/png');camera.position.copy(p0);controls.target.copy(t0);camera.lookAt(t0);return url;
}
function exportSheet(){
  const rad=Math.max(Math.sqrt(LOT.area)*1.1,20),H=Math.max(topOfStack(),10);
  const iso=capture(()=>{const d=rad*1.8+H*.6;camera.position.set(d,d*.85+H*.4,d);controls.target.set(0,H*.3,0);});
  const top=capture(()=>{camera.position.set(0,rad*3.2+H+40,.001);controls.target.set(0,0,0);});
  const front=capture(()=>{camera.position.set(0,H*.45,rad*2.6+H);controls.target.set(0,H*.45,0);});
  const p=LOT.lot.predio,built=Math.round(totalBuilt()),max=Math.round(LOT.maxBuild);
  const rows=masses.map((m,i)=>`<tr><td>${i+1}</td><td>${m.floors}</td><td>${m.floorH.toFixed(2)}</td><td>${(m.floors*m.floorH).toFixed(1)}</td><td>${m.offset}</td><td>${fmt(m.fArea)}</td><td>${fmt(m.fArea*m.floors)}</td></tr>`).join('')||'<tr><td colspan=7>Sin masas</td></tr>';
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Lámina · ${esc(p.npn)}</title><style>
    @page{size:A3 landscape;margin:8mm}*{box-sizing:border-box;margin:0;font-family:'Segoe UI',Arial,sans-serif}body{background:#e9edf2;color:#1a2230;padding:14px}
    .sheet{background:#fff;border:2px solid #1a2230;max-width:1600px;margin:auto}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1a2230;padding:12px 16px}
    .head h1{font-size:20px}.head .s{font-size:12px;color:#555}.head .r{text-align:right;font-size:11px}.brand{font-weight:800;color:#2f9e6e;font-size:22px}
    .grid{display:grid;grid-template-columns:2fr 1fr}.views{display:grid;grid-template-columns:1fr 1fr;border-right:2px solid #1a2230}
    .view{border:1px solid #cdd4de;position:relative;min-height:240px;display:flex;align-items:center;justify-content:center;background:#05080d}.view img{width:100%;height:100%;object-fit:contain}
    .lbl{position:absolute;top:6px;left:8px;background:#1a2230;color:#5ee0a0;font-size:11px;letter-spacing:1px;padding:3px 8px}
    .info{padding:12px 16px;font-size:12px}.info h2{font-size:12px;letter-spacing:1px;color:#2f9e6e;border-bottom:1px solid #ccc;padding-bottom:4px;margin:10px 0 8px;text-transform:uppercase}
    .kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px}.kv .k{color:#666}.kv .v{font-weight:600;text-align:right}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cdd4de;padding:3px 5px;text-align:center}th{background:#1a2230;color:#fff}
    .foot{border-top:2px solid #1a2230;display:flex;justify-content:space-between;padding:8px 16px;font-size:10px;color:#555}
    .noprint{position:fixed;top:10px;right:10px}.noprint button{background:#2f9e6e;color:#fff;border:0;padding:10px 16px;font-weight:700;cursor:pointer;border-radius:6px}@media print{.noprint{display:none}body{background:#fff;padding:0}}
  </style></head><body><div class="noprint"><button onclick="window.print()">Imprimir / Guardar PDF</button></div><div class="sheet">
  <div class="head"><div><h1>${esc((p.direccion||'ESTUDIO DE MASA').toUpperCase())}</h1><div class="s">${esc(p.barrio)||''}${p.comuna?' · Comuna '+esc(p.comuna):''} · ${esc(LOT.city.name)}</div></div>
    <div class="r"><div class="brand">LandX</div><div>${esc(LOT.city.codigo)} ${esc(p.npn)||'—'}</div><div>${new Date().toLocaleString('es-CO')}</div></div></div>
  <div class="grid"><div class="views">
    <div class="view"><span class="lbl">ISOMÉTRICA</span><img src="${iso}"></div><div class="view"><span class="lbl">PLANTA</span><img src="${top}"></div>
    <div class="view"><span class="lbl">ALZADO</span><img src="${front}"></div>
    <div class="view" style="background:#fff;padding:10px;align-items:flex-start"><div style="width:100%"><div class="lbl" style="position:static;display:inline-block;margin-bottom:8px">CUADRO DE MASAS</div>
      <table><tr><th>#</th><th>Pisos</th><th>h piso</th><th>Alt (m)</th><th>Retiro</th><th>Huella m²</th><th>Constr. m²</th></tr>${rows}</table></div></div></div>
   <div class="info"><h2>Predio</h2><div class="kv">${p.direccion?`<span class="k">Dirección</span><span class="v">${esc(p.direccion)}</span>`:''}${p.barrio?`<span class="k">Barrio</span><span class="v">${esc(p.barrio)}</span>`:''}<span class="k">Área lote</span><span class="v">${fmt(LOT.area)} m²</span></div>
    <h2>Normativa · ${esc(LOT.city.norma)}</h2><div class="kv">${LOT.norm&&LOT.norm.icb?`<span class="k">Norma</span><span class="v">${esc(LOT.norm.icb)}</span>`:''}
      <span class="k">Índice de construcción</span><span class="v">${LOT.ic?LOT.ic.toFixed(2).replace('.',','):'—'}</span><span class="k">Pisos máximos</span><span class="v">${LOT.maxFloors||'—'}</span>
      <span class="k">Edificabilidad máx.</span><span class="v">${max?fmt(max)+' m²':'—'}</span></div>
    <h2>Propuesta</h2><div class="kv"><span class="k">Masas</span><span class="v">${masses.length}</span><span class="k">Altura</span><span class="v">${topOfStack().toFixed(1)} m</span><span class="k">Área construida</span><span class="v">${fmt(built)} m²</span><span class="k">Índice logrado</span><span class="v">${(LOT.area?built/LOT.area:0).toFixed(2)}</span>
    <span class="k">vs. máximo de norma</span><span class="v" style="color:${max&&built>max?'#c00':'#2a7'}">${max?(built>max?'+'+fmt(built-max)+' m² (excede)':fmt(max-built)+' m² disponibles'):'—'}</span></div></div></div>
  <div class="foot"><span>LandX · landx.lifecity.com.co</span><span>${esc(LOT.city.fuente)} · Lámina generada automáticamente</span></div></div></body></html>`;
  const w=window.open('','_blank');if(!w){LX.toast('Permite ventanas emergentes para ver la lámina.');return;}
  w.document.write(html);w.document.close();
}
function bindMasas(){
  ['mzFloors','mzFh','mzOff'].forEach(id=>$(id).addEventListener('input',()=>{syncLabels();if(sel){sel.floors=+$('mzFloors').value;sel.floorH=+$('mzFh').value;sel.offset=+$('mzOff').value;rebuildAll();refresh();}}));
  ['mzIc','mzPisosMax'].forEach(id=>$(id).addEventListener('input',readNorm));
  $('mzAdd').onclick=addMass;$('mzTop').onclick=viewTop;$('mzIso').onclick=viewIso;$('mzSave').onclick=saveStudy;$('mzSheet').onclick=exportSheet;
  $('mzDxf').onclick=()=>{const lot=Object.assign({},LOT.lot,{masas:studyData()});downloadDXF(lot);};
}
