// ===== Règles de sécurité pures (sans état, sans Electron) =====
//
// Extraites de main.js (phase 2, lot 0) pour être testées unitairement. La
// logique est IDENTIQUE à celle de la phase 1 : ne pas l'assouplir ici sans
// mettre à jour SECURITY.md et les tests (test/unit/security-policy.test.js).

const path = require('path');
const { fileURLToPath } = require('url');

// Origines de confiance : les 9 services + les fournisseurs d'identité courants.
// Sert à deux choses :
//   - une <webview> ne peut être créée QUE vers une de ces origines (https) ;
//   - seules ces origines peuvent ouvrir une popup (connexions OAuth).
// ⚠️ Si un flux de connexion légitime d'un service ouvre une popup vers un
// domaine absent d'ici, elle partira dans le navigateur système — il faudra
// alors ajouter ce domaine ci-dessous. Un nouveau service doit aussi y figurer.
const ALLOWED_POPUP_HOSTS = Object.freeze([
  'claude.ai', 'anthropic.com',
  'chatgpt.com', 'openai.com',
  'gemini.google.com', 'google.com', 'gstatic.com',   // google.com couvre accounts.google.com
  'z.ai', 'chatglm.cn',
  'perplexity.ai',
  'grok.com', 'x.ai', 'x.com',
  'leonardo.ai',   // couvre app.leonardo.ai et auth.leonardo.ai (suffixe)
  'suno.com',      // couvre clerk.suno.com (auth Clerk : Google/Apple/Microsoft/Discord/tél.)
  'discord.com',   // login Discord proposé par Suno
  'meshy.ai',      // login Google (accounts.google.com déjà couvert) ou e-mail
  // Fournisseurs d'identité fréquents pour les connexions tierces (OAuth/SSO).
  'googleusercontent.com', 'microsoftonline.com', 'live.com', 'appleid.apple.com', 'github.com'
]);

function isAllowedHost(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    // Autorise le domaine exact OU n'importe quel sous-domaine (ex. accounts.google.com).
    return ALLOWED_POPUP_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) {
    return false; // URL non parsable (about:blank, data:, javascript:) -> refusée
  }
}

function isAllowedWebviewSrc(urlStr) {
  try {
    return new URL(urlStr).protocol === 'https:' && isAllowedHost(urlStr);
  } catch (_) {
    return false;
  }
}

// Une webview doit TOUJOURS avoir sa propre partition persistante (un profil
// = un dossier de cookies). Sans partition, elle partagerait la session de
// l'interface elle-même.
function isValidPartition(partition) {
  if (typeof partition !== 'string' || !partition.startsWith('persist:')) return false;
  const profile = partition.slice('persist:'.length);
  return profile.length > 0 && profile.length <= 200 && !/[\u0000-\u001f\u007f]/.test(profile);
}

// N'expose que le host dans les logs : une URL d'auth complète peut contenir des
// tokens OAuth en query string qu'on n'a pas à écrire dans la console.
function hostOf(urlStr) {
  try { return new URL(urlStr).host; } catch (_) { return '(url illisible)'; }
}

function samePath(a, b) {
  const ra = path.resolve(a), rb = path.resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

// L'URL est-elle exactement l'index.html local de l'app (hash/query ignorés) ?
function isAppIndexUrl(urlStr, indexPath) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'file:' && samePath(fileURLToPath(u), indexPath);
  } catch (_) {
    return false;
  }
}

// Un appel IPC n'est accepté que du cadre PRINCIPAL de la fenêtre hôte,
// chargé depuis exactement l'index.html local.
function isTrustedSender(event, mainWindow, indexPath) {
  const frame = event && event.senderFrame;
  return !!mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && !!frame && !frame.parent
    && isAppIndexUrl(frame.url, indexPath);
}

module.exports = {
  ALLOWED_POPUP_HOSTS,
  isAllowedHost,
  isAllowedPopup: isAllowedHost,
  isAllowedWebviewSrc,
  isValidPartition,
  hostOf,
  samePath,
  isAppIndexUrl,
  isTrustedSender
};
