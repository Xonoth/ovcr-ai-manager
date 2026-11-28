// Tests unitaires — browser-identity.js : en-têtes HTTP (Sec-CH-UA, User-Agent)
// et bascule Chrome / Firefox par webContents.
//
// Ces règles ne sont pas vérifiables en intégration : le faux serveur local
// (protocol.handle) reçoit la requête AVANT les modifications de webRequest.
// On appelle donc directement les écouteurs que le module enregistre.
// La cohérence avec le vrai Chromium (marque GREASE, FedCM) est vérifiée par
// test/integration/browser-identity.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// Sous Node, process.versions.chrome n'existe pas : on fixe une version connue.
Object.defineProperty(process.versions, 'chrome', { value: '150.0.7871.250', configurable: true, enumerable: true });
const identity = require('../../browser-identity');

// --- Faux app / session / webContents
function setup() {
  const app = new EventEmitter();
  const switches = [];
  app.commandLine = { appendSwitch: (...a) => switches.push(a) };
  identity.install(app);

  const listeners = {};
  const preloads = [];
  const ses = {
    webRequest: {
      onHeadersReceived: (_filter, fn) => { listeners.received = fn; },
      onBeforeSendHeaders: (_filter, fn) => { listeners.send = fn; }
    },
    registerPreloadScript: p => preloads.push(p)
  };
  app.emit('session-created', ses);

  const send = (details) => new Promise(resolve => listeners.send({ requestHeaders: {}, ...details }, r => resolve(r.requestHeaders || details.requestHeaders)));
  const receive = (url, responseHeaders) => new Promise(resolve => listeners.received({ url, responseHeaders }, resolve));
  return { app, switches, preloads, send, receive };
}

let nextId = 1000;
function fakeContents(type = 'webview') {
  const c = new EventEmitter();
  c.id = nextId++;
  c.getType = () => type;
  c.opener = null;
  c.commands = [];
  let attached = false;
  c.debugger = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    sendCommand: (name, params) => { c.commands.push({ name, params }); return Promise.resolve(); }
  };
  return c;
}

const lastOverride = c => c.commands.filter(x => x.name === 'Emulation.setUserAgentOverride').pop().params;

test('install : FedCM désactivé, preload enregistré sur chaque session', () => {
  const { switches, preloads } = setup();
  assert.deepEqual(switches, [['disable-features', 'FedCm']]);
  assert.equal(preloads.length, 1);
  assert.equal(preloads[0].type, 'frame');
  assert.match(preloads[0].filePath, /browser-identity-preload\.js$/);
});

test('marques pour Chromium 150 : « Not;A=Brand » v8 en tête, puis Chromium, Google Chrome', () => {
  assert.deepEqual(identity.UA_METADATA.brands, [
    { brand: 'Not;A=Brand', version: '8' },
    { brand: 'Chromium', version: '150' },
    { brand: 'Google Chrome', version: '150' }
  ]);
  assert.equal(identity.UA_METADATA.fullVersionList[0].version, '8.0.0.0');
  assert.equal(identity.UA_METADATA.fullVersionList[2].version, '150.0.7871.250');
  assert.equal(identity.CHROME_UA.includes('Chrome/150.0.0.0 '), true);
  assert.equal(/Electron/.test(identity.CHROME_UA), false);
});

test('identityFor : Firefox pour google.com et ses sous-domaines seulement', () => {
  assert.equal(identity.identityFor('https://accounts.google.com/signin'), 'firefox');
  assert.equal(identity.identityFor('https://gemini.google.com/app'), 'firefox');
  assert.equal(identity.identityFor('https://google.com/'), 'firefox');
  assert.equal(identity.identityFor('https://claude.ai/'), 'chrome');
  assert.equal(identity.identityFor('https://notgoogle.com/'), 'chrome');
  assert.equal(identity.identityFor('https://google.com.exemple.test/'), 'chrome');
  assert.equal(identity.identityFor('pas une url'), 'chrome');
});

test('Chrome : les trois Sec-CH-UA « basse entropie » sont ajoutés', async () => {
  const { send } = setup();
  const h = await send({ url: 'https://claude.ai/', resourceType: 'mainFrame' });
  assert.equal(h['sec-ch-ua'], '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"');
  assert.equal(h['sec-ch-ua-mobile'], '?0');
  assert.equal(h['sec-ch-ua-platform'], `"${identity.UA_METADATA.platform}"`);
  assert.equal(h['sec-ch-ua-full-version-list'], undefined, 'haute entropie seulement sur demande');
});

