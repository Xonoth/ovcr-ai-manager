const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsPromises = require('fs').promises;

// On fixe le dossier de données (comptes + sessions IA) sur "ai-manager" quel que
// soit le nom du produit. Ainsi la version packagée (.exe) réutilise le profil
// existant au lieu d'en créer un vierge.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-manager'));

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

// ===== Durcissement navigation / popups (chantier B) =====
// Origines de confiance autorisées à ouvrir une popup depuis une <webview>.
// On y met les 9 services + les fournisseurs d'identité courants pour que les
// connexions OAuth (Google pour Gemini, etc.) continuent de s'ouvrir.
// ⚠️ À VALIDER : cette liste blanche est volontairement explicite. Si un flux de
// connexion légitime d'un service ouvre une popup vers un domaine absent d'ici,
// elle sera refusée — il faudra alors ajouter ce domaine ci-dessous.
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

function isAllowedPopup(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    // Autorise le domaine exact OU n'importe quel sous-domaine (ex. accounts.google.com).
    return ALLOWED_POPUP_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) {
    return false; // URL non parsable (about:blank, data:, javascript:) -> refusée
  }
}

// N'expose que le host dans les logs : une URL d'auth complète peut contenir des
// tokens OAuth en query string qu'on n'a pas à écrire dans la console.
function hostOf(urlStr) {
  try { return new URL(urlStr).host; } catch (_) { return '(url illisible)'; }
}

// Taille max d'un fichier ouvrable dans l'éditeur intégré. Au-delà, lire le
// fichier entier en mémoire + le transférer par IPC figerait main ET renderer.
const MAX_EDITABLE_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0c10',
    title: '[OVCR] AI Manager',
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // --- 1. La fenêtre HÔTE est privilégiée (nodeIntegration:true). Elle ne doit
  // JAMAIS naviguer ailleurs que vers son index.html local : sinon un contenu
  // distant hériterait de l'accès complet à Node/OS. On bloque toute navigation
  // dont l'URL n'est pas un fichier local (le rechargement dev reste un file://).
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      console.warn('[security] navigation de la fenêtre hôte bloquée :', hostOf(url));
    }
  });

  // --- 2. L'hôte ne doit ouvrir AUCUNE nouvelle fenêtre lui-même.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // --- 3. Les <webview> sont des invités sandboxés (sans nodeIntegration). On
  // filtre leurs popups : seules les origines connues (services + auth OAuth)
  // peuvent ouvrir une fenêtre ; tout le reste est refusé. Une popup autorisée
  // s'ouvre avec les webPreferences de l'invité (donc SANS privilèges Node),
  // jamais avec ceux de l'hôte.
  win.webContents.on('did-attach-webview', (event, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
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
    });
  });

  win.loadFile('index.html');
}

// --- IPC pour la gestion des fichiers locaux ---

// Oublie les autorisations mémorisées (bouton de la page d'aide).
ipcMain.handle('reset-site-permissions', () => {
  sitePermissions.reset();
  return true;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  return null;
});

ipcMain.handle('read-directory', async (event, folderPath) => {
  try {
    const files = await fsPromises.readdir(folderPath, { withFileTypes: true });
    const ignored = ['node_modules', '.git', '.next', 'dist', 'build', '.cache'];
    return files
      .filter(dirent => dirent.isFile() && !ignored.includes(dirent.name))
      .map(dirent => ({ name: dirent.name, path: path.join(folderPath, dirent.name) }));
  } catch (error) { return []; }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    // Garde-fou taille : un gros fichier lu en entier figerait l'app. On renvoie
    // un objet-sentinel que le renderer sait distinguer d'un contenu texte.
    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_EDITABLE_FILE_BYTES) {
      return { error: 'too_large', size: stat.size };
    }
    return await fsPromises.readFile(filePath, 'utf-8');
  } catch (error) { return null; }
});

// NOUVEAU : Sauvegarder un fichier depuis l'éditeur
ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    await fsPromises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    return false;
  }
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