// ===== [OVCR] AI Manager — liste des comptes (renderer/accounts-ui.js) =====
//
// Phase 3, P6 lot 5 : code déplacé tel quel depuis renderer/app.js.
// Cartes des comptes (repli mémorisé), statistiques, boutons de cooldown
// (confirmation en deux clics), palette Ctrl+K (et Échap pour fermer les
// fenêtres), fenêtres d'ajout, de modification et de suppression d'un compte.
// Les comptes eux-mêmes sont dans OVCR.state ; leur enregistrement passe par
// saveAccounts (fourni par app.js), qui respecte le mode protégé.
//
// Ne fait rien au chargement : app.js appelle OVCR.accountsUi.init() au
// démarrage, au même moment qu'auparavant ; init() renvoie renderAccounts,
// saveCollapsed et refreshCooldownLabels, utilisés par app.js et panes.js.

(function () {
  'use strict';

  const COLORS = ['#8b5cf6','#f230aa','#c4b5fd','#a855f7','#5865f2','#ec4899','#38bdf8','#f97316'];

  // ctx.SERVICES : liste des services ; ctx.CD : renderer/cooldowns.js ;
  // ctx.prefs : préférences d'affichage ; ctx.saveAccounts, ctx.ensureWritable :
  // enregistrement des comptes et contrôle du mode protégé (app.js).
  function init({ SERVICES, CD, prefs, saveAccounts, ensureWritable }) {
    const { escapeHtml, showToast } = OVCR;
    const state = OVCR.state;

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

    return { renderAccounts, saveCollapsed, refreshCooldownLabels };
  }

  OVCR.accountsUi = { init };
})();
