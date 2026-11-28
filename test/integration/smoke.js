// Intégration — démarrage sur profil vide, isolation et sécurité de la phase 1.

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { scenario, ROOT } = require('./harness');

scenario('Démarrage et sécurité (profil vide)', {}, async ({ win, js, check, userData, delay, consoleErrors, app }) => {
  check('userData isolé dans le dossier temporaire', app.getPath('userData') === userData, app.getPath('userData'));

  // --- Isolation du renderer (phase 1)
  check('pas de require dans la page', await js('typeof require === "undefined"'));
  check('pas de process dans la page', await js('typeof process === "undefined"'));
  const api = await js(`JSON.stringify(Object.fromEntries(Object.entries(window.ovcr).map(([k, v]) => [k, Object.keys(v).sort()])))`);
  check('API window.ovcr exposée (liste fermée, une méthode par opération)', api === JSON.stringify({
    files: ['listDirectory', 'readFile', 'saveFile', 'selectFolder'],
    accounts: ['exportToFile', 'importApply', 'importCancel', 'importPick', 'load', 'migrateLegacy', 'restoreBackup', 'save'],
    storage: ['confirmRevert', 'legacyAccounts', 'legacyPrefs', 'pendingRevert'],
    sitePermissions: ['reset'],
    services: ['openInBrowser'],
    diag: ['get', 'openLogs', 'report']
  }), api);
  const errorsBeforeCsp = consoleErrors.length;
  check('eval bloqué par la CSP', await js('(() => { try { eval("1"); return false; } catch (e) { return e instanceof EvalError; } })()'));
  check('script inline bloqué par la CSP', await js(`new Promise(r => { window.__inl = false; const s = document.createElement('script'); s.textContent = 'window.__inl = true'; document.head.appendChild(s); setTimeout(() => r(window.__inl === false), 50); })`));
  await delay(100);
  // Les violations CSP provoquées volontairement ci-dessus ne comptent pas.
  for (let i = consoleErrors.length - 1; i >= errorsBeforeCsp; i--) {
    if (/Content Security Policy/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
  }

  // --- Démarrage sur un profil vide
  check('état vide affiché', await js('document.querySelector("#accountsList").textContent.includes("Aucun compte")'));
  check('stockage vide', (await js('ovcr.accounts.load()')).status === 'empty');
  check('aucun bandeau d\'alerte', await js('!document.querySelector("#storageBanner:not([hidden])")'));

  // --- Comptes : création / persistance chiffrée via l'IPC réel
  const saved = await js(`ovcr.accounts.save([{ id: 'acc_t1', name: 'Test', email: 't@exemple.test', profile: 'profil_t1', services: ['claude'], cooldowns: { claude: 0 } }])`);
  check('enregistrement par IPC', saved && saved.ok, saved);
  check('chiffrement safeStorage disponible', saved && saved.encrypted === true, saved);
  const onDisk = fs.readFileSync(path.join(userData, 'accounts.json'), 'utf8');
  check('aucune donnée en clair sur le disque', !onDisk.includes('t@exemple.test'));
  const reloaded = await js('ovcr.accounts.load()');
  check('relecture', reloaded.status === 'ok' && reloaded.accounts.length === 1, reloaded.status);
  const invalid = await js(`ovcr.accounts.save([{ id: 'x', name: 'x', email: 'x', profile: '' }])`);
  check('profil invalide refusé par le main', invalid && invalid.ok === false, invalid);

  // --- Fichiers : rien d'accessible sans dossier choisi
  const denied = await js(`ovcr.files.readFile(${JSON.stringify(path.join(ROOT, 'main.js'))})`);
  check('lecture refusée hors dossier choisi', denied && denied.error === 'denied', denied);

  // --- Interface servie en app:// (phase 3, P5)
  check('interface chargée depuis app://ovcr/index.html', win.webContents.getURL() === 'app://ovcr/index.html', win.webContents.getURL());
  check('origine propre app://ovcr, contexte sécurisé', await js('location.origin === "app://ovcr" && window.isSecureContext'));
  const served = await js(`Promise.all(['index.html', 'renderer/app.js', 'main.js', 'accounts-store.js', 'app-preload.js', 'package.json', 'legacy-bridge/legacy-storage.html', 'renderer/%2e%2e/main.js']
    .map(p => fetch('app://ovcr/' + p).then(r => r.status, e => 'erreur')))`);
  check('app:// ne sert que les fichiers de l\'interface (code du main, preload, pont : 404)', JSON.stringify(served) === '[200,200,404,404,404,404,404,404]', served);
  const errorsBeforeFetch = consoleErrors.length;
  const outside = await js(`Promise.all(['https://example.com/', ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'main.js')).href)}].map(u => fetch(u).then(() => 'chargé', () => 'refusé')))`);
  check('fetch hors de app://ovcr refusé (CSP connect-src)', outside.every(x => x === 'refusé'), outside);
  await delay(100);
  for (let i = consoleErrors.length - 1; i >= errorsBeforeFetch; i--) {
    if (/Content Security Policy|Fetch API cannot load/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
  }

  // --- Navigation de la fenêtre hôte bloquée
  const before = win.webContents.getURL();
  await js('location.href = "https://example.com/"; true').catch(() => {});
  await delay(300);
  check('navigation de la fenêtre hôte bloquée', win.webContents.getURL() === before, win.webContents.getURL());
  const errorsBeforeFile = consoleErrors.length;
  await js(`location.href = ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'index.html')).href)}; true`).catch(() => {});
  await delay(300);
  check('retour vers l\'ancienne adresse file:// de l\'interface bloqué', win.webContents.getURL() === before, win.webContents.getURL());
  // Chromium refuse lui-même app:// -> file:// (« Not allowed to load local
  // resource ») : erreur provoquée volontairement, ne compte pas.
  for (let i = consoleErrors.length - 1; i >= errorsBeforeFile; i--) {
    if (/Not allowed to load local resource: file:/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
  }

  // --- IPC refusé depuis une autre fenêtre (même preload)
  const intruder = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'app-preload.js'), contextIsolation: true, sandbox: true } });
  await intruder.loadURL('data:text/html,<p>x</p>');
  const refused = await intruder.webContents.executeJavaScript('ovcr.accounts.load().then(() => "accepté", e => "refusé")', true);
  check('IPC refusé depuis une autre fenêtre', refused === 'refusé', refused);
  // Même preload, sur l'ANCIENNE adresse file:// de l'interface : refusé aussi.
  await intruder.loadFile(path.join(ROOT, 'index.html')).catch(() => {});
  const refusedOld = await intruder.webContents.executeJavaScript('window.ovcr ? ovcr.accounts.load().then(() => "accepté", e => "refusé") : "sans preload"', true);
  check('IPC refusé depuis l\'ancienne interface file://', refusedOld === 'refusé', refusedOld);
  intruder.destroy();

  // --- Webview illégitime refusée (http, domaine hors liste, sans partition)
  const attached = await js(`new Promise(r => {
    const bad = [['http://claude.ai/', 'persist:p'], ['https://exemple.com/', 'persist:p'], ['https://claude.ai/', '']];
    let n = 0; const out = [];
    for (const [src, part] of bad) {
      const w = document.createElement('webview');
      if (part) w.setAttribute('partition', part);
      w.setAttribute('src', src);
      w.style.width = w.style.height = '10px';
      document.body.appendChild(w);
      setTimeout(() => { out.push((() => { try { return w.getWebContentsId() > 0; } catch (_) { return false; } })()); w.remove(); if (++n === bad.length) r(out); }, 800);
    }
  })`);
  check('webviews illégitimes jamais attachées', attached.every(x => x === false), attached);

  check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
});
