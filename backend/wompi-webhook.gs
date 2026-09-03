/**
 * Lote Scout — Activación automática del plan Pro al recibir un pago de Wompi.
 * Google Apps Script (gratis, sin tarjeta). No requiere Cloud Functions ni plan Blaze.
 *
 * Flujo:
 *   Wompi (pago APPROVED) → doPost → verifica firma → busca usuario por correo
 *   → escribe plan=pro en Firestore → avisa al cliente por correo.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURACIÓN (Proyecto → ⚙ Configuración del proyecto → Propiedades del script)
 *   WOMPI_EVENTS_SECRET  Secreto para eventos (Wompi → Ajustes → Llaves). NO es la llave privada.
 *   FIREBASE_PROJECT_ID  analisis-de-lotes
 *   SA_EMAIL             correo de la cuenta de servicio (…@….iam.gserviceaccount.com)
 *   SA_PRIVATE_KEY       campo "private_key" del JSON de la cuenta de servicio
 *   ADMIN_EMAIL          tu correo, para avisos cuando un pago no encuentre usuario
 *
 * ⚠ SA_PRIVATE_KEY es un secreto real: va SOLO en Propiedades del script.
 *   Nunca en el repositorio ni en un chat.
 * ---------------------------------------------------------------------------
 */

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ Webhook ============================ */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (!verifyChecksum(body)) {
      log_('Firma inválida', JSON.stringify(body).slice(0, 400));
      return _json({ ok: false, error: 'firma invalida' });
    }

    var t = body.data && body.data.transaction;
    if (!t) return _json({ ok: true, skipped: 'sin transaccion' });

    // Solo activamos con pagos efectivamente aprobados.
    if (t.status !== 'APPROVED') return _json({ ok: true, skipped: t.status });

    var email = String(t.customer_email || '').trim().toLowerCase();
    if (!email) { notifyAdmin_('Pago aprobado sin correo del comprador', t); return _json({ ok: true, pending: true }); }

    var uid = findUidByEmail_(email);
    if (!uid) {
      // Pagó con un correo distinto al de su cuenta: queda para activación manual.
      notifyAdmin_('Pago aprobado sin usuario coincidente: ' + email, t);
      return _json({ ok: true, pending: true });
    }

    setPlanPro_(uid, t);
    notifyCustomer_(email);
    return _json({ ok: true, uid: uid });

  } catch (err) {
    log_('Error', String(err));
    // Devolvemos 200 igual: si respondemos error, Wompi reintenta hasta 3 veces en 24 h.
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() { return _json({ ok: true, service: 'Lote Scout · Wompi webhook' }); }

/* ==================== Verificación de la firma ==================== */
function verifyChecksum(body) {
  var secret = prop('WOMPI_EVENTS_SECRET');
  if (!secret) throw new Error('Falta WOMPI_EVENTS_SECRET');

  var props = (body.signature && body.signature.properties) || [];
  var concat = '';
  for (var i = 0; i < props.length; i++) concat += getPath_(body.data, props[i]);
  concat += body.timestamp;
  concat += secret;

  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, concat, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  return hex === String(body.signature.checksum || '').toLowerCase();
}

function getPath_(obj, path) {
  var parts = String(path).split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) { if (cur == null) return ''; cur = cur[parts[i]]; }
  return cur == null ? '' : String(cur);
}

/* ==================== Acceso a Firestore (REST) ==================== */
function getToken_() {
  var email = prop('SA_EMAIL');
  var key = normalizePrivateKey_(prop('SA_PRIVATE_KEY'));
  if (!email || !key) throw new Error('Falta SA_EMAIL o SA_PRIVATE_KEY');

  var now = Math.floor(Date.now() / 1000);
  var b64 = function (s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); };
  var header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = b64(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  var toSign = header + '.' + claim;
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign, key)).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: toSign + '.' + sig },
    muteHttpExceptions: true
  });
  var tok = JSON.parse(res.getContentText()).access_token;
  if (!tok) throw new Error('No se obtuvo token: ' + res.getContentText().slice(0, 200));
  return tok;
}

function findUidByEmail_(email) {
  var pid = prop('FIREBASE_PROJECT_ID');
  if (!pid) throw new Error('Falta FIREBASE_PROJECT_ID');
  var url = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents:runQuery';
  var q = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
      limit: 1
    }
  };
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getToken_() },
    payload: JSON.stringify(q), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var txt = res.getContentText();
  // Antes cualquier error se confundia con 'no encontrado'. Ahora se ve.
  if (code !== 200) throw new Error('Firestore respondio ' + code + ': ' + txt.slice(0, 300));
  var arr = JSON.parse(txt);
  if (!Array.isArray(arr)) throw new Error('Respuesta inesperada de Firestore: ' + txt.slice(0, 300));
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].document && arr[i].document.name) {
      var n = arr[i].document.name;
      return n.substring(n.lastIndexOf('/') + 1);
    }
  }
  return null;
}

