// Tests unitaires — versionnement du schéma des comptes et migrations.
// Les migrations « de test » (schémas 2 et 3) sont injectées : elles exercent
// le mécanisme (sauvegarde, ordre, validation, interruption) indépendamment
// des migrations réelles, qui ont leurs propres tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const fake = require('../helpers/fake-electron');
const fx = require('../fixtures/legacy-1.0.4');

const STORE = path.join(__dirname, '..', '..', 'accounts-store.js');

let dir, store;
const p = name => path.join(dir, name);
const env = name => JSON.parse(fs.readFileSync(p(name), 'utf8'));
const payloadOf = name => {
  const e = env(name);
  const raw = e.encryption === 'none' ? e.payload : fake.decrypt(Buffer.from(e.payload, 'base64'));
  return JSON.parse(raw);
};
const backups = () => (fs.existsSync(p('backups')) ? fs.readdirSync(p('backups')) : []);

// v1 -> v2 : couleur par défaut pour les comptes qui n'en ont pas.
// v2 -> v3 : e-mails en minuscules. Toutes deux idempotentes.
const STEPS = {
  1: list => list.map(a => (a && typeof a === 'object' ? { ...a, color: a.color || '#123456' } : a)),
  2: list => list.map(a => (a && typeof a === 'object' && typeof a.email === 'string' ? { ...a, email: a.email.toLowerCase() } : a))
};

test.beforeEach(() => {
  fake.reset();
  dir = fake.useTempUserData();
  store = fake.freshRequire(STORE);
});
test.afterEach(() => {
  store._test.resetSchema();
  fake.cleanup();
});

test('schéma courant de l\'app : 1 ; enregistré dans l\'enveloppe', async () => {
  assert.equal(store.SCHEMA, 1);
  await store.save([fx.accounts110[0]]);
  assert.equal(env('accounts.json').schema, 1);
  assert.ok(Array.isArray(payloadOf('accounts.json')), 'charge utile toujours un tableau (lisible par la 1.1.0)');
});

test('fichier 1.1.0 (sans champ schema) : lu tel quel au schéma 1, sans migration ni sauvegarde', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.equal(l.migrated, undefined);
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_a', 'acc_b']);
  assert.deepEqual(backups(), []);
});

test('migrations successives 1 -> 2 -> 3 : sauvegarde préalable, données transformées, schéma écrit', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  store._test.setSchema(3, STEPS);
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.migrated && { from: l.migrated.from, to: l.migrated.to }, { from: 1, to: 3 });
  assert.equal(l.accounts[1].color, '#123456');
  assert.equal(l.accounts[1].email, 'b@exemple.test');
  assert.equal(l.accounts[0].color, '#8b5cf6', 'valeur existante conservée');
  assert.equal(env('accounts.json').schema, 3);
  const b = backups().filter(f => /^pre-schema-v1-v3-.*\.json$/.test(f));
  assert.equal(b.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'backups', b[0]), 'utf8'), original, 'sauvegarde = fichier d\'origine exact');
});

test('idempotence : un 2e chargement ne remigre pas et ne refait pas de sauvegarde', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  store._test.setSchema(3, STEPS);
  await store.load();
  const after1 = fs.readFileSync(p('accounts.json'), 'utf8');
  const l2 = await store.load();
  assert.equal(l2.migrated, undefined);
  assert.equal(backups().length, 1);
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), after1);
  // Et appliquer deux fois les étapes donne le même résultat.
  const once = store._test.runMigrations(JSON.parse(JSON.stringify(fx.accounts110)), 1);
  assert.deepEqual(store._test.runMigrations(JSON.parse(JSON.stringify(once)), 1), once);
});

test('migration qui lève une erreur : fichier intact, comptes affichés, écriture refusée', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  store._test.setSchema(2, { 1: () => { throw new Error('boum'); } });
  const l = await store.load();
  assert.equal(l.status, 'migration_failed');
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_a', 'acc_b'], 'données d\'origine affichées');
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original);
  const s = await store.save([fx.accounts110[0]]);
  assert.deepEqual(s, { ok: false, error: 'migration_pending' });
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original);
});

test('migration qui perd un compte : refusée par la validation, fichier intact', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  store._test.setSchema(2, { 1: list => list.slice(1) });
  const l = await store.load();
  assert.equal(l.status, 'migration_failed');
  assert.match(l.error, /nombre de comptes/);
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original);
});

test('migration qui change un profil (= partition de cookies) : refusée', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  store._test.setSchema(2, { 1: list => list.map(a => ({ ...a, profile: a.profile + '_x' })) });
  assert.equal((await store.load()).status, 'migration_failed');
});

test('étape de migration absente : échec propre', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  store._test.setSchema(3, { 1: STEPS[1] });
  const l = await store.load();
  assert.equal(l.status, 'migration_failed');
  assert.match(l.error, /2 -> 3 absente/);
});

