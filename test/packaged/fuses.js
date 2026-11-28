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
// Lancé par Node (pas par Electron). Durée : ~1 minute (copie d'Electron).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const electronDist = path.dirname(require('electron')); // chemin d'electron.exe
const fuses = require('../../scripts/fuses');

const asar = require('../../node_modules/@electron/packager/node_modules/@electron/asar/lib/asar.js');
const { resedit } = require('@electron/packager/resedit');

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
if (process.env.OVCR_PROBE_WINDOW) {
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
}
// Même option que `--asar.unpack=**/monaco-editor/**` de npm run dist.
const pack = (src, dest) => asar.createPackageWithOptions(src, dest, { unpack: '**/unpacked/**' });

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

function launch(args = [], env = {}) {
  fs.rmSync(out, { force: true });
  // Variables RETIRÉES, pas vidées : pour Electron, ELECTRON_RUN_AS_NODE=''
  // compte comme définie (le binaire témoin tournerait en mode Node).
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|ELECTRON_ENABLE_LOGGING)$/i.test(k)) delete base[k];
  const r = spawnSync(exe, args, {
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
}

main().catch(err => { failed++; total++; console.log('  ✖ erreur : ' + (err && err.stack || err)); })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { console.log('  (dossier temporaire non supprimé : ' + root + ' — ' + e.code + ')'); }
    console.log(`\n${total - failed}/${total} vérifications des fuses réussies`);
    process.exitCode = failed ? 1 : 0;
  });

