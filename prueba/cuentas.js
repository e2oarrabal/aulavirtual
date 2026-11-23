/* Cuentas del Aula Virtual: inicio de sesión, registro de accesos, notas, «Mis notas» y panel del profe.
   Se carga solo en la versión con usuarios. Usa Firebase (Auth + Firestore) o, para pruebas locales, un simulador (window.AULA_MOCK). */
(function(){
const ADMIN = 'e2oarrabalmalaga@gmail.com';
const DOM = 'alumnos.aula-e2o.es';
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normUsuario = u => String(u||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,'.').replace(/[^a-z0-9.]/g,'').replace(/\.+/g,'.').replace(/^\.|\.$/g,'');
const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fFecha = d => d ? `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}` : '—';
const fHora = d => d ? d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}) : '';
const fCorta = d => d ? `${d.getDate()} ${MES[d.getMonth()]}` : '';
function hace(d){
  if (!d) return 'nunca';
  const m = Math.round((Date.now() - d.getTime())/60000);
  if (m < 2) return 'ahora mismo'; if (m < 60) return `hace ${m} min`;
  const hh = Math.round(m/60); if (hh < 24) return `hace ${hh} h`;
  const dd = Math.round(hh/24); if (dd === 1) return 'ayer'; if (dd < 30) return `hace ${dd} días`;
  return fFecha(d);
}
const nota1 = n => (Math.round(n*10)/10).toLocaleString('es-ES');
const media = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
function claseNota(n){ return n == null ? '' : n >= 7 ? 'bien' : n >= 5 ? 'justo' : 'mal'; }

/* ---------- conexión: Firebase ---------- */
function backendFirebase(){
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth(), db = firebase.firestore();
  const FV = firebase.firestore.FieldValue, TS = () => FV.serverTimestamp();
  const fecha = x => x && x.toDate ? x.toDate() : (x || null);
  let aviso = null, visita = null;
  async function cuentaNueva(usuario, pass){
    const sec = firebase.apps.find(a => a.name === 'secundaria') || firebase.initializeApp(FIREBASE_CONFIG, 'secundaria');
    const email = `${usuario}.${Math.random().toString(36).slice(2,7)}@${DOM}`;
    const c = await sec.auth().createUserWithEmailAndPassword(email, pass);
    await sec.auth().signOut();
    return { uid: c.user.uid, email };
  }
  const col = u => db.collection('alumnos').doc(u);
  return {
    estado(cb){
      auth.onAuthStateChanged(async u => {
        if (!u){ const m = aviso; aviso = null; return cb(null, m); }
        if ((u.email||'').toLowerCase() === ADMIN) return cb({ admin:true, nombre:'Profe', email:u.email });
        try{
          const q = await db.collection('alumnos').where('uid','==',u.uid).where('activo','==',true).limit(1).get();
          if (q.empty) throw new Error('sin-alta');
          cb({ admin:false, usuario:q.docs[0].id, nombre:q.docs[0].data().nombre });
        }catch(e){ console.warn(e); aviso = 'Tu usuario ya no está activo. Habla con tu profe.'; await auth.signOut(); }
      });
    },
    async entrar(usuario, pass){
      let email = usuario.trim();
      if (!email.includes('@')){
        const d = await db.collection('logins').doc(normUsuario(usuario)).get();
        if (!d.exists) { const e = new Error('nouser'); e.code = 'nouser'; throw e; }
        email = d.data().email;
      }
      await auth.signInWithEmailAndPassword(email, pass);
    },
    salir(){ return auth.signOut(); },
    async visitaInicio(u){
      visita = col(u).collection('visitas').doc();
      const b = db.batch();
      b.update(col(u), { ultimoAcceso: TS(), accesos: FV.increment(1) });
      b.set(visita, { inicio: TS(), ultimo: TS(), min: 0 });
      await b.commit();
    },
    latido(min){ if (visita) return visita.update({ ultimo: TS(), min }); },
    guardarIntento(u, o){ return col(u).collection('intentos').add({ ...o, fecha: TS() }); },
    async activarAvisos(u){
      const reg = await navigator.serviceWorker.register(window.AULA_SW_AVISOS || 'sw-avisos.js', { scope: './' });
      await navigator.serviceWorker.ready;
      const token = await firebase.messaging().getToken({ vapidKey: FIREBASE_VAPID, serviceWorkerRegistration: reg });
      if (!token) throw new Error('sin-token');
      const b = db.batch();
      b.set(col(u).collection('avisos').doc(token), { token, fecha: TS(), movil: navigator.userAgent.slice(0, 200) });
      b.update(col(u), { avisos: true });
      await b.commit();
      return token;
    },
    async intentos(u){ const q = await col(u).collection('intentos').orderBy('fecha').get(); return q.docs.map(d => ({ ...d.data(), fecha: fecha(d.data().fecha) || new Date() })); },
    async visitas(u){ const q = await col(u).collection('visitas').orderBy('inicio','desc').limit(300).get(); return q.docs.map(d => ({ ...d.data(), inicio: fecha(d.data().inicio), ultimo: fecha(d.data().ultimo) })); },
    async alumnos(){ const q = await db.collection('alumnos').get(); return q.docs.map(d => ({ usuario:d.id, ...d.data(), ultimoAcceso: fecha(d.data().ultimoAcceso), creado: fecha(d.data().creado) })); },
    async crear(nombre, usuario, pass){
      const l = db.collection('logins').doc(usuario);
      if ((await l.get()).exists) { const e = new Error('existe'); e.code = 'existe'; throw e; }
      const c = await cuentaNueva(usuario, pass);
      const b = db.batch();
      b.set(l, { email: c.email });
      b.set(col(usuario), { nombre, uid: c.uid, email: c.email, activo: true, creado: TS(), accesos: 0, ultimoAcceso: null });
      await b.commit();
    },
    async cambiarPass(usuario, pass){
      const c = await cuentaNueva(usuario, pass);
      const b = db.batch();
      b.update(col(usuario), { uid: c.uid, email: c.email });
      b.set(db.collection('logins').doc(usuario), { email: c.email });
      await b.commit();
    },
    activo(usuario, si){ return col(usuario).update({ activo: si }); },
    async borrar(usuario){
      for (const sub of ['intentos','visitas']){
        const q = await col(usuario).collection(sub).get();
        for (let i = 0; i < q.docs.length; i += 400){ const b = db.batch(); q.docs.slice(i, i+400).forEach(d => b.delete(d.ref)); await b.commit(); }
      }
      const b = db.batch(); b.delete(col(usuario)); b.delete(db.collection('logins').doc(usuario)); await b.commit();
    }
  };
}

