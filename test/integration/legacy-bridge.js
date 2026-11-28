// Intégration — pont vers l'ancien localStorage file:// (legacy-storage.js,
// phase 3 P5). Vrai Electron : une page file:// « ancienne interface » écrit
// des clés, le pont (fenêtre cachée) les relit, les écrit, les efface.
// Toutes les pages file:// partagent la même origine de stockage.

const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const { scenario, ROOT } = require('./harness');
const LS = require(path.join(ROOT, 'legacy-storage.js'));

// BrowserWindow espionné : options reçues, fenêtres du pont ouvertes en même
// temps, visibilité. Options relevées AVANT le constructeur : Electron
// complète ensuite l'objet reçu (show y passe à true sans rien afficher).
const spy = { created: 0, open: 0, maxOpen: 0, shown: 0, visible: 0, prefs: [] };
class SpyWindow extends BrowserWindow {
  constructor(opts) {
    const asked = { show: opts.show, ...opts.webPreferences };
    super(opts);
    spy.created++; spy.open++; spy.maxOpen = Math.max(spy.maxOpen, spy.open);
    spy.prefs.push(asked);
    this.on('show', () => spy.shown++);
    this.webContents.once('did-finish-load', () => { if (!this.isDestroyed() && this.isVisible()) spy.visible++; });
    this.on('closed', () => spy.open--);
  }
}

