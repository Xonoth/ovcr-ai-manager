// Intégration — retour arrière vers le stockage de la 1.0.4, côté interface
// (phase 3, P6 lot 6 : filet posé avant de déplacer ce code).
// Lancement simulé avec --revert-storage-migration (ajouté à process.argv
// avant le chargement de main.js).
// OVCR_SCENARIO=revert  : des comptes existent -> réécrits dans le
//                         localStorage au format 1.0.4, fichiers mis de côté,
//                         message, fermeture demandée ;
// OVCR_SCENARIO=nothing : rien à réécrire -> retour arrière ignoré, démarrage
//                         normal.
// La boîte d'information du main et app.quit() sont remplacées pendant le
// test (aucune fenêtre native, le banc d'essai garde la main).

const path = require('path');
const fs = require('fs');
const { app, dialog } = require('electron');
const { scenario, plainEnvelope, sampleAccount, waitFor } = require('./harness');

const mode = process.env.OVCR_SCENARIO || 'revert';
const calls = { dialog: 0, quit: 0 };

function fakeQuitAndDialog() {
  dialog.showMessageBox = async () => { calls.dialog++; return { response: 0 }; };
  app.quit = () => { calls.quit++; };
}

if (mode === 'revert') {
  scenario('Retour arrière 1.0.4 : comptes réécrits dans le localStorage, fermeture', {
    waitForList: false,
    seed(dir) {
      process.argv.push('--revert-storage-migration');
      fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
    },
    beforeWindow: fakeQuitAndDialog
  }, async ({ js, check, userData, consoleErrors }) => {
    await waitFor(() => js('/Comptes réécrits au format 1\\.0\\.4/.test(document.body.textContent)'), 10000, 'message du retour arrière').catch(() => false);
    check('message « Comptes réécrits au format 1.0.4. Fermeture… »', await js('document.body.textContent.includes("Comptes réécrits au format 1.0.4. Fermeture…")'));
    const legacy = JSON.parse(await js('localStorage.getItem("ai_accounts")') || 'null');
    check('comptes réécrits dans le localStorage (clé 1.0.4 ai_accounts)', Array.isArray(legacy) && legacy.map(a => a.id).join() === 'acc_1,acc_2', legacy);
    check('aucune liste de comptes construite', await js('!document.getElementById("accountsList")'));
    check('démarrage arrêté avant les préférences (prefs_schema non écrit)', await js('localStorage.getItem("prefs_schema") === null'));
    await waitFor(() => calls.quit > 0, 5000, 'fermeture').catch(() => false);
    check('fermeture demandée après le message d\'information', calls.dialog === 1 && calls.quit === 1, calls);
    const files = fs.readdirSync(userData);
    check('fichier chiffré mis de côté, jamais supprimé', !files.includes('accounts.json') && files.some(f => /^accounts\.json\..*reverted/.test(f) || /reverted/.test(f)), files);
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
} else {
  scenario('Retour arrière 1.0.4 demandé sans comptes : ignoré, démarrage normal', {
    seed() { process.argv.push('--revert-storage-migration'); },
    beforeWindow: fakeQuitAndDialog
  }, async ({ js, check, userData, delay, consoleErrors }) => {
    check('démarrage normal : liste vide affichée', await js('document.querySelector("#accountsList").textContent.includes("Aucun compte")'));
    check('écritures possibles (pas de mode protégé)', await js('!document.querySelector("#storageBanner:not([hidden])")'));
    check('préférences initialisées', await js('localStorage.getItem("prefs_schema") === "1"'));
    await delay(500);
    check('aucune fermeture demandée', calls.dialog === 0 && calls.quit === 0, calls);
    const log = fs.readFileSync(path.join(userData, 'logs', 'ovcr.log'), 'utf8');
    check('retour arrière ignoré, tracé dans le journal', /retour arrière ignoré/.test(log));
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
}
