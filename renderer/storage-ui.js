// ===== [OVCR] AI Manager — stockage des comptes (renderer/storage-ui.js) =====
//
// Phase 3, P6 lot 6 : code déplacé tel quel depuis renderer/app.js.
// La liste des comptes est tenue par le processus principal (accounts-store.js,
// chiffrée) ; l'interface en garde la copie de travail (OVCR.state.accounts).
// Ici : enregistrement (saveAccounts), mode protégé (ensureWritable) et
// bandeaux, chargement initial et migration depuis la 1.0.4, retour arrière
// vers la 1.0.4, réparation des comptes (migrateOldAccounts), fenêtre de
// récupération d'une liste illisible (showRecoveryUI).
//
// Ne fait rien au chargement : app.js appelle OVCR.storageUi.init(), puis
// handlePendingRevert() et loadInitial(), au même moment qu'auparavant.

(function () {
  'use strict';

  // ctx.api : pont window.ovcr ; ctx.SERVICES : liste des services ;
  // ctx.renderAccounts : réaffiche la liste (renderer/accounts-ui.js).
  function init({ api, SERVICES, renderAccounts }) {
    const { escapeHtml, showToast } = OVCR;
    const state = OVCR.state;

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

    // Renvoie true si le démarrage doit s'arrêter (retour arrière effectué).
    async function handlePendingRevert() {
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
          return true;
        }
        console.warn('[storage] retour arrière ignoré :', revert.error);
      }
      return false;
    }

    async function loadInitial() {
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

    return { saveAccounts, ensureWritable, handlePendingRevert, loadInitial, migrateOldAccounts, showRecoveryUI };
  }

  OVCR.storageUi = { init };
})();
