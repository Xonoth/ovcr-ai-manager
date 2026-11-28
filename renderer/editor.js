// ===== [OVCR] AI Manager — éditeur de fichiers (renderer/editor.js) =====
//
// Phase 3, P6 lot 3 : code déplacé tel quel depuis renderer/app.js.
// Monaco (chargé à la demande depuis node_modules, optionnel), éditeur de
// secours (textarea) s'il ne peut pas se charger, ouverture d'un dossier
// choisi dans la boîte du processus principal, ouverture des fichiers et
// enregistrement (Ctrl+S). Les refus viennent du main (file-access.js).
//
// Ne fait rien au chargement : app.js appelle OVCR.editor.init() au
// démarrage, et OVCR.editor.ensureMonacoLoaded() à la 1re ouverture du
// panneau éditeur. selectLocalFolder et loadFileInEditor restent des
// fonctions window.* appelées par les boutons (délégation dans app.js).

(function () {
  'use strict';

  // L'application démarre IMMÉDIATEMENT et NE DÉPEND PAS de Monaco.
  // Monaco (l'éditeur de code) est chargé EN LOCAL depuis node_modules et reste
  // OPTIONNEL : s'il n'arrive pas à s'initialiser (fichier manquant, erreur),
  // tout le reste de l'application continue de fonctionner normalement.
  // Chargement PARESSEUX (audit perf) : ~8 Mo de JS Monaco ne sont plus parsés
  // au démarrage mais au premier clic sur l'éditeur (qui démarre replié).
  var monacoRequested = false;
  function ensureMonacoLoaded() {
    if (monacoRequested) return;
    monacoRequested = true;
    // Placeholder le temps du chargement (~centaines de ms) ; remplacé par
    // Monaco (__initMonacoEditor vide le conteneur) ou par l'éditeur de secours.
    const c = document.getElementById('monacoContainer');
    if (c) c.innerHTML = '<div style="padding:14px; font-size:12px; color:var(--fg-dim); font-family:\'JetBrains Mono\',monospace;">Chargement de l\'éditeur…</div>';
    loadMonaco();
  }

  // Monaco en mode NAVIGATEUR : le loader AMD (loader.js) n'est injecté qu'au
  // premier besoin, puis charge editor.main par balises <script> locales (CSP
  // 'self'). Plus de conflit avec le require de Node : la page n'en a plus.
  // URL ABSOLUE résolue depuis l'adresse de l'interface (app://ovcr/index.html
  // depuis la 1.9.0) : le protocole app:// lit les fichiers de Monaco là où ils
  // sont (app.asar.unpacked dans le .exe packagé, via le fs d'Electron).
  function loadMonaco() {
    const vsBase = new URL('node_modules/monaco-editor/min/vs', window.location.href).href;
    const loader = document.createElement('script');
    loader.src = vsBase + '/loader.js';
    loader.onerror = () => {
      console.warn('[editor] loader.js indisponible');
      onMonacoUnavailable();
    };
    loader.onload = () => {
      if (typeof window.require !== 'function' || typeof window.require.config !== 'function') {
        console.warn('[editor] loader AMD invalide');
        onMonacoUnavailable();
        return;
      }
      try {
        window.require.config({ paths: { vs: vsBase } });
        window.require(
          ['vs/editor/editor.main'],
          function () {
            console.log('[editor] Monaco chargé OK');
            if (window.__initMonacoEditor) window.__initMonacoEditor();
          },
          function (err) {
            // Échec du chargement du module Monaco.
            console.error('[editor] échec require(editor.main):', err && (err.message || err));
            onMonacoUnavailable();
          }
        );
      } catch (e) {
        console.error('[editor] exception loadMonaco:', e && (e.message || e));
        onMonacoUnavailable();
      }
    };
    document.head.appendChild(loader);
  }

  function onMonacoUnavailable() {
    // Monaco indisponible : on bascule sur l'éditeur de secours (textarea).
    if (window.__initFallbackEditor) window.__initFallbackEditor();
  }

  // ctx.api : pont window.ovcr.
  function init({ api }) {
    const { escapeHtml, showToast } = OVCR;

    let monacoEditor = null;
    let fallbackTextarea = null;
    let editorMode = 'none'; // 'monaco' | 'textarea' | 'none'
    let currentOpenFilePath = null;
    let currentFileReadOnly = false; // fichier non UTF-8 : affiché, pas réenregistrable

    // Éditeur Monaco — créé UNIQUEMENT si Monaco a pu se charger (optionnel).
    // Appelé par loadMonaco() une fois le CDN chargé. Si Monaco échoue, cette
    // fonction n'est jamais appelée et l'app fonctionne sans éditeur.
    window.__initMonacoEditor = function() {
      if (typeof monaco === 'undefined' || monacoEditor) return;
      const container = document.getElementById('monacoContainer');
      container.innerHTML = ''; // retire le placeholder « Chargement de l'éditeur… »
      monacoEditor = monaco.editor.create(container, {
        value: '// Sélectionnez un fichier pour l\'éditer ici.\n// Ctrl+S pour sauvegarder.',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true
      });
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
        saveCurrentFile();
      });
      editorMode = 'monaco';
    };

    // Éditeur de SECOURS (textarea) — utilisé si Monaco n'a pas pu se charger.
    // Toujours fonctionnel : ouverture, édition et sauvegarde (Ctrl+S).
    window.__initFallbackEditor = function() {
      if (editorMode === 'monaco') return; // Monaco a réussi, on ne fait rien
      const c = document.getElementById('monacoContainer');
      if (!c) return;
      c.innerHTML = `
        <div style="display:flex; flex-direction:column; height:100%;">
          <div style="padding:6px 12px; font-size:11px; color:var(--warning); background:rgba(255,179,71,0.12); border-bottom:1px solid var(--border);">
            <span class="ic" data-icon="triangle-exclamation"></span> Éditeur simplifié (Monaco indisponible) — Ctrl+S pour sauvegarder
          </div>
          <textarea id="fallbackEditor" spellcheck="false" disabled
            style="flex:1; width:100%; resize:none; border:none; outline:none; padding:14px; background:var(--bg); color:var(--fg); font-family:'JetBrains Mono',monospace; font-size:13px; line-height:1.6; tab-size:2;"
            placeholder="Sélectionnez un fichier pour l'éditer ici."></textarea>
        </div>`;
      hydrateIcons(c); // remplit l'icône SVG du bandeau
      fallbackTextarea = document.getElementById('fallbackEditor');
      fallbackTextarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveCurrentFile(); }
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = fallbackTextarea.selectionStart, en = fallbackTextarea.selectionEnd;
          fallbackTextarea.value = fallbackTextarea.value.slice(0, s) + '  ' + fallbackTextarea.value.slice(en);
          fallbackTextarea.selectionStart = fallbackTextarea.selectionEnd = s + 2;
        }
      });
      editorMode = 'textarea';
    };

    // Accès unifié à l'éditeur (Monaco OU textarea de secours).
    function getEditorValue() {
      if (editorMode === 'monaco' && monacoEditor) return monacoEditor.getValue();
      if (editorMode === 'textarea' && fallbackTextarea) return fallbackTextarea.value;
      return null;
    }
    function setEditorContent(content, lang, readOnly) {
      if (editorMode === 'monaco' && monacoEditor) {
        monaco.editor.setModelLanguage(monacoEditor.getModel(), lang);
        monacoEditor.setValue(content);
        monacoEditor.updateOptions({ readOnly: !!readOnly });
      } else if (editorMode === 'textarea' && fallbackTextarea) {
        fallbackTextarea.disabled = false;
        fallbackTextarea.readOnly = !!readOnly;
        fallbackTextarea.value = content;
      }
    }

    // Messages des refus renvoyés par le processus principal (file-access.js).
    const FILE_ERRORS = {
      denied: 'Accès refusé : ce fichier n\'est pas dans le dossier ouvert.',
      binary: 'Fichier binaire : il ne peut pas être ouvert dans l\'éditeur.',
      unreadable: 'Fichier illisible (droits insuffisants, ou fichier déplacé/supprimé).',
      write_failed: 'Erreur d\'enregistrement.',
      too_large: 'Contenu trop volumineux (limite : 20 Mo).',
      invalid: 'Contenu invalide.'
    };

    async function saveCurrentFile() {
      if (!currentOpenFilePath || editorMode === 'none') return;
      if (currentFileReadOnly) {
        showToast('Fichier ouvert en lecture seule (encodage non UTF-8) : non enregistré.', 'warning');
        return;
      }
      const content = getEditorValue();
      if (content === null) return;
      let res = null;
      try { res = await api.files.saveFile(currentOpenFilePath, content); } catch (e) { console.error('[files]', e); }
      if (res && res.ok) showToast('Fichier enregistré !');
      else showToast((res && FILE_ERRORS[res.error]) || 'Erreur d\'enregistrement.', 'error');
    }

    // Fichiers
    window.selectLocalFolder = async function() {
      // Le dossier choisi dans la boîte de dialogue devient, côté processus
      // principal, une racine autorisée : seuls ses fichiers seront accessibles.
      let folderPath, res;
      try {
        folderPath = await api.files.selectFolder();
        if (!folderPath) return;
        res = await api.files.listDirectory(folderPath);
      } catch (e) {
        console.error('[files] ouverture du dossier impossible :', e && e.message);
        showToast('Impossible d\'ouvrir ce dossier.', 'error');
        return;
      }
      if (!res || !res.ok) showToast((res && FILE_ERRORS[res.error]) || 'Dossier illisible.', 'error');
      const files = (res && res.entries) || [];
      const list = document.getElementById('fileList');
      // Le chemin et le nom du fichier viennent du système de fichiers : ils
      // peuvent contenir des guillemets / caractères HTML -> échappés, et passés
      // par data-* (lus par la délégation, chantier A) plutôt que dans un onclick.
      list.innerHTML = files.map(f => `
        <div class="file-item" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}">
          <span class="ic" data-icon="file-code" style="color: var(--fg-dim)"></span> ${escapeHtml(f.name)}
        </div>
      `).join('');
      hydrateIcons(list);
    }

    window.loadFileInEditor = async function(filePath, fileName, el) {
      let res = null;
      try { res = await api.files.readFile(filePath); } catch (e) { console.error('[files]', e); }
      if (!res || !res.ok) {
        // Fichier trop volumineux : on indique sa taille et la limite.
        if (res && res.error === 'too_large') {
          showToast('Fichier trop volumineux pour l\'éditeur : ' + Math.round(res.size / 1048576) + ' Mo (limite : 20 Mo).', 'error');
        } else {
          showToast((res && FILE_ERRORS[res.error]) || FILE_ERRORS.unreadable, 'error');
        }
        return;
      }
      const content = res.content;
      currentFileReadOnly = !!res.readOnly;
      if (currentFileReadOnly) showToast('Encodage non UTF-8 : fichier ouvert en lecture seule (l\'enregistrer l\'abîmerait).', 'warning');

      currentOpenFilePath = filePath;
      document.getElementById('activeFileName').textContent = fileName;
      
      document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');

      const ext = fileName.split('.').pop();
      const langMap = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'html', css: 'css', json: 'json', md: 'markdown' };
      const lang = langMap[ext] || 'plaintext';

      setEditorContent(content, lang, currentFileReadOnly);
    }
  }

  OVCR.editor = { init, ensureMonacoLoaded };
})();
