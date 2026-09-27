/* =========================================================================
   LandX · Estudio de mercado Airbnb (cálculo + presentación)
   -------------------------------------------------------------------------
   Un "comparable" es un anuncio levantado en el sondeo:
     {nombre, zona, rating, resenas, precio, lat, lon, url, amen:[claves]|null}
   precio = COP por noche verificado para las fechas; amen = ficha de servicios
   leída completa (null si no se leyó). Las cifras se calculan solo sobre los
   anuncios que traen el dato, y cada tabla dice sobre cuántos (n).
   ========================================================================= */
import {esc,cop} from './lx-store.js';

export const AMENIDADES=[
  ['wifi','Wifi','u'],['cocina','Cocina','u'],['agua','Agua caliente','u'],['tv','TV','u'],['aire','Aire acondicionado','u'],
  ['trabajo','Zona de trabajo','u'],['blackout','Cortinas blackout','u'],['nevera','Nevera','u'],['mascotas','Admite mascotas','u'],
  ['microondas','Microondas','u'],['balcon','Balcón o patio','u'],['lavadora','Lavadora en la unidad','u'],['cajafuerte','Caja fuerte','u'],
  ['camaras','Cámaras en zonas comunes','e'],['ascensor','Ascensor','e'],['jacuzzi','Jacuzzi','e'],['gimnasio','Gimnasio','e'],
  ['parqueadero','Parqueadero gratis','e'],['porteria','Portería 24 h','e'],['piscina','Piscina','e']];
const NOMBRE=Object.fromEntries(AMENIDADES.map(a=>[a[0],a[1]]));

