// Fuses Electron (phase 3, P2) : durcissement du binaire PACKAGÉ.
//
// Les fuses sont des octets écrits dans l'exécutable lui-même ; Electron les
// lit au démarrage, avant tout code JS. Ils ne concernent que le `.exe` de
// `dist/` : `npm start` et les tests utilisent le binaire d'Electron de
// node_modules, qui n'est jamais modifié.
//
// Lancé par `npm run dist` APRÈS electron-packager : applique WANTED, relit
// le binaire et échoue (code 1) si l'état obtenu diffère, ou si l'empreinte
// d'app.asar attendue par la validation d'intégrité manque dans le `.exe`
// (l'app refuserait alors de démarrer).
//
// Usage : node scripts/fuses.js [chemin\vers\app.exe]   (défaut : build de dist/)
//         node scripts/fuses.js --check [chemin]         (relecture seule)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Un fuse par ligne, TOUS explicites : si une future version d'Electron en
// ajoute un, l'application échoue (strictlyRequireAllFuses) au lieu de garder
// une valeur par défaut sans qu'on l'ait décidé.
const WANTED = Object.freeze({
  // Plus de « .exe utilisé comme Node.js » (ELECTRON_RUN_AS_NODE=1).
  RunAsNode: false,
  // P3, décision de l'utilisateur, pas encore prise : les cookies des sessions
  // restent en clair. L'activer est irréversible (voir PHASE-3.md §3 P3).
  EnableCookieEncryption: false,
  // NODE_OPTIONS ignoré (pas d'injection de --require au lancement).
  EnableNodeOptionsEnvironmentVariable: false,
  // --inspect / --inspect-brk ignorés : le `.exe` n'est plus débogable.
  EnableNodeCliInspectArguments: false,
  // Refuse de démarrer si app.asar a été modifié (empreinte inscrite dans le
  // `.exe` par electron-packager, ressource ELECTRONASAR).
  EnableEmbeddedAsarIntegrityValidation: true,
  // Ne charge l'app que depuis app.asar (pas de dossier resources/app posé à côté).
  OnlyLoadAppFromAsar: true,
  // Valeur par défaut d'Electron : aucun snapshot V8 propre au processus principal.
  LoadBrowserProcessSpecificV8Snapshot: false,
  // L'interface est servie en file:// : à garder tant que P5 (app://) n'est pas fait.
  GrantFileProtocolExtraPrivileges: true,
  // Valeur par défaut d'Electron (sécurité et performance de WebAssembly).
  WasmTrapHandlers: true
});

const DEFAULT_EXE = path.join(__dirname, '..', 'dist', '[OVCR] AI Manager-win32-x64', '[OVCR] AI Manager.exe');

function fusesLib() { return require('@electron/fuses'); } // ESM chargé par require (Node >= 22.12)

// Configuration au format de @electron/fuses (index du fuse -> booléen).
function toFuseConfig(lib = fusesLib()) {
  const config = { version: lib.FuseVersion.V1, strictlyRequireAllFuses: true };
  for (const [name, on] of Object.entries(WANTED)) {
    const index = lib.FuseV1Options[name];
    if (typeof index !== 'number') throw new Error('fuse inconnu de @electron/fuses : ' + name);
    config[index] = on;
  }
  return config;
}

// Compare l'état lu dans le binaire à WANTED. Renvoie la liste des écarts
// (vide = conforme), en noms lisibles. Un fuse présent dans le binaire mais
// absent de WANTED est aussi un écart.
async function checkFuses(exePath, lib = fusesLib()) {
  const wire = await lib.getCurrentFuseWire(exePath);
  const problems = [];
  const seen = new Set();
  for (const key of Object.keys(wire)) {
    if (key === 'version') continue;
    const name = lib.FuseV1Options[Number(key)] || ('#' + key);
    seen.add(name);
    const state = wire[key];
    if (state === lib.FuseState.REMOVED) { problems.push(name + ' : retiré de cette version d\'Electron'); continue; }
    if (!(name in WANTED)) { problems.push(name + ' : fuse non prévu dans WANTED'); continue; }
    const want = WANTED[name] ? lib.FuseState.ENABLE : lib.FuseState.DISABLE;
    if (state !== want) problems.push(name + ' : attendu ' + (WANTED[name] ? 'activé' : 'désactivé') + ', lu ' + describe(state, lib));
  }
  for (const name of Object.keys(WANTED)) if (!seen.has(name)) problems.push(name + ' : absent du binaire');
  return problems;
}

