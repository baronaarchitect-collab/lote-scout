/* =========================================================================
   LandX · Módulo Inversión (dentro de la app)
   -------------------------------------------------------------------------
   1. Botón Airbnb → mapa con el predio al centro y los alojamientos de Airbnb
      alrededor + estudio de mercado. El sondeo lo carga un administrador de
      Life City; el usuario lo solicita desde aquí.
   2. Página de inversión del proyecto (pública, en /p/?id=…) y acceso al CRM.
   Todo es función Pro.
   ========================================================================= */
import {getStore,esc,cop,num,slugify,embedUrl,inversion} from '../lx-store.js';
import {renderEstudio,drawMap} from '../lx-airbnb.js';

let LX=null,S=null;
const $=id=>document.getElementById(id);
const SITE=location.origin+location.pathname.replace(/app\/(index\.html)?$/,'');
const reqPath=lot=>`airbnb/${S.user().uid}_${lot.id}`;

const CSS=`
.inv-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px}
.inv-box .t{font-weight:700;font-size:13.5px;margin-bottom:6px}
.inv-box .acts{display:flex;gap:8px;flex-wrap:wrap}.inv-box .acts .btn{flex:1;min-width:140px}
.inv-link{display:flex;gap:6px;margin:8px 0}.inv-link input{flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:8px;font-size:12.5px}
#abMap{height:44vh;min-height:280px;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#0a0f15;margin-bottom:12px}
.ab-tip{background:#fff;color:#111;border:0;border-radius:6px;font-weight:700;font-size:11px;padding:2px 6px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.ab-tip:before{display:none}.ab-tip-main{background:#0F6B4F;color:#fff}
.ab-kpis{display:grid;grid-template-columns:1.2fr 1.4fr 1fr;gap:8px;margin-bottom:10px}
.ab-kpi{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px}
.ab-kpi span{display:block;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.ab-kpi b{font-size:15px}.ab-kpi.ab-main{border-color:var(--accent)}.ab-kpi.ab-main b{color:#5ee0a0;font-size:18px}
.ab-note,.ab-text{font-size:12.5px;color:var(--muted);line-height:1.5;margin:6px 0}.ab-text{color:var(--text)}
.ab-h{font-size:13.5px;margin:16px 0 6px}.ab-sub{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:8px 0 5px}
.ab-scroll{overflow-x:auto}.ab-table{width:100%;border-collapse:collapse;font-size:12.5px}
.ab-table th,.ab-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:top}
.ab-table th{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}.ab-num{text-align:right!important;white-space:nowrap}
.ab-table small{color:var(--muted)}
.ab-chips{display:flex;flex-wrap:wrap;gap:6px}.ab-chip{font-size:12px;background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:3px 10px}
.ab-chip b{color:#5ee0a0;margin-left:3px}
.ab-state{text-align:center;padding:18px 10px}.ab-state .ic{font-size:34px}.ab-state h3{margin:8px 0 6px;font-size:16px}
.pj-fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin-bottom:8px}
.pj-foto{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border)}
.pj-foto img{width:100%;height:100%;object-fit:cover;display:block}
.pj-foto button{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.7);color:#fff;font-size:12px}
.pj-sum{background:var(--bg);border:1px solid var(--accent);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.7;margin-bottom:12px}
.pj-sum b{color:#5ee0a0}
.pj-h{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;border-top:1px solid var(--border);padding-top:12px}
`;
const BOX=`<div class="inv-box" id="invBox"><div class="t">🏠 Proyecto de inversión <span class="cali-pro" id="invPro">PRO</span></div>
  <div class="hint" id="invInfo" style="margin:0 0 10px"></div><div class="acts" id="invActs"></div></div>`;
