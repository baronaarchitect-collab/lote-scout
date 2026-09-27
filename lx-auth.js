/* LandX · acceso compartido de las páginas internas.
   requireAuth pinta la tarjeta de ingreso en #auth y resuelve con el usuario
   cuando hay sesión. Si la sesión se cierra, recarga la página. */
import {friendly} from './lx-store.js';

export function toast(m){let t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t);}
  t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2800);}

export function requireAuth(S,{titulo='LandX',sub='',signup=true}={}){
  return new Promise(resolve=>{
    const box=document.getElementById('auth');let mode='login',done=false;
    box.className='auth hidden';
    box.innerHTML=`<div class="card"><div class="brand"><img src="../logo-sobre-oscuro.svg" alt=""><h1>${titulo}</h1></div>
      <div class="sub">${sub}</div>
      ${signup?'<div class="tabs"><button id="aLogin" class="on">Ingresar</button><button id="aSignup">Crear cuenta</button></div>':''}
      <div class="field"><label for="aEmail">Correo</label><input id="aEmail" type="email" autocomplete="email"></div>
      <div class="field"><label for="aPass">Contraseña</label><input id="aPass" type="password" autocomplete="current-password"></div>
      <button id="aGo" class="btn primary" style="width:100%">Ingresar</button>
      ${S.demo?'':'<button id="aGoogle" class="btn" style="width:100%;margin-top:10px">Continuar con Google</button>'}
      <div class="err" id="aErr" role="alert"></div></div>`;
    const $=id=>document.getElementById(id),err=$('aErr'),go=$('aGo');
    const setMode=m=>{mode=m;$('aLogin').classList.toggle('on',m==='login');$('aSignup').classList.toggle('on',m==='signup');go.textContent=m==='login'?'Ingresar':'Crear cuenta';err.textContent='';};
    if(signup){$('aLogin').onclick=()=>setMode('login');$('aSignup').onclick=()=>setMode('signup');}
    const submit=async()=>{const e=$('aEmail').value.trim(),p=$('aPass').value;if(!e||!p){err.textContent='Escribe correo y contraseña.';return;}
      err.textContent='';go.disabled=true;try{await (mode==='login'?S.login(e,p):S.signup(e,p));}catch(x){err.textContent=friendly(x);}finally{go.disabled=false;}};
    go.onclick=submit;$('aPass').addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
    if($('aGoogle'))$('aGoogle').onclick=async()=>{try{await S.google();}catch(x){err.textContent=friendly(x);}};
    S.onAuth(u=>{
      if(u){box.classList.add('hidden');if(!done){done=true;resolve(u);}}
      else if(done)location.reload();
      else box.classList.remove('hidden');
    });
  });
}
