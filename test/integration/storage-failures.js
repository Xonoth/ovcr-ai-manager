// Intégration — pannes du stockage vues depuis l'interface (C2, M5).
// Les handlers IPC réels sont remplacés le temps de simuler la panne, puis
// remis en place : tout le reste (preload, validation, fichiers) est réel.

const path = require('path');
const fs = require('fs');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');
const accountsStore = require('../../accounts-store');

let loadBroken = true;
let saveBroken = false;

scenario('Pannes : lecture impossible puis enregistrement en échec', {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1)]));
  },
  beforeWindow({ ipcMain }) {
    ipcMain.removeHandler('accounts:load');
    ipcMain.handle('accounts:load', () => {
      if (loadBroken) throw new Error('panne simulée');
      return accountsStore.load();
    });
    ipcMain.removeHandler('accounts:save');
    ipcMain.handle('accounts:save', (_e, list) => (saveBroken ? { ok: false, error: 'disque plein (simulé)' } : accountsStore.save(list)));
  }
}, async ({ js, check, userData, waitFor, delay }) => {
  const before = fs.readFileSync(path.join(userData, 'accounts.json'), 'utf8');

  // --- C2 : lecture impossible -> mode protégé
  await waitFor(() => js('!!document.querySelector("#storageBanner:not([hidden])")'), 5000, 'bandeau');
  check('bandeau « comptes non chargés » affiché', /pas pu être chargés/.test(await js('document.querySelector("#storageBanner").textContent')));
  await js(`openModal(); document.getElementById('inputName').value = 'X'; document.getElementById('inputEmail').value = 'x@exemple.test'; saveAccount(); true`);
  await delay(400);
  check('création de compte refusée en mode protégé', await js('document.querySelectorAll(".account-card").length === 0'));
  check('fichier de comptes intact', fs.readFileSync(path.join(userData, 'accounts.json'), 'utf8') === before);
  await js('closeModal(); true');

  loadBroken = false;
  await js(`document.querySelector('#storageBanner button').click(); true`);
  await waitFor(() => js('document.querySelectorAll(".account-card").length === 1'), 5000, 'rechargement');
  check('« Réessayer » recharge les comptes', true);
  check('bandeau masqué après succès', await js('document.querySelector("#storageBanner").hidden'));

  // --- M5 : enregistrement en échec -> bandeau persistant + Réessayer
  saveBroken = true;
  await js(`toggleCooldown('acc_1', 'claude'); true`);
  await waitFor(() => js('!!document.querySelector("#storageBanner:not([hidden])")'), 5000, 'bandeau échec');
  check('bandeau « enregistrement échoué » affiché', /a échoué/.test(await js('document.querySelector("#storageBanner").textContent')));
  await delay(3500);
  check('le bandeau reste affiché (pas un toast de 3 s)', await js('!document.querySelector("#storageBanner").hidden'));

  saveBroken = false;
  await js(`document.querySelector('#storageBanner button').click(); true`);
  await waitFor(() => js('document.querySelector("#storageBanner").hidden'), 5000, 'bandeau masqué');
  const l = await accountsStore.load();
  check('« Réessayer » a enregistré la modification', l.status === 'ok' && l.accounts[0].cooldowns.claude > Date.now(), l.accounts && l.accounts[0]);
});