const MODALS=`
<div id="abModal" class="modal hidden"><div class="sheet" style="max-width:720px">
  <div class="hd"><h2>Airbnb alrededor del predio</h2><button class="iconbtn" id="abClose">✕</button></div>
  <div class="bd"><div id="abMapWrap"></div><div id="abBody"></div></div></div></div>
<div id="pjModal" class="modal hidden"><div class="sheet" style="max-width:620px">
  <div class="hd"><h2>🏠 Página de inversión</h2><button class="iconbtn" id="pjClose">✕</button></div>
  <div class="bd">
    <div class="field"><label>Nombre del proyecto</label><input id="pjTitulo" maxlength="60" placeholder="Ej: Casa Los Cristales"></div>
    <div class="field"><label>Frase principal</label><input id="pjFrase" maxlength="120" placeholder="Ej: Cuatro apartaestudios y una piscina."></div>
    <div class="field"><label>Descripción</label><textarea id="pjDesc" maxlength="1200" style="min-height:96px" placeholder="Qué es el proyecto, qué se va a hacer con el inmueble y por qué es una buena oportunidad."></textarea></div>
    <div class="row"><div class="field"><label>Barrio / zona</label><input id="pjBarrio" maxlength="60"></div>
      <div class="field"><label>Unidades a alquilar</label><input id="pjUnidades" inputmode="numeric" placeholder="Ej: 4"></div></div>
    <div class="pj-h">Fotos y videos</div>
    <div class="pj-fotos" id="pjFotos"></div>
    <button class="btn sm" id="pjAddFoto">＋ Agregar fotos</button><input type="file" id="pjFile" accept="image/*" multiple class="hidden">
    <div class="field" style="margin-top:12px"><label>Videos (links de YouTube o Vimeo, uno por línea)</label><textarea id="pjVideos" placeholder="https://youtu.be/…"></textarea></div>
    <div class="pj-h">Inversión</div>
    <div class="row"><div class="field"><label>Valor de la casa / lote</label><input id="pjCompra" inputmode="numeric" placeholder="$"></div>
      <div class="field"><label>Remodelación</label><input id="pjObra" inputmode="numeric" placeholder="$"></div></div>
    <div class="row"><div class="field"><label>Dotación y puesta en marcha</label><input id="pjDot" inputmode="numeric" placeholder="$"></div>
      <div class="field"><label>N.º de participaciones</label><input id="pjPart" inputmode="numeric" placeholder="Ej: 10"></div></div>
    <div class="pj-sum" id="pjSum"></div>
    <div class="pj-h">Plan de pagos del inversionista</div>
    <div class="row"><div class="field"><label>Separación (por participación)</label><input id="pjSep" inputmode="numeric" placeholder="$"></div>
      <div class="field"><label>N.º de cuotas mensuales</label><input id="pjCuotas" inputmode="numeric" placeholder="Ej: 6"></div></div>
    <div class="row"><div class="field"><label>Fecha de la primera cuota</label><input id="pjInicio" type="date"></div>
      <div class="field"><label>Inicio de operación</label><input id="pjOper" maxlength="40" placeholder="Ej: Marzo de 2027"></div></div>
    <div class="field"><label>Tu link de pago de Wompi</label><input id="pjWompi" placeholder="https://checkout.wompi.co/l/…">
      <div class="hint">El dinero llega directo a tu cuenta de Wompi. LandX no recibe ni maneja pagos de tus inversionistas.</div></div>
    <div class="pj-h">Contacto</div>
    <div class="row"><div class="field"><label>Nombre o empresa</label><input id="pjContacto" maxlength="60"></div>
      <div class="field"><label>WhatsApp</label><input id="pjWa" inputmode="tel" placeholder="300 123 4567"></div></div>
    <div class="pj-h">Qué incluir</div>
    <div class="hint" id="pjIncl" style="line-height:1.9"></div>
    <label class="mz-toggle" style="margin-top:10px"><input type="checkbox" id="pjPub" checked> Página publicada (visible para quien tenga el link)</label>
    <button class="btn primary" id="pjSave" style="width:100%">Guardar y publicar</button>
    <div id="pjDone" class="hidden" style="margin-top:12px"></div>
  </div></div></div>`;

export async function init(bridge){
  LX=bridge;S=await getStore();
  const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
  $('dAnalyze').insertAdjacentHTML('beforebegin',BOX);
  document.body.insertAdjacentHTML('beforeend',MODALS);
  $('abClose').onclick=()=>$('abModal').classList.add('hidden');
  $('pjClose').onclick=()=>$('pjModal').classList.add('hidden');
  $('rAirbnb').onclick=()=>openAirbnb(LX.current);
  ['pjCompra','pjObra','pjDot','pjPart','pjSep','pjCuotas'].forEach(id=>$(id).addEventListener('input',renderSum));
  $('pjAddFoto').onclick=()=>$('pjFile').click();
  $('pjFile').onchange=async e=>{for(const f of [...e.target.files]){if(fotos.length>=12){LX.toast('Máximo 12 fotos');break;}
    const d=await LX.compressImage(f,1400,.7);if(d)fotos.push({id:null,src:d});}e.target.value='';renderFotos();};
  $('pjSave').onclick=saveProject;
}

