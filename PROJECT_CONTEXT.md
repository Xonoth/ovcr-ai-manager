# Contexte du projet — [OVCR] AI Manager

> Document de passation destiné à une autre IA. Il décrit l'état **actuel** de l'application pour que tu puisses aider à écrire des fonctionnalités, corriger des bugs ou proposer des améliorations. Aucune connaissance préalable n'est supposée.

## 1. Résumé

**[OVCR] AI Manager** est une application **desktop Windows (Electron)** qui sert de « poste de travail » multi-comptes pour plusieurs services d'IA web (Claude, ChatGPT, Gemini, Perplexity, Z.ai, Grok, Leonardo AI, Suno, Meshy AI). Elle permet de :

- Gérer plusieurs **comptes** (ex. plusieurs adresses Gmail), chacun avec une **session de connexion isolée** (cookies séparés) grâce aux `partition` d'Electron.
- Ouvrir chaque service IA dans un **panneau `<webview>`** intégré, en restant connecté au bon compte.
- Suivre un **cooldown / quota 24h** par service et par compte (bouton « Épuiser (24h) »).
- Éditer des fichiers locaux via un **éditeur de code intégré (Monaco)** avec un explorateur de fichiers.
- Afficher **1 ou 2 panneaux IA** côte à côte (vue simple / vue scindée), avec **colonnes redimensionnables** à la souris.
- Consulter une **page d'aide** (« Comprendre les IA disponibles », bouton `?` dans la barre du workspace) décrivant chaque service et son cas d'usage.

C'est un outil **personnel / communautaire** (communauté « OverCreep »), au thème visuel **violet / rose**.

## 2. Stack technique

