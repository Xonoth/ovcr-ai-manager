// Intégration — export / import des comptes PAR L'INTERFACE (phase 3, P7 lot 2).
// Boutons de l'en-tête des comptes, avertissement « fichier en clair »,
// résumé de l'import et choix unique pour les conflits, refus en mode protégé.
// Les boîtes « Enregistrer sous » / « Ouvrir » du main sont remplacées.
//
// OVCR_SCENARIO=normal    : parcours complet (par défaut) ;
// OVCR_SCENARIO=protected : comptes d'une version plus récente (lecture
//                           seule) -> import refusé, export permis.
// OVCR_CAPTURE_DIR        : si défini, captures des fenêtres (contrôle visuel).

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const mode = process.env.OVCR_SCENARIO || 'normal';
const dialogs = { save: null, open: null, saveCalls: 0, openCalls: 0 };
function fakeDialogs() {
  dialog.showSaveDialog = async () => { dialogs.saveCalls++; return dialogs.save || { canceled: true }; };
  dialog.showOpenDialog = async () => { dialogs.openCalls++; return dialogs.open || { canceled: true, filePaths: [] }; };
}

function helpers({ win, js, waitFor }) {
  const toasts = () => js('[...document.querySelectorAll(".toast")].map(t => t.textContent.trim())');
  return {
    cmd: name => js(`document.querySelector('[data-cmd="${name}"]').click(); true`),
    button: (modal, key) => js(`(() => { const b = document.querySelector('#${modal} [data-transfer="${key}"]'); if (!b) return false; b.click(); return true; })()`),
    isOpen: modal => js(`!!document.getElementById('${modal}')`),
    text: modal => js(`(document.getElementById('${modal}') || {}).textContent || ''`),
    toasts,
    clearToasts: () => js('document.querySelectorAll(".toast").forEach(t => t.remove()); true'),
    waitToast: (re, label) => waitFor(async () => (await toasts()).some(t => re.test(t)), 5000, label).then(() => true, () => false),
    names: () => js('[...document.querySelectorAll("#accountsList .account-name")].map(n => n.textContent.trim())'),
    capture: async (name) => {
      const dir = process.env.OVCR_CAPTURE_DIR;
      if (!dir) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
    }
  };
}

