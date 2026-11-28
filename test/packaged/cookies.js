// Test de COMPORTEMENT du chiffrement des cookies (phase 3, P3) : npm run test:cookies
//
// Même principe que test/packaged/fuses.js : on ne lance jamais le vrai `.exe`
// (vrai profil). On fabrique deux apps JETABLES avec l'Electron du projet :
//   - « 1.4 » : le jeu de fuses de la 1.4.0 (tout WANTED, mais cookies en clair) ;
//   - « 1.5 » : exactement WANTED de scripts/fuses.js (ce que livre npm run dist).
// Elles partagent un même dossier userData temporaire, avec deux partitions
// `persist:` comme deux comptes de l'app, et on enchaîne mise à jour, usage,
// « déconnexion / reconnexion », puis retour arrière. On lit la base SQLite
// des cookies de Chromium (node:sqlite, lecture seule) et ses octets bruts.
//
// Ce test FIGE aussi des comportements de Chromium documentés dans SECURITY.md
// (cookies existants laissés en clair, perte totale au retour arrière) : s'il
// échoue après une montée d'Electron, il faut revoir la documentation.
//
// Aucun réseau (les cookies sont posés par l'API, pas par un site). Lancé par
// Node (pas par Electron). Durée : ~1 minute (copie d'Electron).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const electronDist = path.dirname(require('electron'));
const lib = require('@electron/fuses');
const fuses = require('../../scripts/fuses');

const asar = require('../../node_modules/@electron/packager/node_modules/@electron/asar/lib/asar.js');
const { resedit } = require('@electron/packager/resedit');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-cookie-probe-'));
const userData = path.join(root, 'userdata');
const out = path.join(root, 'out.json');
const PARTITIONS = ['alice', 'bob']; // persist:<profil>, comme les comptes de l'app
const URL = 'https://service.example';

