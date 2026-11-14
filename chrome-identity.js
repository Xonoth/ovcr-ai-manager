// ===== Identité "Google Chrome" cohérente pour les webviews et popups =====
//
// Pourquoi ce module : les pages de connexion Google (accounts.google.com, y
// compris via « Continuer avec Google » depuis Claude/Meshy/Suno…) refusent les
// navigateurs embarqués : « Ce navigateur ou cette application ne sont
// peut-être pas sécurisés ». Remplacer la chaîne User-Agent ne suffit pas
// (correctif 1.0.1) : Google compare plusieurs signaux, et ceux d'Electron se
// contredisaient :
//   - User-Agent        : "… Chrome/150.0.0.0 …" (déjà corrigé en 1.0.1)
//   - navigator.userAgentData.brands : ["Not;A=Brand", "Chromium"] — SANS
//     "Google Chrome", ce que tout vrai Chrome annonce ;
//   - en-têtes Sec-CH-UA : absents dès que l'UA est surchargé par
//     app.userAgentFallback, alors qu'un vrai Chrome les envoie toujours.
// Un "Chrome" qui ne se présente pas comme Chrome = navigateur embarqué.
//
// Solution : Emulation.setUserAgentOverride (protocole DevTools) avec des
// métadonnées complètes. C'est la seule API qui fixe D'UN COUP et de façon
// cohérente l'UA, les en-têtes Sec-CH-UA* et navigator.userAgentData, y compris
// les valeurs haute entropie (fullVersionList, platformVersion…).
// Appliqué à chaque <webview> et à chaque popup qu'elle ouvre (OAuth).

const os = require('os');

const CHROME_FULL = process.versions.chrome;           // ex. 150.0.7871.250
const CHROME_MAJOR = CHROME_FULL.split('.')[0];        // ex. 150

const UA_PLATFORM = process.platform === 'darwin'
  ? 'Macintosh; Intel Mac OS X 10_15_7'
  : process.platform === 'linux'
    ? 'X11; Linux x86_64'
    : 'Windows NT 10.0; Win64; x64';

// UA "réduit" exactement comme Chrome depuis la v110 : Chrome/<major>.0.0.0.
const USER_AGENT =
  `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// Marque "GREASE" + ordre des marques : reproduit l'algorithme de Chromium
// (components/embedder_support/user_agent_utils.cc), indexé sur la version
// majeure. Pour 150 : "Not;A=Brand" v8, puis Chromium, puis Google Chrome —
// identique à ce qu'Electron produit déjà, avec "Google Chrome" en plus.
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

// Version de plateforme telle que Chrome la rapporte sous Windows (version du
// contrat d'API UWP) : Windows 11 24H2/25H2 -> 19.0.0, Windows 11 antérieur ->
// 15.0.0, Windows 10 -> 10.0.0. Sans importance réelle hors Windows.
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

function applyOverride(contents) {
  const dbg = contents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (err) {
    // Déjà attaché par autre chose (DevTools ouverts…) : on garde l'UA de repli.
    console.warn('[ua] debugger indisponible :', err.message);
    return;
  }
  dbg.sendCommand('Emulation.setUserAgentOverride', {
    userAgent: USER_AGENT,
    platform: NAV_PLATFORM,
    userAgentMetadata: UA_METADATA
  }).catch(err => console.warn('[ua] override refusé :', err.message));
}

// ----- En-têtes Sec-CH-UA -----
// Electron n'envoie AUCUN en-tête Sec-CH-UA (même sans surcharge d'UA), alors
// qu'un vrai Chrome envoie toujours les trois "basse entropie" sur HTTPS, plus
// les "haute entropie" aux origines qui les ont demandés via Accept-CH.
// L'override DevTools ci-dessous ne corrige que le côté JavaScript
// (navigator.userAgentData) : les en-têtes sont donc ajoutés ici, au niveau
// réseau, avec exactement les mêmes valeurs.
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

// Origine -> ensemble des client hints demandés par Accept-CH (mémoire de
// processus, comme le fait Chrome pour la durée de la session).
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

function installClientHints(ses) {
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
    const present = new Set(Object.keys(headers).map(k => k.toLowerCase()));
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

function install(app) {
  // Chaque session (une par compte : persist:<profil>) reçoit les en-têtes.
  app.on('session-created', installClientHints);

  // Filet de sécurité : toute session (y compris les requêtes faites avant que
  // l'override DevTools ne s'applique) annonce au moins un UA Chrome sans
  // "Electron/x.y.z".
  app.userAgentFallback = USER_AGENT;

  // Webviews (les panneaux IA) et fenêtres popups (OAuth Google, etc.).
  // La fenêtre hôte (index.html local) n'est jamais concernée : elle ne charge
  // rien de distant.
  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType();
    if (type !== 'webview' && type !== 'window') return;
    if (type === 'window' && !contents.opener) return; // pas une popup : fenêtre hôte
    applyOverride(contents);
    // Si les DevTools d'un panneau sont ouverts puis refermés, le debugger est
    // détaché et l'override perdu : on le réapplique à la fermeture.
    contents.on('devtools-closed', () => applyOverride(contents));
  });
}

module.exports = { install, USER_AGENT, UA_METADATA };
