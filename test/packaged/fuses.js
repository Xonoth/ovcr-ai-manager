// Test de COMPORTEMENT des fuses (phase 3, P2) : npm run test:fuses
//
// On ne lance jamais le vrai `.exe` de dist/ (il utilise le vrai profil).
// À la place, on fabrique dans un dossier temporaire une app JETABLE avec le
// même Electron que le projet, packagée comme le fait electron-packager
// (app.asar + empreinte ELECTRONASAR inscrite dans le .exe), puis on applique
// le MÊME jeu de fuses que `npm run dist` (scripts/fuses.js).
//
// Chaque sonde est d'abord lancée SANS fuses (témoin : la faille existe, donc
// la sonde sait la voir), puis AVEC (la faille est fermée). Aucun réseau.
//
// Phase 3, P5 : l'app jetable embarque aussi les VRAIS app-protocol.js et
// legacy-storage.js (+ la page du pont) et rejoue, avec les fuses, trois
// lancements : une 1.8.0 (interface file://) écrit ses préférences ; une 1.9.0
// sert l'interface en app:// (worker et fetch depuis app.asar.unpacked, comme
// Monaco) et relit/écrit l'ancien localStorage par le pont ; un dernier
// lancement file:// relit ce que le pont a écrit (retour arrière). Témoin :
// fuse GrantFileProtocolExtraPrivileges coupé, le pont ne marche plus.
//
// Lancé par Node (pas par Electron). Durée : ~1 minute (copie d'Electron).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const electronDist = path.dirname(require('electron')); // chemin d'electron.exe
const fuses = require('../../scripts/fuses');

const asar = require('../../node_modules/@electron/packager/node_modules/@electron/asar/lib/asar.js');
const { resedit } = require('@electron/packager/resedit');

