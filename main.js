const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');

// On fixe le dossier de données (comptes + sessions IA) sur "ai-manager" quel que
// soit le nom du produit. Ainsi la version packagée (.exe) réutilise le profil
// existant au lieu d'en créer un vierge.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-manager'));

// Sandbox Chromium pour TOUS les processus de rendu (interface, webviews,
// popups), quelles que soient leurs webPreferences. À appeler avant app.ready.
app.enableSandbox();

// ===== Identité navigateur des panneaux IA (connexion Google) =====
// Sans ça, Google refuse la connexion (« Ce navigateur ou cette application ne
// sont peut-être pas sécurisés »). Le module donne une identité cohérente :
// Firefox sur les pages Google, Chrome partout ailleurs, pour chaque <webview>
// et chaque popup OAuth. À installer avant la création de la moindre fenêtre.
require('./browser-identity').install(app);

// ===== Autorisations des sites =====
// Electron accorde par défaut TOUT ce que demande une page (position, micro,
// caméra, notifications…) sans rien demander. On demande à l'utilisateur à la
// place, avec mémorisation par site (voir site-permissions.js).
const sitePermissions = require('./site-permissions');
sitePermissions.install(app);

const fileAccess = require('./file-access');
const accountsStore = require('./accounts-store');

const INDEX_PATH = path.join(__dirname, 'index.html');
const PRELOAD_PATH = path.join(__dirname, 'app-preload.js');
let mainWindow = null;

// ===== Durcissement navigation / popups (chantier B) =====
// Origines de confiance : les 9 services + les fournisseurs d'identité courants.
// Sert à deux choses :
//   - une <webview> ne peut être créée QUE vers une de ces origines (https) ;
//   - seules ces origines peuvent ouvrir une popup (connexions OAuth).
// ⚠️ Si un flux de connexion légitime d'un service ouvre une popup vers un
// domaine absent d'ici, elle partira dans le navigateur système — il faudra
// alors ajouter ce domaine ci-dessous. Un nouveau service doit aussi y figurer.
const ALLOWED_POPUP_HOSTS = [
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
];

function isAllowedHost(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    // Autorise le domaine exact OU n'importe quel sous-domaine (ex. accounts.google.com).
    return ALLOWED_POPUP_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) {
    return false; // URL non parsable (about:blank, data:, javascript:) -> refusée
  }
}

const isAllowedPopup = isAllowedHost;

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
function isAppIndexUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'file:' && samePath(fileURLToPath(u), INDEX_PATH);
  } catch (_) {
    return false;
  }
}

// Popups des webviews (et des popups elles-mêmes) : seules les origines
// connues ouvrent une fenêtre Electron, qui hérite des webPreferences de
// l'invité (sandbox, sans Node) — jamais de celles de l'hôte.
function popupHandler({ url }) {
  if (isAllowedPopup(url)) return { action: 'allow' };
  // Origine hors liste : jamais de fenêtre Electron. Si c'est un lien web
  // classique, on le confie au navigateur système (aucun privilège Node) ;
  // sinon (about:, data:, javascript:…) on refuse purement.
  if (/^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    console.warn('[security] popup hors liste -> navigateur système :', hostOf(url));
  } else {
    console.warn('[security] popup refusée (schéma non web) :', hostOf(url));
  }
  return { action: 'deny' };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0c10',
    title: '[OVCR] AI Manager',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // --- 1. La fenêtre HÔTE ne doit JAMAIS naviguer ailleurs que vers son
  // index.html local (rechargement compris) : c'est la seule page à qui le
  // preload donne accès aux fichiers et aux comptes.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppIndexUrl(url)) {
      event.preventDefault();
      console.warn('[security] navigation de la fenêtre hôte bloquée :', hostOf(url));
    }
  });

  // --- 2. L'hôte ne doit ouvrir AUCUNE nouvelle fenêtre lui-même.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // --- 3. Création d'une <webview> : on impose ses webPreferences (quoi que
  // demande la page) et on vérifie sa destination et sa partition.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;     // seul le preload de session (identité) s'applique
    delete webPreferences.preloadURL;
    delete webPreferences.enableBlinkFeatures;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.experimentalFeatures = false;

    if (!isAllowedWebviewSrc(params.src) || !isValidPartition(params.partition)) {
      event.preventDefault();
      console.warn('[security] webview refusée :', hostOf(params.src), '(partition valide :', isValidPartition(params.partition), ')');
    }
  });

  win.loadFile(INDEX_PATH);
}

// Webviews et popups : filtrage des popups, et interdiction d'imbriquer des
// webviews (seule l'interface de l'app peut en créer).
app.on('web-contents-created', (_event, contents) => {
  const type = contents.getType();
  if (type === 'webview' || (type === 'window' && contents.opener)) {
    contents.setWindowOpenHandler(popupHandler);
    contents.on('will-attach-webview', (event) => event.preventDefault());
  }
});

// ===== IPC =====
// Chaque canal est dédié à UNE opération et n'accepte que des appels venant
// de la page principale de la fenêtre hôte, chargée depuis l'index.html
// local. Les webviews/popups (sites distants) ne peuvent rien appeler.

function isTrustedSender(event) {
  const frame = event.senderFrame;
  return !!mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && !!frame && !frame.parent
    && isAppIndexUrl(frame.url);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn('[security] appel IPC refusé :', channel);
      throw new Error('Appel refusé');
    }
    return fn(...args);
  });
}

// Oublie les autorisations mémorisées (bouton de la page d'aide).
handle('site-permissions:reset', () => {
  sitePermissions.reset();
  return true;
});

// Fichiers (explorateur + éditeur) : validation complète dans file-access.js.
handle('files:select-folder', () => fileAccess.selectFolder(mainWindow));
handle('files:list-directory', (dirPath) => fileAccess.listDirectory(dirPath));
handle('files:read', (filePath) => fileAccess.readFile(filePath));
handle('files:save', (filePath, content) => fileAccess.saveFile(filePath, content));

// Comptes (métadonnées) : stockage chiffré, voir accounts-store.js.
handle('accounts:load', () => accountsStore.load());
handle('accounts:save', (list) => accountsStore.save(list));
handle('accounts:restore-backup', () => accountsStore.restoreBackup());
handle('accounts:migrate-legacy', (payload) => accountsStore.migrateLegacy(payload));

// Retour arrière de la migration (lancement avec --revert-storage-migration).
handle('storage:pending-revert', () => accountsStore.pendingRevert());
handle('storage:confirm-revert', async () => {
  const r = await accountsStore.confirmRevert();
  if (r.ok) {
    setTimeout(async () => {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Retour au stockage 1.0.4',
        message: 'Les comptes ont été réécrits au format de la version 1.0.4.',
        detail: 'L\'application va se fermer. Vous pouvez maintenant réinstaller la 1.0.4. '
          + 'Les fichiers chiffrés ont été mis de côté dans le dossier de données (rien n\'a été supprimé).'
      }).catch(() => {});
      app.quit();
    }, 300); // laisse au renderer le temps d'écrire son localStorage
  }
  return r;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Fermeture juste après une modification (ex. clic sur « Épuiser » puis
// fermeture de la fenêtre) : on laisse finir l'écriture des comptes.
app.on('will-quit', (event) => {
  if (accountsStore.isIdle()) return;
  event.preventDefault();
  accountsStore.whenIdle().finally(() => app.quit());
});
