// ===== [OVCR] AI Manager — interface (renderer) =====
//
// Script de la page hôte (index.html). Depuis la phase 1 de sécurisation, la
// page tourne SANS Node.js : nodeIntegration: false, contextIsolation: true,
// sandbox. Tout accès au disque ou au stockage des comptes passe par l'API
// minimale exposée par app-preload.js sous window.ovcr, validée côté
// processus principal. Script externe (et non inline) pour que la CSP de
// index.html puisse interdire tout script inline.
//
// Depuis la phase 3 (P6), ce fichier ne contient plus que l'enchaînement du
// démarrage, la délégation des clics et le tick des cooldowns. Le reste est
// dans des scripts CLASSIQUES chargés avant lui par index.html, qui partagent
// l'espace de noms window.OVCR et ne font rien tant qu'app.js ne les appelle
// pas (sauf core.js, qui installe les diagnostics dès son chargement) :
//   core.js           OVCR, état partagé (OVCR.state), escapeHtml, toasts,
//                     diagnostics, écran d'échec du démarrage ;
//   diagnostics-ui.js aide « Comprendre les IA » et section Diagnostic ;
//   editor.js         éditeur de fichiers (Monaco à la demande, secours) ;
//   layout.js         préférences d'affichage, replis, colonnes ;
//   storage-ui.js     stockage des comptes, mode protégé, récupération ;
//   transfer-ui.js    export / import des comptes (fenêtres, choix des conflits) ;
//   accounts-ui.js    liste des comptes, cooldowns, palette, fenêtres ;
//   panes.js          panneaux de service (webviews, erreurs, vue scindée).
// Fonctions pures testées sous Node : cooldowns.js, pane-errors.js.

// Socle de l'interface (renderer/core.js, chargé juste avant ce script) :
// espace de noms window.OVCR (état partagé, escapeHtml, showToast,
// diagnostics, écran d'échec du démarrage). Absent (installation abîmée) :
// message explicite plutôt qu'une interface muette.
if (typeof OVCR === 'undefined') {
  document.body.innerHTML = '<div style="margin:auto; padding:32px; color:#ff4d6a; font-family:sans-serif;">Erreur interne : le fichier renderer/core.js n\'est pas chargé. Réinstallez l\'application.</div>';
  throw new Error('renderer/core.js non chargé');
}

// === Démarrage ===
// L'application démarre IMMÉDIATEMENT et NE DÉPEND PAS de Monaco : l'éditeur
// est chargé à la demande, et reste optionnel (renderer/editor.js).
initApp().catch(err => {
  console.error('[app] démarrage :', err);
  OVCR.showStartupError(err);
});

