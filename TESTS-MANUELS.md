# Tests manuels — [OVCR] AI Manager

Ce qui **ne peut pas** être vérifié par `npm test` / `npm run test:electron` :
les tests automatisés n'utilisent ni le réseau, ni les vrais services IA, ni le
vrai profil. Cette liste est à dérouler **à la main** avant une diffusion.

> Avant de commencer : fermer l'app, puis **copier** le dossier
> `%APPDATA%\ai-manager` ailleurs (sauvegarde de sécurité de vos comptes et
> sessions). Cocher chaque case ; noter tout écart avec le diagnostic
> (`?` → « Diagnostic » → « Copier le diagnostic »).

## Version 1.8.0 (export / import des comptes, phase 3 P7) — validée le 28/11/2026

La 1.8.0 ajoute l'export et l'import de la liste des comptes (boutons de
l'en-tête des comptes). Le format des données enregistrées ne change pas
(retour à la 1.7.0 possible sans perte). `npm run test:electron` couvre les
deux parcours avec des boîtes de dialogue simulées, mais **pas** les vraies
boîtes Windows, le vrai `.exe` ni le vrai profil.

- [ ] **Sauvegarde** : app fermée, copier `%APPDATA%\ai-manager` ailleurs.
- [ ] **Démarrage** : lancer le `.exe` 1.8.0 sur le vrai profil : tous les comptes sont là. `?` → « Diagnostic » indique **1.8.0**. Clic droit sur le `.exe` → Propriétés → Détails : version **1.8.0**.
- [ ] **Boutons** : dans l'en-tête « Comptes enregistrés », deux nouvelles icônes (flèche vers le haut = exporter, flèche vers le bas = importer), avec leur info-bulle.
- [ ] **Export** : cliquer sur Exporter : l'avertissement « en clair » s'affiche avec le bon nombre de comptes. « Choisir l'emplacement… » ouvre la **vraie** boîte « Enregistrer sous » (dossier Documents, nom `ovcr-comptes-<date>.json`). L'annuler : l'avertissement reste. Recommencer et enregistrer sur le Bureau : message « N compte(s) exporté(s) dans … ». Ouvrir le fichier dans le Bloc-notes : comptes lisibles, **aucun** cookie ni mot de passe.
- [ ] **Import identique** : Importer → choisir ce fichier : « déjà présents, à l'identique : rien à importer ».
- [ ] **Import avec conflit** : dans le Bloc-notes, changer le `name` d'un compte du fichier et enregistrer. Importer : le résumé nomme ce compte en conflit, « Ignorer » est coché. « Annuler » : rien ne change. Recommencer avec « Remplacer » : le compte prend le nouveau nom, sa session est conservée (ouvrir un service).
- [ ] **Sauvegarde préalable** : `%APPDATA%\ai-manager\backups` contient un `pre-import-<date>.json` (illisible en clair : chiffré).
- [ ] **Fichier refusé** : importer un fichier qui n'est pas un export (ex. un `.json` quelconque) : message clair, rien ne change.
- [ ] **Remettre le vrai nom** du compte modifié (bouton crayon), puis **supprimer le fichier exporté** du Bureau.
- [ ] (Facultatif) **« Importer comme nouveaux comptes »** sur un compte en conflit : un compte apparaît avec un nouveau profil (`profil_N`), sans session (il faudrait se reconnecter). Le supprimer ensuite.

## Version 1.7.0 (découpage de l'interface, phase 3 P6) — validée le 28/11/2026

La 1.7.0 ne change ni le format des données, ni les fuses, ni le processus
principal : seul le code de l'interface est réparti en plusieurs fichiers
(`renderer/`), **sans changement voulu de comportement**. Tout est couvert par
`npm run test:electron` sur des pages locales, mais **pas** avec le vrai `.exe`,
le vrai profil, les vraies boîtes de dialogue ni les vrais services. Le but de
cette liste : vérifier que **rien n'a changé** à l'usage. Retour à la 1.6.0
possible sans perte (même format de données).

- [ ] **Sauvegarde** : app fermée, copier `%APPDATA%\ai-manager` ailleurs.
- [ ] **Démarrage** : lancer le `.exe` 1.7.0 sur le vrai profil. L'app démarre, tous les comptes sont là, les cartes repliées le sont toujours, les largeurs de l'éditeur et de l'explorateur sont celles d'avant. `?` → « Diagnostic » indique **1.7.0** et « Stockage : ok, N compte(s), chiffré ». Clic droit sur le `.exe` → Propriétés → Détails : version **1.7.0**.
- [ ] **Services** : ouvrir 2 ou 3 services déjà connectés : sessions conservées. Passer en vue scindée, ouvrir un 2e service (il va dans le panneau 2), « Fermer le panneau 2 », revenir en vue simple.
- [ ] **Popup Google** : « Continuer avec Google » sur un service : la popup s'ouvre et la connexion aboutit comme avant.
- [ ] **Cooldowns** : « Épuiser (24h) » sur un service (décompte affiché), puis deux clics pour l'annuler.
- [ ] **Comptes** : ajouter un compte de test, le modifier (changer le profil affiche l'avertissement), le supprimer. Replier une carte, « Tout replier », « Tout déplier ».
- [ ] **Palette** : Ctrl+K, taper un nom de compte, Entrée : le service s'ouvre. Échap ferme la palette.
- [ ] **Aide** : `?` affiche les 9 fiches ; « Diagnostic », « Copier le diagnostic » puis coller dans le Bloc-notes : le texte est là ; « Ouvrir le dossier des journaux » ouvre l'Explorateur sur `logs`.
- [ ] **Éditeur** : ouvrir le panneau éditeur (« Chargement de l'éditeur… » puis Monaco), choisir un dossier de test dans la **vraie** boîte « Choisir un dossier », ouvrir un fichier (coloration), le modifier, Ctrl+S (« Fichier enregistré ! »), vérifier le fichier sur le disque.
- [ ] **Colonnes** : élargir l'éditeur et l'explorateur à la souris, fermer l'app, relancer : largeurs conservées.
- [ ] (Facultatif) **Retour à la 1.6.0** : fermer, lancer la 1.6.0 sur le même profil : comptes et sessions intacts. Puis revenir à la 1.7.0.

## Version 1.6.0 (restes de l'audit, phase 3 P8) — validée le 28/11/2026

La 1.6.0 ne change ni le format des données ni les fuses. Nouveautés : premier
enregistrement d'un profil neuf protégé contre un arrêt brutal, popups de
connexion fermées avec leur panneau, liens externes limités à 5 par minute et
par page, construction du `.exe` par `scripts/dist.js`. Tout est couvert par
`npm run test:electron` sur des pages locales, mais **pas** avec le vrai `.exe`,
le vrai profil ni les vrais services.

- [ ] **Sauvegarde** : app fermée, copier `%APPDATA%\ai-manager` ailleurs.
- [ ] Lancer le `.exe` 1.6.0 sur le vrai profil : l'app démarre, tous les comptes sont là, `?` → « Diagnostic » indique la version **1.6.0** et « Stockage : ok, N compte(s), chiffré ». Clic droit sur le `.exe` → Propriétés → Détails : version **1.6.0**.
- [ ] Ouvrir 2 ou 3 services déjà connectés : sessions conservées.
- [ ] **Popup Google** : sur un service, cliquer « Continuer avec Google » (la popup s'ouvre), puis, sans la fermer, ouvrir un autre service dans le même panneau : la popup se ferme toute seule. Recommencer et aller au bout de la connexion : elle aboutit comme avant.
- [ ] Éditeur Monaco : s'ouvre et colore un fichier (contrôle rapide).
- [ ] (Facultatif, profil neuf) Sur un compte Windows de test, ou après avoir renommé `%APPDATA%\ai-manager` (app fermée) : lancer la 1.6.0, attendre 15 s, ajouter un compte, fermer, relancer : le compte est là, Diagnostic « chiffré ». Puis remettre le vrai dossier à sa place.

## 0. Version 1.5.0 (cookies chiffrés) — validée le 28/11/2026

La 1.5.0 active un seul fuse de plus, `EnableCookieEncryption` (SECURITY.md
§5 « Cookies chiffrés »). `npm run test:cookies` vérifie le mécanisme sur une
app jetable : mise à jour sans perte, nouveaux cookies chiffrés, reconnexion,
perte totale au retour arrière. Il ne vérifie **pas** le vrai `.exe`, le vrai
profil ni les vrais services.

⚠️ **Irréversible** : une fois le profil ouvert par la 1.5.0, **ne plus le
rouvrir avec la 1.4.0**, qui effacerait toutes les sessions. La sauvegarde
ci-dessous est la seule voie de retour.

- [ ] **Sauvegarde OBLIGATOIRE** : app fermée, copier `%APPDATA%\ai-manager` ailleurs (par exemple `ai-manager-avant-1.5.0`).
- [ ] Lancer le `.exe` 1.5.0 sur le vrai profil : l'app démarre, tous les comptes sont là, `?` → « Diagnostic » indique la version **1.5.0** et « Stockage : ok, N compte(s), chiffré ».
- [ ] Ouvrir **tous** les services déjà connectés (ou au moins 4 ou 5, dont Gemini et un service connecté par Google) : sessions conservées, **pas de reconnexion demandée**.
- [ ] **Reconnexion** sur un compte peu important : dans le service, se déconnecter puis se reconnecter (de préférence par « Continuer avec Google ») : la connexion aboutit. Fermer l'app, la rouvrir : ce service est toujours connecté. C'est le vrai `.exe` qui relit des cookies chiffrés.
- [ ] Fermer et rouvrir l'app deux fois : toutes les sessions sont toujours là.
- [ ] Éditeur Monaco et popup « Continuer avec Google » : comme en 1.4.0 (contrôle rapide).
- [ ] (Facultatif, vérifie la parade du retour arrière) app fermée : renommer `%APPDATA%\ai-manager` en `ai-manager-1.5.0`, remettre la sauvegarde sous le nom `ai-manager`, lancer la **1.4.0** : comptes et sessions d'avant la mise à jour sont là. Fermer, supprimer ce dossier `ai-manager` (celui de la 1.4.0), renommer `ai-manager-1.5.0` en `ai-manager`, relancer la 1.5.0 : tout est là.
- [ ] Une fois la 1.5.0 adoptée : **supprimer la sauvegarde**, qui contient les anciennes sessions en clair.

## 0 bis. Version 1.4.0 (fuses Electron) — validée le 28/11/2026

La 1.4.0 ne change que le `.exe` (fuses, voir SECURITY.md §2) : ni le code, ni
les données. `npm run test:fuses` vérifie le mécanisme sur une app jetable,
mais **pas** le vrai `.exe` avec le vrai profil (les tests ne le lancent jamais).

- [ ] **Sauvegarde** : app fermée, copier `%APPDATA%\ai-manager` ailleurs.
- [ ] Copier le dossier `dist\[OVCR] AI Manager-win32-x64` dans un chemin avec `[ ]`, des espaces et des accents, lancer le `.exe` : l'app démarre (pas de fermeture immédiate ni de message d'erreur), tous les comptes sont là, `?` → « Diagnostic » indique la version **1.4.0** et « Stockage : ok, N compte(s), chiffré ».
- [ ] **Éditeur Monaco** (chargé hors de l'archive vérifiée) : ouvrir un dossier, ouvrir un fichier, la coloration s'affiche ; modifier, Ctrl+S, rouvrir : modification présente.
- [ ] Ouvrir 2 ou 3 services déjà connectés : sessions conservées ; une popup « Continuer avec Google » s'ouvre normalement.
- [ ] (Contrôle facultatif) dans PowerShell, depuis le dossier du `.exe` : `$env:ELECTRON_RUN_AS_NODE='1'; & '.\[OVCR] AI Manager.exe' -e "console.log('node')"; Remove-Item Env:ELECTRON_RUN_AS_NODE` : l'app **s'ouvre normalement** et rien n'est affiché dans la console (en 1.3.0, le `.exe` servait de Node.js et affichait `node`).
- [ ] Retour à la 1.3.0 puis à la 1.4.0 : tout est toujours là (les fuses ne touchent pas aux données ; `EnableCookieEncryption` n'est **pas** activé).

## 0 ter. Version 1.3.0 (Electron 45) — validée le 28/11/2026

La 1.3.0 change de moteur (Chromium 150 → 156) et d'API de chiffrement des
comptes. Les tests automatiques couvrent le format et l'identité navigateur,
**pas** les vrais services ni le vrai profil.

- [ ] **Sauvegarde** : app fermée, copier `%APPDATA%\ai-manager` ailleurs.
- [ ] Lancer la 1.3.0 sur le vrai profil : tous les comptes sont là ; `?` → « Diagnostic » indique la version 1.3.0, « Stockage : ok, N compte(s), chiffré ».
- [ ] Ouvrir 2 ou 3 services déjà connectés : sessions conservées (pas de reconnexion).
- [ ] **Gemini** et une popup **« Continuer avec Google »** (Claude ou Perplexity, idéalement avec un vrai compte, voir l'avertissement de PROJECT_CONTEXT sur les essais répétés) : la page Google s'affiche, la connexion aboutit, **aucun** « Ce navigateur ou cette application ne sont peut-être pas sécurisés ».
- [ ] Claude et ChatGPT : pas de boucle de vérification Cloudflare.
- [ ] Modifier un compte (ou « Épuiser » un service), fermer, rouvrir : modification conservée.
- [ ] **Retour arrière** (sur la COPIE ou après la sauvegarde) : fermer la 1.3.0, lancer le `.exe` du zip **1.2.0** : les comptes (y compris la modification faite en 1.3.0) sont lus, aucun écran « illisible ». Puis relancer la 1.3.0 : tout est toujours là.
- [ ] (Si utilisé) partage d'écran dans un service : la question dit « capturer votre écran » (et non « micro et caméra »).

## 1. Mise à jour depuis la 1.1.0 (vrai profil)

- [ ] Lancer la nouvelle version sur le profil existant : tous les comptes sont là, mêmes noms, mêmes profils, mêmes cooldowns.
- [ ] Ouvrir un service déjà connecté : la session est conservée (pas de reconnexion).
- [ ] `?` → « Diagnostic » : « Stockage : ok, N compte(s), chiffré », « Écriture des comptes : possible ».
- [ ] Modifier un compte, fermer, rouvrir : la modification est conservée.
- [ ] Aucun bandeau rouge au démarrage.

## 2. Connexions aux 9 services (vraies sessions)

Pour chaque service — Claude, ChatGPT, Gemini, Z.ai, Perplexity, Grok, Leonardo AI, Suno, Meshy AI :

- [ ] Le service s'ouvre et s'affiche (le spinner disparaît).
- [ ] Une connexion neuve fonctionne (compte de test), y compris « Continuer avec Google » (popup OAuth) là où elle existe.
- [ ] La session survit à un redémarrage de l'app.

Points d'attention : Leonardo, Suno (auth Clerk : Google / Discord / téléphone) et Meshy n'avaient jamais été testés en connexion réelle avant la phase 2.

## 3. Erreurs réelles des panneaux

- [ ] **Coupure réseau réelle** : débrancher le Wi-Fi/câble, ouvrir un service → écran « Pas de connexion Internet » ; un panneau déjà ouvert affiche le bandeau « Hors ligne » en haut. Rebrancher → « Réessayer » recharge le service, le bandeau disparaît.
- [ ] **Service indisponible / DNS** (ex. pendant une panne d'un fournisseur, ou en bloquant un domaine dans le pare-feu) → écran « Site introuvable » ou « Service injoignable ».
- [ ] **Ouvrir dans le navigateur** : ouvre l'adresse du service dans le navigateur habituel ; le message rappelle que la session du compte n'y est pas.
- [ ] **Fermer le panneau** depuis l'écran d'erreur : panneau vide, mémoire libérée (diagnostic : un processus « Tab » en moins).
- [ ] **Service qui ne répond plus** (difficile à provoquer : page très lourde) → écran « Le service ne répond plus » avec « Attendre ». Pas de test automatique : en 1.6.0, cinq façons de bloquer la page d'un panneau ont été essayées, aucune n'a déclenché la détection de Chromium.
- [ ] **Popup de connexion qui échoue** (couper le réseau pendant la popup Google) → boîte « La page de connexion n'a pas pu se charger » avec Réessayer / Ouvrir dans le navigateur / Fermer. Depuis la 1.6.0, la boîte et ses trois boutons sont vérifiés automatiquement (`test/integration/popups.js`, réponse simulée) : ce test manuel vérifie la vraie boîte native et une vraie coupure.
- [ ] Aucun de ces écrans ne parle de quota ou de cooldown, et aucun cooldown n'est modifié.

## 4. Cooldowns

- [ ] « Épuiser (24h) » → décompte ; infobulle « Marqué épuisé (manuellement) … fin prévue … ».
- [ ] Cliquer sur un décompte → « Confirmer ? » ; attendre 5 s → le décompte revient ; deux clics → annulé.
- [ ] Fermer/rouvrir l'app : les décomptes sont conservés.
- [ ] (Optionnel) Reculer l'horloge Windows de 2 jours puis relancer : les cooldowns actifs affichent « ⚠ Échéance incohérente » ; les réinitialiser ; **remettre l'horloge à l'heure**.

## 5. Stockage et récupération (sur une COPIE du profil)

À faire uniquement avec un profil de test ou après avoir sauvegardé `%APPDATA%\ai-manager`.

- [ ] App fermée, renommer `accounts.json` en `accounts.json.test` → au lancement : « Liste de comptes introuvable », sauvegarde proposée ; « Restaurer » remet les comptes.
- [ ] App fermée, remplacer le contenu de `accounts.json` par `{abc` → « Données de comptes illisibles » ; « Continuer sans restaurer », créer un compte : un fichier `backups\bak-preserved-main-unreadable-*.json` apparaît.
- [ ] Lancer l'app deux fois : la 2ᵉ fois, la fenêtre existante revient au premier plan (pas de 2ᵉ fenêtre).
- [ ] Fermer l'app juste après un clic sur « Épuiser » : la modification est bien enregistrée au lancement suivant.

## 6. Diagnostic

- [ ] « Copier le diagnostic » puis coller dans un bloc-notes : aucune adresse e-mail, aucune URL complète.
- [ ] « Ouvrir le dossier des journaux » ouvre `%APPDATA%\ai-manager\logs`.
- [ ] Ouvrir `ovcr.log` : aucune adresse e-mail ni jeton.

## 7. Build distribué (.exe)

- [ ] `npm run dist` puis lancer `[OVCR] AI Manager.exe` depuis un dossier dont le chemin contient `[ ]`, des espaces et des accents : l'app démarre, l'éditeur Monaco s'ouvre, le diagnostic indique la bonne version et « (développement) » n'apparaît **pas**.
- [ ] Le dossier packagé ne contient ni `test/`, ni `scripts/`, ni `eslint.config.js`, ni `TESTS-MANUELS.md`.
- [ ] La sortie de `npm run dist` contient `[fuses] appliqués et vérifiés` (sinon le build a échoué : ne pas distribuer).
