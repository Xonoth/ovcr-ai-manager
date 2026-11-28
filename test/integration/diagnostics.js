// Intégration — journal de diagnostic et erreurs globales (lot 3).

const path = require('path');
const fs = require('fs');
const { session, shell } = require('electron');
const { scenario } = require('./harness');
const diagnostics = require('../../diagnostics');

scenario('Diagnostics : journal expurgé, erreurs de l\'interface, section Diagnostic', {}, async ({ win, js, check, userData, waitFor, delay }) => {
  const logFile = path.join(userData, 'logs', 'ovcr.log');
  const readLog = async () => { await diagnostics.whenFlushed(); return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''; };

  check('journal créé au démarrage', /démarrage/.test(await readLog()));

  // Un compte avec un e-mail, puis une erreur qui mentionne cet e-mail.
  await js(`openModal(); document.getElementById('inputName').value = 'Alice'; document.getElementById('inputEmail').value = 'alice.secret@exemple.test'; saveAccount(); true`);
  await delay(300);
  await js(`console.warn('[test] avertissement pour alice.secret@exemple.test https://claude.ai/chat/abc?token=XYZ'); true`);
  await js(`setTimeout(() => { throw new Error('erreur-de-test-lot3'); }, 0); true`);
  await js(`Promise.reject(new Error('rejet-de-test-lot3')); true`);
  await delay(600);

  const log = await readLog();
  check('avertissement de l\'interface journalisé', /\[interface\] \[test\] avertissement/.test(log));
  check('erreur non interceptée journalisée (avec origine)', /erreur non interceptée : .*erreur-de-test-lot3/.test(log));
  check('promesse rejetée journalisée', /rejet-de-test-lot3/.test(log));
  check('aucun e-mail dans le journal', !/alice\.secret/.test(log));
  check('aucune URL complète ni jeton dans le journal', !/token=XYZ|chat\/abc/.test(log));
  check('toast d\'erreur affiché à l\'utilisateur', await js('[...document.querySelectorAll(".toast")].some(t => t.textContent.includes("erreur interne"))'));

  // Section Diagnostic de la page d'aide.
  await js(`openHelpModal(); showDiagnostic(); true`);
  await waitFor(() => js('!document.getElementById("diagText").textContent.startsWith("Chargement")'), 5000, 'diagnostic');
  const text = await js('document.getElementById("diagText").textContent');
  check('diagnostic : version et état du stockage', /AI Manager 1\.\d+\.\d+.*\n.*Electron/.test(text) && /Stockage : ok, 1 compte\(s\), chiffré/.test(text), text.slice(0, 300));
  check('diagnostic : mémoire par processus', /Mémoire totale : \d+ Mo/.test(text));
  check('diagnostic : derniers événements', /erreur-de-test-lot3/.test(text));
  check('diagnostic : aucun e-mail', !/alice\.secret/.test(text));
  check('aide masquée pendant le diagnostic', await js('document.getElementById("helpList").hidden'));
  check('diagnostic : état de l\'interface (écriture, panneaux, vue)', /Écriture des comptes : possible/.test(text) && /Panneaux : 0 ouvert\(s\), vue simple/.test(text), text);

  // Boutons du diagnostic (P6 lot 2). Le presse-papiers est remplacé DANS LA
  // PAGE : le test ne touche jamais au presse-papiers réel de l'utilisateur.
  const toasts = () => js('[...document.querySelectorAll(".toast")].map(t => t.textContent.trim())');
  const clearToasts = () => js('document.querySelectorAll(".toast").forEach(t => t.remove()); true');
  await clearToasts();
  await js('navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true');
  await js('document.querySelector(\'[data-cmd="copy-diagnostic"]\').click(); true');
  await delay(300);
  check('« Copier le diagnostic » : texte affiché copié, confirmation',
    await js('window.__copied') === text && (await toasts()).some(t => /Diagnostic copié/.test(t)));
  await clearToasts();
  await js('navigator.clipboard.writeText = async () => { throw new Error("refus de test"); }; true');
  await js('document.querySelector(\'[data-cmd="copy-diagnostic"]\').click(); true');
  await delay(300);
  check('copie refusée : repli « Ctrl+C » expliqué', (await toasts()).some(t => /Copie impossible : sélectionnez le texte/.test(t)));
  // « Ouvrir le dossier des journaux » : l'Explorateur n'est pas lancé pendant
  // le test, on vérifie seulement le dossier demandé au système.
  const openedPaths = [];
  shell.openPath = async (p) => { openedPaths.push(p); return ''; };
  await clearToasts();
  await js('document.querySelector(\'[data-cmd="open-logs"]\').click(); true');
  await delay(300);
  check('« Ouvrir le dossier des journaux » : dossier logs demandé, sans erreur',
    openedPaths.length === 1 && path.resolve(openedPaths[0]) === path.join(userData, 'logs') && !(await toasts()).some(t => /Impossible/.test(t)), openedPaths);
  shell.openPath = async () => 'refusé pour le test';
  await js('document.querySelector(\'[data-cmd="open-logs"]\').click(); true');
  await delay(300);
  check('dossier des journaux impossible à ouvrir : message', (await toasts()).some(t => /Impossible d'ouvrir le dossier des journaux/.test(t)));
  await js('document.querySelector(\'[data-cmd="show-diagnostic"]\').click(); true');
  check('2e clic sur « Diagnostic » : retour à la liste des IA', await js('!document.getElementById("helpList").hidden && document.getElementById("diagPanel").hidden'));

  await js(`closeHelpModal(); openHelpModal(); true`);
  check('l\'aide se rouvre sur la liste des IA', await js('!document.getElementById("helpList").hidden && document.getElementById("diagPanel").hidden'));
  const entries = await js('[...document.querySelectorAll("#helpList .help-entry")].map(e => e.querySelector(".help-entry__name").textContent + "|" + e.querySelectorAll(".help-entry__line").length)');
  check('aide : une fiche par service (nom, « C\'est quoi ? », « Quand l\'utiliser ? »)', entries.length === 9 && entries[0] === 'Claude|2' && entries.every(e => e.endsWith('|2')), entries);
  await clearToasts();
  await js('document.querySelector(\'[data-cmd="reset-permissions"]\').click(); true');
  await delay(300);
  check('« Réinitialiser les autorisations des sites » : confirmé', (await toasts()).some(t => /Autorisations des sites réinitialisées/.test(t)));
  await js('document.getElementById("helpModal").dispatchEvent(new MouseEvent("click", { bubbles: true })); true');
  check('clic sur le fond : aide refermée', !(await js('document.getElementById("helpModal").classList.contains("open")')));
  await js('openHelpModal(); document.querySelector("#helpList").click(); true');
  check('clic dans la boîte : aide toujours ouverte', await js('document.getElementById("helpModal").classList.contains("open")'));
  await js('document.querySelector(\'[data-cmd="close-help"]\').click(); true');
  check('bouton « Fermer » : aide refermée', !(await js('document.getElementById("helpModal").classList.contains("open")')));

  // Écran d'erreur de démarrage (composant appelé directement : le
  // déclenchement réel suppose un défaut dans le code de démarrage).
  await js(`OVCR.showStartupError(new Error('démarrage-de-test')); true`);
  check('écran « l\'application n\'a pas pu démarrer » affiché', await js('[...document.querySelectorAll(".modal-overlay.open .modal__title")].some(t => t.textContent.includes("pas pu démarrer"))'));
  await delay(200);
  check('échec de démarrage journalisé', /démarrage impossible : démarrage-de-test/.test(await readLog()));

  // Socle renderer/core.js manquant (installation abîmée) : message explicite
  // au lieu d'une interface vide. Le fichier est bloqué pour ce seul test.
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /\/renderer\/core\.js$/.test(d.url) }));
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await delay(300);
  check('core.js manquant : message « Réinstallez l\'application »', await js('/renderer\\/core\\.js n.est pas chargé/.test(document.body.textContent) && !document.getElementById("accountsList")'));
  session.defaultSession.webRequest.onBeforeRequest(null);
});
