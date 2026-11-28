// Tests unitaires — protocole app:// de l'interface (app-protocol.js, phase 3 P5).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../../app-protocol');

const ROOT = path.resolve(__dirname, '..', '..');
const get = (url, method = 'GET') => P.resolveAppRequest({ url, method }, ROOT);

test('constantes : origine et adresse de l\'interface', () => {
  assert.equal(P.APP_ORIGIN, 'app://ovcr');
  assert.equal(P.INDEX_URL, 'app://ovcr/index.html');
  assert.deepEqual({ ...P.SCHEME_PRIVILEGES }, { standard: true, secure: true, supportFetchAPI: true }, 'fetch (worker de Monaco), mais ni CORS, ni service workers, ni contournement de la CSP');
  assert.ok(Object.isFrozen(P.SCHEME_PRIVILEGES) && Object.isFrozen(P.ALLOWED));
});

test('resolveAppRequest : fichiers de l\'interface servis avec le bon type', () => {
  const cases = {
    'app://ovcr/index.html': ['index.html', 'text/html; charset=utf-8'],
    'app://ovcr/renderer/app.js': ['renderer/app.js', 'text/javascript; charset=utf-8'],
    'app://ovcr/renderer/pane-errors.js': ['renderer/pane-errors.js', 'text/javascript; charset=utf-8'],
    'app://ovcr/assets/icons.js': ['assets/icons.js', 'text/javascript; charset=utf-8'],
    'app://ovcr/assets/fonts/Inter-latin-ext.woff2': ['assets/fonts/Inter-latin-ext.woff2', 'font/woff2'],
    'app://ovcr/node_modules/monaco-editor/min/vs/loader.js': ['node_modules/monaco-editor/min/vs/loader.js', 'text/javascript; charset=utf-8'],
    'app://ovcr/node_modules/monaco-editor/min/vs/editor/editor.main.css': ['node_modules/monaco-editor/min/vs/editor/editor.main.css', 'text/css; charset=utf-8'],
    'app://ovcr/node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf': ['node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf', 'font/ttf'],
    // Requête et ancre ignorées pour le choix du fichier.
    'app://ovcr/index.html?x=1#y': ['index.html', 'text/html; charset=utf-8'],
    // Chromium normalise « .. » avant d'appeler le gestionnaire ; Node aussi.
    'app://ovcr/renderer/../index.html': ['index.html', 'text/html; charset=utf-8']
  };
  for (const [url, [rel, type]] of Object.entries(cases)) {
    const r = get(url);
    assert.equal(r.ok, true, url + ' : ' + r.reason);
    assert.equal(r.filePath, path.join(ROOT, ...rel.split('/')), url);
    assert.equal(r.contentType, type, url);
  }
});

test('resolveAppRequest : tout ce qui n\'est pas dans la liste répond 404', () => {
  for (const url of ['app://ovcr/main.js', 'app://ovcr/accounts-store.js', 'app://ovcr/app-preload.js',
    'app://ovcr/package.json', 'app://ovcr/security-policy.js',
    'app://ovcr/renderer/App.js', 'app://ovcr/INDEX.HTML', 'app://ovcr/renderer/sub/x.js',
    'app://ovcr/node_modules/monaco-editor/package.json', 'app://ovcr/node_modules/other/min/vs/x.js',
    'app://ovcr/node_modules/monaco-editor/min/vs/x.map', 'app://ovcr/assets/fonts/x.ttf',
    'app://ovcr/test/unit/app-protocol.test.js', 'app://ovcr/legacy-bridge/legacy-storage.html',
    // « %2e%2e » est un « .. » pour l'analyseur d'URL : normalisé AVANT nous.
    'app://ovcr/renderer/%2e%2e/main.js']) {
    const r = get(url);
    assert.equal(r.ok, false, url);
    assert.equal(r.status, 404, url + ' : ' + r.reason);
  }
});

test('resolveAppRequest : chemins piégés refusés (400)', () => {
  for (const url of ['app://ovcr/renderer%2f..%2fmain.js', 'app://ovcr/renderer/', 'app://ovcr/',
    'app://ovcr/renderer/%5c..%5cmain.js', 'app://ovcr/renderer//app.js', 'app://ovcr/renderer/%00.js',
    'app://ovcr/C:/Windows/win.ini', 'app://ovcr/%E0%A4%A', 'app://ovcr/' + 'a/'.repeat(200) + 'x.js']) {
    const r = get(url);
    assert.equal(r.ok, false, url);
    assert.equal(r.status, 400, url + ' : ' + r.reason);
  }
});

