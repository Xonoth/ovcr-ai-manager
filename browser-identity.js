// ===== Identité navigateur des webviews et popups =====
//
// Problème : Google refuse les connexions depuis un navigateur embarqué —
// « Impossible de vous connecter. Ce navigateur ou cette application ne sont
// peut-être pas sécurisés » (redirection vers /v3/signin/rejected), que ce
// soit dans le panneau Gemini ou dans la popup « Continuer avec Google » de
// Claude, ChatGPT, Suno, Meshy…
//
// Historique :
//   - 1.0.1 : UA Chrome sans "Electron/x.y.z"            -> toujours bloqué ;
//   - 1.0.2 : identité Chrome complète (UA + Sec-CH-UA +
//             navigator.userAgentData avec "Google Chrome") -> toujours bloqué.
// Google vérifie aussi en JavaScript des dizaines de détails propres au vrai
// Chrome (objet window.chrome, Widevine, voix de synthèse…) qu'Electron n'a
// pas : un « Chrome » qui n'en a pas tous les organes reste suspect.
// Tests (novembre 2026, adresse fictive, même machine) : identité Chrome
// rejetée à chaque essai ; identité Firefox acceptée plusieurs fois. Firefox
// a un moteur différent, Google n'y attend donc aucun de ces détails Chrome.
//
// Stratégie :
//   - pages Google (google.com et sous-domaines : accounts., gemini.…) ->
//     identité FIREFOX cohérente : UA Firefox, aucun en-tête Sec-CH-UA,
//     pas de navigator.userAgentData ni de window.chrome ;
//   - tout le reste -> identité CHROME complète (comme en 1.0.2). On ne met
//     PAS Firefox partout : les protections anti-robot de Claude/ChatGPT
//     (Cloudflare) repèrent un moteur Chromium qui se dit Firefox.
// L'identité suit la page principale de chaque webview/popup et bascule à
// chaque navigation (ex. popup Claude -> accounts.google.com -> retour).

const os = require('os');
const path = require('path');

// ----------------------------------------------------------------- Chrome --

const CHROME_FULL = process.versions.chrome;           // ex. 150.0.7871.250
const CHROME_MAJOR = CHROME_FULL.split('.')[0];        // ex. 150

const UA_PLATFORM = process.platform === 'darwin'
  ? 'Macintosh; Intel Mac OS X 10_15_7'
  : process.platform === 'linux'
    ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';