async function initApp() {
  const { showToast } = OVCR;
  // État partagé (renderer/core.js) : comptes, mode protégé, panneaux…
  const state = OVCR.state;

  // Pont vers le processus principal (app-preload.js). S'il manque, l'app ne
  // peut ni lire ni enregistrer les comptes : on le dit au lieu d'échouer en
  // silence (et surtout sans rien écraser).
  const api = window.ovcr;
  if (!api) {
    document.body.innerHTML = '<div style="margin:auto; padding:32px; color:#ff4d6a; font-family:sans-serif;">Erreur interne : le pont sécurisé (preload) n\'est pas chargé. Réinstallez l\'application.</div>';
    return;
  }
  // Toasts accessibles aux gestionnaires d'erreurs globaux (définis hors initApp).
  window.__ovcrToast = (msg, type) => showToast(msg, type);

  // Modules locaux chargés par index.html avant ce script. Absents (fichier
  // manquant dans une installation abîmée) : écran d'erreur de démarrage.
  const CD = window.OVCRCooldowns;
  if (!CD) throw new Error('module renderer/cooldowns.js non chargé');

  const SERVICES = [
    { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', cssClass: 'svc-claude' },
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', cssClass: 'svc-chatgpt' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', cssClass: 'svc-gemini' },
    { id: 'zeta', name: 'Z.ai', url: 'https://chat.z.ai/', cssClass: 'svc-zeta' },
    { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', cssClass: 'svc-perplexity' },
    { id: 'grok', name: 'Grok', url: 'https://grok.com/', cssClass: 'svc-grok' },
    { id: 'leonardo', name: 'Leonardo AI', url: 'https://app.leonardo.ai/', cssClass: 'svc-leonardo' },
    { id: 'suno', name: 'Suno', url: 'https://suno.com/create', cssClass: 'svc-suno' },
    { id: 'meshy', name: 'Meshy AI', url: 'https://www.meshy.ai/workspace', cssClass: 'svc-meshy' }
  ];

  // Icônes statiques du HTML (chantier D) : on remplit les <span class="ic">.
  hydrateIcons(document);

  // Stockage des comptes (renderer/storage-ui.js) : enregistrement, mode
  // protégé et bandeaux, chargement initial (et migration depuis la 1.0.4),
  // retour arrière vers la 1.0.4, réparation des comptes, récupération d'une
  // liste illisible. renderAccounts n'existe qu'un peu plus bas : passé par
  // une fonction, appelée seulement après le démarrage (comme avant).
  const storage = OVCR.storageUi.init({ api, SERVICES, renderAccounts: () => renderAccounts() });
  const { saveAccounts, ensureWritable, migrateOldAccounts, showRecoveryUI } = storage;

  // Retour arrière demandé (--revert-storage-migration) : comptes réécrits au
  // format 1.0.4, l'application se ferme ; le démarrage s'arrête ici.
  if (await storage.handlePendingRevert()) return;

  // Chargement initial tolérant : ne plante jamais (mode protégé au besoin).
  await storage.loadInitial();

  // Préférences d'affichage (renderer/layout.js) : largeurs des colonnes et
  // repli des cartes, dans le localStorage, versionnées. Créées seulement
  // ici, après le retour arrière éventuel (qui ne doit pas les écrire). Au
  // premier lancement en app:// (1.9.0), reprises de l'ancien file://.
  await OVCR.layout.importLegacyPrefs(api);
  const prefs = OVCR.layout.createPrefs();

  // Liste des comptes (renderer/accounts-ui.js) : cartes et repli, statistiques,
  // cooldowns, palette Ctrl+K, fenêtres d'ajout / modification / suppression.
  // Définit les fonctions window.* correspondantes (boutons, délégation).
  const accountsUi = OVCR.accountsUi.init({ SERVICES, CD, prefs, saveAccounts, ensureWritable });
  const { renderAccounts, saveCollapsed, refreshCooldownLabels } = accountsUi;

  migrateOldAccounts();

  // Éditeur de fichiers (renderer/editor.js) : Monaco chargé à la demande,
  // éditeur de secours, ouverture d'un dossier et des fichiers, Ctrl+S.
  // Définit selectLocalFolder et loadFileInEditor (appelées par les boutons).
  OVCR.editor.init({ api });

  // Panneaux de service (renderer/panes.js) : vue simple / scindée, ouverture
  // d'un service, webview et écrans d'erreur, bandeau « hors ligne »,
  // fermeture. Définit setLayout, openService et closePane2.
  OVCR.panes.init({ api, SERVICES, renderAccounts, saveCollapsed });

  // Mise en page (renderer/layout.js) : définit toggleDashboard, toggleExplorer
  // et toggleIdePanel (boutons), et le redimensionnement des colonnes.
  const layout = OVCR.layout.init({ prefs });

  // Aide « Comprendre les IA disponibles » et section Diagnostic
  // (renderer/diagnostics-ui.js) : définit openHelpModal, closeHelpModal,
  // showDiagnostic, copyDiagnostic, openLogsFolder, resetSitePermissions.
  OVCR.diagnosticsUi.init({ api, SERVICES });

  // Export / import des comptes (renderer/transfer-ui.js) : définit
  // exportAccounts et importAccounts (boutons de l'en-tête des comptes).
  OVCR.transferUi.init({ api, renderAccounts, ensureWritable, migrateOldAccounts });

  layout.setupResizers();

  // --- Délégation d'événements (chantier A) ---
  // Les listes rendues dynamiquement (comptes, palette, fichiers) n'ont plus
  // d'attributs onclick. On écoute UN seul clic sur chaque conteneur STABLE et
  // on lit l'action + les identifiants dans les data-*. Le vecteur d'injection
  // (valeur utilisateur interpolée dans un onclick) disparaît complètement.
  document.getElementById('accountsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const accId = btn.getAttribute('data-acc');
    const svcId = btn.getAttribute('data-svc');
    switch (btn.getAttribute('data-action')) {
      case 'add':             openModal(); break;
      case 'open-service':    openService(accId, svcId); break;
      case 'toggle-cooldown': toggleCooldown(accId, svcId); break;
      case 'edit':            openModal(accId); break;
      case 'delete':          openDeleteModal(accId); break;
      case 'toggle-collapse': toggleCardCollapse(accId); break;
    }
  });

  document.getElementById('paletteResults').addEventListener('click', (e) => {
    const item = e.target.closest('[data-acc]');
    if (!item) return;
    openService(item.getAttribute('data-acc'), item.getAttribute('data-svc'));
    document.getElementById('paletteOverlay').classList.remove('open');
  });

  document.getElementById('fileList').addEventListener('click', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    loadFileInEditor(item.getAttribute('data-path'), item.getAttribute('data-name'), item);
  });

  // Boutons STATIQUES de index.html : plus aucun attribut onclick/oninput (la
  // CSP interdit tout script inline). Chacun porte data-cmd, lu ici.
  const COMMANDS = {
    'toggle-dashboard': () => toggleDashboard(),
    'toggle-all-cards': () => toggleAllCards(),
    'add-account':      () => openModal(),
    'toggle-explorer':  () => toggleExplorer(),
    'toggle-ide':       () => toggleIdePanel(),
    'open-help':        () => openHelpModal(),
    'close-help':       () => closeHelpModal(),
    'close-pane2':      () => closePane2(),
    'layout':           (el) => setLayout(Number(el.getAttribute('data-layout')) === 2 ? 2 : 1, el),
    'select-folder':    () => selectLocalFolder(),
    'close-modal':      () => closeModal(),
    'save-account':     () => saveAccount(),
    'close-delete':     () => closeDeleteModal(),
    'confirm-delete':   () => confirmDelete(),
    'reset-permissions': () => resetSitePermissions(),
    'show-diagnostic':  () => showDiagnostic(),
    'copy-diagnostic':  () => copyDiagnostic(),
    'open-logs':        () => openLogsFolder(),
    'export-accounts':  () => exportAccounts(),
    'import-accounts':  () => importAccounts()
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cmd]');
    if (!el) return;
    const cmd = COMMANDS[el.getAttribute('data-cmd')];
    if (cmd) cmd(el);
  });
  document.getElementById('paletteInput').addEventListener('input', () => filterPalette());

  // Tick cooldowns (1 s). Les échéances ne sont plus remises à 0 à
  // l'expiration : un cooldown fini reste « terminé à HH:MM » pendant 24 h
  // (information utile), puis redevient « non suivi » — sans écriture disque.
  //   - un ÉTAT change (actif -> terminé = réactivation automatique, terminé ->
  //     non suivi) : rendu complet (réactive le bouton de service), lag ≤ 1 s ;
  //   - sinon, au changement de minute : libellés seuls (textContent), bien
  //     moins cher qu'un rendu complet.
  // Coût d'un tick sans changement : calcul de la signature des états (µs).
  let lastCdMinute = Math.floor(Date.now() / 60000);
  let lastCdSignature = CD.signature(state.accounts, Date.now());
  setInterval(() => {
    const now = Date.now();
    const sig = CD.signature(state.accounts, now);
    const minute = Math.floor(now / 60000);
    if (sig !== lastCdSignature) renderAccounts();
    else if (minute !== lastCdMinute) refreshCooldownLabels();
    lastCdSignature = sig;
    lastCdMinute = minute;
  }, 1000);

  renderAccounts();

  // Vérification au démarrage : échéances incohérentes (horloge changée ou
  // donnée invalide) signalées dans le journal ; l'utilisateur les voit sur
  // les boutons (« ⚠ Échéance incohérente ») et peut les réinitialiser.
  (() => {
    const now = Date.now();
    let inconsistent = 0, active = 0;
    state.accounts.forEach(acc => Object.values(acc.cooldowns || {}).forEach(end => {
      const s = CD.state(end, now);
      if (s === 'inconsistent') inconsistent++;
      else if (s === 'active') active++;
    }));
    if (inconsistent) console.warn(`[cooldowns] ${inconsistent} échéance(s) incohérente(s) au démarrage (horloge de l'ordinateur modifiée ?)`);
    else if (active) console.log(`[cooldowns] ${active} cooldown(s) actif(s) au démarrage`);
  })();

  // Récupération des données (chantier C) : si ai_accounts était illisible au
  // démarrage, on propose de restaurer la sauvegarde plutôt que de perdre en
  // silence les comptes de l'utilisateur.
  if (state.dataCorrupt) showRecoveryUI();
}
