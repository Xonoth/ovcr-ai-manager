// Tests unitaires — écriture atomique (atomic-file.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const af = require('../../atomic-file');

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-atomic-')); });
test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fsp = fs.promises;
function failRename(times, code) {
  const real = fsp.rename;
  let calls = 0;
  fsp.rename = async (...args) => {
    calls++;
    if (calls <= times) { const e = new Error('simulé ' + code); e.code = code; throw e; }
    return real.apply(fsp, args);
  };
  return { restore: () => { fsp.rename = real; }, calls: () => calls };
}

test('écrit puis remplace le contenu', async () => {
  const f = path.join(dir, 'x.json');
  await af.writeAtomicText(f, 'v1');
  await af.writeAtomicText(f, 'v2');
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('fichier verrouillé brièvement (EPERM) : réessaie puis réussit', async () => {
  const f = path.join(dir, 'x.json');
  await af.writeAtomicText(f, 'v1');
  const stub = failRename(2, 'EPERM');
  try {
    await af.writeAtomicText(f, 'v2');
  } finally { stub.restore(); }
  assert.equal(stub.calls(), 3);
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2');
});

test('verrou persistant : abandon, ancienne version intacte, pas de .tmp', async () => {
  const f = path.join(dir, 'x.json');
  await af.writeAtomicText(f, 'v1');
  const stub = failRename(100, 'EBUSY');
  try {
    await assert.rejects(af.writeAtomicText(f, 'v2'), { code: 'EBUSY' });
  } finally { stub.restore(); }
  assert.equal(fs.readFileSync(f, 'utf8'), 'v1');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('erreur non transitoire (EIO) : pas de nouvel essai', async () => {
  const f = path.join(dir, 'x.json');
  const stub = failRename(100, 'EIO');
  try {
    await assert.rejects(af.writeAtomicText(f, 'v'), { code: 'EIO' });
  } finally { stub.restore(); }
  assert.equal(stub.calls(), 1);
});

test('.tmp orphelin d\'une coupure précédente : écrasé sans gêner', async () => {
  const f = path.join(dir, 'x.json');
  fs.writeFileSync(f + '.tmp', 'résidu tronqué');
  await af.writeAtomicText(f, 'propre');
  assert.equal(fs.readFileSync(f, 'utf8'), 'propre');
});

test('copyAtomic : copie exacte, source absente -> erreur sans créer la cible', async () => {
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  fs.writeFileSync(a, 'contenu é');
  await af.copyAtomic(a, b);
  assert.equal(fs.readFileSync(b, 'utf8'), 'contenu é');
  await assert.rejects(af.copyAtomic(path.join(dir, 'absent'), path.join(dir, 'c')), { code: 'ENOENT' });
  assert.equal(fs.existsSync(path.join(dir, 'c')), false);
});

test('version synchrone : mêmes garanties', () => {
  const f = path.join(dir, 's.json');
  af.writeAtomicTextSync(f, '1');
  af.writeAtomicTextSync(f, '2');
  assert.equal(fs.readFileSync(f, 'utf8'), '2');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('fileStamp : utilisable dans un nom de fichier Windows', () => {
  assert.doesNotMatch(af.fileStamp(), /[:<>"|?*]/);
});
