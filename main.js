const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// On fixe le dossier de données (comptes + sessions IA) sur "ai-manager" quel que
// soit le nom du produit. Ainsi la version packagée (.exe) réutilise le profil
// existant au lieu d'en créer un vierge.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-manager'));

// ===== Instance unique =====
// Deux instances sur le même dossier de données écriraient les mêmes fichiers
// de comptes chacune de son côté (dernier arrivé gagnant) et se disputeraient
// les profils Chromium (cookies, localStorage). Un 2e lancement remet donc
// simplement la fenêtre existante au premier plan. Le verrou porte sur le
// dossier userData : il doit être pris APRÈS le setPath ci-dessus.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[app] déjà lancée : la fenêtre existante est mise au premier plan.');
  app.exit(0);
}

// ===== Diagnostics locaux (journal expurgé, voir diagnostics.js) =====
// Le plus tôt possible : capture les messages de tous les modules suivants.
// Pas pour une 2e instance (elle se ferme : elle n'écrit pas le journal).
const diagnostics = require('./diagnostics');
// Version de l'APP (package.json, inclus dans le .exe) — app.getVersion()
// renverrait celle d'Electron si l'app est lancée par un autre point d'entrée.
const APP_VERSION = (() => {
  try { const p = require('./package.json'); return { name: p.name, version: p.version }; }
  catch (_) { return { name: app.getName(), version: app.getVersion() }; }
})();
if (gotSingleInstanceLock) diagnostics.init(app, APP_VERSION);

// Erreur JavaScript non interceptée dans le processus principal : on la
// journalise (avec sa pile) et on prévient l'utilisateur UNE fois, sans
// fermer l'app (comportement d'Electron par défaut, mais ici tracé).
let fatalDialogShown = false;
process.on('uncaughtException', (err) => {
  diagnostics.record('fatal', 'main', 'erreur non interceptée : ' + (err && err.message), err && err.stack, true);
  if (fatalDialogShown || !app.isReady()) return;
  fatalDialogShown = true;
  dialog.showMessageBox({
    type: 'error',
    title: 'Erreur interne',
    message: 'Une erreur interne est survenue dans l\'application.',
    detail: 'Vos comptes ne sont pas touchés. Si un problème persiste, redémarrez l\'application. '
      + 'Les détails techniques sont dans le diagnostic (bouton « ? » puis « Diagnostic »).'
  }).catch(e => diagnostics.record('error', 'main', 'boîte d\'erreur impossible : ' + e.message));
});
process.on('unhandledRejection', (reason) => {
  diagnostics.record('error', 'main', 'promesse rejetée non traitée : ' + (reason && reason.message || reason), reason && reason.stack);
});

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

const policy = require('./security-policy');
const { isAllowedPopup, isAllowedWebviewSrc, isValidPartition, hostOf } = policy;

const INDEX_PATH = path.join(__dirname, 'index.html');
const PRELOAD_PATH = path.join(__dirname, 'app-preload.js');
let mainWindow = null;

// ===== Durcissement navigation / popups (chantier B) =====
// Liste blanche des origines et règles pures : voir security-policy.js.
const isAppIndexUrl = (urlStr) => policy.isAppIndexUrl(urlStr, INDEX_PATH);

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

  // --- 4. Résilience de l'interface elle-même : si son processus s'arrête
  // (plantage, mémoire épuisée), on propose de la recharger au lieu de
  // laisser une fenêtre blanche. Les comptes sont sur disque : rien n'est perdu.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[app] interface arrêtée :', details.reason, 'code', details.exitCode);
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Interface arrêtée',
      message: 'L\'interface de l\'application s\'est arrêtée de façon inattendue.',
      detail: `Raison : ${details.reason}. Vos comptes sont enregistrés sur le disque. Les panneaux IA ouverts devront être rouverts.`,
      buttons: ['Recharger l\'interface', 'Quitter'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response === 0 && !win.isDestroyed()) win.loadFile(INDEX_PATH);
      else app.quit();
    }).catch(err => console.error('[app] boîte de dialogue impossible :', err.message));
  });
  win.on('unresponsive', () => console.warn('[app] l\'interface ne répond plus'));
  win.on('responsive', () => console.log('[app] l\'interface répond de nouveau'));

  win.loadFile(INDEX_PATH);
}

// Webviews et popups : filtrage des popups, et interdiction d'imbriquer des
// webviews (seule l'interface de l'app peut en créer).
app.on('web-contents-created', (_event, contents) => {
  const type = contents.getType();
  if (type === 'webview' || (type === 'window' && contents.opener)) {
    contents.setWindowOpenHandler(popupHandler);
    contents.on('will-attach-webview', (event) => event.preventDefault());
    // Traces pour le diagnostic (hôte seulement, jamais l'URL complète).
    contents.on('render-process-gone', (_e, d) => console.warn(`[${type}] processus arrêté :`, d.reason, hostOf(safeUrl(contents))));
    contents.on('unresponsive', () => console.warn(`[${type}] ne répond plus :`, hostOf(safeUrl(contents))));
    contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) console.warn(`[${type}] échec de chargement :`, code, desc, hostOf(url));
    });
    // Popup OAuth qui ne charge pas : sans cela, une fenêtre blanche muette.
    if (type === 'window') watchPopupLoad(contents);
  }
});

