// ===== Autorisations des sites (position, micro, caméra, notifications…) =====
//
// Par défaut, Electron ACCORDE en silence toutes les autorisations demandées
// par une page : Perplexity recevait ainsi la position de l'utilisateur sans
// rien lui demander (permissionState "granted" dans ses données). Ici :
//   - DEMANDÉ à l'utilisateur : position, micro, caméra, notifications, lecture
//     du presse-papiers, capture d'écran, ouverture d'une application externe ;
//   - ACCORDÉ sans question (inoffensif et nécessaire au bon fonctionnement) :
//     écrire dans le presse-papiers (boutons « Copier »), plein écran, lecture
//     protégée (DRM), choix de la sortie audio, accès aux cookies des iframes
//     de connexion (Storage Access API) ;
//   - REFUSÉ : tout le reste (USB, série, HID, MIDI, détection d'inactivité,
//     gestion des fenêtres, verrouillage clavier/souris, système de fichiers…).
// Les choix « mémorisés » valent pour un SITE (origine), tous comptes
// confondus, et sont stockés dans <userData>/site-permissions.json.
// L'interface locale de l'app (file://) ne reçoit que le strict nécessaire
// (presse-papiers de l'éditeur, plein écran) : elle n'a besoin ni de la
// position, ni du micro, ni de la caméra, ni des notifications.

const { BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeAtomicTextSync, fileStamp } = require('./atomic-file');

// Autorisations de l'interface locale (file://).
const APP_UI_ALLOW = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

const ALWAYS_ALLOW = new Set([
  'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem', 'speaker-selection',
  'storage-access', 'top-level-storage-access'
]);

// Libellés pour la question posée à l'utilisateur ("<site> demande à …").
const ASKABLE = {
  geolocation: 'connaître votre position',
  notifications: 'vous envoyer des notifications',
  'clipboard-read': 'lire le contenu de votre presse-papiers',
  'display-capture': 'capturer votre écran',
  'media:audio': 'utiliser votre micro',
  'media:video': 'utiliser votre caméra'
};

let storeFile = null;
let decisions = null; // { "<origine>|<clé>": "allow" | "deny" }

// Version de schéma du fichier, rangée sous une clé réservée "$schema" (sans
// « | ») : la 1.1.0 l'ignore naturellement (elle ne cherche que des clés
// "<origine>|<clé>"). Fichier sans "$schema" = schéma 1. Fichier d'un schéma
// plus récent : lu, mais jamais réécrit par cette version.
const SCHEMA = 1;
let readOnly = false;