test('resolveAppRequest : autre hôte, autre schéma, autre méthode, URL illisible', () => {
  assert.equal(get('app://autre/index.html').status, 404);
  assert.equal(get('app://ovcr.evil/index.html').status, 404);
  assert.equal(get('app://user@ovcr:80/index.html').ok, false);
  assert.equal(get('file:///C:/x/index.html').status, 404);
  assert.equal(get('https://ovcr/index.html').status, 404);
  assert.equal(get('app://ovcr/index.html', 'POST').status, 405);
  assert.equal(get('app://ovcr/index.html', 'get').ok, true, 'méthode insensible à la casse');
  assert.equal(P.resolveAppRequest({ url: 'pas une url' }, ROOT).status, 400);
  assert.equal(P.resolveAppRequest(null, ROOT).status, 400);
  assert.equal(P.resolveAppRequest({ url: 'app://ovcr/index.html' }, ROOT).ok, true, 'méthode absente = GET');
});

test('isAppIndexUrl : seulement app://ovcr/index.html', () => {
  for (const u of ['app://ovcr/index.html', 'app://ovcr/index.html#x', 'app://ovcr/index.html?a=b']) {
    assert.equal(P.isAppIndexUrl(u), true, u);
  }
  for (const u of ['app://ovcr/', 'app://ovcr/renderer/app.js', 'app://autre/index.html', 'app://ovcr/index.htm',
    'file:///C:/app/index.html', 'https://ovcr/index.html', 'app://ovcr/sub/index.html', 'pas une url', '', null, undefined]) {
    assert.equal(P.isAppIndexUrl(u), false, String(u));
  }
});

test('createAppProtocolHandler : sert le fichier, en-têtes stricts', async () => {
  const reads = [];
  const handler = P.createAppProtocolHandler({ appRoot: ROOT, readFile: async (f) => { reads.push(f); return Buffer.from('contenu'); } });
  const res = await handler({ url: 'app://ovcr/renderer/app.js', method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), 'contenu');
  assert.deepEqual(reads, [path.join(ROOT, 'renderer', 'app.js')]);
});

test('createAppProtocolHandler : refus sans lecture du disque, et trace', async () => {
  const reads = [], logs = [];
  const handler = P.createAppProtocolHandler({ appRoot: ROOT, readFile: async (f) => { reads.push(f); return Buffer.from(''); }, log: (m) => logs.push(m) });
  for (const [url, status] of [['app://ovcr/main.js', 404], ['app://ovcr/renderer//app.js', 400], ['app://x/index.html', 404]]) {
    const res = await handler({ url, method: 'GET' });
    assert.equal(res.status, status, url);
    assert.equal(await res.text(), '', 'aucun contenu');
  }
  assert.equal((await handler({ url: 'app://ovcr/index.html', method: 'POST' })).status, 405);
  assert.deepEqual(reads, [], 'aucun fichier lu');
  assert.equal(logs.length, 4);
  assert.match(logs[0], /refus 404 \(hors liste\)/);
});

test('createAppProtocolHandler : fichier de la liste absent du disque -> 404', async () => {
  const logs = [];
  const handler = P.createAppProtocolHandler({
    appRoot: ROOT, log: (m) => logs.push(m),
    readFile: async () => { const e = new Error('absent'); e.code = 'ENOENT'; throw e; }
  });
  const res = await handler({ url: 'app://ovcr/renderer/absent.js', method: 'GET' });
  assert.equal(res.status, 404);
  assert.match(logs[0], /fichier absent \(ENOENT\)/);
});

test('createAppProtocolHandler : vrais fichiers de l\'interface lisibles', async () => {
  const fs = require('fs');
  const handler = P.createAppProtocolHandler({ appRoot: ROOT, readFile: fs.promises.readFile });
  const html = await (await handler({ url: P.INDEX_URL })).text();
  assert.match(html, /<script src="renderer\/app\.js"><\/script>/);
  // Chaque script et police référencé par index.html est servi.
  const refs = [...html.matchAll(/(?:src="|url\(")([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 15, refs.join());
  for (const ref of refs) {
    const res = await handler({ url: new URL(ref, P.INDEX_URL).href });
    assert.equal(res.status, 200, ref);
  }
  assert.equal((await handler({ url: 'app://ovcr/node_modules/monaco-editor/min/vs/loader.js' })).status, 200);
});
