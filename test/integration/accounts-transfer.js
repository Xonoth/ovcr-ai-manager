// Intégration — export / import des comptes (phase 3, P7), par le pont
// window.ovcr (l'interface vient au lot 2 : voir aussi ui-transfer.js).
// Les boîtes « Enregistrer sous » / « Ouvrir » du main sont remplacées
// pendant le test : elles renvoient un chemin du dossier temporaire.

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const dialogs = { save: null, open: null, saveCalls: [], openCalls: [] };

scenario('Export / import des comptes : aller-retour, collisions, sauvegarde préalable', {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
    // Session restée sur le disque d'un compte supprimé : un compte importé
    // « comme nouveau » ne doit pas en hériter.
    fs.mkdirSync(path.join(dir, 'Partitions', 'profil_3'), { recursive: true });
  },
  beforeWindow() {
    dialog.showSaveDialog = async (_win, opts) => { dialogs.saveCalls.push(opts); return dialogs.save || { canceled: true }; };
    dialog.showOpenDialog = async (_win, opts) => { dialogs.openCalls.push(opts); return dialogs.open || { canceled: true, filePaths: [] }; };
  }
}, async ({ js, check, userData, tmp, consoleErrors }) => {
  const out = path.join(tmp, 'export');
  fs.mkdirSync(out, { recursive: true });
  const load = async () => (await js('ovcr.accounts.load()')).accounts;
  const backups = () => { try { return fs.readdirSync(path.join(userData, 'backups')).filter(f => f.startsWith('pre-import-')); } catch (_) { return []; } };

  // --- Export
  const canceled = await js('ovcr.accounts.exportToFile()');
  check('export annulé : rien d\'écrit', canceled.canceled === true && fs.readdirSync(out).length === 0, canceled);
  const opts = dialogs.saveCalls[0] || {};
  check('boîte « Enregistrer sous » : nom proposé daté, filtre JSON',
    /ovcr-comptes-\d{4}-\d{2}-\d{2}\.json$/.test(opts.defaultPath || '') && opts.filters && opts.filters[0].extensions[0] === 'json', opts);

  const exportFile = path.join(out, 'mes-comptes.json');
  dialogs.save = { canceled: false, filePath: exportFile };
  const exported = await js('ovcr.accounts.exportToFile()');
  check('export : 2 comptes, seul le nom du fichier revient à l\'interface',
    exported.ok && exported.count === 2 && exported.fileName === 'mes-comptes.json' && !JSON.stringify(exported).includes(out), exported);
  const text = fs.readFileSync(exportFile, 'utf8');
  const data = JSON.parse(text);
  check('fichier exporté en clair, lisible (format, version, comptes)',
    data.format === 'ovcr-accounts-export' && data.version === 1 && data.accounts.map(a => a.id).join() === 'acc_1,acc_2' && data.accounts[0].email === 'c1@exemple.test', data);
  check('aucun cookie ni chemin de session dans le fichier', !/Partitions|persist:|cookie/i.test(text.replace('sans cookies ni sessions', '')));
  check('aucun fichier temporaire laissé à côté', fs.readdirSync(out).join() === 'mes-comptes.json', fs.readdirSync(out));

  // --- Import : fichier invalide
  const bad = path.join(out, 'invalide.json');
  fs.writeFileSync(bad, JSON.stringify({ ...data, accounts: [{ ...data.accounts[0], profile: '' }] }));
  dialogs.open = { canceled: false, filePaths: [bad] };
  const refused = await js('ovcr.accounts.importPick()');
  check('import d\'un fichier invalide refusé avec la raison', !refused.ok && refused.error === 'invalid' && refused.detail === 'profil invalide', refused);
  fs.writeFileSync(bad, '{ pas du json');
  check('import d\'un fichier non JSON refusé', (await js('ovcr.accounts.importPick()')).error === 'not_json');
  check('rien n\'a été écrit après un refus', backups().length === 0 && (await load()).length === 2);

  // --- Import : résumé
  const incoming = [
    data.accounts[1],                                                      // identique
    { ...data.accounts[0], name: 'Compte 1 modifié', profile: 'profil_1b' }, // conflit par id
    sampleAccount(5, { profile: 'profil_1', name: 'Même session que 1' }), // conflit par profil (même compte visé)
    sampleAccount(6)                                                       // nouveau
  ];
  const importFile = path.join(out, 'a-importer.json');
  fs.writeFileSync(importFile, JSON.stringify({ ...data, accounts: incoming }));
  dialogs.open = { canceled: false, filePaths: [importFile] };
  const pick = await js('ovcr.accounts.importPick()');
  const s = pick.summary || {};
  check('résumé : 4 comptes, 1 nouveau, 1 déjà présent, 2 conflits nommés',
    pick.ok && pick.fileName === 'a-importer.json' && s.total === 4 && s.fresh === 1 && s.identical === 1
      && s.conflicts.map(c => c.name + '>' + c.existing.map(e => e.name).join('+')).join() === 'Compte 1 modifié>Compte 1,Même session que 1>Compte 1', pick);
  check('résumé sans chemin ni comptes complets', !JSON.stringify(pick).includes(out) && pick.accounts === undefined);
  check('jeton refusé s\'il est faux', (await js('ovcr.accounts.importApply("faux", "skip")')).error === 'no_pending_import');
  check('mode inconnu refusé', (await js(`ovcr.accounts.importApply(${JSON.stringify(pick.token)}, "fusion")`)).error === 'mode invalide');

  // --- Appliquer « ignorer »
  const skip = await js(`ovcr.accounts.importApply(${JSON.stringify(pick.token)}, "skip")`);
  check('« ignorer » : 1 ajouté, 3 ignorés', skip.ok && skip.added === 1 && skip.skipped === 3 && skip.replaced === 0, skip);
  let list = await load();
  check('« ignorer » : comptes existants intacts, nouveau ajouté en fin', list.map(a => a.id + ':' + a.name).join() === 'acc_1:Compte 1,acc_2:Compte 2,acc_6:Compte 6', list);
  check('sauvegarde préalable dans backups/ (chiffrée, nommée dans la réponse)', backups().length === 1 && skip.backupFile === backups()[0]
    && JSON.parse(fs.readFileSync(path.join(userData, 'backups', backups()[0]), 'utf8')).encryption === 'safeStorage', backups());
  check('jeton à usage unique', (await js(`ovcr.accounts.importApply(${JSON.stringify(pick.token)}, "skip")`)).error === 'no_pending_import');

  // --- Appliquer « remplacer »
  const pick2 = await js('ovcr.accounts.importPick()');
  check('2e lecture : le compte 6 est désormais « déjà présent »', pick2.ok && pick2.summary.identical === 2 && pick2.summary.fresh === 0, pick2.summary);
  const rep = await js(`ovcr.accounts.importApply(${JSON.stringify(pick2.token)}, "replace")`);
  list = await load();
  // Deux importés visent acc_1 : le 1er prend sa place, le 2e est ajouté en fin.
  check('« remplacer » : comptes remplacés à leur place, une session par compte',
    rep.ok && rep.replaced === 2 && list.map(a => a.id + ':' + a.profile).join() === 'acc_1:profil_1b,acc_2:profil_2,acc_6:profil_6,acc_5:profil_1', list);

  // --- Appliquer « nouveaux comptes »
  const copyFile = path.join(out, 'copie.json');
  fs.writeFileSync(copyFile, JSON.stringify({ ...data, accounts: [{ ...data.accounts[1], name: 'Compte 2 bis' }] }));
  dialogs.open = { canceled: false, filePaths: [copyFile] };
  const pick3 = await js('ovcr.accounts.importPick()');
  await js('ovcr.accounts.importCancel()');
  check('import annulé : jeton oublié', (await js(`ovcr.accounts.importApply(${JSON.stringify(pick3.token)}, "copy")`)).error === 'no_pending_import');
  const pick4 = await js('ovcr.accounts.importPick()');
  const copy = await js(`ovcr.accounts.importApply(${JSON.stringify(pick4.token)}, "copy")`);
  list = await load();
  const copies = list.filter(a => !['acc_1', 'acc_2', 'acc_5', 'acc_6'].includes(a.id));
  check('« nouveaux comptes » : nouvel id, premier profil libre hors sessions du disque (profil_3 sauté)',
    copy.ok && copy.copied === 1 && copy.skipped === 0 && copies.map(a => a.profile + ':' + a.name).join() === 'profil_4:Compte 2 bis'
      && copies.every(a => /^acc_\d+_[0-9a-f]{6}$/.test(a.id)), list);
  check('une sauvegarde préalable par import appliqué', backups().length === 3, backups());

  // --- Annulation de la boîte « Ouvrir »
  dialogs.open = null;
  check('boîte « Ouvrir » annulée', (await js('ovcr.accounts.importPick()')).canceled === true);
  check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
});