/* ---------- simulador para pruebas locales (sin servidor) ---------- */
function backendSimulado(){
  const K = 'aula-sim';
  const lee = () => { try{ const s = JSON.parse(localStorage.getItem(K)); if (s) return s; }catch(e){} return { cuentas:{}, alumnos:{}, sesion:null }; };
  let S = lee();
  const guarda = () => localStorage.setItem(K, JSON.stringify(S));
  const fix = o => { for (const k of ['fecha','inicio','ultimo','ultimoAcceso','creado']) if (o[k]) o[k] = new Date(o[k]); return o; };
  let cbE = null, visita = null;
  const avisa = () => { const u = S.sesion; if (!u) return cbE(null); if (u === ADMIN) return cbE({ admin:true, nombre:'Profe', email:u });
    const a = Object.entries(S.alumnos).find(([k,v]) => v.email === u && v.activo); if (!a) { S.sesion = null; guarda(); return cbE(null, 'Tu usuario ya no está activo. Habla con tu profe.'); }
    cbE({ admin:false, usuario:a[0], nombre:a[1].nombre }); };
  const espera = () => new Promise(r => setTimeout(r, 120));
  return {
    estado(cb){ cbE = cb; setTimeout(avisa, 100); },
    async entrar(usuario, pass){ await espera(); let email = usuario.trim();
      if (!email.includes('@')){ const a = S.alumnos[normUsuario(usuario)]; if (!a) { const e = new Error(); e.code = 'nouser'; throw e; } email = a.email; }
      if (email === ADMIN ? pass !== 'admin123' : (S.cuentas[email] !== pass)) { const e = new Error(); e.code = 'auth/invalid-credential'; throw e; }
      S.sesion = email; guarda(); avisa(); },
    async salir(){ S.sesion = null; guarda(); avisa(); },
    async visitaInicio(u){ const a = S.alumnos[u]; a.accesos = (a.accesos||0)+1; a.ultimoAcceso = new Date(); a.visitas = a.visitas || []; visita = { inicio:new Date(), ultimo:new Date(), min:0 }; a.visitas.push(visita); guarda(); },
    async latido(min){ if (visita){ visita.ultimo = new Date(); visita.min = min; guarda(); } },
    async activarAvisos(u){ await espera(); S.alumnos[u].avisos = true; guarda(); return 'token-simulado'; },
    async guardarIntento(u, o){ await espera(); const a = S.alumnos[u]; (a.intentos = a.intentos || []).push({ ...o, fecha:new Date() }); guarda(); },
    async intentos(u){ await espera(); S = lee(); return (S.alumnos[u].intentos || []).map(fix); },
    async visitas(u){ await espera(); S = lee(); return (S.alumnos[u].visitas || []).map(fix).reverse(); },
    async alumnos(){ await espera(); S = lee(); return Object.entries(S.alumnos).map(([k,v]) => fix({ usuario:k, ...v, intentos:undefined, visitas:undefined })); },
    async crear(nombre, usuario, pass){ await espera(); if (S.alumnos[usuario]) { const e = new Error(); e.code = 'existe'; throw e; }
      const email = `${usuario}.x@${DOM}`; S.cuentas[email] = pass; S.alumnos[usuario] = { nombre, email, uid:email, activo:true, creado:new Date(), accesos:0, ultimoAcceso:null }; guarda(); },
    async cambiarPass(usuario, pass){ await espera(); S.cuentas[S.alumnos[usuario].email] = pass; guarda(); },
    async activo(usuario, si){ S.alumnos[usuario].activo = si; guarda(); },
    async borrar(usuario){ delete S.alumnos[usuario]; guarda(); }
  };
}

const B = window.AULA_MOCK ? backendSimulado() : backendFirebase();
let yo = null;

