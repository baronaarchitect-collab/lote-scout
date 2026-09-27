/* =========================================================================
   LandX · Capa de datos compartida
   -------------------------------------------------------------------------
   La usan el análisis Airbnb, la página pública del proyecto (/p), el CRM
   (/crm), el portal del inversionista (/portal) y el panel de admin (/admin).
   Misma API sobre dos motores:
     · Firestore  (producción, cuando firebase-config.js tiene claves)
     · localStorage (modo demo, para probar sin tocar la nube)
   Rutas tipo Firestore: 'projects/abc', 'projects/abc/leads'.
   ========================================================================= */
export const ADMINS=['barona.architect@gmail.com','baronajuandavid@gmail.com','proyectos@lifecity.com.co'];

let _store=null;
export function getStore(){ if(!_store)_store=create(); return _store; }

async function create(){
  const cfg=window.firebaseConfig||{};
  const useFb=!!(cfg.apiKey&&!/PEGA_AQUI/.test(cfg.apiKey));
  const s=useFb?await firebaseStore(cfg):localStore();
  s.isAdmin=()=>{const u=s.user();return !!u&&ADMINS.includes((u.email||'').toLowerCase());};
  return s;
}

/* ---------- Firestore ---------- */
async function firebaseStore(cfg){
  const V='10.12.0',base=`https://www.gstatic.com/firebasejs/${V}/`;
  const {initializeApp,getApps,getApp}=await import(base+'firebase-app.js');
  const A=await import(base+'firebase-auth.js');
  const F=await import(base+'firebase-firestore.js');
  const app=getApps().length?getApp():initializeApp(cfg);
  const auth=A.getAuth(app),db=F.getFirestore(app);
  let U=auth.currentUser;
  A.onAuthStateChanged(auth,u=>{U=u;});   // user() siempre al día, aunque nadie llame onAuth
  const ref=p=>F.doc(db,...p.split('/')),col=p=>F.collection(db,...p.split('/'));
  return {
    demo:false,
    user:()=>U?{uid:U.uid,email:U.email}:null,
    onAuth(cb){A.onAuthStateChanged(auth,u=>{U=u;cb(u?{uid:u.uid,email:u.email}:null);});},
    login:(e,p)=>A.signInWithEmailAndPassword(auth,e,p),
    signup:(e,p)=>A.createUserWithEmailAndPassword(auth,e,p),
    google:()=>A.signInWithPopup(auth,new A.GoogleAuthProvider()),
    logout:()=>A.signOut(auth),
    now:()=>Date.now(),
    async get(p){const s=await F.getDoc(ref(p));return s.exists()?{id:s.id,...s.data()}:null;},
    async set(p,d,o){await F.setDoc(ref(p),d,{merge:!o||o.merge!==false});},
    async add(p,d){const r=await F.addDoc(col(p),d);return r.id;},
    async del(p){await F.deleteDoc(ref(p));},
    async list(p,o={}){const c=[];if(o.where)c.push(F.where(...o.where));
      const s=await F.getDocs(c.length?F.query(col(p),...c):col(p));return s.docs.map(d=>({id:d.id,...d.data()}));}
  };
}

/* ---------- localStorage (demo) ---------- */
function localStore(){
  const LS=window.localStorage,KEY='lx_db';
  const db=()=>JSON.parse(LS.getItem(KEY)||'{}'),save=d=>LS.setItem(KEY,JSON.stringify(d));
  const users=()=>JSON.parse(LS.getItem('ls_users')||'{}');
  let cb=null;const cur=()=>LS.getItem('ls_session')||null;
  const emit=()=>{const c=cur();cb&&cb(c?{uid:c,email:c}:null);};
  const ok=(v,[f,op,x])=>op==='=='?v[f]===x:true;
  return {
    demo:true,
    user:()=>{const c=cur();return c?{uid:c,email:c}:null;},
    onAuth(f){cb=f;setTimeout(emit,0);},
    async login(e,p){const u=users();if(!u[e]||u[e].pass!==p)throw new Error('Correo o contraseña incorrectos.');LS.setItem('ls_session',e);emit();},
    async signup(e,p){const u=users();if(u[e])throw new Error('Ese correo ya está registrado.');u[e]={pass:p};LS.setItem('ls_users',JSON.stringify(u));LS.setItem('ls_session',e);emit();},
    async google(){throw new Error('Google solo está disponible con Firebase.');},
    async logout(){LS.removeItem('ls_session');emit();},
    now:()=>Date.now(),
    async get(p){const d=db()[p];return d?{id:p.split('/').pop(),...d}:null;},
    async set(p,d,o){const all=db();all[p]=(!o||o.merge!==false)?{...(all[p]||{}),...d}:d;save(all);},
    async add(p,d){const id='d'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);const all=db();all[p+'/'+id]=d;save(all);return id;},
    async del(p){const all=db();delete all[p];save(all);},
    async list(p,o={}){const all=db(),n=p.split('/').length+1;
      return Object.keys(all).filter(k=>k.startsWith(p+'/')&&k.split('/').length===n).map(k=>({id:k.split('/').pop(),...all[k]}))
        .filter(v=>!o.where||ok(v,o.where));}
  };
}

