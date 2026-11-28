// Tests unitaires — stockage des comptes (accounts-store.js).
// Lancement : npm test   (node --test, Electron simulé : test/helpers/fake-electron.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const fake = require('../helpers/fake-electron');

const STORE = path.join(__dirname, '..', '..', 'accounts-store.js');

const acc = (n, extra = {}) => ({
  id: 'acc_' + n, name: 'Compte ' + n, email: `c${n}@exemple.test`, profile: 'profil_' + n,
  color: '#8b5cf6', services: ['claude', 'chatgpt'], cooldowns: { claude: 0, chatgpt: 0 }, ...extra
});

let dir, store;
const p = name => path.join(dir, name);
const readEnvelope = name => JSON.parse(fs.readFileSync(p(name), 'utf8'));
const writeEnvelope = (name, payload, extra = {}) => fs.writeFileSync(p(name), JSON.stringify({
  format: 'ovcr-accounts', version: 1, encryption: 'none', payload, ...extra
}));
const ids = list => list.map(a => a.id);

test.beforeEach(() => {
  fake.reset();
  dir = fake.useTempUserData();
  store = fake.freshRequire(STORE);
});
test.afterEach(() => fake.cleanup());

test('dossier vide : load renvoie empty', async () => {
  assert.deepEqual(await store.load(), { status: 'empty', accounts: [] });
});

test('save puis load : mêmes comptes, charge utile chiffrée', async () => {
  const r = await store.save([acc(1), acc(2)]);
  assert.equal(r.ok, true);
  assert.equal(r.encrypted, true);
  const env = readEnvelope('accounts.json');
  assert.equal(env.format, 'ovcr-accounts');
  assert.equal(env.encryption, 'safeStorage');
  assert.ok(!fs.readFileSync(p('accounts.json'), 'utf8').includes('Compte 1'), 'aucun nom en clair sur le disque');
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.accounts, [acc(1), acc(2)]);
});

test('clé renouvelée (shouldReEncrypt) : comptes lus, fichier PAS réécrit au chargement', async () => {
  await store.save([acc(1)]);
  const before = fs.readFileSync(p('accounts.json'), 'utf8');
  fake.state.shouldReEncrypt = true;
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  let l;
  try { l = await store.load(); } finally { console.warn = warn; }
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.accounts, [acc(1)]);
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), before, 'aucune réécriture (retour arrière préservé)');
  assert.ok(warnings.some(w => /clé de chiffrement renouvelée/.test(w)), 'tracé dans le journal');
  // Le prochain enregistrement normal rechiffre (avec la clé courante).
  assert.equal((await store.save([acc(1), acc(2)])).ok, true);
  assert.equal(readEnvelope('accounts.json').encryption, 'safeStorage');
});

test('réponse de déchiffrement inattendue : traitée comme indéchiffrable, jamais comme vide', async () => {
  await store.save([acc(1)]);
  const original = fake.electron.safeStorage.decryptStringAsync;
  fake.electron.safeStorage.decryptStringAsync = async () => ({ shouldReEncrypt: false });
  try {
    assert.equal((await store.load()).status, 'undecryptable');
  } finally {
    fake.electron.safeStorage.decryptStringAsync = original;
  }
});

test('chaque save garde la génération précédente dans .bak', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  await store.save([acc(1), acc(2), acc(3)]);
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  const l = await store.load();
  assert.equal(l.status, 'corrupt');
  assert.deepEqual(l.backup, { available: true, count: 2 });
});

test('validation stricte à l\'enregistrement', async () => {
  assert.equal((await store.save('pas une liste')).ok, false);
  assert.equal((await store.save([acc(1, { profile: '' })])).ok, false, 'profil vide refusé');
  assert.equal((await store.save([acc(1, { profile: 'a\u0000b' })])).ok, false, 'caractère de contrôle refusé');
  assert.equal((await store.save([acc(1, { id: '' })])).ok, false, 'id vide refusé');
  assert.equal((await store.save([acc(1, { profile: 'x'.repeat(201) })])).ok, false, 'profil trop long refusé');
  assert.equal((await store.save(Array.from({ length: 1001 }, (_, i) => acc(i)))).ok, false, 'trop de comptes');
  assert.equal((await store.save([null])).ok, false, 'élément non objet refusé');
  assert.equal(fs.existsSync(p('accounts.json')), false, 'rien n\'a été écrit');
});

