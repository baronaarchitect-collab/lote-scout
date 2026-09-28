/* =========================================================================
   LandX · Catastro y norma por ciudad
   -------------------------------------------------------------------------
   Cada ciudad es un "adaptador" con la misma forma, para que el resto de la
   app (selección de lote, plano CAD, masa 3D) no sepa de dónde vienen los datos:

     lots(lat, lon)        → lotes alrededor del punto, como features GeoJSON
                             (EPSG:4326) con propiedades ya normalizadas:
                             npn, direpred, nom_barrio, comuna, manzana,
                             terreno, destinacio, shape_area
     norm(lon, lat, area)  → { html, maxBuild, maxFloors, icb, ica }
                             maxBuild en m² (0 si la norma no da índice),
                             maxFloors en pisos (null si no da altura)

   Fuentes (todas públicas y consultables desde el navegador):
     Cali          IDESC GeoServer · POT Acuerdo 0373/2014
     Bogotá        Catastro IDECA (WFS) · POT Decreto 555/2021 (SDP)
     Barranquilla  Catastro abierto de la Alcaldía · Panorama Urbano (POT 2014)
     Medellín      Lotes de la Alcaldía en ArcGIS Online · la norma se digita
                   (el servicio oficial del POT Acuerdo 48/2014 exige token)
   ========================================================================= */
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('es-CO');
const qs=o=>Object.entries(o).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
const R=0.0016; // ~175 m alrededor del punto
const txt=v=>{const s=String(v==null?'':v).trim();return s||'';};