// Ne garde que des entrées bien formées : "<origine>|<clé>" -> "allow" | "deny".
// Objet sans prototype : une clé "__proto__" reste une donnée ordinaire.
function sanitizeDecisions(data) {
  const out = Object.create(null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  for (const [k, v] of Object.entries(data)) {
    if (typeof k === 'string' && k.length <= 400 && k.includes('|') && (v === 'allow' || v === 'deny')) out[k] = v;
  }
  return out;
}

function load(app) {
  if (decisions) return decisions;
  storeFile = path.join(app.getPath('userData'), 'site-permissions.json');
  let text = null;
  try {
    text = fs.readFileSync(storeFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[permissions] lecture impossible :', err.code || err.message);
  }
  if (text === null) {
    decisions = Object.create(null); // premier lancement : on demandera
    return decisions;
  }
  let json, parsed;
  try { json = JSON.parse(text); parsed = sanitizeDecisions(json); } catch (_) { parsed = null; }
  if (parsed) {
    decisions = parsed;
    const schema = json.$schema === undefined ? 1 : json.$schema;
    if (!Number.isInteger(schema) || schema > SCHEMA) {
      readOnly = true;
      console.warn('[permissions] fichier d\'une version plus récente (schéma ' + schema + ') : lu, non réécrit');
    }
  } else {
    // Illisible : mis de côté (jamais écrasé en silence), on redemandera.
    // Aucune autorisation n'est accordée par défaut : le pire cas est une
    // question posée de nouveau.
    decisions = Object.create(null);
    const aside = storeFile.replace(/\.json$/, '') + `.unreadable-${fileStamp()}.json`;
    try {
      fs.renameSync(storeFile, aside);
      console.warn('[permissions] fichier illisible mis de côté :', path.basename(aside));
    } catch (err) {
      console.warn('[permissions] fichier illisible, mise de côté impossible :', err.code || err.message);
    }
  }
  return decisions;
}

function save() {
  if (readOnly) {
    console.warn('[permissions] choix gardé pour cette session seulement (fichier d\'une version plus récente)');
    return;
  }
  try {
    writeAtomicTextSync(storeFile, JSON.stringify({ $schema: SCHEMA, ...decisions }, null, 2));
  } catch (err) {
    console.warn('[permissions] sauvegarde impossible :', err.code || err.message);
  }
}

function originOf(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'file:' ? 'file://' : u.origin;
  } catch (_) {
    return null;
  }
}

// Clés à décider pour une demande : "media" se découpe en micro / caméra,
// "openExternal" porte le protocole visé (mailto:, zoommtg:…).
function keysFor(permission, details) {
  if (permission === 'media') {
    const types = (details && details.mediaTypes) || [];
    return types.length ? types.map(t => `media:${t}`) : ['media:audio', 'media:video'];
  }
  if (permission === 'openExternal') {
    let scheme = 'inconnu';
    try { scheme = new URL(details.externalURL).protocol; } catch (_) { /* URL illisible : schéma « inconnu » (refusé) */ }
    return [`openExternal:${scheme}`];
  }
  return [permission];
}

function labelFor(key) {
  if (ASKABLE[key]) return ASKABLE[key];
  if (key.startsWith('openExternal:')) {
    return `ouvrir une application externe (lien « ${key.slice('openExternal:'.length)} »)`;
  }
  return null; // non prévu : refusé
}

// Une question à la fois par (site, autorisations) : si la page redemande
// pendant que la boîte est ouverte, elle attend la même réponse.
const pending = new Map();

async function ask(webContents, origin, keys) {
  const pendingKey = `${origin}|${keys.join('+')}`;
  if (pending.has(pendingKey)) return pending.get(pendingKey);

  const promise = (async () => {
    const host = (() => { try { return new URL(origin).host; } catch (_) { return origin; } })();
    const what = keys.map(labelFor).join(' et ');
    const embedder = webContents.hostWebContents || webContents;
    const parent = BrowserWindow.fromWebContents(embedder) || BrowserWindow.getFocusedWindow();
    const options = {
      type: 'question',
      title: 'Autorisation demandée',
      message: `${host} demande à ${what}.`,
      detail: 'Autorisez seulement si vous venez de demander une fonction qui en a besoin '
        + '(ex. dictée vocale pour le micro, résultats locaux pour la position).',
      buttons: ['Autoriser', 'Refuser'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      checkboxLabel: 'Se souvenir de ce choix pour ce site',
      checkboxChecked: true
    };
    const { response, checkboxChecked } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    const decision = response === 0 ? 'allow' : 'deny';
    if (checkboxChecked) {
      for (const k of keys) decisions[`${origin}|${k}`] = decision;
      save();
    }
    return decision === 'allow';
  })();

  pending.set(pendingKey, promise);
  try { return await promise; } finally { pending.delete(pendingKey); }
}

async function decide(webContents, permission, details) {
  const origin = originOf((details && (details.securityOrigin || details.requestingUrl)) || webContents.getURL());
  if (origin === 'file://') return APP_UI_ALLOW.has(permission); // interface locale de l'app
  if (ALWAYS_ALLOW.has(permission)) return true;
  if (!origin) return false;

  const keys = keysFor(permission, details);
  if (keys.some(k => !labelFor(k))) return false;         // permission non prévue

  const remembered = keys.map(k => decisions[`${origin}|${k}`]);
  if (remembered.includes('deny')) return false;
  const toAsk = keys.filter((k, i) => remembered[i] !== 'allow');
  if (toAsk.length === 0) return true;
  return ask(webContents, origin, toAsk);
}

function installOn(ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    decide(webContents, permission, details)
      .then(callback)
      .catch(err => { console.warn('[permissions]', err.message); callback(false); });
  });

  // Vérifications synchrones (navigator.permissions.query, Notification.permission…).
  // Elles ne savent répondre que oui/non, pas « à demander ». Donc :
  //   - choix mémorisé -> on le renvoie ;
  //   - pas de choix, position/micro/caméra/presse-papiers/écran -> "oui" :
  //     la page tente alors l'accès, ce qui passe par la QUESTION ci-dessus
  //     (répondre "non" ici ferait renoncer le site sans jamais demander) ;
  //   - pas de choix, notifications -> "non" : pour elles, la vérification
  //     fait foi (un site qui lit "accordé" affiche ses notifications sans
  //     jamais rien demander) ;
  //   - permission non prévue -> "non".
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = originOf(requestingOrigin);
    if (origin === 'file://') return APP_UI_ALLOW.has(permission);
    if (ALWAYS_ALLOW.has(permission)) return true;
    if (!origin) return false;
    let keys;
    if (permission === 'media') {
      const t = details && details.mediaType;
      keys = t === 'audio' || t === 'video' ? [`media:${t}`] : ['media:audio', 'media:video'];
    } else {
      keys = [permission];
    }
    if (keys.some(k => !ASKABLE[k])) return false;
    const remembered = keys.map(k => decisions[`${origin}|${k}`]);
    if (remembered.includes('deny')) return false;
    if (remembered.every(d => d === 'allow')) return true;
    return permission !== 'notifications';
  });
}

function install(app) {
  app.on('session-created', (ses) => {
    load(app);
    installOn(ses);
  });
}

// Oublie tous les choix mémorisés (bouton de la page d'aide). Les sites
// redemanderont à leur prochaine demande.
function reset() {
  decisions = Object.create(null);
  if (storeFile) save();
}

module.exports = { install, reset };
