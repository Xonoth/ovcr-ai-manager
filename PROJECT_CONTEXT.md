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

- **Electron** `^43.7.1` (app desktop, un process principal + un renderer).
- **HTML/CSS/JS vanilla** — pas de framework (pas de React/Vue). Tout le front est dans un seul fichier `index.html` (+ un petit `assets/icons.js` pour les icônes).
- **Monaco Editor** `^0.45.0` (l'éditeur de VS Code), chargé en local depuis `node_modules`.
- **Polices & icônes 100% LOCALES** (plus aucun CDN externe) : polices Google Fonts en `.woff2` sous `assets/fonts/`, icônes ex-Font Awesome converties en **SVG inline** dans `assets/icons.js`. L'app s'affiche donc identiquement hors-ligne.
- **Packaging** : `@electron/packager` (génère un dossier + `.exe`). `electron-builder` a été **retiré des devDependencies** (septembre 2026) : il **ne fonctionne pas sur cette machine** (il exige des droits admin/Mode développeur pour créer des liens symboliques) et traînait 11 alertes `npm audit` dont une critique. Le bloc `build` de `package.json` (config electron-builder) est **conservé** : il ne coûte rien et servira tel quel si on réinstalle l'outil un jour.
- Pas de TypeScript, pas de bundler (Webpack/Vite), pas de tests automatisés.

## 3. Structure des fichiers

```
ai-manager/
├── index.html          # TOUTE l'app : HTML + CSS (<style>) + JS (<script>). ~1285 lignes.
├── main.js             # Process principal Electron (~155 lignes). Fenêtre + IPC fichiers + durcissement navigation/popups.
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
└── dist/               # sorties de build (généré par `npm run dist`) + OVCR-AI-Manager.zip (à distribuer) — NON versionné
```

- **Tout le code applicatif (UI, logique comptes, éditeur, redimensionnement) est dans `index.html`**, dans une grande fonction `initApp()`.
- `assets/icons.js` est chargé avant l'app (`<script src>` dans le `<head>`) et expose `window.OVCR_ICONS` + `window.hydrateIcons(root)`.
- `main.js` : crée la fenêtre, fixe le dossier de données, **durcit la navigation/les popups** (voir §10), et expose 4 handlers IPC fichiers (`select-folder`, `read-directory`, `read-file`, `save-file`).

## 4. Comment lancer / construire

- **Lancer en dev** : `npm start` (= `electron .`)
- **Construire le .exe** : `npm run dist`
  → produit `dist/[OVCR] AI Manager-win32-x64/` contenant `[OVCR] AI Manager.exe` (dossier complet requis, l'exe seul ne suffit pas).
  → pour partager : zipper ce dossier. Un zip prêt à distribuer existe déjà : `dist/OVCR-AI-Manager.zip` (**135,7 Mo** depuis Electron 43.7.1, contient le dossier complet — 130 fichiers — à la racine).
  → le script `dist` enchaîne automatiquement `node scripts/prune-locales.js` (purge des locales Chromium hors fr/en-US/en-GB : −44,9 Mo) et exclut les traductions Monaco `editor.main.nls.<langue>.js` (Monaco tourne avec ses libellés anglais de base, seul `editor.main.nls.js` est gardé).
- Le **.exe n'est pas signé** → Windows SmartScreen affiche un avertissement aux utilisateurs (normal).

> ℹ️ Le build `dist/` est à jour (nom, thème, durcissement A/B/C/D, bouton d'ajout de compte). L'ancien build « AI Agentic Workbench » et son zip ont été supprimés. Après toute modif de `index.html`/`main.js`/`assets/`, relancer `npm run dist` **puis** recréer le zip (voir ci-dessous).

> **Recréer le zip** (PowerShell, à cause des crochets `[ ]` dans le nom de dossier qui cassent l'expansion `-Path`) :
> ```powershell
> Compress-Archive -LiteralPath "dist\[OVCR] AI Manager-win32-x64" -DestinationPath "dist\OVCR-AI-Manager.zip" -CompressionLevel Optimal
> ```

## 5. Données & stockage

Deux endroits distincts, à ne pas confondre :

1. **Métadonnées des comptes** → `localStorage` du renderer.
   - Clé `ai_accounts` : tableau JSON de comptes.
   - Clé `ai_accounts_backup` : **copie de sauvegarde** (1 seule génération) écrite automatiquement avant chaque écrasement de `ai_accounts` — sert à la récupération si `ai_accounts` est corrompu (voir §7, chantier C).
   - Clés `ide_w`, `explorer_w` : largeurs mémorisées des colonnes.
   - Clé `collapsed_accounts` : tableau JSON des ids de comptes dont la carte est **repliée** (vue compacte). Lecture/écriture défensives (`try/catch`), purgée des ids de comptes supprimés à chaque écriture (`saveCollapsed()`).
   - **Stocké EN CLAIR** (pas de chiffrement — un mot de passe maître avait été prototypé puis retiré à la demande de l'utilisateur).
   - **Chargement résilient** : le `JSON.parse` de `ai_accounts` est protégé (`readJSON`). Une donnée corrompue ne plante plus l'app ; une modale propose de restaurer `ai_accounts_backup`. Les écritures de **`ai_accounts`** passent toutes par `saveAccounts()`. (`ide_w`/`explorer_w` restent des chaînes lues/écrites en direct — lectures et écritures désormais enveloppées d'un `try/catch`.)

2. **Sessions de connexion IA (cookies/tokens)** → dossier de données Electron.
   - Chemin : `%APPDATA%\ai-manager\Partitions\profil_X\` (un dossier par profil).
   - **Fixé en dur** dans `main.js` via `app.setPath('userData', ...'ai-manager')` pour que la version packagée réutilise le même profil quel que soit le nom du produit.
   - ⚠️ Les cookies y sont **stockés en clair** (vérifié : Electron ne les chiffre pas ici). Aucune protection au repos n'est implémentée (l'utilisateur a écarté BitLocker/VeraCrypt pour le moment).

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
  // cooldown = timestamp ms de fin de cooldown (0 = disponible)
}
```
Une fonction `migrateOldAccounts()` répare/complète automatiquement les anciens comptes (ajoute services/cooldowns manquants).

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
- `openService(accId, svcId)` — crée un `<webview partition="persist:<profil>" src="<url>">` dans le panneau actif, et déplie la carte du compte si elle était repliée.
- **Bouton « Ajouter un compte »** : un `+` en tête de la liste (à côté du titre « Comptes enregistrés ») + le bouton « Créer mon premier compte » de l'état vide. Les deux portent `data-action="add"` → `openModal()` en mode ajout. *(Avant ce lot, aucun bouton d'ajout n'existait dans l'UI.)*
- `openModal()` / `saveAccount()` / `openDeleteModal()` / `confirmDelete()` — CRUD des comptes.
- `toggleCooldown(accId, svcId)` — bascule le cooldown 24h d'un service.
- `setLayout(mode)` — vue 1 ou 2 panneaux ; gère la poignée de redimensionnement entre panneaux IA. Repasser en vue simple **ne détruit pas** la webview du panneau 2 (session conservée, mais RAM occupée ~100-250 Mo).
- **Bouton « Fermer le panneau 2 »** (`#btnClosePane2`, icône `times-circle` dans la barre du workspace) : visible **uniquement** quand une webview vit dans le panneau 2 (y compris cachée en vue simple — géré par `updateClosePane2Btn()`, appelée par `openService`/`closePane2`). `closePane2()` détruit la webview (`innerHTML` → le process invité Chromium est tué, RAM libérée), restaure le placeholder « Panneau 2 vide » et masque le bouton. En vue scindée, `openService` **cible en priorité un panneau vide** (le panneau 2 fraîchement fermé est re-rempli au prochain service, sans écraser le panneau 1) ; l'alternance habituelle reprend quand les deux panneaux sont occupés.
- `toggleDashboard()` / `toggleExplorer()` / `toggleIdePanel()` — replier/déplier les panneaux.
- **Éditeur** : Monaco est chargé **PARESSEUSEMENT** (audit perf) : `ensureMonacoLoaded()` n'appelle `loadMonaco()` qu'à la **première ouverture du panneau éditeur** (`toggleIdePanel`), plus au démarrage — un placeholder « Chargement de l'éditeur… » s'affiche ~0,3-0,7 s. Économie au démarrage : ~4 Mo de JS non parsés, ~12 Mo de heap. `loadMonaco()` garde le chemin ABSOLU calculé depuis l'emplacement d'`index.html` (crucial pour le .exe packagé). Si Monaco échoue, `__initFallbackEditor()` crée un éditeur de secours (`<textarea>`) fonctionnel avec Ctrl+S. Accès unifié via `getEditorValue()` / `setEditorContent()`.
- **Redimensionnement** : `setupResizers()` + `makeResizer()` — colonnes ajustables à la souris (éditeur, explorateur, entre panneaux IA), via `flex-basis` (pas `width`) pour contourner un piège de flexbox avec Monaco ; largeurs mémorisées dans `localStorage`.
- **Palette** : `Ctrl+K` ouvre une recherche rapide de compte/IA (`filterPalette()`).
- **Page d'aide « Comprendre les IA disponibles »** : bouton `?` (icône `circle-question`) dans la barre du workspace (toujours visible, même sidebar repliée) → `openHelpModal()` remplit `#helpList` depuis `SERVICES` + **`SERVICE_INFO`** (objet statique indexé par id : `{ what, when }` — descriptions grand public, aucune requête réseau) et ouvre la modale `#helpModal` (réutilise `.modal-overlay`/`.modal` + variante `.modal--help` : hauteur bornée à la fenêtre, seule la liste scrolle). Fermeture : bouton, Échap (handler global existant), clic sur le fond. Un service sans fiche `SERVICE_INFO` affiche « Description à venir ». Lecture seule : ne touche ni comptes, ni cooldowns.
- **Sécurité / robustesse (lot de durcissement A/B/C/D)** :
  - `escapeHtml(str)` — échappe `& < > " '`. À utiliser **partout** où une donnée utilisateur (nom/email/profil de compte, nom de fichier) est injectée en `innerHTML`. Critique car le renderer tourne en `nodeIntegration:true`.
  - **Délégation d'événements** : un seul listener `click` par conteneur stable (`#accountsList`, `#paletteResults`, `#fileList`) lit `data-action`/`data-acc`/`data-svc`/`data-path`. Plus aucune donnée n'est injectée dans un attribut `onclick` généré. (Les `onclick` **statiques** codés en dur, sans donnée utilisateur, sont conservés.)
  - `readJSON(key)` / `saveAccounts(list)` / `exportAccountsJSON()` / `importAccountsJSON(text)` / `showRecoveryUI()` — stockage résilient + fondation d'un futur export/import JSON. `saveAccounts` ne recopie l'ancienne valeur dans le backup que si elle est un JSON **valide** (ne détruit jamais un bon backup).
- **Icônes** : `hydrateIcons(root)` (dans `assets/icons.js`) remplace chaque `<span class="ic" data-icon="NOM">` par son SVG. Appelé au démarrage (HTML statique) et après chaque `innerHTML` dynamique. Ajouter une icône = ajouter une entrée `{vb, p}` dans `window.OVCR_ICONS` (viewBox + path).

## 8. UI / Thème (communauté OverCreep, violet / rose)

- Défini par des variables CSS dans `:root` (fichier `index.html`).
- Accent principal : **`--accent: #8b5cf6`** (violet officiel OverCreep). Rose : `--rose: #f230aa`. Halo : `--accent-glow: rgba(139,92,246,.35)`.
- Fonds sombres légèrement violacés (`--bg: #0b0817`, relevé sur overcreep.ovh), bordures teintées violet, fond « aurora » en dégradés radiaux CSS purs.
- Logo (`.header__icon`) : dégradé **rose → violet** (`var(--rose)` → `var(--accent)`).
- Stats : « Comptes actifs » en violet, « IA disponibles » en rose.
- Les couleurs de marque des IA (Claude/ChatGPT/Gemini/Perplexity/Grok) sont **conservées** pour la reconnaissance ; Z.ai est violet et s'intègre au thème ; Leonardo AI est magenta (`--leonardo: #d946ef`), distinct du violet Z.ai et du rose du thème. Suno est **orange-rouge** (`--suno: #f8441b` — sa marque officielle est noir/blanc, on reprend le pôle orange du dégradé signature rose→orange de son app, le rose étant trop proche de Leonardo) ; Meshy AI est **vert lime** (`--meshy: #c5f955`, couleur dominante relevée sur meshy.ai).
- Polices et icônes **désormais 100% locales** (`assets/fonts/` + `assets/icons.js`) — plus aucune dépendance Internet pour l'ossature visuelle. Monaco est local. Les `@font-face` sont dans le `<style>` d'`index.html` avec des chemins **relatifs** (valables en dev ET en `.exe`).

## 9. Comportements par défaut importants

- L'éditeur de code et l'explorateur de fichiers démarrent **repliés** (classe `collapsed` sur `#idePanel` et `#fileExplorer`) → toute la largeur va aux panneaux IA au lancement.
- Les webviews sont **persistantes** : une fois connecté à un service dans un profil, la session est mémorisée (cookies dans `Partitions/`).

## 10. Architecture Electron & points de sécurité (état actuel)

- `main.js` crée la `BrowserWindow` avec **`nodeIntegration: true`** et **`contextIsolation: false`** + `webviewTag: true`. Reste **la principale faiblesse de fond** : la page privilégiée a un accès complet à Node/OS. Non corrigé (migration `contextIsolation` = chantier séparé, volontairement hors périmètre du lot A/B/C/D).
- **Durcissement DÉJÀ EN PLACE (lot B)** dans `main.js` :
  - `will-navigate` sur la fenêtre hôte → bloque toute navigation qui n'est pas vers le `index.html` local (l'hôte privilégié ne part jamais sur une URL distante).
  - `setWindowOpenHandler` sur l'hôte → refuse toute nouvelle fenêtre.
  - `did-attach-webview` → filtre les popups des `<webview>` via une **liste blanche d'origines** (`ALLOWED_POPUP_HOSTS` : les 9 services + fournisseurs d'auth OAuth type Google/Microsoft/Apple/GitHub/Discord). Popup whitelistée → autorisée (sans privilège Node) ; lien web hors-liste → ouvert dans le **navigateur système** (`shell.openExternal`) ; schéma non-web → refusé. `allowpopups` reste sur les webviews (nécessaire aux flux OAuth), mais désormais filtré.
- **Échappement HTML DÉJÀ EN PLACE (lot A)** : un nom de compte contenant du HTML/JS n'est plus exécutable (voir §7).
- Améliorations de sécurité **encore À FAIRE** : ajouter une **CSP** stricte sur `index.html` (le rapatriement des CDN, prérequis, est fait), durcir davantage les webviews, et à terme migrer vers `contextIsolation: true` + `preload` + IPC. Chiffrement au repos (`safeStorage`/DPAPI) : non fait (choix en pause).
- Les cookies de session et les métadonnées de comptes restent **en clair** (voir §5).

## 11. Limites connues / dettes

- Tout dans un seul `index.html` (pas de séparation JS/CSS) — difficile à maintenir en grandissant. (Le seul fichier extrait à ce jour est `assets/icons.js`.)
- Pas de tests automatisés dans le repo. *(Les fonctions pures du lot A/B/C — `escapeHtml`, `isAllowedPopup`, `readJSON`/`saveAccounts` — ont été validées par un script de test ponctuel hors repo, non conservé.)*
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

Explicitement **hors périmètre** (chantiers séparés, non faits) : CSP, migration `contextIsolation`/`preload`, chiffrement au repos, découpage de `index.html`.

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
- **Zip de distribution régénéré** : `dist/OVCR-AI-Manager.zip`, **135,7 Mo**
  (contre ~129 Mo). Vérifié en conditions réelles : dézippé dans un dossier
  neuf, 130 fichiers extraits (= le compte exact du dossier source), `.exe`
  lancé depuis l'extraction, l'app démarre sans erreur.
- **Piège repéré au passage** : le chemin interne le plus long du zip fait
  142 caractères (`…/monaco-editor/min/vs/basic-languages/restructuredtext/`).
  Dézippé dans un dossier déjà profond, Windows refuse silencieusement une
  partie des fichiers (limite MAX_PATH 260). Avertissement ajouté au
  `DISTRIBUTION-LISEZ-MOI.txt` : extraire dans un chemin court.

### Note pour l'IA qui reçoit ce contexte
Quand tu proposes une modification : précise **dans quel fichier** (quasiment toujours `index.html`, parfois `main.js`), rappelle que c'est du **JS vanilla dans un `<script>`** (pas de modules/build), respecte les **variables CSS du thème** existantes, et n'oublie pas que l'app tourne aussi **packagée en .exe** (chemins relatifs vs absolus — voir le chargement de Monaco).

Quelques réflexes issus du dernier lot : **toute donnée utilisateur injectée en HTML doit passer par `escapeHtml()`** ; les nouvelles listes cliquables doivent utiliser la **délégation d'événements** (`data-*`) et non des `onclick` générés ; les **écritures de comptes passent par `saveAccounts()`** (jamais `localStorage.setItem` direct) ; une **nouvelle icône** s'ajoute dans `window.OVCR_ICONS` (`assets/icons.js`) puis s'utilise via `<span class="ic" data-icon="…">` + `hydrateIcons()`.