test('normalisation : couleur invalide retirée, services/cooldowns filtrés, textes tronqués', async () => {
  await store.save([acc(1, {
    color: 'red; background:url(x)', name: 'n'.repeat(500),
    services: ['claude', 'claude', 'BAD ID', 42], cooldowns: { claude: 123, chatgpt: -5, 'BAD ID': 9, gemini: 'x' },
    inconnu: 'champ ignoré'
  })]);
  const [a] = (await store.load()).accounts;
  assert.equal(a.color, undefined);
  assert.equal(a.name.length, 200);
  assert.deepEqual(a.services, ['claude']);
  assert.deepEqual(a.cooldowns, { claude: 123, chatgpt: 0, gemini: 0 });
  assert.equal('inconnu' in a, false);
});

test('lecture tolérante : les entrées illisibles sont ignorées, pas tout le fichier', async () => {
  writeEnvelope('accounts.json', JSON.stringify([acc(1), null, 'x', acc(2, { id: '' })]));
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.equal(l.accounts.length, 2);
  assert.equal(l.accounts[0].id, 'acc_1');
  assert.match(l.accounts[1].id, /^acc_restored_/);
});

test('fichier chiffré avec une autre clé : undecryptable', async () => {
  await store.save([acc(1)]);
  fake.state.keyId = 'cle-B';
  const l = await store.load();
  assert.equal(l.status, 'undecryptable');
});

test('chiffrement indisponible : écrit en clair, rechiffré au chargement suivant', async () => {
  fake.state.encryptionAvailable = false;
  const r = await store.save([acc(1)]);
  assert.equal(r.ok, true);
  assert.equal(r.encrypted, false);
  assert.equal(readEnvelope('accounts.json').encryption, 'none');
  fake.state.encryptionAvailable = true;
  const l = await store.load();
  assert.deepEqual(ids(l.accounts), ['acc_1']);
  assert.equal(readEnvelope('accounts.json').encryption, 'safeStorage');
});

// Profil neuf : Chromium n'écrit la clé dans « Local State » qu'une dizaine de
// secondes après l'avoir créée. Un arrêt brutal entre-temps perdait la clé.
const waitUntil = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('délai dépassé');
    await new Promise(r => setTimeout(r, 10));
  }
};

test('profil neuf : clé pas encore sur le disque -> écriture provisoire en clair, rechiffrée dès qu\'elle y est', async () => {
  fake.removeLocalState();
  store = fake.freshRequire(STORE);
  store._test.setReencryptPollMs(20);
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  assert.equal(readEnvelope('accounts.json').encryption, 'none');
  assert.equal(readEnvelope('accounts.json.bak').encryption, 'none');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(readEnvelope('accounts.json').encryption, 'none', 'toujours en clair tant que la clé est absente');

  const before = readEnvelope('accounts.json');
  fake.writeLocalState();
  await waitUntil(() => readEnvelope('accounts.json').encryption === 'safeStorage' && readEnvelope('accounts.json.bak').encryption === 'safeStorage');
  const after = readEnvelope('accounts.json');
  assert.equal(fake.decrypt(Buffer.from(after.payload, 'base64')), before.payload, 'même contenu');
  assert.equal(after.savedAt, before.savedAt, 'date d\'enregistrement conservée');
  assert.equal(after.schema, before.schema);
  assert.deepEqual(ids((await store.load()).accounts), ['acc_1', 'acc_2']);
  // Les enregistrements suivants sont chiffrés directement.
  await store.save([acc(3)]);
  assert.equal(readEnvelope('accounts.json').encryption, 'safeStorage');
});

test('profil neuf + migration 1.0.4 : la sauvegarde pré-migration est rechiffrée elle aussi', async () => {
  fake.removeLocalState();
  store = fake.freshRequire(STORE);
  store._test.setReencryptPollMs(20);
  const r = await store.migrateLegacy({ current: JSON.stringify([acc(1)]), backup: JSON.stringify([acc(2)]) });
  assert.equal(r.ok, true);
  const pre = path.join('backups', r.backupFile);
  assert.equal(readEnvelope(pre).encryption, 'none');
  assert.equal(readEnvelope(pre).schema, undefined);
  fake.writeLocalState();
  await waitUntil(() => ['accounts.json', 'accounts.json.bak', pre].every(f => readEnvelope(f).encryption === 'safeStorage'));
  assert.equal(readEnvelope(pre).schema, undefined, 'aucun champ ajouté');
});

test('arrêt avant l\'écriture de la clé : au lancement suivant, tout est relu puis rechiffré', async () => {
  fake.removeLocalState();
  store = fake.freshRequire(STORE);
  await store.migrateLegacy({ current: JSON.stringify([acc(1)]), backup: JSON.stringify([acc(2)]) });
  // « Arrêt brutal » : nouveau processus ; entre-temps Chromium a écrit la clé.
  fake.writeLocalState();
  store = fake.freshRequire(STORE);
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(ids(l.accounts), ['acc_1']);
  const files = ['accounts.json', 'accounts.json.bak', ...fs.readdirSync(p('backups')).map(f => path.join('backups', f))];
  for (const f of files) assert.equal(readEnvelope(f).encryption, 'safeStorage', f);
});

