// Intégration — identité navigateur des webviews (browser-identity.js), SANS
// accès réseau : chaque session de test sert une fausse page locale
// (protocol.handle), quel que soit l'hôte demandé.
//
// Filet pour les montées de version d'Electron (phase 3, P1) :
//   - la marque « GREASE » que nous calculons (brandList) doit être celle que
//     Chromium calcule lui-même pour sa version : si l'algorithme de Chromium
//     change, ce test le signale avant que Google ou Cloudflare ne le voient ;
//   - le commutateur « disable-features=FedCm » doit toujours exister et
//     masquer l'API FedCM (sinon « Continuer avec Google » ne fait plus rien) ;
//   - l'identité Chrome (hors Google) et Firefox (pages Google) doit être
//     appliquée telle que prévue, telle que la voient les scripts du site.
//
// Les en-têtes ajoutés ou retirés par webRequest (Sec-CH-UA…) ne sont PAS
// vérifiables ici : le faux serveur (protocol.handle) reçoit la requête avant
// ces modifications. Ils sont couverts par test/unit/browser-identity.test.js.

const path = require('path');
const fs = require('fs');
const { BrowserWindow, session, webContents } = require('electron');
const { scenario, plainEnvelope, sampleAccount, ROOT } = require('./harness');

const fakePage = () => new Response('<!doctype html><title>faux service</title><h1 id="ok">faux service local</h1>',
  { headers: { 'content-type': 'text/html' } });

// JavaScript exécuté dans la page testée : ce que voient les scripts du site.
const PROBE = `(async () => {
  const d = navigator.userAgentData;
  return {
    ua: navigator.userAgent,
    hasUAData: !!d,
    brands: d ? d.brands.map(b => ({ brand: b.brand, version: b.version })) : null,
    full: d ? (await d.getHighEntropyValues(['fullVersionList'])).fullVersionList.map(b => ({ brand: b.brand, version: b.version })) : null,
    identityCredential: typeof window.IdentityCredential,
    credentials: typeof navigator.credentials,
    chromeObject: typeof window.chrome,
    vendor: navigator.vendor
  };
})()`;

const isGrease = b => b.brand !== 'Chromium' && b.brand !== 'Google Chrome';

scenario('Identité navigateur : marques GREASE, FedCM, Chrome / Firefox', {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1)]));
  }
}, async ({ js, check, waitFor }) => {
  const identity = require(path.join(ROOT, 'browser-identity.js'));
  const chromeMajor = process.versions.chrome.split('.')[0];

  // --- 1. Référence : ce que Chromium annonce LUI-MÊME. Fenêtre cachée sans
  // opener, donc non suivie par browser-identity (aucun override), dans une
  // session en mémoire qui ne touche à aucun profil.
  const refSes = session.fromPartition('identite-reference');
  refSes.protocol.handle('https', fakePage);
  const ref = new BrowserWindow({ show: false, webPreferences: { session: refSes, sandbox: true, contextIsolation: true } });
  await ref.loadURL('https://reference.exemple.test/');
  const native = await ref.webContents.executeJavaScript(PROBE, true);
  ref.destroy();

  const nativeChromium = (native.brands || []).find(b => b.brand === 'Chromium');
  check('référence : Chromium annonce sa version majeure', nativeChromium && nativeChromium.version === chromeMajor, native.brands);

  const nativeGrease = (native.brands || []).find(isGrease);
  const ourGrease = identity.UA_METADATA.brands.find(isGrease);
  check('marque GREASE identique à celle de Chromium (nom et version)',
    nativeGrease && ourGrease && nativeGrease.brand === ourGrease.brand && nativeGrease.version === ourGrease.version,
    { chromium: nativeGrease, nous: ourGrease });

  const nativeGreaseFull = (native.full || []).find(isGrease);
  const ourGreaseFull = identity.UA_METADATA.fullVersionList.find(isGrease);
  check('marque GREASE identique en version complète',
    nativeGreaseFull && ourGreaseFull && nativeGreaseFull.version === ourGreaseFull.version,
    { chromium: nativeGreaseFull, nous: ourGreaseFull });

  check('FedCM masqué par « disable-features=FedCm » (pas d\'IdentityCredential)',
    native.identityCredential === 'undefined' && native.credentials === 'object', native);

  // --- 2. Webview d'un service non Google : identité CHROME complète.
  const ses = session.fromPartition('persist:profil_1');
  const headersByHost = new Map();
  ses.protocol.handle('https', (req) => {
    headersByHost.set(new URL(req.url).hostname, Object.fromEntries(req.headers));
    return fakePage();
  });
  const guest = async () => webContents.fromId(await js('document.querySelector("#pane1 webview").getWebContentsId()'));
  const loaded = () => js('!!document.querySelector("#pane1 .pane-loading") && document.querySelector("#pane1 .pane-loading").hidden && !document.querySelector("#pane1 .pane-error")');

  await js(`openService('acc_1', 'claude'); true`);
  await waitFor(loaded, 15000, 'chargement claude');
  const chrome = await (await guest()).executeJavaScript(PROBE, true);
  check('Chrome : UA réduit sans « Electron »', chrome.ua === identity.CHROME_UA && !/Electron/.test(chrome.ua), chrome.ua);
  check('Chrome : navigator.userAgentData = nos marques', JSON.stringify(chrome.brands) === JSON.stringify(identity.UA_METADATA.brands), chrome.brands);
  check('Chrome : liste complète des versions = la nôtre', JSON.stringify(chrome.full) === JSON.stringify(identity.UA_METADATA.fullVersionList), chrome.full);
  check('Chrome : FedCM masqué dans la webview', chrome.identityCredential === 'undefined', chrome.identityCredential);
  // User-Agent réseau : posé par l'override DevTools, donc visible du faux serveur.
  const claudeUA = (headersByHost.get('claude.ai') || {})['user-agent'];
  check('Chrome : User-Agent réseau = UA Chrome réduit', claudeUA === identity.CHROME_UA, claudeUA);

  // --- 3. Webview d'une page Google : identité FIREFOX cohérente.
  await js(`openService('acc_1', 'gemini'); true`);
  await waitFor(async () => (await js('(document.querySelector("#pane1 webview") || {}).src || ""')).includes('gemini.google.com') && await loaded(), 15000, 'chargement gemini');
  const ff = await (await guest()).executeJavaScript(PROBE, true);
  check('Firefox : UA Firefox sur les pages Google', ff.ua === identity.FIREFOX_UA, ff.ua);
  check('Firefox : ni navigator.userAgentData ni window.chrome', !ff.hasUAData && ff.chromeObject === 'undefined', ff);
  check('Firefox : navigator.vendor vide comme Firefox', ff.vendor === '', ff.vendor);
  const googleUA = (headersByHost.get('gemini.google.com') || {})['user-agent'];
  check('Firefox : User-Agent réseau = UA Firefox', googleUA === identity.FIREFOX_UA, googleUA);
});
