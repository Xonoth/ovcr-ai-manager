// Intégration — récupération après corruption, interface comprise.
// Lancé deux fois par run.js : OVCR_SCENARIO=corrupt | missing.

const path = require('path');
const fs = require('fs');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const mode = process.env.OVCR_SCENARIO || 'corrupt';

scenario(`Récupération : fichier principal ${mode === 'missing' ? 'absent' : 'corrompu'}, sauvegarde valide`, {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json.bak'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
    if (mode === 'corrupt') fs.writeFileSync(path.join(dir, 'accounts.json'), '{"format":"ovcr-acc'); // tronqué
  }
}, async ({ js, check, userData, waitFor, delay, consoleErrors }) => {
  await waitFor(() => js('!!document.querySelector(".modal-overlay.open .modal__title")'), 5000, 'modale de récupération');
  const title = await js('document.querySelector(".modal-overlay.open .modal__title").textContent');
  check('modale de récupération affichée', mode === 'missing' ? /introuvable/.test(title) : /illisibles/.test(title), title);
  const desc = await js('document.querySelector(".modal-overlay.open .modal__title").nextElementSibling.textContent');
  check('la sauvegarde de 2 comptes est proposée', desc.includes('2 compte(s)'), desc);
  check('le choix « continuer » explique que la sauvegarde est conservée', desc.includes('backups'), desc);

  if (mode === 'missing') {
    // Restauration depuis l'interface.
    await js(`[...document.querySelectorAll('.modal-overlay.open button')].find(b => b.textContent.includes('Restaurer')).click(); true`);
    await waitFor(() => js('document.querySelectorAll(".account-card").length === 2'), 5000, 'comptes restaurés');
    check('2 comptes restaurés et affichés', true);
    const l = await js('ovcr.accounts.load()');
    check('fichier principal recréé', l.status === 'ok' && l.accounts.length === 2, l.status);
  } else {
    // L'utilisateur continue sans restaurer, puis modifie deux fois.
    await js(`[...document.querySelectorAll('.modal-overlay.open button')].find(b => b.textContent.includes('Continuer')).click(); true`);
    for (const name of ['Nouveau A', 'Nouveau B']) {
      await js(`openModal(); document.getElementById('inputName').value = ${JSON.stringify(name)}; document.getElementById('inputEmail').value = 'n@exemple.test'; saveAccount(); true`);
      await delay(300);
    }
    await waitFor(() => js('document.querySelectorAll(".account-card").length === 2'), 5000, 'nouveaux comptes');
    const backups = fs.existsSync(path.join(userData, 'backups')) ? fs.readdirSync(path.join(userData, 'backups')) : [];
    check('copie de la sauvegarde d\'origine mise à l\'abri', backups.some(f => f.startsWith('bak-preserved-main-unreadable-')), backups);
    check('fichier illisible conservé', fs.readdirSync(userData).some(f => /^accounts\.unreadable-/.test(f)));
  }
  check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
});
