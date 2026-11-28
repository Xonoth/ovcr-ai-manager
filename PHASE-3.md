# Phase 3 — Préparation (document de reprise)

> Rédigé le 28 novembre 2026, à la fin de la phase 2 (version **1.2.0**).
> Destiné à la **prochaine session** (humaine ou IA) qui démarre la phase 3 :
> tout ce qu'il faut savoir pour repartir sans refaire l'enquête.
> Ce fichier n'est pas embarqué dans le `.exe`.

> **Avancement (28 novembre 2026)** — **P1 fait** en version **1.3.0** (Electron 45.3.2, Chromium 156, `safeStorage` asynchrone), tous les tests automatiques verts (112 unitaires, 143 vérifications d'intégration, perf, lint) ; détail dans PROJECT_CONTEXT §13 « Phase 3 ». **Validée à la main par l'utilisateur** (`TESTS-MANUELS.md` §0 ter), zip `dist/OVCR-AI-Manager-1.3.0.zip` créé. Pas de release GitHub. Corrections des faits datés ci-dessous : la fin de vie de la 43 est annoncée pour **janvier 2027** (et non mi-décembre) ; 43.8.13 existe ; `package.json` est désormais en version figée. Décisions P2 à P9 (§4) : **pas encore prises**. Nouveau point pour P8 : vérifier qu'un arrêt brutal juste après le tout premier chiffrement ne rend pas `accounts.json` illisible (la clé vit dans `Local State`, écrit surtout à la fermeture).
>
> **P2 fait** en version **1.4.0** (28/11/2026) : fuses appliqués par `npm run dist` (`scripts/fuses.js`), vérifiés par `npm run test:fuses` sur une app jetable (19/19) ; `EnableEmbeddedAsarIntegrityValidation` fonctionne sous Windows avec electron-packager 20.3.0 (empreinte `ELECTRONASAR` déjà écrite) ; Monaco (`app.asar.unpacked`) reste chargeable. `EnableCookieEncryption` **non activé** (P3 en attente de décision), `GrantFileProtocolExtraPrivileges` laissé activé (P5). Détail : PROJECT_CONTEXT §13 « Phase 3 — P2 ». **Validée à la main par l'utilisateur** (`TESTS-MANUELS.md` §0 bis), zip `dist/OVCR-AI-Manager-1.4.0.zip` créé. Pas de release GitHub. Prochaine décision : P3 (cookies chiffrés).
>
> **P3 fait** en version **1.5.0** (28/11/2026, décision de l'utilisateur) : `EnableCookieEncryption` activé dans `scripts/fuses.js`. **Correction du §3 P3** : le passage ne chiffre **pas** les cookies existants. Ils restent lisibles, mais en clair, jusqu'à ce que le service les réécrive. L'utilisateur a choisi de ne pas les rechiffrer automatiquement : la doc indique de se déconnecter puis se reconnecter pour protéger un compte tout de suite. Le retour arrière est pire que prévu : une version sans le fuse efface **tous** les cookies, y compris ceux restés en clair. Vérifié par `npm run test:cookies` (17/17). Détail : PROJECT_CONTEXT §13 « Phase 3 — P3 », SECURITY.md §5. **Validée à la main par l'utilisateur** (`TESTS-MANUELS.md` §0), zip `dist/OVCR-AI-Manager-1.5.0.zip` créé. Pas de release GitHub. Ensuite, ordre conseillé : P8 → P6 → P7 → P5 → P9.
>
> **P8 fait** en version **1.6.0** (28/11/2026), **validé à la main par l'utilisateur** (`TESTS-MANUELS.md`, section « Version 1.6.0 »), zip `dist/OVCR-AI-Manager-1.6.0.zip` créé. Pas de release GitHub. Le risque noté après P1 était réel : sur un profil neuf, un arrêt brutal dans les ~10 s qui suivent le premier chiffrement rendait les comptes indéchiffrables. Corrigé : écriture provisoire en clair tant que la clé n'est pas dans `Local State`, puis rechiffrement automatique, et clé créée dès le démarrage. Également faits : F4 (5 liens externes par minute et par page), F5 (popups fermées avec leur page d'origine), F6 (`scripts/dist.js`, version lue dans `package.json`), tests automatisés de la boîte d'échec d'une popup et de la fermeture des popups, ménage des dossiers temporaires des tests, `undici` 7.30.2. **Reportés** : l'écran « ne répond plus » et la vraie coupure réseau restent manuels (aucun moyen fiable trouvé) ; `eslint` 10.16.0 et `@electron/packager` 20.3.1 (publiés le 27/11) pas avant le **11/12/2026**. Détail : PROJECT_CONTEXT §13 « Phase 3 — P8 ». Ensuite : P6 → P7 → P5 → P9.
>
> **P6 en cours** (branche locale `phase3-p6`, décisions de l'utilisateur le 28/11/2026) : 8 lots, un commit local par lot, une seule version **1.7.0** à la fin. Les noms `window.*` appelés par les boutons ne changent pas ; `OVCRCooldowns` et `OVCRPaneErrors` restent tels quels ; `exportAccountsJSON` et `importAccountsJSON` seront déplacés sans modification. **Lot 0 fait** (tests seulement, aucun code de l'app touché) : scénarios `ui-editor.js` (Monaco chargé à la demande, dossier choisi, saisie clavier, Ctrl+S vérifié sur le disque, refus non UTF-8 / trop gros / binaire, éditeur de secours avec `loader.js` bloqué) et `ui-basics.js` (palette, vue scindée, repli, ajout / modification / suppression, largeurs mémorisées) ; intégration : 264 vérifications. **Lot 1 fait** : `renderer/core.js` (chargé juste avant `app.js`) crée `window.OVCR` (non remplaçable, extensible par les modules) avec l'état partagé `OVCR.state` (`accounts`, `storageWritable`, `bannerKind`, `loadResult`, `dataCorrupt`, `activeAccountId`, `activePaneId`, `layoutMode`, `collapsedAccounts`), `escapeHtml`, `showToast`, `diag`, `showStartupError` ; `app.js` affiche un message si `core.js` manque (testé) ; le test de l'écran d'échec appelle désormais `OVCR.showStartupError`. Intégration : 265. **Lot 2 fait** : `renderer/diagnostics-ui.js` (`OVCR.diagnosticsUi.init({ api, SERVICES })`) reçoit tel quel l'aide (`SERVICE_INFO` compris) et le diagnostic ; tests ajoutés d'abord dans `diagnostics.js` : copie (presse-papiers simulé **dans la page**, jamais le vrai), dossier des journaux (`shell.openPath` simulé, l'Explorateur n'est pas lancé), réinitialisation des autorisations, fermeture de l'aide. Intégration : 276. **Lot 3 fait** : `renderer/editor.js` (`OVCR.editor.init({ api })`, `OVCR.editor.ensureMonacoLoaded()` appelé par `toggleIdePanel`) reçoit tel quel le chargeur de Monaco, l'éditeur de secours, `FILE_ERRORS`, l'enregistrement et les fichiers ; les variables de l'éditeur y restent privées. `dist.test.js` vérifie que les nouveaux scripts sont embarqués. Lots suivants : 4 `panes.js` → 5 `accounts-ui.js` → 6 `storage-ui.js` → 7 `app.js` réduit.

---

## 0. Comment démarrer la session

1. Lire, dans cet ordre : ce fichier, `PROJECT_CONTEXT.md` (§3 structure, §5 données, §13 « Phase 1 » et « Phase 2 »), `SECURITY.md` (§6 limites, §7 pistes), `TESTS-MANUELS.md`.
2. Vérifier que le point de départ est intact :
   ```powershell
   git log --oneline -3      # attendu : 3d7abe0 (doc 1.2.0), a3d8823 (phase 2), c7a4fa7 (phase 1) — ou plus récent
   npm ci
   npm run lint
   npm test                  # attendu : 99/99
   npm run test:electron     # attendu : 111/111
   ```
   Si un de ces résultats diffère, **s'arrêter et comprendre pourquoi** avant toute modification.
3. Vérifier les faits datés de ce document (versions d'Electron, alertes `npm audit`) : ils vieillissent.
4. Suivre la méthode du §5 : **audit → plan → validation explicite de l'utilisateur → petits lots testés**.

Prompt de démarrage suggéré :

> « On démarre la phase 3 d'OVCR AI Manager. Lis `PHASE-3.md`, `PROJECT_CONTEXT.md`, `SECURITY.md` et `TESTS-MANUELS.md`, vérifie le point de départ (§0), refais un audit rapide des chantiers du §3 avec les versions actuelles, puis propose-moi un plan par lots et les décisions du §4. Ne modifie rien avant ma validation. »

---

## 1. Point de départ (fin de phase 2)

| Élément | État |
|---|---|
| Version | **1.2.0** — `main` = `3d7abe0`, poussé sur GitHub ; zip `dist/OVCR-AI-Manager-1.2.0.zip` ; validée à la main par l'utilisateur |
| Electron | **43.8.10** (Chromium 150.0.7871.250) |
| Tests | 99 unitaires (`npm test`), 111 vérifications d'intégration (`npm run test:electron`), mesures (`npm run test:perf`), ESLint 0 signalement (`npm run lint`) |
| Données | `accounts.json` chiffré (safeStorage), `schema: 1`, migrations prêtes (`MIGRATIONS` vide) ; préférences `prefs_schema: 1` ; `site-permissions.json` `$schema: 1` |
| Release GitHub | **aucune** créée pour la 1.2.0 (le README pointe vers « la dernière release » : à décider) |

Ce que la phase 2 a mis en place et qui **sert de filet** à la phase 3 :
- tests d'intégration qui lancent un vrai Electron, avec un dossier de données temporaire et **sans réseau** (pages de service factices via `session.protocol.handle`) ;
- `security-policy.js` : règles de sécurité pures et testées (liste blanche, partitions, expéditeur IPC) ;
- `atomic-file.js`, `diagnostics.js`, versionnement des données, mode protégé du renderer.

---

## 2. Contraintes héritées (non négociables sans accord explicite)

- Ne jamais affaiblir la phase 1 : renderer sans Node, `contextIsolation`, sandbox, CSP sans inline/`eval`, IPC à expéditeur vérifié et paramètres validés **dans le main**, webviews `https` + liste blanche + partition `persist:`.
- JS vanilla en **scripts classiques** : pas de React/Vue, pas de TypeScript, pas de bundler.
- Ne supprimer aucune fonctionnalité ; ne pas changer l'identité visuelle (variables CSS du thème).
- Ne jamais perdre de données utilisateur ; ne pas casser les sessions persistantes (`Partitions/`).
- Ne pas changer les URLs des services sans nécessité.
- Pas de dépendance inutile ; versions **figées**, publiées depuis **au moins deux semaines**.
- Pas de release, de commit ni de push sans autorisation. Ne jamais dire qu'un test est passé s'il n'a pas été lancé.
- Les tests ne touchent **jamais** le vrai profil (`%APPDATA%\ai-manager`) ni le réseau. **Ne pas lancer le `.exe` packagé pendant les tests automatiques** : il utilise le vrai profil.

---

## 3. Chantiers candidats

Classés par priorité recommandée. Pour chacun : pourquoi, ce qu'on sait déjà, ce qu'il faut toucher, les risques, les tests, les décisions à demander.

### P1 — Monter Electron 43 → 45 (urgent, avant mi-décembre 2026)

**Pourquoi.** Electron ne maintient que les **3 dernières versions majeures**. Sorties : 43.0.0 le 30/06/2026, 44.0.0 le 25/08, 45.0.0 le 21/10 (45.5.0 = `latest` au 28/11). Au rythme de 8 semaines, la **46 devrait sortir vers mi-décembre 2026** : la 43 n'aura alors plus de correctifs de sécurité. *Dates à revérifier en début de session (`npm view electron time --json`).*

**Ce qui change.** Chromium change de version majeure. Or `browser-identity.js` reconstruit l'identité Chrome à partir de `process.versions.chrome` :
- `brandList()` calcule la marque « GREASE » et l'ordre des marques **selon le numéro de version majeure** (algorithme de Chromium : à revérifier pour la nouvelle version) ;
- l'UA Firefox présenté à Google se calcule d'après la date (`firefoxMajor()`) : rien à faire, mais vérifier qu'il reste plausible ;
- `app.commandLine.appendSwitch('disable-features', 'FedCm')` : vérifier que le nom de la fonctionnalité existe toujours ;
- relire les notes de version (« breaking changes ») de 44 et 45 : API `<webview>`, `session.registerPreloadScript`, `protocol.handle`, `webContents.debugger`, `will-attach-webview`, `setPermissionRequestHandler` / `CheckHandler`, `app.getAppMetrics`.

**Fichiers.** `package.json`, `browser-identity.js` (si l'algorithme des marques a changé), éventuellement `main.js` / `site-permissions.js` selon les changements d'API.

**Risques.** Connexion Google refusée (le point le plus fragile du projet, voir PROJECT_CONTEXT §13 « Connexion Google bloquée en webview ») ; régressions des popups OAuth.

**Tests.** Toute la batterie automatique, **plus** la section 2 de `TESTS-MANUELS.md` (connexions réelles aux 9 services, popups « Continuer avec Google »), à faire par l'utilisateur. Garder le zip 1.2.0 comme solution de repli.

**Décision utilisateur.** Cible 45.x (recommandé) ou rester en 43.x jusqu'à sa fin de vie.

### P2 — Fuses Electron (durcissement du `.exe`)

**Pourquoi.** Aujourd'hui, n'importe quel programme peut lancer le `.exe` comme un simple Node.js (`ELECTRON_RUN_AS_NODE`), injecter du code via `NODE_OPTIONS` ou `--inspect`, ou modifier `app.asar` sans être détecté (SECURITY.md §6).

**Outil.** `@electron/fuses`, à appliquer **après** le packaging (étape à ajouter dans `npm run dist`, avant `prune-locales.js`). Version vue le 28/11 : 2.1.3 (29/06/2026). Dépendance de développement uniquement.

| Fuse | Cible proposée | Remarques |
|---|---|---|
| `RunAsNode` | désactivé | Sans effet sur le dev ni sur les tests (les fuses ne touchent que le binaire packagé). |
| `EnableNodeOptionsEnvironmentVariable` | désactivé | |
| `EnableNodeCliInspectArguments` | désactivé | Plus de débogage du `.exe` packagé (le dev reste débogable). |
| `EnableEmbeddedAsarIntegrityValidation` | activé | **À vérifier** : support sous Windows dans Electron 43/45, et calcul de l'intégrité par `@electron/packager` 20.3.0 (sinon l'app refuse de démarrer). |
| `OnlyLoadAppFromAsar` | activé | L'app est déjà en asar ; Monaco est dans `app.asar.unpacked` (à revérifier). |
| `GrantFileProtocolExtraPrivileges` | **laisser tel quel** tant que l'interface est en `file://` | Le désactiver est lié au chantier P5 (`app://`). |
| `EnableCookieEncryption` | **décision utilisateur** | Voir P3. |

**Tests.** Script de vérification qui lit l'état des fuses du `.exe` produit (`@electron/fuses` sait les lire) ; vérifier que `ELECTRON_RUN_AS_NODE=1 "[OVCR] AI Manager.exe" -e "…"` ne lance plus Node ; lancer le `.exe` à la main (utilisateur) : démarrage, Monaco, services.

### P3 — Chiffrement des cookies de session (décision irréversible)

**Pourquoi.** Les sessions IA (`Partitions/<profil>/`) sont en clair : copier ce dossier suffit à se connecter aux comptes. Le fuse `EnableCookieEncryption` les chiffre avec la clé du compte Windows (même protection que `accounts.json`).

**Le piège.** Le passage de clair à chiffré se fait tout seul et sans perte. En revanche, **revenir en arrière est impossible** : une version sans ce fuse (1.2.0 ou antérieure) ne relit plus les cookies, et toutes les sessions sont perdues, donc **reconnexion à tous les services**. Le retour à la 1.0.4 (`--revert-storage-migration`) en perdrait aussi les sessions.

**À faire si l'utilisateur dit oui.**
- l'annoncer clairement dans `DISTRIBUTION-LISEZ-MOI.txt` (« après cette version, revenir en arrière demande de se reconnecter partout ») ;
- le tester sur une **copie** de profil : sessions conservées au passage, puis comportement d'une ancienne version ;
- mettre à jour SECURITY.md §5-6.

### P4 — Signature de l'exécutable

**Pourquoi.** Supprime l'avertissement SmartScreen et permet de vérifier l'éditeur du `.exe`.

**Prérequis hors code** (décision et coût pour l'utilisateur) : un certificat de signature de code (OV ou EV) ou un service de signature (ex. Azure Trusted Signing). **Rien n'est faisable sans.** `@electron/packager` sait signer sous Windows (option `windowsSign`, via `@electron/windows-sign` déjà présent dans `node_modules`). Le secret de signature ne doit **jamais** être commité.

### P5 — Interface en `app://` au lieu de `file://` (moyen terme, à évaluer)

**Pourquoi.** Donner à l'interface une origine propre, et pouvoir désactiver `GrantFileProtocolExtraPrivileges`.

**Ce que ça touche (relevé du code actuel) :**
- `security-policy.js` `isAppIndexUrl()` et `isTrustedSender()` : reconnaissent l'interface par son chemin `file:` ;
- `main.js` : `win.loadFile(INDEX_PATH)` et le contrôle `will-navigate` ;
- `site-permissions.js` : l'origine `file://` reçoit `APP_UI_ALLOW` (presse-papiers, plein écran) ;
- **localStorage** : changer d'origine, c'est changer de stockage. Il faut migrer `prefs_schema`, `ide_w`, `explorer_w` et `collapsed_accounts`. Il faut aussi gérer les clés 1.0.4 (`ai_accounts`, `ai_accounts_backup`), que la migration d'origine lit et que **le retour arrière `--revert-storage-migration` réécrit dans le localStorage de l'origine `file://`** : soit ce retour arrière est conservé et adapté, soit il est abandonné explicitement, avec l'accord de l'utilisateur ;
- `renderer/app.js` `loadMonaco()` : URL calculée depuis `location.href` ;
- la CSP, et les tests (`smoke.js`, `security-policy.test.js`).

**Avis.** Gain réel mais modeste, et risque moyen. À faire **après** P1/P2, ou à reporter.

### P6 — Découpage progressif de `renderer/app.js`

**Constat.** 1 653 lignes ; une seule fonction `initApp()` qui contient 58 fonctions et méthodes `window.*` ; état partagé par fermeture (`accounts`, `storageWritable`, `layoutMode`, etc.).

**Approche proposée** (sans bundler, scripts classiques chargés dans l'ordre par `index.html`) :
- un espace de noms unique `window.OVCR` (état + services), créé par le premier script ;
- un module par lot, **un lot à la fois**, chacun suivi de toute la batterie de tests. Ordre suggéré : `diagnostics-ui` → `editor` (Monaco + secours + fichiers) → `panes` (`mountService`, `closePane`, hors ligne) → `accounts-ui` (rendu, modales, cooldowns) → `storage-ui` (chargement, mode protégé, récupération, bandeaux) → `app.js` réduit au démarrage ;
- mettre à jour la liste des globales de `eslint.config.js` à chaque lot ;
- **interdit** : changer un comportement dans le même lot qu'un déplacement de code.

**Risque.** Ordre de chargement et variables partagées. Le filet, ce sont les 10 scénarios d'intégration, à compléter si une zone n'est pas couverte (l'éditeur Monaco ne l'est presque pas : ajouter un scénario « ouvrir un dossier temporaire, éditer, Ctrl+S » **avant** de déplacer ce code).

### P7 — Export / import des comptes (fonctionnalité)

**Existant.** `exportAccountsJSON()` / `importAccountsJSON()` dans `renderer/app.js` (fondations, aucune interface).

**Conception proposée.**
- l'interface ne choisit jamais de chemin : nouveaux canaux `accounts:export` / `accounts:import` dans le main, avec les boîtes « Enregistrer sous » / « Ouvrir » du main (même principe que `files:select-folder`) ;
- le fichier exporté contient noms, e-mails, profils et cooldowns : **en clair**, le dire à l'utilisateur. Option à proposer : export chiffré, mais alors relisible seulement sur ce compte Windows (safeStorage), ce qui limite l'intérêt ;
- l'export ne contient **jamais** de cookies ni de sessions (on ne touche pas à `Partitions/`) ;
- import : validation stricte par `sanitizeList` du main ; collisions d'id et de **profil** (même profil = même session) gérées explicitement (fusion, remplacement ou ignorer, au choix de l'utilisateur) ; sauvegarde automatique (`backups/`) avant d'appliquer ; respect du mode protégé (`ensureWritable`).

**Tests.** Unitaires (validation, collisions), intégration (aller-retour export → import sur un profil temporaire). Les boîtes de dialogue se simulent comme dans `test/helpers/fake-electron.js`.

### P8 — Restes de l'audit phase 2 et dette technique

> **Fait en 1.6.0**, sauf les deux tests restés manuels et les dépendances publiées depuis moins de deux semaines (voir l'avancement en tête de fichier).

- **F4** : `shell.openExternal` sans limite de fréquence pour les liens hors liste ouverts par un site autorisé (`main.js`, `popupHandler`). Proposer une limite (ex. 5 par minute et par webview) avec trace dans le journal.
- **F5** : les popups OAuth restent ouvertes quand leur webview est remplacée ou fermée. Les fermer avec la webview parente (suivre `opener` dans `web-contents-created`).
- **F6** : la version est écrite deux fois (`"version"` et `--app-version=` dans le script `dist`). Attention : `npm run` passe par **cmd.exe** sous Windows, donc `$npm_package_version` ne marche pas. Solution robuste : un petit script Node de build qui lit `package.json`.
- **Tests manquants** (aujourd'hui manuels) : écran « ne répond plus » (`unresponsive` se déclenche après un long délai), boîte de dialogue d'une popup OAuth en échec (boîte native), vraie coupure réseau. À automatiser si un moyen fiable existe ; sinon, les garder dans `TESTS-MANUELS.md`.
- **Dépendances de dev** : `npm audit` signale `undici` (high), `@electron/asar`, `glob`, `minimatch` (moderate), via `@electron/packager` 20.3.0, et `eslint` (moderate, corrigé en 10.16.0). Rien n'est embarqué dans le `.exe`, mais les mettre à jour reste souhaitable (respecter la règle des deux semaines). Rappel : `npm audit --omit=dev` **ne voit pas Electron** (dépendance de dev mais embarqué) : toujours lancer `npm audit` complet.

### P9 — Intégration continue (optionnel)

GitHub Actions sur `windows-latest` : `npm ci`, `npm run lint`, `npm test`, `npm run test:electron` à chaque push. Aucun secret n'est nécessaire (les tests n'utilisent ni réseau ni compte). À valider par l'utilisateur, car c'est une configuration persistante du dépôt.

### Idées fonctionnelles (non prioritaires, PROJECT_CONTEXT §12)

Réorganiser les comptes par glisser-déposer, groupes, bouton de déconnexion d'un profil, raccourcis clavier entre comptes, notification à la fin d'un cooldown. Une notification devrait respecter le système d'autorisations, l'interface locale n'ayant pas `notifications` dans `APP_UI_ALLOW`.

---

## 4. Décisions à demander à l'utilisateur en début de phase

1. **Electron** : monter en 45.x maintenant (recommandé, fin de support de la 43 attendue mi-décembre) ?
2. **Fuses** : appliquer le jeu proposé (P2) ?
3. **Cookies chiffrés** (P3) : oui ou non, en connaissance de cause (retour arrière = reconnexion partout) ?
4. **Signature** (P4) : un certificat ou un service est-il disponible ou envisagé ?
5. **`app://`** (P5) : faire, reporter ou abandonner ? Si on le fait : garder ou abandonner le retour arrière vers la 1.0.4 ?
6. **Découpage** (P6) : d'accord pour un module par lot ?
7. **Export/import** (P7) : export en clair (avec avertissement), chiffré, ou les deux ?
8. **CI** (P9) et **release GitHub** pour les zips : oui ou non ?

Ordre recommandé si tout est accepté : **P1 → P2 (+P3 si oui) → P8 → P6 → P7 → P5 → P9**, et P4 dès qu'un certificat existe.

---

## 5. Méthode et liste de contrôle

**Pour chaque lot :**
1. Annoncer le périmètre exact du lot (fichiers, comportement attendu).
2. Écrire ou compléter les tests **avant** ou **avec** le changement.
3. `npm run lint` → `npm test` → `npm run test:electron` (et `npm run test:perf` si un panneau ou une boucle est touché).
4. Relire le diff ; vérifier qu'aucune règle de la phase 1 n'est assouplie (`test/unit/security-policy.test.js`, `test/integration/smoke.js`).
5. Pour tout changement visuel : une capture du rendu réel (`win.webContents.capturePage()` dans un scénario jetable, dans un dossier temporaire).

**Avant une livraison :**
- mettre à jour la version (`package.json` : `"version"` seulement, depuis F6 en 1.6.0) ;
- `npm run dist`, puis vérifier le contenu de `app.asar` : pas de `test/`, `eslint.config.js`, `*.md` internes ni `PHASE-3.md` ;
- tests manuels par l'utilisateur (`TESTS-MANUELS.md`, à compléter avec les nouveautés) sur une **sauvegarde** de son profil ;
- zip :
  ```powershell
  Compress-Archive -LiteralPath "dist\[OVCR] AI Manager-win32-x64" -DestinationPath "dist\OVCR-AI-Manager-<version>.zip" -CompressionLevel Optimal
  ```
- mettre à jour PROJECT_CONTEXT, SECURITY, README et DISTRIBUTION-LISEZ-MOI ;
- commit, puis push **seulement avec l'accord de l'utilisateur**.

---

## 6. Pièges connus (appris en phase 2)

- **Shell Bash de cet environnement** : les antislashs des heredocs et des chaînes passées à `eval` / `node -e` sont réinterprétés. Pour tout script non trivial, l'écrire dans un fichier avec l'outil d'écriture, puis l'exécuter.
- **Build de test** : un `eval "npx electron-packager …"` lancé depuis Bash **n'applique pas** les motifs `--ignore`. Depuis la 1.6.0, `npm run dist` passe lui-même par l'API JS (`scripts/dist.js`). Pour un build de test hors de `dist/`, reprendre `require('./scripts/dist').packagerOptions(pkg)` en changeant `out`, et exclure `dist/` à la main.
- **Profil neuf et `Local State`** : Chromium n'écrit la clé de chiffrement qu'environ 10 s après sa création (ou à la fermeture normale). Les scénarios d'intégration démarrent avec un `Local State` copié par `run.js` (profil déjà utilisé) ; un scénario qui veut un profil neuf passe `freshProfile: true`.
- `@electron/asar` n'est pas installé à la racine : il est sous `node_modules/@electron/packager/node_modules/@electron/asar`.
- **Tests de webview hors réseau** : `session.protocol.handle('https', …)` sert des pages factices. `Response.error()` produit un vrai `did-fail-load` (code -2), alors qu'**une requête annulée par `webRequest` n'en produit aucun**. Ne pas retirer le faux serveur pendant un test : la requête partirait vers le vrai service.
- **Instance unique** : le verrou porte sur le dossier `userData`. Les tests (dossier temporaire) peuvent donc tourner pendant que l'app réelle est ouverte, et inversement.
- `npm audit --omit=dev` ignore Electron (voir P8).
- Tests unitaires de dates : `process.env.TZ = 'Europe/Paris'` en tête de fichier (Node relit `TZ` à chaque affectation, y compris sous Windows).
- **Version affichée** : `app.getVersion()` renvoie la version d'Electron quand l'app est lancée par un autre point d'entrée (tests). Le main lit donc `package.json` (`APP_VERSION`).