function setPlanPro_(uid, t) {
  var pid = prop('FIREBASE_PROJECT_ID');
  var url = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents/users/' + uid
    + '?updateMask.fieldPaths=plan&updateMask.fieldPaths=planDesde&updateMask.fieldPaths=ultimaTransaccion';
  var payload = {
    fields: {
      plan: { stringValue: 'pro' },
      planDesde: { timestampValue: new Date().toISOString() },
      ultimaTransaccion: { stringValue: String(t.id || '') }
    }
  };
  var res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getToken_() },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Firestore: ' + res.getContentText().slice(0, 200));
}

/* ========================== Avisos ========================== */
function notifyCustomer_(email) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Tu plan Pro de Lote Scout ya está activo',
      body: 'Listo, tu pago quedó confirmado y tu plan Pro está activo.\n\n' +
            'Recarga la app y ya vas a ver el botón "Analizar zona":\n' +
            'https://baronaarchitect-collab.github.io/lote-scout/\n\n' +
            'Aquí están tus primeros pasos y tres formas de rentabilizarlo:\n' +
            'https://baronaarchitect-collab.github.io/lote-scout/bienvenido.html\n\n' +
            '— Lote Scout'
    });
  } catch (e) { log_('No se pudo avisar al cliente', String(e)); }
}

function notifyAdmin_(asunto, t) {
  var admin = prop('ADMIN_EMAIL');
  if (!admin) return;
  try {
    MailApp.sendEmail({
      to: admin,
      subject: '[Lote Scout] ' + asunto,
      body: 'Revisa y activa manualmente si corresponde.\n\n' +
            'Correo del comprador: ' + (t.customer_email || '—') + '\n' +
            'Transacción: ' + (t.id || '—') + '\n' +
            'Monto (centavos): ' + (t.amount_in_cents || '—') + '\n' +
            'Referencia: ' + (t.reference || '—') + '\n'
    });
  } catch (e) { log_('No se pudo avisar al admin', String(e)); }
}

function log_(titulo, detalle) { console.log(titulo + ' :: ' + detalle); }

/* ==================== Prueba manual ====================
   Ejecuta esta función desde el editor para comprobar que la conexión con
   Firestore funciona, antes de conectar el webhook real.
   Cambia el correo por uno que ya exista en tu app.                        */
function probarConexion() {
  var email = 'baronajuandavid@gmail.com';
  var uid = findUidByEmail_(email.toLowerCase());
  console.log(uid ? ('OK · usuario encontrado: ' + uid) : 'No se encontró usuario con ese correo');
}

/* ============ Normalizacion de la llave privada ============
   El campo de Propiedades del script es de una sola linea, asi que la llave PEM
   suele llegar deformada. Esto acepta las formas usuales de pegado: con \n
   literales, con comillas envolventes, o con los saltos aplastados a espacios. */
function normalizePrivateKey_(raw) {
  var k = String(raw || '').trim();
  if ((k.charAt(0) === '"' && k.charAt(k.length - 1) === '"') ||
      (k.charAt(0) === "'" && k.charAt(k.length - 1) === "'")) {
    k = k.substring(1, k.length - 1);
  }
  k = k.replace(/\n/g, '\n').replace(/\r/g, '');
  if (k.indexOf('\n') === -1) {
    var b = k.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
             .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
             .replace(/\s+/g, '');
    var lines = b.match(/.{1,64}/g) || [];
    k = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  }
  if (k.indexOf('-----BEGIN') !== 0) {
    throw new Error('SA_PRIVATE_KEY no parece una llave PEM. Debe empezar con -----BEGIN PRIVATE KEY-----');
  }
  return k;
}

/* Diagnostico: revisa la llave SIN mostrarla. Ejecutalo si algo falla. */
function diagnosticarLlave() {
  var raw = prop('SA_PRIVATE_KEY');
  if (!raw) { console.log('FALTA: no existe la propiedad SA_PRIVATE_KEY'); return; }
  console.log('Longitud del valor guardado: ' + raw.length + ' caracteres');
  console.log('Empieza con comillas: ' + (raw.trim().charAt(0) === '"'));
  console.log('Contiene barra-n literales: ' + (raw.indexOf('\n') !== -1));
  try {
    var k = normalizePrivateKey_(raw);
    console.log('Lineas tras normalizar: ' + k.split('\n').length);
    Utilities.computeRsaSha256Signature('prueba', k);
    console.log('RESULTADO: la llave es valida y puede firmar.');
  } catch (e) {
    console.log('RESULTADO: la llave NO sirve -> ' + e.message);
    console.log('Vuelve a copiar el campo private_key del JSON, completo, con BEGIN y END.');
  }
  console.log('SA_EMAIL: ' + (prop('SA_EMAIL') || 'FALTA'));
  console.log('FIREBASE_PROJECT_ID: ' + (prop('FIREBASE_PROJECT_ID') || 'FALTA'));
}

/* Diagnostico: lista lo que hay realmente en la coleccion users. */
function diagnosticarConsulta() {
  var pid = prop('FIREBASE_PROJECT_ID');
  console.log('FIREBASE_PROJECT_ID = ' + pid);
  var url = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents/users?pageSize=5';
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + getToken_() }, muteHttpExceptions: true });
  console.log('HTTP ' + res.getResponseCode());
  console.log(res.getContentText().slice(0, 1500));
}
