// Banc d'essai des tests d'INTÉGRATION (vrai Electron, vraie fenêtre).
//
// Chaque scénario tourne dans son propre processus Electron (lancé par
// run.js) avec un dossier de données TEMPORAIRE : le vrai profil
// (%APPDATA%\ai-manager) n'est jamais lu ni écrit. Aucun accès réseau.
//
//   scenario('nom', { seed(userDataDir), beforeWindow({ ipcMain }) }, async (t) => { ... })
//
// seed         : écrit les fichiers de départ (avant le chargement de main.js) ;
// beforeWindow : après main.js, avant la fenêtre (ex. remplacer un handler IPC
//                pour simuler une panne) ;
// t            : { win, js, check, userData, delay, waitFor, consoleErrors, tmp }.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, ms = 10000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('délai dépassé : ' + label);
    await delay(50);
  }
}

// Enveloppe de comptes NON chiffrée (format valide : l'app la relit et la
// rechiffre). Permet de préparer des données avant que safeStorage soit prêt.
function plainEnvelope(accounts) {
  return JSON.stringify({ format: 'ovcr-accounts', version: 1, savedAt: new Date().toISOString(), encryption: 'none', payload: JSON.stringify(accounts) });
}

const sampleAccount = (n, extra = {}) => ({
  id: 'acc_' + n, name: 'Compte ' + n, email: `c${n}@exemple.test`, profile: 'profil_' + n,
  color: '#8b5cf6', services: ['claude', 'chatgpt'], cooldowns: { claude: 0, chatgpt: 0 }, ...extra
});

function scenario(name, opts, body) {
  const tmp = process.env.OVCR_TEST_APPDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-int-'));
  const ownsTmp = !process.env.OVCR_TEST_APPDATA;
  app.setPath('appData', tmp);
  const userData = path.join(tmp, 'ai-manager');
  fs.mkdirSync(userData, { recursive: true });
  if (opts.seed) opts.seed(userData);

  const results = [];
  const consoleErrors = [];
  const check = (label, ok, detail) => {
    results.push({ label, ok: !!ok });
    console.log(`${ok ? '  ✔' : '  ✖'} ${label}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
  };
  const finish = () => {
    const failed = results.filter(r => !r.ok).length;
    console.log(`@@RESULT ${JSON.stringify({ name, total: results.length, failed })}`);
    if (ownsTmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
    app.exit(failed ? 1 : 0);
  };
  const timeout = setTimeout(() => { check('terminé avant le délai de 60 s', false); finish(); }, 60000);

  console.log(`\n▶ ${name}`);
  require(path.join(ROOT, 'main.js'));
  if (opts.beforeWindow) opts.beforeWindow({ ipcMain });

  app.whenReady().then(async () => {
    try {
      const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 10000, 'fenêtre');
      win.webContents.on('console-message', (e) => {
        if (e.level === 'error' || e.level === 3) consoleErrors.push(e.message);
      });
      if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
      const js = code => win.webContents.executeJavaScript(code, true);
      await waitFor(() => js('!!document.querySelector("#accountsList > *")'), 10000, 'rendu de la liste');
      await body({ win, js, check, userData, delay, waitFor, consoleErrors, tmp, app });
    } catch (err) {
      check('exception pendant le scénario', false, String(err && err.stack || err));
    }
    clearTimeout(timeout);
    finish();
  });
}

module.exports = { scenario, plainEnvelope, sampleAccount, ROOT, delay, waitFor };