async function getJson(url,opt){
  const ac=new AbortController(),to=setTimeout(()=>ac.abort(),30000);
  try{const r=await fetch(url,{...opt,signal:ac.signal});if(!r.ok)throw new Error('HTTP '+r.status);
    const t=await r.text();if(!t.trimStart().startsWith('{'))throw new Error('El servidor no respondió con datos');
    const j=JSON.parse(t);if(j.error)throw new Error(j.error.message||'Error del servicio');return j;}
  finally{clearTimeout(to);}
}
// ArcGIS REST: lotes dentro de un rectángulo, devueltos como features GeoJSON en EPSG:4326
async function agsLots(layer,lat,lon,{post=false,fields='*'}={}){
  const p={geometry:[lon-R,lat-R,lon+R,lat+R].join(','),geometryType:'esriGeometryEnvelope',inSR:4326,outSR:4326,
    spatialRel:'esriSpatialRelIntersects',outFields:fields,returnGeometry:'true',resultRecordCount:900,f:'json'};
  const j=post?await getJson(layer+'/query',{method:'POST',body:new URLSearchParams(p),headers:{'Content-Type':'application/x-www-form-urlencoded'}})
              :await getJson(layer+'/query?'+qs(p));
  return (j.features||[]).filter(f=>f.geometry&&f.geometry.rings&&f.geometry.rings.length)
    .map(f=>({type:'Feature',geometry:{type:'Polygon',coordinates:f.geometry.rings},properties:f.attributes||{}}));
}
async function agsPoint(layer,lon,lat){
  const j=await getJson(layer+'/query?'+qs({geometry:lon+','+lat,geometryType:'esriGeometryPoint',inSR:4326,
    spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false',f:'json'}));
  return j.features&&j.features[0]?j.features[0].attributes:null;
}
const row=(k,v)=>`<div><span style="color:var(--muted)">${k}:</span> <b>${esc(v)}</b></div>`;

/* ----------------------------------------------------------------- CALI */
const cali={
  id:'cali',name:'Cali',norma:'POT 2014',fuente:'Catastro IDESC Cali · POT Acuerdo 0373 de 2014',codigo:'NPN',
  bbox:{latMin:3.25,latMax:3.62,lonMin:-76.72,lonMax:-76.36},
  wms:{url:'https://ws-idesc.cali.gov.co/geoserver/catastro/wms',layers:'catastro:cat_bas_terrenos'},
  async lots(lat,lon){
    // propertyName es obligatorio: la vista de la Alcaldía perdió la columna shape_leng y sin esta
    // lista el servidor responde 400 ("column shape_leng does not exist").
    const j=await getJson('https://ws-idesc.cali.gov.co/geoserver/catastro/ows?'+qs({service:'WFS',version:'2.0.0',request:'GetFeature',
      typeNames:'catastro:cat_bas_terrenos',outputFormat:'application/json',srsName:'EPSG:4326',count:900,
      propertyName:'npn,numepred,direpred,nom_barrio,comuna,manzana,terreno,destinacio,shape_area,the_geom',
      bbox:[lon-R,lat-R,lon+R,lat+R].join(',')+',EPSG:4326'}));
    return j.features||[];
  },
  async norm(lon,lat,area){
    const d=.0006;
    const j=await getJson('https://ws-idesc.cali.gov.co/geoserver/ows?'+qs({service:'WFS',version:'2.0.0',request:'GetFeature',
      typeNames:'pot_2014:nur_edificabilidad_icb',outputFormat:'application/json',srsName:'EPSG:4326',propertyName:'icb,ica,the_geom',
      CQL_FILTER:`BBOX(the_geom,${lon-d},${lat-d},${lon+d},${lat+d},'EPSG:4326')`,count:3}));
    const f=(j.features||[])[0];
    if(!f)return {html:'El POT no reporta edificabilidad para este punto (zona sin norma cargada en IDESC).',maxBuild:0,maxFloors:null};
    const a=txt(f.properties.icb),b=txt(f.properties.ica);
    const int=s=>{const m=String(s).match(/(\d+)/);return m?parseInt(m[1]):0;};
    const idx=s=>{const m=String(s).replace(',','.').match(/(\d+(?:\.\d+)?)/);return m?parseFloat(m[1]):0;};
    if(/piso/i.test(a)||/piso/i.test(b)){const p=int(a)+int(b);
      return {icb:a,ica:b,maxBuild:0,maxFloors:p,html:`Norma POT 2014 · edificabilidad por altura: <b>${p} pisos</b> máximo (ICB ${esc(a)} · ICA ${esc(b)}).`};}
    const ic=idx(a)+idx(b);
    if(ic>0)return {icb:a,ica:b,maxBuild:area*ic,maxFloors:null,
      html:`Norma POT 2014 · ICB <b>${esc(a)}</b> + ICA <b>${esc(b)}</b> → índice total <b>${ic.toFixed(2)}</b> · máximo <b>${fmt(area*ic)} m²</b> construidos.`};
    const cod=a&&b&&a!==b?a+' / '+b:(a||b||'sin dato');
    return {icb:a,ica:b,maxBuild:0,maxFloors:null,
      html:`Norma POT 2014: <b>${esc(cod)}</b>. Este predio se rige por una norma especial (sin índice numérico); digita abajo los valores de la ficha normativa.`};
  }
};

/* --------------------------------------------------------------- BOGOTÁ */
const POT_BOG='https://serviciosg.sdp.gov.co/server/rest/services/POT555/NORMA_URBAN%C3%8DSTICA_Y_OT/MapServer';
const bogota={
  id:'bogota',name:'Bogotá',norma:'POT 555 de 2021',fuente:'Catastro IDECA Bogotá · POT Decreto 555 de 2021 (SDP)',codigo:'Código de lote',
  bbox:{latMin:4.45,latMax:4.84,lonMin:-74.23,lonMax:-73.98},
  async lots(lat,lon){
    // Servicio REST y no el WFS: el WFS tarda ~30 s y no devuelve los códigos de lote
    const fs=await agsLots('https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/catastro/lote/MapServer/0',lat,lon,{fields:'LOTCODIGO,MANZCODIGO'});
    return fs.map(f=>{const p=f.properties,c=txt(p.LOTCODIGO);
      return {...f,properties:{npn:c,direpred:'',nom_barrio:'',comuna:'',manzana:txt(p.MANZCODIGO),terreno:c.slice(-3),destinacio:'',shape_area:0}};});
  },
  async norm(lon,lat,area){
    const q=id=>agsPoint(`${POT_BOG}/${id}`,lon,lat).catch(()=>null);
    // Una por una: el servidor de la SDP descarta consultas simultáneas
    const trat=await q(2),rango=await q(14),antej=await q(20),activ=await q(9);
    if(!trat&&!rango)return {html:'El POT 555 no reporta norma para este punto.',maxBuild:0,maxFloors:null};
    const alt=trat?txt(trat.ALTURA_MAXIMA):'',m=alt.match(/\d+/),pisos=m?parseInt(m[0]):null;
    let h=row('Tratamiento',trat?txt(trat.NOMBRE_TRATAMIENTO)||'—':'—')+
      row('Altura máxima',pisos?pisos+' pisos':(alt||'Resultante según el tratamiento y sus cargas'));
    if(antej&&antej.DIMENSION!=null)h+=row('Antejardín mínimo',antej.DIMENSION+' m');
    if(rango&&txt(rango.RANGO))h+=row('Rango de edificabilidad',txt(rango.RANGO));
    if(activ&&txt(activ.NOMBRE_AREA_ACTIVIDAD))h+=row('Área de actividad',txt(activ.NOMBRE_AREA_ACTIVIDAD));
    return {icb:trat?txt(trat.NOMBRE_TRATAMIENTO):'',ica:pisos?pisos+' pisos':alt,maxBuild:0,maxFloors:pisos,antejardin:antej&&+antej.DIMENSION||0,
      html:'<b>POT Decreto 555 de 2021</b>'+h+(pisos?'':'<div style="margin-top:4px">La altura no es fija en este tratamiento: digita abajo los pisos que permite tu ficha.</div>')};
  }
};

/* --------------------------------------------------------- BARRANQUILLA */
// Tabla general de edificabilidad (POT 2014). Rangos: [área máxima m² | null, densidad viv/m², pisos]
const BAQ_NORMA={
  'RENOVACION|REACTIVACION':{base:[[600,.01,2],[800,.012,2],[3000,.02,2],[null,.02,2]],maxima:[[600,.012,3],[800,.04,5],[3000,.06,8],[null,.07,40]],nota:'Mayor a 3000 m²: solo cuando lo autorice el Plan Zonal'},
  'RENOVACION|REDESARROLLO':{texto:'Conforme al Plan Parcial, hasta máximo 40 pisos'},
  'MEJORAMIENTO INTEGRAL|1':{base:[[600,.01,5],[null,.012,5]],maxima:[[600,.012,5],[null,.04,5]]},
  'MEJORAMIENTO INTEGRAL|2':{base:[[600,.01,5],[800,.012,5],[null,.02,5]],maxima:[[600,.012,5],[800,.04,5],[null,.05,8]]},
  'CONSOLIDACION|1A':{base:[[null,.01,2]],maxima:[[null,.01,2]]},
  'CONSOLIDACION|1B':{base:[[600,.01,2],[null,.012,2]],maxima:[[600,.012,3],[null,.04,5]]},
  'CONSOLIDACION|2':{base:[[600,.01,2],[800,.012,2],[4000,.02,2],[null,.02,2]],maxima:[[600,.012,3],[800,.04,5],[4000,.05,8],[null,.05,11]]},
  'CONSOLIDACION|3':{base:[[600,.01,2],[800,.012,2],[2000,.02,2],[null,.02,2]],maxima:[[600,.012,3],[800,.04,5],[2000,.05,8],[null,.06,16]]},
  'CONSOLIDACION|ESPECIAL':{texto:'Ver artículos 350 y 353 del decreto'}
};
const BAQ_TRAT={1:'Conservación',2:'Consolidación',3:'Desarrollo',4:'Espacio público',5:'Espacio público propuesto',6:'Mejoramiento integral',7:'Renovación urbana',8:'Suelo de protección'};
const BAQ_TIPO={1:'Alto',2:'Bajo',3:'Espacio público',4:'Espacio público propuesto',5:'Especial',6:'Especial Plan Reordenamiento',7:'Medio',8:'Mejoramiento Integral 1',9:'Mejoramiento Integral 2',
  10:'Nivel 1A',11:'Nivel 1B',12:'Nivel 2',13:'Nivel 3',14:'Patrimonial',15:'Reactivación',16:'Redesarrollo',17:'Suelo de protección',18:'Reserva infraestructura servicios públicos',
  19:'Sector Normativo 1',20:'Sector Normativo 2',21:'Sector Normativo 3',22:'Sector Normativo 4',23:'Sector Normativo 5',24:'Sector Normativo 6'};
const BAQ_KEY={2:'CONSOLIDACION',6:'MEJORAMIENTO INTEGRAL',7:'RENOVACION'};
const BAQ_NIVEL={5:'ESPECIAL',8:'1',9:'2',10:'1A',11:'1B',12:'2',13:'3',15:'REACTIVACION',16:'REDESARROLLO'};
const rango=(t,a)=>t.find(r=>r[0]===null||a<=r[0])||t[t.length-1];
const barranquilla={
  id:'barranquilla',name:'Barranquilla',norma:'POT 2014',fuente:'Catastro abierto de Barranquilla · Panorama Urbano (POT 2014)',codigo:'Número predial',
  bbox:{latMin:10.86,latMax:11.12,lonMin:-74.93,lonMax:-74.72},
  async lots(lat,lon){
    // POST, como en la app BAQ Lote: el firewall del servidor rechaza los GET con filtros largos
    const fs=await agsLots('https://miciudad.barranquilla.gov.co/gis/rest/services/catastro/datosabiertos/MapServer/315',lat,lon,{post:true});
    return fs.map(f=>{const p=f.properties,c=txt(p.name);
      return {...f,properties:{npn:c,direpred:'',nom_barrio:'',comuna:'',manzana:c.slice(13,17),terreno:c.slice(17,21),destinacio:'',shape_area:+p['st_area(shape)']||0}};});
  },
  async norm(lon,lat,area){
    const a=await agsPoint('https://services3.arcgis.com/oGYAc07w6wsvgUYr/arcgis/rest/services/TRATAMIENTOS_URBANISTICOS_2024/FeatureServer/0',lon,lat);
    if(!a)return {html:'Panorama Urbano no reporta tratamiento urbanístico para este punto.',maxBuild:0,maxFloors:null};
    const trat=BAQ_TRAT[a.Trat_urbanistico]||'—',tipo=BAQ_TIPO[a.Tipo_TratUrb]||'—',alt=txt(a.ALTURA_MAX);
    const regla=BAQ_NORMA[BAQ_KEY[a.Trat_urbanistico]+'|'+BAQ_NIVEL[a.Tipo_TratUrb]];
    let h='<b>POT Barranquilla 2014</b>'+row('Tratamiento',trat+' · '+tipo),maxFloors=null;
    if(regla&&regla.maxima){const b=rango(regla.base,area),m=rango(regla.maxima,area);maxFloors=m[2];
      h+=row('Edificabilidad base',`${b[2]} pisos · ${Math.floor(b[1]*area+1e-9)} viviendas`)+
         row('Edificabilidad máxima',`${m[2]} pisos · ${Math.floor(m[1]*area+1e-9)} viviendas`);
      if(regla.nota&&m===regla.maxima[regla.maxima.length-1])h+=`<div>${esc(regla.nota)}.</div>`;}
    else if(regla)h+=row('Edificabilidad',regla.texto);
    else{if(alt)h+=row('Altura según la capa',alt);const p=alt.match(/(\d+)\s*pisos?/i);if(p)maxFloors=parseInt(p[1]);
      h+='<div style="margin-top:4px">Este tratamiento está fuera de la tabla general de edificabilidad (aplica a Renovación, Mejoramiento Integral y Consolidación). Digita abajo los valores de la norma específica.</div>';}
    h+='<div style="margin-top:4px;color:var(--muted)">No incorpora Planes Parciales, Planes Zonales ni PEMP: si el lote está dentro de alguno, esa norma prevalece.</div>';
    return {icb:trat+' · '+tipo,ica:maxFloors?maxFloors+' pisos':alt,maxBuild:0,maxFloors,html:h};
  }
};

/* ------------------------------------------------------------- MEDELLÍN */
const medellin={
  id:'medellin',name:'Medellín',norma:'POT Acuerdo 48 de 2014',fuente:'Lotes de la Alcaldía de Medellín (febrero de 2026) · POT Acuerdo 48 de 2014',codigo:'CBML',
  bbox:{latMin:6.13,latMax:6.38,lonMin:-75.72,lonMax:-75.47},
  async lots(lat,lon){
    const fs=await agsLots('https://services1.arcgis.com/FZVaYraI7sEGQ6rF/arcgis/rest/services/Lotes_Febrero_2026/FeatureServer/0',lat,lon,
      {fields:'cbml,cobama,numero_pre,area_lote'});
    return fs.map(f=>{const p=f.properties;
      return {...f,properties:{npn:txt(p.cbml),direpred:'',nom_barrio:'',comuna:txt(p.cbml).slice(0,2),manzana:txt(p.cobama),terreno:txt(p.numero_pre),destinacio:'',shape_area:+p.area_lote||0}};});
  },
  async norm(){
    return {maxBuild:0,maxFloors:null,manual:true,html:`<b>POT Medellín · Acuerdo 48 de 2014</b>
      <div>La Alcaldía no publica los aprovechamientos en un servicio abierto. Consulta el polígono de tratamiento de tu lote en
      <a href="https://www.medellin.gov.co/geomedellin" target="_blank" rel="noopener">GeoMedellín ↗</a> y digita abajo su índice de construcción y su altura: la masa se valida contra esos valores.</div>`};
  }
};

export const CITIES=[cali,bogota,barranquilla,medellin];
export function cityAt(c){
  if(!c||c.lat==null)return null;const la=+c.lat,lo=+c.lon;
  return CITIES.find(k=>la>=k.bbox.latMin&&la<=k.bbox.latMax&&lo>=k.bbox.lonMin&&lo<=k.bbox.lonMax)||null;
}
export const cityById=id=>CITIES.find(c=>c.id===id)||cali;
