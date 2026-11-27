// ===== Erreurs des panneaux IA : classification et messages =====
//
// Fonctions PURES (aucun accès au DOM) : chargé en script classique par
// index.html (expose window.OVCRPaneErrors) et testable sous Node
// (test/unit/pane-errors.test.js).
//
// Règle : une erreur de chargement n'est JAMAIS présentée comme un problème
// de quota ou de cooldown — l'app ne sait pas détecter un quota épuisé, et
// une page qui ne charge pas n'en dit rien. Les messages décrivent seulement
// ce qui est observé (réseau, site, certificat, panneau arrêté).
//
// Codes : liste des erreurs réseau de Chromium (net/base/net_error_list.h).

(function (root) {
  'use strict';

  const ABORTED = -3; // navigation remplacée (redirection, nouveau clic) : normal

  const KINDS = {
    offline: {
      title: 'Pas de connexion Internet',
      detail: 'Le service n\'a pas pu être joint car l\'ordinateur semble hors ligne. Vérifiez votre connexion, puis réessayez.'
    },
    dns: {
      title: 'Site introuvable',
      detail: 'L\'adresse du service n\'a pas pu être résolue. Vérifiez votre connexion Internet ; si elle fonctionne, le service est peut-être momentanément indisponible.'
    },
    timeout: {
      title: 'Le service met trop de temps à répondre',
      detail: 'Le serveur n\'a pas répondu à temps. Il est peut-être surchargé : réessayez dans un instant.'
    },
    unreachable: {
      title: 'Service injoignable',
      detail: 'La connexion au service a été refusée ou interrompue. Il est peut-être momentanément indisponible, ou bloqué par un pare-feu ou un VPN.'
    },
    certificate: {
      title: 'Connexion non sécurisée refusée',
      detail: 'Le certificat de sécurité du site n\'a pas pu être vérifié. Le chargement a été arrêté pour vous protéger (réseau public, antivirus qui inspecte le trafic, ou date de l\'ordinateur incorrecte).'
    },
    blocked: {
      title: 'Chargement bloqué',
      detail: 'La page a été bloquée (redirections en boucle, contenu refusé ou adresse non autorisée).'
    },
    generic: {
      title: 'La page n\'a pas pu se charger',
      detail: 'Une erreur réseau a empêché le chargement du service.'
    },
    crashed: {
      title: 'Le panneau s\'est arrêté',
      detail: 'Le processus qui affichait ce service s\'est arrêté de façon inattendue. Rechargez le service : votre session de connexion est conservée.'
    },
    unresponsive: {
      title: 'Le service ne répond plus',
      detail: 'La page est bloquée (script trop long ou mémoire saturée). Vous pouvez attendre qu\'elle se débloque ou recharger le service.'
    }
  };

  const BY_CODE = {
    '-106': 'offline',          // ERR_INTERNET_DISCONNECTED
    '-105': 'dns',              // ERR_NAME_NOT_RESOLVED
    '-137': 'dns',              // ERR_NAME_RESOLUTION_FAILED
    '-7': 'timeout',            // ERR_TIMED_OUT
    '-118': 'timeout',          // ERR_CONNECTION_TIMED_OUT
    '-102': 'unreachable',      // ERR_CONNECTION_REFUSED
    '-109': 'unreachable',      // ERR_ADDRESS_UNREACHABLE
    '-100': 'unreachable',      // ERR_CONNECTION_CLOSED
    '-101': 'unreachable',      // ERR_CONNECTION_RESET
    '-104': 'unreachable',      // ERR_CONNECTION_FAILED
    '-21': 'unreachable',       // ERR_NETWORK_CHANGED
    '-130': 'unreachable',      // ERR_PROXY_CONNECTION_FAILED
    '-20': 'blocked',           // ERR_BLOCKED_BY_CLIENT
    '-27': 'blocked',           // ERR_BLOCKED_BY_RESPONSE
    '-301': 'blocked',          // ERR_DISALLOWED_URL_SCHEME
    '-310': 'blocked'           // ERR_TOO_MANY_REDIRECTS
  };

  // Faut-il afficher un écran d'erreur pour cet échec de chargement ?
  function isRelevantFailure(code, isMainFrame) {
    return !!isMainFrame && Number.isFinite(code) && code !== ABORTED && code < 0;
  }

  // Code d'erreur réseau -> { kind, title, detail }. `online` : état
  // navigator.onLine au moment de l'échec (hors ligne -> « Pas de connexion »).
  function classifyLoadError(code, online) {
    let kind = BY_CODE[String(code)];
    if (!kind && code <= -200 && code > -300) kind = 'certificate';
    if (!kind) kind = 'generic';
    if (online === false && (kind === 'dns' || kind === 'unreachable' || kind === 'timeout' || kind === 'generic')) kind = 'offline';
    return { kind, ...KINDS[kind] };
  }

  // Motif d'arrêt d'un processus (render-process-gone) -> message.
  function classifyCrash(reason) {
    const extra = {
      oom: ' Cause probable : mémoire insuffisante. Fermer l\'autre panneau peut aider.',
      killed: ' Le processus a été arrêté par le système ou un autre programme.',
      'launch-failed': ' Le processus n\'a pas pu démarrer.'
    }[reason] || '';
    return { kind: 'crashed', title: KINDS.crashed.title, detail: KINDS.crashed.detail + extra };
  }

  function unresponsive() {
    return { kind: 'unresponsive', ...KINDS.unresponsive };
  }

  // Hôte seul d'une URL (jamais le chemin ni la query : jetons possibles).
  function hostOf(url) {
    try { return new URL(url).host || '(inconnu)'; } catch (_) { return '(inconnu)'; }
  }

  const api = { isRelevantFailure, classifyLoadError, classifyCrash, unresponsive, hostOf, KINDS, ABORTED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OVCRPaneErrors = api;
})(typeof window !== 'undefined' ? window : globalThis);
