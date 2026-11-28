// Tests unitaires — fuses du binaire packagé (scripts/fuses.js).
// Travaille sur de FAUX binaires (sentinelle + fil de fuses) dans un dossier
// temporaire : aucun Electron n'est lancé ni modifié.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const lib = require('@electron/fuses');
const fuses = require('../../scripts/fuses');

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'; // celui de @electron/fuses
const NAMES = Object.keys(lib.FuseV1Options).filter(k => isNaN(Number(k)));

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-fuses-')); });
test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// Faux exécutable : octets quelconques + sentinelle + version 1 + longueur +
// fil (valeurs par défaut d'Electron 45, lues sur le vrai binaire).
const ELECTRON_DEFAULTS = [1, 0, 1, 1, 0, 0, 0, 1, 1];
function fakeExe(states = ELECTRON_DEFAULTS.map(on => (on ? 49 : 48))) {
  const file = path.join(dir, 'app.exe');
  fs.writeFileSync(file, Buffer.concat([
    crypto.randomBytes(1000), Buffer.from(SENTINEL), Buffer.from([1, states.length]),
    Buffer.from(states), crypto.randomBytes(1000)
  ]));
  return file;
}

test('WANTED décide explicitement de chaque fuse connu de @electron/fuses', () => {
  assert.deepEqual(Object.keys(fuses.WANTED).sort(), NAMES.slice().sort());
  for (const v of Object.values(fuses.WANTED)) assert.equal(typeof v, 'boolean');
});

test('jeu de fuses de la phase 3 (P2 + P3 : cookies chiffrés)', () => {
  const w = fuses.WANTED;
  assert.equal(w.RunAsNode, false);
  assert.equal(w.EnableNodeOptionsEnvironmentVariable, false);
  assert.equal(w.EnableNodeCliInspectArguments, false);
  assert.equal(w.EnableEmbeddedAsarIntegrityValidation, true);
  assert.equal(w.OnlyLoadAppFromAsar, true);
  // Interface en app:// depuis la 1.9.0, mais le pont vers l'ancien
  // localStorage file:// (legacy-storage.js) en a besoin : P5 bis.
  assert.equal(w.GrantFileProtocolExtraPrivileges, true);
  // P3 (1.5.0), décidé par l'utilisateur. IRRÉVERSIBLE : le repasser à false
  // ferait perdre toutes les sessions (voir npm run test:cookies).
  assert.equal(w.EnableCookieEncryption, true);
  assert.ok(Object.isFrozen(w));
});

test('toFuseConfig : format @electron/fuses, strict', () => {
  const c = fuses.toFuseConfig(lib);
  assert.equal(c.version, lib.FuseVersion.V1);
  assert.equal(c.strictlyRequireAllFuses, true);
  for (const name of NAMES) assert.equal(c[lib.FuseV1Options[name]], fuses.WANTED[name], name);
});

test('binaire aux valeurs par défaut : écarts listés, puis applyFuses les corrige', async () => {
  const exe = fakeExe();
  const before = await fuses.checkFuses(exe, lib);
  assert.deepEqual(before.map(p => p.split(' : ')[0]).sort(), [
    'EnableCookieEncryption', 'EnableEmbeddedAsarIntegrityValidation', 'EnableNodeCliInspectArguments',
    'EnableNodeOptionsEnvironmentVariable', 'OnlyLoadAppFromAsar', 'RunAsNode'
  ]);
  assert.deepEqual(await fuses.applyFuses(exe, lib), []);
  assert.deepEqual(await fuses.checkFuses(exe, lib), []);
  // Seul le fil a changé : le reste du fichier est intact.
  assert.equal(fs.statSync(exe).size, 2000 + SENTINEL.length + 2 + 9);
});

test('fuse ajouté par une future version d\'Electron : refus d\'appliquer', async () => {
  const exe = fakeExe([...ELECTRON_DEFAULTS, 1].map(on => (on ? 49 : 48)));
  await assert.rejects(() => fuses.applyFuses(exe, lib), /strictlyRequireAllFuses/);
  const problems = await fuses.checkFuses(exe, lib);
  assert.ok(problems.some(p => /non prévu/.test(p)), problems.join('\n'));
});

test('fuse retiré (r) ou absent : signalé', async () => {
  const removed = fakeExe([49, 48, 49, 49, 48, 48, 48, 49, 114].map(Number));
  assert.ok((await fuses.checkFuses(removed, lib)).some(p => /^WasmTrapHandlers : retiré/.test(p)));
  fs.rmSync(removed);
  const shorter = fakeExe(ELECTRON_DEFAULTS.slice(0, 8).map(on => (on ? 49 : 48)));
  assert.ok((await fuses.checkFuses(shorter, lib)).some(p => /^WasmTrapHandlers : absent/.test(p)));
});

// --- Empreinte d'app.asar (ressource ELECTRONASAR) ---------------------------

function fakeAsar(headerJson) {
  // Même format qu'@electron/asar : pickle(uint32 taille) + pickle(chaîne).
  const str = Buffer.from(headerJson, 'utf8');
  const padded = Math.ceil(str.length / 4) * 4;
  const pickle = Buffer.alloc(8 + padded);
  pickle.writeUInt32LE(4 + padded, 0);
  pickle.writeInt32LE(str.length, 4);
  str.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  const res = path.join(dir, 'resources');
  fs.mkdirSync(res, { recursive: true });
  const file = path.join(res, 'app.asar');
  fs.writeFileSync(file, Buffer.concat([size, pickle, Buffer.from('contenu des fichiers')]));
  return file;
}
function exeWithIntegrity(hash) {
  const exe = path.join(dir, 'app.exe');
  const json = JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]);
  fs.writeFileSync(exe, Buffer.concat([crypto.randomBytes(500), Buffer.from(json), crypto.randomBytes(500)]));
  return exe;
}

test('asarHeaderHash : SHA-256 de la chaîne d\'en-tête seule', () => {
  const header = '{"files":{"main.js":{"size":3,"offset":"0"}}}'; // longueur non multiple de 4
  const asar = fakeAsar(header);
  assert.equal(fuses.asarHeaderHash(asar), crypto.createHash('sha256').update(header).digest('hex'));
});

test('checkAsarIntegrity : empreinte conforme, périmée, absente', () => {
  const asar = fakeAsar('{"files":{}}');
  const good = fuses.asarHeaderHash(asar);
  assert.deepEqual(fuses.checkAsarIntegrity(exeWithIntegrity(good)), []);
  assert.match(fuses.checkAsarIntegrity(exeWithIntegrity('0'.repeat(64)))[0], /différente/);
  const bare = path.join(dir, 'app.exe');
  fs.writeFileSync(bare, crypto.randomBytes(1000));
  assert.match(fuses.checkAsarIntegrity(bare)[0], /aucune empreinte/);
  fs.rmSync(asar);
  assert.match(fuses.checkAsarIntegrity(bare)[0], /introuvable/);
});
