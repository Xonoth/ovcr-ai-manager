// Tests unitaires — accès aux fichiers (file-access.js) : confinement au
// dossier choisi, types de fichiers, écriture limitée aux fichiers ouverts.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fake = require('../helpers/fake-electron');

const MODULE = path.join(__dirname, '..', '..', 'file-access.js');

let fa, root, outside;

test.beforeEach(async () => {
  fake.reset();
  fake.useTempUserData();
  fa = fake.freshRequire(MODULE);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-outside-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9])); // « café » Latin-1
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fake.state.openDialogResult = { canceled: false, filePaths: [root] };
  assert.equal(await fa.selectFolder(null), path.resolve(root));
});

test.afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  fake.cleanup();
});

test('listDirectory : fichiers du dossier choisi, dossiers ignorés', async () => {
  const r = await fa.listDirectory(root);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map(e => e.name).sort(), ['a.js', 'image.png', 'latin1.txt']);
});

test('chemins refusés : hors racine, traversée, relatif, octet nul, périphérique', async () => {
  const denied = [
    outside,
    path.join(outside, 'secret.txt'),
    path.join(root, '..', path.basename(outside), 'secret.txt'),
    'a.js',
    path.join(root, 'a.js\0.txt'),
    '\\\\?\\' + path.join(root, 'a.js'),
    '\\\\.\\PhysicalDrive0',
    42, null, '', 'x'.repeat(5000)
  ];
  for (const p of denied) {
    assert.equal((await fa.readFile(p)).ok, false, 'lecture ' + String(p).slice(0, 60));
    assert.equal((await fa.listDirectory(p)).ok, false, 'liste ' + String(p).slice(0, 60));
  }
});

test('sans dossier choisi, rien n\'est accessible', async () => {
  const fresh = fake.freshRequire(MODULE);
  assert.equal((await fresh.readFile(path.join(root, 'a.js'))).error, 'denied');
});

test('lecture : texte UTF-8 ok, binaire refusé, non UTF-8 en lecture seule', async () => {
  const a = await fa.readFile(path.join(root, 'a.js'));
  assert.deepEqual(a, { ok: true, content: 'console.log(1);\n', readOnly: false });
  assert.equal((await fa.readFile(path.join(root, 'image.png'))).error, 'binary');
  const l = await fa.readFile(path.join(root, 'latin1.txt'));
  assert.equal(l.ok, true);
  assert.equal(l.readOnly, true);
});

test('écriture : seulement un fichier ouvert (UTF-8) au préalable', async () => {
  const target = path.join(root, 'a.js');
  assert.equal((await fa.saveFile(target, 'x')).error, 'denied', 'pas encore ouvert');
  await fa.readFile(target);
  assert.deepEqual(await fa.saveFile(target, 'nouveau'), { ok: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'nouveau');

  const latin = path.join(root, 'latin1.txt');
  await fa.readFile(latin);
  assert.equal((await fa.saveFile(latin, 'x')).error, 'denied', 'non UTF-8 jamais réenregistrable');

  assert.equal((await fa.saveFile(path.join(root, 'nouveau.js'), 'x')).error, 'denied', 'création impossible');
  assert.equal((await fa.saveFile(target, 42)).error, 'invalid');
});

test('lien symbolique / jonction qui sort de la racine : refusé', async (t) => {
  const link = path.join(root, 'lien');
  try {
    fs.symlinkSync(outside, link, 'junction');
  } catch (e) {
    t.skip('création de jonction impossible ici : ' + e.code);
    return;
  }
  assert.equal((await fa.readFile(path.join(link, 'secret.txt'))).ok, false);
});