/* ---------- estilos ---------- */
const CSS = `
.cu-login{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 18px;background:linear-gradient(160deg,#F28A14 0%,#E86F00 55%,#C95E00 100%);overflow:auto}
.cu-login::before{content:"";position:absolute;right:-90px;top:-90px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.12)}
.cu-login::after{content:"";position:absolute;left:-70px;bottom:-80px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,.08)}
.cu-caja{position:relative;z-index:1;width:100%;max-width:380px;background:#fff;color:#1A1C2B;border-radius:24px;padding:26px 22px 22px;box-shadow:0 20px 50px rgba(0,0,0,.22)}
.cu-lgs{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px}
.cu-lgs img:first-child{width:46px;height:46px;border-radius:50%}
.cu-lgs img:last-child{height:38px;width:auto}
.cu-caja h1{font-family:var(--titulo);font-weight:400;font-size:34px;letter-spacing:.5px;text-align:center;margin:4px 0 2px;color:#16357F;text-transform:uppercase}
.cu-caja .sub{text-align:center;color:#5E6175;margin:0 0 18px;font-size:14px}
.cu-campo{display:block;margin:0 0 12px}
.cu-campo span{display:block;font-size:13px;font-weight:600;margin:0 0 5px;color:#1A1C2B}
.cu-campo input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 14px;border:2px solid #E3E0DB;border-radius:14px;background:#FFF9F2;color:#1A1C2B;outline:none}
.cu-campo input:focus{border-color:#EF7D00;background:#fff}
.cu-pass{position:relative}
.cu-pass button{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;color:#B35A00;font:inherit;font-size:13px;font-weight:600;padding:8px;cursor:pointer}
.cu-entrar{width:100%;margin-top:6px;border:0;border-radius:999px;padding:14px;font:inherit;font-weight:700;font-size:16px;color:#fff;background:#16357F;cursor:pointer}
.cu-entrar:disabled{opacity:.6}
.cu-err{min-height:20px;margin:10px 0 0;color:#D3343C;font-size:14px;text-align:center}
.cu-ayuda{margin:12px 0 0;font-size:13px;color:#5E6175;text-align:center}
.cu-cargando{color:#fff;font-weight:600;position:relative;z-index:1}
.cu-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface);color:var(--ink);border-radius:18px;padding:10px 12px 10px 16px;margin:0 0 14px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.cu-bar b{flex:1;min-width:120px;font-weight:600}
.cu-bar a,.cu-bar button{border:0;border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}
.cu-bar a{background:#16357F;color:#fff}
.cu-bar button{background:transparent;color:var(--muted);padding:8px 6px}
.cu-av{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#16357F;color:#fff;border-radius:18px;padding:12px 14px;margin:0 0 14px;font-size:14px;font-weight:500}
.cu-av span{flex:1;min-width:180px}
.cu-av .cu-btn{background:#EF7D00}
p.cu-av{display:block}
.cu-aviso{position:relative;background:var(--surface);color:var(--ink);border-left:6px solid #EF7D00;border-radius:18px;padding:12px 16px;margin:0 0 14px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.cu-aviso p{margin:0;font-size:14.5px}
.cu-nuevo{float:right;margin-left:8px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;background:#EF7D00;color:#fff;border-radius:999px;padding:3px 9px}
.cu-nota{margin:14px auto 0;padding:10px 14px;border-radius:14px;background:color-mix(in srgb,var(--c) 10%,transparent);font-weight:600}
.cu-nota a{color:inherit}
.cu-sec{background:var(--surface);color:var(--ink);border-radius:20px;padding:16px;margin:0 0 14px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.cu-sec h2{font-size:18px;margin:0 0 10px}
.cu-sec h3{font-size:15px;margin:14px 0 6px;color:var(--muted);font-weight:600}
.cu-medias{display:flex;gap:8px;flex-wrap:wrap}
.cu-medias div{flex:1;min-width:92px;border-radius:14px;padding:10px;background:color-mix(in srgb,var(--c) 12%,transparent);text-align:center}
.cu-medias b{display:block;font-size:24px}
.cu-medias small{font-size:12px;color:var(--muted)}
.cu-act{border-top:1px solid var(--line)}
.cu-act summary{list-style:none;color:inherit;outline:none;display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer}
.cu-act summary::-webkit-details-marker{display:none}
.cu-act summary span{flex:1;min-width:0}
.cu-act summary small{display:block;color:var(--muted);font-size:12px}
.cu-n{flex:none;min-width:46px;text-align:center;font-weight:700;border-radius:12px;padding:6px 8px;background:#eee;color:#1A1C2B}
.cu-n.bien{background:#D9F2E3;color:#0E5C33}.cu-n.justo{background:#FFF0CC;color:#7A5200}.cu-n.mal{background:#FBDADB;color:#8E1D22}
.cu-hist{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 12px}
.cu-hist span{font-size:12px;border-radius:10px;padding:5px 8px;background:color-mix(in srgb,var(--ink) 6%,transparent)}
.cu-hist span b{font-size:14px;margin-right:4px}
.cu-vacio{color:var(--muted);margin:4px 0}
.cu-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.cu-btn{border:0;border-radius:999px;padding:10px 16px;font:inherit;font-weight:600;font-size:14px;cursor:pointer;background:#16357F;color:#fff;text-decoration:none}
.cu-btn.sec{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.cu-btn.peligro{background:#FBDADB;color:#8E1D22}
.cu-btn:disabled{opacity:.6}
.cu-alu{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.cu-alu:first-of-type{border-top:0}
.cu-alu .av{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#16357F;color:#fff;font-weight:700}
.cu-alu.baja{opacity:.55}
.cu-alu span{flex:1;min-width:0}
.cu-alu small{display:block;color:var(--muted);font-size:12px}
.cu-form{display:grid;gap:10px;margin-top:10px}
.cu-form label span{display:block;font-size:13px;font-weight:600;margin-bottom:4px}
.cu-form input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:2px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink)}
.cu-ok{border-radius:14px;padding:12px 14px;background:#D9F2E3;color:#0E5C33;margin-top:10px}
.cu-ok code{font-size:16px;font-weight:700}
.cu-msg{font-size:14px;margin:8px 0 0;color:var(--muted)}
.cu-msg.err{color:var(--bad)}
.cu-tabla{width:100%;border-collapse:collapse;font-size:14px}
.cu-tabla td{padding:7px 4px;border-top:1px solid var(--line)}
.cu-tabla td:last-child{text-align:right;color:var(--muted)}
`;

