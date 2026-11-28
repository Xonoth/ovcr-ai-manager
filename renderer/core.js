// ===== [OVCR] AI Manager — socle de l'interface (renderer/core.js) =====
//
// Premier script de l'interface chargé par index.html (phase 3, P6 : découpage
// progressif de renderer/app.js). Script CLASSIQUE, sans module ni bundler :
// tout ce qui est partagé entre les scripts de l'interface passe par un seul
// espace de noms, window.OVCR, créé ici et non remplaçable.
//
// Contrairement aux autres modules (qui ne font rien tant que app.js ne les
// appelle pas), ce socle agit DÈS son chargement, exprès :
//   - le filet de sécurité de hydrateIcons ;
//   - la remontée des avertissements et erreurs vers le journal local
//     (diagnostics), pour attraper aussi les erreurs du démarrage.
//
// La page tourne SANS Node.js (nodeIntegration: false, contextIsolation,
// sandbox) : le seul accès au système est l'API window.ovcr d'app-preload.js.

(function () {
  'use strict';

  // Échappe les caractères HTML dangereux (chantier A). À utiliser PARTOUT où une
  // donnée saisie par l'utilisateur (nom / email / profil de compte, nom de
  // fichier) est injectée dans du HTML via innerHTML. Empêche l'exécution de
  // HTML/JS injecté (un simple nom de compte « <img onerror> » vaudrait sinon
  // exécution de code dans l'interface — la CSP bloquerait ce script inline,
  // mais on ne compte pas sur une seule barrière).
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Filet de sécurité (chantier audit 3.6) : si assets/icons.js n'a pas pu se
  // charger, `hydrateIcons` serait absente et le 1er appel dans initApp() ferait
  // planter TOUTE l'app. On garantit une fonction no-op -> au pire, pas d'icônes,
  // mais l'app reste utilisable.
  if (typeof window.hydrateIcons !== 'function') window.hydrateIcons = function () {};

  // === Diagnostics (phase 2, lot 3) ===
  // Les avertissements/erreurs de l'interface et les erreurs JavaScript non
  // interceptées partent dans le journal local du processus principal
  // (diagnostics.js : expurgé, limité en débit). Rien n'est envoyé sur Internet.
  // La console reste inchangée (même affichage dans les DevTools).
  const diag = (() => {
    const api = window.ovcr && window.ovcr.diag;
    const nativeError = console.error.bind(console);
    const fmt = (a) => {
      if (a instanceof Error) return a.name + ': ' + a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    };
    function report(level, message, stack) {
      if (!api) return;
      // Jamais console.error ici (boucle) : on retombe sur la console native.
      api.report({ level, message: String(message).slice(0, 2000), stack: stack ? String(stack).slice(0, 4000) : undefined })
        .catch(e => nativeError('[diag] rapport impossible :', e && e.message));
    }
    for (const level of ['warn', 'error']) {
      const native = console[level].bind(console);
      console[level] = (...args) => { native(...args); report(level, args.map(fmt).join(' ')); };
    }
    // Erreur visible pour l'utilisateur : une fois toutes les 10 s au plus.
    let lastNotice = 0;
    function notice() {
      if (Date.now() - lastNotice < 10000 || typeof window.__ovcrToast !== 'function') return;
      lastNotice = Date.now();
      window.__ovcrToast('Une erreur interne est survenue (détails : « ? » puis « Diagnostic »).', 'error');
    }
    window.addEventListener('error', (e) => {
      report('error', 'erreur non interceptée : ' + (e.message || 'inconnue') + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''), e.error && e.error.stack);
      notice();
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      report('error', 'promesse rejetée non traitée : ' + (r && r.message || r), r && r.stack);
      notice();
    });
    return { report };
  })();

  // Écran affiché si le démarrage échoue en cours de route : jamais une
  // interface à moitié construite et muette.
  function showStartupError(err) {
    diag.report('error', '[app] démarrage impossible : ' + (err && err.message || err), err && err.stack);
    const box = document.createElement('div');
    box.className = 'modal-overlay open';
    box.style.zIndex = '300';
    box.innerHTML = '<div class="modal"><div class="modal__title">L\'application n\'a pas pu démarrer</div>'
      + '<div style="color:var(--fg-muted); font-size:13px; margin:8px 0 4px;">Une erreur interne a interrompu le démarrage. Vos comptes ne sont pas modifiés. '
      + 'Essayez de recharger ; si le problème continue, les détails techniques sont dans le dossier des journaux.</div>'
      + '<div class="modal__actions"><button class="btn" data-startup="logs">Ouvrir le dossier des journaux</button>'
      + '<button class="btn btn--primary" data-startup="reload">Recharger</button></div></div>';
    box.addEventListener('click', (e) => {
      const action = e.target.closest('[data-startup]');
      if (!action) return;
      if (action.getAttribute('data-startup') === 'reload') location.reload();
      else if (window.ovcr && window.ovcr.diag) window.ovcr.diag.openLogs().catch(e => console.warn('[diag] dossier des journaux :', e && e.message));
    });
    document.body.appendChild(box);
  }

  // Notification brève en bas à droite (disparaît après 3 s).
  // type : 'success' (défaut), 'warning' ou 'error'.
  function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast`;
    toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--accent)';
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'exclamation-triangle';
    // msg peut contenir une donnée utilisateur (ex. nom de compte) -> échappé (chantier A).
    toast.innerHTML = `<span class="ic" data-icon="${iconName}"></span> ${escapeHtml(msg)}`;
    window.hydrateIcons(toast);
    document.getElementById('toastContainer').appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // === État partagé de l'interface ===
  // Une seule copie, lue et modifiée par les scripts de l'interface (jamais
  // enregistrée telle quelle : les comptes passent par le processus principal).
  const state = {
    accounts: [],              // copie de travail des comptes (la référence fait foi)
    storageWritable: true,     // false = écritures bloquées (mode protégé)
    bannerKind: null,          // nature du bandeau de stockage affiché, ou null
    loadResult: null,          // dernière réponse de api.accounts.load()
    dataCorrupt: false,        // comptes illisibles : proposer la récupération
    activeAccountId: null,     // compte du dernier service ouvert
    activePaneId: 1,           // panneau qui recevra le prochain service
    layoutMode: 1,             // 1 = vue simple, 2 = vue scindée
    collapsedAccounts: new Set() // ids des comptes dont la carte est repliée
  };

  Object.defineProperty(window, 'OVCR', {
    // Objet non gelé : chaque module de l'interface y ajoutera sa partie.
    value: { state, escapeHtml, diag, showStartupError, showToast },
    writable: false,
    configurable: false,
    enumerable: true
  });
})();
