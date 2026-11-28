// Intégration — versions des données, interface comprise.
// OVCR_SCENARIO=legacy : migration réelle depuis le localStorage de la 1.0.4.
// OVCR_SCENARIO=newer  : fichier écrit par une version plus récente -> lecture seule.

const path = require('path');
const fs = require('fs');
const { scenario, plainEnvelope, sampleAccount, openOldFilePage } = require('./harness');
const fx = require('../fixtures/legacy-1.0.4');

const mode = process.env.OVCR_SCENARIO || 'legacy';

if (mode === 'legacy') {
  scenario('Versions : migration 1.0.4 (localStorage file://) -> stockage chiffré', {}, async ({ win, js, check, userData, waitFor, consoleErrors, tmp }) => {
    // État d'un profil 1.0.4 : comptes dans le localStorage de l'origine
    // file:// (l'interface 1.0.4 était une page file://), aucun fichier ; et
    // rien encore dans celui de app://ovcr (premier lancement de la 1.9.0).
    const old = await openOldFilePage(tmp);
    await old.js(`localStorage.setItem('ai_accounts', ${JSON.stringify(fx.ai_accounts)});
              localStorage.setItem('ai_accounts_backup', ${JSON.stringify(fx.ai_accounts_backup)});
              localStorage.setItem('ide_w', 'n\\'importe quoi'); true`);
    await js('localStorage.clear(); true');
    win.webContents.reload();
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await waitFor(() => js('document.querySelectorAll(".account-card").length === 3'), 10000, '3 comptes migrés');
    check('3 comptes 1.0.4 affichés après migration', true);
    await waitFor(() => old.js('localStorage.getItem("ai_accounts") === null'), 5000, 'effacement').catch(() => false);
    check('ancienne copie en clair effacée du localStorage file://', await old.js('localStorage.getItem("ai_accounts") === null && localStorage.getItem("ai_accounts_backup") === null'));
    check('aucune copie des comptes dans le localStorage de app://', await js('localStorage.getItem("ai_accounts") === null && localStorage.getItem("ai_accounts_backup") === null'));
    check('ancienne préférence reprise (puis ignorée car invalide)', await js('localStorage.getItem("ide_w")') === 'n\'importe quoi');
    old.close();
    const envl = JSON.parse(fs.readFileSync(path.join(userData, 'accounts.json'), 'utf8'));
    check('fichier chiffré écrit', envl.encryption === 'safeStorage', envl.encryption);
    check('schéma enregistré dans l\'enveloppe', envl.schema === 1, envl.schema);
    check('sauvegarde pré-migration créée', fs.readdirSync(path.join(userData, 'backups')).some(f => f.startsWith('pre-migration-')));
    check('services complétés pour l\'ancien compte (9 services)', await js('document.querySelectorAll(".account-card")[1].querySelectorAll(".svc-btn").length === 9'));
    check('profil vide 1.0.4 remplacé par un profil libre', await js('document.querySelectorAll(".account-email")[2].textContent.includes("profil_3")'));
    const stored = (await js('ovcr.accounts.load()')).accounts.map(a => a.profile);
    check('liste enregistrée avec des profils valides', JSON.stringify(stored) === JSON.stringify(['profil_1', 'profil_2', 'profil_3']), stored);
    check('préférence invalide ignorée sans bloquer', await js('!document.getElementById("idePanel").style.flex.includes("importe")'));
    check('version des préférences enregistrée', await js('localStorage.getItem("prefs_schema") === "1"'));
    check('aucun bandeau d\'alerte', await js('!document.querySelector("#storageBanner:not([hidden])")'));
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
} else {
  let original;
  scenario('Versions : données d\'une version plus récente -> lecture seule', {
    seed(dir) {
      const e = JSON.parse(plainEnvelope([sampleAccount(1, { champFutur: 'x' })]));
      fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ ...e, schema: 99 }));
      original = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
    }
  }, async ({ js, check, userData, waitFor, delay }) => {
    await waitFor(() => js('!!document.querySelector("#storageBanner:not([hidden])")'), 5000, 'bandeau');
    check('bandeau « version plus récente » affiché', /plus récente/.test(await js('document.querySelector("#storageBanner").textContent')));
    check('comptes affichés quand même', await js('document.querySelectorAll(".account-card").length === 1'));
    await js(`toggleCooldown('acc_1', 'claude'); true`);
    await delay(400);
    check('modification refusée (cooldown inchangé)', await js('!document.querySelector(".cooldown-btn.active")'));
    check('fichier jamais réécrit', fs.readFileSync(path.join(userData, 'accounts.json'), 'utf8') === original);
  });
}
