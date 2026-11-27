// Intégration — résilience des panneaux IA (lot 4), SANS accès réseau :
// la session du compte de test sert une fausse page locale à la place du
// service (protocol.handle), les échecs de chargement sont des erreurs réseau
// renvoyées par ce même serveur local, et le plantage est provoqué sur le
// vrai processus de la webview. Aucun service IA
// réel n'est contacté ; « Ouvrir dans le navigateur » n'est pas cliqué (il
// ouvrirait le vrai navigateur) : seule sa validation côté main est testée.

const path = require('path');
const fs = require('fs');
const { session, webContents } = require('electron');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

scenario('Panneaux IA : plantage, échec de chargement, réessai, fermeture', {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1)]));
  }
}, async ({ js, check, waitFor, delay, userData }) => {
  const ses = session.fromPartition('persist:profil_1');
  let failing = false;
  // Toute requête https de cette session est servie LOCALEMENT : une fausse
  // page, ou une erreur réseau (net::ERR_FAILED) quand `failing` est vrai.
  ses.protocol.handle('https', () => (failing
    ? Response.error()
    : new Response('<!doctype html><title>faux service</title><h1 id="ok">faux service local</h1>', { headers: { 'content-type': 'text/html' } })));

  const overlayTitle = () => js('(document.querySelector("#pane1 .pane-error__title") || {}).textContent || ""');
  const click = (label) => js(`(() => { const b = [...document.querySelectorAll('#pane1 .pane-error__actions button')].find(x => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  const guest = async () => webContents.fromId(await js('document.querySelector("#pane1 webview").getWebContentsId()'));

  // --- Ouverture normale
  await js(`openService('acc_1', 'claude'); true`);
  await waitFor(() => js('document.querySelector("#pane1 .pane-loading") && document.querySelector("#pane1 .pane-loading").hidden'), 15000, 'chargement');
  check('service ouvert, chargement terminé, aucun écran d\'erreur', !(await js('!!document.querySelector("#pane1 .pane-error")')));
  check('la fausse page locale est bien affichée (aucun réseau)', await (await guest()).executeJavaScript('!!document.getElementById("ok")'));

  // --- Plantage du processus de la webview
  (await guest()).forcefullyCrashRenderer();
  await waitFor(async () => /arrêté/.test(await overlayTitle()), 10000, 'écran plantage');
  check('plantage : écran « Le panneau s\'est arrêté »', true);
  await click('Informations de diagnostic');
  const diagText = await js('document.querySelector("#pane1 .pane-error__diag").textContent');
  check('plantage : informations de diagnostic affichées', /Problème : crashed/.test(diagText) && /Service : claude/.test(diagText), diagText);
  check('plantage : aucun e-mail dans les informations', !/@/.test(diagText));
  await click('Recharger le service');
  await waitFor(async () => !(await js('!!document.querySelector("#pane1 .pane-error")')) && await js('document.querySelector("#pane1 .pane-loading").hidden'), 15000, 'rechargement');
  check('« Recharger le service » recrée le panneau (même partition)', await js('document.querySelector("#pane1 webview").getAttribute("partition") === "persist:profil_1"'));

  // --- Échec de chargement : erreur réseau renvoyée par le serveur LOCAL de
  // test (garanti hors réseau). Le message « Pas de connexion Internet » d'une
  // vraie coupure est couvert par les tests unitaires de classification et par
  // les tests manuels (TESTS-MANUELS.md).
  failing = true;
  await js(`document.querySelector('#pane1 webview').reload(); true`);
  await waitFor(async () => (await overlayTitle()).length > 0, 15000, 'écran d\'échec');
  const failTitle = await overlayTitle();
  check('échec de chargement : écran d\'erreur explicite', /n'a pas pu se charger/.test(failTitle), failTitle);
  const text = await js('document.querySelector("#pane1 .pane-error").textContent');
  check('jamais présenté comme un quota ou un cooldown', !/quota|cooldown|épuis/i.test(text), text);
  const buttons = await js('[...document.querySelectorAll("#pane1 .pane-error__actions button")].map(b => b.textContent)');
  check('actions proposées : Réessayer, Recharger, Navigateur, Fermer, Diagnostic',
    JSON.stringify(buttons) === JSON.stringify(['Réessayer', 'Recharger le service', 'Ouvrir dans le navigateur', 'Fermer le panneau', 'Informations de diagnostic']), buttons);
  await click('Informations de diagnostic');
  const failDiag = await js('document.querySelector("#pane1 .pane-error__diag").textContent');
  check('diagnostic : code réseau et hôte seul (pas l\'URL)', /Code : -2 /.test(failDiag) && /Site : claude\.ai/.test(failDiag) && !/\/new/.test(failDiag), failDiag);

  // Réessayer pendant le blocage : l'écran revient ; après déblocage : chargé.
  await click('Réessayer');
  await delay(300);
  await waitFor(async () => (await overlayTitle()).length > 0, 15000, 'nouvel échec');
  check('réessai toujours en échec : erreur de nouveau affichée', true);
  failing = false;
  await click('Réessayer');
  await waitFor(async () => !(await js('!!document.querySelector("#pane1 .pane-error")')) && await js('document.querySelector("#pane1 .pane-loading").hidden'), 15000, 'réessai réussi');
  check('réessai après retour du réseau : page chargée', await (await guest()).executeJavaScript('!!document.getElementById("ok")'));

  // --- Les erreurs n'ont touché à aucun cooldown
  const acc = (await js('ovcr.accounts.load()')).accounts[0];
  check('cooldowns inchangés par les erreurs de chargement', Object.values(acc.cooldowns).every(v => v === 0), acc.cooldowns);

  // --- « Ouvrir dans le navigateur » : seules les adresses de services passent
  const refused = await js(`Promise.all(['https://exemple.com/', 'http://claude.ai/', 'javascript:alert(1)', 'file:///C:/Windows/win.ini', 42].map(u => ovcr.services.openInBrowser(u)))`);
  check('ouverture externe refusée hors liste blanche https', refused.every(r => r === false), refused);

  // --- Fermer le panneau depuis l'écran d'erreur
  (await guest()).forcefullyCrashRenderer();
  await waitFor(async () => /arrêté/.test(await overlayTitle()), 10000, 'écran plantage 2');
  await click('Fermer le panneau');
  await delay(200);
  check('« Fermer le panneau » : panneau vidé, placeholder restauré', await js('!document.querySelector("#pane1 webview") && /Panneau 1 vide/.test(document.getElementById("pane1").textContent)'));

  // --- Traces dans le journal (hôte seulement)
  await delay(300);
  const log = fs.readFileSync(path.join(userData, 'logs', 'ovcr.log'), 'utf8');
  check('erreurs de panneau tracées dans le journal', /\[panneau\] crashed/.test(log) && /\[panneau\] generic code -2/.test(log));
});