/* ---------- pantalla de entrada ---------- */
function pantallaLogin(aviso){
  let el = $('#cu-login');
  if (!el){ el = document.createElement('div'); el.id = 'cu-login'; el.className = 'cu-login'; document.body.appendChild(el); }
  document.documentElement.style.overflow = 'hidden';
  el.innerHTML = `<form class="cu-caja" id="cu-f" autocomplete="on">
      <div class="cu-lgs"><img src="logos/e2o.jpg" alt="E2O"><img src="logos/arrabal.png" alt="Arrabal AID"></div>
      <h1>Aula Virtual</h1><p class="sub">Escuela de Segunda Oportunidad · Málaga</p>
      <label class="cu-campo"><span>Usuario</span><input id="cu-u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label class="cu-campo"><span>Contraseña</span><div class="cu-pass"><input id="cu-p" name="password" type="password" autocomplete="current-password" required><button type="button" id="cu-ver">Ver</button></div></label>
      <button class="cu-entrar" id="cu-go">Entrar</button>
      <p class="cu-err" id="cu-err">${h(aviso||'')}</p>
      <p class="cu-ayuda">Solo tienes que entrar una vez en cada móvil.<br>¿No tienes usuario o se te ha olvidado la contraseña? Pídeselo a tu profe.</p>
    </form>`;
  $('#cu-ver').onclick = () => { const p = $('#cu-p'); const v = p.type === 'password'; p.type = v ? 'text' : 'password'; $('#cu-ver').textContent = v ? 'Ocultar' : 'Ver'; };
  $('#cu-f').onsubmit = async e => {
    e.preventDefault();
    const go = $('#cu-go'), err = $('#cu-err');
    go.disabled = true; go.textContent = 'Entrando…'; err.textContent = '';
    try{ await B.entrar($('#cu-u').value, $('#cu-p').value); }
    catch(x){
      const c = x.code || '';
      err.textContent = c === 'nouser' ? 'Ese usuario no existe. Revisa cómo se escribe.'
        : /wrong-password|invalid-credential|invalid-login|user-not-found|invalid-email/.test(c) ? 'La contraseña no es correcta.'
        : /too-many/.test(c) ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
        : /network/.test(c) ? 'No hay conexión a internet.' : 'No se ha podido entrar. Inténtalo otra vez.';
      go.disabled = false; go.textContent = 'Entrar';
    }
  };
}
function pantallaCargando(){
  let el = $('#cu-login');
  if (!el){ el = document.createElement('div'); el.id = 'cu-login'; el.className = 'cu-login'; document.body.appendChild(el); }
  el.innerHTML = '<p class="cu-cargando">Cargando el aula…</p>';
}
function quitarLogin(){ const el = $('#cu-login'); if (el) el.remove(); document.documentElement.style.overflow = ''; }

/* ---------- tiempo en el aula ---------- */
let seg = 0, reloj = null, oculto = null;
function empiezaVisita(){
  seg = 0; clearInterval(reloj);
  B.visitaInicio(yo.usuario).catch(e => console.warn('visita', e));
  reloj = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    seg += 30;
    if (seg % 60 === 0) Promise.resolve(B.latido(Math.round(seg/60))).catch(()=>{});
  }, 30000);
}
document.addEventListener('visibilitychange', () => {
  if (!yo || yo.admin) return;
  if (document.visibilityState === 'hidden'){ oculto = Date.now(); Promise.resolve(B.latido(Math.round(seg/60))).catch(()=>{}); }
  else if (oculto && Date.now() - oculto > 30*60000){ oculto = null; empiezaVisita(); }
});

/* ---------- actividades y notas ---------- */
function infoActividad(id){
  const J = JUEGOS[id] || {};
  const tema = Object.keys(TEMAS).find(k => TEMAS[k].juego === id) || '';
  const T = tema ? TEMAS[tema] : null;
  return { actividad:id, tipo: /^(mi-)?reto-/.test(id) ? 'reto' : 'juego', titulo: J.titulo || id, ambito: J.ambito || '',
    tema, temaTitulo: T ? T.titulo : '', area: T ? T.area : (J.materia || ''), clase: T ? T.clase : null };
}
function agrupa(intentos){
  const acts = {};
  intentos.forEach(i => {
    const a = acts[i.actividad] || (acts[i.actividad] = { ...i, lista:[] });
    a.lista.push(i); Object.assign(a, { titulo:i.titulo, tema:i.tema, temaTitulo:i.temaTitulo, area:i.area, clase:i.clase, ambito:i.ambito, tipo:i.tipo });
  });
  Object.values(acts).forEach(a => { a.lista.sort((x,y)=>x.fecha-y.fecha); a.mejor = Math.max(...a.lista.map(x=>x.nota)); a.ultima = a.lista[a.lista.length-1]; });
  return Object.values(acts);
}
function resumen(intentos){
  const acts = agrupa(intentos);
  const amb = {};
  AMBITOS.slice(0,3).forEach(A => { const xs = acts.filter(a => a.ambito === A.id); amb[A.id] = { A, acts:xs, media: media(xs.map(a=>a.mejor)) }; });
  return { acts, amb, general: media(acts.map(a=>a.mejor)) };
}
function notasHTML(intentos, vacio){
  const R = resumen(intentos);
  if (!R.acts.length) return `<section class="cu-sec"><p class="cu-vacio">${vacio}</p></section>`;
  const medias = `<section class="cu-sec"><h2>Medias</h2><div class="cu-medias">${Object.values(R.amb).map(x=>`<div style="--c:var(${x.A.c})"><b>${x.media==null?'—':nota1(x.media)}</b><small>${x.A.nombre}</small></div>`).join('')}</div>
    <p class="cu-msg">Se cuenta la mejor nota de cada actividad.</p></section>`;
  const bloques = Object.values(R.amb).filter(x => x.acts.length).map(x => {
    const grupos = {};
    x.acts.forEach(a => { const k = a.tema || '~retos'; (grupos[k] = grupos[k] || []).push(a); });
    const orden = Object.keys(grupos).sort((p,q) => (p==='~retos') - (q==='~retos') || ((grupos[p][0].clase||0) - (grupos[q][0].clase||0)));
    return `<section class="cu-sec" style="--c:var(${x.A.c})"><h2>${x.A.nombre} <span class="cu-n ${claseNota(x.media)}" style="float:right">${nota1(x.media)}</span></h2>
      ${orden.map(k => { const g = grupos[k]; const mt = media(g.map(a=>a.mejor));
        return `<h3>${k==='~retos' ? 'Retos' : `${h(g[0].area)} · ${h(g[0].temaTitulo)}`}${k==='~retos'?'':` · media ${nota1(mt)}`}</h3>` + g.map(a => `
        <details class="cu-act"><summary><span>${h(a.titulo)}<small>Última: ${nota1(a.ultima.nota)} · ${a.lista.length} ${a.lista.length===1?'intento':'intentos'} · ${hace(a.ultima.fecha)}</small></span><b class="cu-n ${claseNota(a.mejor)}">${nota1(a.mejor)}</b></summary>
          <div class="cu-hist">${a.lista.map(i=>`<span><b>${nota1(i.nota)}</b>${fCorta(i.fecha)} ${fHora(i.fecha)}${i.conTiempo?'':' · repaso'}</span>`).join('')}</div></details>`).join(''); }).join('')}
    </section>`;
  }).join('');
  return medias + bloques;
}