test('rechiffrement différé : jamais un fichier d\'une version plus récente', async () => {
  fake.removeLocalState();
  store = fake.freshRequire(STORE);
  writeEnvelope('accounts.json', JSON.stringify([acc(1)]), { schema: 99 });
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  assert.equal((await store.load()).status, 'newer');
  fake.writeLocalState();
  store = fake.freshRequire(STORE);
  await store.load();
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original);
});

test('restoreBackup : met le fichier illisible de côté et remet la sauvegarde', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  const r = await store.restoreBackup();
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.accounts), ['acc_1']);
  assert.ok(fs.readdirSync(dir).some(f => /^accounts\.unreadable-.*\.json$/.test(f)), 'fichier illisible conservé');
  assert.deepEqual(ids((await store.load()).accounts), ['acc_1']);
});

test('restoreBackup sans sauvegarde lisible : refus, rien n\'est déplacé', async () => {
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  const r = await store.restoreBackup();
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), '{corrompu');
});

test('save sur un fichier illisible : il est mis de côté, la sauvegarde existante est préservée', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);   // .bak = [acc1]
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  await store.save([acc(9)]);
  assert.ok(fs.readdirSync(dir).some(f => /^accounts\.unreadable-.*\.json$/.test(f)));
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  assert.deepEqual((await store.load()).backup, { available: true, count: 1 });
});

test('migrateLegacy : sauvegarde préalable, écriture, relecture vérifiée', async () => {
  const current = JSON.stringify([acc(1), acc(2)]);
  const backup = JSON.stringify([acc(1)]);
  const r = await store.migrateLegacy({ current, backup });
  assert.equal(r.ok, true);
  const pre = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(pre.length, 1);
  assert.match(pre[0], /^pre-migration-.*\.json$/);
  assert.deepEqual(ids((await store.load()).accounts), ['acc_1', 'acc_2']);
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  assert.deepEqual((await store.load()).backup, { available: true, count: 1 });
});

test('migrateLegacy : refuse si le nouveau stockage existe déjà, ou si la charge est invalide', async () => {
  assert.equal((await store.migrateLegacy(null)).ok, false);
  assert.equal((await store.migrateLegacy({ current: 42 })).error, 'invalid');
  assert.equal((await store.migrateLegacy({})).error, 'nothing');
  await store.save([acc(1)]);
  assert.equal((await store.migrateLegacy({ current: '[]' })).error, 'exists');
});

test('migrateLegacy : chaîne corrompue reprise telle quelle (récupération possible ensuite)', async () => {
  const r = await store.migrateLegacy({ current: '{pas du json', backup: JSON.stringify([acc(1)]) });
  assert.equal(r.ok, true);
  const l = await store.load();
  assert.equal(l.status, 'corrupt');
  assert.deepEqual(l.backup, { available: true, count: 1 });
});

test('écritures concurrentes : traitées dans l\'ordre d\'arrivée, la dernière gagne', async () => {
  const all = [];
  for (let i = 1; i <= 20; i++) all.push(store.save(Array.from({ length: i }, (_, k) => acc(k))));
  assert.equal(store.isIdle(), false);
  await Promise.all(all);
  await store.whenIdle();
  assert.equal(store.isIdle(), true);
  assert.equal((await store.load()).accounts.length, 20);
});

test('écriture interrompue (échec du renommage) : l\'ancienne version reste intacte', async () => {
  await store.save([acc(1)]);
  const fsp = fs.promises;
  const realRename = fsp.rename;
  fsp.rename = async () => { const e = new Error('simulé'); e.code = 'EIO'; throw e; };
  try {
    const r = await store.save([acc(1), acc(2)]);
    assert.equal(r.ok, false);
  } finally {
    fsp.rename = realRename;
  }
  assert.deepEqual(ids((await store.load()).accounts), ['acc_1']);
});

test('retour arrière : inactif sans le drapeau de lancement', async () => {
  assert.equal(await store.pendingRevert(), null);
  assert.equal((await store.confirmRevert()).ok, false);
});

// ---- Défauts relevés par l'audit de la phase 2, corrigés au lot 1 ----

