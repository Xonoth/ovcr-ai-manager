// Tests unitaires — journal de diagnostic (diagnostics.js) : expurgation,
// rotation, validation et débit des rapports de l'interface.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fake = require('../helpers/fake-electron');

const MODULE = path.join(__dirname, '..', '..', 'diagnostics.js');
let diag, dir, logFile;

test.beforeEach(() => {
  fake.reset();
  fake.useTempUserData();
  diag = fake.freshRequire(MODULE);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-diag-'));
  logFile = path.join(dir, 'ovcr.log');
  diag._test.setFile(logFile);
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fake.cleanup();
});

test('expurgation : e-mails, URL (jetons), nom du compte Windows', () => {
  const user = path.basename(os.homedir());
  const s = diag.redact(`échec pour jean.dupont+ia@exemple.fr sur https://accounts.google.com/o/oauth2/auth?code=SECRET&state=x `
    + `fichier C:\\Users\\${user}\\AppData\\Roaming\\ai-manager\\accounts.json file:///C:/Users/${user}/x.html`);
  assert.doesNotMatch(s, /jean\.dupont/);
  assert.match(s, /<e-mail>/);
  assert.doesNotMatch(s, /SECRET|oauth2/);
  assert.match(s, /https:\/\/accounts\.google\.com\/…/);
  if (user.length > 1) assert.ok(!s.includes(`\\Users\\${user}\\`), 'nom d\'utilisateur retiré');
  assert.match(s, /<utilisateur>/);
  assert.doesNotMatch(s, /file:\/\/\/C:/);
});

test('expurgation : longueur bornée', () => {
  assert.ok(diag.redact('x'.repeat(10000)).length <= 2001);
});

test('record : écrit dans le fichier et dans la mémoire tampon', async () => {
  diag.record('warn', 'main', '[accounts] test a@b.fr');
  await diag.whenFlushed();
  const text = fs.readFileSync(logFile, 'utf8');
  assert.match(text, /WARN {2}\[main\] \[accounts\] test <e-mail>/);
  const last = diag.recent(1)[0];
  assert.equal(last.level, 'warn');
  assert.equal(last.message, '[accounts] test <e-mail>');
});

test('rotation : au-delà de 1 Mo, ovcr.log -> ovcr.1.log -> ovcr.2.log (3 fichiers max)', async () => {
  const big = 'y'.repeat(diag._test.MAX_FILE_BYTES + 10);
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(logFile, big + i);
    diag.record('info', 'main', 'ligne ' + i);
    await diag.whenFlushed();
  }
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['ovcr.1.log', 'ovcr.2.log', 'ovcr.log']);
  assert.ok(fs.statSync(logFile).size < 1000, 'fichier courant neuf');
});

test('rapports de l\'interface : validation stricte', () => {
  assert.equal(diag.reportFromRenderer(null), false);
  assert.equal(diag.reportFromRenderer('texte'), false);
  assert.equal(diag.reportFromRenderer([]), false);
  assert.equal(diag.reportFromRenderer({ message: 42 }), false);
  assert.equal(diag.reportFromRenderer({ message: '' }), false);
  assert.equal(diag.reportFromRenderer({ level: 'fatal', message: 'x' }), true);
  assert.equal(diag.recent(1)[0].level, 'error', '« fatal » réservé au main');
  assert.equal(diag.reportFromRenderer({ level: 'warn', message: 'm'.repeat(50000), stack: 's'.repeat(50000) }), true);
  const e = diag.recent(1)[0];
  assert.ok(e.message.length <= 2001 && e.stack.length <= 4001);
  assert.equal(e.source, 'interface');
});

test('rapports de l\'interface : limités à 60 par minute', () => {
  let accepted = 0;
  for (let i = 0; i < 200; i++) if (diag.reportFromRenderer({ message: 'boucle ' + i })) accepted++;
  assert.equal(accepted, 60);
});

test('mémoire tampon bornée', () => {
  for (let i = 0; i < 500; i++) diag.record('info', 'main', 'm' + i);
  assert.equal(diag.recent(1000).length, 300);
  assert.equal(diag.recent(1)[0].message, 'm499');
});
