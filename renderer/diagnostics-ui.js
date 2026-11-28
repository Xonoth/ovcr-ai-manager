// ===== [OVCR] AI Manager — aide et diagnostic (renderer/diagnostics-ui.js) =====
//
// Phase 3, P6 lot 2 : code déplacé tel quel depuis renderer/app.js.
// Fenêtre « Comprendre les IA disponibles » (une fiche par service) et sa
// section Diagnostic (texte déjà expurgé par le processus principal, copie,
// dossier des journaux), plus la réinitialisation des autorisations des sites.
//
// Ne fait rien au chargement : app.js appelle OVCR.diagnosticsUi.init() au
// démarrage, au même moment qu'auparavant. Les fonctions window.* restent
// appelées par les boutons (data-cmd, délégation dans app.js).

(function () {
  'use strict';

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

  // ctx.api : pont window.ovcr ; ctx.SERVICES : liste des services (app.js).
  function init({ api, SERVICES }) {
    const { escapeHtml, showToast } = OVCR;
    const state = OVCR.state;

    // Modale d'aide « Comprendre les IA disponibles ». Liste régénérée à chaque
    // ouverture depuis SERVICES + SERVICE_INFO : un 10e service apparaîtra tout
    // seul (avec son nom au minimum si sa fiche SERVICE_INFO manque encore).
    // Purement informatif : ne touche ni comptes, ni cooldowns, ni webviews.
    window.openHelpModal = function() {
      const list = document.getElementById('helpList');
      list.hidden = false;                                  // toujours rouverte sur l'aide,
      document.getElementById('diagPanel').hidden = true;   // pas sur le diagnostic
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
      const ok = await api.sitePermissions.reset().catch(e => { console.error('[permissions] réinitialisation impossible :', e && e.message); return false; });
      showToast(ok ? 'Autorisations des sites réinitialisées' : 'Réinitialisation impossible', ok ? 'success' : 'error');
    }

    // --- Diagnostic (lot 3) : texte lisible, déjà expurgé par le main.
    let lastDiagnosticText = '';
    function formatDiagnostic(d) {
      const lines = [];
      lines.push(`[OVCR] AI Manager ${d.app.version}${d.app.packaged ? '' : ' (développement)'}`);
      lines.push(`Electron ${d.versions.electron} · Chromium ${d.versions.chrome} · ${d.os.platform} ${d.os.release} ${d.os.arch}`);
      lines.push(`Ouverte depuis ${d.uptimeMin} min · schéma des comptes : ${d.accountsSchema}`);
      const s = d.storage;
      lines.push(s
        ? `Stockage : ${s.status}${s.accounts !== undefined ? ', ' + s.accounts + ' compte(s)' : ''}${s.encrypted === false ? ', NON chiffré' : s.encrypted ? ', chiffré' : ''}${s.migrated ? ', migré ' + s.migrated : ''}${s.backupAvailable !== undefined ? ', sauvegarde ' + (s.backupAvailable ? 'disponible' : 'absente') : ''}`
        : 'Stockage : état inconnu');
      lines.push(`Écriture des comptes : ${state.storageWritable ? 'possible' : 'bloquée (' + (state.bannerKind || 'inconnu') + ')'}`);
      lines.push(`Mémoire totale : ${d.memory.totalMb} Mo`);
      for (const [type, m] of Object.entries(d.memory.byType)) lines.push(`  ${type} : ${m.count} processus, ${m.mb} Mo`);
      lines.push(`Panneaux : ${document.querySelectorAll('#webviewArea webview').length} ouvert(s), vue ${state.layoutMode === 2 ? 'scindée' : 'simple'}`);
      lines.push('', 'Derniers événements :');
      for (const e of d.recent) lines.push(`${e.t.slice(11, 19)} ${e.level.toUpperCase()} [${e.source}] ${e.message}`);
      return lines.join('\n');
    }
    window.showDiagnostic = async function() {
      const panel = document.getElementById('diagPanel');
      const text = document.getElementById('diagText');
      const list = document.getElementById('helpList');
      if (!panel.hidden) { panel.hidden = true; list.hidden = false; return; } // 2e clic : retour à l'aide
      text.textContent = 'Chargement…';
      panel.hidden = false;
      list.hidden = true;
      try {
        lastDiagnosticText = formatDiagnostic(await api.diag.get());
      } catch (e) {
        console.error('[diag] lecture impossible :', e && e.message);
        lastDiagnosticText = 'Diagnostic indisponible : ' + (e && e.message);
      }
      text.textContent = lastDiagnosticText; // textContent : aucun HTML interprété
    }
    window.copyDiagnostic = async function() {
      try {
        await navigator.clipboard.writeText(lastDiagnosticText);
        showToast('Diagnostic copié dans le presse-papiers');
      } catch (e) {
        console.warn('[diag] copie impossible :', e && e.message);
        showToast('Copie impossible : sélectionnez le texte et faites Ctrl+C.', 'warning');
      }
    }
    window.openLogsFolder = async function() {
      const ok = await api.diag.openLogs().catch(e => { console.error('[diag] dossier des journaux :', e && e.message); return false; });
      if (!ok) showToast('Impossible d\'ouvrir le dossier des journaux', 'error');
    }
    window.closeHelpModal = function() { document.getElementById('helpModal').classList.remove('open'); }
    // Fermeture par clic en dehors de la boîte (sur le fond assombri).
    document.getElementById('helpModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeHelpModal();
    });
  }

  OVCR.diagnosticsUi = { init };
})();