/* ---------- avisos al móvil ---------- */
const RAIZ = () => location.href.split('#')[0].split('?')[0].replace(/prueba\/(index\.html)?$/, '').replace(/index\.html$/, '');
function estadoAvisos(){
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'no';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission === 'granted' && localStorage.getItem('aula-avisos')) return 'si';
  return 'pendiente';
}
function bloqueAvisos(){
  const e = estadoAvisos();
  if (!yo || yo.admin || e === 'si') return '';
  if (e === 'no') return /iphone|ipad/i.test(navigator.userAgent) ? `<p class="cu-av">🔔 Para recibir avisos en el iPhone, primero instala el aula en tu pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.</p>` : '';
  if (e === 'bloqueado') return `<p class="cu-av">🔕 Tienes los avisos bloqueados. Actívalos en los ajustes del navegador (permisos de notificaciones de esta web).</p>`;
  return `<div class="cu-av"><span>🔔 Activa los avisos para enterarte de los cambios de calendario y las novedades.</span><button class="cu-btn" id="cu-av-on">Activar avisos</button></div>`;
}
async function activarAvisos(btn){
  btn.disabled = true; btn.textContent = 'Activando…';
  try{
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('permiso');
    const t = await B.activarAvisos(yo.usuario);
    localStorage.setItem('aula-avisos', t);
    btn.closest('.cu-av').innerHTML = '✅ ¡Listo! Te llegarán los avisos del aula a este móvil.';
  }catch(e){
    console.error(e);
    btn.closest('.cu-av').innerHTML = e.message === 'permiso' ? '🔕 No has dado permiso. Si cambias de idea, actívalo en los ajustes del navegador.' : 'No se han podido activar los avisos. Inténtalo más tarde.';
  }
}
let avisoCache = null;
async function avisoActual(){
  if (avisoCache) return avisoCache;
  try{ const r = await fetch(RAIZ() + 'avisos/aviso.json?t=' + Date.now(), { cache:'no-store' }); avisoCache = await r.json(); }catch(e){ avisoCache = {}; }
  return avisoCache;
}
async function pintaAviso(){
  const a = await avisoActual();
  if (!a || !a.texto || !a.mostrar) return;
  if (a.hasta && new Date() > new Date(a.hasta + 'T23:59:59')) return;
  const app = appEl(); if (!app || app.querySelector('.cu-aviso') || !app.querySelector('.cu-bar')) return;
  const visto = localStorage.getItem('aula-aviso-visto') === a.id;
  app.querySelector('.cu-bar').insertAdjacentHTML('afterend', `<div class="cu-aviso">${visto ? '' : '<b class="cu-nuevo">Nuevo</b>'}<p><b>${h(a.titulo)}</b><br>${h(a.texto)}</p></div>`);
  if (!visto) localStorage.setItem('aula-aviso-visto', a.id);
}

/* ---------- vistas ---------- */
const appEl = () => document.getElementById('app');
const cabecera = (t, sub) => `<a class="back" href="#inicio">${I.back} Inicio</a><section class="head" style="--c:#16357F"><p class="kicker">${sub}</p><h1>${t}</h1></section>`;

async function misNotas(){
  const app = appEl();
  if (yo.admin){ app.innerHTML = cabecera('Mis notas','Aula Virtual') + `<section class="cu-sec"><p>Has entrado como profe. Las notas del alumnado están en el <a href="#panel">panel del profe</a>.</p></section>`; return; }
  app.innerHTML = cabecera('Mis notas', yo.nombre) + '<section class="cu-sec"><p class="cu-vacio">Cargando tus notas…</p></section>';
  try{
    const its = await B.intentos(yo.usuario);
    if (location.hash !== '#notas') return;
    app.innerHTML = cabecera('Mis notas', h(yo.nombre)) + notasHTML(its, 'Todavía no has hecho ninguna actividad. Cuando termines un juego o un reto, tu nota aparecerá aquí.');
  }catch(e){ console.error(e); app.querySelector('.cu-sec').innerHTML = '<p class="cu-msg err">No se han podido cargar tus notas. Comprueba la conexión.</p>'; }
}

function sugerirUsuario(nombre){ const p = normUsuario(nombre).split('.').filter(Boolean); return p.length > 1 ? p[0] + '.' + p[1] : (p[0] || ''); }
function sugerirPass(){ const w = ['sol','mar','luna','tigre','rio','nube','faro','roca','lobo','pino','ola','cielo']; return w[Math.floor(Math.random()*w.length)] + (100 + Math.floor(Math.random()*900)); }