test('migration interrompue (échec de l\'écriture finale) : reprise au lancement suivant', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  store._test.setSchema(3, STEPS);
  const fsp = fs.promises;
  const realRename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (String(to).endsWith('accounts.json')) { const e = new Error('coupure'); e.code = 'EIO'; throw e; }
    return realRename.call(fsp, from, to);
  };
  let l;
  try { l = await store.load(); } finally { fsp.rename = realRename; }
  assert.equal(l.status, 'migration_failed');
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original, 'ancien fichier en place');
  assert.equal(fs.existsSync(p('accounts.json.tmp')), false);
  const l2 = await store.load();
  assert.equal(l2.status, 'ok');
  assert.equal(env('accounts.json').schema, 3);
});

test('données invalides dans un fichier ancien : entrées illisibles ignorées, migration aboutie', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110([fx.accounts110[0], null, 'x', 42, { ...fx.accounts110[1], id: '' }]));
  store._test.setSchema(2, { 1: STEPS[1] });
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_a', 'acc_restored_4']);
});

test('champ schema invalide : fichier considéré corrompu (sauvegarde proposée)', async () => {
  for (const schema of ['2', 0, -1, 1.5, null]) {
    fs.writeFileSync(p('accounts.json'), JSON.stringify({ ...JSON.parse(fx.envelope110(fx.accounts110)), schema }));
    assert.equal((await store.load()).status, 'corrupt', String(schema));
  }
});

test('E4 — schéma plus récent que l\'app : lecture seule, jamais réécrit', async () => {
  fs.writeFileSync(p('accounts.json'), JSON.stringify({ ...JSON.parse(fx.envelope110([{ ...fx.accounts110[0], champFutur: 'x' }])), schema: 7 }));
  const original = fs.readFileSync(p('accounts.json'), 'utf8');
  const l = await store.load();
  assert.equal(l.status, 'newer');
  assert.equal(l.schema, 7);
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_a'], 'comptes quand même affichés');
  assert.deepEqual(await store.save([fx.accounts110[0]]), { ok: false, error: 'newer_schema' });
  assert.equal(fs.readFileSync(p('accounts.json'), 'utf8'), original);
});

test('conteneur plus récent (version d\'enveloppe 2) : lecture seule également', async () => {
  fs.writeFileSync(p('accounts.json'), JSON.stringify({ ...JSON.parse(fx.envelope110(fx.accounts110)), version: 2 }));
  assert.equal((await store.load()).status, 'newer');
});

test('retour arrière vers la 1.1.0 puis remontée : aucun compte perdu', async () => {
  fs.writeFileSync(p('accounts.json'), fx.envelope110(fx.accounts110));
  store._test.setSchema(3, STEPS);
  await store.load();
  // La 1.1.0 lit la charge utile comme un tableau et la réécrit SANS schema.
  const list = payloadOf('accounts.json');
  assert.ok(Array.isArray(list));
  fs.writeFileSync(p('accounts.json'), fx.envelope110(list));
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_a', 'acc_b']);
  assert.equal(env('accounts.json').schema, 3);
});

test('restauration d\'une sauvegarde d\'un schéma plus ancien : migrée au passage', async () => {
  fs.writeFileSync(p('accounts.json.bak'), fx.envelope110(fx.accounts110));
  fs.writeFileSync(p('accounts.json'), '{corrompu');
  store._test.setSchema(2, { 1: STEPS[1] });
  const r = await store.restoreBackup();
  assert.equal(r.ok, true);
  assert.equal(r.result.status, 'ok');
  assert.equal(r.accounts[1].color, '#123456');
  assert.equal(env('accounts.json').schema, 2);
});

test('1.0.4 (localStorage) -> stockage chiffré -> schéma courant : rien de perdu', async () => {
  store._test.setSchema(3, STEPS);
  const m = await store.migrateLegacy({ current: fx.ai_accounts, backup: fx.ai_accounts_backup });
  assert.equal(m.ok, true);
  assert.equal(env('accounts.json').schema, 1, 'écrit au schéma 1 (forme 1.0.4)');
  const l = await store.load();
  assert.equal(l.status, 'ok');
  assert.deepEqual(l.accounts.map(a => a.id), ['acc_1784230841031', 'acc_1700000000000', 'acc_1700000000001']);
  assert.equal(l.accounts[2].profile, '', 'profil vide 1.0.4 conservé (la migration ne bloque pas)');
  assert.equal(l.accounts[1].email, 'ancien@exemple.test');
  assert.equal('quotas' in l.accounts[1], false);
  assert.ok(backups().some(f => f.startsWith('pre-migration-')));
  assert.ok(backups().some(f => f.startsWith('pre-schema-v1-v3-')));
});
