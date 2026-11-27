// ===== [OVCR] AI Manager — interface (renderer) =====
//
// Script de la page hôte (index.html). Depuis la phase 1 de sécurisation, la
// page tourne SANS Node.js : nodeIntegration: false, contextIsolation: true,
// sandbox. Tout accès au disque ou au stockage des comptes passe par l'API
// minimale exposée par app-preload.js sous window.ovcr, validée côté
// processus principal. Script externe (et non inline) pour que la CSP de
// index.html puisse interdire tout script inline.

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

// === Démarrage ===
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
initApp().catch(err => console.error('[app] démarrage :', err));

// Monaco en mode NAVIGATEUR : le loader AMD (loader.js) n'est injecté qu'au
// premier besoin, puis charge editor.main par balises <script> locales (CSP
// 'self'). Plus de conflit avec le require de Node : la page n'en a plus.
// URL ABSOLUE résolue depuis l'emplacement réel d'index.html : valable en dev
// ET dans le .exe packagé (index.html dans app.asar, Monaco dans
// app.asar.unpacked — Electron fait le lien de façon transparente).
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

async function initApp() {
  // Pont vers le processus principal (app-preload.js). S'il manque, l'app ne
  // peut ni lire ni enregistrer les comptes : on le dit au lieu d'échouer en
  // silence (et surtout sans rien écraser).
  const api = window.ovcr;
  if (!api) {
    document.body.innerHTML = '<div style="margin:auto; padding:32px; color:#ff4d6a; font-family:sans-serif;">Erreur interne : le pont sécurisé (preload) n\'est pas chargé. Réinstallez l\'application.</div>';
    return;
  }

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

  // Contenu de la modale d'aide, indexé par id de service (même philosophie
  // data-driven que SERVICES : ajouter un service = ajouter son entrée ici).
  // Texte statique embarqué (aucun fetch réseau), rédigé neutre / grand public.
  const SERVICE_INFO = {
    claude: {
      what: "L'assistant conversationnel d'Anthropic. Il excelle en rédaction, en analyse de longs documents, en programmation et dans les raisonnements qui demandent plusieurs étapes.",
      when: "Plutôt pour du code, des textes longs et soignés, ou des questions complexes qui demandent de la rigueur."
    },
    chatgpt: {
      what: "L'assistant généraliste d'OpenAI, le plus connu du grand public. Il discute, rédige, résume, génère des images, analyse des fichiers et peut chercher sur le web.",
      when: "Le couteau suisse du quotidien : brainstorming, questions générales, petites tâches variées."
    },
    gemini: {
      what: "L'assistant IA de Google. Multimodal (texte, images, audio, vidéo), il s'appuie sur la recherche Google et s'intègre aux outils Google (Docs, Gmail, Drive…).",
      when: "Plutôt pour analyser des images ou vidéos, ou si vous travaillez déjà dans l'écosystème Google."
    },
    zeta: {
      what: "Le chat de Z.ai, propulsé par les modèles GLM. Gratuit pour l'essentiel, avec un mode agent capable de chercher sur le web et de produire des fichiers (docx, pdf, xlsx).",
      when: "Une alternative gratuite solide pour le chat et le code, quand les quotas des autres sont épuisés."
    },
    perplexity: {
      what: "Un « moteur de réponse » : il cherche sur le web en direct, synthétise plusieurs sources et cite ses références pour chaque affirmation.",
      when: "Plutôt pour la recherche d'informations à jour, la veille et la vérification de faits avec sources."
    },
    grok: {
      what: "L'assistant de xAI (Elon Musk), connecté au réseau X (ex-Twitter). Ton direct, accès au temps réel de X, génération d'images incluse.",
      when: "Plutôt pour suivre l'actualité chaude et les tendances via X, ou pour un ton moins formel."
    },
    leonardo: {
      what: "Une plateforme de génération d'images orientée création : illustrations, concept art, assets de jeu vidéo, avec des contrôles fins (styles, modèles, retouche).",
      when: "Plutôt pour produire des visuels et illustrations de qualité avec un contrôle précis du style."
    },
    suno: {
      what: "Un générateur de musique : il compose des chansons complètes (instruments, voix, paroles) à partir d'une simple description texte, dans à peu près tous les genres.",
      when: "Plutôt pour créer une musique, un jingle ou une chanson à partir d'un texte ou d'une idée."
    },
    meshy: {
      what: "Un générateur de modèles 3D : il transforme un texte ou une image en objet 3D texturé, avec rigging/animation automatique et export vers les formats standards (GLB, FBX, STL…).",
      when: "Plutôt pour créer des assets 3D (jeux, impression 3D, animation) sans savoir modéliser."
    }
  };

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
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  // Enregistre la liste de comptes. L'envoi est IMMÉDIAT et porte un
  // instantané de la liste au moment de l'appel ; le processus principal
  // traite les écritures une par une, dans l'ordre d'arrivée, valide les
  // données et conserve la génération précédente en sauvegarde. Il retarde
  // aussi la fermeture de l'app tant qu'une écriture est en cours.
  function saveAccounts(list) {
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(list)); }
    catch (e) { console.error('[storage] liste de comptes non sérialisable :', e); return false; }
    api.accounts.save(snapshot)
      .then(res => {
        if (!res || !res.ok) {
          console.error('[storage] échec écriture des comptes :', res && res.error);
          showToast('Impossible d\'enregistrer les comptes' + (res && res.error ? ' (' + res.error + ')' : ''), 'error');
        }
      })
      .catch(e => {
        console.error('[storage] échec écriture des comptes :', e);
        showToast('Impossible d\'enregistrer les comptes', 'error');
      });
    return true;
  }

  // Fondation réutilisable pour une future fonctionnalité d'export/import JSON
  // (ne pas coder le backup « en dur » : ces deux fonctions serviront à l'UI).
  function exportAccountsJSON() { return JSON.stringify(accounts, null, 2); }
  function importAccountsJSON(text) {
    const parsed = JSON.parse(text); // peut throw : l'appelant (UI) gère l'erreur
    if (!Array.isArray(parsed)) throw new Error('Format invalide : un tableau de comptes est attendu.');
    accounts = parsed;
    migrateOldAccounts();  // complète/répare les comptes importés
    saveAccounts(accounts);
    renderAccounts();
    return accounts.length;
  }

  // Retour arrière demandé (lancement avec --revert-storage-migration) : on
  // réécrit les comptes dans le localStorage au format 1.0.4, le processus
  // principal met ses fichiers de côté puis ferme l'app.
  const revert = await api.storage.pendingRevert().catch(() => null);
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
  let dataCorrupt = false;
  let loadResult = null;
  let accounts = [];
  try {
    loadResult = await api.accounts.load();
    // Premier lancement après la 1.0.4 : migration depuis le localStorage.
    if (loadResult.status === 'empty') {
      const legacy = legacyGet(LEGACY_STORE_KEY);
      const legacyBackup = legacyGet(LEGACY_BACKUP_KEY);
      if (legacy != null || legacyBackup != null) {
        const m = await api.accounts.migrateLegacy({ current: legacy, backup: legacyBackup });
        if (m && m.ok) {
          // Copie chiffrée vérifiée côté main (+ sauvegarde préalable dans
          // backups/) : la copie en clair peut disparaître.
          try { localStorage.removeItem(LEGACY_STORE_KEY); localStorage.removeItem(LEGACY_BACKUP_KEY); } catch (_) {}
          console.log('[storage] comptes migrés depuis localStorage (chiffrement : ' + m.encrypted + ')');
          loadResult = await api.accounts.load();
        } else {
          // Migration impossible : on travaille sur l'ancienne copie (non
          // effacée) ; la prochaine écriture créera le nouveau stockage.
          console.error('[storage] migration impossible :', m && m.error);
          showToast('Migration du stockage des comptes impossible : ancienne copie conservée.', 'warning');
          try {
            const parsed = JSON.parse(legacy);
            if (Array.isArray(parsed)) loadResult = { status: 'ok', accounts: parsed };
          } catch (_) { /* ancienne copie illisible : liste vide, rien n'est écrasé */ }
        }
      }
    }
    if (loadResult.status === 'ok' && Array.isArray(loadResult.accounts)) accounts = loadResult.accounts;
    else if (loadResult.status === 'corrupt' || loadResult.status === 'undecryptable') dataCorrupt = true;
    // 'empty' -> accounts reste []
  } catch (e) {
    console.error('[storage] lecture des comptes impossible :', e);
  }

  // Vue compacte : ids des comptes dont la grille de services est repliée.
  // Persisté dans localStorage (clé dédiée, même modèle défensif que ide_w :
  // une valeur absente/illisible retombe sur le défaut = tout déplié).
  const COLLAPSED_KEY = 'collapsed_accounts';
  let collapsedAccounts = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    if (Array.isArray(saved)) collapsedAccounts = new Set(saved.filter(x => typeof x === 'string'));
  } catch (e) { console.warn('[storage] états de repli ignorés :', e); }

  // Écrit l'état de repli en purgeant les ids de comptes supprimés
  // (la clé ne grossit pas indéfiniment au fil des suppressions).
  function saveCollapsed() {
    collapsedAccounts = new Set([...collapsedAccounts].filter(id => accounts.some(a => a.id === id)));
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedAccounts])); } catch (e) {}
  }

  window.toggleCardCollapse = function(accId) {
    if (!accounts.some(a => a.id === accId)) return; // garde : id obsolète
    if (collapsedAccounts.has(accId)) collapsedAccounts.delete(accId);
    else collapsedAccounts.add(accId);
    saveCollapsed();
    renderAccounts();
  }

  // Bascule globale : s'il reste au moins une carte dépliée on replie tout,
  // sinon on déplie tout. Idempotent sur les cartes déjà dans l'état cible.
  window.toggleAllCards = function() {
    if (accounts.length === 0) return;
    const anyExpanded = accounts.some(a => !collapsedAccounts.has(a.id));
    if (anyExpanded) accounts.forEach(a => collapsedAccounts.add(a.id));
    else collapsedAccounts.clear();
    saveCollapsed();
    renderAccounts();
  }

  let activeAccountId = null;
  let activePaneId = 1;
  let layoutMode = 1;
  let monacoEditor = null;
  let fallbackTextarea = null;
  let editorMode = 'none'; // 'monaco' | 'textarea' | 'none'
  let currentOpenFilePath = null;
  let currentFileReadOnly = false; // fichier non UTF-8 : affiché, pas réenregistrable

  // Migration : convertit les anciens comptes et garantit que chaque compte
  // possède TOUS les services + un cooldown pour chacun (répare aussi les
  // comptes enregistrés qui n'avaient pas encore Perplexity/Zeta).
  function migrateOldAccounts() {
    let needsUpdate = false;
    const ALL_SERVICES = SERVICES.map(s => s.id);
    accounts.forEach(acc => {
      if (!Array.isArray(acc.services)) { acc.services = [...ALL_SERVICES]; needsUpdate = true; }
      if (acc.quotas && !acc.cooldowns) { delete acc.quotas; needsUpdate = true; }
      if (!acc.cooldowns) { acc.cooldowns = {}; needsUpdate = true; }
      ALL_SERVICES.forEach(sid => {
        if (!acc.services.includes(sid)) { acc.services.push(sid); needsUpdate = true; }
        if (acc.cooldowns[sid] === undefined) { acc.cooldowns[sid] = 0; needsUpdate = true; }
      });
    });
    if (needsUpdate) saveAccounts(accounts);
  }
  migrateOldAccounts();

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

  // Rendu
  function renderAccounts() {
    const container = document.getElementById('accountsList');
    if (accounts.length === 0) {
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

    container.innerHTML = accounts.map((acc, idx) => {
      // Toute donnée issue du compte (nom, email, profil, couleur) est saisie
      // par l'utilisateur -> échappée avant injection (chantier A).
      const initials = escapeHtml(String(acc.name).slice(0, 2).toUpperCase());
      const color = escapeHtml(acc.color || COLORS[idx % COLORS.length]);
      const id = escapeHtml(acc.id);
      const isActive = acc.id === activeAccountId;
      const isCollapsed = collapsedAccounts.has(acc.id);
      // Résumé « N/7 » de la carte repliée : même test de disponibilité que
      // updateStats -> reste synchro avec le tick des cooldowns (re-render 1×/min).
      const availCount = acc.services.filter(sid => !acc.cooldowns[sid] || acc.cooldowns[sid] <= Date.now()).length;

      const servicesHtml = acc.services.map(sid => {
        const svc = SERVICES.find(s => s.id === sid);
        if (!svc) return '';
        const cdTime = acc.cooldowns[sid] || 0;
        const isOnCooldown = cdTime > Date.now();
        const btnClass = isOnCooldown ? `${svc.cssClass} cooldown-active` : svc.cssClass;
        const cdBtnClass = isOnCooldown ? 'cooldown-btn active' : 'cooldown-btn';
        const cdText = isOnCooldown ? formatCooldown(cdTime - Date.now()) : 'Épuiser (24h)';
        // svc.id vient de SERVICES (valeurs sûres codées en dur). Les actions
        // passent par des data-* lus par la délégation d'événements (chantier A) :
        // plus aucune donnée n'est injectée dans un attribut onclick.
        return `
          <div class="service-column">
            <button class="svc-btn ${btnClass}" data-action="open-service" data-acc="${id}" data-svc="${svc.id}">${escapeHtml(svc.name)}</button>
            <button class="${cdBtnClass}" data-action="toggle-cooldown" data-acc="${id}" data-svc="${svc.id}">${cdText}</button>
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
    accounts.forEach(acc => {
      let hasAvailable = false;
      acc.services.forEach(sid => {
        if (!acc.cooldowns[sid] || acc.cooldowns[sid] <= Date.now()) { availableIAs++; hasAvailable = true; }
      });
      if (hasAvailable) activeAccounts++;
    });
    document.getElementById('statActive').textContent = activeAccounts;
    document.getElementById('statAvailable').textContent = availableIAs;
    // Oriente le chevron du bouton « Tout replier / déplier » selon l'état
    // global (appelé dans les deux branches de renderAccounts, y c. liste vide).
    const allBtn = document.getElementById('btnToggleAllCards');
    if (allBtn) allBtn.classList.toggle('all-collapsed', accounts.length > 0 && accounts.every(a => collapsedAccounts.has(a.id)));
  }

  function formatCooldown(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `⏳ ${h}h ${m.toString().padStart(2, '0')}m`;
  }

  // Layout
  window.setLayout = function(mode, btn) {
    layoutMode = mode;
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
      activePaneId = 1;
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
    if (!p.classList.contains('collapsed')) ensureMonacoLoaded();
  }

  window.openService = function(accId, svcId) {
    const acc = accounts.find(a => a.id === accId);
    const svc = SERVICES.find(s => s.id === svcId);
    if (!acc || !svc) return;

    activeAccountId = accId;
    // Ouvrir un service (carte OU palette Ctrl+K) déplie la carte concernée :
    // confirmation visuelle du compte utilisé même si elle était repliée.
    if (collapsedAccounts.has(accId)) { collapsedAccounts.delete(accId); saveCollapsed(); }
    renderAccounts();

    // Vue scindée : un panneau VIDE est toujours servi en priorité (cas
    // typique : panneau 2 fermé via « Fermer le panneau 2 » -> le prochain
    // service le remplit au lieu d'écraser le panneau 1). Quand les deux
    // panneaux sont occupés, l'alternance habituelle continue.
    if (layoutMode === 2) {
      const p1Full = !!document.querySelector('#pane1 webview');
      const p2Full = !!document.querySelector('#pane2 webview');
      if (p1Full && !p2Full) activePaneId = 2;
      else if (!p1Full && p2Full) activePaneId = 1;
    }

    const pane = document.getElementById(`pane${activePaneId}`);
    pane.innerHTML = ''; // détruit l'ancienne <webview> (le process invité Chromium est libéré)

    // Feedback de chargement : spinner + nom du service/compte le temps que la
    // page charge (avant : panneau noir muet pendant plusieurs secondes).
    // L'animation CSS ne vit que tant que l'overlay existe -> coût nul ensuite.
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
    pane.appendChild(webview);

    // Retiré au 1er rendu du service ; filet de 10 s si l'événement ne vient
    // jamais (webview morte) pour ne jamais masquer le panneau. Si un autre
    // service est ouvert entre-temps, innerHTML='' a déjà détaché l'overlay
    // et le remove() différé est sans effet.
    const clearLoading = () => loading.remove();
    webview.addEventListener('dom-ready', clearLoading, { once: true });
    setTimeout(clearLoading, 10000);

    if (layoutMode === 2) {
      activePaneId = activePaneId === 1 ? 2 : 1;
    }
    updateClosePane2Btn();
    showToast(`${svc.name} ouvert avec ${acc.name}`);
  }

  // Bouton « Fermer le panneau 2 » : affiché seulement si une webview vit dans
  // le panneau 2 (même cachée en vue simple — c'est justement le cas où elle
  // consomme de la RAM en arrière-plan sans être visible).
  function updateClosePane2Btn() {
    const btn = document.getElementById('btnClosePane2');
    if (btn) btn.style.display = document.querySelector('#pane2 webview') ? '' : 'none';
  }

  window.closePane2 = function() {
    const pane2 = document.getElementById('pane2');
    if (!pane2.querySelector('webview')) return; // rien d'ouvert : rien à faire
    // innerHTML='' détruit la <webview> -> Electron tue le process invité
    // Chromium et libère sa mémoire (même mécanique que le remplacement
    // effectué par openService). On restaure le placeholder d'origine.
    pane2.innerHTML = '<div class="pane-empty"><span class="ic" data-icon="robot"></span><span>Panneau 2 vide</span></div>';
    hydrateIcons(pane2);
    // (openService re-ciblera de lui-même ce panneau vide en vue scindée.)
    updateClosePane2Btn();
    showToast('Panneau 2 fermé (mémoire libérée)');
  }

  // Fichiers
  window.selectLocalFolder = async function() {
    // Le dossier choisi dans la boîte de dialogue devient, côté processus
    // principal, une racine autorisée : seuls ses fichiers seront accessibles.
    const folderPath = await api.files.selectFolder();
    if (!folderPath) return;
    const res = await api.files.listDirectory(folderPath);
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
    accounts.forEach(acc => {
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
    if (accId) {
      const acc = accounts.find(a => a.id === accId);
      title.textContent = "Modifier le compte";
      document.getElementById('editId').value = acc.id;
      document.getElementById('inputName').value = acc.name;
      document.getElementById('inputEmail').value = acc.email;
      document.getElementById('inputProfile').value = acc.profile;
    } else {
      title.textContent = "Ajouter un compte";
      document.getElementById('editId').value = '';
      document.getElementById('inputName').value = '';
      document.getElementById('inputEmail').value = '';
      // Suggère un profil NON collisionnant (`length+1` pouvait re-proposer un
      // profil déjà pris après une suppression -> sessions partagées).
      const used = new Set(accounts.map(a => a.profile));
      let n = accounts.length + 1;
      while (used.has('profil_' + n)) n++;
      document.getElementById('inputProfile').value = 'profil_' + n;
    }
    modal.classList.add('open');
  }
  window.closeModal = function() { document.getElementById('accountModal').classList.remove('open'); }

  // Modale d'aide « Comprendre les IA disponibles ». Liste régénérée à chaque
  // ouverture depuis SERVICES + SERVICE_INFO : un 10e service apparaîtra tout
  // seul (avec son nom au minimum si sa fiche SERVICE_INFO manque encore).
  // Purement informatif : ne touche ni comptes, ni cooldowns, ni webviews.
  window.openHelpModal = function() {
    const list = document.getElementById('helpList');
    // Contenu 100% statique (SERVICES + SERVICE_INFO codés en dur) -> sûr,
    // mais on garde escapeHtml par cohérence avec le reste du rendu.
    list.innerHTML = SERVICES.map(svc => {
      const info = SERVICE_INFO[svc.id];
      return `
        <div class="help-entry">
          <div class="help-entry__name"><span class="help-entry__dot" style="background:var(--${svc.id})"></span>${escapeHtml(svc.name)}</div>
          ${info ? `
            <div class="help-entry__line"><span class="help-entry__label">C'est quoi ?</span> ${escapeHtml(info.what)}</div>
            <div class="help-entry__line"><span class="help-entry__label">Quand l'utiliser ?</span> ${escapeHtml(info.when)}</div>
          ` : `<div class="help-entry__line" style="color:var(--fg-muted)">Description à venir.</div>`}
        </div>
      `;
    }).join('');
    document.getElementById('helpModal').classList.add('open');
  }
  // Oublie les autorisations mémorisées (position, micro, caméra,
  // notifications…) : chaque site redemandera à sa prochaine demande.
  window.resetSitePermissions = async function() {
    const ok = await api.sitePermissions.reset().catch(() => false);
    showToast(ok ? 'Autorisations des sites réinitialisées' : 'Réinitialisation impossible', ok ? 'success' : 'error');
  }
  window.closeHelpModal = function() { document.getElementById('helpModal').classList.remove('open'); }
  // Fermeture par clic en dehors de la boîte (sur le fond assombri).
  document.getElementById('helpModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeHelpModal();
  });

  // Suppression de compte
  window.openDeleteModal = function(accId) {
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return;
    document.getElementById('deleteId').value = accId;
    document.getElementById('deleteDesc').textContent =
      `Supprimer « ${acc.name} » (${acc.email}) ? La session restera stockée sur le disque, mais le compte disparaîtra de la liste.`;
    document.getElementById('deleteModal').classList.add('open');
  }
  window.closeDeleteModal = function() { document.getElementById('deleteModal').classList.remove('open'); }
  window.confirmDelete = function() {
    const id = document.getElementById('deleteId').value;
    accounts = accounts.filter(a => a.id !== id);
    if (activeAccountId === id) activeAccountId = null;
    saveCollapsed();        // purge l'état de repli du compte supprimé
    saveAccounts(accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
    closeDeleteModal();
    showToast('Compte supprimé');
  }

  window.saveAccount = function() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('inputName').value.trim();
    const email = document.getElementById('inputEmail').value.trim();
    const profile = document.getElementById('inputProfile').value.trim();
    if (!name || !email || !profile) return showToast('Remplissez tous les champs', 'error');

    // Unicité du profil (chantier audit 3.1) : deux comptes partageant le même
    // `profile` utiliseraient la MÊME partition Electron (persist:<profile>) →
    // cookies/sessions mêlés entre comptes. On refuse la collision.
    if (accounts.some(a => a.id !== id && a.profile === profile)) {
      return showToast('Ce profil est déjà utilisé par un autre compte (les sessions seraient partagées).', 'error');
    }

    if (id) {
      const acc = accounts.find(a => a.id === id);
      if (!acc) return; // garde : id obsolète
      Object.assign(acc, { name, email, profile });
      showToast('Compte mis à jour');
    } else {
      accounts.push({
        id: 'acc_' + Date.now(), name, email, profile,
        color: COLORS[accounts.length % COLORS.length],
        services: SERVICES.map(s => s.id),
        cooldowns: Object.fromEntries(SERVICES.map(s => [s.id, 0]))
      });
      showToast('Compte ajouté');
    }
    saveAccounts(accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
    closeModal();
  }

  window.toggleCooldown = function(accId, svcId) {
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return; // garde : id obsolète (chantier audit 3.7)
    const currentCd = acc.cooldowns[svcId] || 0;
    acc.cooldowns[svcId] = currentCd > Date.now() ? 0 : Date.now() + 86400000;
    saveAccounts(accounts); // écrit + backup de la génération précédente (chantier C)
    renderAccounts();
  }

  function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast`;
    toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--accent)';
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'exclamation-triangle';
    // msg peut contenir une donnée utilisateur (ex. nom de compte) -> échappé (chantier A).
    toast.innerHTML = `<span class="ic" data-icon="${iconName}"></span> ${escapeHtml(msg)}`;
    hydrateIcons(toast);
    document.getElementById('toastContainer').appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3000);
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
    try {
      const savedIde = localStorage.getItem('ide_w');
      if (savedIde) idePanel.style.flex = '0 0 ' + savedIde;
      const savedExp = localStorage.getItem('explorer_w');
      if (savedExp) fileExplorer.style.flex = '0 0 ' + savedExp;
    } catch (e) { console.warn('[storage] largeurs de colonnes ignorées :', e); }

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
      onEnd: () => { try { localStorage.setItem('ide_w', Math.round(idePanel.getBoundingClientRect().width) + 'px'); } catch (e) {} }
    });

    // Explorateur de fichiers ↔ éditeur
    makeResizer(document.getElementById('resizerExplorer'), {
      el: fileExplorer,
      getStart: () => fileExplorer.getBoundingClientRect().width,
      min: 120,
      max: () => idePanel.getBoundingClientRect().width - 160,
      apply: (w) => { fileExplorer.style.flex = '0 0 ' + w + 'px'; },
      onEnd: () => { try { localStorage.setItem('explorer_w', Math.round(fileExplorer.getBoundingClientRect().width) + 'px'); } catch (e) {} }
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
    'reset-permissions': () => resetSitePermissions()
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
      const acc = accounts.find(a => a.id === btn.getAttribute('data-acc'));
      if (!acc) return;
      const cd = acc.cooldowns[btn.getAttribute('data-svc')] || 0;
      if (cd > now) btn.textContent = formatCooldown(cd - now);
    });
  }

  // Tick cooldowns (1 s) : remet à 0 les cooldowns expirés (seul cas de
  // re-render complet : il faut réactiver le bouton de service) et, au
  // changement de minute (le format du décompte est à la minute), met à jour
  // les libellés via refreshCooldownLabels() — même ponctualité qu'avant
  // (lag ≤ 1 s), mais sans reconstruire tout le DOM de la liste.
  // Coût d'un tick sans cooldown actif : boucle comptes x services pure (µs).
  let lastCdMinute = -1;
  setInterval(() => {
    const now = Date.now();
    let needsRender = false, anyActive = false;
    accounts.forEach(acc => {
      SERVICES.forEach(svc => {
        const cd = acc.cooldowns[svc.id];
        if (!cd) return;
        if (cd <= now) { acc.cooldowns[svc.id] = 0; needsRender = true; }
        else anyActive = true;
      });
    });
    const minute = Math.floor(now / 60000);
    if (needsRender) renderAccounts();
    else if (anyActive && minute !== lastCdMinute) refreshCooldownLabels();
    lastCdMinute = minute;
  }, 1000);

  renderAccounts();

  // Récupération des données (chantier C) : si ai_accounts était illisible au
  // démarrage, on propose de restaurer la sauvegarde plutôt que de perdre en
  // silence les comptes de l'utilisateur.
  if (dataCorrupt) showRecoveryUI();

  // Construit et affiche la modale de récupération. Restaure depuis
  // ai_accounts_backup si un backup valide existe, sinon informe simplement.
  // (Fonction déclarée -> hoistée, l'appel ci-dessus la voit.)
  function showRecoveryUI() {
    // État de la sauvegarde (accounts.json.bak), fourni par le processus principal.
    const backup = (loadResult && loadResult.backup) || { available: false, count: 0 };
    const hasBackup = !!backup.available;
    // « undecryptable » : fichier chiffré par un autre compte Windows, ou clé
    // DPAPI perdue (mot de passe Windows réinitialisé par un administrateur…).
    const why = loadResult && loadResult.status === 'undecryptable'
      ? 'ne peut pas être déchiffrée sur ce compte Windows'
      : 'est corrompue';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    const box = document.createElement('div');
    box.className = 'modal';

    const title = document.createElement('div');
    title.className = 'modal__title';
    title.textContent = 'Données de comptes illisibles';

    const desc = document.createElement('div');
    desc.style.cssText = 'color:var(--fg-muted); font-size:13px; margin:8px 0 4px;';
    // textContent (pas innerHTML) : aucune donnée n'est interprétée en HTML.
    desc.textContent = hasBackup
      ? `La liste de comptes enregistrée ${why}. Une sauvegarde de ${backup.count} compte(s) a été trouvée. La restaurer ?`
      : `La liste de comptes enregistrée ${why} et aucune sauvegarde lisible n'est disponible. L'application démarre avec une liste vide ; le fichier actuel sera mis de côté (jamais supprimé) si vous créez ou modifiez un compte. Vos sessions de connexion ne sont pas touchées : recréer un compte avec le même nom de profil les retrouve.`;

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const close = () => overlay.remove();

    if (hasBackup) {
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = 'Ignorer';
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
        accounts = r.accounts;
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
