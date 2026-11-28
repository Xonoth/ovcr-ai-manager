// Tests unitaires — autorisations des sites (site-permissions.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const fake = require('../helpers/fake-electron');

const MODULE = path.join(__dirname, '..', '..', 'site-permissions.js');

let sp, dir, handlers;

function install() {
  sp = fake.freshRequire(MODULE);
  fake.electron.app.removeAllListeners('session-created');
  sp.install(fake.electron.app);
  handlers = {};
  fake.electron.app.emit('session-created', {
    setPermissionRequestHandler: fn => { handlers.request = fn; },
    setPermissionCheckHandler: fn => { handlers.check = fn; }
  });
}

const wc = url => ({ getURL: () => url, hostWebContents: null });
function request(url, permission, details = {}) {
  return new Promise(resolve => handlers.request(wc(url), permission, resolve, { requestingUrl: url, ...details }));
}

test.beforeEach(() => {
  fake.reset();
  dir = fake.useTempUserData();
  install();
});
test.afterEach(() => fake.cleanup());

test('interface locale (app://ovcr) : uniquement presse-papiers et plein écran', async () => {
  const local = 'app://ovcr/index.html';
  assert.equal(await request(local, 'clipboard-sanitized-write'), true);
  assert.equal(await request(local, 'clipboard-read'), true);
  assert.equal(await request(local, 'fullscreen'), true);
  assert.equal(await request(local, 'geolocation'), false);
  assert.equal(await request(local, 'media', { mediaTypes: ['audio'] }), false);
  assert.equal(await request(local, 'storage-access'), false, 'pas même ce que les sites reçoivent sans question');
  assert.equal(handlers.check(null, 'clipboard-read', 'app://ovcr'), true);
  assert.equal(handlers.check(null, 'notifications', 'app://ovcr'), false);
  assert.equal(fake.state.messageBoxCalls.length, 0, 'aucune question posée');
});

test('page file:// (pont vers l\'ancien localStorage, ancienne interface) : rien, sans question', async () => {
  const page = 'file:///C:/app/legacy-bridge/legacy-storage.html';
  for (const perm of ['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem', 'storage-access', 'geolocation', 'notifications']) {
    assert.equal(await request(page, perm), false, perm);
    assert.equal(handlers.check(null, perm, 'file:///'), false, perm);
  }
  assert.equal(fake.state.messageBoxCalls.length, 0, 'aucune question posée');
});

test('origine opaque ou hôte app:// inconnu : refusé, sans question', async () => {
  for (const url of ['app://autre/index.html', 'data:text/html,x', 'about:blank']) {
    assert.equal(await request(url, 'geolocation'), false, url);
    assert.equal(await request(url, 'clipboard-read'), false, url);
  }
  assert.equal(fake.state.messageBoxCalls.length, 0);
});

test('accordé sans question : écriture presse-papiers, plein écran, DRM', async () => {
  for (const perm of ['clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']) {
    assert.equal(await request('https://claude.ai/', perm), true, perm);
  }
  assert.equal(fake.state.messageBoxCalls.length, 0);
});

test('refusé sans question : USB, série, HID, MIDI…', async () => {
  for (const perm of ['usb', 'serial', 'hid', 'midi', 'midiSysex', 'idle-detection', 'window-management', 'pointerLock']) {
    assert.equal(await request('https://claude.ai/', perm), false, perm);
  }
  assert.equal(fake.state.messageBoxCalls.length, 0);
});

test('position : question posée, refus mémorisé sans redemande', async () => {
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: true };
  assert.equal(await request('https://www.perplexity.ai/', 'geolocation'), false);
  assert.equal(fake.state.messageBoxCalls.length, 1);
  assert.equal(await request('https://www.perplexity.ai/', 'geolocation'), false);
  assert.equal(fake.state.messageBoxCalls.length, 1, 'pas de 2e question');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'site-permissions.json'), 'utf8'));
  assert.equal(saved['https://www.perplexity.ai|geolocation'], 'deny');
});

test('« autoriser une fois » : accordé mais non mémorisé', async () => {
  fake.state.messageBoxResponse = { response: 0, checkboxChecked: false };
  assert.equal(await request('https://chatgpt.com/', 'media', { mediaTypes: ['audio'] }), true);
  assert.equal(await request('https://chatgpt.com/', 'media', { mediaTypes: ['audio'] }), true);
  assert.equal(fake.state.messageBoxCalls.length, 2);
});

// Electron 45 : la capture d'écran arrive sous le nom « display-capture » (et
// non plus « media » sans mediaTypes) ; « media » ne couvre que micro/caméra.
test('capture d\'écran (display-capture) : question dédiée, mémorisée à part du micro', async () => {
  fake.state.messageBoxResponse = { response: 0, checkboxChecked: true };
  assert.equal(await request('https://chatgpt.com/', 'display-capture'), true);
  assert.equal(fake.state.messageBoxCalls.length, 1);
  assert.match(fake.state.messageBoxCalls[0].message, /chatgpt\.com demande à capturer votre écran\./);
  assert.doesNotMatch(fake.state.messageBoxCalls[0].message, /micro|caméra/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'site-permissions.json'), 'utf8'));
  assert.equal(saved['https://chatgpt.com|display-capture'], 'allow');
  assert.equal(saved['https://chatgpt.com|media:audio'], undefined, 'le micro n\'est pas accordé avec l\'écran');

  // Redemande : choix mémorisé, aucune nouvelle question ; vérification synchrone cohérente.
  assert.equal(await request('https://chatgpt.com/', 'display-capture'), true);
  assert.equal(fake.state.messageBoxCalls.length, 1);
  assert.equal(handlers.check(null, 'display-capture', 'https://chatgpt.com'), true);

  // Micro demandé ensuite (media + mediaTypes audio) : question distincte.
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: true };
  assert.equal(await request('https://chatgpt.com/', 'media', { mediaTypes: ['audio'] }), false);
  assert.equal(fake.state.messageBoxCalls.length, 2);
  assert.match(fake.state.messageBoxCalls[1].message, /utiliser votre micro\./);
});

