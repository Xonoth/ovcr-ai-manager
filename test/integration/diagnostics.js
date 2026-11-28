// Intégration — journal de diagnostic et erreurs globales (lot 3).

const path = require('path');
const fs = require('fs');
const { session } = require('electron');
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
  await js(`closeHelpModal(); openHelpModal(); true`);
  check('l\'aide se rouvre sur la liste des IA', await js('!document.getElementById("helpList").hidden && document.getElementById("diagPanel").hidden'));
  await js('closeHelpModal(); true');

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
