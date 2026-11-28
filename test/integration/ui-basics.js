// Intégration — parcours de base de l'interface (phase 3, P6 lot 0 : filet
// posé AVANT le découpage de renderer/app.js).
//
// Couvre ce qu'aucun autre scénario ne vérifiait : palette Ctrl+K, vue
// scindée et « Fermer le panneau 2 », repli des cartes (une, toutes,
// conservé au rechargement), ajout / modification / suppression d'un compte
// par les fenêtres, Échap, tableau de bord, largeurs de colonnes mémorisées.
// Les services sont servis par une fausse page locale (aucun réseau).

const path = require('path');
const fs = require('fs');
const { session } = require('electron');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const SERVICE_COUNT = 9;

scenario('Interface : palette, vue scindée, repli, comptes, préférences', {
  seed(dir) {
    // services incomplets : complétés au démarrage (9 services par compte).
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1), sampleAccount(2)]));
  }
}, async ({ win, js, check, waitFor, delay, consoleErrors }) => {
  const fakePage = () => new Response('<!doctype html><title>faux service</title><h1 id="ok">faux service local</h1>', { headers: { 'content-type': 'text/html' } });
  for (const p of ['profil_1', 'profil_2', 'profil_3', 'profil_test']) session.fromPartition('persist:' + p).protocol.handle('https', fakePage);

  const stored = async () => (await js('ovcr.accounts.load()')).accounts;
  const cmd = (name, extra = '') => js(`document.querySelector('[data-cmd="${name}"]${extra}').click(); true`);
  const action = (act, acc) => js(`document.querySelector('#accountsList [data-action="${act}"][data-acc="${acc}"]').click(); true`);
  const key = (k, mods = {}) => js(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...mods })})); true`);
  const paneInfo = n => js(`(() => { const w = document.querySelector('#pane${n} webview'); return w ? w.getAttribute('partition') + ' ' + w.getAttribute('src') : null; })()`);
  const toasts = () => js('[...document.querySelectorAll(".toast")].map(t => t.textContent.trim())');
  const clearToasts = () => js('document.querySelectorAll(".toast").forEach(t => t.remove()); true');
  const collapsed = () => js('[...document.querySelectorAll("#accountsList .account-card")].map(c => c.classList.contains("collapsed"))');
  const reload = async () => {
    win.webContents.reload();
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await waitFor(() => js('!!document.querySelector("#accountsList .account-card")'), 10000, 'rechargement');
  };
  const search = v => js(`(() => { const i = document.getElementById('paletteInput'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); return true; })()`);
  const setInput = (id, v) => js(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; true`);

  // ===== Démarrage =====
  check('deux comptes affichés', await js('document.querySelectorAll("#accountsList .account-card").length') === 2);
  check(`services complétés au démarrage (${SERVICE_COUNT} par compte)`, (await stored()).every(a => a.services.length === SERVICE_COUNT));
  check('statistiques : 2 comptes actifs, 18 services hors cooldown', await js('document.getElementById("statActive").textContent + "/" + document.getElementById("statAvailable").textContent') === '2/18');

  // ===== Palette Ctrl+K =====
  await key('k', { ctrlKey: true });
  check('Ctrl+K ouvre la palette', await js('document.getElementById("paletteOverlay").classList.contains("open")'));
  check('palette : un résultat par compte et par service, le 1er présélectionné',
    await js('document.querySelectorAll("#paletteResults .palette-item").length') === 2 * SERVICE_COUNT
    && await js('document.querySelectorAll("#paletteResults .palette-item.selected").length') === 1);
  await search('c2@exemple');
  const filtered = await js('[...document.querySelectorAll("#paletteResults .palette-item")].map(x => x.getAttribute("data-acc"))');
  check('palette : filtre par e-mail', filtered.length === SERVICE_COUNT && filtered.every(a => a === 'acc_2'), filtered);
  await search('aucun-compte-xyz');
  check('palette : aucun résultat pour un texte inconnu', await js('document.querySelectorAll("#paletteResults .palette-item").length') === 0);
  await search('compte 2');
  await key('Enter');
  await delay(200);
  check('palette : Entrée ouvre le service sélectionné dans le panneau 1', await paneInfo(1) === 'persist:profil_2 https://claude.ai/new', await paneInfo(1));
  check('palette : refermée après le choix', !(await js('document.getElementById("paletteOverlay").classList.contains("open")')));
  check('compte utilisé marqué actif', await js('!!document.querySelectorAll("#accountsList .account-card")[1].querySelector(".active-dot")'));
  check('toast « Claude ouvert avec Compte 2 »', (await toasts()).some(t => /Claude ouvert avec Compte 2/.test(t)));
  await key('k', { ctrlKey: true });
  await key('Escape');
  check('Échap referme la palette', !(await js('document.getElementById("paletteOverlay").classList.contains("open")')));
  // Clic sur un résultat (et non Entrée)
  await key('k', { ctrlKey: true });
  await search(''); // la palette garde la dernière recherche
  await js(`document.querySelector('#paletteResults .palette-item[data-acc="acc_1"][data-svc="gemini"]').click(); true`);
  await delay(200);
  check('palette : un clic ouvre le service choisi', await paneInfo(1) === 'persist:profil_1 https://gemini.google.com/app', await paneInfo(1));

  // ===== Vue scindée =====
  check('vue simple : panneau 2 caché, bouton « Fermer le panneau 2 » caché',
    !(await js('document.getElementById("pane2").classList.contains("active")')) && await js('document.getElementById("btnClosePane2").style.display === "none"'));
  await cmd('layout', '[data-layout="2"]');
  check('vue scindée : panneau 2 et séparateur affichés, bouton actif',
    await js('document.getElementById("pane2").classList.contains("active") && document.getElementById("resizerPane").style.display === "block" && document.querySelector(\'[data-cmd="layout"][data-layout="2"]\').classList.contains("active")'));
  await action('open-service', 'acc_1');                     // 1er bouton de service : Claude
  await delay(200);
  check('vue scindée : le panneau 2 vide est servi en priorité', await paneInfo(2) === 'persist:profil_1 https://claude.ai/new' && await paneInfo(1) === 'persist:profil_1 https://gemini.google.com/app');
  check('bouton « Fermer le panneau 2 » affiché', await js('document.getElementById("btnClosePane2").style.display === ""'));
  await js(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_2"][data-svc="chatgpt"]').click(); true`);
  await delay(200);
  check('vue scindée : deux panneaux pleins -> alternance (panneau 1 remplacé)', await paneInfo(1) === 'persist:profil_2 https://chatgpt.com/' && /claude/.test(await paneInfo(2)));
  await clearToasts();
  await cmd('close-pane2');
  await delay(100);
  check('« Fermer le panneau 2 » : panneau vidé, placeholder, bouton caché',
    await paneInfo(2) === null && await js('/Panneau 2 vide/.test(document.getElementById("pane2").textContent) && document.getElementById("btnClosePane2").style.display === "none"'));
  check('toast « mémoire libérée »', (await toasts()).some(t => /Panneau 2 fermé/.test(t)));
  await js(`document.querySelector('#accountsList [data-action="open-service"][data-acc="acc_2"][data-svc="grok"]').click(); true`);
  await delay(200);
  check('après fermeture : le service suivant remplit le panneau 2', await paneInfo(2) === 'persist:profil_2 https://grok.com/' && /chatgpt/.test(await paneInfo(1)));
  await cmd('layout', '[data-layout="1"]');
  check('retour en vue simple : panneau 2 caché, panneau 1 pleine largeur',
    await js('!document.getElementById("pane2").classList.contains("active") && document.getElementById("resizerPane").style.display === "none" && document.getElementById("pane1").style.flex.startsWith("1")'));
  check('vue simple : la webview du panneau 2 reste vivante (bouton toujours affiché)', await js('!!document.querySelector("#pane2 webview") && document.getElementById("btnClosePane2").style.display === ""'));
  await action('open-service', 'acc_1');
  await delay(200);
  check('vue simple : un service s\'ouvre toujours dans le panneau 1', /persist:profil_1 https:\/\/claude/.test(await paneInfo(1)));

  // ===== Repli des cartes =====
  await action('toggle-collapse', 'acc_1');
  check('clic sur l\'en-tête : carte repliée', JSON.stringify(await collapsed()) === '[true,false]');
  check('carte repliée : résumé « 9/9 »', await js('document.querySelector("#accountsList .account-card.collapsed .svc-summary").textContent') === `${SERVICE_COUNT}/${SERVICE_COUNT}`);
  await cmd('toggle-all-cards');
  check('« Tout replier » : il restait une carte dépliée -> tout replié', JSON.stringify(await collapsed()) === '[true,true]');
  check('bouton global orienté « tout déplier »', await js('document.getElementById("btnToggleAllCards").classList.contains("all-collapsed")'));
  await reload();
  check('repli conservé après rechargement', JSON.stringify(await collapsed()) === '[true,true]');
  await key('k', { ctrlKey: true });
  await js(`document.querySelector('#paletteResults .palette-item[data-acc="acc_2"]').click(); true`);
  await delay(200);
  check('ouvrir un service d\'une carte repliée la déplie', JSON.stringify(await collapsed()) === '[true,false]');
  await cmd('toggle-all-cards');
  await cmd('toggle-all-cards');
  check('« Tout replier » puis « Tout déplier »', JSON.stringify(await collapsed()) === '[false,false]' && !(await js('document.getElementById("btnToggleAllCards").classList.contains("all-collapsed")')));
  await action('toggle-collapse', 'acc_2');

  // ===== Ajout d'un compte =====
  await cmd('add-account');
  check('« Ajouter » : fenêtre ouverte, titre, champs vides',
    await js('document.getElementById("accountModal").classList.contains("open") && document.getElementById("modalTitle").textContent === "Ajouter un compte" && document.getElementById("inputName").value === "" && document.getElementById("editId").value === ""'));
  check('profil proposé libre (profil_3)', await js('document.getElementById("inputProfile").value') === 'profil_3');
  await clearToasts();
  await cmd('save-account');
  check('champs vides : refusé', (await toasts()).some(t => /Remplissez tous les champs/.test(t)) && (await stored()).length === 2);
  await setInput('inputName', 'Nouveau <b>');
  await setInput('inputEmail', 'n@exemple.test');
  await setInput('inputProfile', 'profil_1');
  await clearToasts();
  await cmd('save-account');
  check('profil déjà pris : refusé (sessions partagées)', (await toasts()).some(t => /déjà utilisé/.test(t)) && (await stored()).length === 2);
  check('après un refus : la fenêtre reste ouverte', await js('document.getElementById("accountModal").classList.contains("open")'));
  await setInput('inputProfile', '  profil_3  ');
  await clearToasts();
  await cmd('save-account');
  await delay(300);
  const afterAdd = await stored();
  const added = afterAdd[2];
  check('compte ajouté et enregistré', afterAdd.length === 3 && added && added.name === 'Nouveau <b>' && added.profile === 'profil_3' && /^acc_\d+$/.test(added.id), added);
  check('nouveau compte : tous les services, aucun cooldown', added && added.services.length === SERVICE_COUNT && Object.values(added.cooldowns).every(v => v === 0));
  check('fenêtre refermée, toast « Compte ajouté »', !(await js('document.getElementById("accountModal").classList.contains("open")')) && (await toasts()).some(t => /Compte ajouté/.test(t)));
  check('nom affiché tel quel (HTML échappé)', await js('[...document.querySelectorAll(".account-name")].some(n => n.textContent.includes("Nouveau <b>")) && !document.querySelector(".account-name b")'));
  check('statistiques mises à jour (3 comptes)', await js('document.getElementById("statActive").textContent') === '3');

  // ===== Modification =====
  await action('edit', 'acc_2');
  check('« Modifier » : fenêtre préremplie',
    await js('document.getElementById("modalTitle").textContent === "Modifier le compte" && document.getElementById("inputName").value === "Compte 2" && document.getElementById("inputProfile").value === "profil_2"'));
  await setInput('inputName', 'Compte deux');
  await cmd('save-account');
  await delay(300);
  const edited = (await stored()).find(a => a.id === 'acc_2');
  check('modification enregistrée (nom), profil et cooldowns conservés', edited.name === 'Compte deux' && edited.profile === 'profil_2' && Object.keys(edited.cooldowns).length === SERVICE_COUNT, edited);
  await action('edit', 'acc_2');
  await key('Escape');
  check('Échap referme la fenêtre du compte', !(await js('document.getElementById("accountModal").classList.contains("open")')));
  await cmd('close-modal');

  // ===== Suppression =====
  await action('toggle-collapse', added.id);
  await action('delete', added.id);
  check('« Supprimer » : confirmation avec nom et e-mail',
    await js('document.getElementById("deleteModal").classList.contains("open") && /Nouveau <b>/.test(document.getElementById("deleteDesc").textContent) && /n@exemple\\.test/.test(document.getElementById("deleteDesc").textContent)'));
  await cmd('close-delete');
  check('« Annuler » : rien supprimé', !(await js('document.getElementById("deleteModal").classList.contains("open")')) && (await stored()).length === 3);
  await action('delete', added.id);
  await clearToasts();
  await cmd('confirm-delete');
  await delay(300);
  check('suppression enregistrée', (await stored()).map(a => a.id).join() === 'acc_1,acc_2');
  check('fenêtre refermée, toast « Compte supprimé »', !(await js('document.getElementById("deleteModal").classList.contains("open")')) && (await toasts()).some(t => /Compte supprimé/.test(t)));
  check('état de repli purgé du compte supprimé', JSON.parse(await js('localStorage.getItem("collapsed_accounts")')).join() === 'acc_2', await js('localStorage.getItem("collapsed_accounts")'));

  // ===== Tableau de bord, explorateur =====
  await cmd('toggle-dashboard');
  check('tableau de bord réduit, bouton pour le rouvrir', await js('document.getElementById("dashboard").classList.contains("collapsed") && document.getElementById("btnShowDashboard").style.display === "flex"'));
  await js('document.getElementById("btnShowDashboard").click(); true');
  check('tableau de bord rouvert', await js('!document.getElementById("dashboard").classList.contains("collapsed") && document.getElementById("btnShowDashboard").style.display === "none"'));

  // ===== Largeurs de colonnes =====
  await cmd('toggle-ide');
  await cmd('toggle-explorer');
  await delay(300);
  const drag = (id, dx) => js(`(() => {
    const r = document.getElementById(${JSON.stringify(id)}), b = r.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + 20;
    r.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    const dragging = r.classList.contains('dragging') && document.getElementById('resizeOverlay').classList.contains('active');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + ${dx}, clientY: y, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: x + ${dx}, clientY: y, bubbles: true }));
    return dragging && !r.classList.contains('dragging') && !document.getElementById('resizeOverlay').classList.contains('active');
  })()`);
  const ideW0 = await js('document.getElementById("idePanel").getBoundingClientRect().width');
  check('séparateur éditeur : glisser (état « en cours » puis relâché)', await drag('resizerIde', 60));
  const ideW1 = await js('document.getElementById("idePanel").getBoundingClientRect().width');
  check('éditeur élargi de 60 px', Math.abs(ideW1 - ideW0 - 60) <= 1, [ideW0, ideW1]);
  check('largeur de l\'éditeur mémorisée', await js('localStorage.getItem("ide_w")') === Math.round(ideW1) + 'px', await js('localStorage.getItem("ide_w")'));
  await drag('resizerExplorer', -5000);
  check('explorateur : largeur minimale respectée (120 px) et mémorisée',
    await js('localStorage.getItem("explorer_w")') === '120px', await js('localStorage.getItem("explorer_w")'));
  await js('localStorage.setItem("explorer_w", "n\'importe quoi"); true');
  await reload();
  check('après rechargement : largeur de l\'éditeur restaurée', await js('document.getElementById("idePanel").style.flex') === `0 0 ${Math.round(ideW1)}px`, await js('document.getElementById("idePanel").style.flex'));
  check('largeur invalide ignorée (valeur par défaut)', await js('document.getElementById("fileExplorer").style.flex') === '');

  check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
});