export function onDetail(lot){
  $('invPro').classList.toggle('hidden',LX.isPro());
  if(lot.projectId){
    $('invInfo').textContent='Este lote ya tiene página de inversión y CRM.';
    $('invActs').innerHTML=`<a class="btn" href="${SITE}p/?id=${encodeURIComponent(lot.projectId)}" target="_blank">🌐 Ver página</a>
      <a class="btn primary" href="${SITE}crm/?id=${encodeURIComponent(lot.projectId)}" target="_blank">📋 CRM del proyecto</a>
      <button class="btn sm ghost" id="invEdit" style="flex-basis:100%">✏️ Editar página</button>`;
  }else{
    $('invInfo').textContent='Publica una página para presentar este inmueble a inversionistas: fotos, estudio de mercado Airbnb, valor por participación y un formulario que alimenta tu CRM.';
    $('invActs').innerHTML='<button class="btn primary" id="invEdit">🏠 Crear página de inversión</button>';
  }
  $('invEdit').onclick=()=>openProject(lot);
}

/* ===================== Airbnb ===================== */
let abMap=null;
function airbnbUrl(c){const d=.012;return `https://www.airbnb.com/s/homes?search_type=user_map_move&search_by_map=true&zoom=14&ne_lat=${(c.lat+d).toFixed(5)}&ne_lng=${(c.lon+d).toFixed(5)}&sw_lat=${(c.lat-d).toFixed(5)}&sw_lng=${(c.lon-d).toFixed(5)}`;}
async function openAirbnb(lot){
  if(!lot||!lot.coords||lot.coords.lat==null){LX.toast('Ubica el lote en el mapa primero');return;}
  if(!LX.isPro()){LX.showUpgrade('El mapa de Airbnb y el estudio de mercado de la zona son funciones Pro.');return;}
  $('abModal').classList.remove('hidden');
  if(abMap){abMap.remove();abMap=null;}
  $('abMapWrap').innerHTML='';$('abBody').innerHTML='<div class="ab-state"><span class="spin"></span></div>';
  let req=null;try{req=await S.get(reqPath(lot));}catch(e){console.warn(e);}
  const link=`<a class="btn sm" href="${airbnbUrl(lot.coords)}" target="_blank" rel="noopener">Abrir Airbnb en esta zona ↗</a>`;
  const warn=lot.coords.source==='city'?'<div class="hint" style="color:var(--warn);margin-bottom:10px">⚠️ Esta foto no traía GPS: el predio está en el centro de la ciudad. Ubícalo en el mapa antes de pedir el análisis.</div>':'';
  if(req&&req.status==='listo'){
    $('abMapWrap').innerHTML='<div id="abMap"></div>';
    abMap=drawMap($('abMap'),lot.coords,req.comps,'📷 Tu predio');
    $('abBody').innerHTML=warn+renderEstudio(req.comps,req.notas)+
      `<p class="ab-note" style="margin-top:14px">Sondeo realizado por Life City${req.doneAt?' el '+new Date(req.doneAt).toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'}):''}. Los precios de Airbnb cambian según la fecha: úsalo como referencia.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${link}<button class="btn sm ghost" id="abAgain">↻ Pedir actualización</button></div>`;
    $('abAgain').onclick=()=>requestStudy(lot,req);
  }else if(req&&req.status==='solicitado'){
    $('abBody').innerHTML=warn+`<div class="ab-state"><div class="ic">⏳</div><h3>Análisis en preparación</h3>
      <p class="ab-note">Lo solicitaste el ${new Date(req.createdAt).toLocaleDateString('es-CO',{day:'numeric',month:'long'})}. El equipo de Life City está levantando los anuncios de Airbnb alrededor del predio. Cuando esté listo aparecerá aquí, con el mapa.</p>${link}</div>`;
  }else{
    $('abBody').innerHTML=warn+`<div class="ab-state"><div class="ic">🏘️</div><h3>Estudio de mercado Airbnb</h3>
      <p class="ab-note">El equipo de Life City levanta los alojamientos de Airbnb alrededor de tu predio: precio por noche, calificación y amenidades. Recibes el mapa con el predio en el centro y el análisis de la competencia.</p>
      <button class="btn primary" id="abAsk" style="margin:6px 0 10px">Solicitar análisis Airbnb</button><br>${link}</div>`;
    $('abAsk').onclick=()=>requestStudy(lot,null);
  }
}
async function requestStudy(lot,prev){
  const u=S.user();
  try{
    await S.set(reqPath(lot),{uid:u.uid,email:(u.email||'').toLowerCase(),lotId:lot.id,dir:lot.dir||'',ciudad:LX.city(),
      coords:{lat:+lot.coords.lat,lon:+lot.coords.lon},npn:(lot.predio&&lot.predio.npn)||'',
      status:'solicitado',createdAt:S.now(),comps:prev?prev.comps||[]:[],notas:prev?prev.notas||'':''});
    LX.toast('Solicitud enviada ✓');openAirbnb(lot);
  }catch(e){console.error(e);LX.toast('No se pudo enviar la solicitud.');}
}

