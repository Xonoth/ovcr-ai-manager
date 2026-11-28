# Sécurité — [OVCR] AI Manager

État après la **phase 1 « Sécurité et fondations »**, la **phase 2 « Fiabilité et robustesse »** et le début de la **phase 3** (Electron 45 en 1.3.0, fuses en 1.4.0, cookies chiffrés en 1.5.0, restes de l'audit en 1.6.0 ; novembre 2026). Ce document décrit le modèle de sécurité, ce qui est protégé, et surtout ce qui **ne l'est pas**. La phase 2 n'a assoupli **aucune** règle de la phase 1 : elle est vérifiée par des tests automatisés (`test/unit/security-policy.test.js`, `test/integration/smoke.js`).

## 1. Modèle : qui a le droit de faire quoi

| Contexte | Contenu | Node.js | Sandbox | Accès au disque / comptes |
|---|---|---|---|---|
| Processus principal (`main.js` + modules) | code de l'app | oui | — | oui, **seul** à y toucher |
| Fenêtre hôte (`index.html` + `renderer/*.js`) | interface locale | **non** | oui | uniquement via `window.ovcr` (preload), validé par le main |
| `<webview>` des services IA | sites distants | non | oui | aucun |
| Popups OAuth | sites distants | non | oui | aucun |

`app.enableSandbox()` impose la sandbox Chromium à **tous** les processus de rendu.

## 2. Fenêtre hôte

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`.
- **Preload `app-preload.js`** : expose `window.ovcr` avec une liste **fermée** de méthodes (une par opération). Jamais `ipcRenderer`, `require`, `process`, ni fonction « envoyer sur n'importe quel canal ».
- **Chaque canal IPC vérifie l'expéditeur** (`isTrustedSender`, règle pure dans `security-policy.js`) : il faut être le cadre principal de la fenêtre hôte, chargé depuis **exactement** l'`index.html` local. Une autre fenêtre, une webview ou une popup — même avec un preload qui aurait `ipcRenderer` — est refusée.
- Canaux ajoutés en phase 2, avec la même vérification :
  - `services:open-in-browser(url)` : n'ouvre dans le navigateur système qu'une URL **https** d'un domaine de `ALLOWED_POPUP_HOSTS` (refus et trace sinon) ;
  - `diag:report(payload)` : objet validé, textes tronqués (2 000 / 4 000 caractères), niveau « fatal » interdit, **60 rapports par minute** au plus ; tout est expurgé avant écriture ;
  - `diag:get()` : lecture seule (versions, état du stockage sans contenu, mémoire, derniers événements expurgés) ;
  - `diag:open-logs()` : aucun paramètre, ouvre le dossier **fixe** `userData/logs`.
- Une erreur imprévue dans un canal est journalisée côté main ; l'interface ne reçoit qu'un message générique (`Erreur interne (<canal>)`), sans pile ni détail interne.
- **Instance unique** (`app.requestSingleInstanceLock()`, sur le dossier de données) : deux instances n'écrivent jamais les mêmes fichiers en parallèle.
- Navigation : la fenêtre hôte ne peut charger que son `index.html` ; elle ne peut ouvrir aucune fenêtre.
- Autorisations (position, micro, caméra, notifications…) : l'interface n'a que le presse-papiers (éditeur) et le plein écran.

### Content Security Policy

Posée par `<meta>` dans `index.html`, elle ne concerne **que l'interface** — chaque webview garde la CSP envoyée par son propre site.

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self';
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- **Aucun script inline, aucun `eval`** : tout le JS est dans des fichiers (`assets/icons.js`, `renderer/*.js`, Monaco), les boutons statiques passent par `data-cmd` au lieu de `onclick`.
- `style-src 'unsafe-inline'` est conservé : attributs `style=""` de l'interface et balises `<style>` injectées par Monaco. Cela n'exécute aucun code.
- Aucune connexion réseau depuis l'interface ; les `<webview>` ne sont pas des iframes et ne dépendent pas de `frame-src`.
- Monaco tourne sans `unsafe-eval`, avec ses web workers (`worker-src 'self'`).

### Binaire packagé : fuses Electron (depuis la 1.4.0)

Les fuses sont des octets écrits dans le `.exe` lui-même, lus par Electron avant tout code JS. `npm run dist` les applique (`scripts/fuses.js`, une seule source), les **relit** et échoue si l'état obtenu diffère ou si l'empreinte d'`app.asar` manque dans le `.exe`. Ils ne concernent que le binaire de `dist/` : `npm start` et les tests utilisent l'Electron de `node_modules`, jamais modifié.

| Fuse | État | Effet |
|---|---|---|
| `RunAsNode` | désactivé | `ELECTRON_RUN_AS_NODE=1` ne transforme plus le `.exe` en Node.js : l'app démarre normalement. |
| `EnableNodeOptionsEnvironmentVariable` | désactivé | `NODE_OPTIONS` ignoré. (Electron refusait déjà `--require` dans une app packagée, mais d'autres options passaient.) |
| `EnableNodeCliInspectArguments` | désactivé | `--inspect` / `--inspect-brk` ignorés : pas de débogueur attachable au `.exe`. |
| `EnableEmbeddedAsarIntegrityValidation` | activé | Refus de démarrer si l'en-tête d'`app.asar` ne correspond plus à l'empreinte inscrite dans le `.exe` (ressource `ELECTRONASAR`, écrite par `@electron/packager`), refus de lire un fichier de l'archive dont le contenu a changé. |
| `OnlyLoadAppFromAsar` | activé | Un dossier `resources/app` posé à côté n'est pas chargé. |
| `GrantFileProtocolExtraPrivileges` | **activé** (défaut) | Nécessaire tant que l'interface est en `file://` (chantier `app://`, voir §7). |
| `EnableCookieEncryption` | **activé** depuis la 1.5.0 | Les cookies des sessions sont chiffrés sur le disque. Décision de l'utilisateur, **irréversible** : voir §5 « Cookies chiffrés ». |
| `LoadBrowserProcessSpecificV8Snapshot`, `WasmTrapHandlers` | défauts d'Electron | Écrits explicitement : chaque fuse est décidé (une future version d'Electron qui en ajoute un fait échouer le build). |

Vérifié par `npm run test:fuses` sur une app **jetable** construite comme la vraie, avec le même Electron et le même jeu de fuses : chaque contournement est d'abord constaté **sans** fuses (témoin), puis refusé **avec**. L'app jetable vérifie aussi qu'une page de l'archive charge toujours un script de `app.asar.unpacked`, comme l'interface charge Monaco. Le vrai `.exe` n'est jamais lancé par les tests (il utiliserait le vrai profil).

## 3. Webviews et popups

À chaque création de `<webview>` (`will-attach-webview`), le main **impose** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, supprime tout preload demandé par la page, et refuse la webview si :

- son adresse n'est pas en `https://` vers un domaine de `ALLOWED_POPUP_HOSTS` ;
- elle n'a pas de partition `persist:<profil>` (sinon elle partagerait la session de l'interface).

Seul le preload d'identité navigateur (`browser-identity-preload.js`, enregistré sur la session) s'exécute dans les sites.

Popups : seules les origines de `ALLOWED_POPUP_HOSTS` ouvrent une fenêtre (sandboxée, même session que la webview) ; un autre lien web part dans le navigateur système, **au plus 5 par minute et par page** depuis la 1.6.0 (au-delà, le lien est ignoré et une ligne est écrite dans le journal) ; les autres schémas sont refusés. Le filtre s'applique aussi aux popups ouvertes **depuis** une popup. Une popup est **fermée avec sa page d'origine** (panneau fermé ou changé de service, depuis la 1.6.0) : elle ne reste pas ouverte sans personne à qui répondre. Aucune webview ne peut en imbriquer une autre.

## 4. Fichiers (explorateur + éditeur) — `file-access.js`

Aucune validation côté renderer n'est considérée comme suffisante ; tout est contrôlé dans le main :

- un dossier n'est accessible qu'après avoir été choisi dans la boîte « Choisir un dossier » (**racines autorisées**, pour la session) ;
- chemin : chaîne absolue, sans octet nul, hors espaces de noms `\\?\` / `\\.\`, normalisé (`path.resolve`), puis **résolu** (`realpath`, liens symboliques et jonctions suivis) et obligatoirement **dans** une racine autorisée → `..\`, chemins absolus extérieurs, liens qui sortent : refusés ;
- lecture : fichier régulier, **20 Mo max**, binaires refusés (octet nul), fichiers non UTF-8 ouverts **en lecture seule** (les réenregistrer les abîmerait) ;
- écriture : uniquement un fichier **ouvert au préalable** dans l'éditeur → impossible de créer ou d'écraser un fichier arbitraire ; 20 Mo max.

Pas de liste blanche d'extensions : l'éditeur sert à du code de toute sorte (`.lua`, `.py`, `.gitignore`…) ; la règle « seulement un fichier ouvert, dans le dossier choisi » est plus protectrice qu'un filtre par extension.

## 5. Données locales

| Donnée | Emplacement | Protection |
|---|---|---|
| Comptes (noms, e-mails, profils, cooldowns) | `%APPDATA%\ai-manager\accounts.json` (+ `.bak`) | **chiffré** `safeStorage` (DPAPI : lisible seulement par ce compte Windows). Profil **neuf** : en clair quelques secondes, le temps que Chromium écrive la clé sur le disque (voir ci-dessous) |
| Sauvegardes (`pre-migration-*`, `pre-schema-*`, `bak-preserved-*`) | `%APPDATA%\ai-manager\backups\` | copies d'enveloppes : chiffrées de même ; jamais supprimées par l'app |
| Autorisations des sites | `%APPDATA%\ai-manager\site-permissions.json` | en clair (origines + oui/non : rien de personnel) |
| Préférences d'affichage (largeurs, cartes repliées) | `localStorage` | en clair (non sensibles) |
| Journal de diagnostic | `%APPDATA%\ai-manager\logs\ovcr*.log` (3 × 1 Mo max) | en clair, **expurgé** : e-mails masqués, URL réduites à l'hôte (pas de jeton OAuth), nom du compte Windows retiré des chemins ; ne contient que des identifiants techniques (id de compte, hôte, code d'erreur). Rien n'est envoyé : l'utilisateur copie le diagnostic s'il veut le partager. |
| **Cookies / sessions des services IA** | `%APPDATA%\ai-manager\Partitions\<profil>\Network\Cookies` | **chiffrés** depuis la 1.5.0 (fuse `EnableCookieEncryption`, même DPAPI et même clé que `safeStorage`), **sauf** les cookies écrits en clair par une version antérieure et pas encore réécrits — voir ci-dessous |

### Premier enregistrement d'un profil neuf (depuis la 1.6.0)

La clé de `safeStorage` est rangée dans `Local State`, que Chromium n'écrit qu'**environ 10 s** après l'avoir créée. Jusqu'à la 1.5.0, un arrêt brutal dans cet intervalle (plantage, coupure de courant, fin de tâche) rendait les premiers comptes **indéchiffrables**. Depuis la 1.6.0, l'app crée la clé dès le démarrage et, tant qu'elle n'est pas sur le disque, écrit les comptes **en clair** ; elle les rechiffre (avec `.bak` et `backups/`) dès que la clé y est. Ne concerne qu'un profil neuf : premier lancement, ou migration depuis la 1.0.4. Le contenu en clair a pu rester dans les secteurs libres du disque, comme pour toute réécriture de fichier.

### Cookies chiffrés (depuis la 1.5.0)

Mesuré avec Electron 45.3.2 sur une app jetable (`npm run test:cookies`, 17 vérifications) :

- **Mise à jour sans perte** : la 1.5.0 relit tous les cookies écrits en clair par une version antérieure. Aucune reconnexion n'est nécessaire.
- **Chiffrement au fil de l'eau** : un cookie nouveau ou réécrit par un service est enregistré chiffré (préfixe `v10`, AES-GCM, clé protégée par DPAPI dans `Local State`). L'ancienne valeur en clair disparaît des fichiers (`Cookies` et `Cookies-journal`).
- **Ce qui reste en clair** : Chromium ne rechiffre **pas** les cookies existants. Un cookie de connexion longue durée (par exemple ceux de Google) peut donc rester en clair des mois, tant que le service ne le renouvelle pas. Pour protéger **tout de suite** un compte, il suffit de **se déconnecter du service puis de se reconnecter** : la nouvelle session est chiffrée et l'ancienne est effacée (vérifié par le test). Un rechiffrement automatique par l'API `cookies` d'Electron a été écarté : il perdrait des attributs qu'elle ne sait pas exprimer (partition CHIPS, priorité, date de création), avec un risque de déconnexion, Google surtout.
- **Irréversible** : une version **sans** ce fuse (1.4.0 et antérieures, ou la 1.0.4 après `--revert-storage-migration`) **efface tous les cookies de toutes les partitions** au démarrage, y compris ceux qui étaient encore en clair : il faut se reconnecter partout. Revenir ensuite à la 1.5.0 ne les rend pas. Les comptes (`accounts.json`) ne sont pas concernés : ils restent lisibles dans les deux sens. Seule parade : une **copie du dossier** `%APPDATA%\ai-manager` faite **avant** le passage à la 1.5.0, remise en place avant de relancer l'ancienne version. Cette copie contient les anciens cookies en clair : la supprimer une fois la 1.5.0 adoptée.

### Migration depuis la 1.0.4 (automatique, une fois)

Au premier lancement, le renderer transmet les anciennes clés `localStorage` (`ai_accounts`, `ai_accounts_backup`) au main, qui :

1. écrit une **sauvegarde préalable** chiffrée de l'état d'origine dans `backups/` ;
2. écrit `accounts.json` / `accounts.json.bak` (chaînes reprises telles quelles, même corrompues : la récupération par la sauvegarde reste possible) ;
3. relit et compare ; en cas d'écart, annule.

Le renderer n'efface les clés `localStorage` qu'après ce succès. Les cookies (`Partitions/`) ne sont **pas touchés** : les sessions restent connectées.

### Retour arrière (vers la 1.0.4)

```powershell
& ".\[OVCR] AI Manager.exe" --revert-storage-migration
```

Les comptes **actuels** sont réécrits dans le `localStorage` au format 1.0.4, `accounts.json(.bak)` sont renommés en `*.reverted-<date>.json` (rien n'est supprimé), puis l'app se ferme : la 1.0.4 peut être relancée. Testé : la vraie 1.0.4 relit alors les comptes, y compris les modifications faites après la migration. **Depuis la 1.5.0**, la 1.0.4 ne relit plus les cookies chiffrés : les comptes reviennent, mais il faut se reconnecter à tous les services (voir « Cookies chiffrés »).

### Récupération

Fichier corrompu, indéchiffrable (autre compte Windows, mot de passe Windows réinitialisé par un administrateur) ou **introuvable** alors qu'une sauvegarde existe → modale proposant la sauvegarde. Un fichier illisible est toujours **mis de côté** (`accounts.unreadable-<date>.json`), jamais supprimé ; si l'utilisateur continue sans restaurer, une **copie de la sauvegarde** est d'abord mise à l'abri dans `backups/` (elle ne peut plus être écrasée par les rotations suivantes). En dernier recours, recréer un compte avec le **même nom de profil** retrouve sa session.

Données écrites par une **version plus récente** de l'app (schéma ou conteneur) ou dont la **migration a échoué** : affichées en **lecture seule** — ni l'interface ni le main ne les réécrivent (le main refuse `newer_schema` / `migration_pending` même si l'interface le demandait).

## 6. Limites restantes (assumées, à connaître)

- **Cookies écrits avant la 1.5.0** : restés en clair dans `Partitions/` tant que le service ne les a pas renouvelés (se déconnecter puis se reconnecter les remplace, §5). Les cookies sont gérés par Chromium, pas par l'app ; l'app ne les lit ni ne les exporte. Le chiffrement est **irréversible** : revenir à une version antérieure efface toutes les sessions.
- `safeStorage`/DPAPI (comptes **et** cookies depuis la 1.5.0) protège contre les autres comptes Windows et la copie du disque à froid, **pas** contre un programme malveillant qui tourne sous votre compte (il peut demander le déchiffrement lui-même). Règle inchangée : **une session Windows = une personne**.
- Les anciennes valeurs effacées du `localStorage` peuvent subsister quelque temps dans les fichiers internes de LevelDB (`Local Storage\leveldb\*.log`) jusqu'à leur compactage par Chromium.
- `style-src 'unsafe-inline'` dans la CSP (nécessaire à Monaco et aux styles en ligne).
- Exécutable non signé (SmartScreen). La vérification d'intégrité (1.4.0) protège `app.asar` contre une modification **isolée**, mais : elle ne couvre ni `app.asar.unpacked` (Monaco, chargé par l'interface), ni le `.exe` et les DLL ; et sans signature, rien n'empêche de remplacer **ensemble** le `.exe` et `app.asar` (ou d'inscrire une nouvelle empreinte). Comme pour `safeStorage`, cela ne protège pas d'un programme malveillant qui écrit déjà dans le dossier de l'app : la signature (§7) est le complément.
- La liste `ALLOWED_POPUP_HOSTS` fait confiance à tous les sous-domaines de ses entrées (ex. `*.google.com`).
- Un site autorisé peut toujours ouvrir des liens dans le navigateur système, mais au plus 5 par minute et par page depuis la 1.6.0.
- **Electron** : passé de 43.7.1 à 43.8.10 en 1.2.0 (4 alertes `npm audit` d'Electron corrigées), puis à **45.3.2** en 1.3.0 (Chromium **156.0.8078.100**), avant la fin de support de la 43 (Electron ne corrige que les 3 dernières versions majeures). Version désormais **figée** dans `package.json`. Le changement de Chromium modifie la marque « GREASE » annoncée (`"Not:A-Brand"` v8 en 156) : un test d'intégration la compare à celle que Chromium calcule lui-même, et vérifie que FedCM reste désactivé. La connexion Google réelle reste à valider à la main à chaque montée de Chromium. Le chiffrement des comptes passe par l'**API asynchrone** de `safeStorage` (l'API synchrone disparaît en Electron 46) : même DPAPI, même clé, même format, donc même protection et retour arrière vers la 1.2.0 possible. Attention, `npm audit --omit=dev` ne voit pas Electron (déclaré en dépendance de développement alors qu'il est **embarqué dans le .exe**) : toujours lancer `npm audit` complet. Les alertes restantes concernent les **outils de développement** (packager, ESLint), pas le .exe : `undici` corrigé en 1.6.0 (7.30.2) ; `glob`, `minimatch`, `@electron/asar`, `eslint` (« moderate ») attendent eslint 10.16.0 et @electron/packager 20.3.1, publiés le 27/11/2026 (règle des deux semaines : pas avant le 11/12/2026).

## 7. Pistes pour la suite (non faites)

- Signature de l'exécutable.
- Protocole `app://` personnalisé à la place de `file://` (origine propre ; demanderait une migration du `localStorage` restant).
