// Intégration — éditeur de fichiers (phase 3, P6 lot 0 : filet posé AVANT le
// découpage de renderer/app.js).
//
// Couvre le parcours réel de l'utilisateur, sans réseau et hors du vrai
// profil : ouverture du panneau éditeur (Monaco chargé à la demande), choix
// d'un dossier (boîte « Ouvrir » du main remplacée par une réponse fixe),
// ouverture d'un fichier, saisie au clavier, Ctrl+S vérifié sur le disque,
// fichiers refusés (non UTF-8, trop gros, binaire), puis le même parcours avec
// l'éditeur de secours quand Monaco ne peut pas se charger (loader.js bloqué).

const path = require('path');
const fs = require('fs');
const { dialog, session } = require('electron');
const { scenario } = require('./harness');

let folder;

scenario('Éditeur : Monaco, fichiers refusés, Ctrl+S, éditeur de secours', {
  seed(userDataDir) {
    // Dossier de travail À CÔTÉ du profil, dans le même dossier temporaire.
    folder = path.join(path.dirname(userDataDir), 'projet');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'a.js'), 'const a = 1;\n');
    fs.writeFileSync(path.join(folder, 'notes.md'), '# Notes\n');
    fs.writeFileSync(path.join(folder, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // « café » en Latin-1
    fs.writeFileSync(path.join(folder, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    // 20 Mo + 1 octet : juste au-dessus de la limite de l'éditeur.
    fs.writeFileSync(path.join(folder, 'gros.txt'), Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
  }
}, async ({ win, js, check, waitFor, delay, consoleErrors }) => {
  // La boîte « Choisir un dossier » du main répond toujours le dossier de test.
  let dialogCalls = 0;
  dialog.showOpenDialog = async () => { dialogCalls++; return { canceled: false, filePaths: [folder] }; };

  const disk = name => fs.readFileSync(path.join(folder, name));
  const toasts = () => js('[...document.querySelectorAll(".toast")].map(t => t.textContent.trim())');
  const clearToasts = () => js('document.querySelectorAll(".toast").forEach(t => t.remove()); true');
  const waitToast = (re, label) => waitFor(async () => (await toasts()).some(t => re.test(t)), 5000, label).catch(() => false);
  const openFile = name => js(`(() => { const el = [...document.querySelectorAll('#fileList .file-item')].find(x => x.getAttribute('data-name') === ${JSON.stringify(name)}); if (!el) return false; el.click(); return true; })()`);
  const cmd = name => js(`document.querySelector('[data-cmd="${name}"]').click(); true`);
  // Vraies frappes clavier (comme l'utilisateur), envoyées à l'élément qui a le focus.
  const typeText = async (text) => { for (const ch of text) win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await delay(100); };
  const ctrlS = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] });
    await delay(300);
  };
  // sendInputEvent fonctionne sans mettre la fenêtre au premier plan : le
  // test ne vole pas le focus de l'utilisateur.

  // ===== 1. Monaco =====
  check('éditeur replié au démarrage, Monaco pas encore chargé', await js('document.getElementById("idePanel").classList.contains("collapsed") && typeof monaco === "undefined"'));
  await cmd('toggle-ide');
  check('ouverture du panneau : message « Chargement de l\'éditeur… »', await js('/Chargement de l.éditeur/.test(document.getElementById("monacoContainer").textContent)'));
  const loaded = await waitFor(() => js('typeof monaco !== "undefined" && monaco.editor.getEditors().length === 1'), 20000, 'Monaco').catch(() => false);
  check('Monaco chargé à la demande (une seule instance)', loaded);
  check('placeholder remplacé par Monaco', await js('!!document.querySelector("#monacoContainer .monaco-editor") && !/Chargement/.test(document.getElementById("monacoContainer").textContent)'));
  const ed = 'monaco.editor.getEditors()[0]';

  await cmd('toggle-explorer');
  check('explorateur déplié', await js('!document.getElementById("fileExplorer").classList.contains("collapsed")'));
  await cmd('select-folder');
  await waitFor(() => js('document.querySelectorAll("#fileList .file-item").length > 0'), 5000, 'liste des fichiers');
  check('boîte « Choisir un dossier » demandée au main', dialogCalls === 1, dialogCalls);
  const names = await js('[...document.querySelectorAll("#fileList .file-item")].map(x => x.getAttribute("data-name")).sort()');
  check('fichiers du dossier listés', JSON.stringify(names) === JSON.stringify(['a.js', 'gros.txt', 'image.bin', 'latin.txt', 'notes.md']), names);

  await openFile('a.js');
  await waitFor(() => js(`${ed}.getValue() === "const a = 1;\\n"`), 5000, 'contenu de a.js').catch(() => false);
  check('a.js ouvert : contenu affiché dans Monaco', await js(`${ed}.getValue()`) === 'const a = 1;\n');
  check('a.js : langage JavaScript, modifiable', await js(`${ed}.getModel().getLanguageId() === "javascript" && !${ed}.getOption(monaco.editor.EditorOption.readOnly)`));
  check('a.js : nom affiché et fichier surligné', await js('document.getElementById("activeFileName").textContent === "a.js" && document.querySelector("#fileList .file-item.active").getAttribute("data-name") === "a.js"'));

  // Saisie au clavier en fin de fichier, puis Ctrl+S (raccourci de Monaco).
  await js(`${ed}.focus(); ${ed}.setPosition({ lineNumber: 2, column: 1 }); true`);
  await typeText('a++;');
  check('saisie au clavier dans Monaco', await js(`${ed}.getValue()`) === 'const a = 1;\na++;', await js(`${ed}.getValue()`));
  await clearToasts();
  await ctrlS();
  check('Ctrl+S : « Fichier enregistré ! »', await waitToast(/Fichier enregistré/, 'toast enregistrement'));
  check('Ctrl+S : contenu écrit sur le disque', disk('a.js').toString('utf8') === 'const a = 1;\na++;', disk('a.js').toString('utf8'));

  await openFile('notes.md');
  await waitFor(() => js(`${ed}.getValue() === "# Notes\\n"`), 5000, 'notes.md').catch(() => false);
  check('notes.md : langage Markdown', await js(`${ed}.getModel().getLanguageId()`) === 'markdown');

  // Non UTF-8 : affiché en lecture seule, jamais réenregistré.
  await clearToasts();
  await openFile('latin.txt');
  check('latin.txt : avertissement « lecture seule »', await waitToast(/lecture seule/, 'toast latin'));
  check('latin.txt : Monaco en lecture seule, texte brut', await js(`${ed}.getOption(monaco.editor.EditorOption.readOnly) && ${ed}.getModel().getLanguageId() === "plaintext"`));
  await clearToasts();
  await js(`${ed}.focus(); true`);
  await ctrlS();
  check('latin.txt : Ctrl+S refusé avec explication', await waitToast(/lecture seule/, 'toast refus'));
  check('latin.txt : fichier intact sur le disque', disk('latin.txt').equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])));

  // Trop gros / binaire : refusés, le fichier ouvert reste le précédent.
  await clearToasts();
  await openFile('gros.txt');
  check('gros.txt : refusé, taille et limite indiquées', await waitToast(/trop volumineux.*20 Mo/, 'toast gros'));
  await clearToasts();
  await openFile('image.bin');
  check('image.bin : refusé (fichier binaire)', await waitToast(/binaire/, 'toast binaire'));
  check('après un refus : le fichier ouvert reste latin.txt', await js('document.getElementById("activeFileName").textContent') === 'latin.txt');

  // Retour sur a.js : de nouveau modifiable.
  await openFile('a.js');
  await waitFor(() => js(`!${ed}.getOption(monaco.editor.EditorOption.readOnly)`), 5000, 'a.js modifiable').catch(() => false);
  check('a.js rouvert : de nouveau modifiable', await js(`${ed}.getValue() === "const a = 1;\\na++;" && !${ed}.getOption(monaco.editor.EditorOption.readOnly)`));

  await cmd('toggle-ide');
  check('panneau éditeur replié', await js('document.getElementById("idePanel").classList.contains("collapsed")'));
  await cmd('toggle-ide');
  check('panneau rouvert : toujours une seule instance de Monaco', await js('monaco.editor.getEditors().length === 1'));

  // ===== 2. Éditeur de secours (loader.js de Monaco bloqué) =====
  // La fenêtre principale utilise la session par défaut ; le main n'y pose
  // aucun filtre webRequest : celui-ci ne sert qu'au test.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: /\/monaco-editor\/min\/vs\/loader\.js$/.test(details.url) });
  });
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await waitFor(() => js('!!document.querySelector("#accountsList > *")'), 10000, 'rechargement');
  await cmd('toggle-ide');
  const fallback = await waitFor(() => js('!!document.getElementById("fallbackEditor")'), 10000, 'éditeur de secours').catch(() => false);
  check('Monaco indisponible : éditeur de secours affiché', fallback && await js('typeof monaco === "undefined"'));
  check('secours : bandeau « Éditeur simplifié » avec icône', await js('/Éditeur simplifié/.test(document.getElementById("monacoContainer").textContent) && !!document.querySelector("#monacoContainer .ic svg")'));
  check('secours : désactivé tant qu\'aucun fichier n\'est ouvert', await js('document.getElementById("fallbackEditor").disabled'));

  // Le dossier reste autorisé côté main, mais la liste de l'interface est
  // vide après rechargement : on le rouvre comme l'utilisateur.
  await cmd('toggle-explorer');
  await cmd('select-folder');
  await waitFor(() => js('document.querySelectorAll("#fileList .file-item").length > 0'), 5000, 'liste des fichiers (secours)');
  await openFile('a.js');
  await waitFor(() => js('document.getElementById("fallbackEditor").value.length > 0'), 5000, 'a.js (secours)').catch(() => false);
  check('secours : a.js ouvert et modifiable', await js('(() => { const t = document.getElementById("fallbackEditor"); return t.value === "const a = 1;\\na++;" && !t.disabled && !t.readOnly; })()'));

  await js('(() => { const t = document.getElementById("fallbackEditor"); t.focus(); t.selectionStart = t.selectionEnd = t.value.length; return true; })()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await delay(100);
  await typeText('b;');
  check('secours : Tab insère deux espaces, saisie au clavier', await js('document.getElementById("fallbackEditor").value') === 'const a = 1;\na++;  b;', await js('document.getElementById("fallbackEditor").value'));
  await clearToasts();
  await ctrlS();
  check('secours : Ctrl+S enregistre', await waitToast(/Fichier enregistré/, 'toast secours'));
  check('secours : contenu écrit sur le disque', disk('a.js').toString('utf8') === 'const a = 1;\na++;  b;', disk('a.js').toString('utf8'));

  await clearToasts();
  await openFile('latin.txt');
  check('secours : latin.txt en lecture seule', await waitToast(/lecture seule/, 'toast latin secours') && await js('document.getElementById("fallbackEditor").readOnly'));
  await clearToasts();
  await js('document.getElementById("fallbackEditor").focus(); true');
  await ctrlS();
  check('secours : Ctrl+S refusé sur latin.txt, fichier intact', await waitToast(/lecture seule/, 'refus secours') && disk('latin.txt').equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])));

  session.defaultSession.webRequest.onBeforeRequest(null);
  // Seules erreurs attendues : l'échec voulu du chargement de loader.js.
  const unexpected = consoleErrors.filter(m => !/loader\.js|ERR_BLOCKED_BY_CLIENT/.test(m));
  check('aucune erreur inattendue dans la console de l\'interface', unexpected.length === 0, unexpected);
});
