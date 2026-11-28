// Intégration — cooldowns dans l'interface (lot 5).

const path = require('path');
const fs = require('fs');
const { scenario, plainEnvelope, sampleAccount } = require('./harness');

const H = 3600 * 1000;
let seededAt;

scenario('Cooldowns : états, confirmation, persistance, réactivation automatique', {
  seed(dir) {
    seededAt = Date.now();
    fs.writeFileSync(path.join(dir, 'accounts.json'), plainEnvelope([sampleAccount(1, {
      services: ['claude', 'chatgpt', 'gemini', 'zeta', 'perplexity'],
      cooldowns: {
        claude: seededAt + 2 * H,        // actif
        chatgpt: seededAt - 1 * H,       // terminé il y a 1 h
        gemini: seededAt + 48 * H,       // incohérent (horloge reculée)
        zeta: seededAt + 25000,          // se termine pendant le test
        perplexity: 0                    // non suivi
      }
    })]));
  }
}, async ({ js, check, waitFor, delay, userData, win }) => {
  const btn = sid => js(`(() => { const b = document.querySelector('[data-action="toggle-cooldown"][data-svc="${sid}"]'); return { text: b.textContent, state: b.getAttribute('data-cd-state'), title: b.title, svcExhausted: document.querySelector('[data-action="open-service"][data-svc="${sid}"]').classList.contains('cooldown-active') }; })()`);
  const stored = async sid => (await js('ovcr.accounts.load()')).accounts[0].cooldowns[sid];
  const click = sid => js(`document.querySelector('[data-action="toggle-cooldown"][data-svc="${sid}"]').click(); true`);

  // --- États affichés
  const a = await btn('claude');
  check('actif : décompte « ⏳ 1h 5xm » / 2h, service grisé', /^⏳ (1h 5\dm|2h 00m)$/.test(a.text) && a.state === 'active' && a.svcExhausted, a);
  check('actif : infobulle « marqué manuellement » avec heure de fin', /manuellement/.test(a.title) && /fin prévue/.test(a.title), a.title);
  const e = await btn('chatgpt');
  check('terminé : « ✓ Fini HH:MM », service réactivé', /^✓ Fini (hier )?\d\d:\d\d$/.test(e.text) && e.state === 'ended' && !e.svcExhausted, e);
  const i = await btn('gemini');
  check('incohérent : signalé sur le bouton', i.text === '⚠ Échéance incohérente' && i.state === 'inconsistent', i);
  const u = await btn('perplexity');
  check('non suivi : libellé historique « Épuiser (24h) »', u.text === 'Épuiser (24h)' && u.state === 'unknown', u);
  check('statistique renommée « Hors cooldown »', await js('[...document.querySelectorAll(".stat-card__label")].some(l => l.textContent === "Hors cooldown")'));
  // 9 services (complétés au démarrage) dont claude, gemini et zeta épuisés -> 6.
  check('statistique : services hors cooldown comptés', await js('document.getElementById("statAvailable").textContent') === '6');

  // --- Annulation d'un cooldown actif : confirmation en deux clics
  await click('claude');
  const c1 = await btn('claude');
  check('1er clic sur un cooldown actif : demande de confirmation', c1.text === 'Confirmer ?', c1);
  check('rien n\'est modifié avant confirmation', (await stored('claude')) > Date.now());
  // Expiration prévue à 5,05 s. La fenêtre de test n'est jamais au premier
  // plan : Chromium y aligne les minuteries sur la seconde, d'où une marge
  // d'attente (sans elle, ce contrôle échouait environ une fois sur quatre).
  await delay(5400);
  const expired = await waitFor(async () => /^⏳/.test((await btn('claude')).text), 2000, 'expiration de la confirmation').catch(() => false);
  check('sans 2e clic : la confirmation expire, cooldown intact', expired);
  await click('claude');
  await click('claude');
  await delay(300);
  check('2 clics : cooldown annulé (non suivi)', (await btn('claude')).state === 'unknown' && (await stored('claude')) === 0);

  // --- Marquer : non suivi -> actif 24 h ; terminé -> actif sans confirmation
  const before = Date.now();
  await click('perplexity');
  await delay(300);
  const p = await stored('perplexity');
  check('« Épuiser » : échéance à +24 h (timestamp UTC enregistré)', p - before >= 24 * H - 1000 && p - before <= 24 * H + 2000, p - before);
  await click('chatgpt');
  await delay(300);
  check('cooldown terminé : un clic le relance directement', (await btn('chatgpt')).state === 'active');

  // --- Incohérent : réinitialisation avec confirmation
  await click('gemini');
  check('incohérent : confirmation demandée', (await btn('gemini')).text === 'Confirmer ?');
  await click('gemini');
  await delay(300);
  check('incohérent : réinitialisé', (await stored('gemini')) === 0);

  // --- Réactivation automatique à l'échéance (zeta)
  check('zeta encore actif', (await btn('zeta')).state === 'active');
  await waitFor(async () => (await btn('zeta')).state === 'ended', 35000, 'fin du cooldown zeta');
  const z = await btn('zeta');
  check('réactivation automatique : terminé, service de nouveau utilisable', z.state === 'ended' && !z.svcExhausted, z);
  check('échéance conservée sur disque (pas remise à 0)', (await stored('zeta')) > 0);

  // --- Persistance après fermeture/réouverture de l'interface
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await waitFor(() => js('!!document.querySelector(\'[data-action="toggle-cooldown"]\')'), 10000, 'rechargement');
  check('après rechargement : états conservés', (await btn('perplexity')).state === 'active' && (await btn('chatgpt')).state === 'active' && (await btn('claude')).state === 'unknown');

  // --- M8 : avertissement quand on change le profil d'un compte existant
  const warn = () => js('!document.getElementById("profileWarning").hidden');
  await js(`openModal('acc_1'); true`);
  check('édition : pas d\'avertissement si le profil est inchangé', !(await warn()));
  await js(`const i = document.getElementById('inputProfile'); i.value = 'profil_autre'; i.dispatchEvent(new Event('input')); true`);
  check('édition : avertissement si le profil change', await warn());
  await js(`closeModal(); openModal(); true`);
  check('création : jamais d\'avertissement', !(await warn()));
  await js('closeModal(); true');

  const log = fs.readFileSync(path.join(userData, 'logs', 'ovcr.log'), 'utf8');
  check('vérification au démarrage : incohérence signalée dans le journal', /échéance\(s\) incohérente\(s\) au démarrage/.test(log));
});
