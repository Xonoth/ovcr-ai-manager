// Tests unitaires — export / import des comptes (accounts-transfer.js, phase 3 P7).
// Lancement : npm test
// La validation est celle du stockage (accounts-store.js, Electron simulé).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fake = require('../helpers/fake-electron');

const T = require('../../accounts-transfer');
const store = fake.freshRequire(path.join(__dirname, '..', '..', 'accounts-store.js'));
const deps = { schema: 1, sanitizeList: store._test.sanitizeList, runMigrations: store._test.runMigrations };

const acc = (n, extra = {}) => ({
  id: 'acc_' + n, name: 'Compte ' + n, email: `c${n}@exemple.test`, profile: 'profil_' + n,
  color: '#8b5cf6', services: ['claude', 'chatgpt'], cooldowns: { claude: 0, chatgpt: 0 }, ...extra
});
const envelope = (accounts, extra = {}) => JSON.stringify({ format: T.EXPORT_FORMAT, version: 1, schema: 1, accounts, ...extra });
let seq = 0;
const opts = (extra = {}) => ({ newId: () => 'acc_new_' + (++seq), ...extra });
test.beforeEach(() => { seq = 0; });

// ---------------------------------------------------------------- export --

test('export : enveloppe lisible, relue à l\'identique par l\'import', () => {
  const text = T.buildExport([acc(1), acc(2)], { schema: 1, appVersion: '1.8.0', now: new Date('2026-11-28T10:00:00Z') });
  const data = JSON.parse(text);
  assert.equal(data.format, 'ovcr-accounts-export');
  assert.equal(data.version, 1);
  assert.equal(data.schema, 1);
  assert.equal(data.app, '1.8.0');
  assert.equal(data.exportedAt, '2026-11-28T10:00:00.000Z');
  assert.ok(text.includes('\n  "accounts"'), 'JSON indenté (lisible)');
  assert.deepEqual(T.parseImport(text, deps), { ok: true, accounts: [acc(1), acc(2)] });
});

test('export : aucun champ de session ou de cookie', () => {
  const text = T.buildExport([acc(1)], { schema: 1, appVersion: 'x' });
  assert.ok(!/cookie|partition|session/i.test(text.replace(/sans cookies ni sessions/, '')));
});

// ---------------------------------------------------------------- import --

test('import : tableau nu accepté (ancienne fondation exportAccountsJSON)', () => {
  assert.deepEqual(T.parseImport(JSON.stringify([acc(1)], null, 2), deps), { ok: true, accounts: [acc(1)] });
});

test('import : marque d\'ordre d\'octets (BOM) en tête acceptée', () => {
  assert.equal(T.parseImport(String.fromCharCode(0xFEFF) + envelope([acc(1)]), deps).ok, true);
});

test('import : refus motivés', () => {
  const err = (text) => T.parseImport(text, deps).error;
  assert.equal(err(42), 'unreadable');
  assert.equal(err('x'.repeat(T.MAX_IMPORT_CHARS + 1)), 'too_large');
  assert.equal(err('{ pas du json'), 'not_json');
  assert.equal(err('{"a":1}'), 'unknown_format');
  assert.equal(err(JSON.stringify({ format: 'ovcr-accounts', version: 1, payload: 'x' })), 'unknown_format', 'fichier de stockage interne, pas un export');
  assert.equal(err(envelope([acc(1)], { version: 2 })), 'newer_format');
  assert.equal(err(envelope([acc(1)], { version: 0 })), 'unknown_format');
  assert.equal(err(envelope([acc(1)], { schema: 2 })), 'newer_schema');
  assert.equal(err(envelope([acc(1)], { schema: 'un' })), 'unknown_format');
  assert.equal(err(envelope('pas une liste')), 'unknown_format');
  assert.equal(err(envelope([])), 'empty');
  assert.equal(err(envelope([acc(1), acc(2, { id: 'acc_1' })])), 'duplicates');
  assert.equal(err(envelope([acc(1), acc(2, { profile: 'profil_1' })])), 'duplicates');
});

test('import : validation stricte, un compte invalide refuse tout le fichier', () => {
  for (const bad of [acc(2, { profile: '' }), acc(2, { profile: 'a\nb' }), acc(2, { id: '' }), 'texte', null]) {
    const r = T.parseImport(envelope([acc(1), bad]), deps);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid');
    assert.equal(typeof r.detail, 'string');
  }
});

test('import : champs normalisés comme à l\'enregistrement (inconnus retirés, textes bornés)', () => {
  const r = T.parseImport(envelope([acc(1, { cookies: 'x', name: 'n'.repeat(500), color: 'red', services: ['claude', 'claude', 'MAUVAIS'] })]), deps);
  assert.equal(r.ok, true);
  const a = r.accounts[0];
  assert.equal(a.cookies, undefined);
  assert.equal(a.name.length, 200);
  assert.equal(a.color, undefined);
  assert.deepEqual(a.services, ['claude']);
});

test('import : schéma plus ancien migré avant validation', () => {
  const r = T.parseImport(envelope([{ ...acc(1), nom: 'x' }], { schema: 1 }), {
    schema: 2, sanitizeList: deps.sanitizeList,
    runMigrations: (list, from) => { assert.equal(from, 1); return list.map(a => ({ ...a, name: 'migré' })); }
  });
  assert.equal(r.ok, true);
  assert.equal(r.accounts[0].name, 'migré');
  const failed = T.parseImport(envelope([acc(1)]), { schema: 2, sanitizeList: deps.sanitizeList, runMigrations: () => { throw new Error('x'); } });
  assert.equal(failed.error, 'migration_failed');
});

// ------------------------------------------------------------ collisions --

