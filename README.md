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
- **Suivi de quota (« cooldown ») 24 h** par service et par compte : un clic sur « Épuiser (24h) » marque le service comme vidé, avec compte à rebours visible et réactivation automatique.
- **1 ou 2 panneaux IA** côte à côte, colonnes redimensionnables, bouton « Fermer le panneau 2 » pour libérer la mémoire de la webview cachée.
- **Palette rapide (Ctrl+K)** : ouvrir n'importe quel service avec n'importe quel compte au clavier.
- **Page d'aide intégrée** (bouton `?`) : description et cas d'usage de chaque IA, pour les utilisateurs qui ne les connaissent pas toutes.
- **Éditeur de code intégré** (Monaco, celui de VS Code) avec explorateur de fichiers local — chargé paresseusement au premier clic, avec éditeur de secours si Monaco échoue.
- **Interface 100 % locale** : polices et icônes embarquées, aucun CDN, aucune télémétrie — l'app n'envoie rien à aucun serveur ; seuls les sites des IA sont contactés, dans leurs panneaux.
- **Stockage résilient** : sauvegarde automatique d'une génération des données de comptes, récupération proposée en cas de corruption.

## Installation

### Utilisateur (binaire Windows)

Récupérez le zip de la [dernière release](../../releases), décompressez le dossier **en entier**, lancez `[OVCR] AI Manager.exe`. Au premier lancement, Windows SmartScreen affiche un avertissement (exécutable non signé) : « Informations complémentaires » → « Exécuter quand même ». Voir `DISTRIBUTION-LISEZ-MOI.txt` pour le détail.

### Développement

Prérequis : **Windows 10/11** (seule plateforme testée — `main.js` et le packaging ciblent win32 ; un portage Mac/Linux demanderait au minimum de revoir le packaging), **Node.js 18+** et npm.

```bash
git clone <url-du-repo>
cd ai-manager
npm install
npm start          # lance l'app en dev (electron .)
```

### Construire l'exécutable

```bash
npm run dist
```