scenario('Pont file:// : lecture, écriture, effacement de l\'ancien localStorage', {}, async ({ win, js, check, tmp, delay, consoleErrors }) => {
  const logs = [];
  const bridge = LS.createLegacyStorageBridge({ BrowserWindow: SpyWindow, log: m => logs.push(m) });

  // « Ancienne interface » : une autre page file:// (ailleurs sur le disque).
  const oldPage = path.join(tmp, 'ancienne-interface.html');
  fs.writeFileSync(oldPage, '<!doctype html><meta charset="utf-8"><title>ancienne</title>');
  const old = new BrowserWindow({ show: false });
  await old.loadFile(oldPage);
  const oldJs = code => old.webContents.executeJavaScript(code);
  await oldJs(`localStorage.setItem('ai_accounts', '[{"id":"acc_1"}]'); localStorage.setItem('ide_w', '412px'); localStorage.setItem('autre', 'garde'); true`);

  // L'interface (app://ovcr depuis la 1.9.0) a son propre localStorage.
  const uiProtocol = await js('location.protocol');
  check('interface en app://', uiProtocol === 'app:', uiProtocol);
  await js(`localStorage.setItem('explorer_w', '199px'); true`);

  const read = await bridge.read([...LS.LEGACY_KEYS]);
  check('lecture : valeurs écrites par une autre page file://', read.ai_accounts === '[{"id":"acc_1"}]' && read.ide_w === '412px', read);
  check('lecture : clé absente -> null', read.ai_accounts_backup === null && read.explorer_w === null, read);
  check('lecture : stockage de l\'interface app:// invisible depuis le pont', read.explorer_w === null && read.prefs_schema === null, read);
  check('lecture : stockage file:// invisible depuis l\'interface app://', await js('localStorage.getItem("ide_w") === null && localStorage.getItem("ai_accounts") === null'));
  check('lecture : seulement les clés demandées', Object.keys(read).sort().join() === [...LS.LEGACY_KEYS].sort().join(), Object.keys(read));

  await bridge.write({ collapsed_accounts: '["acc_9"]', ai_accounts_backup: 'copie' });
  check('écriture : visible depuis l\'ancienne page', await oldJs(`localStorage.getItem('collapsed_accounts') === '["acc_9"]' && localStorage.getItem('ai_accounts_backup') === 'copie'`));
  check('écriture : sans effet sur l\'interface app://', await js('localStorage.getItem("collapsed_accounts")') !== '["acc_9"]');

  await bridge.remove(['ai_accounts', 'ai_accounts_backup']);
  check('effacement : clés retirées', await oldJs(`localStorage.getItem('ai_accounts') === null && localStorage.getItem('ai_accounts_backup') === null`));
  check('effacement : clé hors liste intacte', await oldJs(`localStorage.getItem('autre')`) === 'garde');

  // Refus AVANT toute fenêtre : clés hors liste, valeurs non textuelles.
  const before = spy.created;
  const refused = [];
  for (const [label, call] of [
    ['clé hors liste (lecture)', () => bridge.read(['autre'])],
    ['liste vide', () => bridge.read([])],
    ['clé hors liste (écriture)', () => bridge.write({ autre: 'x' })],
    ['valeur non textuelle', () => bridge.write({ ide_w: 300 })],
    ['valeur trop longue', () => bridge.write({ ide_w: 'x'.repeat(LS.MAX_VALUE_LENGTH + 1) })],
    ['clé hors liste (effacement)', () => bridge.remove(['__proto__'])]
  ]) {
    try { await call(); } catch (e) { refused.push(label); }
  }
  check('refus : clés hors liste et valeurs invalides', refused.length === 6, refused);
  check('refus : aucune fenêtre ouverte pour une demande refusée', spy.created === before, spy.created - before);
  check('lecture sans effet : clé hors liste jamais lue', await oldJs(`localStorage.getItem('autre')`) === 'garde');

  // Opérations simultanées : une seule fenêtre du pont à la fois.
  spy.maxOpen = spy.open;
  const many = await Promise.all([1, 2, 3, 4, 5].map(i => bridge.write({ ide_w: i + 'px' }).then(() => bridge.read(['ide_w']))));
  check('opérations simultanées : une seule fenêtre du pont à la fois', spy.maxOpen === 1, spy.maxOpen);
  check('opérations simultanées : exécutées dans l\'ordre', (await bridge.read(['ide_w'])).ide_w === '5px', many);

  // Fenêtre du pont : cachée, sans preload, isolée, refermée.
  await delay(100);
  check('fenêtres du pont jamais affichées', spy.shown === 0 && spy.visible === 0 && spy.prefs.every(p => p.show === false), { shown: spy.shown, visible: spy.visible, show: spy.prefs.map(p => p.show) });
  check('fenêtres du pont : sans preload, isolées, sans Node', spy.prefs.every(p => !p.preload && p.sandbox === true && p.contextIsolation === true && p.nodeIntegration === false), spy.prefs[0]);
  check('fenêtres du pont toutes refermées', spy.open === 0 && BrowserWindow.getAllWindows().length === 2, { open: spy.open, all: BrowserWindow.getAllWindows().length });

  // Page absente, délai dépassé : erreur tracée, le pont reste utilisable.
  const missing = LS.createLegacyStorageBridge({ BrowserWindow: SpyWindow, pagePath: path.join(tmp, 'absente.html'), log: m => logs.push(m) });
  const e1 = await missing.read(['ide_w']).then(() => null, e => e.message);
  check('page du pont absente : erreur', !!e1, e1);
  const slow = LS.createLegacyStorageBridge({ BrowserWindow: SpyWindow, timeoutMs: 1, log: m => logs.push(m) });
  const e2 = await slow.read(['ide_w']).then(() => null, e => e.message);
  check('délai dépassé : erreur explicite', /délai dépassé/.test(e2 || ''), e2);
  check('échecs tracés (sans valeur)', logs.length === 2 && logs.every(l => /^\[legacy-storage\] lecture impossible/.test(l)) && !logs.join().includes('5px'), logs);
  check('après un échec, le pont fonctionne encore', (await bridge.read(['ide_w'])).ide_w === '5px');
  await delay(200);
  check('aucune fenêtre du pont restée ouverte après les échecs', spy.open === 0, spy.open);

  check('page du pont : aucun script', !/<script/i.test(fs.readFileSync(LS.PAGE_PATH, 'utf8')));
  old.destroy();
  void win;
  check('aucune erreur dans la console de l\'interface', consoleErrors.length === 0, consoleErrors);
});
