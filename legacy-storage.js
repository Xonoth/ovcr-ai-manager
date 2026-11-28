// ===== Pont vers l'ancien localStorage file:// (phase 3, P5) =====
//
// Jusqu'en 1.8.0, l'interface était chargée en file:// : son localStorage
// appartenait à l'origine « file:// ». Depuis la 1.9.0 elle est servie en
// app://ovcr (app-protocol.js) et a son propre localStorage, qui ne voit plus
// l'ancien. Or trois choses y vivent encore :
//   - les préférences d'affichage (largeurs, cartes repliées), à reprendre une fois ;
//   - les comptes d'une 1.0.4 jamais migrée (ai_accounts, ai_accounts_backup) ;
//   - la destination du retour arrière --revert-storage-migration, qui réécrit
//     les comptes à cet endroit pour que la 1.0.4 les retrouve.
//
// Ce pont ouvre, le temps d'une opération, une fenêtre CACHÉE sur une page
// file:// vide (legacy-bridge/legacy-storage.html : aucun script, CSP
// default-src 'none', aucun preload) et y exécute depuis le main un court
// script qui lit, écrit ou efface des clés de la liste LEGACY_KEYS, rien
// d'autre. Toutes les pages file:// partagent la même origine de stockage :
// c'est bien le localStorage de l'ancienne interface.
//
// ⚠️ Ne marche QUE tant que le fuse GrantFileProtocolExtraPrivileges est
// actif : sans lui, une page file:// ne peut plus lire dans app.asar, ni
// accéder au localStorage (SecurityError), vérifié le 28/11/2026 avec
// Electron 45.3.2. Couper ce fuse (« P5 bis ») implique de retirer ce pont.

const path = require('path');

const LEGACY_ACCOUNT_KEYS = Object.freeze(['ai_accounts', 'ai_accounts_backup']);
const LEGACY_PREF_KEYS = Object.freeze(['prefs_schema', 'ide_w', 'explorer_w', 'collapsed_accounts']);
const LEGACY_KEYS = Object.freeze([...LEGACY_ACCOUNT_KEYS, ...LEGACY_PREF_KEYS]);
const PAGE_PATH = path.join(__dirname, 'legacy-bridge', 'legacy-storage.html');
const MAX_VALUE_LENGTH = 8 * 1024 * 1024; // 8 Mo de texte : bien au-delà d'une vraie liste de comptes
const DEFAULT_TIMEOUT_MS = 10000;

function checkKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('liste de clés vide');
  for (const k of keys) if (!LEGACY_KEYS.includes(k)) throw new Error('clé non autorisée : ' + String(k).slice(0, 40));
  return [...new Set(keys)];
}

function checkEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('entrées invalides');
  const keys = checkKeys(Object.keys(entries));
  for (const k of keys) {
    const v = entries[k];
    if (typeof v !== 'string') throw new Error('valeur non textuelle pour ' + k);
    if (v.length > MAX_VALUE_LENGTH) throw new Error('valeur trop longue pour ' + k);
  }
  return keys;
}

// Scripts exécutés dans la page du pont. Les clés et valeurs, déjà validées,
// y entrent par JSON.stringify (jamais par concaténation brute).
const scripts = {
  read: (keys) => `(() => { const out = {}; for (const k of ${JSON.stringify(keys)}) out[k] = localStorage.getItem(k); return out; })()`,
  write: (entries) => `(() => { const e = ${JSON.stringify(entries)}; for (const k of Object.keys(e)) localStorage.setItem(k, e[k]); return true; })()`,
  remove: (keys) => `(() => { for (const k of ${JSON.stringify(keys)}) localStorage.removeItem(k); return true; })()`
};

// BrowserWindow : celui d'Electron (injecté pour les tests). Les opérations
// passent une par une (file d'attente) : jamais deux fenêtres du pont à la fois.
function createLegacyStorageBridge({ BrowserWindow, pagePath = PAGE_PATH, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {} }) {
  let queue = Promise.resolve();

  async function runInBridge(script) {
    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      skipTaskbar: true,
      webPreferences: {
        // Pas de preload, pas de Node : la page ne peut rien demander au main.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false
      }
    });
    const wc = win.webContents;
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('délai dépassé (' + timeoutMs + ' ms)')), timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          await win.loadFile(pagePath);
          return wc.executeJavaScript(script);
        })(),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    }
  }

  function enqueue(label, build) {
    const run = queue.then(async () => {
      try {
        return await runInBridge(build());
      } catch (e) {
        log(`[legacy-storage] ${label} impossible : ${e && e.message}`);
        throw e;
      }
    });
    queue = run.catch(() => {}); // un échec ne bloque pas les opérations suivantes
    return run;
  }

  return {
    // { clé: valeur ou null } pour chaque clé demandée.
    read(keys) {
      const list = checkKeys(keys);
      return enqueue('lecture', () => scripts.read(list)).then(out => {
        const res = {};
        for (const k of list) res[k] = out && typeof out[k] === 'string' ? out[k] : null;
        return res;
      });
    },
    // entries : { clé: texte }.
    write(entries) {
      checkEntries(entries);
      const copy = { ...entries };
      return enqueue('écriture', () => scripts.write(copy)).then(() => true);
    },
    remove(keys) {
      const list = checkKeys(keys);
      return enqueue('effacement', () => scripts.remove(list)).then(() => true);
    }
  };
}

module.exports = {
  LEGACY_KEYS, LEGACY_ACCOUNT_KEYS, LEGACY_PREF_KEYS, PAGE_PATH, MAX_VALUE_LENGTH,
  createLegacyStorageBridge
};