test('Chrome : un en-tête déjà présent n\'est jamais écrasé', async () => {
  const { send } = setup();
  const h = await send({ url: 'https://claude.ai/', resourceType: 'mainFrame', requestHeaders: { 'Sec-CH-UA': 'déjà là' } });
  assert.equal(h['Sec-CH-UA'], 'déjà là');
  assert.equal(h['sec-ch-ua'], undefined);
});

test('Chrome : haute entropie envoyée seulement à l\'origine qui la demande (Accept-CH)', async () => {
  const { send, receive } = setup();
  await receive('https://chatgpt.com/', { 'Accept-CH': ['Sec-CH-UA-Full-Version-List, Sec-CH-UA-Arch'] });
  const asked = await send({ url: 'https://chatgpt.com/api', resourceType: 'xhr' });
  assert.equal(asked['sec-ch-ua-full-version-list'], '"Not;A=Brand";v="8.0.0.0", "Chromium";v="150.0.7871.250", "Google Chrome";v="150.0.7871.250"');
  assert.equal(asked['sec-ch-ua-arch'], '"x86"');
  assert.equal(asked['sec-ch-ua-model'], undefined, 'non demandé');
  const other = await send({ url: 'https://claude.ai/', resourceType: 'mainFrame' });
  assert.equal(other['sec-ch-ua-full-version-list'], undefined, 'autre origine');
});

test('Firefox : page Google -> aucun Sec-CH-UA, User-Agent Firefox (quelle que soit la casse)', async () => {
  const { send } = setup();
  const h = await send({
    url: 'https://accounts.google.com/v3/signin',
    resourceType: 'mainFrame',
    requestHeaders: { 'user-agent': 'Chrome', 'Sec-CH-UA': 'x', 'sec-ch-ua-mobile': '?0', Accept: 'text/html' }
  });
  assert.deepEqual(Object.keys(h).filter(k => /^sec-ch-ua/i.test(k)), []);
  assert.deepEqual(Object.keys(h).filter(k => k.toLowerCase() === 'user-agent'), ['User-Agent']);
  assert.equal(h['User-Agent'], identity.FIREFOX_UA);
  assert.equal(h.Accept, 'text/html', 'les autres en-têtes sont conservés');
});

test('bascule par webContents : override DevTools et sous-ressources suivent la page', async () => {
  const { app, send } = setup();
  const c = fakeContents('webview');
  app.emit('web-contents-created', {}, c);
  assert.equal(lastOverride(c).userAgent, identity.CHROME_UA, 'Chrome par défaut');
  assert.deepEqual(lastOverride(c).userAgentMetadata, identity.UA_METADATA);

  c.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://accounts.google.com/' });
  assert.equal(lastOverride(c).userAgent, identity.FIREFOX_UA);
  assert.equal(lastOverride(c).userAgentMetadata, undefined, 'Firefox n\'a pas de client hints');

  // Sous-ressource hors google.com chargée PAR la page Google : identité Firefox.
  const sub = await send({ url: 'https://www.gstatic.com/x.js', resourceType: 'script', webContentsId: c.id });
  assert.equal(sub['User-Agent'], identity.FIREFOX_UA);
  assert.equal(sub['sec-ch-ua'], undefined);

  // Navigation de sous-cadre ou dans le même document : aucune bascule.
  const n = c.commands.length;
  c.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'https://claude.ai/' });
  c.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: 'https://claude.ai/' });
  assert.equal(c.commands.length, n);

  // Redirection retour vers le site : Chrome de nouveau.
  c.emit('did-redirect-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://claude.ai/callback' });
  assert.equal(lastOverride(c).userAgent, identity.CHROME_UA);
  c.emit('destroyed');
});

test('suivi : popups (fenêtre avec opener) oui, fenêtre hôte et autres types non', () => {
  const { app } = setup();
  const popup = fakeContents('window');
  popup.opener = {};
  const host = fakeContents('window');
  const bg = fakeContents('backgroundPage');
  for (const c of [popup, host, bg]) app.emit('web-contents-created', {}, c);
  assert.equal(popup.commands.length, 1);
  assert.equal(host.commands.length, 0);
  assert.equal(bg.commands.length, 0);
});