// Décode une enveloppe (chiffrement simulé) -> liste d'ids.
function idsInEnvelopeFile(filePath) {
  const env = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const raw = env.encryption === 'none' ? env.payload
    : fake.decrypt(Buffer.from(env.payload, 'base64'));
  return JSON.parse(raw).map(a => a.id);
}

test('C1 — « Continuer sans restaurer » puis 2 modifications : la sauvegarde valide reste récupérable', async () => {
  await store.save([acc(1), acc(2)]);
  await store.save([acc(1), acc(2), acc(3)]);   // .bak = [1, 2]
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  await store.save([acc(9)]);
  await store.save([acc(9), acc(10)]);
  await store.save([acc(9), acc(10), acc(11)]);
  const preserved = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('bak-preserved-main-unreadable-'));
  assert.equal(preserved.length, 1, 'une seule copie mise à l\'abri (pas une par enregistrement)');
  assert.deepEqual(idsInEnvelopeFile(path.join(dir, 'backups', preserved[0])), ['acc_1', 'acc_2']);
});

test('E1 — fichier principal absent mais .bak valide : « missing » avec la sauvegarde proposée', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  fs.rmSync(p('accounts.json'));
  const l = await store.load();
  assert.equal(l.status, 'missing');
  assert.deepEqual(l.backup, { available: true, count: 1 });
  const r = await store.restoreBackup();
  assert.equal(r.ok, true);
  assert.deepEqual(ids((await store.load()).accounts), ['acc_1']);
});

test('E1 — fichier principal absent, puis l\'utilisateur continue : .bak mis à l\'abri avant rotation', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);   // .bak = [1]
  fs.rmSync(p('accounts.json'));
  await store.save([acc(7)]);
  await store.save([acc(7), acc(8)]);   // .bak tourne -> [7]
  const preserved = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('bak-preserved-main-missing-'));
  assert.equal(preserved.length, 1);
  assert.deepEqual(idsInEnvelopeFile(path.join(dir, 'backups', preserved[0])), ['acc_1']);
});

test('E1 — sans sauvegarde non plus : vrai premier lancement, « empty »', async () => {
  assert.equal((await store.load()).status, 'empty');
});

test('M1 — charge utile JSON valide mais non tableau : corrompue, pas « 0 compte »', async () => {
  for (const payload of ['{"a":1}', 'null', '42', '"texte"']) {
    writeEnvelope('accounts.json', payload);
    assert.equal((await store.load()).status, 'corrupt', payload);
  }
});

test('restauration interrompue (échec de l\'écriture finale) : le fichier d\'origine reste en place', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  const fsp = fs.promises;
  const realRename = fsp.rename;
  fsp.rename = async () => { const e = new Error('simulé'); e.code = 'EIO'; throw e; };
  try {
    assert.equal((await store.restoreBackup()).ok, false);
  } finally {
    fsp.rename = realRename;
  }
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), '{corrompu', 'jamais d\'instant sans fichier principal');
  assert.equal((await store.restoreBackup()).ok, true, 'nouvel essai possible');
});

test('rotation interrompue (échec de copie vers .bak) : principal et ancien .bak intacts', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);   // main = [1,2], .bak = [1]
  const fsp = fs.promises;
  const realOpen = fsp.open;
  fsp.open = async (f, ...rest) => {
    if (String(f).endsWith('accounts.json.bak.tmp')) { const e = new Error('disque plein'); e.code = 'ENOSPC'; throw e; }
    return realOpen.call(fsp, f, ...rest);
  };
  try {
    assert.equal((await store.save([acc(1), acc(2), acc(3)])).ok, false);
  } finally {
    fsp.open = realOpen;
  }
  assert.deepEqual(idsInEnvelopeFile(p('accounts.json')), ['acc_1', 'acc_2']);
  assert.deepEqual(idsInEnvelopeFile(p('accounts.json.bak')), ['acc_1']);
  assert.equal(fs.existsSync(p('accounts.json.bak.tmp')), false, 'aucun .tmp orphelin');
});

test('migration avec un .bak orphelin : il est mis à l\'abri avant d\'être remplacé', async () => {
  await store.save([acc(1)]);
  await store.save([acc(1), acc(2)]);
  fs.rmSync(p('accounts.json'));       // .bak = [1] orphelin
  const r = await store.migrateLegacy({ current: JSON.stringify([acc(5)]), backup: JSON.stringify([acc(6)]) });
  assert.equal(r.ok, true);
  const preserved = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('bak-preserved-pre-migration-'));
  assert.equal(preserved.length, 1);
  assert.deepEqual(idsInEnvelopeFile(path.join(dir, 'backups', preserved[0])), ['acc_1']);
});

// E4 (schéma plus récent) : voir migrations.test.js
