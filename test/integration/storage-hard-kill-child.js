// Lancé par storage-hard-kill.js : l'app réelle (main.js) sur un profil NEUF
// (OVCR_TEST_APPDATA, sans « Local State »).
//   OVCR_MODE=save : enregistre deux fois des comptes, affiche @@SAVED puis
//                    attend d'être tué net par le parent ;
//   OVCR_MODE=load : relit les comptes (@@LOADED), attend que les fichiers
//                    soient chiffrés sur le disque (@@ENCRYPTED), puis quitte.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('appData', process.env.OVCR_TEST_APPDATA);
require(path.join(__dirname, '..', '..', 'main.js'));
const userData = path.join(process.env.OVCR_TEST_APPDATA, 'ai-manager');
const encryptionOf = f => { try { return JSON.parse(fs.readFileSync(path.join(userData, f), 'utf8')).encryption; } catch (e) { return 'illisible:' + e.code; } };
const out = (tag, obj) => console.log(`@@${tag} ${JSON.stringify(obj)}`);
const sample = n => ({ id: 'acc_' + n, name: 'Compte ' + n, email: `c${n}@exemple.test`, profile: 'profil_' + n, color: '#8b5cf6', services: ['claude'], cooldowns: { claude: 0 } });

setTimeout(() => app.exit(3), 40000); // filet
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 200 && !(win = BrowserWindow.getAllWindows()[0]); i++) await new Promise(r => setTimeout(r, 50));
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = code => win.webContents.executeJavaScript(code, true);
  if (process.env.OVCR_MODE === 'save') {
    const a = await js(`ovcr.accounts.save(${JSON.stringify([sample(1)])})`);
    const b = await js(`ovcr.accounts.save(${JSON.stringify([sample(1), sample(2)])})`);
    out('SAVED', { ok: a.ok && b.ok, main: encryptionOf('accounts.json'), bak: encryptionOf('accounts.json.bak'), localState: fs.existsSync(path.join(userData, 'Local State')) });
    return; // le parent tue le processus
  }
  const r = await js('ovcr.accounts.load()');
  out('LOADED', { status: r.status, ids: (r.accounts || []).map(x => x.id) });
  const start = Date.now();
  while (Date.now() - start < 30000 && !(encryptionOf('accounts.json') === 'safeStorage' && encryptionOf('accounts.json.bak') === 'safeStorage')) {
    await new Promise(res => setTimeout(res, 200));
  }
  out('ENCRYPTED', { main: encryptionOf('accounts.json'), bak: encryptionOf('accounts.json.bak'), afterMs: Date.now() - start });
  app.exit(0);
});