async function panel(){
  const app = appEl();
  app.innerHTML = cabecera('Panel del profe','Alumnado') + `
    <section class="cu-sec"><div class="cu-btns" style="margin:0"><button class="cu-btn" id="cu-nuevo">+ Nuevo alumno</button><button class="cu-btn sec" id="cu-xls">Descargar Excel</button></div>
      <p class="cu-msg" id="cu-xmsg"></p><div id="cu-alta"></div></section>
    <section class="cu-sec" id="cu-lista"><p class="cu-vacio">Cargando…</p></section>`;
  $('#cu-nuevo').onclick = formAlta;
  $('#cu-xls').onclick = e => excel(null, e.currentTarget, $('#cu-xmsg'));
  cargaLista();
}
async function cargaLista(){
  try{
    const al = (await B.alumnos()).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
    const l = $('#cu-lista'); if (location.hash !== '#panel' || !l) return;
    l.innerHTML = `<h2>Alumnado (${al.filter(a=>a.activo).length} activos)</h2><p class="cu-msg">🔔 = tiene los avisos al móvil activados (${al.filter(a=>a.activo&&a.avisos).length} de ${al.filter(a=>a.activo).length}).</p>` + (al.length ? al.map(a => `
      <a class="cu-alu ${a.activo?'':'baja'}" href="#panel-${encodeURIComponent(a.usuario)}"><b class="av">${h((a.nombre||'?')[0].toUpperCase())}</b>
        <span><b>${h(a.nombre)}</b>${a.avisos?' 🔔':''}${a.activo?'':' · de baja'}<small>${h(a.usuario)} · ${a.accesos===1?'1 acceso':(a.accesos||0)+' accesos'} · último ${hace(a.ultimoAcceso)}</small></span><span style="flex:none">›</span></a>`).join('')
      : '<p class="cu-vacio">Todavía no hay alumnos. Pulsa «Nuevo alumno» para dar de alta al primero.</p>');
  }catch(e){ console.error(e); const l = $('#cu-lista'); if (l) l.innerHTML = '<p class="cu-msg err">No se ha podido cargar el alumnado. Comprueba la conexión.</p>'; }
}
function formAlta(){
  const c = $('#cu-alta');
  c.innerHTML = `<form class="cu-form" id="cu-fa">
    <label><span>Nombre y apellidos</span><input id="fa-n" required autocomplete="off"></label>
    <label><span>Usuario (sin espacios ni tildes)</span><input id="fa-u" required autocapitalize="none" autocomplete="off"></label>
    <label><span>Contraseña (mínimo 6 caracteres)</span><input id="fa-p" required minlength="6" autocomplete="off" value="${sugerirPass()}"></label>
    <div class="cu-btns" style="margin:0"><button class="cu-btn">Dar de alta</button><button type="button" class="cu-btn sec" id="fa-x">Cancelar</button></div>
    <p class="cu-msg" id="fa-m"></p></form>`;
  let tocado = false;
  $('#fa-n').oninput = () => { if (!tocado) $('#fa-u').value = sugerirUsuario($('#fa-n').value); };
  $('#fa-u').oninput = () => { tocado = true; };
  $('#fa-x').onclick = () => { c.innerHTML = ''; };
  $('#fa-n').focus();
  $('#cu-fa').onsubmit = async e => {
    e.preventDefault();
    const nombre = $('#fa-n').value.trim(), usuario = normUsuario($('#fa-u').value), pass = $('#fa-p').value;
    const m = $('#fa-m'), b = e.submitter || c.querySelector('.cu-btn');
    if (!usuario) { m.className = 'cu-msg err'; m.textContent = 'Escribe un usuario.'; return; }
    if (pass.length < 6) { m.className = 'cu-msg err'; m.textContent = 'La contraseña necesita al menos 6 caracteres.'; return; }
    b.disabled = true; m.className = 'cu-msg'; m.textContent = 'Creando…';
    try{
      await B.crear(nombre, usuario, pass);
      c.innerHTML = credenciales(nombre, usuario, pass, 'Alta hecha.');
      enlazarCopiar(nombre, usuario, pass);
      cargaLista();
    }catch(x){ console.error(x); b.disabled = false; m.className = 'cu-msg err';
      m.textContent = x.code === 'existe' ? 'Ese usuario ya existe. Elige otro (por ejemplo, añade la segunda letra del apellido).' : /weak-password/.test(x.code||'') ? 'La contraseña es demasiado débil.' : 'No se ha podido crear. Comprueba la conexión.'; }
  };
}
function credenciales(nombre, usuario, pass, t){
  return `<div class="cu-ok"><b>${t}</b> Pásale estos datos a ${h(nombre)}:<br>Usuario: <code>${h(usuario)}</code><br>Contraseña: <code>${h(pass)}</code>
    <div class="cu-btns"><button class="cu-btn" id="cu-copia">Copiar mensaje</button></div></div>`;
}
function enlazarCopiar(nombre, usuario, pass){
  const b = $('#cu-copia'); if (!b) return;
  const url = location.href.split('#')[0].replace(/prueba\/?(index\.html)?$/, '');
  const txt = `Hola, ${nombre.split(' ')[0]}. Estos son tus datos para entrar en el Aula Virtual:\n${url}\nUsuario: ${usuario}\nContraseña: ${pass}\nSolo tienes que ponerlos la primera vez.`;
  b.onclick = async () => { try{ await navigator.clipboard.writeText(txt); b.textContent = 'Copiado ✓'; }catch(e){ prompt('Copia este mensaje:', txt); } };
}