if (mode === 'normal') {
  scenario('Interface : export / import des comptes (avertissement, résumé, conflits)', {
    seed(dir) { fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)])); },
    beforeWindow: fakeDialogs
  }, async (t) => {
    const { js, check, tmp, waitFor, delay, consoleErrors } = t;
    const h = helpers(t);
    const out = path.join(tmp, 'transfert');
    fs.mkdirSync(out, { recursive: true });
    const stored = async () => (await js('ovcr.accounts.load()')).accounts;

    check('boutons Exporter / Importer dans l\'en-tête des comptes, icônes affichées',
      await js('["btnExportAccounts", "btnImportAccounts"].every(id => { const b = document.getElementById(id); return b && b.closest(".section-title--accounts") && b.querySelector("svg"); })'));

    await h.capture('en-tete');

    // ===== Export =====
    await h.cmd('export-accounts');
    const warn = await h.text('exportModal');
    check('avertissement avant l\'export : en clair, nombre de comptes, ni cookie ni session',
      /EN CLAIR/.test(warn) && /2 compte\(s\)/.test(warn) && /ni mot de passe, ni cookie, ni session/.test(warn), warn);
    check('aucune boîte « Enregistrer sous » avant confirmation', dialogs.saveCalls === 0);
    await h.capture('export');
    await h.button('exportModal', 'cancel');
    check('« Annuler » referme l\'avertissement sans rien exporter', !(await h.isOpen('exportModal')) && dialogs.saveCalls === 0);

    await h.cmd('export-accounts');
    await h.button('exportModal', 'confirm');
    await waitFor(() => dialogs.saveCalls === 1, 5000, 'boîte Enregistrer sous');
    await delay(150);
    check('boîte « Enregistrer sous » annulée : l\'avertissement reste ouvert', await h.isOpen('exportModal'));
    const exportFile = path.join(out, 'mes-comptes.json');
    dialogs.save = { canceled: false, filePath: exportFile };
    await h.button('exportModal', 'confirm');
    check('export : message avec le nombre et le nom du fichier', await h.waitToast(/2 compte\(s\) exporté\(s\) dans « mes-comptes\.json »/, 'toast export'), await h.toasts());
    check('export : fenêtre refermée, fichier écrit', !(await h.isOpen('exportModal')) && JSON.parse(fs.readFileSync(exportFile, 'utf8')).accounts.length === 2);
    await h.clearToasts();

    // ===== Import : fichier refusé =====
    const data = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
    const bad = path.join(out, 'invalide.json');
    fs.writeFileSync(bad, JSON.stringify({ ...data, accounts: [{ ...data.accounts[0], profile: '' }] }));
    dialogs.open = { canceled: false, filePaths: [bad] };
    await h.cmd('import-accounts');
    check('fichier invalide : message clair, aucune fenêtre', await h.waitToast(/Import impossible : Fichier refusé : un compte est invalide \(profil invalide\)\./, 'toast refus')
      && !(await h.isOpen('importModal')), await h.toasts());
    await h.clearToasts();

    // ===== Import : résumé, conflits, « Remplacer » =====
    const evil = '<img src=x id=injecte>';
    const importFile = path.join(out, 'a-importer.json');
    fs.writeFileSync(importFile, JSON.stringify({ ...data, accounts: [
      data.accounts[0],                                            // déjà présent
      { ...data.accounts[1], name: 'Compte 2 renommé ' + evil },   // conflit
      sampleAccount(3)                                             // nouveau
    ] }));
    dialogs.open = { canceled: false, filePaths: [importFile] };
    await h.cmd('import-accounts');
    await waitFor(() => h.isOpen('importModal'), 5000, 'fenêtre d\'import');
    const summary = await h.text('importModal');
    check('résumé : fichier, 3 comptes, 1 nouveau, 1 déjà présent, 1 en conflit',
      summary.includes('Fichier « a-importer.json » : 3 compte(s) — 1 nouveau(x), 1 déjà présent(s), 1 en conflit.'), summary);
    check('conflit nommé (compte importé et compte actuel, avec leurs profils)',
      summary.includes(`Compte 2 renommé ${evil} (profil_2) ↔ compte actuel Compte 2 (profil_2)`), summary);
    check('nom venu du fichier affiché comme du texte (aucune balise interprétée)', await js('!document.getElementById("injecte")'));
    check('choix unique, « Ignorer » coché par défaut, 3 options',
      await js('[...document.querySelectorAll("#importModal input[name=importMode]")].map(i => i.value + (i.checked ? "*" : "")).join()') === 'skip*,replace,copy');
    check('sauvegarde préalable annoncée', /copie de la liste actuelle est enregistrée avant l'import/.test(summary));
    await h.capture('import');

    await h.button('importModal', 'cancel');
    check('« Annuler » : fenêtre refermée, aucun compte modifié', !(await h.isOpen('importModal')) && (await stored()).length === 2);

    await h.cmd('import-accounts');
    await waitFor(() => h.isOpen('importModal'), 5000, 'fenêtre d\'import (2)');
    await js('document.querySelector(\'#importModal input[value="replace"]\').click(); true');
    await h.button('importModal', 'confirm');
    check('« Remplacer » : message du résultat', await h.waitToast(/Import terminé : 1 ajouté\(s\), 1 remplacé\(s\), 1 ignoré\(s\)/, 'toast import'), await h.toasts());
    const names = await h.names();
    check('liste réaffichée : compte remplacé à sa place, nouveau compte en fin',
      names.length === 3 && names[0] === 'Compte 1' && names[1] === 'Compte 2 renommé ' + evil && names[2] === 'Compte 3', names);
    const list = await stored();
    check('comptes enregistrés, nouveau compte complété (tous les services)',
      list.map(a => a.id).join() === 'acc_1,acc_2,acc_3' && list[2].services.length === list[0].services.length, list.map(a => a.id + ':' + a.services.length));
    check('statistiques à jour (3 comptes actifs)', await js('document.getElementById("statActive").textContent') === '3');
    await h.clearToasts();

    // ===== Import : tout déjà présent (nouvel export, réimporté tel quel) =====
    const again = path.join(out, 'export-2.json');
    dialogs.save = { canceled: false, filePath: again };
    check('nouvel export : 3 comptes', (await js('ovcr.accounts.exportToFile()')).count === 3);
    dialogs.open = { canceled: false, filePaths: [again] };
    await h.cmd('import-accounts');
    await waitFor(() => h.isOpen('importModal'), 5000, 'fenêtre d\'import (3)');
    check('rien à importer : message dédié, un seul bouton',
      /sont déjà présents, à l'identique : rien à importer/.test(await h.text('importModal'))
        && await js('document.querySelectorAll("#importModal .modal__actions button").length') === 1);
    await h.button('importModal', 'close');
    check('fenêtre refermée', !(await h.isOpen('importModal')));
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
} else {
  scenario('Interface : import refusé en lecture seule, export permis', {
    seed(dir) {
      fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ ...JSON.parse(plainEnvelope([sampleAccount(1)])), schema: 99 }));
    },
    beforeWindow: fakeDialogs
  }, async (t) => {
    const { js, check, consoleErrors } = t;
    const h = helpers(t);
    check('lecture seule (bandeau « version plus récente »)', await js('!!document.querySelector("#storageBanner:not([hidden])")'));
    await h.cmd('import-accounts');
    check('import refusé avec explication, sans ouvrir de boîte',
      await h.waitToast(/Modification impossible pour ne rien écraser/, 'toast lecture seule') && dialogs.openCalls === 0 && !(await h.isOpen('importModal')), await h.toasts());
    await h.cmd('export-accounts');
    check('export toujours possible (avertissement affiché)', await h.isOpen('exportModal'));
    await h.button('exportModal', 'cancel');
    check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
  });
}
