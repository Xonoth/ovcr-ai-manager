# Sécurité — [OVCR] AI Manager

État après la **phase 1 « Sécurité et fondations »** (novembre 2026). Ce document décrit le modèle de sécurité, ce qui est protégé, et surtout ce qui **ne l'est pas**.

## 1. Modèle : qui a le droit de faire quoi

| Contexte | Contenu | Node.js | Sandbox | Accès au disque / comptes |
|---|---|---|---|---|
| Processus principal (`main.js` + modules) | code de l'app | oui | — | oui, **seul** à y toucher |
| Fenêtre hôte (`index.html` + `renderer/app.js`) | interface locale | **non** | oui | uniquement via `window.ovcr` (preload), validé par le main |
| `<webview>` des services IA | sites distants | non | oui | aucun |
| Popups OAuth | sites distants | non | oui | aucun |

`app.enableSandbox()` impose la sandbox Chromium à **tous** les processus de rendu.

## 2. Fenêtre hôte

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`.
- **Preload `app-preload.js`** : expose `window.ovcr` avec une liste **fermée** de méthodes (une par opération). Jamais `ipcRenderer`, `require`, `process`, ni fonction « envoyer sur n'importe quel canal ».
- **Chaque canal IPC vérifie l'expéditeur** (`isTrustedSender` dans `main.js`) : il faut être le cadre principal de la fenêtre hôte, chargé depuis **exactement** l'`index.html` local. Une autre fenêtre, une webview ou une popup — même avec un preload qui aurait `ipcRenderer` — est refusée.
- Navigation : la fenêtre hôte ne peut charger que son `index.html` ; elle ne peut ouvrir aucune fenêtre.
- Autorisations (position, micro, caméra, notifications…) : l'interface n'a que le presse-papiers (éditeur) et le plein écran.

### Content Security Policy

Posée par `<meta>` dans `index.html`, elle ne concerne **que l'interface** — chaque webview garde la CSP envoyée par son propre site.

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self';
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- **Aucun script inline, aucun `eval`** : tout le JS est dans des fichiers (`assets/icons.js`, `renderer/app.js`, Monaco), les boutons statiques passent par `data-cmd` au lieu de `onclick`.
- `style-src 'unsafe-inline'` est conservé : attributs `style=""` de l'interface et balises `<style>` injectées par Monaco. Cela n'exécute aucun code.
- Aucune connexion réseau depuis l'interface ; les `<webview>` ne sont pas des iframes et ne dépendent pas de `frame-src`.
- Monaco tourne sans `unsafe-eval`, avec ses web workers (`worker-src 'self'`).

## 3. Webviews et popups

À chaque création de `<webview>` (`will-attach-webview`), le main **impose** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, supprime tout preload demandé par la page, et refuse la webview si :

- son adresse n'est pas en `https://` vers un domaine de `ALLOWED_POPUP_HOSTS` ;
- elle n'a pas de partition `persist:<profil>` (sinon elle partagerait la session de l'interface).

Seul le preload d'identité navigateur (`browser-identity-preload.js`, enregistré sur la session) s'exécute dans les sites.

Popups : seules les origines de `ALLOWED_POPUP_HOSTS` ouvrent une fenêtre (sandboxée, même session que la webview) ; un autre lien web part dans le navigateur système ; les autres schémas sont refusés. Le filtre s'applique aussi aux popups ouvertes **depuis** une popup. Aucune webview ne peut en imbriquer une autre.

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
| Comptes (noms, e-mails, profils, cooldowns) | `%APPDATA%\ai-manager\accounts.json` (+ `.bak`) | **chiffré** `safeStorage` (DPAPI : lisible seulement par ce compte Windows) |
| Sauvegarde avant migration | `%APPDATA%\ai-manager\backups\pre-migration-*.json` | chiffrée de même |
| Autorisations des sites | `%APPDATA%\ai-manager\site-permissions.json` | en clair (origines + oui/non : rien de personnel) |
| Préférences d'affichage (largeurs, cartes repliées) | `localStorage` | en clair (non sensibles) |
| **Cookies / sessions des services IA** | `%APPDATA%\ai-manager\Partitions\<profil>\` | **en clair** — voir limites |

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

Les comptes **actuels** sont réécrits dans le `localStorage` au format 1.0.4, `accounts.json(.bak)` sont renommés en `*.reverted-<date>.json` (rien n'est supprimé), puis l'app se ferme : la 1.0.4 peut être relancée. Testé : la vraie 1.0.4 relit alors les comptes, y compris les modifications faites après la migration.

### Récupération

Fichier corrompu, ou indéchiffrable (autre compte Windows, mot de passe Windows réinitialisé par un administrateur) → modale proposant la sauvegarde. Un fichier illisible est toujours **mis de côté** (`accounts.unreadable-<date>.json`), jamais supprimé. En dernier recours, recréer un compte avec le **même nom de profil** retrouve sa session.

## 6. Limites restantes (assumées, à connaître)

- **Cookies de session en clair** dans `Partitions/`. Ils sont gérés par Chromium, pas par l'app ; l'app ne les lit ni ne les exporte. Les chiffrer passe par le fuse Electron `EnableCookieEncryption` (voir §7) — **irréversible** : volontairement non activé sans décision explicite.
- `safeStorage`/DPAPI protège contre les autres comptes Windows et la copie du disque à froid, **pas** contre un programme malveillant qui tourne sous votre compte (il peut demander le déchiffrement lui-même). Règle inchangée : **une session Windows = une personne**.
- Les anciennes valeurs effacées du `localStorage` peuvent subsister quelque temps dans les fichiers internes de LevelDB (`Local Storage\leveldb\*.log`) jusqu'à leur compactage par Chromium.
- `style-src 'unsafe-inline'` dans la CSP (nécessaire à Monaco et aux styles en ligne).
- Exécutable non signé (SmartScreen) ; pas de vérification d'intégrité de `app.asar`.
- La liste `ALLOWED_POPUP_HOSTS` fait confiance à tous les sous-domaines de ses entrées (ex. `*.google.com`).

## 7. Pistes pour la suite (non faites)

- **Fuses Electron** au packaging (`@electron/fuses`) : désactiver `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` ; activer `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` ; et, sur décision, `EnableCookieEncryption` (passage sûr de « clair » à « chiffré », mais retour impossible : les cookies seraient perdus).
- Signature de l'exécutable.
- Protocole `app://` personnalisé à la place de `file://` (origine propre ; demanderait une migration du `localStorage` restant).