async function fichaAlumno(u){
  const app = appEl();
  app.innerHTML = `<a class="back" href="#panel">${I.back} Panel del profe</a><section class="cu-sec"><p class="cu-vacio">Cargando…</p></section>`;
  try{
    const [al, its, vis] = await Promise.all([B.alumnos(), B.intentos(u), B.visitas(u)]);
    const a = al.find(x => x.usuario === u);
    if (location.hash !== '#panel-' + encodeURIComponent(u)) return;
    if (!a){ app.innerHTML = `<a class="back" href="#panel">${I.back} Panel del profe</a><section class="cu-sec"><p>Este alumno ya no existe.</p></section>`; return; }
    const total = vis.reduce((s,v)=>s+(v.min||0),0);
    app.innerHTML = `<a class="back" href="#panel">${I.back} Panel del profe</a>
      <section class="head" style="--c:#16357F"><p class="kicker">${h(a.usuario)}${a.activo?'':' · de baja'}</p><h1>${h(a.nombre)}</h1>
        <p>${a.accesos===1?'1 acceso':(a.accesos||0)+' accesos'} · último ${hace(a.ultimoAcceso)} · ${total?`unos ${total} min en el aula`:'menos de 1 min en el aula'}</p></section>
      <section class="cu-sec"><div class="cu-btns" style="margin:0">
        <button class="cu-btn" id="fa-xls">Excel de este alumno</button>
        <button class="cu-btn sec" id="fa-pass">Nueva contraseña</button>
        <button class="cu-btn sec" id="fa-act">${a.activo?'Dar de baja':'Reactivar'}</button>
        <button class="cu-btn peligro" id="fa-del">Borrar</button></div><p class="cu-msg" id="fa-m"></p><div id="fa-out"></div></section>
      ${notasHTML(its, 'Todavía no ha hecho ninguna actividad.')}
      <section class="cu-sec"><h2>Accesos</h2>${vis.length ? `<table class="cu-tabla">${vis.slice(0,40).map(v=>`<tr><td>${fFecha(v.inicio)}</td><td>${fHora(v.inicio)}</td><td>${v.min?`${v.min} min`:'menos de 1 min'}</td></tr>`).join('')}</table>${vis.length>40?`<p class="cu-msg">Se muestran los 40 últimos. El Excel los incluye todos.</p>`:''}` : '<p class="cu-vacio">Todavía no ha entrado.</p>'}</section>`;
    const m = $('#fa-m');
    $('#fa-xls').onclick = e => excel(u, e.currentTarget, m);
    $('#fa-pass').onclick = async e => {
      const p = prompt('Nueva contraseña para ' + a.nombre + ' (mínimo 6 caracteres):', sugerirPass()); if (p == null) return;
      if (p.length < 6) { m.className = 'cu-msg err'; m.textContent = 'Mínimo 6 caracteres.'; return; }
      e.currentTarget.disabled = true; m.className = 'cu-msg'; m.textContent = 'Cambiando…';
      try{ await B.cambiarPass(u, p); m.textContent = ''; $('#fa-out').innerHTML = credenciales(a.nombre, u, p, 'Contraseña cambiada.'); enlazarCopiar(a.nombre, u, p); }
      catch(x){ console.error(x); m.className = 'cu-msg err'; m.textContent = 'No se ha podido cambiar. Comprueba la conexión.'; }
      e.currentTarget.disabled = false;
    };
    $('#fa-act').onclick = async () => { try{ await B.activo(u, !a.activo); fichaAlumno(u); }catch(x){ console.error(x); m.className='cu-msg err'; m.textContent = 'No se ha podido cambiar.'; } };
    $('#fa-del').onclick = async () => {
      if (prompt(`Se borrarán ${a.nombre}, sus notas y sus accesos. No se puede deshacer.\nEscribe BORRAR para confirmar:`) !== 'BORRAR') return;
      m.className = 'cu-msg'; m.textContent = 'Borrando…';
      try{ await B.borrar(u); location.hash = '#panel'; }catch(x){ console.error(x); m.className='cu-msg err'; m.textContent = 'No se ha podido borrar.'; }
    };
  }catch(e){ console.error(e); app.querySelector('.cu-sec').innerHTML = '<p class="cu-msg err">No se han podido cargar los datos. Comprueba la conexión.</p>'; }
}

