// ===== [OVCR] AI Manager — mise en page (renderer/layout.js) =====
//
// Phase 3, P6 lot 7 : code déplacé tel quel depuis renderer/app.js.
// Préférences d'affichage (localStorage), repli du tableau de bord, de
// l'explorateur et de l'éditeur, colonnes redimensionnables à la souris.
//
// Ne fait rien au chargement : app.js appelle importLegacyPrefs() puis
// createPrefs(), init() et setupResizers() au démarrage.

(function () {
  'use strict';

  // === Préférences d'affichage (localStorage, non sensibles) ===
  // Clés : ide_w, explorer_w (largeurs « 123px »), collapsed_accounts (ids).
  // Versionnées par `prefs_schema` (absent = 1). Une valeur invalide est
  // ignorée (retour au défaut), jamais bloquante. Si les préférences viennent
  // d'une version plus récente, on les lit mais on ne les réécrit pas.
  // Une préférence non enregistrée n'est pas grave (seulement l'affichage) :
  // on le signale dans la console, sans alerter l'utilisateur.
  function createPrefs() {
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
    return prefs;
  }

  // Phase 3, P5 : depuis la 1.9.0, l'interface est en app://ovcr et a son
  // propre localStorage. S'il ne contient encore aucune préférence (premier
  // lancement de la 1.9.0), on reprend UNE FOIS celles de l'ancienne origine
  // file:// (versions <= 1.8.0, lues par le main via le pont). Elles sont
  // ensuite validées par createPrefs() et à la lecture, comme toutes les
  // autres. L'ancienne copie n'est pas effacée (une 1.8.0 la retrouverait).
  // Tout échec : préférences par défaut, jamais bloquant.
  const LEGACY_PREF_KEYS = ['prefs_schema', 'ide_w', 'explorer_w', 'collapsed_accounts'];
  async function importLegacyPrefs(api) {
    try {
      if (localStorage.getItem('prefs_schema') != null) return false;
    } catch (e) {
      return false; // localStorage indisponible : createPrefs() le signalera
    }
    let old;
    try { old = await api.storage.legacyPrefs(); }
    catch (e) { console.warn('[prefs] anciennes préférences illisibles :', e.message); return false; }
    const found = LEGACY_PREF_KEYS.filter(k => old && typeof old[k] === 'string');
    if (!found.length) return false;
    try {
      for (const k of found) localStorage.setItem(k, old[k]);
    } catch (e) {
      console.warn('[prefs] anciennes préférences non reprises :', e.message);
      return false;
    }
    console.log('[prefs] préférences reprises de la version précédente : ' + found.join(', '));
    return true;
  }

  // ctx.prefs : préférences créées par createPrefs().
  function init({ prefs }) {
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

    return { setupResizers };
  }

  OVCR.layout = { createPrefs, importLegacyPrefs, init };
})();