Produit `dist/[OVCR] AI Manager-win32-x64/` (l'exe a besoin du dossier complet — pour distribuer, zippez tout le dossier). Le script purge automatiquement les locales Chromium inutilisées et les traductions Monaco (−46 Mo).

**Limitation connue** : le packaging utilise `@electron/packager`. `electron-builder` ne fonctionne pas sans droits administrateur ou Mode développeur Windows (création de liens symboliques) — c'est pourquoi il n'y a ni installateur ni exe portable mono-fichier, et pourquoi il n'est plus installé (seule sa config `build` reste dans `package.json`).

## Structure du projet

```
ai-manager/
├── index.html              # Interface : HTML + CSS + CSP
├── renderer/app.js         # Logique de l'interface (JS vanilla, sans accès Node)
├── app-preload.js          # Pont minimal interface -> processus principal (window.ovcr)
├── main.js                 # Process principal Electron : fenêtre, IPC validés, durcissement navigation/popups/webviews
├── file-access.js          # Accès aux fichiers de l'explorateur/éditeur (validation des chemins)
├── accounts-store.js       # Stockage chiffré des comptes (safeStorage) + migration/retour arrière
├── browser-identity.js     # Identité navigateur (Firefox sur Google, Chrome ailleurs) pour la connexion Google
├── browser-identity-preload.js # Preload : aligne ce que voient les pages Google
├── site-permissions.js     # Autorisations des sites : question à l'utilisateur au lieu d'un accord d'office
├── assets/
│   ├── icons.js            # 20 icônes SVG inline (sous-ensemble Font Awesome) + hydrateIcons()
│   └── fonts/              # Polices WOFF2 locales (Space Grotesk, Inter, JetBrains Mono)
├── scripts/prune-locales.js # Post-build : purge des locales Chromium inutilisées
├── PROJECT_CONTEXT.md      # Documentation interne détaillée (architecture, historique des chantiers)
├── SECURITY.md             # Modèle de sécurité, stockage, limites restantes
└── DISTRIBUTION-LISEZ-MOI.txt # Notice utilisateur jointe au zip distribué
```

Pas de framework, pas de bundler, pas de TypeScript : JS vanilla en scripts classiques (`index.html` + `renderer/app.js`), volontairement. `PROJECT_CONTEXT.md` contient la documentation d'architecture complète pour qui veut contribuer.

## Sécurité et limites connues

Transparence complète — ce qui est fait, et ce qui ne l'est pas :

Le détail complet (modèle, migration, retour arrière, limites) est dans [SECURITY.md](SECURITY.md).

**Limites assumées (à connaître avant d'utiliser) :**
- **Les sessions IA (cookies) sont stockées en clair** dans `%APPDATA%\ai-manager\Partitions` (gérées par Chromium). Les métadonnées de comptes, elles, sont désormais chiffrées (`safeStorage`/DPAPI), ce qui protège des autres comptes Windows mais pas d'un programme malveillant lancé sous le vôtre. Règle simple : **une session Windows = une personne** — n'utilisez pas l'app dans un compte Windows partagé.
- L'exécutable distribué n'est **pas signé** (avertissement SmartScreen normal).

**Mesures en place :**
- **Interface sans accès à Node.js** : `nodeIntegration: false`, `contextIsolation: true`, sandbox Chromium pour tous les processus. L'interface ne parle au processus principal que par une API minimale (`window.ovcr`, une méthode par opération) ; chaque appel est validé côté processus principal et refusé s'il ne vient pas de la page locale de l'app.
- **Content Security Policy** stricte sur l'interface : aucun script inline, aucun `eval`, aucune connexion réseau.
- **Fichiers** : seul le dossier choisi par l'utilisateur est accessible (chemins normalisés et résolus, traversée `..\` et liens sortants refusés) ; on ne peut réenregistrer qu'un fichier ouvert dans l'éditeur ; binaires refusés, fichiers non UTF-8 en lecture seule, 20 Mo max.
- **Webviews** : préférences de sécurité imposées à la création, destination `https://` vers un service connu et partition de profil obligatoires.
- Échappement HTML systématique de toute donnée utilisateur injectée dans le DOM ; aucun `onclick` généré dynamiquement (délégation d'événements par `data-*`).
- La fenêtre hôte ne peut pas naviguer vers une URL distante ni ouvrir de fenêtre ; les popups des webviews sont filtrées par **liste blanche d'origines** (les 9 services + fournisseurs OAuth courants), tout le reste part dans le navigateur système.
- **Autorisations des sites demandées, plus accordées d'office** : position, micro, caméra, notifications, lecture du presse-papiers, capture d'écran et ouverture d'applications externes déclenchent une question (« Autoriser / Refuser », mémorisable par site). Le reste (USB, MIDI, série…) est refusé. Bouton « Réinitialiser les autorisations des sites » dans la page d'aide (`?`).
- Garde-fous divers : unicité des profils (pas de partage de session accidentel), limite de taille des fichiers ouverts dans l'éditeur, stockage tolérant à la corruption avec backup.

Les issues de sécurité sont bienvenues — merci de les signaler de façon responsable.

## Contribuer

Projet maintenu en solo, contributions bienvenues — en particulier :

- **Ajouter un service IA** (le pattern est entièrement data-driven) : une entrée dans `SERVICES`, des variables de couleur `--<id>`/`--<id>-dim` + une classe `.svc-<id>`, une fiche `SERVICE_INFO` pour la page d'aide, et si besoin le domaine d'auth dans `ALLOWED_POPUP_HOSTS` (`main.js`). La migration attache automatiquement le nouveau service aux comptes existants.
- Corrections de bugs, améliorations de performance mesurées, durcissement sécurité (pistes ouvertes dans [SECURITY.md](SECURITY.md) §7 : fuses Electron, signature).

Règles du projet : JS vanilla sans dépendance nouvelle, toute donnée utilisateur passe par `escapeHtml()`, aucun script ni `onclick` inline (CSP), tout accès disque passe par une méthode dédiée de `window.ovcr` validée dans le processus principal, les écritures de comptes passent par `saveAccounts()`, les listes cliquables utilisent la délégation d'événements. Lisez `PROJECT_CONTEXT.md` avant une contribution non triviale. Fork → branche → pull request.

## Licence

[MIT](LICENSE). Composants tiers (polices OFL, icônes Font Awesome CC BY 4.0, Monaco MIT) : voir [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Crédits

Développé pour la communauté **[OverCreep](https://overcreep.ovh)** (le thème violet/rose vient de là). Merci aux membres qui ont servi de bêta-testeurs.
