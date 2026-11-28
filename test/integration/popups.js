// Intégration — popups de connexion et liens externes (audit phase 2, F4, F5,
// M10), SANS accès réseau : la session du compte de test sert de fausses
// pages locales (protocol.handle), y compris dans les popups, qui partagent
// la session de leur webview.
//
// Le navigateur système n'est JAMAIS ouvert : shell.openExternal est remplacé
// par un enregistreur avant le moindre lien (le scénario s'arrête si ce
// remplacement ne prend pas). La boîte native d'une popup en échec est
// remplacée de la même façon par une réponse choisie par le test.

const path = require('path');
const fs = require('fs');
const electron = require('electron');
const { session, webContents, BrowserWindow } = electron;
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const opened = [];
const stubOpenExternal = async (url) => { opened.push(url); };
let dialogAnswer = null;
const dialogCalls = [];

scenario('Popups de connexion : fermeture avec la page d\'origine, échec de chargement, liens externes limités', {
  seed(dir) {
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1)]));
  },
  beforeWindow() {
    electron.shell.openExternal = stubOpenExternal;
    const realShowMessageBox = electron.dialog.showMessageBox;
    electron.dialog.showMessageBox = async (...args) => {
      const opts = args[args.length - 1];
      if (!dialogAnswer) return realShowMessageBox.apply(electron.dialog, args);
      dialogCalls.push(opts);
      return { response: opts.buttons.indexOf(dialogAnswer), checkboxChecked: false };
    };
  }
}, async ({ js, check, waitFor, delay, userData }) => {
  if (electron.shell.openExternal !== stubOpenExternal) {
    check('shell.openExternal remplacé (sinon le vrai navigateur s\'ouvrirait)', false);
    return;
  }
  const ses = session.fromPartition('persist:profil_1');
  let failing = false;
  ses.protocol.handle('https', () => (failing
    ? Response.error()
    : new Response('<!doctype html><title>faux</title><h1 id="ok">page locale</h1>', { headers: { 'content-type': 'text/html' } })));

  const guestOf = async (pane) => webContents.fromId(await js(`document.querySelector("#${pane} webview").getWebContentsId()`));
  const popups = () => BrowserWindow.getAllWindows().filter(w => w.webContents.opener || w.getParentWindow());
  const windowCount = () => BrowserWindow.getAllWindows().length;
  const openFrom = (contents, url) => contents.executeJavaScript(`window.open(${JSON.stringify(url)}, '_blank', 'popup,width=480,height=600'); true`, true);
  const loaded = async () => waitFor(() => js('document.querySelector("#pane1 .pane-loading") && document.querySelector("#pane1 .pane-loading").hidden'), 15000, 'chargement');

  await js(`openService('acc_1', 'claude'); true`);
  await loaded();
  const g1 = await guestOf('pane1');
  check('fausse page locale chargée (aucun réseau)', await g1.executeJavaScript('!!document.getElementById("ok")'));

  // --- F5 : popup + popup imbriquée, puis la webview est REMPLACÉE (autre service)
  await openFrom(g1, 'https://accounts.google.com/o/oauth2/auth?client_id=test');
  await waitFor(() => windowCount() === 2, 10000, 'popup ouverte');
  const popup = BrowserWindow.getAllWindows().find(w => w.webContents !== null && w.webContents.getType() === 'window' && w.webContents.opener);
  check('popup OAuth (origine autorisée) ouverte dans une fenêtre Electron', !!popup);
  await waitFor(() => !popup.webContents.isLoading(), 10000, 'popup chargée');
  await openFrom(popup.webContents, 'https://appleid.apple.com/auth/authorize');
  await waitFor(() => windowCount() === 3, 10000, 'popup imbriquée');
  check('popup ouverte depuis la popup (imbriquée)', true);
  await js(`openService('acc_1', 'chatgpt'); true`);
  await waitFor(() => windowCount() === 1, 5000, 'popups fermées');
  check('F5 : webview remplacée -> ses popups (imbriquée comprise) sont fermées', windowCount() === 1, windowCount());
  await loaded();

  // --- F5 : la webview est FERMÉE (panneau fermé)
  const g2 = await guestOf('pane1');
  await openFrom(g2, 'https://accounts.google.com/signin');
  await waitFor(() => windowCount() === 2, 10000, 'popup 2');
  await js(`document.querySelector('#pane1 webview').remove(); true`);
  await waitFor(() => windowCount() === 1, 5000, 'popup 2 fermée');
  check('F5 : panneau fermé -> sa popup est fermée', windowCount() === 1, windowCount());
  check('la fenêtre principale reste ouverte', BrowserWindow.getAllWindows().length === 1 && !BrowserWindow.getAllWindows()[0].webContents.opener);

  // --- M10 : popup dont la page ne charge pas -> boîte « Réessayer / navigateur / Fermer »
  await js(`openService('acc_1', 'claude'); true`);
  await loaded();
  const g3 = await guestOf('pane1');
  failing = true;
  dialogAnswer = 'Réessayer';
  await openFrom(g3, 'https://accounts.google.com/o/oauth2/auth?essai=1');
  await waitFor(() => dialogCalls.length >= 1, 10000, 'boîte d\'échec');
  const box = dialogCalls[0];
  check('popup en échec : boîte « La page de connexion (…) n\'a pas pu se charger »', /accounts\.google\.com\) n'a pas pu se charger/.test(box.message), box.message);
  check('popup en échec : Réessayer / Ouvrir dans le navigateur / Fermer', JSON.stringify(box.buttons) === '["Réessayer","Ouvrir dans le navigateur","Fermer"]', box.buttons);
  check('popup en échec : jamais l\'URL complète dans le message', !/essai=1/.test(box.message + box.detail));
  // Réessayer pendant l'échec -> la boîte revient ; puis réseau rétabli -> la page charge.
  await waitFor(() => dialogCalls.length >= 2, 10000, 'boîte après réessai');
  check('Réessayer toujours en échec : la boîte revient', true);
  failing = false;
  const p3 = popups()[0];
  await waitFor(() => p3 && !p3.isDestroyed() && !p3.webContents.isLoading(), 10000, 'réessai');
  await delay(300);
  const n = dialogCalls.length;
  check('Réessayer après retour du réseau : page de connexion chargée',
    !p3.isDestroyed() && await p3.webContents.executeJavaScript('!!document.getElementById("ok")'));
  // Échec de nouveau, réponse « Fermer » -> popup fermée.
  failing = true;
  dialogAnswer = 'Fermer';
  p3.webContents.reload();
  await waitFor(() => dialogCalls.length > n && windowCount() === 1, 10000, 'popup fermée par « Fermer »');
  check('« Fermer » ferme la popup', windowCount() === 1);
  // « Ouvrir dans le navigateur » : adresse confiée au navigateur système, popup fermée.
  dialogAnswer = 'Ouvrir dans le navigateur';
  await openFrom(g3, 'https://accounts.google.com/o/oauth2/auth?essai=2');
  await waitFor(() => windowCount() === 1 && opened.length === 1, 10000, 'ouverture externe');
  check('« Ouvrir dans le navigateur » : adresse confiée au navigateur système, popup fermée',
    opened.length === 1 && opened[0].startsWith('https://accounts.google.com/'), opened);
  failing = false;
  dialogAnswer = null;
  opened.length = 0;

  // --- F4 : liens hors liste -> navigateur système, 5 par minute et par page
  for (let i = 1; i <= 8; i++) await openFrom(g3, `https://exemple.com/lien-${i}?jeton=secret`);
  await delay(500);
  check('F4 : liens hors liste jamais ouverts dans une fenêtre Electron', windowCount() === 1, windowCount());
  check('F4 : 5 liens confiés au navigateur système, les 3 suivants ignorés', opened.length === 5 && opened[4].endsWith('lien-5?jeton=secret'), opened);
  await js(`openService('acc_1', 'gemini'); true`);
  await loaded();
  await openFrom(await guestOf('pane1'), 'https://exemple.com/autre-page');
  await delay(300);
  check('F4 : limite propre à chaque page (une nouvelle webview a son propre quota)', opened.length === 6, opened.length);
  await openFrom(await guestOf('pane1'), 'javascript:alert(1)');
  await delay(200);
  check('schéma non web : refusé, jamais confié au navigateur', opened.length === 6 && windowCount() === 1);

  await delay(300);
  const log = fs.readFileSync(path.join(userData, 'logs', 'ovcr.log'), 'utf8');
  const limited = log.split(/\r?\n/).filter(l => /liens suivants ignorés/.test(l));
  check('F4 : une seule ligne de journal pour la rafale refusée, hôte seul', limited.length === 1 && /claude\.ai/.test(limited[0]) && !/jeton|lien-6/.test(limited[0]), limited);
  check('F5 : fermeture tracée dans le journal', /popup fermée avec sa page d'origine/.test(log));
  check('aucune URL complète (jeton) dans le journal', !/jeton=secret|essai=/.test(log));
});
