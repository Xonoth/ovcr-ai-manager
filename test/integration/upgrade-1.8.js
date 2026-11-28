// Intégration — passage d'une version servie en file:// (<= 1.8.0) à la 1.9.0
// servie en app://ovcr (phase 3, P5).
// OVCR_SCENARIO=prefs       : préférences d'affichage de l'ancienne origine
//                             file:// reprises UNE fois, puis plus jamais ;
// OVCR_SCENARIO=bridge-down : pont vers l'ancien localStorage en panne ->
//                             démarrage normal, préférences par défaut, pas de
//                             mode protégé.

const path = require('path');
const fs = require('fs');
const { scenario, plainEnvelope, sampleAccount, openOldFilePage } = require('./harness');

const mode = process.env.OVCR_SCENARIO || 'prefs';
const seed = (dir) => fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
const collapsed = (js) => js('[...document.querySelectorAll("#accountsList .account-card")].map(c => c.classList.contains("collapsed"))');
const reload = async (win, js, waitFor) => {
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await waitFor(() => js('!!document.querySelector("#accountsList > *")'), 10000, 'rendu de la liste');
};

if (mode === 'prefs') {
  scenario('Passage 1.8.0 -> 1.9.0 : préférences file:// reprises une fois', { seed }, async ({ win, js, check, tmp, waitFor, consoleErrors }) => {
    // Profil 1.8.0 : préférences dans le localStorage file://, rien en app://.
    const old = await openOldFilePage(tmp);
    await old.js(`localStorage.setItem('prefs_schema', '1'); localStorage.setItem('ide_w', '345px');
      localStorage.setItem('explorer_w', '150px'); localStorage.setItem('collapsed_accounts', '["acc_1"]');
      localStorage.setItem('autre_cle', 'jamais copiée'); true`);
    await js('localStorage.clear(); true');
    await reload(win, js, waitFor);

    const got = JSON.parse(await js('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])))'));
    check('préférences reprises dans le localStorage de app://', got.prefs_schema === '1' && got.ide_w === '345px' && got.explorer_w === '150px' && got.collapsed_accounts === '["acc_1"]', got);
    check('seulement les clés de préférences', !('autre_cle' in got) && !('ai_accounts' in got), Object.keys(got));
    check('largeur de l\'éditeur appliquée', await js('document.getElementById("idePanel").style.flex') === '0 0 345px', await js('document.getElementById("idePanel").style.flex'));
    check('largeur de l\'explorateur appliquée', await js('document.getElementById("fileExplorer").style.flex') === '0 0 150px', await js('document.getElementById("fileExplorer").style.flex'));
    check('repli des cartes repris', JSON.stringify(await collapsed(js)) === '[true,false]', await collapsed(js));
    check('ancienne copie file:// conservée (une 1.8.0 la retrouverait)', await old.js('localStorage.getItem("ide_w")') === '345px');

    // Plus jamais repris : l'ancienne copie change, l'interface garde les siennes.
    await old.js(`localStorage.setItem('ide_w', '500px'); localStorage.setItem('collapsed_accounts', '["acc_2"]'); true`);
    await reload(win, js, waitFor);
    check('lancement suivant : préférences de app:// gardées (pas de nouvelle reprise)', await js('localStorage.getItem("ide_w")') === '345px' && JSON.stringify(await collapsed(js)) === '[true,false]');

    // Profil neuf (rien nulle part) : préférences par défaut.
    await old.js('localStorage.clear(); true');
    await js('localStorage.clear(); true');
    await reload(win, js, waitFor);
    check('profil neuf : seule la version des préférences est écrite', await js('JSON.stringify(Object.keys(localStorage))') === '["prefs_schema"]', await js('JSON.stringify(Object.keys(localStorage))'));
    old.close();
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
} else {
  const calls = { prefs: 0, accounts: 0 };
  scenario('Passage 1.8.0 -> 1.9.0 : pont en panne, démarrage normal', {
    beforeWindow({ ipcMain }) {
      for (const ch of ['storage:legacy-prefs', 'storage:legacy-accounts']) {
        ipcMain.removeHandler(ch);
        ipcMain.handle(ch, () => { calls[ch.endsWith('prefs') ? 'prefs' : 'accounts']++; throw new Error('pont indisponible (test)'); });
      }
    }
  }, async ({ js, check, consoleErrors }) => {
    check('pont sollicité (préférences et comptes 1.0.4)', calls.prefs === 1 && calls.accounts === 1, calls);
    check('démarrage normal : liste vide affichée', await js('document.querySelector("#accountsList").textContent.includes("Aucun compte")'));
    check('écritures possibles (pas de mode protégé)', await js('!document.querySelector("#storageBanner:not([hidden])")'));
    check('préférences par défaut initialisées', await js('localStorage.getItem("prefs_schema") === "1"'));
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
}