const median=a=>{if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

export function stats(comps){
  comps=comps||[];
  const conPrecio=comps.filter(c=>+c.precio>0),precios=conPrecio.map(c=>+c.precio);
  const conFicha=comps.filter(c=>Array.isArray(c.amen));
  const amen=AMENIDADES.map(([k,n,g])=>({k,n,g,c:conFicha.filter(c=>c.amen.includes(k)).length})).sort((a,b)=>b.c-a.c);
  // Precio según amenidad: solo si hay al menos 2 anuncios a cada lado
  const ambos=conPrecio.filter(c=>Array.isArray(c.amen));
  const porAmen=AMENIDADES.map(([k,n])=>{const si=ambos.filter(c=>c.amen.includes(k)).map(c=>+c.precio),no=ambos.filter(c=>!c.amen.includes(k)).map(c=>+c.precio);
    return {k,n,con:median(si),sin:median(no),nCon:si.length,nSin:no.length};}).filter(r=>r.nCon>=2&&r.nSin>=2&&r.con!==r.sin)
    .sort((a,b)=>Math.abs(b.con-b.sin)-Math.abs(a.con-a.sin)).slice(0,5);
  return {total:comps.length,nPrecio:precios.length,nFicha:conFicha.length,
    mediana:median(precios),promedio:precios.length?precios.reduce((a,b)=>a+b,0)/precios.length:0,
    min:precios.length?Math.min(...precios):0,max:precios.length?Math.max(...precios):0,amen,porAmen};
}

// HTML del estudio. Las clases (.ab-*) las estiliza cada página con su propio tema.
export function renderEstudio(comps,notas){
  const s=stats(comps);
  if(!s.total)return '<p class="ab-empty">Aún no hay comparables cargados.</p>';
  const rating=c=>c.rating?`${String(c.rating).replace('.',',')}${c.resenas?' ('+esc(c.resenas)+')':''}`:'Nuevo';
  const filas=comps.slice().sort((a,b)=>(+a.precio||1e12)-(+b.precio||1e12)).map(c=>`<tr>
    <td>${c.url?`<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.nombre)}</a>`:esc(c.nombre)}</td>
    <td>${esc(c.zona)||'—'}</td><td>${rating(c)}</td><td class="ab-num">${+c.precio>0?cop(c.precio):'s/d'}</td></tr>`).join('');
  const chips=g=>s.amen.filter(a=>a.g===g&&a.c>0).map(a=>`<span class="ab-chip">${esc(a.n)} <b>${a.c}/${s.nFicha}</b></span>`).join('');
  let h=`<div class="ab-kpis">
    <div class="ab-kpi ab-main"><span>Mediana por noche</span><b>${s.nPrecio?cop(s.mediana):'s/d'}</b></div>
    <div class="ab-kpi"><span>Rango</span><b>${s.nPrecio?cop(s.min)+' – '+cop(s.max):'s/d'}</b></div>
    <div class="ab-kpi"><span>Promedio</span><b>${s.nPrecio?cop(s.promedio):'s/d'}</b></div></div>
  <p class="ab-note">Sondeo de anuncios activos en Airbnb alrededor del predio: ${s.total} anuncio${s.total>1?'s':''}, ${s.nPrecio} con precio verificado y ${s.nFicha} con la ficha de servicios leída completa.</p>
  <h4 class="ab-h">Comparables</h4>
  <div class="ab-scroll"><table class="ab-table"><thead><tr><th>Anuncio</th><th>Zona</th><th>Calificación</th><th class="ab-num">COP / noche</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  if(s.nFicha){
    h+=`<h4 class="ab-h">Qué amenidades ofrece la competencia</h4>
    <div class="ab-sub">Dentro del alojamiento</div><div class="ab-chips">${chips('u')||'—'}</div>
    <div class="ab-sub">Del edificio o conjunto</div><div class="ab-chips">${chips('e')||'—'}</div>`;
  }
  if(s.porAmen.length){
    h+=`<h4 class="ab-h">Precio por noche según la amenidad</h4>
    <div class="ab-scroll"><table class="ab-table"><thead><tr><th>Amenidad</th><th class="ab-num">Mediana con</th><th class="ab-num">Mediana sin</th></tr></thead><tbody>
    ${s.porAmen.map(r=>`<tr><td>${esc(r.n)}</td><td class="ab-num">${cop(r.con)} <small>(n=${r.nCon})</small></td><td class="ab-num">${cop(r.sin)} <small>(n=${r.nSin})</small></td></tr>`).join('')}
    </tbody></table></div>
    <p class="ab-note">Es correlación, no causalidad, sobre una muestra pequeña: las amenidades vienen en paquete con la vista, la ubicación y la edad del edificio.</p>`;
  }
  if(notas)h+=`<h4 class="ab-h">Lo que dicen las reseñas</h4><p class="ab-text">${esc(notas).replace(/\n/g,'<br>')}</p>`;
  return h;
}

// Mapa Leaflet con el predio al centro y los comparables alrededor. Devuelve el mapa.
export function drawMap(el,centro,comps,etiqueta){
  const L=window.L,map=L.map(el,{zoomControl:true,scrollWheelZoom:false}).setView([centro.lat,centro.lon],15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  const pts=[[centro.lat,centro.lon]];
  (comps||[]).filter(c=>c.lat&&c.lon).forEach(c=>{pts.push([+c.lat,+c.lon]);
    L.circleMarker([+c.lat,+c.lon],{radius:8,color:'#fff',weight:2,fillColor:'#FF5A5F',fillOpacity:1}).addTo(map)
      .bindTooltip(+c.precio>0?cop(c.precio):'Airbnb',{permanent:true,direction:'top',className:'ab-tip',offset:[0,-6]})
      .bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(c.zona)||''}<br>${+c.precio>0?cop(c.precio)+' / noche':''}${c.rating?' · ★ '+esc(c.rating):''}${c.url?`<br><a href="${esc(c.url)}" target="_blank" rel="noopener">Ver en Airbnb</a>`:''}`);});
  L.circleMarker([centro.lat,centro.lon],{radius:11,color:'#fff',weight:3,fillColor:'#0F6B4F',fillOpacity:1}).addTo(map)
    .bindTooltip(etiqueta||'El proyecto',{permanent:true,direction:'bottom',className:'ab-tip ab-tip-main',offset:[0,8]});
  if(pts.length>1)map.fitBounds(L.latLngBounds(pts).pad(.25),{maxZoom:16});
  setTimeout(()=>map.invalidateSize(),150);
  return map;
}
export const amenidadNombre=k=>NOMBRE[k]||k;