- **Electron** `^43.8.10` (app desktop, un process principal + un renderer ; Chromium 150.0.7871.250).
- **HTML/CSS/JS vanilla** — pas de framework (pas de React/Vue). Le front = `index.html` (HTML + CSS + CSP) + `renderer/app.js` (toute la logique, script classique) + `assets/icons.js` (icônes). Le JS a été sorti d'`index.html` en phase 1 sécurité pour que la CSP interdise les scripts inline.
- **Monaco Editor** `^0.45.0` (l'éditeur de VS Code), chargé en local depuis `node_modules`.
- **Polices & icônes 100% LOCALES** (plus aucun CDN externe) : polices Google Fonts en `.woff2` sous `assets/fonts/`, icônes ex-Font Awesome converties en **SVG inline** dans `assets/icons.js`. L'app s'affiche donc identiquement hors-ligne.
- **Packaging** : `@electron/packager` (génère un dossier + `.exe`). `electron-builder` a été **retiré des devDependencies** (septembre 2026) : il **ne fonctionne pas sur cette machine** (il exige des droits admin/Mode développeur pour créer des liens symboliques) et traînait 11 alertes `npm audit` dont une critique. Le bloc `build` de `package.json` (config electron-builder) est **conservé** : il ne coûte rien et servira tel quel si on réinstalle l'outil un jour.
- Pas de TypeScript, pas de bundler (Webpack/Vite).
- **Tests automatisés** (phase 2) : `node:test` intégré à Node (aucune dépendance) pour les tests unitaires, Electron lui-même pour les tests d'intégration. **ESLint** (`eslint`, `@eslint/js`, `globals`, versions figées) en dépendance de **développement** uniquement — jamais dans le `.exe`. Voir §4.

## 3. Structure des fichiers

```
ai-manager/
├── index.html          # Interface : HTML + CSS (<style>) + CSP (<meta>). Plus aucun script inline ni onclick.
├── renderer/
│   ├── app.js          # Toute la logique de l'interface (ex-<script> d'index.html), SANS accès Node : passe par window.ovcr.
│   ├── cooldowns.js    # (phase 2) États et libellés des cooldowns, fonctions pures (window.OVCRCooldowns, testable sous Node).
│   └── pane-errors.js  # (phase 2) Classification des erreurs des panneaux IA, fonctions pures (window.OVCRPaneErrors).
├── app-preload.js      # Preload de la fenêtre hôte : expose window.ovcr (liste fermée de méthodes, contextBridge).
├── main.js             # Process principal Electron. Instance unique, fenêtre sécurisée + IPC validés (expéditeur vérifié) + durcissement navigation/popups/webviews + résilience (plantages, popups en échec).
├── security-policy.js  # (phase 2) Règles de sécurité PURES extraites de main.js (liste blanche, partitions, expéditeur IPC) — testées.
├── atomic-file.js      # (phase 2) Écriture atomique (tmp + fsync + renommage, nouvelles tentatives si fichier verrouillé).
├── diagnostics.js      # (phase 2) Journal local expurgé (userData/logs), erreurs non interceptées, rapports de l'interface.
├── file-access.js      # Fichiers de l'explorateur/éditeur : racines autorisées, chemins résolus, limites (voir SECURITY.md §4).
├── accounts-store.js   # Comptes : stockage chiffré safeStorage, sauvegardes, versionnement du schéma + migrations, récupération, retour arrière.
├── eslint.config.js    # (phase 2) ESLint — développement uniquement, exclu du .exe.
├── test/               # (phase 2) unit/ (node:test), integration/ (Electron réel, userData temporaire), fixtures/, helpers/ — exclu du .exe.
├── TESTS-MANUELS.md    # (phase 2) Ce qui ne peut PAS être testé automatiquement (services IA réels, OAuth, vraie coupure réseau…).
├── SECURITY.md         # Modèle de sécurité, CSP, stockage, limites restantes, pistes.
├── browser-identity.js # Identité navigateur des webviews/popups : Firefox sur Google, Chrome ailleurs ; FedCM désactivé — connexion Google.
├── browser-identity-preload.js # Preload de session : aligne navigator sur Firefox sur les pages Google.
├── site-permissions.js # Autorisations des sites (position, micro, caméra, notifs…) : question + mémorisation par site.
├── scripts/
│   └── prune-locales.js # Post-build : supprime les locales Chromium inutiles (garde fr/en-US/en-GB), lancé par `npm run dist`
├── assets/
│   ├── icons.js        # 20 icônes SVG inline (sous-ensemble Font Awesome) + hydrateIcons()
│   └── fonts/          # 6 .woff2 (Space Grotesk, Inter, JetBrains Mono ; sous-ensembles latin + latin-ext)
├── package.json        # Scripts, dépendances, config de build.
├── package-lock.json
├── README.md           # Documentation publique GitHub (fonctionnalités, installation, sécurité, contribution)
├── LICENSE             # MIT
├── THIRD-PARTY-NOTICES.md # Attributions : polices OFL, icônes Font Awesome CC BY 4.0, Monaco/Electron MIT
├── DISTRIBUTION-LISEZ-MOI.txt # Notice utilisateur jointe au zip distribué à la communauté
├── .gitignore          # Exclut node_modules/, dist/, harnais de test, .env
├── node_modules/
│   └── monaco-editor/  # embarqué dans l'app
└── dist/               # sorties de build (généré par `npm run dist`) + OVCR-AI-Manager-<version>.zip (à distribuer) — NON versionné
```

- **Tout le code applicatif de l'interface (UI, logique comptes, éditeur, redimensionnement) est dans `renderer/app.js`**, dans une grande fonction `async initApp()` (asynchrone : les comptes sont chargés depuis le processus principal).
- `assets/icons.js` est chargé avant l'app (`<script src>` dans le `<head>`) et expose `window.OVCR_ICONS` + `window.hydrateIcons(root)`.
- `main.js` : crée la fenêtre, fixe le dossier de données, **durcit la navigation/les popups/les webviews** (voir §10), et enregistre les canaux IPC (`files:*`, `accounts:*`, `storage:*`, `site-permissions:reset`), tous protégés par `isTrustedSender`.

## 4. Comment lancer / construire

- **Lancer en dev** : `npm start` (= `electron .`)
- **Tests** (phase 2) — à lancer avant tout build :
  - `npm test` : tests **unitaires** (`node --test`, Electron simulé par `test/helpers/fake-electron.js`) : stockage, écritures interrompues, migrations, cooldowns (fuseau Europe/Paris, changements d'heure), règles de sécurité, accès fichiers, autorisations, diagnostics, classification des erreurs.
  - `npm run test:electron` : tests d'**intégration** — un vrai Electron par scénario, dossier de données **temporaire** (le vrai profil n'est jamais touché), **aucun accès réseau** (les pages de service sont factices, servies localement). Couvre démarrage, isolation/CSP/IPC, récupération après corruption, pannes de stockage, migration 1.0.4, schéma futur, diagnostics, erreurs de panneau (plantage réel, échec de chargement), cooldowns, instance unique.
  - `npm run test:perf` : mesures (mémoire, fuites de webviews/processus/tas JS sur 30 ouvertures).
  - `npm run lint` : ESLint.
  - Les **tests manuels** (vrais services IA, OAuth, vraie coupure réseau…) sont listés dans `TESTS-MANUELS.md`.
- **Construire le .exe** : `npm run dist`
  → produit `dist/[OVCR] AI Manager-win32-x64/` contenant `[OVCR] AI Manager.exe` (dossier complet requis, l'exe seul ne suffit pas).
  → pour partager : zipper ce dossier. Un zip prêt à distribuer existe déjà : `dist/OVCR-AI-Manager-1.2.0.zip` (~136 Mo, contient le dossier complet — 130 fichiers — à la racine). Le nom du zip porte la version depuis la 1.0.1, pour qu'un membre sache ce qu'il a téléchargé.
  → le script `dist` enchaîne automatiquement `node scripts/prune-locales.js` (purge des locales Chromium hors fr/en-US/en-GB : −44,9 Mo) et exclut les traductions Monaco `editor.main.nls.<langue>.js` (Monaco tourne avec ses libellés anglais de base, seul `editor.main.nls.js` est gardé).
- Le **.exe n'est pas signé** → Windows SmartScreen affiche un avertissement aux utilisateurs (normal).

> ℹ️ Le build `dist/` est à jour (nom, thème, durcissement A/B/C/D, bouton d'ajout de compte). L'ancien build « AI Agentic Workbench » et son zip ont été supprimés. Après toute modif de `index.html`/`main.js`/`assets/`, relancer `npm run dist` **puis** recréer le zip (voir ci-dessous).

> **Recréer le zip** (PowerShell, à cause des crochets `[ ]` dans le nom de dossier qui cassent l'expansion `-Path`) :
> ```powershell
> Compress-Archive -LiteralPath "dist\[OVCR] AI Manager-win32-x64" -DestinationPath "dist\OVCR-AI-Manager-1.2.0.zip" -CompressionLevel Optimal
> ```

## 5. Données & stockage

Deux endroits distincts, à ne pas confondre :

1. **Métadonnées des comptes** → tenues par le **processus principal** (`accounts-store.js`), depuis la phase 1 sécurité.
   - `%APPDATA%\ai-manager\accounts.json` : tableau JSON de comptes, dans une enveloppe `{format:"ovcr-accounts", version:1, schema:1, encryption:"safeStorage"|"none", payload}` ; charge utile **chiffrée `safeStorage`** (DPAPI). `"none"` seulement si le chiffrement est indisponible (rechiffré au lancement suivant).
   - `accounts.json.bak` : **génération précédente** (copiée de façon **atomique** avant chaque écrasement si elle est valide) — remplace `ai_accounts_backup`.
   - `backups/` (rien n'y est jamais supprimé par l'app) :
     - `pre-migration-<date>.json` : état `localStorage` d'origine (1.0.4), chiffré, fait avant la migration ;
     - `pre-schema-v<n>-v<m>-<date>.json` : copie exacte du fichier avant une migration de schéma ;
     - `bak-preserved-<raison>-<date>.json` : copie de `.bak` mise à l'abri quand le fichier principal est illisible ou absent (sinon deux enregistrements pouvaient écraser la seule sauvegarde valide — audit phase 2, C1).
   - Fichier illisible → jamais supprimé : renommé (ou copié) `accounts.unreadable-<date>.json`.
   - Le renderer n'écrit jamais ces fichiers : `saveAccounts()` envoie un instantané par `window.ovcr.accounts.save()`, le main **valide** (types, tailles, couleur `#hex`, profil non vide sans caractère de contrôle) puis écrit de façon **atomique** (`atomic-file.js` : temporaire + `fsync` + renommage, nouvelles tentatives si un antivirus verrouille brièvement le fichier), une écriture à la fois, et retarde la fermeture de l'app (5 s max) tant qu'une écriture est en cours.
   - **Statuts de lecture** (`load()`) : `ok`, `empty` (vrai premier lancement), `missing` (principal absent mais `.bak` lisible → restauration proposée), `corrupt` (y compris JSON valide qui n'est pas un tableau), `undecryptable`, `newer` (schéma/conteneur plus récent → **lecture seule**), `migration_failed` (données d'origine intactes → **lecture seule**).
   - **Mode protégé du renderer** : si l'état du stockage est inconnu (erreur IPC) ou `newer`/`migration_failed`, les écritures sont **bloquées** (bandeau persistant, `ensureWritable()`), pour ne jamais écraser les vrais comptes par une liste vide ou incomplète. Un enregistrement en échec laisse un **bandeau persistant** avec « Réessayer ».
   - **Versionnement** : `schema` dans l'enveloppe (absent = 1). La charge utile reste **un tableau** à tous les schémas → une version antérieure (1.1.0) relit toujours tous les comptes. Migrations dans `MIGRATIONS` (`accounts-store.js`), fonctions pures et idempotentes, avec sauvegarde préalable, validation (aucun compte perdu, ids et profils inchangés), écriture atomique puis relecture ; interrompue → refaite au lancement suivant. Schéma courant : **1** (aucune migration réelle n'a encore été nécessaire ; le mécanisme est testé avec des migrations factices).
   - **Migration automatique** au 1er lancement : les anciennes clés `localStorage` `ai_accounts` / `ai_accounts_backup` sont reprises telles quelles, vérifiées, puis effacées. **Retour arrière** : lancer avec `--revert-storage-migration` (voir SECURITY.md §5).
   - **Chargement résilient** : donnée corrompue, indéchiffrable ou fichier principal introuvable → modale proposant la sauvegarde ; « Continuer sans restaurer » garde une copie de la sauvegarde dans `backups/`.
   - **Réparation au chargement** (`migrateOldAccounts()`, renderer) : services/cooldowns manquants complétés ; **profil vide ou invalide** (accepté par la 1.0.4) remplacé par le premier `profil_N` libre, avec un message — sans cela, le main refusait d'enregistrer TOUTE la liste (bug réel, trouvé en phase 2).
2. **Préférences d'affichage** → `localStorage` du renderer (non sensibles, en clair), via l'objet `prefs` de `renderer/app.js` :
   - Clé `prefs_schema` (absente = 1) : préférences d'une version plus récente → lues, jamais réécrites.
   - Clés `ide_w`, `explorer_w` : largeurs mémorisées des colonnes (`<nombre>px`, valeur invalide ignorée).
   - Clé `collapsed_accounts` : tableau JSON des ids de comptes dont la carte est **repliée** (vue compacte), purgé des ids de comptes supprimés à chaque écriture (`saveCollapsed()`).
   - Un échec d'écriture est journalisé (console → journal de diagnostic), jamais bloquant.
2 bis. **Autorisations des sites** → `site-permissions.json` : écriture atomique ; clé réservée `"$schema"` (ignorée par la 1.1.0) ; fichier illisible **mis de côté** (`site-permissions.unreadable-<date>.json`) au lieu d'être écrasé ; entrées mal formées ignorées.
2 ter. **Journal de diagnostic** → `%APPDATA%\ai-manager\logs\ovcr.log` (+ `.1`, `.2`, 1 Mo chacun) — voir §13 « Phase 2 ».

3. **Sessions de connexion IA (cookies/tokens)** → dossier de données Electron.
   - Chemin : `%APPDATA%\ai-manager\Partitions\profil_X\` (un dossier par profil).
   - **Fixé en dur** dans `main.js` via `app.setPath('userData', ...'ai-manager')` pour que la version packagée réutilise le même profil quel que soit le nom du produit.
   - ⚠️ Les cookies y sont **stockés en clair** (fuse Electron `EnableCookieEncryption` désactivé par défaut). Non modifié en phase 1 : l'activer est **irréversible** (voir SECURITY.md §6-7) — décision utilisateur en attente. L'app ne lit ni n'exporte jamais ces cookies.

### Schéma d'un compte (`ai_accounts`)
```json
{
  "id": "acc_1784230841031",
  "name": "Compte Démo",
  "email": "exemple@email.test",
  "profile": "profil_1",           // -> partition Electron persist:profil_1
  "color": "#ffb347",              // couleur de la pastille d'avatar
  "services": ["claude","chatgpt","gemini","perplexity","zeta","grok","leonardo","suno","meshy"],
  "cooldowns": { "claude":0, "chatgpt":0, "gemini":0, "perplexity":0, "zeta":0, "grok":0, "leonardo":0, "suno":0, "meshy":0 }
  // cooldown = échéance en ms depuis l'époque Unix (UTC) ; 0 = rien de marqué
}
```
Une fonction `migrateOldAccounts()` répare/complète automatiquement les anciens comptes (ajoute services/cooldowns manquants, remplace un profil vide/invalide).

**Cooldowns (phase 2, `renderer/cooldowns.js`)** — toujours marqués **à la main** ; l'app ne détecte pas (et ne prétend pas détecter) un quota réellement épuisé. États dérivés de l'échéance (durée fixe 24 h, donc « marqué à » = échéance − 24 h, sans champ supplémentaire) :
- **non suivi** (`unknown`) : 0, ou terminé depuis plus de 24 h → bouton « Épuiser (24h) » ;
- **actif** (`active`) : échéance à venir → « ⏳ 5h 07m », service grisé ; annuler demande **deux clics** (« Confirmer ? », 5 s) ;
- **terminé** (`ended`) : échéance passée depuis < 24 h → « ✓ Fini 14:05 », service réactivé automatiquement (l'échéance n'est plus remise à 0) ;
- **incohérent** (`inconsistent`) : échéance > 24 h dans le futur (horloge reculée) → « ⚠ Échéance incohérente », compté épuisé, réinitialisation avec confirmation ; signalé dans le journal au démarrage.
Changements d'heure été/hiver sans effet (timestamps UTC, 24 vraies heures). Statistique renommée **« Hors cooldown »** (au lieu de « IA disponibles », qui prétendait savoir).

## 6. Services IA (liste en dur dans `initApp`)

```js
const SERVICES = [
  { id:'claude',     name:'Claude',     url:'https://claude.ai/new',            cssClass:'svc-claude' },
  { id:'chatgpt',    name:'ChatGPT',    url:'https://chatgpt.com/',             cssClass:'svc-chatgpt' },
  { id:'gemini',     name:'Gemini',     url:'https://gemini.google.com/app',    cssClass:'svc-gemini' },
  { id:'zeta',       name:'Z.ai',       url:'https://chat.z.ai/',               cssClass:'svc-zeta' },
  { id:'perplexity', name:'Perplexity', url:'https://www.perplexity.ai/',       cssClass:'svc-perplexity' },
  { id:'grok',       name:'Grok',       url:'https://grok.com/',                cssClass:'svc-grok' },
  { id:'leonardo',   name:'Leonardo AI', url:'https://app.leonardo.ai/',        cssClass:'svc-leonardo' },
  { id:'suno',       name:'Suno',       url:'https://suno.com/create',          cssClass:'svc-suno' },
  { id:'meshy',      name:'Meshy AI',   url:'https://www.meshy.ai/workspace',   cssClass:'svc-meshy' }
];
```
Ajouter un service = ajouter une entrée ici + une classe CSS `.svc-<id>` + variables de couleur `--<id>` / `--<id>-dim` + sa fiche dans `SERVICE_INFO` (page d'aide, voir §7) (+ si besoin son domaine dans `ALLOWED_POPUP_HOSTS` de `main.js` pour les popups d'auth). La migration l'attache ensuite à tous les comptes.

URLs d'app retenues pour les deux derniers ajouts : Suno → `/create` (page de création ; déconnecté, redirige vers le sign-in puis revient sur `/create`) ; Meshy → `/workspace` (l'app elle-même, plutôt que la landing marketing `meshy.ai/fr/`).

Les boutons de service d'une carte sont posés dans `.services-grid`, une **grille CSS auto-adaptative** (`grid-template-columns: repeat(auto-fill, minmax(85px, 1fr))`) : autant de colonnes de ≥85px que la carte peut en contenir (3 dans la sidebar de 380px), étirées sur toute la largeur. Un 8ᵉ/9ᵉ service se placera tout seul sur une nouvelle ligne, sans retoucher le CSS.

## 7. Fonctionnalités & fonctions clés (dans `index.html`)

- `renderAccounts()` — rend les cartes de comptes (avatar, boutons de service, cooldowns). **Toutes les données de compte sont échappées** (`escapeHtml`) et les cartes n'ont **plus d'`onclick` inline** : les actions passent par des `data-*` lus par la délégation d'événements (voir plus bas). Quand la liste est **vide**, affiche un bouton d'appel à l'action « Créer mon premier compte ».
- **Vue compacte (repli/dépli des cartes)** : cliquer sur le **header** d'une carte (`data-action="toggle-collapse"` sur `.account-header` — les boutons éditer/supprimer imbriqués gardent la priorité via `closest()`) replie/déplie sa grille de services ; repliée, la carte affiche un badge **« N/9 »** (services hors cooldown / total, ambré si un cooldown est actif, resynchronisé par le tick des cooldowns) + un chevron pivoté. Un bouton global « Tout replier / Tout déplier » (`#btnToggleAllCards`, dans l'en-tête de la liste) bascule toutes les cartes. Fonctions : `toggleCardCollapse(accId)`, `toggleAllCards()`, `saveCollapsed()` ; état persisté dans `localStorage.collapsed_accounts` (voir §5) ; défaut = tout déplié ; `openService` **déplie automatiquement** la carte du compte utilisé (utile depuis la palette Ctrl+K). Animation CSS pure (`grid-template-rows: 1fr → 0fr` sur `.services-wrap`, enfant `overflow:hidden`).
- `openService(accId, svcId)` — choisit le panneau, déplie la carte du compte, puis `mountService(pane, acc, svc)` crée le `<webview partition="persist:<profil>" src="<url>">` avec son cycle de vie (phase 2) : spinner de chargement, **écran d'erreur** sur `did-fail-load` (cadre principal, sauf -3), `render-process-gone` et `unresponsive`, avec les actions **Réessayer**, **Recharger le service** (recrée la webview, même partition → session conservée), **Ouvrir dans le navigateur** (`window.ovcr.services.openInBrowser`, adresse https du service vérifiée par le main), **Fermer le panneau** (`closePane(n)`), **Informations de diagnostic** (code, hôte seul, service). Messages dans `renderer/pane-errors.js` ; jamais présentés comme un quota. Bandeau « Hors ligne » discret en haut des panneaux ouverts (`offline`/`online`). Les popups OAuth en échec affichent une boîte native (Réessayer / navigateur / Fermer) côté main.
- **Diagnostic** (page d'aide `?` → « Diagnostic ») : versions, état du stockage, écriture possible ou bloquée, mémoire par type de processus, panneaux ouverts, derniers événements du journal ; boutons « Copier le diagnostic » et « Ouvrir le dossier des journaux ». Tout est expurgé (aucun e-mail, URL réduite à l'hôte).
- **Bouton « Ajouter un compte »** : un `+` en tête de la liste (à côté du titre « Comptes enregistrés ») + le bouton « Créer mon premier compte » de l'état vide. Les deux portent `data-action="add"` → `openModal()` en mode ajout. *(Avant ce lot, aucun bouton d'ajout n'existait dans l'UI.)*
- `openModal()` / `saveAccount()` / `openDeleteModal()` / `confirmDelete()` — CRUD des comptes.
- `toggleCooldown(accId, svcId)` — marque un service épuisé pour 24 h, ou annule un cooldown actif/incohérent après confirmation (deux clics). Voir « Cooldowns » au §5.
- Modifier le **profil** d'un compte existant affiche un avertissement dans la fenêtre (`#profileWarning`) : c'est changer de session de connexion.
- `setLayout(mode)` — vue 1 ou 2 panneaux ; gère la poignée de redimensionnement entre panneaux IA. Repasser en vue simple **ne détruit pas** la webview du panneau 2 (session conservée, mais RAM occupée ~100-250 Mo).
- **Bouton « Fermer le panneau 2 »** (`#btnClosePane2`, icône `times-circle` dans la barre du workspace) : visible **uniquement** quand une webview vit dans le panneau 2 (y compris cachée en vue simple — géré par `updateClosePane2Btn()`, appelée par `openService`/`closePane2`). `closePane2()` détruit la webview (`innerHTML` → le process invité Chromium est tué, RAM libérée), restaure le placeholder « Panneau 2 vide » et masque le bouton. En vue scindée, `openService` **cible en priorité un panneau vide** (le panneau 2 fraîchement fermé est re-rempli au prochain service, sans écraser le panneau 1) ; l'alternance habituelle reprend quand les deux panneaux sont occupés.
- `toggleDashboard()` / `toggleExplorer()` / `toggleIdePanel()` — replier/déplier les panneaux.
- **Éditeur** : Monaco est chargé **PARESSEUSEMENT** (audit perf) : `ensureMonacoLoaded()` n'appelle `loadMonaco()` qu'à la **première ouverture du panneau éditeur** (`toggleIdePanel`), plus au démarrage — un placeholder « Chargement de l'éditeur… » s'affiche ~0,3-0,7 s. Économie au démarrage : ~4 Mo de JS non parsés, ~12 Mo de heap. `loadMonaco()` injecte le loader AMD et calcule une URL ABSOLUE depuis l'emplacement d'`index.html` (crucial pour le .exe packagé). Si Monaco échoue, `__initFallbackEditor()` crée un éditeur de secours (`<textarea>`) fonctionnel avec Ctrl+S. Accès unifié via `getEditorValue()` / `setEditorContent(content, lang, readOnly)`. Les refus du main (fichier hors dossier, binaire, trop gros…) s'affichent en toast via `FILE_ERRORS` ; un fichier non UTF-8 s'ouvre en lecture seule (`currentFileReadOnly`).
- **Redimensionnement** : `setupResizers()` + `makeResizer()` — colonnes ajustables à la souris (éditeur, explorateur, entre panneaux IA), via `flex-basis` (pas `width`) pour contourner un piège de flexbox avec Monaco ; largeurs mémorisées dans `localStorage`.
- **Palette** : `Ctrl+K` ouvre une recherche rapide de compte/IA (`filterPalette()`).
- **Page d'aide « Comprendre les IA disponibles »** : bouton `?` (icône `circle-question`) dans la barre du workspace (toujours visible, même sidebar repliée) → `openHelpModal()` remplit `#helpList` depuis `SERVICES` + **`SERVICE_INFO`** (objet statique indexé par id : `{ what, when }` — descriptions grand public, aucune requête réseau) et ouvre la modale `#helpModal` (réutilise `.modal-overlay`/`.modal` + variante `.modal--help` : hauteur bornée à la fenêtre, seule la liste scrolle). Fermeture : bouton, Échap (handler global existant), clic sur le fond. Un service sans fiche `SERVICE_INFO` affiche « Description à venir ». Lecture seule : ne touche ni comptes, ni cooldowns.
- **Sécurité / robustesse (lot de durcissement A/B/C/D)** :
  - `escapeHtml(str)` — échappe `& < > " '`. À utiliser **partout** où une donnée utilisateur (nom/email/profil de compte, nom de fichier) est injectée en `innerHTML`. (Le renderer n'a plus Node et la CSP bloque les scripts inline, mais on garde les deux barrières.)
  - **Délégation d'événements** : un seul listener `click` par conteneur stable (`#accountsList`, `#paletteResults`, `#fileList`) lit `data-action`/`data-acc`/`data-svc`/`data-path`. Plus aucune donnée n'est injectée dans un attribut `onclick` généré. (Les `onclick` **statiques** codés en dur, sans donnée utilisateur, sont conservés.)
  - `saveAccounts(list)` / `exportAccountsJSON()` / `importAccountsJSON(text)` / `showRecoveryUI()` — stockage résilient (désormais côté main, voir §5) + fondation d'un futur export/import JSON. Le main ne recopie l'ancienne génération dans `accounts.json.bak` que si elle est **valide** (ne détruit jamais un bon backup).
- **Icônes** : `hydrateIcons(root)` (dans `assets/icons.js`) remplace chaque `<span class="ic" data-icon="NOM">` par son SVG. Appelé au démarrage (HTML statique) et après chaque `innerHTML` dynamique. Ajouter une icône = ajouter une entrée `{vb, p}` dans `window.OVCR_ICONS` (viewBox + path).

## 8. UI / Thème (communauté OverCreep, violet / rose)

- Défini par des variables CSS dans `:root` (fichier `index.html`).
- Accent principal : **`--accent: #8b5cf6`** (violet officiel OverCreep). Rose : `--rose: #f230aa`. Halo : `--accent-glow: rgba(139,92,246,.35)`.
- Fonds sombres légèrement violacés (`--bg: #0b0817`, relevé sur overcreep.ovh), bordures teintées violet, fond « aurora » en dégradés radiaux CSS purs.
- Logo (`.header__icon`) : dégradé **rose → violet** (`var(--rose)` → `var(--accent)`).
- Stats : « Comptes actifs » en violet, « Hors cooldown » en rose (ex-« IA disponibles », renommé en phase 2).
- Éléments ajoutés en phase 2, sur les **mêmes variables** du thème : bandeau d'alerte persistant `.app-banner`, écran d'erreur de panneau `.pane-error*`, bandeau `.pane-offline`, états de cooldown `.cooldown-btn.ended/.inconsistent/.confirming` (avertissement = `--warning`), avertissement de formulaire `.form-warning`, diagnostic `.diag-*`.
- Les couleurs de marque des IA (Claude/ChatGPT/Gemini/Perplexity/Grok) sont **conservées** pour la reconnaissance ; Z.ai est violet et s'intègre au thème ; Leonardo AI est magenta (`--leonardo: #d946ef`), distinct du violet Z.ai et du rose du thème. Suno est **orange-rouge** (`--suno: #f8441b` — sa marque officielle est noir/blanc, on reprend le pôle orange du dégradé signature rose→orange de son app, le rose étant trop proche de Leonardo) ; Meshy AI est **vert lime** (`--meshy: #c5f955`, couleur dominante relevée sur meshy.ai).
- Polices et icônes **désormais 100% locales** (`assets/fonts/` + `assets/icons.js`) — plus aucune dépendance Internet pour l'ossature visuelle. Monaco est local. Les `@font-face` sont dans le `<style>` d'`index.html` avec des chemins **relatifs** (valables en dev ET en `.exe`).

## 9. Comportements par défaut importants

- L'éditeur de code et l'explorateur de fichiers démarrent **repliés** (classe `collapsed` sur `#idePanel` et `#fileExplorer`) → toute la largeur va aux panneaux IA au lancement.
- Les webviews sont **persistantes** : une fois connecté à un service dans un profil, la session est mémorisée (cookies dans `Partitions/`).

## 10. Architecture Electron & points de sécurité (état actuel)

> Référence détaillée : **`SECURITY.md`**. Résumé :

- **Fenêtre hôte** : `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `webviewTag: true`, preload `app-preload.js`. `app.enableSandbox()` sandboxe tous les processus de rendu. La page n'a **ni `require` ni `process`** ; elle n'a que `window.ovcr` :
  - `files` : `selectFolder()`, `listDirectory(dir)`, `readFile(path)` → `{ok, content, readOnly}` / `{ok:false, error}`, `saveFile(path, content)` → `{ok}` / `{ok:false, error}` ;
  - `accounts` : `load()`, `save(list)`, `restoreBackup()`, `migrateLegacy({current, backup})` ;
  - `storage` : `pendingRevert()`, `confirmRevert()` ; `sitePermissions` : `reset()` ;
  - `services` : `openInBrowser(url)` (https + liste blanche, sinon refus) ; `diag` : `report({level, message, stack})` (validé, borné, 60/min), `get()`, `openLogs()` (chemin fixe).
  Chaque canal IPC passe par `handle()` dans `main.js`, qui vérifie l'**expéditeur** (`isTrustedSender` : cadre principal de la fenêtre hôte, URL = exactement l'`index.html` local, comparaison par chemin, robuste aux `[ ]`/espaces/accents du dossier packagé). Pour ajouter une opération : un canal dédié dans `main.js` + une méthode dans `app-preload.js` + la validation des paramètres **dans le main**. Jamais de canal générique.
- **CSP** (`<meta>` dans `index.html`) : `script-src 'self'` (aucun inline, aucun `eval`), `style-src 'self' 'unsafe-inline'` (Monaco + attributs `style`), `connect-src 'self'`, `worker-src 'self'`, `frame-src`/`object-src 'none'`. Ne s'applique qu'à l'interface, pas aux sites des webviews. Conséquence : **aucun `onclick`/`oninput` dans le HTML** — les boutons statiques portent `data-cmd="…"`, traité par la table `COMMANDS` de `renderer/app.js`.
- **Monaco** charge en **mode navigateur** : `loadMonaco()` injecte `loader.js` à la première ouverture de l'éditeur, avec une URL absolue calculée par `new URL(…, location.href)` (ok en dev et en `.exe` : asar/asar.unpacked transparents). Plus de bascule `window.require`/`nodeRequire`. Les web workers fonctionnent (`worker-src 'self'`).
- **Webviews** (`will-attach-webview`) : préférences imposées (sans Node, isolées, sandbox, preload de page supprimé — seul le preload de session d'identité tourne) ; refusées si l'URL n'est pas `https://` vers `ALLOWED_POPUP_HOSTS` ou si la partition n'est pas `persist:<profil>`. ⚠️ Un nouveau service doit donc figurer dans `ALLOWED_POPUP_HOSTS`.
- **Navigation / popups (lot B, conservé)** : l'hôte ne navigue que vers son `index.html` et n'ouvre aucune fenêtre ; popups des webviews **et des popups** filtrées par `ALLOWED_POPUP_HOSTS` (autorisée → fenêtre sandboxée, même session ; lien web hors liste → navigateur système ; autre schéma → refusé). Aucune webview ne peut en imbriquer une autre.
- **Fichiers** (`file-access.js`) : racines = dossiers choisis dans la boîte de dialogue ; chemins normalisés + `realpath` + confinement ; lecture 20 Mo max, binaires refusés, non-UTF-8 en lecture seule ; écriture seulement d'un fichier déjà ouvert.
- **Autorisations** : l'interface locale (`file://`) n'a plus « tout » : seulement `clipboard-read`, `clipboard-sanitized-write`, `fullscreen` (`APP_UI_ALLOW` dans `site-permissions.js`).
- **Échappement HTML (lot A, conservé)** : toujours obligatoire — défense en profondeur avec la CSP.
- **Reste en clair** : cookies de session (`Partitions/`), `site-permissions.json`, préférences d'affichage. Voir SECURITY.md §6 pour toutes les limites.

## 11. Limites connues / dettes

- `renderer/app.js` reste un gros fichier (une fonction `initApp`) ; seules les parties pures ont été extraites (`cooldowns.js`, `pane-errors.js`). Découpage progressif possible, non entrepris (pas de refonte).
- Tests : unitaires + intégration locaux (voir §4) ; les services IA réels, l'OAuth et une vraie coupure réseau restent **manuels** (`TESTS-MANUELS.md`).
- `npm audit` : alertes restantes uniquement dans les outils de développement (packager, ESLint) ; `npm audit --omit=dev` ne voit pas Electron, qui est pourtant embarqué (voir SECURITY.md §6).
- ~~Icônes/polices dépendent d'Internet (CDN).~~ **Corrigé** : tout est local (`assets/`).
- `.exe` non signé (avertissement SmartScreen).
- `electron-builder` inutilisable ici (droits symlinks) → on ne peut pas produire un vrai portable mono-fichier ni un installateur sans activer le Mode développeur Windows ou lancer en admin. Il n'est donc plus installé (voir §2) ; seule sa config `build` reste dans `package.json`.

## 12. Idées d'évolutions possibles (non demandées, à titre indicatif)

- Réorganiser/renommer les comptes par glisser-déposer ; regrouper par « équipe ».
- Rafraîchir/recharger un webview, bouton « déconnexion » d'un profil.
- Import/export de la liste de comptes (JSON). *(Fondation déjà en place : `exportAccountsJSON()` / `importAccountsJSON()` dans `index.html` — il ne manque que l'UI qui les branche.)*
- Thèmes multiples / réglages.
- Raccourcis clavier pour basculer entre comptes.
- Notifications quand un cooldown se termine.

## 13. Dernières évolutions (lot de durcissement + UI)

Réalisé en vue du partage du `.exe` à la communauté OverCreep :

- **A — Échappement HTML + délégation d'événements** : `escapeHtml()` sur toutes les données utilisateur rendues en HTML ; suppression des `onclick` dynamiques au profit de `data-*` + listeners délégués (§7). Ferme le risque d'injection/RCE via un nom de compte.
- **B — Durcissement navigation/popups** (`main.js`) : `will-navigate` + `setWindowOpenHandler` sur l'hôte, filtrage des popups des webviews par liste blanche (§10).
- **C — Résilience des données** : chargement de `ai_accounts` tolérant à la corruption + backup automatique `ai_accounts_backup` + modale de récupération (§5, §7).
- **D — Polices & icônes locales** : plus aucun CDN ; `.woff2` locaux + icônes SVG inline (§2, §8).
- **UI** : ajout du **bouton « Ajouter un compte »** (`+` en tête de liste) et de l'état vide **« Créer mon premier compte »** — auparavant *aucun* moyen de créer un compte depuis l'interface.
- **Build** : `dist/` régénéré, ancien build « AI Agentic Workbench » supprimé, zip de distribution `dist/OVCR-AI-Manager.zip` à jour (§4).

Explicitement **hors périmètre** de ce lot : CSP, migration `contextIsolation`/`preload`, chiffrement au repos, découpage de `index.html` — **réalisés depuis en phase 1** (voir plus bas), sauf le chiffrement des cookies de session.

### Correctifs post-audit (pré-partage)

Suite à un audit complet du code :

- **Unicité du `profile`** (`saveAccount` / `openModal`) : deux comptes ne peuvent plus partager le même `profile` (sinon **partition Electron commune → sessions/cookies mêlés**). Le profil suggéré par défaut évite désormais toute collision (le `profil_N` basé sur `length+1` pouvait re-proposer un profil déjà pris après suppression).
- **Garde taille fichier** (`read-file` dans `main.js`) : refus au-delà de **20 Mo** (`MAX_EDITABLE_FILE_BYTES`, initialement 5 Mo — relevé après retour bêta) — évite de figer l'app en ouvrant un gros fichier ; le renderer affiche un toast indiquant la taille du fichier et la limite.
- **Robustesse** : `hydrateIcons` a un stub no-op si `assets/icons.js` échoue (l'app ne meurt plus) ; gardes `if (!acc) return` sur `toggleCooldown`/`saveAccount` ; logs de sécurité tronqués au host (pas de token OAuth en clair dans la console).
- **UX** : le compte à rebours des cooldowns se rafraîchit à chaque changement de minute — depuis l'audit perf via `refreshCooldownLabels()` (mise à jour `textContent` ciblée, ~110× moins chère qu'un re-render complet ; le re-render complet ne reste déclenché que par une expiration).
- **Build allégé** : le script `dist` exclut `monaco-editor/{dev,esm,min-maps}` (inutilisés — l'app ne charge que `min/`). L'`app.asar.unpacked` passe de **89 Mo → 13 Mo** ; zip **~155 → ~141 Mo**. *(Le `.exe` ~225 Mo = Electron/Chromium lui-même, incompressible sans changer d'approche de packaging.)*

**Reste recommandé avant diffusion (non-code)** : tester une connexion neuve sur les **9 services** — dont Leonardo AI, Suno et Meshy AI, ajoutés récemment (liste blanche : `leonardo.ai` couvre `app./auth.leonardo.ai` ; `suno.com` couvre `clerk.suno.com` (auth Clerk : Google/Apple/Microsoft/Discord/téléphone, d'où l'ajout de `discord.com`) ; `meshy.ai` + Google pour Meshy — les flows réels n'ont pas encore été testés) — (valider la liste blanche des popups `ALLOWED_POPUP_HOSTS`), et documenter dans le README « un compte Windows par personne » (les cookies de session restent en clair sous `%APPDATA%` — `safeStorage` ne les protègerait pas).

### Ajout Suno + Meshy AI et page d'aide (juillet 2026)

- **2 nouveaux services** (7 → 9) : Suno (`suno`, musique) et Meshy AI (`meshy`, 3D), ajoutés selon le pattern data-driven de §6 (entrée `SERVICES` + `--suno`/`--meshy` + `.svc-suno`/`.svc-meshy` + hosts popup dans `main.js`). `migrateOldAccounts()` (générique) les attache automatiquement aux comptes existants, cooldowns à 0, sans toucher aux cooldowns en cours. Grille : toujours 3 colonnes dans la sidebar → 3×3, vérifié sans troncature ni désalignement.
- **Page d'aide** : bouton `?` + modale « Comprendre les IA disponibles » (§7), contenu dans `SERVICE_INFO`, nouvelle icône `circle-question` dans `assets/icons.js`.
- Build `dist/` et zip régénérés après ces ajouts.

### Audit performance (juillet 2026)

Mesures faites dans un harnais navigateur (stub Electron, 15 comptes × 9 services, HTTP local) — chiffres médians :

- **Monaco paresseux** : chargé au 1er clic sur l'éditeur (voir §7). Avant : ~4 Mo de JS parsés + ~12 Mo de heap au démarrage pour tous ; après : 0 au démarrage, ~650 ms au 1er clic (placeholder affiché). L'éditeur démarrant replié, la plupart des membres ne paieront jamais ce coût.
- **Cooldowns** : re-render complet 1×/min remplacé par `refreshCooldownLabels()` (`textContent` seul) au changement de minute : 0,08 ms vs 9,5 ms (render+layout, 15 comptes). Tick 1 s conservé (corps mesuré à ~1,5 µs). `renderAccounts()` complet reste déclenché par interaction ou expiration — coût mesuré 0,9-2,9 ms à 15 comptes : le re-render intégral systématique est **assumé** (pas de rendering incrémental, complexité inutile à ce coût).
- **Feedback de connexion** (confort, coût ~nul) : overlay `.pane-loading` (spinner + « Connexion à X — compte… ») affiché par `openService()`, retiré à `dom-ready` de la webview (filet 10 s si l'événement ne vient jamais). L'animation ne vit que pendant le chargement.
- **Build** : purge locales Chromium (55 → 3 : −44,9 Mo) + exclusion nls Monaco (−1,7 Mo). Dossier : 359,8 → 313,3 Mo ; zip : 140,7 → **129,2 Mo**.
- **Vérifié sans changement nécessaire** : écritures `localStorage` uniquement sur action utilisateur (aucun debounce requis) ; `hydrateIcons` 0,6 ms/120 icônes ; `openService` détruit bien l'ancienne webview (`innerHTML=''`) avant d'en créer une nouvelle.
- **Arbitrages tranchés (décision utilisateur)** : la webview du panneau 2 reste en vie par défaut quand on repasse en vue simple (session préservée), mais un bouton **« Fermer le panneau 2 »** permet de la détruire explicitement pour libérer la RAM (voir §7) ; `backdrop-filter` (flou) et animation `logoGlow` **conservés tels quels** — pas de sacrifice visuel préventif ; correctif d'une ligne en réserve si un membre signale un scroll saccadé après diffusion : retirer `backdrop-filter` des `.account-card`.

---

### Connexion Google bloquée en webview (septembre 2026)

Symptôme : à l'ajout d'un compte, la popup « Continuer avec Google » (Claude,
Meshy, Suno…) affiche **« Impossible de vous connecter — Ce navigateur ou cette
application ne sont peut-être pas sécurisés »**.

- **Cause** : Google refuse les connexions faites depuis un navigateur embarqué
  (`disallowed_useragent`). L'UA par défaut d'Electron contenait le jeton
  `Electron/43.1.1`, alors que les client hints (`Sec-CH-UA`) annonçaient
  « Chromium » tout court : signature à la fois embarquée **et** incohérente.
- **Correctif** (`main.js`, tout en haut) : `app.userAgentFallback` est forcé sur
  un UA Chrome de bureau standard — `Chrome/<major>.0.0.0`, version majeure du
  Chromium réellement embarqué, UA « réduit » comme le fait Chrome depuis la
  v110. S'applique à l'hôte, à toutes les `<webview>` et aux popups OAuth.
- **Vérifié** : flux réel Claude → « Continuer avec Google » dans une `<webview>`
  avec popup ; la page d'identification Google s'affiche normalement.
- **Récidive (novembre 2026) → identité Chrome complète, 1.0.2** (`chrome-identity.js`,
  installé en tête de `main.js`) : l’UA seul ne suffisait plus. Diagnostic sur
  Electron 43.7.1 : `navigator.userAgentData.brands` = `["Not;A=Brand",
  "Chromium"]` (pas de « Google Chrome ») et **aucun en-tête `Sec-CH-UA`**
  envoyé, alors qu’un vrai Chrome en envoie toujours sur HTTPS. Le module :
  1. garde `app.userAgentFallback` (UA Chrome réduit) comme filet ;
  2. sur chaque `<webview>` et chaque popup (`web-contents-created`), attache
     le `debugger` et appelle `Emulation.setUserAgentOverride` avec des
     `userAgentMetadata` complètes (marques GREASE + Chromium + Google Chrome
     dans l’ordre calculé par Chromium, fullVersionList, platformVersion…) →
     `navigator.userAgentData` identique à Chrome ; réappliqué à la fermeture
     des DevTools d’un panneau ;
  3. via `session-created` → `webRequest`, ajoute `Sec-CH-UA`,
     `-Mobile`, `-Platform` à toute requête HTTPS, plus les hints haute
     entropie aux origines qui les demandent par `Accept-CH`.
  Vérifié (harnais Electron + httpbin) dans une webview **et** sa popup. Seul
  `webRequest.onBeforeSendHeaders/onHeadersReceived` par session : ne pas
  en enregistrer un autre ailleurs sans fusionner (Electron n’en garde qu’un).
  Livré en **version 1.0.2** (`package.json` + `--app-version`), zip
  `dist/OVCR-AI-Manager-1.0.2.zip` (135,7 Mo) ; `.exe` packagé vérifié
  (FileVersion 1.0.2, `chrome-identity.js` présent dans `app.asar`, démarrage OK).
- **1.0.2 insuffisante → identité Firefox sur Google, 1.0.3** (`browser-identity.js`
  + `browser-identity-preload.js`, ex-`chrome-identity.js`). Reproduit avec
  une adresse fictive (redirection `/v3/signin/rejected`) : l’identité Chrome,
  même complète, était rejetée à chaque essai ; Google vérifie en JS des
  détails propres au vrai Chrome (`window.chrome`, etc.) qu’Electron n’a pas.
  Une identité **Firefox** passe (Firefox = autre moteur, Google n’y attend
  aucun de ces détails). Le module :
  1. choisit l’identité par page principale : **Firefox sur `google.com` et
     sous-domaines**, **Chrome partout ailleurs** (Cloudflare de Claude/ChatGPT
     repérerait un Chromium qui se dit Firefox) ; bascule sur
     `did-start-navigation`/`did-redirect-navigation` via
     `Emulation.setUserAgentOverride` ;
  2. côté réseau (`webRequest`) : requêtes vers une page Google -> UA Firefox
     et **aucun** `Sec-CH-UA` ; ailleurs -> UA Chrome + client hints ;
  3. preload enregistré **sur la session** (`ses.registerPreloadScript`, pas
     `will-attach-webview` : les popups OAuth n’héritent pas du preload de la
     webview) : sur les pages Google, supprime `navigator.userAgentData` et
     `window.chrome`, et aligne `vendor`/`productSub`/`appVersion`/`oscpu`/
     `buildID` sur Firefox, via `contextBridge.executeInMainWorld` (le
     preload tourne dans un monde isolé) ;
  4. **FedCM désactivé** (`--disable-features=FedCm`) : le bouton « Continuer
     avec Google » des sites tiers (Google Identity Services, ex. Perplexity)
     passait par FedCM, qu’Electron expose sans en avoir l’interface ni les
     comptes -> échec silencieux (`[GSI_LOGGER]: FedCM get() rejects…`), clic
     sans effet. Sans FedCM, GIS retombe sur la redirection OAuth classique.
  Version de Firefox annoncée calculée d’après la date (une version / 4
  semaines depuis Firefox 134 le 07/01/2025) pour ne pas vieillir.
  **Attention aux tests** : des essais répétés avec des adresses fictives font
  signaler l’IP par Google (CAPTCHA, rejets même pour un vrai navigateur) —
  tester avec parcimonie, idéalement avec un vrai compte. Validé par
  l’utilisateur (connexion Google + Perplexity OK). Livré en **version 1.0.3**,
  zip `dist/OVCR-AI-Manager-1.0.3.zip`.
- **Limite** : le blocage de Google est **basé sur le risque**, pas seulement sur
  l'UA (IP, nombre de comptes enchaînés sur la même machine, protection avancée
  du compte…). Si le message revient malgré tout sur un compte donné, le
  contournement fiable est de se connecter au service **par e-mail + code**
  plutôt que par « Continuer avec Google ».

Dans la foulée (même lot, sans rapport avec le bug) :

- **Electron `43.1.1` → `43.7.1`** (Chromium 150.0.7871.250) : patchs de sécurité
  Chromium uniquement, aucune rupture. Démarrage dev + `.exe` packagé vérifiés.
- **`electron-builder` retiré** des devDependencies (inutilisable ici, cf. §2) et
  **`@electron/packager` `20.0.3` → `20.3.0`** + `npm audit fix` : on passe de
  **12 alertes (11 hautes + 1 critique) à 0**. Toutes venaient d'outils de build
  (`tar`, `js-yaml`, `undici`, `brace-expansion`) — rien n'était embarqué dans
  l'app livrée, mais autant ne pas laisser de bruit dans l'audit.
- **Build régénéré** : dossier `dist/[OVCR] AI Manager-win32-x64` = **327 Mo**
  (contre ~313 Mo, Electron 43.7.1 étant un peu plus gros), purge des locales
  toujours active (52 supprimées, 44,9 Mo).
- **Zip de distribution régénéré** : `dist/OVCR-AI-Manager-1.0.1.zip`, **135,7 Mo**
  (contre ~129 Mo). Vérifié en conditions réelles : dézippé dans un dossier
  neuf, 130 fichiers extraits (= le compte exact du dossier source), `.exe`
  lancé depuis l'extraction, l'app démarre sans erreur.
- **Piège repéré au passage** : le chemin interne le plus long du zip fait
  142 caractères (`…/monaco-editor/min/vs/basic-languages/restructuredtext/`).
  Dézippé dans un dossier déjà profond, Windows refuse silencieusement une
  partie des fichiers (limite MAX_PATH 260). Avertissement ajouté au
  `DISTRIBUTION-LISEZ-MOI.txt` : extraire dans un chemin court.
- **Version 1.0.0 → 1.0.1** (`package.json` + `--app-version` du script `dist`) :
  le zip déjà diffusé à la communauté portait 1.0.0 **sans** le correctif Google.
  Sans bump, deux binaires différents auraient circulé sous le même numéro ; là,
  un membre ouvre les propriétés du `.exe` et sait tout de suite ce qu'il a.
  Publié en **release GitHub `v1.0.1`** avec le zip en pièce jointe — c'est
  désormais le canal de téléchargement de référence.

### Autorisations des sites (novembre 2026)

Constat : Electron **accorde d'office** toute autorisation demandée par une page.
Perplexity recevait ainsi la position de l'utilisateur sans question
(`locationMetadata.permissionState: "granted"` dans son `localStorage`).

- **`site-permissions.js`** (installé dans `main.js` juste après
  `browser-identity`) pose, pour chaque session (`session-created`), un
  `setPermissionRequestHandler` et un `setPermissionCheckHandler` :
  - **question** (`dialog.showMessageBox` sur la fenêtre hôte, « Autoriser /
    Refuser » + case « Se souvenir de ce choix pour ce site » cochée par défaut) :
    `geolocation`, `notifications`, `clipboard-read`, `display-capture`,
    `media` (micro et caméra décidés séparément), `openExternal` (par protocole) ;
  - **accordé sans question** : `clipboard-sanitized-write`, `fullscreen`,
    `mediaKeySystem`, `speaker-selection`, `storage-access`,
    `top-level-storage-access` (iframes de connexion) ;
  - **refusé** : tout le reste (USB, HID, série, MIDI, idle-detection,
    window-management, verrouillages clavier/souris, fileSystem…) ;
  - l'interface locale (`file://`) a tout.
- Choix mémorisés **par origine, tous comptes confondus**, dans
  `%APPDATA%\ai-manager\site-permissions.json`. Bouton « Réinitialiser les
  autorisations des sites » dans la page d'aide → IPC `reset-site-permissions`.
- **Subtilité du check handler** (synchrone, oui/non seulement, pas de
  « à demander ») : sans choix mémorisé, il répond **oui** pour position, micro,
  caméra, presse-papiers et écran — le site tente alors l'accès, ce qui passe par
  la question ; répondre non ferait renoncer le site sans jamais demander. Pour
  les **notifications**, il répond **non** tant qu'elles ne sont pas autorisées :
  un site qui lit `Notification.permission === "granted"` les affiche sans rien
  demander. `Notification.requestPermission()` passe quand même par la question.
- Vérifié par un harnais (boîte de dialogue simulée) : question au premier accès,
  refus mémorisé sans redemande, « autoriser une fois » non mémorisé, USB refusé
  sans question, réinitialisation. Validé à la main par l’utilisateur ; livré en
  **version 1.0.4** (zip `dist/OVCR-AI-Manager-1.0.4.zip`).

### Phase 1 — Sécurité et fondations (novembre 2026)

- **Renderer sans Node** : `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` + `app.enableSandbox()`. Le JS d'`index.html` est sorti dans `renderer/app.js` ; tous les `require`/`ipcRenderer` remplacés par `window.ovcr` (`app-preload.js`).
- **IPC** : canaux dédiés (`files:*`, `accounts:*`, `storage:*`, `site-permissions:reset`), expéditeur vérifié, paramètres validés dans le main. Les anciens canaux (`select-folder`, `read-directory`, `read-file`, `save-file`, `reset-site-permissions`) n'existent plus.
- **CSP** stricte sur l'interface ; `onclick` statiques → `data-cmd`.
- **Fichiers** : `file-access.js` (confinement au dossier choisi, binaires/encodage, écriture limitée aux fichiers ouverts).
- **Comptes chiffrés** : `accounts-store.js` (safeStorage), migration auto depuis `localStorage` avec sauvegarde préalable, retour arrière `--revert-storage-migration`.
- **Webviews** : préférences imposées, URL et partition validées ; popups de popups filtrées ; autorisations de l'interface locale réduites.
- **Vérifié** (harnais Electron, userData isolé) : isolation (`require`/`process` absents), migration chiffrée sans fuite en clair, persistance, validation des saves, CSP (inline/`eval` bloqués), navigation hôte bloquée, Monaco + worker + Ctrl+S, 14 cas d'accès fichier refusés (traversée, absolu, périphérique, type, écriture non ouverte…), webview Gemini (identité Firefox intacte, sandbox, partition), 4 webviews illégitimes refusées, popup Google autorisée (même session, sandbox), popups hors liste → navigateur système, IPC d'une autre fenêtre refusé, récupération corrompu/indéchiffrable, fermeture pendant écriture, **retour arrière relu par la vraie 1.0.4**, puis re-migration. Build packagé de test (asar) vérifié, y compris depuis un chemin avec `[ ]`, espaces et accents.
- **Validé à la main par l'utilisateur** sur son vrai profil (migration réelle réussie, comptes, sessions, services OK). Livré en **version 1.1.0** (zip `dist/OVCR-AI-Manager-1.1.0.zip`).

### Phase 2 — Fiabilité et robustesse (novembre 2026)

Audit puis 8 lots, chacun testé avant le suivant. Version **1.2.0**, avec **Electron 43.7.1 → 43.8.10** (corrige les alertes de sécurité d'Electron, dont une « high » ; même Chromium 150.0.7871.250, donc identité Google inchangée). **Validé à la main par l'utilisateur** avec le `.exe` 1.2.0 (`TESTS-MANUELS.md`), puis livré : zip `dist/OVCR-AI-Manager-1.2.0.zip`.

- **Lot 0 — banc de tests** : `security-policy.js` (règles pures extraites de `main.js`, logique inchangée), `test/` (unitaires `node:test` + intégration Electron), scripts `npm test` / `npm run test:electron`.
- **Lot 1 — stockage** : `atomic-file.js` (rotation `.bak` atomique, nouvelles tentatives EPERM/EBUSY/EACCES, pas de `.tmp` orphelin) ; sauvegarde mise à l'abri avant rotation quand le principal est illisible/absent (**C1**, bug réel reproduit : 2 enregistrements après « Ignorer » détruisaient la seule sauvegarde) ; mode protégé du renderer si la lecture échoue (**C2**) ; principal absent + `.bak` valide → restauration proposée (**E1**) ; restauration sans instant sans fichier ; **instance unique** (**E2**) ; charge utile non tableau = corrompue (**M1**) ; `site-permissions.json` atomique, illisible mis de côté (**M4**) ; bandeau persistant d'échec d'enregistrement (**M5**) ; fermeture attendue 5 s max (**M7**).
- **Lot 2 — versionnement** : `schema` dans l'enveloppe, registre de migrations, sauvegarde/validation/relecture, lecture seule si plus récent (**E4**), versions des préférences et des autorisations. Correctif trouvé par les tests : un profil vide hérité de la 1.0.4 bloquait **tout** enregistrement → profil libre attribué.
- **Lot 3 — diagnostics** : `diagnostics.js` (journal tournant expurgé), erreurs non interceptées main/interface, plantage de l'interface → « Recharger », erreurs IPC journalisées (réponse générique), écran d'erreur de démarrage, section « Diagnostic », plus aucun `catch` silencieux non justifié.
- **Lot 4 — panneaux IA** : écran d'erreur par panneau + actions, popups OAuth en échec, bandeau hors ligne, canal `services:open-in-browser`.
- **Lot 5 — cooldowns** : états non suivi / actif / terminé / incohérent, confirmation avant annulation, réactivation automatique, vérification au démarrage, aucun changement de format (compatible 1.1.0) ; avertissement au changement de profil (**M8**).
- **Lot 6 — qualité** : ESLint (dev), 0 signalement ; globales voulues de l'interface listées dans `eslint.config.js`.
- **Lot 7 — performance** (`npm run test:perf`, pages factices) : 1 panneau ≈ +200 Mo, panneau 2 caché ≈ +170 Mo (page factice : un vrai service pèse plus), libérés par « Fermer le panneau 2 » ; 30 remplacements de panneau : aucune webview orpheline, processus/tas JS/DOM stables, ~0,6 s par ouverture locale ; tick des cooldowns ≈ 1 µs. **Pas de suspension automatique** des webviews : la seule webview inactive possible est le panneau 2 caché, déjà libérable par un bouton (arbitrage utilisateur antérieur), et une suspension ferait perdre l'état des pages (saisie en cours).
- **Tests** : 99 tests unitaires, 111 vérifications d'intégration, mesures de perf — tous verts au moment de la livraison. Manuels : `TESTS-MANUELS.md`.

### Note pour l'IA qui reçoit ce contexte
Quand tu proposes une modification : précise **dans quel fichier** (le plus souvent `renderer/app.js` ou `index.html`, parfois `main.js` / un module du main), rappelle que c'est du **JS vanilla en script classique** (pas de modules/build), respecte les **variables CSS du thème** existantes, et n'oublie pas que l'app tourne aussi **packagée en .exe** (chemins relatifs vs absolus — voir le chargement de Monaco).

Réflexes : **toute donnée utilisateur injectée en HTML doit passer par `escapeHtml()`** ; **aucun script ni gestionnaire inline** (la CSP les bloque) : `data-cmd`/`data-action` + délégation ; les **écritures de comptes passent par `saveAccounts()`** ; **le renderer n'a pas Node** : un besoin système = une méthode dédiée dans `app-preload.js` + un canal `handle()` dans `main.js` + validation côté main ; une **nouvelle icône** s'ajoute dans `window.OVCR_ICONS` (`assets/icons.js`) puis s'utilise via `<span class="ic" data-icon="…">` + `hydrateIcons()`.

Réflexes phase 2 : **toute écriture de fichier de données passe par `atomic-file.js`** ; un **changement de forme des comptes** = `SCHEMA` + une étape dans `MIGRATIONS` (pure, idempotente, charge utile toujours un tableau) + des tests dans `test/unit/migrations.test.js` ; une modification de comptes côté interface vérifie `ensureWritable()` ; **pas de `catch` vide** (journaliser, ou commenter pourquoi l'erreur est sans effet) ; les journaux ne contiennent **que des identifiants techniques** (id de compte, hôte, code), jamais un nom, un e-mail ou une URL complète ; une nouvelle fonction appelée depuis `COMMANDS`/la délégation et posée sur `window` doit être ajoutée aux globales de `eslint.config.js` ; lancer `npm test`, `npm run test:electron` et `npm run lint` avant tout build.
