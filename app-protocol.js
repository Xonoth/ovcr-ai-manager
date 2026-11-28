// ===== Protocole app:// de l'interface (phase 3, P5) =====
//
// Jusqu'en 1.8.0, l'interface était chargée en file:// (win.loadFile). Son
// origine était alors « file:// » : partagée avec n'importe quel fichier local
// (localStorage commun, et 'self' de la CSP couvrant en pratique tout file://).
// Depuis la 1.9.0, elle est servie par un protocole propre :
//
//   app://ovcr/index.html   (origine « app://ovcr »)
//
// Ce module est PUR (sans Electron) pour être testé sous Node
// (test/unit/app-protocol.test.js). main.js enregistre le schéma avant
// app.ready (SCHEME_PRIVILEGES) et branche createAppProtocolHandler sur la
// session de la fenêtre principale UNIQUEMENT : les webviews (partitions
// persist:<profil>) ne voient pas ce protocole.
//
// Seuls les fichiers dont l'interface a besoin sont servis (liste ALLOWED) ;
// tout le reste (main.js, stockage des comptes, preloads, package.json…)
// répond 404, même s'il existe dans l'archive.

const path = require('path');

const APP_SCHEME = 'app';
const APP_HOST = 'ovcr';
const APP_ORIGIN = APP_SCHEME + '://' + APP_HOST;
const INDEX_URL = APP_ORIGIN + '/index.html';

// Privilèges du schéma (protocol.registerSchemesAsPrivileged) : « standard »
// (URL relatives, origine propre, localStorage) et « secure » (contexte
// sécurisé, comme https). Rien d'autre : pas de fetch, pas de CORS, pas de
// service workers.
const SCHEME_PRIVILEGES = Object.freeze({ standard: true, secure: true });

// Fichiers servis : chemins relatifs à la racine de l'app, en barres obliques.
const ALLOWED = Object.freeze([
  /^index\.html$/,
  /^renderer\/[a-z][a-z-]*\.js$/,
  /^assets\/icons\.js$/,
  /^assets\/fonts\/[A-Za-z][A-Za-z-]*\.woff2$/,
  // Monaco (chargé à la demande, dans app.asar.unpacked une fois packagé).
  /^node_modules\/monaco-editor\/min\/vs\/[A-Za-z0-9_./-]+\.(js|css|ttf)$/
]);

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
});

function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(String(file)).toLowerCase()] || null;
}

// Chemin relatif demandé (« renderer/app.js ») ou null s'il est invalide.
// L'URL a déjà été normalisée par Chromium (« /a/../b » -> « /b ») ; on refuse
// en plus ce qui, une fois décodé, sortirait de la racine ou serait ambigu.
function requestedPath(u) {
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch (_) { return null; }
  if (!rel.startsWith('/')) return null;
  rel = rel.slice(1);
  if (!rel || rel.length > 300) return null;
  if (/[\\\u0000-\u001f\u007f:]/.test(rel)) return null;
  const segments = rel.split('/');
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null;
  return rel;
}

// Décide quoi répondre à une requête. Renvoie
//   { ok: true, filePath, contentType }  ou  { ok: false, status, reason }.
function resolveAppRequest(request, appRoot) {
  let u;
  try { u = new URL(request && request.url); } catch (_) { return { ok: false, status: 400, reason: 'url illisible' }; }
  if (u.protocol !== APP_SCHEME + ':' || u.host !== APP_HOST) return { ok: false, status: 404, reason: 'hôte inconnu' };
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET') return { ok: false, status: 405, reason: 'méthode ' + method };
  const rel = requestedPath(u);
  if (!rel) return { ok: false, status: 400, reason: 'chemin invalide' };
  if (!ALLOWED.some(re => re.test(rel))) return { ok: false, status: 404, reason: 'hors liste' };
  const contentType = contentTypeFor(rel);
  if (!contentType) return { ok: false, status: 404, reason: 'type inconnu' };
  const root = path.resolve(appRoot);
  const filePath = path.resolve(root, ...rel.split('/'));
  if (!filePath.startsWith(root + path.sep)) return { ok: false, status: 400, reason: 'hors racine' };
  return { ok: true, filePath, contentType };
}

// L'URL est-elle exactement l'interface (app://ovcr/index.html, requête et
// ancre ignorées) ?
function isAppIndexUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === APP_SCHEME + ':' && u.host === APP_HOST && u.pathname === '/index.html';
  } catch (_) {
    return false;
  }
}

// Gestionnaire pour protocol.handle(APP_SCHEME, …). readFile est fs.promises.readFile
// en production (lit aussi dans app.asar et app.asar.unpacked) ; log reçoit
// les refus (chemin tronqué, jamais de contenu).
function createAppProtocolHandler({ appRoot, readFile, log = () => {} }) {
  const headers = (contentType) => ({
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store'
  });
  const refuse = (status, reason, request) => {
    log(`[app://] refus ${status} (${reason}) : ${String(request && request.url).slice(0, 120)}`);
    return new Response(null, { status, headers: { 'x-content-type-options': 'nosniff' } });
  };
  return async (request) => {
    const r = resolveAppRequest(request, appRoot);
    if (!r.ok) return refuse(r.status, r.reason, request);
    let body;
    try { body = await readFile(r.filePath); }
    catch (e) { return refuse(404, 'fichier absent (' + (e && e.code) + ')', request); }
    return new Response(body, { status: 200, headers: headers(r.contentType) });
  };
}

module.exports = {
  APP_SCHEME, APP_HOST, APP_ORIGIN, INDEX_URL, SCHEME_PRIVILEGES, ALLOWED,
  contentTypeFor, resolveAppRequest, isAppIndexUrl, createAppProtocolHandler
};