// UA "réduit" exactement comme Chrome depuis la v110 : Chrome/<major>.0.0.0.
const CHROME_UA =
  `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// Marque "GREASE" + ordre des marques : algorithme de Chromium
// (components/embedder_support/user_agent_utils.cc), indexé sur la version
// majeure. Pour 150 : "Not;A=Brand" v8, Chromium, Google Chrome.
function brandList(fullVersions) {
  const seed = Number(CHROME_MAJOR);
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const greasedVersions = ['8', '99', '24'];
  const greaseBrand = `Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand`;
  const greaseMajor = greasedVersions[seed % greasedVersions.length];
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const order = orders[seed % 6];
  const v = fullVersions ? CHROME_FULL : CHROME_MAJOR;
  const entries = [
    { brand: greaseBrand, version: fullVersions ? `${greaseMajor}.0.0.0` : greaseMajor },
    { brand: 'Chromium', version: v },
    { brand: 'Google Chrome', version: v }
  ];
  const list = [];
  entries.forEach((e, i) => { list[order[i]] = e; });
  return list;
}

// Version de plateforme rapportée par Chrome sous Windows : Windows 11
// 24H2/25H2 -> 19.0.0, Windows 11 antérieur -> 15.0.0, Windows 10 -> 10.0.0.
function platformVersion() {
  if (process.platform !== 'win32') return os.release();
  const build = Number(os.release().split('.')[2]) || 0;
  if (build >= 26100) return '19.0.0';
  if (build >= 22000) return '15.0.0';
  return '10.0.0';
}

const UA_METADATA = {
  brands: brandList(false),
  fullVersionList: brandList(true),
  fullVersion: CHROME_FULL,
  platform: process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : 'Windows',
  platformVersion: platformVersion(),
  architecture: process.arch === 'arm64' ? 'arm' : 'x86',
  model: '',
  mobile: false,
  bitness: process.arch === 'ia32' ? '32' : '64',
  wow64: false
};

const NAV_PLATFORM = process.platform === 'darwin' ? 'MacIntel'
  : process.platform === 'linux' ? 'Linux x86_64' : 'Win32';

// ---------------------------------------------------------------- Firefox --

// Version courante de Firefox, déduite de la date : une version toutes les
// 4 semaines depuis Firefox 134 (7 janvier 2025). Un UA figé vieillirait et
// finirait lui-même par paraître suspect.
function firefoxMajor() {
  const elapsed = Date.now() - Date.UTC(2025, 0, 7);
  return 134 + Math.max(0, Math.floor(elapsed / (28 * 24 * 3600 * 1000)));
}
const FF_MAJOR = firefoxMajor();
const FF_PLATFORM = process.platform === 'darwin'
  ? 'Macintosh; Intel Mac OS X 10.15'
  : process.platform === 'linux'
    ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';
const FIREFOX_UA =
  `Mozilla/5.0 (${FF_PLATFORM}; rv:${FF_MAJOR}.0) Gecko/20100101 Firefox/${FF_MAJOR}.0`;

// ------------------------------------------------------- Choix d'identité --

// google.com et tous ses sous-domaines (accounts., gemini., myaccount.…).
function isGoogleHost(host) {
  return host === 'google.com' || host.endsWith('.google.com');
}

function identityFor(urlStr) {
  try {
    return isGoogleHost(new URL(urlStr).hostname.toLowerCase()) ? 'firefox' : 'chrome';
  } catch (_) {
    return 'chrome';
  }
}

// ------------------------------------------- Override DevTools par onglet --

// Identité appliquée à chaque webContents (webview/popup), par id.
const identityByContents = new Map();

function setIdentity(contents, identity) {
  if (identityByContents.get(contents.id) === identity) return;
  identityByContents.set(contents.id, identity);
  const dbg = contents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (err) {
    // Déjà attaché par autre chose (DevTools ouverts…) : on garde l'UA de repli.
    console.warn('[ua] debugger indisponible :', err.message);
    return;
  }
  // Chrome : métadonnées complètes -> navigator.userAgentData cohérent.
  // Firefox : pas de métadonnées (Firefox n'a pas de client hints) ; le
  // preload supprime navigator.userAgentData et window.chrome côté page.
  const params = identity === 'firefox'
    ? { userAgent: FIREFOX_UA, platform: NAV_PLATFORM }
    : { userAgent: CHROME_UA, platform: NAV_PLATFORM, userAgentMetadata: UA_METADATA };
  dbg.sendCommand('Emulation.setUserAgentOverride', params)
    .catch(err => console.warn('[ua] override refusé :', err.message));
}

function trackContents(contents) {
  setIdentity(contents, 'chrome');
  // Bascule AVANT que la page n'arrive : au démarrage de la navigation et à
  // chaque redirection (ex. claude.ai -> accounts.google.com).
  const onNav = (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    setIdentity(contents, identityFor(details.url));
  };
  contents.on('did-start-navigation', onNav);
  contents.on('did-redirect-navigation', onNav);
  // DevTools d'un panneau refermés -> debugger détaché, override perdu.
  contents.on('devtools-closed', () => {
    const current = identityByContents.get(contents.id) || 'chrome';
    identityByContents.delete(contents.id);
    setIdentity(contents, current);
  });
  contents.once('destroyed', () => identityByContents.delete(contents.id));
}

// ------------------------------------------------- En-têtes HTTP (réseau) --

// Electron n'envoie AUCUN en-tête Sec-CH-UA ; un vrai Chrome envoie toujours
// les trois "basse entropie" sur HTTPS, plus les "haute entropie" aux origines
// qui les demandent via Accept-CH. Firefox, lui, n'en envoie aucun.
const q = s => `"${s}"`;
const brandHeader = list => list.map(b => `${q(b.brand)};v=${q(b.version)}`).join(', ');

const LOW_ENTROPY_HEADERS = {
  'sec-ch-ua': brandHeader(UA_METADATA.brands),
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': q(UA_METADATA.platform)
};

const HIGH_ENTROPY_HEADERS = {
  'sec-ch-ua-full-version-list': brandHeader(UA_METADATA.fullVersionList),
  'sec-ch-ua-full-version': q(UA_METADATA.fullVersion),
  'sec-ch-ua-platform-version': q(UA_METADATA.platformVersion),
  'sec-ch-ua-arch': q(UA_METADATA.architecture),
  'sec-ch-ua-bitness': q(UA_METADATA.bitness),
  'sec-ch-ua-model': q(UA_METADATA.model),
  'sec-ch-ua-wow64': '?0',
  'sec-ch-ua-form-factors': q('Desktop')
};

// Origine -> client hints demandés par Accept-CH (mémoire de processus).
const acceptChByOrigin = new Map();

function originOf(urlStr) {
  try { return new URL(urlStr).origin; } catch (_) { return null; }
}

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
  if (!key) return null;
  const v = headers[key];
  return Array.isArray(v) ? v.join(',') : v;
}

// Identité d'une requête : la page principale décide pour elle-même (la
// navigation vers accounts.google.com part avant que la bascule ne soit
// faite) ; les sous-ressources suivent la page qui les charge.
function identityForRequest(details) {
  if (details.resourceType === 'mainFrame') return identityFor(details.url);
  const known = identityByContents.get(details.webContentsId);
  return known || identityFor(details.url);
}

function installHeaders(ses) {
  ses.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, callback) => {
    const acceptCh = headerValue(details.responseHeaders, 'accept-ch');
    const origin = originOf(details.url);
    if (acceptCh && origin) {
      acceptChByOrigin.set(origin, new Set(acceptCh.toLowerCase().split(',').map(s => s.trim())));
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    const headers = details.requestHeaders;
    const keys = Object.keys(headers);

    if (identityForRequest(details) === 'firefox') {
      for (const k of keys) {
        const lk = k.toLowerCase();
        if (lk.startsWith('sec-ch-ua')) delete headers[k];
        else if (lk === 'user-agent') delete headers[k];
      }
      headers['User-Agent'] = FIREFOX_UA;
      return callback({ requestHeaders: headers });
    }

    const present = new Set(keys.map(k => k.toLowerCase()));
    const add = (name, value) => { if (!present.has(name)) headers[name] = value; };
    for (const [name, value] of Object.entries(LOW_ENTROPY_HEADERS)) add(name, value);
    const requested = acceptChByOrigin.get(originOf(details.url));
    if (requested) {
      for (const [name, value] of Object.entries(HIGH_ENTROPY_HEADERS)) {
        if (requested.has(name)) add(name, value);
      }
    }
    callback({ requestHeaders: headers });
  });
}

// ------------------------------------------------------------- Install --

const PRELOAD = path.join(__dirname, 'browser-identity-preload.js');


function install(app) {
  // Filet de sécurité : tout ce qui échappe aux overrides annonce au moins un
  // UA Chrome sans "Electron/x.y.z".
  app.userAgentFallback = CHROME_UA;

  // FedCM désactivé. Le bouton « Continuer avec Google » des sites tiers
  // (Google Identity Services, ex. Perplexity) passe par FedCM
  // (navigator.credentials.get({identity})) dès que le navigateur l'expose et
  // qu'une session Google existe. Electron expose l'API mais n'a ni la boîte
  // de dialogue ni les comptes de Chrome : l'appel échoue en silence
  // ("[GSI_LOGGER]: FedCM get() rejects…") et le clic ne fait RIEN. Sans
  // FedCM, GIS retombe sur la redirection/popup OAuth classique, qui marche.
  // À poser avant app.ready, donc ici au chargement de main.js.
  app.commandLine.appendSwitch('disable-features', 'FedCm');

  // Chaque session (une par compte : persist:<profil>) reçoit les en-têtes
  // et le preload. Le preload est enregistré sur la SESSION (et non via
  // will-attach-webview) pour couvrir aussi les popups OAuth, qui n'héritent
  // pas du preload de leur webview. Il ne fait rien hors des pages Google.
  app.on('session-created', (ses) => {
    installHeaders(ses);
    ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD });
  });

  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType();
    if (type !== 'webview' && type !== 'window') return;
    if (type === 'window' && !contents.opener) return; // pas une popup : fenêtre hôte
    trackContents(contents);
  });
}

module.exports = { install, CHROME_UA, FIREFOX_UA, UA_METADATA, identityFor };