/* ===================== Página de inversión ===================== */
let fotos=[],borradas=[],editing=null,proj=null;
function renderFotos(){
  $('pjFotos').innerHTML=fotos.map((f,i)=>`<div class="pj-foto"><img src="${f.src}" alt=""><button data-i="${i}" title="Quitar">✕</button></div>`).join('');
  $('pjFotos').querySelectorAll('button').forEach(b=>b.onclick=()=>{const f=fotos.splice(+b.dataset.i,1)[0];if(f.id)borradas.push(f.id);renderFotos();});
}
function formInv(){return {compra:num($('pjCompra').value),remodelacion:num($('pjObra').value),dotacion:num($('pjDot').value),
  participaciones:Math.max(1,Math.round(num($('pjPart').value))||1),separacion:num($('pjSep').value),cuotas:Math.round(num($('pjCuotas').value)),inicio:$('pjInicio').value};}
function renderSum(){const v=inversion({inversion:formInv()});
  $('pjSum').innerHTML=v.total?`Inversión total <b>${cop(v.total)}</b> = compra ${cop(v.compra)} + remodelación ${cop(v.obra)} + dotación ${cop(v.dot)}<br>
    Valor por inversionista: <b>${cop(v.valor)}</b> por participación (${v.n} participaciones)`:'Escribe el valor de la casa y la remodelación para calcular el valor por inversionista.';}
