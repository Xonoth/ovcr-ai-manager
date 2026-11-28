# [OVCR] AI Manager

**Un poste de travail de bureau (Windows) pour utiliser plusieurs services d'IA web avec plusieurs comptes, sans jongler entre navigateurs.** Chaque compte dispose de sessions isolées (cookies séparés), chaque IA s'ouvre dans un panneau intégré, et un suivi de « cooldown » 24 h par service aide à gérer les quotas gratuits.

Pensé à l'origine pour la communauté [OverCreep](https://overcreep.ovh), publié ici pour quiconque en a l'usage.

> **Avertissement de non-affiliation** — Ce projet n'est affilié à, ni approuvé par, aucun des fournisseurs d'IA mentionnés (Anthropic/Claude, OpenAI/ChatGPT, Google/Gemini, Perplexity, Z.ai, xAI/Grok, Leonardo AI, Suno, Meshy AI). Les noms et marques citées appartiennent à leurs propriétaires respectifs et ne sont utilisés qu'à des fins d'identification.
>
> **Responsabilité d'usage** — Cet outil n'utilise aucune API : il affiche les interfaces web officielles des services dans des panneaux intégrés (webviews), où vous vous connectez et interagissez vous-même, comme dans un navigateur. Vous restez seul responsable du respect des conditions d'utilisation de chaque service, notamment de leurs règles sur l'usage de plusieurs comptes.

## Aperçu

<!-- À COMPLÉTER : captures d'écran à fournir avant/après publication -->
![Vue principale — grille de comptes et panneau IA](docs/screenshot-main.png)
![Vue scindée — deux services côte à côte](docs/screenshot-split.png)

*(Captures à ajouter dans `docs/` — emplacements prévus ci-dessus.)*

## Fonctionnalités