function safeUrl(contents) {
  try { return contents.getURL(); } catch (_) { return ''; }
}

// Popup (connexion OAuth) dont la page principale échoue : on explique et on
// propose Réessayer / navigateur système / Fermer (audit phase 2, M10).
function watchPopupLoad(contents) {
  let asking = false;
  contents.on('did-fail-load', async (_e, code, desc, url, isMainFrame) => {
    // -3 = ERR_ABORTED : navigation remplacée (redirection normale), pas une erreur.
    if (!isMainFrame || code === -3 || asking || contents.isDestroyed()) return;
    const popup = BrowserWindow.fromWebContents(contents);
    if (!popup) return;
    asking = true;
    const canOpenExternally = /^https:\/\//i.test(url) && isAllowedPopup(url);
    const buttons = ['Réessayer', ...(canOpenExternally ? ['Ouvrir dans le navigateur'] : []), 'Fermer'];
    try {
      const { response } = await dialog.showMessageBox(popup, {
        type: 'warning',
        title: 'Fenêtre de connexion',
        message: `La page de connexion (${hostOf(url)}) n'a pas pu se charger.`,
        detail: `${describeNetError(code, desc)}\n\n« Ouvrir dans le navigateur » ouvre la page dans votre navigateur habituel : la connexion y sera faite hors de l'application.`,
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true
      });
      if (contents.isDestroyed()) return;
      const choice = buttons[response];
      if (choice === 'Réessayer') contents.loadURL(url).catch(err => console.warn('[window] nouvel essai impossible :', err.message));
      else if (choice === 'Ouvrir dans le navigateur') { shell.openExternal(url); popup.close(); }
      else popup.close();
    } catch (err) {
      console.warn('[window] boîte de dialogue impossible :', err.message);
    } finally {
      asking = false;
    }
  });
}

// Libellé lisible d'un code d'erreur réseau Chromium (net_error_list.h).
function describeNetError(code, desc) {
  const known = {
    '-106': 'Pas de connexion Internet.',
    '-105': 'Adresse introuvable (DNS) : connexion Internet ou nom de site en cause.',
    '-102': 'Connexion refusée par le serveur.',
    '-118': 'Le serveur met trop de temps à répondre.',
    '-7': 'Le serveur met trop de temps à répondre.',
    '-109': 'Serveur injoignable.',
    '-21': 'Le réseau a changé pendant le chargement.',
    '-100': 'Connexion fermée par le serveur.',
    '-101': 'Connexion réinitialisée.',
    '-137': 'Adresse introuvable (DNS).'
  };
  if (known[code]) return known[code];
  if (code <= -200 && code > -300) return 'Problème de certificat de sécurité : la connexion a été refusée pour vous protéger.';
  return `Erreur réseau ${code}${desc ? ' (' + desc + ')' : ''}.`;
}

// ===== IPC =====
// Chaque canal est dédié à UNE opération et n'accepte que des appels venant
// de la page principale de la fenêtre hôte, chargée depuis l'index.html
// local. Les webviews/popups (sites distants) ne peuvent rien appeler.

const isTrustedSender = (event) => policy.isTrustedSender(event, mainWindow, INDEX_PATH);

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn('[security] appel IPC refusé :', channel);
      throw new Error('Appel refusé');
    }
    try {
      return await fn(...args);
    } catch (err) {
      // Erreur imprévue d'un module : tracée (avec sa pile) dans le journal,
      // renvoyée à l'interface sous une forme générique (pas de détail interne).
      diagnostics.record('error', 'main', `[ipc] ${channel} : ${err && err.message}`, err && err.stack);
      // Volontairement SANS `cause` : aucun détail interne ne doit repartir vers l'interface.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Erreur interne (${channel})`);
    }
  });
}

// Dernier état connu du stockage des comptes (pour le diagnostic : statut et
// nombre, jamais le contenu).
let lastStorageState = null;
function rememberStorageState(res) {
  if (res && typeof res === 'object') {
    lastStorageState = {
      status: res.status,
      accounts: Array.isArray(res.accounts) ? res.accounts.length : undefined,
      encrypted: res.encrypted,
      migrated: res.migrated ? `${res.migrated.from} -> ${res.migrated.to}` : undefined,
      backupAvailable: res.backup ? res.backup.available : undefined,
      at: new Date().toISOString()
    };
    if (res.status !== 'ok' && res.status !== 'empty') console.warn('[accounts] état au chargement :', res.status);
  }
  return res;
}

