// Mesures de PERFORMANCE (lot 7) — pas un test « réussi/échoué » au sens
// fonctionnel : relève la mémoire et vérifie l'absence de FUITE (processus,
// webContents, tas JavaScript de l'interface) quand on ouvre et ferme des
// panneaux en boucle. Pages de service FACTICES servies localement (aucun
// réseau) : la mémoire d'un vrai service IA est bien plus élevée — seules les
// tendances et les écarts comptent ici.
//
// Lancement seul : npx electron test/integration/perf.js

const path = require('path');
const fs = require('fs');
const { app, session, webContents } = require('electron');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const CYCLES = Number(process.env.OVCR_PERF_CYCLES || 30);
const mb = b => Math.round(b / 1024 / 1024);

scenario(`Performance : ${CYCLES} ouvertures/fermetures de panneaux`, {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
  }
}, async ({ js, check, delay, waitFor }) => {
  // Page factice un peu lourde (1 Mo de DOM) pour rendre une fuite visible.
  const page = '<!doctype html><title>faux</title><div id="ok">' + 'x'.repeat(1024 * 1024) + '</div>';
  for (const p of ['persist:profil_1', 'persist:profil_2']) {
    session.fromPartition(p).protocol.handle('https', () => new Response(page, { headers: { 'content-type': 'text/html' } }));
  }
  const metrics = () => {
    const m = app.getAppMetrics();
    return { procs: m.length, totalMb: Math.round(m.reduce((s, x) => s + x.memory.workingSetSize, 0) / 1024), guests: webContents.getAllWebContents().filter(w => w.getType() === 'webview').length };
  };
  const heap = async () => { await js('window.gc ? gc() : 0; true'); return mb(await js('performance.memory.usedJSHeapSize')); };
  const listeners = () => js('document.querySelectorAll("#accountsList *").length');

  const loaded = (n) => waitFor(() => js(`!!document.querySelector("#pane${n} webview") && document.querySelector("#pane${n} .pane-loading").hidden`), 15000, 'chargement panneau ' + n);

  await delay(1000);
  const base = metrics();
  const baseHeap = await heap();
  console.log(`  · départ : ${base.procs} processus, ${base.totalMb} Mo, ${base.guests} webview, tas interface ${baseHeap} Mo`);

  // 1 panneau ouvert (référence du DOM prise ici : la pastille « compte
  // actif » apparaît au premier service ouvert)
  await js(`openService('acc_1', 'claude'); true`); await loaded(1);
  await delay(800);
  const one = metrics();
  const baseNodes = await listeners();
  console.log(`  · 1 panneau : ${one.procs} processus, ${one.totalMb} Mo (+${one.totalMb - base.totalMb} Mo)`);

  // Vue scindée, 2 panneaux, puis retour en vue simple (panneau 2 caché, vivant)
  await js(`setLayout(2, document.querySelector('[data-layout="2"]')); openService('acc_2', 'chatgpt'); true`); await loaded(2);
  await delay(800);
  const two = metrics();
  await js(`setLayout(1, document.querySelector('[data-layout="1"]')); true`);
  await delay(800);
  const hidden = metrics();
  console.log(`  · 2 panneaux : ${two.totalMb} Mo ; panneau 2 caché (vue simple) : ${hidden.totalMb} Mo, ${hidden.guests} webview vivantes`);
  await js('closePane2(); true');
  await delay(1500);
  const closed2 = metrics();
  console.log(`  · après « Fermer le panneau 2 » : ${closed2.totalMb} Mo, ${closed2.guests} webview`);
  check('« Fermer le panneau 2 » détruit bien la webview cachée', closed2.guests === 1, closed2);

  // Boucle : remplacer le service du panneau 1, CYCLES fois.
  const t0 = Date.now();
  for (let i = 0; i < CYCLES; i++) {
    await js(`openService('acc_${1 + (i % 2)}', '${i % 2 ? 'gemini' : 'claude'}'); true`);
    await loaded(1);
  }
  const perOpen = Math.round((Date.now() - t0) / CYCLES);
  await delay(2000);
  const after = metrics();
  const afterHeap = await heap();
  const afterNodes = await listeners();
  console.log(`  · après ${CYCLES} remplacements : ${after.procs} processus, ${after.totalMb} Mo, ${after.guests} webview, tas interface ${afterHeap} Mo, ~${perOpen} ms/ouverture`);

  check('aucune webview orpheline (une seule vivante)', after.guests === 1, after);
  check('nombre de processus revenu au niveau « 1 panneau »', after.procs <= one.procs + 1, { one: one.procs, after: after.procs });
  check(`tas JS de l'interface stable (+${afterHeap - baseHeap} Mo, seuil 15 Mo)`, afterHeap - baseHeap < 15, { baseHeap, afterHeap });
  check('DOM de la liste des comptes stable', afterNodes === baseNodes, { baseNodes, afterNodes });
  check(`mémoire totale contenue (+${after.totalMb - one.totalMb} Mo vs 1 panneau, seuil 150 Mo)`, after.totalMb - one.totalMb < 150, { one: one.totalMb, after: after.totalMb });

  // Coût du tick des cooldowns (1 s) : signature des états seule.
  const tick = await js(`(() => { const t = performance.now(); for (let i = 0; i < 1000; i++) OVCRCooldowns.signature([{cooldowns:{a:Date.now()+5e6,b:0,c:1,d:2,e:3,f:4,g:5,h:6,i:7}}, {cooldowns:{a:1}}], Date.now()); return (performance.now() - t) / 1000; })()`);
  console.log(`  · tick des cooldowns : ~${(tick * 1000).toFixed(1)} µs par seconde (2 comptes)`);
  check('tick des cooldowns négligeable (< 0,5 ms)', tick < 0.5, tick);
});