- **Multi-comptes isolés** : chaque compte utilise une partition Electron dédiée (`persist:<profil>`) — cookies et sessions strictement séparés. L'unicité du profil est imposée par l'app.
- **9 services IA intégrés** : Claude, ChatGPT, Gemini, Perplexity, Z.ai, Grok, Leonardo AI (images), Suno (musique), Meshy AI (3D). En ajouter un est un pattern simple et documenté (voir [Contribuer](#contribuer)).
- **Suivi de quota (« cooldown ») 24 h** par service et par compte : un clic sur « Épuiser (24h) » marque le service comme vidé, avec compte à rebours visible et réactivation automatique (« ✓ Fini 14:05 »). Le suivi est **manuel** : l'app ne lit pas le quota réel des services. Annuler un cooldown en cours demande une confirmation ; une échéance incohérente (horloge de l'ordinateur modifiée) est signalée.
- **1 ou 2 panneaux IA** côte à côte, colonnes redimensionnables, bouton « Fermer le panneau 2 » pour libérer la mémoire de la webview cachée.
- **Export / import des comptes** (boutons de l'en-tête des comptes) : fichier JSON **en clair** (noms, e-mails, profils, cooldowns ; jamais de cookies ni de sessions), pour sauvegarder ou changer de PC. À l'import : résumé, et un choix pour les comptes en conflit (ignorer, remplacer, ou importer comme nouveaux comptes) ; copie de la liste actuelle faite avant.
- **Palette rapide (Ctrl+K)** : ouvrir n'importe quel service avec n'importe quel compte au clavier.
- **Page d'aide intégrée** (bouton `?`) : description et cas d'usage de chaque IA, pour les utilisateurs qui ne les connaissent pas toutes.
- **Éditeur de code intégré** (Monaco, celui de VS Code) avec explorateur de fichiers local — chargé paresseusement au premier clic, avec éditeur de secours si Monaco échoue.
- **Interface 100 % locale** : polices et icônes embarquées, aucun CDN, aucune télémétrie — l'app n'envoie rien à aucun serveur ; seuls les sites des IA sont contactés, dans leurs panneaux.
- **Stockage résilient** : écritures atomiques (jamais de fichier à moitié écrit, même en cas de coupure), sauvegarde automatique de la génération précédente, récupération proposée en cas de corruption ou de fichier manquant, aucune sauvegarde jamais écrasée sans copie, format de données versionné (une version plus ancienne relit toujours les comptes).
- **Erreurs claires dans les panneaux IA** : service injoignable, pas de connexion, certificat refusé, panneau planté ou figé → message explicite et actions (Réessayer, Recharger le service, Ouvrir dans le navigateur, Fermer le panneau, informations de diagnostic). Jamais confondu avec un quota.
- **Diagnostic local** (bouton `?` → « Diagnostic ») : versions, état du stockage, mémoire, derniers événements — expurgés (aucun e-mail ni URL complète), à copier pour signaler un problème. Journal dans `%APPDATA%\ai-manager\logs`. Rien n'est envoyé.

## Installation

### Utilisateur (binaire Windows)

Récupérez le zip de la [dernière release](../../releases), décompressez le dossier **en entier**, lancez `[OVCR] AI Manager.exe`. Au premier lancement, Windows SmartScreen affiche un avertissement (exécutable non signé) : « Informations complémentaires » → « Exécuter quand même ». Voir `DISTRIBUTION-LISEZ-MOI.txt` pour le détail.

### Développement

Prérequis : **Windows 10/11** (seule plateforme testée — `main.js` et le packaging ciblent win32 ; un portage Mac/Linux demanderait au minimum de revoir le packaging), **Node.js 22+** et npm.

```bash
git clone <url-du-repo>
cd ai-manager
npm install
npm start               # lance l'app en dev (electron .)
npm test                # tests unitaires (node:test)
npm run test:electron   # tests d'intégration (vrai Electron, données temporaires, sans réseau)
npm run test:perf       # mesures mémoire / fuites
npm run test:fuses      # fuses du .exe, sur une app jetable (dossier temporaire)
npm run test:cookies    # chiffrement des cookies : mise à jour, reconnexion, retour arrière (app jetable)
npm run lint            # ESLint
```

Les tests n'utilisent **jamais** votre vrai profil (`%APPDATA%\ai-manager`) ni le réseau : chaque scénario d'intégration tourne dans un dossier temporaire avec des pages de service factices. Ce qui ne peut pas être automatisé (connexions réelles aux services, OAuth, vraie coupure réseau) est listé dans [TESTS-MANUELS.md](TESTS-MANUELS.md).

### Construire l'exécutable

```bash
npm run dist
```

Produit `dist/[OVCR] AI Manager-win32-x64/` (l'exe a besoin du dossier complet — pour distribuer, zippez tout le dossier). Le script purge automatiquement les locales Chromium inutilisées et les traductions Monaco (−46 Mo), et applique puis vérifie les **fuses Electron** du `.exe` (`scripts/fuses.js`, voir [SECURITY.md](SECURITY.md) §2).

**Limitation connue** : le packaging utilise `@electron/packager`. `electron-builder` ne fonctionne pas sans droits administrateur ou Mode développeur Windows (création de liens symboliques) — c'est pourquoi il n'y a ni installateur ni exe portable mono-fichier, et pourquoi il n'est plus installé (seule sa config `build` reste dans `package.json`).

## Structure du projet

```
ai-manager/
├── index.html              # Interface : HTML + CSS + CSP
├── renderer/core.js        # Socle de l'interface : espace de noms window.OVCR, état partagé, diagnostics
├── renderer/*-ui.js, editor.js, layout.js, panes.js # Un script par zone de l'interface (comptes, stockage, éditeur, panneaux…)
├── renderer/app.js         # Démarrage de l'interface (JS vanilla, sans accès Node)
├── renderer/cooldowns.js   # États et libellés des cooldowns (fonctions pures)
├── renderer/pane-errors.js # Messages d'erreur des panneaux IA (fonctions pures)
├── app-preload.js          # Pont minimal interface -> processus principal (window.ovcr)
├── main.js                 # Process principal Electron : instance unique, fenêtre, IPC validés, durcissement navigation/popups/webviews
├── security-policy.js      # Règles de sécurité pures (liste blanche, partitions, expéditeur IPC)
├── atomic-file.js          # Écriture atomique des fichiers de données
├── diagnostics.js          # Journal local expurgé + erreurs non interceptées
├── file-access.js          # Accès aux fichiers de l'explorateur/éditeur (validation des chemins)
├── accounts-store.js       # Stockage chiffré des comptes (safeStorage), schéma versionné, migrations, récupération, retour arrière
├── accounts-transfer.js    # Export / import des comptes (format, validation, conflits ; fonctions pures)
├── browser-identity.js     # Identité navigateur (Firefox sur Google, Chrome ailleurs) pour la connexion Google
├── browser-identity-preload.js # Preload : aligne ce que voient les pages Google
├── site-permissions.js     # Autorisations des sites : question à l'utilisateur au lieu d'un accord d'office
├── assets/
│   ├── icons.js            # Icônes SVG inline (sous-ensemble Font Awesome + 2 dessinées) + hydrateIcons()
│   └── fonts/              # Polices WOFF2 locales (Space Grotesk, Inter, JetBrains Mono)
├── scripts/                # Outils de build (exclus du .exe) : purge des locales, fuses Electron
├── test/                   # Tests unitaires (node:test) et d'intégration (Electron) — exclus du .exe
├── eslint.config.js        # ESLint (développement uniquement)
├── TESTS-MANUELS.md        # Vérifications à faire à la main (services réels, OAuth, réseau…)
├── PROJECT_CONTEXT.md      # Documentation interne détaillée (architecture, historique des chantiers)
├── SECURITY.md             # Modèle de sécurité, stockage, limites restantes
└── DISTRIBUTION-LISEZ-MOI.txt # Notice utilisateur jointe au zip distribué
```

Pas de framework, pas de bundler, pas de TypeScript : JS vanilla en scripts classiques (`index.html` + `renderer/*.js`, partagés par l'espace de noms `window.OVCR`), volontairement. `PROJECT_CONTEXT.md` contient la documentation d'architecture complète pour qui veut contribuer.

## Sécurité et limites connues

Transparence complète — ce qui est fait, et ce qui ne l'est pas :

Le détail complet (modèle, migration, retour arrière, limites) est dans [SECURITY.md](SECURITY.md).

**Limites assumées (à connaître avant d'utiliser) :**
- Les comptes et, depuis la 1.5.0, les **sessions IA (cookies)** sont chiffrés (`safeStorage`/DPAPI), ce qui protège des autres comptes Windows et de la copie du dossier, mais pas d'un programme malveillant lancé sous le vôtre. Règle simple : **une session Windows = une personne** — n'utilisez pas l'app dans un compte Windows partagé.
- Les sessions ouvertes **avant** la 1.5.0 restent en clair tant que le service ne les renouvelle pas : se déconnecter puis se reconnecter les chiffre tout de suite. Le chiffrement est **irréversible** : revenir à une version antérieure efface toutes les sessions (reconnexion partout). Détail : [SECURITY.md](SECURITY.md) §5.
- L'exécutable distribué n'est **pas signé** (avertissement SmartScreen normal).

**Mesures en place :**
- **Interface sans accès à Node.js** : `nodeIntegration: false`, `contextIsolation: true`, sandbox Chromium pour tous les processus. L'interface ne parle au processus principal que par une API minimale (`window.ovcr`, une méthode par opération) ; chaque appel est validé côté processus principal et refusé s'il ne vient pas de la page locale de l'app.
- **Content Security Policy** stricte sur l'interface : aucun script inline, aucun `eval`, aucune connexion réseau.
- **Fichiers** : seul le dossier choisi par l'utilisateur est accessible (chemins normalisés et résolus, traversée `..\` et liens sortants refusés) ; on ne peut réenregistrer qu'un fichier ouvert dans l'éditeur ; binaires refusés, fichiers non UTF-8 en lecture seule, 20 Mo max.
- **Webviews** : préférences de sécurité imposées à la création, destination `https://` vers un service connu et partition de profil obligatoires.
- Échappement HTML systématique de toute donnée utilisateur injectée dans le DOM ; aucun `onclick` généré dynamiquement (délégation d'événements par `data-*`).
- La fenêtre hôte ne peut pas naviguer vers une URL distante ni ouvrir de fenêtre ; les popups des webviews sont filtrées par **liste blanche d'origines** (les 9 services + fournisseurs OAuth courants), tout le reste part dans le navigateur système (5 liens par minute et par page au plus). Une popup de connexion se ferme avec le panneau qui l'a ouverte.
- **Autorisations des sites demandées, plus accordées d'office** : position, micro, caméra, notifications, lecture du presse-papiers, capture d'écran et ouverture d'applications externes déclenchent une question (« Autoriser / Refuser », mémorisable par site). Le reste (USB, MIDI, série…) est refusé. Bouton « Réinitialiser les autorisations des sites » dans la page d'aide (`?`).
- **Exécutable durci (fuses Electron)** : le `.exe` ne peut plus servir de Node.js (`ELECTRON_RUN_AS_NODE`), ignore `NODE_OPTIONS` et `--inspect`, ne charge l'app que depuis `app.asar` et refuse de démarrer si cette archive a été modifiée ; depuis la 1.5.0, il chiffre les cookies des sessions.
- **Export des comptes en clair** (choix assumé, annoncé avant chaque export) : le fichier contient noms, e-mails, profils et cooldowns, **jamais** de cookies ni de sessions. Le chemin est choisi dans une boîte de dialogue du processus principal ; un import est validé strictement et précédé d'une copie de la liste actuelle.
- Garde-fous divers : unicité des profils (pas de partage de session accidentel), limite de taille des fichiers ouverts dans l'éditeur, stockage tolérant à la corruption avec backup, **une seule instance** de l'app à la fois (pas d'écritures concurrentes).
- Journal de diagnostic **local et expurgé** ; « Ouvrir dans le navigateur » n'accepte que l'adresse https d'un service connu.

Les issues de sécurité sont bienvenues — merci de les signaler de façon responsable.

## Contribuer

Projet maintenu en solo, contributions bienvenues — en particulier :

- **Ajouter un service IA** (le pattern est entièrement data-driven) : une entrée dans `SERVICES`, des variables de couleur `--<id>`/`--<id>-dim` + une classe `.svc-<id>`, une fiche `SERVICE_INFO` pour la page d'aide, et si besoin le domaine d'auth dans `ALLOWED_POPUP_HOSTS` (`main.js`). La migration attache automatiquement le nouveau service aux comptes existants.
- Corrections de bugs, améliorations de performance mesurées, durcissement sécurité (pistes ouvertes dans [SECURITY.md](SECURITY.md) §7 : signature, protocole `app://`).

Règles du projet : JS vanilla sans dépendance nouvelle, toute donnée utilisateur passe par `escapeHtml()`, aucun script ni `onclick` inline (CSP), tout accès disque passe par une méthode dédiée de `window.ovcr` validée dans le processus principal, les écritures de comptes passent par `saveAccounts()`, les listes cliquables utilisent la délégation d'événements. Lisez `PROJECT_CONTEXT.md` avant une contribution non triviale. Fork → branche → pull request.

## Licence

[MIT](LICENSE). Composants tiers (polices OFL, icônes Font Awesome CC BY 4.0, Monaco MIT) : voir [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Crédits

Développé pour la communauté **[OverCreep](https://overcreep.ovh)** (le thème violet/rose vient de là). Merci aux membres qui ont servi de bêta-testeurs.