/* ---------- Excel ---------- */
function cargaXLSX(){
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
}
async function excel(solo, btn, msg){
  btn.disabled = true; msg.className = 'cu-msg'; msg.textContent = 'Preparando el Excel…';
  try{
    await cargaXLSX();
    let al = (await B.alumnos()).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
    if (solo) al = al.filter(a => a.usuario === solo);
    const datos = [];
    for (const a of al){ const [its, vis] = await Promise.all([B.intentos(a.usuario), B.visitas(a.usuario)]); datos.push({ a, R: resumen(its), its, vis }); }
    const wb = XLSX.utils.book_new();
    const amb = AMBITOS.slice(0,3);
    const num = n => n == null ? '' : Math.round(n*10)/10;
    const fd = d => d ? `${fFecha(d)} ${fHora(d)}` : '';
    const res = [['Alumno','Usuario','Estado','Avisos','Accesos','Último acceso','Minutos en el aula','Actividades hechas', ...amb.map(x=>'Media '+x.nombre), 'Media general']];
    datos.forEach(({a,R,vis}) => res.push([a.nombre, a.usuario, a.activo?'Activo':'De baja', a.avisos?'Sí':'No', a.accesos||0, fd(a.ultimoAcceso), vis.reduce((s,v)=>s+(v.min||0),0), R.acts.length, ...amb.map(x=>num(R.amb[x.id].media)), num(R.general)]));
    const hr = XLSX.utils.aoa_to_sheet(res); hr['!cols'] = res[0].map((t,i)=>({ wch: i===0 ? 28 : Math.max(12, t.length+2) }));
    XLSX.utils.book_append_sheet(wb, hr, 'Resumen');
    const usados = new Set(['Resumen']);
    datos.forEach(({a,R,vis}) => {
      const f = [[a.nombre], [`Usuario: ${a.usuario}`, `Accesos: ${a.accesos||0}`, `Último acceso: ${fd(a.ultimoAcceso)}`], [],
        ['MEDIAS'], ['Ámbito','Media', 'Actividades'], ...amb.map(x => [x.nombre, num(R.amb[x.id].media), R.amb[x.id].acts.length]), ['General', num(R.general), R.acts.length], [],
        ['NOTAS'], ['Ámbito','Tema','Actividad','Tipo','Mejor nota','Última nota','Intentos','Última vez','Todas las notas']];
      amb.forEach(x => {
        const acts = R.amb[x.id].acts.slice().sort((p,q)=>(p.tema?0:1)-(q.tema?0:1) || (p.clase||0)-(q.clase||0));
        let temaPrev = null;
        acts.forEach(ac => {
          f.push([x.nombre, ac.tema ? `${ac.area} · ${ac.temaTitulo}` : 'Retos', ac.titulo, ({reto:'Reto', ficha:'Ficha'})[ac.tipo] || 'Juego', num(ac.mejor), num(ac.ultima.nota), ac.lista.length, fd(ac.ultima.fecha), ac.lista.map(i=>nota1(i.nota)).join(' → ')]);
        });
        const temas = [...new Set(acts.filter(z=>z.tema).map(z=>z.tema))];
        temas.forEach(t => { const g = acts.filter(z=>z.tema===t); f.push([x.nombre, `Media del tema: ${g[0].area} · ${g[0].temaTitulo}`, '', '', num(media(g.map(z=>z.mejor)))]); });
      });
      f.push([], ['ACCESOS'], ['Fecha','Hora','Minutos aprox.']);
      vis.slice().reverse().forEach(v => f.push([fFecha(v.inicio), fHora(v.inicio), v.min||0]));
      const ws = XLSX.utils.aoa_to_sheet(f);
      ws['!cols'] = [{wch:16},{wch:40},{wch:36},{wch:8},{wch:11},{wch:11},{wch:9},{wch:18},{wch:30}];
      let n = a.nombre.replace(/[\\\/\?\*\[\]:]/g,'').slice(0,28) || a.usuario, k = 2, base = n;
      while (usados.has(n)) n = base.slice(0,26) + ' ' + (k++);
      usados.add(n);
      XLSX.utils.book_append_sheet(wb, ws, n);
    });
    const hoy = new Date(); const fn = `Aula Virtual - ${solo ? (al[0]?al[0].nombre:solo) : 'notas y accesos'} - ${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fn.normalize('NFD').replace(/[̀-ͯ]/g,''));
    msg.textContent = 'Excel descargado.';
  }catch(e){ console.error(e); msg.className = 'cu-msg err'; msg.textContent = 'No se ha podido preparar el Excel. Comprueba la conexión.'; }
  btn.disabled = false;
}

/* ---------- conexión con el aula ---------- */
window.AULA = {
  arranca(){
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    pantallaCargando();
    B.estado((u, aviso) => {
      yo = u;
      if (!u){ clearInterval(reloj); pantallaLogin(aviso); return; }
      quitarLogin();
      if (!u.admin) empiezaVisita();
      route();
    });
  },
  ruta(hh){
    if (!yo) return false;
    if (hh === 'notas'){ misNotas(); return true; }
    if (hh === 'panel' && yo.admin){ panel(); return true; }
    if (hh.startsWith('panel-') && yo.admin){ fichaAlumno(decodeURIComponent(hh.slice(6))); return true; }
    return false;
  },
  despues(sec){
    if (!yo || sec !== 'inicio' || (location.hash && location.hash !== '#inicio')) return;
    const app = appEl(); if (app.querySelector('.cu-bar')) return;
    app.insertAdjacentHTML('afterbegin', `<div class="cu-bar"><b>Hola, ${h(yo.nombre.split(' ')[0])}</b>${yo.admin ? '<a href="#panel">Panel del profe</a>' : '<a href="#notas">Mis notas</a>'}<button id="cu-salir">Salir</button></div>`);
    $('#cu-salir').onclick = () => { if (confirm('¿Cerrar la sesión? Tendrás que volver a escribir tu usuario y contraseña.')) { location.hash = ''; B.salir(); } };
    const av = bloqueAvisos(); if (av) app.querySelector('.cu-bar').insertAdjacentHTML('afterend', av);
    const bo = $('#cu-av-on'); if (bo) bo.onclick = () => activarAvisos(bo);
    pintaAviso();
  },
  async notaFicha(r){
    if (!yo) return;
    if (yo.admin){ const el = document.querySelector('.cu-slot'); if (el) el.textContent = 'Has entrado como profe: tu nota no se guarda. Entra con un alumno para probarlo.'; return; }
    const T = TEMAS[r.tema];
    const o = { actividad:'ficha-'+r.tema, tipo:'ficha', titulo:'Ficha: '+T.titulo, ambito:T.ambito, tema:r.tema, temaTitulo:T.titulo, area:T.area, clase:T.clase,
      nota: Math.round(r.aciertos / r.total * 100)/10, aciertos:r.aciertos, total:r.total, conTiempo:true, puntos:0 };
    const pinta = t => { const el = document.querySelector('.cu-slot'); if (el) el.innerHTML = t; };
    pinta('Guardando tu nota…');
    try{ await B.guardarIntento(yo.usuario, o); pinta('Nota guardada en <a href="#notas">Mis notas</a>.'); }
    catch(e){ console.error(e); pinta('No se ha podido guardar la nota (sin conexión).'); }
  },
  async nota(r){
    if (!yo) return;
    if (yo.admin){ setTimeout(() => { const s = document.querySelector('.score'); if (s) s.insertAdjacentHTML('beforeend', '<p class="cu-nota">Has entrado como profe: tu nota no se guarda.</p>'); }, 0); return; }
    const o = { ...infoActividad(r.id), nota: Math.round(r.aciertos / r.total * 100)/10, aciertos:r.aciertos, total:r.total, conTiempo:!!r.conTiempo, puntos:r.puntos||0 };
    const pinta = t => setTimeout(() => { const s = document.querySelector('.score'); if (!s) return; let p = s.querySelector('.cu-nota'); if (!p){ p = document.createElement('p'); p.className = 'cu-nota'; s.appendChild(p); } p.innerHTML = t; }, 0);
    pinta(`Tu nota: ${nota1(o.nota)} / 10 · guardando…`);
    try{ await B.guardarIntento(yo.usuario, o); pinta(`Tu nota: ${nota1(o.nota)} / 10 · guardada en <a href="#notas">Mis notas</a>`); }
    catch(e){ console.error(e); pinta(`Tu nota: ${nota1(o.nota)} / 10 · no se ha podido guardar (sin conexión).`); }
  }
};
})();