test('capture d\'écran refusée et mémorisée : refusée sans question, y compris en vérification', async () => {
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: true };
  assert.equal(await request('https://claude.ai/', 'display-capture'), false);
  assert.equal(await request('https://claude.ai/', 'display-capture'), false);
  assert.equal(fake.state.messageBoxCalls.length, 1);
  assert.equal(handlers.check(null, 'display-capture', 'https://claude.ai'), false);
  assert.equal(await request('app://ovcr/index.html', 'display-capture'), false, 'jamais pour l\'interface locale');
});

test('vérification synchrone : notifications non accordées tant que non décidées', () => {
  assert.equal(handlers.check(null, 'notifications', 'https://claude.ai'), false);
  assert.equal(handlers.check(null, 'geolocation', 'https://claude.ai'), true, 'laisse la page tenter -> question');
  assert.equal(handlers.check(null, 'usb', 'https://claude.ai'), false);
  assert.equal(handlers.check(null, 'geolocation', 'app://ovcr'), false);
  assert.equal(handlers.check(null, 'geolocation', 'file:///C:/app/index.html'), false);
});

test('reset : oublie les choix mémorisés', async () => {
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: true };
  await request('https://grok.com/', 'geolocation');
  sp.reset();
  fake.state.messageBoxResponse = { response: 0, checkboxChecked: false };
  assert.equal(await request('https://grok.com/', 'geolocation'), true);
  assert.equal(fake.state.messageBoxCalls.length, 2);
});

test('M4 — fichier d\'autorisations corrompu : mis de côté, pas écrasé en silence', async () => {
  fs.writeFileSync(path.join(dir, 'site-permissions.json'), '{corrompu');
  install();
  const aside = fs.readdirSync(dir).filter(f => /^site-permissions\.unreadable-.*\.json$/.test(f));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{corrompu', 'contenu conservé tel quel');
  // Repart de zéro : on redemande (rien n'est accordé d'office).
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: false };
  assert.equal(await request('https://claude.ai/', 'geolocation'), false);
  assert.equal(fake.state.messageBoxCalls.length, 1);
});

test('M4 — entrées mal formées ignorées, entrées valides conservées', async () => {
  fs.writeFileSync(path.join(dir, 'site-permissions.json'), JSON.stringify({
    'https://grok.com|geolocation': 'deny',
    'https://grok.com|notifications': 'peut-être',
    'sans-barre': 'allow',
    '__proto__': 'allow'
  }));
  install();
  assert.equal(await request('https://grok.com/', 'geolocation'), false);
  assert.equal(fake.state.messageBoxCalls.length, 0, 'refus mémorisé respecté');
  assert.equal(handlers.check(null, 'notifications', 'https://grok.com'), false, 'valeur invalide = non décidée');
});

test('M4 — JSON valide mais pas un objet (tableau) : traité comme illisible', () => {
  fs.writeFileSync(path.join(dir, 'site-permissions.json'), '["x"]');
  install();
  assert.ok(fs.readdirSync(dir).some(f => /^site-permissions\.unreadable-/.test(f)));
});

test('versionnement : $schema écrit ; fichier 1.1.0 (sans $schema) relu ; schéma futur jamais réécrit', async () => {
  fs.writeFileSync(path.join(dir, 'site-permissions.json'), JSON.stringify({ 'https://grok.com|geolocation': 'deny' }));
  install();
  fake.state.messageBoxResponse = { response: 1, checkboxChecked: true };
  await request('https://claude.ai/', 'geolocation');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'site-permissions.json'), 'utf8'));
  assert.equal(saved.$schema, 1);
  assert.equal(saved['https://grok.com|geolocation'], 'deny', 'choix 1.1.0 conservé');

  const future = JSON.stringify({ $schema: 9, 'https://grok.com|geolocation': 'allow' });
  fs.writeFileSync(path.join(dir, 'site-permissions.json'), future);
  install();
  assert.equal(await request('https://grok.com/', 'geolocation'), true, 'choix lu');
  await request('https://chatgpt.com/', 'geolocation');
  assert.equal(fs.readFileSync(path.join(dir, 'site-permissions.json'), 'utf8'), future, 'fichier non réécrit');
});

test('écriture atomique : aucun .tmp laissé, contenu relisible', async () => {
  fake.state.messageBoxResponse = { response: 0, checkboxChecked: true };
  await request('https://claude.ai/', 'notifications');
  assert.equal(fs.existsSync(path.join(dir, 'site-permissions.json.tmp')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'site-permissions.json'), 'utf8'))['https://claude.ai|notifications'], 'allow');
});