let total = 0, failed = 0;
function check(name, ok, detail) {
  total++;
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : '\n      ' + detail}`);
}

// --- App jetable ------------------------------------------------------------

// main.js : exécute la liste d'actions de OVCR_PROBE_ACTIONS (JSON), écrit
// l'état des cookies de chaque partition, puis quitte par app.quit() : avec
// app.exit(), « Local State » (qui garde la clé de chiffrement) ne serait pas écrit.
const MAIN_JS = `const { app, session, safeStorage } = require('electron');
const fs = require('fs');
app.setPath('userData', process.env.OVCR_PROBE_USERDATA);
const result = { cookies: {}, errors: [] };
const done = () => { fs.writeFileSync(process.env.OVCR_PROBE_OUT, JSON.stringify(result)); app.quit(); };
app.whenReady().then(async () => {
  for (const a of JSON.parse(process.env.OVCR_PROBE_ACTIONS)) {
    try {
      const ses = a.partition && session.fromPartition('persist:' + a.partition);
      if (a.op === 'set') await ses.cookies.set({ url: ${JSON.stringify(URL)}, name: a.name, value: a.value, secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 86400 * 30 });
      if (a.op === 'remove') await ses.cookies.remove(${JSON.stringify(URL)}, a.name);
      if (a.op === 'encrypt') fs.writeFileSync(a.file, await safeStorage.encryptStringAsync(a.value));
      if (a.op === 'decrypt') {
        const r = await safeStorage.decryptStringAsync(fs.readFileSync(a.file));
        result.decrypted = typeof r === 'string' ? r : r.result;
      }
    } catch (e) { result.errors.push(a.op + ' : ' + e.message); }
  }
  for (const p of ${JSON.stringify(PARTITIONS)}) {
    const ses = session.fromPartition('persist:' + p);
    result.cookies[p] = Object.fromEntries((await ses.cookies.get({})).map(c => [c.name, c.value]));
    await ses.cookies.flushStore();
  }
  done();
}).catch(e => { result.errors.push('fatal : ' + e.message); done(); });
`;

async function buildApps() {
  console.log('▶ Préparation : deux apps jetables (Electron ' + require('electron/package.json').version + ') dans ' + root);
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'ovcr-cookie-probe', version: '1.0.0', main: 'main.js' }));
  fs.writeFileSync(path.join(src, 'main.js'), MAIN_JS);

  const old = path.join(root, 'v14');
  fs.cpSync(electronDist, old, { recursive: true });
  fs.renameSync(path.join(old, 'electron.exe'), path.join(old, 'probe.exe'));
  fs.rmSync(path.join(old, 'resources', 'default_app.asar'), { force: true });
  const appAsar = path.join(old, 'resources', 'app.asar');
  await asar.createPackage(src, appAsar);
  await resedit(path.join(old, 'probe.exe'), { asarIntegrity: { 'resources\\app.asar': { algorithm: 'SHA256', hash: fuses.asarHeaderHash(appAsar) } } });

  const cur = path.join(root, 'v15');
  fs.cpSync(old, cur, { recursive: true });

  // 1.4 : WANTED avec les cookies en clair (seule différence avec la 1.5).
  await lib.flipFuses(path.join(old, 'probe.exe'), { ...fuses.toFuseConfig(lib), [lib.FuseV1Options.EnableCookieEncryption]: false });
  // 1.5 : exactement ce que livre npm run dist.
  const problems = await fuses.applyFuses(path.join(cur, 'probe.exe'));
  check('app « 1.5 » : jeu de fuses de scripts/fuses.js appliqué et relu', problems.length === 0, problems.join(' ; '));
  check('ce jeu chiffre les cookies (EnableCookieEncryption)', fuses.WANTED.EnableCookieEncryption === true);
  return { v14: path.join(old, 'probe.exe'), v15: path.join(cur, 'probe.exe') };
}

function launch(exe, actions = []) {
  fs.rmSync(out, { force: true });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|ELECTRON_ENABLE_LOGGING)$/i.test(k)) delete env[k];
  const r = spawnSync(exe, [], {
    env: { ...env, OVCR_PROBE_USERDATA: userData, OVCR_PROBE_OUT: out, OVCR_PROBE_ACTIONS: JSON.stringify(actions) },
    encoding: 'utf8', timeout: 30000, windowsHide: true
  });
  const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { cookies: {}, errors: ['aucun résultat'] };
  res.status = r.status;
  res.output = ((r.stdout || '') + (r.stderr || '') + (r.error ? r.error.message : '')).trim().slice(-300);
  return res;
}
const show = r => `cookies ${JSON.stringify(r.cookies)}, erreurs ${JSON.stringify(r.errors)}, code ${r.status}${r.output ? ', sortie : ' + r.output : ''}`;
const ran = r => r.status === 0 && r.errors.length === 0;

// --- Lecture du disque --------------------------------------------------------

const networkDir = p => path.join(userData, 'Partitions', p, 'Network');

// Lignes de la table cookies (lecture seule, app fermée).
function rows(p) {
  const db = new DatabaseSync(path.join(networkDir(p), 'Cookies'), { readOnly: true });
  try {
    return db.prepare('select name, value, encrypted_value from cookies').all()
      .map(r => ({ name: r.name, clear: r.value, enc: Buffer.from(r.encrypted_value || []) }));
  } finally { db.close(); }
}
const row = (p, name) => rows(p).find(r => r.name === name);
// Le cookie est-il stocké chiffré par Chromium (valeur vide, préfixe v10 = DPAPI/AES-GCM) ?
const isEncrypted = r => !!r && r.clear === '' && r.enc.length > 3 && r.enc.subarray(0, 3).toString() === 'v10';

// Une valeur apparaît-elle en clair dans un fichier de cookies (base + journal) ?
function onDisk(p, value) {
  const dir = networkDir(p);
  return fs.readdirSync(dir).filter(f => /^Cookies/.test(f))
    .filter(f => fs.readFileSync(path.join(dir, f)).includes(Buffer.from(value)))
    .join(', ');
}

// --- Scénario ---------------------------------------------------------------

async function main() {
  const { v14, v15 } = await buildApps();
  const secretFile = path.join(root, 'accounts.bin');
  // Valeurs uniques, faciles à retrouver dans les octets d'un fichier.
  const V = { a1: 'ovcr-alice-old-7f3a', a2: 'ovcr-alice-new-91c2', c: 'ovcr-alice-added-44d0', b1: 'ovcr-bob-old-2b8e', b2: 'ovcr-bob-relog-6e15' };

  console.log('\n▶ Version 1.4 (cookies en clair) : deux comptes connectés');
  let r = launch(v14, [
    { op: 'set', partition: 'alice', name: 'sid', value: V.a1 },
    { op: 'set', partition: 'bob', name: 'sid', value: V.b1 },
    { op: 'encrypt', file: secretFile, value: 'comptes-chiffres' }
  ]);
  check('sessions posées dans les deux partitions', ran(r) && r.cookies.alice.sid === V.a1 && r.cookies.bob.sid === V.b1, show(r));
  check('témoin : sans le fuse, la valeur est lisible dans le fichier Cookies', !!onDisk('alice', V.a1) && !isEncrypted(row('alice', 'sid')), 'la sonde ne voit pas le clair');

  console.log('\n▶ Mise à jour vers la 1.5 (fuse EnableCookieEncryption)');
  r = launch(v15);
  check('passage sans perte : les deux sessions sont toujours là', ran(r) && r.cookies.alice.sid === V.a1 && r.cookies.bob.sid === V.b1, show(r));
  check('comportement connu de Chromium : un cookie existant reste en clair tant qu\'il n\'est pas réécrit',
    !!onDisk('alice', V.a1) && !!onDisk('bob', V.b1) && !isEncrypted(row('alice', 'sid')),
    'les anciens cookies ont été rechiffrés : mettre à jour SECURITY.md (§5-6) et DISTRIBUTION-LISEZ-MOI.txt');

  r = launch(v15, [
    { op: 'set', partition: 'alice', name: 'sid', value: V.a2 }, // le service renouvelle sa session
    { op: 'set', partition: 'alice', name: 'pref', value: V.c } // nouveau cookie
  ]);
  check('cookies réécrits ou nouveaux : lus normalement', ran(r) && r.cookies.alice.sid === V.a2 && r.cookies.alice.pref === V.c, show(r));
  check('cookie nouveau : chiffré sur le disque (v10), valeur absente du fichier', isEncrypted(row('alice', 'pref')) && !onDisk('alice', V.c), 'trouvé en clair dans : ' + onDisk('alice', V.c));
  check('cookie renouvelé par le service : chiffré, et l\'ancienne valeur a disparu des fichiers',
    isEncrypted(row('alice', 'sid')) && !onDisk('alice', V.a2) && !onDisk('alice', V.a1),
    'nouvelle valeur dans : ' + (onDisk('alice', V.a2) || '-') + ' ; ancienne dans : ' + (onDisk('alice', V.a1) || '-'));

  r = launch(v15, [
    { op: 'remove', partition: 'bob', name: 'sid' }, // déconnexion…
    { op: 'set', partition: 'bob', name: 'sid', value: V.b2 } // …puis reconnexion
  ]);
  check('déconnexion puis reconnexion : nouvelle session lue', ran(r) && r.cookies.bob.sid === V.b2, show(r));
  check('après reconnexion, plus aucune valeur de session en clair dans la partition',
    isEncrypted(row('bob', 'sid')) && !onDisk('bob', V.b1) && !onDisk('bob', V.b2),
    'ancienne dans : ' + (onDisk('bob', V.b1) || '-') + ' ; nouvelle dans : ' + (onDisk('bob', V.b2) || '-'));

  r = launch(v15, [{ op: 'decrypt', file: secretFile }]);
  check('relance : toutes les sessions sont relues', ran(r) && r.cookies.alice.sid === V.a2 && r.cookies.alice.pref === V.c && r.cookies.bob.sid === V.b2, show(r));
  check('les comptes (safeStorage) écrits par la 1.4 se déchiffrent toujours', r.decrypted === 'comptes-chiffres', show(r));

  console.log('\n▶ Retour arrière vers la 1.4 (irréversibilité)');
  r = launch(v14, [{ op: 'decrypt', file: secretFile }]);
  check('la 1.4 démarre normalement', ran(r), show(r));
  check('IRRÉVERSIBLE : la 1.4 ne garde AUCUN cookie, dans aucune partition',
    Object.keys(r.cookies.alice || {}).length === 0 && Object.keys(r.cookies.bob || {}).length === 0, show(r));
  check('les comptes (safeStorage), eux, restent lisibles par la 1.4', r.decrypted === 'comptes-chiffres', show(r));
  r = launch(v15);
  check('revenir ensuite à la 1.5 ne rend pas les sessions perdues',
    ran(r) && Object.keys(r.cookies.alice).length === 0 && Object.keys(r.cookies.bob).length === 0, show(r));
}

main().catch(err => { failed++; total++; console.log('  ✖ erreur : ' + (err && err.stack || err)); })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { console.log('  (dossier temporaire non supprimé : ' + root + ' — ' + e.code + ')'); }
    console.log(`\n${total - failed}/${total} vérifications du chiffrement des cookies réussies`);
    process.exitCode = failed ? 1 : 0;
  });