// Résumé mémoire par type de processus (Mo), via app.getAppMetrics().
function memorySummary() {
  const byType = {};
  let total = 0;
  for (const m of app.getAppMetrics()) {
    const mb = (m.memory && m.memory.workingSetSize ? m.memory.workingSetSize : 0) / 1024;
    const key = m.type === 'Tab' ? 'Tab (interface + panneaux IA + popups)' : m.type;
    byType[key] = byType[key] || { count: 0, mb: 0 };
    byType[key].count++;
    byType[key].mb += mb;
    total += mb;
  }
  for (const k of Object.keys(byType)) byType[k].mb = Math.round(byType[k].mb);
  return { totalMb: Math.round(total), byType };
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

// Diagnostics : rapport d'erreur de l'interface (validé et limité dans
// diagnostics.js), lecture du diagnostic, ouverture du dossier des journaux
// (chemin FIXE, aucun paramètre accepté).
handle('diag:report', (payload) => diagnostics.reportFromRenderer(payload));
handle('diag:get', () => ({
  app: { name: APP_VERSION.name, version: APP_VERSION.version, packaged: app.isPackaged },
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  os: { platform: process.platform, release: require('os').release(), arch: process.arch },
  storage: lastStorageState,
  accountsSchema: accountsStore.SCHEMA,
  memory: memorySummary(),
  uptimeMin: Math.round(process.uptime() / 60),
  recent: diagnostics.recent(40)
}));
handle('diag:open-logs', async () => {
  const dir = diagnostics.logsDir();
  if (!dir) return false;
  const err = await shell.openPath(dir);
  if (err) console.warn('[diag] ouverture du dossier des journaux impossible :', err);
  return !err;
});

// « Ouvrir dans le navigateur » depuis l'écran d'erreur d'un panneau : URL
// https vers un service de la liste blanche UNIQUEMENT (jamais un lien
// arbitraire fourni par l'interface).
handle('services:open-in-browser', async (url) => {
  if (typeof url !== 'string' || url.length > 2048 || !isAllowedWebviewSrc(url)) {
    console.warn('[security] ouverture externe refusée :', hostOf(url));
    return false;
  }
  await shell.openExternal(url);
  return true;
});

// Comptes (métadonnées) : stockage chiffré, voir accounts-store.js.
handle('accounts:load', () => accountsStore.load().then(rememberStorageState));
handle('accounts:save', (list) => accountsStore.save(list).then(res => {
  if (!res.ok) console.warn('[accounts] enregistrement refusé ou en échec :', res.error);
  else rememberStorageState({ status: 'ok', accounts: Array.isArray(list) ? list : undefined, encrypted: res.encrypted });
  return res;
}));
handle('accounts:restore-backup', () => accountsStore.restoreBackup().then(res => {
  if (res.ok) rememberStorageState(res.result);
  return res;
}));
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
      }).catch(err => console.warn('[storage] boîte de dialogue impossible :', err.message));
      app.quit();
    }, 300); // laisse au renderer le temps d'écrire son localStorage
  }
  return r;
});

app.on('second-instance', (_event, argv) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // Retour arrière demandé alors que l'app tourne déjà : il ne peut se faire
  // qu'au démarrage (avant tout chargement des comptes).
  if (Array.isArray(argv) && argv.includes(accountsStore.REVERT_FLAG)) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Retour au stockage 1.0.4',
      message: 'Fermez d\'abord l\'application, puis relancez-la avec --revert-storage-migration.',
      detail: 'Le retour arrière ne peut pas se faire pendant que l\'application est ouverte.'
    }).catch(err => console.warn('[app] boîte de dialogue impossible :', err.message));
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Fermeture juste après une modification (ex. clic sur « Épuiser » puis
// fermeture de la fenêtre) : on laisse finir l'écriture des comptes. Délai
// maximal : un disque bloqué ne doit pas empêcher l'app de se fermer (une
// écriture interrompue laisse de toute façon l'ancienne version intacte).
const QUIT_WAIT_MAX_MS = 5000;
let quitWaitStarted = false;
app.on('will-quit', (event) => {
  if ((accountsStore.isIdle() && diagnostics.isFlushed()) || quitWaitStarted) return;
  quitWaitStarted = true;
  event.preventDefault();
  let timer;
  const timedOut = new Promise(resolve => {
    timer = setTimeout(() => {
      console.warn('[accounts] écriture toujours en cours après ' + QUIT_WAIT_MAX_MS + ' ms : fermeture quand même');
      resolve();
    }, QUIT_WAIT_MAX_MS);
  });
  const idle = accountsStore.whenIdle().then(() => diagnostics.whenFlushed());
  Promise.race([idle, timedOut]).finally(() => {
    clearTimeout(timer);
    app.quit();
  });
});