const ROOT = path.join(__dirname, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-fuse-probe-'));
const appDir = path.join(root, 'app');
const exe = path.join(appDir, 'probe.exe');
const resources = path.join(appDir, 'resources');
const appAsar = path.join(resources, 'app.asar');
const out = path.join(root, 'markers.txt');
const userData = path.join(root, 'userdata');

let total = 0, failed = 0;
function check(name, ok, detail) {
  total++;
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : '\n      ' + detail}`);
}

// --- Fabrication de l'app jetable -------------------------------------------

// main.js : écrit un marqueur puis quitte. Le texte du marqueur est un
// paramètre, pour fabriquer des variantes « modifiées » de même taille.
// Avec OVCR_PROBE_WINDOW=1, il ouvre en plus une fenêtre cachée dont la page
// (dans app.asar) charge un script DÉPAQUETÉ (app.asar.unpacked), exactement
// comme l'interface charge Monaco.
function mainJs(marker) {
  return `const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.env.OVCR_PROBE_OUT;
app.setPath('userData', process.env.OVCR_PROBE_USERDATA);
fs.appendFileSync(out, '${marker}\\n');
// Témoin de NODE_OPTIONS : une des rares options qu'Electron accepte encore
// dans une app packagée (--require y est déjà refusé).
fs.appendFileSync(out, 'hs=' + require('http').maxHeaderSize + '\\n');
if (process.env.OVCR_PROBE_P5) {
  // Phase 3, P5 : vrais modules de l'app (copiés à côté de ce main.js).
  const { protocol } = require('electron');
  const appProtocol = require('./app-protocol');
  const legacyStorage = require('./legacy-storage');
  protocol.registerSchemesAsPrivileged([{ scheme: appProtocol.APP_SCHEME, privileges: { ...appProtocol.SCHEME_PRIVILEGES } }]);
  const step = process.env.OVCR_PROBE_P5;
  const js = (win, code) => win.webContents.executeJavaScript(code);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      if (step === 'old-write') {
        await win.loadFile(path.join(__dirname, 'old.html'));
        fs.appendFileSync(out, 'p5-old-write=' + await js(win, "localStorage.setItem('ide_w', '321px'); location.protocol") + '\\n');
      } else if (step === 'old-read') {
        await win.loadFile(path.join(__dirname, 'old.html'));
        fs.appendFileSync(out, 'p5-old-read=' + await js(win, "String(localStorage.getItem('ai_accounts'))") + '\\n');
      } else {
        protocol.handle(appProtocol.APP_SCHEME, appProtocol.createAppProtocolHandler({ appRoot: __dirname, readFile: fs.promises.readFile }));
        await win.loadURL(appProtocol.INDEX_URL);
        let title = '';
        for (let i = 0; i < 100 && !/^p5:/.test(title); i++) { await new Promise(r => setTimeout(r, 50)); title = await js(win, 'document.title'); }
        fs.appendFileSync(out, 'p5-ui=' + title + '|' + await js(win, 'location.origin') + '\\n');
        fs.appendFileSync(out, 'p5-main=' + await js(win, "fetch('app://ovcr/main.js').then(r => r.status, () => 'erreur')") + '\\n');
        const bridge = legacyStorage.createLegacyStorageBridge({ BrowserWindow, timeoutMs: 5000 });
        try {
          fs.appendFileSync(out, 'p5-bridge-read=' + (await bridge.read(['ide_w'])).ide_w + '\\n');
          await bridge.write({ ai_accounts: 'revert-ok' });
          fs.appendFileSync(out, 'p5-bridge-write=ok\\n');
        } catch (e) { fs.appendFileSync(out, 'p5-bridge-error=' + e.message + '\\n'); }
      }
    } catch (e) { fs.appendFileSync(out, 'p5-error=' + e.message + '\\n'); }
    win.destroy();
    // Fermeture normale (et non app.exit) : le localStorage est écrit sur le disque.
    setTimeout(() => app.quit(), 200);
  });
} else if (process.env.OVCR_PROBE_WINDOW) {
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    await win.loadFile(path.join(__dirname, 'index.html'));
    fs.appendFileSync(out, 'renderer=' + await win.webContents.executeJavaScript('document.title') + '\\n');
    app.exit(0);
  }).catch(e => { fs.appendFileSync(out, 'renderer-error=' + e.message + '\\n'); app.exit(1); });
} else {
  app.exit(0);
}
`;
}
function writeSource(dir, marker) {
  fs.mkdirSync(path.join(dir, 'unpacked'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ovcr-fuse-probe', version: '1.0.0', main: 'main.js' }));
  fs.writeFileSync(path.join(dir, 'main.js'), mainJs(marker));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>vide</title><script src="unpacked/probe.js"></script>');
  fs.writeFileSync(path.join(dir, 'unpacked', 'probe.js'), "document.title = 'unpacked-ok';\n");
  // Phase 3, P5. index.html sert aussi d'interface app:// (seul .html servi) :
  // renderer/sonde.js n'agit qu'en app://, pour ne pas gêner la sonde « window ».
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; worker-src \'self\'; connect-src \'self\'">'
    + '<title>vide</title><script src="unpacked/probe.js"></script><script src="renderer/sonde.js"></script>');
  fs.writeFileSync(path.join(dir, 'old.html'), '<!doctype html><meta charset="utf-8"><title>ancienne interface</title>');
  fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'renderer', 'sonde.js'), "if (location.protocol === 'app:') { const w = new Worker('node_modules/monaco-editor/min/vs/p5-worker.js');"
    + " w.onmessage = e => { document.title = 'p5:' + e.data; }; w.onerror = () => { document.title = 'p5:worker-error'; }; }\n");
  const vs = path.join(dir, 'node_modules', 'monaco-editor', 'min', 'vs');
  fs.mkdirSync(vs, { recursive: true });
  fs.writeFileSync(path.join(vs, 'p5-worker.js'), "fetch('p5.nls.js').then(r => r.text()).then(t => postMessage('fetch-' + t.trim()), () => postMessage('fetch-error'));\n");
  fs.writeFileSync(path.join(vs, 'p5.nls.js'), 'ok\n');
  for (const f of ['app-protocol.js', 'legacy-storage.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'legacy-bridge'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'legacy-bridge', 'legacy-storage.html'), path.join(dir, 'legacy-bridge', 'legacy-storage.html'));
}
// Même option que `asar.unpack: '**/monaco-editor/**'` de npm run dist (+ le dossier de la sonde « window »).
const pack = (src, dest) => asar.createPackageWithOptions(src, dest, { unpack: '{**/unpacked/**,**/monaco-editor/**}' });

async function build() {
  console.log('▶ Préparation : copie d\'Electron ' + require('electron/package.json').version + ' dans ' + root);
  fs.cpSync(electronDist, appDir, { recursive: true });
  fs.renameSync(path.join(appDir, 'electron.exe'), exe);
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
  writeSource(path.join(root, 'src'), 'app');
  await pack(path.join(root, 'src'), appAsar);
  // Même ressource que celle qu'écrit electron-packager (win32.js -> resedit).
  await resedit(exe, { asarIntegrity: { 'resources\\app.asar': { algorithm: 'SHA256', hash: fuses.asarHeaderHash(appAsar) } } });
}

// --- Sondes -----------------------------------------------------------------

function launch(args = [], env = {}, binary = exe) {
  fs.rmSync(out, { force: true });
  // Variables RETIRÉES, pas vidées : pour Electron, ELECTRON_RUN_AS_NODE=''
  // compte comme définie (le binaire témoin tournerait en mode Node).
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|ELECTRON_ENABLE_LOGGING)$/i.test(k)) delete base[k];
  const r = spawnSync(binary, args, {
    env: { ...base, ...env, OVCR_PROBE_OUT: out, OVCR_PROBE_USERDATA: userData },
    encoding: 'utf8', timeout: 30000, windowsHide: true
  });
  const markers = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  return { markers, status: r.status, output: (r.stdout || '') + (r.stderr || ''), error: r.error };
}
const describe = r => `marqueurs [${r.markers.join(', ')}], code ${r.status}${r.error ? ', ' + r.error.message : ''}, sortie : ${r.output.trim().slice(-300) || '(vide)'}`;

const probes = {
  start: () => launch(),
  window: () => launch([], { OVCR_PROBE_WINDOW: '1' }),
  runAsNode: () => launch(['-e', "require('fs').appendFileSync(process.env.OVCR_PROBE_OUT, 'node\\n')"], { ELECTRON_RUN_AS_NODE: '1' }),
  nodeOptions: () => launch([], { NODE_OPTIONS: '--max-http-header-size=12345' }),
  inspect: () => launch(['--inspect=0']),
  // Archive remplacée par une autre (en-tête différent) sans toucher au .exe.
  swappedAsar: async () => {
    writeSource(path.join(root, 'src-swapped'), 'swapped-asar');
    const saved = appAsar + '.orig';
    fs.renameSync(appAsar, saved);
    try {
      await pack(path.join(root, 'src-swapped'), appAsar);
      return launch();
    } finally { fs.rmSync(appAsar, { force: true }); fs.renameSync(saved, appAsar); }
  },
  // Contenu d'un fichier modifié dans l'archive, en-tête intact (même taille).
  patchedFile: () => {
    const original = fs.readFileSync(appAsar);
    const at = original.indexOf(Buffer.from("'app\\n'"));
    if (at < 0) throw new Error('marqueur introuvable dans app.asar');
    const patched = Buffer.from(original);
    Buffer.from("'apq\\n'").copy(patched, at);
    fs.writeFileSync(appAsar, patched);
    try { return launch(); } finally { fs.writeFileSync(appAsar, original); }
  },
  // Plus d'app.asar, mais un dossier resources/app posé à côté.
  looseFolder: () => {
    const saved = appAsar + '.orig';
    fs.renameSync(appAsar, saved);
    writeSource(path.join(resources, 'app'), 'loose-folder');
    try { return launch(); } finally {
      fs.rmSync(path.join(resources, 'app'), { recursive: true, force: true });
      fs.renameSync(saved, appAsar);
    }
  }
};

async function main() {
  await build();

  console.log('\n▶ Témoins, binaire SANS fuses (chaque faille doit être visible)');
  let r = await probes.start();
  check('l\'app jetable démarre', r.markers.includes('app'), describe(r));
  r = await probes.window();
  check('une page de l\'archive charge un script dépaqueté', r.markers.includes('renderer=unpacked-ok'), describe(r));
  r = await probes.runAsNode();
  check('ELECTRON_RUN_AS_NODE exécute du code Node', r.markers.includes('node') && !r.markers.includes('app'), describe(r));
  r = await probes.nodeOptions();
  check('NODE_OPTIONS modifie le runtime Node', r.markers.includes('hs=12345'), describe(r));
  r = await probes.inspect();
  check('--inspect ouvre un débogueur', /Debugger listening/.test(r.output), describe(r));
  r = await probes.swappedAsar();
  check('une archive remplacée est chargée', r.markers.includes('swapped-asar'), describe(r));
  r = await probes.patchedFile();
  check('un fichier modifié dans l\'archive est exécuté', r.markers.includes('apq'), describe(r));
  r = await probes.looseFolder();
  check('un dossier resources/app est chargé', r.markers.includes('loose-folder'), describe(r));

  console.log('\n▶ Application des fuses (scripts/fuses.js, comme npm run dist)');
  const problems = [...await fuses.applyFuses(exe), ...fuses.checkAsarIntegrity(exe)];
  check('fuses appliqués, relus et empreinte d\'app.asar présente', problems.length === 0, problems.join(' ; '));
  const sourceProblems = await fuses.checkFuses(path.join(electronDist, 'electron.exe'));
  check('l\'Electron de node_modules n\'est pas modifié (dev et tests intacts)', sourceProblems.length > 0, 'fuses du projet trouvés sur le binaire de développement');

  console.log('\n▶ Binaire AVEC fuses');
  r = await probes.start();
  check('l\'app démarre (intégrité d\'app.asar acceptée)', r.markers.includes('app') && r.status === 0, describe(r));
  r = await probes.window();
  check('une page de l\'archive charge un script dépaqueté (cas de Monaco)', r.markers.includes('renderer=unpacked-ok') && r.status === 0, describe(r));
  r = await probes.runAsNode();
  check('ELECTRON_RUN_AS_NODE ignoré : pas de code Node, l\'app démarre normalement', !r.markers.includes('node') && r.markers.includes('app'), describe(r));
  r = await probes.nodeOptions();
  check('NODE_OPTIONS ignoré', !r.markers.includes('hs=12345') && r.markers.includes('app'), describe(r));
  r = await probes.inspect();
  check('--inspect ignoré', !/Debugger listening/.test(r.output) && r.markers.includes('app'), describe(r));
  r = await probes.swappedAsar();
  check('archive remplacée : refus de démarrer', r.markers.length === 0 && r.status !== 0, describe(r));
  r = await probes.patchedFile();
  check('fichier modifié dans l\'archive : refus d\'exécuter', !r.markers.includes('apq') && r.status !== 0, describe(r));
  r = await probes.looseFolder();
  check('dossier resources/app : ignoré', r.markers.length === 0, describe(r));
  r = await probes.start();
  check('l\'app démarre toujours après ces essais', r.markers.includes('app') && r.status === 0, describe(r));

  console.log('\n▶ Phase 3, P5 : interface app:// et pont file://, binaire AVEC fuses');
  const unpackedWorker = path.join(resources, 'app.asar.unpacked', 'node_modules', 'monaco-editor', 'min', 'vs', 'p5-worker.js');
  check('faux Monaco bien dépaqueté (app.asar.unpacked), comme le vrai', fs.existsSync(unpackedWorker), unpackedWorker);
  const p5 = (step, binary) => launch([], { OVCR_PROBE_P5: step }, binary);
  r = p5('old-write');
  check('1.8.0 (interface file://) écrit ses préférences', r.markers.includes('p5-old-write=file:'), describe(r));
  r = p5('new');
  check('interface servie en app://ovcr depuis l\'archive ; worker et fetch depuis app.asar.unpacked (cas de Monaco)', r.markers.includes('p5-ui=p5:fetch-ok|app://ovcr'), describe(r));
  check('app:// refuse le code du main (404)', r.markers.includes('p5-main=404'), describe(r));
  check('pont file:// : préférences de la version précédente relues', r.markers.includes('p5-bridge-read=321px'), describe(r));
  check('pont file:// : écriture acceptée', r.markers.includes('p5-bridge-write=ok'), describe(r));
  r = p5('old-read');
  check('retour arrière : écrit par le pont, relu au lancement suivant en file:// (comme la 1.0.4)', r.markers.includes('p5-old-read=revert-ok'), describe(r));

  // Témoin pour « P5 bis » : sans GrantFileProtocolExtraPrivileges, le pont
  // ne marche plus (page file:// illisible dans l'archive, localStorage refusé).
  const exeNoGrant = path.join(appDir, 'probe-sans-grant.exe');
  fs.copyFileSync(exe, exeNoGrant);
  const lib = require('@electron/fuses');
  await lib.flipFuses(exeNoGrant, { version: lib.FuseVersion.V1, [lib.FuseV1Options.GrantFileProtocolExtraPrivileges]: false });
  r = p5('new', exeNoGrant);
  check('témoin : fuse GrantFileProtocolExtraPrivileges coupé -> app:// marche toujours', r.markers.includes('p5-ui=p5:fetch-ok|app://ovcr'), describe(r));
  check('témoin : fuse GrantFileProtocolExtraPrivileges coupé -> le pont file:// échoue (à retirer avant de couper ce fuse)', r.markers.some(m => m.startsWith('p5-bridge-error=')) && !r.markers.includes('p5-bridge-write=ok'), describe(r));
}

main().catch(err => { failed++; total++; console.log('  ✖ erreur : ' + (err && err.stack || err)); })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { console.log('  (dossier temporaire non supprimé : ' + root + ' — ' + e.code + ')'); }
    console.log(`\n${total - failed}/${total} vérifications des fuses réussies`);
    process.exitCode = failed ? 1 : 0;
  });

