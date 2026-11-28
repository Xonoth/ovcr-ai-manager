// ===== [OVCR] AI Manager — panneaux de service (renderer/panes.js) =====
//
// Phase 3, P6 lot 4 : code déplacé tel quel depuis renderer/app.js.
// Vue simple ou scindée, ouverture d'un service dans un panneau (webview
// sur la partition persist:<profil> du compte), écran de chargement et
// écrans d'erreur (renderer/pane-errors.js), bandeau « hors ligne »,
// fermeture d'un panneau.
//
// Ne fait rien au chargement : app.js appelle OVCR.panes.init() au
// démarrage, au même moment qu'auparavant. setLayout, openService et
// closePane2 restent des fonctions window.* appelées par les boutons, la
// palette et la liste des comptes (délégation dans app.js).

(function () {
  'use strict';

  // ctx.api : pont window.ovcr ; ctx.SERVICES : liste des services ;
  // ctx.renderAccounts, ctx.saveCollapsed : liste des comptes (app.js).
  function init({ api, SERVICES, renderAccounts, saveCollapsed }) {
    const { escapeHtml, showToast } = OVCR;
    const state = OVCR.state;

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
  }

  OVCR.panes = { init };
})();