/* ---------- utilidades comunes ---------- */
export const esc=s=>(s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const cop=n=>'$'+Math.round(+n||0).toLocaleString('es-CO');
export const num=v=>{const n=parseFloat(String(v==null?'':v).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'));return isNaN(n)?0:n;};
export function normPhone(raw){let d=(''+(raw||'')).replace(/\D/g,'');if(!d)return null;if(d.length===10&&d[0]==='3')d='57'+d;return d;}
export function slugify(s){return (s||'proyecto').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'proyecto';}
export function friendly(e){const m=(e&&e.message)||''+e;
  if(/invalid-credential|wrong-password|user-not-found/.test(m))return 'Correo o contraseña incorrectos.';
  if(/email-already-in-use/.test(m))return 'Ese correo ya está registrado. Inicia sesión.';
  if(/weak-password/.test(m))return 'La contraseña debe tener al menos 6 caracteres.';
  if(/invalid-email/.test(m))return 'Correo inválido.';
  if(/permission|insufficient/i.test(m))return 'No tienes permiso para esta acción.';
  return m.replace(/^Error:\s*/,'');}
// Convierte un link de YouTube o Vimeo en su URL para incrustar; null si no es válido
export function embedUrl(u){u=(u||'').trim();let m;
  if((m=u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)))return 'https://www.youtube-nocookie.com/embed/'+m[1];
  if((m=u.match(/vimeo\.com\/(?:video\/)?(\d+)/)))return 'https://player.vimeo.com/video/'+m[1];
  return null;}

/* ---------- Inversión: total, participación y plan de pagos ---------- */
export function inversion(p){
  const i=p.inversion||{};const compra=+i.compra||0,obra=+i.remodelacion||0,dot=+i.dotacion||0;
  const total=compra+obra+dot,n=Math.max(1,+i.participaciones||1);
  return {compra,obra,dot,total,n,valor:total/n,separacion:+i.separacion||0,cuotas:Math.max(0,+i.cuotas||0),inicio:i.inicio||''};
}
// Separación + cuotas mensuales iguales por el saldo, para k participaciones
export function planPagos(p,k,hoy){
  // Fechas en hora local (toISOString usa UTC y de noche en Colombia ya marca el día siguiente)
  const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const v=inversion(p),tot=Math.round(v.valor*k),sep=Math.min(Math.round(v.separacion*k),tot),saldo=tot-sep;
  const out=sep>0?[{n:0,concepto:'Separación',fecha:ymd(hoy||new Date()),valor:sep}]:[];   // sin separación, el plan arranca en la cuota 1
  if(saldo>0){const c=Math.max(1,v.cuotas),base=v.inicio?new Date(v.inicio+'T12:00:00'):new Date(),cuota=Math.floor(saldo/c);
    for(let j=0;j<c;j++){const d=new Date(base.getFullYear(),base.getMonth()+j,1,12);
      d.setDate(Math.min(base.getDate(),new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));   // 31 → último día del mes
      // La última cuota absorbe los pesos del redondeo: la suma siempre da el total exacto
      out.push({n:j+1,concepto:'Cuota '+(j+1)+' de '+c,fecha:ymd(d),valor:j===c-1?saldo-cuota*(c-1):cuota});}}
  return out;
}
export const ETAPAS=[['nuevo','Nuevo'],['contactado','Contactado'],['interesado','Interesado'],['separo','Separó'],['descartado','Descartado']];