async function openProject(lot){
  if(!LX.isPro()){LX.showUpgrade('La página de inversión y el CRM del proyecto son funciones Pro.');return;}
  editing=lot;proj=null;fotos=[];borradas=[];
  $('pjDone').classList.add('hidden');$('pjModal').classList.remove('hidden');
  if(lot.projectId){try{proj=await S.get('projects/'+lot.projectId);
    fotos=(await S.list(`projects/${lot.projectId}/fotos`)).sort((a,b)=>(a.orden||0)-(b.orden||0)).map(f=>({id:f.id,src:f.src}));}catch(e){console.warn(e);}}
  else if(lot.photoURL)fotos=[{id:null,src:lot.photoURL}];
  const p=proj||{},i=p.inversion||{},set=(id,v)=>$(id).value=v==null?'':v;
  set('pjTitulo',p.titulo||lot.dir||'');set('pjFrase',p.frase);set('pjDesc',p.descripcion);
  set('pjBarrio',p.barrio||(lot.predio&&lot.predio.barrio)||'');set('pjUnidades',p.unidades);
  set('pjVideos',(p.videos||[]).join('\n'));
  set('pjCompra',i.compra||num(lot.precio)||'');set('pjObra',i.remodelacion||'');set('pjDot',i.dotacion||'');set('pjPart',i.participaciones||'');
  set('pjSep',i.separacion||'');set('pjCuotas',i.cuotas||'');set('pjInicio',i.inicio);set('pjOper',p.operacion);
  set('pjWompi',p.wompi);set('pjContacto',p.contacto);set('pjWa',p.whatsapp);$('pjPub').checked=p.published!==false;
  renderFotos();renderSum();
  // Qué traerá la página, según lo que ya existe para este lote
  let req=null;try{req=await S.get(reqPath(lot));}catch(e){}
  const an=LX.lastAnalysis(),ok=v=>v?'✅':'⬜';
  const tieneAb=!!(req&&req.status==='listo'&&(req.comps||[]).length),tieneAn=!!(an&&an.lotId===lot.id),tieneMasa=!!(lot.predio&&(lot.masas||[]).length);
  $('pjIncl').innerHTML=`${ok(tieneAb)} Estudio de mercado Airbnb ${tieneAb?'':'<i>— pídelo con el botón Airbnb del lote</i>'}<br>
    ${ok(tieneAn||(p.entorno||[]).length)} Entorno a 5 km ${tieneAn||(p.entorno||[]).length?'':'<i>— ejecuta «Analizar zona» antes de publicar</i>'}<br>
    ${ok(tieneMasa)} Masa 3D del proyecto ${tieneMasa?'':'<i>— busca el lote en el catastro y guarda su masa normativa</i>'}`;
  editing._req=tieneAb?req:null;
}
async function saveProject(){
  const lot=editing,u=S.user(),titulo=$('pjTitulo').value.trim();
  if(!titulo){LX.toast('Ponle nombre al proyecto');return;}
  const wompi=$('pjWompi').value.trim();
  if(wompi&&!/^https:\/\/checkout\.wompi\.co\//.test(wompi)){LX.toast('El link de Wompi debe empezar por https://checkout.wompi.co/');return;}
  const videos=$('pjVideos').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const malo=videos.find(v=>!embedUrl(v));if(malo){LX.toast('Este link de video no es de YouTube ni Vimeo: '+malo.slice(0,40));return;}
  const b=$('pjSave');b.disabled=true;b.innerHTML='<span class="spin"></span>';
  try{
    const id=lot.projectId||(slugify(titulo)+'-'+Math.random().toString(36).slice(2,6));
    const inv=formInv(),an=LX.lastAnalysis(),req=lot._req,prev=proj||{};
    const entorno=(an&&an.lotId===lot.id)?{items:an.items.slice().sort((a,b)=>a.dist-b.dist).slice(0,60).map(i=>({name:i.name,key:i.key,cat:i.cat,icon:i.icon,dist:Math.round(i.dist)})),
      roads:an.roads.slice(0,4).map(r=>({name:r.name,type:r.type||'',dist:Math.round(r.dist)}))}:(prev.entornoData||null);
    const data={uid:u.uid,ownerEmail:(u.email||'').toLowerCase(),lotId:lot.id,published:$('pjPub').checked,
      titulo,frase:$('pjFrase').value.trim(),descripcion:$('pjDesc').value.trim(),barrio:$('pjBarrio').value.trim(),ciudad:LX.city(),
      unidades:Math.round(num($('pjUnidades').value))||0,coords:{lat:+lot.coords.lat,lon:+lot.coords.lon},
      videos,inversion:inv,disponibles:prev.disponibles!=null?Math.min(prev.disponibles,inv.participaciones):inv.participaciones,
      operacion:$('pjOper').value.trim(),wompi,contacto:$('pjContacto').value.trim(),whatsapp:$('pjWa').value.trim(),
      airbnb:req?{comps:req.comps,notas:req.notas||'',fecha:req.doneAt||null}:(prev.airbnb||null),
      entornoData:entorno,
      masa:(lot.predio&&(lot.masas||[]).length)?{geom:lot.predio.geom,area:lot.predio.area||0,npn:lot.predio.npn||'',masas:lot.masas}:null,
      createdAt:prev.createdAt||S.now(),updatedAt:S.now()};
    await S.set('projects/'+id,data,{merge:false});
    for(const fid of borradas)await S.del(`projects/${id}/fotos/${fid}`);
    for(let k=0;k<fotos.length;k++){const f=fotos[k];
      if(f.id)await S.set(`projects/${id}/fotos/${f.id}`,{orden:k});
      else f.id=await S.add(`projects/${id}/fotos`,{src:f.src,orden:k,uid:u.uid});}
    borradas=[];proj=data;
    if(!lot.projectId)await LX.patchCurrent({projectId:id});
    const url=`${SITE}p/?id=${encodeURIComponent(id)}`;
    $('pjDone').classList.remove('hidden');
    $('pjDone').innerHTML=`<div class="pj-sum" style="margin:0">${data.published?'✅ Página publicada':'💾 Guardada como borrador (no visible)'}
      <div class="inv-link"><input id="pjUrl" readonly value="${esc(url)}"><button class="btn sm" id="pjCopy">Copiar</button></div>
      <div style="display:flex;gap:8px"><a class="btn sm primary" style="flex:1" href="${esc(url)}" target="_blank">🌐 Ver página</a>
      <a class="btn sm" style="flex:1" href="${SITE}crm/?id=${encodeURIComponent(id)}" target="_blank">📋 Abrir CRM</a></div></div>`;
    $('pjCopy').onclick=()=>{navigator.clipboard.writeText(url).then(()=>LX.toast('Link copiado'),()=>{$('pjUrl').select();});};
    $('pjDone').scrollIntoView({behavior:'smooth',block:'end'});
    LX.toast('Página guardada ✓');onDetail(LX.current);
  }catch(e){console.error(e);LX.toast('No se pudo guardar: '+(e.message||e));}
  finally{b.disabled=false;b.textContent='Guardar y publicar';}
}