test('plan : nouveaux, identiques (ordre des clés et des services indifférent), conflits par id ou profil', () => {
  const existing = [acc(1), acc(2), acc(3)];
  const incoming = [
    acc(4),                                                   // nouveau
    { ...acc(1), services: ['chatgpt', 'claude'] },           // identique
    acc(2, { name: 'Autre nom' }),                            // même id + profil, modifié
    acc(5, { profile: 'profil_3' }),                          // même profil (même session)
    acc(3, { profile: 'profil_9' })                           // même id, profil différent
  ];
  const plan = T.planImport(existing, incoming);
  assert.deepEqual(plan.fresh.map(a => a.id), ['acc_4']);
  assert.deepEqual(plan.identical.map(a => a.id), ['acc_1']);
  assert.deepEqual(plan.conflicts.map(c => [c.incoming.id, c.existing.map(e => e.id)]),
    [['acc_2', ['acc_2']], ['acc_5', ['acc_3']], ['acc_3', ['acc_3']]]);
  const s = T.summarize(plan);
  assert.equal(s.total, 5);
  assert.equal(s.fresh, 1);
  assert.equal(s.identical, 1);
  assert.equal(s.conflicts.length, 3);
  assert.deepEqual(s.conflicts[0], { name: 'Autre nom', email: 'c2@exemple.test', profile: 'profil_2', existing: [{ name: 'Compte 2', email: 'c2@exemple.test', profile: 'profil_2' }] });
});

test('appliquer « ignorer » : seuls les nouveaux sont ajoutés, l\'existant n\'est pas touché', () => {
  const existing = [acc(1), acc(2)];
  const plan = T.planImport(existing, [acc(1), acc(2, { name: 'X' }), acc(3)]);
  const r = T.applyImport(existing, plan, 'skip', opts());
  assert.deepEqual(r.accounts, [acc(1), acc(2), acc(3)]);
  assert.deepEqual([r.added, r.replaced, r.skipped, r.copied], [1, 0, 2, 0]);
  assert.deepEqual(existing, [acc(1), acc(2)], 'liste d\'origine non modifiée');
});

test('appliquer « remplacer » : le compte importé prend la place de l\'existant', () => {
  const existing = [acc(1), acc(2), acc(3)];
  const plan = T.planImport(existing, [acc(2, { name: 'Nouveau 2', cooldowns: { claude: 123 } })]);
  const r = T.applyImport(existing, plan, 'replace', opts());
  assert.deepEqual(r.accounts.map(a => [a.id, a.name]), [['acc_1', 'Compte 1'], ['acc_2', 'Nouveau 2'], ['acc_3', 'Compte 3']]);
  assert.deepEqual(r.accounts[1].cooldowns, { claude: 123 });
  assert.equal(r.replaced, 1);
});

test('appliquer « remplacer » : conflit avec deux comptes -> les deux sont remplacés (jamais deux comptes sur une session)', () => {
  const existing = [acc(1), acc(2), acc(3)];
  // même id que acc_1, même profil que acc_3
  const plan = T.planImport(existing, [acc(1, { profile: 'profil_3', name: 'Fusion' })]);
  const r = T.applyImport(existing, plan, 'replace', opts());
  assert.deepEqual(r.accounts.map(a => [a.id, a.profile]), [['acc_1', 'profil_3'], ['acc_2', 'profil_2']]);
  assert.equal(new Set(r.accounts.map(a => a.profile)).size, r.accounts.length);
});

test('appliquer « remplacer » : deux importés visant le même compte existant', () => {
  const existing = [acc(1), acc(2)];
  // le 1er a l'id de acc_1, le 2e son profil
  const plan = T.planImport(existing, [acc(1, { profile: 'profil_8' }), acc(9, { profile: 'profil_1' })]);
  const r = T.applyImport(existing, plan, 'replace', opts());
  assert.deepEqual(r.accounts.map(a => [a.id, a.profile]), [['acc_1', 'profil_8'], ['acc_2', 'profil_2'], ['acc_9', 'profil_1']]);
  assert.equal(new Set(r.accounts.map(a => a.id)).size, 3);
  assert.equal(new Set(r.accounts.map(a => a.profile)).size, 3);
});

test('appliquer « nouveaux comptes » : nouvel id et premier profil libre, hors sessions présentes sur le disque', () => {
  const existing = [acc(1), acc(2)];
  const plan = T.planImport(existing, [acc(1, { name: 'Copie' }), acc(5, { profile: 'profil_2' })]);
  let n = 0;
  const ids = ['acc_1', 'acc_new_a', 'acc_new_b'];  // le 1er est déjà pris : redemandé
  const r = T.applyImport(existing, plan, 'copy', { newId: () => ids[n++], reservedProfiles: new Set(['Profil_3']) });
  assert.deepEqual(r.accounts.map(a => [a.id, a.profile, a.name]), [
    ['acc_1', 'profil_1', 'Compte 1'], ['acc_2', 'profil_2', 'Compte 2'],
    ['acc_new_a', 'profil_4', 'Copie'], ['acc_new_b', 'profil_5', 'Compte 5']
  ]);
  assert.equal(r.copied, 2);
});

test('appliquer : mode inconnu refusé', () => {
  assert.throws(() => T.applyImport([], T.planImport([], [acc(1)]), 'fusion', opts()), /mode invalide/);
});

test('aller-retour : export puis import sur la même liste = tout « déjà présent »', () => {
  const list = [acc(1), acc(2, { cooldowns: { claude: Date.UTC(2026, 10, 28) } })];
  const parsed = T.parseImport(T.buildExport(list, { schema: 1, appVersion: 'x' }), deps);
  const plan = T.planImport(list, parsed.accounts);
  assert.deepEqual([plan.fresh.length, plan.identical.length, plan.conflicts.length], [0, 2, 0]);
});
