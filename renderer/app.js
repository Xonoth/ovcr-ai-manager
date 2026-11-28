// ===== [OVCR] AI Manager — interface (renderer) =====
//
// Script de la page hôte (index.html). Depuis la phase 1 de sécurisation, la
// page tourne SANS Node.js : nodeIntegration: false, contextIsolation: true,
// sandbox. Tout accès au disque ou au stockage des comptes passe par l'API
// minimale exposée par app-preload.js sous window.ovcr, validée côté
// processus principal. Script externe (et non inline) pour que la CSP de
// index.html puisse interdire tout script inline.

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
  const { escapeHtml, showToast } = OVCR;
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

  const COLORS = ['#8b5cf6','#f230aa','#c4b5fd','#a855f7','#5865f2','#ec4899','#38bdf8','#f97316'];

  // Icônes statiques du HTML (chantier D) : on remplit les <span class="ic">.
  hydrateIcons(document);

  // === Stockage résilient des comptes (chantier C, puis phase 1 sécurité) ===
  // La liste des comptes est tenue par le processus principal (accounts-store.js),
  // chiffrée avec safeStorage, avec une génération de sauvegarde avant chaque
  // écrasement. Le renderer ne garde que la copie de travail en mémoire.
  // Anciennes clés localStorage de la 1.0.4 (migrées puis effacées au 1er lancement).
  const LEGACY_STORE_KEY = 'ai_accounts';
  const LEGACY_BACKUP_KEY = 'ai_accounts_backup';

  function legacyGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { console.warn('[storage] localStorage illisible :', e.message); return null; }
  }

  // Enregistre la liste de comptes. L'envoi est IMMÉDIAT et porte un
  // instantané de la liste au moment de l'appel ; le processus principal
  // traite les écritures une par une, dans l'ordre d'arrivée, valide les
  // données et conserve la génération précédente en sauvegarde. Il retarde
  // aussi la fermeture de l'app tant qu'une écriture est en cours.
  //
  // Écritures BLOQUÉES tant que l'état du stockage est inconnu (lecture des
  // comptes en échec) : enregistrer la liste vide affichée écraserait les vrais
  // comptes (audit phase 2, C2). Un échec d'enregistrement laisse un bandeau
  // persistant (et non un simple toast de 3 s) avec « Réessayer » (M5).
  let saveSeq = 0;
  function saveAccounts(list) {
    if (!state.storageWritable) {
      console.warn('[storage] écriture ignorée : comptes non chargés');
      return false;
    }
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(list)); }
    catch (e) { console.error('[storage] liste de comptes non sérialisable :', e); return false; }
    const seq = ++saveSeq;
    const failed = (detail) => {
      console.error('[storage] échec écriture des comptes :', detail);
      // Seul l'échec de la DERNIÈRE écriture compte (une plus récente qui a
      // réussi contient déjà tout).
      if (seq === saveSeq) {
        showStorageBanner('save-failed',
          'Le dernier enregistrement des comptes a échoué' + (detail && typeof detail === 'string' ? ' (' + detail + ')' : '')
          + ' : vos dernières modifications ne sont pas encore sauvegardées.',
          'Réessayer', () => saveAccounts(state.accounts));
      }
    };
    api.accounts.save(snapshot)
      .then(res => {
        if (!res || !res.ok) failed(res && res.error);
        else if (seq === saveSeq) hideStorageBanner('save-failed');
      })
      .catch(e => failed(e && e.message));
    return true;
  }

  // Refuse une modification (avec explication) si le stockage n'est pas sûr.
  function ensureWritable() {
    if (state.storageWritable) return true;
    const why = {
      newer: 'comptes enregistrés par une version plus récente (lecture seule)',
      migration_failed: 'mise à jour du format des comptes non aboutie (lecture seule)'
    }[state.bannerKind] || 'comptes non chargés, utilisez « Réessayer »';
    showToast('Modification impossible pour ne rien écraser : ' + why + '.', 'error');
    return false;
  }

  // Bandeau d'alerte persistant (un seul à la fois ; id = nature du problème).
  function showStorageBanner(kind, message, actionLabel, action) {
    let el = document.getElementById('storageBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'storageBanner';
      el.className = 'app-banner';
      el.setAttribute('role', 'alert');
      document.body.appendChild(el);
    }
    state.bannerKind = kind;
    el.textContent = '';
    const text = document.createElement('span');
    text.textContent = message; // textContent : aucune interprétation HTML
    el.appendChild(text);
    if (actionLabel && action) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = actionLabel;
      btn.addEventListener('click', action);
      el.appendChild(btn);
    }
    el.hidden = false;
  }
  function hideStorageBanner(kind) {
    const el = document.getElementById('storageBanner');
    if (el && (!kind || state.bannerKind === kind)) { el.hidden = true; state.bannerKind = null; }
  }

  // Copie de secours lue directement (migration impossible) : jamais validée
  // par le main -> on ne garde que des objets et on force des textes.
  function normalizeLegacyList(parsed) {
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(a => a && typeof a === 'object' && !Array.isArray(a) && typeof a.id === 'string' && a.profile != null)
      .map(a => ({
        ...a,
        name: String(a.name == null ? '' : a.name),
        email: String(a.email == null ? '' : a.email),
        profile: String(a.profile),
        cooldowns: a.cooldowns && typeof a.cooldowns === 'object' && !Array.isArray(a.cooldowns) ? a.cooldowns : {}
      }));
  }

  // Fondation réutilisable pour une future fonctionnalité d'export/import JSON
  // (ne pas coder le backup « en dur » : ces deux fonctions serviront à l'UI).
  // eslint-disable-next-line no-unused-vars -- fondation documentée pour une future UI d'export
  function exportAccountsJSON() { return JSON.stringify(state.accounts, null, 2); }
  // eslint-disable-next-line no-unused-vars -- fondation documentée pour une future UI d'import
  function importAccountsJSON(text) {
    if (!state.storageWritable) throw new Error('Comptes non chargés : import impossible.');
    const parsed = JSON.parse(text); // peut throw : l'appelant (UI) gère l'erreur
    if (!Array.isArray(parsed)) throw new Error('Format invalide : un tableau de comptes est attendu.');
    state.accounts = parsed;
    migrateOldAccounts();  // complète/répare les comptes importés
    saveAccounts(state.accounts);
    renderAccounts();
    return state.accounts.length;
  }

  // Retour arrière demandé (lancement avec --revert-storage-migration) : on
  // réécrit les comptes dans le localStorage au format 1.0.4, le processus
  // principal met ses fichiers de côté puis ferme l'app.
  const revert = await api.storage.pendingRevert().catch(e => {
    console.error('[storage] vérification du retour arrière impossible :', e);
    return null;
  });
  if (revert) {
    if (revert.ok) {
      try {
        if (revert.current != null) localStorage.setItem(LEGACY_STORE_KEY, revert.current);
        if (revert.backup != null) localStorage.setItem(LEGACY_BACKUP_KEY, revert.backup);
        const done = await api.storage.confirmRevert();
        document.body.innerHTML = '<div style="margin:auto; padding:32px; font-family:sans-serif; color:#ece6f4;">'
          + (done && done.ok ? 'Comptes réécrits au format 1.0.4. Fermeture…' : 'Retour arrière impossible : ' + escapeHtml(done && done.error)) + '</div>';
      } catch (e) {
        console.error('[storage] retour arrière impossible :', e);
      }
      return;
    }
    console.warn('[storage] retour arrière ignoré :', revert.error);
  }

  // Chargement initial tolérant : l'app ne plante JAMAIS au démarrage, même si
  // les comptes sont illisibles (le cas échéant on propose la restauration plus bas).
  try {
    state.loadResult = await api.accounts.load();
    // Premier lancement après la 1.0.4 : migration depuis le localStorage.
    if (state.loadResult.status === 'empty') {
      const legacy = legacyGet(LEGACY_STORE_KEY);
      const legacyBackup = legacyGet(LEGACY_BACKUP_KEY);
      if (legacy != null || legacyBackup != null) {
        const m = await api.accounts.migrateLegacy({ current: legacy, backup: legacyBackup });
        if (m && m.ok) {
          // Copie chiffrée vérifiée côté main (+ sauvegarde préalable dans
          // backups/) : la copie en clair peut disparaître.
          try { localStorage.removeItem(LEGACY_STORE_KEY); localStorage.removeItem(LEGACY_BACKUP_KEY); }
          catch (e) { console.warn('[storage] ancienne copie en clair non effacée (sera ignorée) :', e.message); }
          console.log('[storage] comptes migrés depuis localStorage (chiffrement : ' + m.encrypted + ')');
          state.loadResult = await api.accounts.load();
        } else {
          // Migration impossible : on travaille sur l'ancienne copie (non
          // effacée) ; la prochaine écriture créera le nouveau stockage.
          console.error('[storage] migration impossible :', m && m.error);
          showToast('Migration du stockage des comptes impossible : ancienne copie conservée.', 'warning');
          let list = null;
          try { list = normalizeLegacyList(JSON.parse(legacy)); }
          catch (e) { console.warn('[storage] ancienne copie illisible, liste vide (rien n\'est écrasé) :', e.message); }
          if (list) state.loadResult = { status: 'ok', accounts: list };
        }
      }
    }
    applyLoadResult(state.loadResult);
  } catch (e) {
    console.error('[storage] lecture des comptes impossible :', e);
    applyLoadResult(null);
  }

  // Interprète la réponse de api.accounts.load(). Tout état non reconnu
  // (exception IPC, réponse inattendue) passe en mode protégé : liste vide
  // affichée MAIS écritures bloquées, bandeau avec « Réessayer ».
  function applyLoadResult(res) {
    state.loadResult = res;
    state.dataCorrupt = false;
    const status = res && res.status;
    if (status === 'ok' && Array.isArray(res.accounts)) {
      state.accounts = res.accounts;
      state.storageWritable = true;
      if (res.migrated) console.log(`[storage] données mises à jour (schéma ${res.migrated.from} -> ${res.migrated.to}), sauvegarde : ${res.migrated.backupFile}`);
    } else if ((status === 'newer' || status === 'migration_failed') && Array.isArray(res.accounts)) {
      // Comptes affichés et utilisables (ouvrir un service), mais JAMAIS
      // réécrits : données d'une version plus récente de l'app, ou mise à
      // jour des données qui n'a pas abouti (données d'origine intactes).
      state.accounts = res.accounts;
      state.storageWritable = false;
      showStorageBanner(status,
        status === 'newer'
          ? 'Ces comptes ont été enregistrés par une version plus récente de l\'application. Lecture seule : mettez l\'application à jour pour les modifier.'
          : 'La mise à jour du format des comptes a échoué. Vos données d\'origine sont intactes ; l\'application les affiche en lecture seule.');
    } else if (status === 'empty') {
      state.accounts = [];
      state.storageWritable = true;
    } else if (status === 'corrupt' || status === 'undecryptable' || status === 'missing') {
      // État connu : l'utilisateur choisit (restaurer ou continuer). Les
      // écritures restent possibles : le main met de côté le fichier illisible
      // et une copie de la sauvegarde avant toute rotation.
      state.accounts = [];
      state.dataCorrupt = true;
      state.storageWritable = true;
    } else {
      state.accounts = [];
      state.storageWritable = false;
      showStorageBanner('load-failed',
        'Les comptes n\'ont pas pu être chargés. Les modifications sont désactivées pour ne rien écraser.',
        'Réessayer', retryLoadAccounts);
    }
  }

  async function retryLoadAccounts() {
    let res = null;
    try { res = await api.accounts.load(); }
    catch (e) { console.error('[storage] nouvelle lecture impossible :', e); }
    applyLoadResult(res);
    if (!state.storageWritable) { showToast('Toujours impossible de charger les comptes.', 'error'); return; }
    hideStorageBanner('load-failed');
    migrateOldAccounts();
    renderAccounts();
    if (state.dataCorrupt) showRecoveryUI();
    else showToast('Comptes chargés');
  }

  // === Préférences d'affichage (localStorage, non sensibles) ===
  // Clés : ide_w, explorer_w (largeurs « 123px »), collapsed_accounts (ids).
  // Versionnées par `prefs_schema` (absent = 1). Une valeur invalide est
  // ignorée (retour au défaut), jamais bloquante. Si les préférences viennent
  // d'une version plus récente, on les lit mais on ne les réécrit pas.
  // Une préférence non enregistrée n'est pas grave (seulement l'affichage) :
  // on le signale dans la console, sans alerter l'utilisateur.
  const PREFS_SCHEMA = 1;
  const prefs = (() => {
    let readOnly = false;
    try {
      const stored = localStorage.getItem('prefs_schema');
      const v = stored == null ? 1 : Number(stored);
      if (!Number.isInteger(v) || v > PREFS_SCHEMA) {
        readOnly = true;
        console.warn('[prefs] préférences d\'une version plus récente (schéma ' + stored + ') : lues, non réécrites');
      } else if (stored == null) {
        localStorage.setItem('prefs_schema', String(PREFS_SCHEMA));
      }
    } catch (e) {
      readOnly = true;
      console.warn('[prefs] localStorage indisponible, préférences par défaut :', e.message);
    }
    return {
      get(key) {
        try { return localStorage.getItem(key); }
        catch (e) { console.warn('[prefs] lecture impossible :', key, e.message); return null; }
      },
      set(key, value) {
        if (readOnly) return;
        try { localStorage.setItem(key, value); }
        catch (e) { console.warn('[prefs] préférence non enregistrée :', key, e.message); }
      },
      // Largeur mémorisée : « <nombre>px » raisonnable, sinon null.
      width(key) {
        const v = this.get(key);
        if (v == null) return null;
        if (/^\d{2,5}px$/.test(v)) return v;
        console.warn('[prefs] largeur invalide ignorée :', key);
        return null;
      }
    };
  })();

  // Vue compacte : ids des comptes dont la grille de services est repliée.
  // Une valeur absente/illisible retombe sur le défaut = tout déplié.
  const COLLAPSED_KEY = 'collapsed_accounts';
  try {
    const saved = JSON.parse(prefs.get(COLLAPSED_KEY) || '[]');
    if (Array.isArray(saved)) state.collapsedAccounts = new Set(saved.filter(x => typeof x === 'string'));
  } catch (e) { console.warn('[prefs] états de repli ignorés :', e.message); }

  // Écrit l'état de repli en purgeant les ids de comptes supprimés
  // (la clé ne grossit pas indéfiniment au fil des suppressions).
  function saveCollapsed() {
    state.collapsedAccounts = new Set([...state.collapsedAccounts].filter(id => state.accounts.some(a => a.id === id)));
    prefs.set(COLLAPSED_KEY, JSON.stringify([...state.collapsedAccounts]));
  }

  window.toggleCardCollapse = function(accId) {
    if (!state.accounts.some(a => a.id === accId)) return; // garde : id obsolète
    if (state.collapsedAccounts.has(accId)) state.collapsedAccounts.delete(accId);
    else state.collapsedAccounts.add(accId);
    saveCollapsed();
    renderAccounts();
  }

  // Bascule globale : s'il reste au moins une carte dépliée on replie tout,
  // sinon on déplie tout. Idempotent sur les cartes déjà dans l'état cible.
  window.toggleAllCards = function() {
    if (state.accounts.length === 0) return;
    const anyExpanded = state.accounts.some(a => !state.collapsedAccounts.has(a.id));
    if (anyExpanded) state.accounts.forEach(a => state.collapsedAccounts.add(a.id));
    else state.collapsedAccounts.clear();
    saveCollapsed();
    renderAccounts();
  }

  // Migration : convertit les anciens comptes et garantit que chaque compte
  // possède TOUS les services + un cooldown pour chacun (répare aussi les
  // comptes enregistrés qui n'avaient pas encore Perplexity/Zeta).
  function migrateOldAccounts() {
    let needsUpdate = false;
    const ALL_SERVICES = SERVICES.map(s => s.id);
    state.accounts.forEach(acc => {
      if (!Array.isArray(acc.services)) { acc.services = [...ALL_SERVICES]; needsUpdate = true; }
      if (acc.quotas && !acc.cooldowns) { delete acc.quotas; needsUpdate = true; }
      if (!acc.cooldowns) { acc.cooldowns = {}; needsUpdate = true; }
      ALL_SERVICES.forEach(sid => {
        if (!acc.services.includes(sid)) { acc.services.push(sid); needsUpdate = true; }
        if (acc.cooldowns[sid] === undefined) { acc.cooldowns[sid] = 0; needsUpdate = true; }
      });
    });
    // Profil vide ou invalide (accepté sans contrôle par la 1.0.4) : le main
    // refuse alors d'enregistrer TOUTE la liste, et ce compte ne pouvait de
    // toute façon ouvrir aucun service (partition « persist: » vide refusée).
    // On lui attribue le premier profil libre, et on le dit (audit phase 2).
    const used = new Set(state.accounts.map(a => a.profile));
    state.accounts.forEach(acc => {
      const p = typeof acc.profile === 'string' ? acc.profile : '';
      if (p && p.length <= 200 && !/[\u0000-\u001f\u007f]/.test(p)) return;
      let n = 1;
      while (used.has('profil_' + n)) n++;
      acc.profile = 'profil_' + n;
      used.add(acc.profile);
      needsUpdate = true;
      console.warn('[storage] profil invalide remplacé pour le compte', acc.id);
      showToast(`Le compte « ${acc.name} » n'avait pas de profil valide : « ${acc.profile} » lui a été attribué.`, 'warning');
    });
    if (needsUpdate) saveAccounts(state.accounts);
  }
  migrateOldAccounts();

  // Éditeur de fichiers (renderer/editor.js) : Monaco chargé à la demande,
  // éditeur de secours, ouverture d'un dossier et des fichiers, Ctrl+S.
  // Définit selectLocalFolder et loadFileInEditor (appelées par les boutons).
  OVCR.editor.init({ api });

  // Rendu
  function renderAccounts() {
    const container = document.getElementById('accountsList');
    if (state.accounts.length === 0) {
      // État vide : appel à l'action pour créer un premier compte. Le bouton
      // porte data-action="add" -> géré par la délégation (aucun onclick, aucune
      // donnée utilisateur ici de toute façon).
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--fg-dim); display:flex; flex-direction:column; align-items:center; gap:16px;">
          <div>Aucun compte pour l'instant.</div>
          <button class="btn btn--primary" data-action="add"><span class="ic" data-icon="plus"></span> Créer mon premier compte</button>
        </div>`;
      hydrateIcons(container);
      updateStats(); // remet les stats à 0 (ex. après suppression du dernier compte)
      return;
    }

    container.innerHTML = state.accounts.map((acc, idx) => {
      // Toute donnée issue du compte (nom, email, profil, couleur) est saisie
      // par l'utilisateur -> échappée avant injection (chantier A).
      const initials = escapeHtml(String(acc.name).slice(0, 2).toUpperCase());
      const color = escapeHtml(acc.color || COLORS[idx % COLORS.length]);
      const id = escapeHtml(acc.id);
      const isActive = acc.id === state.activeAccountId;
      const isCollapsed = state.collapsedAccounts.has(acc.id);
      // Résumé « N/9 » de la carte repliée : même test que updateStats
      // (renderer/cooldowns.js) -> toujours synchro avec le tick des cooldowns.
      const now = Date.now();
      const availCount = acc.services.filter(sid => CD.isAvailable(acc.cooldowns[sid], now)).length;

      const servicesHtml = acc.services.map(sid => {
        const svc = SERVICES.find(s => s.id === sid);
        if (!svc) return '';
        const v = CD.view(acc.cooldowns[sid], now);
        const pending = isResetPending(acc.id, sid);
        const exhausted = v.state === 'active' || v.state === 'inconsistent';
        const btnClass = exhausted ? `${svc.cssClass} cooldown-active` : svc.cssClass;
        const cdBtnClass = 'cooldown-btn' + (exhausted ? ' active' : '') + (v.state === 'ended' ? ' ended' : '')
          + (v.state === 'inconsistent' ? ' inconsistent' : '') + (pending ? ' confirming' : '');
        const cdText = pending ? 'Confirmer ?' : v.text;
        const cdTitle = pending ? 'Cliquer de nouveau pour annuler ce cooldown (sinon rien ne change).' : v.title;
        // svc.id vient de SERVICES (valeurs sûres codées en dur). Les actions
        // passent par des data-* lus par la délégation d'événements (chantier A) :
        // plus aucune donnée n'est injectée dans un attribut onclick.
        return `
          <div class="service-column">
            <button class="svc-btn ${btnClass}" data-action="open-service" data-acc="${id}" data-svc="${svc.id}">${escapeHtml(svc.name)}</button>
            <button class="${cdBtnClass}" data-action="toggle-cooldown" data-acc="${id}" data-svc="${svc.id}" data-cd-state="${v.state}" title="${escapeHtml(cdTitle)}">${escapeHtml(cdText)}</button>
          </div>
        `;
      }).join('');

      // Le header entier bascule le repli (data-action="toggle-collapse") :
      // les boutons éditer/supprimer imbriqués portent leur propre data-action,
      // que closest() résout en priorité -> aucun conflit de clic.
      return `
        <div class="account-card ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}">
          <div class="account-header" data-action="toggle-collapse" data-acc="${id}">
            <div class="account-avatar" style="background:${color}">${initials}</div>
            <div class="account-info">
              <div class="account-name">${escapeHtml(acc.name)} ${isActive ? '<span class="active-dot"></span>' : ''}</div>
              <div class="account-email">${escapeHtml(acc.email)} • ${escapeHtml(acc.profile)}</div>
            </div>
            <div class="account-actions">
              <button class="btn btn--icon" data-action="edit" data-acc="${id}"><span class="ic" data-icon="pen"></span></button>
              <button class="btn btn--icon" data-action="delete" data-acc="${id}"><span class="ic" data-icon="trash" style="color:var(--danger)"></span></button>
            </div>
            <span class="svc-summary ${availCount < acc.services.length ? 'has-cd' : ''}" title="${availCount} service(s) hors cooldown sur ${acc.services.length}">${availCount}/${acc.services.length}</span>
            <span class="ic collapse-chevron" data-icon="chevron-down" title="Replier / déplier"></span>
          </div>
          <div class="services-wrap"><div class="services-inner">
            <div class="services-grid">${servicesHtml}</div>
          </div></div>
        </div>
      `;
    }).join('');
    hydrateIcons(container); // remplit les icônes SVG des boutons éditer/supprimer
    updateStats();
  }

  function updateStats() {
    let activeAccounts = 0, availableIAs = 0;
    const now = Date.now();
    state.accounts.forEach(acc => {
      let hasAvailable = false;
      acc.services.forEach(sid => {
        if (CD.isAvailable(acc.cooldowns[sid], now)) { availableIAs++; hasAvailable = true; }
      });
      if (hasAvailable) activeAccounts++;
    });
    document.getElementById('statActive').textContent = activeAccounts;
    document.getElementById('statAvailable').textContent = availableIAs;
    // Oriente le chevron du bouton « Tout replier / déplier » selon l'état
    // global (appelé dans les deux branches de renderAccounts, y c. liste vide).
    const allBtn = document.getElementById('btnToggleAllCards');
    if (allBtn) allBtn.classList.toggle('all-collapsed', state.accounts.length > 0 && state.accounts.every(a => state.collapsedAccounts.has(a.id)));
  }

  // Annulation d'un cooldown actif (ou incohérent) en DEUX clics : le 1er arme
  // une confirmation sur le bouton pendant 5 s, le 2e annule. Évite qu'un clic
  // accidentel efface l'information (audit phase 2, E5).
  const RESET_CONFIRM_MS = 5000;
  const pendingResets = new Map(); // "accId|svcId" -> échéance de la confirmation
  const isResetPending = (accId, svcId) => (pendingResets.get(accId + '|' + svcId) || 0) > Date.now();

  // Layout
  window.setLayout = function(mode, btn) {
    state.layoutMode = mode;
    document.querySelectorAll('.workspace-header .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const pane2 = document.getElementById('pane2');
    const resizerPane = document.getElementById('resizerPane');
    const pane1 = document.getElementById('pane1');
    if (mode === 2) {
      pane2.classList.add('active');
      if (resizerPane) resizerPane.style.display = 'block';
    } else {
      pane2.classList.remove('active');
      state.activePaneId = 1;
      if (resizerPane) resizerPane.style.display = 'none';
      if (pane1) pane1.style.flex = '1'; // on rend toute la largeur au panneau unique
    }
  }

  window.toggleDashboard = function() {
    const dash = document.getElementById('dashboard');
    const btnShow = document.getElementById('btnShowDashboard');
    dash.classList.toggle('collapsed');
    btnShow.style.display = dash.classList.contains('collapsed') ? 'flex' : 'none';
  }

  window.toggleExplorer = function() { document.getElementById('fileExplorer').classList.toggle('collapsed'); }
  window.toggleIdePanel = function() {
    const p = document.getElementById('idePanel');
    p.classList.toggle('collapsed');
    // Monaco paresseux : chargé à la 1re OUVERTURE du panneau éditeur.
    if (!p.classList.contains('collapsed')) OVCR.editor.ensureMonacoLoaded();
  }

  window.openService = function(accId, svcId) {
    const acc = state.accounts.find(a => a.id === accId);
    const svc = SERVICES.find(s => s.id === svcId);
    if (!acc || !svc) return;

    state.activeAccountId = accId;
    // Ouvrir un service (carte OU palette Ctrl+K) déplie la carte concernée :
    // confirmation visuelle du compte utilisé même si elle était repliée.
    if (state.collapsedAccounts.has(accId)) { state.collapsedAccounts.delete(accId); saveCollapsed(); }
    renderAccounts();

    // Vue scindée : un panneau VIDE est toujours servi en priorité (cas
    // typique : panneau 2 fermé via « Fermer le panneau 2 » -> le prochain
    // service le remplit au lieu d'écraser le panneau 1). Quand les deux
    // panneaux sont occupés, l'alternance habituelle continue.
    if (state.layoutMode === 2) {
      const p1Full = !!document.querySelector('#pane1 webview');
      const p2Full = !!document.querySelector('#pane2 webview');
      if (p1Full && !p2Full) state.activePaneId = 2;
      else if (!p1Full && p2Full) state.activePaneId = 1;
    }

    const pane = document.getElementById(`pane${state.activePaneId}`);
    mountService(pane, acc, svc);

    if (state.layoutMode === 2) {
      state.activePaneId = state.activePaneId === 1 ? 2 : 1;
    }
    updateClosePane2Btn();
    showToast(`${svc.name} ouvert avec ${acc.name}`);
  }

  // === Panneau de service : webview + chargement + écran d'erreur (lot 4) ===
  // Tout est recréé à chaque montage : pane.innerHTML='' détruit l'ancienne
  // <webview> (le processus invité Chromium est libéré) et, avec elle, ses
  // écouteurs. Un remontage (« Recharger le service ») recrée la webview sur
  // la MÊME partition persist:<profil> : la session de connexion est conservée.
  const PE = window.OVCRPaneErrors;
  function mountService(pane, acc, svc) {
    pane.innerHTML = '';
    pane.dataset.acc = acc.id;
    pane.dataset.svc = svc.id;
    const paneNo = pane.id === 'pane2' ? 2 : 1;

    // Feedback de chargement : spinner + nom du service/compte le temps que la
    // page charge. L'animation CSS ne vit que tant que l'overlay est visible.
    const loading = document.createElement('div');
    loading.className = 'pane-loading';
    loading.innerHTML = `<div class="pane-spinner"></div><span>Connexion à ${escapeHtml(svc.name)} — ${escapeHtml(acc.name)}…</span>`;
    pane.appendChild(loading);

    const webview = document.createElement('webview');
    webview.setAttribute('partition', `persist:${acc.profile}`);
    webview.setAttribute('src', svc.url);
    webview.setAttribute('allowpopups', '');
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.flex = '1 1 0'; // laisse la place au bandeau « hors ligne » éventuel
    webview.style.minHeight = '0';
    pane.appendChild(webview);

    let failed = false;          // un échec est affiché pour la navigation en cours
    let errorBox = null;
    let lastFailure = null;      // { kind, code, description, host, at }
    const showLoading = () => { loading.hidden = false; };
    const hideLoading = () => { loading.hidden = true; };
    // Filet de 10 s si aucun événement ne vient (webview morte) : on ne
    // masque jamais le panneau indéfiniment.
    const safety = setTimeout(hideLoading, 10000);

    function hideError() {
      if (errorBox) { errorBox.remove(); errorBox = null; }
    }

    function showError(info, actions) {
      hideLoading();
      hideError();
      lastFailure = { ...info, service: svc.id, account: acc.id, at: new Date().toLocaleTimeString() };
      console.warn('[panneau]', info.kind, info.code !== undefined ? 'code ' + info.code : '', info.host || '', 'service', svc.id, 'compte', acc.id);
      errorBox = document.createElement('div');
      errorBox.className = 'pane-error';
      errorBox.setAttribute('role', 'alert');
      const icon = document.createElement('span');
      icon.className = 'ic pane-error__icon';
      icon.setAttribute('data-icon', 'triangle-exclamation');
      const title = document.createElement('div');
      title.className = 'pane-error__title';
      title.textContent = info.title;
      const detail = document.createElement('div');
      detail.className = 'pane-error__detail';
      detail.textContent = info.detail;
      const meta = document.createElement('div');
      meta.className = 'pane-error__meta';
      meta.textContent = `${svc.name} — ${acc.name}`;
      const bar = document.createElement('div');
      bar.className = 'pane-error__actions';
      const diagBox = document.createElement('pre');
      diagBox.className = 'pane-error__diag';
      diagBox.hidden = true;
      const all = [...actions, ['Informations de diagnostic', () => {
        diagBox.textContent = [
          `Problème : ${lastFailure.kind}`,
          lastFailure.code !== undefined ? `Code : ${lastFailure.code}${lastFailure.description ? ' (' + lastFailure.description + ')' : ''}` : null,
          lastFailure.host ? `Site : ${lastFailure.host}` : null,
          `Service : ${svc.id} · panneau ${paneNo}`,
          `Connexion Internet : ${navigator.onLine ? 'oui' : 'non'}`,
          `Heure : ${lastFailure.at}`
        ].filter(Boolean).join('\n');
        diagBox.hidden = !diagBox.hidden;
      }]];
      all.forEach(([label, fn], i) => {
        const b = document.createElement('button');
        b.className = i === 0 ? 'btn btn--primary' : 'btn';
        b.textContent = label;
        b.addEventListener('click', fn);
        bar.appendChild(b);
      });
      errorBox.append(icon, title, detail, meta, bar, diagBox);
      hydrateIcons(errorBox);
      pane.appendChild(errorBox);
    }

    const retry = (url) => {
      failed = false;
      hideError();
      showLoading();
      webview.loadURL(url || svc.url).catch(e => console.warn('[panneau] nouvel essai :', e && e.message));
    };
    const remount = () => mountService(pane, acc, svc);
    const openInBrowser = () => api.services.openInBrowser(svc.url).then(ok => {
      if (ok) showToast(`${svc.name} ouvert dans votre navigateur (hors de l'application, sans la session de ce compte)`, 'warning');
      else showToast('Ouverture dans le navigateur impossible', 'error');
    }).catch(e => { console.error('[panneau] navigateur :', e && e.message); showToast('Ouverture dans le navigateur impossible', 'error'); });
    const close = () => closePane(paneNo);

    webview.addEventListener('did-start-loading', () => { if (!failed) showLoading(); });
    webview.addEventListener('dom-ready', () => { clearTimeout(safety); hideLoading(); });
    webview.addEventListener('did-stop-loading', hideLoading);

    webview.addEventListener('did-fail-load', (e) => {
      if (!PE || !PE.isRelevantFailure(e.errorCode, e.isMainFrame)) return;
      failed = true;
      const info = PE.classifyLoadError(e.errorCode, navigator.onLine);
      const url = e.validatedURL;
      showError({ ...info, code: e.errorCode, description: e.errorDescription, host: PE.hostOf(url) }, [
        ['Réessayer', () => retry(url)],
        ['Recharger le service', remount],
        ['Ouvrir dans le navigateur', openInBrowser],
        ['Fermer le panneau', close]
      ]);
    });

    webview.addEventListener('render-process-gone', (e) => {
      const d = e.details || e;
      if (d.reason === 'clean-exit') return;
      failed = true;
      showError({ ...(PE ? PE.classifyCrash(d.reason) : { kind: 'crashed', title: 'Le panneau s\'est arrêté', detail: '' }), code: d.exitCode, description: d.reason }, [
        ['Recharger le service', remount],
        ['Ouvrir dans le navigateur', openInBrowser],
        ['Fermer le panneau', close]
      ]);
    });

    webview.addEventListener('unresponsive', () => {
      showError(PE ? PE.unresponsive() : { kind: 'unresponsive', title: 'Le service ne répond plus', detail: '' }, [
        ['Attendre', hideError],
        ['Recharger le service', remount],
        ['Fermer le panneau', close]
      ]);
    });
    webview.addEventListener('responsive', () => {
      if (errorBox && lastFailure && lastFailure.kind === 'unresponsive') hideError();
    });

    updateOfflineStrip(pane);
  }

  // Bandeau discret « hors ligne » en haut des panneaux ouverts : une page déjà
  // chargée peut rester utilisable un moment, on ne la masque donc pas.
  function updateOfflineStrip(pane) {
    let strip = pane.querySelector('.pane-offline');
    const show = !navigator.onLine && !!pane.querySelector('webview');
    if (show && !strip) {
      strip = document.createElement('div');
      strip.className = 'pane-offline';
      strip.textContent = 'Hors ligne : ce panneau ne peut plus joindre le service. Il se mettra à jour au retour de la connexion (ou rechargez-le).';
      pane.prepend(strip);
    } else if (!show && strip) {
      strip.remove();
    }
  }
  const updateAllOfflineStrips = () => ['pane1', 'pane2'].forEach(id => updateOfflineStrip(document.getElementById(id)));
  window.addEventListener('offline', () => { console.warn('[réseau] connexion perdue'); updateAllOfflineStrips(); });
  window.addEventListener('online', () => { console.log('[réseau] connexion rétablie'); updateAllOfflineStrips(); });

  // Ferme un panneau (bouton « Fermer le panneau 2 » ou écran d'erreur).
  function closePane(n) {
    const pane = document.getElementById(`pane${n}`);
    if (!pane || !pane.querySelector('webview')) return false;
    // innerHTML='' détruit la <webview> -> Electron tue le process invité
    // Chromium et libère sa mémoire. On restaure le placeholder d'origine.
    pane.innerHTML = `<div class="pane-empty"><span class="ic" data-icon="robot"></span><span>Panneau ${n} vide</span></div>`;
    delete pane.dataset.acc;
    delete pane.dataset.svc;
    hydrateIcons(pane);
    // (openService re-ciblera de lui-même un panneau vide en vue scindée.)
    updateClosePane2Btn();
    return true;
  }

  // Bouton « Fermer le panneau 2 » : affiché seulement si une webview vit dans
  // le panneau 2 (même cachée en vue simple — c'est justement le cas où elle
  // consomme de la RAM en arrière-plan sans être visible).
  function updateClosePane2Btn() {
    const btn = document.getElementById('btnClosePane2');
    if (btn) btn.style.display = document.querySelector('#pane2 webview') ? '' : 'none';
  }

  window.closePane2 = function() {
    if (closePane(2)) showToast('Panneau 2 fermé (mémoire libérée)');
  }

  // Palette
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('paletteOverlay').classList.add('open');
      document.getElementById('paletteInput').focus();
      filterPalette();
    }
    if (e.key === 'Escape') {
      document.getElementById('paletteOverlay').classList.remove('open');
      document.getElementById('accountModal').classList.remove('open');
      document.getElementById('deleteModal').classList.remove('open');
      document.getElementById('helpModal').classList.remove('open');
    }
    if (e.key === 'Enter' && document.getElementById('paletteOverlay').classList.contains('open')) {
      e.preventDefault();
      const sel = document.querySelector('.palette-item.selected');
      if (sel) sel.click();
    }
  });

  window.filterPalette = function() {
    const query = document.getElementById('paletteInput').value.toLowerCase();
    const results = document.getElementById('paletteResults');
    let items = [];
    state.accounts.forEach(acc => {
      if (acc.name.toLowerCase().includes(query) || acc.email.toLowerCase().includes(query)) {
        acc.services.forEach(sid => {
          const svc = SERVICES.find(s => s.id === sid);
          if (svc) items.push({ acc, svc });
        });
      }
    });
    results.innerHTML = items.map((item, idx) => `
      <div class="palette-item ${idx === 0 ? 'selected' : ''}" data-acc="${escapeHtml(item.acc.id)}" data-svc="${escapeHtml(item.svc.id)}">
        <div class="account-avatar" style="background:${escapeHtml(item.acc.color)}; width:24px; height:24px; font-size:10px;">${escapeHtml(String(item.acc.name).slice(0,2))}</div>
        <span>${escapeHtml(item.acc.name)} - ${escapeHtml(item.svc.name)}</span>
      </div>
    `).join('');
  }

  // Modals
  window.openModal = function(accId = null) {
    const modal = document.getElementById('accountModal');
    const title = document.getElementById('modalTitle');
    const profileInput = document.getElementById('inputProfile');
    const acc = accId ? state.accounts.find(a => a.id === accId) : null;
    if (accId && !acc) return; // garde : id obsolète
    if (acc) {
      title.textContent = "Modifier le compte";
      document.getElementById('editId').value = acc.id;
      document.getElementById('inputName').value = acc.name;
      document.getElementById('inputEmail').value = acc.email;
      profileInput.value = acc.profile;
      profileInput.dataset.original = acc.profile;
    } else {
      delete profileInput.dataset.original;
      title.textContent = "Ajouter un compte";
      document.getElementById('editId').value = '';
      document.getElementById('inputName').value = '';
      document.getElementById('inputEmail').value = '';
      // Suggère un profil NON collisionnant (`length+1` pouvait re-proposer un
      // profil déjà pris après une suppression -> sessions partagées).
      const used = new Set(state.accounts.map(a => a.profile));
      let n = state.accounts.length + 1;
      while (used.has('profil_' + n)) n++;
      document.getElementById('inputProfile').value = 'profil_' + n;
    }
    updateProfileWarning();
    modal.classList.add('open');
  }

  // Modifier le profil d'un compte EXISTANT change sa partition de cookies
  // (persist:<profil>) : sans avertissement, les sessions semblaient perdues
  // (audit phase 2, M8). Simple information, rien n'est bloqué.
  function updateProfileWarning() {
    const input = document.getElementById('inputProfile');
    const original = input.dataset.original;
    document.getElementById('profileWarning').hidden = original === undefined || input.value.trim() === original;
  }
  document.getElementById('inputProfile').addEventListener('input', updateProfileWarning);
  window.closeModal = function() { document.getElementById('accountModal').classList.remove('open'); }

  // Aide « Comprendre les IA disponibles » et section Diagnostic
  // (renderer/diagnostics-ui.js) : définit openHelpModal, closeHelpModal,
  // showDiagnostic, copyDiagnostic, openLogsFolder, resetSitePermissions.
  OVCR.diagnosticsUi.init({ api, SERVICES });

  // Suppression de compte
  window.openDeleteModal = function(accId) {
    const acc = state.accounts.find(a => a.id === accId);
    if (!acc) return;
    document.getElementById('deleteId').value = accId;
    document.getElementById('deleteDesc').textContent =
      `Supprimer « ${acc.name} » (${acc.email}) ? La session restera stockée sur le disque, mais le compte disparaîtra de la liste.`;
    document.getElementById('deleteModal').classList.add('open');
  }
  window.closeDeleteModal = function() { document.getElementById('deleteModal').classList.remove('open'); }
  window.confirmDelete = function() {
    if (!ensureWritable()) return;
    const id = document.getElementById('deleteId').value;
    state.accounts = state.accounts.filter(a => a.id !== id);
    if (state.activeAccountId === id) state.activeAccountId = null;
    saveCollapsed();        // purge l'état de repli du compte supprimé
    saveAccounts(state.accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
    closeDeleteModal();
    showToast('Compte supprimé');
  }

  window.saveAccount = function() {
    if (!ensureWritable()) return;
    const id = document.getElementById('editId').value;
    const name = document.getElementById('inputName').value.trim();
    const email = document.getElementById('inputEmail').value.trim();
    const profile = document.getElementById('inputProfile').value.trim();
    if (!name || !email || !profile) return showToast('Remplissez tous les champs', 'error');

    // Unicité du profil (chantier audit 3.1) : deux comptes partageant le même
    // `profile` utiliseraient la MÊME partition Electron (persist:<profile>) →
    // cookies/sessions mêlés entre comptes. On refuse la collision.
    if (state.accounts.some(a => a.id !== id && a.profile === profile)) {
      return showToast('Ce profil est déjà utilisé par un autre compte (les sessions seraient partagées).', 'error');
    }

    if (id) {
      const acc = state.accounts.find(a => a.id === id);
      if (!acc) return; // garde : id obsolète
      Object.assign(acc, { name, email, profile });
      showToast('Compte mis à jour');
    } else {
      state.accounts.push({
        id: 'acc_' + Date.now(), name, email, profile,
        color: COLORS[state.accounts.length % COLORS.length],
        services: SERVICES.map(s => s.id),
        cooldowns: Object.fromEntries(SERVICES.map(s => [s.id, 0]))
      });
      showToast('Compte ajouté');
    }
    saveAccounts(state.accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
    closeModal();
  }

  window.toggleCooldown = function(accId, svcId) {
    const acc = state.accounts.find(a => a.id === accId);
    if (!acc) return; // garde : id obsolète (chantier audit 3.7)
    if (!ensureWritable()) return;
    const now = Date.now();
    const key = accId + '|' + svcId;
    const v = CD.view(acc.cooldowns[svcId], now);
    if (v.confirmToChange) {
      // Cooldown actif ou incohérent : 1er clic = demande de confirmation.
      if (!isResetPending(accId, svcId)) {
        pendingResets.set(key, now + RESET_CONFIRM_MS);
        renderAccounts();
        setTimeout(() => { if (!isResetPending(accId, svcId) && pendingResets.delete(key)) renderAccounts(); }, RESET_CONFIRM_MS + 50);
        return;
      }
      pendingResets.delete(key);
      acc.cooldowns[svcId] = 0; // annulé : de nouveau « non suivi »
      console.log('[cooldowns] annulé', v.state === 'inconsistent' ? '(échéance incohérente)' : '', 'compte', accId, 'service', svcId);
    } else {
      // Non suivi ou terminé : marqué épuisé, rappel dans 24 h.
      acc.cooldowns[svcId] = CD.newEnd(now);
    }
    saveAccounts(state.accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
  }

  // Colonnes redimensionnables à la souris
  function setupResizers() {
    const overlay = document.getElementById('resizeOverlay');
    const idePanel = document.getElementById('idePanel');
    const fileExplorer = document.getElementById('fileExplorer');
    const pane1 = document.getElementById('pane1');

    // On lève les limites CSS qui empêcheraient d'agrandir/réduire librement.
    idePanel.style.maxWidth = 'none';
    idePanel.style.minWidth = '0';
    fileExplorer.style.maxWidth = 'none';
    fileExplorer.style.minWidth = '0';

    // Restaure les largeurs mémorisées (via flex-basis = taille exacte).
    // Lecture défensive (chantier C) : une valeur absente/illisible ne doit
    // jamais empêcher l'app de démarrer — on retombe simplement sur le défaut.
    const savedIde = prefs.width('ide_w');
    if (savedIde) idePanel.style.flex = '0 0 ' + savedIde;
    const savedExp = prefs.width('explorer_w');
    if (savedExp) fileExplorer.style.flex = '0 0 ' + savedExp;

    function makeResizer(resizer, opts) {
      if (!resizer) return;
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startSize = opts.getStart();
        resizer.classList.add('dragging');
        overlay.classList.add('active');
        document.body.style.userSelect = 'none';

        function move(ev) {
          const max = typeof opts.max === 'function' ? opts.max() : opts.max;
          let next = startSize + (ev.clientX - startX);
          next = Math.max(opts.min, Math.min(max, next));
          opts.apply(next);
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          resizer.classList.remove('dragging');
          overlay.classList.remove('active');
          document.body.style.userSelect = '';
          if (opts.onEnd) opts.onEnd();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }

    // Éditeur (largeur du panneau IDE) ↔ panneaux IA
    makeResizer(document.getElementById('resizerIde'), {
      el: idePanel,
      getStart: () => idePanel.getBoundingClientRect().width,
      min: 260,
      max: () => document.querySelector('.workspace-body').getBoundingClientRect().width - 320,
      apply: (w) => { idePanel.style.flex = '0 0 ' + w + 'px'; },
      onEnd: () => prefs.set('ide_w', Math.round(idePanel.getBoundingClientRect().width) + 'px')
    });

    // Explorateur de fichiers ↔ éditeur
    makeResizer(document.getElementById('resizerExplorer'), {
      el: fileExplorer,
      getStart: () => fileExplorer.getBoundingClientRect().width,
      min: 120,
      max: () => idePanel.getBoundingClientRect().width - 160,
      apply: (w) => { fileExplorer.style.flex = '0 0 ' + w + 'px'; },
      onEnd: () => prefs.set('explorer_w', Math.round(fileExplorer.getBoundingClientRect().width) + 'px')
    });

    // Panneau IA 1 ↔ panneau IA 2 (vue scindée)
    makeResizer(document.getElementById('resizerPane'), {
      el: pane1,
      getStart: () => pane1.getBoundingClientRect().width,
      min: 200,
      max: () => document.getElementById('webviewArea').getBoundingClientRect().width - 220,
      apply: (w) => { pane1.style.flex = '0 0 ' + w + 'px'; }
    });
  }
  setupResizers();

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
    'open-logs':        () => openLogsFolder()
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cmd]');
    if (!el) return;
    const cmd = COMMANDS[el.getAttribute('data-cmd')];
    if (cmd) cmd(el);
  });
  document.getElementById('paletteInput').addEventListener('input', () => filterPalette());

  // Rafraîchit UNIQUEMENT le texte des compteurs « ⏳ Xh YYm » en cours, par
  // textContent (aucun innerHTML, aucune hydratation d'icônes) : bien moins
  // cher qu'un renderAccounts() complet (mesuré ~50x), pour un affichage
  // identique — le format du décompte est à la minute près.
  function refreshCooldownLabels() {
    const now = Date.now();
    document.querySelectorAll('#accountsList [data-action="toggle-cooldown"]').forEach(btn => {
      const accId = btn.getAttribute('data-acc'), svcId = btn.getAttribute('data-svc');
      const acc = state.accounts.find(a => a.id === accId);
      if (!acc || isResetPending(accId, svcId)) return;
      const v = CD.view(acc.cooldowns[svcId], now);
      if (v.state !== btn.getAttribute('data-cd-state')) return; // changement d'état : rendu complet au tick
      btn.textContent = v.text;
      btn.title = v.title;
    });
  }

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

  // Construit et affiche la modale de récupération. Restaure depuis
  // ai_accounts_backup si un backup valide existe, sinon informe simplement.
  // (Fonction déclarée -> hoistée, l'appel ci-dessus la voit.)
  function showRecoveryUI() {
    // État de la sauvegarde (accounts.json.bak), fourni par le processus principal.
    const backup = (state.loadResult && state.loadResult.backup) || { available: false, count: 0 };
    const hasBackup = !!backup.available;
    // « undecryptable » : fichier chiffré par un autre compte Windows, ou clé
    // DPAPI perdue (mot de passe Windows réinitialisé par un administrateur…).
    const status = state.loadResult && state.loadResult.status;
    const why = status === 'undecryptable'
      ? 'ne peut pas être déchiffrée sur ce compte Windows'
      : status === 'missing' ? 'est introuvable' : 'est corrompue';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    const box = document.createElement('div');
    box.className = 'modal';

    const title = document.createElement('div');
    title.className = 'modal__title';
    title.textContent = status === 'missing' ? 'Liste de comptes introuvable' : 'Données de comptes illisibles';

    const desc = document.createElement('div');
    desc.style.cssText = 'color:var(--fg-muted); font-size:13px; margin:8px 0 4px;';
    // textContent (pas innerHTML) : aucune donnée n'est interprétée en HTML.
    desc.textContent = hasBackup
      ? `La liste de comptes enregistrée ${why}. Une sauvegarde de ${backup.count} compte(s) a été trouvée. La restaurer ? `
        + 'Si vous continuez sans restaurer, une copie de cette sauvegarde est conservée dans le dossier « backups » des données de l\'application (rien n\'est supprimé).'
      : `La liste de comptes enregistrée ${why} et aucune sauvegarde lisible n'est disponible. L'application démarre avec une liste vide ; le fichier actuel sera mis de côté (jamais supprimé) si vous créez ou modifiez un compte. Vos sessions de connexion ne sont pas touchées : recréer un compte avec le même nom de profil les retrouve.`;

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const close = () => overlay.remove();

    if (hasBackup) {
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = 'Continuer sans restaurer';
      cancel.addEventListener('click', close);

      const restore = document.createElement('button');
      restore.className = 'btn btn--primary';
      restore.textContent = 'Restaurer la sauvegarde';
      restore.addEventListener('click', async () => {
        restore.disabled = true;
        // Le processus principal met le fichier illisible de côté et remet la
        // sauvegarde en place, puis renvoie les comptes restaurés.
        const r = await api.accounts.restoreBackup().catch(e => ({ ok: false, error: String(e) }));
        if (!r || !r.ok) {
          restore.disabled = false;
          showToast('Restauration impossible' + (r && r.error ? ' (' + r.error + ')' : ''), 'error');
          return;
        }
        // Même interprétation qu'au démarrage (sauvegarde migrée, ou plus
        // récente -> lecture seule).
        applyLoadResult(r.result || { status: 'ok', accounts: r.accounts });
        migrateOldAccounts();   // complète/répare les comptes restaurés
        renderAccounts();
        close();
        showToast('Comptes restaurés depuis la sauvegarde');
      });
      actions.appendChild(cancel);
      actions.appendChild(restore);
    } else {
      const ok = document.createElement('button');
      ok.className = 'btn btn--primary';
      ok.textContent = 'Compris';
      ok.addEventListener('click', close);
      actions.appendChild(ok);
    }

    box.appendChild(title);
    box.appendChild(desc);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
}