function describe(state, lib) {
  if (state === lib.FuseState.ENABLE) return 'activé';
  if (state === lib.FuseState.DISABLE) return 'désactivé';
  return 'valeur ' + state;
}

// SHA-256 de l'en-tête d'app.asar : c'est ce que vérifie Electron au démarrage
// (même calcul qu'electron-packager). Format : uint32 taille du pickle, pickle
// = uint32 taille de la charge, int32 longueur de la chaîne, chaîne JSON.
function asarHeaderHash(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    const pickle = Buffer.alloc(headerPickleSize);
    fs.readSync(fd, pickle, 0, headerPickleSize, 8);
    const strLen = pickle.readInt32LE(4);
    const header = pickle.subarray(8, 8 + strLen).toString('utf8');
    return crypto.createHash('sha256').update(header).digest('hex');
  } finally { fs.closeSync(fd); }
}

// Vérifie que le `.exe` contient l'empreinte de SON app.asar (ressource
// ELECTRONASAR, JSON en clair). Sans elle, ou avec une empreinte périmée, le
// fuse d'intégrité empêcherait l'app de démarrer.
function checkAsarIntegrity(exePath) {
  const asarPath = path.join(path.dirname(exePath), 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) return ['resources\\app.asar introuvable à côté du .exe'];
  const hash = asarHeaderHash(asarPath);
  const exe = fs.readFileSync(exePath);
  const needle = JSON.stringify({ file: 'resources\\app.asar', alg: 'SHA256', value: hash });
  if (exe.includes(Buffer.from(needle, 'utf8'))) return [];
  if (exe.includes(Buffer.from('"file":"resources\\\\app.asar"', 'utf8'))) {
    return ['empreinte d\'app.asar présente dans le .exe mais différente de l\'archive (app.asar modifié après le packaging ?)'];
  }
  return ['aucune empreinte d\'app.asar dans le .exe (ressource ELECTRONASAR absente)'];
}

async function applyFuses(exePath, lib = fusesLib()) {
  await lib.flipFuses(exePath, toFuseConfig(lib));
  return checkFuses(exePath, lib);
}

async function main(argv) {
  const checkOnly = argv.includes('--check');
  const exePath = path.resolve(argv.find(a => !a.startsWith('--')) || DEFAULT_EXE);
  if (!fs.existsSync(exePath)) {
    console.error('[fuses] exécutable introuvable : ' + exePath);
    return 1;
  }
  const problems = checkOnly ? await checkFuses(exePath) : await applyFuses(exePath);
  if (WANTED.EnableEmbeddedAsarIntegrityValidation) problems.push(...checkAsarIntegrity(exePath));
  if (problems.length) {
    console.error('[fuses] ÉCHEC sur ' + exePath + '\n  - ' + problems.join('\n  - '));
    return 1;
  }
  const summary = Object.entries(WANTED).map(([n, on]) => (on ? '+' : '-') + n).join(' ');
  console.log('[fuses] ' + (checkOnly ? 'conformes' : 'appliqués et vérifiés') + ' : ' + summary);
  return 0;
}

module.exports = { WANTED, DEFAULT_EXE, toFuseConfig, checkFuses, applyFuses, asarHeaderHash, checkAsarIntegrity };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
    console.error('[fuses] ' + (err && err.stack || err));
    process.exitCode = 1;
  });
}
