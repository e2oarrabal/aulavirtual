// Envía avisos/aviso.json a todos los móviles con los avisos activados (lo ejecuta GitHub Actions).
const fs = require('fs');
const admin = require('firebase-admin');
if (!process.env.FIREBASE_SA) { console.log('Falta el secreto FIREBASE_SA: no se envía nada.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
(async () => {
  const a = JSON.parse(fs.readFileSync(__dirname + '/aviso.json', 'utf8'));
  if (!a.enviar) { console.log('Aviso marcado como no enviar.'); return; }
  const hecho = db.collection('ajustes').doc('ultimoAviso');
  const prev = await hecho.get();
  if (prev.exists && prev.data().id === a.id) { console.log('Este aviso ya se envió:', a.id); return; }
  const snap = await db.collectionGroup('avisos').get();
  const docs = snap.docs.filter(d => d.data().token);
  console.log('Móviles con avisos:', docs.length);
  let ok = 0, fallos = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    const r = await admin.messaging().sendEachForMulticast({
      tokens: lote.map(d => d.data().token),
      data: { titulo: a.titulo, texto: a.texto, url: a.url || '', id: a.id },
      webpush: { headers: { Urgency: 'high', TTL: String(3 * 24 * 3600) } }
    });
    for (let k = 0; k < r.responses.length; k++) {
      const x = r.responses[k];
      if (x.success) ok++;
      else { fallos++; const c = x.error && x.error.code || '';
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(c)) await lote[k].ref.delete(); }
    }
  }
  await hecho.set({ id: a.id, enviado: admin.firestore.FieldValue.serverTimestamp(), ok, fallos });
  console.log(`Enviados: ${ok} · fallidos: ${fallos}`);
})().catch(e => { console.error(e); process.exit(1); });
